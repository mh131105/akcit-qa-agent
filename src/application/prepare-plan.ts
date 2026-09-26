import { isDeepStrictEqual } from 'node:util';
import { buildRouteDetail, type RouteDetailPayload } from '../domain/route-detail.js';
import { routeDependencies, routeEligibility, type RouteDetailRequest, type RouteDependencies } from './route-detail.js';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { resolvePreparationModels, type readConfig, type ResolvedVisualModels } from '../config.js';
import { eligibleRequirements, InvalidPreparationOutput, parseCuration, parsePlan, parseTestCases, parseVerdict,
  type Artifact, type CurationPayload, type PlanPayload, type Verdict } from '../domain/preparation.js';
import { applyPlanApprovalCommand } from '../domain/plan-approval.js';
import { InvalidNavigationOutput } from '../domain/navigation.js';
import { mappingEligibility, produceMapping, preflightVisual, MappingError,
  type MappingRequest, type MappingServices } from './map-application.js';
import { executeSpecialistTask, preflightSpecialists, SpecialistError,
  type SpecialistTask, type SpecialistResult, type PreparationRole } from '../runtime/pi.js';
import { RunStore, StorageError, type RunRecord, type RunOutput, type Preparation, type PreparationCall, type PreparationAnswer, type StoredRun } from '../storage/runs.js';

export class PreparationError extends Error {
  constructor(readonly code: string, message: string, readonly status = 409) { super(message); }
}
export type PreparationOptions = {
  modelCall?: (task: SpecialistTask) => Promise<SpecialistResult>;
  modelPreflight?: typeof preflightSpecialists;
  // Substituição explícita das sessões visuais em testes/smokes; nunca recebida pela API.
  visualCall?: (task: import('../runtime/pi-visual.js').VisualTask) => Promise<import('../runtime/pi-visual.js').VisualResult>;
  visualPreflight?: typeof import('./map-application.js').preflightVisual;
  // Injeção interna de relógio/limites para testes; nunca recebida pela API.
  now?: () => number;
  limits?: Partial<Preparation['limits']>;
};
const defaults = {
  maxRequirements: 10, maxRevisions: 3, maxValidatorAttempts: 2, timeoutMs: 120_000, activeMs: 45 * 60_000, maxActions: 100,
} satisfies Preparation['limits'];
const stopped = () => new PreparationError('CANCELLED', 'A preparação foi cancelada.');
const authorize = (run: RunRecord, userId: string) => {
  if (!userId || run.ownerId !== userId) throw new PreparationError('RUN_NOT_FOUND', 'Execução não encontrada.', 404);
};
function originals(run: RunRecord): Artifact[] {
  if (!run.artifacts.length || run.artifacts.some(item =>
    !['id', 'name', 'version', 'text'].every(key => typeof item[key] === 'string' && !!(item[key] as string).trim())) ||
    new Set(run.artifacts.map(item => item.id)).size !== run.artifacts.length ||
    !Array.isArray(run.input.artifactIds) || run.input.artifactIds.length !== run.artifacts.length ||
    !run.artifacts.every(item => (run.input.artifactIds as unknown[]).includes(item.id))) {
    throw new PreparationError('INVALID_INPUT', 'O rascunho precisa conter artefatos textuais originais preservados.', 400);
  }
  return run.artifacts.map(item => ({ id: item.id as string, name: item.name as string,
    version: item.version as string, text: item.text as string }));
}
function draft(run: RunRecord) {
  if (run.status !== 'draft' || run.phase !== 'intake' || run.outputs.length || run.budgetCycles.length) {
    throw new PreparationError('INVALID_STATE', 'Somente um rascunho em entrada pode iniciar a preparação.');
  }
  originals(run);
}
export type AnswerRequest = { outputId: string; outputRevision: number; questionId: string; text: string };
export type ContinueRequest = { outputId: string; outputRevision: number; expectedAccessRevision?: number };
export function preparationAnswers(run: RunRecord): PreparationAnswer[] {
  // Registros anteriores à coleta de respostas continuam legíveis, sem publicar campos livres.
  return run.answerArtifacts ? run.answers.filter(answer => typeof answer.artifactId === 'string' &&
    typeof answer.id === 'string' && typeof answer.outputId === 'string') as PreparationAnswer[] : [];
}
export function pendingPreparationAnswers(run: RunRecord): PreparationAnswer[] {
  return preparationAnswers(run).filter(answer => !run.preparation?.consumedAnswerIds?.includes(answer.id));
}
export function latestOutput(run: RunRecord, phase: string): RunOutput | undefined {
  const versions = run.outputs.filter(output => output.phase === phase);
  if (new Set(versions.map(output => output.id)).size > 1 ||
    new Set(versions.map(output => output.revision)).size !== versions.length ||
    versions.some(output => !Number.isSafeInteger(output.revision) || output.revision < 1)) {
    throw new StorageError('AMBIGUOUS_RECORD');
  }
  return versions.reduce<RunOutput | undefined>((last, output) =>
    !last || output.revision > last.revision ? output : last, undefined);
}
export function canResumePreparation(run: RunRecord): boolean {
  return !!run.preparation && run.status === 'awaiting_input' && run.phase === 'curation' && pendingPreparationAnswers(run).length > 0;
}
function freezeActiveTime(preparation: Preparation, now: number) {
  if (preparation.finishedAt === null) preparation.accumulatedActiveMs = (preparation.accumulatedActiveMs ?? 0) +
    Math.max(0, now - Date.parse(preparation.startedAt));
  else if (preparation.accumulatedActiveMs === undefined) preparation.accumulatedActiveMs =
    Math.max(0, Date.parse(preparation.finishedAt) - Date.parse(preparation.startedAt));
}

/** A mesma autorização é reconferida durante a produção, sem alterar o estado salvo. */
export function caseDependencies(run: RunRecord, request: ContinueRequest, waiting = true) {
  const plan = latestOutput(run, 'planning');
  const curation = latestOutput(run, 'curation');
  const result = applyPlanApprovalCommand({ status: waiting ? run.status : 'awaiting_approval',
    phase: waiting ? run.phase : 'planning', plan: plan ?? null, curation: curation ?? null,
    validations: run.validations, approvals: run.approvals }, { type: 'continue', ...request, resourceReserved: true });
  if (!result.ok) throw new PreparationError(result.error.code, result.error.message);
  if (result.work?.type !== 'create_cases') {
    throw new PreparationError('INVALID_STATE', 'O pedido de alteração do plano precisa ser analisado antes de gerar casos.');
  }
  const answers = preparationAnswers(run);
  if (pendingPreparationAnswers(run).length || [curation!, plan!].some(output => {
    const refs = output.answerRefs ?? [];
    return refs.length !== answers.length || answers.some(answer => !refs.some(ref =>
      ref.answerId === answer.id && ref.questionId === answer.questionId && ref.revision === answer.revision));
  })) throw new PreparationError('STALE_VERSION', 'Os esclarecimentos precisam ser considerados na curadoria e no plano vigentes.');
  const artifacts = [...originals(run), ...(run.answerArtifacts ?? []) as Artifact[]];
  try { parsePlan(plan!.payload, artifacts, parseCuration(curation!.payload, artifacts)); }
  catch { throw new PreparationError('STALE_VERSION', 'As fontes ou referências da curadoria e do plano não estão preservadas.'); }
  return { plan: plan!, curation: curation!, work: result.work };
}

export function canCreateCases(run: RunRecord): boolean {
  const plan = latestOutput(run, 'planning');
  if (!plan || !run.preparation || run.preparation.finishedAt === null) return false;
  try {
    caseDependencies(run, { outputId: plan.id, outputRevision: plan.revision });
    const preparation = structuredClone(run.preparation);
    freezeActiveTime(preparation, Date.now());
    return preparation.accumulatedActiveMs! < preparation.limits.activeMs;
  } catch { return false; }
}
type Active = { runId: string; id: string; controller: AbortController; done: Promise<void>;
  cases?: ContinueRequest; mapping?: MappingRequest; routes?: { request: RouteDetailRequest; dependencies: RouteDependencies }; workId?: string };

/** ponytail: um coordenador por aplicação/processo, sem fila de trabalhos;
 * múltiplos processos escritores exigiriam uma reserva externa compartilhada. */
export class PreparationCoordinator {
  private active: Active | null = null;
  private starts: Promise<unknown> = Promise.resolve();
  private readonly modelCall;
  private readonly preflight;
  private readonly visualCall;
  private readonly visualPreflight;
  private readonly now;
  private readonly limits;
  constructor(private readonly store: RunStore, private readonly config: ReturnType<typeof readConfig>, options: PreparationOptions = {}) {
    this.modelCall = options.modelCall ?? executeSpecialistTask;
    this.preflight = options.modelPreflight ?? preflightSpecialists;
    this.visualCall = options.visualCall;
    this.visualPreflight = options.visualPreflight ?? preflightVisual;
    this.now = options.now ?? Date.now;
    this.limits = { ...defaults, ...options.limits };
    if (Object.entries(this.limits).some(([key, value]) => !Number.isSafeInteger(value) || (value as number) < 1 ||
      (value as number) > (defaults[key as keyof typeof defaults] as number))) throw new Error('Limites de preparação inválidos.');
  }
  private time() { return new Date(this.now()).toISOString(); }

  start(runId: string, userId: string): Promise<{ accepted: boolean }> {
    const result = this.starts.then(() => this.accept(runId, userId, false));
    this.starts = result.catch(() => {});
    return result;
  }
  resume(runId: string, userId: string): Promise<{ accepted: boolean }> {
    const result = this.starts.then(() => this.accept(runId, userId, true));
    this.starts = result.catch(() => {});
    return result;
  }
  continue(runId: string, userId: string, request: ContinueRequest): Promise<{ accepted: boolean }> {
    const result = this.starts.then(async () => {
      const { run } = await this.store.read(runId);
      authorize(run, userId);
      const referenced = run.outputs.find(output => output.id === request.outputId && output.revision === request.outputRevision);
      if (referenced?.phase === 'mapping') {
        if (request.expectedAccessRevision !== undefined) throw new PreparationError('INVALID_INPUT', 'O detalhamento recebe somente a referência do mapa.', 400);
        return this.acceptRoutes(runId, userId, request);
      }
      if (referenced?.phase === 'planning' && request.expectedAccessRevision === undefined) return this.acceptCases(runId, userId, request);
      if (referenced?.phase === 'case_design' && request.expectedAccessRevision !== undefined) return this.acceptMapping(runId, userId, request as Required<ContinueRequest>);
      throw new PreparationError('STALE_VERSION', 'Informe a saída e a revisão correspondentes à continuidade solicitada.');
    });
    this.starts = result.catch(() => {});
    return result;
  }
  private async acceptRoutes(runId: string, userId: string, request: RouteDetailRequest): Promise<{ accepted: boolean }> {
    const record = await this.store.read(runId);
    authorize(record.run, userId);
    if (record.workIntents.some(work => work.type === 'detail_routes' && work.outputId === request.outputId &&
      work.outputRevision === request.outputRevision && work.processingId)) return { accepted: false };
    const dependencies = routeEligibility(record.run, request, this.config);
    if (this.active) throw new PreparationError('RESOURCE_UNAVAILABLE', 'Ambiente ocupado. O mapa validado foi preservado; tente novamente após o término.');
    const models = await this.models();
    const active: Active = { runId, id: randomUUID(), workId: randomUUID(), routes: { request: { ...request }, dependencies },
      controller: new AbortController(), done: Promise.resolve() };
    this.active = active;
    try {
      await this.store.update(runId, ({ run, workIntents }) => {
        authorize(run, userId);
        if (!isDeepStrictEqual(routeEligibility(run, request, this.config), dependencies)) {
          throw new PreparationError('STALE_VERSION', 'As dependências mudaram antes do início do detalhamento.');
        }
        freezeActiveTime(run.preparation!, this.now());
        run.status = 'running'; run.phase = 'route_detail';
        run.preparation = { ...run.preparation!, id: active.id, startedAt: this.time(), finishedAt: null,
          activeRole: 'test-designer', activity: 'route_detail', stopReason: null };
        workIntents.push({ id: active.workId!, type: 'detail_routes', ...request, createdAt: this.time(),
          processingId: active.id, accessRevision: dependencies.accessRevision, status: 'pending' });
        return { save: true, value: undefined };
      });
      this.dispatch(active, models);
      return { accepted: true };
    } catch (error) {
      try {
        const saved = await this.store.read(runId);
        if (saved.run.status === 'running' && saved.run.preparation?.id === active.id) {
          await this.finish(active, 'interrupted', { code: 'START_FAILED', message: 'Não foi possível confirmar o início do detalhamento.' });
        }
      } finally { if (this.active === active) this.active = null; }
      throw error;
    }
  }
  private checkRoutes(run: RunRecord, active: Active) {
    if (!active.routes) return;
    try {
      if (isDeepStrictEqual(routeDependencies(run, active.routes.request, this.config), active.routes.dependencies)) return;
    } catch (error) {
      if (error instanceof StorageError) throw error;
      // Uma cadeia que perdeu aprovação durante o trabalho também ficou desatualizada.
    }
    throw new PreparationError('STALE_VERSION', 'As dependências utilizadas no detalhamento foram alteradas.');
  }
  /** Continuidade dos casos aprovados: mapeamento visual, com a mesma reserva,
   * o mesmo orçamento ativo e intenção persistida antes do 202. */
  private async acceptMapping(runId: string, userId: string, request: Required<ContinueRequest>): Promise<{ accepted: boolean }> {
    if (typeof request.outputId !== 'string' || !request.outputId || !Number.isSafeInteger(request.outputRevision) ||
      request.outputRevision < 1 || !Number.isSafeInteger(request.expectedAccessRevision) || request.expectedAccessRevision < 1) {
      throw new PreparationError('INVALID_INPUT', 'Informe a revisão exata dos casos aprovados e do acesso configurado.', 400);
    }
    const record = await this.store.read(runId);
    authorize(record.run, userId);
    // Intenção persistida identifica a repetição, inclusive após conclusão/cancelamento.
    if (record.workIntents.some(work => work.type === 'create_map' && work.outputId === request.outputId &&
      work.outputRevision === request.outputRevision && work.accessRevision === request.expectedAccessRevision && work.processingId)) {
      return { accepted: false };
    }
    const eligible = (current: StoredRun) => {
      const result = mappingEligibility(current, request, this.config, this.now());
      if (!result.ok) throw new PreparationError(result.error.code, result.error.message, result.error.status);
      return result.start;
    };
    eligible(record);
    if (this.active) throw new PreparationError('RESOURCE_UNAVAILABLE', 'Ambiente ocupado. Os casos aprovados foram preservados; tente novamente após o término.');
    const models = await this.visualPreflight(this.config);
    if (this.active) throw new PreparationError('RESOURCE_UNAVAILABLE', 'Ambiente ocupado. Os casos aprovados foram preservados; tente novamente após o término.');
    const active: Active = { runId, id: randomUUID(), workId: randomUUID(), mapping: { ...request },
      controller: new AbortController(), done: Promise.resolve() };
    this.active = active;
    try {
      await this.store.update(runId, record => {
        const { run, workIntents } = record;
        authorize(run, userId);
        eligible(record);
        const startedAt = this.time();
        const previous = run.preparation!;
        const limits = { ...previous.limits, maxActions: previous.limits.maxActions ?? this.limits.maxActions ?? defaults.maxActions };
        run.status = 'running'; run.phase = 'mapping';
        run.preparation = { ...previous, id: active.id, startedAt, finishedAt: null,
          activeRole: 'test-executor', activity: 'mapping', stopReason: null, limits,
          consumedActions: previous.consumedActions ?? 0 };
        // O ciclo vigente registra os limites utilizados, incluindo o teto de ações.
        const cycle = run.budgetCycles.find(cycle => cycle.id === previous.budgetCycleId);
        if (cycle) cycle.limits = limits;
        workIntents.push({ type: 'create_map', id: active.workId!, processingId: active.id,
          outputId: request.outputId, outputRevision: request.outputRevision,
          accessRevision: request.expectedAccessRevision, createdAt: startedAt, status: 'pending' });
        return { save: true, value: undefined };
      });
      this.dispatch(active, models);
      return { accepted: true };
    } catch (error) {
      try {
        const saved = await this.store.read(runId);
        if (saved.run.status === 'running' && saved.run.preparation?.id === active.id) {
          await this.finish(active, 'interrupted', { code: 'START_FAILED', message: 'Não foi possível confirmar o início do mapeamento.' });
        }
      } finally { if (this.active === active) this.active = null; }
      throw error;
    }
  }
  private async acceptCases(runId: string, userId: string, request: ContinueRequest): Promise<{ accepted: boolean }> {
    if (typeof request.outputId !== 'string' || !request.outputId || !Number.isSafeInteger(request.outputRevision) || request.outputRevision < 1) {
      throw new PreparationError('INVALID_INPUT', 'Informe a revisão exata do plano aprovado.', 400);
    }
    const record = await this.store.read(runId);
    authorize(record.run, userId);
    // Intenção persistida identifica a repetição, inclusive após conclusão/cancelamento.
    if (record.workIntents.some(work => work.type === 'create_cases' && work.outputId === request.outputId &&
      work.outputRevision === request.outputRevision && work.processingId)) return { accepted: false };
    const eligible = (run: RunRecord) => {
      const dependencies = caseDependencies(run, request);
      if (!run.preparation || run.preparation.finishedAt === null) {
        throw new PreparationError('INVALID_STATE', 'A preparação do plano ainda não foi encerrada.');
      }
      freezeActiveTime(run.preparation, this.now());
      if (run.preparation.accumulatedActiveMs! >= run.preparation.limits.activeMs) {
        throw new PreparationError('ACTIVE_LIMIT', 'O orçamento ativo desta execução foi esgotado.');
      }
      return dependencies;
    };
    eligible(record.run);
    if (this.active) throw new PreparationError('RESOURCE_UNAVAILABLE', 'Ambiente ocupado. O plano aprovado foi preservado; tente novamente após o término.');
    const models = await this.models();
    const active: Active = { runId, id: randomUUID(), workId: randomUUID(), cases: { ...request },
      controller: new AbortController(), done: Promise.resolve() };
    this.active = active;
    try {
      await this.store.update(runId, ({ run, workIntents }) => {
        authorize(run, userId);
        const { work } = eligible(run);
        const startedAt = this.time();
        run.status = 'running'; run.phase = 'case_design';
        run.preparation = { ...run.preparation!, id: active.id, startedAt, finishedAt: null,
          activeRole: 'test-designer', activity: 'case_design', stopReason: null };
        workIntents.push({ ...work, id: active.workId!, processingId: active.id, createdAt: startedAt, status: 'pending' });
        return { save: true, value: undefined };
      });
      this.dispatch(active, models);
      return { accepted: true };
    } catch (error) {
      // rename pode confirmar o registro e o fsync posterior falhar: nunca abandonar running.
      try {
        const saved = await this.store.read(runId);
        if (saved.run.status === 'running' && saved.run.preparation?.id === active.id) {
          await this.finish(active, 'interrupted', { code: 'START_FAILED', message: 'Não foi possível confirmar o início do processamento.' });
        }
      } finally { if (this.active === active) this.active = null; }
      throw error;
    }
  }
  private async models() {
    let models: ReturnType<typeof resolvePreparationModels>;
    try { models = resolvePreparationModels(this.config); }
    catch { throw new PreparationError('MODEL_NOT_CONFIGURED', 'Configure PI_PROVIDER e PI_MODEL; substituições por papel exigem o par completo.', 503); }
    try { await this.preflight(models, this.config.piAuthPath); }
    catch (error) {
      if (error instanceof SpecialistError) throw new PreparationError(error.code, error.message, 503);
      throw new PreparationError('MODEL_UNAVAILABLE', 'Não foi possível conferir os modelos e credenciais configurados.', 503);
    }
    return models;
  }
  private dispatch(active: Active, models: ReturnType<typeof resolvePreparationModels> | ResolvedVisualModels) {
    active.done = new Promise<void>(resolve => setImmediate(resolve))
      .then(() => this.process(active, models))
      .finally(() => { if (this.active === active) this.active = null; });
    void active.done.catch(() => {});
  }
  async answer(runId: string, userId: string, request: AnswerRequest): Promise<void> {
    if (typeof request.outputId !== 'string' || !request.outputId || !Number.isSafeInteger(request.outputRevision) ||
      request.outputRevision < 1 || typeof request.questionId !== 'string' || !request.questionId ||
      typeof request.text !== 'string' || !request.text.trim() || [...request.text].length > 4000) {
      throw new PreparationError('INVALID_INPUT', 'Informe uma resposta de até 4000 caracteres para a versão da pergunta.', 400);
    }
    await this.store.update(runId, ({ run }) => {
      authorize(run, userId);
      if (!run.preparation || !(['awaiting_input', 'awaiting_approval'].includes(run.status)) ||
        !['curation', 'planning'].includes(run.phase)) {
        throw new PreparationError('INVALID_STATE', 'Respostas só podem ser registradas durante a revisão da preparação.');
      }
      const curation = latestOutput(run, 'curation');
      if (!curation || curation.id !== request.outputId || curation.revision !== request.outputRevision) {
        throw new PreparationError('STALE_VERSION', 'A versão da pergunta mudou. Consulte a curadoria atual.');
      }
      const question = (curation.payload as CurationPayload).questions.find(item => item.id === request.questionId);
      if (!question) throw new PreparationError('QUESTION_NOT_FOUND', 'Pergunta não encontrada nesta versão.', 404);
      const previous = preparationAnswers(run).find(answer => answer.outputId === request.outputId &&
        answer.outputRevision === request.outputRevision && answer.questionId === request.questionId);
      if (previous) {
        if (previous.text !== request.text) throw new PreparationError('ANSWER_CONFLICT', 'Esta pergunta já recebeu outra resposta nesta versão.');
        return { save: false, value: undefined };
      }
      const id = randomUUID(), artifactId = randomUUID();
      const answer: PreparationAnswer = { id, revision: 1, ...request, artifactId, actorId: userId, at: this.time() };
      run.answers.push(answer);
      run.answerArtifacts = [...(run.answerArtifacts ?? []), { id: artifactId,
        name: `resposta-${request.questionId}-${id}.txt`, version: '1', text: request.text }];
      // A informação nova invalida a aprovação anterior imediatamente, antes de qualquer chamada paga.
      run.status = 'awaiting_input'; run.phase = 'curation';
      run.preparation.stopReason = { code: 'ANSWERS_PENDING', message: 'Resposta registrada. Retome a preparação para revisar a curadoria e o plano.' };
      return { save: true, value: undefined };
    });
  }
  private async accept(runId: string, userId: string, resume: boolean): Promise<{ accepted: boolean }> {
    const { run } = await this.store.read(runId);
    authorize(run, userId);
    // Repetição consulta o processamento original, inclusive após cancelamento/erro.
    if (!resume && run.preparation) return { accepted: false };
    if (resume) {
      if (run.status === 'running' && this.active?.runId === runId &&
        run.budgetCycles.some(cycle => cycle.id === run.preparation?.budgetCycleId && cycle.reason === 'user_answer')) return { accepted: false };
      if (!canResumePreparation(run)) throw new PreparationError('INVALID_STATE', 'A retomada exige respostas novas e preparação aguardando entrada.');
      freezeActiveTime(run.preparation!, this.now());
      if (run.preparation!.accumulatedActiveMs! >= run.preparation!.limits.activeMs) {
        throw new PreparationError('ACTIVE_LIMIT', 'O orçamento ativo desta execução foi esgotado.');
      }
      originals(run);
    } else draft(run);
    const models = await this.models();
    if (this.active) throw new PreparationError('RESOURCE_UNAVAILABLE', 'Ambiente ocupado. O rascunho foi preservado; tente novamente após o término.');
    const active: Active = { runId, id: randomUUID(), controller: new AbortController(), done: Promise.resolve() };
    this.active = active;
    try {
      await this.store.update(runId, ({ run: current }) => {
        authorize(current, userId);
        if (resume) {
          if (!canResumePreparation(current)) throw new PreparationError('INVALID_STATE', 'A preparação não está mais disponível para retomada.');
          freezeActiveTime(current.preparation!, this.now());
          if (current.preparation!.accumulatedActiveMs! >= current.preparation!.limits.activeMs) {
            throw new PreparationError('ACTIVE_LIMIT', 'O orçamento ativo desta execução foi esgotado.');
          }
        } else draft(current);
        const previous = current.preparation;
        const newAnswers = pendingPreparationAnswers(current);
        const startedAt = this.time();
        const budgetCycleId = randomUUID();
        current.status = 'running'; current.phase = 'curation';
        const limits = previous?.limits ?? this.limits;
        current.validationPolicy = { maxValidationRevisions: limits.maxRevisions,
          maxValidatorAttempts: limits.maxValidatorAttempts, timeoutMs: limits.timeoutMs };
        current.budgetCycles.push({ id: budgetCycleId, startedAt, reason: resume ? 'user_answer' : 'initial_preparation',
          answerRef: null, ...(resume ? { answerRefs: newAnswers.map(answer => answer.id) } : {}),
          affectedCaseIds: [], limits: { ...(previous?.limits ?? this.limits) } });
        current.preparation = { id: active.id, budgetCycleId, startedAt, finishedAt: null,
          activeRole: 'artifact-curator', activity: 'curating', stopReason: null, limits: { ...(previous?.limits ?? this.limits) },
          calls: previous?.calls ?? [], accumulatedActiveMs: previous?.accumulatedActiveMs ?? 0,
          consumedAnswerIds: preparationAnswers(current).map(answer => answer.id) };
        return { save: true, value: undefined };
      });
      this.dispatch(active, models);
      return { accepted: true };
    } catch (error) {
      if (this.active === active) this.active = null;
      throw error;
    }
  }

  async cancel(runId: string, userId: string): Promise<void> {
    await this.store.update(runId, ({ run, workIntents }) => {
      authorize(run, userId);
      if (run.status === 'cancelled') return { save: false, value: undefined };
      if (!['draft', 'running', 'awaiting_input', 'awaiting_approval'].includes(run.status)) {
        throw new PreparationError('INVALID_STATE', 'Esta execução já está encerrada.');
      }
      run.status = 'cancelled';
      for (const work of workIntents) if (work.status === 'pending') {
        work.status = 'cancelled'; work.finishedAt = this.time();
        work.reason = { code: 'CANCELLED', message: 'Processamento cancelado pelo usuário.' };
      }
      if (run.preparation) {
        freezeActiveTime(run.preparation, this.now());
        run.preparation.finishedAt = this.time();
        run.preparation.activeRole = null; run.preparation.activity = null;
        run.preparation.stopReason = { code: 'CANCELLED', message: 'Preparação cancelada pelo usuário.' };
        for (const call of run.preparation.calls) {
          if (call.status === 'running') {
            call.status = 'cancelled'; call.errorCode = 'CANCELLED';
            call.finishedAt = this.time();
            call.durationMs = Math.max(0, this.now() - Date.parse(call.startedAt));
          }
        }
      }
      return { save: true, value: undefined };
    });
    if (this.active?.runId === runId) this.active.controller.abort(stopped());
  }

  /** Útil para encerramento controlado e testes; não integra o contrato HTTP. */
  async settled(): Promise<void> { await this.active?.done; }

  private check(run: RunRecord, active: Active) {
    if (active.controller.signal.aborted) throw active.controller.signal.reason;
    if (run.status !== 'running' || run.preparation?.id !== active.id) throw stopped();
    if ((run.preparation.accumulatedActiveMs ?? 0) + this.now() - Date.parse(run.preparation.startedAt) >= run.preparation.limits.activeMs) {
      throw new PreparationError('ACTIVE_LIMIT', 'O orçamento de 45 minutos de processamento ativo foi esgotado.');
    }
  }
  private async update<T>(active: Active, change: (run: RunRecord) => T): Promise<T> {
    return this.store.update(active.runId, ({ run }) => {
      this.check(run, active);
      return { save: true, value: change(run) };
    });
  }
  /** Atualização serializada com acesso ao envelope completo (credencial/mídia). */
  private updateRecord<T>(active: Active, change: (record: StoredRun) => T): Promise<T> {
    return this.store.update(active.runId, record => {
      this.check(record.run, active);
      return { save: true, value: change(record) };
    });
  }
  private async finish(active: Active, status: string, reason: { code: string; message: string } | null) {
    await this.store.update(active.runId, ({ run, workIntents }) => {
      if (run.status !== 'running' || run.preparation?.id !== active.id) return { save: false, value: undefined };
      if (status === 'awaiting_approval' || (active.routes && ['ready', 'awaiting_input'].includes(status))) this.check(run, active);
      if (active.routes && ['ready', 'awaiting_input'].includes(status)) this.checkRoutes(run, active);
      if (status === 'awaiting_approval' && active.cases) caseDependencies(run, active.cases, false);
      run.status = status;
      freezeActiveTime(run.preparation, this.now());
      run.preparation.finishedAt = this.time(); run.preparation.activeRole = null; run.preparation.activity = null;
      run.preparation.stopReason = reason;
      const work = workIntents.find(work => work.id === active.workId && work.status === 'pending');
      if (work) {
        work.status = status === 'awaiting_approval' || status === 'ready' || (active.routes && reason?.code === 'ROUTES_PENDING') ? 'completed' : status === 'cancelled' ? 'cancelled' : 'interrupted';
        work.finishedAt = this.time();
        if (reason) work.reason = reason;
      }
      return { save: true, value: undefined };
    });
  }
  private async call(active: Active, models: ReturnType<typeof resolvePreparationModels>, role: PreparationRole,
    phase: PreparationCall['phase'], attempt: number, revision: number, input: Record<string, unknown>,
    parse: (value: unknown) => unknown): Promise<unknown> {
    const started = this.now();
    const call: PreparationCall = { id: randomUUID(), role, ...models[role], phase, attempt,
      outputRevision: revision, startedAt: this.time(), status: 'running' };
    const timeoutMs = await this.update(active, run => {
      call.budgetCycleId = run.preparation!.budgetCycleId;
      run.phase = phase;
      run.preparation!.activeRole = role;
      run.preparation!.activity = role === 'output-validator' ? `validating_${phase}` :
        phase === 'curation' ? 'curating' : phase;
      run.preparation!.calls.push(call);
      return run.preparation!.limits.timeoutMs;
    });
    const controller = new AbortController();
    const abort = () => controller.abort(active.controller.signal.reason);
    active.controller.signal.addEventListener('abort', abort, { once: true });
    if (active.controller.signal.aborted) abort();
    const timeout = setTimeout(() => controller.abort(new PreparationError('TIMEOUT', 'A chamada excedeu o limite de tempo.')), timeoutMs);
    let result: SpecialistResult | undefined;
    let failure: unknown;
    let failedMetadata: SpecialistResult['metadata'] | undefined;
    let payload: unknown;
    try {
      if (controller.signal.aborted) throw controller.signal.reason;
      result = await this.modelCall({ role, task: role === 'output-validator' ? 'validate-output' :
        phase === 'curation' ? 'curate-artifacts' : phase === 'planning' ? 'create-test-plan' : phase === 'route_detail' ? 'detail-test-routes' : 'create-test-cases',
        model: models[role], prompt: JSON.stringify(input),
        ...(this.config.piAuthPath ? { authPath: this.config.piAuthPath } : {}),
        signal: controller.signal, timeoutMs });
      if (controller.signal.aborted) throw controller.signal.reason;
      payload = parse(result.payload);
    } catch (error) {
      if (error instanceof SpecialistError) failedMetadata = error.metadata;
      failure = controller.signal.aborted ? controller.signal.reason : error;
    }
    finally {
      clearTimeout(timeout);
      active.controller.signal.removeEventListener('abort', abort);
    }
    await this.store.update(active.runId, ({ run }) => {
      const saved = run.preparation?.id === active.id && run.preparation.calls.find(item => item.id === call.id);
      if (!saved || !['running', 'cancelled'].includes(saved.status)) return { save: false, value: undefined };
      saved.finishedAt = this.time(); saved.durationMs = Math.max(0, this.now() - started);
      saved.status = run.status === 'cancelled' ? 'cancelled' : failure instanceof InvalidPreparationOutput ||
        (failure instanceof SpecialistError && failure.code === 'INVALID_OUTPUT') ? 'invalid' : failure ? 'error' : 'completed';
      if (failure) saved.errorCode = this.failure(failure).code;
      // Lista explícita: não salvar texto bruto, raciocínio ou metadados arbitrários do provedor.
      const metadata = result?.metadata ?? failedMetadata;
      if (metadata?.thinkingLevel) saved.thinkingLevel = metadata.thinkingLevel;
      const usage = metadata?.usage;
      if (usage) {
        saved.usage = {};
        for (const key of ['input', 'output', 'cacheRead', 'cacheWrite', 'totalTokens'] as const) {
          const value = usage[key];
          if (typeof value === 'number' && Number.isFinite(value) && value >= 0) saved.usage[key] = value;
        }
      }
      const cost = metadata?.estimatedCost;
      if (typeof cost === 'number' && Number.isFinite(cost) && cost >= 0) saved.estimatedCost = cost;
      return { save: true, value: undefined };
    });
    this.check((await this.store.read(active.runId)).run, active);
    if (failure) throw failure;
    return payload;
  }
  private failure(error: unknown): { code: string; message: string } {
    if (error instanceof StorageError) return { code: error.code, message: error.message };
    if (error instanceof PreparationError || error instanceof SpecialistError || error instanceof InvalidPreparationOutput ||
      error instanceof InvalidNavigationOutput || error instanceof MappingError) {
      return { code: error.code, message: error.message };
    }
    return { code: 'MODEL_ERROR', message: 'Falha técnica na preparação. Os registros confirmados foram preservados.' };
  }

  private async process(active: Active, models: ReturnType<typeof resolvePreparationModels> | ResolvedVisualModels) {
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      const initial = (await this.store.read(active.runId)).run;
      deadline = setTimeout(() => active.controller.abort(new PreparationError('ACTIVE_LIMIT',
        'O orçamento de processamento ativo foi esgotado.')), Math.max(1,
        initial.preparation!.limits.activeMs - (initial.preparation!.accumulatedActiveMs ?? 0) - (this.now() - Date.parse(initial.preparation!.startedAt))));
      this.check(initial, active);
      if (active.mapping) {
        const services: MappingServices = {
          read: () => this.store.read(active.runId),
          update: change => this.updateRecord(active, change),
          finish: (status, reason) => this.finish(active, status, reason),
          failure: error => this.failure(error),
          now: this.now, time: () => this.time(), signal: active.controller.signal,
          config: this.config, models: models as ResolvedVisualModels,
          mediaDir: join(this.config.dataDir, 'media', active.runId),
          ...(this.visualCall ? { visualCall: this.visualCall } : {}),
        };
        await produceMapping(services, active.mapping);
        return;
      }
      const artifacts = [...originals(initial), ...(initial.answerArtifacts ?? []) as Artifact[]];
      const answers = preparationAnswers(initial).map(answer => ({ ...answer,
        question: (initial.outputs.find(output => output.id === answer.outputId && output.revision === answer.outputRevision)
          ?.payload as CurationPayload | undefined)?.questions.find(question => question.id === answer.questionId),
      }));
      const common = { artifacts, answers, objective: typeof initial.input.objective === 'string' ? initial.input.objective : '' };
      if (active.routes) {
        this.checkRoutes(initial, active);
        const { curation, plan, cases, mapping, navigation, caseApproval } = active.routes.dependencies;
        const output = await this.produce(active, models as ReturnType<typeof resolvePreparationModels>, 'route_detail', {
          ...common, approvedCuration: curation, approvedPlan: plan, approvedCases: cases,
          caseApproval, approvedMapping: mapping, pending: navigation.pending,
        }, artifacts, curation, plan);
        if (output) {
          const anyRoute = (output.payload as RouteDetailPayload).testCases.some(item => item.pathId !== null);
          await this.finish(active, anyRoute ? 'ready' : 'awaiting_input', anyRoute ? null : {
            code: 'ROUTES_PENDING', message: 'Nenhum caso possui percurso observado. Consulte as pendências; a retomada desta etapa ainda não está disponível.' });
        }
        return;
      }
      if (active.cases) {
        const textualModels = models as ReturnType<typeof resolvePreparationModels>;
        const { curation, plan } = caseDependencies(initial, active.cases, false);
        const cases = await this.produce(active, textualModels, 'case_design', { ...common,
          approvedCuration: curation, approvedPlan: plan,
          planApproval: initial.approvals.find(decision => decision.outputId === plan.id && decision.outputRevision === plan.revision),
        }, artifacts, curation, plan);
        if (cases) await this.finish(active, 'awaiting_approval', null);
        return;
      }
      const curation = await this.produce(active, models as ReturnType<typeof resolvePreparationModels>, 'curation', common, artifacts);
      if (!curation) return;
      const curated = curation.payload as CurationPayload;
      if (!eligibleRequirements(curated).length) {
        await this.finish(active, 'awaiting_input', { code: 'INSUFFICIENT_INFORMATION',
          message: 'Falta informação para planejar requisitos independentes. Responda às perguntas e retome a preparação.' });
        return;
      }
      const plan = await this.produce(active, models as ReturnType<typeof resolvePreparationModels>, 'planning', { ...common, approvedCuration: curation }, artifacts, curation);
      if (plan) await this.finish(active, 'awaiting_approval', null);
    } catch (error) {
      const reason = this.failure(error);
      await this.finish(active, ['ACTIVE_LIMIT', 'REVISION_LIMIT', 'VALIDATOR_LIMIT', 'INPUT_LIMIT', 'CASE_LIMIT', 'STALE_VERSION', 'IMAGE_LIMIT'].includes(reason.code)
        ? 'interrupted' : reason.code === 'CANCELLED' ? 'cancelled' : 'error', reason);
    } finally { clearTimeout(deadline); }
  }

  private async produce(active: Active, models: ReturnType<typeof resolvePreparationModels>, phase: PreparationCall['phase'],
    common: Record<string, unknown>, artifacts: Artifact[], curation?: RunOutput, plan?: RunOutput): Promise<RunOutput | null> {
    const initial = (await this.store.read(active.runId)).run;
    const checkDependencies = (run: RunRecord) => {
      if (active.routes) { this.checkRoutes(run, active); return; }
      if (!active.cases) return;
      const dependencies = caseDependencies(run, active.cases, false);
      if (dependencies.curation.id !== curation!.id || dependencies.curation.revision !== curation!.revision ||
        JSON.stringify([...originals(run), ...(run.answerArtifacts ?? [])]) !== JSON.stringify(artifacts)) {
        throw new PreparationError('STALE_VERSION', 'As dependências utilizadas nos casos foram alteradas.');
      }
    };
    let previous: RunOutput | null = latestOutput(initial, phase) ?? null;
    const id = previous?.id ?? randomUUID();
    let feedback: unknown = null;
    for (let attempt = 1; attempt <= initial.preparation!.limits.maxRevisions; attempt++) {
      const previousOutput = previous;
      const revision = (previous?.revision ?? 0) + 1;
      let payload: Record<string, unknown>;
      try {
        payload = await this.call(active, models, phase === 'curation' ? 'artifact-curator' : 'test-designer',
          phase, attempt, revision, { task: phase, ...common, previousOutput: previous, feedback }, value => phase === 'curation'
            ? parseCuration(value, artifacts) : phase === 'route_detail' ? buildRouteDetail(value, active.routes!.dependencies.logicalCases,
              active.routes!.dependencies.navigation, { outputId: active.routes!.dependencies.cases.id, revision: active.routes!.dependencies.cases.revision })
              : phase === 'planning' ? parsePlan(value, artifacts, curation!.payload as CurationPayload)
              : parseTestCases(value, artifacts, curation!.payload as CurationPayload, plan!.payload as PlanPayload)) as Record<string, unknown>;
      } catch (error) {
        if (error instanceof InvalidPreparationOutput && ['INPUT_LIMIT', 'CASE_LIMIT'].includes(error.code)) throw error;
        if (error instanceof InvalidPreparationOutput || (error instanceof SpecialistError && error.code === 'INVALID_OUTPUT')) {
          feedback = this.failure(error); continue;
        }
        throw error;
      }
      const output = await this.update(active, run => {
        checkDependencies(run);
        // Dependência exata conferida novamente antes de salvar o plano.
        if (curation) {
          const latest = run.outputs.filter(item => item.phase === 'curation').at(-1);
          const verdicts = run.validations.filter(item => item.outputId === curation.id &&
            item.outputRevision === curation.revision && item.status !== 'error' && item.validator === 'output-validator');
          if (latest?.id !== curation.id || latest.revision !== curation.revision || verdicts.length !== 1 || verdicts[0]?.status !== 'approved') {
            throw new PreparationError('STALE_VERSION', 'A curadoria aprovada não é mais vigente.');
          }
        }
        const output: RunOutput = { id, phase, revision, producer: phase === 'curation' ? 'artifact-curator' : 'test-designer',
          createdAt: this.time(), budgetCycleId: run.preparation!.budgetCycleId,
          ...(active.routes ? { accessRevision: active.routes.dependencies.accessRevision } : {}),
          dependsOn: [curation, plan, ...(active.routes ? [active.routes.dependencies.cases, active.routes.dependencies.mapping] : [])].filter((item): item is RunOutput => !!item)
            .map(item => ({ outputId: item.id, revision: item.revision })),
          answerRefs: preparationAnswers(run).map(answer => ({ answerId: answer.id, questionId: answer.questionId, revision: answer.revision })), payload };
        run.outputs.push(output);
        if (phase === 'curation') run.questions = (payload as CurationPayload).questions;
        return output;
      });
      previous = output;
      let verdict: Verdict | undefined;
      for (let validatorAttempt = 1; validatorAttempt <= initial.preparation!.limits.maxValidatorAttempts; validatorAttempt++) {
        try {
          const { run } = await this.store.read(active.runId);
          verdict = await this.call(active, models, 'output-validator', phase, validatorAttempt, revision,
            { task: 'validation', ...common, output, previousOutput,
              previousVerdicts: run.validations.filter(item => item.outputId === id) }, parseVerdict) as Verdict;
          await this.update(active, run => {
            checkDependencies(run);
            run.validations.push({ id: randomUUID(), outputId: id, outputRevision: revision,
              validator: 'output-validator', at: this.time(), attempt: validatorAttempt, ...verdict! });
          });
          break;
        } catch (error) {
          if (error instanceof StorageError || (error instanceof PreparationError && error.code === 'STALE_VERSION')) throw error;
          if (active.controller.signal.aborted) throw active.controller.signal.reason;
          const reason = this.failure(error);
          await this.update(active, run => {
            run.validations.push({ id: randomUUID(), outputId: id, outputRevision: revision,
              validator: 'output-validator', at: this.time(), attempt: validatorAttempt, status: 'error',
              reason: reason.message, findings: [{ code: reason.code, message: reason.message, location: null }] });
          });
          if (validatorAttempt === initial.preparation!.limits.maxValidatorAttempts) {
            if (reason.code === 'INVALID_MODEL_OUTPUT' || reason.code === 'INVALID_OUTPUT') {
              throw new PreparationError('VALIDATOR_LIMIT', 'O limite de tentativas técnicas do validador foi esgotado sem parecer válido.');
            }
            throw error;
          }
        }
      }
      if (verdict?.status === 'approved') return output;
      if (verdict?.status === 'blocked') {
        const insufficient = phase === 'curation' && !eligibleRequirements(payload as CurationPayload).length &&
          (payload as CurationPayload).questions.length > 0;
        await this.finish(active, insufficient || active.routes ? 'awaiting_input' : 'interrupted',
          { code: 'VALIDATION_BLOCKED', message: verdict.reason });
        return null;
      }
      feedback = verdict;
    }
    throw new PreparationError('REVISION_LIMIT', 'O limite de três tentativas de produção/revisão da saída foi esgotado.');
  }
}
