// T8.2 — Smoke de mapeamento: navegador, cursor, capturas e destinos bloqueados reais
// com respostas de modelo substituídas explicitamente (SIMULAÇÃO identificada).
// Sem chamada paga de LLM. Executa na imagem final (Xvfb + Chromium + xdotool).
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../dist/app.js';
import { readConfig } from '../dist/config.js';
import { RunStore } from '../dist/storage/runs.js';
import { openBrowserSession } from '../agents/test-executor/tools/browser.mjs';
import { createDemoTarget } from './demo-target.mjs';

assert.equal(Number(process.versions.node.split('.')[0]), 24, 'Execute com Node.js 24.');
const root = await mkdtemp(join(tmpdir(), 'akcit-mapping-smoke-'));
const artifactDir = process.env.SMOKE_ARTIFACT_DIR;
const started = Date.now();
const checked = [];
const limits = { maxRequirements: 10, maxRevisions: 3, maxValidatorAttempts: 2, timeoutMs: 120000, activeMs: 2700000 };
const visualModels = {
  executor: { provider: 'deepseek', model: 'deepseek-flash', thinkingLevel: 'high' },
  'validator-visual': { provider: 'deepseek', model: 'deepseek-flash', thinkingLevel: 'high' },
};
const BLOCKED_ORIGIN = 'https://example.com';
let browserSession;
let server;
let target;
let app;

try {
  // Alvo T7 controlado em modo de referência.
  target = createDemoTarget({ port: 0, user: 'demo', password: 'demo1234', mode: 'reference' });
  target.server.listen(0, '127.0.0.1');
  await once(target.server, 'listening');
  const targetOrigin = 'http://127.0.0.1:' + target.server.address().port;

  const config = readConfig({
    DATA_DIR: root, APP_ORIGIN: 'http://localhost:3000',
    TARGET_ALLOWED_ORIGINS: targetOrigin, PILOT_ALLOWED_EMAILS: 'smoke@example.test',
  });
  let executorCalls = 0;
  let validatorCalls = 0;
  const visualCall = async (task) => {
    const input = JSON.parse(task.prompt);
    if (task.role === 'test-executor') {
      executorCalls++;
      // SIMULAÇÃO: o roteiro abaixo substitui a resposta do modelo; navegador e tools são reais.
      assert.equal(input.task, 'map-application');
      assert.ok(input.access.startUrl);
      browserSession = await openBrowserSession(task.browser);
      const tool = name => browserSession.tools.find(item => item.name === name);
      const runTool = async (name, params) => {
        const result = await tool(name).execute('smoke-' + name, params, undefined);
        assert.ok(Array.isArray(result.content));
        return result;
      };
      // 1. Observa a tela de login (sem segredo visível ainda).
      const loginShot = await runTool('observe_screen', {});
      assert.ok(loginShot.details.observationId, 'observação de login persistida');
      checked.push('observacao-login');
      // 2. Localiza os campos visualmente (medida feita pelo smoke, não pelo produto).
      const box = async selector => {
        const bounds = await browserSession.page.locator(selector).boundingBox();
        assert.ok(bounds, 'campo ' + selector + ' visível');
        return { x: Math.round(bounds.x + bounds.width / 2), y: Math.round(bounds.y + bounds.height / 2) };
      };
      const user = await box('input[name="user"]');
      const password = await box('input[name="password"]');
      const submit = await box('button[type="submit"]');
      // 3. Cliques reais por cursor e preenchimento privado da credencial.
      await runTool('pointer', { action: 'click', x: user.x, y: user.y });
      const fillUser = await runTool('fill_credential', { field: 'username' });
      assert.ok(fillUser.details.actionId);
      await runTool('pointer', { action: 'click', x: password.x, y: password.y });
      await runTool('fill_credential', { field: 'password' });
      await runTool('pointer', { action: 'click', x: submit.x, y: submit.y });
      checked.push('cursor-clique-preencher-credential');
      // 4. Aguarda a navegação real e observa a área autenticada.
      await browserSession.page.waitForURL(url => new URL(url).pathname === '/', { timeout: 10000 });
      const homeShot = await runTool('observe_screen', {});
      assert.ok(homeShot.details.observationId, 'observação da área autenticada persistida');
      checked.push('observacao-area-autenticada');
      // 5. Destino não habilitado é bloqueado antes do acesso, com motivo legível.
      await browserSession.page.goto(BLOCKED_ORIGIN).catch(() => {});
      const blockedShot = await runTool('observe_screen', {});
      const blockedText = blockedShot.content.find(item => item.type === 'text').text;
      assert.ok(JSON.parse(blockedText).blockedDestinations.includes(BLOCKED_ORIGIN), 'destino bloqueado com motivo legível');
      assert.ok(!browserSession.page.url().startsWith(BLOCKED_ORIGIN), 'navegação bloqueada não vence');
      checked.push('destino-bloqueado');
      // 6. Mapa construído somente com identificadores devolvidos pelas tools.
      const observationIds = [loginShot.details.observationId, homeShot.details.observationId];
      const payload = {
        authentication: { status: 'authenticated', observationId: homeShot.details.observationId },
        map: {
          screens: [
            { id: 'tela-login', name: 'Login', recognition: 'Formulário de usuário e senha.', observationIds: [loginShot.details.observationId] },
            { id: 'tela-inicio', name: 'Início', recognition: 'Menu principal após autenticar.', observationIds: [homeShot.details.observationId] },
          ],
          transitions: [{ id: 'entrar', from: 'tela-login', actionId: fillUser.details.actionId, to: 'tela-inicio', observationIds: [homeShot.details.observationId] }],
          paths: [{ id: 'percurso-login', startScreenId: 'tela-login', transitionIds: ['entrar'] }],
        },
        pending: [], limitations: ['Exploração limitada ao login e à tela inicial neste smoke.'],
      };
      await browserSession.close();
      browserSession = null;
      return { payload, metadata: { provider: 'deepseek', model: 'deepseek-flash', thinkingLevel: 'high', durationMs: 1 }, calls: [{ at: new Date().toISOString(), durationMs: 1 }] };
    }
    // SIMULAÇÃO: parecer do validador substituído; as imagens recebidas são reais.
    validatorCalls++;
    assert.equal(input.task, 'validation');
    assert.ok(Array.isArray(task.images) && task.images.length === 2, 'validador recebe as próprias imagens referenciadas');
    return { payload: { status: 'approved', reason: 'Mapa sustentado pelas capturas (parecer simulado).', findings: [] }, metadata: { provider: 'deepseek', model: 'deepseek-flash', thinkingLevel: 'high', durationMs: 1 }, calls: [{ at: new Date().toISOString(), durationMs: 1 }] };
  };
  app = await createApp(config, { visualCall, visualPreflight: async () => visualModels });
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  const base = 'http://127.0.0.1:' + app.address().port;
  const store = new RunStore(root);

  // Execução sintética no estado aprovado; acesso configurado com a credencial do alvo.
  const runId = 'run-mapping-smoke';
  const at = '2026-09-25T12:00:00.000Z';
  await store.create({
    id: runId, ownerId: 'smoke-owner', name: 'Smoke de mapeamento', applicationName: 'Reservas', createdAt: at,
    status: 'awaiting_approval', phase: 'case_design',
    input: { credentialRef: 'cred-smoke', startUrl: targetOrigin + '/', accessProfile: 'Operador', dataPreparation: 'Nenhuma', authorizedTarget: true, accessRevision: 1, objective: 'Mapear a navegação.', artifactIds: ['artifact-1'] },
    artifacts: [{ id: 'artifact-1', name: 'historias.txt', version: '1', text: 'US-01: Fazer reservas.\nCA-01: Quantidade de 1 a 10.' }],
    outputs: [], validations: [], approvals: [], questions: [], answers: [], budgetCycles: [],
    validationPolicy: { maxValidationRevisions: 3, maxValidatorAttempts: 2, timeoutMs: 120000 },
  });
  await store.update(runId, record => {
    record.targetCredential = { ref: 'cred-smoke', username: 'demo', password: 'demo1234' };
    const sources = [{ artifactId: 'artifact-1', locator: 'L1', quote: 'US-01: Fazer reservas.' }];
    const run = record.run;
    run.outputs.push(
      { id: 'out-curation', phase: 'curation', revision: 1, dependsOn: [], producer: 'artifact-curator', createdAt: at, answerRefs: [], payload: { requirements: [{ id: 'US-01', statement: 'Fazer reservas.', sources, rules: [{ id: 'CA-01', statement: 'Quantidade de 1 a 10.', sources }] }], questions: [] } },
      { id: 'out-plan', phase: 'planning', revision: 1, dependsOn: [{ outputId: 'out-curation', revision: 1 }], producer: 'test-designer', createdAt: at, answerRefs: [], payload: { testPlan: { objective: 'x', requirementIds: ['US-01'], ruleIds: ['CA-01'], priorities: [{ ruleId: 'CA-01', reason: 'x' }], exclusions: [], approach: ['x'], preconditions: [], sources } } },
      { id: 'out-cases', phase: 'case_design', revision: 1, dependsOn: [{ outputId: 'out-curation', revision: 1 }, { outputId: 'out-plan', revision: 1 }], producer: 'test-designer', createdAt: at, answerRefs: [], payload: { testCases: [{ id: 'CT-01', requirementIds: ['US-01'], ruleIds: ['CA-01'], preconditions: [], setup: 'x', pathId: null, data: { quantidade: 1 }, techniques: [{ name: 'AVL', description: 'x', values: [1] }], expected: 'x', sources }] } },
    );
    for (const outputId of ['out-curation', 'out-plan', 'out-cases']) run.validations.push({ outputId, outputRevision: 1, validator: 'output-validator', status: 'approved' });
    run.approvals.push(
      { id: 'dec-plan', outputId: 'out-plan', outputRevision: 1, actorId: 'smoke-owner', at, decision: 'approved', comment: '' },
      { id: 'dec-cases', outputId: 'out-cases', outputRevision: 1, actorId: 'smoke-owner', at, decision: 'approved', comment: '' },
    );
    run.budgetCycles = [{ id: 'cycle-1', startedAt: '2026-09-25T11:58:00.000Z', reason: 'initial_preparation', answerRef: null, affectedCaseIds: [], limits: { ...limits } }];
    run.preparation = { id: 'prep-1', budgetCycleId: 'cycle-1', startedAt: '2026-09-25T11:58:00.000Z', finishedAt: at, activeRole: null, activity: null, stopReason: null, limits: { ...limits }, calls: [], accumulatedActiveMs: 60000, consumedAnswerIds: [] };
    return { save: true, value: null };
  });

  // Continuidade pelo HTTP real: reserva, intenção persistida e 202 antes do despacho.
  const continuation = await fetch(base + '/api/runs/' + runId + '/continue', {
    method: 'POST',
    headers: { Origin: config.appOrigin, 'Content-Type': 'application/json', 'X-Expected-User-Id': 'smoke-owner' },
    body: JSON.stringify({ outputId: 'out-cases', outputRevision: 1, expectedAccessRevision: 1 }),
  });
  assert.equal(continuation.status, 202, await continuation.text());
  const duplicate = await fetch(base + '/api/runs/' + runId + '/continue', {
    method: 'POST',
    headers: { Origin: config.appOrigin, 'Content-Type': 'application/json', 'X-Expected-User-Id': 'smoke-owner' },
    body: JSON.stringify({ outputId: 'out-cases', outputRevision: 1, expectedAccessRevision: 1 }),
  });
  assert.equal(duplicate.status, 200, 'repetição consulta o trabalho existente, sem novo navegador');
  checked.push('continuidade-202-repeticao-200');

  // Aguarda o mapa validado.
  let review;
  for (let attempt = 0; attempt < 400; attempt++) {
    const response = await fetch(base + '/api/runs/' + runId, { headers: { 'X-Expected-User-Id': 'smoke-owner' } });
    assert.equal(response.status, 200);
    review = await response.json();
    if (review.status !== 'running') break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.equal(review.status, 'ready', JSON.stringify(review.stopReason));
  assert.equal(review.phase, 'mapping');
  assert.equal(review.mapping.revision, 1);
  assert.equal(review.mapping.validations[0].status, 'approved');
  assert.equal(review.mapping.payload.authentication.status, 'authenticated');
  assert.equal(review.mapping.payload.map.screens.length, 2);
  assert.equal(review.observations.length, 3);
  assert.equal(executorCalls, 1);
  assert.equal(validatorCalls, 1);
  checked.push('mapa-validado-ready');

  // Capturas reais servidas pela rota de evidência.
  const evidence = await fetch(base + '/api/runs/' + runId + '/evidence/' + review.observations[0].assetId, { headers: { 'X-Expected-User-Id': 'smoke-owner' } });
  assert.equal(evidence.status, 200);
  assert.equal(evidence.headers.get('content-type'), 'image/png');
  const capture = Buffer.from(await evidence.arrayBuffer());
  assert.ok(capture.length > 10000, 'captura real do display com ' + capture.length + ' bytes');
  checked.push('evidencia-captura-real');

  // Segredo fora da projeção pública e das capturas persistidas.
  const stored = await store.read(runId);
  assert.ok(!JSON.stringify(stored.run).includes('demo1234'), 'projeção pública sem a senha do alvo');
  assert.equal(stored.targetCredential.password, 'demo1234', 'credencial privada resolvida só no backend');
  checked.push('segredo-fora-da-projecao');

  if (artifactDir) {
    await mkdir(artifactDir, { recursive: true });
    for (const observation of review.observations.slice(0, 2)) {
      const file = join(root, 'media', runId, observation.assetId + '.png');
      const content = await readFile(file);
      await writeFile(join(artifactDir, observation.assetId + '.png'), content);
    }
  }
  const result = { status: 'passed', checked, simulated: ['resposta do executor substituída por roteiro de smoke', 'parecer do validador substituído por roteiro de smoke'], durationMs: Date.now() - started };
  if (process.env.SMOKE_RESULT_FILE) await writeFile(process.env.SMOKE_RESULT_FILE, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browserSession?.close().catch(() => {});
  await app?.shutdown();
  if (app?.listening) { app.close(); app.closeAllConnections(); await once(app, 'close'); }
  if (target?.server?.listening) { target.server.close(); await once(target.server, 'close'); }
  await rm(root, { recursive: true, force: true });
}