import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { AgentSession, ModelRuntime } from '@earendil-works/pi-coding-agent';
import { readConfig, resolvePreparationModels } from '../src/config.js';
import { executeSpecialistTask, preflightSpecialists, type SpecialistTask } from '../src/runtime/pi.js';

const selection = { provider: 'openai', model: 'gpt-4o' };
const models = { 'artifact-curator': selection, 'test-designer': selection, 'output-validator': selection };
const task = (signal = new AbortController().signal, timeoutMs = 1000): SpecialistTask => ({
  role: 'artifact-curator', task: 'curate-artifacts', model: selection, prompt: 'entrada sintética', signal, timeoutMs,
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
  assert.equal(missing.piAuthPath, undefined);
  assert.equal(readConfig({ PI_AUTH_PATH: '  ' }).piAuthPath, undefined);
  assert.equal(readConfig({ PI_AUTH_PATH: ' .data/pi/auth.json ' }).piAuthPath, resolve('.data/pi/auth.json'));
});

test('preflight não chama modelos, não aceita seleção inexistente ou credencial ausente', async t => {
  const prompt = t.mock.method(AgentSession.prototype, 'prompt', async () => { throw new Error('inferência não autorizada no teste'); });
  t.mock.method(ModelRuntime.prototype, 'getAuth', async () => undefined);
  await assert.rejects(preflightSpecialists({ ...models, 'artifact-curator': { provider: 'missing', model: 'missing' } }), { code: 'MODEL_UNAVAILABLE' });
  await assert.rejects(preflightSpecialists(models), { code: 'CREDENTIAL_UNAVAILABLE' });
  assert.equal(prompt.mock.callCount(), 0);
});

test('DeepSeek usa raciocínio baixo no Flash e alto no Pro, preservando os demais provedores', async t => {
  t.mock.method(ModelRuntime.prototype, 'getAuth', async () => ({ auth: { apiKey: 'fake-never-sent' } }));
  const observed: unknown[] = [];
  t.mock.method(AgentSession.prototype, 'prompt', async function (this: AgentSession) {
    observed.push({ model: this.model?.id, thinking: this.thinkingLevel });
    assert.deepEqual(this.messages, []);
    assert.deepEqual(this.getActiveToolNames(), []);
    answer(this, '{"synthetic":true}');
  });
  for (const model of [
    { provider: 'deepseek', model: 'deepseek-flash' },
    { provider: 'deepseek', model: 'deepseek-v4-pro' },
    selection,
  ]) {
    const result = await executeSpecialistTask({ ...task(), model });
    assert.deepEqual(result.payload, { synthetic: true });
    assert.doesNotMatch(JSON.stringify(result), /não persistir|fake-never-sent/);
  }
  assert.deepEqual(observed, [
    { model: 'deepseek-flash', thinking: 'low' },
    { model: 'deepseek-v4-pro', thinking: 'high' },
    { model: selection.model, thinking: 'off' },
  ]);
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
    const result = await executeSpecialistTask({ ...task(), role: i === 0 ? 'artifact-curator' : 'output-validator',
      task: i === 0 ? 'curate-artifacts' : 'validate-output' });
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

test('tarefas de plano, casos e validação carregam uma única skill em sessões separadas', async t => {
  t.mock.method(ModelRuntime.prototype, 'getAuth', async () => ({ auth: { apiKey: 'fake-never-sent' } }));
  const sessions: string[] = [];
  const expectedSkills = ['create-test-plan', 'create-test-cases', 'validate-output'];
  t.mock.method(AgentSession.prototype, 'prompt', async function (this: AgentSession) {
    const selected = expectedSkills[sessions.length]!;
    sessions.push(this.sessionId);
    assert.match(this.systemPrompt, new RegExp(`name: ${selected}\\n`));
    for (const other of expectedSkills.filter(name => name !== selected)) {
      assert.doesNotMatch(this.systemPrompt, new RegExp(`name: ${other}\\n`));
    }
    assert.deepEqual(this.messages, []);
    assert.deepEqual(this.getActiveToolNames(), []);
    assert.equal(this.model?.id, selection.model);
    answer(this, '{"synthetic":true}');
  });
  await executeSpecialistTask({ ...task(), role: 'test-designer', task: 'create-test-plan' });
  await executeSpecialistTask({ ...task(), role: 'test-designer', task: 'create-test-cases' });
  await executeSpecialistTask({ ...task(), role: 'output-validator', task: 'validate-output' });
  assert.equal(new Set(sessions).size, 3);
});

test('runtime recusa tarefa incompatível, ausente ou caminho arbitrário antes de acessar modelos', async t => {
  const auth = t.mock.method(ModelRuntime.prototype, 'getAuth', async () => ({ auth: { apiKey: 'fake-never-sent' } }));
  const prompt = t.mock.method(AgentSession.prototype, 'prompt', async () => { throw new Error('inferência não autorizada no teste'); });
  for (const input of [
    { ...task(), role: 'test-designer', task: 'validate-output' },
    { ...task(), role: 'output-validator', task: 'create-test-cases' },
    { ...task(), task: '../../../private/SKILL.md' },
    { ...task(), task: undefined },
    { ...task(), role: '__proto__' },
  ]) {
    await assert.rejects(executeSpecialistTask(input as SpecialistTask), { code: 'INVALID_TASK' });
  }
  assert.equal(auth.mock.callCount(), 0);
  assert.equal(prompt.mock.callCount(), 0);
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

test('OAuth usa somente authPath explícito, preserva tokens e omite tarifa de API da assinatura', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'akcit-oauth-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const authPath = join(directory, 'auth.json');
  // Token fictício com validade futura evita refresh; a inferência é substituída explicitamente.
  const credentials = { 'openai-codex': { type: 'oauth', access: 'synthetic-access-never-sent',
    refresh: 'synthetic-refresh-never-sent', expires: Date.now() + 60 * 60_000, accountId: 'synthetic' } };
  await writeFile(authPath, JSON.stringify(credentials), { mode: 0o600 });
  const codex = { provider: 'openai-codex', model: 'gpt-5.5' };
  const configured = { 'artifact-curator': codex, 'test-designer': codex, 'output-validator': codex };
  const create = t.mock.method(ModelRuntime, 'create');
  const network = t.mock.method(globalThis, 'fetch', async () => { throw new Error('rede não autorizada no teste'); });
  const prompt = t.mock.method(AgentSession.prototype, 'prompt', async function (this: AgentSession) {
    assert.equal(this.model?.provider, 'openai-codex');
    assert.deepEqual(this.getActiveToolNames(), []);
    assert.deepEqual(this.messages, []);
    answer(this, '{"synthetic":true}');
  });
  await assert.rejects(preflightSpecialists(configured), { code: 'CREDENTIAL_UNAVAILABLE' });
  assert.equal(create.mock.calls[0]!.arguments[0]!.authPath, undefined);
  assert.ok(create.mock.calls[0]!.arguments[0]!.credentials, 'sem caminho, bloquear store pessoal padrão');
  await preflightSpecialists(configured, authPath);
  assert.equal(create.mock.calls[1]!.arguments[0]!.authPath, authPath);
  assert.equal(create.mock.calls[1]!.arguments[0]!.credentials, undefined);
  const output = await executeSpecialistTask({ ...task(), model: codex, authPath });
  assert.equal(create.mock.calls[2]!.arguments[0]!.authPath, authPath);
  assert.deepEqual(output.payload, { synthetic: true });
  assert.equal(output.metadata.usage?.totalTokens, 30);
  assert.equal(Object.hasOwn(output.metadata, 'estimatedCost'), false);
  assert.doesNotMatch(JSON.stringify(output), /synthetic-access|synthetic-refresh|auth\.json/);
  assert.deepEqual(JSON.parse(await readFile(authPath, 'utf8')), credentials);
  assert.equal(network.mock.callCount(), 0);
  assert.equal(prompt.mock.callCount(), 1);
});

test('falha do arquivo OAuth não publica caminho nem conteúdo da credencial', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'akcit-oauth-error-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const authPath = join(directory, 'private-auth.json');
  await writeFile(authPath, '{"openai-codex":"synthetic-private-secret', { mode: 0o600 });
  const prompt = t.mock.method(AgentSession.prototype, 'prompt', async () => { throw new Error('inferência não autorizada no teste'); });
  const codex = { provider: 'openai-codex', model: 'gpt-5.5' };
  for (const operation of [
    () => preflightSpecialists({ 'artifact-curator': codex, 'test-designer': codex, 'output-validator': codex }, authPath),
    () => executeSpecialistTask({ ...task(), model: codex, authPath }),
  ]) {
    await assert.rejects(operation(), (error: unknown) => {
      assert.ok(['MODEL_ERROR', 'CREDENTIAL_UNAVAILABLE'].includes((error as { code: string }).code));
      assert.doesNotMatch(String(error), /synthetic-private-secret|private-auth|akcit-oauth-error/);
      return true;
    });
  }
  assert.equal(prompt.mock.callCount(), 0);
});
