import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { createApp } from '../dist/app.js';
import { readConfig } from '../dist/config.js';
import { RunStore } from '../dist/storage/runs.js';

// Jornada real do site/API e coordenador. A chamada textual ao modelo é
// substituída aqui, na composição do teste, sem opção de simulação na API.
assert.equal(Number(process.versions.node.split('.')[0]), 24, 'Execute com Node.js 24.');
const root = await mkdtemp(join(tmpdir(), 'akcit-web-smoke-'));
const artifactDir = process.env.SMOKE_ARTIFACT_DIR;
const started = Date.now();
const checked = [];
const accounts = [
  { name: 'Pessoa de teste', email: 'web-one@example.test', password: 'Senha fictícia longa 2026!', teamName: 'Piloto sintético' },
  { name: 'Outra pessoa', email: 'web-two@example.test', password: 'Outra senha fictícia 2026!' },
];
const text = '  US-01: Como pessoa, quero reservar um item.\nCA-01: Aceitar de 1 a 10 itens.\n<script>globalThis.smokeInjected = true</script>\n  ';
const name = '<img src=x onerror="globalThis.smokeInjected=true"> Reservas';
const pendingName = 'Resposta perdida — recuperação';
const pendingText = '  US-02: Confirmar uma única execução.\nCA-02: Repetir sem duplicar.\n  ';
let server;
let browser;
let page;
let result;
let clock = Date.now();
let releaseResponse = () => {};
const preparationText = 'US-01: Como pessoa, quero reservar itens.\nCA-01: Quantidade inteira de 1 a 10.\nUS-02: Como pessoa, quero registrar uma observação.\nCA-02: Observação opcional com limite a definir.\nCA-03: A observação deve ser persistida; local de consulta a definir.';
const preparationCalls = [];
let holdPreparation = false;
let holdCaseValidation = false;
let holdRouteValidation = false;
let releasePreparation = () => {};
let preparationHeld = false;
async function waitForPreparationHeld() {
  const deadline = Date.now() + 10_000;
  while (!preparationHeld) {
    assert.ok(Date.now() < deadline, 'O modelo simulado deve iniciar antes de conferir/liberar sua chamada.');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

async function modelCall(task) {
  const input = JSON.parse(task.prompt);
  assert.equal(input.artifacts[0].text, preparationText, 'Cada especialista recebe o material original.');
  if (task.role === 'output-validator') assert.ok(input.output, 'Validador recebe a revisão exata da saída.');
  preparationCalls.push(task.role);
  if ((holdRouteValidation && task.role === 'output-validator' && input.output?.phase === 'route_detail') || holdPreparation || (holdCaseValidation && task.role === 'output-validator' && input.output.phase === 'case_design')) {
    await new Promise(resolve => {
      preparationHeld = true;
      releasePreparation = () => { preparationHeld = false; resolve(); };
      if (task.signal.aborted) resolve();
      else task.signal.addEventListener('abort', resolve, { once: true });
    });
  }
  const source = line => ({ artifactId: input.artifacts[0].id, locator: `L${line}`, quote: preparationText.split('\n')[line - 1] });
  const answer = id => input.answers?.filter(item => item.questionId === id).at(-1);
  const answerSource = item => {
    const artifact = input.artifacts.find(artifact => artifact.id === item.artifactId);
    assert.equal(artifact.text, item.text, 'Resposta vira fonte literal para cada especialista.');
    assert.equal(item.question.id, item.questionId, 'Resposta conserva a pergunta da revisão original.');
    return { artifactId: artifact.id, locator: `L1-L${artifact.text.split('\n').length}`, quote: artifact.text };
  };
  for (const item of input.answers ?? []) answerSource(item);
  const questions = [
    { id: 'Q-01', description: 'Qual é o limite da observação opcional?', requirementIds: ['US-02'], ruleIds: ['CA-02'], caseIds: [], blocking: true, sources: [source(4)] },
    { id: 'Q-02', description: 'Onde consultar a observação persistida?', requirementIds: ['US-02'], ruleIds: ['CA-03'], caseIds: [], blocking: true, sources: [source(5)] },
  ].filter(item => !answer(item.id));
  const resolvedRules = ['Q-01', 'Q-02'].flatMap((id, index) => answer(id) ? [`CA-0${index + 2}`] : []);
  const payload = task.task === 'detail-test-routes' ? { routes: input.approvedCases.payload.testCases.map((item, index) => ({
    caseId: item.id, pathId: index === 0 ? 'percurso-reservas' : null,
    reason: index === 0 ? null : 'O mapa não identifica o percurso de consulta da observação.' })) } : task.role === 'artifact-curator' ? {
    requirements: [
      { id: 'US-01', statement: 'Reservar itens.', sources: [source(1)],
        rules: [{ id: 'CA-01', statement: 'Quantidade inteira de 1 a 10.', sources: [source(2)] }] },
      { id: 'US-02', statement: 'Registrar uma observação.', sources: [source(3)],
        rules: ['Q-01', 'Q-02'].map((id, index) => ({ id: `CA-0${index + 2}`, kind: 'rule',
          statement: answer(id)?.text.trim() ?? preparationText.split('\n')[index + 3],
          sources: [source(index + 4), ...(answer(id) ? [answerSource(answer(id))] : [])] })) },
    ],
    questions,
  } : task.task === 'create-test-cases' ? { testCases: ['CA-01', ...resolvedRules].map((ruleId, index) => ({
    id: `CT-0${index + 1}`, requirementIds: [index === 0 ? 'US-01' : 'US-02'], ruleIds: [ruleId],
    preconditions: ['Uma reserva lógica está disponível para descrever os dados.'],
    setup: index === 0 ? '<svg data-smoke onload="globalThis.smokeInjected=true">Preparar os dados; nenhuma ação foi executada.</svg>' : 'Preparar uma observação para uma reserva.',
    pathId: null, data: index === 0 ? { quantidade: 1 } : { observacao: 'Exemplo controlado.' },
    techniques: [{ name: index === 0 ? 'AVL' : 'Cenário baseado no requisito',
      description: index === 0 ? '1 é o limite inferior inclusivo do domínio inteiro informado.' : 'Exercitar a observação descrita no esclarecimento.',
      values: index === 0 ? [1] : ['Exemplo controlado.'] }],
    expected: index === 0 ? 'A quantidade 1 está no intervalo permitido.' : answer(`Q-0${index}`).text.trim(),
    sources: [source(index === 0 ? 2 : index + 3), ...(index === 0 ? [] : [answerSource(answer(`Q-0${index}`))])],
  })) } : task.role === 'test-designer' ? { testPlan: {
    objective: 'Conferir reservas segundo os comportamentos esclarecidos.',
    requirementIds: ['US-01', ...(resolvedRules.length ? ['US-02'] : [])], ruleIds: ['CA-01', ...resolvedRules],
    priorities: ['CA-01', ...resolvedRules].map(ruleId => ({ ruleId, reason: 'Conferir o comportamento documentado.' })),
    exclusions: questions.map(question => ({ description: `US-02 / ${question.ruleIds[0]}: observação opcional.`, reason: `${question.id}: ${question.description}` })),
    approach: ['Análise dos limites 1 e 10, valores externos e quantidade não inteira; sem detalhar casos ou navegação.'],
    preconditions: ['Disponibilizar ambiente controlado antes da execução.'], sources: [source(1), source(2), source(4),
      ...(input.answers ?? []).map(answerSource)],
  } } : { status: 'approved', reason: 'O material e as pendências localizadas foram preservados.', findings: [] };
  return { payload, metadata: { provider: task.model.provider, model: task.model.model, durationMs: 1 } };
}

function waiting(id, ownerId, label) {
  return {
    id, ownerId, name: label, applicationName: 'Aplicação sintética de reservas',
    createdAt: new Date().toISOString(), status: 'awaiting_approval', phase: 'planning',
    input: { credentialRef: null }, artifacts: [], questions: [], answers: [],
    validationPolicy: {}, budgetCycles: [], approvals: [],
    outputs: [
      { id: 'curation', phase: 'curation', revision: 1, dependsOn: [], payload: {} },
      { id: 'plan', phase: 'planning', revision: 1, dependsOn: [{ outputId: 'curation', revision: 1 }],
        payload: { testPlan: {
          objective: 'Conferir os limites de reservas com dados fictícios.',
          requirementIds: ['US-01'], ruleIds: ['CA-01'],
          priorities: [{ ruleId: 'CA-01', reason: 'Limites da quantidade.' }],
          exclusions: [{ description: 'Pagamento', reason: 'Não faz parte do material recebido.' }],
          approach: ['Valores limite: 0, 1, 10 e 11.'], preconditions: ['Ambiente controlado disponível.'],
          sources: [{ artifactId: 'artifact-synthetic', locator: 'US-01 / CA-01',
            quote: '<svg data-smoke onload="globalThis.smokeInjected=true">Fonte literal</svg>' }],
        } } },
    ],
    validations: ['curation', 'plan'].map(outputId => ({
      outputId, outputRevision: 1, validator: 'output-validator', status: 'approved',
    })),
  };
}

// Sessões visuais substituídas explicitamente (SIMULAÇÃO identificada no resultado).
const visualModels = {
  executor: { provider: 'deepseek', model: 'deepseek-flash', thinkingLevel: 'high' },
  'validator-visual': { provider: 'deepseek', model: 'deepseek-flash', thinkingLevel: 'high' },
};
let visualCalls = 0;
async function visualCall(task) {
  visualCalls++;
  assert.ok(['test-executor', 'output-validator'].includes(task.role));
  const input = JSON.parse(task.prompt);
  const metadata = { provider: 'deepseek', model: 'deepseek-flash', thinkingLevel: 'high', durationMs: 1 };
  const calls = [{ at: new Date().toISOString(), durationMs: 1 }];
  if (task.role === 'test-executor') {
    assert.equal(input.task, 'map-application');
    assert.ok(input.approvedCases, 'Executor recebe os casos aprovados.');
    assert.equal(input.access.startUrl, 'https://alvo.exemplo.test');
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    await mkdir(task.browser.mediaDir, { recursive: true });
    const observations = [];
    for (const [index, name] of ['login', 'inicio', 'reservas'].entries()) {
      const observation = { id: 'obs-' + name, assetId: ('smoke-asset-' + (index + 1)).padEnd(21, '0'), at: new Date().toISOString(), width: 1366, height: 768 };
      await writeFile(join(task.browser.mediaDir, observation.assetId + '.png'), png);
      await task.browser.onObservation(observation);
      observations.push(observation);
    }
    const actions = [];
    for (const [index, name] of ['clicar-entrar', 'abrir-reservas'].entries()) {
      const action = { id: 'smoke-act-' + name, at: new Date().toISOString(), tool: 'pointer', params: { action: 'click', x: 10 + index, y: 20 + index }, outcome: 'ok' };
      await task.browser.onAction(action);
      actions.push(action);
    }
    const caseId = input.approvedCases.payload.testCases[0].id;
    const payload = {
      authentication: { status: 'authenticated', observationId: observations[1].id },
      map: {
        screens: [
          { id: 'tela-login', name: 'Login', recognition: 'Formulário de usuário e senha.', observationIds: [observations[0].id] },
          { id: 'tela-inicio', name: 'Início', recognition: 'Menu principal após autenticar.', observationIds: [observations[1].id] },
          { id: 'tela-reservas', name: 'Reservas', recognition: 'Lista de reservas.', observationIds: [observations[2].id] },
        ],
        transitions: [
          { id: 'entrar', from: 'tela-login', actionId: actions[0].id, to: 'tela-inicio', observationIds: [observations[1].id] },
          { id: 'abrir-reservas', from: 'tela-inicio', actionId: actions[1].id, to: 'tela-reservas', observationIds: [observations[2].id] },
        ],
        paths: [{ id: 'percurso-reservas', startScreenId: 'tela-login', transitionIds: ['entrar', 'abrir-reservas'] }],
      },
      pending: [{ id: 'pend-01', description: 'Caminho de nova reserva não percorrido nesta etapa.', affectedCaseIds: [caseId] }],
      limitations: ['Exploração limitada às telas principais; sem criar reservas.'],
    };
    return { payload, metadata, calls };
  }
  assert.equal(input.task, 'validation');
  assert.ok(Array.isArray(task.images) && task.images.length === 3, 'Validador recebe as próprias imagens referenciadas.');
  return { payload: { status: 'approved', reason: 'Mapa sustentado pelas imagens (simulado).', findings: [] }, metadata, calls };
}
async function visible(locator) { await locator.first().waitFor({ state: 'visible' }); }
async function bodyIncludes(value) { await visible(page.getByText(value, { exact: false })); }
async function history() {
  await page.getByRole('link', { name: 'Minhas execuções', exact: true }).first().click();
  await page.waitForURL('**/execucoes');
  await visible(page.getByRole('heading', { name: 'Minhas execuções', exact: true }));
}
async function login(account) {
  await page.getByLabel('E-mail', { exact: true }).fill(account.email);
  await page.getByLabel('Senha', { exact: true }).fill(account.password);
  return submitAccess(page, 'login', 'Entrar na conta');
}
async function register(account, targetPage = page) {
  await targetPage.getByRole('button', { name: 'Criar conta', exact: true }).click();
  await targetPage.getByLabel('Nome', { exact: true }).fill(account.name);
  await targetPage.getByLabel('E-mail', { exact: true }).fill(account.email);
  await targetPage.getByLabel('Senha', { exact: true }).fill(account.password);
  if (account.teamName) await targetPage.getByLabel('Nome da equipe (opcional)', { exact: true }).fill(account.teamName);
  return submitAccess(targetPage, 'register', 'Cadastrar e entrar');
}
async function submitAccess(targetPage, operation, label) {
  const path = `**/api/auth/${operation}`;
  let identity;
  const capture = async route => {
    const response = await route.fetch();
    assert.equal(response.status(), operation === 'register' ? 201 : 200);
    identity = (await response.json()).user; // Capturar antes da navegação, sem consultar /me.
    await route.fulfill({ response });
  };
  await targetPage.route(path, capture);
  try {
    await targetPage.getByRole('button', { name: label, exact: true }).click();
    await targetPage.waitForURL(url => url.pathname.startsWith('/execucoes'));
    // A navegação termina antes do boot assíncrono. Não desativar a interceptação
    // enquanto o novo documento ainda carrega o script, a sessão ou os dados.
    await visible(targetPage.getByRole('button', { name: 'Sair', exact: true }));
    await targetPage.waitForFunction(() => !document.querySelector('[aria-busy="true"]'));
    return identity;
  } finally { await targetPage.unroute(path, capture); }
}
async function fillRun(runName, content) {
  await page.getByLabel('Nome da execução', { exact: true }).fill(runName);
  await page.getByLabel('Aplicação', { exact: true }).fill('Reservas de exemplo');
  await page.getByLabel('Objetivo (opcional)', { exact: true }).fill('Verificar os limites documentados.');
  await page.getByLabel('Material de requisitos', { exact: true }).fill(content);
}
async function api(context, path, accountId) {
  assert.ok(accountId, 'A consulta conserva a identidade obtida no cadastro/login.');
  const response = await context.request.get(path, { headers: { 'X-Expected-User-Id': accountId } });
  assert.equal(response.status(), 200, `Consulta real ${path}`);
  return response.json();
}
async function noMarkup(scope = page) {
  assert.equal(await scope.locator('img, svg[data-smoke]').count(), 0, 'Conteúdo recebido deve ser texto.');
  assert.equal(await page.evaluate(() => globalThis.smokeInjected), undefined);
}
async function screenshot(filename, width) {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
  await page.evaluate(() => document.fonts.ready);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    `A página não deve transbordar horizontalmente em ${width}px.`);
  if (artifactDir) await page.screenshot({ path: join(artifactDir, filename), fullPage: true });
}

const attemptFor = accountId => page.evaluate(id => JSON.parse(sessionStorage.getItem(`akcit.intake.v1:${id}`)), accountId);
const sentAttempt = request => ({ accountId: request.headers()['x-expected-user-id'],
  key: request.headers()['idempotency-key'], body: request.postData() });

async function regressions(origin, store, owner, other) {
  const originalPage = page;
  for (const [name, scenario] of [['account', accountRace], ['logout', logoutRecovery], ['comment', commentRecovery]]) {
    if (process.env.SMOKE_REGRESSION && process.env.SMOKE_REGRESSION !== name) continue;
    clock += 15 * 60 * 1000 + 1; // Isolar os cenários dos contadores de login da jornada anterior.
    const context = await browser.newContext({ baseURL: origin });
    page = await context.newPage(); page.setDefaultTimeout(10000);
    try {
      await page.goto('/acesso');
      assert.equal((await login(accounts[0])).id, owner.id);
      await scenario(context, store, owner, other);
    } finally { releaseResponse(); await context.close(); page = originalPage; }
  }
}

async function accountRace(context, store, owner, other) {
  await page.goto('/execucoes/nova');
  await fillRun('Corrida entre contas', '  Material privado da conta A.\n  ');
  const second = await context.newPage();
  await second.goto('/execucoes');
  let captured;
  const oldSession = new Promise(resolve => { captured = resolve; });
  const hold = new Promise(resolve => { releaseResponse = resolve; });
  let held = false;
  await page.route('**/api/auth/me', async route => {
    if (held) return route.continue();
    held = true;
    const response = await route.fetch();
    assert.equal((await response.json()).user.id, owner.id);
    captured(); await hold; await route.fulfill({ response });
  });
  let runResult;
  await page.route('**/api/runs', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    const response = await route.fetch();
    // Ler antes de entregar: ACCOUNT_CHANGED navega e invalida o corpo no CDP.
    runResult = { body: await response.json(), original: sentAttempt(route.request()) };
    await route.fulfill({ response });
  });
  const response = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/api/runs'));
  await page.getByRole('button', { name: 'Salvar rascunho', exact: true }).click();
  await oldSession;
  // Login real na segunda aba: o cookie compartilhado muda depois de /me ter lido A.
  const loginB = await second.evaluate(async credentials => {
    const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(credentials) });
    return { status: response.status, body: await response.json() };
  }, { email: accounts[1].email, password: accounts[1].password });
  assert.equal(loginB.status, 200); assert.equal(loginB.body.user.id, other.id);
  const before = (await api(context, '/api/runs', other.id)).items;
  releaseResponse();
  const refused = await response;
  assert.equal(refused.status(), 409, 'Operação iniciada por A não pode salvar na sessão de B.');
  assert.equal(runResult.body.error.code, 'ACCOUNT_CHANGED');
  const original = runResult.original;
  assert.equal(original.accountId, owner.id);
  await page.waitForFunction(() => document.querySelector('#name')?.value === '');
  assert.deepEqual(await attemptFor(owner.id), original);
  assert.deepEqual((await api(context, '/api/runs', other.id)).items, before);
  const logout = await second.evaluate(async expected => {
    const response = await fetch('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Expected-User-Id': expected }, body: '{}' });
    return { status: response.status, body: await response.json() };
  }, owner.id);
  assert.equal(logout.status, 409); assert.equal(logout.body.error.code, 'ACCOUNT_CHANGED');
  assert.equal((await (await context.request.get('/api/auth/me')).json()).user.id, other.id);
  await visible(page.getByLabel('Nome da execução', { exact: true }));
  assert.equal(await page.getByLabel('Nome da execução', { exact: true }).inputValue(), '');
  assert.ok(!(await page.locator('body').innerText()).includes('Material privado da conta A.'));
  await second.evaluate(async credentials => {
    const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(credentials) });
    if (response.status !== 200) throw new Error('Login de A falhou.');
  }, { email: accounts[0].email, password: accounts[0].password });
  await page.reload();
  await visible(page.getByRole('button', { name: 'Tentar confirmar salvamento', exact: true }));
  assert.deepEqual(await attemptFor(owner.id), original);
  const recovered = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/api/runs'));
  await page.getByRole('button', { name: 'Tentar confirmar salvamento', exact: true }).click();
  const saved = await recovered;
  assert.equal(saved.status(), 201); assert.deepEqual(sentAttempt(saved.request()), original);
  assert.equal((await store.read(runResult.body.id)).run.ownerId, owner.id);
  await page.waitForURL(url => /^\/execucoes\/run-/.test(url.pathname));
  checked.push('BUG-T2.1-01: duas abas compartilham cookie; /me de A atrasado + login B → ACCOUNT_CHANGED, nenhum rascunho para B; logout divergente mantém B; A recupera chave/corpo/conta originais');
}

async function logoutRecovery(context, store, owner) {
  const sent = [];
  let loseSave = false;
  let savedId;
  await page.route('**/api/runs', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    sent.push(sentAttempt(route.request()));
    if (!loseSave) return route.continue();
    loseSave = false;
    const response = await route.fetch();
    assert.equal(response.status(), 201); savedId = (await response.json()).id;
    await route.abort('connectionreset');
  });
  const pending = async label => {
    await page.goto('/execucoes/nova');
    await fillRun(label, `  ${label}\nTexto literal preservado.  `);
    loseSave = true;
    await page.getByRole('button', { name: 'Salvar rascunho', exact: true }).click();
    await visible(page.getByRole('button', { name: 'Tentar confirmar salvamento', exact: true }));
    await bodyIncludes('O salvamento ainda não foi confirmado.');
    const attempt = await attemptFor(owner.id);
    assert.equal(attempt.accountId, owner.id);
    assert.equal(attempt.key, sent.at(-1).key);
    assert.equal(attempt.body, sent.at(-1).body);
    return attempt;
  };
  const original = await pending('Logout incerto conserva tentativa');
  for (const failure of ['503', 'network']) {
    await page.route('**/api/auth/logout', async route => {
      if (failure === 'network') return route.abort('connectionreset');
      return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'STORAGE_UNAVAILABLE' } }) });
    });
    await page.getByRole('button', { name: 'Sair', exact: true }).click();
    // Conferir a recuperação antes da mensagem também reproduz a exclusão prematura na base.
    assert.deepEqual(await attemptFor(owner.id), original, `Logout ${failure} não pode apagar a tentativa.`);
    await bodyIncludes('Não foi possível confirmar a saída. Sua tentativa de salvamento foi preservada.');
    await page.unroute('**/api/auth/logout');
    await page.reload();
    await visible(page.getByRole('button', { name: 'Tentar confirmar salvamento', exact: true }));
    assert.deepEqual(await attemptFor(owner.id), original);
  }
  await page.getByRole('button', { name: 'Tentar confirmar salvamento', exact: true }).click();
  await page.waitForURL(`**/execucoes/${savedId}`);
  await bodyIncludes('Material recebido. O processamento ainda não foi iniciado.');
  assert.deepEqual(sent.at(-1), original);
  assert.equal((await api(context, '/api/runs', owner.id)).items.filter(run => run.name === 'Logout incerto conserva tentativa').length, 1);
  assert.equal((await store.read(savedId)).run.artifacts[0].text, JSON.parse(original.body).text);

  const lostLogout = await pending('Resposta do logout perdida');
  await page.route('**/api/auth/logout', async route => {
    const response = await route.fetch(); assert.equal(response.status(), 204);
    await route.abort('connectionreset');
  });
  await page.getByRole('button', { name: 'Sair', exact: true }).click();
  await bodyIncludes('Não foi possível confirmar a saída. Sua tentativa de salvamento foi preservada.');
  assert.deepEqual(await attemptFor(owner.id), lostLogout);
  assert.equal((await context.request.get('/api/auth/me')).status(), 401);
  await page.unroute('**/api/auth/logout');
  await page.reload(); await page.waitForURL('**/acesso*');
  assert.ok(!(await page.locator('body').innerText()).includes('Texto literal preservado.'));
  assert.deepEqual(await attemptFor(owner.id), lostLogout);
  await login(accounts[0]);
  await visible(page.getByRole('button', { name: 'Tentar confirmar salvamento', exact: true }));
  assert.deepEqual(await attemptFor(owner.id), lostLogout);
  await page.getByRole('button', { name: 'Tentar confirmar salvamento', exact: true }).click();
  await page.waitForURL(`**/execucoes/${savedId}`);
  await bodyIncludes('Material recebido. O processamento ainda não foi iniciado.');
  assert.deepEqual(sent.at(-1), lostLogout);
  assert.equal((await api(context, '/api/runs', owner.id)).items.filter(run => run.name === 'Resposta do logout perdida').length, 1);

  await pending('Logout confirmado limpa tentativa');
  const confirmed = page.waitForResponse(response => response.url().endsWith('/api/auth/logout'));
  await page.getByRole('button', { name: 'Sair', exact: true }).click();
  assert.equal((await confirmed).status(), 204);
  await page.waitForURL('**/acesso*');
  assert.equal(await attemptFor(owner.id), null, 'pagehide não deve regravar a tentativa após 204.');
  assert.equal((await context.request.get('/api/auth/me')).status(), 401);
  await login(accounts[0]);
  const beforeDraft = sent.length;
  await page.goto('/execucoes/nova');
  await fillRun('Formulário ainda não enviado', '  Material sem chave de envio.  ');
  await page.reload();
  await visible(page.getByRole('button', { name: 'Salvar rascunho', exact: true }));
  assert.equal((await attemptFor(owner.id)).kind, 'draft');
  assert.equal(sent.length, beforeDraft, 'O formulário ainda não foi enviado.');
  await page.getByRole('button', { name: 'Sair', exact: true }).click();
  await page.waitForURL('**/acesso*');
  assert.equal(await attemptFor(owner.id), null, 'Formulário sem chave também não pode reaparecer por pagehide após 204.');
  await login(accounts[0]);
  const retained = await pending('Logout confirmado com limpeza indisponível');
  await page.evaluate(() => { Storage.prototype.removeItem = () => { throw new DOMException('Falha sintética de limpeza', 'SecurityError'); }; });
  // Mesmo sem conseguir reconsultar a sessão na página de acesso, o aviso local deve aparecer.
  await page.route('**/api/auth/me', route => route.abort('connectionreset'));
  const cleanFailure = page.waitForResponse(response => response.url().endsWith('/api/auth/logout'));
  await page.getByRole('button', { name: 'Sair', exact: true }).click();
  assert.equal((await cleanFailure).status(), 204);
  await bodyIncludes(/limpar|limpeza/i);
  assert.equal(await page.getByRole('button', { name: 'Sair', exact: true }).count(), 0);
  assert.equal(await page.getByLabel('Material de requisitos', { exact: true }).count(), 0);
  assert.equal((await context.request.get('/api/auth/me')).status(), 401);
  assert.deepEqual(await attemptFor(owner.id), retained);
  await page.evaluate(() => dispatchEvent(new Event('pagehide')));
  assert.deepEqual(await attemptFor(owner.id), retained);
  checked.push('BUG-T2.1-01: logout 503/rede conserva conta/chave/corpo após reload; repetir encontra execução original; logout com resposta perdida mantém recuperação e sessão inválida oculta material');
  checked.push('BUG-T2.1-01: logout 204 limpa recuperação sem regravação por pagehide; falha de limpeza após 204 mantém saída confirmada e informa problema local');
}

async function commentRecovery(context, store, owner) {
  const literal = '  Incluir CA-02.\n  <b>Comentário literal da revisão 1</b>  \n';
  for (const mode of ['before', 'query', 'after', 'revision', 'conflict']) {
    const id = `recovery-comment-${mode}`;
    await store.create(waiting(id, owner.id, `Recuperação do comentário ${mode}`));
    await page.goto(`/execucoes/${id}`);
    await page.getByLabel('Comentário', { exact: true }).fill(literal);
    let posts = 0; let failQuery = mode === 'query';
    await page.route(`**/api/runs/${id}`, async route => {
      if (failQuery) { failQuery = false; return route.abort('connectionreset'); }
      return route.continue();
    });
    await page.route(`**/api/runs/${id}/request-changes`, async route => {
      posts++;
      assert.equal(route.request().postDataJSON().comment, literal);
      if (posts > 1) return route.continue();
      if (mode === 'after') { const response = await route.fetch(); assert.equal(response.status(), 200); }
      if (mode === 'revision') {
        await store.update(id, record => {
          record.run.outputs.push({ ...structuredClone(record.run.outputs[1]), revision: 2 });
          record.run.validations.push({ outputId: 'plan', outputRevision: 2, validator: 'output-validator', status: 'approved' });
          return { save: true, value: null };
        });
      }
      if (mode === 'conflict') {
        const response = await context.request.post(`/api/runs/${id}/approve`, { headers: { Origin: new URL(page.url()).origin, 'X-Expected-User-Id': owner.id }, data: { outputId: 'plan', outputRevision: 1 } });
        assert.equal(response.status(), 200);
      }
      await route.abort('connectionreset');
    });
    await page.getByRole('button', { name: 'Solicitar alterações', exact: true }).click();
    if (mode === 'query') {
      await visible(page.getByRole('button', { name: 'Tentar novamente', exact: true }));
      assert.equal(posts, 1);
      assert.equal(await page.getByLabel('Comentário preservado da revisão 1', { exact: true }).inputValue(), literal);
      await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
    }
    if (mode === 'before' || mode === 'query') {
      await bodyIncludes('Não foi possível confirmar a decisão pela resposta.');
      await visible(page.getByLabel('Comentário', { exact: true }));
      assert.equal(await page.getByLabel('Comentário', { exact: true }).inputValue(), literal, `Comentário literal preservado após ${mode}.`);
      assert.deepEqual((await api(context, `/api/runs/${id}`, owner.id)).approvals, []);
      assert.equal(posts, 1, 'Consulta de recuperação não pode reenviar a decisão.');
      await page.getByRole('button', { name: 'Solicitar alterações', exact: true }).click();
      await visible(page.getByText('Alterações solicitadas · Revisão 1', { exact: true }));
      assert.equal(posts, 2, 'Somente nova ação explícita repete o POST.');
    } else if (mode === 'after') {
      await visible(page.getByText('Alterações solicitadas · Revisão 1', { exact: true }));
      assert.equal(posts, 1);
      assert.equal(await page.getByLabel('Comentário', { exact: true }).count(), 0);
      assert.equal(await page.getByLabel('Comentário preservado da revisão 1', { exact: true }).count(), 0);
      assert.equal(await page.locator('p.text-content').filter({ hasText: 'Comentário literal da revisão 1' }).count(), 1, 'Somente a decisão confirmada deve permanecer.');
    } else {
      await bodyIncludes(mode === 'revision' ? 'Plano de testes / Revisão 2' : 'Plano aprovado · Revisão 1');
      const copy = page.getByLabel('Comentário preservado da revisão 1', { exact: true });
      await visible(copy);
      assert.equal(await copy.inputValue(), literal, 'Comentário da revisão original fica disponível literalmente para leitura/cópia.');
      assert.equal(await copy.getAttribute('readonly'), '');
      await bodyIncludes(/comentário.*revisão 1|revisão 1.*comentário/i);
      if (mode === 'revision') assert.equal(await page.getByLabel('Comentário', { exact: true }).inputValue(), '', 'Revisão nova não recebe comentário antigo.');
      if (mode === 'conflict') {
        failQuery = true;
        await page.getByRole('button', { name: 'Atualizar consulta', exact: true }).click();
        await visible(page.getByRole('button', { name: 'Tentar novamente', exact: true }));
        assert.equal(await copy.inputValue(), literal);
        await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
        await bodyIncludes('Plano aprovado · Revisão 1');
        assert.equal(await copy.inputValue(), literal);
      }
      assert.equal(posts, 1);
    }
    const approvals = (await api(context, `/api/runs/${id}`, owner.id)).approvals;
    assert.equal(approvals.length, mode === 'revision' ? 0 : 1);
    if (['before', 'query', 'after'].includes(mode)) assert.equal(approvals[0].comment, literal);
    await page.unroute(`**/api/runs/${id}`);
    await page.unroute(`**/api/runs/${id}/request-changes`);
  }
  checked.push('BUG-T2.1-01: comentário literal preservado após falha antes da gravação e na reconsulta; nova ação explícita registra uma única decisão');
  checked.push('BUG-T2.1-01: resposta de decisão perdida após gravação recupera confirmação sem novo POST; revisão nova/conflito preservam cópia da revisão original sem preencher revisão nova');
}

async function preparationJourney(context, store, owner) {
  const createDraft = async label => {
    await page.goto('/execucoes/nova');
    await fillRun(label, preparationText);
    await page.getByRole('button', { name: 'Salvar rascunho', exact: true }).click();
    await page.waitForURL(url => /^\/execucoes\/run-/.test(url.pathname));
    await visible(page.getByRole('button', { name: 'Preparar plano', exact: true }));
    const id = new URL(page.url()).pathname.split('/').at(-1);
    return id;
  };
  const begin = async id => {
    const response = page.waitForResponse(response => response.url().endsWith(`/api/runs/${id}/start`));
    await page.getByRole('button', { name: 'Preparar plano', exact: true }).click();
    const accepted = await response;
    assert.equal(accepted.status(), 202);
    assert.equal(accepted.request().headers()['x-expected-user-id'], owner.id);
    assert.deepEqual(accepted.request().postDataJSON(), {});
    await visible(page.getByRole('button', { name: 'Cancelar preparação', exact: true }));
    await bodyIncludes('Curador');
    await waitForPreparationHeld();
  };

  const id = await createDraft('Preparação do plano pelo site');
  holdPreparation = true;
  await begin(id);
  await screenshot('web-preparation.png', 1366);
  const repeated = await context.request.post(`/api/runs/${id}/start`, {
    headers: { Origin: new URL(page.url()).origin, 'X-Expected-User-Id': owner.id }, data: {},
  });
  assert.equal(repeated.status(), 200);
  assert.deepEqual(preparationCalls, ['artifact-curator']);
  holdPreparation = false; releasePreparation();
  await visible(page.getByRole('button', { name: 'Aprovar plano', exact: true }));
  assert.deepEqual(preparationCalls, ['artifact-curator', 'output-validator', 'test-designer', 'output-validator']);
  await bodyIncludes('Qual é o limite da observação opcional?');
  await bodyIncludes('US-02 / CA-02: observação opcional.');
  assert.equal(await page.getByRole('button', { name: 'Cancelar preparação', exact: true }).count(), 0);
  const review = await api(context, `/api/runs/${id}`, owner.id);
  assert.equal(review.status, 'awaiting_approval'); assert.equal(review.phase, 'planning');
  assert.equal(review.questions.length, 2); assert.deepEqual(review.approvals, []);
  assert.deepEqual(review.plan.payload.testPlan.requirementIds, ['US-01']);
  const persisted = (await store.read(id)).run;
  assert.equal(persisted.outputs.length, 2);
  for (const output of persisted.outputs) assert.ok(persisted.validations.some(verdict =>
    verdict.outputId === output.id && verdict.outputRevision === output.revision && verdict.status === 'approved'));
  let detailQueries = 0;
  const counted = request => { if (request.method() === 'GET' && new URL(request.url()).pathname === `/api/runs/${id}`) detailQueries++; };
  page.on('request', counted);
  await page.getByLabel('Comentário', { exact: true }).fill('Comentário em edição preservado.');
  await new Promise(resolve => setTimeout(resolve, 2400)); // Atravessa um ciclo de consulta de 2 s.
  assert.equal(detailQueries, 0, 'A consulta periódica termina antes da revisão humana.');
  assert.equal(await page.getByLabel('Comentário', { exact: true }).inputValue(), 'Comentário em edição preservado.');
  page.off('request', counted);
  await screenshot('web-generated-plan.png', 1366);

  const answerForm = questionId => page.locator('form').filter({ has: page.getByLabel(`Resposta para ${questionId}`, { exact: true }) });
  const firstAnswer = '  A observação é opcional e aceita até 120 caracteres.\n  ';
  const localAnswer = '  Minha resposta ainda não registrada.\n  ';
  const concurrentAnswer = 'A observação pode ser consultada nos detalhes da reserva.';
  await page.getByLabel('Resposta para Q-01', { exact: true }).fill(firstAnswer);
  await page.getByLabel('Resposta para Q-02', { exact: true }).fill(localAnswer);
  const answerResponse = page.waitForResponse(response => response.url().endsWith(`/api/runs/${id}/answer`));
  await answerForm('Q-01').getByRole('button', { name: 'Registrar resposta', exact: true }).click();
  assert.equal((await answerResponse).status(), 200);
  await bodyIncludes('Resposta registrada. Confira as demais dúvidas antes de retomar.');
  assert.equal(await page.getByLabel('Resposta para Q-02', { exact: true }).inputValue(), localAnswer);
  assert.equal(await page.getByLabel('Comentário preservado da revisão 1', { exact: true }).inputValue(), 'Comentário em edição preservado.');
  assert.equal(await page.getByRole('button', { name: 'Aprovar plano', exact: true }).count(), 0);
  const answered = await api(context, `/api/runs/${id}`, owner.id);
  assert.equal(answered.status, 'awaiting_input'); assert.equal(answered.phase, 'curation');
  assert.equal(answered.canResume, true); assert.equal(answered.answers[0].text, firstAnswer);
  assert.equal((await store.read(id)).run.artifacts[0].text, preparationText);
  const headers = { Origin: new URL(page.url()).origin, 'X-Expected-User-Id': owner.id };
  const oldGate = await context.request.post(`/api/runs/${id}/approve`, { headers,
    data: { outputId: review.plan.id, outputRevision: review.plan.revision } });
  assert.equal(oldGate.status(), 409, 'Resposta invalida a aprovação do plano anterior antes da retomada.');
  let resumes = 0;
  const countResume = request => { if (request.method() === 'POST' && request.url().endsWith(`/api/runs/${id}/resume`)) resumes++; };
  page.on('request', countResume);
  await page.getByRole('button', { name: 'Retomar preparação com as respostas', exact: true }).click();
  await bodyIncludes('Há uma resposta digitada que ainda não foi registrada.');
  assert.equal(resumes, 0, 'Texto pendente não pode ser perdido ao retomar.');
  assert.equal(preparationCalls.length, 4, 'Salvar resposta não dispara inferência.');

  // Envio concorrente da mesma conta registra Q-02 antes do formulário local.
  const concurrent = await context.request.post(`/api/runs/${id}/answer`, { headers,
    data: { outputId: review.curation.id, outputRevision: review.curation.revision, questionId: 'Q-02', text: concurrentAnswer } });
  assert.equal(concurrent.status(), 200);
  const conflictResponse = page.waitForResponse(response => response.url().endsWith(`/api/runs/${id}/answer`));
  await answerForm('Q-02').getByRole('button', { name: 'Registrar resposta', exact: true }).click();
  assert.equal((await conflictResponse).status(), 409);
  await page.getByRole('button', { name: 'Consultar registro atualizado', exact: true }).click();
  const preserved = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Texto não enviado · Q-02 · Curadoria r1', exact: true }) });
  await visible(preserved);
  assert.equal(await preserved.locator('blockquote').textContent(), localAnswer);
  assert.equal((await api(context, `/api/runs/${id}`, owner.id)).answers.length, 2);
  await page.getByRole('button', { name: 'Retomar preparação com as respostas', exact: true }).click();
  await bodyIncludes('Há uma resposta digitada que ainda não foi registrada.');
  assert.equal(resumes, 0);
  await preserved.getByRole('button', { name: 'Descartar este texto não enviado', exact: true }).click();

  holdPreparation = true;
  const resumeResponse = page.waitForResponse(response => response.url().endsWith(`/api/runs/${id}/resume`));
  await page.getByRole('button', { name: 'Retomar preparação com as respostas', exact: true }).click();
  const resumedResponse = await resumeResponse;
  assert.equal(resumedResponse.status(), 202);
  assert.deepEqual(resumedResponse.request().postDataJSON(), {});
  assert.equal(resumedResponse.request().headers()['x-expected-user-id'], owner.id);
  await visible(page.getByRole('button', { name: 'Cancelar preparação', exact: true }));
  await waitForPreparationHeld();
  holdPreparation = false; releasePreparation();
  await visible(page.getByRole('button', { name: 'Aprovar plano', exact: true }));
  await bodyIncludes('Plano de testes / Revisão 2');
  assert.equal(await page.getByLabel('Comentário', { exact: true }).inputValue(), '', 'Não aplicar comentário da revisão antiga na revisão nova.');
  assert.equal(await page.getByLabel('Comentário preservado da revisão 1', { exact: true }).inputValue(), 'Comentário em edição preservado.');
  const resumed = await api(context, `/api/runs/${id}`, owner.id);
  assert.equal(resumed.curation.id, review.curation.id); assert.equal(resumed.curation.revision, 2);
  assert.equal(resumed.plan.id, review.plan.id); assert.equal(resumed.plan.revision, 2);
  assert.deepEqual(resumed.questions, []); assert.deepEqual(resumed.approvals, []);
  assert.deepEqual(resumed.plan.payload.testPlan.ruleIds, ['CA-01', 'CA-02', 'CA-03']);
  assert.equal(preparationCalls.length, 8); assert.equal(resumes, 1); page.off('request', countResume);
  await screenshot('web-clarified-plan.png', 1366);
  await page.getByRole('button', { name: 'Aprovar plano', exact: true }).click();
  await visible(page.getByText('Plano aprovado · Revisão 2', { exact: true }));
  const approved = await api(context, `/api/runs/${id}`, owner.id);
  assert.equal(approved.approvals.length, 1); assert.equal(approved.approvals[0].outputRevision, 2);
  assert.equal(preparationCalls.length, 8, 'A aprovação do plano não inicia a geração automaticamente.');
  holdPreparation = true; holdCaseValidation = true;
  const continuation = page.waitForResponse(response => response.url().endsWith(`/api/runs/${id}/continue`));
  await page.getByRole('button', { name: 'Gerar casos de teste', exact: true }).click();
  const acceptedCases = await continuation;
  assert.equal(acceptedCases.status(), 202);
  assert.equal(acceptedCases.request().headers()['x-expected-user-id'], owner.id);
  assert.deepEqual(acceptedCases.request().postDataJSON(), { outputId: approved.plan.id, outputRevision: 2 });
  await bodyIncludes('Gerando casos de teste');
  await waitForPreparationHeld();
  const repeatedCases = await context.request.post(`/api/runs/${id}/continue`, { headers,
    data: { outputId: approved.plan.id, outputRevision: 2 } });
  assert.equal(repeatedCases.status(), 200);
  assert.equal(preparationCalls.length, 9, 'Repetir a continuidade não duplica geração.');
  holdPreparation = false; releasePreparation();
  await bodyIncludes('Validando os casos de teste');
  await waitForPreparationHeld();
  await bodyIncludes('Conteúdo provisório — a validação desta revisão ainda não foi aprovada.');
  holdCaseValidation = false; releasePreparation();
  await bodyIncludes('Conjunto validado. Disponível para revisão humana');
  await bodyIncludes('Casos lógicos — percurso ainda não mapeado.');
  await page.getByText('CT-01 · CA-01', { exact: true }).click();
  await bodyIncludes('1 é o limite inferior inclusivo do domínio inteiro informado.');
  await noMarkup();
  const cases = await api(context, `/api/runs/${id}`, owner.id);
  assert.equal(cases.status, 'awaiting_approval'); assert.equal(cases.phase, 'case_design');
  assert.equal(cases.cases.revision, 1); assert.equal(cases.cases.current, true);
  assert.equal(cases.cases.validations[0].status, 'approved');
  assert.equal(cases.cases.payload.testCases.length, 3);
  assert.ok(cases.cases.payload.testCases.every(item => item.pathId === null));
  assert.equal(preparationCalls.length, 10);
  const savedCases = (await store.read(id)).run.outputs.find(output => output.phase === 'case_design');
  assert.deepEqual(savedCases.payload, cases.cases.payload);
  await screenshot('web-cases.png', 1366); await screenshot('web-cases-mobile.png', 390);
  await page.reload(); await bodyIncludes('Conjunto validado. Disponível para revisão humana');
  assert.equal(await page.getByRole('button', { name: 'Gerar casos de teste', exact: true }).count(), 0);

  // T6.2: Verificações de decisão humana sobre os casos de teste
  await visible(page.getByRole('button', { name: 'Aprovar casos de teste', exact: true }));
  await visible(page.getByRole('button', { name: 'Solicitar alterações nos casos', exact: true }));
  await visible(page.getByLabel('Comentário sobre os casos', { exact: true }));
  await screenshot('web-cases-review.png', 1366); await screenshot('web-cases-review-mobile.png', 390);

  // CA-02: validação de comentário obrigatório ao solicitar alterações
  await page.getByRole('button', { name: 'Solicitar alterações nos casos', exact: true }).click();
  await bodyIncludes('Informe um comentário para solicitar alterações.');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'case-comment');

  // CA-08: recuperação de falha de rede/resposta incerta preserva comentário
  const caseCommentText = 'Revisar o resultado esperado do caso CT-03.';
  await page.getByLabel('Comentário sobre os casos', { exact: true }).fill(caseCommentText);
  let casePosts = 0;
  const countCasePosts = request => {
    if (request.method() === 'POST' && /\/(approve|request-changes)$/.test(new URL(request.url()).pathname)) casePosts++;
  };
  page.on('request', countCasePosts);
  await page.route(`**/api/runs/${id}/request-changes`, async route => {
    assert.equal(route.request().headers()['x-expected-user-id'], owner.id);
    assert.deepEqual(route.request().postDataJSON(), { outputId: savedCases.id, outputRevision: 1, comment: caseCommentText });
    await route.abort('connectionreset');
  });
  await page.getByRole('button', { name: 'Solicitar alterações nos casos', exact: true }).click();
  await bodyIncludes('Não foi possível confirmar a decisão pela resposta.');
  assert.equal(await page.getByLabel('Comentário sobre os casos', { exact: true }).inputValue(), caseCommentText);
  const editedComment = '  B: Revisar também os dados do CT-03.\n  ';
  await page.getByLabel('Comentário sobre os casos', { exact: true }).fill(editedComment);
  await page.getByRole('button', { name: 'Atualizar consulta', exact: true }).click();
  await visible(page.getByLabel('Comentário sobre os casos', { exact: true }));
  assert.equal(await page.getByLabel('Comentário sobre os casos', { exact: true }).inputValue(), editedComment,
    'CA-01: atualizar a consulta preserva B, não restaura A.');
  assert.equal(casePosts, 1, 'A consulta não reenvia nenhuma decisão.');
  assert.deepEqual((await api(context, `/api/runs/${id}`, owner.id)).approvals, cases.approvals);
  checked.push('BUG-T6.2-01 CA-01: falha antes da gravação → editar A para B → atualizar consulta conserva B literal, sem novo POST');
  await page.unroute(`**/api/runs/${id}/request-changes`);

  // CA-01: Aprovação dos casos de teste pelo site
  await page.getByRole('button', { name: 'Aprovar casos de teste', exact: true }).click();
  await bodyIncludes('Casos aprovados. Configure o acesso à aplicação antes do mapeamento.');
  await screenshot('web-cases-approved.png', 1366); await screenshot('web-cases-approved-mobile.png', 390);

  // CA-05: persistência após recarregar página
  await page.reload();
  await bodyIncludes('Casos aprovados. Configure o acesso à aplicação antes do mapeamento.');
  assert.equal(await page.getByRole('button', { name: 'Aprovar casos de teste', exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Solicitar alterações nos casos', exact: true }).count(), 0);
  await screenshot('web-cases-persisted.png', 1366);

  // CA-09: conferência de que nenhum mapeamento ou navegação foi iniciado
  const runAfterApproval = await api(context, `/api/runs/${id}`, owner.id);
  assert.equal(runAfterApproval.status, 'awaiting_approval');
  assert.equal(runAfterApproval.phase, 'case_design');
  assert.equal(runAfterApproval.canDecideCases, false);
  const storedRecordAfter = await store.read(id);
  assert.equal(runAfterApproval.cases.current, true);
  assert.equal(casePosts, 2, 'Somente a aprovação explícita envia o segundo POST.');
  assert.equal(runAfterApproval.approvals.filter(a => a.outputId === savedCases.id).length, 1);
  checked.push('BUG-T6.2-01 CA-04: casos aprovados e vigentes mantêm a confirmação após recarregar');
  assert.equal(storedRecordAfter.run.outputs.some(o => o.phase === 'mapping'), false);
  assert.deepEqual(storedRecordAfter.workIntents.filter(w => w.status === 'pending'), []);

  // BUG-T6.2-01 CA-03: a aprovação histórica não oculta dependências alteradas.
  await store.update(id, record => {
    const curation = record.run.outputs.find(o => o.id === cases.curation.id && o.revision === cases.curation.revision);
    record.run.outputs.push({ ...structuredClone(curation), revision: curation.revision + 1 });
    return { save: true, value: null };
  });
  await page.getByRole('button', { name: 'Atualizar consulta', exact: true }).click();
  await bodyIncludes('Casos desatualizados — as dependências desta revisão foram alteradas.');
  await bodyIncludes('Casos aprovados · Revisão 1 · Conteúdo desatualizado');
  assert.equal(await page.getByText('Casos aprovados. O mapeamento ainda não foi iniciado.', { exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Aprovar casos de teste', exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Solicitar alterações nos casos', exact: true }).count(), 0);
  const staleCases = await api(context, `/api/runs/${id}`, owner.id);
  assert.equal(staleCases.cases.current, false); assert.equal(staleCases.canDecideCases, false);
  assert.deepEqual(staleCases.approvals, runAfterApproval.approvals, 'A aprovação original permanece intacta.');
  assert.equal(casePosts, 2);
  await screenshot('web-cases-stale.png', 1366); await screenshot('web-cases-stale-mobile.png', 390);
  checked.push('BUG-T6.2-01 CA-03: dependência sintética alterada → aviso de casos desatualizados, aprovação identificada no histórico e nenhuma nova decisão disponível');

  // CA-02 e CA-07: jornada de solicitação de alterações e separação dos históricos
  const changesRun = structuredClone(storedRecordAfter.run);
  changesRun.id = 'run-cases-changes';
  changesRun.name = 'Execução com alterações nos casos';
  changesRun.approvals = changesRun.approvals.filter(a => a.outputId !== savedCases.id);
  await store.create(changesRun);

  await page.goto('/execucoes/run-cases-changes');
  await bodyIncludes('Conjunto validado. Disponível para revisão humana');
  assert.equal(await page.getByLabel('Comentário sobre os casos', { exact: true }).inputValue(), '', 'Outra execução não herda o comentário.');
  let changesPosts = 0;
  await page.route('**/api/runs/run-cases-changes/request-changes', async route => {
    changesPosts++;
    assert.equal(route.request().headers()['x-expected-user-id'], owner.id);
    assert.deepEqual(route.request().postDataJSON(), { outputId: savedCases.id, outputRevision: changesPosts,
      comment: changesPosts === 1 ? caseCommentText : 'Revisar o resultado esperado do caso CT-01.' });
    if (changesPosts === 2) {
      const response = await route.fetch();
      assert.equal(response.status(), 200, 'CA-05: gravar antes de perder a resposta.');
    }
    await route.abort('connectionreset');
  });
  await page.getByLabel('Comentário sobre os casos', { exact: true }).fill(caseCommentText);
  await page.getByRole('button', { name: 'Solicitar alterações nos casos', exact: true }).click();
  await bodyIncludes('Não foi possível confirmar a decisão pela resposta.');
  await page.getByLabel('Comentário sobre os casos', { exact: true }).fill(editedComment);
  await store.update(changesRun.id, record => {
    record.run.outputs.push({ ...structuredClone(savedCases), revision: 2 });
    record.run.validations.push({ outputId: savedCases.id, outputRevision: 2, validator: 'output-validator', status: 'approved' });
    return { save: true, value: null };
  });
  await page.getByRole('button', { name: 'Atualizar consulta', exact: true }).click();
  await bodyIncludes('Casos de teste / Revisão 2');
  const preservedCaseComment = page.getByLabel('Comentário preservado da revisão 1', { exact: true });
  assert.equal(await preservedCaseComment.inputValue(), editedComment);
  assert.equal(await preservedCaseComment.getAttribute('readonly'), '');
  assert.equal(await page.getByLabel('Comentário sobre os casos', { exact: true }).inputValue(), '', 'CA-02: a revisão nova não recebe B.');
  assert.equal(changesPosts, 1); assert.equal(casePosts, 3);
  assert.deepEqual((await api(context, `/api/runs/${changesRun.id}`, owner.id)).approvals, cases.approvals);
  await screenshot('web-cases-comment-recovery.png', 1366);
  checked.push('BUG-T6.2-01 CA-02: revisão muda durante recuperação → B da revisão 1 fica somente para leitura/cópia e revisão 2 fica vazia');

  await page.getByLabel('Comentário sobre os casos', { exact: true }).fill('Revisar o resultado esperado do caso CT-01.');
  await page.getByRole('button', { name: 'Solicitar alterações nos casos', exact: true }).click();
  await bodyIncludes('Alterações solicitadas. Os casos aguardam revisão.');
  await bodyIncludes('Revisar o resultado esperado do caso CT-01.');
  assert.equal(changesPosts, 2); assert.equal(casePosts, 4);
  assert.equal(await preservedCaseComment.count(), 0, 'A decisão recuperada não deixa cópia de uma revisão anterior.');
  await screenshot('web-cases-changes.png', 1366); await screenshot('web-cases-changes-mobile.png', 390);

  // CA-07: verificar que as decisões não se misturam nos painéis
  await page.reload();
  await bodyIncludes('Alterações solicitadas. Os casos aguardam revisão.');
  await bodyIncludes('Revisar o resultado esperado do caso CT-01.');
  const changesRunPersisted = await api(context, '/api/runs/run-cases-changes', owner.id);
  assert.equal(changesRunPersisted.canDecideCases, false);
  const caseDecisionEntry = changesRunPersisted.approvals.find(a => a.outputId === savedCases.id);
  assert.equal(caseDecisionEntry.decision, 'changes_requested');
  assert.equal(caseDecisionEntry.outputRevision, 2);
  assert.equal(caseDecisionEntry.comment, 'Revisar o resultado esperado do caso CT-01.');
  assert.equal(changesRunPersisted.approvals.filter(a => a.outputId === savedCases.id).length, 1);
  assert.equal(changesPosts, 2); assert.equal(casePosts, 4, 'CA-05: a recuperação e o reload não reenviam a decisão.');
  assert.equal(await page.getByLabel('Comentário sobre os casos', { exact: true }).count(), 0);
  assert.equal(await preservedCaseComment.count(), 0);
  await page.unroute('**/api/runs/run-cases-changes/request-changes');
  page.off('request', countCasePosts);
  assert.equal(preparationCalls.length, 10, 'Recuperar comentários, consultar e decidir não iniciam inferência.');
  checked.push('BUG-T6.2-01 CA-05: resposta perdida depois de gravar → consulta recupera uma única decisão da revisão 2, sem reenvio automático');

  checked.push('T6.2: aprovação e solicitação de alterações de casos pelo site → comentário obrigatório → persistência após recarregar → nenhum mapeamento iniciado → históricos de plano e casos separados');
  checked.push('T6.1: aprovação separada → gerar casos 202 → repetição 200 sem duplicação → geração → casos provisórios em validação → conjunto persistido para revisão humana');
  checked.push('T4.1: rascunho → iniciar 202 → curador → validador → planejador → validador → aprovação pelo site; chamada de modelo substituída explicitamente no teste');
  checked.push('T4.1: repetição não duplica chamada; pendência localizada permite plano independente; consulta periódica para na revisão e conserva comentário em edição');
  checked.push('Esclarecimentos: resposta literal preserva originais, comentário e outra resposta digitada; plano antigo não aceita aprovação e texto pendente impede retomada');
  checked.push('Esclarecimentos: resposta concorrente preserva cópia local; retomada explícita mantém IDs, cria revisões 2 validadas, incorpora fontes das respostas e exige nova aprovação');

  const cancelledId = await createDraft('Preparação cancelada pelo site');
  const callsBefore = preparationCalls.length;
  holdPreparation = true;
  await begin(cancelledId);
  const cancellation = page.waitForResponse(response => response.url().endsWith(`/api/runs/${cancelledId}/cancel`));
  await page.getByRole('button', { name: 'Cancelar preparação', exact: true }).click();
  const stopped = await cancellation;
  assert.equal(stopped.status(), 200);
  assert.equal(stopped.request().headers()['x-expected-user-id'], owner.id);
  await visible(page.getByText('Cancelada', { exact: true }));
  holdPreparation = false; releasePreparation();
  const cancelled = await api(context, `/api/runs/${cancelledId}`, owner.id);
  assert.equal(cancelled.status, 'cancelled'); assert.equal(cancelled.plan, null);
  assert.equal(preparationCalls.length, callsBefore + 1);
  assert.equal(await page.getByRole('button', { name: 'Preparar plano', exact: true }).count(), 0);
  checked.push('T4.1: cancelar pelo site conserva identidade e estado cancelado, aborta a chamada e impede planejamento posterior');
  // Snapshot com casos aprovados e dependências vigentes (antes da adulteração
  // sintética do BUG-T6.2-01): sustenta a jornada de mapeamento a seguir.
  return { approvedRecord: storedRecordAfter, savedCases };
}

try {
  if (artifactDir) await mkdir(artifactDir, { recursive: true });
  const config = readConfig({ DATA_DIR: root, PILOT_ALLOWED_EMAILS: accounts.map(account => account.email).join(','),
    PI_PROVIDER: 'test-only', PI_MODEL: 'scripted', TARGET_ALLOWED_ORIGINS: 'https://alvo.exemplo.test' });
  server = await createApp(config, { now: () => clock, modelCall, modelPreflight: async () => {}, visualCall, visualPreflight: async () => visualModels });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  // A origem só é conhecida após o bind efêmero; configurar antes de qualquer
  // solicitação. O Chromium enviará seu Origin nativo, sem override de cabeçalho.
  config.appOrigin = readConfig({ APP_ORIGIN: origin }).appOrigin;
  const store = new RunStore(root);
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium', headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const context = await browser.newContext({ baseURL: origin, viewport: { width: 1366, height: 900 } });
  page = await context.newPage();
  page.setDefaultTimeout(10000);
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto('/');
  await page.waitForURL('**/acesso*');
  const owner = await register(accounts[0]);
  const otherContext = await browser.newContext({ baseURL: origin });
  const otherPage = await otherContext.newPage();
  await otherPage.goto('/acesso');
  const other = await register(accounts[1], otherPage);
  await otherContext.close();
  if (!process.env.SMOKE_REGRESSION) {
  await bodyIncludes(/nenhuma execução|primeira execução/i);
  assert.deepEqual((await api(context, '/api/runs', owner.id)).items, []);
  await page.getByRole('link', { name: 'Nova execução', exact: true }).first().click();
  await fillRun(name, text);
  let creationCount = 0;
  page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/runs') creationCount++;
  });
  await page.getByRole('button', { name: 'Salvar rascunho', exact: true }).click();
  await page.waitForURL(url => /^\/execucoes\/run-/.test(url.pathname));
  const draftId = new URL(page.url()).pathname.split('/').at(-1);
  await bodyIncludes('Material recebido. O processamento ainda não foi iniciado.');
  assert.equal(creationCount, 1);
  assert.equal((await store.read(draftId)).run.artifacts[0].text, text);
  assert.equal((await api(context, `/api/runs/${draftId}`, owner.id)).plan, null);
  await noMarkup();
  await page.reload();
  await bodyIncludes(name);
  await history();
  await visible(page.getByRole('link', { name, exact: true }));
  await noMarkup();
  checked.push('cadastro → histórico vazio → criação real → detalhe → histórico; texto literal preservado');

  await page.getByRole('button', { name: 'Sair', exact: true }).click();
  await page.waitForURL('**/acesso*');
  await login(accounts[0]);
  await visible(page.getByRole('link', { name, exact: true }));
  await page.getByRole('link', { name, exact: true }).click();
  await bodyIncludes('Material recebido. O processamento ainda não foi iniciado.');
  checked.push('recarregamento, logout/login e reencontro da execução persistida');

  // T8.1: Configurar acesso privado ao alvo
  await bodyIncludes('Acesso pendente. Configure o endereço e a conta de teste antes do mapeamento.');

  // Erro de envio: destino não autorizado
  await page.getByLabel('URL inicial', { exact: true }).fill('https://nao-autorizado.exemplo.test');
  await page.getByLabel('Perfil de acesso', { exact: true }).fill('Operador de reservas');
  await page.getByLabel('Preparação necessária', { exact: true }).fill('Iniciar com a lista de reservas vazia.');
  await page.getByLabel('Usuário da conta de teste', { exact: true }).fill('operador-reserva');
  await page.getByLabel('Senha da conta de teste', { exact: true }).fill('senha-secreta-alvo-123!');
  await page.getByLabel('Confirmo que tenho autorização para testar esta aplicação', { exact: true }).check();
  await page.getByRole('button', { name: 'Salvar acesso', exact: true }).click();
  await bodyIncludes('O endereço informado não pertence às origens autorizadas pela equipe do piloto.');
  assert.equal(await page.getByLabel('Senha da conta de teste', { exact: true }).inputValue(), '', 'Senha limpa após erro de validação.');

  // Erro de envio: resposta perdida / falha de rede
  await page.getByLabel('URL inicial', { exact: true }).fill('https://alvo.exemplo.test');
  await page.getByLabel('Senha da conta de teste', { exact: true }).fill('senha-secreta-alvo-123!');
  await page.route(`**/api/runs/${draftId}`, async route => {
    if (route.request().method() === 'PATCH') await route.abort('connectionreset');
    else await route.continue();
  });
  await page.getByRole('button', { name: 'Salvar acesso', exact: true }).click();
  await bodyIncludes(/não foi possível concluir a solicitação|verifique a conexão/i);
  assert.equal(await page.getByLabel('Senha da conta de teste', { exact: true }).inputValue(), '', 'Senha limpa após erro de rede, sem reenvio automático.');
  await page.unroute(`**/api/runs/${draftId}`);

  // Conflito de revisão: STALE_VERSION
  await store.update(draftId, record => {
    record.run.input.accessRevision = 1;
    return { save: true, value: null };
  });
  await page.getByLabel('Senha da conta de teste', { exact: true }).fill('senha-secreta-alvo-123!');
  await page.getByRole('button', { name: 'Salvar acesso', exact: true }).click();
  await bodyIncludes(/consulte a configuração salva antes de tentar novamente/i);
  await visible(page.getByRole('button', { name: 'Consultar registro atualizado', exact: true }));
  assert.equal(await page.getByLabel('Senha da conta de teste', { exact: true }).inputValue(), '', 'Senha limpa após conflito de versão.');
  await store.update(draftId, record => {
    record.run.input.accessRevision = 0;
    return { save: true, value: null };
  });
  await page.getByRole('button', { name: 'Consultar registro atualizado', exact: true }).click();
  await bodyIncludes('Acesso pendente. Configure o endereço e a conta de teste antes do mapeamento.');

  // Salvamento com sucesso da configuração inicial completa
  await page.getByLabel('URL inicial', { exact: true }).fill('https://alvo.exemplo.test');
  await page.getByLabel('Perfil de acesso', { exact: true }).fill('Operador de reservas');
  await page.getByLabel('Preparação necessária', { exact: true }).fill('Iniciar com a lista de reservas vazia.');
  await page.getByLabel('Usuário da conta de teste', { exact: true }).fill('operador-reserva');
  await page.getByLabel('Senha da conta de teste', { exact: true }).fill('senha-secreta-alvo-123!');
  await page.getByLabel('Confirmo que tenho autorização para testar esta aplicação', { exact: true }).check();
  await page.getByRole('button', { name: 'Salvar acesso', exact: true }).click();

  await bodyIncludes('Acesso configurado. O login ainda não foi verificado pelo navegador.');
  await bodyIncludes('https://alvo.exemplo.test');
  await bodyIncludes('Operador de reservas');
  await bodyIncludes('Iniciar com a lista de reservas vazia.');
  await bodyIncludes('Credencial cadastrada');
  await bodyIncludes('Confirmada pelo usuário');

  // Segredo e usuário não permanecem no storage do navegador
  const targetStorage = await page.evaluate(() => JSON.stringify({ session: { ...sessionStorage }, local: { ...localStorage } }));
  assert.ok(!targetStorage.includes('senha-secreta-alvo-123!'), 'Senha não pode ser persistida no storage.');
  assert.ok(!targetStorage.includes('operador-reserva'), 'Usuário não pode ser persistido no storage.');

  // Captura do resumo salvo
  await screenshot('acesso-configurado.png', 1366);

  // Recarregar e conferir resumo persistido
  await page.reload();
  await bodyIncludes('Acesso configurado. O login ainda não foi verificado pelo navegador.');
  await bodyIncludes('https://alvo.exemplo.test');
  await bodyIncludes('Operador de reservas');
  await bodyIncludes('Credencial cadastrada');

  // Atualização sem reenviar senha
  await page.locator('summary', { hasText: 'Alterar configuração de acesso' }).click();
  await page.getByLabel('Perfil de acesso', { exact: true }).fill('Operador sênior de reservas');
  await page.getByLabel('Preparação necessária', { exact: true }).fill('Carregar 5 reservas prévias.');
  assert.equal(await page.getByLabel('Substituir usuário e senha da conta de teste', { exact: true }).isChecked(), false);
  await page.getByRole('button', { name: 'Salvar acesso', exact: true }).click();

  await bodyIncludes('Acesso à aplicação testada · Revisão 2');
  await bodyIncludes('Operador sênior de reservas');
  await bodyIncludes('Carregar 5 reservas prévias.');
  await bodyIncludes('Credencial cadastrada');

  const storedAfterUpdate = await store.read(draftId);
  assert.equal(storedAfterUpdate.run.input.accessRevision, 2);
  assert.equal(storedAfterUpdate.run.input.accessProfile, 'Operador sênior de reservas');
  assert.equal(storedAfterUpdate.run.input.dataPreparation, 'Carregar 5 reservas prévias.');
  assert.equal(storedAfterUpdate.targetCredential?.username, 'operador-reserva');
  assert.equal(storedAfterUpdate.targetCredential?.password, 'senha-secreta-alvo-123!');
  checked.push('T8.1: configurar acesso → validação/origem não autorizada → resposta perdida sem reenvio automático → conflito de revisão → salvamento 200 → recarregamento com resumo sem senha → atualização sem reenviar senha incrementa revisão');


  await page.goto('/execucoes/nova');
  await fillRun(pendingName, pendingText);
  const sent = [];
  let lost = true;
  const heldResponse = new Promise(resolve => { releaseResponse = resolve; });
  let persisted;
  const persistedResponse = new Promise(resolve => { persisted = resolve; });
  await page.route('**/api/runs', async route => {
    const request = route.request();
    if (request.method() !== 'POST') return route.continue();
    sent.push({ key: request.headers()['idempotency-key'], body: request.postData(), origin: request.headers().origin });
    if (!lost) return route.continue();
    lost = false;
    const response = await route.fetch(); // A API persiste antes de perdermos só a resposta.
    assert.equal(response.status(), 201);
    persisted();
    await heldResponse;
    await route.abort('connectionreset');
  });
  const savingButton = page.getByRole('button', { name: /Salvar rascunho|Tentar confirmar salvamento/ });
  await savingButton.dblclick({ delay: 30 });
  assert.equal(await savingButton.isDisabled(), true, 'Botão desabilitado enquanto a resposta não chega.');
  await persistedResponse;
  releaseResponse();
  // Esse rótulo já aparece durante o envio; aguardar a falha ser processada
  // antes de consultar o registro e testar sua recuperação.
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button =>
    button.textContent === 'Tentar confirmar salvamento' && !button.disabled));
  assert.equal((await api(context, '/api/runs', owner.id)).items.length, 2);
  const storedAttempt = await page.evaluate(id => JSON.parse(sessionStorage.getItem(`akcit.intake.v1:${id}`)), owner.id);
  assert.deepEqual(storedAttempt, { accountId: owner.id, key: sent[0].key, body: sent[0].body });
  assert.equal(await page.getByLabel('Material de requisitos', { exact: true }).inputValue(), pendingText);
  assert.equal(await page.getByLabel('Nome da execução', { exact: true }).isEditable(), false);
  await page.reload();
  await visible(page.getByRole('button', { name: 'Tentar confirmar salvamento', exact: true }));
  assert.equal(await page.getByLabel('Material de requisitos', { exact: true }).inputValue(), pendingText);
  clock += 8 * 60 * 60 * 1000 + 1;
  await page.reload();
  await page.waitForURL('**/acesso*');
  assert.ok(!(await page.locator('body').innerText()).includes(pendingText));
  await login(accounts[1]);
  assert.equal(await page.getByLabel('Material de requisitos', { exact: true }).inputValue(), '');
  assert.equal(await page.getByLabel('Nome da execução', { exact: true }).inputValue(), '');
  assert.equal(await page.getByRole('button', { name: 'Tentar confirmar salvamento', exact: true }).count(), 0);
  assert.deepEqual(await page.evaluate(id => JSON.parse(sessionStorage.getItem(`akcit.intake.v1:${id}`)), owner.id), storedAttempt);
  clock += 8 * 60 * 60 * 1000 + 1;
  await page.reload();
  await page.waitForURL('**/acesso*');
  await login(accounts[0]);
  await visible(page.getByRole('button', { name: 'Tentar confirmar salvamento', exact: true }));
  assert.equal(await page.getByLabel('Material de requisitos', { exact: true }).inputValue(), pendingText);
  await page.getByRole('button', { name: 'Tentar confirmar salvamento', exact: true }).click();
  await page.waitForURL(url => /^\/execucoes\/run-/.test(url.pathname));
  // A URL muda antes de o novo documento confirmar a sessão e carregar o detalhe.
  // Esperar o estado renderizado antes de avançar o relógio evita expirar o boot.
  await bodyIncludes('Material recebido. O processamento ainda não foi iniciado.');
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[1], sent[0], 'Repetir exatamente a mesma chave, corpo e origem após recarregar.');
  assert.match(sent[0].key, /^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i);
  assert.equal(sent[0].origin, origin);
  assert.equal((await api(context, '/api/runs', owner.id)).items.length, 2);
  assert.equal((await store.read(new URL(page.url()).pathname.split('/').at(-1))).run.artifacts[0].text, pendingText);
  assert.equal(await page.evaluate(id => sessionStorage.getItem(`akcit.intake.v1:${id}`), owner.id), null);
  await page.unroute('**/api/runs');
  checked.push('clique duplo bloqueado; resposta perdida após persistir → aba recarregada → mesma chave/corpo sem duplicação');
  checked.push('tentativa guardada não aparece para outra conta após expiração; conta original recupera o mesmo corpo e chave');

  // Expiração durante o uso exige nova sessão antes de consultar dados privados.
  clock += 8 * 60 * 60 * 1000 + 1;
  await page.getByRole('link', { name: 'Minhas execuções', exact: true }).first().click();
  await page.waitForURL('**/acesso*');
  assert.ok(!(await page.locator('body').innerText()).includes(name));
  await login(accounts[0]);
  await visible(page.getByRole('link', { name, exact: true }));
  checked.push('sessão expirada remove os dados da tela e exige login');

  await page.getByRole('button', { name: 'Sair', exact: true }).click();
  await page.waitForURL('**/acesso*');
  assert.equal(await page.evaluate(() => sessionStorage.length), 0);
  await login(accounts[1]);
  assert.deepEqual((await api(context, '/api/runs', other.id)).items, []);
  await page.goto(`/execucoes/${draftId}`);
  await bodyIncludes(/não encontrad/i);
  assert.ok(!(await page.locator('body').innerText()).includes(name));
  assert.equal((await context.request.get(`/api/runs/${draftId}`, { headers: { 'X-Expected-User-Id': other.id } })).status(), 404);
  await page.goto('/execucoes/nova');
  assert.equal(await page.getByLabel('Material de requisitos', { exact: true }).inputValue(), '');
  await page.getByRole('button', { name: 'Sair', exact: true }).click();
  await page.waitForURL('**/acesso*');
  await login(accounts[0]);
  checked.push('segunda conta isolada: histórico vazio, detalhe 404 e formulário sem conteúdo da primeira');

  for (const [id, label] of [['plan-approve', 'Plano para aprovação'], ['plan-changes', 'Plano para ajustes'],
    ['plan-stale', 'Plano com nova revisão'], ['plan-conflict', 'Plano com decisão concorrente']]) {
    await store.create(waiting(id, owner.id, label));
  }
  await page.goto('/execucoes/plan-approve');
  await bodyIncludes('Conferir os limites de reservas com dados fictícios.');
  await bodyIncludes('<svg data-smoke onload="globalThis.smokeInjected=true">Fonte literal</svg>');
  await noMarkup();
  await screenshot('web-plan.png', 1366);
  await page.getByRole('button', { name: 'Aprovar plano', exact: true }).click();
  await visible(page.getByText('Plano aprovado · Revisão 1', { exact: true }));
  const approved = await api(context, '/api/runs/plan-approve', owner.id);
  assert.equal(approved.status, 'awaiting_approval');
  assert.equal(approved.phase, 'planning');
  assert.equal(approved.approvals.length, 1);
  assert.equal(approved.approvals[0].decision, 'approved');
  assert.equal(approved.approvals[0].outputRevision, 1);
  assert.deepEqual((await store.read('plan-approve')).workIntents, []);
  await page.reload();
  await visible(page.getByText('Plano aprovado · Revisão 1', { exact: true }));
  assert.deepEqual((await api(context, '/api/runs/plan-approve', owner.id)).approvals, approved.approvals);
  await store.update('plan-approve', record => {
    record.run.status = 'completed'; record.run.phase = 'report';
    return { save: true, value: null };
  });
  await page.reload();
  await visible(page.getByText('Concluída', { exact: true }));
  await visible(page.getByText('Plano aprovado · Revisão 1', { exact: true }));
  assert.ok(!(await page.locator('body').innerText()).includes('execução permanece em espera'));
  checked.push('decisão histórica de execução concluída não exibe espera falsa');

  await page.goto('/execucoes/plan-changes');
  const comment = '  Incluir o CA-02. <b>Comentário literal</b>  ';
  let decisions = 0;
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/request-changes')) decisions++; });
  await page.getByRole('button', { name: 'Solicitar alterações', exact: true }).click();
  await visible(page.getByLabel('Comentário', { exact: true }));
  // Aceita campo sempre visível ou aberto pela ação, sem assumir um modal.
  if (!(await page.getByLabel('Comentário', { exact: true }).getAttribute('aria-invalid'))) {
    await page.getByRole('button', { name: 'Solicitar alterações', exact: true }).click();
  }
  assert.equal(decisions, 0, 'Comentário vazio não deve criar decisão.');
  await page.getByLabel('Comentário', { exact: true }).fill(comment);
  await page.getByRole('button', { name: 'Solicitar alterações', exact: true }).click();
  await bodyIncludes(comment.trim());
  await page.reload();
  await bodyIncludes(comment.trim());
  const changed = await api(context, '/api/runs/plan-changes', owner.id);
  assert.equal(changed.status, 'awaiting_approval');
  assert.equal(changed.approvals.length, 1);
  assert.equal(changed.approvals[0].decision, 'changes_requested');
  assert.equal(changed.approvals[0].outputRevision, 1);
  assert.equal(changed.approvals[0].comment.trim(), comment.trim());
  assert.deepEqual((await store.read('plan-changes')).workIntents, []);
  assert.equal(await page.locator('b').filter({ hasText: 'Comentário literal' }).count(), 0);
  checked.push('planos sintéticos: conteúdo, fontes literais, aprovação e alteração da revisão 1 persistidos; espera mantida');

  await page.goto('/execucoes/plan-stale');
  await visible(page.getByRole('button', { name: 'Aprovar plano', exact: true }));
  await store.update('plan-stale', record => {
    record.run.outputs.push({ ...structuredClone(record.run.outputs[1]), revision: 2 });
    record.run.validations.push({ outputId: 'plan', outputRevision: 2, validator: 'output-validator', status: 'approved' });
    return { save: true, value: null };
  });
  const staleResponse = page.waitForResponse(response => response.url().endsWith('/plan-stale/approve'));
  await page.getByRole('button', { name: 'Aprovar plano', exact: true }).click();
  assert.equal((await staleResponse).status(), 409);
  await bodyIncludes(/desatualiz|revisão.*mud|nova revisão/i);
  await bodyIncludes(/revisão 2/i);
  assert.deepEqual((await api(context, '/api/runs/plan-stale', owner.id)).approvals, []);
  checked.push('revisão desatualizada recusada, consulta atualizada e nenhuma aprovação reaplicada');

  await page.goto('/execucoes/plan-conflict');
  await visible(page.getByRole('button', { name: 'Aprovar plano', exact: true }));
  const concurrent = await context.newPage();
  await concurrent.goto('/execucoes/plan-conflict');
  const concurrentResponse = concurrent.waitForResponse(response => response.url().endsWith('/plan-conflict/approve'));
  await concurrent.getByRole('button', { name: 'Aprovar plano', exact: true }).click();
  assert.equal((await concurrentResponse).status(), 200);
  await concurrent.close();
  await page.getByLabel('Comentário', { exact: true }).fill('Revisar esta decisão concorrente.');
  const conflictResponse = page.waitForResponse(response => response.url().endsWith('/plan-conflict/request-changes'));
  await page.getByRole('button', { name: 'Solicitar alterações', exact: true }).click();
  assert.equal((await conflictResponse).status(), 409);
  await bodyIncludes(/decisão.*diferente|decisão.*registrada|conflito/i);
  const conflict = await api(context, '/api/runs/plan-conflict', owner.id);
  assert.equal(conflict.approvals.length, 1);
  assert.equal(conflict.approvals[0].decision, 'approved');
  checked.push('decisão concorrente em outra aba: conflito recusado, decisão original preservada');

  await history();
  await visible(page.getByRole('link', { name, exact: true }));
  await page.getByLabel('Buscar por nome ou aplicação', { exact: true }).fill('resposta perdida');
  await page.getByLabel('Situação', { exact: true }).selectOption('draft');
  const filteredResponse = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === '/api/runs' && url.searchParams.get('q') === 'resposta perdida' && url.searchParams.get('status') === 'draft';
  });
  await page.getByRole('button', { name: 'Filtrar', exact: true }).click();
  assert.equal((await filteredResponse).status(), 200);
  await visible(page.getByRole('link', { name: pendingName, exact: true }));
  assert.equal(await page.getByRole('link', { name, exact: true }).count(), 0);
  await page.getByLabel('Buscar por nome ou aplicação', { exact: true }).fill('sem resultados sintéticos');
  await page.getByRole('button', { name: 'Filtrar', exact: true }).click();
  await bodyIncludes(/nenhum.*filtro|nenhum resultado|nenhuma execução.*filtro/i);
  await page.goto('/execucoes');
  await visible(page.getByRole('link', { name, exact: true }));
  checked.push('busca e situação combinadas usam os parâmetros da API; filtro sem resultado');
  const corrupt = join(root, 'runs', 'smoke-unavailable.json');
  await writeFile(corrupt, '{');
  await page.reload();
  await visible(page.getByRole('button', { name: 'Tentar novamente', exact: true }));
  assert.equal(await page.getByRole('link', { name, exact: true }).count(), 0);
  await rm(corrupt);
  await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
  await visible(page.getByRole('link', { name, exact: true }));
  checked.push('falha real de consulta503 no armazenamento temporário e recuperação pelo botão de nova tentativa');
  await screenshot('web-desktop.png', 1366);
  await screenshot('web-mobile.png', 390);
  await page.getByRole('link', { name: 'Nova execução', exact: true }).first().click();
  await fillRun('Formulário responsivo', 'US-03: Texto fictício.\nCA-03: O campo conserva o conteúdo.');
  await screenshot('web-mobile-form.png', 390);
  await page.getByLabel('Nome da execução', { exact: true }).focus();
  await page.keyboard.press('Tab');
  const focus = await page.evaluate(() => ({
    id: document.activeElement.id, outline: getComputedStyle(document.activeElement).outlineStyle,
    width: parseFloat(getComputedStyle(document.activeElement).outlineWidth),
  }));
  assert.equal(focus.id, 'applicationName');
  assert.notEqual(focus.outline, 'none');
  assert.ok(focus.width >= 2, 'A navegação por Tab precisa mostrar o foco.');
  checked.push('navegação por Tab entre campos com foco visível');
  const beforeOversize = creationCount;
  const oversized = 'á'.repeat(8200);
  await page.getByLabel('Material de requisitos', { exact: true }).fill(oversized);
  await page.getByRole('button', { name: 'Salvar rascunho', exact: true }).click();
  await bodyIncludes(/JSON completo excede 16 KiB/i);
  assert.equal(creationCount, beforeOversize, 'JSON acima de 16 KiB não deve ser enviado.');
  assert.equal(await page.getByLabel('Material de requisitos', { exact: true }).inputValue(), oversized);
  checked.push('limite do JSON em bytes bloqueia o envio e preserva o preenchimento');
  await fillRun('Armazenamento indisponível', 'US-04: Preservar o formulário.\nCA-04: Sem storage, não enviar.');
  await page.evaluate(() => {
    Storage.prototype.setItem = function () { throw new DOMException('Quota fictícia', 'QuotaExceededError'); };
  });
  await page.getByRole('button', { name: 'Salvar rascunho', exact: true }).click();
  await bodyIncludes(/não.*guardar|não.*preservar|armazenamento.*navegador|recuperação.*indisponível/i);
  assert.equal(creationCount, beforeOversize, 'Sem guardar tentativa recuperável, não enviar POST.');
  assert.equal(await page.getByLabel('Nome da execução', { exact: true }).inputValue(), 'Armazenamento indisponível');
  checked.push('sessionStorage indisponível impede envio e mantém o formulário');
  const secretStorage = await page.evaluate(() => JSON.stringify({ session: { ...sessionStorage }, local: { ...localStorage } }));
  for (const account of accounts) assert.ok(!secretStorage.includes(account.password));
  assert.ok(!secretStorage.includes('akcit_session'));
  assert.deepEqual(pageErrors, [], 'Nenhum erro JavaScript na jornada.');
  checked.push('desktop 1366px e celular 390px sem transbordamento; nenhum token ou senha no storage');
  const journey = await preparationJourney(context, store, owner);
  assert.deepEqual(pageErrors, [], 'Nenhum erro JavaScript na preparação e aprovação do plano.');

  // T8.2: mapear aplicação pelo site, com sessões visuais substituídas explicitamente.
  const mappingId = 'run-mapping-smoke';
  const mappingRun = structuredClone(journey.approvedRecord.run);
  mappingRun.id = mappingId;
  mappingRun.name = 'Mapeamento visual simulado';
  await store.create(mappingRun);
  await store.update(mappingId, record => {
    record.targetCredential = { ref: 'cred-smoke', username: 'operador-reserva', password: 'senha-secreta-alvo-123!' };
    record.run.input = { ...record.run.input, credentialRef: 'cred-smoke', startUrl: 'https://alvo.exemplo.test', accessProfile: 'Operador de reservas', dataPreparation: 'Lista vazia.', authorizedTarget: true, accessRevision: 1 };
    return { save: true, value: null };
  });
  await page.goto('/execucoes/run-mapping-smoke');
  await bodyIncludes('Casos aprovados. Pronto para mapear a aplicação.');
  const mappingPost = page.waitForResponse(response => response.url().endsWith('/api/runs/run-mapping-smoke/continue'));
  await page.getByRole('button', { name: 'Mapear aplicação', exact: true }).click();
  const acceptedMapping = await mappingPost;
  assert.equal(acceptedMapping.status(), 202);
  assert.deepEqual(acceptedMapping.request().postDataJSON(), { outputId: journey.savedCases.id, outputRevision: 1, expectedAccessRevision: 1 });
  await bodyIncludes('Mapa validado — aguardando detalhamento dos percursos.');
  await bodyIncludes('Mapa de navegação / Revisão 1');
  await bodyIncludes('Telas observadas (3)');
  await bodyIncludes('Transições (2)');
  await bodyIncludes('Caminhos (1)');
  await bodyIncludes('Pendências (1)');
  await bodyIncludes('Ações registradas (2)');
  await bodyIncludes('Acesso autenticado observado');
  await bodyIncludes('Limitações do mapa');
  // A captura chega por blob com a autenticação existente (rolar até a imagem:
  // ela usa carregamento preguiçoso e fora da viewport nunca completa).
  await page.waitForFunction(() => {
    const image = document.querySelector('img[alt="Captura da tela observada"]');
    image?.scrollIntoView();
    return image && image.complete && image.naturalWidth > 0 && image.src.startsWith('blob:');
  }, null, { timeout: 30_000 });
  const mapping = await api(context, '/api/runs/run-mapping-smoke', owner.id);
  assert.equal(mapping.status, 'ready'); assert.equal(mapping.phase, 'mapping');
  assert.equal(mapping.canMap, false); assert.equal(mapping.mapping.revision, 1);
  assert.equal(mapping.mapping.validations[0].status, 'approved');
  assert.equal(mapping.observations.length, 3); assert.equal(mapping.mappingActions.length, 2);
  assert.ok(!JSON.stringify(mapping.mapping.payload).includes('senha-secreta-alvo-123!'), 'projeção sem a senha do alvo');
  assert.ok(!(await page.locator('body').innerText()).includes('senha-secreta-alvo-123!'));
  assert.ok(!(await page.locator('body').innerText()).includes('caseId'), 'sem contrato de execução no mapa');
  // Outra conta não acessa a evidência do proprietário (sessão própria → 404).
  const foreignContext = await browser.newContext({ baseURL: origin });
  const foreignPage = await foreignContext.newPage();
  await foreignPage.goto('/acesso');
  await foreignPage.getByLabel('E-mail', { exact: true }).fill(accounts[1].email);
  await foreignPage.getByLabel('Senha', { exact: true }).fill(accounts[1].password);
  const foreignLogin = foreignPage.waitForResponse(response => response.url().endsWith('/api/auth/login'));
  await foreignPage.getByRole('button', { name: 'Entrar na conta', exact: true }).click();
  assert.equal((await foreignLogin).status(), 200);
  const foreignEvidence = await foreignContext.request.get(`/api/runs/run-mapping-smoke/evidence/${mapping.observations[0].assetId}`, { headers: { 'X-Expected-User-Id': other.id } });
  assert.equal(foreignEvidence.status(), 404, 'evidência isolada de outras contas');
  // Persistência após recarregar, incluindo nova busca das capturas.
  await page.reload();
  await bodyIncludes('Mapa validado — aguardando detalhamento dos percursos.');
  await page.waitForFunction(() => {
    const image = document.querySelector('img[alt="Captura da tela observada"]');
    image?.scrollIntoView();
    return image && image.complete && image.naturalWidth > 0;
  }, null, { timeout: 30_000 });
  await screenshot('web-map.png', 1366); await screenshot('web-map-mobile.png', 390);
  // ready no filtro de histórico.
  const readyHistory = await api(context, '/api/runs?status=ready', owner.id);
  assert.ok(readyHistory.items.some(item => item.id === mappingId), 'ready/mapping no filtro de histórico');
  assert.equal(visualCalls, 2, 'uma produção e uma validação visual');
  checked.push('T8.2: mapear aplicação pelo site com sessões visuais substituídas → 202 → mapa validado em ready/mapping → telas, transições, caminhos, pendências, limitações, ações e capturas por blob → evidência isolada entre contas → persistência após recarregar');

  // T6.3 — a associação é simulada; API, interface, persistência e isolamento são reais.
  const beforeRoutes = await store.read(mappingId);
  await page.goto('/execucoes/' + mappingId);
  await bodyIncludes('a associação de percursos é uma etapa separada');
  await bodyIncludes('Casos lógicos — mapa disponível, aguardando associação dos percursos.');
  holdRouteValidation = true;
  const detailPost = page.waitForResponse(response => response.url().endsWith(`/api/runs/${mappingId}/continue`));
  await page.getByRole('button', { name: 'Detalhar percursos', exact: true }).click();
  assert.equal((await detailPost).status(), 202);
  await bodyIncludes('Validando as associações de percursos');
  await waitForPreparationHeld();
  const provisionalRoutes = await api(context, `/api/runs/${mappingId}`, owner.id);
  assert.equal(provisionalRoutes.routeDetail.ready, false);
  assert.equal(await page.getByText('Percursos validados — aguardando execução dos testes', { exact: true }).count(), 0);
  holdRouteValidation = false; releasePreparation();
  await bodyIncludes('Percursos validados — aguardando execução dos testes');
  await bodyIncludes('Casos aprovados. Consulte o detalhamento e suas pendências abaixo.');
  const detailed = await api(context, `/api/runs/${mappingId}`, owner.id);
  assert.equal(detailed.status, 'ready'); assert.equal(detailed.phase, 'route_detail');
  assert.equal(detailed.canDetailRoutes, false); assert.equal(detailed.routeDetail.ready, true);
  assert.equal(detailed.routeDetail.payload.testCases.length, detailed.cases.payload.testCases.length);
  assert.ok(detailed.routeDetail.payload.pending.length > 0, 'pendências localizadas permanecem');
  const afterRoutes = await store.read(mappingId);
  assert.deepEqual(afterRoutes.run.outputs.slice(0, -1), beforeRoutes.run.outputs);
  assert.deepEqual(afterRoutes.run.approvals, beforeRoutes.run.approvals);
  const casePanel = page.locator('section.panel').filter({ has: page.getByRole('heading', { name: 'Casos de teste', exact: true }) });
  await casePanel.locator('details').first().locator('summary').click();
  await bodyIncludes('entrar → Início'); await bodyIncludes('abrir-reservas → Reservas');
  const pendingCaseIndex = detailed.cases.payload.testCases.findIndex(item => item.id === detailed.routeDetail.payload.pending[0].caseId);
  await casePanel.locator('details').nth(pendingCaseIndex).locator('summary').click();
  await bodyIncludes('O mapa não identifica o percurso de consulta da observação.');
  // Capturas legítimas do mapa continuam na página; os novos painéis são texto.
  await noMarkup(casePanel);
  await noMarkup(page.locator('section.panel').filter({ has: page.getByRole('heading', { name: 'Detalhamento dos percursos', exact: true }) }));
  await screenshot('19-percursos-desktop.png', 1366);
  await screenshot('20-percursos-mobile.png', 390);
  await page.reload(); await bodyIncludes('Percursos validados — aguardando execução dos testes');
  const persistedRoutes = await api(context, `/api/runs/${mappingId}`, owner.id);
  assert.deepEqual(persistedRoutes.routeDetail, detailed.routeDetail);
  const repeatRoutes = await context.request.post(`/api/runs/${mappingId}/continue`, {
    headers: { Origin: origin, 'X-Expected-User-Id': owner.id },
    data: { outputId: mapping.mapping.id, outputRevision: mapping.mapping.revision } });
  assert.equal(repeatRoutes.status(), 200);
  const foreignRoutes = await foreignContext.request.get(`/api/runs/${mappingId}`, { headers: { 'X-Expected-User-Id': other.id } });
  assert.equal(foreignRoutes.status(), 404);
  await foreignContext.close();
  assert.equal(await page.getByRole('button', { name: 'Executar testes', exact: true }).count(), 0);
  checked.push('T6.3: detalhar pela interface → andamento/provisório → percursos validados e pendências por caso → snapshots/aprovações preservados → recarga/idempotência/isolamento → desktop e mobile');
  }
  await regressions(origin, store, owner, other);
  result = { status: 'passed', scope: 'T2.1/T4.1/T6.1/T6.2/T8.1/T8.2/T6.3 — navegador, API, coordenador e persistência reais; chamada de modelo substituída, sem inferência paga', checked,
    node: process.versions.node, chromium: browser.version(), durationMs: Date.now() - started };
} catch (error) {
  result = { status: 'failed', checked, error: error.message, pageUrl: page?.url(), durationMs: Date.now() - started };
  if (artifactDir && page) await page.screenshot({ path: join(artifactDir, 'web-failure.png'), fullPage: true }).catch(() => {});
  console.error(error);
  process.exitCode = 1;
} finally {
  releaseResponse();
  releasePreparation();
  if (artifactDir && result) await writeFile(join(artifactDir, 'web-result.json'), JSON.stringify(result, null, 2));
  if (result) console.log(JSON.stringify(result));
  await browser?.close();
  if (server?.listening) {
    server.close();
    server.closeAllConnections();
    await once(server, 'close');
  }
  await rm(root, { recursive: true, force: true });
}
