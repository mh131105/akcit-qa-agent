import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { createApp } from '../src/app.js';
import { readConfig } from '../src/config.js';
import { RunStore } from '../src/storage/runs.js';

const origin = 'http://localhost:3000';
const password = 'senha fictícia de testes';
const accounts = [
  { name: 'Pessoa Um', email: 'one@example.test', password },
  { name: 'Pessoa Dois', email: 'two@example.test', password },
];
const input = { name: 'Reservas — primeira execução', applicationName: 'Aplicação de reservas',
  objective: 'Verificar as regras de quantidade.',
  text: ' \t# Histórias e critérios\r\n\r\n**US-01:** Reservar itens.\n- CA-01: Quantidade inteira, de 1 a 10.\rAção e ação.\n  ' };
const publicKeys = ['id', 'name', 'applicationName', 'createdAt', 'status', 'phase'].sort();
const cookieOf = (response: Response) => response.headers.get('set-cookie')!.split(';')[0]!;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const idFor = (userId: string, key: string) => `run-${hash([userId, key.toLowerCase()])}`;

async function harness(t: TestContext) {
  const dataDir = await fs.mkdtemp(join(tmpdir(), 'akcit-intake-'));
  const config = readConfig({ DATA_DIR: dataDir, APP_ORIGIN: origin,
    PILOT_ALLOWED_EMAILS: accounts.map(account => account.email).join(',') });
  let app = await createApp(config);
  let base = '';
  async function listen() {
    app.listen(0, '127.0.0.1');
    await once(app, 'listening');
    const address = app.address();
    assert.ok(address && typeof address !== 'string');
    base = `http://127.0.0.1:${address.port}`;
  }
  async function close() { app.close(); app.closeAllConnections(); await once(app, 'close'); }
  await listen();
  t.after(async () => { await close(); await fs.rm(dataDir, { recursive: true, force: true }); });
  // Identidade capturada apenas no login/cadastro; nunca reconsultada antes de uma operação.
  const expectedUsers = new Map<string, string>();
  async function request(path: string, body?: unknown, cookie?: string, overrides: RequestInit = {}) {
    const expectedUserId = cookie && expectedUsers.get(cookie);
    const headers = new Headers({ Origin: origin, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}),
        ...(expectedUserId && (path.startsWith('/api/runs') || path === '/api/auth/logout')
          ? { 'X-Expected-User-Id': expectedUserId } : {}) });
    new Headers(overrides.headers).forEach((value, name) => headers.set(name, value));
    const response = await fetch(`${base}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), ...overrides, headers,
    });
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const text = await response.text();
    assert.ok(!text.includes(dataDir), 'resposta não revela caminhos internos');
    const result = text ? JSON.parse(text) : null;
    if (response.ok && ['/api/auth/register', '/api/auth/login'].includes(path)) {
      expectedUsers.set(cookieOf(response), result.user.id);
    }
    return { response, status: response.status, body: result };
  }
  async function register(index = 0) {
    const result = await request('/api/auth/register', accounts[index]);
    assert.equal(result.status, 201, JSON.stringify(result.body));
    return { user: result.body.user, cookie: cookieOf(result.response) };
  }
  async function login(index = 0) {
    const result = await request('/api/auth/login', { email: accounts[index]!.email, password });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    return cookieOf(result.response);
  }
  const file = (id: string) => join(dataDir, 'runs', `${id}.json`);
  return { dataDir, file, request, register, login, store: new RunStore(dataDir),
    raw: (id: string) => fs.readFile(file(id), 'utf8'),
    files: () => fs.readdir(join(dataDir, 'runs')),
    create: (cookie: string | undefined, key = randomUUID(), body: unknown = input) =>
      request('/api/runs', body, cookie, { headers: { 'Idempotency-Key': key } }),
    get base() { return base; },
    restart: async () => { await close(); app = await createApp(config); await listen(); },
  };
}
function error(result: { status: number; body: any }, status: number, code: string) {
  assert.equal(result.status, status, JSON.stringify(result.body));
  assert.equal(result.body.error.code, code);
  assert.deepEqual(Object.keys(result.body), ['error']);
}
function summary(value: any) { assert.deepEqual(Object.keys(value).sort(), publicKeys); }

async function wireRequest(url: string, method: string, cookie: string, body: unknown, headers: string[]) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const request = httpRequest(url, { method, headers: [
      'Host', new URL(url).host, 'Origin', origin, 'Content-Type', 'application/json', 'Cookie', cookie, ...headers,
    ] }, response => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { text += chunk; });
      response.on('end', () => resolve({ status: response.statusCode!, body: JSON.parse(text) }));
    });
    request.on('error', reject);
    request.end(JSON.stringify(body));
  });
}

test('BUG-T2.1-01: criação e histórico recusam identidade ausente, inválida e duplicada', async t => {
  const h = await harness(t);
  const owner = await h.register();
  for (const method of ['GET', 'POST']) {
    for (const expected of [[], ['X-Expected-User-Id', 'not-a-uuid'],
      ['X-Expected-User-Id', owner.user.id, 'x-expected-user-id', owner.user.id]]) {
      const denied = await wireRequest(`${h.base}/api/runs`, method, owner.cookie, method === 'POST' ? input : undefined,
        [...expected, 'Idempotency-Key', randomUUID()]);
      error(denied, 400, 'INVALID_EXPECTED_USER_ID');
    }
  }
  assert.deepEqual(await h.files(), []);
});

test('BUG-T2.1-01: operação de A com sessão B não cria, lê nem altera registros; A recupera a chave original', async t => {
  const h = await harness(t);
  const owner = await h.register();
  const other = await h.register(1);
  const existing = await h.create(other.cookie);
  assert.equal(existing.status, 201);
  const original = await h.raw(existing.body.id);
  const files = await h.files();
  const key = randomUUID();
  const creates = t.mock.method(RunStore.prototype, 'createIdempotent');
  const lists = t.mock.method(RunStore.prototype, 'listForOwner');
  const reads = t.mock.method(RunStore.prototype, 'read');
  const expected = { 'X-Expected-User-Id': owner.user.id, 'Idempotency-Key': key };
  const denied = await h.request('/api/runs', input, other.cookie, { headers: expected });
  error(denied, 409, 'ACCOUNT_CHANGED');
  assert.equal(denied.response.headers.get('location'), null);
  for (const path of ['/api/runs', `/api/runs/${existing.body.id}`]) {
    const result = await h.request(path, undefined, other.cookie, { headers: expected });
    error(result, 409, 'ACCOUNT_CHANGED');
    assert.deepEqual(result.body, denied.body);
  }
  for (const privateValue of [owner.user.id, other.user.id, existing.body.id, input.text]) {
    assert.ok(!JSON.stringify(denied.body).includes(privateValue));
  }
  assert.equal(creates.mock.callCount(), 0);
  assert.equal(lists.mock.callCount(), 0);
  assert.equal(reads.mock.callCount(), 0);
  creates.mock.restore(); lists.mock.restore(); reads.mock.restore();
  assert.deepEqual(await h.files(), files);
  assert.equal(await h.raw(existing.body.id), original);
  const recovered = await h.request('/api/runs', input, owner.cookie, { headers: expected });
  assert.equal(recovered.status, 201);
  assert.equal(recovered.body.id, idFor(owner.user.id, key));
  assert.equal((await h.store.read(recovered.body.id)).run.ownerId, owner.user.id);
  assert.equal((await h.store.read(recovered.body.id)).run.artifacts[0]!.text, input.text);
  assert.equal((await h.request('/api/runs', input, owner.cookie, { headers: expected })).status, 200);
  assert.deepEqual((await h.request('/api/runs', undefined, other.cookie)).body, { items: [existing.body] });
});

test('T3.3: entrar, criar por HTTP, abrir rascunho literal e reencontrar após reinício e novo login', async t => {
  const h = await harness(t);
  const owner = await h.register();
  const other = await h.register(1);
  const cookie = await h.login();
  assert.deepEqual((await h.request('/api/runs', undefined, cookie)).body, { items: [] });
  assert.deepEqual((await h.request('/api/runs', undefined, other.cookie)).body, { items: [] });
  const key = randomUUID();
  const beforeTime = Date.now();
  const created = await h.create(cookie, key.toUpperCase(), {
    ...input, name: `  ${input.name}  `, applicationName: ` ${input.applicationName}\n`, objective: ` ${input.objective} `,
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  summary(created.body);
  const id = idFor(owner.user.id, key);
  assert.equal(created.body.id, id);
  assert.equal(created.response.headers.get('location'), `/api/runs/${id}`);
  assert.deepEqual(created.body, { id, name: input.name, applicationName: input.applicationName,
    createdAt: created.body.createdAt, status: 'draft', phase: 'intake' });
  assert.equal(new Date(created.body.createdAt).toISOString(), created.body.createdAt);
  assert.ok(Date.parse(created.body.createdAt) >= beforeTime && Date.parse(created.body.createdAt) <= Date.now());
  const stored = await h.store.read(id);
  const artifact = stored.run.artifacts[0]!;
  assert.equal(stored.run.ownerId, owner.user.id);
  assert.equal(stored.run.artifacts.length, 1);
  assert.equal(typeof artifact.id, 'string');
  assert.ok(artifact.id);
  assert.deepEqual(artifact, { id: artifact.id, name: 'historias-e-criterios.txt', version: '1', text: input.text });
  assert.deepEqual(stored.run.input, { startUrl: null, credentialRef: null, accessProfile: null,
    dataPreparation: null, authorizedTarget: false, objective: input.objective, artifactIds: [artifact.id] });
  for (const field of ['outputs', 'validations', 'approvals', 'questions', 'answers', 'budgetCycles']) {
    assert.deepEqual(stored.run[field], []);
  }
  assert.deepEqual(stored.workIntents, []);
  assert.deepEqual(stored.run.validationPolicy, { maxValidationRevisions: 3, maxValidatorAttempts: 2, timeoutMs: 120000 });
  assert.deepEqual(stored.run.creation, { requestHash: hash([input.name, input.applicationName, input.objective, input.text]) });
  const raw = await h.raw(id);
  const opened = await h.request(`/api/runs/${id}`, undefined, cookie);
  assert.equal(opened.status, 200);
  assert.deepEqual(opened.body, { ...created.body, plan: null, curation: null, cases: null, canCreateCases: false, canDecideCases: false, answers: [], canResume: false, approvals: [], questions: [], stopReason: null,
    progress: { processingId: null, activeRole: null, activity: null, startedAt: null, finishedAt: null } });
  error(await h.request(`/api/runs/${id}/approve`, { outputId: 'inexistente', outputRevision: 1 }, cookie), 409, 'INVALID_STATE');
  assert.equal(await h.raw(id), raw, 'recusa de aprovação preserva todo o rascunho');
  error(await h.request(`/api/runs/${id}`, undefined, other.cookie), 404, 'RUN_NOT_FOUND');
  assert.deepEqual((await h.request('/api/runs', undefined, cookie)).body, { items: [created.body] });
  await h.restart();
  error(await h.request('/api/runs', undefined, cookie), 401, 'INVALID_SESSION');
  const returned = await h.login();
  assert.deepEqual((await h.request('/api/runs', undefined, returned)).body, { items: [created.body] });
  assert.deepEqual((await h.request(`/api/runs/${id}`, undefined, returned)).body, opened.body);
  const repeated = await h.create(returned, key, input);
  assert.equal(repeated.status, 200);
  assert.deepEqual(repeated.body, created.body);
  assert.equal(repeated.response.headers.get('location'), `/api/runs/${id}`);
  assert.equal(await h.raw(id), raw, 'reinício e repetição preservam IDs, horário e texto');
  assert.deepEqual((await h.request('/api/runs', undefined, await h.login(1))).body, { items: [] });
});

test('T3.3: concorrência, chave por conta e conflitos com conteúdo original normalizado', async t => {
  const h = await harness(t);
  const owner = await h.register();
  const other = await h.register(1);
  const key = randomUUID();
  const requests = await Promise.all(Array.from({ length: 8 }, () => h.create(owner.cookie, key)));
  assert.deepEqual(requests.map(result => result.status).sort(), [200, 200, 200, 200, 200, 200, 200, 201]);
  requests.forEach(result => {
    assert.deepEqual(result.body, requests[0]!.body);
    assert.equal(result.response.headers.get('location'), `/api/runs/${result.body.id}`);
  });
  const id = requests[0]!.body.id;
  assert.deepEqual(await h.files(), [`${id}.json`]);
  const raw = await h.raw(id);
  const normalized = { text: input.text, objective: ` ${input.objective}\n`, applicationName: ` ${input.applicationName} `, name: ` ${input.name} ` };
  assert.equal((await h.create(owner.cookie, key, normalized)).status, 200);
  for (const change of [{ name: 'Outro nome' }, { applicationName: 'Outra aplicação' },
    { objective: '' }, { text: input.text.trim() }, { text: input.text.replaceAll('\r\n', '\n') }]) {
    error(await h.create(owner.cookie, key, { ...input, ...change }), 409, 'IDEMPOTENCY_CONFLICT');
  }
  assert.equal(await h.raw(id), raw);
  const independent = await h.create(other.cookie, key);
  assert.equal(independent.status, 201);
  assert.equal(independent.body.id, idFor(other.user.id, key));
  assert.notEqual(independent.body.id, id);
  assert.notEqual((await h.store.read(independent.body.id)).run.artifacts[0]!.id, (await h.store.read(id)).run.artifacts[0]!.id);
  assert.deepEqual((await h.request('/api/runs', undefined, owner.cookie)).body, { items: [requests[0]!.body] });
  assert.deepEqual((await h.request('/api/runs', undefined, other.cookie)).body, { items: [independent.body] });
  error(await h.request(`/api/runs/${independent.body.id}`, undefined, owner.cookie), 404, 'RUN_NOT_FOUND');
  const emptyObjectiveKey = randomUUID();
  const { objective: _, ...withoutObjective } = input;
  const empty = await h.create(owner.cookie, emptyObjectiveKey, withoutObjective);
  assert.equal(empty.status, 201);
  assert.equal((await h.store.read(empty.body.id)).run.input.objective, '');
  const repeat = await h.create(owner.cookie, emptyObjectiveKey, { ...withoutObjective, objective: ' \n\t' });
  assert.equal(repeat.status, 200);
  assert.deepEqual(repeat.body, empty.body);
});

test('T4.1: iniciar e cancelar exigem sessão, origem, identidade original, propriedade e corpo vazio', async t => {
  const h = await harness(t);
  const owner = await h.register();
  const other = await h.register(1);
  const created = await h.create(owner.cookie);
  assert.equal(created.status, 201);
  const original = await h.raw(created.body.id);
  for (const operation of ['start', 'cancel']) {
    const path = `/api/runs/${created.body.id}/${operation}`;
    error(await h.request(path, {}), 401, 'INVALID_SESSION');
    error(await h.request(path, {}, 'akcit_session=inventada'), 401, 'INVALID_SESSION');
    error(await h.request(path, {}, owner.cookie, { headers: { Origin: 'https://other.example.test' } }), 403, 'ORIGIN_REJECTED');
    for (const identity of [[], ['X-Expected-User-Id', 'invalid'],
      ['X-Expected-User-Id', owner.user.id, 'x-expected-user-id', owner.user.id]]) {
      error(await wireRequest(`${h.base}${path}`, 'POST', owner.cookie, {}, identity), 400, 'INVALID_EXPECTED_USER_ID');
    }
    const switched = await h.request(path, {}, other.cookie, { headers: { 'X-Expected-User-Id': owner.user.id } });
    error(switched, 409, 'ACCOUNT_CHANGED');
    error(await h.request(path, {}, other.cookie), 404, 'RUN_NOT_FOUND');
    error(await h.request(`/api/runs/absent/${operation}`, {}, owner.cookie), 404, 'RUN_NOT_FOUND');
    for (const forged of [{ ownerId: owner.user.id }, { model: 'simulated' }, { fixture: true }, { status: 'running' }]) {
      error(await h.request(path, forged, owner.cookie), 400, 'INVALID_INPUT');
    }
    for (const privateValue of [created.body.id, input.text, owner.user.id, other.user.id]) {
      assert.ok(!JSON.stringify(switched.body).includes(privateValue));
    }
    assert.equal(await h.raw(created.body.id), original, 'recusas não alteram rascunho, orçamento ou processamento');
  }
});

test('T3.3: repetição preserva trabalho posterior e compara o hash original', async t => {
  const h = await harness(t);
  const owner = await h.register();
  const key = randomUUID();
  const created = await h.create(owner.cookie, key);
  assert.equal(created.status, 201);
  const id = created.body.id;
  // Simulação de etapas futuras somente no teste; a API de entrada não produz trabalho.
  await h.store.update(id, record => {
    record.run.name = 'Nome alterado em etapa posterior';
    record.run.status = 'cancelled';
    record.run.phase = 'curation';
    record.run.artifacts[0]!.text = 'Artefato modificado posteriormente.';
    record.run.outputs = [{ id: 'out-curation', phase: 'curation', revision: 1, dependsOn: [], payload: { synthetic: true } }];
    record.run.questions = [{ text: 'Pergunta simulada.' }];
    record.run.budgetCycles = [{ id: 'budget-simulation' }];
    record.workIntents = [{ id: 'work-simulation', type: 'analyze_feedback', outputId: 'out-curation',
      outputRevision: 1, createdAt: record.run.createdAt, status: 'interrupted',
      interruption: { at: record.run.createdAt, reason: 'service_restart' } }];
    return { save: true, value: undefined };
  });
  const raw = await h.raw(id);
  await h.restart();
  const cookie = await h.login();
  const repeated = await h.create(cookie, key);
  assert.equal(repeated.status, 200);
  assert.deepEqual(repeated.body, { ...created.body, name: 'Nome alterado em etapa posterior', status: 'cancelled', phase: 'curation' });
  summary(repeated.body);
  assert.equal(await h.raw(id), raw, 'nenhum campo posterior pode ser apagado na repetição');
  error(await h.create(cookie, key, { ...input, text: 'Artefato modificado posteriormente.' }), 409, 'IDEMPOTENCY_CONFLICT');
});

test('T3.3: histórico próprio ordenado, busca por nome/aplicação, estados e filtros combinados', async t => {
  const h = await harness(t);
  const owner = await h.register();
  const other = await h.register(1);
  const statuses = ['draft', 'running', 'awaiting_approval', 'awaiting_input', 'completed', 'interrupted', 'error', 'cancelled'];
  const items: any[] = [];
  for (const [index, status] of statuses.entries()) {
    const result = await h.create(owner.cookie, randomUUID(), { ...input,
      name: index % 2 ? `Catálogo ${index}` : `Reservas ${index}`,
      applicationName: index % 2 ? 'Aplicação de reservas' : 'Inventário' });
    assert.equal(result.status, 201);
    const createdAt = `2026-09-${index < 4 ? '21' : '22'}T12:00:00.000Z`;
    // Simulação de datas e estados para testar ordenação/filtros; sem carga no aplicativo.
    await h.store.update(result.body.id, record => {
      record.run.status = status;
      record.run.createdAt = createdAt;
      return { save: true, value: undefined };
    });
    items.push({ ...result.body, status, createdAt });
  }
  assert.equal((await h.create(other.cookie, randomUUID(), { ...input, name: 'SEGREDO-OUTRA-CONTA' })).status, 201);
  await fs.writeFile(join(h.dataDir, 'runs', '.incomplete.tmp'), '{');
  items.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  const listed = await h.request('/api/runs', undefined, owner.cookie);
  assert.equal(listed.status, 200);
  assert.deepEqual(listed.body, { items });
  listed.body.items.forEach(summary);
  for (const status of statuses) {
    assert.deepEqual((await h.request(`/api/runs?status=${status}`, undefined, owner.cookie)).body,
      { items: items.filter(item => item.status === status) });
  }
  assert.deepEqual((await h.request('/api/runs?q=ReSeRvAs', undefined, owner.cookie)).body, { items });
  assert.deepEqual((await h.request('/api/runs?q=CAT%C3%81LOGO', undefined, owner.cookie)).body,
    { items: items.filter(item => item.name.startsWith('Catálogo')) });
  assert.deepEqual((await h.request('/api/runs?q=inVENT%C3%81rio&status=completed', undefined, owner.cookie)).body,
    { items: items.filter(item => item.status === 'completed') });
  for (const query of ['q=ausente', 'q=SEGREDO-OUTRA-CONTA', 'q=Invent%C3%A1rio&status=cancelled']) {
    assert.deepEqual((await h.request(`/api/runs?${query}`, undefined, owner.cookie)).body, { items: [] });
  }
  assert.deepEqual((await h.request('/api/runs?q=', undefined, owner.cookie)).body, { items });
  assert.equal((await h.request(`/api/runs?q=${'x'.repeat(120)}`, undefined, owner.cookie)).status, 200);
  for (const query of [`q=${'x'.repeat(121)}`, 'status=', 'status=DRAFT', 'status=unknown',
    `ownerId=${other.user.id}`, 'fixture=true', 'q=x&q=x', 'status=draft&status=draft', 'page=1']) {
    error(await h.request(`/api/runs?${query}`, undefined, owner.cookie), 400, 'INVALID_INPUT');
  }
});

test('T3.3: sessão, origem, JSON, campos permitidos e chave UUID v4 são obrigatórios', async t => {
  const h = await harness(t);
  const owner = await h.register();
  const key = randomUUID();
  error(await h.create(undefined, key), 401, 'INVALID_SESSION');
  error(await h.create('akcit_session=inventada', key), 401, 'INVALID_SESSION');
  error(await h.request('/api/runs'), 401, 'INVALID_SESSION');
  for (const badOrigin of ['', 'null', `${origin}.evil.test`, 'http://localhost:3001', 'https://localhost:3000']) {
    error(await h.request('/api/runs', input, owner.cookie,
      { headers: { Origin: badOrigin, 'Idempotency-Key': key } }), 403, 'ORIGIN_REJECTED');
  }
  const absentOrigin = await fetch(`${h.base}/api/runs`, { method: 'POST', body: JSON.stringify(input),
    headers: { Cookie: owner.cookie, 'Content-Type': 'application/json', 'Idempotency-Key': key } });
  assert.equal(absentOrigin.status, 403);
  error(await h.request('/api/runs', input, owner.cookie, { headers: { 'Idempotency-Key': key, 'Content-Type': 'text/plain' } }), 415, 'UNSUPPORTED_MEDIA_TYPE');
  error(await h.request('/api/runs', input, owner.cookie, { headers: { 'Idempotency-Key': key }, body: '{' }), 400, 'INVALID_JSON');
  for (const body of [null, [], 42, {}, ...['name', 'applicationName', 'text'].map(field => ({ ...input, [field]: undefined })),
    ...['name', 'applicationName', 'text'].flatMap(field => ['', ' \n\t', null, 42].map(value => ({ ...input, [field]: value }))),
    { ...input, name: 'x'.repeat(121) }, { ...input, applicationName: 'x'.repeat(121) },
    { ...input, objective: 'x'.repeat(2001) }, { ...input, objective: null }, { ...input, objective: [] }]) {
    error(await h.create(owner.cookie, key, body), 400, 'INVALID_INPUT');
  }
  for (const field of ['ownerId', 'id', 'createdAt', 'status', 'phase', 'outputs', 'validations', 'approvals',
    'credentialRef', 'fixture', 'artifacts', 'input', 'creation', 'workIntents']) {
    error(await h.create(owner.cookie, key, { ...input, [field]: 'forged' }), 400, 'INVALID_INPUT');
  }
  error(await h.request('/api/runs', input, owner.cookie), 400, 'INVALID_IDEMPOTENCY_KEY');
  for (const badKey of ['', 'not-a-uuid', '00000000-0000-0000-0000-000000000000',
    `${key.slice(0, 14)}1${key.slice(15)}`, `${key}, ${key}`, `{${key}}`]) {
    error(await h.create(owner.cookie, badKey), 400, 'INVALID_IDEMPOTENCY_KEY');
  }
  // Cabeçalhos separados no fio, incluindo diferenças de caixa; fetch combina duplicados.
  const duplicated = await wireRequest(`${h.base}/api/runs`, 'POST', owner.cookie, input,
    ['X-Expected-User-Id', owner.user.id, 'Idempotency-Key', key, 'idempotency-key', key]);
  error(duplicated, 400, 'INVALID_IDEMPOTENCY_KEY');
  error(await h.request(`/api/runs?ownerId=${owner.user.id}`, input, owner.cookie,
    { headers: { 'Idempotency-Key': key } }), 400, 'INVALID_INPUT');
  const forgedOwner = { ownerId: owner.user.id };
  for (const headers of [['Content-Length', String(Buffer.byteLength(JSON.stringify(forgedOwner)))],
    ['Transfer-Encoding', 'chunked']]) {
    error(await wireRequest(`${h.base}/api/runs`, 'GET', owner.cookie, forgedOwner, ['X-Expected-User-Id', owner.user.id, ...headers]), 400, 'INVALID_INPUT');
  }
  assert.deepEqual(await h.files(), [], 'entrada recusada não deixa registros nem temporários');
  const accepted = await h.create(owner.cookie, key, { ...input, name: ` ${'😀'.repeat(120)} `,
    applicationName: ` ${'á'.repeat(120)} `, objective: ` ${'a'.repeat(2000)} ` });
  assert.equal(accepted.status, 201);
  assert.equal(accepted.body.name, '😀'.repeat(120));
  const getWithoutOrigin = await fetch(`${h.base}/api/runs`, { headers: { Cookie: owner.cookie, 'X-Expected-User-Id': owner.user.id } });
  assert.equal(getWithoutOrigin.status, 200);
});

test('T3.3: limite de 16 KiB aplica-se aos bytes do JSON inteiro, inclusive corpo em partes', async t => {
  const h = await harness(t);
  const owner = await h.register();
  const key = randomUUID();
  const base = { ...input, text: 'á' };
  const atLimit = { ...base, text: base.text + 'x'.repeat(16 * 1024 - Buffer.byteLength(JSON.stringify(base))) };
  assert.equal(Buffer.byteLength(JSON.stringify(atLimit)), 16 * 1024);
  const overLimit = { ...atLimit, text: atLimit.text + 'x' };
  error(await h.create(owner.cookie, key, overLimit), 413, 'BODY_TOO_LARGE');
  const bytes = Buffer.from(JSON.stringify(overLimit));
  const chunks = new ReadableStream({ start(controller) {
    for (let offset = 0; offset < bytes.length; offset += 1024) controller.enqueue(bytes.subarray(offset, offset + 1024));
    controller.close();
  } });
  error(await h.request('/api/runs', input, owner.cookie, { headers: { 'Idempotency-Key': key },
    body: chunks, duplex: 'half' } as RequestInit), 413, 'BODY_TOO_LARGE');
  assert.deepEqual(await h.files(), []);
  const accepted = await h.create(owner.cookie, key, atLimit);
  assert.equal(accepted.status, 201);
  assert.equal((await h.store.read(accepted.body.id)).run.artifacts[0]!.text, atLimit.text);
});

test('T3.3: falhas de persistência antes/depois da substituição não confirmam sucesso e repetição recupera', async t => {
  const h = await harness(t);
  const owner = await h.register();
  const key = randomUUID();
  const before = t.mock.method(fs, 'rename', async () => { throw new Error('simulação: caminho privado'); });
  try {
    const failed = await h.create(owner.cookie, key);
    error(failed, 503, 'STORAGE_FAILURE');
    assert.equal(failed.response.headers.get('location'), null);
    assert.ok(!JSON.stringify(failed.body).includes('caminho privado'));
  } finally { before.mock.restore(); }
  assert.deepEqual(await h.files(), []);
  assert.equal((await h.create(owner.cookie, key)).status, 201);
  const uncertainKey = randomUUID();
  const rename = fs.rename;
  // Simula erro depois de substituir o arquivo, quando a persistência pode ter ocorrido.
  const after = t.mock.method(fs, 'rename', async (...args: Parameters<typeof fs.rename>) => {
    await rename(...args);
    throw new Error('simulação: falha depois da substituição');
  });
  try { error(await h.create(owner.cookie, uncertainKey), 503, 'STORAGE_FAILURE'); }
  finally { after.mock.restore(); }
  const id = idFor(owner.user.id, uncertainKey);
  const original = await h.raw(id);
  await h.restart();
  const repeated = await h.create(await h.login(), uncertainKey);
  assert.equal(repeated.status, 200);
  assert.equal(repeated.body.id, id);
  assert.equal(repeated.body.createdAt, JSON.parse(original).run.createdAt);
  assert.equal(await h.raw(id), original);
  assert.deepEqual((await h.files()).sort(), [id, idFor(owner.user.id, key)].map(value => `${value}.json`).sort());
});

test('T3.3: histórico recusa corrupção/acesso inseguro sem lista parcial; creation é opcional mas validado', async t => {
  const h = await harness(t);
  const owner = await h.register();
  const other = await h.register(1);
  const valid = await h.create(owner.cookie);
  const privateRun = await h.create(other.cookie);
  assert.equal(valid.status, 201);
  assert.equal(privateRun.status, 201);
  const id = privateRun.body.id;
  const original = await h.raw(id);
  for (const creation of [null, [], {}, { requestHash: 42 }, { requestHash: 'a'.repeat(63) },
    { requestHash: 'g'.repeat(64) }, { requestHash: 'A'.repeat(64) }]) {
    const malformed = JSON.parse(original);
    malformed.run.creation = creation;
    await fs.writeFile(h.file(id), JSON.stringify(malformed));
    error(await h.request('/api/runs?q=ausente&status=draft', undefined, owner.cookie), 503, 'STORAGE_FAILURE');
    await assert.rejects(h.store.read(id), { code: 'INVALID_RECORD' });
  }
  await fs.writeFile(h.file(id), '{ conteúdo privado');
  const corrupt = await h.request('/api/runs', undefined, owner.cookie);
  error(corrupt, 503, 'STORAGE_FAILURE');
  assert.ok(!JSON.stringify(corrupt.body).includes(id));
  assert.ok(!JSON.stringify(corrupt.body).includes('conteúdo privado'));
  await fs.unlink(h.file(id));
  await fs.symlink(h.file(valid.body.id), h.file(id));
  error(await h.request('/api/runs', undefined, owner.cookie), 503, 'STORAGE_FAILURE');
  await fs.unlink(h.file(id));
  await fs.mkdir(h.file(id));
  error(await h.request('/api/runs', undefined, owner.cookie), 503, 'STORAGE_FAILURE');
  await fs.rmdir(h.file(id));
  // Simulação de registro legado anterior à inclusão de creation.
  const legacy = JSON.parse(original);
  delete legacy.run.creation;
  await fs.writeFile(h.file(id), JSON.stringify(legacy));
  assert.deepEqual(await h.store.read(id), legacy);
  assert.deepEqual((await h.request('/api/runs', undefined, other.cookie)).body, { items: [privateRun.body] });
  assert.equal((await h.request(`/api/runs/${id}`, undefined, other.cookie)).status, 200);
  assert.deepEqual((await h.request('/api/runs', undefined, owner.cookie)).body, { items: [valid.body] });
});
