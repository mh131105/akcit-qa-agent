// T8.2-R1 — Ensaio real do mapeamento visual validado.
// Usa a composição normal do aplicativo (createApp sem substituições), armazenamento
// isolado e credenciais privadas do ambiente: modelCall, visualCall, preflight,
// navegador e pareceres são os reais. Nunca é parte de npm test nem do CI.
// Executar na imagem final (Xvfb + Chromium) com `node scripts/eval-mapping-real.mjs --run`.
import assert from 'node:assert/strict';
import { loadEnvFile } from 'node:process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { createApp } from '../dist/app.js';
import { readConfig, resolvePreparationModels, resolveVisualModels } from '../dist/config.js';
import { RunStore } from '../dist/storage/runs.js';
import { executeVisualTask } from '../dist/runtime/pi-visual.js';
import { parseVerdict } from '../dist/domain/preparation.js';
import { createDemoTarget } from './demo-target.mjs';

assert.equal(Number(process.versions.node.split('.')[0]), 24, 'Execute com Node.js 24.');
assert.ok(process.argv.includes('--run'), 'Inferência real: use --run depois de configurar privadamente o ambiente.');
try { loadEnvFile('.env'); } catch { /* variáveis já vêm do ambiente do container */ }

// Perfis documentados, sem fallback silencioso: a indisponibilidade recusa o início.
const PROFILES = {
  PI_CURATOR_PROVIDER: 'deepseek', PI_CURATOR_MODEL: 'deepseek-flash', PI_CURATOR_THINKING_LEVEL: 'low',
  PI_PLANNER_PROVIDER: 'deepseek', PI_PLANNER_MODEL: 'deepseek-v4-pro', PI_PLANNER_THINKING_LEVEL: 'high',
  PI_VALIDATOR_PROVIDER: 'deepseek', PI_VALIDATOR_MODEL: 'deepseek-v4-pro', PI_VALIDATOR_THINKING_LEVEL: 'high',
  PI_EXECUTOR_PROVIDER: 'deepseek', PI_EXECUTOR_MODEL: 'deepseek-flash', PI_EXECUTOR_THINKING_LEVEL: 'high',
  PI_VALIDATOR_VISUAL_PROVIDER: 'deepseek', PI_VALIDATOR_VISUAL_MODEL: 'deepseek-flash', PI_VALIDATOR_VISUAL_THINKING_LEVEL: 'high',
};
const env = { ...process.env, ...PROFILES };
const humanDir = process.env.EVAL_HUMAN_DIR ? resolvePath(process.env.EVAL_HUMAN_DIR) : null;
const evidenceDir = resolvePath(process.env.EVAL_EVIDENCE_DIR ?? join(tmpdir(), 'akcit-eval-mapping-real-' + Date.now()));
function resolvePath(path) { return join(process.cwd(), path); }
const TARGET_USER = process.env.DEMO_TARGET_USER ?? 'demo';
const TARGET_PASSWORD = process.env.DEMO_TARGET_PASSWORD ?? 'demo1234';
const MATERIAL = 'US-01: Criar reservas.\nCA-01: A quantidade de reserva aceita está entre 1 e 10.';
const ACCOUNT = { name: 'Avaliador Real', email: 'eval-mapping@example.test', password: 'senha ficticia longa 1!' };

const report = {
  startedAt: new Date().toISOString(), sha: process.env.APP_REVISION ?? null,
  image: process.env.EVAL_IMAGE ?? null, profiles: PROFILES, scenarios: [], failures: [],
};
const runs = new Map(); // runId -> { id, journey, review }
const dataDir = resolvePath(env.DATA_DIR ?? join(tmpdir(), 'akcit-eval-mapping-' + Date.now()));
const store = new RunStore(dataDir);
await store.initialize();
await rm(dataDir, { recursive: true, force: true });
await store.initialize();
const target = createDemoTarget({ port: 0, user: TARGET_USER, password: TARGET_PASSWORD, mode: 'reference' });
target.server.listen(0, '127.0.0.1');
await once(target.server, 'listening');
const targetOrigin = 'http://127.0.0.1:' + target.server.address().port;

// Porta livre para a aplicação, com APP_ORIGIN exato para a interface.
const probe = createServer();
probe.listen(0, '127.0.0.1');
await once(probe, 'listening');
const appPort = probe.address().port;
await new Promise(resolve => probe.close(resolve));
const origin = `http://127.0.0.1:${appPort}`;
const config = readConfig({ ...env, DATA_DIR: dataDir, APP_ORIGIN: origin,
  TARGET_ALLOWED_ORIGINS: targetOrigin, PILOT_ALLOWED_EMAILS: ACCOUNT.email });
const resolvedText = resolvePreparationModels(config);
const resolvedVisual = resolveVisualModels(config);
report.appliedModels = { textual: resolvedText, visual: resolvedVisual };
console.log(JSON.stringify({ event: 'eval-config', origin, targetOrigin, dataDir, models: report.appliedModels }));

const app = await createApp(config, {});
app.listen(appPort, '127.0.0.1');
await once(app, 'listening');

const headers = (cookie, userId) => ({ Origin: origin, 'Content-Type': 'application/json',
  ...(cookie ? { Cookie: cookie } : {}), 'X-Expected-User-Id': userId });
const json = async (path, value) => { await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 }); };
async function api(path, body, cookie, userId, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(origin + path, { method, headers: headers(cookie, userId),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
async function register() {
  const result = await api('/api/auth/register', ACCOUNT);
  if (result.status === 201) return { cookie: result.cookie, user: result.body.user };
  assert.equal(result.status, 409, JSON.stringify(result.body));
  const login = await api('/api/auth/login', { email: ACCOUNT.email, password: ACCOUNT.password });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  return { cookie: login.cookie, user: login.body.user };
}
async function waitFor(runId, cookie, userId, predicate, label, timeoutMs = 40 * 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const review = (await api('/api/runs/' + runId, undefined, cookie, userId)).body;
    if (predicate(review)) return review;
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  throw new Error('Tempo esgotado aguardando ' + label + ' na execução ' + runId);
}
function recordRun(runId, journey, review) { runs.set(runId, { id: runId, journey, review }); }

/** Exporta evidências de uma execução: registro sanitizado, capturas e projeção. */
async function exportRun(runId, cookie, userId, tag) {
  const review = (await api('/api/runs/' + runId, undefined, cookie, userId)).body;
  const stored = await store.read(runId);
  const sanitized = structuredClone(stored);
  delete sanitized.targetCredential;
  const directory = join(evidenceDir, tag + '-' + runId);
  await json(join(directory, 'review.json'), review);
  await json(join(directory, 'record.json'), sanitized);
  for (const observation of (stored.run.observations ?? [])) {
    await copyFile(join(dataDir, 'media', runId, observation.assetId + '.png'), join(directory, observation.assetId + '.png')).catch(() => {});
  }
  return { directory, review, stored };
}

/** Jornada completa via API: requisitos → curadoria → plano → aprovação → casos →
 * aprovação → acesso → mapeamento → validação visual. `approvalMode` registra como
 * as aprovações foram emitidas (humana/automatizada). */
async function fullJourney(journeyName, approvalMode) {
  const scenario = { name: journeyName, approvalMode, runId: null, steps: [], error: null };
  try {
    const { cookie, user } = await register();
    const created = await api('/api/runs', { name: journeyName, applicationName: 'Reservas (T7)', objective: '', text: MATERIAL }, cookie, user.id);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const runId = created.body.id;
    scenario.runId = runId;
    const start = await api('/api/runs/' + runId + '/start', {}, cookie, user.id);
    assert.equal(start.status, 202, JSON.stringify(start.body));
    let review = await waitFor(runId, cookie, user.id, item => item.status !== 'running', 'preparação do plano');
    assert.equal(review.status, 'awaiting_approval');
    assert.equal(review.phase, 'planning');
    scenario.steps.push('plano-validado');
    // Aprovação do plano (humana ou automatizada, registrada explicitamente).
    const plan = review.plan;
    const planApproval = await api('/api/runs/' + runId + '/approve', { outputId: plan.id, outputRevision: plan.revision }, cookie, user.id);
    assert.equal(planApproval.status, 200, JSON.stringify(planApproval.body));
    const casesAccepted = await api('/api/runs/' + runId + '/continue', { outputId: plan.id, outputRevision: plan.revision }, cookie, user.id);
    assert.equal(casesAccepted.status, 202, JSON.stringify(casesAccepted.body));
    review = await waitFor(runId, cookie, user.id, item => item.status !== 'running', 'geração dos casos');
    assert.equal(review.status, 'awaiting_approval');
    assert.equal(review.phase, 'case_design');
    scenario.steps.push('casos-validados');
    const cases = review.cases;
    const casesApproval = await api('/api/runs/' + runId + '/approve', { outputId: cases.id, outputRevision: cases.revision }, cookie, user.id);
    assert.equal(casesApproval.status, 200, JSON.stringify(casesApproval.body));
    // Acesso ao alvo com a credencial do ambiente.
    const access = await api('/api/runs/' + runId, { expectedAccessRevision: 0, startUrl: targetOrigin + '/',
      accessProfile: 'Operador de reservas', dataPreparation: 'Iniciar com a lista de reservas vazia.',
      authorizedTarget: true, credential: { username: TARGET_USER, password: TARGET_PASSWORD } }, cookie, user.id, 'PATCH');
    assert.equal(access.status, 200, JSON.stringify(access.body));
    const mappingAccepted = await api('/api/runs/' + runId + '/continue', { outputId: cases.id, outputRevision: cases.revision, expectedAccessRevision: 1 }, cookie, user.id);
    assert.equal(mappingAccepted.status, 202, JSON.stringify(mappingAccepted.body));
    review = await waitFor(runId, cookie, user.id, item => item.status !== 'running', 'mapeamento e validação visual');
    scenario.steps.push('mapeamento-concluido');
    recordRun(runId, journeyName, review);
    const exported = await exportRun(runId, cookie, user.id, journeyName);
    scenario.finalStatus = review.status;
    scenario.phase = review.phase;
    scenario.verdicts = review.mapping?.validations ?? [];
    scenario.calls = exported.stored.run.preparation?.calls ?? [];
    scenario.observations = review.observations?.length ?? 0;
    scenario.actions = review.mappingActions?.length ?? 0;
    assert.equal(target.reservations.length, 0, 'nenhuma reserva criada durante o mapeamento');
    assert.ok(!JSON.stringify(review.mapping?.payload).includes('caseId'), 'nenhum caso apresentado como executado');
    assert.equal(review.status, 'ready', JSON.stringify(review.stopReason));
    assert.equal(review.phase, 'mapping');
    assert.ok((review.mapping?.validations ?? []).at(-1)?.status === 'approved', 'mapa aprovado pelo validador visual real');
    // Imagens efetivamente recebidas: a chamada do validador registra consumo de entrada.
    const validatorCall = scenario.calls.find(call => call.phase === 'mapping_validation');
    scenario.validatorCall = validatorCall ?? null;
    return scenario;
  } catch (error) {
    scenario.error = error?.stack ?? String(error);
    report.failures.push({ scenario: journeyName, error: scenario.error });
    return scenario;
  } finally {
    report.scenarios.push(scenario);
  }
}

/** Cenário 2: credencial inválida, bloqueio pelo fluxo suportado, correção e
 * nova tentativa explícita, preservando histórico e tempo acumulado. */
async function invalidCredentialJourney() {
  const scenario = { name: 'credencial-invalida-e-correcao', runId: null, steps: [], error: null };
  try {
    const { cookie, user } = await register();
    const created = await api('/api/runs', { name: 'Credencial inválida e correção', applicationName: 'Reservas (T7)', objective: '', text: MATERIAL }, cookie, user.id);
    const runId = created.body.id;
    scenario.runId = runId;
    const start = await api('/api/runs/' + runId + '/start', {}, cookie, user.id);
    await waitFor(runId, cookie, user.id, item => item.status === 'awaiting_approval', 'plano');
    const plan = (await api('/api/runs/' + runId, undefined, cookie, user.id)).body.plan;
    await api('/api/runs/' + runId + '/approve', { outputId: plan.id, outputRevision: plan.revision }, cookie, user.id);
    await api('/api/runs/' + runId + '/continue', { outputId: plan.id, outputRevision: plan.revision }, cookie, user.id);
    await waitFor(runId, cookie, user.id, item => item.status === 'awaiting_approval' && item.phase === 'case_design', 'casos');
    const cases = (await api('/api/runs/' + runId, undefined, cookie, user.id)).body.cases;
    await api('/api/runs/' + runId + '/approve', { outputId: cases.id, outputRevision: cases.revision }, cookie, user.id);
    // Credencial deliberadamente incorreta.
    await api('/api/runs/' + runId, { expectedAccessRevision: 0, startUrl: targetOrigin + '/',
      accessProfile: 'Operador de reservas', dataPreparation: 'Lista vazia.', authorizedTarget: true,
      credential: { username: TARGET_USER, password: 'senha-incorreta-eval-1!' } }, cookie, user.id, 'PATCH');
    await api('/api/runs/' + runId + '/continue', { outputId: cases.id, outputRevision: cases.revision, expectedAccessRevision: 1 }, cookie, user.id);
    const blocked = await waitFor(runId, cookie, user.id, item => item.status !== 'running', 'bloqueio por credencial');
    scenario.blockedStatus = blocked.status;
    scenario.blockedStopReason = blocked.stopReason;
    scenario.steps.push('bloqueio-observado');
    assert.equal(blocked.status, 'awaiting_input');
    assert.equal(blocked.stopReason?.code, 'CREDENTIAL_REJECTED');
    const before = await store.read(runId);
    scenario.historyBefore = { mappingOutputs: before.run.outputs.filter(output => output.phase === 'mapping').length, accumulatedActiveMs: before.run.preparation?.accumulatedActiveMs };
    // Correção pelo fluxo suportado: nova revisão de acesso e nova tentativa explícita.
    await api('/api/runs/' + runId, { expectedAccessRevision: 1, startUrl: targetOrigin + '/',
      accessProfile: 'Operador de reservas', dataPreparation: 'Lista vazia.', authorizedTarget: true,
      credential: { username: TARGET_USER, password: TARGET_PASSWORD } }, cookie, user.id, 'PATCH');
    await api('/api/runs/' + runId + '/continue', { outputId: cases.id, outputRevision: cases.revision, expectedAccessRevision: 2 }, cookie, user.id);
    const review = await waitFor(runId, cookie, user.id, item => item.status !== 'running', 'nova tentativa de mapeamento');
    scenario.finalStatus = review.status;
    scenario.verdicts = review.mapping?.validations ?? [];
    const after = await store.read(runId);
    scenario.historyAfter = { mappingOutputs: after.run.outputs.filter(output => output.phase === 'mapping').length, accessRevision: after.run.input.accessRevision, accumulatedActiveMs: after.run.preparation?.accumulatedActiveMs };
    assert.equal(review.status, 'ready');
    assert.equal(review.phase, 'mapping');
    assert.ok((after.run.preparation?.accumulatedActiveMs ?? 0) >= (before.run.preparation?.accumulatedActiveMs ?? 0), 'tempo acumulado preservado, sem zerar');
    await exportRun(runId, cookie, user.id, 'credencial');
    return scenario;
  } catch (error) {
    scenario.error = error?.stack ?? String(error);
    report.failures.push({ scenario: scenario.name, error: scenario.error });
    return scenario;
  } finally {
    report.scenarios.push(scenario);
  }
}

/** Cenário 3: controles positivo e negativo do validador visual real.
 * O positivo é o parecer real da jornada aprovada; o negativo usa uma cópia do
 * mapa com uma transição deliberadamente sem suporte (referências existentes). */
async function validatorControls(approvedRunId) {
  const scenario = { name: 'validador-controle-positivo-negativo', error: null, positive: null, negative: null };
  try {
    const stored = await store.read(approvedRunId);
    const run = stored.run;
    const mapping = run.outputs.filter(output => output.phase === 'mapping').at(-1);
    assert.ok(mapping, 'mapa real ausente');
    const payload = mapping.payload;
    const curation = run.outputs.filter(output => output.phase === 'curation').at(-1);
    const plan = run.outputs.filter(output => output.phase === 'planning').at(-1);
    const cases = run.outputs.filter(output => output.phase === 'case_design').at(-1);
    scenario.positive = { verdict: run.validations.filter(item => item.outputId === mapping.id && item.outputRevision === mapping.revision).at(-1) };
    const references = new Set([...payload.map.screens.flatMap(screen => screen.observationIds),
      ...payload.map.transitions.flatMap(transition => transition.observationIds),
      ...(payload.authentication.status === 'authenticated' ? [payload.authentication.observationId] : [])]);
    const ordered = [...references];
    const images = await Promise.all(ordered.map(async observationId => {
      const observation = run.observations.find(item => item.id === observationId);
      return { data: (await readFile(join(dataDir, 'media', approvedRunId, observation.assetId + '.png'))).toString('base64'), mimeType: 'image/png' };
    }));
    const manifest = ordered.map((observationId, imageIndex) => {
      const observation = run.observations.find(item => item.id === observationId);
      return { imageIndex, observationId, assetId: observation.assetId, at: observation.at, width: observation.width, height: observation.height };
    });
    const referencedActionIds = new Set(payload.map.transitions.map(transition => transition.actionId));
    const actions = (run.mappingActions ?? []).filter(action => referencedActionIds.has(action.id));
    // Cópia negativa: uma transição sem suporte visual, mantendo IDs existentes.
    const altered = structuredClone(payload);
    const targetTransition = altered.map.transitions.find(transition => transition.id !== payload.map.transitions[0]?.id) ?? altered.map.transitions[0];
    assert.ok(targetTransition, 'transição real ausente para o controle negativo');
    const unrelated = altered.map.screens.flatMap(screen => screen.observationIds)
      .filter(id => !targetTransition.observationIds.includes(id));
    targetTransition.observationIds = [unrelated[0] ?? targetTransition.observationIds[0]];
    const buildContext = output => ({ task: 'validation', artifacts: run.artifacts, curation, plan, approvedCases: cases,
      output, manifest: { observations: manifest }, actions, previousOutput: null, previousVerdicts: [] });
    const negativeResult = await executeVisualTask({
      role: 'output-validator', kind: 'validate-navigation', model: resolvedVisual['validator-visual'],
      prompt: JSON.stringify(buildContext({ ...mapping, id: randomUUID(), revision: 1, payload: altered })),
      images, perCallTimeoutMs: 120_000, signal: new AbortController().signal,
      callMeta: { attempt: 1, outputRevision: 1 },
      ...(config.piAuthPath ? { authPath: config.piAuthPath } : {}),
    });
    scenario.negative = { verdict: parseVerdict(negativeResult.payload), metadata: negativeResult.metadata,
      alteredTransition: targetTransition.id, calls: negativeResult.calls };
    scenario.steps = ['parecer-negativo-registrado'];
    assert.ok(['changes_requested', 'blocked'].includes(scenario.negative.verdict.status), 'validador não aprovou a transição sem suporte');
    return scenario;
  } catch (error) {
    scenario.error = error?.stack ?? String(error);
    report.failures.push({ scenario: scenario.name, error: scenario.error });
    return scenario;
  } finally {
    report.scenarios.push(scenario);
  }
}

/** Jornada A acompanhada pela interface, com revisão humana efetiva (arquivo de
 * decisão em EVAL_HUMAN_DIR). Aprovações da jornada B são automatizadas e
 * registradas como tal. */
async function main() {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium', headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    let approvedRunId = null;
    // Jornada A: interface real + revisão humana do plano e dos casos.
    {
      const scenario = { name: 'jornada-completa-interface-revisao-humana', approvalMode: 'humana (arquivo de decisão em EVAL_HUMAN_DIR)', runId: null, steps: [], error: null };
      try {
        const context = await browser.newContext({ baseURL: origin, viewport: { width: 1366, height: 900 } });
        const page = await context.newPage();
        page.setDefaultTimeout(20000);
        await page.goto('/');
        await page.waitForURL('**/acesso*');
        await page.getByRole('button', { name: 'Criar conta', exact: true }).click();
        await page.getByLabel('Nome', { exact: true }).fill(ACCOUNT.name);
        await page.getByLabel('E-mail', { exact: true }).fill(ACCOUNT.email);
        await page.getByLabel('Senha', { exact: true }).fill(ACCOUNT.password);
        await page.getByRole('button', { name: 'Cadastrar e entrar', exact: true }).click();
        await page.waitForURL(url => url.pathname.startsWith('/execucoes'));
        const sessionCookie = 'akcit_session=' + (await context.cookies()).find(cookie => cookie.name === 'akcit_session')?.value;
        const me = await (await context.request.get(origin + '/api/auth/me')).json();
        const userId = me.user.id;
        // Criação pela interface.
        await page.getByRole('link', { name: 'Nova execução', exact: true }).first().click();
        await page.getByLabel('Nome da execução', { exact: true }).fill('Ensaio real — interface e revisão humana');
        await page.getByLabel('Material de requisitos', { exact: true }).fill(MATERIAL);
        await page.getByRole('button', { name: 'Salvar rascunho', exact: true }).click();
        await page.waitForURL(url => /^\/execucoes\/run-/.test(url.pathname));
        const runId = new URL(page.url()).pathname.split('/').at(-1);
        scenario.runId = runId;
        // Preparação pela interface.
        const startResponse = page.waitForResponse(response => response.url().endsWith(`/api/runs/${runId}/start`));
        await page.getByRole('button', { name: 'Preparar plano', exact: true }).click();
        assert.equal((await startResponse).status(), 202);
        await page.getByRole('button', { name: 'Aprovar plano', exact: true }).waitFor({ timeout: 40 * 60_000 });
        // Revisão humana efetiva do plano (conteúdo real impresso e decidido pelo operador).
        const planReview = (await context.request.get(origin + `/api/runs/${runId}`)).then(r => r.json());
        if (humanDir) {
          await json(join(humanDir, 'awaiting-plan-' + runId + '.json'), { runId, input: MATERIAL, curation: planReview.curation, plan: planReview.plan });
          const decisionFile = join(humanDir, 'decision-plan-' + runId + '.json');
          const decision = await waitForHumanDecision(decisionFile);
          assert.equal(decision.decision, 'approved', 'revisão humana recusou o plano: ' + JSON.stringify(decision));
          scenario.humanPlan = decision;
        } else {
          throw new Error('EVAL_HUMAN_DIR é obrigatório para a jornada com revisão humana.');
        }
        await page.getByRole('button', { name: 'Aprovar plano', exact: true }).click();
        await page.getByRole('button', { name: 'Gerar casos de teste', exact: true }).waitFor({ timeout: 40 * 60_000 });
        const generateCases = page.waitForResponse(response => response.url().endsWith(`/api/runs/${runId}/continue`));
        await page.getByRole('button', { name: 'Gerar casos de teste', exact: true }).click();
        assert.equal((await generateCases).status(), 202);
        await page.getByRole('button', { name: 'Aprovar casos de teste', exact: true }).waitFor({ timeout: 40 * 60_000 });
        // Revisão humana efetiva dos casos.
        const caseReview = await (await context.request.get(origin + `/api/runs/${runId}`)).json();
        if (humanDir) {
          await json(join(humanDir, 'awaiting-cases-' + runId + '.json'), { runId, curation: caseReview.curation, plan: caseReview.plan, cases: caseReview.cases });
          const decisionFile = join(humanDir, 'decision-cases-' + runId + '.json');
          const decision = await waitForHumanDecision(decisionFile);
          assert.equal(decision.decision, 'approved', 'revisão humana recusou os casos: ' + JSON.stringify(decision));
          scenario.humanCases = decision;
        }
        await page.getByRole('button', { name: 'Aprovar casos de teste', exact: true }).click();
        // Acesso pela interface.
        await page.getByLabel('URL inicial', { exact: true }).fill(targetOrigin + '/');
        await page.getByLabel('Perfil de acesso', { exact: true }).fill('Operador de reservas');
        await page.getByLabel('Preparação necessária', { exact: true }).fill('Iniciar com a lista de reservas vazia.');
        await page.getByLabel('Usuário da conta de teste', { exact: true }).fill(TARGET_USER);
        await page.getByLabel('Senha da conta de teste', { exact: true }).fill(TARGET_PASSWORD);
        await page.getByLabel('Confirmo que tenho autorização para testar esta aplicação', { exact: true }).check();
        await page.getByRole('button', { name: 'Salvar acesso', exact: true }).click();
        await page.getByRole('button', { name: 'Mapear aplicação', exact: true }).waitFor({ timeout: 60_000 });
        // Mapeamento pela interface com navegador e pareceres reais.
        const mappingPost = page.waitForResponse(response => response.url().endsWith(`/api/runs/${runId}/continue`));
        await page.getByRole('button', { name: 'Mapear aplicação', exact: true }).click();
        assert.equal((await mappingPost).status(), 202);
        await page.getByText('Mapa validado — aguardando detalhamento dos percursos.', { exact: false }).first().waitFor({ timeout: 40 * 60_000 });
        scenario.steps.push('mapa-validado-na-interface');
        // Recarregar preserva mapa e capturas.
        await page.reload();
        await page.getByText('Mapa validado — aguardando detalhamento dos percursos.', { exact: false }).first().waitFor({ timeout: 60_000 });
        await page.waitForFunction(() => {
          const image = document.querySelector('img[alt="Captura da tela observada"]');
          return image && image.complete && image.naturalWidth > 0 && image.src.startsWith('blob:');
        }, null, { timeout: 30_000 });
        await page.screenshot({ path: join(evidenceDir, 'ui-mapa-' + runId + '.png'), fullPage: true });
        const finalReview = await (await context.request.get(origin + `/api/runs/${runId}`)).json();
        assert.equal(finalReview.status, 'ready');
        assert.equal(finalReview.phase, 'mapping');
        assert.ok(!JSON.stringify(finalReview.mapping?.payload).includes('caseId'));
        assert.equal(target.reservations.length, 0);
        recordRun(runId, scenario.name, finalReview);
        const exported = await exportRun(runId, sessionCookie, userId, 'jornada-interface');
        scenario.verdicts = finalReview.mapping?.validations ?? [];
        scenario.calls = exported.stored.run.preparation?.calls ?? [];
        approvedRunId = runId;
        await context.close();
      } catch (error) {
        scenario.error = error?.stack ?? String(error);
        report.failures.push({ scenario: scenario.name, error: scenario.error });
      } finally {
        report.scenarios.push(scenario);
      }
    }
    // Jornada B: aprovações automatizadas, registradas como tal.
    await fullJourney('jornada-completa-aprovacoes-automatizadas', 'automatizada (roteiro)');
    // Cenário 2: credencial inválida e correção.
    await invalidCredentialJourney();
    // Cenário 3: controles do validador a partir do mapa real da jornada A.
    if (approvedRunId) await validatorControls(approvedRunId);
  } finally {
    await browser.close();
  }
  await json(join(evidenceDir, 'report.json'), report);
  console.log(JSON.stringify({ event: 'eval-finished', evidenceDir, scenarios: report.scenarios.map(scenario => ({ name: scenario.name, error: scenario.error ?? null, finalStatus: scenario.finalStatus ?? scenario.blockedStatus ?? null })) }, null, 2));
  if (report.failures.length) {
    console.error('Ensaios com falha:', JSON.stringify(report.failures, null, 2));
    process.exitCode = 1;
  }
}

async function waitForHumanDecision(decisionFile, timeoutMs = 30 * 60_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const decision = JSON.parse(await readFile(decisionFile, 'utf8'));
      if (decision && typeof decision.decision === 'string') return decision;
    } catch {}
    if (Date.now() > deadline) throw new Error('Decisão humana não chegou em tempo: ' + decisionFile);
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
}

await main();
await app.shutdown();
app.close(); app.closeAllConnections(); await once(app, 'close');
if (target.server.listening) { target.server.close(); await once(target.server, 'close'); }
