import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { createApp } from '../src/app.js';
import { executePlanCommand } from '../src/application/plan-approval.js';
import { readConfig } from '../src/config.js';
import { RunStore, type RunRecord, type StoredRun } from '../src/storage/runs.js';

// Somente dados sintéticos; estes testes não usam modelo, Pi, VPS ou navegador.
const fixture = JSON.parse(readFileSync(new URL(
  '../docs/requisitos/exemplos/execucao-demo.json', import.meta.url,
), 'utf8')) as { fixture: boolean; run: RunRecord };
assert.equal(fixture.fixture, true);
const plan = fixture.run.outputs.find(output => output.phase === 'planning')!;
const curation = fixture.run.outputs.find(output => output.phase === 'curation')!;
assert.ok(plan);
assert.ok(curation);
const reference = { outputId: plan.id, outputRevision: plan.revision };
const approve = { type: 'approve_plan', ...reference } as const;
const changes = { type: 'request_plan_changes', ...reference, comment: 'Rever os limites da quantidade.' } as const;
const proceed = { type: 'continue', ...reference } as const;
const owner = { userId: 'storage-test-owner' };
type Request = Parameters<typeof executePlanCommand>[2];
type Context = Parameters<typeof executePlanCommand>[3];
type Result = Awaited<ReturnType<typeof executePlanCommand>>;

function waiting(id = 'run-test'): RunRecord {
  const run = structuredClone(fixture.run);
  return {
    ...run, id, ownerId: owner.userId, status: 'awaiting_approval', phase: 'planning',
    approvals: run.approvals.filter(decision => decision.outputId !== plan.id),
    questions: [{ id: 'question-test', description: 'Qual o limite?', requirementIds: ['US-01'], caseIds: [], blocking: false, sources: [] }],
    answers: [{ questionId: 'question-test', revision: 1, actorId: owner.userId, at: '2026-09-23T12:00:00Z', text: 'Até dez.', affectedCaseIds: [] }],
    extraHistory: [{ event: 'synthetic-note', content: { preserved: true } }],
  };
}

async function temporaryStore(t: TestContext) {
  const dataDir = await fs.mkdtemp(join(tmpdir(), 'akcit-plan-storage-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const store = new RunStore(dataDir);
  await store.initialize();
  const file = (id = 'run-test') => join(dataDir, 'runs', `${id}.json`);
  const raw = (id = 'run-test') => fs.readFile(file(id), 'utf8');
  async function reopen(id = 'run-test') {
    const reopened = new RunStore(dataDir);
    await reopened.initialize();
    const record = await reopened.read(id);
    assert.deepEqual(record, JSON.parse(await raw(id)), 'a leitura deve refletir o arquivo salvo');
    return record;
  }
  return { dataDir, store, file, raw, reopen };
}

function success(result: Result) {
  assert.ok(result.ok, JSON.stringify(result));
  return result;
}

function refusal(result: Result, code: string) {
  assert.equal(result.ok, false);
  assert.ok(!result.ok);
  assert.equal(result.error.code, code);
  assert.equal(result.work, null);
  assert.deepEqual(Object.keys(result).sort(), ['error', 'ok', 'work'], 'recusa não devolve execução ou documentos');
  return result;
}

function utc(at: string) {
  assert.equal(new Date(at).toISOString(), at);
}

test('T3.1 CA-01/02: decisões sobrevivem à reabertura e preservam o registro completo', async t => {
  const { store, reopen } = await temporaryStore(t);
  for (const request of [approve, changes]) {
    const run = waiting(request.type);
    await store.create(run);
    const started = Date.now();
    const result = success(await executePlanCommand(store, run.id, request, owner));
    const stored = await reopen(run.id);
    const decision = stored.run.approvals.at(-1)!;
    assert.match(decision.id, /^[0-9a-f-]{36}$/i);
    utc(decision.at);
    assert.ok(Date.parse(decision.at) >= started && Date.parse(decision.at) <= Date.now());
    assert.deepEqual(decision, {
      id: decision.id, at: decision.at, actorId: owner.userId, ...reference,
      decision: request.type === 'approve_plan' ? 'approved' : 'changes_requested',
      comment: request.type === 'request_plan_changes' ? request.comment : '',
    });
    assert.deepEqual(stored, {
      schemaVersion: 1, run: { ...run, approvals: [...run.approvals, decision] }, workIntents: [],
    });
    assert.equal(result.work, null);
    assert.deepEqual(result.approvals, stored.run.approvals);
    success(await executePlanCommand(store, run.id, request, owner));
    assert.deepEqual(await reopen(run.id), stored, 'repetição preserva decisão e horário originais');
  }
});

test('T3.1 CA-04: só o proprietário interno decide; campos externos não escolhem autor ou reserva', async t => {
  const { store, raw, reopen } = await temporaryStore(t);
  await store.create(waiting());
  const before = await raw();
  for (const context of [{ userId: 'another-user' }, { userId: '' }, {}]) {
    refusal(await executePlanCommand(store, 'run-test', approve, context as Context), 'UNAUTHORIZED');
    assert.equal(await raw(), before);
  }
  const forged = {
    ...approve, id: 'client-id', actorId: 'client-actor', at: '2000-01-01T00:00:00Z',
    status: 'running', validations: [], resourceReserved: true,
  };
  success(await executePlanCommand(store, 'run-test', forged, owner));
  const approved = await reopen();
  const decision = approved.run.approvals.at(-1)!;
  assert.equal(decision.actorId, owner.userId);
  assert.notEqual(decision.id, forged.id);
  assert.notEqual(decision.at, forged.at);
  refusal(await executePlanCommand(store, 'run-test', { ...proceed, resourceReserved: true } as Request, owner), 'RESOURCE_UNAVAILABLE');
  assert.deepEqual(await reopen(), approved);
});

test('T3.1 CA-05/06: aprovação e pedido aguardam reserva; continuidade salva estado e intenção juntos', async t => {
  const { store, reopen, raw } = await temporaryStore(t);
  for (const request of [approve, changes]) {
    const id = request.type;
    await store.create(waiting(id));
    success(await executePlanCommand(store, id, request, { ...owner, resourceReserved: false }));
    const decided = await reopen(id);
    const before = await raw(id);
    for (const context of [owner, { ...owner, resourceReserved: false }]) {
      refusal(await executePlanCommand(store, id, proceed, context), 'RESOURCE_UNAVAILABLE');
      assert.equal(await raw(id), before);
      assert.deepEqual(await reopen(id), decided);
    }
    const continued = success(await executePlanCommand(store, id, proceed, { ...owner, resourceReserved: true }));
    const saved = await reopen(id);
    const intent = saved.workIntents[0]!;
    assert.equal(saved.workIntents.length, 1);
    assert.match(intent.id, /^[0-9a-f-]{36}$/i);
    utc(intent.createdAt);
    assert.deepEqual(intent, {
      id: intent.id, createdAt: intent.createdAt, ...reference, status: 'pending',
      type: request.type === 'approve_plan' ? 'create_cases' : 'analyze_feedback',
    });
    assert.deepEqual(saved.run, {
      ...decided.run, status: 'running', phase: request.type === 'approve_plan' ? 'case_design' : 'planning',
    });
    assert.deepEqual(continued.work, intent);
    refusal(await executePlanCommand(store, id, proceed, { ...owner, resourceReserved: true }), 'INVALID_STATE');
    assert.deepEqual(await reopen(id), saved);
  }
});

test('T3.1 CA-03: escolhe a maior revisão em ordem adversa e lê pareceres atuais do disco', async t => {
  const { store, raw, reopen } = await temporaryStore(t);
  const run = waiting();
  const oldDecision = fixture.run.approvals.find(decision => decision.outputId === plan.id)!;
  run.approvals.push(structuredClone(oldDecision));
  run.outputs = [
    { ...structuredClone(plan), revision: 2, dependsOn: [{ outputId: curation.id, revision: 2 }] },
    { ...structuredClone(curation), revision: 2 }, ...run.outputs.reverse(),
  ];
  await store.create(run);
  const before = await raw();
  refusal(await executePlanCommand(store, run.id, approve, owner), 'STALE_VERSION');
  const approve2 = { ...approve, outputRevision: 2 };
  refusal(await executePlanCommand(store, run.id, approve2, owner), 'INSUFFICIENT_VALIDATION');
  assert.equal(await raw(), before);
  await store.update(run.id, record => {
    record.run.validations = [...record.run.validations, ...[plan.id, curation.id].map(outputId => ({
      id: `validation-2-${outputId}`, outputId, outputRevision: 2,
      validator: 'output-validator', status: 'approved' as const, findings: [], reason: 'Sintético.',
    }))];
    return { value: undefined, save: true };
  });
  refusal(await executePlanCommand(store, run.id, { ...proceed, outputRevision: 2 }, { ...owner, resourceReserved: true }), 'DECISION_MISSING');
  success(await executePlanCommand(store, run.id, approve2, owner));
  const saved = await reopen();
  assert.deepEqual(saved.run.approvals.slice(0, -1), run.approvals);
  assert.equal(saved.run.approvals.at(-1)?.outputRevision, 2);
  assert.deepEqual(saved.run.outputs, run.outputs);
});

test('T3.1 CA-03: curadoria nova invalida dependência antiga; versões inválidas não avançam', async t => {
  const { store, raw, reopen } = await temporaryStore(t);
  const newerCuration = waiting('new-curation');
  newerCuration.outputs.unshift({ ...structuredClone(curation), revision: 2 });
  await store.create(newerCuration);
  refusal(await executePlanCommand(store, newerCuration.id, approve, owner), 'STALE_VERSION');
  assert.deepEqual((await reopen(newerCuration.id)).run, newerCuration);
  await store.create(waiting());
  const before = await raw();
  for (const outputRevision of [0, -1, 0.5, 99, NaN, Infinity]) {
    refusal(await executePlanCommand(store, 'run-test', { ...approve, outputRevision }, owner), 'STALE_VERSION');
    assert.equal(await raw(), before);
  }
  const invalid = waiting('invalid-plan-revision');
  invalid.outputs.find(output => output.phase === 'planning')!.revision = 0.5;
  await store.create(invalid);
  refusal(await executePlanCommand(store, invalid.id, { ...approve, outputRevision: 0.5 }, owner), 'STALE_VERSION');
  assert.deepEqual((await reopen(invalid.id)).run, invalid);
});

test('T3.1 CA-03: IDs concorrentes e revisões duplicadas do plano ou curadoria são ambíguos', async t => {
  const { store, reopen } = await temporaryStore(t);
  for (const output of [plan, curation]) {
    for (const duplicateId of [output.id, `${output.id}-competitor`]) {
      const run = waiting(`${output.phase}-${duplicateId}`);
      run.outputs.unshift({ ...structuredClone(output), id: duplicateId });
      await store.create(run);
      refusal(await executePlanCommand(store, run.id, approve, owner), 'AMBIGUOUS_RECORD');
      assert.deepEqual(await reopen(run.id), { schemaVersion: 1, run, workIntents: [] });
    }
  }
});

test('T3.1 CA-03: recusas preservam os códigos do domínio e nunca gravam dados', async t => {
  const { store, raw } = await temporaryStore(t);
  await store.create(waiting());
  const before = await raw();
  refusal(await executePlanCommand(store, 'run-test', { ...changes, comment: '  ' }, owner), 'COMMENT_REQUIRED');
  refusal(await executePlanCommand(store, 'run-test', proceed, { ...owner, resourceReserved: true }), 'DECISION_MISSING');
  assert.equal(await raw(), before);
  await store.update('run-test', record => {
    record.run.validations = record.run.validations.filter(validation => validation.outputId !== plan.id);
    return { value: undefined, save: true };
  });
  const withoutVerdict = await raw();
  refusal(await executePlanCommand(store, 'run-test', approve, owner), 'INSUFFICIENT_VALIDATION');
  assert.equal(await raw(), withoutVerdict);
});

test('T3.1 CA-07: repetições concorrentes entre instâncias preservam ID e horário e criam uma intenção', async t => {
  const { store, dataDir, reopen, raw } = await temporaryStore(t);
  await store.create(waiting());
  const other = new RunStore(dataDir);
  await other.initialize();
  const results = await Promise.all(Array.from({ length: 12 }, (_, i) =>
    executePlanCommand(i % 2 ? store : other, 'run-test', approve, owner)));
  results.forEach(success);
  const decided = await reopen();
  assert.equal(decided.run.approvals.filter(decision => decision.outputId === plan.id).length, 1);
  for (const result of results) assert.deepEqual(success(result).approvals, decided.run.approvals);
  const before = await raw();
  success(await executePlanCommand(other, 'run-test', approve, owner));
  assert.equal(await raw(), before, 'repetição não regrava nem substitui horário/identificador');
  const continuations = await Promise.all(Array.from({ length: 12 }, (_, i) =>
    executePlanCommand(i % 2 ? store : other, 'run-test', proceed, { ...owner, resourceReserved: true })));
  assert.equal(continuations.filter(result => result.ok).length, 1);
  continuations.filter(result => !result.ok).forEach(result => refusal(result, 'INVALID_STATE'));
  const saved = await reopen();
  assert.equal(saved.run.status, 'running');
  assert.deepEqual(saved.run.approvals, decided.run.approvals);
  assert.equal(saved.workIntents.length, 1);
  assert.deepEqual(saved.workIntents[0], success(continuations.find(result => result.ok)!).work);
});

test('T3.1 CA-07: decisões concorrentes conflitantes não se sobrescrevem', async t => {
  const { store, dataDir, reopen } = await temporaryStore(t);
  await store.create(waiting());
  const results = await Promise.all([
    executePlanCommand(store, 'run-test', approve, owner),
    executePlanCommand(new RunStore(dataDir), 'run-test', changes, owner),
  ]);
  assert.equal(results.filter(result => result.ok).length, 1);
  refusal(results.find(result => !result.ok)!, 'DECISION_CONFLICT');
  const saved = await reopen();
  assert.deepEqual(saved.run.approvals, success(results.find(result => result.ok)!).approvals);
  assert.equal(saved.run.approvals.filter(decision => decision.outputId === plan.id).length, 1);
  assert.deepEqual(saved.workIntents, []);
});

test('T3.1 CA-07: caminho de atualização protege leitura, mudança e gravação entre instâncias', async t => {
  const { store, dataDir, reopen } = await temporaryStore(t);
  await store.create({ ...waiting(), updateCount: 0 });
  await Promise.all(Array.from({ length: 12 }, () => new RunStore(dataDir).update('run-test', async record => {
    const count = record.run.updateCount as number;
    await new Promise<void>(resolve => setImmediate(resolve));
    record.run.updateCount = count + 1;
    return { value: undefined, save: true };
  })));
  assert.equal((await reopen()).run.updateCount, 12);
  await store.update('run-test', record => {
    record.run.status = 'cancelled';
    return { value: undefined, save: true };
  });
  refusal(await executePlanCommand(new RunStore(dataDir), 'run-test', approve, owner), 'INVALID_STATE');
  assert.equal((await reopen()).run.status, 'cancelled');
});

test('T3.1 CA-08: falha anterior à renomeação preserva arquivo, decisão e ausência de intenção', async t => {
  const { store, raw, reopen, dataDir } = await temporaryStore(t);
  await store.create(waiting());
  for (const request of [approve, proceed]) {
    const before = await raw();
    const rename = t.mock.method(fs, 'rename', async () => { throw new Error('simulated write failure'); });
    try {
      refusal(await executePlanCommand(store, 'run-test', request, { ...owner, resourceReserved: true }), 'STORAGE_FAILURE');
    } finally {
      rename.mock.restore();
    }
    assert.equal(await raw(), before);
    assert.equal((await reopen()).workIntents.length, 0);
    assert.deepEqual(await fs.readdir(join(dataDir, 'runs')), ['run-test.json']);
    if (request.type === 'approve_plan') success(await executePlanCommand(store, 'run-test', approve, owner));
  }
});

test('T3.1 CA-08: arquivo inválido não vira execução vazia nem é sobrescrito por criação', async t => {
  const { store, dataDir, file, raw } = await temporaryStore(t);
  await store.create(waiting());
  for (const contents of ['{invalid-json', JSON.stringify({ schemaVersion: 2, run: waiting(), workIntents: [] }), JSON.stringify({ schemaVersion: 1, run: {}, workIntents: [] })]) {
    await fs.writeFile(file(), contents);
    await assert.rejects(store.read('run-test'), { code: 'INVALID_RECORD' });
    refusal(await executePlanCommand(store, 'run-test', approve, owner), 'INVALID_RECORD');
    await assert.rejects(createApp(readConfig({ DATA_DIR: dataDir })), { code: 'INVALID_RECORD' });
    await assert.rejects(store.create(waiting()), { code: 'RUN_EXISTS' });
    assert.equal(await raw(), contents);
  }
});

test('T3.1 CA-08: números não finitos não criam nem substituem um registro por JSON ilegível', async t => {
  const { store, dataDir, file, raw, reopen } = await temporaryStore(t);
  await store.create(waiting());
  const before = await raw();
  const mutate: ((run: RunRecord, value: number) => void)[] = [
    (run, value) => { run.outputs[0]!.revision = value; },
    (run, value) => { run.outputs.find(output => output.phase === 'planning')!.dependsOn[0]!.revision = value; },
    (run, value) => { run.approvals = run.approvals.map(decision => ({ ...decision, outputRevision: value })); },
    (run, value) => { run.validations = run.validations.map(verdict => ({ ...verdict, outputRevision: value })); },
  ];
  for (const value of [NaN, Infinity, -Infinity]) {
    for (const change of mutate) {
      const invalid = waiting('non-finite');
      change(invalid, value);
      await assert.rejects(store.create(invalid), { code: 'INVALID_RECORD' });
      await assert.rejects(fs.access(file(invalid.id)), { code: 'ENOENT' });
      await assert.rejects(store.update('run-test', record => {
        change(record.run, value);
        return { value: undefined, save: true };
      }), { code: 'INVALID_RECORD' });
      assert.equal(await raw(), before);
    }
  }
  assert.deepEqual((await reopen()).run, waiting());
  assert.deepEqual(await fs.readdir(join(dataDir, 'runs')), ['run-test.json']);
});

test('T3.1: criação exclusiva, IDs seguros, permissões privadas e erros de acesso identificáveis', async t => {
  const { store, dataDir, file, raw, reopen } = await temporaryStore(t);
  const run = waiting();
  const creates = await Promise.allSettled([store.create(run), new RunStore(dataDir).create(run)]);
  assert.equal(creates.filter(result => result.status === 'fulfilled').length, 1);
  const rejected = creates.find(result => result.status === 'rejected');
  assert.ok(rejected?.status === 'rejected');
  assert.equal(rejected.reason.code, 'RUN_EXISTS');
  assert.deepEqual((await reopen()).run, run);
  const before = await raw();
  await assert.rejects(store.create({ ...run, status: 'cancelled' }), { code: 'RUN_EXISTS' });
  assert.equal(await raw(), before);
  for (const id of ['', '..', '../outside', 'a/b', 'a\\b', '/absolute', 'bad\0id']) {
    await assert.rejects(store.read(id), { code: 'INVALID_RUN_ID' });
    await assert.rejects(store.create(waiting(id)), { code: 'INVALID_RUN_ID' });
    await assert.rejects(store.update(id, () => ({ value: undefined, save: true })), { code: 'INVALID_RUN_ID' });
  }
  assert.equal((await fs.stat(dataDir)).mode & 0o777, 0o700);
  assert.equal((await fs.stat(join(dataDir, 'runs'))).mode & 0o777, 0o700);
  assert.equal((await fs.stat(file())).mode & 0o777, 0o600);
  refusal(await executePlanCommand(store, 'missing', approve, owner), 'RUN_NOT_FOUND');
  const open = t.mock.method(fs, 'open', async () => { throw Object.assign(new Error('private-document-secret'), { code: 'EACCES' }); });
  try {
    const result = refusal(await executePlanCommand(store, run.id, approve, owner), 'RUN_INACCESSIBLE');
    assert.doesNotMatch(result.error.message, /private-document-secret/);
  } finally {
    open.mock.restore();
  }
  assert.equal(await raw(), before);
});

test('T3.1: link simbólico de execução é recusado sem ler ou sobrescrever o destino', async t => {
  const { store, dataDir, file } = await temporaryStore(t);
  const contents = JSON.stringify({ schemaVersion: 1, run: waiting('linked-run'), workIntents: [] });
  const outside = join(dataDir, 'outside-runs.json');
  await fs.writeFile(outside, contents, { mode: 0o600 });
  await fs.symlink(outside, file('linked-run'));
  await assert.rejects(store.read('linked-run'), { code: 'RUN_INACCESSIBLE' });
  refusal(await executePlanCommand(store, 'linked-run', approve, owner), 'RUN_INACCESSIBLE');
  await assert.rejects(store.create(waiting('linked-run')), { code: 'RUN_EXISTS' });
  assert.equal(await fs.readFile(outside, 'utf8'), contents);
  assert.equal((await fs.lstat(file('linked-run'))).isSymbolicLink(), true);
});

test('T3.1 CA-09: recuperação persiste interrupção, conserva históricos e é repetível', async t => {
  const { store, reopen, raw } = await temporaryStore(t);
  await store.create(waiting());
  success(await executePlanCommand(store, 'run-test', approve, owner));
  success(await executePlanCommand(store, 'run-test', proceed, { ...owner, resourceReserved: true }));
  const originalInterruption = { reason: 'service_restart' as const, at: '2026-09-22T10:00:00.000Z' };
  await store.update('run-test', record => {
    record.run.interruptions = [originalInterruption];
    record.workIntents.unshift({ ...record.workIntents[0]!, id: 'historical-intent', status: 'interrupted', interruption: originalInterruption });
    return { value: undefined, save: true };
  });
  const running = await reopen();
  const unchanged: StoredRun[] = [];
  for (const status of ['draft', 'awaiting_approval', 'awaiting_input', 'completed', 'interrupted', 'error', 'cancelled']) {
    await store.create({ ...waiting(status), status });
    unchanged.push(await reopen(status));
  }
  assert.equal(await store.recoverInterrupted(), 1);
  const recovered = await reopen();
  const interruption = recovered.run.interruptions!.at(-1)!;
  assert.equal(interruption.reason, 'service_restart');
  utc(interruption.at);
  assert.deepEqual(recovered.run, { ...running.run, status: 'interrupted', interruptions: [originalInterruption, interruption] });
  assert.deepEqual(recovered.workIntents[0], running.workIntents[0]);
  assert.deepEqual(recovered.workIntents[1], { ...running.workIntents[1], status: 'interrupted', interruption });
  const after = await raw();
  assert.equal(await store.recoverInterrupted(), 0);
  assert.equal(await raw(), after, 'segunda recuperação preserva a interrupção original');
  for (const record of unchanged) assert.deepEqual(await reopen(record.run.id), record);
});

test('T3.1 CA-09/10: createApp recupera antes de servir, entrega site/health e não carrega fixture', async t => {
  const { store, dataDir, reopen } = await temporaryStore(t);
  await store.create(waiting());
  success(await executePlanCommand(store, 'run-test', approve, owner));
  success(await executePlanCommand(store, 'run-test', proceed, { ...owner, resourceReserved: true }));
  const app = await createApp(readConfig({ DATA_DIR: dataDir, PORT: '0' }));
  const recovered = await reopen();
  assert.equal(recovered.run.status, 'interrupted', 'recuperação conclui antes de createApp retornar');
  assert.equal(recovered.workIntents[0]?.status, 'interrupted');
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  t.after(async () => { app.close(); await once(app, 'close'); });
  const address = app.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}`;
  const home = await fetch(url, { redirect: 'manual' });
  assert.equal(home.status, 302);
  assert.equal(home.headers.get('location'), '/execucoes');
  const site = await fetch(`${url}/execucoes`);
  assert.equal(site.status, 200);
  assert.match(await site.text(), /<script src="\/web\/app\.js" defer><\/script>/);
  assert.deepEqual(await (await fetch(`${url}/healthz`)).json(), {
    status: 'ok', environment: 'local', revision: 'local', stage: 'environment-ready',
  });
  assert.equal((await fetch(`${url}/api/runs/run-test/approve`, { method: 'POST' })).status, 503);
  assert.deepEqual(await fs.readdir(join(dataDir, 'runs')), ['run-test.json']);
  const empty = await temporaryStore(t);
  await createApp(readConfig({ DATA_DIR: empty.dataDir, PORT: '0' }));
  assert.deepEqual(await fs.readdir(join(empty.dataDir, 'runs')), []);
});
