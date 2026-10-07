import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MAP_LIMITS, parseNavigation, type NavigationPayload } from '../domain/navigation.js';
import { InvalidNavigationOutput } from '../domain/navigation.js';
import { parseVerdict, type Artifact, type TestCasesPayload, type Verdict } from '../domain/preparation.js';
import { caseDependencies, answersCurrent, preparationAnswers, effectiveAnswers, PreparationError, latestOutput } from './prepare-plan.js';
import { resolveTargetCredential } from './target-access.js';
import { StorageError, type RunOutput, type RunRecord, type StoredRun } from '../storage/runs.js';
import { preflightVisualModels, type VisualResult, type VisualTask } from '../runtime/pi-visual.js';
import { runVisual } from './visual-call.js';
import { SpecialistError } from '../runtime/pi.js';
import { resolveVisualModels, type readConfig, type ResolvedVisualModels } from '../config.js';

export class MappingError extends Error {
  constructor(readonly code: string, message: string, readonly status = 409) { super(message); this.name = 'MappingError'; }
}
export type MappingRequest = { outputId: string; outputRevision: number; expectedAccessRevision: number };
export type MappingStart = { curation: RunOutput; plan: RunOutput; cases: RunOutput; artifacts: Artifact[]; caseIds: string[] };

function accessRevision(run: RunRecord): number {
  return typeof run.input?.accessRevision === 'number' ? run.input.accessRevision : 0;
}
function validAccess(record: StoredRun, config: Pick<ReturnType<typeof readConfig>, 'targetAllowedOrigins'>): { url: URL } | { error: { code: string; message: string; status: number } } {
  const input = record.run.input ?? {};
  if (typeof input.startUrl !== 'string' || !input.startUrl || input.authorizedTarget !== true ||
    !record.targetCredential || record.targetCredential.ref !== input.credentialRef) {
    return { error: { code: 'ACCESS_NOT_CONFIGURED', message: 'Configure o endereço, a autorização e a credencial de teste antes do mapeamento.', status: 409 } };
  }
  let url: URL;
  try { url = new URL(input.startUrl); }
  catch { return { error: { code: 'ACCESS_NOT_CONFIGURED', message: 'O endereço configurado para o alvo é inválido.', status: 409 } }; }
  if (!config.targetAllowedOrigins.includes(url.origin)) {
    return { error: { code: 'TARGET_NOT_ALLOWED', message: 'O endereço configurado não está mais autorizado para testes.', status: 403 } };
  }
  return { url };
}

/** Tempo ativo gasto quando a preparação está encerrada. `accumulatedActiveMs` já
 * contém o período encerrado (congelado ao terminar); somá-lo de novo contaria o
 * mesmo intervalo duas vezes. Registros legados sem o campo calculam o período
 * encerrado como compatibilidade. Durante trabalho ativo, soma-se apenas o período
 * ainda em andamento — espera humana nunca entra na conta. */
function frozenActiveMs(preparation: NonNullable<RunRecord['preparation']>, now: number): number {
  const accumulated = preparation.accumulatedActiveMs ?? 0;
  if (preparation.finishedAt === null) {
    return accumulated + Math.max(0, now - Date.parse(preparation.startedAt));
  }
  if (preparation.accumulatedActiveMs === undefined) {
    return Math.max(0, Date.parse(preparation.finishedAt) - Date.parse(preparation.startedAt));
  }
  return accumulated;
}

/** Verificação específica das condições de início do mapeamento. Não usa canDecideCases:
 * ela fica falsa depois que a decisão humana já existe. Reutiliza caseDependencies para
 * curadoria, plano e esclarecimentos vigentes; confere as duas aprovações humanas. */
export function mappingEligibility(
  record: StoredRun,
  request: MappingRequest,
  config: Pick<ReturnType<typeof readConfig>, 'targetAllowedOrigins'>,
  now: number,
  options: { checkState?: boolean } = {},
): { ok: true; start: MappingStart } | { ok: false; error: { code: string; message: string; status: number } } {
  const run = record.run;
  const refuse = (code: string, message: string, status = 409) => ({ ok: false as const, error: { code, message, status } });
  if (!Number.isSafeInteger(request.expectedAccessRevision) || request.expectedAccessRevision < 1) {
    return refuse('INVALID_INPUT', 'Informe a revisão exata do acesso configurado para iniciar o mapeamento.', 400);
  }
  const cases = latestOutput(run, 'case_design');
  const plan = latestOutput(run, 'planning');
  const curation = latestOutput(run, 'curation');
  if (!cases || !plan || !curation || cases.id !== request.outputId || cases.revision !== request.outputRevision) {
    return refuse('STALE_VERSION', 'Casos de teste inexistentes ou desatualizados. Atualize a versão.');
  }
  let dependencies: ReturnType<typeof caseDependencies>;
  try {
    dependencies = caseDependencies(run, { outputId: plan.id, outputRevision: plan.revision }, false);
  } catch (error) {
    const failure = error instanceof PreparationError ? error : new PreparationError('STALE_VERSION', 'Dependências desatualizadas.');
    return refuse(failure.code, failure.message);
  }
  if (dependencies.curation.id !== curation.id || dependencies.curation.revision !== curation.revision ||
    dependencies.plan.id !== plan.id || dependencies.plan.revision !== plan.revision) {
    return refuse('STALE_VERSION', 'Curadoria ou plano aprovados não são mais vigentes.');
  }
  if (!run.preparation) return refuse('INVALID_STATE', 'A preparação ainda não foi encerrada.');
  const preparation = run.preparation;
  const active = options.checkState === false;
  if (!active && preparation.finishedAt === null) {
    return refuse('INVALID_STATE', 'A preparação ainda não foi encerrada.');
  }
  const spent = frozenActiveMs(preparation, now);
  if (spent >= preparation.limits.activeMs) {
    return refuse('ACTIVE_LIMIT', 'O orçamento ativo desta execução foi esgotado.');
  }
  const validDeps = cases.dependsOn.length === 2 &&
    [curation, plan].every(output => cases.dependsOn.some(ref => ref.outputId === output.id && ref.revision === output.revision)) &&
    answersCurrent(run, cases);
  if (!validDeps) return refuse('STALE_VERSION', 'As dependências dos casos de teste foram alteradas.');
  const caseVerdicts = run.validations.filter(validation =>
    validation.outputId === cases.id && validation.outputRevision === cases.revision &&
    validation.validator === 'output-validator' && validation.status !== 'error');
  if (caseVerdicts.length !== 1 || caseVerdicts[0]?.status !== 'approved') {
    return refuse('INSUFFICIENT_VALIDATION', 'Os casos de teste precisam de parecer aprovado do validador independente.');
  }
  const caseApproved = run.approvals.some(decision =>
    decision.outputId === cases.id && decision.outputRevision === cases.revision && decision.decision === 'approved');
  if (!caseApproved) return refuse('DECISION_MISSING', 'Não há aprovação humana para a revisão vigente dos casos de teste.');
  if (options.checkState !== false) {
    const retry = run.status === 'awaiting_input' && run.phase === 'mapping' &&
      run.preparation.stopReason?.code === 'CREDENTIAL_REJECTED';
    const first = run.status === 'awaiting_approval' && run.phase === 'case_design';
    if (!first && !retry) {
      return refuse('INVALID_STATE', 'O mapeamento só inicia após a aprovação dos casos, ou em nova tentativa explícita após falha de credencial.');
    }
  }
  if (accessRevision(run) !== request.expectedAccessRevision) {
    return refuse('STALE_VERSION', 'A revisão da configuração de acesso mudou. Consulte a configuração atualizada antes de mapear.');
  }
  const access = validAccess(record, config);
  if ('error' in access) return { ok: false, error: access.error };
  const caseIds = (cases.payload as TestCasesPayload).testCases.map(testCase => testCase.id);
  return { ok: true, start: {
    curation, plan, cases,
    artifacts: [...run.artifacts, ...(run.answerArtifacts ?? [])] as Artifact[],
    caseIds,
  } };
}

/** Elegibilidade exibida na projeção; o POST reconfere tudo com a revisão enviada. */
export function canMap(record: StoredRun, config: Pick<ReturnType<typeof readConfig>, 'targetAllowedOrigins'>, now = Date.now()): boolean {
  const run = record.run;
  const revision = accessRevision(run);
  const cases = latestOutput(run, 'case_design');
  if (!cases || revision < 1) return false;
  const retry = run.status === 'awaiting_input' && run.phase === 'mapping' &&
    run.preparation?.stopReason?.code === 'CREDENTIAL_REJECTED';
  if (run.status !== 'awaiting_approval' || run.phase !== 'case_design') {
    if (!retry) return false;
  }
  return mappingEligibility(record, { outputId: cases.id, outputRevision: cases.revision, expectedAccessRevision: revision }, config, now).ok;
}

export type MappingServices = {
  read(): Promise<StoredRun>;
  update<T>(change: (record: StoredRun) => T): Promise<T>;
  finish(status: string, reason: { code: string; message: string } | null): Promise<void>;
  failure(error: unknown): { code: string; message: string };
  now(): number;
  time(): string;
  signal: AbortSignal;
  config: ReturnType<typeof readConfig>;
  models: ResolvedVisualModels;
  mediaDir: string;
  visualCall?: (task: VisualTask) => Promise<VisualResult>;
};

/** Rotina de mapeamento e validação: executor visual produz o mapa com ferramentas
 * reais; o validador examina o mapa e as imagens referenciadas em sessão independente.
 * Limites: três produções/revisões, duas tentativas técnicas de validação por revisão,
 * cem ações de exploração e 45 minutos ativos acumulados, sem reinício a cada correção. */
export async function produceMapping(services: MappingServices, request: MappingRequest): Promise<void> {
  const initial = await services.read();
  // O estado inicial já foi conferido e persistido pelo coordenador; aqui vale o trabalho em andamento.
  const eligibility = mappingEligibility(initial, request, services.config, services.now(), { checkState: false });
  if (!eligibility.ok) throw new MappingError(eligibility.error.code, eligibility.error.message, eligibility.error.status);
  const { curation, plan, cases, artifacts, caseIds } = eligibility.start;
  const limits = initial.run.preparation!.limits;
  // Resolução privada: a credencial fica no envelope StoredRun, nunca na projeção.
  const credential = resolveTargetCredential(initial);
  if (!credential) throw new MappingError('ACCESS_NOT_CONFIGURED', 'Credencial de teste indisponível para o mapeamento.');
  const credentials = credential;
  const startUrl = initial.run.input!.startUrl as string;
  // Evidências anteriores à correção do acesso não comprovam a nova autenticação:
  // apenas observações e ações criadas no trabalho vigente sustentam o mapa.
  // O marcador mappingPreparationId é gravado junto da evidência (imune a relógios
  // divergentes); registros legados sem o marcador usam o início do trabalho.
  const activePreparationId = initial.run.preparation!.id;
  const activeStartedAt = Date.parse(initial.run.preparation!.startedAt);
  const belongsToCurrentWork = (item: { mappingPreparationId?: string; at: string }) =>
    item.mappingPreparationId !== undefined ? item.mappingPreparationId === activePreparationId
      : Date.parse(item.at) >= activeStartedAt;
  const currentObservations = (run: RunRecord) =>
    (run.observations ?? []).filter(observation => belongsToCurrentWork(observation));
  const currentActions = (run: RunRecord) =>
    (run.mappingActions ?? []).filter(action => belongsToCurrentWork(action));
  let previous = latestOutput(initial.run, 'mapping');
  const outputId = previous?.id ?? randomUUID();
  let feedback: unknown = null;

  for (let attempt = 1; attempt <= (limits.maxRevisions ?? 3); attempt++) {
    const revision = (previous?.revision ?? 0) + 1;
    const current = await services.read();
    const remainingActions = async () => {
      const fresh = await services.read();
      const preparation = fresh.run.preparation;
      return (preparation?.limits.maxActions ?? 100) - (preparation?.consumedActions ?? 0);
    };
    let payload: NavigationPayload;
    try {
      const result = await runVisual(services, {
        role: 'test-executor', kind: 'map-application', model: services.models.executor,
        prompt: JSON.stringify({ task: 'map-application', artifacts, curation, plan, approvedCases: cases, access: {
          startUrl, accessProfile: current.run.input?.accessProfile ?? null,
          dataPreparation: current.run.input?.dataPreparation ?? null, hasCredential: true },
        previousOutput: previous, feedback, answers: preparationAnswers(current.run), validatedFeedback: latestOutput(current.run, 'feedback') }),
        perCallTimeoutMs: limits.timeoutMs,
        callMeta: { attempt, outputRevision: revision },
        browser: {
          startUrl, allowedOrigins: services.config.targetAllowedOrigins, credential: credentials,
          mediaDir: services.mediaDir, signal: services.signal, remainingActions,
          onObservation: observation => services.update(record => {
            record.run.observations = [...(record.run.observations ?? []), {
              id: observation.id, assetId: observation.assetId, at: observation.at,
              width: observation.width, height: observation.height,
              ...(record.run.preparation?.id !== undefined
                ? { mappingPreparationId: record.run.preparation.id } : {}),
            }];
            return undefined;
          }),
          onAction: action => services.update(record => {
            const preparation = record.run.preparation;
            if (!preparation) return undefined;
            const saved = { ...action, mappingPreparationId: preparation.id };
            const consumed = preparation.consumedActions ?? 0;
            if (consumed >= (preparation.limits.maxActions ?? 100)) {
              saved.outcome = 'error';
              saved.note = 'ACTION_LIMIT: o limite de cem ações de exploração foi esgotado.';
            } else {
              preparation.consumedActions = consumed + 1;
            }
            record.run.mappingActions = [...(record.run.mappingActions ?? []), saved];
            return undefined;
          }),
        },
      });
      // As observações/ações criadas durante a sessão também sustentam o mapa.
      const freshRecord = await services.read();
      const observations = currentObservations(freshRecord.run);
      const actions = currentActions(freshRecord.run);
      payload = parseNavigation(result.payload, {
        observations: observations.map(observation => observation.id),
        actions: actions.map(action => action.id),
        caseIds,
      });
      // Uma ação com erro não sustenta uma transição bem-sucedida.
      const failedActions = new Set(actions.filter(action => action.outcome !== 'ok').map(action => action.id));
      if (payload.map.transitions.some(transition => failedActions.has(transition.actionId))) {
        throw new InvalidNavigationOutput('ACTION_NOT_SUPPORTED');
      }
    } catch (error) {
      if (services.signal.aborted) throw services.signal.reason;
      if (error instanceof MappingError || error instanceof StorageError) throw error;
      // Saída de modelo inválida gera nova revisão dentro do limite; falhas técnicas
      // ou de navegador conservam a causa identificável em vez de virarem
      // esgotamento de revisões.
      if (error instanceof InvalidNavigationOutput ||
        (error instanceof SpecialistError && error.code === 'INVALID_OUTPUT')) {
        const failure = services.failure(error);
        feedback = failure;
        // A inferência terminou, mas a saída não atendeu ao contrato: as chamadas
        // da tentativa ficam registradas como inválidas, preservando o motivo.
        await services.update(record => {
          for (const saved of record.run.preparation?.calls ?? []) {
            if (saved.role === 'test-executor' && saved.attempt === attempt &&
                ['running', 'completed'].includes(saved.status)) {
              saved.status = 'invalid';
              saved.errorCode = failure.code;
              if (saved.finishedAt === undefined) {
                saved.finishedAt = services.time();
                saved.durationMs = Math.max(0, services.now() - Date.parse(saved.startedAt));
              }
            }
          }
          return undefined;
        });
        continue;
      }
      throw error;
    }
    // Dependência exata reconferida antes de publicar a revisão do mapa.
    const output = await services.update(record => {
      // Durante o trabalho o estado é running; apenas as dependências são reconferidas.
      const currentEligibility = mappingEligibility(record, request, services.config, services.now(), { checkState: false });
      if (!currentEligibility.ok) throw new MappingError(currentEligibility.error.code, currentEligibility.error.message, currentEligibility.error.status);
      const run = record.run;
      const saved: RunOutput = { id: outputId, phase: 'mapping', revision, producer: 'test-executor',
        createdAt: services.time(), budgetCycleId: run.preparation!.budgetCycleId,
        dependsOn: [curation, plan, cases].map(output => ({ outputId: output.id, revision: output.revision })),
        answerRefs: effectiveAnswers(run).map(answer => ({ answerId: answer.id, questionId: answer.questionId, revision: answer.revision })),
        payload: { phase: 'mapping', producer: 'test-executor', accessRevision: accessRevision(run), ...payload },
      };
      run.outputs.push(saved);
      run.phase = 'mapping';
      run.preparation!.activeRole = 'output-validator';
      run.preparation!.activity = 'validating_mapping';
      return saved;
    });
    previous = output;
    let verdict: Verdict | undefined;
    for (let validatorAttempt = 1; validatorAttempt <= (limits.maxValidatorAttempts ?? 2); validatorAttempt++) {
      try {
        const fresh = await services.read();
        const references = new Set<string>([
          ...payload.map.screens.flatMap(screen => screen.observationIds),
          ...payload.map.transitions.flatMap(transition => transition.observationIds),
          ...(payload.authentication.status === 'authenticated' ? [payload.authentication.observationId] : []),
        ]);
        if (references.size > MAP_LIMITS.validatorImages) throw new InvalidNavigationOutput('IMAGE_LIMIT');
        // Manifesto ordenado: a ordem corresponde exatamente às imagens anexadas.
        const ordered = [...references];
        const observations = currentObservations(fresh.run);
        const images = await Promise.all(ordered.map(async observationId => {
          const observation = observations.find(item => item.id === observationId);
          if (!observation) throw new StorageError('STORAGE_FAILURE');
          return { data: (await readFile(join(services.mediaDir, observation.assetId + '.png'))).toString('base64'), mimeType: 'image/png' as const };
        }));
        const manifest = ordered.map((observationId, imageIndex) => {
          const observation = observations.find(item => item.id === observationId)!;
          return { imageIndex, observationId, assetId: observation.assetId, at: observation.at,
            width: observation.width, height: observation.height };
        });
        // Registro das ações relevantes para conferir cada transição declarada.
        const referencedActionIds = new Set(payload.map.transitions.map(transition => transition.actionId));
        const actions = currentActions(fresh.run).filter(action => referencedActionIds.has(action.id));
        const result = await runVisual(services, {
          role: 'output-validator', kind: 'validate-navigation', model: services.models['validator-visual'],
          prompt: JSON.stringify({ task: 'validation', artifacts, curation, plan, approvedCases: cases,
            output, manifest: { observations: manifest }, actions,
            previousOutput: fresh.run.outputs.filter(item => item.id === outputId && item.revision < output.revision).at(-1) ?? null,
            previousVerdicts: fresh.run.validations.filter(validation => validation.outputId === outputId) }),
          images, perCallTimeoutMs: limits.timeoutMs,
          callMeta: { attempt, outputRevision: revision },
        });
        const parsed = parseVerdict(result.payload);
        verdict = parsed;
        // Resposta contraditória é validação inválida, dentro das tentativas existentes:
        // autenticação não concluída não pode receber parecer aprovado.
        const contradictory = parsed.status === 'approved' && payload.authentication.status === 'not_authenticated';
        await services.update(record => {
          record.run.validations.push(contradictory
            ? { id: randomUUID(), outputId, outputRevision: revision, validator: 'output-validator',
              at: services.time(), attempt: validatorAttempt, status: 'error' as const,
              reason: 'O parecer aprovado contradiz a autenticação não concluída declarada no mapa.',
              findings: [{ code: 'CONTRADICTORY_APPROVAL', message: 'O parecer aprovado contradiz a autenticação não concluída declarada no mapa.', location: null }] }
            : { id: randomUUID(), outputId, outputRevision: revision,
              validator: 'output-validator', at: services.time(), attempt: validatorAttempt, ...parsed });
          return undefined;
        });
        if (contradictory) {
          if (validatorAttempt === (limits.maxValidatorAttempts ?? 2)) {
            throw new MappingError('VALIDATOR_LIMIT', 'O limite de tentativas técnicas do validador visual foi esgotado sem parecer válido.');
          }
          continue;
        }
      } catch (error) {
        if (error instanceof MappingError || error instanceof StorageError || services.signal.aborted) throw error;
        const reason = services.failure(error);
        await services.update(record => {
          record.run.validations.push({ id: randomUUID(), outputId, outputRevision: revision,
            validator: 'output-validator', at: services.time(), attempt: validatorAttempt, status: 'error',
            reason: reason.message, findings: [{ code: reason.code, message: reason.message, location: null }] });
          return undefined;
        });
        if (validatorAttempt === (limits.maxValidatorAttempts ?? 2)) {
          throw new MappingError('VALIDATOR_LIMIT', 'O limite de tentativas técnicas do validador visual foi esgotado sem parecer válido.');
        }
        continue;
      }
      if (verdict.status === 'approved') { await services.finish('ready', null); return; }
      if (verdict.status === 'blocked') {
        const credentialFailure = verdict.findings.some(finding => finding.code === 'AUTHENTICATION_MISSING');
        await services.finish('awaiting_input', {
          code: credentialFailure ? 'CREDENTIAL_REJECTED' : 'MAPPING_BLOCKED', message: verdict.reason });
        return;
      }
      feedback = verdict;
      break;
    }
  }
  throw new MappingError('REVISION_LIMIT', 'O limite de três produções/revisões do mapa foi esgotado.');
}

/** Confere os perfis visuais; falha legível antes de reservar o ambiente. */
export async function preflightVisual(config: ReturnType<typeof readConfig>) {
  let models: ResolvedVisualModels;
  try { models = resolveVisualModels(config); }
  catch { throw new MappingError('MODEL_NOT_CONFIGURED', 'Configure PI_EXECUTOR_PROVIDER/MODEL e PI_VALIDATOR_VISUAL_PROVIDER/MODEL para o mapeamento visual.', 503); }
  try {
    await preflightVisualModels(models, config.piAuthPath);
  } catch (error) {
    if (error instanceof Error && error.name === 'SpecialistError') {
      const specialist = error as { code?: string; message?: string };
      throw new MappingError(specialist.code ?? 'MODEL_UNAVAILABLE', specialist.message ?? 'Modelos visuais indisponíveis.', 503);
    }
    throw new MappingError('MODEL_UNAVAILABLE', 'Não foi possível conferir os modelos e credenciais visuais configurados.', 503);
  }
  return models;
}
