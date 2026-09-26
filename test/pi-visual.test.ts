import assert from 'node:assert/strict';
import test from 'node:test';
import { executeVisualTask, visualSettings, type VisualCallUpdate, type VisualResult } from '../src/runtime/pi-visual.js';

// T8.2-R1 — Comportamentos do runtime visual que ficavam encobertos pela
// substituição de `visualCall`: propagação das tools/imagens para a sessão,
// contagem de todas as chamadas, teto de 120 s por chamada, cancelamento entre
// operações assíncronas e limpeza do navegador antes de liberar o chamador.
// A sessão Pi é substituída por costuras internas (nunca expostas pela API);
// o navegador real é exercitado no smoke da imagem final.

type FakeSession = {
  messages: { role: string; stopReason?: string; content: { type: string; text: string }[]; usage?: Record<string, number> }[];
  subscriber?: (event: unknown) => void;
  prompt: (prompt: string, options: unknown) => Promise<void>;
  abort: () => Promise<void>;
  dispose: () => void;
  setAutoCompactionEnabled: (enabled: boolean) => void;
  setAutoRetryEnabled: (enabled: boolean) => void;
  subscribe: (handler: (event: unknown) => void) => void;
};
function makeFakeSession(finalText: string, behavior: {
  prompt?: () => Promise<void>;
  emitRounds?: number;
  usage?: Record<string, number>;
} = {}) {
  const session: FakeSession = {
    messages: [],
    async abort() { aborts.count += 1; },
    dispose() { disposes.count += 1; },
    setAutoCompactionEnabled() {},
    setAutoRetryEnabled() {},
    subscribe(handler) { session.subscriber = handler; },
    async prompt(promptText, options) {
      prompts.push({ promptText, options });
      if (behavior.prompt) return behavior.prompt();
      for (let round = 0; round < (behavior.emitRounds ?? 1); round++) {
        session.subscriber?.({ type: 'message_start', message: { role: 'assistant' } });
        session.subscriber?.({ type: 'message_end', message: { role: 'assistant', usage: behavior.usage ?? { input: 10, output: 5 } } });
      }
      session.messages.push({ role: 'assistant', stopReason: 'stop',
        content: [{ type: 'text', text: finalText }] });
    },
  };
  return session;
}
const aborts = { count: 0 };
const disposes = { count: 0 };
const prompts: { promptText: string; options: any }[] = [];
function resetSpies() { aborts.count = 0; disposes.count = 0; prompts.length = 0; }
function fakeModel() { return { modelRuntime: {} as never, model: {} as never }; }
function baseTask(overrides: Record<string, unknown> = {}) {
  return {
    role: 'test-executor' as const, kind: 'map-application' as const,
    model: { provider: 'deepseek', model: 'deepseek-flash', thinkingLevel: 'high' as const },
    prompt: JSON.stringify({ task: 'map-application' }),
    signal: new AbortController().signal,
    perCallTimeoutMs: 120000,
    callMeta: { attempt: 1, outputRevision: 1 },
    ...overrides,
  };
}

test('sessão visual recebe customTools do navegador, imagens e teto de 120 s por chamada', async () => {
  resetSpies();
  let sessionArgs: any;
  let settingsTimeout: number | undefined;
  const browser = { tools: [{ name: 'observe_screen' }, { name: 'pointer' }], blockedDestinations: [], page: null,
    close: async () => {} };
  const result = await executeVisualTask(baseTask({
    images: [{ data: 'AAAA', mimeType: 'image/png' }, { data: 'BBBB', mimeType: 'image/png' }],
    browser: { startUrl: 'http://127.0.0.1:4000/', allowedOrigins: ['http://127.0.0.1:4000'], credential: null,
      mediaDir: '/tmp/pi-visual-media', remainingActions: async () => 10, onObservation: async () => {}, onAction: async () => {} },
  }), {
    createSession: async args => { sessionArgs = args; return { session: makeFakeSession('{"status":"approved"}') }; },
    openBrowser: async () => browser,
    createSettings: timeout => { settingsTimeout = timeout; return visualSettings(timeout); },
    prepareModel: async () => fakeModel(),
  });
  assert.deepEqual(sessionArgs.tools, ['observe_screen', 'pointer'], 'tools liberadas correspondem às do navegador');
  assert.equal(sessionArgs.customTools.length, 2);
  assert.equal(sessionArgs.noTools, 'all');
  assert.equal(sessionArgs.thinkingLevel, 'high');
  assert.equal(settingsTimeout, 120000, 'teto de 120 segundos por chamada aplicado');
  assert.equal(prompts[0]!.options.images.length, 2, 'imagens anexadas à mensagem');
  assert.equal(result.payload.status, 'approved');
});

test('todas as chamadas de modelo são contadas, com início, término e uso', async () => {
  resetSpies();
  const updates: VisualCallUpdate[] = [];
  const session = makeFakeSession('{"status":"approved"}', { emitRounds: 2, usage: { input: 12, output: 3, totalTokens: 15 } });
  const result: VisualResult = await executeVisualTask(baseTask({
    onCall: async event => { updates.push(event); },
  }), {
    createSession: async () => ({ session }),
    prepareModel: async () => fakeModel(),
    
  });
  assert.equal(result.calls.length, 2, 'duas inferências registradas, não apenas a resposta final');
  assert.equal(updates.filter(update => update.kind === 'start').length, 2);
  assert.equal(updates.filter(update => update.kind === 'end').length, 2);
  assert.equal(updates[0]!.callId, updates[1]!.callId, 'início e término referenciam a mesma chamada');
  assert.ok(updates[1]!.durationMs! >= 0);
  assert.equal(updates[1]!.usage?.input, 12, 'uso da inferência preservado');
  assert.equal(result.calls[0]!.usage?.totalTokens, 15);
});

test('cancelamento atravessa a inicialização do navegador e fecha o que foi aberto', async () => {
  resetSpies();
  const controller = new AbortController();
  let closed = 0;
  let sessionCreated = 0;
  const openBrowser = async (options: { signal?: AbortSignal }) => {
    await new Promise(resolve => setTimeout(resolve, 25));
    if (options.signal?.aborted) throw new Error('CANCELLED: a chamada foi cancelada.');
    return { tools: [], blockedDestinations: [], page: null, close: async () => { closed += 1; } };
  };
  const promise = executeVisualTask(baseTask({
    signal: controller.signal,
    browser: { signal: controller.signal, startUrl: 'http://127.0.0.1:4000/', allowedOrigins: ['http://127.0.0.1:4000'], credential: null,
      mediaDir: '/tmp/pi-visual-media', remainingActions: async () => 10, onObservation: async () => {}, onAction: async () => {} },
  }), {
    openBrowser,
    createSession: async () => { sessionCreated += 1; return { session: makeFakeSession('{}') }; },
    prepareModel: async () => fakeModel(),
    
  });
  controller.abort(new Error('cancelamento externo'));
  await assert.rejects(promise, error => error.code === 'CANCELLED');
  assert.equal(sessionCreated, 0, 'nenhuma sessão iniciada depois do cancelamento');
});

test('cancelamento com sessão aberta encerra chamada, sessão e navegador antes de liberar', async () => {
  resetSpies();
  const controller = new AbortController();
  let closed = 0;
  let release = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  let started!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  const session = makeFakeSession('{"status":"approved"}', {
    prompt: async () => { started(); await gate; throw new Error('chamada interrompida'); },
  });
  const promise = executeVisualTask(baseTask({
    signal: controller.signal,
    browser: { signal: controller.signal, startUrl: 'http://127.0.0.1:4000/', allowedOrigins: ['http://127.0.0.1:4000'], credential: null,
      mediaDir: '/tmp/pi-visual-media', remainingActions: async () => 10, onObservation: async () => {}, onAction: async () => {} },
  }), {
    createSession: async () => ({ session }),
    openBrowser: async () => ({ tools: [], blockedDestinations: [], page: null, close: async () => { closed += 1; } }),
    prepareModel: async () => fakeModel(),
    
  });
  await entered;
  controller.abort(new Error('cancelamento externo'));
  release();
  await assert.rejects(promise, error => error.code === 'CANCELLED');
  assert.equal(aborts.count, 1, 'sessão abortada');
  assert.equal(disposes.count, 1, 'sessão descartada');
  assert.equal(closed, 1, 'navegador encerrado antes de liberar o chamador');
});

test('falha da sessão fecha o navegador e conserva a falha técnica', async () => {
  resetSpies();
  let closed = 0;
  const session = makeFakeSession('{"status":"approved"}', {
    prompt: async () => { throw new Error('falha interna do provedor'); },
  });
  await assert.rejects(executeVisualTask(baseTask({
    browser: { startUrl: 'http://127.0.0.1:4000/', allowedOrigins: ['http://127.0.0.1:4000'], credential: null,
      mediaDir: '/tmp/pi-visual-media', remainingActions: async () => 10, onObservation: async () => {}, onAction: async () => {} },
  }), {
    createSession: async () => ({ session }),
    openBrowser: async () => ({ tools: [], blockedDestinations: [], page: null, close: async () => { closed += 1; } }),
    prepareModel: async () => fakeModel(),
    
  }), error => error.code === 'MODEL_ERROR');
  assert.equal(closed, 1, 'navegador fechado após a falha');
  assert.equal(disposes.count, 1, 'sessão descartada após a falha');
});

test('JSON inválido do modelo produz INVALID_OUTPUT sem aprovar nada', async () => {
  resetSpies();
  const result = executeVisualTask(baseTask({}), {
    createSession: async () => ({ session: makeFakeSession('não é JSON') }),
    prepareModel: async () => fakeModel(),
    
  });
  await assert.rejects(result, error => error.code === 'INVALID_OUTPUT');
});

test('visualSettings aplica o teto por chamada informado', () => {
  const settings = visualSettings(120000);
  assert.ok(settings, 'configuração da sessão criada sem retry automático');
});

test('JSON embrulhado em cercas de código ou com texto adicional é tolerado', async () => {
  resetSpies();
  const fenced = await executeVisualTask(baseTask({}), {
    createSession: async () => ({ session: makeFakeSession('```json\n{"status":"approved"}\n```') }),
    prepareModel: async () => fakeModel(),
  });
  assert.equal(fenced.payload.status, 'approved', 'cercas de código removidas antes do parse');
  const surrounded = await executeVisualTask(baseTask({}), {
    createSession: async () => ({ session: makeFakeSession('Mapa concluído:\n{"status":"approved"}') }),
    prepareModel: async () => fakeModel(),
  });
  assert.equal(surrounded.payload.status, 'approved', 'texto ao redor do objeto tolerado');
});
