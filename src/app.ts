import { createServer } from 'node:http';
import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import type { readConfig } from './config.js';
import { RunStore } from './storage/runs.js';
import { AuthService } from './auth.js';
import { PreparationCoordinator, type PreparationOptions } from './application/prepare-plan.js';
import { handleApi } from './http/api.js';

const pages = new Set(['/perfil', '/acesso', '/execucoes', '/execucoes/nova']);
// src/app.ts e dist/app.js têm o mesmo diretório pai; o runtime inclui src/web.
const webFiles = new Map([
  ['/web/styles.css', { url: new URL('../src/web/styles.css', import.meta.url), type: 'text/css; charset=utf-8' }],
  ['/web/app.js', { url: new URL('../src/web/app.js', import.meta.url), type: 'text/javascript; charset=utf-8' }],
]);
const indexFile = new URL('../src/web/index.html', import.meta.url);
// blob: apenas para exibir capturas buscadas com a autenticação existente; URLs revogadas ao sair.
const contentSecurityPolicy = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' blob:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

export async function createApp(config: ReturnType<typeof readConfig>, options: Pick<PreparationOptions, 'modelCall' | 'modelPreflight' | 'visualCall' | 'visualPreflight'> & { now?: () => number } = {}) {
  const runs = new RunStore(config.dataDir);
  await runs.initialize();
  await runs.recoverInterrupted();
  const auth = new AuthService(config, options.now);
  const preparation = new PreparationCoordinator(runs, config, options);
  const server = createServer(async (request, response) => {
    try {
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.setHeader('Content-Security-Policy', contentSecurityPolicy);
      response.setHeader('Referrer-Policy', 'same-origin');
      if (request.url === '/api' || request.url?.startsWith('/api/')) {
        await handleApi(request, response, runs, auth, config, preparation);
        return;
      }
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
      const path = new URL(request.url ?? '/', 'http://localhost').pathname;
      if (path === '/') {
        response.writeHead(302, { Location: '/execucoes' }).end();
        return;
      }
      const page = pages.has(path) || /^\/execucoes\/[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(path);
      const file = page ? { url: indexFile, type: 'text/html; charset=utf-8' } : webFiles.get(path);
      if (file) {
        const content = await readFile(file.url);
        response.writeHead(200, { 'Content-Type': file.type, 'Content-Length': content.length });
        response.end(request.method === 'HEAD' ? undefined : content);
        return;
      }
      response.writeHead(404, { 'Content-Type': 'application/json' }).end('{"error":"not-found"}');
    } catch {
      if (!response.headersSent) response.writeHead(503, { 'Content-Type': 'application/json' });
      response.end('{"error":{"code":"STORAGE_FAILURE","message":"Não foi possível concluir a operação."}}');
    }
  });
  // Encerramento controlado: espera o trabalho ativo terminar (sessão/navegador) antes de sair.
  return Object.assign(server, { shutdown: async () => { await preparation.settled(); } });
}
