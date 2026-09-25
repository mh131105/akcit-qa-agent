import {
  nonEmpty, recordApprovalDecision, validRevision,
  type PlanApprovalErrorCode, type PlanDecision,
} from './plan-approval.js';

type OutputReference = Readonly<{ outputId: string; outputRevision: number }>;
type OutputVersion = Readonly<{ id: string; revision: number }>;

export type CaseApprovalState = Readonly<{
  status: string;
  phase: string;
  cases: (OutputVersion & Readonly<{
    dependsOn: readonly Readonly<{ outputId: string; revision: number }>[];
    answerRefs?: readonly Readonly<{ questionId: string; revision: number; answerId?: string }>[];
  }>) | null;
  plan: (OutputVersion & Readonly<{
    answerRefs?: readonly Readonly<{ questionId: string; revision: number; answerId?: string }>[];
  }>) | null;
  curation: OutputVersion | null;
  validations: readonly (OutputReference & Readonly<{
    validator: string;
    status: 'approved' | 'changes_requested' | 'blocked' | 'error';
  }>)[];
  approvals: readonly PlanDecision[];
}>;

export type CaseApprovalCommand = OutputReference & Readonly<{
  type: 'approve_cases' | 'request_case_changes';
  id: string;
  actorId: string;
  at: string;
  comment?: string | undefined;
}>;

export type CaseApprovalErrorCode = PlanApprovalErrorCode;

export type CaseApprovalResult =
  | { ok: true; state: CaseApprovalState }
  | { ok: false; state: CaseApprovalState; error: { code: CaseApprovalErrorCode; message: string } };

// ponytail: função pura de decisão humana dos casos; reutiliza a lógica de aprovação sem criar novas abstrações.
export function applyCaseApprovalCommand(
  state: CaseApprovalState,
  command: CaseApprovalCommand,
): CaseApprovalResult {
  const refuse = (code: CaseApprovalErrorCode, message: string): CaseApprovalResult =>
    ({ ok: false, state, error: { code, message } });

  if (state.phase !== 'case_design' || state.status !== 'awaiting_approval') {
    return refuse('INVALID_STATE', 'A execução não está aguardando aprovação dos casos de teste.');
  }

  const { cases, plan, curation } = state;
  if (!cases || !plan || !curation || !nonEmpty(cases.id) || !nonEmpty(plan.id) || !nonEmpty(curation.id) ||
    !validRevision(command.outputRevision) || !validRevision(cases.revision) ||
    !validRevision(plan.revision) || !validRevision(curation.revision) ||
    command.outputId !== cases.id || command.outputRevision !== cases.revision ||
    cases.dependsOn.length !== 2 ||
    !cases.dependsOn.some(ref => ref.outputId === curation.id && ref.revision === curation.revision) ||
    !cases.dependsOn.some(ref => ref.outputId === plan.id && ref.revision === plan.revision) ||
    JSON.stringify(cases.answerRefs ?? []) !== JSON.stringify(plan.answerRefs ?? [])) {
    return refuse('STALE_VERSION', 'Casos de teste ou dependências inexistentes, inválidos ou desatualizados. Atualize a versão.');
  }

  const planApproved = state.approvals.some(approval =>
    approval.outputId === plan.id && approval.outputRevision === plan.revision && approval.decision === 'approved');
  const planValidated = state.validations.some(validation =>
    validation.outputId === plan.id && validation.outputRevision === plan.revision &&
    validation.validator === 'output-validator' && validation.status === 'approved');
  if (!planApproved || !planValidated) {
    return refuse('STALE_VERSION', 'O plano precisa estar aprovado e validado para a versão vigente.');
  }

  const verdicts = state.validations.filter(validation =>
    validation.outputId === cases.id && validation.outputRevision === cases.revision &&
    validation.validator === 'output-validator' && validation.status !== 'error');
  if (verdicts.length !== 1 || verdicts[0]?.status !== 'approved') {
    return refuse('INSUFFICIENT_VALIDATION', 'Os casos de teste precisam de parecer aprovado do validador independente para sua revisão vigente.');
  }

  if (command.type !== 'approve_cases' && command.type !== 'request_case_changes') {
    return refuse('INVALID_STATE', 'Comando incompatível com a aprovação dos casos de teste.');
  }

  const decisionResult = recordApprovalDecision(
    state.approvals,
    { outputId: cases.id, outputRevision: cases.revision },
    {
      id: command.id,
      actorId: command.actorId,
      at: command.at,
      decision: command.type === 'approve_cases' ? 'approved' : 'changes_requested',
      comment: command.comment,
    },
  );
  if (!decisionResult.ok) return { ok: false, state, error: decisionResult.error };
  if (decisionResult.approvals === state.approvals) return { ok: true, state };
  return { ok: true, state: { ...state, approvals: decisionResult.approvals } };
}
