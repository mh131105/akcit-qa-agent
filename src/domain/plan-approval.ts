type OutputReference = Readonly<{ outputId: string; outputRevision: number }>;
type OutputVersion = Readonly<{ id: string; revision: number }>;

export type PlanDecision = OutputReference & Readonly<{
  id: string;
  actorId: string;
  at: string;
  decision: 'approved' | 'changes_requested';
  comment: string;
}>;

export type PlanApprovalState = Readonly<{
  status: string;
  phase: string;
  // Snapshots vigentes obtidos do armazenamento pelo backend, nunca do cliente.
  plan: (OutputVersion & Readonly<{
    dependsOn: readonly Readonly<{ outputId: string; revision: number }>[];
  }>) | null;
  curation: OutputVersion | null;
  validations: readonly (OutputReference & Readonly<{
    validator: string;
    status: 'approved' | 'changes_requested' | 'blocked' | 'error';
  }>)[];
  approvals: readonly PlanDecision[];
}>;

export type PlanApprovalCommand = OutputReference & (
  | Readonly<{
    type: 'approve_plan' | 'request_plan_changes';
    id: string;
    actorId: string;
    at: string;
    comment?: string;
  }>
  | Readonly<{ type: 'continue'; resourceReserved: boolean }>
);

export type PlanApprovalErrorCode =
  | 'INVALID_STATE'
  | 'INVALID_DECISION'
  | 'STALE_VERSION'
  | 'INSUFFICIENT_VALIDATION'
  | 'DECISION_MISSING'
  | 'DECISION_CONFLICT'
  | 'COMMENT_REQUIRED'
  | 'RESOURCE_UNAVAILABLE';

export type PlanApprovalResult =
  | { ok: true; state: PlanApprovalState; work: (OutputReference & {
    type: 'create_cases' | 'analyze_feedback';
  }) | null }
  | { ok: false; state: PlanApprovalState; work: null; error: {
    code: PlanApprovalErrorCode; message: string;
  } };

const validRevision = (revision: number) => Number.isSafeInteger(revision) && revision > 0;
const nonEmpty = (value: string) => typeof value === 'string' && value.trim().length > 0;
const validTime = (at: string) => {
  if (typeof at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(at) ||
    !Number.isFinite(Date.parse(at))) return false;
  return new Date(at).toISOString() === (at.includes('.') ? at : at.replace('Z', '.000Z'));
};
const validDecision = (decision: PlanDecision) =>
  nonEmpty(decision.id) && nonEmpty(decision.actorId) && validTime(decision.at) &&
  typeof decision.comment === 'string' &&
  (decision.decision === 'approved' ||
    (decision.decision === 'changes_requested' && nonEmpty(decision.comment)));

export function applyPlanApprovalCommand(
  state: PlanApprovalState,
  command: PlanApprovalCommand,
): PlanApprovalResult {
  const refuse = (code: PlanApprovalErrorCode, message: string): PlanApprovalResult =>
    ({ ok: false, state, work: null, error: { code, message } });

  if (state.phase !== 'planning' || state.status !== 'awaiting_approval') {
    return refuse('INVALID_STATE', 'A execução não está aguardando aprovação do plano.');
  }

  const { plan, curation } = state;
  if (!plan || !curation || !nonEmpty(plan.id) || !nonEmpty(curation.id) || plan.id === curation.id ||
    !validRevision(command.outputRevision) || !validRevision(plan.revision) ||
    !validRevision(curation.revision) || command.outputId !== plan.id ||
    command.outputRevision !== plan.revision || plan.dependsOn.length !== 1 ||
    !plan.dependsOn.every(ref => ref.outputId === curation.id &&
      validRevision(ref.revision) && ref.revision === curation.revision)) {
    return refuse('STALE_VERSION', 'Plano ou dependência inexistente, inválido ou desatualizado. Atualize a versão.');
  }

  const approved = (output: OutputVersion) => {
    const verdicts = state.validations.filter(validation =>
      validation.outputId === output.id && validation.outputRevision === output.revision &&
      validation.validator === 'output-validator' && validation.status !== 'error');
    return verdicts.length === 1 && verdicts[0]?.status === 'approved';
  };
  if (!approved(plan) || !approved(curation)) {
    return refuse('INSUFFICIENT_VALIDATION', 'Plano e curadoria precisam de parecer aprovado do validador independente para suas versões vigentes.');
  }

  const decisions = state.approvals.filter(approval =>
    approval.outputId === plan.id && approval.outputRevision === plan.revision);
  if (decisions.length > 1) {
    return refuse('DECISION_CONFLICT', 'A revisão possui mais de uma decisão registrada.');
  }
  const previous = decisions[0];

  if (command.type === 'approve_plan' || command.type === 'request_plan_changes') {
    const comment = command.comment ?? '';
    if (command.type === 'request_plan_changes' && !nonEmpty(comment)) {
      return refuse('COMMENT_REQUIRED', 'Informe um comentário para solicitar alterações.');
    }
    const decision: PlanDecision = {
      id: command.id, outputId: plan.id, outputRevision: plan.revision,
      actorId: command.actorId, at: command.at, comment,
      decision: command.type === 'approve_plan' ? 'approved' : 'changes_requested',
    };
    if (!validDecision(decision)) {
      return refuse('INVALID_DECISION', 'Informe identificador, autor e horário UTC válidos para a decisão.');
    }
    if (previous) {
      if (previous.actorId !== decision.actorId || previous.decision !== decision.decision ||
        previous.comment !== decision.comment) {
        return refuse('DECISION_CONFLICT', 'Esta revisão já possui uma decisão diferente; decisões não são editadas.');
      }
      return { ok: true, state, work: null };
    }
    if (state.approvals.some(approval => approval.id === decision.id)) {
      return refuse('DECISION_CONFLICT', 'O identificador da decisão já está em uso.');
    }
    return { ok: true, state: { ...state, approvals: [...state.approvals, decision] }, work: null };
  }

  if (command.type !== 'continue') {
    return refuse('INVALID_STATE', 'Comando incompatível com a aprovação do plano.');
  }
  if (!previous || !validDecision(previous)) {
    return refuse('DECISION_MISSING', 'Não há decisão humana válida para a versão vigente do plano.');
  }
  if (command.resourceReserved !== true) {
    return refuse('RESOURCE_UNAVAILABLE', 'Ambiente ocupado. A decisão foi preservada; tente continuar novamente quando houver recurso reservado.');
  }
  const createCases = previous.decision === 'approved';
  return {
    ok: true,
    state: { ...state, status: 'running', phase: createCases ? 'case_design' : 'planning' },
    work: { type: createCases ? 'create_cases' : 'analyze_feedback', outputId: plan.id, outputRevision: plan.revision },
  };
}
