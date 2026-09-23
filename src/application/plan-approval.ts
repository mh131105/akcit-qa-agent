import { randomUUID } from 'node:crypto';
import {
  applyPlanApprovalCommand, type PlanApprovalCommand, type PlanApprovalErrorCode,
  type PlanApprovalState, type PlanDecision,
} from '../domain/plan-approval.js';
import { RunStore, StorageError, type StorageErrorCode, type RunOutput, type WorkIntent } from '../storage/runs.js';

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
      if (!context || typeof context.userId !== 'string' || !context.userId.trim() || context.userId !== run.ownerId) {
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
