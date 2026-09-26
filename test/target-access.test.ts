import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { createApp } from '../src/app.js';
import { readConfig } from '../src/config.js';
import { RunStore, type RunRecord, type StoredRun } from '../src/storage/runs.js';

const appOrigin = 'http://localhost:3000';
const targetOrigin = 'http://127.0.0.1:4000';
const accounts = [
  { name: 'Pessoa Um', email: 'one@example.test', password: 'senha ficticia longa 1!' },
  { name: 'Pessoa Dois', email: 'two@example.test', password: 'senha ficticia longa 2!' },
];
const cookieOf = (response: Response) => response.headers.get('set-cookie')!.split(';')[0]!;

async function harness(t: TestContext, env: NodeJS.ProcessEnv = {}) {
  const dataDir = await fs.mkdtemp(join(tmpdir(), 'akcit-target-access-'));
  const config = readConfig({
    DATA_DIR: dataDir,
    APP_ORIGIN: appOrigin,
    TARGET_ALLOWED_ORIGINS: `${targetOrigin},https://target.example.test:8443`,
    PILOT_ALLOWED_EMAILS: accounts.map(a => a.email).join(','),
    ...env,
  });
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

  const expectedUsers = new Map<string, string>();
  async function request(path: string, body?: unknown, cookie?: string, overrides: RequestInit = {}) {
    const expectedUserId = cookie && expectedUsers.get(cookie);
    const headers = new Headers({
      Origin: appOrigin,
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
      ...(expectedUserId && (path.startsWith('/api/runs') || path === '/api/auth/logout')
        ? { 'X-Expected-User-Id': expectedUserId } : {}),
    });
    new Headers(overrides.headers).forEach((value, name) => headers.set(name, value));
    const response = await fetch(`${base}${path}`, {
      method: overrides.method ?? (body === undefined ? 'GET' : 'POST'),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...overrides,
      headers,
    });
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const text = await response.text();
    const result = text ? JSON.parse(text) : null;
    if (response.ok && ['/api/auth/register', '/api/auth/login'].includes(path)) {
      expectedUsers.set(cookieOf(response), result.user.id);
    }
    return { response, status: response.status, body: result, text };
  }

  async function register(index = 0) {
    const result = await request('/api/auth/register', accounts[index]);
    assert.equal(result.status, 201, JSON.stringify(result.body));
    return { user: result.body.user, cookie: cookieOf(result.response) };
  }

  async function createRun(cookie: string, name = 'Execução de teste') {
    const result = await request('/api/runs', {
      name,
      applicationName: 'Aplicação alvo',
      objective: 'Validar acesso ao alvo.',
      text: 'US-01: Fazer reservas.\nCA-01: Quantidade de 1 a 10.',
    }, cookie, { headers: { 'Idempotency-Key': randomUUID() } });
    assert.equal(result.status, 201, JSON.stringify(result.body));
    return result.body;
  }

  return {
    dataDir,
    store: new RunStore(dataDir),
    request,
    register,
    createRun,
    get base() { return base; },
    restart: async () => { await close(); app = await createApp(config); await listen(); },
  };
}

test('T8.1 CA-01 / CA-04: cadastro inicial de acesso, consulta segura e sobrevivência a reinício', async t => {
  const h = await harness(t);
  const owner = await h.register(0);
  const run = await h.createRun(owner.cookie);

  // Inicialmente, acesso está pendente com revisão 0
  const initial = await h.request(`/api/runs/${run.id}`, undefined, owner.cookie);
  assert.equal(initial.status, 200);
  assert.deepEqual(initial.body.targetAccess, {
    revision: 0,
    startUrl: null,
    accessProfile: null,
    dataPreparation: null,
    authorizedTarget: false,
    hasCredential: false,
    canEdit: true,
  });

  const syntheticPassword = 'SYNTHETIC-PASSWORD-abc-123-with-spaces  ';
  const payload = {
    expectedAccessRevision: 0,
    startUrl: `${targetOrigin}/reservas`,
    accessProfile: 'Operador de reservas',
    dataPreparation: 'Iniciar com a lista de reservas vazia.',
    authorizedTarget: true,
    credential: {
      username: 'usuario-sintetico',
      password: syntheticPassword,
    },
  };

  const configured = await h.request(`/api/runs/${run.id}`, payload, owner.cookie, { method: 'PATCH' });
  assert.equal(configured.status, 200, JSON.stringify(configured.body));
  assert.deepEqual(configured.body.targetAccess, {
    revision: 1,
    startUrl: `${targetOrigin}/reservas`,
    accessProfile: 'Operador de reservas',
    dataPreparation: 'Iniciar com a lista de reservas vazia.',
    authorizedTarget: true,
    hasCredential: true,
    canEdit: true,
  });
  // Segredo não vaza na resposta do PATCH
  assert.ok(!configured.text.includes(syntheticPassword));
  assert.ok(!configured.text.includes('usuario-sintetico'));

  // Consulta GET subsequente retorna a mesma projeção
  const review = await h.request(`/api/runs/${run.id}`, undefined, owner.cookie);
  assert.equal(review.status, 200);
  assert.deepEqual(review.body.targetAccess, configured.body.targetAccess);
  assert.ok(!review.text.includes(syntheticPassword));
  assert.ok(!review.text.includes('usuario-sintetico'));

  // O arquivo no disco contém a credencial no envelope privado fora de run
  const stored = await h.store.read(run.id);
  assert.ok(stored.targetCredential);
  assert.equal(stored.targetCredential.username, 'usuario-sintetico');
  assert.equal(stored.targetCredential.password, syntheticPassword); // Literalmente preservado com espaços
  assert.equal(stored.targetCredential.ref, stored.run.input.credentialRef);
  assert.equal(stored.run.input.startUrl, `${targetOrigin}/reservas`);
  assert.equal(stored.run.input.accessProfile, 'Operador de reservas');
  assert.equal(stored.run.input.dataPreparation, 'Iniciar com a lista de reservas vazia.');
  assert.equal(stored.run.input.authorizedTarget, true);
  assert.equal(stored.run.input.accessRevision, 1);

  // Reiniciar o serviço e reconsultar após novo login
  await h.restart();
  const relogin = await h.request('/api/auth/login', { email: accounts[0].email, password: accounts[0].password });
  assert.equal(relogin.status, 200);
  const newCookie = cookieOf(relogin.response);
  const reloaded = await h.request(`/api/runs/${run.id}`, undefined, newCookie);
  assert.equal(reloaded.status, 200);
  assert.deepEqual(reloaded.body.targetAccess, configured.body.targetAccess);
  assert.ok(!reloaded.text.includes(syntheticPassword));
});

test('T8.1: atualização de perfil e preparo sem reenviar senha preserva credencial anterior', async t => {
  const h = await harness(t);
  const owner = await h.register(0);
  const run = await h.createRun(owner.cookie);

  const originalPassword = 'ORIGINAL-PASSWORD-xyz';
  await h.request(`/api/runs/${run.id}`, {
    expectedAccessRevision: 0,
    startUrl: `${targetOrigin}/reservas`,
    accessProfile: 'Operador',
    dataPreparation: 'Sem preparo.',
    authorizedTarget: true,
    credential: { username: 'operador-1', password: originalPassword },
  }, owner.cookie, { method: 'PATCH' });

  const initialStored = await h.store.read(run.id);
  const originalRef = initialStored.targetCredential?.ref;
  assert.ok(originalRef);

  // Atualiza sem enviar o campo credential
  const updated = await h.request(`/api/runs/${run.id}`, {
    expectedAccessRevision: 1,
    startUrl: `${targetOrigin}/reservas`,
    accessProfile: 'Supervisor de reservas',
    dataPreparation: 'Inserir reservas de teste 1 a 5 antes do início.',
    authorizedTarget: true,
  }, owner.cookie, { method: 'PATCH' });

  assert.equal(updated.status, 200);
  assert.equal(updated.body.targetAccess.revision, 2);
  assert.equal(updated.body.targetAccess.accessProfile, 'Supervisor de reservas');
  assert.equal(updated.body.targetAccess.hasCredential, true);

  const updatedStored = await h.store.read(run.id);
  assert.equal(updatedStored.targetCredential?.ref, originalRef);
  assert.equal(updatedStored.targetCredential?.username, 'operador-1');
  assert.equal(updatedStored.targetCredential?.password, originalPassword);
  assert.equal(updatedStored.run.input.credentialRef, originalRef);
  assert.equal(updatedStored.run.input.accessRevision, 2);
});

test('T8.1: substituição explícita de credencial gera nova referência opaca', async t => {
  const h = await harness(t);
  const owner = await h.register(0);
  const run = await h.createRun(owner.cookie);

  await h.request(`/api/runs/${run.id}`, {
    expectedAccessRevision: 0,
    startUrl: `${targetOrigin}/reservas`,
    accessProfile: 'Operador',
    dataPreparation: 'Sem preparo.',
    authorizedTarget: true,
    credential: { username: 'antigo-user', password: 'antiga-senha' },
  }, owner.cookie, { method: 'PATCH' });

  const firstStored = await h.store.read(run.id);
  const firstRef = firstStored.targetCredential?.ref;

  // Substitui explicitamente a credencial
  const replaced = await h.request(`/api/runs/${run.id}`, {
    expectedAccessRevision: 1,
    startUrl: `${targetOrigin}/reservas`,
    accessProfile: 'Operador',
    dataPreparation: 'Sem preparo.',
    authorizedTarget: true,
    credential: { username: 'novo-user', password: 'nova-senha-secreta' },
  }, owner.cookie, { method: 'PATCH' });

  assert.equal(replaced.status, 200);
  assert.equal(replaced.body.targetAccess.revision, 2);
  assert.equal(replaced.body.targetAccess.hasCredential, true);

  const secondStored = await h.store.read(run.id);
  assert.notEqual(secondStored.targetCredential?.ref, firstRef);
  assert.equal(secondStored.targetCredential?.username, 'novo-user');
  assert.equal(secondStored.targetCredential?.password, 'nova-senha-secreta');
  assert.equal(secondStored.run.input.credentialRef, secondStored.targetCredential?.ref);
});

test('T8.1 CA-03: isolamento entre contas e proteções HTTP (Origin, Expected-User-Id, Session)', async t => {
  const h = await harness(t);
  const owner = await h.register(0);
  const other = await h.register(1);
  const run = await h.createRun(owner.cookie);

  const payload = {
    expectedAccessRevision: 0,
    startUrl: `${targetOrigin}/reservas`,
    accessProfile: 'Operador',
    dataPreparation: 'Sem preparo.',
    authorizedTarget: true,
    credential: { username: 'user', password: 'password' },
  };

  // Outra conta tenta modificar -> 404 RUN_NOT_FOUND
  const denied = await h.request(`/api/runs/${run.id}`, payload, other.cookie, { method: 'PATCH' });
  assert.equal(denied.status, 404);
  assert.equal(denied.body.error.code, 'RUN_NOT_FOUND');

  // Outra conta tenta consultar -> 404 RUN_NOT_FOUND
  const deniedGet = await h.request(`/api/runs/${run.id}`, undefined, other.cookie);
  assert.equal(deniedGet.status, 404);

  // Sem autenticação -> 401 INVALID_SESSION
  const unauth = await h.request(`/api/runs/${run.id}`, payload, undefined, { method: 'PATCH' });
  assert.equal(unauth.status, 401);

  // Origem rejeitada -> 403 ORIGIN_REJECTED
  const wrongOrigin = await h.request(`/api/runs/${run.id}`, payload, owner.cookie, {
    method: 'PATCH',
    headers: { Origin: 'http://malicious-site.test' },
  });
  assert.equal(wrongOrigin.status, 403);
  assert.equal(wrongOrigin.body.error.code, 'ORIGIN_REJECTED');

  // Sem X-Expected-User-Id válido -> 400 INVALID_EXPECTED_USER_ID
  const wrongExpected = await h.request(`/api/runs/${run.id}`, payload, owner.cookie, {
    method: 'PATCH',
    headers: { 'X-Expected-User-Id': 'not-a-uuid' },
  });
  assert.equal(wrongExpected.status, 400);
  assert.equal(wrongExpected.body.error.code, 'INVALID_EXPECTED_USER_ID');

  // Identidade divergente da sessão -> 409 ACCOUNT_CHANGED
  const divergent = await h.request(`/api/runs/${run.id}`, payload, owner.cookie, {
    method: 'PATCH',
    headers: { 'X-Expected-User-Id': other.user.id },
  });
  assert.equal(divergent.status, 409);
  assert.equal(divergent.body.error.code, 'ACCOUNT_CHANGED');
});

test('T8.1 CA-02: validação e recusa de destino não autorizado, URLs inválidas e campos obrigatórios', async t => {
  const h = await harness(t);
  const owner = await h.register(0);
  const run = await h.createRun(owner.cookie);

  const baseValid = {
    expectedAccessRevision: 0,
    startUrl: `${targetOrigin}/reservas`,
    accessProfile: 'Operador',
    dataPreparation: 'Sem preparo.',
    authorizedTarget: true,
    credential: { username: 'user', password: 'password' },
  };

  // 1. Destino não presente em TARGET_ALLOWED_ORIGINS
  const unauthTarget = await h.request(`/api/runs/${run.id}`, {
    ...baseValid,
    startUrl: 'http://127.0.0.1:9999/reservas',
  }, owner.cookie, { method: 'PATCH' });
  assert.equal(unauthTarget.status, 400);
  assert.equal(unauthTarget.body.error.code, 'TARGET_NOT_ALLOWED');

  // 2. Protocolo diferente de HTTP/HTTPS
  const nonHttp = await h.request(`/api/runs/${run.id}`, {
    ...baseValid,
    startUrl: 'ftp://127.0.0.1:4000/reservas',
  }, owner.cookie, { method: 'PATCH' });
  assert.equal(nonHttp.status, 400);
  assert.equal(nonHttp.body.error.code, 'INVALID_URL');

  // 3. Credencial embutida na URL
  const embeddedCred = await h.request(`/api/runs/${run.id}`, {
    ...baseValid,
    startUrl: 'http://admin:secret@127.0.0.1:4000/reservas',
  }, owner.cookie, { method: 'PATCH' });
  assert.equal(embeddedCred.status, 400);
  assert.equal(embeddedCred.body.error.code, 'INVALID_URL');

  // 4. Query string na URL
  const queryString = await h.request(`/api/runs/${run.id}`, {
    ...baseValid,
    startUrl: `${targetOrigin}/reservas?filter=all`,
  }, owner.cookie, { method: 'PATCH' });
  assert.equal(queryString.status, 400);
  assert.equal(queryString.body.error.code, 'INVALID_URL');

  // 5. Fragmento na URL
  const fragment = await h.request(`/api/runs/${run.id}`, {
    ...baseValid,
    startUrl: `${targetOrigin}/reservas#section`,
  }, owner.cookie, { method: 'PATCH' });
  assert.equal(fragment.status, 400);
  assert.equal(fragment.body.error.code, 'INVALID_URL');

  // 6. Confirmação de autorização ausente ou falsa
  const missingAuth = await h.request(`/api/runs/${run.id}`, {
    ...baseValid,
    authorizedTarget: false,
  }, owner.cookie, { method: 'PATCH' });
  assert.equal(missingAuth.status, 400);
  assert.equal(missingAuth.body.error.code, 'AUTHORIZED_TARGET_REQUIRED');

  // 7. Primeiro cadastro sem credencial
  const noCredInitial = await h.request(`/api/runs/${run.id}`, {
    ...baseValid,
    credential: undefined,
  }, owner.cookie, { method: 'PATCH' });
  assert.equal(noCredInitial.status, 400);
  assert.equal(noCredInitial.body.error.code, 'INVALID_INPUT');

  // 8. Credencial incompleta (sem senha)
  const incompleteCred = await h.request(`/api/runs/${run.id}`, {
    ...baseValid,
    credential: { username: 'operador' },
  }, owner.cookie, { method: 'PATCH' });
  assert.equal(incompleteCred.status, 400);
  assert.equal(incompleteCred.body.error.code, 'INVALID_INPUT');

  // 9. Fornecimento indevido de campos privados (credentialRef, etc.)
  const forbiddenField = await h.request(`/api/runs/${run.id}`, {
    ...baseValid,
    credentialRef: 'fake-ref',
  }, owner.cookie, { method: 'PATCH' });
  assert.equal(forbiddenField.status, 400);
  assert.equal(forbiddenField.body.error.code, 'INVALID_INPUT');

  // 10. Limite de corpo excedido (> 16 KiB)
  const oversized = await h.request(`/api/runs/${run.id}`, {
    ...baseValid,
    dataPreparation: 'a'.repeat(20000),
  }, owner.cookie, { method: 'PATCH' });
  assert.equal(oversized.status, 413);

  // Nenhum dos erros acima alterou o registro
  const check = await h.store.read(run.id);
  assert.equal(check.run.input.accessRevision ?? 0, 0);
  assert.equal(check.run.input.credentialRef, null);
  assert.equal(check.targetCredential, undefined);
});

test('T8.1 CA-05: controle de revisão concorrente e STALE_VERSION', async t => {
  const h = await harness(t);
  const owner = await h.register(0);
  const run = await h.createRun(owner.cookie);

  const payload = {
    expectedAccessRevision: 0,
    startUrl: `${targetOrigin}/reservas`,
    accessProfile: 'Operador',
    dataPreparation: 'Sem preparo.',
    authorizedTarget: true,
    credential: { username: 'user', password: 'password' },
  };

  // Primeira alteração incrementa para 1
  const first = await h.request(`/api/runs/${run.id}`, payload, owner.cookie, { method: 'PATCH' });
  assert.equal(first.status, 200);

  // Tentativa com expectedAccessRevision = 0 agora resulta em conflito 409
  const stale = await h.request(`/api/runs/${run.id}`, payload, owner.cookie, { method: 'PATCH' });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error.code, 'STALE_VERSION');

  // Concorrência simulada: duas chamadas com a mesma revisão 1
  const p1 = h.request(`/api/runs/${run.id}`, {
    ...payload,
    expectedAccessRevision: 1,
    accessProfile: 'Perfil Concorrente A',
  }, owner.cookie, { method: 'PATCH' });

  const p2 = h.request(`/api/runs/${run.id}`, {
    ...payload,
    expectedAccessRevision: 1,
    accessProfile: 'Perfil Concorrente B',
  }, owner.cookie, { method: 'PATCH' });

  const [res1, res2] = await Promise.all([p1, p2]);
  const statuses = [res1.status, res2.status].sort();
  assert.deepEqual(statuses, [200, 409], 'Exatamente uma operação concorrida é aceita e a outra recebe conflito');
});

test('T8.1 CA-06: preservação de plano/casos/aprovações e regra de imutabilidade da URL', async t => {
  const h = await harness(t);
  const owner = await h.register(0);
  const run = await h.createRun(owner.cookie);

  // 1. Configura acesso em rascunho
  const configured = await h.request(`/api/runs/${run.id}`, {
    expectedAccessRevision: 0,
    startUrl: `${targetOrigin}/reservas`,
    accessProfile: 'Operador',
    dataPreparation: 'Sem preparo.',
    authorizedTarget: true,
    credential: { username: 'user', password: 'password' },
  }, owner.cookie, { method: 'PATCH' });
  assert.equal(configured.status, 200);

  // 2. Em rascunho, alterar a URL inicial é permitido
  const updatedUrl = await h.request(`/api/runs/${run.id}`, {
    expectedAccessRevision: 1,
    startUrl: `${targetOrigin}/reservas-novo`,
    accessProfile: 'Operador',
    dataPreparation: 'Sem preparo.',
    authorizedTarget: true,
  }, owner.cookie, { method: 'PATCH' });
  assert.equal(updatedUrl.status, 200);
  assert.equal(updatedUrl.body.targetAccess.startUrl, `${targetOrigin}/reservas-novo`);

  // 3. Simula início da preparação (status: awaiting_approval, phase: planning)
  await h.store.update(run.id, record => {
    record.run.status = 'awaiting_approval';
    record.run.phase = 'planning';
    return { value: null, save: true };
  });

  const snapshotBefore = await h.store.read(run.id);

  // 4. Após o início, trocar a URL é RECUSADO com TARGET_IMMUTABLE
  const changeTargetDenied = await h.request(`/api/runs/${run.id}`, {
    expectedAccessRevision: 2,
    startUrl: `${targetOrigin}/outro-alvo`,
    accessProfile: 'Operador',
    dataPreparation: 'Sem preparo.',
    authorizedTarget: true,
  }, owner.cookie, { method: 'PATCH' });
  assert.equal(changeTargetDenied.status, 409);
  assert.equal(changeTargetDenied.body.error.code, 'TARGET_IMMUTABLE');

  // 5. Manter a mesma URL e alterar outros campos é PERMITIDO
  const sameUrlUpdate = await h.request(`/api/runs/${run.id}`, {
    expectedAccessRevision: 2,
    startUrl: `${targetOrigin}/reservas-novo`,
    accessProfile: 'Operador Atualizado',
    dataPreparation: 'Nova preparação.',
    authorizedTarget: true,
  }, owner.cookie, { method: 'PATCH' });
  assert.equal(sameUrlUpdate.status, 200);
  assert.equal(sameUrlUpdate.body.targetAccess.revision, 3);
  assert.equal(sameUrlUpdate.body.targetAccess.accessProfile, 'Operador Atualizado');

  // 6. Confere que artefatos, saídas, aprovações, fase e status não foram tocados
  const snapshotAfter = await h.store.read(run.id);
  assert.equal(snapshotAfter.run.status, snapshotBefore.run.status);
  assert.equal(snapshotAfter.run.phase, snapshotBefore.run.phase);
  assert.deepEqual(snapshotAfter.run.artifacts, snapshotBefore.run.artifacts);
  assert.deepEqual(snapshotAfter.run.outputs, snapshotBefore.run.outputs);
  assert.deepEqual(snapshotAfter.run.approvals, snapshotBefore.run.approvals);

  // 7. Durante processamento (status: running), alterações são RECUSADAS
  await h.store.update(run.id, record => {
    record.run.status = 'running';
    return { value: null, save: true };
  });
  const runningDenied = await h.request(`/api/runs/${run.id}`, {
    expectedAccessRevision: 3,
    startUrl: `${targetOrigin}/reservas-novo`,
    accessProfile: 'Operador',
    dataPreparation: 'Preparo.',
    authorizedTarget: true,
  }, owner.cookie, { method: 'PATCH' });
  assert.equal(runningDenied.status, 409);
  assert.equal(runningDenied.body.error.code, 'INVALID_STATE');

  // 8. Após início do mapeamento (phase: mapping), alterações são RECUSADAS
  await h.store.update(run.id, record => {
    record.run.status = 'awaiting_approval';
    record.run.phase = 'mapping';
    return { value: null, save: true };
  });
  const mappingDenied = await h.request(`/api/runs/${run.id}`, {
    expectedAccessRevision: 3,
    startUrl: `${targetOrigin}/reservas-novo`,
    accessProfile: 'Operador',
    dataPreparation: 'Preparo.',
    authorizedTarget: true,
  }, owner.cookie, { method: 'PATCH' });
  assert.equal(mappingDenied.status, 409);
  assert.equal(mappingDenied.body.error.code, 'INVALID_STATE');

  // 9. Em execução encerrada (status: completed / cancelled), alterações são RECUSADAS
  await h.store.update(run.id, record => {
    record.run.status = 'completed';
    record.run.phase = 'report';
    return { value: null, save: true };
  });
  const completedDenied = await h.request(`/api/runs/${run.id}`, {
    expectedAccessRevision: 3,
    startUrl: `${targetOrigin}/reservas-novo`,
    accessProfile: 'Operador',
    dataPreparation: 'Preparo.',
    authorizedTarget: true,
  }, owner.cookie, { method: 'PATCH' });
  assert.equal(completedDenied.status, 409);
  assert.equal(completedDenied.body.error.code, 'INVALID_STATE');
});

test('T8.1 CA-08: compatibilidade com registros legados sem campos de acesso', async t => {
  const h = await harness(t);
  const owner = await h.register(0);

  // Registro antigo sem accessRevision, sem targetCredential e com startUrl null
  const legacyRun: RunRecord = {
    id: 'legacy-run-1',
    ownerId: owner.user.id,
    name: 'Execução legada',
    applicationName: 'Alvo',
    createdAt: new Date().toISOString(),
    status: 'draft',
    phase: 'intake',
    input: {
      startUrl: null,
      credentialRef: null,
      accessProfile: null,
      dataPreparation: null,
      authorizedTarget: false,
      objective: '',
      artifactIds: [],
    },
    artifacts: [],
    outputs: [],
    validations: [],
    approvals: [],
    questions: [],
    answers: [],
    budgetCycles: [],
    validationPolicy: { maxValidationRevisions: 3, maxValidatorAttempts: 2, timeoutMs: 120000 },
  };

  await h.store.create(legacyRun);

  // Leitura via API expõe targetAccess padrão sem quebrar
  const review = await h.request('/api/runs/legacy-run-1', undefined, owner.cookie);
  assert.equal(review.status, 200);
  assert.deepEqual(review.body.targetAccess, {
    revision: 0,
    startUrl: null,
    accessProfile: null,
    dataPreparation: null,
    authorizedTarget: false,
    hasCredential: false,
    canEdit: true,
  });

  // Atualização do registro legado a partir da revisão 0 funciona perfeitamente
  const configured = await h.request('/api/runs/legacy-run-1', {
    expectedAccessRevision: 0,
    startUrl: `${targetOrigin}/legado`,
    accessProfile: 'Operador legado',
    dataPreparation: 'Iniciar com preparo.',
    authorizedTarget: true,
    credential: { username: 'legado-user', password: 'legado-password' },
  }, owner.cookie, { method: 'PATCH' });

  assert.equal(configured.status, 200);
  assert.equal(configured.body.targetAccess.revision, 1);
  assert.equal(configured.body.targetAccess.hasCredential, true);
  assert.equal(configured.body.targetAccess.startUrl, `${targetOrigin}/legado`);
});
