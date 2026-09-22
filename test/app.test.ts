import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createApp } from '../src/app.js';
import { readConfig } from '../src/config.js';

test('healthcheck identifica o ambiente e nunca devolve credenciais', async () => {
  const data = await mkdtemp(join(tmpdir(), 'akcit-test-'));
  const app = await createApp(readConfig({ APP_ENV: 'development', PORT: '0', DATA_DIR: data, OPENAI_API_KEY: 'secret-test-value' }));
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  try {
    const address = app.address();
    assert.ok(address && typeof address !== 'string');
    const url = `http://127.0.0.1:${address.port}`;
    const result = await fetch(`${url}/healthz`);
    assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), { status: 'ok', environment: 'development', revision: 'local', stage: 'environment-ready' });
    assert.equal((await fetch(`${url}/.env`)).status, 404);
    assert.equal((await fetch(`${url}/healthz`, { method: 'POST' })).status, 405);
  } finally {
    app.close();
    await once(app, 'close');
    await rm(data, { recursive: true });
  }
});

test('configuração recusa ambiente desconhecido', () => {
  assert.throws(() => readConfig({ APP_ENV: 'typo' }), /APP_ENV/);
});
