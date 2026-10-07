import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { parseFeedback, type FeedbackContext, type FeedbackPayload } from '../domain/feedback.js';
import { InvalidPreparationOutput, parseVerdict, type Verdict } from '../domain/preparation.js';
import { SpecialistError, type TextualRole } from '../runtime/pi.js';
import type { RunOutput, RunRecord, StoredRun } from '../storage/runs.js';
import { latestOutput, PreparationError } from './prepare-plan.js';

export type FeedbackRequest = { outputId: string; outputRevision: number; answerIds?: string[] };
export type TextServices = {
  read(): Promise<StoredRun>;
  update<T>(change: (run: RunRecord) => T): Promise<T>;
  call<T>(role: TextualRole, phase: 'feedback' | 'report', attempt: number, revision: number,
    context: Record<string, unknown>, parse: (value: unknown) => T): Promise<T>;
  finish(status: string, reason: { code: string; message: string } | null): Promise<void>;
  time(): string;
};

export function feedbackDependencies(run: RunRecord, request: FeedbackRequest) {
  const target = run.outputs.find(output => output.id === request.outputId && output.revision === request.outputRevision);
  if (!target || run.outputs.some(output => output.id === target.id && output.revision > target.revision)) {
    throw new PreparationError('STALE_VERSION', 'A revisão comentada não é mais vigente.');
  }
  const decisions = run.approvals.filter(item => item.outputId === target.id && item.outputRevision === target.revision && item.decision === 'changes_requested');
  const answers = request.answerIds?.length ? run.answers.filter(answer => request.answerIds!.includes(answer.id as string)) : [];
  if (request.answerIds?.length ? new Set(request.answerIds).size !== request.answerIds.length || answers.length !== request.answerIds.length ||
    answers.some(answer => answer.outputId !== target.id || answer.outputRevision !== target.revision) : decisions.length !== 1) {
    throw new PreparationError('DECISION_MISSING', 'Não há comentário ou respostas válidas para analisar esta revisão.');
  }
  const outputs = ['curation', 'planning', 'case_design', 'mapping', 'route_detail'].map(phase => latestOutput(run, phase)).filter((item): item is RunOutput => !!item);
  const curation = outputs.find(output => output.phase === 'curation');
  const cases = outputs.find(output => output.phase === 'case_design');
  const context: FeedbackContext = {
    requirementIds: ((curation?.payload.requirements ?? []) as { id: string }[]).map(item => item.id),
    caseIds: ((cases?.payload.testCases ?? []) as { id: string }[]).map(item => item.id),
  };
  return { target, decisions, answers, outputs, context, artifacts: [...run.artifacts, ...(run.answerArtifacts ?? [])] };
}

/** Compartilha só o ciclo textual de revisão; reserva, orçamento e cancelamento continuam no coordenador. */
export async function produceValidatedText(services: TextServices, options: {
  phase: 'feedback' | 'report'; role: TextualRole; context: Record<string, unknown>;
  dependsOn: RunOutput['dependsOn']; check(run: RunRecord): void;
  answerRefs?: RunOutput['answerRefs'];
  parse(value: unknown): Record<string, unknown>;
}): Promise<RunOutput | null> {
  const initial = (await services.read()).run;
  let previous = latestOutput(initial, options.phase) ?? null;
  const id = previous?.id ?? randomUUID();
  let feedback: unknown = null;
  for (let attempt = 1; attempt <= initial.preparation!.limits.maxRevisions; attempt++) {
    const revision = (previous?.revision ?? 0) + 1;
    let payload: Record<string, unknown>;
    try {
      payload = await services.call(options.role, options.phase, attempt, revision,
        { task: options.phase, ...options.context, previousOutput: previous, feedback }, options.parse);
    } catch (error) {
      if (error instanceof InvalidPreparationOutput || error instanceof SpecialistError && error.code === 'INVALID_OUTPUT') {
        feedback = { code: error.code, message: error.message }; continue;
      }
      throw error;
    }
    const previousOutput = previous;
    const output = await services.update(run => {
      options.check(run);
      const output: RunOutput = { id, revision, phase: options.phase, producer: options.role,
        createdAt: services.time(), budgetCycleId: run.preparation!.budgetCycleId,
        dependsOn: structuredClone(options.dependsOn), payload,
        answerRefs: options.answerRefs ?? run.answers.filter(answer => !run.answers.some(other => other.questionId === answer.questionId &&
          (other.revision as number) > (answer.revision as number))).map(answer => ({ answerId: answer.id as string,
          questionId: answer.questionId as string, revision: answer.revision as number })) };
      run.outputs.push(output);
      return output;
    });
    previous = output;
    let verdict: Verdict | undefined;
    for (let validatorAttempt = 1; validatorAttempt <= initial.preparation!.limits.maxValidatorAttempts; validatorAttempt++) {
      try {
        verdict = await services.call('output-validator', options.phase, validatorAttempt, revision,
          { task: 'validation', ...options.context, output, previousOutput,
            previousVerdicts: (await services.read()).run.validations.filter(item => item.outputId === id) }, parseVerdict);
      } catch (error) {
        if (error instanceof PreparationError || error instanceof SpecialistError && error.code === 'CANCELLED') throw error;
        const code = error instanceof SpecialistError || error instanceof InvalidPreparationOutput ? error.code : 'MODEL_ERROR';
        await services.update(run => {
          options.check(run);
          run.validations.push({ id: randomUUID(), outputId: id, outputRevision: revision, validator: 'output-validator',
            at: services.time(), attempt: validatorAttempt, status: 'error', reason: 'A validação não produziu parecer válido.',
            findings: [{ code, message: 'A validação não produziu parecer válido.', location: null }] });
        });
        if (validatorAttempt === initial.preparation!.limits.maxValidatorAttempts) {
          throw new PreparationError('VALIDATOR_LIMIT', 'O limite de tentativas técnicas do validador foi esgotado sem parecer válido.');
        }
        continue;
      }
      await services.update(run => {
        options.check(run);
        run.validations.push({ id: randomUUID(), outputId: id, outputRevision: revision, validator: 'output-validator',
          at: services.time(), attempt: validatorAttempt, ...verdict! });
      });
      break;
    }
    if (verdict?.status === 'approved') return output;
    if (verdict?.status === 'blocked') {
      await services.finish('awaiting_input', { code: 'VALIDATION_BLOCKED', message: verdict.reason });
      return null;
    }
    feedback = verdict;
  }
  throw new PreparationError('REVISION_LIMIT', 'O limite de três tentativas de produção/revisão da saída foi esgotado.');
}

export async function produceFeedback(services: TextServices, request: FeedbackRequest): Promise<RunOutput | null> {
  const initial = feedbackDependencies((await services.read()).run, request);
  const check = (run: RunRecord) => {
    // A resposta a uma pergunta de feedback produz a revisão seguinte do mesmo ID.
    const source = initial.target.phase === 'feedback' ? { ...run, outputs: run.outputs.filter(output =>
      output.id !== initial.target.id || output.revision <= initial.target.revision) } : run;
    if (!isDeepStrictEqual(feedbackDependencies(source, request), initial)) throw new PreparationError('STALE_VERSION', 'O contexto do comentário foi alterado durante a análise.');
  };
  const refs = [initial.target, ...initial.outputs].filter((output, index, all) => all.findIndex(other => other.id === output.id && other.revision === output.revision) === index);
  const output = await produceValidatedText(services, { phase: 'feedback', role: 'test-designer', context: initial,
    answerRefs: initial.answers.map(answer => ({ answerId: answer.id as string, questionId: answer.questionId as string, revision: answer.revision as number })),
    dependsOn: refs.map(output => ({ outputId: output.id, revision: output.revision })), check,
    parse: value => parseFeedback(value, initial.context) });
  if (output && (output.payload as FeedbackPayload).impact === 'clarification') {
    await services.update(run => {
      check(run);
      const payload = output.payload as FeedbackPayload;
      run.questions.push({ id: `feedback:${output.id}:${output.revision}`, description: payload.question, cause: payload.reason,
        requirementIds: payload.requirementIds, caseIds: payload.caseIds, blocking: true, sources: [],
        phase: 'feedback', outputId: output.id, outputRevision: output.revision });
    });
  }
  return output;
}
