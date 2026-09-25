// T7 — Smoke: jornada completa pelo navegador real com Playwright.
// Usa playwright-core já instalado. Sem chamada de modelo.
// ponytail: single-file smoke, reuses demo-target.mjs, no extra deps.

import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { createDemoTarget } from './demo-target.mjs';

assert.equal(Number(process.versions.node.split('.')[0]), 24, 'Execute com Node.js 24.');

const artifactDir = process.env.SMOKE_ARTIFACT_DIR;
const started = Date.now();
const checked = [];
let browser;
let server;

try {
  // --- Start target in reference mode ---
  const ref = createDemoTarget({ port: 0, user: 'demo', password: 'demo1234', mode: 'reference' });
  server = ref.server;
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    headless: false,
    args: ['--no-sandbox', '--window-position=0,0', '--window-size=1366,768', '--force-device-scale-factor=1'],
  });
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await context.newPage();

  // 1. Login incorreto
  await page.goto(`${baseUrl}/login`);
  await page.fill('input[name="user"]', 'wrong');
  await page.fill('input[name="password"]', 'wrong');
  await page.click('button[type="submit"]');
  await page.waitForSelector('.msg-error');
  assert.ok((await page.textContent('.msg-error')).includes('Credenciais inválidas'));
  checked.push('login-incorreto');

  // 2. Acesso direto a página protegida redireciona
  await page.goto(`${baseUrl}/reservas`);
  assert.ok(page.url().includes('/login'), 'Deveria redirecionar para login');
  checked.push('acesso-direto-protegido');

  // 3. Login correto
  await page.fill('input[name="user"]', 'demo');
  await page.fill('input[name="password"]', 'demo1234');
  await page.click('button[type="submit"]');
  await page.waitForURL(`${baseUrl}/`);
  checked.push('login-correto');

  // Captura após login
  if (artifactDir) {
    await mkdir(artifactDir, { recursive: true });
    await page.screenshot({ path: `${artifactDir}/target-home.png` });
  }

  // 4. Navegar para Reservas
  await page.click('a[href="/reservas"]');
  await page.waitForSelector('h1');
  assert.ok((await page.textContent('h1')).includes('Reservas'));
  assert.ok((await page.textContent('body')).includes('Nenhuma reserva encontrada'));
  checked.push('navegacao-reservas');

  // 5. Nova reserva — quantidade válida com comentário
  await page.click('a[href="/reservas/nova"]');
  await page.waitForSelector('h1');
  assert.ok((await page.textContent('h1')).includes('Nova reserva'));
  await page.fill('input[name="qty"]', '5');
  await page.fill('textarea[name="comment"]', 'Comentário de teste');
  await page.click('button[type="submit"]');
  await page.waitForSelector('.msg-success');
  assert.ok((await page.textContent('.msg-success')).includes('Reserva criada'));
  checked.push('nova-reserva-valida');

  // 6. Reserva consultável na lista
  assert.ok((await page.textContent('body')).includes('5'));
  assert.ok((await page.textContent('body')).includes('Comentário de teste'));
  checked.push('reserva-na-lista');

  // 7. Comentário preservado ao recarregar
  await page.reload();
  assert.ok((await page.textContent('body')).includes('Comentário de teste'));
  checked.push('comentario-preservado-reload');

  // 8. Quantidade inválida
  await page.click('a[href="/reservas/nova"]');
  await page.fill('input[name="qty"]', '0');
  await page.click('button[type="submit"]');
  await page.waitForSelector('.msg-error');
  assert.ok((await page.textContent('.msg-error')).includes('Quantidade inválida'));
  checked.push('quantidade-invalida');

  // 9. Ausência de reserva após rejeição (still only 1 reservation)
  const bodyAfterReject = await page.textContent('body');
  const countAfterReject = (bodyAfterReject.match(/Comentário de teste/g) || []).length;
  assert.equal(countAfterReject, 1, 'Deve ter apenas 1 reserva (nenhuma nova após rejeição)');
  checked.push('sem-reserva-apos-rejeicao');

  // 10. Percurso completo por links e formulários
  await page.click('a[href="/reservas/nova"]');
  await page.fill('input[name="qty"]', '10');
  await page.click('button[type="submit"]');
  await page.waitForSelector('.msg-success');
  assert.ok((await page.textContent('.msg-success')).includes('Reserva criada'));
  checked.push('percurso-completo-reference');

  // --- Close reference, start known-defect ---
  await browser.close();
  browser = null;
  server.close();
  await once(server, 'close');

  const def = createDemoTarget({ port: 0, user: 'demo', password: 'demo1234', mode: 'known-defect' });
  server = def.server;
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const defUrl = `http://127.0.0.1:${server.address().port}`;

  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    headless: false,
    args: ['--no-sandbox', '--window-position=0,0', '--window-size=1366,768', '--force-device-scale-factor=1'],
  });
  const defContext = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const defPage = await defContext.newPage();

  // Login
  await defPage.goto(`${defUrl}/login`);
  await defPage.fill('input[name="user"]', 'demo');
  await defPage.fill('input[name="password"]', 'demo1234');
  await defPage.click('button[type="submit"]');
  await defPage.waitForURL(`${defUrl}/`);

  // 11. Defeito: quantidade 10 rejeitada
  await defPage.click('a[href="/reservas"]');
  await defPage.click('a[href="/reservas/nova"]');
  await defPage.fill('input[name="qty"]', '10');
  await defPage.click('button[type="submit"]');
  await defPage.waitForSelector('.msg-error');
  assert.ok((await defPage.textContent('.msg-error')).includes('Quantidade inválida'));
  assert.equal(def.reservations.length, 0, 'Qty 10 should be rejected in known-defect');
  checked.push('defeito-conhecido-qty10');

  // 12. Quantidade 9 aceita no modo known-defect
  await defPage.click('a[href="/reservas/nova"]');
  await defPage.fill('input[name="qty"]', '9');
  await defPage.click('button[type="submit"]');
  await defPage.waitForSelector('.msg-success');
  assert.ok((await defPage.textContent('.msg-success')).includes('Reserva criada'));
  checked.push('known-defect-qty9-aceita');

  // --- Reset test ---
  await browser.close();
  browser = null;
  server.close();
  await once(server, 'close');

  // 13. Reset: novo servidor, lista vazia, sessão inválida
  const reset = createDemoTarget({ port: 0, user: 'demo', password: 'demo1234', mode: 'reference' });
  server = reset.server;
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const resetUrl = `http://127.0.0.1:${server.address().port}`;
  assert.equal(reset.reservations.length, 0, 'Reset should clear reservations');
  assert.equal(reset.sessions.size, 0, 'Reset should clear sessions');

  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    headless: false,
    args: ['--no-sandbox', '--window-position=0,0', '--window-size=1366,768', '--force-device-scale-factor=1'],
  });
  const resetContext = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const resetPage = await resetContext.newPage();
  await resetPage.goto(`${resetUrl}/reservas`);
  assert.ok(resetPage.url().includes('/login'), 'Old session should not work after reset');
  checked.push('reset-sessao-invalida');

  // Login and confirm empty list
  await resetPage.fill('input[name="user"]', 'demo');
  await resetPage.fill('input[name="password"]', 'demo1234');
  await resetPage.click('button[type="submit"]');
  await resetPage.waitForURL(`${resetUrl}/`);
  await resetPage.click('a[href="/reservas"]');
  assert.ok((await resetPage.textContent('body')).includes('Nenhuma reserva encontrada'));
  checked.push('reset-lista-vazia');

  // --- Result ---
  const result = {
    status: 'passed',
    checked,
    durationMs: Date.now() - started,
  };
  console.log(JSON.stringify(result, null, 2));
  if (artifactDir) {
    await writeFile(`${artifactDir}/target-result.json`, JSON.stringify(result, null, 2));
    await resetPage.screenshot({ path: `${artifactDir}/target-reset.png` });
  }
} finally {
  if (browser) await browser.close();
  if (server?.listening) {
    server.close();
    await once(server, 'close');
  }
}
