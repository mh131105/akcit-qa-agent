import { randomUUID } from 'node:crypto';
import { resolvePreparationModels, type readConfig } from '../config.js';
import { eligibleRequirements, InvalidPreparationOutput, parseCuration, parsePlan, parseVerdict,
  type Artifact, type CurationPayload, type Verdict } from '../domain/preparation.js';
import { executeSpecialistTask, preflightSpecialists, SpecialistError,
  type SpecialistTask, type SpecialistResult, type PreparationRole } from '../runtime/pi.js';
import { RunStore, StorageError, type RunRecord, type RunOutput, type Preparation, type PreparationCall } from '../storage/runs.js';

export class PreparationError extends Error {
  constructor(readonly code: string, message: string, readonly status = 409) { super(message); }
}
export type PreparationOptions = {
  modelCall?: (task: SpecialistTask) => Promise<SpecialistResult>;
  modelPreflight?: typeof preflightSpecialists;
  // Injeção interna de relógio/limites para testes; nunca recebida pela API.
  now?: () => number;
  limits?: Partial<Preparation['limits']>;
};
const defaults: Preparation['limits'] = {
  maxRequirements: 10, maxRevisions: 3, maxValidatorAttempts: 2, timeoutMs: 120_000, activeMs: 45 * 60_000,
};
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
type Active = { runId: string; id: string; controller: AbortController; done: Promise<void> };

/** ponytail: um coordenador por aplicação/processo, sem fila de trabalhos;
 * múltiplos processos escritores exigiriam uma reserva externa compartilhada. */
export class PreparationCoordinator {
  private active: Active | null = null;
  private starts: Promise<unknown> = Promise.resolve();
  private readonly modelCall;
  private readonly preflight;
  private readonly now;
  private readonly limits;
  constructor(private readonly store: RunStore, private readonly config: ReturnType<typeof readConfig>, options: PreparationOptions = {}) {
    this.modelCall = options.modelCall ?? executeSpecialistTask;
    this.preflight = options.modelPreflight ?? preflightSpecialists;
    this.now = options.now ?? Date.now;
    this.limits = { ...defaults, ...options.limits };
    if (Object.entries(this.limits).some(([key, value]) => !Number.isSafeInteger(value) || value < 1 ||
      value > defaults[key as keyof typeof defaults])) throw new Error('Limites de preparação inválidos.');
  }
  private time() { return new Date(this.now()).toISOString(); }

  start(runId: string, userId: string): Promise<{ accepted: boolean }> {
    const result = this.starts.then(() => this.accept(runId, userId));
    this.starts = result.catch(() => {});
    return result;
  }
  private async accept(runId: string, userId: string): Promise<{ accepted: boolean }> {
    const { run } = await this.store.read(runId);
    authorize(run, userId);
    // Repetição consulta o processamento original, inclusive após cancelamento/erro.
    if (run.preparation) return { accepted: false };
    draft(run);
    let models: ReturnType<typeof resolvePreparationModels>;
    try { models = resolvePreparationModels(this.config); }
    catch { throw new PreparationError('MODEL_NOT_CONFIGURED', 'Configure PI_PROVIDER e PI_MODEL; substituições por papel exigem o par completo.', 503); }
    try { await this.preflight(models); }
    catch (error) {
      if (error instanceof SpecialistError) throw new PreparationError(error.code, error.message, 503);
      throw new PreparationError('MODEL_UNAVAILABLE', 'Não foi possível conferir os modelos e credenciais configurados.', 503);
    }
    if (this.active) throw new PreparationError('RESOURCE_UNAVAILABLE', 'Ambiente ocupado. O rascunho foi preservado; tente novamente após o término.');
    const active: Active = { runId, id: randomUUID(), controller: new AbortController(), done: Promise.resolve() };
    this.active = active;
    try {
      await this.store.update(runId, ({ run: current }) => {
        authorize(current, userId);
        draft(current);
        const startedAt = this.time();
        const budgetCycleId = randomUUID();
        current.status = 'running'; current.phase = 'curation';
        current.validationPolicy = { maxValidationRevisions: this.limits.maxRevisions,
          maxValidatorAttempts: this.limits.maxValidatorAttempts, timeoutMs: this.limits.timeoutMs };
        current.budgetCycles.push({ id: budgetCycleId, startedAt, reason: 'initial_preparation',
          answerRef: null, affectedCaseIds: [], limits: { ...this.limits } });
        current.preparation = { id: active.id, budgetCycleId, startedAt, finishedAt: null,
          activeRole: 'artifact-curator', activity: 'curating', stopReason: null, limits: { ...this.limits }, calls: [] };
        return { save: true, value: undefined };
      });
      active.done = new Promise<void>(resolve => setImmediate(resolve))
        .then(() => this.process(active, models))
        .finally(() => { if (this.active === active) this.active = null; });
      // Falha de armazenamento permanece observável pelo estado running e pela recuperação.
      void active.done.catch(() => {});
      return { accepted: true };
    } catch (error) {
      if (this.active === active) this.active = null;
      throw error;
    }
  }

  async cancel(runId: string, userId: string): Promise<void> {
    await this.store.update(runId, ({ run }) => {
      authorize(run, userId);
      if (run.status === 'cancelled') return { save: false, value: undefined };
      if (!['draft', 'running', 'awaiting_input', 'awaiting_approval'].includes(run.status)) {
        throw new PreparationError('INVALID_STATE', 'Esta execução já está encerrada.');
      }
      run.status = 'cancelled';
      if (run.preparation) {
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
    if (this.now() - Date.parse(run.preparation.startedAt) >= run.preparation.limits.activeMs) {
      throw new PreparationError('ACTIVE_LIMIT', 'O orçamento de 45 minutos de processamento ativo foi esgotado.');
    }
  }
  private async update<T>(active: Active, change: (run: RunRecord) => T): Promise<T> {
    return this.store.update(active.runId, ({ run }) => {
      this.check(run, active);
      return { save: true, value: change(run) };
    });
  }
  private async finish(active: Active, status: string, reason: { code: string; message: string } | null) {
    await this.store.update(active.runId, ({ run }) => {
      if (run.status !== 'running' || run.preparation?.id !== active.id) return { save: false, value: undefined };
      run.status = status;
      run.preparation.finishedAt = this.time(); run.preparation.activeRole = null; run.preparation.activity = null;
      run.preparation.stopReason = reason;
      return { save: true, value: undefined };
    });
  }
  private async call(active: Active, models: ReturnType<typeof resolvePreparationModels>, role: PreparationRole,
    phase: 'curation' | 'planning', attempt: number, revision: number, input: Record<string, unknown>,
    parse: (value: unknown) => unknown): Promise<unknown> {
    const started = this.now();
    const call: PreparationCall = { id: randomUUID(), role, ...models[role], phase, attempt,
      outputRevision: revision, startedAt: this.time(), status: 'running' };
    await this.update(active, run => {
      run.phase = phase;
      run.preparation!.activeRole = role;
      run.preparation!.activity = role === 'output-validator' ? `validating_${phase}` :
        phase === 'curation' ? 'curating' : 'planning';
      run.preparation!.calls.push(call);
    });
    const controller = new AbortController();
    const abort = () => controller.abort(active.controller.signal.reason);
    active.controller.signal.addEventListener('abort', abort, { once: true });
    if (active.controller.signal.aborted) abort();
    const timeout = setTimeout(() => controller.abort(new PreparationError('TIMEOUT', 'A chamada excedeu o limite de tempo.')), this.limits.timeoutMs);
    let result: SpecialistResult | undefined;
    let failure: unknown;
    let failedMetadata: SpecialistResult['metadata'] | undefined;
    let payload: unknown;
    try {
      if (controller.signal.aborted) throw controller.signal.reason;
      result = await this.modelCall({ role, model: models[role], prompt: JSON.stringify(input),
        signal: controller.signal, timeoutMs: this.limits.timeoutMs });
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
    if (error instanceof PreparationError || error instanceof SpecialistError || error instanceof InvalidPreparationOutput) {
      return { code: error.code, message: error.message };
    }
    return { code: 'MODEL_ERROR', message: 'Falha técnica na preparação. Os registros confirmados foram preservados.' };
  }

  private async process(active: Active, models: ReturnType<typeof resolvePreparationModels>) {
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      const initial = (await this.store.read(active.runId)).run;
      deadline = setTimeout(() => active.controller.abort(new PreparationError('ACTIVE_LIMIT',
        'O orçamento de processamento ativo foi esgotado.')), Math.max(1,
        this.limits.activeMs - (this.now() - Date.parse(initial.preparation!.startedAt))));
      this.check(initial, active);
      const artifacts = originals(initial);
      const common = { artifacts, objective: typeof initial.input.objective === 'string' ? initial.input.objective : '' };
      const curation = await this.produce(active, models, 'curation', common, artifacts);
      if (!curation) return;
      const curated = curation.payload as CurationPayload;
      if (!eligibleRequirements(curated).length) {
        await this.finish(active, 'awaiting_input', { code: 'INSUFFICIENT_INFORMATION',
          message: 'Falta informação para planejar requisitos independentes. Consulte as perguntas; resposta e retomada ainda não estão disponíveis.' });
        return;
      }
      const plan = await this.produce(active, models, 'planning', { ...common, approvedCuration: curation }, artifacts, curation);
      if (plan) await this.finish(active, 'awaiting_approval', null);
    } catch (error) {
      const reason = this.failure(error);
      await this.finish(active, ['ACTIVE_LIMIT', 'REVISION_LIMIT', 'VALIDATOR_LIMIT', 'INPUT_LIMIT'].includes(reason.code)
        ? 'interrupted' : reason.code === 'CANCELLED' ? 'cancelled' : 'error', reason);
    } finally { clearTimeout(deadline); }
  }

  private async produce(active: Active, models: ReturnType<typeof resolvePreparationModels>, phase: 'curation' | 'planning',
    common: Record<string, unknown>, artifacts: Artifact[], curation?: RunOutput): Promise<RunOutput | null> {
    const id = randomUUID();
    let previous: RunOutput | null = null;
    let feedback: unknown = null;
    for (let attempt = 1; attempt <= this.limits.maxRevisions; attempt++) {
      const revision = (previous?.revision ?? 0) + 1;
      let payload: Record<string, unknown>;
      try {
        payload = await this.call(active, models, phase === 'curation' ? 'artifact-curator' : 'test-designer',
          phase, attempt, revision, { task: phase, ...common, previousOutput: previous, feedback }, value => phase === 'curation'
            ? parseCuration(value, artifacts) : parsePlan(value, artifacts, curation!.payload as CurationPayload)) as Record<string, unknown>;
      } catch (error) {
        if (error instanceof InvalidPreparationOutput && error.code === 'INPUT_LIMIT') throw error;
        if (error instanceof InvalidPreparationOutput || (error instanceof SpecialistError && error.code === 'INVALID_OUTPUT')) {
          feedback = this.failure(error); continue;
        }
        throw error;
      }
      const output = await this.update(active, run => {
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
          dependsOn: curation ? [{ outputId: curation.id, revision: curation.revision }] : [], answerRefs: [], payload };
        run.outputs.push(output);
        if (phase === 'curation') run.questions = (payload as CurationPayload).questions;
        return output;
      });
      previous = output;
      let verdict: Verdict | undefined;
      for (let validatorAttempt = 1; validatorAttempt <= this.limits.maxValidatorAttempts; validatorAttempt++) {
        try {
          const { run } = await this.store.read(active.runId);
          verdict = await this.call(active, models, 'output-validator', phase, validatorAttempt, revision,
            { task: 'validation', ...common, output, previousVerdicts: run.validations.filter(item => item.outputId === id) }, parseVerdict) as Verdict;
          await this.update(active, run => {
            run.validations.push({ id: randomUUID(), outputId: id, outputRevision: revision,
              validator: 'output-validator', at: this.time(), attempt: validatorAttempt, ...verdict! });
          });
          break;
        } catch (error) {
          if (error instanceof StorageError) throw error;
          if (active.controller.signal.aborted) throw active.controller.signal.reason;
          const reason = this.failure(error);
          await this.update(active, run => {
            run.validations.push({ id: randomUUID(), outputId: id, outputRevision: revision,
              validator: 'output-validator', at: this.time(), attempt: validatorAttempt, status: 'error',
              reason: reason.message, findings: [{ code: reason.code, message: reason.message, location: null }] });
          });
          if (validatorAttempt === this.limits.maxValidatorAttempts) {
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
        await this.finish(active, insufficient ? 'awaiting_input' : 'interrupted',
          { code: 'VALIDATION_BLOCKED', message: verdict.reason });
        return null;
      }
      feedback = verdict;
    }
    throw new PreparationError('REVISION_LIMIT', 'O limite de três tentativas de produção/revisão da saída foi esgotado.');
  }
}
