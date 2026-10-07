import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ArtifactInputError, extractArtifacts, MAX_FILE_BYTES, pdfPages, readMultipart } from '../src/application/artifacts.js';
import { createRun, duplicateRun } from '../src/application/runs.js';
import { RunStore } from '../src/storage/runs.js';
import { AuthService } from '../src/auth.js';
import { readConfig } from '../src/config.js';

test('upload preserves sources, original/extraction IDs, retry and secret-free duplication', async t => {
  const root = await mkdtemp(join(tmpdir(), 'akcit-artifacts-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new RunStore(root); await store.initialize();
  const input = { name: 'Arquivos', applicationName: 'Reservas', text: 'CA-01: Aceitar de 1 a 10.' };
  const files = [{ name: 'regra.md', type: 'text/markdown', data: Buffer.from('CA-02: Comentário opcional.\n') }];
  const context = { userId: randomUUID() }; const keys = [randomUUID()];
  const first = await createRun(store, input, keys, context, files);
  const run = (await store.read(first.run.id)).run;
  assert.equal(run.artifacts.length, 2);
  assert.notEqual(run.artifacts[0]!.id, run.artifacts[1]!.id);
  const file = run.artifacts[1]!;
  assert.notEqual(file.id, file.originalId);
  assert.equal(await readFile(join(root, 'artifacts', run.id, `${file.originalId}.original`), 'utf8'), files[0]!.data.toString());
  assert.equal(await readFile(join(root, 'artifacts', run.id, `${file.id}.txt`), 'utf8'), file.text);
  assert.equal((await createRun(store, input, keys, context, files)).created, false);
  assert.equal((await readdir(join(root, 'artifacts', run.id))).length, 2, 'retry cleans only newly created unused files');
  await store.update(run.id, record => {
    record.run.input = { ...record.run.input, credentialRef: 'secret-reference', authorizedTarget: true,
      startUrl: 'https://example.test', accessProfile: 'Operador', dataPreparation: 'Pela interface' };
    return { value: null, save: true };
  });
  const copy = await duplicateRun(store, run.id, { artifactIds: [file.id] }, [randomUUID()], context);
  const duplicated = (await store.read(copy.run.id)).run;
  assert.equal(duplicated.artifacts.length, 1);
  assert.notEqual(duplicated.artifacts[0]!.id, file.id);
  assert.notEqual(duplicated.artifacts[0]!.originalId, file.originalId);
  assert.equal(duplicated.artifacts[0]!.text, file.text);
  assert.equal(duplicated.input.credentialRef, null);
  assert.equal(duplicated.input.authorizedTarget, false);
  assert.equal(duplicated.input.startUrl, 'https://example.test');
  assert.deepEqual(duplicated.outputs, []);
  assert.deepEqual(duplicated.approvals, []);
  await assert.rejects(duplicateRun(store, run.id, { artifactIds: [file.id] }, [randomUUID()], { userId: randomUUID() }), { code: 'RUN_NOT_FOUND' });
});

test('uncertain record persistence never removes referenced uploaded originals', async t => {
  const root = await mkdtemp(join(tmpdir(), 'akcit-artifact-retry-')); t.after(() => rm(root, { recursive: true, force: true }));
  const store = new RunStore(root); await store.initialize();
  const original = store.createIdempotent.bind(store);
  const failure = t.mock.method(store, 'createIdempotent', async run => { await original(run); throw new Error('response lost after persistence'); });
  const body = { name: 'Arquivo', applicationName: 'Reservas' }, keys = [randomUUID()], context = { userId: randomUUID() };
  const files = [{ name: 'fonte.txt', type: '', data: Buffer.from('CA: Aceitar um item.') }];
  await assert.rejects(createRun(store, body, keys, context, files)); failure.mock.restore();
  const result = await createRun(store, body, keys, context, files); assert.equal(result.created, false);
  const run = (await store.read(result.run.id)).run;
  assert.equal(await readFile(join(root, 'artifacts', run.id, `${run.artifacts[0]!.originalId}.original`), 'utf8'), files[0]!.data.toString());
  assert.equal((await readdir(join(root, 'artifacts', run.id))).length, 2);
});

test('invalid upload formats, content and limits are rejected without extraction', async () => {
  for (const file of [
    { name: '../private.txt', type: 'text/plain', data: Buffer.from('a') },
    { name: 'requirements.exe', type: 'text/plain', data: Buffer.from('a') },
    { name: 'requirements.txt', type: 'text/plain', data: Buffer.from([0xff]) },
    { name: 'requirements.txt', type: 'text/plain', data: Buffer.from([0]) },
    { name: 'requirements.pdf', type: 'application/pdf', data: Buffer.from('not a PDF') },
    { name: 'requirements.txt', type: 'text/plain', data: Buffer.alloc(MAX_FILE_BYTES + 1, 'x') },
  ]) await assert.rejects(extractArtifacts([file]), ArtifactInputError);
  await assert.rejects(extractArtifacts(Array.from({ length: 6 }, () => ({ name: 'a.txt', type: '', data: Buffer.from('a') }))), { code: 'FILE_LIMIT' });
});

test('PDF extraction keeps page-to-line correspondence without merging page text', () => {
  const extracted = pdfPages('Primeira\nlinha\n\fSegunda página\n\f');
  assert.equal(extracted.text, 'Primeira\nlinha\n\nSegunda página\n');
  assert.deepEqual(extracted.pages, [{ page: 1, firstLine: 1, lastLine: 3 }, { page: 2, firstLine: 4, lastLine: 5 }]);
});

test('multipart streaming validates fields and rejects oversized file before full body', async t => {
  let bytesRead = 0;
  const server = createServer(async (request, response) => {
    request.on('data', chunk => { bytesRead += chunk.length; });
    try { const result = await readMultipart(request); response.end(JSON.stringify({ ...result, files: result.files.map(file => ({ ...file, data: file.data.toString() })) })); }
    catch (error) { response.statusCode = error instanceof ArtifactInputError ? error.status : 500; response.end(JSON.stringify({ code: (error as ArtifactInputError).code })); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.close(); server.closeAllConnections(); await once(server, 'close'); });
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}`;
  const form = new FormData(); form.set('name', 'Execução'); form.append('files', new Blob(['fonte 1']), 'a.md'); form.append('files', new Blob(['fonte 2']), 'b.txt');
  const valid = await fetch(url, { method: 'POST', body: form });
  assert.equal(valid.status, 200);
  assert.deepEqual((await valid.json()).files.map((file: any) => file.data), ['fonte 1', 'fonte 2']);
  bytesRead = 0;
  const boundary = 'test-boundary';
  async function* oversized() {
    yield Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="large.txt"\r\n\r\n`);
    for (let i = 0; i < 300; i++) { yield Buffer.alloc(64 * 1024, 'a'); await new Promise(resolve => setTimeout(resolve, 1)); }
    yield Buffer.from(`\r\n--${boundary}--\r\n`);
  }
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    body: oversized() as any, duplex: 'half' } as RequestInit);
  assert.equal(response.status, 413);
  assert.ok(bytesRead < 12 * 1024 * 1024, 'refuses during transmission, not after reading all 19 MiB');
});

test('profile updates only editable fields and every session of same account', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'akcit-profile-')); t.after(() => rm(dataDir, { recursive: true, force: true }));
  const auth = new AuthService(readConfig({ DATA_DIR: dataDir, APP_ORIGIN: 'http://localhost:3000' }));
  t.after(() => auth.close());
  const input = { name: 'Original', email: 'one@example.test', password: 'Senha fictícia longa para teste 1!', teamName: 'Antiga' };
  const first = await auth.register(input, '127.0.0.1'); const second = await auth.login(input, '127.0.0.1');
  const updated = await auth.updateProfile(first.user.id, { name: 'Atualizado', teamName: '' });
  assert.equal(updated.name, 'Atualizado'); assert.equal(updated.teamName, undefined); assert.equal(updated.email, input.email);
  assert.equal(auth.authenticate(auth.cookie(second.token)).user.name, updated.name);
  await assert.rejects(auth.updateProfile(first.user.id, { name: 'Novo', email: 'intruder@example.test' }), { code: 'INVALID_INPUT' });
  await assert.rejects(auth.updateProfile(randomUUID(), { name: 'Novo' }), { code: 'INVALID_SESSION' });
});

test('HTTP: authenticated upload, profile, duplicate, owner-only media and retryable complete deletion', async t => {
  const { createApp } = await import('../src/app.js');
  const fs = (await import('node:fs/promises')).default;
  const root = await mkdtemp(join(tmpdir(), 'akcit-upload-api-'));
  const origin = 'http://localhost:3000';
  const server = await createApp(readConfig({ DATA_DIR: root, APP_ORIGIN: origin }));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string'); const base = `http://127.0.0.1:${address.port}`;
  t.after(async () => { server.close(); server.closeAllConnections(); await once(server, 'close'); await rm(root, { recursive: true, force: true }); });
  const register = async (email: string) => {
    const response = await fetch(`${base}/api/auth/register`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Pessoa', email, password: 'Senha fictícia de testes 1!' }) });
    assert.equal(response.status, 201); const data = await response.json(); return { cookie: response.headers.get('set-cookie')!.split(';')[0]!, id: data.user.id };
  };
  const owner = await register('one@example.test'), other = await register('two@example.test');
  const headers = (user = owner) => ({ Origin: origin, Cookie: user.cookie, 'X-Expected-User-Id': user.id });
  const json = (method: string, body: unknown, user = owner): RequestInit => ({ method, headers: { ...headers(user), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const form = new FormData(); form.set('name', 'Duas fontes'); form.set('applicationName', 'Reservas'); form.append('files', new Blob(['US-01: Reservar.']), 'historia.md'); form.append('files', new Blob(['CA-01: Aceitar 1.']), 'criterio.txt');
  const sent = await fetch(`${base}/api/runs`, { method: 'POST', headers: { ...headers(), 'Idempotency-Key': randomUUID() }, body: form });
  assert.equal(sent.status, 201, await sent.clone().text()); const run = await sent.json();
  const review = await fetch(`${base}/api/runs/${run.id}`, { headers: headers() });
  assert.equal(review.status, 200); const received = await review.json(); assert.equal(received.artifacts.length, 2);
  assert.ok(!JSON.stringify(received).includes(root));
  const profile = await fetch(`${base}/api/auth/me`, json('PATCH', { name: 'Pessoa atualizada', teamName: 'Equipe QA' }));
  assert.equal(profile.status, 200); assert.equal((await profile.json()).user.teamName, 'Equipe QA');
  const wrongProfile = await fetch(`${base}/api/auth/me`, { ...json('PATCH', { name: 'Outra pessoa' }, other), headers: { ...headers(other), 'Content-Type': 'application/json', 'X-Expected-User-Id': owner.id } });
  assert.equal(wrongProfile.status, 409);
  const store = new RunStore(root); const assetId = randomUUID();
  await fs.mkdir(join(root, 'media', run.id), { recursive: true });
  await fs.writeFile(join(root, 'media', run.id, `${assetId}.png`), Buffer.from('synthetic-image'));
  await store.update(run.id, record => {
    record.run.observations = [{ id: 'observation-1', assetId, at: new Date().toISOString(), width: 1, height: 1 }];
    return { value: null, save: true };
  });
  assert.equal((await fetch(`${base}/api/runs/${run.id}/evidence/${assetId}`, { headers: headers() })).status, 200);
  for (const path of [`/api/runs/${run.id}`, `/api/runs/${run.id}/evidence/${assetId}`]) assert.equal((await fetch(base + path, { headers: headers(other) })).status, 404);
  const duplicate = await fetch(`${base}/api/runs/${run.id}/duplicate`, { ...json('POST', { artifactIds: [received.artifacts[0].id] }), headers: { ...headers(), 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() } });
  assert.equal(duplicate.status, 201); const copy = await duplicate.json(); assert.notEqual(copy.id, run.id);
  assert.equal((await fetch(`${base}/api/runs/${run.id}`, json('DELETE', { confirmed: true }))).status, 409);
  assert.equal((await fetch(`${base}/api/runs/${run.id}`, json('DELETE', { confirmed: true }, other))).status, 404);
  await store.update(run.id, record => { record.run.status = 'cancelled'; return { value: null, save: true }; });
  assert.equal((await fetch(`${base}/api/runs/${run.id}`, json('DELETE', { confirmed: false }))).status, 400);
  const originalRm = fs.rm.bind(fs); let failOnce = true;
  const mocked = t.mock.method(fs, 'rm', async (...args: Parameters<typeof fs.rm>) => {
    if (failOnce && String(args[0]) === join(root, 'media', run.id)) { failOnce = false; throw Object.assign(new Error('simulated removal error'), { code: 'EACCES' }); }
    return originalRm(...args);
  });
  const interrupted = await fetch(`${base}/api/runs/${run.id}`, json('DELETE', { confirmed: true }));
  assert.equal(interrupted.status, 503); assert.equal((await store.read(run.id)).run.ownerId, owner.id);
  mocked.mock.restore();
  assert.equal((await fetch(`${base}/api/runs/${run.id}`, json('DELETE', { confirmed: true }))).status, 204);
  for (const path of [join(root, 'runs', `${run.id}.json`), join(root, 'artifacts', run.id), join(root, 'media', run.id)]) await assert.rejects(fs.stat(path), { code: 'ENOENT' });
  assert.equal((await fetch(`${base}/api/runs/${run.id}`, { headers: headers() })).status, 404);
  assert.equal((await store.read(copy.id)).run.artifacts.length, 1);
});
