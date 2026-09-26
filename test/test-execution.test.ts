import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { RunStore, type RunRecord, type RunOutput } from '../src/storage/runs.js';
import { PreparationError } from '../src/application/prepare-plan.js';
import { createRun } from '../src/application/runs.js';
import { executionEligibility, canExecuteTests, produceExecution } from '../src/application/execute-tests.js';
import { readConfig } from '../src/config.js';
import { approvedCaseStillCurrent, eligibleExecutionCases, latestExecutionOutputs, parseExecutionCandidate, type ExecutionAttempt } from '../src/domain/test-execution.js';
import type { MappingServices } from '../src/application/map-application.js';
import type { RouteDetailPayload } from '../src/domain/route-detail.js';
import type { VisualTask } from '../src/runtime/pi-visual.js';
import { SpecialistError } from '../src/runtime/pi.js';
const text = 'Quantidade inteira de 1 a 10 cria reserva. Fora desse intervalo rejeita sem criar reserva.';
const approved = { status: 'approved' as const, reason: 'Caso e capturas conferidos.', findings: [] };
const model = { provider: 'deepseek', model: 'deepseek-flash', thinkingLevel: 'high' as const };
const visualResult = (payload: unknown) => ({ payload, metadata: { ...model, durationMs: 1 }, calls: [{ at: new Date().toISOString(), durationMs: 1 }] });
// Imagem sintética somente dos testes unitários; o smoke usa ffmpeg/Chromium reais.
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6BUkAAAAASUVORK5CYII=', 'base64');
const candidate = (ids: string[], changes = {}) => ({ setupObservation: 'Formulário disponível e preparo conferido.',
  observed: 'Entrada inválida foi rejeitada sem criar reserva.', verdict: 'passed', reason: 'Rejeição esperada observada.',
  evidenceIds: ids, evidenceGaps: [], question: null, reproduce: false, ...changes });

async function setup(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'akcit-execution-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new RunStore(dir); await store.initialize();
  const config = readConfig({ DATA_DIR: dir, TARGET_ALLOWED_ORIGINS: 'http://127.0.0.1:4000' });
  const id = (await createRun(store, { name: 'Execução', applicationName: 'Reservas', text }, [randomUUID()], { userId: 'owner' })).run.id;
  await store.update(id, record => {
    const run = record.run, at = new Date().toISOString();
    const sources = [{ artifactId: run.artifacts[0]!.id, locator: 'L1', quote: text }];
    const output = (id: string, phase: string, payload: any, deps: RunOutput[]): RunOutput => ({ id, phase, revision: 1,
      payload, dependsOn: deps.map(item => ({ outputId: item.id, revision: item.revision })), answerRefs: [] });
    const curation = output('curation', 'curation', { requirements: [{ id: 'REQ-1', statement: text, sources,
      rules: [{ id: 'RULE-1', statement: text, sources }] }], questions: [] }, []);
    const plan = output('plan', 'planning', { testPlan: { objective: 'Conferir reservas.', requirementIds: ['REQ-1'], ruleIds: ['RULE-1'],
      priorities: [{ ruleId: 'RULE-1', reason: 'Limites de entrada.' }], exclusions: [], approach: ['AVL no domínio inteiro.'], preconditions: [], sources } }, [curation]);
    const cases = output('cases', 'case_design', { testCases: [0, 1].map(value => ({ id: `CASE-${value}`, requirementIds: ['REQ-1'],
      ruleIds: ['RULE-1'], preconditions: [], setup: 'Formulário pronto para nova reserva.', pathId: null, data: { quantity: value },
      techniques: [{ name: 'AVL', description: 'Limite inferior e vizinho inválido.', values: [value] }],
      expected: value === 0 ? 'Rejeitar sem criar reserva.' : 'Criar reserva.', sources })) }, [curation, plan]);
    const mapping = output('mapping', 'mapping', { accessRevision: 1, authentication: { status: 'authenticated', observationId: 'obs-map' },
      map: { screens: [{ id: 'form', name: 'Nova reserva', recognition: 'Formulário autenticado.', observationIds: ['obs-map'] }],
        transitions: [], paths: [{ id: 'path-form', startScreenId: 'form', transitionIds: [] }] }, pending: [], limitations: [] }, [curation, plan, cases]);
    const detail = output('routes', 'route_detail', { testCases: cases.payload.testCases.map((item: any) => ({ ...item,
      pathId: 'path-form', approvedCaseRevision: { outputId: 'cases', revision: 1 } })), pending: [] }, [curation, plan, cases, mapping]);
    detail.accessRevision = 1;
    run.outputs = [curation, plan, cases, mapping, detail];
    run.validations = run.outputs.map(item => ({ outputId: item.id, outputRevision: 1, validator: 'output-validator', ...approved }));
    run.approvals = [plan, cases].map(item => ({ id: randomUUID(), outputId: item.id, outputRevision: 1, actorId: 'owner', at, decision: 'approved', comment: '' }));
    const limits = { maxRequirements: 10, maxRevisions: 3, maxValidatorAttempts: 2, timeoutMs: 120000, activeMs: 2700000 };
    run.preparation = { id: 'preparation', budgetCycleId: 'cycle', startedAt: at, finishedAt: at, activeRole: null, activity: null,
      stopReason: null, limits, calls: [], accumulatedActiveMs: 0 };
    run.budgetCycles = [{ id: 'cycle', reason: 'initial_preparation', answerRef: null, affectedCaseIds: [], limits, startedAt: at }];
    run.observations = [{ id: 'obs-map', assetId: 'asset-mapping-0001', at, width: 1, height: 1 }];
    Object.assign(run.input, { startUrl: 'http://127.0.0.1:4000', accessRevision: 1, authorizedTarget: true,
      credentialRef: 'credential', dataPreparation: 'Lista conferida pela interface.', accessProfile: 'Operador' });
    record.targetCredential = { ref: 'credential', username: 'test-user', password: 'test-secret' };
    run.status = 'ready'; run.phase = 'route_detail';
    return { value: undefined, save: true };
  });
  const controller = new AbortController();
  const calls: VisualTask[] = [];
  const request = { outputId: 'routes', outputRevision: 1, expectedAccessRevision: 1 };
  const services: MappingServices = {
    read: () => store.read(id), update: change => store.update(id, record => {
      controller.signal.throwIfAborted(); return { save: true, value: change(record) };
    }),
    finish: async (status, reason) => { await store.update(id, record => {
      record.run.status = status; record.run.phase = 'execution'; record.run.preparation!.finishedAt = new Date().toISOString();
      record.run.preparation!.stopReason = reason; return { save: true, value: undefined };
    }); },
    failure: error => ({ code: error instanceof SpecialistError ? error.code : 'MODEL_ERROR', message: 'Falha técnica controlada.' }),
    now: Date.now, time: () => new Date().toISOString(), signal: controller.signal, config,
    models: { executor: model, 'validator-visual': model }, mediaDir: dir,
  };
  async function observe(task: VisualTask) {
    assert.ok(task.browser);
    const run = (await store.read(id)).run;
    assert.equal(run.executionAttempts!.at(-1)!.status, 'running', 'persiste tentativa antes da primeira ação');
    const observation = { id: randomUUID(), assetId: randomUUID(), at: new Date().toISOString(), width: 1, height: 1 };
    await writeFile(join(dir, observation.assetId + '.png'), png);
    await task.browser.onObservation(observation);
    await task.browser.onAction({ id: randomUUID(), at: observation.at, tool: 'pointer', params: { action: 'click', x: 10, y: 10 }, outcome: 'ok' });
    return observation.id;
  }
  const start = async (call: (task: VisualTask) => Promise<ReturnType<typeof visualResult>>) => {
    await store.update(id, record => {
      record.run.status = 'running'; record.run.preparation!.finishedAt = null; return { value: undefined, save: true };
    });
    services.visualCall = async task => { calls.push(task); return call(task); };
    await produceExecution(services, request);
  };
  return { id, dir, store, config, controller, calls, request, services, start, observe, read: async () => (await store.read(id)).run };
}

test('execução sequencial persiste tentativas, valida cada caso com suas imagens e mantém IDs estáveis', async t => {
  const h = await setup(t);
  assert.equal(canExecuteTests(await h.store.read(h.id), h.config), true);
  await h.start(async task => {
    if (task.browser) return visualResult(candidate([await h.observe(task)]));
    assert.equal(task.kind, 'validate-test-result');
    const input = JSON.parse(task.prompt);
    assert.equal(task.images!.length, 1); assert.equal(task.images![0]!.data, png.toString('base64'));
    assert.equal(input.manifest.observations[0].attemptId, input.attempt.id);
    assert.doesNotMatch(task.prompt, /test-secret|test-user/);
    return visualResult(approved);
  });
  const run = await h.read();
  assert.equal(run.status, 'ready'); assert.equal(run.phase, 'execution');
  assert.equal(run.executionAttempts!.length, 2);
  assert.deepEqual(run.executionAttempts!.map(item => item.verdict), ['passed', 'passed']);
  assert.equal(latestExecutionOutputs(run).length, 2);
  assert.deepEqual(h.calls.map(task => task.kind), ['execute-test-case', 'validate-test-result', 'execute-test-case', 'validate-test-result']);
  assert.deepEqual(run.preparation!.calls.map(call => call.phase), ['execution', 'execution_validation', 'execution', 'execution_validation']);
});

test('JSON inválido corrige com imagens sem repetir ação física ou abrir outro navegador', async t => {
  const h = await setup(t); let invalid = true;
  await h.start(async task => {
    if (task.browser) {
      const id = await h.observe(task);
      if (invalid) { invalid = false; return visualResult({ invalid: true }); }
      return visualResult(candidate([id]));
    }
    if (task.role === 'test-executor') {
      const input = JSON.parse(task.prompt); assert.equal(input.mode, 'correct_conclusion_only');
      assert.equal(task.images!.length, 1); return visualResult(candidate(input.attempt.evidenceIds));
    }
    return visualResult(approved);
  });
  assert.equal(h.calls.filter(task => task.browser).length, 2);
  assert.equal((await h.read()).executionAttempts![0]!.events.length, 1);
  assert.equal((await h.read()).executionAttempts![0]!.verdict, 'passed');
});

test('reprodução limitada a uma preserva falha aprovada e revisão por tentativa', async t => {
  const h = await setup(t);
  await h.start(async task => {
    if (task.browser) {
      const input = JSON.parse(task.prompt), id = await h.observe(task);
      return visualResult(candidate([id], input.approvedCase.id === 'CASE-0' ? { verdict: 'failed',
        observed: 'A entrada inválida criou reserva.', reason: 'Divergência visível; repetir com preparo conferido para verificar variação.', reproduce: true } : {}));
    }
    return visualResult(approved);
  });
  const run = await h.read(), attempts = run.executionAttempts!.filter(item => item.caseId === 'CASE-0');
  assert.equal(attempts.length, 2); assert.equal(attempts[1]!.reproducesAttemptId, attempts[0]!.id);
  assert.ok(attempts.every(item => item.verdict === 'failed'));
  const outputs = run.outputs.filter(item => item.phase === 'execution' && item.payload.caseId === 'CASE-0');
  assert.equal(outputs.length, 2); assert.equal(outputs[0]!.id, outputs[1]!.id);
  assert.ok(outputs.every(output => run.validations.some(validation => validation.outputId === output.id && validation.outputRevision === output.revision && validation.status === 'approved')));
});

test('bloqueio de preparo é localizado e caso independente continua', async t => {
  const h = await setup(t);
  await h.start(async task => {
    if (task.browser) {
      const input = JSON.parse(task.prompt), id = await h.observe(task);
      return visualResult(candidate([id], input.approvedCase.id === 'CASE-0' ? { verdict: 'blocked',
        observed: 'Lista necessária indisponível.', reason: 'Não foi possível conferir o preparo.', question: 'Como abrir a lista de preparo?' } : {}));
    }
    return visualResult(approved);
  });
  const run = await h.read();
  assert.equal(run.status, 'awaiting_input');
  assert.deepEqual(run.executionAttempts!.map(item => item.verdict), ['blocked', 'passed']);
  const route = run.outputs.find(item => item.phase === 'route_detail')!;
  const cases = (route.payload as RouteDetailPayload).testCases;
  assert.equal(eligibleExecutionCases(run, cases, route).length, 0);
  assert.deepEqual(eligibleExecutionCases(run, cases, { ...route, revision: 2 }).map(item => item.id), ['CASE-0']);
  assert.equal(eligibleExecutionCases(run, cases.map(item => ({ ...item, approvedCaseRevision: { ...item.approvedCaseRevision, revision: 2 } })),
    { ...route, revision: 2 }).length, 1, 'revisão do conjunto sem alteração lógica preserva o caso independente');
});

test('falha de captura após ação produz inconclusivo sem inventar defeito ou reprodução', async t => {
  const h = await setup(t);
  await h.start(async task => {
    if (task.browser) {
      await h.observe(task); throw new SpecialistError('MODEL_ERROR', 'Falha de captura controlada.');
    }
    const input = JSON.parse(task.prompt);
    assert.equal(input.output.payload.verdict, 'inconclusive');
    assert.equal(input.output.payload.reproduce, false); return visualResult(approved);
  });
  assert.ok((await h.read()).executionAttempts!.every(item => item.verdict === 'inconclusive'));
  assert.equal(h.calls.filter(item => item.browser).length, 2);
});

test('conclusões rejeitam captura do mapa, passed sem suporte, not_run inventado e reprodução de bloqueio', async t => {
  const h = await setup(t);
  const attempt: ExecutionAttempt = { id: 'attempt', caseId: 'case', approvedCaseRevision: { outputId: 'cases', revision: 1 },
    routeDetailRef: { outputId: 'routes', revision: 1 }, startedAt: new Date().toISOString(), finishedAt: null, status: 'running',
    setupObservation: '', events: [], observed: '', verdict: null, reason: '', evidenceIds: ['obs-attempt'], evidenceGaps: [] };
  for (const payload of [candidate(['obs-map']), candidate([]), candidate(['obs-attempt'], { verdict: 'not_run' }),
    candidate(['obs-attempt'], { verdict: 'passed', evidenceGaps: ['Resultado ilegível.'] }),
    candidate(['obs-attempt'], { verdict: 'blocked', question: 'Preparo?', reproduce: true }),
    candidate(['obs-attempt'], { verdict: 'inconclusive' })]) assert.throws(() => parseExecutionCandidate(payload, attempt));
  assert.equal(parseExecutionCandidate(candidate([], { verdict: 'inconclusive', evidenceGaps: ['Captura ausente.'] }), attempt).verdict, 'inconclusive');
  assert.equal((await h.read()).executionAttempts, undefined);
});

test('elegibilidade recusa versões, acesso alterado, aprovação ausente e orçamento esgotado', async t => {
  const h = await setup(t), original = await h.store.read(h.id);
  for (const modify of [
    (run: RunRecord) => { run.input.accessRevision = 2; },
    (run: RunRecord) => { run.approvals = run.approvals.filter(item => item.outputId !== 'cases'); },
    (run: RunRecord) => { run.validations = run.validations.filter(item => item.outputId !== 'routes'); },
    (run: RunRecord) => { run.preparation!.accumulatedActiveMs = 2700000; },
  ]) {
    const record = structuredClone(original); modify(record.run);
    assert.throws(() => executionEligibility(record, h.request, h.config));
    assert.equal(canExecuteTests(record, h.config), false);
  }
  assert.throws(() => executionEligibility(original, { ...h.request, outputRevision: 2 }, h.config));
});

test('cinquenta ações por tentativa e cancelamento impedem novas chamadas', async t => {
  const h = await setup(t);
  await assert.rejects(h.start(async task => {
    assert.ok(task.browser);
    for (let action = 0; action < 50; action++) {
      assert.equal(await task.browser.remainingActions(), 50 - action);
      await task.browser.onAction({ id: randomUUID(), at: new Date().toISOString(), tool: 'pointer', params: {}, outcome: 'ok' });
    }
    assert.equal(await task.browser.remainingActions(), 0);
    await assert.rejects(task.browser.onAction({ id: randomUUID(), at: new Date().toISOString(), tool: 'pointer', params: {}, outcome: 'ok' }));
    h.controller.abort(new Error('cancelled'));
    return visualResult(candidate([]));
  }), /cancelled/);
  assert.equal(h.calls.length, 1);
  assert.equal((await h.read()).executionAttempts![0]!.events.length, 50);
});

test('reinício conserva evidências e interrompe tentativa sem repeti-la', async t => {
  const h = await setup(t);
  await h.store.update(h.id, record => {
    const run = record.run; run.status = 'running'; run.phase = 'execution'; run.preparation!.finishedAt = null;
    run.executionAttempts = [{ id: 'attempt', caseId: 'CASE-0', approvedCaseRevision: { outputId: 'cases', revision: 1 },
      routeDetailRef: { outputId: 'routes', revision: 1 }, startedAt: new Date().toISOString(), finishedAt: null,
      status: 'running', setupObservation: '', events: [], observed: '', verdict: null, reason: '', evidenceIds: [], evidenceGaps: [] }];
    return { value: undefined, save: true };
  });
  assert.equal(await h.store.recoverInterrupted(), 1);
  const run = await h.read(), route = run.outputs.find(item => item.phase === 'route_detail')!;
  assert.equal(run.executionAttempts![0]!.status, 'interrupted');
  assert.deepEqual(eligibleExecutionCases(run, (route.payload as RouteDetailPayload).testCases, { ...route, revision: 2 }).map(item => item.id), ['CASE-1']);
});

test('alvo R3 mantém notas independentes durante bloqueio e restaura reservas só pelo avaliador', async t => {
  const { createDemoTarget } = await import('../scripts/demo-target.mjs');
  const { once } = await import('node:events');
  const target = createDemoTarget({ port: 0, mode: 'blocked-reservations' });
  target.server.listen(0, '127.0.0.1'); await once(target.server, 'listening');
  t.after(() => new Promise<void>(resolve => { target.server.close(() => resolve()); target.server.closeAllConnections(); }));
  const origin = `http://127.0.0.1:${target.server.address().port}`;
  const login = await fetch(origin + '/login', { method: 'POST', body: 'user=demo&password=demo1234', redirect: 'manual' });
  const cookie = login.headers.get('set-cookie')!.split(';')[0]!;
  const request = (path: string, body?: string) => fetch(origin + path, { method: body ? 'POST' : 'GET',
    headers: { Cookie: cookie }, ...(body ? { body } : {}), redirect: 'manual' });
  assert.equal((await request('/reservas')).status, 503);
  assert.equal((await request('/reservas/nova', 'qty=1')).status, 503);
  assert.equal(target.reservations.length, 0);
  assert.equal((await request('/notas', 'text=Fluxo+independente')).status, 303);
  assert.match(await (await request('/notas')).text(), /Fluxo independente/);
  target.setReservationsAvailable(true);
  assert.equal((await request('/reservas')).status, 200);
  assert.equal((await request('/reservas/nova', 'qty=1')).status, 303);
  assert.equal(target.reservations.length, 1);
  assert.equal(target.notes.length, 1);
});


test('esgotamento de orçamento preserva ACTIVE_LIMIT em vez de mascarar como cancelamento humano', async t => {
  const h = await setup(t);
  await assert.rejects(h.start(async task => {
    await h.observe(task);
    h.controller.abort(new PreparationError('ACTIVE_LIMIT', 'Orçamento esgotado.'));
    throw new SpecialistError('CANCELLED', 'A sessão foi abortada.');
  }), { code: 'ACTIVE_LIMIT' });
  assert.equal(h.calls.length, 1);
});


test('alteração localizada em CASE-0 preserva tentativa e resultado de CASE-1 na nova revisão do conjunto', async t => {
  const h = await setup(t);
  await h.start(async task => task.browser ? visualResult(candidate([await h.observe(task)])) : visualResult(approved));
  const run = await h.read(), oldCases = run.outputs.find(output => output.phase === 'case_design')!;
  const originalRefs = run.executionAttempts!.map(attempt => structuredClone(attempt.approvedCaseRevision));
  const revisedCases = structuredClone(oldCases); revisedCases.revision = 2;
  (revisedCases.payload.testCases as any[])[0].data.quantity = 11;
  run.outputs.push(revisedCases);
  run.invalidations = [{ id: 'change-case-0', outputId: oldCases.id, outputRevision: oldCases.revision,
    reason: 'Alteração localizada nos dados de CASE-0.', at: new Date().toISOString(),
    feedbackRef: { outputId: 'feedback', revision: 1 }, caseIds: ['CASE-0'] }];
  const oldRoute = run.outputs.find(output => output.phase === 'route_detail')!;
  const newRoute = { ...oldRoute, revision: 2 };
  const detailed = (revisedCases.payload.testCases as any[]).map(item => ({ ...item, pathId: 'path-form',
    approvedCaseRevision: { outputId: revisedCases.id, revision: 2 } }));
  assert.equal(approvedCaseStillCurrent(run, run.executionAttempts![0]!, detailed[0], revisedCases), false);
  assert.equal(approvedCaseStillCurrent(run, run.executionAttempts![1]!, detailed[1], revisedCases), true);
  assert.deepEqual(eligibleExecutionCases(run, detailed, newRoute).map(item => item.id), ['CASE-0']);
  assert.deepEqual(run.executionAttempts!.map(attempt => attempt.approvedCaseRevision), originalRefs);
  const execution = run.outputs.find(output => output.phase === 'execution' && output.payload.caseId === 'CASE-1')!;
  run.invalidations.push({ id: 'invalidate-case-1-result', outputId: execution.id, outputRevision: execution.revision,
    reason: 'Evidência desta tentativa invalidada.', at: new Date().toISOString(),
    feedbackRef: { outputId: 'feedback', revision: 1 }, caseIds: ['CASE-1'] });
  assert.equal(approvedCaseStillCurrent(run, run.executionAttempts![1]!, detailed[1], revisedCases), false);
});
