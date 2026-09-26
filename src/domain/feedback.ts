import { InvalidPreparationOutput } from './preparation.js';

export type FeedbackPayload = {
  impact: 'requirements' | 'cases' | 'navigation' | 'clarification';
  restartFrom: 'curation' | 'planning' | 'case_design' | 'mapping' | null;
  reason: string; requirementIds: string[]; caseIds: string[];
  instructions: string[]; question: string | null;
};
export type FeedbackContext = { requirementIds: string[]; caseIds: string[] };
export type FeedbackInvalidation = {
  id: string; outputId: string; outputRevision: number; reason: string; at: string;
  feedbackRef: { outputId: string; revision: number }; caseIds: string[];
};
const fail = (): never => { throw new InvalidPreparationOutput(); };
const text = (value: unknown, max = 4000): string =>
  typeof value === 'string' && !!value.trim() && value.length <= max ? value : fail();

/** Só estrutura e matriz de dependências. O especialista interpreta o comentário. */
export function parseFeedback(value: unknown, context: FeedbackContext): FeedbackPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  const item = value as Record<string, unknown>;
  const keys = ['impact', 'restartFrom', 'reason', 'requirementIds', 'caseIds', 'instructions', 'question'];
  if (Object.keys(item).length !== keys.length || keys.some(key => !Object.hasOwn(item, key))) return fail();
  const allowed = {
    requirements: ['curation', 'planning'], cases: ['case_design'], navigation: ['mapping'], clarification: [null],
  } as const;
  if (typeof item.impact !== 'string' || !Object.hasOwn(allowed, item.impact) ||
    !(allowed[item.impact as keyof typeof allowed] as readonly unknown[]).includes(item.restartFrom)) return fail();
  const ids = (value: unknown, permitted: string[]) => {
    if (!Array.isArray(value) || value.length > 30 || value.some(id => typeof id !== 'string' || !permitted.includes(id)) ||
      new Set(value).size !== value.length) return fail();
    return value as string[];
  };
  const requirementIds = ids(item.requirementIds, context.requirementIds), caseIds = ids(item.caseIds, context.caseIds);
  if (item.impact === 'requirements' && context.requirementIds.length && !requirementIds.length) return fail();
  if (['cases', 'navigation'].includes(item.impact) && (!context.caseIds.length || !caseIds.length)) return fail();
  if (!Array.isArray(item.instructions) || item.instructions.length > 30) return fail();
  const instructions = item.instructions.map(value => text(value));
  if (item.impact === 'clarification' ? instructions.length !== 0 : !instructions.length || item.question !== null) return fail();
  return { impact: item.impact as FeedbackPayload['impact'], restartFrom: item.restartFrom as FeedbackPayload['restartFrom'],
    reason: text(item.reason), requirementIds, caseIds, instructions,
    question: item.impact === 'clarification' ? text(item.question) : null };
}

export function feedbackEffects(feedback: FeedbackPayload, outputs: readonly {
  id: string; revision: number; phase: string; payload: Record<string, unknown>;
}[]) {
  const phases = feedback.impact === 'clarification' ? [] : feedback.impact === 'navigation'
    ? ['mapping', 'route_detail', 'execution', 'report'] : feedback.impact === 'cases'
    ? ['case_design', 'mapping', 'route_detail', 'execution', 'report']
    : [...(feedback.restartFrom === 'curation' ? ['curation'] : []), 'planning', 'case_design', 'mapping', 'route_detail', 'execution', 'report'];
  // A falha de uma tentativa anterior ainda pode ser a conclusão sustentada do caso.
  // Invalidar só a revisão mais recente deixaria essa conclusão afetada como vigente.
  const latest = outputs.filter(output => output.phase === 'execution' || !outputs.some(other => other.id === output.id && other.revision > output.revision));
  return { restartFrom: feedback.restartFrom,
    requiresPlanApproval: feedback.impact === 'requirements',
    requiresCaseApproval: feedback.impact === 'requirements' || feedback.impact === 'cases',
    affectedOutputs: latest.filter(output => phases.includes(output.phase) &&
      (output.phase !== 'execution' || feedback.caseIds.length === 0 || feedback.caseIds.includes(output.payload.caseId as string)))
      .map(output => ({ outputId: output.id, outputRevision: output.revision })) };
}
