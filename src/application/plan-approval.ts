import { randomUUID } from 'node:crypto';
import {
  canCreateCases, canResumePreparation, caseDependencies, preparationAnswers,
  PreparationError,
} from './prepare-plan.js';
import type { TestCase } from '../domain/preparation.js';
import {
  applyPlanApprovalCommand, type PlanApprovalCommand, type PlanApprovalErrorCode,
  type PlanApprovalState, type PlanDecision,
} from '../domain/plan-approval.js';
import {
  applyCaseApprovalCommand, type CaseApprovalCommand, type CaseApprovalErrorCode,
  type CaseApprovalState,
} from '../domain/case-approval.js';
import { RunStore, StorageError, type StorageErrorCode, type RunOutput, type WorkIntent, type PreparationAnswer, type RunRecord } from '../storage/runs.js';
import { publicTargetAccess, type TargetAccessReview } from './target-access.js';
import { publicNavigation } from '../domain/navigation.js';
import { canMap } from './map-application.js';
import type { readConfig } from '../config.js';

export type PlanCommandRequest = Readonly<{
  type: 'approve_plan' | 'request_plan_changes' | 'continue' | 'approve_cases' | 'request_case_changes';
  outputId: string; outputRevision: number; comment?: string;
}>;
export type PlanCommandContext = Readonly<{ userId: string; resourceReserved?: boolean }>;
export type PlanCommandResult =
  | { ok: true; status: string; phase: string; approvals: readonly PlanDecision[]; work: WorkIntent | null }
  | { ok: false; work: null; error: {
    code: PlanApprovalErrorCode | StorageErrorCode | 'UNAUTHORIZED'; message: string;
  } };

export type CaseCommandRequest = Readonly<{
  type: 'approve_cases' | 'request_case_changes';
  outputId: string; outputRevision: number; comment?: string;
}>;
export type CaseCommandResult =
  | { ok: true; status: string; phase: string; approvals: readonly PlanDecision[]; work: null }
  | { ok: false; work: null; error: {
    code: CaseApprovalErrorCode | StorageErrorCode | 'UNAUTHORIZED'; message: string;
  } };

export type PlanReview = {
  id: string; name: string; applicationName: string; createdAt: string;
  status: string; phase: string;
  progress: { processingId: string | null; activeRole: string | null; activity: string | null;
    startedAt: string | null; finishedAt: string | null };
  stopReason: { code: string; message: string } | null;
  canResume: boolean;
  canCreateCases: boolean;
  canDecideCases: boolean;
  cases: { id: string; revision: number; current: boolean;
    dependsOn: RunOutput['dependsOn']; answerRefs: NonNullable<RunOutput['answerRefs']>;
    payload: { testCases: TestCase[] };
    validations: (PlanApprovalState['validations'][number] & { reason: string;
      findings: { code: string; message: string; location: string | null }[] })[] } | null;
  answers: PreparationAnswer[];
  curation: { id: string; revision: number; payload: ReturnType<typeof publicCuration>;
    validations: PlanApprovalState['validations'] } | null;
  questions: { id: string; description: string; requirementIds: string[]; ruleIds: string[]; blocking: boolean;
    outputId: string | null; outputRevision: number | null; answerId: string | null;
    sources: { artifactId: string; locator: string; quote: string }[] }[];
  plan: {
    id: string; revision: number;
    payload: { testPlan: ReturnType<typeof publicTestPlan> };
    validations: PlanApprovalState['validations'];
  } | null;
  approvals: PlanDecision[];
  targetAccess: TargetAccessReview;
  canMap: boolean;
  mapping: {
    id: string; revision: number; current: boolean;
    dependsOn: RunOutput['dependsOn'];
    payload: ReturnType<typeof publicNavigation>;
    validations: (PlanApprovalState['validations'][number] & { reason: string;
      findings: { code: string; message: string; location: string | null }[] })[];
  } | null;
  observations: { id: string; assetId: string; at: string; width: number; height: number }[];
  mappingActions: { id: string; at: string; tool: string; params: Record<string, unknown>;
    outcome: string; observationId: string | null; note: string | null }[];
};
export type PlanReviewResult =
  | { ok: true; review: PlanReview }
  | { ok: false; error: { code: StorageErrorCode | 'UNAUTHORIZED'; message: string } };

const authorized = (ownerId: string, context: PlanCommandContext) =>
  context && typeof context.userId === 'string' && !!context.userId.trim() && context.userId === ownerId;

export function publicPlanDecisions(approvals: readonly PlanDecision[]): PlanDecision[] {
  return approvals.map(decision => ({
    id: decision.id, outputId: decision.outputId, outputRevision: decision.outputRevision,
    actorId: decision.actorId, at: decision.at, decision: decision.decision, comment: decision.comment,
  }));
}

// O armazenamento preserva payloads extensíveis; a API publica somente o contrato.
const object = (item: unknown): Record<string, unknown> => {
  if (!item || typeof item !== 'object' || Array.isArray(item)) throw new StorageError('INVALID_RECORD');
  return item as Record<string, unknown>;
};
const text = (item: unknown): string => {
  if (typeof item !== 'string') throw new StorageError('INVALID_RECORD');
  return item;
};
const list = (item: unknown): unknown[] => {
  if (!Array.isArray(item)) throw new StorageError('INVALID_RECORD');
  return item;
};
function publicTestPlan(value: unknown) {
  const plan = object(value);
  return {
    objective: text(plan.objective),
    requirementIds: list(plan.requirementIds).map(text),
    ruleIds: list(plan.ruleIds).map(text),
    priorities: list(plan.priorities).map(item => {
      const priority = object(item);
      return { ruleId: text(priority.ruleId), reason: text(priority.reason) };
    }),
    exclusions: list(plan.exclusions).map(item => {
      const exclusion = object(item);
      return { description: text(exclusion.description), reason: text(exclusion.reason) };
    }),
    approach: list(plan.approach).map(text),
    preconditions: list(plan.preconditions).map(text),
    sources: list(plan.sources).map(item => {
      const source = object(item);
      return { artifactId: text(source.artifactId), locator: text(source.locator), quote: text(source.quote) };
    }),
  };
}

const publicSources = (value: unknown) => Array.isArray(value) ? value.map(item => {
  const source = item && typeof item === 'object' ? item as Record<string, unknown> : {};
  return { artifactId: String(source.artifactId ?? ''), locator: String(source.locator ?? ''), quote: String(source.quote ?? '') };
}) : [];
const publicIds = (value: unknown): string[] => Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
function publicTestCases(payload: Record<string, unknown>): TestCase[] {
  const scalar = (value: unknown): string | number | boolean | null => {
    if (value === null || typeof value === 'string' || typeof value === 'boolean' ||
      typeof value === 'number' && Number.isFinite(value)) return value;
    throw new StorageError('INVALID_RECORD');
  };
  return list(payload.testCases).map(raw => {
    const item = object(raw);
    if (item.pathId !== null) throw new StorageError('INVALID_RECORD');
    return { id: text(item.id), requirementIds: list(item.requirementIds).map(text),
      ruleIds: list(item.ruleIds).map(text), preconditions: list(item.preconditions).map(text), setup: text(item.setup), pathId: null,
      data: Object.fromEntries(Object.entries(object(item.data)).map(([key, value]) => [key, scalar(value)])),
      techniques: list(item.techniques).map(rawTechnique => {
        const technique = object(rawTechnique);
        return { name: text(technique.name), description: text(technique.description), values: list(technique.values).map(scalar) };
      }), expected: text(item.expected), sources: list(item.sources).map(rawSource => {
        const source = object(rawSource);
        return { artifactId: text(source.artifactId), locator: text(source.locator), quote: text(source.quote) };
      }) };
  });
}
function publicQuestion(question: Record<string, unknown>) {
  return { id: String(question.id ?? ''), description: String(question.description ?? ''),
    requirementIds: publicIds(question.requirementIds), ruleIds: publicIds(question.ruleIds), caseIds: publicIds(question.caseIds),
    blocking: question.blocking === true, sources: publicSources(question.sources) };
}
function publicCuration(payload: Record<string, unknown>) {
  return {
    requirements: Array.isArray(payload.requirements) ? payload.requirements.map((requirement: Record<string, unknown>) => ({
      id: String(requirement.id ?? ''), statement: String(requirement.statement ?? ''), sources: publicSources(requirement.sources),
      rules: Array.isArray(requirement.rules) ? requirement.rules.map((rule: Record<string, unknown>) => ({
        id: String(rule.id ?? ''), statement: String(rule.statement ?? ''), sources: publicSources(rule.sources),
        ...(['rule', 'example'].includes(String(rule.kind)) ? { kind: rule.kind as 'rule' | 'example' } : {}),
        ...(Array.isArray(rule.examples) ? { examples: rule.examples.map((example: Record<string, unknown>) => ({
          id: String(example.id ?? ''), given: publicIds(example.given), when: publicIds(example.when),
          then: publicIds(example.then), sources: publicSources(example.sources),
        })) } : {}),
      })) : [],
    })) : [],
    questions: Array.isArray(payload.questions) ? payload.questions.map(publicQuestion) : [],
  };
}

function current(outputs: RunOutput[], phase: string): RunOutput | null {
  const versions = outputs.filter(output => output.phase === phase);
  if (new Set(versions.map(output => output.id)).size > 1 ||
    new Set(versions.map(output => output.revision)).size !== versions.length) {
    throw new StorageError('AMBIGUOUS_RECORD');
  }
  // Não deixa uma revisão inválida desaparecer atrás de outra válida/aprovada.
  return versions.find(output => !Number.isSafeInteger(output.revision) || output.revision < 1) ??
    versions.reduce<RunOutput | null>((latest, output) =>
      !latest || output.revision > latest.revision ? output : latest, null);
}

export async function getPlanReview(
  store: RunStore,
  runId: string,
  context: PlanCommandContext,
  config: Pick<ReturnType<typeof readConfig>, 'targetAllowedOrigins'> = { targetAllowedOrigins: [] },
): Promise<PlanReviewResult> {
  try {
    const record = await store.read(runId);
    const run = record.run;
    if (!authorized(run.ownerId, context)) {
      return { ok: false, error: { code: 'UNAUTHORIZED', message: 'Operação não autorizada para esta execução.' } };
    }
    const plan = current(run.outputs, 'planning');
    const curation = current(run.outputs, 'curation');
    const cases = current(run.outputs, 'case_design');
    const mapping = current(run.outputs, 'mapping');
    let currentCases = false;
    let currentMapping = false;
    if (mapping && cases && plan) {
      try {
        const dependencies = caseDependencies(run, { outputId: plan.id, outputRevision: plan.revision }, false);
        currentMapping = mapping.dependsOn.length === 3 &&
          [dependencies.curation, dependencies.plan, cases].every(output =>
            mapping.dependsOn.some(ref => ref.outputId === output.id && ref.revision === output.revision));
      } catch { /* O histórico continua consultável, sem autorizar avanço. */ }
    }
    if (cases && plan) {
      try {
        const dependencies = caseDependencies(run, { outputId: plan.id, outputRevision: plan.revision }, false);
        currentCases = cases.dependsOn.length === 2 && [dependencies.curation, dependencies.plan].every(output =>
          cases.dependsOn.some(ref => ref.outputId === output.id && ref.revision === output.revision)) &&
          JSON.stringify(cases.answerRefs ?? []) === JSON.stringify(plan.answerRefs ?? []);
      } catch { /* O histórico continua consultável, sem autorizar avanço. */ }
    }
    const answers = preparationAnswers(run).map(answer => ({ id: answer.id, revision: answer.revision,
      outputId: answer.outputId, outputRevision: answer.outputRevision, questionId: answer.questionId,
      text: answer.text, artifactId: answer.artifactId, actorId: answer.actorId, at: answer.at }));
    const validations = (output: RunOutput) => run.validations.filter(validation =>
      validation.outputId === output.id && validation.outputRevision === output.revision).map(validation => ({
        outputId: validation.outputId, outputRevision: validation.outputRevision, validator: validation.validator, status: validation.status,
      }));
    return { ok: true, review: {
      id: run.id, name: run.name, applicationName: run.applicationName, createdAt: run.createdAt,
      status: run.status, phase: run.phase,
      progress: { processingId: run.preparation?.id ?? null, activeRole: run.preparation?.activeRole ?? null,
        activity: run.preparation?.activity ?? null, startedAt: run.preparation?.startedAt ?? null,
        finishedAt: run.preparation?.finishedAt ?? null },
      stopReason: run.preparation?.stopReason ? { code: run.preparation.stopReason.code, message: run.preparation.stopReason.message }
        : run.status === 'interrupted' && run.interruptions?.length ? { code: 'SERVICE_RESTART', message: 'O serviço reiniciou. O trabalho foi interrompido.' }
        : run.status === 'cancelled' ? { code: 'CANCELLED', message: 'Execução cancelada pelo usuário.' } : null,
      canResume: canResumePreparation(run), canCreateCases: canCreateCases(run), canDecideCases: canDecideCases(run),
      canMap: canMap(record, { targetAllowedOrigins: config.targetAllowedOrigins }),
      mapping: mapping ? { id: mapping.id, revision: mapping.revision, current: currentMapping,
        dependsOn: mapping.dependsOn.map(ref => ({ outputId: ref.outputId, revision: ref.revision })),
        payload: publicNavigation(mapping.payload),
        validations: run.validations.filter(item => item.outputId === mapping.id && item.outputRevision === mapping.revision)
          .map(item => ({ outputId: item.outputId, outputRevision: item.outputRevision,
            validator: item.validator, status: item.status, reason: item.reason ?? '',
            findings: (item.findings ?? []).map(finding => ({ code: finding.code, message: finding.message, location: finding.location })) })),
      } : null,
      observations: (run.observations ?? []).map(observation => ({ id: observation.id, assetId: observation.assetId,
        at: observation.at, width: observation.width, height: observation.height })),
      mappingActions: (run.mappingActions ?? []).map(action => ({ id: action.id, at: action.at, tool: action.tool,
        params: action.params, outcome: action.outcome, observationId: action.observationId ?? null, note: action.note ?? null })),
      answers,
      cases: cases ? { id: cases.id, revision: cases.revision, current: currentCases,
        dependsOn: cases.dependsOn.map(ref => ({ outputId: ref.outputId, revision: ref.revision })),
        answerRefs: (cases.answerRefs ?? []).map(ref => ({ questionId: ref.questionId, revision: ref.revision,
          ...(ref.answerId ? { answerId: ref.answerId } : {}) })), payload: { testCases: publicTestCases(cases.payload) },
        validations: run.validations.filter(item => item.outputId === cases.id && item.outputRevision === cases.revision)
          .map(item => ({ outputId: item.outputId, outputRevision: item.outputRevision,
            validator: item.validator, status: item.status, reason: item.reason ?? '',
            findings: (item.findings ?? []).map(finding => ({ code: finding.code, message: finding.message, location: finding.location })) })),
      } : null,
      curation: curation ? { id: curation.id, revision: curation.revision,
        payload: publicCuration(curation.payload), validations: validations(curation) } : null,
      questions: run.questions.map(question => ({ ...publicQuestion(question),
        outputId: curation?.id ?? null, outputRevision: curation?.revision ?? null,
        answerId: answers.find(answer => answer.outputId === curation?.id && answer.outputRevision === curation?.revision &&
          answer.questionId === question.id)?.id ?? null,
      })),
      plan: plan ? {
        id: plan.id, revision: plan.revision,
        payload: { testPlan: publicTestPlan(plan.payload.testPlan) },
        validations: run.validations.filter(validation =>
          validation.outputId === plan.id && validation.outputRevision === plan.revision)
          .map(validation => ({
            outputId: validation.outputId, outputRevision: validation.outputRevision,
            validator: validation.validator, status: validation.status,
          })),
      } : null,
      approvals: publicPlanDecisions(run.approvals),
      targetAccess: publicTargetAccess(run, Boolean(record.targetCredential && record.run.input?.credentialRef === record.targetCredential.ref)),
    } };
  } catch (error) {
    const failure = error instanceof StorageError ? error : new StorageError('STORAGE_FAILURE');
    return { ok: false, error: { code: failure.code, message: failure.message } };
  }
}

export function canDecideCases(run: RunRecord): boolean {
  if (run.status !== 'awaiting_approval' || run.phase !== 'case_design') return false;
  const cases = current(run.outputs, 'case_design');
  const plan = current(run.outputs, 'planning');
  const curation = current(run.outputs, 'curation');
  if (!cases || !plan || !curation || !Number.isSafeInteger(cases.revision) || cases.revision < 1) return false;
  const existingDecisions = run.approvals.filter(a => a.outputId === cases.id && a.outputRevision === cases.revision);
  if (existingDecisions.length > 0) return false;
  try {
    const dependencies = caseDependencies(run, { outputId: plan.id, outputRevision: plan.revision }, false);
    const validDeps = cases.dependsOn.length === 2 &&
      [dependencies.curation, dependencies.plan].every(output =>
        cases.dependsOn.some(ref => ref.outputId === output.id && ref.revision === output.revision)) &&
      JSON.stringify(cases.answerRefs ?? []) === JSON.stringify(plan.answerRefs ?? []);
    if (!validDeps) return false;
  } catch {
    return false;
  }
  const verdicts = run.validations.filter(v =>
    v.outputId === cases.id && v.outputRevision === cases.revision &&
    v.validator === 'output-validator' && v.status !== 'error');
  return verdicts.length === 1 && verdicts[0]?.status === 'approved';
}

/** Serviço interno; store já inicializado em config.dataDir.
 * request é intenção do solicitante. context.userId vem da identidade conferida
 * pelo backend; context.resourceReserved só confirma reserva REAL do chamador.
 * O serviço gera UUID/horário UTC, usa o domínio e confirma somente o que persistiu.
 * Falhas não devolvem execução/projeção; work não é despachado nem consumido aqui.
 */
export async function executePlanCommand(
  store: RunStore,
  runId: string,
  request: PlanCommandRequest,
  context: PlanCommandContext,
): Promise<PlanCommandResult> {
  if (request.type === 'approve_cases' || request.type === 'request_case_changes') {
    return executeCaseCommand(store, runId, {
      type: request.type,
      outputId: request.outputId,
      outputRevision: request.outputRevision,
      ...(request.comment !== undefined ? { comment: request.comment } : {}),
    }, context);
  }
  const planRequest = request;
  try {
    return await store.update<PlanCommandResult>(runId, record => {
      const run = record.run;
      if (!authorized(run.ownerId, context)) {
        return { save: false, value: {
          ok: false, work: null, error: { code: 'UNAUTHORIZED', message: 'Operação não autorizada para esta execução.' },
        } };
      }
      const state: PlanApprovalState = {
        status: run.status, phase: run.phase,
        plan: current(run.outputs, 'planning'), curation: current(run.outputs, 'curation'),
        validations: run.validations, approvals: run.approvals,
      };
      const reference = { outputId: planRequest.outputId, outputRevision: planRequest.outputRevision };
      const command: PlanApprovalCommand = planRequest.type === 'continue'
        ? { type: 'continue', ...reference, resourceReserved: context.resourceReserved === true }
        : { type: planRequest.type as 'approve_plan' | 'request_plan_changes', ...reference, id: randomUUID(), actorId: context.userId,
          at: new Date().toISOString(), ...(planRequest.comment === undefined ? {} : { comment: planRequest.comment }) };
      const result = applyPlanApprovalCommand(state, command);
      if (!result.ok) return { save: false, value: { ok: false, work: null, error: result.error } };

      run.status = result.state.status;
      run.phase = result.state.phase;
      run.approvals.push(...result.state.approvals.slice(state.approvals.length));
      const work: WorkIntent | null = result.work ? {
        ...result.work, id: randomUUID(), createdAt: new Date().toISOString(), status: 'pending',
      } : null;
      if (work) record.workIntents.push(work);
      return { save: result.state !== state, value: {
        ok: true, status: run.status, phase: run.phase, approvals: run.approvals, work,
      } };
    });
  } catch (error) {
    const failure = error instanceof StorageError ? error : new StorageError('STORAGE_FAILURE');
    return { ok: false, work: null, error: { code: failure.code, message: failure.message } };
  }
}

export async function executeCaseCommand(
  store: RunStore,
  runId: string,
  request: CaseCommandRequest,
  context: PlanCommandContext,
): Promise<CaseCommandResult> {
  try {
    return await store.update<CaseCommandResult>(runId, record => {
      const run = record.run;
      if (!authorized(run.ownerId, context)) {
        return { save: false, value: {
          ok: false, work: null, error: { code: 'UNAUTHORIZED', message: 'Operação não autorizada para esta execução.' },
        } };
      }
      const plan = current(run.outputs, 'planning');
      const curation = current(run.outputs, 'curation');
      const cases = current(run.outputs, 'case_design');

      if (plan) {
        try {
          caseDependencies(run, { outputId: plan.id, outputRevision: plan.revision }, false);
        } catch (error) {
          const failure = error instanceof PreparationError ? error : new PreparationError('STALE_VERSION', 'Dependências desatualizadas.');
          return { save: false, value: { ok: false, work: null, error: { code: failure.code as CaseApprovalErrorCode, message: failure.message } } };
        }
      }

      const state: CaseApprovalState = {
        status: run.status, phase: run.phase,
        cases, plan, curation,
        validations: run.validations, approvals: run.approvals,
      };
      const command: CaseApprovalCommand = {
        type: request.type, outputId: request.outputId, outputRevision: request.outputRevision,
        id: randomUUID(), actorId: context.userId, at: new Date().toISOString(),
        ...(request.comment === undefined ? {} : { comment: request.comment }),
      };
      const result = applyCaseApprovalCommand(state, command);
      if (!result.ok) return { save: false, value: { ok: false, work: null, error: result.error } };

      const hasNew = result.state.approvals.length > state.approvals.length;
      if (hasNew) {
        run.approvals.push(...result.state.approvals.slice(state.approvals.length));
      }
      return { save: hasNew, value: {
        ok: true, status: run.status, phase: run.phase, approvals: run.approvals, work: null,
      } };
    });
  } catch (error) {
    const failure = error instanceof StorageError ? error : new StorageError('STORAGE_FAILURE');
    return { ok: false, work: null, error: { code: failure.code, message: failure.message } };
  }
}

export async function executeApprovalCommand(
  store: RunStore,
  runId: string,
  request: Readonly<{ type: 'approve' | 'request_changes'; outputId: string; outputRevision: number; comment?: string }>,
  context: PlanCommandContext,
): Promise<PlanCommandResult> {
  const record = await store.read(runId);
  const matching = record.run.outputs.find(output => output.id === request.outputId);
  const isCases = matching?.phase === 'case_design' || (record.run.phase === 'case_design' && matching?.phase !== 'planning');
  if (isCases) {
    return executeCaseCommand(store, runId, {
      type: request.type === 'approve' ? 'approve_cases' : 'request_case_changes',
      outputId: request.outputId,
      outputRevision: request.outputRevision,
      ...(request.comment !== undefined ? { comment: request.comment } : {}),
    }, context);
  }
  return executePlanCommand(store, runId, {
    type: request.type === 'approve' ? 'approve_plan' : 'request_plan_changes',
    outputId: request.outputId,
    outputRevision: request.outputRevision,
    ...(request.comment !== undefined ? { comment: request.comment } : {}),
  }, context);
}
