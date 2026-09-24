import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentSession, ModelRuntime } from '@earendil-works/pi-coding-agent';
import { readConfig, resolvePreparationModels } from '../src/config.js';
import { executeSpecialistTask, preflightSpecialists, type SpecialistTask } from '../src/runtime/pi.js';

const selection = { provider: 'openai', model: 'gpt-4o' };
const models = { 'artifact-curator': selection, 'test-designer': selection, 'output-validator': selection };
const task = (signal = new AbortController().signal, timeoutMs = 1000): SpecialistTask => ({
  role: 'artifact-curator', model: selection, prompt: 'entrada sintética', signal, timeoutMs,
});

function answer(session: AgentSession, text: string, stopReason = 'stop') {
  session.agent.state.messages.push({
    role: 'assistant', content: [{ type: 'text', text }, { type: 'thinking', thinking: 'não persistir' }],
    api: 'openai-responses', provider: 'openai', model: selection.model, timestamp: Date.now(), stopReason,
    usage: { input: 10, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 30,
      cost: { input: 0.001, output: 0.002, cacheRead: 0, cacheWrite: 0, total: 0.003 } },
  } as never);
}

test('configuração dos modelos é validada no início e exige pares completos por papel', () => {
  const missing = readConfig({});
  assert.throws(() => resolvePreparationModels(missing), /PI_PROVIDER e PI_MODEL/);
  const partial = readConfig({ PI_PROVIDER: 'openai', PI_MODEL: 'gpt-4o', PI_VALIDATOR_MODEL: 'other' });
  assert.throws(() => resolvePreparationModels(partial), /PI_VALIDATOR_PROVIDER e PI_VALIDATOR_MODEL/);
  const config = readConfig({ PI_PROVIDER: ' openai ', PI_MODEL: ' gpt-4o ', PI_VALIDATOR_PROVIDER: 'anthropic', PI_VALIDATOR_MODEL: 'chosen' });
  assert.deepEqual(resolvePreparationModels(config), { ...models, 'output-validator': { provider: 'anthropic', model: 'chosen' } });
});

test('preflight não chama modelos, não aceita seleção inexistente ou credencial ausente', async t => {
  const prompt = t.mock.method(AgentSession.prototype, 'prompt', async () => { throw new Error('inferência não autorizada no teste'); });
  t.mock.method(ModelRuntime.prototype, 'getAuth', async () => undefined);
  await assert.rejects(preflightSpecialists({ ...models, 'artifact-curator': { provider: 'missing', model: 'missing' } }), { code: 'MODEL_UNAVAILABLE' });
  await assert.rejects(preflightSpecialists(models), { code: 'CREDENTIAL_UNAVAILABLE' });
  assert.equal(prompt.mock.callCount(), 0);
});

test('runtime usa sessão própria sem tools, histórico, retries ou compactação e devolve só JSON/metadados', async t => {
  t.mock.method(ModelRuntime.prototype, 'getAuth', async () => ({ auth: { apiKey: 'fake-never-sent' } }));
  const sessions: string[] = [];
  const dispose = t.mock.method(AgentSession.prototype, 'dispose');
  const prompt = t.mock.method(AgentSession.prototype, 'prompt', async function (this: AgentSession, text: string, options: unknown) {
    sessions.push(this.sessionId);
    assert.equal(text, 'entrada sintética');
    assert.equal((options as { expandPromptTemplates: boolean }).expandPromptTemplates, false);
    assert.equal(typeof (options as { preflightResult: unknown }).preflightResult, 'function');
    assert.deepEqual(this.getActiveToolNames(), []);
    assert.deepEqual(this.messages, []);
    assert.equal(this.sessionFile, undefined);
    assert.equal(this.autoRetryEnabled, false);
    assert.equal(this.autoCompactionEnabled, false);
    assert.equal(this.settingsManager.getProviderRetrySettings().maxRetries, 0);
    assert.match(this.systemPrompt, sessions.length === 1 ? /Curadoria de material textual/ : /output-validator/);
    if (sessions.length === 2) assert.doesNotMatch(this.systemPrompt, /# Curadoria de material textual/);
    assert.equal(this.model?.id, selection.model);
    answer(this, '{"requirements":[],"questions":[]}');
  });
  for (let i = 0; i < 2; i++) {
    const result = await executeSpecialistTask({ ...task(), role: i === 0 ? 'artifact-curator' : 'output-validator' });
    assert.deepEqual(result.payload, { requirements: [], questions: [] });
    assert.deepEqual(result.metadata.usage, { input: 10, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 30 });
    assert.equal(result.metadata.estimatedCost, 0.003);
    assert.ok(result.metadata.durationMs >= 0);
    assert.doesNotMatch(JSON.stringify(result), /não persistir/);
  }
  assert.equal(new Set(sessions).size, 2);
  assert.equal(prompt.mock.callCount(), 2);
  assert.equal(dispose.mock.callCount(), 2);
});

test('JSON inválido e falha do provedor não repetem chamadas nem expõem mensagens privadas', async t => {
  t.mock.method(ModelRuntime.prototype, 'getAuth', async () => ({ auth: { apiKey: 'fake-never-sent' } }));
  const prompt = t.mock.method(AgentSession.prototype, 'prompt', async function (this: AgentSession) { answer(this, '```json\n{}\n```'); });
  await assert.rejects(executeSpecialistTask(task()), { code: 'INVALID_OUTPUT' });
  prompt.mock.mockImplementation(async () => { throw new Error('secret-key material privado'); });
  await assert.rejects(executeSpecialistTask(task()), (error: unknown) => {
    assert.equal((error as { code: string }).code, 'MODEL_ERROR');
    assert.doesNotMatch(String(error), /secret-key|material privado/);
    return true;
  });
  assert.equal(prompt.mock.callCount(), 2);
});

test('timeout e cancelamento abortam a sessão e aguardam sua conclusão antes do dispose', async t => {
  t.mock.method(ModelRuntime.prototype, 'getAuth', async () => ({ auth: { apiKey: 'fake-never-sent' } }));
  let finish: (() => void) | undefined;
  let started: (() => void) | undefined;
  let settled = false;
  const prompt = t.mock.method(AgentSession.prototype, 'prompt', async function (this: AgentSession) {
    started?.();
    await new Promise<void>(resolve => { finish = resolve; });
    settled = true;
    answer(this, '{"late":true}');
  });
  const abort = t.mock.method(AgentSession.prototype, 'abort', async () => {
    await new Promise(resolve => setTimeout(resolve, 10));
    finish?.();
  });
  const originalDispose = AgentSession.prototype.dispose;
  const dispose = t.mock.method(AgentSession.prototype, 'dispose', function (this: AgentSession) {
    assert.equal(settled, true, 'não liberar sessão com chamada ainda ativa');
    originalDispose.call(this);
  });
  await assert.rejects(executeSpecialistTask(task(undefined, 250)), { code: 'TIMEOUT' });
  assert.equal(abort.mock.callCount(), 1);
  const controller = new AbortController();
  settled = false;
  const entered = new Promise<void>(resolve => { started = resolve; });
  const running = executeSpecialistTask(task(controller.signal));
  await entered;
  controller.abort();
  await assert.rejects(running, { code: 'CANCELLED' });
  assert.equal(prompt.mock.callCount(), 2);
  assert.equal(abort.mock.callCount(), 2);
  assert.equal(dispose.mock.callCount(), 2);
});

test('cancelamento durante preflight do SDK impede iniciar inferência depois do abort', async t => {
  const controller = new AbortController();
  t.mock.method(ModelRuntime.prototype, 'getAuth', async () => ({ auth: { apiKey: 'fake-never-sent' } }));
  t.mock.method(ModelRuntime.prototype, 'checkAuth', async () => {
    controller.abort();
    return { type: 'api_key' };
  });
  const inference = t.mock.method(ModelRuntime.prototype, 'streamSimple', () => { throw new Error('inferência não autorizada no teste'); });
  await assert.rejects(executeSpecialistTask(task(controller.signal)), { code: 'CANCELLED' });
  assert.equal(inference.mock.callCount(), 0);
});
