import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { PreparationCoordinator, type PreparationOptions } from '../src/application/prepare-plan.js';
import { createRun } from '../src/application/runs.js';
import { executeApprovalCommand, getPlanReview } from '../src/application/plan-approval.js';
import { RunStore } from '../src/storage/runs.js';
import { readConfig } from '../src/config.js';
import { createApp } from '../src/app.js';
import { buildRouteDetail, validateRouteDetail } from '../src/domain/route-detail.js';
import type { TestCasesPayload } from '../src/domain/preparation.js';
import type { NavigationPayload } from '../src/domain/navigation.js';
import type { SpecialistTask } from '../src/runtime/pi.js';
const text = 'Quantidade inteira de 1 a 10 cria reserva. Fora desse intervalo rejeita sem criar reserva.';
const approved = { status: 'approved', reason: 'Comportamentos e fontes conferidos.', findings: [] };
const changes = { status: 'changes_requested', reason: 'Corrigir expectativa de rejeição.',
  findings: [{ code: 'EXPECTED', location: 'testCases[0].expected', message: 'Rejeitar sem criar reserva.' }] };
const model = { provider: 'mock', model: 'controlled' };
const result = (payload: unknown) => ({ payload, metadata: { ...model, thinkingLevel: 'high' as const, durationMs: 1 } });
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

const targetOrigin = 'http://127.0.0.1:4000';
const association = (input: any) => ({ routes: input.approvedCases.payload.testCases.map((item: any) =>
  ({ caseId: item.id, pathId: 'path-form', reason: null })) });
async function setup(t: TestContext, options: PreparationOptions = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'akcit-routes-'));
  t.after(() => rm(dir, { force: true, recursive: true }));
  const config = readConfig({ DATA_DIR: dir, TARGET_ALLOWED_ORIGINS: targetOrigin,
    PI_PROVIDER: 'deepseek', PI_MODEL: 'deepseek-v4-pro', PI_THINKING_LEVEL: 'high',
    APP_ORIGIN: 'http://localhost:3000' });
  const store = new RunStore(dir); await store.initialize();
  const calls: SpecialistTask[] = [];
  const coordinator = new PreparationCoordinator(store, config, { ...options, modelPreflight: async () => {},
    modelCall: async task => {
      calls.push(task);
      const input = JSON.parse(task.prompt);
      if (input.task === 'route_detail' || input.output?.phase === 'route_detail') {
        return options.modelCall ? options.modelCall(task) : result(task.role === 'output-validator' ? approved : association(input));
      }
      return normal(task);
    } });
  const id = (await createRun(store, { name: 'Percursos', applicationName: 'Reservas', text }, [randomUUID()], { userId: 'owner' })).run.id;
  const read = async () => (await store.read(id)).run;
  await coordinator.start(id, 'owner'); await coordinator.settled();
  let output = (await read()).outputs.at(-1)!;
  assert.ok((await executeApprovalCommand(store, id, { outputId: output.id, outputRevision: output.revision, type: 'approve' }, { userId: 'owner' })).ok);
  await coordinator.continue(id, 'owner', { outputId: output.id, outputRevision: output.revision }); await coordinator.settled();
  output = (await read()).outputs.at(-1)!;
  assert.ok((await executeApprovalCommand(store, id, { outputId: output.id, outputRevision: output.revision, type: 'approve' }, { userId: 'owner' })).ok);
  await store.update(id, record => {
    const run = record.run;
    Object.assign(run.input, { accessRevision: 1, startUrl: targetOrigin, credentialRef: 'cred-test', authorizedTarget: true,
      accessProfile: 'Operador', dataPreparation: 'Lista vazia.' });
    record.targetCredential = { ref: 'cred-test', username: 'synthetic-user', password: 'synthetic-secret' };
    run.observations = [{ id: 'obs-1', assetId: 'asset-00000001', at: new Date().toISOString(), width: 1366, height: 768 }];
    run.mappingActions = [{ id: 'act-form', at: new Date().toISOString(), tool: 'pointer', params: {}, outcome: 'ok' }];
    run.outputs.push({ id: 'map-1', revision: 1, phase: 'mapping', producer: 'test-executor', answerRefs: [],
      dependsOn: run.outputs.map(item => ({ outputId: item.id, revision: item.revision })), payload: {
        accessRevision: 1, authentication: { status: 'authenticated', observationId: 'obs-1' },
        map: { screens: [
          { id: 'home', name: 'Início', recognition: 'Área autenticada.', observationIds: ['obs-1'] },
          { id: 'form', name: 'Nova reserva', recognition: 'Formulário de reserva.', observationIds: ['obs-1'] }],
          transitions: [{ id: 'open-form', from: 'home', to: 'form', actionId: 'act-form', observationIds: ['obs-1'] }],
          paths: [{ id: 'path-home', startScreenId: 'home', transitionIds: [] }, { id: 'path-form', startScreenId: 'home', transitionIds: ['open-form'] }] },
        pending: [], limitations: [] } });
    run.validations.push({ outputId: 'map-1', outputRevision: 1, validator: 'output-validator', ...approved });
    run.status = 'ready'; run.phase = 'mapping';
    return { save: true, value: undefined };
  });
  const reference = { outputId: 'map-1', outputRevision: 1 };
  const review = async () => {
    const response = await getPlanReview(store, id, { userId: 'owner' }, config);
    assert.ok(response.ok); return response.review;
  };
  return { id, dir, config, store, coordinator, read, calls, reference, review,
    start: () => coordinator.continue(id, 'owner', reference) };
}
test('T6.3: detalha com Pro/high, contexto completo, snapshot preservado e saída pública vigente', async t => {
  const h = await setup(t, { modelCall: async task => {
    const input = JSON.parse(task.prompt);
    assert.equal(task.model.provider, 'deepseek'); assert.equal(task.model.model, 'deepseek-v4-pro');
    assert.equal(task.model.thinkingLevel, 'high');
    assert.equal(input.approvedCases.phase, 'case_design'); assert.equal(input.approvedMapping.phase, 'mapping');
    assert.equal(input.caseApproval.decision, 'approved'); assert.equal(input.approvedPlan.phase, 'planning');
    assert.equal(input.approvedCuration.phase, 'curation'); assert.equal(input.artifacts[0].text, text);
    assert.deepEqual(input.answers, []); assert.deepEqual(input.pending, []);
    assert.doesNotMatch(task.prompt, /synthetic-secret|synthetic-user/);
    return result(task.role === 'output-validator' ? approved : association(input));
  } });
  const before = await h.read();
  assert.equal((await h.review()).canDetailRoutes, true);
  assert.deepEqual(await h.start(), { accepted: true }); await h.coordinator.settled();
  const run = await h.read(), view = await h.review();
  assert.equal(run.status, 'ready'); assert.equal(run.phase, 'route_detail');
  assert.deepEqual(run.outputs.slice(0, -1), before.outputs); assert.deepEqual(run.approvals, before.approvals);
  assert.ok(view.routeDetail?.ready); assert.ok(view.routeDetail.current); assert.equal(view.canDetailRoutes, false);
  assert.equal(view.canDecideCases, false); assert.equal(view.canResume, false);
  assert.equal(view.routeDetail.payload.testCases.length, 4);
  assert.ok(view.cases!.payload.testCases.every(item => item.pathId === null));
  assert.deepEqual(h.calls.slice(6).map(item => item.task), ['detail-test-routes', 'validate-output']);
  assert.equal((await h.store.read(h.id)).workIntents.at(-1)!.status, 'completed');
  assert.deepEqual(await h.start(), { accepted: false }); assert.equal(h.calls.length, 8);
  const reopened = await new RunStore(h.dir).read(h.id); assert.deepEqual(reopened.run, run);
  assert.ok((await h.review()).routeDetail?.ready);
});

test('T6.3: domínio recusa omissões, duplicatas, IDs inventados, razões vazias e alteração lógica', async t => {
  const h = await setup(t), run = await h.read();
  const cases = run.outputs.find(item => item.phase === 'case_design')!;
  const logical = cases.payload as TestCasesPayload, nav = run.outputs.at(-1)!.payload as NavigationPayload;
  const reference = { outputId: cases.id, revision: cases.revision };
  const routes = logical.testCases.map(item => ({ caseId: item.id, pathId: 'path-form', reason: null }));
  for (const invalid of [
    { routes: routes.slice(1) }, { routes: [...routes.slice(1), routes[1]] },
    { routes: [{ ...routes[0], caseId: 'invented' }, ...routes.slice(1)] },
    { routes: routes.map(item => ({ ...item, pathId: 'invented' })) },
    { routes: routes.map(item => ({ ...item, pathId: null, reason: '  ' })) },
    { routes: routes.map(item => ({ ...item, expected: 'alterado' })) },
  ]) assert.throws(() => buildRouteDetail(invalid, logical, nav, reference), { code: 'INVALID_MODEL_OUTPUT' });
  const payload = buildRouteDetail({ routes }, logical, nav, reference);
  for (const field of ['expected', 'data', 'preconditions', 'setup', 'sources', 'techniques', 'ruleIds', 'requirementIds', 'id', 'approvedCaseRevision']) {
    const changed: any = structuredClone(payload); changed.testCases[0][field] = 'alterado';
    assert.throws(() => validateRouteDetail(changed, logical, nav, reference), { code: 'INVALID_MODEL_OUTPUT' });
  }
  assert.ok(logical.testCases.every(item => item.pathId === null));
});

for (const defect of ['no_approval', 'no_map_verdict', 'case_changes', 'new_curation', 'new_cases', 'new_access', 'new_answer', 'exhausted'] as const) {
  test(`T6.3: ${defect} recusa antes da inferência`, async t => {
    const h = await setup(t);
    await h.store.update(h.id, ({ run }) => {
      const cases = run.outputs.find(item => item.phase === 'case_design')!;
      if (defect === 'no_approval') run.approvals = run.approvals.filter(item => item.outputId !== cases.id);
      if (defect === 'no_map_verdict') run.validations = run.validations.filter(item => item.outputId !== 'map-1');
      if (defect === 'case_changes') run.approvals = run.approvals.map(item => item.outputId === cases.id ? { ...item, decision: 'changes_requested', comment: 'Rever dados.' } : item);
      if (defect === 'new_curation') run.outputs.push({ ...run.outputs[0]!, revision: 2 });
      if (defect === 'new_cases') run.outputs.push({ ...cases, revision: 2 });
      if (defect === 'new_access') run.input.accessRevision = 2;
      if (defect === 'new_answer') {
        run.answerArtifacts = [{ id: 'answer-source', name: 'answer.txt', version: '1', text: 'Outra regra.' }];
        run.answers = [{ id: 'answer-1', revision: 1, outputId: run.outputs[0]!.id, outputRevision: 1, questionId: 'Q-1',
          text: 'Outra regra.', artifactId: 'answer-source', actorId: 'owner', at: new Date().toISOString() }];
      }
      if (defect === 'exhausted') run.preparation!.accumulatedActiveMs = run.preparation!.limits.activeMs;
      return { save: true, value: undefined };
    });
    const before = await h.store.read(h.id);
    assert.equal((await h.review()).canDetailRoutes, false);
    await assert.rejects(h.start()); assert.equal(h.calls.length, 6);
    assert.deepEqual(await h.store.read(h.id), before);
  });
}

test('T6.3: correção cria revisão, preserva histórico e entrega parecer anterior ao projetista', async t => {
  let revisions = 0;
  const h = await setup(t, { modelCall: async task => {
    const input = JSON.parse(task.prompt);
    if (task.role === 'output-validator') return result(++revisions === 1 ? changes : approved);
    if (input.previousOutput) { assert.deepEqual(input.feedback, changes); assert.equal(input.previousOutput.revision, 1); }
    return result(association(input));
  } });
  await h.start(); await h.coordinator.settled();
  const run = await h.read(), outputs = run.outputs.filter(item => item.phase === 'route_detail');
  assert.deepEqual(outputs.map(item => item.revision), [1, 2]); assert.equal(outputs[0]!.id, outputs[1]!.id);
  assert.deepEqual(run.validations.slice(-2).map(item => item.status), ['changes_requested', 'approved']);
  assert.ok((await h.review()).routeDetail?.ready);
});

for (const mode of ['partial', 'all_pending', 'blocked', 'changes', 'invalid', 'invalid_verdict', 'technical_error'] as const) {
  test(`T6.3: ${mode} preserva pendências ou encerra com limite e causa`, async t => {
    const h = await setup(t, { modelCall: async task => {
      const input = JSON.parse(task.prompt);
      if (task.role === 'output-validator') {
        if (mode === 'blocked') return result({ ...changes, status: 'blocked' });
        if (mode === 'changes') return result(changes);
        if (mode === 'invalid_verdict') return result({ status: 'invented' });
        return result(approved);
      }
      if (mode === 'invalid') return result({ routes: [] });
      if (mode === 'technical_error') throw new Error('Falha técnica sintética.');
      const associations = association(input);
      if (mode === 'partial' || mode === 'all_pending') associations.routes = associations.routes.map((item: any, index: number) =>
        mode === 'all_pending' || index === 0 ? { ...item, pathId: null, reason: 'O mapa não contém a tela necessária para este caso.' } : item);
      return result(associations);
    } });
    await h.start(); await h.coordinator.settled();
    const run = await h.read(), view = await h.review();
    if (mode === 'partial') { assert.equal(view.status, 'ready'); assert.ok(view.routeDetail?.ready); assert.equal(view.routeDetail.payload.pending.length, 1); }
    else if (mode === 'all_pending' || mode === 'blocked') { assert.equal(run.status, 'awaiting_input'); assert.equal(run.phase, 'route_detail'); assert.equal(view.routeDetail?.ready, false); assert.equal(view.canResume, false); }
    else {
      assert.equal(run.status, mode === 'technical_error' ? 'error' : 'interrupted');
      const code = mode === 'invalid_verdict' ? 'VALIDATOR_LIMIT' : mode === 'technical_error' ? 'MODEL_ERROR' : 'REVISION_LIMIT';
      assert.equal(run.preparation!.stopReason!.code, code);
    }
    assert.equal(h.calls.filter(item => item.task === 'detail-test-routes').length, ['changes', 'invalid'].includes(mode) ? 3 : 1);
    if (mode === 'invalid_verdict') assert.deepEqual(run.validations.slice(-2).map(item => item.status), ['error', 'error']);
    assert.deepEqual(await h.start(), { accepted: false });
  });
}

for (const during of ['production', 'validation'] as const) {
  for (const change of ['access', 'map', 'cases', 'cancel', 'restart'] as const) {
    test(`T6.3: ${change} durante ${during} impede publicação tardia`, async t => {
      const entered = deferred<SpecialistTask>(), release = deferred<void>();
      const h = await setup(t, { modelCall: async task => {
        if (during === 'production' ? task.role === 'test-designer' : task.role === 'output-validator') { entered.resolve(task); await release.promise; }
        return result(task.role === 'output-validator' ? approved : association(JSON.parse(task.prompt)));
      } });
      await h.start(); const task = await entered.promise;
      if (change === 'cancel') { await h.coordinator.cancel(h.id, 'owner'); assert.equal(task.signal.aborted, true); }
      else if (change === 'restart') assert.equal(await new RunStore(h.dir).recoverInterrupted(), 1);
      else await h.store.update(h.id, ({ run }) => {
        if (change === 'access') run.input.accessRevision = 2;
        else { const original = run.outputs.find(item => item.phase === (change === 'map' ? 'mapping' : 'case_design'))!; run.outputs.push({ ...original, revision: 2 }); }
        return { save: true, value: undefined };
      });
      release.resolve(); await h.coordinator.settled();
      const run = await h.read(); assert.equal(run.status, change === 'cancel' ? 'cancelled' : 'interrupted');
      assert.equal(run.validations.filter(item => run.outputs.some(output => output.phase === 'route_detail' && output.id === item.outputId) && item.status === 'approved').length, 0);
      assert.ok(!(await h.review()).routeDetail?.ready);
      assert.deepEqual(await h.start(), { accepted: false });
    });
  }
}

test('T6.3: duplo envio inicia um único trabalho e preserva orçamento acumulado', async t => {
  let now = Date.now();
  const h = await setup(t, { now: () => now, modelCall: async task => { now += 100; return result(task.role === 'output-validator' ? approved : association(JSON.parse(task.prompt))); } });
  const before = (await h.read()).preparation!.accumulatedActiveMs!;
  now += 86_400_000;
  assert.deepEqual(await Promise.all([h.start(), h.start()]), [{ accepted: true }, { accepted: false }]);
  await h.coordinator.settled();
  assert.equal((await h.read()).preparation!.accumulatedActiveMs, before + 200);
  assert.equal((await h.store.read(h.id)).workIntents.filter(item => item.type === 'detail_routes').length, 1);
  await assert.rejects(h.coordinator.continue(h.id, 'other', h.reference), { code: 'RUN_NOT_FOUND' });
});

test('T6.3: API autenticada inicia pelo mapa e isola resultado e decisões entre contas', async t => {
  const h = await setup(t);
  let inferred = 0;
  const app = await createApp(h.config, { modelPreflight: async () => {}, modelCall: async task => {
    inferred++; return result(task.role === 'output-validator' ? approved : association(JSON.parse(task.prompt)));
  } });
  app.listen(0, '127.0.0.1'); await once(app, 'listening');
  t.after(async () => { await app.shutdown(); app.closeAllConnections(); await new Promise<void>(resolve => app.close(() => resolve())); });
  const address = app.address(); assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  const request = (path: string, cookie = '', user = '', body?: unknown) => fetch(origin + path, {
    method: body === undefined ? 'GET' : 'POST', headers: { Cookie: cookie, 'X-Expected-User-Id': user,
      Origin: h.config.appOrigin, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const register = async (email: string) => {
    const response = await request('/api/auth/register', '', '', { name: 'Teste', email, password: 'Senha ficticia longa 1!' });
    assert.equal(response.status, 201); return { cookie: response.headers.get('set-cookie')!.split(';')[0]!, id: (await response.json()).user.id };
  };
  const owner = await register('owner@example.test'), other = await register('other@example.test');
  await h.store.update(h.id, ({ run }) => { run.ownerId = owner.id; run.approvals.forEach(item => { item.actorId = owner.id; }); return { save: true, value: undefined }; });
  assert.equal((await request(`/api/runs/${h.id}/continue`, other.cookie, other.id, h.reference)).status, 404);
  assert.equal((await request(`/api/runs/${h.id}/continue`, owner.cookie, owner.id, { ...h.reference, expectedAccessRevision: 1 })).status, 400);
  assert.equal((await request(`/api/runs/${h.id}/continue`, owner.cookie, owner.id, h.reference)).status, 202);
  await app.shutdown();
  assert.equal((await request(`/api/runs/${h.id}/continue`, owner.cookie, owner.id, h.reference)).status, 200);
  const view = await (await request(`/api/runs/${h.id}`, owner.cookie, owner.id)).json();
  assert.equal(view.routeDetail.ready, true); assert.equal(inferred, 2);
  assert.doesNotMatch(JSON.stringify(view), /synthetic-secret|synthetic-user/);
  assert.equal((await request(`/api/runs/${h.id}`, other.cookie, other.id)).status, 404);
});
