import assert from 'node:assert/strict';
import test from 'node:test';
import { feedbackEffects, parseFeedback } from '../src/domain/feedback.js';
import { feedbackDependencies, produceFeedback, type TextServices } from '../src/application/analyze-feedback.js';
import type { RunRecord } from '../src/storage/runs.js';

const navigation = { impact: 'navigation', restartFrom: 'mapping', reason: 'Mudou a indicação do menu.',
  requirementIds: ['REQ-1'], caseIds: ['CT-1'], instructions: ['Observar o menu indicado.'], question: null };
const context = { requirementIds: ['REQ-1'], caseIds: ['CT-1', 'CT-2'] };
const approved = { status: 'approved', findings: [], reason: 'Impacto localizado e coerente.' };
const at = '2026-09-26T12:00:00.000Z';
function run(): RunRecord {
  return { id: 'run-feedback', ownerId: 'owner', name: 'Feedback', applicationName: 'Alvo', createdAt: at,
    status: 'running', phase: 'case_design', input: {}, artifacts: [], questions: [], answers: [], validations: [], budgetCycles: [], validationPolicy: {},
    outputs: [
      { id: 'curation', revision: 1, phase: 'curation', dependsOn: [], payload: { requirements: [{ id: 'REQ-1' }] } },
      { id: 'cases', revision: 1, phase: 'case_design', dependsOn: [], payload: { testCases: [{ id: 'CT-1' }, { id: 'CT-2' }] } },
    ], approvals: [{ id: 'decision', actorId: 'owner', at, outputId: 'cases', outputRevision: 1, decision: 'changes_requested', comment: 'O formulário está no menu Agenda.' }],
    preparation: { id: 'work', budgetCycleId: 'cycle', startedAt: at, finishedAt: null, activeRole: 'test-designer', activity: 'feedback', stopReason: null,
      calls: [], limits: { activeMs: 2700000, maxRequirements: 10, maxRevisions: 3, maxValidatorAttempts: 2, timeoutMs: 120000 } } };
}
function services(record: RunRecord, respond: (role: string, context: Record<string, unknown>) => unknown) {
  const calls: { role: string; phase: string; context: Record<string, unknown> }[] = [];
  const result: TextServices = {
    read: async () => ({ schemaVersion: 1, run: structuredClone(record), workIntents: [] }),
    update: async change => change(record), time: () => at,
    finish: async status => { record.status = status; },
    call: async (role, phase, _attempt, _revision, input, parse) => {
      calls.push({ role, phase, context: structuredClone(input) }); return parse(respond(role, input));
    },
  };
  return { services: result, calls };
}

test('feedback: matriz de impacto é estrutural; IDs desconhecidos e interpretação ambígua implícita são recusados', () => {
  assert.deepEqual(parseFeedback(navigation, context), navigation);
  assert.throws(() => parseFeedback({ ...navigation, caseIds: ['invented'] }, context));
  assert.throws(() => parseFeedback({ ...navigation, restartFrom: 'case_design' }, context));
  assert.throws(() => parseFeedback({ ...navigation, impact: 'clarification', restartFrom: null, question: 'Qual campo?' }, context));
  assert.equal(parseFeedback({ ...navigation, impact: 'clarification', restartFrom: null, instructions: [], question: 'Qual campo?' }, context).question, 'Qual campo?');
  assert.throws(() => parseFeedback({ ...navigation, verdict: 'passed' }, context));
});

test('feedback: orientação preserva lógica e invalida somente resultados dos casos afetados', () => {
  const outputs = ['planning', 'case_design', 'mapping', 'route_detail', 'report'].map(phase => ({ id: phase, revision: 1, phase, payload: {} }));
  outputs.push(...['CT-1', 'CT-2'].map(caseId => ({ id: caseId, revision: 1, phase: 'execution', payload: { caseId } })));
  const effects = feedbackEffects(parseFeedback(navigation, context), outputs);
  assert.equal(effects.requiresPlanApproval, false); assert.equal(effects.requiresCaseApproval, false);
  assert.deepEqual(effects.affectedOutputs.map(item => item.outputId), ['mapping', 'route_detail', 'report', 'CT-1']);
  outputs.push({ id: 'CT-1', revision: 2, phase: 'execution', payload: { caseId: 'CT-1' } });
  assert.deepEqual(feedbackEffects(parseFeedback(navigation, context), outputs).affectedOutputs.filter(item => item.outputId === 'CT-1')
    .map(item => item.outputRevision), [1, 2]);
  const rules = feedbackEffects(parseFeedback({ ...navigation, impact: 'requirements', restartFrom: 'curation' }, context), outputs);
  assert.equal(rules.requiresPlanApproval, true); assert.equal(rules.requiresCaseApproval, true);
});

test('feedback: especialista e validador separados preservam decisões e revisões anteriores', async () => {
  const record = run(); let validations = 0;
  const { services: session, calls } = services(record, role => role !== 'output-validator' ? navigation : ++validations === 1
    ? { status: 'changes_requested', findings: [{ code: 'LOCALIZE', message: 'Especifique o caso afetado.', location: 'caseIds' }], reason: 'Corrigir localização.' } : approved);
  const output = await produceFeedback(session, { outputId: 'cases', outputRevision: 1 });
  assert.equal(output?.revision, 2); assert.equal(record.outputs.filter(item => item.phase === 'feedback').length, 2);
  assert.deepEqual(calls.map(item => item.role), ['test-designer', 'output-validator', 'test-designer', 'output-validator']);
  assert.deepEqual(record.approvals[0]?.comment, 'O formulário está no menu Agenda.');
  assert.equal((calls[2]!.context.feedback as { status: string }).status, 'changes_requested');
  assert.equal((calls[1]!.context.output as { revision: number }).revision, 1);
});

test('feedback: pergunta localizada é persistida e sua resposta produz nova revisão no mesmo ID', async () => {
  const record = run(); const ambiguous = { ...navigation, impact: 'clarification', restartFrom: null, instructions: [], question: 'Mudar a regra ou só o menu?' };
  const first = await produceFeedback(services(record, role => role === 'output-validator' ? approved : ambiguous).services,
    { outputId: 'cases', outputRevision: 1 });
  assert.ok(first);
  assert.equal(record.questions[0]?.id, `feedback:${first.id}:1`);
  record.answers.push({ id: 'answer-1', questionId: record.questions[0]!.id, outputId: first.id, outputRevision: 1, revision: 1, text: 'Só o menu.' });
  const second = await produceFeedback(services(record, role => role === 'output-validator' ? approved : navigation).services,
    { outputId: first.id, outputRevision: 1, answerIds: ['answer-1'] });
  assert.equal(second?.id, first.id); assert.equal(second?.revision, 2);
  assert.deepEqual(second?.answerRefs?.map(ref => ref.answerId), ['answer-1']);
});

test('feedback: comentário desatualizado e respostas de outra saída não autorizam análise', () => {
  const record = run(); record.outputs.push({ ...record.outputs[1]!, revision: 2 });
  assert.throws(() => feedbackDependencies(record, { outputId: 'cases', outputRevision: 1 }), /vigente/);
  record.answers.push({ id: 'answer', outputId: 'curation', outputRevision: 1 });
  assert.throws(() => feedbackDependencies(record, { outputId: 'cases', outputRevision: 2, answerIds: ['answer'] }), /respostas/);
});
