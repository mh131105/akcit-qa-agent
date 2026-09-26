// T9.1 — SIMULAÇÃO EXPLÍCITA de modelos. Chromium, Xvfb, ferramentas visuais,
// autenticação, ações, capturas, coordenador e persistência são reais; zero LLM pago.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm, readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { RunStore } from '../dist/storage/runs.js';
import { PreparationCoordinator } from '../dist/application/prepare-plan.js';
import { readConfig } from '../dist/config.js';
import { openBrowserSession } from '../agents/test-executor/tools/browser.mjs';
import { createDemoTarget } from './demo-target.mjs';

assert.equal(Number(process.versions.node.split('.')[0]), 24);
const directory = await mkdtemp(join(tmpdir(), 'akcit-execution-smoke-'));
const mediaDir = join(directory, 'media', 'run-execution-smoke');
const models = { executor: { provider: 'deepseek', model: 'deepseek-flash', thinkingLevel: 'high' },
  'validator-visual': { provider: 'deepseek', model: 'deepseek-flash', thinkingLevel: 'high' } };
const target = createDemoTarget({ port: 0, mode: 'reference', user: 'demo', password: 'demo1234' });
let coordinator;
let session;
const checked = [];
let succeeded = false;
try {
  target.server.listen(0, '127.0.0.1'); await once(target.server, 'listening');
  const origin = `http://127.0.0.1:${target.server.address().port}`;
  const config = readConfig({ DATA_DIR: directory, TARGET_ALLOWED_ORIGINS: origin });
  const store = new RunStore(directory); await store.initialize();
  const runId = 'run-execution-smoke', at = new Date().toISOString();
  const text = 'Quantidade inteira de 1 a 10 cria reserva. Fora desse intervalo rejeita sem criar reserva.';
  const sources = [{ artifactId: 'artifact', locator: 'L1', quote: text }];
  const make = (id, phase, payload, outputs = []) => ({ id, phase, revision: 1, payload, answerRefs: [],
    dependsOn: outputs.map(item => ({ outputId: item.id, revision: item.revision })) });
  const curation = make('curation', 'curation', { requirements: [{ id: 'REQ-1', statement: text, sources,
    rules: [{ id: 'RULE-1', statement: text, sources }] }], questions: [] });
  const plan = make('plan', 'planning', { testPlan: { objective: 'Conferir rejeição e sucesso.', requirementIds: ['REQ-1'], ruleIds: ['RULE-1'],
    priorities: [{ ruleId: 'RULE-1', reason: 'Limite inferior.' }], exclusions: [], approach: ['AVL.'], preconditions: [], sources } }, [curation]);
  const cases = make('cases', 'case_design', { testCases: [0, 1].map(value => ({ id: `CASE-${value}`, requirementIds: ['REQ-1'], ruleIds: ['RULE-1'],
    preconditions: [], setup: 'Abrir formulário de nova reserva.', pathId: null, data: { quantity: value },
    techniques: [{ name: 'AVL', description: 'Limite inferior e vizinho.', values: [value] }],
    expected: value === 0 ? 'Rejeitar sem criar reserva.' : 'Criar reserva.', sources })) }, [curation, plan]);
  const limits = { maxRequirements: 10, maxRevisions: 3, maxValidatorAttempts: 2, timeoutMs: 120000, activeMs: 2700000 };
  await store.create({ id: runId, ownerId: 'smoke-owner', name: 'SIMULAÇÃO — execução visual', applicationName: 'Reservas', createdAt: at,
    status: 'ready', phase: 'route_detail', input: { artifactIds: ['artifact'], startUrl: origin, credentialRef: 'credential', authorizedTarget: true,
      accessRevision: 1, accessProfile: 'Operador', dataPreparation: 'Formulário disponível; lista muda a cada caso válido.' },
    artifacts: [{ id: 'artifact', name: 'smoke.txt', version: '1', text }], outputs: [curation, plan, cases], validations: [], approvals: [],
    questions: [], answers: [], validationPolicy: {}, budgetCycles: [{ id: 'cycle', reason: 'initial_preparation', answerRef: null,
      startedAt: at, affectedCaseIds: [], limits }], preparation: { id: 'prep', budgetCycleId: 'cycle', startedAt: at,
      finishedAt: at, activeRole: null, activity: null, stopReason: null, limits, calls: [], accumulatedActiveMs: 0 } });
  await store.update(runId, record => { record.targetCredential = { ref: 'credential', username: 'demo', password: 'demo1234' }; return { save: true, value: undefined }; });

  async function openForm(browser) {
    const page = browser.page;
    const tool = async (name, params) => browser.tools.find(item => item.name === name).execute(randomUUID(), params, undefined);
    const paint = async () => {
      await page.bringToFront();
      await page.waitForFunction(() => performance.getEntriesByType('paint').length > 0);
      await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
    };
    // Coordenadas medidas pelo roteiro controlado, jamais expostas como ferramenta ao modelo.
    const click = async selector => {
      const point = await page.$eval(selector, element => {
        const rect = element.getBoundingClientRect();
        return { x: Math.round(window.screenX + rect.x + rect.width / 2 + window.outerWidth - window.innerWidth),
          y: Math.round(window.screenY + rect.y + rect.height / 2 + window.outerHeight - window.innerHeight) };
      });
      return tool('pointer', { action: 'click', ...point });
    };
    await paint();
    await click('input[name="user"]'); await tool('fill_credential', { field: 'username' });
    await click('input[name="password"]'); await tool('fill_credential', { field: 'password' });
    await click('button[type="submit"]'); await page.waitForURL(url => url.pathname === '/'); await paint();
    await click('nav a[href="/reservas"]'); await page.waitForURL(url => url.pathname === '/reservas'); await paint();
    await click('a[href="/reservas/nova"]'); await page.waitForURL(url => url.pathname === '/reservas/nova'); await paint();
    const initial = await tool('observe_screen', {});
    return { page, tool, click, paint, observationId: initial.details.observationId };
  }

  // Observação real do formulário para o mapa sintético aprovado desta fixture.
  session = await openBrowserSession({ startUrl: origin, allowedOrigins: [origin], credential: { username: 'demo', password: 'demo1234' },
    mediaDir, remainingActions: async () => 100, onObservation: observation => store.update(runId, record => {
      record.run.observations = [...(record.run.observations ?? []), observation]; return { save: true, value: undefined };
    }), onAction: action => store.update(runId, record => {
      record.run.mappingActions = [...(record.run.mappingActions ?? []), action]; return { save: true, value: undefined };
    }) });
  const mapped = await openForm(session);
  await session.close(); session = null;
  const mapping = make('map', 'mapping', { accessRevision: 1, authentication: { status: 'authenticated', observationId: mapped.observationId },
    map: { screens: [{ id: 'form', name: 'Nova reserva', recognition: 'Formulário de reserva autenticado.', observationIds: [mapped.observationId] }],
      transitions: [], paths: [{ id: 'form-path', startScreenId: 'form', transitionIds: [] }] }, pending: [], limitations: [] }, [curation, plan, cases]);
  const routes = make('routes', 'route_detail', { testCases: cases.payload.testCases.map(item => ({ ...item,
    pathId: 'form-path', approvedCaseRevision: { outputId: cases.id, revision: 1 } })), pending: [] }, [curation, plan, cases, mapping]);
  routes.accessRevision = 1;
  await store.update(runId, record => {
    const run = record.run; run.outputs.push(mapping, routes);
    run.validations = run.outputs.map(output => ({ outputId: output.id, outputRevision: 1, validator: 'output-validator',
      status: 'approved', reason: 'Parecer SIMULADO para fixture do smoke.', findings: [] }));
    run.approvals = [plan, cases].map(output => ({ id: randomUUID(), outputId: output.id, outputRevision: 1,
      actorId: 'smoke-owner', at, decision: 'approved', comment: 'Aprovação sintética explícita, somente smoke.' }));
    return { save: true, value: undefined };
  });
  let authorCalls = 0, validatorCalls = 0;
  const result = payload => ({ payload, metadata: { provider: 'substituted-smoke', model: 'deterministic', thinkingLevel: 'high', durationMs: 1 },
    calls: [{ at: new Date().toISOString(), durationMs: 1 }] });
  const visualCall = async task => {
    const input = JSON.parse(task.prompt);
    assert.doesNotMatch(task.prompt, /demo1234/);
    if (task.role === 'output-validator') {
      validatorCalls++;
      assert.equal(task.browser, undefined);
      assert.equal(task.kind, 'validate-test-result');
      assert.equal(task.images.length, 2);
      for (const [index, image] of task.images.entries()) {
        assert.ok(Buffer.from(image.data, 'base64').length > 10000, 'captura efetiva do display');
        assert.equal(input.manifest.observations[index].attemptId, input.attempt.id);
      }
      return result({ status: 'approved', reason: 'SIMULAÇÃO: execução confrontada pelo smoke com alvo controlado.', findings: [] });
    }
    authorCalls++;
    assert.equal(task.kind, 'execute-test-case');
    const active = (await store.read(runId)).run.executionAttempts.at(-1);
    assert.equal(active.id, input.attempt.id); assert.equal(active.status, 'running');
    session = await openBrowserSession(task.browser);
    try {
      const form = await openForm(session), before = target.reservations.length;
      await form.click('input[name="qty"]');
      await form.tool('keyboard_scroll', { kind: 'type', text: String(input.approvedCase.data.quantity) });
      await form.click('button[type="submit"]');
      await form.page.waitForURL(url => url.pathname === '/reservas'); await form.paint();
      const final = await form.tool('observe_screen', {});
      const quantity = input.approvedCase.data.quantity;
      const observed = await form.page.locator(quantity === 0 ? '.msg-error' : '.msg-success').innerText();
      assert.equal(target.reservations.length, before + (quantity === 0 ? 0 : 1));
      assert.equal(observed, quantity === 0 ? 'Quantidade inválida' : 'Reserva criada');
      return result({ setupObservation: 'Formulário autenticado observado antes de preencher.', observed,
        verdict: 'passed', reason: 'Comportamento esperado conferido no alvo controlado (conclusão SIMULADA).',
        evidenceIds: [form.observationId, final.details.observationId], evidenceGaps: [], question: null, reproduce: false });
    } finally { await session.close(); session = null; }
  };
  coordinator = new PreparationCoordinator(store, config, { visualCall, visualPreflight: async () => models });
  assert.deepEqual(await coordinator.continue(runId, 'smoke-owner', { outputId: routes.id, outputRevision: 1, expectedAccessRevision: 1 }), { accepted: true });
  await coordinator.settled();
  const persisted = (await store.read(runId)).run;
  assert.equal(persisted.status, 'ready', JSON.stringify(persisted.preparation.stopReason)); assert.equal(persisted.phase, 'execution');
  assert.equal(authorCalls, 2); assert.equal(validatorCalls, 2);
  assert.ok(persisted.executionAttempts.every(attempt => attempt.status === 'completed' && attempt.verdict === 'passed' && attempt.evidenceIds.length === 2));
  assert.equal(target.reservations.length, 1, 'rejeição inválida e criação válida sem duplicação');
  assert.ok(persisted.executionAttempts.every(attempt => attempt.events.length <= 50));
  assert.equal(persisted.observations.filter(observation => observation.attemptId).length, 4);
  assert.doesNotMatch(JSON.stringify(persisted), /demo1234/);
  const reopened = await new RunStore(directory).read(runId); assert.deepEqual(reopened.run, persisted);
  checked.push('tentativa-persistida-antes-acao', 'execucao-sequencial-real', 'rejeicao-esperada-passed', 'sucesso-passed',
    'duas-imagens-reais-por-caso', 'validacao-independente', 'segredo-ausente', 'persistencia-reaberta', 'cinquenta-acoes');
  if (process.env.SMOKE_ARTIFACT_DIR) {
    await mkdir(process.env.SMOKE_ARTIFACT_DIR, { recursive: true });
    for (const observation of persisted.observations.filter(item => item.attemptId)) {
      await writeFile(join(process.env.SMOKE_ARTIFACT_DIR, observation.assetId + '.png'), await readFile(join(mediaDir, observation.assetId + '.png')));
    }
  }
  console.log(JSON.stringify({ smoke: 'execution', llm: 'explicitly substituted; no paid calls', checked }));
  succeeded = true;
} finally {
  await session?.close();
  await coordinator?.settled();
  if (target.server.listening) { target.server.close(); await once(target.server, 'close'); }
  if (succeeded) await rm(directory, { recursive: true, force: true });
  else console.error('Dados privados preservados para diagnóstico do smoke:', directory);
}
