import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  applyCaseApprovalCommand,
  type CaseApprovalCommand,
  type CaseApprovalState,
} from '../src/domain/case-approval.js';
import type { RunRecord } from '../src/storage/runs.js';

const fixture = JSON.parse(readFileSync(new URL(
  '../docs/requisitos/exemplos/execucao-demo.json', import.meta.url,
), 'utf8')) as { fixture: boolean; run: RunRecord };
assert.equal(fixture.fixture, true);

const planOutput = fixture.run.outputs.find(output => output.phase === 'planning')!;
const curationOutput = fixture.run.outputs.find(output => output.phase === 'curation')!;
const casesOutput = fixture.run.outputs.find(output => output.phase === 'case_design')!;
assert.ok(planOutput);
assert.ok(curationOutput);
assert.ok(casesOutput);

const reference = { outputId: casesOutput.id, outputRevision: casesOutput.revision };
const approveCommand: CaseApprovalCommand = {
  type: 'approve_cases',
  ...reference,
  id: 'approval-cases-1',
  actorId: 'user-tester',
  at: '2026-09-24T20:00:00.000Z',
};
const changesCommand: CaseApprovalCommand = {
  type: 'request_case_changes',
  ...reference,
  id: 'approval-cases-2',
  actorId: 'user-tester',
  at: '2026-09-24T20:00:00.000Z',
  comment: 'Revisar o resultado esperado do caso CT-03.',
};

function validState(): CaseApprovalState {
  return {
    status: 'awaiting_approval',
    phase: 'case_design',
    cases: {
      id: casesOutput.id,
      revision: casesOutput.revision,
      dependsOn: casesOutput.dependsOn.map(r => ({ outputId: r.outputId, revision: r.revision })),
      answerRefs: casesOutput.answerRefs ? [...casesOutput.answerRefs] : [],
    },
    plan: {
      id: planOutput.id,
      revision: planOutput.revision,
      answerRefs: planOutput.answerRefs ? [...planOutput.answerRefs] : [],
    },
    curation: {
      id: curationOutput.id,
      revision: curationOutput.revision,
    },
    validations: [
      { outputId: curationOutput.id, outputRevision: curationOutput.revision, validator: 'output-validator', status: 'approved' },
      { outputId: planOutput.id, outputRevision: planOutput.revision, validator: 'output-validator', status: 'approved' },
      { outputId: casesOutput.id, outputRevision: casesOutput.revision, validator: 'output-validator', status: 'approved' },
    ],
    approvals: [
      {
        id: 'approval-plan-1',
        outputId: planOutput.id,
        outputRevision: planOutput.revision,
        actorId: 'user-tester',
        at: '2026-09-24T19:00:00.000Z',
        decision: 'approved',
        comment: 'Plano aprovado.',
      },
    ],
  };
}

test('CA-01: aprovação válida dos casos registra autor, data, versão e preserva o estado', () => {
  const state = validState();
  const result = applyCaseApprovalCommand(state, approveCommand);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.state.status, 'awaiting_approval');
  assert.equal(result.state.phase, 'case_design');
  assert.equal(result.state.approvals.length, 2);
  const decision = result.state.approvals.at(-1)!;
  assert.deepEqual(decision, {
    id: approveCommand.id,
    outputId: casesOutput.id,
    outputRevision: casesOutput.revision,
    actorId: approveCommand.actorId,
    at: approveCommand.at,
    decision: 'approved',
    comment: '',
  });
});

test('CA-02: pedido de alteração dos casos exige comentário não vazio e preserva comentário', () => {
  const state = validState();
  const result = applyCaseApprovalCommand(state, changesCommand);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.state.approvals.length, 2);
  const decision = result.state.approvals.at(-1)!;
  assert.equal(decision.decision, 'changes_requested');
  assert.equal(decision.comment, changesCommand.comment);

  for (const empty of ['', '   ', undefined]) {
    const invalid = applyCaseApprovalCommand(state, {
      ...changesCommand,
      comment: empty,
    });
    assert.equal(invalid.ok, false);
    if (invalid.ok) return;
    assert.equal(invalid.error.code, 'COMMENT_REQUIRED');
  }
});

test('CA-03: recusa comando se a fase ou status não estiver em awaiting_approval/case_design', () => {
  for (const [status, phase] of [
    ['running', 'case_design'],
    ['awaiting_approval', 'planning'],
    ['awaiting_approval', 'mapping'],
    ['completed', 'case_design'],
  ]) {
    const result = applyCaseApprovalCommand({ ...validState(), status, phase }, approveCommand);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error.code, 'INVALID_STATE');
  }
});

test('CA-03: recusa se a saída solicitada não corresponder à revisão vigente dos casos', () => {
  const state = validState();
  for (const invalidRef of [
    { outputId: 'wrong-id', outputRevision: 1 },
    { outputId: casesOutput.id, outputRevision: 2 },
    { outputId: casesOutput.id, outputRevision: 0 },
  ]) {
    const result = applyCaseApprovalCommand(state, { ...approveCommand, ...invalidRef });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error.code, 'STALE_VERSION');
  }
});

test('CA-03: recusa se as dependências dos casos tiverem sido alteradas ou forem inconsistentes', () => {
  const state = validState();
  // Dependência com revisão desatualizada
  const staleDeps: CaseApprovalState = {
    ...state,
    cases: {
      ...state.cases!,
      dependsOn: [
        { outputId: curationOutput.id, revision: 1 },
        { outputId: planOutput.id, revision: 2 }, // plano vigente é 1
      ],
    },
  };
  const result1 = applyCaseApprovalCommand(staleDeps, approveCommand);
  assert.equal(result1.ok, false);
  if (result1.ok) return;
  assert.equal(result1.error.code, 'STALE_VERSION');

  // AnswerRefs inconsistentes
  const staleAnswers: CaseApprovalState = {
    ...state,
    cases: {
      ...state.cases!,
      answerRefs: [{ questionId: 'q-1', revision: 1 }],
    },
    plan: {
      ...state.plan!,
      answerRefs: [],
    },
  };
  const result2 = applyCaseApprovalCommand(staleAnswers, approveCommand);
  assert.equal(result2.ok, false);
  if (result2.ok) return;
  assert.equal(result2.error.code, 'STALE_VERSION');
});

test('CA-03: recusa se o plano não estiver aprovado pelo usuário ou não estiver validado', () => {
  const state = validState();
  // Plano sem aprovação humana
  const noPlanApproval: CaseApprovalState = {
    ...state,
    approvals: [],
  };
  const result1 = applyCaseApprovalCommand(noPlanApproval, approveCommand);
  assert.equal(result1.ok, false);
  if (result1.ok) return;
  assert.equal(result1.error.code, 'STALE_VERSION');

  // Plano sem validação aprovada
  const planNotValidated: CaseApprovalState = {
    ...state,
    validations: [
      { outputId: curationOutput.id, outputRevision: curationOutput.revision, validator: 'output-validator', status: 'approved' },
      { outputId: planOutput.id, outputRevision: planOutput.revision, validator: 'output-validator', status: 'changes_requested' },
      { outputId: casesOutput.id, outputRevision: casesOutput.revision, validator: 'output-validator', status: 'approved' },
    ],
  };
  const result2 = applyCaseApprovalCommand(planNotValidated, approveCommand);
  assert.equal(result2.ok, false);
  if (result2.ok) return;
  assert.equal(result2.error.code, 'STALE_VERSION');
});

test('CA-03: parecer dos casos precisa ser approved por output-validator sem status error', () => {
  const state = validState();
  // Sem parecer dos casos
  const noValidation: CaseApprovalState = {
    ...state,
    validations: state.validations.filter(v => v.outputId !== casesOutput.id),
  };
  const r1 = applyCaseApprovalCommand(noValidation, approveCommand);
  assert.equal(r1.ok, false);
  if (!r1.ok) assert.equal(r1.error.code, 'INSUFFICIENT_VALIDATION');

  // Parecer rejeitado
  const rejected: CaseApprovalState = {
    ...state,
    validations: [
      ...state.validations.filter(v => v.outputId !== casesOutput.id),
      { outputId: casesOutput.id, outputRevision: casesOutput.revision, validator: 'output-validator', status: 'changes_requested' },
    ],
  };
  const r2 = applyCaseApprovalCommand(rejected, approveCommand);
  assert.equal(r2.ok, false);
  if (!r2.ok) assert.equal(r2.error.code, 'INSUFFICIENT_VALIDATION');

  // Tentativa técnica com status error não conta como aprovação
  const errorVerdicts: CaseApprovalState = {
    ...state,
    validations: [
      ...state.validations.filter(v => v.outputId !== casesOutput.id),
      { outputId: casesOutput.id, outputRevision: casesOutput.revision, validator: 'output-validator', status: 'error' },
      { outputId: casesOutput.id, outputRevision: casesOutput.revision, validator: 'output-validator', status: 'approved' },
    ],
  };
  // Quando há um error e um approved, verdicts.filter(status !== 'error') tem tamanho 1 approved, o que é válido!
  const r3 = applyCaseApprovalCommand(errorVerdicts, approveCommand);
  assert.equal(r3.ok, true);

  // Mas apenas status: error não é aprovado
  const onlyError: CaseApprovalState = {
    ...state,
    validations: [
      ...state.validations.filter(v => v.outputId !== casesOutput.id),
      { outputId: casesOutput.id, outputRevision: casesOutput.revision, validator: 'output-validator', status: 'error' },
    ],
  };
  const r4 = applyCaseApprovalCommand(onlyError, approveCommand);
  assert.equal(r4.ok, false);
  if (!r4.ok) assert.equal(r4.error.code, 'INSUFFICIENT_VALIDATION');
});

test('CA-04: repetição da mesma decisão pelo mesmo autor retorna estado existente idêntico', () => {
  const state = validState();
  const first = applyCaseApprovalCommand(state, approveCommand);
  assert.equal(first.ok, true);
  if (!first.ok) return;

  // Repetição idêntica
  const repeated = applyCaseApprovalCommand(first.state, {
    ...approveCommand,
    id: 'another-id', // ID ignorado na repetição
    at: '2026-09-24T21:00:00.000Z', // Data ignorada na repetição
  });
  assert.equal(repeated.ok, true);
  if (!repeated.ok) return;
  assert.strictEqual(repeated.state, first.state, 'deve preservar referência do estado sem duplicar');
  assert.equal(repeated.state.approvals.length, 2);
});

test('CA-04: decisão conflitante na mesma revisão retorna DECISION_CONFLICT', () => {
  const state = validState();
  const first = applyCaseApprovalCommand(state, approveCommand);
  assert.equal(first.ok, true);
  if (!first.ok) return;

  // Decisão diferente (changes_requested vs approved)
  const conflict1 = applyCaseApprovalCommand(first.state, changesCommand);
  assert.equal(conflict1.ok, false);
  if (!conflict1.ok) assert.equal(conflict1.error.code, 'DECISION_CONFLICT');

  // Autor diferente
  const conflict2 = applyCaseApprovalCommand(first.state, {
    ...approveCommand,
    actorId: 'another-user',
  });
  assert.equal(conflict2.ok, false);
  if (!conflict2.ok) assert.equal(conflict2.error.code, 'DECISION_CONFLICT');

  // ID de decisão já utilizado em outro registro
  const conflict3 = applyCaseApprovalCommand(state, {
    ...approveCommand,
    id: 'approval-plan-1', // já usado no plano
  });
  assert.equal(conflict3.ok, false);
  if (!conflict3.ok) assert.equal(conflict3.error.code, 'DECISION_CONFLICT');
});

test('CA-05: campos da decisão exigem ID, autor e horário UTC válidos', () => {
  const state = validState();
  for (const invalid of [
    { ...approveCommand, id: '' },
    { ...approveCommand, actorId: '' },
    { ...approveCommand, at: 'not-a-date' },
    { ...approveCommand, at: '2026-09-24 20:00:00' },
  ]) {
    const result = applyCaseApprovalCommand(state, invalid);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, 'INVALID_DECISION');
  }
});
