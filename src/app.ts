import { createServer } from 'node:http';
import { access, mkdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import type { readConfig } from './config.js';

export async function createApp(config: ReturnType<typeof readConfig>) {
  await mkdir(config.dataDir, { recursive: true });
  return createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    if (request.url === '/healthz') {
      try {
        await access(config.dataDir, constants.R_OK | constants.W_OK);
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ status: 'ok', environment: config.environment, revision: config.revision, stage: 'environment-ready' }));
      } catch {
        response.writeHead(503, { 'Content-Type': 'application/json' }).end('{"status":"storage-unavailable"}');
      }
      return;
    }
    if (request.url === '/') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'" });
      response.end(`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AKCIT QA · Ambiente preparado</title><style>body{font:18px/1.6 system-ui,sans-serif;max-width:680px;margin:12vh auto;padding:24px;color:#152b2b;background:#f5f7f5}small{color:#38675d}h1{line-height:1.15}a{color:#1d6854}</style><small>AKCIT QA · ${config.environment}</small><h1>Ambiente preparado para desenvolvimento.</h1><p>A infraestrutura está ativa. A próxima etapa é definir os requisitos e implementar o fluxo de testes com o orquestrador e os especialistas.</p><p><a href="/healthz">Consultar estado do ambiente</a></p></html>`);
      return;
    }
    response.writeHead(404, { 'Content-Type': 'application/json' }).end('{"error":"not-found"}');
  });
}
