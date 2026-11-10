import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, request, type IncomingMessage, type ServerResponse } from 'node:http';
import { createConnection, createServer as createTcpServer, type Socket } from 'node:net';
import test, { type TestContext } from 'node:test';
import {
  assertTargetUrl, isPublicAddress, resolveTarget, TargetPolicyError, validateTargetUrl,
  type TargetLookup,
} from '../agents/test-executor/tools/target-policy.mjs';
import { createTargetProxy } from '../agents/test-executor/tools/target-proxy.mjs';

test('public targets: IPv4/IPv6 globais são aceitos; redes internas, especiais e metadata são bloqueadas', () => {
  for (const address of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111', '2001:4860:4860::8888']) {
    assert.equal(isPublicAddress(address), true, address);
  }
  for (const address of [
    '0.0.0.0', '10.1.2.3', '100.100.100.200', '127.0.0.1', '169.254.169.254',
    '168.63.129.16', '172.16.0.1', '172.31.255.255', '192.168.1.1', '192.0.0.9',
    '192.0.2.1', '192.88.99.1', '198.18.0.1', '198.51.100.1', '203.0.113.1',
    '224.0.0.1', '255.255.255.255', '::', '::1', 'fd00::1', 'fe80::1', 'ff02::1',
    '::ffff:127.0.0.1', '::ffff:8.8.8.8', '64:ff9b::a00:1', '2001:db8::1',
    '2001::1', '2002:7f00:1::', '3fff::1', 'not-an-address',
  ]) assert.equal(isPublicAddress(address), false, address);
});

test('public targets: normalização de URL não permite IPs locais codificados', () => {
  for (const url of [
    'http://127.1/', 'http://2130706433/', 'http://0x7f000001/', 'http://0177.0.0.1/',
    'http://[::ffff:7f00:1]/', 'https://localhost./', 'https://service.local/',
    'https://metadata.google.internal/', 'http://home.arpa/', 'http://service.home.arpa/',
    'http://server/', 'http://192.168.1.1.nip.io/',
  ]) {
    // Domain aliases are resolved in the asynchronous check below.
    if (url.includes('nip.io')) continue;
    assert.throws(() => validateTargetUrl(url), TargetPolicyError, url);
  }
  for (const url of ['file:///etc/passwd', 'ftp://example.com', 'https://user:password@example.com']) {
    assert.throws(() => validateTargetUrl(url), (error: unknown) =>
      error instanceof TargetPolicyError && error.code === 'INVALID_URL');
  }
  assert.equal(validateTargetUrl('https://app.example.com/settings?tab=one#/profile').href,
    'https://app.example.com/settings?tab=one#/profile');
});

test('public targets: domínio novo resolve sem whitelist; qualquer resposta DNS não pública rejeita o destino', async () => {
  const publicLookup: TargetLookup = async (hostname, options) => {
    assert.equal(hostname, 'new-customer.example.com');
    assert.deepEqual(options, { all: true, verbatim: true });
    return [{ address: '93.184.216.34', family: 4 }, { address: '2606:4700:4700::1111', family: 6 }];
  };
  assert.equal((await assertTargetUrl('https://new-customer.example.com/app', [], publicLookup)).origin,
    'https://new-customer.example.com');
  for (const answers of [
    [{ address: '127.0.0.1', family: 4 }],
    [{ address: '8.8.8.8', family: 4 }, { address: '169.254.169.254', family: 4 }],
    [{ address: '8.8.8.8', family: 4 }, { address: 'fd00::1', family: 6 }],
    [{ address: '8.8.8.8', family: 6 }],
    [],
  ]) {
    await assert.rejects(assertTargetUrl('https://alias.example.com', [], async () => answers),
      (error: unknown) => error instanceof TargetPolicyError && error.code === 'TARGET_NOT_ALLOWED');
  }
  await assert.rejects(assertTargetUrl('https://lookup-failure.example.com', [], async () => { throw new Error('ENOTFOUND'); }), TargetPolicyError);
});

test('public targets: DNS é revalidado por conexão e o endereço aprovado é retornado para pinning', async () => {
  let calls = 0;
  const lookup: TargetLookup = async () => (++calls === 1
    ? [{ address: '93.184.216.34', family: 4 }]
    : [{ address: '127.0.0.1', family: 4 }]);
  assert.deepEqual(await resolveTarget(new URL('https://rebind.example.com'), [], lookup),
    { address: '93.184.216.34', family: 4 });
  await assert.rejects(resolveTarget(new URL('https://rebind.example.com'), [], lookup), TargetPolicyError);
  assert.equal(calls, 2);
});

test('public targets: prefere IPv4 público com AAAA primeiro sem ignorar respostas privadas', async () => {
  const url = new URL('https://dual-stack.example.com');
  assert.deepEqual(await resolveTarget(url, [], async () => [
    { address: '2606:4700:4700::1111', family: 6 }, { address: '93.184.216.34', family: 4 },
  ]), { address: '93.184.216.34', family: 4 });
  assert.deepEqual(await resolveTarget(url, [], async () => [
    { address: '2606:4700:4700::1111', family: 6 },
  ]), { address: '2606:4700:4700::1111', family: 6 });
  await assert.rejects(resolveTarget(url, [], async () => [
    { address: 'fd00::1', family: 6 }, { address: '93.184.216.34', family: 4 },
  ]), TargetPolicyError);
});

test('public targets: exceções privadas de fixture exigem origem exata e não viram curinga', async () => {
  const trusted = ['http://127.0.0.1:4000', 'https://fixture.example.test'];
  assert.equal((await assertTargetUrl('http://127.0.0.1:4000/app?tab=1', trusted)).hostname, '127.0.0.1');
  await assertTargetUrl('https://fixture.example.test', trusted, async () => { throw new Error('not called'); });
  await assert.rejects(assertTargetUrl('http://127.0.0.1:4001', trusted), TargetPolicyError);
  await assert.rejects(assertTargetUrl('https://127.0.0.1:4000', trusted), TargetPolicyError);
});

async function fixture(t: TestContext, handler: (request: IncomingMessage, response: ServerResponse) => void) {
  const server = createServer(handler);
  const sockets = new Set<Socket>();
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  t.after(async () => { for (const socket of sockets) socket.destroy(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  return { server, origin: `http://127.0.0.1:${address.port}` };
}

function throughProxy(proxy: string, destination: string, body = '') {
  return new Promise<{ status: number; body: string; location?: string }>((resolve, reject) => {
    const outgoing = request(proxy, {
      method: body ? 'POST' : 'GET', path: destination,
      headers: { 'proxy-authorization': 'must-not-reach-the-target', ...(body ? { 'content-length': Buffer.byteLength(body) } : {}) },
    }, response => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { text += chunk; });
      response.on('end', () => resolve({ status: response.statusCode!, body: text,
        ...(response.headers.location ? { location: response.headers.location } : {}) }));
    });
    outgoing.on('error', reject);
    outgoing.end(body);
  });
}

test('target proxy: repassa método/corpo/Host e retira credencial do proxy; bloqueia outro loopback após redirect', async t => {
  let internalHits = 0;
  const internal = await fixture(t, (_request, response) => { internalHits++; response.end('private'); });
  const target = await fixture(t, (request, response) => {
    assert.equal(request.headers['proxy-authorization'], undefined);
    if (request.url === '/redirect') {
      response.writeHead(302, { location: internal.origin + '/secret' }); response.end(); return;
    }
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => response.end(JSON.stringify({ method: request.method, path: request.url, host: request.headers.host, body })));
  });
  const blocked: string[] = [];
  const proxy = await createTargetProxy({ trustedOrigins: [target.origin], onBlocked: origin => blocked.push(origin) });
  t.after(() => proxy.close());
  const result = await throughProxy(proxy.url, target.origin + '/submit?q=one#not-forwarded', 'hello');
  assert.equal(result.status, 200);
  assert.deepEqual(JSON.parse(result.body), { method: 'POST', path: '/submit?q=one', host: new URL(target.origin).host, body: 'hello' });
  const redirected = await throughProxy(proxy.url, target.origin + '/redirect');
  assert.equal(redirected.status, 302);
  assert.equal((await throughProxy(proxy.url, redirected.location!)).status, 403);
  assert.equal(internalHits, 0);
  assert.deepEqual(blocked, [internal.origin]);
});

test('target proxy: DNS misto/mutável não estabelece conexão com destino interno', async t => {
  let internalHits = 0;
  const internal = await fixture(t, (_request, response) => { internalHits++; response.end('private'); });
  let calls = 0;
  const proxy = await createTargetProxy({ lookup: async () => {
    calls++;
    return calls === 1
      ? [{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }]
      : [{ address: '127.0.0.1', family: 4 }];
  } });
  t.after(() => proxy.close());
  const target = `http://rebind.example.com:${new URL(internal.origin).port}`;
  assert.equal((await throughProxy(proxy.url, target)).status, 403);
  assert.equal((await throughProxy(proxy.url, target)).status, 403);
  assert.equal(calls, 2);
  assert.equal(internalHits, 0);
});

test('target proxy: conexão usa IP aprovado sem segunda resolução do nome', async t => {
  const target = await fixture(t, (request, response) => response.end(request.headers.host));
  const targetUrl = new URL(target.origin);
  const alias = `http://does-not-exist.example.test:${targetUrl.port}`;
  let calls = 0;
  const proxy = await createTargetProxy({ trustedOrigins: [alias], lookup: async hostname => {
    calls++;
    assert.equal(hostname, 'does-not-exist.example.test');
    return [{ address: '127.0.0.1', family: 4 }];
  } });
  t.after(() => proxy.close());
  const result = await throughProxy(proxy.url, alias + '/');
  assert.equal(result.status, 200);
  assert.equal(result.body, new URL(alias).host);
  assert.equal(calls, 1);
});

function proxySocket(proxy: string) {
  const address = new URL(proxy);
  return createConnection({ host: address.hostname, port: Number(address.port) });
}

async function readUntil(socket: Socket, marker: Buffer) {
  let bytes = Buffer.alloc(0);
  for await (const chunk of socket) {
    bytes = Buffer.concat([bytes, chunk]);
    if (bytes.includes(marker)) return bytes;
  }
  return bytes;
}

test('target proxy: CONNECT mantém túnel opaco e recusa túnel para metadata', async t => {
  const sockets = new Set<Socket>();
  const echo = createTcpServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket));
    socket.on('data', bytes => socket.write(bytes));
  });
  echo.listen(0, '127.0.0.1');
  await once(echo, 'listening');
  const address = echo.address();
  assert.ok(address && typeof address !== 'string');
  t.after(async () => { for (const socket of sockets) socket.destroy(); await new Promise<void>(resolve => echo.close(() => resolve())); });
  const proxy = await createTargetProxy({ trustedOrigins: [`https://127.0.0.1:${address.port}`] });
  t.after(() => proxy.close());
  const socket = proxySocket(proxy.url);
  const marker = Buffer.from([0x16, 0x03, 0x03, 0x00, 0x03, 0xaa, 0xbb, 0xcc]);
  socket.write(`CONNECT 127.0.0.1:${address.port} HTTP/1.1\r\nHost: 127.0.0.1:${address.port}\r\n\r\n`);
  socket.write(marker);
  const bytes = await readUntil(socket, marker);
  assert.match(bytes.toString('latin1'), /^HTTP\/1.1 200 Connection Established/);
  assert.ok(bytes.subarray(bytes.indexOf('\r\n\r\n') + 4).equals(marker));
  const blocked = proxySocket(proxy.url);
  blocked.write('CONNECT 169.254.169.254:443 HTTP/1.1\r\nHost: 169.254.169.254:443\r\n\r\n');
  const response = await readUntil(blocked, Buffer.from('\r\n\r\n'));
  assert.match(response.toString(), /^HTTP\/1.1 403 Forbidden/);
  await proxy.close();
  await proxy.close();
});

test('target proxy: WebSocket upgrade conserva caminho, Host e dados sem liberar rede privada', async t => {
  const target = await fixture(t, (_request, response) => response.end());
  target.server.on('upgrade', (request, socket, head) => {
    assert.equal(request.url, '/live?room=1');
    assert.equal(request.headers.host, new URL(target.origin).host);
    assert.equal(request.headers['proxy-authorization'], undefined);
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
    if (head.length) socket.write(head);
    socket.on('data', bytes => socket.write(bytes));
  });
  const proxy = await createTargetProxy({ trustedOrigins: [target.origin] });
  t.after(() => proxy.close());
  const socket = proxySocket(proxy.url);
  const marker = Buffer.from('websocket-opaque-payload');
  socket.write(`GET ${target.origin.replace('http:', 'ws:')}/live?room=1 HTTP/1.1\r\nHost: ${new URL(target.origin).host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nProxy-Authorization: secret\r\n\r\n`);
  socket.write(marker);
  const bytes = await readUntil(socket, marker);
  assert.match(bytes.toString(), /^HTTP\/1.1 101 Switching Protocols/);
  assert.ok(bytes.subarray(bytes.indexOf('\r\n\r\n') + 4).equals(marker));
});

test('target proxy: CONNECT de WebSocket aceita somente host/porta da fixture HTTP explícita', async t => {
  let otherHits = 0;
  const other = await fixture(t, (_request, response) => { otherHits++; response.end('private'); });
  const target = await fixture(t, (_request, response) => response.end());
  target.server.on('upgrade', (_request, socket, head) => {
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
    if (head.length) socket.write(head);
    socket.on('data', bytes => socket.write(bytes));
  });
  const proxy = await createTargetProxy({ trustedOrigins: [target.origin] });
  t.after(() => proxy.close());
  const authority = new URL(target.origin).host;
  const socket = proxySocket(proxy.url);
  const marker = Buffer.from('plain-websocket-through-connect');
  socket.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`);
  // Chromium sends the plain WebSocket handshake after CONNECT. Sending it
  // eagerly also verifies that already-buffered CONNECT bytes are preserved.
  socket.write(`GET /live HTTP/1.1\r\nHost: ${authority}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n`);
  socket.write(marker);
  const bytes = await readUntil(socket, marker);
  assert.match(bytes.toString(), /^HTTP\/1.1 200 Connection Established/);
  assert.ok(bytes.includes(Buffer.from('HTTP/1.1 101 Switching Protocols')));
  assert.ok(bytes.includes(marker));
  const blocked = proxySocket(proxy.url);
  const otherAuthority = new URL(other.origin).host;
  blocked.write(`CONNECT ${otherAuthority} HTTP/1.1\r\nHost: ${otherAuthority}\r\n\r\n`);
  assert.match((await readUntil(blocked, Buffer.from('\r\n\r\n'))).toString(), /^HTTP\/1.1 403 Forbidden/);
  assert.equal(otherHits, 0);
  // With no explicit fixture exception, the same CONNECT remains forbidden.
  const publicProxy = await createTargetProxy();
  t.after(() => publicProxy.close());
  const denied = proxySocket(publicProxy.url);
  denied.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`);
  assert.match((await readUntil(denied, Buffer.from('\r\n\r\n'))).toString(), /^HTTP\/1.1 403 Forbidden/);
});
