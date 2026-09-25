import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { createApp } from '../src/app.js';
import { readConfig } from '../src/config.js';
import { RunStore, type RunRecord } from '../src/storage/runs.js';
import type { PreparationOptions } from '../src/application/prepare-plan.js';

// Somente preparo de testes: nenhuma fixture é carregada pela aplicação.
const origin = 'http://localhost:3000';
const password = '  senha fictícia longa  ';
const account = { name: 'Pessoa Um', email: 'one@example.test', password, teamName: 'Equipe exemplo' };
const second = { name: 'Pessoa Dois', email: 'two@example.test', password };
const reference = { outputId: 'out-plan', outputRevision: 1 };
const secret = 'PRIVATE-MARKER-MUST-NOT-LEAK';
const sessionCookie = (response: Response) => response.headers.get('set-cookie')!.split(';')[0]!;

function waiting(id: string, ownerId: string): RunRecord {
  return {
    id, ownerId, name: 'Revisão sintética', applicationName: 'Alvo controlado',
    createdAt: '2026-09-23T12:00:00.000Z', status: 'awaiting_approval', phase: 'planning',
    input: { credentialRef: secret, startUrl: secret, accessProfile: secret },
    artifacts: [{ path: secret }], questions: [], answers: [], validationPolicy: {}, budgetCycles: [],
    privateField: secret,
    outputs: [
      { id: 'out-curation', phase: 'curation', revision: 1, dependsOn: [], payload: {} },
      { id: reference.outputId, phase: 'planning', revision: 1, dependsOn: [{ outputId: 'out-curation', revision: 1 }],
        privateField: secret, payload: { privateField: secret, testPlan: {
          objective: 'Verificar o exemplo.', requirementIds: ['US-01'], ruleIds: ['CA-01'],
          priorities: [{ ruleId: 'CA-01', reason: 'Limites.', privateField: secret }],
          exclusions: [{ description: 'Fora do escopo.', reason: 'Sem requisito.', privateField: secret }],
          approach: ['AVL'], preconditions: ['Ambiente preparado.'], privateField: secret,
          sources: [{ artifactId: 'artifact-1', locator: 'CA-01', quote: 'Texto fictício.', privateField: secret }],
        } } },
    ],
    validations: ['out-curation', reference.outputId].map(outputId => ({
      outputId, outputRevision: 1, validator: 'output-validator', status: 'approved' as const, privateField: secret,
    })),
    approvals: [{ id: 'old', outputId: 'out-plan', outputRevision: 0, actorId: ownerId,
      at: '2026-09-23T12:00:00.000Z', decision: 'approved', comment: '', privateField: secret } as any],
  };
}

async function harness(t: TestContext, env: NodeJS.ProcessEnv = {}, preparation: PreparationOptions = {}) {
  const dataDir = await fs.mkdtemp(join(tmpdir(), 'akcit-http-'));
  const config = readConfig({ DATA_DIR: dataDir, APP_ORIGIN: origin,
    PILOT_ALLOWED_EMAILS: ' ONE@example.test , two@example.test ', ...env });
  let time = Date.parse('2026-09-23T12:00:00Z');
  let app = await createApp(config, { now: () => time, ...preparation });
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
  const store = new RunStore(dataDir);
  // Identidade capturada apenas no login/cadastro; nunca reconsultada antes de uma operação.
  const expectedUsers = new Map<string, string>();
  async function request(path: string, body?: unknown, cookie?: string, overrides: RequestInit = {}) {
    const expectedUserId = cookie && expectedUsers.get(cookie);
    const response = await fetch(`${base}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...overrides,
      headers: { Origin: config.appOrigin ?? origin, 'Content-Type': 'application/json',
        ...(cookie ? { Cookie: cookie } : {}),
        ...(expectedUserId && (path.startsWith('/api/runs') || path === '/api/auth/logout')
          ? { 'X-Expected-User-Id': expectedUserId } : {}), ...overrides.headers },
    });
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const text = await response.text();
    assert.ok(!text.includes(secret), 'resposta não pode conter campos privados');
    const result = text ? JSON.parse(text) : null;
    if (response.ok && ['/api/auth/register', '/api/auth/login'].includes(path)) {
      expectedUsers.set(sessionCookie(response), result.user.id);
    }
    return { response, status: response.status, body: result };
  }
  async function register(input = account) {
    const result = await request('/api/auth/register', input);
    assert.equal(result.status, 201, JSON.stringify(result.body));
    return { ...result, user: result.body.user, cookie: sessionCookie(result.response) };
  }
  return { dataDir, store, request, register, get base() { return base; },
    advance: (ms: number) => { time += ms; },
    restart: async () => { await close(); app = await createApp(config, { now: () => time, ...preparation }); await listen(); },
  };
}
function error(result: { status: number; body: any }, status: number, code: string) {
  assert.equal(result.status, status, JSON.stringify(result.body));
  assert.equal(result.body.error.code, code);
  assert.deepEqual(Object.keys(result.body), ['error']);
}

async function wireRequest(url: string, cookie: string, body: unknown, headers: string[]) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const request = httpRequest(url, { method: body === undefined ? 'GET' : 'POST', headers: [
      'Host', new URL(url).host, 'Origin', origin, 'Content-Type', 'application/json', 'Cookie', cookie, ...headers,
    ] }, response => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { text += chunk; });
      response.on('end', () => resolve({ status: response.statusCode!, body: text ? JSON.parse(text) : null }));
    });
    request.on('error', reject);
    request.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

test('BUG-T2.1-01: consulta, decisões e logout exigem uma única identidade esperada válida', async t => {
  const h = await harness(t);
  const owner = await h.register();
  await h.store.create(waiting('expected-user', owner.user.id));
  const routes = [
    ['/api/runs/expected-user', undefined],
    ['/api/runs/expected-user/approve', reference],
    ['/api/runs/expected-user/request-changes', { ...reference, comment: '  Rever literalmente.  ' }],
    ['/api/runs/expected-user/continue', reference],
    ['/api/auth/logout', {}],
  ] as const;
  for (const [path, body] of routes) {
    for (const headers of [[], ['X-Expected-User-Id', ''], ['X-Expected-User-Id', 'not-a-uuid'],
      ['X-Expected-User-Id', '00000000-0000-0000-0000-000000000000'],
      ['X-Expected-User-Id', `${owner.user.id.slice(0, 14)}1${owner.user.id.slice(15)}`],
      ['X-Expected-User-Id', `{${owner.user.id}}`],
      ['X-Expected-User-Id', `${owner.user.id}, ${owner.user.id}`],
      ['X-Expected-User-Id', owner.user.id, 'x-expected-user-id', owner.user.id]]) {
      error(await wireRequest(`${h.base}${path}`, owner.cookie, body, headers), 400, 'INVALID_EXPECTED_USER_ID');
    }
  }
  assert.equal((await h.request('/api/auth/me', undefined, owner.cookie)).status, 200);
  assert.equal((await h.request('/api/runs/expected-user', undefined, owner.cookie,
    { headers: { 'X-Expected-User-Id': owner.user.id.toUpperCase() } })).status, 200);
  assert.equal((await h.store.read('expected-user')).run.approvals.length, 1);
});

test('BUG-T2.1-01: identidade divergente bloqueia consulta, decisões e logout antes de acessar execuções', async t => {
  const h = await harness(t);
  const owner = await h.register();
  const other = await h.register(second as typeof account);
  await h.store.create(waiting('account-a', owner.user.id));
  await h.store.create(waiting('account-b', other.user.id));
  const snapshots = await Promise.all(['account-a', 'account-b'].map(id => fs.readFile(join(h.dataDir, `runs/${id}.json`), 'utf8')));
  const reads = t.mock.method(RunStore.prototype, 'read');
  const updates = t.mock.method(RunStore.prototype, 'update');
  for (const id of ['account-a', 'account-b', 'missing']) {
    for (const suffix of ['', '/approve', '/request-changes', '/continue']) {
      const body = suffix ? { ...reference, ...(suffix.includes('changes') ? { comment: '  Conta A.  ' } : {}) } : undefined;
      const denied = await h.request(`/api/runs/${id}${suffix}`, body, other.cookie,
        { headers: { 'X-Expected-User-Id': owner.user.id } });
      error(denied, 409, 'ACCOUNT_CHANGED');
      for (const privateValue of [owner.user.id, other.user.id, secret, 'account-a', 'account-b']) {
        assert.ok(!JSON.stringify(denied.body).includes(privateValue));
      }
    }
  }
  const logout = await h.request('/api/auth/logout', {}, other.cookie,
    { headers: { 'X-Expected-User-Id': owner.user.id } });
  error(logout, 409, 'ACCOUNT_CHANGED');
  assert.equal(logout.response.headers.get('set-cookie'), null);
  assert.deepEqual((await h.request('/api/auth/me', undefined, other.cookie)).body, { user: other.user });
  assert.equal(reads.mock.callCount(), 0);
  assert.equal(updates.mock.callCount(), 0);
  reads.mock.restore(); updates.mock.restore();
  assert.deepEqual(await Promise.all(['account-a', 'account-b'].map(id => fs.readFile(join(h.dataDir, `runs/${id}.json`), 'utf8'))), snapshots);
});

test('T3.2: cadastro, consulta própria, aprovação idempotente, logout e retorno após reinício', async t => {
  const h = await harness(t);
  const owner = await h.register({ ...account, email: ' ONE@EXAMPLE.TEST ' });
  assert.deepEqual(owner.user, { id: owner.user.id, name: account.name, email: account.email, teamName: account.teamName });
  assert.match(owner.user.id, /^[a-f0-9-]{36}$/i);
  const header = owner.response.headers.get('set-cookie')!;
  for (const attribute of ['HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=28800']) assert.ok(header.includes(attribute));
  assert.doesNotMatch(header, /Domain=|Secure/);
  error(await h.request('/api/auth/register', { ...account, email: 'outsider@example.test' }), 403, 'REGISTRATION_NOT_ALLOWED');
  error(await h.request('/api/auth/register', account), 409, 'ACCOUNT_EXISTS');
  assert.deepEqual((await h.request('/api/auth/me', undefined, owner.cookie)).body, { user: owner.user });
  await h.store.create(waiting('run-own', owner.user.id));
  const review = await h.request('/api/runs/run-own', undefined, owner.cookie);
  assert.deepEqual(Object.keys(review.body).sort(), ['id', 'name', 'applicationName', 'createdAt', 'status', 'phase', 'plan', 'curation', 'cases', 'canCreateCases', 'canDecideCases', 'answers', 'canResume', 'approvals', 'progress', 'stopReason', 'questions'].sort());
  assert.equal(review.body.plan.revision, 1);
  assert.equal(review.body.plan.payload.testPlan.objective, 'Verificar o exemplo.');
  assert.equal(review.body.plan.validations[0].status, 'approved');
  const approved = await h.request('/api/runs/run-own/approve', reference, owner.cookie);
  assert.equal(approved.status, 200);
  assert.deepEqual(Object.keys(approved.body).sort(), ['approvals', 'phase', 'status']);
  const decision = approved.body.approvals.at(-1);
  assert.equal(decision.actorId, owner.user.id);
  assert.equal(decision.decision, 'approved');
  assert.equal(approved.body.status, 'awaiting_approval');
  assert.equal(approved.body.phase, 'planning');
  const before = await fs.readFile(join(h.dataDir, 'runs/run-own.json'), 'utf8');
  const repeats = await Promise.all([1, 2].map(() => h.request('/api/runs/run-own/approve', reference, owner.cookie)));
  repeats.forEach(result => assert.deepEqual(result.body, approved.body));
  assert.equal(await fs.readFile(join(h.dataDir, 'runs/run-own.json'), 'utf8'), before);
  assert.deepEqual((await h.store.read('run-own')).workIntents, []);
  assert.deepEqual((await h.request('/api/runs/run-own', undefined, owner.cookie)).body.approvals.at(-1), decision);
  const loggedOut = await h.request('/api/auth/logout', {}, owner.cookie);
  assert.equal(loggedOut.status, 204);
  assert.match(loggedOut.response.headers.get('set-cookie')!, /Max-Age=0/);
  error(await h.request('/api/auth/me', undefined, owner.cookie), 401, 'INVALID_SESSION');
  const login = await h.request('/api/auth/login', { email: ' ONE@example.test ', password });
  assert.equal(login.status, 200);
  const newCookie = sessionCookie(login.response);
  assert.notEqual(newCookie, owner.cookie);
  await h.restart();
  error(await h.request('/api/auth/me', undefined, newCookie), 401, 'INVALID_SESSION');
  const relogin = await h.request('/api/auth/login', { email: account.email, password });
  assert.equal(relogin.status, 200);
  assert.deepEqual(relogin.body.user, owner.user);
  assert.deepEqual((await h.request('/api/runs/run-own', undefined, sessionCookie(relogin.response))).body.approvals.at(-1), decision);
});

test('T3.2: duas contas isoladas, comentário obrigatório e campos forjados recusados', async t => {
  const h = await harness(t);
  const owner = await h.register();
  const other = await h.register(second as typeof account);
  await h.store.create(waiting('run-changes', owner.user.id));
  for (const suffix of ['', '/approve', '/request-changes', '/continue']) {
    const payload = suffix ? { ...reference, ...(suffix.includes('changes') ? { comment: 'Rever.' } : {}) } : undefined;
    const denied = await h.request(`/api/runs/run-changes${suffix}`, payload, other.cookie);
    const missing = await h.request(`/api/runs/missing${suffix}`, payload, other.cookie);
    error(denied, 404, 'RUN_NOT_FOUND');
    assert.deepEqual(denied.body, missing.body);
  }
  for (const field of ['actorId', 'userId', 'ownerId', 'id', 'at', 'status', 'phase', 'validations', 'resourceReserved', 'workIntents']) {
    error(await h.request('/api/runs/run-changes/approve', { ...reference, [field]: 'forged' }, owner.cookie), 400, 'INVALID_INPUT');
  }
  for (const comment of [undefined, '', '   ']) {
    error(await h.request('/api/runs/run-changes/request-changes', { ...reference, comment }, owner.cookie), 400, 'COMMENT_REQUIRED');
  }
  const change = { ...reference, comment: '  Rever cobertura do CA-01.  ' };
  const result = await h.request('/api/runs/run-changes/request-changes', change, owner.cookie);
  assert.equal(result.status, 200);
  assert.equal(result.body.approvals.at(-1).comment, change.comment);
  assert.equal(result.body.approvals.at(-1).decision, 'changes_requested');
  assert.deepEqual((await h.request('/api/runs/run-changes/request-changes', change, owner.cookie)).body, result.body);
  error(await h.request('/api/runs/run-changes/approve', reference, owner.cookie), 409, 'DECISION_CONFLICT');
  const saved = await h.store.read('run-changes');
  assert.equal(saved.run.status, 'awaiting_approval');
  assert.equal(saved.run.phase, 'planning');
  assert.deepEqual(saved.workIntents, []);
  assert.equal(saved.run.approvals.at(-1)!.actorId, owner.user.id);
  assert.deepEqual((await h.request('/api/runs/run-changes', undefined, owner.cookie)).body.approvals, result.body.approvals);
  error(await h.request('/api/runs/run-changes/continue', reference, owner.cookie), 409, 'INVALID_STATE');
});

test('T6.1: continue exige autorização e revisão exata, recusa campos forjados e repete sem duplicar', async t => {
  const original = 'US-01: Reservar itens. CA-01: Aceitar quantidades inteiras de 1 a 10 e rejeitar as demais.';
  const calls: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const h = await harness(t, { PI_PROVIDER: 'test-provider', PI_MODEL: 'test-model' }, {
    modelPreflight: async () => {},
    modelCall: async task => {
      calls.push(task.task);
      const input = JSON.parse(task.prompt);
      const sources = [{ artifactId: input.artifacts[0].id, locator: 'L1', quote: original }];
      if (task.task === 'create-test-cases') await gate;
      const payload = task.role === 'artifact-curator' ? { requirements: [{ id: 'US-01', statement: 'Reservar itens.', sources,
        rules: [{ id: 'CA-01', statement: 'Aceitar inteiros de 1 a 10 e rejeitar os demais.', sources }] }], questions: [] }
        : task.task === 'create-test-plan' ? { testPlan: { objective: 'Conferir quantidades.', requirementIds: ['US-01'], ruleIds: ['CA-01'],
          priorities: [{ ruleId: 'CA-01', reason: 'Faixa documentada.' }], exclusions: [], approach: ['Limites inteiros.'], preconditions: [], sources } }
        : task.task === 'create-test-cases' ? { testCases: [{ id: 'CT-01', requirementIds: ['US-01'], ruleIds: ['CA-01'],
          preconditions: [], setup: 'Preparar quantidade 1.', pathId: null, data: { quantidade: 1 },
          techniques: [{ name: 'AVL', description: 'Limite inferior inclusivo inteiro.', values: [1] }], expected: 'Aceitar a quantidade 1.', sources }] }
        : { status: 'approved', reason: 'Escopo e fontes conferidos.', findings: [] };
      return { payload, metadata: { provider: task.model.provider, model: task.model.model, durationMs: 1 } };
    },
  });
  t.after(release);
  const owner = await h.register(); const other = await h.register(second as typeof account);
  const created = await h.request('/api/runs', { name: 'Casos pelo site', applicationName: 'Alvo controlado', text: original }, owner.cookie,
    { headers: { 'Idempotency-Key': 'ad98b748-d193-471b-8e99-8e0b225f6c98' } });
  assert.equal(created.status, 201);
  const id = created.body.id; const endpoint = `/api/runs/${id}`;
  assert.equal((await h.request(`${endpoint}/start`, {}, owner.cookie)).status, 202);
  const completed = async () => {
    for (let attempt = 0; attempt < 200; attempt++) {
      const run = (await h.store.read(id)).run;
      if (run.status !== 'running') return run;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.fail('O processamento simulado não terminou.');
  };
  const planned = await completed(); assert.equal(planned.phase, 'planning'); assert.equal(planned.status, 'awaiting_approval');
  const plan = planned.outputs.find(output => output.phase === 'planning')!;
  const body = { outputId: plan.id, outputRevision: plan.revision };
  const snapshot = await fs.readFile(join(h.dataDir, `runs/${id}.json`), 'utf8');
  error(await h.request(`${endpoint}/continue`, body, other.cookie), 404, 'RUN_NOT_FOUND');
  error(await h.request(`${endpoint}/continue`, body, owner.cookie), 409, 'DECISION_MISSING');
  error(await h.request(`${endpoint}/continue`, { ...body, outputRevision: 2 }, owner.cookie), 409, 'STALE_VERSION');
  error(await h.request(`${endpoint}/continue`, body, owner.cookie, { headers: { Origin: 'https://other.example.test' } }), 403, 'ORIGIN_REJECTED');
  for (const field of ['resourceReserved', 'userId', 'model', 'skillPath', 'approval']) {
    error(await h.request(`${endpoint}/continue`, { ...body, [field]: true }, owner.cookie), 400, 'INVALID_INPUT');
  }
  for (const outputRevision of [0, '1', 1.5, null]) error(await h.request(`${endpoint}/continue`, { ...body, outputRevision }, owner.cookie), 400, 'INVALID_INPUT');
  error(await h.request(`${endpoint}/continue?resourceReserved=true`, body, owner.cookie), 400, 'INVALID_INPUT');
  assert.equal(await fs.readFile(join(h.dataDir, `runs/${id}.json`), 'utf8'), snapshot);
  assert.equal(calls.length, 4);
  assert.equal((await h.request(`${endpoint}/approve`, body, owner.cookie)).status, 200);
  assert.equal(calls.length, 4, 'Aprovar não inicia inferência.');
  assert.equal((await h.request(endpoint, undefined, owner.cookie)).body.canCreateCases, true);
  const accepted = await Promise.all([1, 2].map(() => h.request(`${endpoint}/continue`, body, owner.cookie)));
  assert.deepEqual(accepted.map(value => value.status).sort(), [200, 202]);
  assert.ok(accepted.every(value => value.body.phase === 'case_design' && value.body.status === 'running'));
  assert.equal((await h.store.read(id)).workIntents.filter(intent => intent.type === 'create_cases').length, 1);
  release();
  const generated = await completed(); assert.equal(generated.status, 'awaiting_approval'); assert.equal(generated.phase, 'case_design');
  assert.deepEqual(calls.slice(4), ['create-test-cases', 'validate-output']);
  const repeated = await h.request(`${endpoint}/continue`, body, owner.cookie);
  assert.equal(repeated.status, 200); assert.equal(repeated.body.cases.revision, 1);
  assert.equal(repeated.body.cases.validations[0].status, 'approved'); assert.equal(repeated.body.canCreateCases, false);
  assert.equal(calls.length, 6);
});

test('T3.2: origem, conteúdo, JSON, tamanho em partes e sessão têm respostas controladas', async t => {
  const h = await harness(t);
  const owner = await h.register();
  await h.store.create(waiting('input', owner.user.id));
  for (const badOrigin of ['', 'null', 'http://localhost:3001', `${origin}.evil.test`, 'https://localhost:3000']) {
    error(await h.request('/api/auth/logout', {}, owner.cookie, { headers: { Origin: badOrigin } }), 403, 'ORIGIN_REJECTED');
  }
  const absent = await fetch(`${h.base}/api/auth/logout`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: owner.cookie }, body: '{}' });
  assert.equal(absent.status, 403);
  error(await h.request('/api/auth/logout', {}, owner.cookie, { headers: { 'Content-Type': 'text/plain' } }), 415, 'UNSUPPORTED_MEDIA_TYPE');
  error(await h.request('/api/auth/logout', {}, owner.cookie, { body: '{' }), 400, 'INVALID_JSON');
  for (const body of [[], null, 12, { state: 'forged' }]) error(await h.request('/api/auth/logout', body, owner.cookie), 400, 'INVALID_INPUT');
  error(await h.request('/api/runs/input/approve', { ...reference, outputRevision: '1' }, owner.cookie), 400, 'INVALID_INPUT');
  error(await h.request('/api/auth/logout', { padding: 'x'.repeat(17000) }, owner.cookie), 413, 'BODY_TOO_LARGE');
  const chunks = new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode('{"padding":"'));
    for (let i = 0; i < 20; i++) controller.enqueue(new TextEncoder().encode('x'.repeat(1024)));
    controller.enqueue(new TextEncoder().encode('"}')); controller.close();
  } });
  error(await h.request('/api/auth/logout', {}, owner.cookie, { body: chunks, duplex: 'half' } as RequestInit), 413, 'BODY_TOO_LARGE');
  for (const cookie of [undefined, 'akcit_session=client-selected', `${owner.cookie}; ${owner.cookie}`]) {
    error(await h.request('/api/auth/me', undefined, cookie), 401, 'INVALID_SESSION');
  }
  assert.equal((await h.request('/api/auth/me', undefined, owner.cookie)).status, 200);
  assert.equal((await fetch(`${h.base}/healthz`)).status, 200);
  assert.equal((await fetch(h.base)).status, 200);
});

test('T3.2: senhas integrais, hash persistido, cookie HTTPS e expiração absoluta controlada', async t => {
  const h = await harness(t, { APP_ORIGIN: 'https://pilot.example.test' });
  const owner = await h.register();
  assert.match(owner.response.headers.get('set-cookie')!, /; Secure/);
  const raw = await fs.readFile(join(h.dataDir, 'auth/users.json'), 'utf8');
  assert.ok(!raw.includes(password));
  const record = JSON.parse(raw);
  assert.equal(record.schemaVersion, 1);
  assert.equal(record.users.length, 1);
  const storedPassword = record.users[0].password;
  assert.deepEqual(storedPassword, { algorithm: 'scrypt', N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024,
    keyLength: 64, salt: storedPassword.salt, hash: storedPassword.hash });
  assert.match(storedPassword.salt, /^[a-f0-9]{32}$/);
  assert.match(storedPassword.hash, /^[a-f0-9]{128}$/);
  assert.ok(!JSON.stringify(owner.body).includes(storedPassword.hash));
  assert.ok(!JSON.stringify(owner.body).includes(owner.cookie.slice('akcit_session='.length)));
  assert.equal((await fs.stat(join(h.dataDir, 'auth/users.json'))).mode & 0o777, 0o600);
  assert.equal((await fs.stat(join(h.dataDir, 'auth'))).mode & 0o777, 0o700);
  const wrong = await h.request('/api/auth/login', { email: account.email, password: password.trim() });
  const absent = await h.request('/api/auth/login', { email: second.email, password });
  error(wrong, 401, 'INVALID_CREDENTIALS');
  assert.deepEqual(absent.body, wrong.body);
  h.advance(8 * 60 * 60 * 1000 - 1);
  assert.equal((await h.request('/api/auth/me', undefined, owner.cookie)).status, 200);
  h.advance(1);
  error(await h.request('/api/auth/me', undefined, owner.cookie), 401, 'INVALID_SESSION');
});

test('T3.2: cadastro concorrente serializa unicidade e preserva contas diferentes', async t => {
  const h = await harness(t);
  const results = await Promise.all([account, { ...account, email: ' ONE@EXAMPLE.TEST ' }, second]
    .map(input => h.request('/api/auth/register', input)));
  assert.deepEqual(results.map(result => result.status).sort(), [201, 201, 409]);
  const record = JSON.parse(await fs.readFile(join(h.dataDir, 'auth/users.json'), 'utf8'));
  assert.deepEqual(record.users.map((user: any) => user.email).sort(), [account.email, second.email]);
  assert.notEqual(record.users[0].password.salt, record.users[1].password.salt);
  assert.notEqual(record.users[0].password.hash, record.users[1].password.hash);
  for (const email of [account.email, second.email]) assert.equal((await h.request('/api/auth/login', { email, password })).status, 200);
});

test('T3.2: limites combinados por e-mail e conexão expiram sem confiar em proxy', async t => {
  const h = await harness(t);
  for (let attempt = 0; attempt < 10; attempt++) {
    error(await h.request('/api/auth/register', { ...account, email: 'disabled@example.test' }), 403, 'REGISTRATION_NOT_ALLOWED');
  }
  error(await h.request('/api/auth/login', { email: ' DISABLED@example.test ', password }), 429, 'TOO_MANY_ATTEMPTS');
  h.advance(15 * 60 * 1000);
  error(await h.request('/api/auth/register', { ...account, email: 'disabled@example.test' }), 403, 'REGISTRATION_NOT_ALLOWED');
  h.advance(15 * 60 * 1000);
  for (let attempt = 0; attempt < 30; attempt++) {
    error(await h.request('/api/auth/register', { ...account, email: `disabled${attempt}@example.test` }, undefined,
      { headers: { 'X-Forwarded-For': `198.51.100.${attempt}` } }), 403, 'REGISTRATION_NOT_ALLOWED');
  }
  error(await h.request('/api/auth/register', account, undefined, { headers: { 'X-Forwarded-For': '203.0.113.1' } }), 429, 'TOO_MANY_ATTEMPTS');
  h.advance(15 * 60 * 1000);
  assert.equal((await h.request('/api/auth/register', account)).status, 201);
});

test('T3.2: configuração pendente e cadastro desabilitado preservam healthcheck', async t => {
  const pending = await harness(t, { APP_ORIGIN: '' });
  error(await pending.request('/api/auth/login', { email: account.email, password }), 503, 'AUTH_NOT_CONFIGURED');
  assert.equal((await fetch(`${pending.base}/healthz`)).status, 200);
  const disabled = await harness(t, { PILOT_ALLOWED_EMAILS: '' });
  error(await disabled.request('/api/auth/register', account), 403, 'REGISTRATION_NOT_ALLOWED');
  for (const appOrigin of ['http://example.test', 'https://example.test/path', 'https://user:pass@example.test', 'null', 'ftp://localhost', 'https://example.test?query', 'https://example.test#fragment']) {
    assert.throws(() => readConfig({ APP_ORIGIN: appOrigin }), /APP_ORIGIN/);
  }
  for (const appOrigin of ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://[::1]:3000', 'https://example.test']) {
    assert.equal(readConfig({ APP_ORIGIN: appOrigin }).appOrigin, appOrigin);
  }
  assert.deepEqual(readConfig({ PILOT_ALLOWED_EMAILS: ' ONE@example.test, one@example.test, two@example.test ' }).pilotAllowedEmails,
    [account.email, second.email]);
  assert.throws(() => readConfig({ PILOT_ALLOWED_EMAILS: 'not-an-email' }), /PILOT_ALLOWED_EMAILS/);
});

test('T3.2: limites de strings são validados em execução e senha aceita 15 a 128 caracteres intactos', async t => {
  const h = await harness(t);
  for (const input of [
    { ...account, name: '' }, { ...account, name: 'x'.repeat(121) }, { ...account, name: 42 },
    { ...account, teamName: ' ' }, { ...account, teamName: 'x'.repeat(121) }, { ...account, teamName: [] },
    { ...account, email: 'invalid' }, { ...account, email: `${'x'.repeat(255)}@example.test` },
    { ...account, password: 'x'.repeat(14) }, { ...account, password: 'x'.repeat(129) },
    { ...account, password: 42 }, { ...account, actorId: 'forged' },
  ]) error(await h.request('/api/auth/register', input), 400, 'INVALID_INPUT');
  for (const [input, exactPassword] of [[account, ' '.repeat(15)], [second, '🔒'.repeat(128)]] as const) {
    const result = await h.request('/api/auth/register', { ...input, name: '😀'.repeat(120), password: exactPassword });
    assert.equal(result.status, 201);
    assert.equal((await h.request('/api/auth/login', { email: input.email, password: exactPassword })).status, 200);
  }
});

test('T3.2: versão vigente, parecer, estado e decisão anterior inválida não alteram o registro', async t => {
  const h = await harness(t);
  const owner = await h.register();
  for (const [id, mutate, code] of [
    ['stale', (run: RunRecord) => { run.outputs.unshift({ ...structuredClone(run.outputs[1]!), revision: 2 }); }, 'STALE_VERSION'],
    ['verdict', (run: RunRecord) => { run.validations = []; }, 'INSUFFICIENT_VALIDATION'],
    ['state', (run: RunRecord) => { run.status = 'cancelled'; }, 'INVALID_STATE'],
    ['invalid', (run: RunRecord) => { run.approvals.push({ id: 'bad-time', actorId: owner.user.id, at: 'invalid', ...reference, decision: 'approved', comment: '' }); }, 'INVALID_DECISION'],
  ] as const) {
    const run = waiting(id, owner.user.id); mutate(run); await h.store.create(run);
    const before = await fs.readFile(join(h.dataDir, `runs/${id}.json`), 'utf8');
    error(await h.request(`/api/runs/${id}/approve`, reference, owner.cookie), 409, code);
    assert.equal(await fs.readFile(join(h.dataDir, `runs/${id}.json`), 'utf8'), before);
  }
  assert.equal((await h.request('/api/runs/stale', undefined, owner.cookie)).body.plan.revision, 2);
  const empty = waiting('empty', owner.user.id); empty.outputs = [];
  await h.store.create(empty);
  assert.equal((await h.request('/api/runs/empty', undefined, owner.cookie)).body.plan, null);
  await h.store.update('stale', record => { record.run.outputs.push(structuredClone(record.run.outputs[0]!)); return { save: true, value: undefined }; });
  error(await h.request('/api/runs/stale', undefined, owner.cookie), 409, 'AMBIGUOUS_RECORD');
});

test('T3.2: armazenamento indisponível ou corrompido gera erro sem derrubar servidor', async t => {
  const h = await harness(t);
  const owner = await h.register();
  await h.store.create(waiting('storage', owner.user.id));
  const file = join(h.dataDir, 'runs/storage.json');
  const original = await fs.readFile(file, 'utf8');
  await fs.unlink(file); await fs.mkdir(file);
  error(await h.request('/api/runs/storage', undefined, owner.cookie), 503, 'RUN_INACCESSIBLE');
  await fs.rmdir(file); await fs.writeFile(file, original);
  assert.equal((await h.request('/api/runs/storage', undefined, owner.cookie)).status, 200);
  const usersFile = join(h.dataDir, 'auth/users.json');
  await fs.writeFile(usersFile, '{');
  error(await h.request('/api/auth/login', { email: account.email, password }), 503, 'AUTH_STORAGE_UNAVAILABLE');
  error(await h.request('/api/auth/register', second), 503, 'AUTH_STORAGE_UNAVAILABLE');
  assert.equal(await fs.readFile(usersFile, 'utf8'), '{');
  assert.equal((await fetch(`${h.base}/healthz`)).status, 200);
});

function waitingCases(id: string, ownerId: string): RunRecord {
  const text = 'Texto sintético para validação de fontes dos casos.';
  const artifact = { id: 'artifact-1', name: 'art.md', version: 'v1', text };
  const source = { artifactId: 'artifact-1', locator: 'L1', quote: text };
  return {
    id, ownerId, name: 'Revisão sintética de casos', applicationName: 'Alvo controlado',
    createdAt: '2026-09-23T12:00:00.000Z', status: 'awaiting_approval', phase: 'case_design',
    input: { credentialRef: secret, startUrl: secret, accessProfile: secret, objective: 'Testar', artifactIds: ['artifact-1'] },
    artifacts: [artifact], questions: [], answers: [], validationPolicy: {}, budgetCycles: [],
    outputs: [
      {
        id: 'out-curation', phase: 'curation', revision: 1, dependsOn: [], answerRefs: [],
        payload: {
          requirements: [{ id: 'REQ-1', statement: text, sources: [source],
            rules: [{ id: 'RULE-1', statement: text, sources: [source] }] }],
          questions: [],
        },
      },
      {
        id: 'out-plan', phase: 'planning', revision: 1, dependsOn: [{ outputId: 'out-curation', revision: 1 }], answerRefs: [],
        payload: {
          testPlan: {
            objective: 'Testar', requirementIds: ['REQ-1'], ruleIds: ['RULE-1'],
            priorities: [{ ruleId: 'RULE-1', reason: 'Foco' }], exclusions: [],
            approach: ['AVL'], preconditions: [], sources: [source],
          },
        },
      },
      {
        id: 'out-cases', phase: 'case_design', revision: 1,
        dependsOn: [{ outputId: 'out-curation', revision: 1 }, { outputId: 'out-plan', revision: 1 }], answerRefs: [],
        payload: {
          testCases: [{
            id: 'CT-01', requirementIds: ['REQ-1'], ruleIds: ['RULE-1'], preconditions: [], setup: '', pathId: null,
            data: {}, techniques: [{ name: 'PCE', description: 'Teste', values: [] }], expected: 'OK', sources: [source],
          }],
        },
      },
    ],
    validations: [
      { outputId: 'out-curation', outputRevision: 1, validator: 'output-validator', status: 'approved' },
      { outputId: 'out-plan', outputRevision: 1, validator: 'output-validator', status: 'approved' },
      { outputId: 'out-cases', outputRevision: 1, validator: 'output-validator', status: 'approved' },
    ],
    approvals: [
      { id: 'app-plan', outputId: 'out-plan', outputRevision: 1, actorId: ownerId, at: '2026-09-23T12:00:00.000Z', decision: 'approved', comment: '' },
    ],
  };
}

test('T6.2: endpoints de aprovação e solicitação de alterações nos casos de teste', async t => {
  const h = await harness(t);
  const owner = await h.register();
  const outsider = await h.register(second);
  const casesRef = { outputId: 'out-cases', outputRevision: 1 };

  // CA-01/CA-02: consulta antes de decidir
  await h.store.create(waitingCases('run-cases-1', owner.user.id));
  const reviewBefore = await h.request('/api/runs/run-cases-1', undefined, owner.cookie);
  assert.equal(reviewBefore.status, 200);
  assert.equal(reviewBefore.body.canDecideCases, true);
  assert.equal(reviewBefore.body.cases.id, 'out-cases');
  assert.equal(reviewBefore.body.cases.revision, 1);

  // CA-02: pedido de alteração sem comentário é recusado
  error(await h.request('/api/runs/run-cases-1/request-changes', casesRef, owner.cookie), 400, 'COMMENT_REQUIRED');
  error(await h.request('/api/runs/run-cases-1/request-changes', { ...casesRef, comment: '   ' }, owner.cookie), 400, 'COMMENT_REQUIRED');

  // CA-01: aprovação dos casos registra decisão com autor, horário e revisão vigentes
  const approved = await h.request('/api/runs/run-cases-1/approve', casesRef, owner.cookie);
  assert.equal(approved.status, 200);
  assert.equal(approved.body.status, 'awaiting_approval');
  assert.equal(approved.body.phase, 'case_design');
  const caseDecision = approved.body.approvals.find((a: any) => a.outputId === 'out-cases');
  assert.ok(caseDecision);
  assert.equal(caseDecision.actorId, owner.user.id);
  assert.equal(caseDecision.decision, 'approved');

  // Consulta atualizada reflete canDecideCases false
  const reviewAfter = await h.request('/api/runs/run-cases-1', undefined, owner.cookie);
  assert.equal(reviewAfter.body.canDecideCases, false);

  // CA-04: repetição idêntica é idempotente e preserva decisão
  const repeat = await h.request('/api/runs/run-cases-1/approve', casesRef, owner.cookie);
  assert.equal(repeat.status, 200);
  assert.deepEqual(repeat.body, approved.body);

  // CA-04: decisão divergente para mesma revisão gera conflito 409
  error(await h.request('/api/runs/run-cases-1/request-changes', { ...casesRef, comment: 'Mudar CT-01' }, owner.cookie), 409, 'DECISION_CONFLICT');

  // CA-02: pedido de alterações com comentário válido
  await h.store.create(waitingCases('run-cases-2', owner.user.id));
  const changed = await h.request('/api/runs/run-cases-2/request-changes', { ...casesRef, comment: 'Ajustar expectativa.' }, owner.cookie);
  assert.equal(changed.status, 200);
  const changeDecision = changed.body.approvals.find((a: any) => a.outputId === 'out-cases');
  assert.ok(changeDecision);
  assert.equal(changeDecision.decision, 'changes_requested');
  assert.equal(changeDecision.comment, 'Ajustar expectativa.');

  // CA-06: isolamento de contas
  error(await h.request('/api/runs/run-cases-1', undefined, outsider.cookie), 404, 'RUN_NOT_FOUND');
  error(await h.request('/api/runs/run-cases-1/approve', casesRef, outsider.cookie), 404, 'RUN_NOT_FOUND');
  error(await h.request('/api/runs/run-cases-1/request-changes', { ...casesRef, comment: 'Tentativa externa.' }, outsider.cookie), 404, 'RUN_NOT_FOUND');

  // CA-03: dependência desatualizada ou sem validação
  await h.store.create(waitingCases('run-cases-stale', owner.user.id));
  error(await h.request('/api/runs/run-cases-stale/approve', { outputId: 'out-cases', outputRevision: 99 }, owner.cookie), 409, 'STALE_VERSION');

  const unvalidated = waitingCases('run-cases-unvalidated', owner.user.id);
  unvalidated.validations = unvalidated.validations.filter(v => v.outputId !== 'out-cases');
  await h.store.create(unvalidated);
  error(await h.request('/api/runs/run-cases-unvalidated/approve', casesRef, owner.cookie), 409, 'INSUFFICIENT_VALIDATION');
});

