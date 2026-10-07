import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { PreparationCoordinator, type PreparationOptions } from '../src/application/prepare-plan.js';
import { createRun } from '../src/application/runs.js';
import { executePlanCommand, getPlanReview } from '../src/application/plan-approval.js';
import { eligibleRequirements } from '../src/domain/preparation.js';
import { RunStore } from '../src/storage/runs.js';
import { readConfig } from '../src/config.js';
import { AuthService } from '../src/auth.js';
import { handleApi } from '../src/http/api.js';
import type { SpecialistTask } from '../src/runtime/pi.js';

const text = 'RF-01: Reservar itens.\nCA-01: Quantidade de 1 a 10.\nCA-02: Comentário.';
const model = { provider: 'test-provider', model: 'test-model' };
const accepted = { status: 'approved', reason: 'Conteúdo equivalente às fontes.', findings: [] };
const result = (payload: unknown) => ({ payload, metadata: { ...model, durationMs: 1 } });
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
};
function normal(task: SpecialistTask) {
  const input = JSON.parse(task.prompt);
  const original = input.artifacts[0];
  const source = { artifactId: original.id, locator: 'L1-L3', quote: original.text };
  const answer = input.answers?.at(-1);
  const answerSource = answer ? { artifactId: answer.artifactId, locator: 'L1', quote: answer.text } : source;
  if (task.role === 'artifact-curator') return result({ requirements: [{ id: 'RF-01', statement: 'Reservar itens.',
    sources: [source], rules: [
      { id: 'CA-01', statement: 'Quantidade de 1 a 10.', sources: [source] },
      { id: 'CA-02', statement: answer ? answer.text : 'Comentário.', sources: [answerSource] },
    ] }], questions: answer ? [] : [{ id: 'Q-01', description: 'O comentário é opcional?',
      requirementIds: ['RF-01'], ruleIds: ['CA-02'], caseIds: [], blocking: true, sources: [source] }] });
  if (task.role === 'test-designer') {
    const eligible = eligibleRequirements(input.approvedCuration.payload);
    const ruleIds = eligible.flatMap(requirement => requirement.rules.map(rule => rule.id));
    return result({ testPlan: { objective: 'Verificar reserva.', requirementIds: eligible.map(item => item.id), ruleIds,
      priorities: ruleIds.map(ruleId => ({ ruleId, reason: 'Comportamento definido.' })), exclusions: [],
      approach: ['Verificar os comportamentos documentados.'], preconditions: [], sources: [source] } });
  }
  return result(accepted);
}
async function setup(t: TestContext, custom: PreparationOptions = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'akcit-answers-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new RunStore(dir); await store.initialize();
  const config = readConfig({ DATA_DIR: dir, PI_PROVIDER: model.provider, PI_MODEL: model.model,
    APP_ORIGIN: 'http://localhost:3000' });
  const calls: SpecialistTask[] = [];
  const coordinator = new PreparationCoordinator(store, config, { modelPreflight: async () => {}, ...custom,
    modelCall: async task => { calls.push(task); return custom.modelCall ? custom.modelCall(task) : normal(task); } });
  const owner = randomUUID();
  const create = async () => (await createRun(store, { name: 'Preparação', applicationName: 'Alvo', text }, [randomUUID()], { userId: owner })).run.id;
  const id = await create();
  const read = async () => (await store.read(id)).run;
  const start = async () => { await coordinator.start(id, owner); await coordinator.settled(); };
  const answer = async (value = 'Comentário opcional.') => {
    const run = await read(); const curation = run.outputs.filter(output => output.phase === 'curation').at(-1)!;
    return { outputId: curation.id, outputRevision: curation.revision, questionId: 'Q-01', text: value };
  };
  return { dir, store, config, coordinator, calls, owner, id, create, read, start, answer };
}

test('resposta preserva fontes e aprovação histórica, invalida gate antes de retomar e gera novas revisões', async t => {
  const h = await setup(t); await h.start();
  const before = await h.read();
  const oldPlan = before.outputs.find(output => output.phase === 'planning')!;
  assert.deepEqual(oldPlan.payload.testPlan && (oldPlan.payload.testPlan as any).ruleIds, ['CA-01']);
  const approved = await executePlanCommand(h.store, h.id, { type: 'approve_plan', outputId: oldPlan.id, outputRevision: 1 }, { userId: h.owner });
  assert.equal(approved.ok, true);
  const request = await h.answer('  Comentário opcional.  ');
  await h.coordinator.answer(h.id, h.owner, request);
  const saved = await h.read();
  assert.deepEqual(saved.artifacts, before.artifacts); assert.deepEqual(saved.input, before.input);
  assert.equal(saved.answers[0]!.text, request.text); assert.equal(saved.answerArtifacts![0]!.text, request.text);
  assert.equal(saved.approvals.length, 1); assert.equal(saved.status, 'awaiting_input'); assert.equal(saved.phase, 'curation');
  assert.equal(h.calls.length, 4); assert.equal(saved.budgetCycles.length, 1);
  const refusal = await executePlanCommand(h.store, h.id, { type: 'approve_plan', outputId: oldPlan.id, outputRevision: 1 }, { userId: h.owner });
  assert.equal(refusal.ok, false);
  const projection = await getPlanReview(h.store, h.id, { userId: h.owner }); assert.ok(projection.ok);
  assert.equal(projection.review.canResume, true); assert.equal(projection.review.questions[0]!.answerId, saved.answers[0]!.id);
  assert.equal(projection.review.questions[0]!.outputRevision, 1);
  assert.deepEqual(projection.review.questions[0]!.ruleIds, ['CA-02']);
  assert.deepEqual(await h.coordinator.resume(h.id, h.owner), { accepted: true }); await h.coordinator.settled();
  const after = await h.read();
  assert.equal(after.status, 'awaiting_approval'); assert.equal(after.outputs.length, 4);
  assert.equal(after.outputs[2]!.id, before.outputs[0]!.id); assert.equal(after.outputs[2]!.revision, 2);
  assert.equal(after.outputs[3]!.id, oldPlan.id); assert.equal(after.outputs[3]!.revision, 2);
  assert.deepEqual(after.outputs[3]!.dependsOn, [{ outputId: after.outputs[2]!.id, revision: 2 }]);
  assert.equal(after.outputs[2]!.answerRefs![0]!.answerId, saved.answers[0]!.id);
  assert.equal(after.budgetCycles[1]!.reason, 'user_answer'); assert.deepEqual(after.budgetCycles[1]!.answerRefs, [saved.answers[0]!.id]);
  assert.equal(after.preparation!.calls.length, 8); assert.equal(after.approvals.length, 1);
  for (const call of h.calls.slice(4)) {
    const input = JSON.parse(call.prompt);
    assert.equal(input.artifacts[0].text, text); assert.equal(input.artifacts[1].text, request.text);
    assert.equal(input.answers[0].question.description, 'O comentário é opcional?');
    assert.equal(input.answers[0].outputRevision, 1);
  }
  const current = await getPlanReview(h.store, h.id, { userId: h.owner }); assert.ok(current.ok);
  assert.equal(current.review.canResume, false); assert.equal(current.review.curation!.revision, 2);
  await assert.rejects(h.coordinator.resume(h.id, h.owner), { code: 'INVALID_STATE' });
});

test('resposta atômica é idempotente; correção versionada, referência velha, usuário alheio e corpo inválido preservam histórico', async t => {
  const h = await setup(t); await h.start(); const request = await h.answer();
  const unchanged = await h.read();
  await assert.rejects(h.coordinator.answer(h.id, 'other', request), { code: 'RUN_NOT_FOUND' });
  await assert.rejects(h.coordinator.answer(h.id, h.owner, { ...request, outputRevision: 9 }), { code: 'STALE_VERSION' });
  await assert.rejects(h.coordinator.answer(h.id, h.owner, { ...request, questionId: 'absent' }), { code: 'QUESTION_NOT_FOUND' });
  for (const value of ['', '   ', 'a'.repeat(4001)]) await assert.rejects(h.coordinator.answer(h.id, h.owner, { ...request, text: value }), { code: 'INVALID_INPUT' });
  assert.deepEqual(await h.read(), unchanged);
  await Promise.all([h.coordinator.answer(h.id, h.owner, request), h.coordinator.answer(h.id, h.owner, request)]);
  const saved = await h.read(); assert.equal(saved.answers.length, 1); assert.equal(saved.answerArtifacts!.length, 1);
  await h.coordinator.answer(h.id, h.owner, { ...request, text: 'Outro conteúdo.', expectedAnswerRevision: 1 });
  const revised = await h.read();
  assert.equal(revised.answers.length, 2); assert.equal(revised.answers[1]!.revision, 2);
  assert.deepEqual(revised.answers[0], saved.answers[0]);
  assert.equal(revised.answerArtifacts!.length, 2);
  await h.coordinator.resume(h.id, h.owner); await h.coordinator.settled();
  await assert.rejects(h.coordinator.answer(h.id, h.owner, request), { code: 'STALE_VERSION' });
});

test('reserva e preflight recusados preservam resposta pendente; resume concorrente dispara um trabalho', async t => {
  const entered = deferred(), release = deferred(); let slow = false, configured = true;
  const h = await setup(t, { modelPreflight: async () => { if (!configured) throw new Error('unavailable'); },
    modelCall: async task => { if (slow) { entered.resolve(); await release.promise; } return normal(task); } });
  await h.start(); await h.coordinator.answer(h.id, h.owner, await h.answer());
  const pending = await h.read(); configured = false;
  await assert.rejects(h.coordinator.resume(h.id, h.owner), { code: 'MODEL_UNAVAILABLE' });
  assert.deepEqual(await h.read(), pending); configured = true; slow = true;
  const other = await h.create(); await h.coordinator.start(other, h.owner); await entered.promise;
  await assert.rejects(h.coordinator.resume(h.id, h.owner), { code: 'RESOURCE_UNAVAILABLE' });
  assert.deepEqual(await h.read(), pending); release.resolve(); await h.coordinator.settled(); slow = false;
  const replies = await Promise.all([h.coordinator.resume(h.id, h.owner), h.coordinator.resume(h.id, h.owner)]);
  assert.deepEqual(replies, [{ accepted: true }, { accepted: false }]); await h.coordinator.settled();
  assert.equal((await h.read()).budgetCycles.length, 2);
});

test('retomada preserva tempo ativo, exclui espera e mantém teto cumulativo', async t => {
  let time = Date.now();
  const h = await setup(t, { now: () => time, limits: { activeMs: 70_000 }, modelCall: async task => { time += 10_000; return normal(task); } });
  await h.start(); assert.equal((await h.read()).preparation!.accumulatedActiveMs, 40_000);
  time += 300_000;
  await h.coordinator.answer(h.id, h.owner, await h.answer());
  await h.coordinator.resume(h.id, h.owner); await h.coordinator.settled();
  const run = await h.read(); assert.equal(run.status, 'interrupted'); assert.equal(run.preparation!.stopReason!.code, 'ACTIVE_LIMIT');
  assert.equal(run.preparation!.accumulatedActiveMs, 70_000); assert.equal(run.preparation!.calls.length, 7);
  await assert.rejects(h.coordinator.resume(h.id, h.owner), { code: 'INVALID_STATE' });
});

test('cancelamento e reinício durante retomada impedem avanço tardio e novo processamento', async t => {
  for (const restart of [false, true]) {
    const entered = deferred(), release = deferred(); let slow = false;
    const h = await setup(t, { modelCall: async task => { if (slow) { entered.resolve(); await release.promise; } return normal(task); } });
    await h.start(); const request = await h.answer(); await h.coordinator.answer(h.id, h.owner, request);
    slow = true; await h.coordinator.resume(h.id, h.owner); await entered.promise;
    await assert.rejects(h.coordinator.answer(h.id, h.owner, request), { code: 'INVALID_STATE' });
    if (restart) await h.store.recoverInterrupted(); else await h.coordinator.cancel(h.id, h.owner);
    const stopped = await h.read(); assert.equal(stopped.status, restart ? 'interrupted' : 'cancelled');
    release.resolve(); await h.coordinator.settled();
    assert.equal((await h.read()).outputs.length, stopped.outputs.length);
    assert.equal((await h.read()).status, stopped.status);
    await assert.rejects(h.coordinator.resume(h.id, h.owner), { code: 'INVALID_STATE' });
    await assert.rejects(h.coordinator.answer(h.id, h.owner, request), { code: 'INVALID_STATE' });
    assert.ok((await h.read()).preparation!.accumulatedActiveMs! >= 0);
  }
});

test('answer/resume HTTP exigem sessão, origem, identidade, propriedade e contrato estrito', async t => {
  const h = await setup(t); await h.start();
  const auth = new AuthService(h.config);
  t.after(() => auth.close());
  const owner = await auth.register({ name: 'Pessoa', email: 'one@example.test', password: 'Senha fictícia comprida 1!' }, 'owner');
  const other = await auth.register({ name: 'Outra', email: 'two@example.test', password: 'Senha fictícia comprida 1!' }, 'other');
  await h.store.update(h.id, ({ run }) => { run.ownerId = owner.user.id; return { save: true, value: undefined }; });
  const app = createServer((request, response) => void handleApi(request, response, h.store, auth, h.config, h.coordinator));
  app.listen(0, '127.0.0.1'); await once(app, 'listening');
  t.after(async () => { app.close(); app.closeAllConnections(); await once(app, 'close'); });
  const address = app.address(); assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/api/runs/${h.id}`;
  async function send(operation: string, body: unknown, overrides: Record<string, string> = {}) {
    const response = await fetch(`${base}/${operation}`, { method: 'POST', body: JSON.stringify(body), headers: {
      Origin: h.config.appOrigin!, 'Content-Type': 'application/json', Cookie: auth.cookie(owner.token).split(';')[0]!,
      'X-Expected-User-Id': owner.user.id, ...overrides,
    } });
    return { status: response.status, body: await response.json() as any };
  }
  const request = await h.answer();
  for (const [operation, body] of [['answer', request], ['resume', {}]] as const) {
    assert.equal((await send(operation, body, { Cookie: '' })).status, 401);
    assert.equal((await send(operation, body, { Origin: 'https://other.test' })).status, 403);
    assert.equal((await send(operation, body, { 'X-Expected-User-Id': '' })).status, 400);
    assert.equal((await send(operation, body, { 'X-Expected-User-Id': other.user.id })).status, 409);
    assert.equal((await send(operation, body, { Cookie: auth.cookie(other.token).split(';')[0]!, 'X-Expected-User-Id': other.user.id })).status, 404);
    assert.equal((await send(operation, { ...body, extra: true })).status, 400);
  }
  assert.equal((await send('resume', {})).status, 409);
  const answer = await send('answer', request); assert.equal(answer.status, 200); assert.equal(answer.body.canResume, true);
  assert.equal(answer.body.answers[0].actorId, owner.user.id);
  assert.equal((await send('answer', request)).status, 200);
  assert.equal((await send('answer', { ...request, text: 'Diferente', expectedAnswerRevision: 1 })).status, 200);
  assert.equal((await send('resume', {})).status, 202); await h.coordinator.settled();
  assert.equal((await h.read()).status, 'awaiting_approval');
});

test('novo ciclo motivado por resposta continua limitado a três produções e conserva chamadas anteriores', async t => {
  let rejectRevisions = false;
  const h = await setup(t, { modelCall: async task => rejectRevisions && task.role === 'artifact-curator'
    ? result({ incomplete: true }) : normal(task) });
  await h.start(); const previousCalls = (await h.read()).preparation!.calls;
  await h.coordinator.answer(h.id, h.owner, await h.answer()); rejectRevisions = true;
  await h.coordinator.resume(h.id, h.owner); await h.coordinator.settled();
  const run = await h.read();
  assert.equal(run.status, 'interrupted'); assert.equal(run.preparation!.stopReason!.code, 'REVISION_LIMIT');
  assert.equal(run.budgetCycles.length, 2); assert.equal(run.preparation!.calls.length, previousCalls.length + 3);
  assert.deepEqual(run.preparation!.calls.slice(0, previousCalls.length), previousCalls);
  assert.deepEqual(run.preparation!.calls.slice(-3).map(call => call.attempt), [1, 2, 3]);
  assert.ok(run.preparation!.calls.slice(-3).every(call => call.budgetCycleId === run.budgetCycles[1]!.id));
  await assert.rejects(h.coordinator.resume(h.id, h.owner), { code: 'INVALID_STATE' });
});
