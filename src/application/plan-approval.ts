import { randomUUID } from 'node:crypto';
import { canResumePreparation, preparationAnswers } from './prepare-plan.js';
import {
  applyPlanApprovalCommand, type PlanApprovalCommand, type PlanApprovalErrorCode,
  type PlanApprovalState, type PlanDecision,
} from '../domain/plan-approval.js';
import { RunStore, StorageError, type StorageErrorCode, type RunOutput, type WorkIntent, type PreparationAnswer } from '../storage/runs.js';

export type PlanCommandRequest = Readonly<{
  type: 'approve_plan' | 'request_plan_changes' | 'continue';
  outputId: string; outputRevision: number; comment?: string;
}>;
export type PlanCommandContext = Readonly<{ userId: string; resourceReserved?: boolean }>;
export type PlanCommandResult =
  | { ok: true; status: string; phase: string; approvals: readonly PlanDecision[]; work: WorkIntent | null }
  | { ok: false; work: null; error: {
    code: PlanApprovalErrorCode | StorageErrorCode | 'UNAUTHORIZED'; message: string;
  } };

export type PlanReview = {
  id: string; name: string; applicationName: string; createdAt: string;
  status: string; phase: string;
  progress: { processingId: string | null; activeRole: string | null; activity: string | null;
    startedAt: string | null; finishedAt: string | null };
  stopReason: { code: string; message: string } | null;
  canResume: boolean;
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
function publicTestPlan(value: unknown) {
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
): Promise<PlanReviewResult> {
  try {
    const { run } = await store.read(runId);
    if (!authorized(run.ownerId, context)) {
      return { ok: false, error: { code: 'UNAUTHORIZED', message: 'Operação não autorizada para esta execução.' } };
    }
    const plan = current(run.outputs, 'planning');
    const curation = current(run.outputs, 'curation');
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
      canResume: canResumePreparation(run), answers,
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
    } };
  } catch (error) {
    const failure = error instanceof StorageError ? error : new StorageError('STORAGE_FAILURE');
    return { ok: false, error: { code: failure.code, message: failure.message } };
  }
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
      const reference = { outputId: request.outputId, outputRevision: request.outputRevision };
      const command: PlanApprovalCommand = request.type === 'continue'
        ? { type: 'continue', ...reference, resourceReserved: context.resourceReserved === true }
        : { type: request.type, ...reference, id: randomUUID(), actorId: context.userId,
          at: new Date().toISOString(), ...(request.comment === undefined ? {} : { comment: request.comment }) };
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
