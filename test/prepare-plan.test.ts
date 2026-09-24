import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PreparationCoordinator, type PreparationOptions } from '../src/application/prepare-plan.js';
import { createRun } from '../src/application/runs.js';
import { executePlanCommand, getPlanReview } from '../src/application/plan-approval.js';
import { RunStore } from '../src/storage/runs.js';
import { readConfig } from '../src/config.js';
import { SpecialistError, type SpecialistTask } from '../src/runtime/pi.js';

const original = 'US-01: Reservar itens.\nCA-01: Quantidade inteira de 1 a 10.\nCA-02: Comentário opcional.';
const approved = { status: 'approved', reason: 'Fontes, condições e escopo conferidos.', findings: [] };
const correction = { status: 'changes_requested', reason: 'Corrigir cobertura.', findings: [
  { code: 'COVERAGE', location: 'requirements[0].rules', message: 'Preservar o comentário opcional.' },
] };
const model = { provider: 'test-provider', model: 'test-model' };
const result = (payload: unknown) => ({ payload, metadata: { ...model, durationMs: 1,
  usage: { input: 5, output: 8 }, estimatedCost: 0.001 } });
function source(id: string) { return { artifactId: id, locator: 'L1-L3', quote: original }; }
function curation(id: string) {
  return { requirements: [{ id: 'US-01', statement: 'Reservar itens.', sources: [source(id)], rules: [
    { id: 'CA-01', statement: 'Quantidade inteira de 1 a 10.', sources: [source(id)] },
    { id: 'CA-02', statement: 'Comentário opcional.', sources: [source(id)] },
  ] }], questions: [] };
}
function plan(id: string) {
  return { testPlan: { objective: 'Verificar reserva.', requirementIds: ['US-01'], ruleIds: ['CA-01', 'CA-02'],
    priorities: [{ ruleId: 'CA-01', reason: 'Limites e rejeição.' }], exclusions: [],
    approach: ['Partições e limites inteiros; comentário vazio e informado.'], preconditions: [], sources: [source(id)] } };
}
function normal(task: SpecialistTask) {
  const data = JSON.parse(task.prompt);
  return result(task.role === 'artifact-curator' ? curation(data.artifacts[0].id)
    : task.role === 'test-designer' ? plan(data.artifacts[0].id) : approved);
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
async function setup(t: TestContext, custom: PreparationOptions = {}, env: NodeJS.ProcessEnv = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'akcit-preparation-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new RunStore(dir); await store.initialize();
  const config = readConfig({ DATA_DIR: dir, PI_PROVIDER: model.provider, PI_MODEL: model.model, ...env });
  const calls: SpecialistTask[] = [];
  const coordinator = new PreparationCoordinator(store, config, { modelPreflight: async () => {}, ...custom,
    modelCall: async task => { calls.push(task); return custom.modelCall ? custom.modelCall(task) : normal(task); } });
  const create = async () => (await createRun(store, { name: 'Teste', applicationName: 'Sintética', text: original }, [randomUUID()], { userId: 'owner' })).run.id;
  const id = await create();
  const read = async () => (await store.read(id)).run;
  return { dir, store, coordinator, calls, id, create, read };
}

test('T4.1: caminho OAuth privado chega ao runtime, sem entrar em prompt ou persistência', async t => {
  const authPath = '/private/synthetic/pi/auth.json';
  let preflight = false;
  const h = await setup(t, {
    modelPreflight: async (_models, path) => { assert.equal(path, authPath); preflight = true; },
    modelCall: async task => {
      assert.equal(task.authPath, authPath);
      assert.equal(task.prompt.includes(authPath), false);
      return normal(task);
    },
  }, { PI_AUTH_PATH: authPath });
  await h.coordinator.start(h.id, 'owner'); await h.coordinator.settled();
  assert.equal(preflight, true);
  assert.equal((await h.read()).status, 'awaiting_approval');
  assert.equal(JSON.stringify(await h.read()).includes(authPath), false);
});

test('T4.1: sequência real do coordenador, revisões exatas e aprovação humana separada', async t => {
  const h = await setup(t, { modelCall: async task => {
    const run = await h.read();
    const input = JSON.parse(task.prompt);
    assert.equal(run.preparation?.activeRole, task.role);
    if (task.role === 'test-designer') {
      assert.equal(run.validations[0]?.status, 'approved');
      assert.deepEqual(input.approvedCuration, run.outputs[0]);
      assert.equal(input.artifacts[0].text, original);
    }
    if (task.role === 'output-validator') {
      assert.deepEqual(input.output, run.outputs.at(-1));
      const refusal = await executePlanCommand(h.store, h.id, { type: 'approve_plan',
        outputId: input.output.id, outputRevision: input.output.revision }, { userId: 'owner' });
      assert.equal(refusal.ok, false);
    }
    return normal(task);
  } });
  assert.deepEqual(await h.coordinator.start(h.id, 'owner'), { accepted: true });
  await h.coordinator.settled();
  assert.deepEqual(h.calls.map(call => call.role), ['artifact-curator', 'output-validator', 'test-designer', 'output-validator']);
  const run = await h.read();
  assert.equal(run.status, 'awaiting_approval'); assert.equal(run.phase, 'planning');
  assert.equal(run.approvals.length, 0); assert.equal(run.validations.length, 2);
  assert.deepEqual(run.outputs[1]!.dependsOn, [{ outputId: run.outputs[0]!.id, revision: 1 }]);
  assert.equal(run.budgetCycles.length, 1);
  assert.ok(run.preparation!.calls.every(call => call.status === 'completed' && call.usage?.input === 5 && call.estimatedCost === 0.001));
  const response = await executePlanCommand(h.store, h.id, { type: 'approve_plan', outputId: run.outputs[1]!.id,
    outputRevision: 1 }, { userId: 'owner' });
  assert.ok(response.ok); assert.equal((await h.read()).status, 'awaiting_approval');
  assert.deepEqual(await h.coordinator.start(h.id, 'owner'), { accepted: false });
  assert.equal(h.calls.length, 4);
});

test('T4.1: correção mantém ID, fontes, histórico e dependência da revisão aprovada', async t => {
  let review = 0;
  const h = await setup(t, { modelCall: async task => {
    if (task.role === 'output-validator' && ++review === 1) return result(correction);
    if (task.role === 'artifact-curator' && h.calls.length > 1) {
      const input = JSON.parse(task.prompt);
      assert.equal(input.previousOutput.revision, 1); assert.deepEqual(input.feedback, correction);
    }
    return normal(task);
  } });
  await h.coordinator.start(h.id, 'owner'); await h.coordinator.settled();
  const run = await h.read();
  assert.equal(run.status, 'awaiting_approval');
  assert.deepEqual(run.outputs.map(output => output.revision), [1, 2, 1]);
  assert.equal(run.outputs[0]!.id, run.outputs[1]!.id);
  assert.equal(run.outputs[2]!.dependsOn[0]!.revision, 2);
  assert.deepEqual(run.validations.map(item => item.status), ['changes_requested', 'approved', 'approved']);
});

test('T4.1: parecer inválido consome duas tentativas, registra error e nunca avança', async t => {
  const h = await setup(t, { modelCall: async task => task.role === 'output-validator'
    ? result({ ...approved, status: 'maybe' }) : normal(task) });
  await h.coordinator.start(h.id, 'owner'); await h.coordinator.settled();
  const run = await h.read();
  assert.equal(run.status, 'interrupted'); assert.equal(run.preparation!.stopReason!.code, 'VALIDATOR_LIMIT');
  assert.deepEqual(run.validations.map(item => item.status), ['error', 'error']);
  assert.equal(h.calls.length, 3); assert.equal(run.outputs.length, 1);
});

test('T4.1: JSON inválido e rejeições não reiniciam o orçamento de três produções', async t => {
  for (const invalid of [true, false]) {
    const h = await setup(t, { modelCall: async task => invalid
      ? result({ bad: 'JSON estruturalmente inválido' }) : task.role === 'output-validator' ? result(correction) : normal(task) });
    await h.coordinator.start(h.id, 'owner'); await h.coordinator.settled();
    const run = await h.read();
    assert.equal(run.status, 'interrupted'); assert.equal(run.preparation!.stopReason!.code, 'REVISION_LIMIT');
    assert.equal(run.budgetCycles.length, 1); assert.equal(run.outputs.length, invalid ? 0 : 3);
    assert.equal(h.calls.filter(call => call.role === 'artifact-curator').length, 3);
    assert.deepEqual(await h.coordinator.start(h.id, 'owner'), { accepted: false });
  }
});

test('T4.1: início concorrente é idempotente e outro rascunho permanece intacto', async t => {
  const entered = deferred<void>(); const release = deferred<void>();
  const h = await setup(t, { modelCall: async task => { entered.resolve(); await release.promise; return normal(task); } });
  const second = await h.create(); const originalDraft = await h.store.read(second);
  const starts = await Promise.all([h.coordinator.start(h.id, 'owner'), h.coordinator.start(h.id, 'owner')]);
  assert.deepEqual(starts, [{ accepted: true }, { accepted: false }]); await entered.promise;
  await assert.rejects(h.coordinator.start(second, 'owner'), { code: 'RESOURCE_UNAVAILABLE' });
  assert.deepEqual(await h.store.read(second), originalDraft); assert.equal(h.calls.length, 1);
  release.resolve(); await h.coordinator.settled();
  assert.equal((await h.read()).budgetCycles.length, 1);
  await h.coordinator.start(second, 'owner'); await h.coordinator.settled();
});

test('T4.1: cancelamento persiste e aborta; resposta tardia não avança nem libera reserva cedo', async t => {
  const entered = deferred<SpecialistTask>(); const release = deferred<void>();
  const h = await setup(t, { modelCall: async task => { entered.resolve(task); await release.promise; return normal(task); } });
  await h.coordinator.start(h.id, 'owner'); const task = await entered.promise;
  await h.coordinator.cancel(h.id, 'owner');
  assert.equal(task.signal.aborted, true); assert.equal((await h.read()).status, 'cancelled');
  assert.equal((await h.read()).preparation!.calls[0]!.status, 'cancelled');
  const second = await h.create();
  await assert.rejects(h.coordinator.start(second, 'owner'), { code: 'RESOURCE_UNAVAILABLE' });
  release.resolve(); await h.coordinator.settled();
  const run = await h.read();
  assert.equal(run.status, 'cancelled'); assert.equal(run.outputs.length, 0); assert.equal(h.calls.length, 1);
  assert.equal(run.preparation!.calls[0]!.status, 'cancelled');
  await h.coordinator.cancel(h.id, 'owner');
  assert.deepEqual(await h.coordinator.start(h.id, 'owner'), { accepted: false });
});

test('T4.1: timeout aborta chamada de validação e falha técnica não autoriza planejamento', async t => {
  let aborts = 0;
  const h = await setup(t, { limits: { timeoutMs: 15 }, modelCall: async task => {
    if (task.role !== 'output-validator') return normal(task);
    await new Promise<void>(resolve => task.signal.addEventListener('abort', () => { aborts++; resolve(); }, { once: true }));
    return result(approved); // Simula resposta tardia depois do abort.
  } });
  await h.coordinator.start(h.id, 'owner'); await h.coordinator.settled();
  const run = await h.read();
  assert.equal(aborts, 2); assert.equal(run.status, 'error');
  assert.equal(run.preparation!.stopReason!.code, 'TIMEOUT');
  assert.deepEqual(run.validations.map(item => item.status), ['error', 'error']);
  assert.equal(run.outputs.length, 1);
});

test('T4.1: orçamento ativo e limite de dez US interrompem sem truncar', async t => {
  let time = Date.now();
  const h = await setup(t, { now: () => time, limits: { activeMs: 100 }, modelCall: async task => { time += 101; return normal(task); } });
  await h.coordinator.start(h.id, 'owner'); await h.coordinator.settled();
  assert.equal((await h.read()).preparation!.stopReason!.code, 'ACTIVE_LIMIT');
  assert.equal((await h.read()).status, 'interrupted'); assert.equal(h.calls.length, 1);
  const big = await setup(t, { modelCall: async task => {
    const id = JSON.parse(task.prompt).artifacts[0].id;
    return result({ requirements: Array.from({ length: 11 }, (_, i) => ({ ...curation(id).requirements[0], id: `US-${i}` })), questions: [] });
  } });
  await big.coordinator.start(big.id, 'owner'); await big.coordinator.settled();
  assert.equal((await big.read()).preparation!.stopReason!.code, 'INPUT_LIMIT'); assert.equal(big.calls.length, 1);
});

test('T4.1: pergunta localizada permite trabalho independente; sem ele aguarda entrada', async t => {
  for (const independent of [true, false]) {
    const h = await setup(t, { modelCall: async task => {
      if (task.role !== 'artifact-curator') return normal(task);
      const id = JSON.parse(task.prompt).artifacts[0].id;
      const content = curation(id);
      if (independent) content.requirements.push({ id: 'US-02', statement: 'Item sem regra.', rules: [], sources: [source(id)] });
      return result({ ...content, questions: [{ id: 'Q-01', description: 'Qual a regra ausente?',
        requirementIds: [independent ? 'US-02' : 'US-01'], caseIds: [], blocking: true, sources: [source(id)] }] });
    } });
    await h.coordinator.start(h.id, 'owner'); await h.coordinator.settled();
    const run = await h.read();
    assert.equal(run.status, independent ? 'awaiting_approval' : 'awaiting_input');
    assert.equal(run.questions.length, 1); assert.equal(h.calls.length, independent ? 4 : 2);
    const review = await getPlanReview(h.store, h.id, { userId: 'owner' });
    assert.ok(review.ok); assert.equal(review.review.questions[0]!.id, 'Q-01');
  }
});

test('T4.1: bloqueio independente não vira aprovação nem planejamento', async t => {
  const h = await setup(t, { modelCall: async task => task.role === 'output-validator'
    ? result({ ...correction, status: 'blocked' }) : normal(task) });
  await h.coordinator.start(h.id, 'owner'); await h.coordinator.settled();
  assert.equal((await h.read()).status, 'interrupted'); assert.equal(h.calls.length, 2);
});

test('T4.1: configuração/credencial ausentes, modelo indisponível e estado inválido não iniciam', async t => {
  for (const env of [{ PI_PROVIDER: '' }, { PI_VALIDATOR_MODEL: 'incomplete' }]) {
    const h = await setup(t, {}, env);
    await assert.rejects(h.coordinator.start(h.id, 'owner'), { code: 'MODEL_NOT_CONFIGURED' });
    assert.equal((await h.read()).status, 'draft'); assert.equal(h.calls.length, 0);
  }
  for (const code of ['CREDENTIAL_UNAVAILABLE', 'MODEL_UNAVAILABLE'] as const) {
    const h = await setup(t, { modelPreflight: async () => { throw new SpecialistError(code, 'Configuração indisponível.'); } });
    await assert.rejects(h.coordinator.start(h.id, 'owner'), { code });
    assert.equal((await h.read()).budgetCycles.length, 0);
  }
  const h = await setup(t);
  await assert.rejects(h.coordinator.start(h.id, 'stranger'), { code: 'RUN_NOT_FOUND' });
  await assert.rejects(h.coordinator.cancel(h.id, 'stranger'), { code: 'RUN_NOT_FOUND' });
  await h.coordinator.cancel(h.id, 'owner');
  await assert.rejects(h.coordinator.start(h.id, 'owner'), { code: 'INVALID_STATE' });
});

test('T4.1: reinício preserva saída confirmada e impede resposta antiga/retomada', async t => {
  const entered = deferred<void>(); const release = deferred<void>();
  const h = await setup(t, { modelCall: async task => {
    if (task.role === 'output-validator') { entered.resolve(); await release.promise; }
    return normal(task);
  } });
  await h.coordinator.start(h.id, 'owner'); await entered.promise;
  const output = (await h.read()).outputs[0];
  const reopened = new RunStore(h.dir); assert.equal(await reopened.recoverInterrupted(), 1);
  const recovered = (await reopened.read(h.id)).run;
  assert.equal(recovered.status, 'interrupted'); assert.deepEqual(recovered.outputs[0], output);
  assert.equal(recovered.preparation!.calls.at(-1)!.status, 'interrupted');
  release.resolve(); await h.coordinator.settled();
  assert.deepEqual(await h.read(), recovered);
  assert.deepEqual(await h.coordinator.start(h.id, 'owner'), { accepted: false });
  assert.equal(h.calls.length, 2);
});

test('T4.1: metadados adicionais inválidos são recusados sem substituir registro', async t => {
  const h = await setup(t); await h.coordinator.start(h.id, 'owner'); await h.coordinator.settled();
  const path = join(h.dir, 'runs', `${h.id}.json`);
  const record = JSON.parse(await readFile(path, 'utf8'));
  record.run.preparation.limits.timeoutMs = -1;
  await writeFile(path, JSON.stringify(record));
  await assert.rejects(h.store.read(h.id), { code: 'INVALID_RECORD' });
});

test('T4.1: prazo ativo aborta chamada em andamento, preserva consumo de erro e não avança', async t => {
  let wasAborted = false;
  const h = await setup(t, { limits: { activeMs: 40 }, modelCall: async task => {
    await new Promise<void>(resolve => {
      if (task.signal.aborted) return resolve();
      task.signal.addEventListener('abort', () => resolve(), { once: true });
    });
    wasAborted = task.signal.aborted;
    throw new SpecialistError('CANCELLED', 'Chamada encerrada.', result({}).metadata);
  } });
  await h.coordinator.start(h.id, 'owner'); await h.coordinator.settled();
  const run = await h.read();
  assert.equal(wasAborted, true); assert.equal(run.status, 'interrupted');
  assert.equal(run.preparation!.stopReason!.code, 'ACTIVE_LIMIT');
  assert.equal(run.preparation!.calls[0]!.usage!.output, 8);
  assert.equal(run.preparation!.calls[0]!.estimatedCost, 0.001);
  assert.equal(run.outputs.length, 0); assert.equal(h.calls.length, 1);
});

test('T4.1: falha de armazenamento após salvar parecer não repete validação', async t => {
  const h = await setup(t);
  const { StorageError } = await import('../src/storage/runs.js');
  const update = h.store.update.bind(h.store);
  let injected = false;
  t.mock.method(h.store, 'update', async (...args: Parameters<typeof h.store.update>) => {
    const value = await update(...args);
    if (!injected && (await h.read()).validations.length === 1) {
      injected = true; throw new StorageError('STORAGE_FAILURE');
    }
    return value;
  });
  await h.coordinator.start(h.id, 'owner'); await h.coordinator.settled();
  const run = await h.read();
  assert.equal(run.status, 'error'); assert.equal(run.preparation!.stopReason!.code, 'STORAGE_FAILURE');
  assert.equal(run.validations.length, 1); assert.equal(h.calls.length, 2);
  assert.equal(run.outputs.length, 1);
});
