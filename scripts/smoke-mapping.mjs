// T8.2-R1 — Smoke de mapeamento: navegador, cursor, capturas, login, destinos e
// percurso até "Nova reserva" reais, com respostas de modelo substituídas
// explicitamente (SIMULAÇÃO identificada). Sem chamada paga de LLM.
// Executa na imagem final (Xvfb + Chromium + xdotool + ffmpeg), como o CI.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
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
const displayGeometry = execFileSync('xdotool', ['getdisplaygeometry'], { encoding: 'utf8' }).trim();
let browserSession;
let server;
let target;
let app;
let fixtureServer;

// DOM pronto não implica que o compositor já pintou no display do Xvfb.
// O roteiro aguarda a página controlada; a evidência continua vindo da tool
// real (ffmpeg/x11grab), com o mesmo critério mínimo de tamanho.
async function waitForPaint(page) {
  await page.bringToFront();
  await page.waitForFunction(() => performance.getEntriesByType('paint').some(entry => entry.name === 'first-contentful-paint'),
    null, { timeout: 10_000 });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

/** Ponto central de um elemento na geometria do display (imagem capturada = display),
 * medido sem deslocamento fixo: coordenadas da viewport mais a posição real da janela. */
async function screenPoint(page, selector) {
  const point = await page.evaluate(selector => {
    const element = document.querySelector(selector);
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      x: Math.round(window.screenX + rect.x + rect.width / 2 + (window.outerWidth - window.innerWidth)),
      y: Math.round(window.screenY + rect.y + rect.height / 2 + (window.outerHeight - window.innerHeight)),
    };
  }, selector);
  assert.ok(point, 'elemento ' + selector + ' visível');
  return point;
}
const headers = (cookie, userId, origin = undefined) => ({
  ...(origin ? { Origin: origin } : {}), 'Content-Type': 'application/json',
  ...(cookie ? { Cookie: cookie } : {}), 'X-Expected-User-Id': userId,
});

try {
  // Alvo T7 controlado em modo de referência.
  target = createDemoTarget({ port: 0, user: 'demo', password: 'demo1234', mode: 'reference' });
  target.server.listen(0, '127.0.0.1');
  await once(target.server, 'listening');
  const targetOrigin = 'http://127.0.0.1:' + target.server.address().port;

  // Página controlada para os testes de cursor/aba extra das ferramentas reais.
  fixtureServer = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html><html><title>alvos</title><body style="margin:0">
<button id="popup" style="position:absolute;left:60px;top:60px;width:140px;height:40px" onclick="window.open('/popup-extra')">Abrir popup</button>
<button id="alvo-a" style="position:absolute;left:30px;top:200px;width:14px;height:14px" onclick="document.title='alvo-a-clicado'"></button>
<button id="alvo-b" style="position:absolute;left:420px;top:420px;width:14px;height:14px" onclick="document.title='alvo-b-clicado'"></button>
</body></html>`);
  });
  fixtureServer.listen(0, '127.0.0.1');
  await once(fixtureServer, 'listening');
  const fixtureOrigin = 'http://127.0.0.1:' + fixtureServer.address().port;

  const config = readConfig({
    DATA_DIR: root, APP_ORIGIN: 'http://localhost:3000',
    TARGET_ALLOWED_ORIGINS: [targetOrigin, fixtureOrigin].join(','), PILOT_ALLOWED_EMAILS: 'smoke@example.test',
  });
  let executorCalls = 0;
  let validatorCalls = 0;
  // SIMULAÇÃO EXPLÍCITA: o roteiro abaixo substitui as respostas dos modelos.
  // Navegador, cursor, teclado, capturas, persistência, API e interface são reais.
  const visualCall = async (task) => {
    const input = JSON.parse(task.prompt);
    if (task.role === 'test-executor') {
      executorCalls++;
      assert.equal(input.task, 'map-application');
      assert.ok(input.access.startUrl);
      assert.ok(input.curation && input.plan, 'executor recebe curadoria e plano vigentes');
      assert.ok(input.approvedCases, 'executor recebe os casos aprovados');
      browserSession = await openBrowserSession(task.browser);
      const tool = name => browserSession.tools.find(item => item.name === name);
      const runTool = async (name, params) => {
        const result = await tool(name).execute('smoke-' + name, params, undefined);
        assert.ok(Array.isArray(result.content));
        return result;
      };
      // 1. Observa a tela de login (sem segredo visível ainda).
      await waitForPaint(browserSession.page);
      const loginShot = await runTool('observe_screen', {});
      assert.ok(loginShot.details.observationId, 'observação de login persistida');
      checked.push('observacao-login');
      // 2. Localiza os campos visualmente (medida feita pelo smoke, não pelo produto).
      const user = await screenPoint(browserSession.page, 'input[name="user"]');
      const password = await screenPoint(browserSession.page, 'input[name="password"]');
      const submit = await screenPoint(browserSession.page, 'button[type="submit"]');
      // 3. Foco errado não recebe segredo: sem digitar nada, FOCUS_MISMATCH.
      await assert.rejects(() => runTool('fill_credential', { field: 'username' }), /FOCUS_MISMATCH/);
      assert.equal(await browserSession.page.evaluate(() => document.querySelector('input[name="user"]').value), '', 'foco errado não digitou');
      checked.push('foco-incorreto-recusado-sem-digitar');
      // 4. Cliques reais por cursor e preenchimento privado da credencial.
      await runTool('pointer', { action: 'click', x: user.x, y: user.y });
      const fillUser = await runTool('fill_credential', { field: 'username' });
      assert.ok(fillUser.details.actionId);
      await runTool('pointer', { action: 'click', x: password.x, y: password.y });
      await runTool('fill_credential', { field: 'password' });
      checked.push('cursor-clique-preencher-credential');
      // 5. Captura insegura bloqueada: nada é salvo nem enviado ao modelo.
      const blockedCapture = await runTool('observe_screen', {});
      assert.equal(blockedCapture.details.blocked, true, 'captura com credencial visível bloqueada');
      assert.equal(blockedCapture.details.observationId, null);
      assert.ok(!blockedCapture.content.some(item => item.type === 'image'), 'nenhuma imagem enviada ao modelo');
      checked.push('captura-insegura-bloqueada');
      // 6. Envia o formulário pelo botão da própria página; a transição de login
      //    fica associada ao clique em Entrar (não ao preenchimento do usuário).
      const submitClick = await runTool('pointer', { action: 'click', x: submit.x, y: submit.y });
      await browserSession.page.waitForURL(url => new URL(url).pathname === '/', { timeout: 10000 });
      await waitForPaint(browserSession.page);
      const homeShot = await runTool('observe_screen', {});
      assert.ok(homeShot.details.observationId, 'observação da área autenticada persistida');
      checked.push('observacao-area-autenticada');
      // 7. Percurso real até Reservas → Nova reserva, sem confirmar nenhuma reserva.
      const reservasLink = await screenPoint(browserSession.page, 'nav a[href="/reservas"]');
      const reservasClick = await runTool('pointer', { action: 'click', x: reservasLink.x, y: reservasLink.y });
      await browserSession.page.waitForURL(url => new URL(url).pathname === '/reservas', { timeout: 10000 });
      await waitForPaint(browserSession.page);
      const reservasShot = await runTool('observe_screen', {});
      const novaLink = await screenPoint(browserSession.page, 'a[href="/reservas/nova"]');
      const novaClick = await runTool('pointer', { action: 'click', x: novaLink.x, y: novaLink.y });
      await browserSession.page.waitForURL(url => new URL(url).pathname === '/reservas/nova', { timeout: 10000 });
      await waitForPaint(browserSession.page);
      const novaShot = await runTool('observe_screen', {});
      assert.equal(target.reservations.length, 0, 'nenhuma reserva criada durante o mapeamento');
      checked.push('percurso-reservas-nova-reserva-sem-confirmar');
      // 8. Destino não habilitado é bloqueado antes do acesso, com motivo legível.
      //    A página após a navegação recusada não sustenta a verificação de
      //    privacidade: a captura fica bloqueada, sem imagem, por segurança.
      await browserSession.page.goto(BLOCKED_ORIGIN).catch(() => {});
      const blockedShot = await runTool('observe_screen', {});
      assert.equal(blockedShot.details.blocked, true, 'captura pós-navegação recusada bloqueada');
      assert.ok(!blockedShot.content.some(item => item.type === 'image'), 'nenhuma imagem enviada ao modelo');
      const blockedText = blockedShot.content.find(item => item.type === 'text').text;
      const blockedInfo = JSON.parse(blockedText);
      assert.ok(blockedInfo.blockedDestinations.includes(BLOCKED_ORIGIN), 'destino bloqueado com motivo legível');
      assert.ok(['CREDENTIAL_VISIBLE', 'PRIVACY_CHECK_FAILED'].includes(blockedInfo.blocked));
      assert.ok(!browserSession.page.url().startsWith(BLOCKED_ORIGIN), 'navegação bloqueada não vence');
      checked.push('destino-bloqueado');
      // 9. Mapa construído somente com identificadores devolvidos pelas tools.
      const payload = {
        authentication: { status: 'authenticated', observationId: homeShot.details.observationId },
        map: {
          screens: [
            { id: 'tela-login', name: 'Login', recognition: 'Formulário de usuário e senha.', observationIds: [loginShot.details.observationId] },
            { id: 'tela-inicio', name: 'Início', recognition: 'Menu principal após autenticar.', observationIds: [homeShot.details.observationId] },
            { id: 'tela-reservas', name: 'Reservas', recognition: 'Lista de reservas com link para nova reserva.', observationIds: [reservasShot.details.observationId] },
            { id: 'tela-nova-reserva', name: 'Nova reserva', recognition: 'Formulário de quantidade e comentário.', observationIds: [novaShot.details.observationId] },
          ],
          transitions: [
            { id: 'entrar', from: 'tela-login', actionId: submitClick.details.actionId, to: 'tela-inicio', observationIds: [homeShot.details.observationId] },
            { id: 'ir-para-reservas', from: 'tela-inicio', actionId: reservasClick.details.actionId, to: 'tela-reservas', observationIds: [reservasShot.details.observationId] },
            { id: 'nova-reserva', from: 'tela-reservas', actionId: novaClick.details.actionId, to: 'tela-nova-reserva', observationIds: [novaShot.details.observationId] },
          ],
          paths: [{ id: 'percurso-principal', startScreenId: 'tela-login', transitionIds: ['entrar', 'ir-para-reservas', 'nova-reserva'] }],
        },
        pending: [], limitations: ['Exploração limitada ao login, início, reservas e nova reserva neste smoke.'],
      };
      assert.notEqual(payload.map.transitions[0].actionId, fillUser.details.actionId, 'transição de login usa o clique em Entrar, não o preenchimento');
      await browserSession.close();
      browserSession = null;
      return { payload, metadata: { provider: 'deepseek', model: 'deepseek-flash', thinkingLevel: 'high', durationMs: 1 }, calls: [{ at: new Date().toISOString(), durationMs: 1 }] };
    }
    // SIMULAÇÃO: parecer do validador substituído; imagens e manifesto recebidos são reais.
    validatorCalls++;
    assert.equal(input.task, 'validation');
    assert.ok(input.curation && input.plan && input.approvedCases, 'validador recebe curadoria, plano e casos');
    assert.ok(Array.isArray(task.images) && task.images.length === 4, 'validador recebe as próprias imagens referenciadas');
    const manifest = input.manifest?.observations ?? [];
    assert.equal(manifest.length, task.images.length, 'manifesto com uma entrada por imagem');
    manifest.forEach((entry, index) => {
      assert.equal(entry.imageIndex, index, 'ordem do manifesto corresponde aos anexos');
      assert.ok(entry.observationId && entry.assetId && entry.at, 'manifesto identifica cada observação');
      assert.equal(entry.width, Number(displayGeometry.split(/\s+/)[0]), 'manifesto usa as dimensões reais do display');
      assert.equal(entry.height, Number(displayGeometry.split(/\s+/)[1]), 'manifesto usa as dimensões reais do display');
    });
    assert.ok(Array.isArray(input.actions) && input.actions.length === 3, 'validador recebe as ações das transições');
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
  // Conta real registrada pela API: o cookie e o ID retornados conduzem a jornada.
  const registered = await fetch(base + '/api/auth/register', {
    method: 'POST', headers: { Origin: config.appOrigin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Smoke Mapping', email: 'smoke@example.test', password: 'senha ficticia longa 1!' }),
  });
  const registeredText = await registered.text();
  assert.equal(registered.status, 201, registeredText);
  const account = JSON.parse(registeredText);
  const cookie = registered.headers.get('set-cookie').split(';')[0];
  const ownerId = account.user.id;
  checked.push('conta-registrada-pela-api');

  await store.create({
    id: runId, ownerId, name: 'Smoke de mapeamento', applicationName: 'Reservas', createdAt: at,
    status: 'awaiting_approval', phase: 'case_design',
    input: { credentialRef: 'cred-smoke', startUrl: targetOrigin + '/', accessProfile: 'Operador', dataPreparation: 'Nenhuma', authorizedTarget: true, accessRevision: 1, objective: 'Mapear a navegação.', artifactIds: ['artifact-1'] },
    artifacts: [{ id: 'artifact-1', name: 'historias.txt', version: '1', text: 'US-01: Fazer reservas.\nCA-01: Quantidade de 1 a 10.' }],
    outputs: [], validations: [], approvals: [], questions: [], answers: [], budgetCycles: [],
    validationPolicy: { maxValidationRevisions: 3, maxValidatorAttempts: 2, timeoutMs: 120000 },
  });

  // Recusas sem autenticação: a autenticação do produto não foi enfraquecida.
  let unauthenticated = await fetch(base + '/api/runs/' + runId, { headers: { 'X-Expected-User-Id': ownerId } });
  assert.equal(unauthenticated.status, 401, 'consulta sem sessão recusada');
  unauthenticated = await fetch(base + '/api/runs/' + runId + '/continue', {
    method: 'POST', headers: { Origin: config.appOrigin, 'Content-Type': 'application/json', 'X-Expected-User-Id': ownerId },
    body: JSON.stringify({ outputId: 'out-cases', outputRevision: 1, expectedAccessRevision: 1 }),
  });
  assert.equal(unauthenticated.status, 401, 'continuidade sem sessão recusada');
  checked.push('recusas-sem-autenticacao');

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
      { id: 'dec-plan', outputId: 'out-plan', outputRevision: 1, actorId: ownerId, at, decision: 'approved', comment: '' },
      { id: 'dec-cases', outputId: 'out-cases', outputRevision: 1, actorId: ownerId, at, decision: 'approved', comment: '' },
    );
    run.budgetCycles = [{ id: 'cycle-1', startedAt: '2026-09-25T11:58:00.000Z', reason: 'initial_preparation', answerRef: null, affectedCaseIds: [], limits: { ...limits } }];
    run.preparation = { id: 'prep-1', budgetCycleId: 'cycle-1', startedAt: '2026-09-25T11:58:00.000Z', finishedAt: at, activeRole: null, activity: null, stopReason: null, limits: { ...limits }, calls: [], accumulatedActiveMs: 60000, consumedAnswerIds: [] };
    return { save: true, value: null };
  });

  // Continuidade pelo HTTP real: reserva, intenção persistida e 202 antes do despacho.
  const continuation = await fetch(base + '/api/runs/' + runId + '/continue', {
    method: 'POST',
    headers: headers(cookie, ownerId, config.appOrigin),
    body: JSON.stringify({ outputId: 'out-cases', outputRevision: 1, expectedAccessRevision: 1 }),
  });
  assert.equal(continuation.status, 202, await continuation.text());
  const duplicate = await fetch(base + '/api/runs/' + runId + '/continue', {
    method: 'POST',
    headers: headers(cookie, ownerId, config.appOrigin),
    body: JSON.stringify({ outputId: 'out-cases', outputRevision: 1, expectedAccessRevision: 1 }),
  });
  assert.equal(duplicate.status, 200, 'repetição consulta o trabalho existente, sem novo navegador');
  checked.push('continuidade-202-repeticao-200');

  // Aguarda o mapa validado.
  let review;
  for (let attempt = 0; attempt < 400; attempt++) {
    const response = await fetch(base + '/api/runs/' + runId, { headers: headers(cookie, ownerId) });
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
  assert.equal(review.mapping.payload.map.screens.length, 4);
  assert.equal(review.mapping.payload.map.transitions.length, 3);
  assert.deepEqual(review.mapping.payload.map.paths[0].transitionIds, ['entrar', 'ir-para-reservas', 'nova-reserva']);
  // A transição de login está associada ao clique em Entrar, registrado como pointer.
  const loginTransition = review.mapping.payload.map.transitions[0];
  const loginAction = review.mappingActions.find(action => action.id === loginTransition.actionId);
  assert.equal(loginAction.tool, 'pointer');
  assert.equal(loginAction.params.action, 'click');
  assert.equal(review.observations.length, 4);
  // Observações usam as dimensões reais do display (imagem = cursor).
  const [geometryWidth, geometryHeight] = displayGeometry.split(/\s+/).map(Number);
  for (const observation of review.observations) {
    assert.equal(observation.width, geometryWidth);
    assert.equal(observation.height, geometryHeight);
  }
  assert.equal(executorCalls, 1);
  assert.equal(validatorCalls, 1);
  checked.push('mapa-validado-ready');

  // Histórico de chamadas: executor e validador persistidos com início e término.
  const stored = await store.read(runId);
  const mappingCalls = stored.run.preparation.calls.filter(call => call.phase === 'mapping' || call.phase === 'mapping_validation');
  assert.equal(mappingCalls.length, 2, 'chamadas do executor e do validador registradas');
  assert.ok(mappingCalls.every(call => call.status === 'completed' && call.startedAt && call.finishedAt && call.durationMs >= 0));
  checked.push('chamadas-persistidas');

  // Capturas reais servidas pela rota de evidência, com Cookie e X-Expected-User-Id.
  const evidence = await fetch(base + '/api/runs/' + runId + '/evidence/' + review.observations[0].assetId, { headers: headers(cookie, ownerId) });
  assert.equal(evidence.status, 200);
  assert.equal(evidence.headers.get('content-type'), 'image/png');
  const capture = Buffer.from(await evidence.arrayBuffer());
  if (artifactDir) {
    await mkdir(artifactDir, { recursive: true });
    await writeFile(join(artifactDir, 'login-display.png'), capture);
  }
  assert.ok(capture.length > 10000, 'captura real do display com ' + capture.length + ' bytes');
  const foreignEvidence = await fetch(base + '/api/runs/' + runId + '/evidence/' + review.observations[0].assetId, { headers: headers(undefined, ownerId) });
  assert.equal(foreignEvidence.status, 401, 'evidência sem sessão recusada');
  checked.push('evidencia-captura-real');

  // Segredo fora da projeção pública e das capturas persistidas.
  assert.ok(!JSON.stringify(stored.run).includes('demo1234'), 'projeção pública sem a senha do alvo');
  assert.equal(stored.targetCredential.password, 'demo1234', 'credencial privada resolvida só no backend');
  checked.push('segredo-fora-da-projecao');

  // ==== Ferramentas reais isoladas: aba única, popup bloqueado e alvos pequenos ====
  const fixtureSession = await openBrowserSession({
    startUrl: fixtureOrigin + '/', allowedOrigins: [fixtureOrigin], credential: null,
    mediaDir: join(root, 'media-fixture'),
    remainingActions: async () => 1000, onObservation: async () => {}, onAction: async () => {},
  });
  const fixtureTool = name => fixtureSession.tools.find(item => item.name === name);
  // Aba principal permanece; aba extra aberta pelo alvo é bloqueada.
  const popupPoint = await screenPoint(fixtureSession.page, '#popup');
  await fixtureTool('pointer').execute('smoke-popup', { action: 'click', x: popupPoint.x, y: popupPoint.y }, undefined);
  await fixtureSession.page.waitForTimeout(300);
  assert.equal(fixtureSession.page.context().pages().length, 1, 'aba principal permanece aberta e aba extra é bloqueada');
  checked.push('aba-principal-permanece-popup-bloqueado');
  // Cliques atingem alvos pequenos em posições distintas usando coordenadas da captura.
  for (const [selector, title] of [['#alvo-a', 'alvo-a-clicado'], ['#alvo-b', 'alvo-b-clicado']]) {
    const point = await screenPoint(fixtureSession.page, selector);
    await fixtureTool('pointer').execute('smoke-' + selector, { action: 'click', x: point.x, y: point.y }, undefined);
    await fixtureSession.page.waitForFunction(expected => document.title === expected, title, { timeout: 10000 });
  }
  checked.push('cliques-alvos-pequenos-coordenadas-da-captura');
  await fixtureSession.close();

  // ==== Capturas não consomem ações; observação final continua disponível ====
  const limitSession = await openBrowserSession({
    startUrl: targetOrigin + '/', allowedOrigins: [targetOrigin], credential: null,
    mediaDir: join(root, 'media-limit'),
    remainingActions: async () => 0, onObservation: async () => {}, onAction: async () => {},
  });
  const limitTool = name => limitSession.tools.find(item => item.name === name);
  const finalObservation = await limitTool('observe_screen').execute('smoke-limit-obs', {}, undefined);
  assert.ok(finalObservation.details.observationId, 'observação final segura disponível com ações esgotadas');
  await assert.rejects(() => limitTool('pointer').execute('smoke-limit-click', { action: 'click', x: 10, y: 10 }, undefined), /ACTION_LIMIT/);
  checked.push('captura-nao-consome-acao-limite-aplica-se-a-acoes');
  await limitSession.close();

  // ==== Verificação de privacidade indisponível bloqueia a captura ====
  const privacySession = await openBrowserSession({
    startUrl: targetOrigin + '/', allowedOrigins: [targetOrigin],
    credential: { username: 'demo', password: 'demo1234' }, mediaDir: join(root, 'media-privacy'),
    remainingActions: async () => 100, onObservation: async () => {}, onAction: async () => {},
  });
  const privacyTool = name => privacySession.tools.find(item => item.name === name);
  await privacySession.page.close().catch(() => {});
  const privacyBlocked = await privacyTool('observe_screen').execute('smoke-privacy', {}, undefined);
  assert.equal(privacyBlocked.details.blocked, true, 'verificação de privacidade indisponível bloqueia a captura');
  assert.ok(!privacyBlocked.content.some(item => item.type === 'image'), 'nada é enviado ao modelo');
  checked.push('privacidade-indisponivel-bloqueia-captura');
  await privacySession.close();

  if (artifactDir) {
    await mkdir(artifactDir, { recursive: true });
    for (const observation of review.observations.slice(0, 4)) {
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
  if (fixtureServer?.listening) { fixtureServer.close(); await once(fixtureServer, 'close'); }
  await rm(root, { recursive: true, force: true });
}
