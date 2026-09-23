import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  applyPlanApprovalCommand,
  type PlanApprovalCommand,
  type PlanApprovalErrorCode,
  type PlanApprovalState,
  type PlanDecision,
} from '../src/domain/plan-approval.js';

// Pareceres e saídas da fixture são sintéticos; nenhum modelo ou agente é chamado.
const fixture = JSON.parse(readFileSync(new URL(
  '../docs/requisitos/exemplos/execucao-demo.json', import.meta.url,
), 'utf8')) as {
  fixture: boolean;
  run: {
    outputs: (NonNullable<PlanApprovalState['plan']> & { phase: string })[];
    validations: PlanApprovalState['validations'];
  };
};
assert.equal(fixture.fixture, true);
const plan = fixture.run.outputs.find(output => output.phase === 'planning');
const curation = fixture.run.outputs.find(output => output.phase === 'curation');
assert.ok(plan);
assert.ok(curation);

function waiting(): PlanApprovalState {
  return structuredClone({
    status: 'awaiting_approval', phase: 'planning',
    plan: { id: plan!.id, revision: plan!.revision, dependsOn: plan!.dependsOn },
    curation: { id: curation!.id, revision: curation!.revision },
    validations: fixture.run.validations.filter(validation =>
      validation.outputId === plan!.id || validation.outputId === curation!.id),
    approvals: [],
  });
}

const reference = { outputId: plan.id, outputRevision: plan.revision };
const approve = {
  type: 'approve_plan', ...reference, id: 'approval-plan-test',
  actorId: 'user-demo', at: '2026-09-23T19:40:00Z',
} as const satisfies PlanApprovalCommand;
const requestChanges = {
  ...approve, type: 'request_plan_changes', comment: 'Reavaliar a regra de quantidade e seu impacto na curadoria.',
} as const satisfies PlanApprovalCommand;
const proceed = {
  type: 'continue', ...reference, resourceReserved: true,
} as const satisfies PlanApprovalCommand;
const commands = [approve, requestChanges, proceed];

function freeze(value: unknown): void {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
}

function apply(state: PlanApprovalState, command: PlanApprovalCommand) {
  const beforeState = structuredClone(state);
  const beforeCommand = structuredClone(command);
  freeze(state);
  freeze(command);
  const result = applyPlanApprovalCommand(state, command);
  assert.deepEqual(state, beforeState, 'estado de entrada deve permanecer intacto');
  assert.deepEqual(command, beforeCommand, 'comando de entrada deve permanecer intacto');
  if (!result.ok) {
    assert.strictEqual(result.state, state, 'recusa preserva a referência do estado');
    assert.equal(result.work, null, 'recusa não deve gerar trabalho');
    assert.ok(result.error.message.trim(), 'recusa deve explicar o motivo');
  }
  return result;
}

function success(state: PlanApprovalState, command: PlanApprovalCommand) {
  const result = apply(state, command);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.ok(result.ok);
  return result;
}

function refusal(state: PlanApprovalState, command: PlanApprovalCommand, code: PlanApprovalErrorCode) {
  const result = apply(state, command);
  assert.equal(result.ok, false);
  assert.ok(!result.ok);
  assert.equal(result.error.code, code);
  return result;
}

function decided(command: typeof approve | typeof requestChanges = approve) {
  return success(waiting(), command).state;
}

test('CA-01: aprovar registra autor, horário e versão, mantendo a espera sem trabalho', () => {
  const state = waiting();
  const result = success(state, approve);
  assert.equal(result.state.phase, 'planning');
  assert.equal(result.state.status, 'awaiting_approval');
  assert.equal(result.work, null);
  assert.deepEqual(result.state.approvals, [{
    id: approve.id, ...reference, actorId: approve.actorId, at: approve.at,
    decision: 'approved', comment: '',
  }]);
  assert.deepEqual(state.approvals, []);
});

test('CA-02/03: ocupado preserva aprovação; reserva permite criar casos uma única vez', () => {
  const state = decided();
  const busy = refusal(state, { ...proceed, resourceReserved: false }, 'RESOURCE_UNAVAILABLE');
  assert.match(busy.error.message, /ocupado|indisponível/i);
  assert.equal(busy.state.status, 'awaiting_approval');
  assert.equal(busy.state.phase, 'planning');
  assert.deepEqual(busy.state.approvals, state.approvals);
  const result = success(busy.state, proceed);
  assert.equal(result.state.status, 'running');
  assert.equal(result.state.phase, 'case_design');
  assert.deepEqual(result.work, { type: 'create_cases', ...reference });
  assert.deepEqual(result.state.approvals, state.approvals);
  refusal(result.state, proceed, 'INVALID_STATE');
});

test('CA-04: pedido registrado aguarda reserva e encaminha análise sem criar casos', () => {
  const result = success(waiting(), requestChanges);
  assert.equal(result.work, null);
  assert.equal(result.state.status, 'awaiting_approval');
  assert.equal(result.state.phase, 'planning');
  assert.deepEqual(result.state.approvals, [{
    id: requestChanges.id, ...reference, actorId: requestChanges.actorId,
    at: requestChanges.at, decision: 'changes_requested', comment: requestChanges.comment,
  }]);
  const busy = refusal(result.state, { ...proceed, resourceReserved: false }, 'RESOURCE_UNAVAILABLE');
  const continued = success(busy.state, proceed);
  assert.equal(continued.state.status, 'running');
  assert.equal(continued.state.phase, 'planning');
  assert.deepEqual(continued.work, { type: 'analyze_feedback', ...reference });
  refusal(continued.state, proceed, 'INVALID_STATE');
});

test('CA-04: pedido exige comentário com conteúdo', () => {
  for (const comment of [undefined, '', '  ', '\n\t']) {
    const command = { ...requestChanges, comment } as PlanApprovalCommand;
    refusal(waiting(), command, 'COMMENT_REQUIRED');
  }
});

test('CA-05: os três comandos exigem referência exata e revisão inteira positiva', () => {
  for (const command of commands) {
    for (const outputId of ['', 'out-inexistente', curation.id]) {
      refusal(decided(), { ...command, outputId }, 'STALE_VERSION');
    }
    for (const outputRevision of [0, -1, 0.5, 2, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      refusal(decided(), { ...command, outputRevision }, 'STALE_VERSION');
    }
  }
});

test('CA-05: nenhum comando aceita plano ou curadoria inexistente/inválido ou dependência obsoleta', () => {
  const state = decided();
  const invalidStates: PlanApprovalState[] = [
    { ...state, plan: null },
    { ...state, curation: null },
    { ...state, plan: { ...state.plan!, id: '' } },
    { ...state, curation: { ...state.curation!, id: '' } },
    { ...state, curation: { ...state.curation!, id: plan.id } },
    { ...state, plan: { ...state.plan!, revision: 0 } },
    { ...state, curation: { ...state.curation!, revision: 0.5 } },
    { ...state, curation: { ...state.curation!, revision: 2 } },
    { ...state, curation: { ...state.curation!, id: 'out-outra-curadoria' } },
    ...[
      [], [{ outputId: curation.id, revision: 0 }],
      [{ outputId: curation.id, revision: 2 }],
      [{ outputId: 'out-inexistente', revision: 1 }],
      [...state.plan!.dependsOn, ...state.plan!.dependsOn],
    ].map(dependsOn => ({ ...state, plan: { ...state.plan!, dependsOn } })),
  ];
  for (const invalidState of invalidStates) {
    for (const command of commands) refusal(invalidState, command, 'STALE_VERSION');
  }
});

test('CA-05: parecer de plano e curadoria deve aprovar a mesma revisão por output-validator', () => {
  const state = decided();
  for (const outputId of [plan.id, curation.id]) {
    const verdict = state.validations.find(item => item.outputId === outputId)!;
    const others = state.validations.filter(item => item.outputId !== outputId);
    const invalidVerdicts = [
      [], [{ ...verdict, validator: 'test-designer' }],
      [{ ...verdict, outputId: 'out-inexistente' }],
      [{ ...verdict, outputRevision: 2 }],
      ...(['changes_requested', 'blocked', 'error'] as const).map(status => [{ ...verdict, status }]),
      [verdict, { ...verdict }],
      [verdict, { ...verdict, status: 'blocked' as const }],
    ];
    for (const replacements of invalidVerdicts) {
      const invalidState = { ...state, validations: [...others, ...replacements] };
      for (const command of commands) refusal(invalidState, command, 'INSUFFICIENT_VALIDATION');
    }
  }
});

test('CA-05: erros técnicos históricos não invalidam um único parecer aprovado da revisão', () => {
  const state = waiting();
  const validations = state.validations.flatMap(verdict => [
    { ...verdict, status: 'error' as const }, verdict,
  ]);
  const approved = success({ ...state, validations }, approve);
  assert.equal(success(approved.state, proceed).work?.type, 'create_cases');
});

test('CA-05: nova revisão preserva decisões anteriores mas exige novo parecer e nova decisão', () => {
  const previous = decided();
  const revision2 = { ...previous, plan: { ...previous.plan!, revision: 2 } };
  const continue2 = { ...proceed, outputRevision: 2 };
  for (const command of commands) refusal(revision2, command, 'STALE_VERSION');
  refusal(revision2, continue2, 'INSUFFICIENT_VALIDATION');
  refusal(revision2, { ...approve, outputRevision: 2 }, 'INSUFFICIENT_VALIDATION');
  const validated = { ...revision2, validations: [
    ...revision2.validations,
    { ...reference, outputRevision: 2, validator: 'output-validator', status: 'approved' as const },
  ] };
  refusal(validated, continue2, 'DECISION_MISSING');
  const approved = success(validated, { ...approve, id: 'approval-plan-v2', outputRevision: 2 });
  assert.equal(approved.state.approvals.length, 2);
  assert.deepEqual(approved.state.approvals[0], previous.approvals[0]);
  assert.deepEqual(success(approved.state, continue2).work, {
    type: 'create_cases', outputId: reference.outputId, outputRevision: 2,
  });
});

test('CA-06: repetir decisão idêntica ignora novo id/horário e preserva o registro original', () => {
  for (const command of [approve, requestChanges]) {
    const state = decided(command);
    const result = success(state, { ...command, id: 'retry-id', at: '2026-09-24T10:00:00Z' });
    assert.strictEqual(result.state, state);
    assert.equal(result.state.approvals.length, 1);
    assert.equal(result.state.approvals[0]?.at, command.at);
    assert.equal(result.work, null);
  }
});

test('CA-06: decisão, autor ou comentário diferente conflitam sem edição retroativa', () => {
  for (const command of [approve, requestChanges]) {
    const state = decided(command);
    const otherDecision = command.type === 'approve_plan' ? requestChanges : approve;
    for (const conflicting of [
      otherDecision, { ...command, actorId: 'other-user' }, { ...command, comment: 'Outro conteúdo' },
    ]) refusal(state, conflicting, 'DECISION_CONFLICT');
  }
});

test('CA-06: decisões duplicadas na revisão ou id reutilizado no histórico são conflitos', () => {
  const state = decided();
  const duplicate = { ...state, approvals: [...state.approvals, ...state.approvals] };
  for (const command of commands) refusal(duplicate, command, 'DECISION_CONFLICT');
  const history = { ...waiting(), approvals: [{ ...state.approvals[0]!, outputId: 'out-antigo' }] };
  refusal(history, approve, 'DECISION_CONFLICT');
});

test('continuidade exige decisão humana válida da mesma saída/revisão', () => {
  refusal(waiting(), proceed, 'DECISION_MISSING');
  const state = decided();
  const decision = state.approvals[0]!;
  const invalidDecisions = [
    { ...decision, outputId: 'out-outro-plano' }, { ...decision, outputRevision: 2 },
    { ...decision, actorId: '' }, { ...decision, at: 'inválido' },
    { ...decision, id: '' }, { ...decision, decision: 'changes_requested', comment: '  ' },
    { ...decision, decision: 'unknown' },
  ] as PlanDecision[];
  for (const invalid of invalidDecisions) {
    refusal({ ...state, approvals: [invalid] }, proceed, 'DECISION_MISSING');
  }
});

test('decisões exigem id, autor e horário UTC válidos', () => {
  for (const command of [approve, requestChanges]) {
    for (const field of ['id', 'actorId', 'at'] as const) {
      for (const value of [undefined, '', ' \t']) {
        refusal(waiting(), { ...command, [field]: value } as PlanApprovalCommand, 'INVALID_DECISION');
      }
    }
    for (const at of ['invalidZ', '2026-09-23T19:40:00', '2026-13-23T19:40:00Z', '2026-02-30T10:00:00Z']) {
      refusal(waiting(), { ...command, at }, 'INVALID_DECISION');
    }
    const at = '2026-09-23T19:40:00.123Z';
    assert.equal(success(waiting(), { ...command, at }).state.approvals[0]?.at, at);
  }
});

test('CA-07: comandos não reabrem estados encerrados/interrompidos e só operam na aprovação do plano', () => {
  const state = decided();
  for (const status of ['cancelled', 'completed', 'interrupted', 'error', 'running', 'draft', 'awaiting_input']) {
    for (const command of commands) refusal({ ...state, status }, command, 'INVALID_STATE');
  }
  for (const phase of ['curation', 'case_design', 'mapping', 'execution', 'report']) {
    for (const command of commands) refusal({ ...state, phase }, command, 'INVALID_STATE');
  }
  refusal(state, { ...proceed, type: 'unknown' } as unknown as PlanApprovalCommand, 'INVALID_STATE');
});

test('CA-07: resultados são determinísticos e preservam entradas congeladas profundamente', () => {
  const state = waiting();
  const first = success(state, approve);
  assert.deepEqual(success(state, approve), first);
  const continued = success(first.state, proceed);
  assert.deepEqual(success(first.state, proceed), continued);
  assert.deepEqual(state, waiting());
});
