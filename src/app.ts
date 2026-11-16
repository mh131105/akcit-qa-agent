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
  ['/web/qatron-mark.png', { url: new URL('../src/web/qatron-mark.png', import.meta.url), type: 'image/png' }],
]);
const indexFile = new URL('../src/web/index.html', import.meta.url);
const landingIndexFile = new URL('../src/web/landing/index.html', import.meta.url);
// A página pública expõe apenas os arquivos de demonstração selecionados.
const landingFiles = new Map([
  ['styles.css', 'text/css; charset=utf-8'],
  ['script.js', 'text/javascript; charset=utf-8'],
  ['qatron-mark.png', 'image/png'],
  ['assets/ordenacao-crescente.png', 'image/png'],
  ['assets/ordenacao-decrescente.png', 'image/png'],
  ['assets/ordenacao-relatorio-final.jpg', 'image/jpeg'],
  ['assets/relatorio-final.txt', 'text/plain; charset=utf-8'],
  ['assets/qatron-showcase.mp4', 'video/mp4'],
  ['assets/qatron-poster.jpg', 'image/jpeg'],
].map(([path, type]) => [`/landing/${path}`, { url: new URL(`../src/web/landing/${path}`, import.meta.url), type: type! }]));
// blob: apenas para exibir capturas buscadas com a autenticação existente; URLs revogadas ao sair.
const contentSecurityPolicy = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' blob:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
const landingContentSecurityPolicy = "default-src 'none'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self'; media-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

export async function createApp(config: ReturnType<typeof readConfig>, options: Pick<PreparationOptions, 'modelCall' | 'modelPreflight' | 'visualCall' | 'visualPreflight'> & { now?: () => number } = {}) {
  const runs = new RunStore(config.dataDir);
  const auth = new AuthService(config, options.now);
  await auth.initialize();
  try {
    await runs.initialize();
    await runs.recoverInterrupted();
  } catch (error) { auth.close(); throw error; }
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
      const page = pages.has(path) || /^\/execucoes\/[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(path);
      const landing = path === '/' ? { url: landingIndexFile, type: 'text/html; charset=utf-8' } : landingFiles.get(path);
      const file = landing ?? (page ? { url: indexFile, type: 'text/html; charset=utf-8' } : webFiles.get(path));
      if (file) {
        if (landing) response.setHeader('Content-Security-Policy', landingContentSecurityPolicy);
        const content = await readFile(file.url);
        if (file.type === 'video/mp4') {
          response.setHeader('Accept-Ranges', 'bytes');
          // Um intervalo basta para reprodução e seek. HEAD ignora Range; intervalos
          // múltiplos/unidades não suportadas recebem a representação completa.
          const range = request.method === 'GET' && /^bytes=(\d*)-(\d*)$/.exec(request.headers.range ?? '');
          if (range) {
            const suffix = range[1] === '';
            const first = Number(range[1]);
            const last = Number(range[2]);
            const start = suffix ? Math.max(0, content.length - last) : first;
            const end = suffix || range[2] === '' ? content.length - 1 : Math.min(last, content.length - 1);
            if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || (suffix && last === 0) || start >= content.length || end < start) {
              response.writeHead(416, { 'Content-Range': `bytes */${content.length}`, 'Content-Length': 0 }).end();
              return;
            }
            response.writeHead(206, {
              'Content-Type': file.type, 'Content-Range': `bytes ${start}-${end}/${content.length}`, 'Content-Length': end - start + 1,
            });
            response.end(content.subarray(start, end + 1));
            return;
          }
        }
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
  server.once('close', () => auth.close());
  // Encerramento controlado: espera o trabalho ativo terminar (sessão/navegador) antes de sair.
  return Object.assign(server, { shutdown: async () => { await preparation.settled(); } });
}
