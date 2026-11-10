import { createServer, request as httpRequest } from 'node:http';
import { createConnection } from 'node:net';
import { resolveTarget, TargetPolicyError, validateTargetUrl } from './target-policy.mjs';

/** A session-owned forward proxy. Chromium never resolves the destination itself:
 * every outgoing connection uses an IP checked immediately before connecting.
 * TLS remains end-to-end between Chromium and the original server (CONNECT).
 */
export async function createTargetProxy({ trustedOrigins = [], lookup, onBlocked } = {}) {
  const sockets = new Set();
  let closed = false;
  let closing;
  function track(socket) {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    // Individual handlers below report failures; cleanup must never throw.
    socket.on('error', () => {});
    socket.setTimeout(30000, () => socket.destroy());
    return socket;
  }
  function reportBlocked(value) {
    try { onBlocked?.(new URL(value).origin); } catch { /* no user URL/query in logs */ }
  }
  async function destination(value) {
    try {
      const url = validateTargetUrl(value, trustedOrigins);
      const resolved = await resolveTarget(url, trustedOrigins, lookup);
      if (closed) throw new Error('PROXY_CLOSED');
      return { url, ...resolved, port: Number(url.port || (url.protocol === 'https:' ? 443 : 80)) };
    } catch (error) {
      if (error instanceof TargetPolicyError) reportBlocked(value);
      throw error;
    }
  }
  function statusOf(error) { return error instanceof TargetPolicyError ? 403 : 502; }
  function failResponse(response, error) {
    if (response.destroyed) return;
    if (response.headersSent) return response.destroy();
    const status = statusOf(error);
    response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
    response.end(status === 403 ? 'Destino de rede não permitido.' : 'Não foi possível acessar a aplicação.');
  }
  function failSocket(socket, error) {
    if (socket.destroyed) return;
    const status = statusOf(error);
    socket.end(`HTTP/1.1 ${status} ${status === 403 ? 'Forbidden' : 'Bad Gateway'}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  }
  function forwardHeaders(headers, host, upgrade = false) {
    const filtered = Object.fromEntries(Object.entries(headers).filter(([name]) =>
      !['proxy-authorization', 'proxy-authenticate', 'proxy-connection', 'host'].includes(name.toLowerCase())));
    return { ...filtered, host, ...(upgrade ? {} : { connection: 'close' }) };
  }

  const server = createServer({ requestTimeout: 30000, headersTimeout: 10000 }, (request, response) => {
    void (async () => {
      const target = await destination(request.url);
      if (request.destroyed || response.destroyed) return;
      if (target.url.protocol !== 'http:') {
        // HTTPS requests must use CONNECT, so Node never becomes a TLS client.
        throw new TargetPolicyError('INVALID_URL', 'HTTPS exige túnel CONNECT.');
      }
      const outgoing = httpRequest({
        hostname: target.address, family: target.family, port: target.port,
        method: request.method, path: target.url.pathname + target.url.search,
        headers: forwardHeaders(request.headers, target.url.host), agent: false,
      }, incoming => {
        if (response.destroyed) return incoming.destroy();
        const headers = { ...incoming.headers };
        delete headers['proxy-authenticate'];
        response.writeHead(incoming.statusCode ?? 502, headers);
        incoming.on('error', () => response.destroy());
        incoming.pipe(response);
      });
      outgoing.on('socket', track);
      outgoing.on('error', error => failResponse(response, error));
      outgoing.setTimeout(30000, () => outgoing.destroy(new Error('TARGET_TIMEOUT')));
      request.on('aborted', () => outgoing.destroy());
      response.on('close', () => { if (!response.writableFinished) outgoing.destroy(); });
      request.pipe(outgoing);
    })().catch(error => failResponse(response, error));
  });
  server.maxConnections = 128;
  server.on('connection', track);
  server.on('clientError', (_error, socket) => socket.destroy());
  server.on('connect', (request, client, head) => {
    void (async () => {
      if (!request.url || /[/?#]/.test(request.url)) throw new TargetPolicyError('INVALID_URL', 'CONNECT inválido.');
      const target = await destination('https://' + request.url);
      if (client.destroyed) return;
      const outgoing = track(createConnection({ host: target.address, family: target.family, port: target.port }));
      let connected = false;
      outgoing.on('connect', () => {
        connected = true;
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length) outgoing.write(head);
        client.pipe(outgoing);
        outgoing.pipe(client);
      });
      outgoing.on('error', error => connected ? client.destroy() : failSocket(client, error));
      outgoing.on('close', () => client.destroy());
      client.on('close', () => outgoing.destroy());
    })().catch(error => failSocket(client, error));
  });
  server.on('upgrade', (request, client, head) => {
    void (async () => {
      if (request.method !== 'GET' || request.headers.upgrade?.toLowerCase() !== 'websocket') {
        throw new TargetPolicyError('INVALID_URL', 'Upgrade não permitido.');
      }
      const url = new URL(request.url);
      if (url.protocol === 'ws:') url.protocol = 'http:';
      const target = await destination(url.href);
      if (target.url.protocol !== 'http:') throw new TargetPolicyError('INVALID_URL', 'Upgrade inválido.');
      if (client.destroyed) return;
      const outgoing = track(createConnection({ host: target.address, family: target.family, port: target.port }));
      let connected = false;
      outgoing.on('connect', () => {
        connected = true;
        const headers = forwardHeaders(request.headers, target.url.host, true);
        let prelude = `GET ${target.url.pathname}${target.url.search} HTTP/1.1\r\n`;
        for (const [name, value] of Object.entries(headers)) {
          if (value !== undefined) prelude += `${name}: ${Array.isArray(value) ? value.join(', ') : value}\r\n`;
        }
        outgoing.write(prelude + '\r\n');
        if (head.length) outgoing.write(head);
        client.pipe(outgoing);
        outgoing.pipe(client);
      });
      outgoing.on('error', error => connected ? client.destroy() : failSocket(client, error));
      outgoing.on('close', () => client.destroy());
      client.on('close', () => outgoing.destroy());
    })().catch(error => failSocket(client, error));
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
  });
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}`,
    close() {
      if (closing) return closing;
      closed = true;
      closing = new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
        for (const socket of sockets) socket.destroy();
      });
      return closing;
    },
  };
}
