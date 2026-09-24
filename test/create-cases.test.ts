import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PreparationCoordinator, type PreparationOptions } from '../src/application/prepare-plan.js';
import { createRun } from '../src/application/runs.js';
import { executePlanCommand, getPlanReview } from '../src/application/plan-approval.js';
import { RunStore, StorageError } from '../src/storage/runs.js';
import { readConfig } from '../src/config.js';
import type { SpecialistTask } from '../src/runtime/pi.js';

const text = 'Quantidade inteira de 1 a 10 cria reserva. Fora desse intervalo rejeita sem criar reserva.';
const approved = { status: 'approved', reason: 'Comportamentos e fontes conferidos.', findings: [] };
const changes = { status: 'changes_requested', reason: 'Corrigir expectativa de rejeição.',
  findings: [{ code: 'EXPECTED', location: 'testCases[0].expected', message: 'Rejeitar sem criar reserva.' }] };
const model = { provider: 'mock', model: 'controlled' };
const result = (payload: unknown) => ({ payload, metadata: { ...model, durationMs: 1 } });
function normal(task: SpecialistTask) {
  const input = JSON.parse(task.prompt);
  const sources = [{ artifactId: input.artifacts[0].id, locator: 'L1', quote: text }];
  if (task.role === 'output-validator') return result(approved);
  if (task.role === 'artifact-curator') return result({ requirements: [{ id: 'REQ-1', statement: text,
    sources, rules: [{ id: 'RULE-1', statement: text, sources }] }], questions: [] });
  if (task.task === 'create-test-plan') return result({ testPlan: { objective: 'Conferir reserva.',
    requirementIds: ['REQ-1'], ruleIds: ['RULE-1'], priorities: [{ ruleId: 'RULE-1', reason: 'Conferir limites e rejeição.' }], exclusions: [],
    approach: ['PCE e AVL no domínio inteiro.'], preconditions: [], sources } });
  return result({ testCases: [0, 1, 10, 11].map(value => ({ id: `CASE-${value}`, requirementIds: ['REQ-1'],
    ruleIds: ['RULE-1'], preconditions: [], setup: 'Preparar dados de reserva antes da execução.', pathId: null,
    data: { quantity: value }, techniques: [{ name: 'AVL', description: 'Limites inclusivos 1 e 10; vizinhos inteiros 0 e 11.', values: [value] }],
    expected: value > 0 && value < 11 ? 'Criar reserva.' : 'Rejeitar sem criar reserva.', sources })) });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
async function setup(t: TestContext, options: PreparationOptions = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'akcit-cases-'));
  t.after(() => rm(dir, { force: true, recursive: true }));
  const store = new RunStore(dir); await store.initialize();
  const calls: SpecialistTask[] = [];
  const coordinator = new PreparationCoordinator(store, readConfig({ DATA_DIR: dir,
    PI_PROVIDER: model.provider, PI_MODEL: model.model }), { ...options, modelPreflight: options.modelPreflight ?? (async () => {}),
    modelCall: async task => { calls.push(task); return options.modelCall ? options.modelCall(task) : normal(task); } });
  const create = async () => (await createRun(store, { name: 'Casos controlados', applicationName: 'Reservas', text },
    [randomUUID()], { userId: 'owner' })).run.id;
  const id = await create();
  const read = async () => (await store.read(id)).run;
  await coordinator.start(id, 'owner'); await coordinator.settled();
  const plan = (await read()).outputs.find(output => output.phase === 'planning')!;
  assert.ok(plan);
  const reference = { outputId: plan.id, outputRevision: plan.revision };
  const approve = await executePlanCommand(store, id, { type: 'approve_plan', ...reference }, { userId: 'owner' });
  assert.ok(approve.ok);
  return { dir, store, coordinator, calls, id, create, read, reference };
}

test('T6.1: caminho completo preserva plano, contexto completo e intenção concluída, sem aprovação dos casos', async t => {
  const h = await setup(t, { modelCall: async task => {
    const input = JSON.parse(task.prompt);
    if (input.task === 'case_design' || input.output?.phase === 'case_design') {
      assert.equal(input.approvedPlan.phase, 'planning'); assert.equal(input.approvedCuration.phase, 'curation');
      assert.equal(input.planApproval.decision, 'approved'); assert.equal(input.artifacts[0].text, text);
      assert.deepEqual(input.answers, []);
      if (task.role === 'output-validator') assert.deepEqual(input.output, (await h.read()).outputs.at(-1));
    }
    return normal(task);
  } });
  const before = await h.read();
  const ready = await getPlanReview(h.store, h.id, { userId: 'owner' });
  assert.ok(ready.ok); assert.equal(ready.review.canCreateCases, true);
  assert.deepEqual(await h.coordinator.continue(h.id, 'owner', h.reference), { accepted: true });
  await h.coordinator.settled();
  const record = await h.store.read(h.id), run = record.run, cases = run.outputs.at(-1)!;
  assert.equal(run.status, 'awaiting_approval'); assert.equal(run.phase, 'case_design');
  assert.equal(cases.producer, 'test-designer'); assert.equal(cases.revision, 1); assert.deepEqual(cases.answerRefs, []);
  assert.deepEqual(cases.dependsOn, before.outputs.map(output => ({ outputId: output.id, revision: output.revision })));
  assert.deepEqual(run.outputs.slice(0, 2), before.outputs); assert.deepEqual(run.approvals, before.approvals);
  assert.equal(run.budgetCycles.length, before.budgetCycles.length);
  assert.equal(record.workIntents.length, 1); assert.equal(record.workIntents[0]!.status, 'completed');
  assert.ok(record.workIntents[0]!.finishedAt);
  assert.deepEqual(h.calls.slice(4).map(task => task.task), ['create-test-cases', 'validate-output']);
  const review = await getPlanReview(h.store, h.id, { userId: 'owner' });
  assert.ok(review.ok); assert.equal(review.review.cases!.current, true); assert.equal(review.review.canCreateCases, false);
  assert.equal(review.review.cases!.validations[0]!.reason, approved.reason);
  assert.equal(review.review.cases!.payload.testCases.length, 4);
  assert.deepEqual(await h.coordinator.continue(h.id, 'owner', h.reference), { accepted: false });
  assert.equal(h.calls.length, 6);
});

test('T6.1: correção preserva ID da saída e dos casos, cria revisão e usa parecer exato', async t => {
  let validations = 0;
  const h = await setup(t, { modelCall: async task => {
    const input = JSON.parse(task.prompt);
    if (input.output?.phase === 'case_design') {
      if (++validations === 1) return result(changes);
      assert.equal(input.previousOutput.revision, 1);
      assert.equal(input.previousOutput.id, input.output.id);
      assert.equal(input.previousVerdicts[0].status, 'changes_requested');
    }
    if (task.task === 'create-test-cases' && input.previousOutput) {
      assert.equal(input.previousOutput.revision, 1); assert.deepEqual(input.feedback, changes);
    }
    return normal(task);
  } });
  await h.coordinator.continue(h.id, 'owner', h.reference); await h.coordinator.settled();
  const run = await h.read(), outputs = run.outputs.filter(output => output.phase === 'case_design');
  assert.equal(run.status, 'awaiting_approval'); assert.deepEqual(outputs.map(output => output.revision), [1, 2]);
  assert.equal(outputs[0]!.id, outputs[1]!.id); assert.deepEqual(outputs[0]!.payload, outputs[1]!.payload);
  assert.deepEqual(run.validations.slice(2).map(verdict => [verdict.outputRevision, verdict.status]), [[1, 'changes_requested'], [2, 'approved']]);
});

for (const mode of ['blocked', 'changes_requested', 'invalid_verdict', 'invalid_cases', 'excess'] as const) {
  test(`T6.1: ${mode} interrompe, encerra intenção e respeita limites`, async t => {
    const h = await setup(t, { modelCall: async task => {
      const input = JSON.parse(task.prompt);
      if (task.task === 'create-test-cases') {
        if (mode === 'invalid_cases') return result({ invented: true });
        if (mode === 'excess') {
          const first = (normal(task).payload as any).testCases[0];
          return result({ testCases: Array.from({ length: 40 }, (_, index) => ({ ...first, id: `CASE-${index}` })) });
        }
      }
      if (input.output?.phase === 'case_design') {
        if (mode === 'invalid_verdict') return result({ status: 'not_a_verdict' });
        if (mode === 'blocked' || mode === 'changes_requested') return result({ ...changes, status: mode });
      }
      return normal(task);
    } });
    await h.coordinator.continue(h.id, 'owner', h.reference); await h.coordinator.settled();
    const record = await h.store.read(h.id), run = record.run;
    const expected = { blocked: 'VALIDATION_BLOCKED', changes_requested: 'REVISION_LIMIT', invalid_verdict: 'VALIDATOR_LIMIT',
      invalid_cases: 'REVISION_LIMIT', excess: 'CASE_LIMIT' }[mode];
    assert.equal(run.status, 'interrupted'); assert.equal(run.preparation!.stopReason!.code, expected);
    assert.equal(record.workIntents[0]!.status, 'interrupted'); assert.equal(record.workIntents[0]!.reason!.code, expected);
    assert.equal(h.calls.filter(task => task.task === 'create-test-cases').length, ['changes_requested', 'invalid_cases'].includes(mode) ? 3 : 1);
    if (mode === 'invalid_verdict') assert.deepEqual(run.validations.slice(2).map(verdict => verdict.status), ['error', 'error']);
    if (mode === 'excess') assert.equal(run.outputs.filter(output => output.phase === 'case_design').length, 0);
  });
}

test('T6.1: concorrência repete o processamento, ambiente ocupado preserva plano para nova tentativa', async t => {
  const entered = deferred<void>(), release = deferred<void>();
  const h = await setup(t, { modelCall: async task => {
    if (task.task === 'create-test-cases') { entered.resolve(); await release.promise; }
    return normal(task);
  } });
  const second = await h.create();
  await h.coordinator.start(second, 'owner'); await h.coordinator.settled();
  const secondPlan = (await h.store.read(second)).run.outputs.at(-1)!;
  const secondRef = { outputId: secondPlan.id, outputRevision: secondPlan.revision };
  assert.ok((await executePlanCommand(h.store, second, { type: 'approve_plan', ...secondRef }, { userId: 'owner' })).ok);
  const original = await h.store.read(second);
  assert.deepEqual(await Promise.all([h.coordinator.continue(h.id, 'owner', h.reference),
    h.coordinator.continue(h.id, 'owner', h.reference)]), [{ accepted: true }, { accepted: false }]);
  await entered.promise;
  await assert.rejects(h.coordinator.continue(second, 'owner', secondRef), { code: 'RESOURCE_UNAVAILABLE' });
  assert.deepEqual(await h.store.read(second), original);
  release.resolve(); await h.coordinator.settled();
  assert.equal((await h.store.read(h.id)).workIntents.length, 1);
  await h.coordinator.continue(second, 'owner', secondRef); await h.coordinator.settled();
  assert.equal((await h.store.read(second)).run.phase, 'case_design');
});

for (const during of ['production', 'validation'] as const) {
  test(`T6.1: cancelamento durante ${during} aborta e resposta tardia não publica nem restaura execução`, async t => {
    const entered = deferred<SpecialistTask>(), release = deferred<void>();
    const h = await setup(t, { modelCall: async task => {
      const input = JSON.parse(task.prompt);
      if (during === 'production' ? task.task === 'create-test-cases' : input.output?.phase === 'case_design') {
        entered.resolve(task); await release.promise;
      }
      return normal(task);
    } });
    await h.coordinator.continue(h.id, 'owner', h.reference);
    const task = await entered.promise;
    await h.coordinator.cancel(h.id, 'owner'); assert.equal(task.signal.aborted, true);
    release.resolve(); await h.coordinator.settled();
    const record = await h.store.read(h.id);
    assert.equal(record.run.status, 'cancelled'); assert.equal(record.workIntents[0]!.status, 'cancelled');
    assert.equal(record.run.outputs.filter(output => output.phase === 'case_design').length, during === 'production' ? 0 : 1);
    assert.equal(record.run.validations.length, 2);
    assert.deepEqual(await h.coordinator.continue(h.id, 'owner', h.reference), { accepted: false });
  });
}

test('T6.1: espera humana não conta, consumo anterior permanece e orçamento esgotado recusa sem gravar', async t => {
  let now = Date.now();
  const h = await setup(t, { now: () => now, limits: { activeMs: 1000 }, modelCall: async task => { now += 100; return normal(task); } });
  assert.equal((await h.read()).preparation!.accumulatedActiveMs, 400);
  now += 86_400_000;
  await h.coordinator.continue(h.id, 'owner', h.reference); await h.coordinator.settled();
  assert.equal((await h.read()).preparation!.accumulatedActiveMs, 600);
  const exhausted = await setup(t);
  await exhausted.store.update(exhausted.id, ({ run }) => {
    run.preparation!.accumulatedActiveMs = run.preparation!.limits.activeMs;
    return { save: true, value: undefined };
  });
  const before = await exhausted.store.read(exhausted.id);
  await assert.rejects(exhausted.coordinator.continue(exhausted.id, 'owner', exhausted.reference), { code: 'ACTIVE_LIMIT' });
  assert.deepEqual(await exhausted.store.read(exhausted.id), before); assert.equal(exhausted.calls.length, 4);
});

for (const defect of ['new_curation', 'no_approval', 'changes_requested', 'missing_original', 'new_answer'] as const) {
  test(`T6.1: ${defect} recusa antes de inferência e preserva registro`, async t => {
    const h = await setup(t);
    await h.store.update(h.id, ({ run }) => {
      if (defect === 'new_curation') run.outputs.push({ ...run.outputs[0]!, revision: 2 });
      if (defect === 'no_approval') run.approvals = [];
      if (defect === 'changes_requested') run.approvals = run.approvals.map(decision => ({ ...decision, decision: 'changes_requested', comment: 'Rever escopo.' }));
      if (defect === 'missing_original') run.artifacts = [];
      if (defect === 'new_answer') {
        const curation = run.outputs[0]!;
        run.answerArtifacts = [{ id: 'answer-artifact', name: 'answer.txt', version: '1', text: 'Nova regra.' }];
        run.answers = [{ id: 'answer', questionId: 'Q-1', revision: 1, outputId: curation.id, outputRevision: curation.revision,
          text: 'Nova regra.', artifactId: 'answer-artifact', actorId: 'owner', at: new Date().toISOString() }];
      }
      return { save: true, value: undefined };
    });
    const before = await h.store.read(h.id);
    await assert.rejects(h.coordinator.continue(h.id, 'owner', h.reference));
    assert.deepEqual(await h.store.read(h.id), before); assert.equal(h.calls.length, 4);
  });
}

for (const during of ['production', 'validation'] as const) {
  test(`T6.1: dependência alterada durante ${during} impede publicação`, async t => {
    const h = await setup(t, { modelCall: async task => {
      const input = JSON.parse(task.prompt);
      if (during === 'production' ? task.task === 'create-test-cases' : input.output?.phase === 'case_design') {
        await h.store.update(h.id, ({ run }) => {
          run.outputs.push({ ...run.outputs[0]!, revision: 2 }); return { save: true, value: undefined };
        });
      }
      return normal(task);
    } });
    await h.coordinator.continue(h.id, 'owner', h.reference); await h.coordinator.settled();
    const run = await h.read(); assert.equal(run.status, 'interrupted'); assert.equal(run.preparation!.stopReason!.code, 'STALE_VERSION');
    assert.equal(run.validations.length, 2);
    const review = await getPlanReview(h.store, h.id, { userId: 'owner' }); assert.ok(review.ok);
    if (during === 'validation') assert.equal(review.review.cases!.current, false);
  });
}

test('T6.1: reinício preserva casos provisórios, encerra intenção e impede resposta tardia', async t => {
  const entered = deferred<void>(), release = deferred<void>();
  const h = await setup(t, { modelCall: async task => {
    if (JSON.parse(task.prompt).output?.phase === 'case_design') { entered.resolve(); await release.promise; }
    return normal(task);
  } });
  await h.coordinator.continue(h.id, 'owner', h.reference); await entered.promise;
  assert.equal(await new RunStore(h.dir).recoverInterrupted(), 1);
  const recovered = await h.store.read(h.id);
  release.resolve(); await h.coordinator.settled();
  assert.deepEqual(await h.store.read(h.id), recovered);
  assert.equal(recovered.workIntents[0]!.status, 'interrupted'); assert.equal(recovered.run.outputs.at(-1)!.phase, 'case_design');
  assert.equal(recovered.run.validations.length, 2);
  assert.deepEqual(await h.coordinator.continue(h.id, 'owner', h.reference), { accepted: false });
});

test('T6.1: falha após gravação do aceite interrompe intenção sem deixar running órfão', async t => {
  const h = await setup(t), update = h.store.update.bind(h.store);
  let injected = false;
  t.mock.method(h.store, 'update', async (...args: Parameters<typeof h.store.update>) => {
    const value = await update(...args);
    if (!injected && (await h.read()).phase === 'case_design') { injected = true; throw new StorageError('STORAGE_FAILURE'); }
    return value;
  });
  await assert.rejects(h.coordinator.continue(h.id, 'owner', h.reference), { code: 'STORAGE_FAILURE' });
  const record = await h.store.read(h.id);
  assert.equal(record.run.status, 'interrupted'); assert.equal(record.workIntents[0]!.status, 'interrupted');
  assert.equal(h.calls.length, 4);
});
