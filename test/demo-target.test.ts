import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createDemoTarget } from '../scripts/demo-target.mjs';

// --- Helpers -------------------------------------------------------------- //

/** Start server on random port, return base URL and cleanup. */
async function startTarget(mode = 'reference') {
  const { server, sessions, reservations } = createDemoTarget({
    port: 0,
    user: 'testuser',
    password: 'testpass',
    mode,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const addr = server.address();
  const base = `http://127.0.0.1:${addr.port}`;
  return {
    base,
    sessions,
    reservations,
    async close() {
      server.close();
      await once(server, 'close');
    },
  };
}

/** Login and return cookie string. */
async function login(base, user = 'testuser', password = 'testpass') {
  const res = await fetch(`${base}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `user=${encodeURIComponent(user)}&password=${encodeURIComponent(password)}`,
    redirect: 'manual',
  });
  assert.equal(res.status, 302, 'Login should redirect');
  const cookie = res.headers.get('set-cookie');
  assert.ok(cookie, 'Should set session cookie');
  return cookie.split(';')[0]; // "sid=..."
}

/** Fetch with cookie, following redirects manually for form POST. */
async function authedFetch(base, path, cookie, opts = {}) {
  return fetch(`${base}${path}`, {
    ...opts,
    headers: { ...opts.headers, Cookie: cookie },
    redirect: opts.redirect ?? 'follow',
  });
}

/** Submit reservation form. */
async function createReservation(base, cookie, qty, comment = '') {
  return authedFetch(base, '/reservas/nova', cookie, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
    body: `qty=${encodeURIComponent(qty)}&comment=${encodeURIComponent(comment)}`,
  });
}

// --- Tests ---------------------------------------------------------------- //

test('login com credenciais corretas redireciona para início', async () => {
  const t = await startTarget();
  try {
    const res = await fetch(`${t.base}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'user=testuser&password=testpass',
      redirect: 'manual',
    });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/');
    assert.ok(res.headers.get('set-cookie'));
  } finally { await t.close(); }
});

test('login com credenciais incorretas mostra erro', async () => {
  const t = await startTarget();
  try {
    const res = await fetch(`${t.base}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'user=wrong&password=wrong',
      redirect: 'manual',
    });
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes('Credenciais inválidas'));
  } finally { await t.close(); }
});

test('páginas internas exigem sessão', async () => {
  const t = await startTarget();
  try {
    for (const path of ['/', '/reservas', '/reservas/nova']) {
      const res = await fetch(`${t.base}${path}`, { redirect: 'manual' });
      assert.equal(res.status, 302, `${path} should redirect without session`);
      assert.equal(res.headers.get('location'), '/login');
    }
  } finally { await t.close(); }
});

test('modo reference: quantidades válidas 1, 2, 9, 10 criam reserva', async () => {
  const t = await startTarget('reference');
  try {
    const cookie = await login(t.base);
    for (const qty of [1, 2, 9, 10]) {
      const res = await createReservation(t.base, cookie, String(qty));
      const html = await res.text();
      assert.ok(html.includes('Reserva criada'), `qty=${qty} should succeed in reference mode`);
    }
    assert.equal(t.reservations.length, 4);
  } finally { await t.close(); }
});

test('modo reference: quantidades inválidas 0, 11, 1.5, vazio são rejeitadas', async () => {
  const t = await startTarget('reference');
  try {
    const cookie = await login(t.base);
    for (const qty of ['0', '11', '1.5', '']) {
      const res = await createReservation(t.base, cookie, qty);
      const html = await res.text();
      assert.ok(html.includes('Quantidade inválida'), `qty="${qty}" should be rejected`);
    }
    assert.equal(t.reservations.length, 0, 'No reservations should be created');
  } finally { await t.close(); }
});

test('modo known-defect: quantidades 1, 2, 9 criam reserva', async () => {
  const t = await startTarget('known-defect');
  try {
    const cookie = await login(t.base);
    for (const qty of [1, 2, 9]) {
      const res = await createReservation(t.base, cookie, String(qty));
      const html = await res.text();
      assert.ok(html.includes('Reserva criada'), `qty=${qty} should succeed in known-defect`);
    }
    assert.equal(t.reservations.length, 3);
  } finally { await t.close(); }
});

test('modo known-defect: quantidade 10 é rejeitada (defeito conhecido)', async () => {
  const t = await startTarget('known-defect');
  try {
    const cookie = await login(t.base);
    const res = await createReservation(t.base, cookie, '10');
    const html = await res.text();
    assert.ok(html.includes('Quantidade inválida'), 'qty=10 should be rejected in known-defect');
    assert.equal(t.reservations.length, 0);
  } finally { await t.close(); }
});

test('modo known-defect: quantidades inválidas 0, 11, 1.5, vazio são rejeitadas', async () => {
  const t = await startTarget('known-defect');
  try {
    const cookie = await login(t.base);
    for (const qty of ['0', '11', '1.5', '']) {
      const res = await createReservation(t.base, cookie, qty);
      const html = await res.text();
      assert.ok(html.includes('Quantidade inválida'), `qty="${qty}" should be rejected in known-defect`);
    }
    assert.equal(t.reservations.length, 0);
  } finally { await t.close(); }
});

test('comentário vazio: reserva criada sem comentário', async () => {
  const t = await startTarget();
  try {
    const cookie = await login(t.base);
    const res = await createReservation(t.base, cookie, '5', '');
    const html = await res.text();
    assert.ok(html.includes('Reserva criada'));
    assert.equal(t.reservations[0].comment, '');
  } finally { await t.close(); }
});

test('comentário preenchido: preservado na reserva', async () => {
  const t = await startTarget();
  try {
    const cookie = await login(t.base);
    const comment = 'Reserva de teste com observação <script>alert(1)</script>';
    const res = await createReservation(t.base, cookie, '3', comment);
    const html = await res.text();
    assert.ok(html.includes('Reserva criada'));
    assert.equal(t.reservations[0].comment, comment, 'Comment should be preserved as-is');
    // XSS check: rendered as text, not executed
    assert.ok(!html.includes('<script>alert(1)</script>'), 'Comment must be escaped in HTML');
    assert.ok(html.includes('&lt;script&gt;'));
  } finally { await t.close(); }
});

test('comentário preenchido: preservado no modo known-defect', async () => {
  const t = await startTarget('known-defect');
  try {
    const cookie = await login(t.base);
    const res = await createReservation(t.base, cookie, '5', 'Nota especial');
    const html = await res.text();
    assert.ok(html.includes('Reserva criada'));
    assert.equal(t.reservations[0].comment, 'Nota especial');
  } finally { await t.close(); }
});

test('reset: reiniciar o servidor limpa sessões e reservas', async () => {
  const t = await startTarget();
  try {
    const cookie = await login(t.base);
    await createReservation(t.base, cookie, '5');
    assert.equal(t.reservations.length, 1);
    assert.equal(t.sessions.size, 1);
  } finally { await t.close(); }

  // Start a new instance — state is fresh
  const t2 = await startTarget();
  try {
    assert.equal(t2.reservations.length, 0, 'Reservations should be empty after restart');
    assert.equal(t2.sessions.size, 0, 'Sessions should be empty after restart');
    // Old cookie should not work
    const res = await fetch(`${t2.base}/`, { redirect: 'manual' });
    assert.equal(res.status, 302, 'Should redirect to login without valid session');
  } finally { await t2.close(); }
});

test('reserva consultável na lista após criação', async () => {
  const t = await startTarget();
  try {
    const cookie = await login(t.base);
    await createReservation(t.base, cookie, '7', 'Meu comentário');
    const res = await authedFetch(t.base, '/reservas', cookie);
    const html = await res.text();
    assert.ok(html.includes('7'), 'Qty should appear in the list');
    assert.ok(html.includes('Meu comentário'), 'Comment should appear in the list');
  } finally { await t.close(); }
});
