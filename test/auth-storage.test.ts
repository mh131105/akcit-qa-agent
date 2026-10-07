import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';
import { AuthService } from '../src/auth.js';
import { createApp } from '../src/app.js';
import { readConfig } from '../src/config.js';
import { RunStore, type RunRecord } from '../src/storage/runs.js';

const input = { name: 'Conta nova', email: 'new@example.test', password: 'Senha123!' };
const unavailable = { name: 'AuthError', code: 'AUTH_STORAGE_UNAVAILABLE', status: 503 };

async function fixture(t: TestContext) {
  const dataDir = await fs.mkdtemp(join(tmpdir(), 'akcit-accounts-'));
  const config = readConfig({ DATA_DIR: dataDir, APP_ORIGIN: 'http://localhost:3000' });
  const auth = new AuthService(config);
  t.after(async () => { auth.close(); await fs.rm(dataDir, { recursive: true, force: true }); });
  return { dataDir, config, auth, directory: join(dataDir, 'auth'), file: join(dataDir, 'auth/users.sqlite') };
}

test('SQLite guarda perfil, UUID e Argon2; fechar a conexão invalida sessões sem recriar o banco', async t => {
  const h = await fixture(t);
  await h.auth.initialize();
  const { user, token } = await h.auth.register(input, 'test');
  const second = await h.auth.login(input, 'test');
  const changed = await h.auth.updateProfile(user.id, { name: 'Nome atualizado', teamName: 'Equipe' });
  assert.deepEqual(h.auth.authenticate(h.auth.cookie(token)).user, changed);
  assert.deepEqual(h.auth.authenticate(h.auth.cookie(second.token)).user, changed);
  assert.deepEqual(await h.auth.updateProfile(user.id, { name: 'Nome atualizado' }), changed);
  const withoutTeam = await h.auth.updateProfile(user.id, { name: 'Nome atualizado', teamName: '' });
  assert.ok(!Object.hasOwn(withoutTeam, 'teamName'));
  assert.equal((await fs.stat(h.directory)).mode & 0o777, 0o700);
  assert.equal((await fs.stat(h.file)).mode & 0o777, 0o600);
  h.auth.close();
  assert.throws(() => h.auth.authenticate(h.auth.cookie(token)), { code: 'INVALID_SESSION' });
  await assert.rejects(h.auth.login(input, 'test'), unavailable);
  const restarted = new AuthService(h.config);
  try {
    await restarted.initialize();
    assert.deepEqual((await restarted.login(input, 'test')).user, withoutTeam);
  } finally { restarted.close(); }
});

test('Contas JSON antigas exigem arquivamento explícito e não são importadas nem apagadas', async t => {
  const h = await fixture(t);
  await fs.mkdir(h.directory);
  const legacy = join(h.directory, 'users.json');
  await fs.writeFile(legacy, '{"schemaVersion":1,"users":[]}');
  const example = JSON.parse(await fs.readFile(new URL('../docs/requisitos/exemplos/execucao-demo.json', import.meta.url), 'utf8')) as { run: RunRecord };
  const store = new RunStore(h.dataDir); await store.initialize();
  await store.create({ ...example.run, id: 'run-legacy', status: 'running' });
  const runFile = join(h.dataDir, 'runs/run-legacy.json');
  const originalRun = await fs.readFile(runFile);
  await assert.rejects(createApp(h.config), unavailable);
  assert.deepEqual(await fs.readFile(runFile), originalRun, 'A falha de autenticação não altera execuções antigas antes do arquivamento.');
  assert.equal(await fs.readFile(legacy, 'utf8'), '{"schemaVersion":1,"users":[]}');
  await assert.rejects(fs.stat(h.file), { code: 'ENOENT' });
});

test('SQLite corrompido, truncado ou sem versão não é substituído por contas vazias', async t => {
  for (const kind of ['corrupt', 'truncated', 'unversioned', 'future-version']) {
    await t.test(kind, async t => {
      const h = await fixture(t);
      await fs.mkdir(h.directory);
      if (kind === 'corrupt' || kind === 'truncated') await fs.writeFile(h.file, kind === 'corrupt' ? 'invalid sqlite bytes' : '');
      else {
        const database = new DatabaseSync(h.file);
        database.exec(`CREATE TABLE preserved (value TEXT); INSERT INTO preserved VALUES ('keep');${kind === 'future-version' ? ' PRAGMA user_version=2;' : ''}`);
        database.close();
      }
      const original = await fs.readFile(h.file);
      await assert.rejects(createApp(h.config), unavailable);
      assert.deepEqual(await fs.readFile(h.file), original);
    });
  }
});

test('Links simbólicos de contas ou diretório são recusados sem alterar o destino', async t => {
  for (const kind of ['file', 'directory']) {
    await t.test(kind, async t => {
      const h = await fixture(t);
      const target = join(h.dataDir, 'private-target');
      if (kind === 'file') {
        await fs.mkdir(h.directory);
        await fs.writeFile(target, 'preserve', { mode: 0o644 });
        await fs.symlink(target, h.file);
      } else {
        await fs.mkdir(target, { mode: 0o755 });
        await fs.symlink(target, h.directory);
      }
      const mode = (await fs.stat(target)).mode;
      await assert.rejects(h.auth.initialize(), unavailable);
      assert.equal((await fs.stat(target)).mode, mode);
      if (kind === 'file') assert.equal(await fs.readFile(target, 'utf8'), 'preserve');
      else assert.deepEqual(await fs.readdir(target), []);
    });
  }
});

test('Parâmetros ou hash adulterados são recusados antes da derivação, sem modificar a conta', async t => {
  const h = await fixture(t);
  await h.auth.register(input, 'test');
  const database = new DatabaseSync(h.file);
  t.after(() => database.close());
  const original = JSON.parse(database.prepare('SELECT password_hash FROM users').get()!.password_hash as string);
  for (const change of [{ algorithm: 'scrypt' }, { version: 20 }, { memory: 2 ** 30 }, { hash: '00' }, { salt: '00' }]) {
    const value = JSON.stringify({ ...original, ...change });
    database.prepare('UPDATE users SET password_hash = ?').run(value);
    await assert.rejects(h.auth.login(input, 'test'), unavailable);
    assert.equal(database.prepare('SELECT password_hash FROM users').get()!.password_hash, value);
  }
});
