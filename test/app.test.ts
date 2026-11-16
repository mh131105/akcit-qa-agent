import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
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

test('páginas e arquivos locais usam lista explícita, cabeçalhos seguros e caminhos relativos ao módulo', async () => {
  const data = await mkdtemp(join(tmpdir(), 'akcit-web-test-'));
  const app = await createApp(readConfig({
    APP_ENV: 'development', PORT: '0', DATA_DIR: data,
    APP_ORIGIN: 'http://127.0.0.1',
  }));
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  const previousDirectory = process.cwd();
  try {
    const address = app.address();
    assert.ok(address && typeof address !== 'string');
    const url = `http://127.0.0.1:${address.port}`;
    const html = await readFile(new URL('../src/web/index.html', import.meta.url), 'utf8');
    // A localização dos arquivos não depende do diretório de execução do comando.
    process.chdir(data);
    const home = await fetch(url, { redirect: 'manual' });
    assert.equal(home.status, 200);
    assert.equal(home.headers.get('location'), null);
    assert.equal(home.headers.get('set-cookie'), null);
    const landingHtml = await home.text();
    assert.match(landingHtml, /Testes funcionais,/);
    assert.match(landingHtml, /href="\/execucoes"/);
    assert.match(landingHtml, /src="\/landing\/assets\/qatron-showcase\.mp4"/);
    assert.doesNotMatch(landingHtml, /(?:href|src)="(?:styles\.css|script\.js|assets\/)|\bstyle=/);
    assert.doesNotMatch(landingHtml, /<script\b(?![^>]*\bsrc=)/i);
    const landingPolicy = home.headers.get('content-security-policy') ?? '';
    for (const directive of ["media-src 'self'", "style-src 'self' https://fonts.googleapis.com", 'font-src https://fonts.gstatic.com']) {
      assert.ok(landingPolicy.split('; ').includes(directive), directive);
    }
    assert.doesNotMatch(landingPolicy, /unsafe-inline|unsafe-eval/);
    const homeHead = await fetch(url, { method: 'HEAD' });
    assert.equal(homeHead.status, 200);
    assert.equal(homeHead.headers.get('content-length'), home.headers.get('content-length'));
    assert.equal(await homeHead.text(), '');
    for (const [path, mime] of [
      ['styles.css', 'text/css; charset=utf-8'], ['script.js', 'text/javascript; charset=utf-8'], ['qatron-mark.png', 'image/png'],
      ['assets/ordenacao-crescente.png', 'image/png'], ['assets/ordenacao-decrescente.png', 'image/png'],
      ['assets/ordenacao-relatorio-final.jpg', 'image/jpeg'], ['assets/relatorio-final.txt', 'text/plain; charset=utf-8'],
      ['assets/qatron-poster.jpg', 'image/jpeg'],
    ]) {
      const asset = await fetch(`${url}/landing/${path}`);
      assert.equal(asset.status, 200, path);
      assert.equal(asset.headers.get('content-type'), mime);
      assert.deepEqual(Buffer.from(await asset.arrayBuffer()), await readFile(new URL(`../src/web/landing/${path}`, import.meta.url)));
    }
    const video = await readFile(new URL('../src/web/landing/assets/qatron-showcase.mp4', import.meta.url));
    const videoUrl = `${url}/landing/assets/qatron-showcase.mp4`;
    const videoHead = await fetch(videoUrl, { method: 'HEAD', headers: { Range: 'bytes=0-1' } });
    assert.equal(videoHead.status, 200);
    assert.equal(videoHead.headers.get('accept-ranges'), 'bytes');
    assert.equal(videoHead.headers.get('content-type'), 'video/mp4');
    assert.equal(videoHead.headers.get('content-length'), String(video.length));
    assert.equal(await videoHead.text(), '');
    for (const [range, start, end] of [
      ['bytes=0-1', 0, 1], ['bytes=512-1023', 512, 1023], ['bytes=-32', video.length - 32, video.length - 1],
      [`bytes=${video.length - 8}-`, video.length - 8, video.length - 1],
      [`bytes=${video.length - 8}-${video.length + 50}`, video.length - 8, video.length - 1],
    ] as const) {
      const partial = await fetch(videoUrl, { headers: { Range: range } });
      assert.equal(partial.status, 206, range);
      assert.equal(partial.headers.get('content-type'), 'video/mp4');
      assert.equal(partial.headers.get('content-range'), `bytes ${start}-${end}/${video.length}`);
      assert.equal(partial.headers.get('content-length'), String(end - start + 1));
      assert.deepEqual(Buffer.from(await partial.arrayBuffer()), video.subarray(start, end + 1));
    }
    for (const range of [`bytes=${video.length}-`, 'bytes=10-1', 'bytes=-0']) {
      const unavailable = await fetch(videoUrl, { headers: { Range: range } });
      assert.equal(unavailable.status, 416, range);
      assert.equal(unavailable.headers.get('content-range'), `bytes */${video.length}`);
      assert.equal(await unavailable.text(), '');
    }
    const completeVideo = await fetch(videoUrl);
    assert.equal(completeVideo.status, 200);
    assert.deepEqual(Buffer.from(await completeVideo.arrayBuffer()), video);
    for (const path of ['/acesso', '/acesso?returnTo=%2Fexecucoes%2Fnova', '/execucoes', '/execucoes/nova', '/execucoes/run-demo-001']) {
      const result = await fetch(`${url}${path}`);
      assert.equal(result.status, 200, path);
      assert.equal(result.headers.get('content-type'), 'text/html; charset=utf-8');
      assert.equal(result.headers.get('cache-control'), 'no-store');
      assert.equal(result.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(result.headers.get('referrer-policy'), 'same-origin');
      const policy = result.headers.get('content-security-policy') ?? '';
      for (const directive of ["default-src 'none'", "script-src 'self'", "style-src 'self'", "connect-src 'self'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'"]) {
        assert.ok(policy.split('; ').includes(directive), directive);
      }
      assert.doesNotMatch(policy, /unsafe-inline|unsafe-eval/);
      assert.doesNotMatch(policy, /fonts\.googleapis\.com|fonts\.gstatic\.com|media-src/);
      assert.equal(await result.text(), html);
    }
    assert.match(html, /lang=["']pt(?:-BR)?["']/);
    assert.match(html, /href=["']\/web\/styles\.css["']/);
    assert.match(html, /src=["']\/web\/app\.js["']/);
    assert.doesNotMatch(html, /<script\b(?![^>]*\bsrc=)/i);
    for (const [path, mime] of [['styles.css', 'text/css; charset=utf-8'], ['app.js', 'text/javascript; charset=utf-8'], ['qatron-mark.png', 'image/png']]) {
      const result = await fetch(`${url}/web/${path}`);
      assert.equal(result.status, 200);
      assert.equal(result.headers.get('content-type'), mime);
      assert.equal(result.headers.get('cache-control'), 'no-store');
      assert.equal(result.headers.get('x-content-type-options'), 'nosniff');
      assert.deepEqual(Buffer.from(await result.arrayBuffer()), await readFile(new URL(`../src/web/${path}`, import.meta.url)));
      const head = await fetch(`${url}/web/${path}`, { method: 'HEAD' });
      assert.equal(head.status, 200);
      assert.equal(head.headers.get('content-type'), mime);
      assert.equal(head.headers.get('content-length'), result.headers.get('content-length'));
      assert.equal(await head.text(), '');
    }
    const head = await fetch(`${url}/execucoes/run-demo-001`, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
    for (const path of ['/.env', '/package.json', '/web/index.html', '/src/web/index.html', '/web/app.js.map', '/web/app.js/extra', '/web/qatron-mark.png/extra', '/execucoes/demo/extra', '/execucoes/', '/desconhecido', '/landing/index.html', '/landing/assets/relatorio-parcial.txt', '/landing/assets/qatron-showcase.mp4/extra', '/landing/%2e%2e%2f.env']) {
      const result = await fetch(`${url}${path}`);
      assert.equal(result.status, 404, path);
      assert.deepEqual(await result.json(), { error: 'not-found' });
    }
    const post = await fetch(`${url}/execucoes/nova`, { method: 'POST' });
    assert.equal(post.status, 405);
    assert.equal(post.headers.get('allow'), 'GET, HEAD');
    const api = await fetch(`${url}/api/auth/me`);
    assert.equal(api.status, 401);
    assert.equal(api.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await api.json(), { error: { code: 'INVALID_SESSION', message: 'Sessão ausente, inválida ou expirada.' } });
    assert.equal((await fetch(`${url}/api/unknown`)).status, 404);
    assert.equal((await fetch(`${url}/healthz`)).status, 200);
  } finally {
    process.chdir(previousDirectory);
    app.close();
    await once(app, 'close');
    await rm(data, { recursive: true });
  }
});
