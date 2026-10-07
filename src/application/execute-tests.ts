import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { EXECUTION_LIMITS, eligibleExecutionCases, latestExecutionOutput, parseExecutionCandidate,
  InvalidExecutionOutput, type ExecutionAttempt, type ExecutionCandidate, type ExecutionPayload } from '../domain/test-execution.js';
import type { RouteDetailPayload, DetailedTestCase } from '../domain/route-detail.js';
import { parseVerdict, type Verdict } from '../domain/preparation.js';
import { StorageError, type RunOutput, type RunRecord, type StoredRun } from '../storage/runs.js';
import type { readConfig } from '../config.js';
import { SpecialistError } from '../runtime/pi.js';
import type { VisualImage } from '../runtime/pi-visual.js';
import { currentRouteDetail, routeDependencies } from './route-detail.js';
import { latestOutput, PreparationError, preparationAnswers } from './prepare-plan.js';
import { resolveTargetCredential } from './target-access.js';
import { type MappingServices } from './map-application.js';
import { runVisual } from './visual-call.js';

type Config = Pick<ReturnType<typeof readConfig>, 'targetAllowedOrigins'>;
export type ExecutionRequest = { outputId: string; outputRevision: number; expectedAccessRevision?: number };
const approved = (run: RunRecord, output: RunOutput) => {
  const verdicts = run.validations.filter(item => item.outputId === output.id && item.outputRevision === output.revision &&
    item.validator === 'output-validator' && item.status !== 'error');
  return verdicts.length === 1 && verdicts[0]!.status === 'approved';
};

export function executionEligibility(record: StoredRun, request: ExecutionRequest, config: Config, now = Date.now(),
  options: { checkState?: boolean } = {}) {
  const run = record.run, routeDetail = latestOutput(run, 'route_detail');
  if (!routeDetail || routeDetail.id !== request.outputId || routeDetail.revision !== request.outputRevision ||
    !currentRouteDetail(run, routeDetail, config)) throw new PreparationError('STALE_VERSION', 'O detalhamento ou suas dependências não são mais vigentes.');
  if (!approved(run, routeDetail)) throw new PreparationError('INSUFFICIENT_VALIDATION', 'A revisão vigente dos percursos precisa de validação independente.');
  if (request.expectedAccessRevision !== run.input.accessRevision || !Number.isSafeInteger(request.expectedAccessRevision)) {
    throw new PreparationError('STALE_VERSION', 'Confirme a revisão vigente do acesso antes de executar os casos.');
  }
  if (!resolveTargetCredential(record)) throw new PreparationError('ACCESS_NOT_CONFIGURED', 'A credencial de teste precisa ser configurada novamente.');
  const preparation = run.preparation;
  if (!preparation || (options.checkState !== false && (run.status !== 'ready' || run.phase !== 'route_detail' || preparation.finishedAt === null))) {
    throw new PreparationError('INVALID_STATE', 'A execução começa após o detalhamento validado, com o ambiente disponível.');
  }
  const activeMs = (preparation.accumulatedActiveMs ?? (preparation.finishedAt === null ? 0 :
    Math.max(0, Date.parse(preparation.finishedAt) - Date.parse(preparation.startedAt)))) +
    (preparation.finishedAt === null ? Math.max(0, now - Date.parse(preparation.startedAt)) : 0);
  if (activeMs >= preparation.limits.activeMs) throw new PreparationError('ACTIVE_LIMIT', 'O orçamento ativo desta execução foi esgotado.');
  const mapping = latestOutput(run, 'mapping')!;
  const dependencies = routeDependencies(run, { outputId: mapping.id, outputRevision: mapping.revision }, config);
  const detail = routeDetail.payload as RouteDetailPayload;
  const eligible = eligibleExecutionCases(run, detail.testCases, routeDetail);
  if (options.checkState !== false && !eligible.length) throw new PreparationError('NO_ELIGIBLE_CASES', 'Não há casos independentes elegíveis para iniciar.');
  return { ...dependencies, routeDetail, detail, eligible };
}
export function canExecuteTests(record: StoredRun, config: Config, now = Date.now()): boolean {
  const routeDetail = latestOutput(record.run, 'route_detail');
  if (!routeDetail || typeof record.run.input.accessRevision !== 'number') return false;
  try {
    executionEligibility(record, { outputId: routeDetail.id, outputRevision: routeDetail.revision,
      expectedAccessRevision: record.run.input.accessRevision }, config, now); return true;
  } catch { return false; }
}

async function evidence(services: MappingServices, attempt: ExecutionAttempt, ids: string[]) {
  if (ids.length > EXECUTION_LIMITS.validatorImages) throw new InvalidExecutionOutput('A conclusão excede 24 capturas; preserve todas e selecione as que sustentam este caso.');
  const run = (await services.read()).run;
  const images: VisualImage[] = [];
  const observations = [];
  const missing: string[] = [];
  for (const id of ids) {
    const observation = (run.observations ?? []).find(item => item.id === id && item.attemptId === attempt.id && item.caseId === attempt.caseId);
    if (!observation) throw new InvalidExecutionOutput();
    try {
      const data = await readFile(join(services.mediaDir, observation.assetId + '.png'));
      images.push({ data: data.toString('base64'), mimeType: 'image/png' });
      observations.push({ imageIndex: images.length - 1, ...observation });
    } catch { missing.push(id); }
  }
  return { images, observations, missing };
}

/** Usa o coordenador e o registro de chamadas existentes. Cada tentativa física
 * possui apenas uma sessão de navegador; corrigir JSON ou parecer usa só registros. */
export async function produceExecution(services: MappingServices, request: ExecutionRequest): Promise<void> {
  services.signal.throwIfAborted();
  const initial = await services.read();
  const context = executionEligibility(initial, request, services.config, services.now(), { checkState: false });
  const limits = initial.run.preparation!.limits;
  const credential = resolveTargetCredential(initial)!;
  const routeRef = { outputId: context.routeDetail.id, revision: context.routeDetail.revision };
  const refresh = async (attemptId: string) => (await services.read()).run.executionAttempts!.find(item => item.id === attemptId)!;
  let pending = context.detail.pending.length > 0;
  let unvalidated = false;

  for (const testCase of context.eligible) {
    services.signal.throwIfAborted();
    const history = (await services.read()).run.executionAttempts?.filter(item => item.caseId === testCase.id) ?? [];
    let previousAttempt = history.at(-1);
    for (let physical = history.length; physical < EXECUTION_LIMITS.attemptsPerCase; physical++) {
      services.signal.throwIfAborted();
      const attempt: ExecutionAttempt = { id: randomUUID(), caseId: testCase.id,
        approvedCaseRevision: { ...testCase.approvedCaseRevision }, routeDetailRef: routeRef,
        startedAt: services.time(), finishedAt: null, status: 'running', setupObservation: '', events: [],
        observed: '', verdict: null, reason: '', evidenceIds: [], evidenceGaps: [],
        ...(previousAttempt ? { reproducesAttemptId: previousAttempt.id } : {}) };
      await services.update(record => {
        executionEligibility(record, request, services.config, services.now(), { checkState: false });
        record.run.executionAttempts = [...(record.run.executionAttempts ?? []), attempt];
        record.run.phase = 'execution';
        record.run.preparation!.activeRole = 'test-executor';
        record.run.preparation!.activity = 'executing_test_case';
      });
      const run = (await services.read()).run;
      let previousOutput = latestExecutionOutput(run, testCase.id);
      const outputId = previousOutput?.id ?? randomUUID();
      let feedback: unknown = null;
      let accepted: ExecutionCandidate | undefined;
      try {
        for (let correction = 1; correction <= limits.maxRevisions; correction++) {
          services.signal.throwIfAborted();
          const revision = (previousOutput?.revision ?? 0) + 1;
          let current = await refresh(attempt.id);
          let candidate: ExecutionCandidate;
          try {
            const savedEvidence = correction === 1 ? undefined : await evidence(services, current,
              current.evidenceIds.length <= EXECUTION_LIMITS.validatorImages ? current.evidenceIds : []);
            const result = await runVisual(services, {
              role: 'test-executor', kind: 'execute-test-case', model: services.models.executor,
              prompt: JSON.stringify({ task: 'execute-test-case', mode: correction === 1 ? 'execute' : 'correct_conclusion_only',
                approvedCase: testCase, approvedPlan: context.plan, approvedMapping: context.mapping,
                routeDetailRef: routeRef, access: { startUrl: initial.run.input.startUrl,
                  accessProfile: initial.run.input.accessProfile, dataPreparation: initial.run.input.dataPreparation },
                attempt: current, previousAttempts: history, previousOutput: previousOutput ?? null, feedback,
                answers: preparationAnswers((await services.read()).run),
                ...(savedEvidence ? { manifest: { observations: savedEvidence.observations }, missingImages: savedEvidence.missing } : {}),
              }),
              ...(savedEvidence ? { images: savedEvidence.images } : {}),
              perCallTimeoutMs: limits.timeoutMs, callMeta: { attempt: correction, outputRevision: revision },
              ...(correction === 1 ? { browser: {
                startUrl: initial.run.input.startUrl as string, allowedOrigins: services.config.targetAllowedOrigins,
                credential, mediaDir: services.mediaDir, signal: services.signal,
                remainingActions: async () => {
                  services.signal.throwIfAborted();
                  return EXECUTION_LIMITS.actions - (await refresh(attempt.id)).events.length;
                },
                onObservation: observation => services.update(record => {
                  services.signal.throwIfAborted();
                  const active = record.run.executionAttempts!.find(item => item.id === attempt.id)!;
                  if (active.status !== 'running') throw new PreparationError('INVALID_STATE', 'A tentativa foi encerrada.');
                  record.run.observations = [...(record.run.observations ?? []), { ...observation, caseId: testCase.id, attemptId: attempt.id }];
                  active.evidenceIds.push(observation.id);
                }),
                onAction: action => services.update(record => {
                  services.signal.throwIfAborted();
                  const active = record.run.executionAttempts!.find(item => item.id === attempt.id)!;
                  if (active.status !== 'running' || active.events.length >= EXECUTION_LIMITS.actions) {
                    throw new PreparationError('ACTION_LIMIT', 'O limite de cinquenta ações desta tentativa foi esgotado.');
                  }
                  active.events.push(action);
                }),
              } } : {}),
            });
            current = await refresh(attempt.id);
            candidate = parseExecutionCandidate(result.payload, current);
          } catch (error) {
            if (services.signal.aborted) throw services.signal.reason;
            if (error instanceof StorageError) throw error;
            feedback = services.failure(error);
            if (error instanceof InvalidExecutionOutput || (error instanceof SpecialistError && error.code === 'INVALID_OUTPUT')) {
              // A ação física nunca é repetida para corrigir uma resposta malformada.
              continue;
            }
            current = await refresh(attempt.id);
            candidate = { setupObservation: current.setupObservation || 'O preparo não foi confirmado integralmente.',
              observed: 'A tentativa foi interrompida por falha técnica; não há conclusão comprovada sobre a aplicação.',
              verdict: 'inconclusive', reason: services.failure(error).message,
              evidenceIds: current.evidenceIds.length <= EXECUTION_LIMITS.validatorImages ? [...current.evidenceIds] : [],
              evidenceGaps: ['Falha técnica durante a coleta ou conclusão; registros confirmados foram preservados.'],
              question: null, reproduce: false };
          }
          const media = await evidence(services, current, candidate.evidenceIds);
          if (media.missing.length) {
            candidate = { ...candidate, verdict: 'inconclusive', reproduce: false,
              evidenceIds: candidate.evidenceIds.filter(id => !media.missing.includes(id)),
              reason: 'Uma ou mais capturas vinculadas à tentativa ficaram indisponíveis.',
              evidenceGaps: [...candidate.evidenceGaps, `Capturas indisponíveis: ${media.missing.join(', ')}.`] };
          }
          const payload: ExecutionPayload = { caseId: testCase.id, attemptId: attempt.id, ...candidate };
          const output = await services.update(record => {
            services.signal.throwIfAborted();
            executionEligibility(record, request, services.config, services.now(), { checkState: false });
            const saved: RunOutput = { id: outputId, phase: 'execution', revision, producer: 'test-executor',
              createdAt: services.time(), budgetCycleId: record.run.preparation!.budgetCycleId,
              dependsOn: [context.cases, context.routeDetail].map(item => ({ outputId: item.id, revision: item.revision })),
              answerRefs: preparationAnswers(record.run).map(answer => ({ answerId: answer.id, questionId: answer.questionId, revision: answer.revision })),
              payload };
            record.run.outputs.push(saved);
            const active = record.run.executionAttempts!.find(item => item.id === attempt.id)!;
            const { evidenceIds: _selected, question: _question, reproduce: _reproduce, ...conclusion } = candidate;
            Object.assign(active, conclusion);
            record.run.preparation!.activeRole = 'output-validator';
            record.run.preparation!.activity = 'validating_test_result';
            return saved;
          });
          previousOutput = output;
          const verdict = await validateResult(services, output, testCase, context.routeDetail, await refresh(attempt.id), media);
          if (verdict?.status === 'approved') { accepted = candidate; break; }
          feedback = verdict ?? { code: 'VALIDATOR_LIMIT', message: 'O validador não concluiu após as tentativas técnicas permitidas.' };
          // Falha técnica do validador não autoriza chamadas extras de autoria.
          if (!verdict) break;
        }
      } catch (error) {
        if (services.signal.aborted) throw services.signal.reason;
        if (!services.signal.aborted) {
          await services.update(record => {
            const active = record.run.executionAttempts!.find(item => item.id === attempt.id)!;
            active.status = 'interrupted'; active.finishedAt = services.time();
            active.evidenceGaps.push('Interrupção técnica; ações registradas não serão repetidas automaticamente.');
          });
        }
        throw error;
      }
      previousAttempt = await services.update(record => {
        const active = record.run.executionAttempts!.find(item => item.id === attempt.id)!;
        active.status = 'completed'; active.finishedAt = services.time();
        if (!accepted) {
          active.verdict = 'inconclusive';
          active.reason = 'Não foi possível obter uma conclusão validada dentro do limite de revisões.';
          active.evidenceGaps.push('Conclusão sem parecer independente aprovado.');
        }
        return structuredClone(active);
      });
      pending ||= accepted?.verdict === 'blocked';
      unvalidated ||= !accepted;
      if (!accepted?.reproduce || physical + 1 >= EXECUTION_LIMITS.attemptsPerCase) break;
    }
  }
  await services.finish(unvalidated ? 'error' : pending ? 'awaiting_input' : 'ready', unvalidated
    ? { code: 'VALIDATION_LIMIT', message: 'Há tentativa sem conclusão validada após o limite de revisões. Os registros permitem solicitar um relatório parcial.' }
    : pending ? { code: 'EXECUTION_PENDING', message: 'Casos independentes foram processados. Há impedimentos pendentes de esclarecimento.' } : null);
}

async function validateResult(services: MappingServices, output: RunOutput, testCase: DetailedTestCase,
  routeDetail: RunOutput, attempt: ExecutionAttempt, media: Awaited<ReturnType<typeof evidence>>): Promise<Verdict | undefined> {
  const limits = (await services.read()).run.preparation!.limits;
  for (let validationAttempt = 1; validationAttempt <= limits.maxValidatorAttempts; validationAttempt++) {
    services.signal.throwIfAborted();
    try {
      const result = await runVisual(services, {
        role: 'output-validator', kind: 'validate-test-result', model: services.models['validator-visual'],
        prompt: JSON.stringify({ task: 'validate-test-result', approvedCase: testCase, routeDetail, attempt, output,
          events: attempt.events, manifest: { observations: media.observations }, missingImages: media.missing }),
        images: media.images, perCallTimeoutMs: limits.timeoutMs,
        callMeta: { attempt: validationAttempt, outputRevision: output.revision },
      });
      const verdict = parseVerdict(result.payload);
      await services.update(record => {
        record.run.validations.push({ id: randomUUID(), outputId: output.id, outputRevision: output.revision,
          validator: 'output-validator', at: services.time(), attempt: validationAttempt, ...verdict });
      });
      return verdict;
    } catch (error) {
      if (services.signal.aborted) throw services.signal.reason;
      if (error instanceof StorageError) throw error;
      const failure = services.failure(error);
      await services.update(record => {
        record.run.validations.push({ id: randomUUID(), outputId: output.id, outputRevision: output.revision,
          validator: 'output-validator', at: services.time(), attempt: validationAttempt, status: 'error',
          reason: failure.message, findings: [{ ...failure, location: null }] });
      });
    }
  }
  return undefined;
}
