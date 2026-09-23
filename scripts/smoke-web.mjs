import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { createApp } from '../dist/app.js';
import { readConfig } from '../dist/config.js';
import { RunStore } from '../dist/storage/runs.js';

// Jornada real do site/API. Somente planos são preparados no armazenamento
// temporário: este smoke não gera planos por IA nem chama provedores de LLM.
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
  await page.getByRole('button', { name: 'Entrar na conta', exact: true }).click();
  await page.waitForURL(url => url.pathname.startsWith('/execucoes'));
}
async function register(account, targetPage = page) {
  await targetPage.getByRole('button', { name: 'Criar conta', exact: true }).click();
  await targetPage.getByLabel('Nome', { exact: true }).fill(account.name);
  await targetPage.getByLabel('E-mail', { exact: true }).fill(account.email);
  await targetPage.getByLabel('Senha', { exact: true }).fill(account.password);
  if (account.teamName) await targetPage.getByLabel('Nome da equipe (opcional)', { exact: true }).fill(account.teamName);
  await targetPage.getByRole('button', { name: 'Cadastrar e entrar', exact: true }).click();
  await targetPage.waitForURL('**/execucoes');
}
async function fillRun(runName, content) {
  await page.getByLabel('Nome da execução', { exact: true }).fill(runName);
  await page.getByLabel('Aplicação', { exact: true }).fill('Reservas de exemplo');
  await page.getByLabel('Objetivo (opcional)', { exact: true }).fill('Verificar os limites documentados.');
  await page.getByLabel('Histórias de usuário e critérios de aceite', { exact: true }).fill(content);
}
async function api(context, path) {
  const response = await context.request.get(path);
  assert.equal(response.status(), 200, `Consulta real ${path}`);
  return response.json();
}
async function noMarkup() {
  assert.equal(await page.locator('img, svg[data-smoke]').count(), 0, 'Conteúdo recebido deve ser texto.');
  assert.equal(await page.evaluate(() => globalThis.smokeInjected), undefined);
}
async function screenshot(filename, width) {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
  await page.evaluate(() => document.fonts.ready);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    `A página não deve transbordar horizontalmente em ${width}px.`);
  if (artifactDir) await page.screenshot({ path: join(artifactDir, filename), fullPage: true });
}

try {
  if (artifactDir) await mkdir(artifactDir, { recursive: true });
  const config = readConfig({ DATA_DIR: root, PILOT_ALLOWED_EMAILS: accounts.map(account => account.email).join(',') });
  server = await createApp(config, { now: () => clock });
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
  await register(accounts[0]);
  const owner = (await api(context, '/api/auth/me')).user;
  const otherContext = await browser.newContext({ baseURL: origin });
  const otherPage = await otherContext.newPage();
  await otherPage.goto('/acesso');
  await register(accounts[1], otherPage);
  await otherContext.close();
  await bodyIncludes(/nenhuma execução|primeira execução/i);
  assert.deepEqual((await api(context, '/api/runs')).items, []);
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
  assert.equal((await api(context, `/api/runs/${draftId}`)).plan, null);
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

  await page.goto('/execucoes/nova');
  await fillRun(pendingName, pendingText);
  const sent = [];
  let lost = true;
  const heldResponse = new Promise(resolve => { releaseResponse = resolve; });
  await page.route('**/api/runs', async route => {
    const request = route.request();
    if (request.method() !== 'POST') return route.continue();
    sent.push({ key: request.headers()['idempotency-key'], body: request.postData(), origin: request.headers().origin });
    if (!lost) return route.continue();
    lost = false;
    const response = await route.fetch(); // A API persiste antes de perdermos só a resposta.
    assert.equal(response.status(), 201);
    await heldResponse;
    await route.abort('connectionreset');
  });
  const savingButton = page.getByRole('button', { name: /Salvar rascunho|Tentar confirmar salvamento/ });
  await savingButton.dblclick({ delay: 30 });
  assert.equal(await savingButton.isDisabled(), true, 'Botão desabilitado enquanto a resposta não chega.');
  releaseResponse();
  await visible(page.getByRole('button', { name: 'Tentar confirmar salvamento', exact: true }));
  assert.equal((await api(context, '/api/runs')).items.length, 2);
  const storedAttempt = await page.evaluate(id => JSON.parse(sessionStorage.getItem(`akcit.intake.v1:${id}`)), owner.id);
  assert.deepEqual(storedAttempt, { accountId: owner.id, key: sent[0].key, body: sent[0].body });
  assert.equal(await page.getByLabel('Histórias de usuário e critérios de aceite', { exact: true }).inputValue(), pendingText);
  assert.equal(await page.getByLabel('Nome da execução', { exact: true }).isEditable(), false);
  await page.reload();
  await visible(page.getByRole('button', { name: 'Tentar confirmar salvamento', exact: true }));
  assert.equal(await page.getByLabel('Histórias de usuário e critérios de aceite', { exact: true }).inputValue(), pendingText);
  clock += 8 * 60 * 60 * 1000 + 1;
  await page.reload();
  await page.waitForURL('**/acesso*');
  assert.ok(!(await page.locator('body').innerText()).includes(pendingText));
  await login(accounts[1]);
  assert.equal(await page.getByLabel('Histórias de usuário e critérios de aceite', { exact: true }).inputValue(), '');
  assert.equal(await page.getByLabel('Nome da execução', { exact: true }).inputValue(), '');
  assert.equal(await page.getByRole('button', { name: 'Tentar confirmar salvamento', exact: true }).count(), 0);
  assert.deepEqual(await page.evaluate(id => JSON.parse(sessionStorage.getItem(`akcit.intake.v1:${id}`)), owner.id), storedAttempt);
  clock += 8 * 60 * 60 * 1000 + 1;
  await page.reload();
  await page.waitForURL('**/acesso*');
  await login(accounts[0]);
  await visible(page.getByRole('button', { name: 'Tentar confirmar salvamento', exact: true }));
  assert.equal(await page.getByLabel('Histórias de usuário e critérios de aceite', { exact: true }).inputValue(), pendingText);
  await page.getByRole('button', { name: 'Tentar confirmar salvamento', exact: true }).click();
  await page.waitForURL(url => /^\/execucoes\/run-/.test(url.pathname));
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[1], sent[0], 'Repetir exatamente a mesma chave, corpo e origem após recarregar.');
  assert.match(sent[0].key, /^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i);
  assert.equal(sent[0].origin, origin);
  assert.equal((await api(context, '/api/runs')).items.length, 2);
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
  assert.deepEqual((await api(context, '/api/runs')).items, []);
  await page.goto(`/execucoes/${draftId}`);
  await bodyIncludes(/não encontrad/i);
  assert.ok(!(await page.locator('body').innerText()).includes(name));
  assert.equal((await context.request.get(`/api/runs/${draftId}`)).status(), 404);
  await page.goto('/execucoes/nova');
  assert.equal(await page.getByLabel('Histórias de usuário e critérios de aceite', { exact: true }).inputValue(), '');
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
  const approved = await api(context, '/api/runs/plan-approve');
  assert.equal(approved.status, 'awaiting_approval');
  assert.equal(approved.phase, 'planning');
  assert.equal(approved.approvals.length, 1);
  assert.equal(approved.approvals[0].decision, 'approved');
  assert.equal(approved.approvals[0].outputRevision, 1);
  assert.deepEqual((await store.read('plan-approve')).workIntents, []);
  await page.reload();
  await visible(page.getByText('Plano aprovado · Revisão 1', { exact: true }));
  assert.deepEqual((await api(context, '/api/runs/plan-approve')).approvals, approved.approvals);
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
  const changed = await api(context, '/api/runs/plan-changes');
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
  assert.deepEqual((await api(context, '/api/runs/plan-stale')).approvals, []);
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
  const conflict = await api(context, '/api/runs/plan-conflict');
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
  await page.getByLabel('Histórias de usuário e critérios de aceite', { exact: true }).fill(oversized);
  await page.getByRole('button', { name: 'Salvar rascunho', exact: true }).click();
  await bodyIncludes(/JSON completo excede 16 KiB/i);
  assert.equal(creationCount, beforeOversize, 'JSON acima de 16 KiB não deve ser enviado.');
  assert.equal(await page.getByLabel('Histórias de usuário e critérios de aceite', { exact: true }).inputValue(), oversized);
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
  result = { status: 'passed', scope: 'T2.1 — navegador, API e persistência reais; planos sintéticos, sem IA', checked,
    node: process.versions.node, chromium: browser.version(), durationMs: Date.now() - started };
} catch (error) {
  result = { status: 'failed', checked, error: error.message, durationMs: Date.now() - started };
  if (artifactDir && page) await page.screenshot({ path: join(artifactDir, 'web-failure.png'), fullPage: true }).catch(() => {});
  console.error(error);
  process.exitCode = 1;
} finally {
  releaseResponse();
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
