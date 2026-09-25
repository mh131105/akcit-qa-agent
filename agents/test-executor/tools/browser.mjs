// T8.2 — Ferramentas de navegador do executor visual: captura, cursor, teclado,
// rolagem, preenchimento privado de credenciais e controle dos destinos permitidos.
// O modelo decide as ações; as ferramentas validam parâmetros, coordenadas,
// cancelamento e limite de ações antes de executar. Nada vira comando de shell.
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { chromium } from 'playwright-core';

const exec = promisify(execFile);
const KEY_WHITELIST = new Set([
  'Return', 'Tab', 'Escape', 'BackSpace', 'space',
  'Up', 'Down', 'Left', 'Right', 'Page_Up', 'Page_Down', 'Home', 'End',
]);
const ACTION_LIMIT = () => new Error('ACTION_LIMIT: o limite de cem ações de exploração foi esgotado.');

export async function openBrowserSession(options) {
  const display = options.display ?? process.env.DISPLAY ?? ':99';
  const executablePath = options.chromiumPath ?? process.env.CHROMIUM_PATH ?? '/usr/bin/chromium';
  const { credential, allowedOrigins } = options;
  const allowed = new Set(allowedOrigins);
  const blockedDestinations = [];
  let closed = false;

  const start = new URL(options.startUrl);
  if (!allowed.has(start.origin)) {
    throw new Error(`ORIGIN_NOT_ALLOWED: a origem ${start.origin} não está habilitada pela equipe do piloto.`);
  }
  await mkdir(options.mediaDir, { recursive: true, mode: 0o700 });

  const browser = await chromium.launch({
    executablePath,
    headless: false,
    args: ['--no-sandbox', '--window-position=0,0', '--window-size=1366,768', '--force-device-scale-factor=1'],
  });
  const context = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    serviceWorkers: 'block',
    acceptDownloads: false,
  });
  // Piloto simples: uma única aba. Novas abas e popups são bloqueados com motivo.
  context.on('page', page => { void page.close(); });
  await context.route('**/*', async route => {
    const request = route.request();
    let url;
    try { url = new URL(request.url()); }
    catch { return route.abort('blockedbyclient'); }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return route.continue();
    if (!allowed.has(url.origin)) {
      if (!blockedDestinations.includes(url.origin)) blockedDestinations.push(url.origin);
      return route.abort('blockedbyclient');
    }
    return route.continue();
  });
  const page = await context.newPage();
  page.on('dialog', dialog => { void dialog.dismiss().catch(() => {}); });
  await page.goto(options.startUrl, { waitUntil: 'domcontentloaded' });

  const id = () => randomUUID();
  const at = () => new Date().toISOString();
  const bounds = () => page.viewportSize() ?? { width: 1366, height: 768 };

  async function guard(signal) {
    if (closed) throw new Error('BROWSER_CLOSED: a sessão do navegador foi encerrada.');
    if (signal?.aborted) throw new Error('CANCELLED: a chamada foi cancelada.');
    if ((await options.remainingActions()) < 1) throw ACTION_LIMIT();
  }
  // O executor preenche credenciais sem receber os valores; capturas de uma tela
  // de login com a credencial visível não são enviadas ao modelo nem persistidas.
  async function credentialVisible() {
    if (!credential) return false;
    try {
      return await page.evaluate(({ username, password }) => {
        const inputs = Array.from(document.querySelectorAll('input'));
        const hasPasswordField = inputs.some(input => input.type === 'password');
        if (!hasPasswordField) return false;
        const values = inputs.map(input => input.value).filter(value => value.length > 0);
        const text = document.body ? document.body.textContent ?? '' : '';
        return values.includes(username) || values.includes(password) ||
          text.includes(username) || text.includes(password);
      }, credential);
    } catch { return false; }
  }
  async function screenshot() {
    return { buffer: await page.screenshot({ type: 'png' }), size: bounds() };
  }
  async function record(action, signal) {
    await guard(signal);
    return options.onAction(action);
  }
  async function observe(signal) {
    await guard(signal);
    const visible = await credentialVisible();
    const summary = { observationId: null, width: bounds().width, height: bounds().height,
      blockedDestinations, credentialVisible: visible };
    if (visible) {
      summary.observationId = null;
      return { summary, content: [{ type: 'text',
        text: JSON.stringify({ observationId: null, width: summary.width, height: summary.height,
          blocked: 'CREDENTIAL_VISIBLE', message: 'Observação bloqueada: a tela de login exibe a credencial digitada. Nenhuma captura foi enviada ou persistida.', blockedDestinations }) }],
        details: { observationId: null, blocked: true } };
    }
    const capture = await screenshot();
    const observationId = id();
    const assetId = id();
    await writeFile(join(options.mediaDir, assetId + '.png'), capture.buffer);
    const record = { id: observationId, assetId, at: at(), width: capture.size.width, height: capture.size.height };
    await options.onObservation(record);
    return {
      summary: { ...summary, observationId, assetId },
      content: [
        { type: 'text', text: JSON.stringify({ observationId, width: record.width, height: record.height,
          blockedDestinations: blockedDestinations.slice(), message: 'Observação registrada. Use este observationId como evidência real da tela.' }) },
        { type: 'image', data: capture.buffer.toString('base64'), mimeType: 'image/png' },
      ],
      details: { observationId, assetId, blocked: false },
    };
  }

  const tools = [
    {
      name: 'observe_screen', label: 'Observar tela', executionMode: 'sequential',
      promptSnippet: 'observe_screen — captura o display; devolve imagem, dimensões e observationId.',
      description: 'Captura a tela atual e devolve a imagem, as dimensões e o identificador da observação. Nenhum parâmetro. A imagem recebida é a única evidência válida; jamais invente um observationId.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      async execute(_toolCallId, _params, signal) {
        const result = await observe(signal);
        return { content: result.content, details: result.details };
      },
    },
    {
      name: 'pointer', label: 'Mover e clicar', executionMode: 'sequential',
      promptSnippet: 'pointer {action: move|click|double_click, x, y} — opera o cursor por coordenadas da imagem observada.',
      description: 'Move o cursor ou clica por coordenadas da imagem observada (pixel 0,0 é o canto superior esquerdo). Sempre observe a tela depois e confira o resultado antes de prosseguir.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['move', 'click', 'double_click'] },
          x: { type: 'integer', minimum: 0, maximum: 4000 },
          y: { type: 'integer', minimum: 0, maximum: 4000 },
        },
        required: ['action', 'x', 'y'], additionalProperties: false,
      },
      async execute(_toolCallId, params, signal) {
        await guard(signal);
        const size = bounds();
        if (!Number.isInteger(params.x) || !Number.isInteger(params.y) || params.x < 0 || params.y < 0 ||
            params.x >= size.width || params.y >= size.height) {
          throw new Error(`COORDINATE_OUT_OF_BOUNDS: coordenadas ${params.x},${params.y} fora da tela observada de ${size.width}x${size.height}.`);
        }
        const args = ['mousemove', '--sync', String(params.x), String(params.y)];
        if (params.action === 'click') args.push('click', '1');
        if (params.action === 'double_click') args.push('click', '--repeat', '2', '--delay', '60', '1');
        await exec('xdotool', args, { env: { ...process.env, DISPLAY: display }, timeout: 10000 });
        const actionId = id();
        await options.onAction({ id: actionId, at: at(), tool: 'pointer',
          params: { action: params.action, x: params.x, y: params.y }, outcome: 'ok', note: 'ação executada pelo cursor' });
        return { content: [{ type: 'text', text: JSON.stringify({ actionId, ok: true, message: 'Ação executada. Observe a tela para conferir o resultado.' }) }],
          details: { actionId } };
      },
    },
    {
      name: 'keyboard_scroll', label: 'Teclado e rolagem', executionMode: 'sequential',
      promptSnippet: 'keyboard_scroll {kind: type|key|scroll, ...} — digitação curta, teclas permitidas ou rolagem explícita.',
      description: 'Executa ações explícitas e limitadas de navegação: digitar texto curto no campo focado, pressionar teclas permitidas (Return, Tab, Escape, BackSpace, space, setas, Page_Up/Down, Home, End) ou rolar a página. Sem atalhos por JavaScript.',
      parameters: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['type', 'key', 'scroll'] },
          text: { type: 'string', minLength: 1, maxLength: 200 },
          keys: { type: 'array', items: { type: 'string', enum: [...KEY_WHITELIST] }, maxItems: 5 },
          direction: { type: 'string', enum: ['up', 'down'] },
          amount: { type: 'integer', minimum: 1, maximum: 20 },
        },
        required: ['kind'], additionalProperties: false,
      },
      async execute(_toolCallId, params, signal) {
        await guard(signal);
        const described = { kind: params.kind, ...(params.text !== undefined ? { text: params.text } : {}),
          ...(params.keys !== undefined ? { keys: params.keys } : {}),
          ...(params.direction !== undefined ? { direction: params.direction, amount: params.amount } : {}) };
        let args = [];
        if (params.kind === 'type') {
          if (typeof params.text !== 'string' || !params.text.length || params.text.length > 200) {
            throw new Error('INVALID_PARAMETERS: informe text de 1 a 200 caracteres para type.');
          }
          args = ['type', '--delay', '25', '--clearmodifiers', params.text];
        } else if (params.kind === 'key') {
          if (!Array.isArray(params.keys) || !params.keys.length || params.keys.length > 5 ||
              params.keys.some(key => !KEY_WHITELIST.has(key))) {
            throw new Error('INVALID_PARAMETERS: informe de 1 a 5 teclas da lista permitida para key.');
          }
          args = ['key', '--clearmodifiers', ...params.keys];
        } else {
          if (!['up', 'down'].includes(params.direction) || !Number.isInteger(params.amount) || params.amount < 1 || params.amount > 20) {
            throw new Error('INVALID_PARAMETERS: informe direction up|down e amount de 1 a 20 para scroll.');
          }
          args = ['click', '--repeat', String(params.amount), '--delay', '60', params.direction === 'up' ? '4' : '5'];
        }
        await exec('xdotool', args, { env: { ...process.env, DISPLAY: display }, timeout: 10000 });
        const actionId = id();
        await options.onAction({ id: actionId, at: at(), tool: 'keyboard_scroll', params: described, outcome: 'ok',
          note: 'teclado/rolagem executados' });
        return { content: [{ type: 'text', text: JSON.stringify({ actionId, ok: true, message: 'Ação executada. Observe a tela para conferir o resultado.' }) }],
          details: { actionId } };
      },
    },
    {
      name: 'fill_credential', label: 'Preencher credencial', executionMode: 'sequential',
      promptSnippet: 'fill_credential {field: username|password} — preenche o campo focado com a credencial privada.',
      description: 'Preenche o campo de login atualmente focado (clique nele antes com pointer) usando a credencial de teste cadastrada, sem revelar o valor. O resultado nunca contém o segredo. Use apenas nos campos de usuário/senha do alvo.',
      parameters: {
        type: 'object',
        properties: { field: { type: 'string', enum: ['username', 'password'] } },
        required: ['field'], additionalProperties: false,
      },
      async execute(_toolCallId, params, signal) {
        await guard(signal);
        if (!credential) throw new Error('CREDENTIAL_UNAVAILABLE: não há credencial de teste cadastrada para este alvo.');
        const value = params.field === 'username' ? credential.username : credential.password;
        await page.keyboard.insertText(value);
        const actionId = id();
        await options.onAction({ id: actionId, at: at(), tool: 'fill_credential', params: { field: params.field },
          outcome: 'ok', note: 'valor preenchido sem exposição ao modelo' });
        return { content: [{ type: 'text', text: JSON.stringify({ actionId, ok: true, message: 'Campo preenchido com a credencial cadastrada. Envie o formulário pela interface e observe o resultado.' }) }],
          details: { actionId } };
      },
    },
  ];

  return {
    tools,
    blockedDestinations,
    // Acesso somente para o teste/smoke medir coordenadas; o agente nunca recebe a página.
    page,
    async close() {
      if (closed) return;
      closed = true;
      await browser.close().catch(() => {});
    },
  };
}
