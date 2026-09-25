import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { createApp } from '../src/app.js';
import { readConfig } from '../src/config.js';
import { RunStore } from '../src/storage/runs.js';

// T8.2 — Contratos, autorização, revisões, pareceres e transições do mapeamento.
// Sessões visuais substituídas explicitamente; observações e ações usam o mesmo
// caminho de persistência das ferramentas reais (arquivos PNG reais no disco).
const appOrigin = 'http://localhost:3000';
const targetOrigin = 'http://127.0.0.1:4000';
const accounts = [
  { name: 'Pessoa Um', email: 'one@example.test', password: 'senha ficticia longa 1!' },
  { name: 'Pessoa Dois', email: 'two@example.test', password: 'senha ficticia longa 2!' },
];
const cookieOf = (response: Response) => response.headers.get('set-cookie')!.split(';')[0]!;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const limits = { maxRequirements: 10, maxRevisions: 3, maxValidatorAttempts: 2, timeoutMs: 120000, activeMs: 2700000 };
const visualModels = {
  executor: { provider: 'deepseek', model: 'deepseek-flash', thinkingLevel: 'high' as const },
  'validator-visual': { provider: 'deepseek', model: 'deepseek-flash', thinkingLevel: 'high' as const },
};
async function harness(t: TestContext, options: { visualCall?: unknown } = {}) {
  const dataDir = await fs.mkdtemp(join(tmpdir(), 'akcit-navigation-'));
  const config = readConfig({
    DATA_DIR: dataDir, APP_ORIGIN: appOrigin, TARGET_ALLOWED_ORIGINS: targetOrigin,
    PILOT_ALLOWED_EMAILS: accounts.map(account => account.email).join(','),
  });
  let app = await createApp(config, {
    ...(options.visualCall ? { visualCall: options.visualCall as never } : {}),
    visualPreflight: async () => visualModels,
  });
  let base = '';
  async function listen() {
    app.listen(0, '127.0.0.1');
    await once(app, 'listening');
    const address = app.address();
    assert.ok(address && typeof address !== 'string');
    base = 'http://127.0.0.1:' + address.port;
  }
  async function close() { await app.shutdown(); app.close(); app.closeAllConnections(); await once(app, 'close'); }
  await listen();
  t.after(async () => { await close(); await fs.rm(dataDir, { recursive: true, force: true }); });
  const expectedUsers = new Map<string, string>();
  async function request(path: string, body?: unknown, cookie?: string, overrides: RequestInit = {}) {
    const expectedUserId = cookie && expectedUsers.get(cookie);
    const headers = new Headers({
      Origin: appOrigin, 'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
      ...(expectedUserId && path.startsWith('/api/runs') ? { 'X-Expected-User-Id': expectedUserId } : {}),
    });
    new Headers(overrides.headers).forEach((value, name) => headers.set(name, value));
    const response = await fetch(base + path, {
      method: overrides.method ?? (body === undefined ? 'GET' : 'POST'),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...overrides, headers,
    });
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const text = await response.text();
    const result = text ? JSON.parse(text) : null;
    if (response.ok && ['/api/auth/register', '/api/auth/login'].includes(path)) expectedUsers.set(cookieOf(response), result.user.id);
    return { response, status: response.status, body: result, text };
  }
  async function register(index = 0) {
    const result = await request('/api/auth/register', accounts[index]);
    assert.equal(result.status, 201, JSON.stringify(result.body));
    return { user: result.body.user, cookie: cookieOf(result.response) };
  }
  async function createRun(cookie: string, name = 'Mapeamento de teste') {
    const result = await request('/api/runs', {
      name, applicationName: 'Aplicação alvo', objective: 'Mapear a navegação.',
      text: 'US-01: Fazer reservas.\nCA-01: Quantidade de 1 a 10.',
    }, cookie, { headers: { 'Idempotency-Key': randomUUID() } });
    assert.equal(result.status, 201, JSON.stringify(result.body));
    return result.body;
  }
  return {
    dataDir, store: new RunStore(dataDir), request, register, createRun,
    get base() { return base; },
  };
}

/** Semeia curadoria, plano e casos aprovados e validados, além da preparação encerrada. */
async function seedApproved(h: { store: RunStore }, runId: string, ownerId: string) {
  const at = '2026-09-24T10:00:00.000Z';
  await h.store.update(runId, record => {
    const run = record.run;
    const artifactId = (run.artifacts[0] as { id: string }).id;
    const sources = [{ artifactId, locator: 'L1', quote: 'US-01: Fazer reservas.' }];
    run.outputs.push(
      { id: 'out-curation', phase: 'curation', revision: 1, dependsOn: [], producer: 'artifact-curator',
        createdAt: at, answerRefs: [], payload: { requirements: [{ id: 'US-01', statement: 'Fazer reservas.', sources,
          rules: [{ id: 'CA-01', statement: 'Quantidade de 1 a 10.', sources }] }], questions: [] } },
      { id: 'out-plan', phase: 'planning', revision: 1, dependsOn: [{ outputId: 'out-curation', revision: 1 }],
        producer: 'test-designer', createdAt: at, answerRefs: [], payload: { testPlan: {
          objective: 'Conferir reservas.', requirementIds: ['US-01'], ruleIds: ['CA-01'],
          priorities: [{ ruleId: 'CA-01', reason: 'Limite documentado.' }], exclusions: [],
          approach: ['Análise de limites'], preconditions: [], sources } } },
      { id: 'out-cases', phase: 'case_design', revision: 1, dependsOn: [{ outputId: 'out-curation', revision: 1 }, { outputId: 'out-plan', revision: 1 }],
        producer: 'test-designer', createdAt: at, answerRefs: [], payload: { testCases: [{ id: 'CT-01',
          requirementIds: ['US-01'], ruleIds: ['CA-01'], preconditions: [], setup: 'Sem preparo adicional.', pathId: null,
          data: { quantidade: 1 }, techniques: [{ name: 'AVL', description: 'Limite inferior.', values: [1] }],
          expected: 'Quantidade 1 aceita.', sources }] } },
    );
    for (const outputId of ['out-curation', 'out-plan', 'out-cases']) run.validations.push({ outputId, outputRevision: 1, validator: 'output-validator', status: 'approved' });
    run.approvals.push(
      { id: 'dec-plan', outputId: 'out-plan', outputRevision: 1, actorId: ownerId, at, decision: 'approved', comment: '' },
      { id: 'dec-cases', outputId: 'out-cases', outputRevision: 1, actorId: ownerId, at, decision: 'approved', comment: '' },
    );
    run.budgetCycles = [{ id: 'cycle-1', startedAt: '2026-09-24T09:58:00.000Z', reason: 'initial_preparation', answerRef: null, affectedCaseIds: [], limits: { ...limits } }];
    run.preparation = { id: 'prep-1', budgetCycleId: 'cycle-1', startedAt: '2026-09-24T09:58:00.000Z', finishedAt: at, activeRole: null, activity: null, stopReason: null, limits: { ...limits }, calls: [], accumulatedActiveMs: 120000, consumedAnswerIds: [] };
    run.status = 'awaiting_approval'; run.phase = 'case_design';
    return { save: true, value: undefined };
  });
}
async function configureAccess(h: { request: (path: string, body?: unknown, cookie?: string, overrides?: RequestInit) => Promise<{ status: number; body: any; response: Response }> }, runId: string, cookie: string, expected: number, password = 'demo1234') {
  const result = await h.request('/api/runs/' + runId, {
    expectedAccessRevision: expected, startUrl: targetOrigin, accessProfile: 'Operador de reservas',
    dataPreparation: 'Iniciar com a lista de reservas vazia.', authorizedTarget: true,
    credential: { username: 'demo', password },
  }, cookie, { method: 'PATCH' });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return result.body.targetAccess;
}

async function pollReview(h: { request: (path: string, body?: unknown, cookie?: string) => Promise<{ status: number; body: any }> }, runId: string, cookie: string, until: (review: { status: string }) => boolean) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const result = await h.request('/api/runs/' + runId, undefined, cookie);
    assert.equal(result.status, 200);
    if (until(result.body)) return result.body;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error('A execução não alcançou o estado esperado.');
}

type VisualTaskStub = { role: string; prompt: string; browser?: { mediaDir: string; onObservation: (record: unknown) => Promise<void>; onAction: (record: unknown) => Promise<void> } };
type ExecutorFactory = (attempt: number, input: Record<string, unknown>) => unknown;
type ValidatorFactory = (attempt: number, input: Record<string, unknown>) => unknown;
function fakeVisual(factory: { executor?: ExecutorFactory; validator?: ValidatorFactory }) {
  const calls: string[] = [];
  let executorAttempt = 0;
  let validatorAttempt = 0;
  const visualCall = async (task: VisualTaskStub) => {
    calls.push(task.role);
    const input = JSON.parse(task.prompt) as Record<string, unknown>;
    if (task.role === 'test-executor') {
      executorAttempt += 1;
      const attempt = executorAttempt;
      const observationId = 'obs-' + attempt;
      const assetId = ('asset-000000' + attempt).slice(-15);
      const actionId = 'act-' + attempt;
      if (task.browser) {
        await fs.mkdir(task.browser.mediaDir, { recursive: true });
        await fs.writeFile(join(task.browser.mediaDir, assetId + '.png'), PNG);
        await task.browser.onObservation({ id: observationId, assetId, at: new Date().toISOString(), width: 1366, height: 768 });
        await task.browser.onAction({ id: actionId, at: new Date().toISOString(), tool: 'pointer', params: { action: 'click', x: 40, y: 200 }, outcome: 'ok' });
      }
      const payload = factory.executor ? await factory.executor(attempt, input) : {
        authentication: { status: 'authenticated', observationId },
        map: { screens: [{ id: 'tela-' + attempt, name: 'Início', recognition: 'Página inicial após o login.', observationIds: [observationId] }], transitions: [], paths: [] },
        pending: [], limitations: [],
      };
      return { payload, metadata: { provider: 'deepseek', model: 'deepseek-flash', thinkingLevel: 'high', durationMs: 1 }, calls: [{ at: new Date().toISOString(), durationMs: 1 }] };
    }
    validatorAttempt += 1;
    const payload = factory.validator ? await factory.validator(validatorAttempt, input) : { status: 'approved', reason: 'Mapa sustentado pelas imagens.', findings: [] };
    return { payload, metadata: { provider: 'deepseek', model: 'deepseek-flash', thinkingLevel: 'high', durationMs: 1 }, calls: [{ at: new Date().toISOString(), durationMs: 1 }] };
  };
  return { visualCall, calls };
}

async function mappedRun(t: TestContext, factory: { executor?: ExecutorFactory; validator?: ValidatorFactory } = {}) {
  const fake = fakeVisual(factory);
  const h = await harness(t, { visualCall: fake.visualCall });
  const owner = await h.register(0);
  const run = await h.createRun(owner.cookie);
  await seedApproved(h, run.id, owner.user.id);
  await configureAccess(h, run.id, owner.cookie, 0);
  return { h, owner, run, fake };
}
test('CA-01: mapeamento só inicia com casos aprovados e acesso configurado', async t => {
  const { h, owner, run, fake } = await mappedRun(t);
  // Sem decisão humana dos casos: recusado antes de qualquer chamada visual.
  await h.store.update(run.id, record => {
    record.run.approvals = record.run.approvals.filter(decision => decision.outputId !== 'out-cases');
    return { save: true, value: undefined };
  });
  let result = await h.request('/api/runs/' + run.id + '/continue', { outputId: 'out-cases', outputRevision: 1, expectedAccessRevision: 1 }, owner.cookie);
  assert.equal(result.status, 409);
  assert.equal(result.body.error.code, 'DECISION_MISSING');
  await h.store.update(run.id, record => {
    record.run.approvals.push({ id: 'dec-cases-2', outputId: 'out-cases', outputRevision: 1, actorId: owner.user.id, at: '2026-09-24T10:01:00.000Z', decision: 'approved', comment: '' });
    return { save: true, value: undefined };
  });
  // Sem credencial: acesso pendente recusado.
  await h.store.update(run.id, record => {
    record.targetCredential = undefined;
    return { save: true, value: undefined };
  });
  result = await h.request('/api/runs/' + run.id + '/continue', { outputId: 'out-cases', outputRevision: 1, expectedAccessRevision: 1 }, owner.cookie);
  assert.equal(result.status, 409);
  assert.equal(result.body.error.code, 'ACCESS_NOT_CONFIGURED');
  await h.store.update(run.id, record => {
    record.targetCredential = { ref: record.run.input!.credentialRef as string, username: 'demo', password: 'demo1234' };
    return { save: true, value: undefined };
  });
  // Revisão de acesso divergente: recusado.
  result = await h.request('/api/runs/' + run.id + '/continue', { outputId: 'out-cases', outputRevision: 1, expectedAccessRevision: 2 }, owner.cookie);
  assert.equal(result.status, 409);
  assert.equal(result.body.error.code, 'STALE_VERSION');
  // Aceite e conclusão ready/mapping.
  result = await h.request('/api/runs/' + run.id + '/continue', { outputId: 'out-cases', outputRevision: 1, expectedAccessRevision: 1 }, owner.cookie);
  assert.equal(result.status, 202);
  const review = await pollReview(h, run.id, owner.cookie, item => item.status !== 'running');
  assert.equal(review.status, 'ready');
  assert.equal(review.phase, 'mapping');
  assert.equal(review.canMap, false);
  assert.equal(review.mapping.revision, 1);
  assert.equal(review.mapping.current, true);
  assert.equal(review.mapping.payload.authentication.status, 'authenticated');
  assert.equal(review.mapping.validations.at(-1).status, 'approved');
  assert.equal(review.observations.length, 1);
  assert.deepEqual(fake.calls, ['test-executor', 'output-validator']);
  const stored = await h.store.read(run.id);
  assert.equal(stored.run.outputs.filter(output => output.phase === 'mapping').length, 1);
  assert.equal(stored.run.preparation!.calls.filter(call => call.phase === 'mapping').length, 1);
  // A credencial não vaza na projeção.
  assert.ok(!JSON.stringify(review).includes('demo1234'));
});

test('CA-02: duplo clique e ambiente ocupado não abrem dois navegadores', async t => {
  let release = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  const fake = fakeVisual({
    executor: async () => { await gate; throw new Error('liberado'); },
  });
  const h = await harness(t, { visualCall: fake.visualCall });
  const owner = await h.register(0);
  const run = await h.createRun(owner.cookie);
  await seedApproved(h, run.id, owner.user.id);
  await configureAccess(h, run.id, owner.cookie, 0);
  const first = await h.request('/api/runs/' + run.id + '/continue', { outputId: 'out-cases', outputRevision: 1, expectedAccessRevision: 1 }, owner.cookie);
  assert.equal(first.status, 202);
  const second = await h.request('/api/runs/' + run.id + '/continue', { outputId: 'out-cases', outputRevision: 1, expectedAccessRevision: 1 }, owner.cookie);
  assert.equal(second.status, 200, 'repetição consulta o trabalho existente');
  // Outra execução disputa a mesma reserva do ambiente: ocupado, decisões preservadas.
  const otherRun = await h.createRun(owner.cookie, 'Segunda execução');
  await seedApproved(h, otherRun.id, owner.user.id);
  await configureAccess(h, otherRun.id, owner.cookie, 0);
  const busy = await h.request('/api/runs/' + otherRun.id + '/continue', { outputId: 'out-cases', outputRevision: 1, expectedAccessRevision: 1 }, owner.cookie);
  assert.equal(busy.status, 409);
  assert.equal(busy.body.error.code, 'RESOURCE_UNAVAILABLE');
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.deepEqual(fake.calls, ['test-executor']);
  const stored = await h.store.read(run.id);
  assert.equal(stored.workIntents.filter(work => work.type === 'create_map').length, 1);
  release();
  await pollReview(h, run.id, owner.cookie, item => item.status !== 'running');
});

test('CA-05: referências inventadas são recusadas; observações reais preservadas', async t => {
  let attempts = 0;
  const { h, owner, run } = await mappedRun(t, {
    executor: (index) => {
      attempts = index;
      if (index === 1) return {
        authentication: { status: 'authenticated', observationId: 'obs-' + index },
        map: { screens: [{ id: 'tela-1', name: 'Início', recognition: 'Login.', observationIds: ['obs-inventada'] }], transitions: [], paths: [] },
        pending: [], limitations: [],
      };
      return {
        authentication: { status: 'authenticated', observationId: 'obs-' + index },
        map: { screens: [{ id: 'tela-2', name: 'Início', recognition: 'Login.', observationIds: ['obs-' + index] }], transitions: [], paths: [] },
        pending: [], limitations: [],
      };
    },
  });
  const result = await h.request('/api/runs/' + run.id + '/continue', { outputId: 'out-cases', outputRevision: 1, expectedAccessRevision: 1 }, owner.cookie);
  assert.equal(result.status, 202);
  const review = await pollReview(h, run.id, owner.cookie, item => item.status !== 'running');
  assert.equal(review.status, 'ready');
  assert.equal(attempts, 2, 'produção inválida gera nova tentativa dentro do limite');
  assert.equal(review.mapping.revision, 1);
  assert.deepEqual(review.mapping.payload.map.screens[0].observationIds, ['obs-2']);
  assert.equal(review.observations.length, 2, 'observações reais das duas produções preservadas');
});
test('CA-06: correção cria nova revisão; pareceres preservados', async t => {
  let validatorCalls = 0;
  const { h, owner, run } = await mappedRun(t, {
    validator: (index, input) => {
      validatorCalls = index;
      const output = input.output as { revision: number };
      if (output.revision === 1 && index === 1) return { status: 'changes_requested', reason: 'Transição sem suporte visual.', findings: [{ code: 'UNSUPPORTED_TRANSITION', message: 'A transição não aparece nas capturas.', location: 'transitions/t-1' }] };
      return { status: 'approved', reason: 'Mapa sustentado pelas imagens.', findings: [] };
    },
  });
  const result = await h.request('/api/runs/' + run.id + '/continue', { outputId: 'out-cases', outputRevision: 1, expectedAccessRevision: 1 }, owner.cookie);
  assert.equal(result.status, 202);
  const review = await pollReview(h, run.id, owner.cookie, item => item.status !== 'running');
  assert.equal(review.status, 'ready');
  assert.equal(review.mapping.revision, 2, 'correção produz revisão 2 do mesmo mapa');
  assert.equal(review.mapping.validations.length, 1);
  assert.equal(review.mapping.validations[0].status, 'approved');
  const stored = await h.store.read(run.id);
  assert.equal(stored.run.outputs.filter(output => output.phase === 'mapping').length, 2, 'revisão anterior preservada');
  const verdicts = stored.run.validations.filter(item => stored.run.outputs.some(output => output.phase === 'mapping' && output.id === item.outputId));
  assert.equal(verdicts.length, 2, 'pareceres das duas revisões preservados');
  assert.equal(verdicts[0].status, 'changes_requested');
  assert.equal(verdicts[1].status, 'approved');
  assert.equal(validatorCalls, 2);
});

test('CA-06: erro técnico do validador esgota tentativas sem aprovar o mapa', async t => {
  const { h, owner, run } = await mappedRun(t, {
    validator: () => { throw new Error('falha técnica simulada do validador'); },
  });
  const result = await h.request('/api/runs/' + run.id + '/continue', { outputId: 'out-cases', outputRevision: 1, expectedAccessRevision: 1 }, owner.cookie);
  assert.equal(result.status, 202);
  const review = await pollReview(h, run.id, owner.cookie, item => item.status !== 'running');
  assert.equal(review.status, 'interrupted');
  assert.equal(review.phase, 'mapping');
  assert.equal(review.mapping.validations.filter(item => item.status === 'error').length, 2);
  assert.ok(!review.mapping.validations.some(item => item.status === 'approved'));
});

test('CA-07: falha de credencial preserva histórico e permite correção e nova tentativa', async t => {
  let production = 0;
  const { h, owner, run } = await mappedRun(t, {
    executor: (attempt) => {
      production = attempt;
      if (attempt === 1) return {
        authentication: { status: 'not_authenticated', observationId: null },
        map: { screens: [{ id: 'tela-login', name: 'Login', recognition: 'Formulário de login.', observationIds: ['obs-' + attempt] }], transitions: [], paths: [] },
        pending: [{ id: 'pend-01', description: 'Área autenticada inacessível com a credencial atual.', affectedCaseIds: ['CT-01'] }],
        limitations: ['Autenticação não concluída.'],
      };
      return {
        authentication: { status: 'authenticated', observationId: 'obs-' + attempt },
        map: { screens: [{ id: 'tela-inicio', name: 'Início', recognition: 'Área autenticada após corrigir a credencial.', observationIds: ['obs-' + attempt] }], transitions: [], paths: [] },
        pending: [], limitations: [],
      };
    },
    validator: (index, input) => {
      const output = input.output as { revision: number };
      if (output.revision === 1) return { status: 'blocked', reason: 'Sem observação da área autenticada.', findings: [{ code: 'AUTHENTICATION_MISSING', message: 'Falta observação da área autenticada.', location: null }] };
      return { status: 'approved', reason: 'Mapa sustentado pelas imagens.', findings: [] };
    },
  });
  let result = await h.request('/api/runs/' + run.id + '/continue', { outputId: 'out-cases', outputRevision: 1, expectedAccessRevision: 1 }, owner.cookie);
  assert.equal(result.status, 202);
  let review = await pollReview(h, run.id, owner.cookie, item => item.status !== 'running');
  assert.equal(review.status, 'awaiting_input');
  assert.equal(review.phase, 'mapping');
  assert.equal(review.stopReason.code, 'CREDENTIAL_REJECTED');
  assert.equal(review.canMap, true, 'correção de credencial permite nova tentativa explícita');
  assert.equal(review.mapping.payload.pending[0].affectedCaseIds[0], 'CT-01');
  // Corrige a credencial: nova revisão de acesso na mesma aplicação.
  await configureAccess(h, run.id, owner.cookie, 1, 'demo-nova-senha');
  result = await h.request('/api/runs/' + run.id + '/continue', { outputId: 'out-cases', outputRevision: 1, expectedAccessRevision: 2 }, owner.cookie);
  assert.equal(result.status, 202);
  review = await pollReview(h, run.id, owner.cookie, item => item.status !== 'running');
  assert.equal(review.status, 'ready');
  assert.equal(review.mapping.revision, 2);
  const stored = await h.store.read(run.id);
  assert.equal(stored.targetCredential!.password, 'demo-nova-senha');
  assert.equal(stored.run.outputs.filter(output => output.phase === 'mapping').length, 2, 'revisão anterior preservada');
  assert.equal(stored.workIntents.filter(work => work.type === 'create_map').length, 2);
  assert.ok((stored.run.preparation!.accumulatedActiveMs ?? 0) >= 120000, 'tempo consumido não foi zerado');
});

test('CA-08: cancelamento durante o mapeamento impede novas ações', async t => {
  let release = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  const fake = fakeVisual({
    executor: async () => { await gate; throw new Error('liberado'); },
  });
  const h = await harness(t, { visualCall: fake.visualCall });
  const owner = await h.register(0);
  const run = await h.createRun(owner.cookie);
  await seedApproved(h, run.id, owner.user.id);
  await configureAccess(h, run.id, owner.cookie, 0);
  await h.request('/api/runs/' + run.id + '/continue', { outputId: 'out-cases', outputRevision: 1, expectedAccessRevision: 1 }, owner.cookie);
  await new Promise(resolve => setTimeout(resolve, 50));
  const cancel = await h.request('/api/runs/' + run.id + '/cancel', {}, owner.cookie);
  assert.equal(cancel.status, 200);
  release();
  await new Promise(resolve => setTimeout(resolve, 100));
  const review = await h.request('/api/runs/' + run.id, undefined, owner.cookie);
  assert.equal(review.body.status, 'cancelled');
  const after = await h.request('/api/runs/' + run.id + '/continue', { outputId: 'out-cases', outputRevision: 1, expectedAccessRevision: 1 }, owner.cookie);
  assert.equal(after.status, 200, 'repetição consulta o trabalho existente sem reabrir o navegador');
  const storedAfter = await h.store.read(run.id);
  assert.equal(storedAfter.run.status, 'cancelled');
  assert.equal(storedAfter.workIntents.filter(work => work.type === 'create_map').length, 1);
  assert.deepEqual(fake.calls, ['test-executor'], 'nenhuma chamada nova após o cancelamento');
});

test('CA-09: evidência verificada pelo proprietário, isolada de outras contas', async t => {
  const { h, owner, run } = await mappedRun(t);
  const other = await h.register(1);
  await h.request('/api/runs/' + run.id + '/continue', { outputId: 'out-cases', outputRevision: 1, expectedAccessRevision: 1 }, owner.cookie);
  const review = await pollReview(h, run.id, owner.cookie, item => item.status !== 'running');
  assert.equal(review.status, 'ready');
  const observation = review.observations[0];
  assert.ok(observation);
  const owned = await fetch(h.base + '/api/runs/' + run.id + '/evidence/' + observation.assetId, { headers: { Cookie: owner.cookie, 'X-Expected-User-Id': owner.user.id } });
  assert.equal(owned.status, 200);
  assert.equal(owned.headers.get('content-type'), 'image/png');
  assert.ok((await owned.arrayBuffer()).byteLength > 0);
  const foreign = await fetch(h.base + '/api/runs/' + run.id + '/evidence/' + observation.assetId, { headers: { Cookie: other.cookie, 'X-Expected-User-Id': other.user.id } });
  assert.equal(foreign.status, 404);
  const missing = await fetch(h.base + '/api/runs/' + run.id + '/evidence/asset-inexistente', { headers: { Cookie: owner.cookie, 'X-Expected-User-Id': owner.user.id } });
  assert.equal(missing.status, 404);
  const noSession = await fetch(h.base + '/api/runs/' + run.id + '/evidence/' + observation.assetId);
  assert.equal(noSession.status, 401);
});

test('CA-10: ready entra no filtro de histórico; nenhum teste apresentado como executado', async t => {
  const { h, owner, run } = await mappedRun(t);
  await h.request('/api/runs/' + run.id + '/continue', { outputId: 'out-cases', outputRevision: 1, expectedAccessRevision: 1 }, owner.cookie);
  await pollReview(h, run.id, owner.cookie, item => item.status !== 'running');
  const history = await h.request('/api/runs?status=ready', undefined, owner.cookie);
  assert.equal(history.status, 200);
  assert.equal(history.body.items.length, 1);
  assert.equal(history.body.items[0].id, run.id);
  const review = await h.request('/api/runs/' + run.id, undefined, owner.cookie);
  assert.equal(review.body.status, 'ready');
  assert.equal(review.body.phase, 'mapping');
  assert.ok(!JSON.stringify(review.body.mapping.payload).includes('caseId'), 'capturas de mapeamento não usam contrato de execução');
});

test('falha do executor esgota revisões sem aprovar por padrão', async t => {
  const { h, owner, run } = await mappedRun(t, {
    executor: () => { throw new Error('MODEL_ERROR simulado'); },
  });
  const result = await h.request('/api/runs/' + run.id + '/continue', { outputId: 'out-cases', outputRevision: 1, expectedAccessRevision: 1 }, owner.cookie);
  assert.equal(result.status, 202);
  const review = await pollReview(h, run.id, owner.cookie, item => item.status !== 'running');
  assert.equal(review.status, 'interrupted');
  assert.equal(review.phase, 'mapping');
  assert.equal(review.mapping, null, 'nenhum mapa foi publicado');
});