// T7 — Aplicação controlada de reservas para demonstração.
// Servidor independente, node:http, sessões e reservas em memória.
// Modos: reference, known-defect (rejeita qty 10) e blocked-reservations (R3).
// ponytail: single-file server, stdlib only, no router lib.

import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

// --- Config defaults (env) ------------------------------------------------ //

const ENV_PORT = Number(process.env.DEMO_TARGET_PORT) || 4000;
const ENV_USER = process.env.DEMO_TARGET_USER || 'demo';
const ENV_PASSWORD = process.env.DEMO_TARGET_PASSWORD || 'demo1234';
const ENV_MODE = process.env.DEMO_TARGET_MODE || 'reference';

// --- Helpers -------------------------------------------------------------- //

function parseCookies(header) {
  const map = {};
  if (!header) return map;
  for (const pair of header.split(';')) {
    const [k, ...v] = pair.split('=');
    map[k.trim()] = v.join('=').trim();
  }
  return map;
}

function send(res, status, html) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function redirect(res, location, sid, status = 302) {
  const headers = { Location: location };
  if (sid) headers['Set-Cookie'] = `sid=${sid}; HttpOnly; Path=/; SameSite=Lax`;
  res.writeHead(status, headers);
  res.end();
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

/** Escape HTML to prevent XSS — text content only. */
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function parseForm(body) {
  const map = {};
  for (const pair of body.split('&')) {
    const [k, ...v] = pair.split('=');
    map[decodeURIComponent(k)] = decodeURIComponent(v.join('=').replace(/\+/g, ' '));
  }
  return map;
}

/** Validate qty per business rules. Returns null if valid, error string if not. */
function validateQty(raw, mode) {
  if (raw === undefined || raw === '') return 'Quantidade inválida';
  const n = Number(raw);
  if (!Number.isInteger(n)) return 'Quantidade inválida';
  if (n < 1 || n > 10) return 'Quantidade inválida';
  // known-defect: reject 10
  if (mode === 'known-defect' && n === 10) return 'Quantidade inválida';
  return null;
}

// --- Layout --------------------------------------------------------------- //

function layout(title, body) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>*{box-sizing:border-box;font-family:system-ui,sans-serif}body{margin:0;padding:20px;max-width:640px;margin:0 auto}
h1{font-size:1.4rem}a{color:#0066cc}table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:6px 10px;border:1px solid #ccc}
input,textarea,button{font:inherit;padding:6px 10px}button{cursor:pointer}
.msg-success{color:#006600;font-weight:bold}.msg-error{color:#cc0000;font-weight:bold}
nav{margin-bottom:16px}nav a{margin-right:12px}</style></head>
<body>${body}</body></html>`;
}

// --- Pages ---------------------------------------------------------------- //

function loginPage(error) {
  return layout('Login', `
<h1>Login</h1>
${error ? `<p class="msg-error">${esc(error)}</p>` : ''}
<form method="POST" action="/login">
  <p><label>Usuário<br><input type="text" name="user" required></label></p>
  <p><label>Senha<br><input type="password" name="password" required></label></p>
  <p><button type="submit">Entrar</button></p>
</form>`);
}

function navHtml() {
  return `<nav><a href="/">Início</a><a href="/reservas">Reservas</a><a href="/notas">Notas</a><a href="/logout">Sair</a></nav>`;
}

function homePage() {
  return layout('Início', `${navHtml()}<h1>Início</h1><p>Bem-vindo. Acesse <a href="/reservas">Reservas</a> para gerenciar suas reservas.</p>`);
}

function reservationsPage(reservations, message, messageClass) {
  const rows = reservations.map(r =>
    `<tr><td>${esc(r.id.slice(0, 8))}</td><td>${r.qty}</td><td>${esc(r.comment)}</td><td>${esc(r.createdAt)}</td></tr>`
  ).join('');
  const table = reservations.length
    ? `<table><thead><tr><th>ID</th><th>Qtd</th><th>Comentário</th><th>Criado em</th></tr></thead><tbody>${rows}</tbody></table>`
    : '<p>Nenhuma reserva encontrada.</p>';
  return layout('Reservas', `${navHtml()}<h1>Reservas</h1>
${message ? `<p class="${messageClass}">${esc(message)}</p>` : ''}
${table}
<p><a href="/reservas/nova">Nova reserva</a></p>`);
}

function newReservationPage(error, values) {
  const qty = values?.qty ?? '';
  const comment = values?.comment ?? '';
  return layout('Nova reserva', `${navHtml()}<h1>Nova reserva</h1>
${error ? `<p class="msg-error">${esc(error)}</p>` : ''}
<form method="POST" action="/reservas/nova">
  <p><label>Quantidade<br><input type="text" name="qty" value="${esc(qty)}"></label></p>
  <p><label>Comentário (opcional)<br><textarea name="comment" rows="3">${esc(comment)}</textarea></label></p>
  <p><button type="submit">Confirmar</button></p>
</form>`);
}

// --- Server --------------------------------------------------------------- //

export function createDemoTarget(overrides = {}) {
  const port = overrides.port ?? ENV_PORT;
  const user = overrides.user ?? ENV_USER;
  const password = overrides.password ?? ENV_PASSWORD;
  const mode = overrides.mode ?? ENV_MODE;

  if (!['reference', 'known-defect', 'blocked-reservations'].includes(mode)) {
    throw new Error(`Modo inválido: "${mode}". Use "reference", "known-defect" ou "blocked-reservations".`);
  }

  // Per-instance state
  const sessions = new Map();
  const reservations = [];
  const notes = [];
  let reservationsAvailable = mode !== 'blocked-reservations';

  function getSession(req) {
    const sid = parseCookies(req.headers.cookie).sid;
    return sid ? sessions.get(sid) : undefined;
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const path = url.pathname;
    const method = req.method;

    // --- Login (public) ---
    if (path === '/login' && method === 'GET') {
      return send(res, 200, loginPage());
    }
    if (path === '/login' && method === 'POST') {
      const body = parseForm(await readBody(req));
      if (body.user === user && body.password === password) {
        const sid = randomUUID();
        sessions.set(sid, { user: body.user });
        return redirect(res, '/', sid);
      }
      return send(res, 200, loginPage('Credenciais inválidas'));
    }

    // --- Logout ---
    if (path === '/logout') {
      const sid = parseCookies(req.headers.cookie).sid;
      if (sid) sessions.delete(sid);
      return redirect(res, '/login');
    }

    // --- Session guard ---
    const session = getSession(req);
    if (!session) return redirect(res, '/login');

    // --- Home ---
    if (path === '/' && method === 'GET') {
      return send(res, 200, homePage());
    }

    // Fluxo independente para R3; indisponibilidade não afeta notas.
    if (path === '/notas' && method === 'GET') {
      return send(res, 200, layout('Notas', `${navHtml()}<h1>Notas</h1>
${notes.length ? `<ul>${notes.map(note => `<li>${esc(note.text)}</li>`).join('')}</ul>` : '<p>Nenhuma nota registrada.</p>'}
<form method="POST" action="/notas"><p><label>Nota<br><textarea name="text" rows="3" required maxlength="200"></textarea></label></p>
<button type="submit">Salvar nota</button></form>`));
    }
    if (path === '/notas' && method === 'POST') {
      const body = parseForm(await readBody(req));
      if (typeof body.text === 'string' && body.text.trim() && body.text.length <= 200) notes.push({ id: randomUUID(), text: body.text, createdAt: new Date().toISOString() });
      return redirect(res, '/notas', undefined, 303);
    }
    if (path.startsWith('/reservas') && !reservationsAvailable) {
      return send(res, 503, layout('Reservas indisponíveis', `${navHtml()}<h1>Reservas indisponíveis</h1><p>Esta funcionalidade está temporariamente indisponível. As notas continuam disponíveis.</p>`));
    }

    // --- Reservations list ---
    if (path === '/reservas' && method === 'GET') {
      const flash = session.flash;
      delete session.flash;
      return send(res, 200, reservationsPage(reservations, flash?.message, flash?.messageClass));
    }

    // --- New reservation form ---
    if (path === '/reservas/nova' && method === 'GET') {
      return send(res, 200, newReservationPage());
    }

    // --- Create reservation ---
    if (path === '/reservas/nova' && method === 'POST') {
      const body = parseForm(await readBody(req));
      const error = validateQty(body.qty, mode);
      if (!error) reservations.push({
        id: randomUUID(),
        qty: Number(body.qty),
        comment: body.comment || '',
        createdAt: new Date().toISOString(),
      });
      session.flash = { message: error ?? 'Reserva criada', messageClass: error ? 'msg-error' : 'msg-success' };
      // POST/Redirect/GET: recarregar a lista não reenvia o formulário de criação.
      return redirect(res, '/reservas', undefined, 303);
    }

    // 404
    send(res, 404, layout('Não encontrado', `${navHtml()}<h1>Página não encontrada</h1>`));
  });

  // Controle exclusivamente do avaliador; não há endpoint que permita ao agente alterar a variante.
  return { server, port, sessions, reservations, notes, setReservationsAvailable(value) {
    if (typeof value !== 'boolean') throw new TypeError('Informe disponibilidade booleana.');
    reservationsAvailable = value;
  } };
}

// --- CLI entry ------------------------------------------------------------ //

const isMain = process.argv[1] && (
  process.argv[1].endsWith('demo-target.mjs') ||
  process.argv[1].endsWith('demo-target')
);

if (isMain) {
  if (!['reference', 'known-defect', 'blocked-reservations'].includes(ENV_MODE)) {
    console.error(`Modo inválido: "${ENV_MODE}". Use "reference", "known-defect" ou "blocked-reservations".`);
    process.exit(1);
  }
  const { server, port } = createDemoTarget();
  server.listen(port, '127.0.0.1', () => {
    console.log(`Demo target (${ENV_MODE}) listening on http://127.0.0.1:${port}`);
  });
}
