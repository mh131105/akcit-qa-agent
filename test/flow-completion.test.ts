import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readConfig } from '../src/config.js';
import { RunStore, type RunOutput } from '../src/storage/runs.js';
import { createRun } from '../src/application/runs.js';
import { configureTargetAccess } from '../src/application/target-access.js';
import { PreparationCoordinator, latestOutput } from '../src/application/prepare-plan.js';
import { executeApprovalCommand, getPlanReview } from '../src/application/plan-approval.js';

const text = 'Quantidade inteira entre 1 e 10 cria uma reserva; quantidade fora do intervalo é rejeitada.';
const approved = { status: 'approved', reason: 'Fontes, expectativas e evidências conferidas.', findings: [] };
const model = { provider: 'mock', model: 'controlled', thinkingLevel: 'high' as const };
const response = (payload: unknown) => ({ payload, metadata: { ...model, durationMs: 1 }, calls: [{ at: new Date().toISOString(), durationMs: 1 }] });
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6BUkAAAAASUVORK5CYII=', 'base64');

// Modelos substituídos identificados: este teste verifica coordenação e persistência, não qualidade de LLM.
async function flow(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'akcit-flow-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const config = readConfig({ DATA_DIR: dir, TARGET_ALLOWED_ORIGINS: 'http://localhost:4000',
    PI_PROVIDER: 'mock', PI_MODEL: 'controlled', PI_REPORT_PROVIDER: 'mock', PI_REPORT_MODEL: 'controlled' });
  const store = new RunStore(dir); await store.initialize();
  const runId = (await createRun(store, { name: 'Fluxo completo', applicationName: 'Reservas', text }, [randomUUID()], { userId: 'owner' })).run.id;
  const calls: string[] = [];
  let block = false, feedbackImpact: 'requirements' | 'cases' | 'navigation' = 'requirements';
  const coordinator = new PreparationCoordinator(store, config, {
    modelPreflight: async () => {}, visualPreflight: async () => ({ executor: model, 'validator-visual': model }),
    modelCall: async task => {
      calls.push(task.task); const input = JSON.parse(task.prompt);
      if (task.role === 'output-validator') return response(approved);
      if (task.task === 'analyze-feedback') return response({ impact: feedbackImpact,
        restartFrom: feedbackImpact === 'requirements' ? 'planning' : feedbackImpact === 'cases' ? 'case_design' : 'mapping',
        reason: 'Comentário afeta somente a etapa identificada.', requirementIds: ['REQ'], caseIds: feedbackImpact === 'requirements' ? [] : ['CASE-0'],
        instructions: ['Aplicar o esclarecimento preservando as fontes.'], question: null });
      if (task.task === 'write-report') return response({ summary: 'Avaliação concluída com evidências.', scope: 'Regras de quantidade.', limitations: [], conclusion: 'Consulte os resultados e as pendências de cada caso.' });
      if (task.task === 'detail-test-routes') return response({ routes: input.approvedCases.payload.testCases.map((item: any) => ({ caseId: item.id, pathId: 'PATH', reason: null })) });
      const sources = [{ artifactId: input.artifacts[0].id, locator: 'L1', quote: text }];
      if (task.task === 'curate-artifacts') return response({ requirements: [{ id: 'REQ', statement: text, sources,
        rules: [{ id: 'RULE', statement: text, sources }] }], questions: [] });
      if (task.task === 'create-test-plan') return response({ testPlan: { objective: 'Conferir quantidade.', requirementIds: ['REQ'], ruleIds: ['RULE'],
        priorities: [{ ruleId: 'RULE', reason: 'Limites.' }], exclusions: [], approach: ['AVL.'], preconditions: [], sources } });
      return response({ testCases: [0, 1].map(value => ({ id: `CASE-${value}`, requirementIds: ['REQ'], ruleIds: ['RULE'],
        preconditions: [], setup: 'Conferir formulário.', pathId: null, data: { quantity: value },
        techniques: [{ name: 'AVL', description: 'Limite inferior e vizinho inteiro.', values: [value] }], expected: value ? 'Criar reserva.' : 'Rejeitar sem criar reserva.', sources })) });
    },
    visualCall: async task => {
      calls.push(task.kind); const input = JSON.parse(task.prompt);
      if (!task.browser) { assert.ok(task.images?.length); return response(approved); }
      const observation = { id: randomUUID(), assetId: randomUUID(), at: new Date().toISOString(), width: 1, height: 1 };
      await mkdir(task.browser.mediaDir, { recursive: true }); await writeFile(join(task.browser.mediaDir, observation.assetId + '.png'), png);
      await task.browser.onObservation(observation);
      if (task.kind === 'map-application') return response({ authentication: { status: 'authenticated', observationId: observation.id },
        map: { screens: [{ id: 'FORM', name: 'Formulário', recognition: 'Quantidade.', observationIds: [observation.id] }],
          transitions: [], paths: [{ id: 'PATH', startScreenId: 'FORM', transitionIds: [] }] }, pending: [], limitations: [] });
      await task.browser.onAction({ id: randomUUID(), at: observation.at, tool: 'pointer', params: { action: 'click', x: 1, y: 1 }, outcome: 'ok' });
      const blocked = block && input.approvedCase.id === 'CASE-0';
      return response({ setupObservation: 'Preparo observado.', observed: blocked ? 'Preparo indisponível.' : 'Comportamento esperado observado.',
        verdict: blocked ? 'blocked' : 'passed', reason: blocked ? 'Falta localizar o preparo.' : 'Resultado sustentado pela captura.',
        evidenceIds: [observation.id], evidenceGaps: [], question: blocked ? 'Qual caminho permite preparar o caso?' : null, reproduce: false });
    },
  });
  const read = async () => (await store.read(runId)).run;
  const output = async (phase: string) => latestOutput(await read(), phase)!;
  const decide = async (target: RunOutput, changes = false) => {
    const result = await executeApprovalCommand(store, runId, { type: changes ? 'request_changes' : 'approve', outputId: target.id,
      outputRevision: target.revision, ...(changes ? { comment: 'Revisar este escopo conforme fontes.' } : {}) }, { userId: 'owner' });
    assert.ok(result.ok, JSON.stringify(result));
  };
  const next = async (target: RunOutput, withAccess = false) => {
    await coordinator.continue(runId, 'owner', { outputId: target.id, outputRevision: target.revision, ...(withAccess ? { expectedAccessRevision: 1 } : {}) });
    await coordinator.settled(); assert.notEqual((await read()).status, 'error', JSON.stringify((await read()).preparation?.stopReason));
  };
  const toRoutes = async () => {
    const plan = await output('planning'); await decide(plan); await next(plan);
    const cases = await output('case_design'); await decide(cases);
    const access = await configureTargetAccess(store, runId, { startUrl: 'http://localhost:4000', accessProfile: 'Operador', dataPreparation: 'Conferir pela interface.',
      authorizedTarget: true, expectedAccessRevision: 0, credential: { username: 'synthetic', password: 'synthetic-secret' } }, { userId: 'owner' }, config.targetAllowedOrigins);
    assert.ok(access.ok, JSON.stringify(access));
    await next(cases, true); await next(await output('mapping'));
    assert.equal((await read()).phase, 'route_detail'); assert.equal((await read()).status, 'ready');
  };
  await coordinator.start(runId, 'owner'); await coordinator.settled();
  return { store, config, coordinator, runId, calls, read, output, decide, next, toRoutes,
    setBlock: (value: boolean) => { block = value; }, setFeedback: (value: typeof feedbackImpact) => { feedbackImpact = value; } };
}

test('T9.1 integra plano → casos → navegador → execução → relatório publicado sem editar estados', async t => {
  const h = await flow(t); await h.toRoutes(); await h.next(await h.output('route_detail'), true);
  assert.equal((await h.read()).executionAttempts!.length, 2);
  await h.coordinator.report(h.runId, 'owner', 'final'); await h.coordinator.settled();
  const run = await h.read(); assert.equal(run.status, 'completed', JSON.stringify(run.preparation?.stopReason)); assert.equal(run.phase, 'done');
  const review = await getPlanReview(h.store, h.runId, { userId: 'owner' }, h.config); assert.ok(review.ok);
  assert.equal(review.review.report!.payload.snapshot.counts.passed, 2); assert.equal(review.review.report!.underReview, false);
  assert.equal(h.calls.filter(call => call === 'write-report').length, 1);
});

test('T9.1 pedido de alterações gera revisão validada e exige nova aprovação', async t => {
  const h = await flow(t); const original = await h.output('planning'); await h.decide(original, true); await h.next(original);
  const revised = await h.output('planning'); assert.equal(revised.id, original.id); assert.equal(revised.revision, 2);
  assert.equal((await h.read()).approvals.length, 1); assert.ok((await h.read()).invalidations?.length);
  await assert.rejects(h.coordinator.continue(h.runId, 'owner', { outputId: revised.id, outputRevision: revised.revision }), { code: 'DECISION_MISSING' });
  await h.decide(revised); await h.next(revised);
  const cases = await h.output('case_design'); h.setFeedback('cases'); await h.decide(cases, true); await h.next(cases);
  assert.equal((await h.output('case_design')).revision, 2); assert.equal((await h.output('planning')).revision, 2);
});

test('T9.1 bloqueio localizado, resposta de navegação, remapeamento e retomada desde o início', async t => {
  const h = await flow(t); await h.toRoutes(); h.setBlock(true); await h.next(await h.output('route_detail'), true);
  let run = await h.read(); assert.equal(run.status, 'awaiting_input'); assert.deepEqual(run.executionAttempts!.map(a => a.verdict), ['blocked', 'passed']);
  const execution = run.outputs.find(o => o.phase === 'execution')!; const approvals = structuredClone(run.approvals);
  await h.coordinator.answer(h.runId, 'owner', { outputId: execution.id, outputRevision: execution.revision, questionId: 'execution:CASE-0', text: 'Abra o menu Preparar antes de iniciar.' });
  h.setFeedback('navigation'); h.setBlock(false); await h.coordinator.resume(h.runId, 'owner'); await h.coordinator.settled();
  run = await h.read(); assert.equal(run.status, 'ready', JSON.stringify(run.preparation?.stopReason)); assert.equal(run.phase, 'mapping');
  assert.deepEqual(run.approvals, approvals); await h.next(await h.output('mapping')); await h.next(await h.output('route_detail'), true);
  assert.equal((await h.read()).executionAttempts!.length, 3); assert.equal((await h.read()).executionAttempts!.at(-1)!.caseId, 'CASE-0');
});

test('T9.1 cancelar em ready impede relatório e qualquer nova inferência', async t => {
  const h = await flow(t); await h.toRoutes(); const calls = h.calls.length; await h.coordinator.cancel(h.runId, 'owner');
  assert.equal((await h.read()).status, 'cancelled'); await assert.rejects(h.coordinator.report(h.runId, 'owner', 'partial'));
  await assert.rejects(h.coordinator.continue(h.runId, 'owner', { outputId: (await h.output('route_detail')).id, outputRevision: 1, expectedAccessRevision: 1 }));
  assert.equal(h.calls.length, calls);
});

test('T9.1 orçamento esgotado durante tentativa encerra registro ativo e permite excluir sem repetir ações', async t => {
  const h = await flow(t); await h.toRoutes();
  let now = Date.now(), calls = 0;
  const coordinator = new PreparationCoordinator(h.store, h.config, {
    now: () => now, visualPreflight: async () => ({ executor: model, 'validator-visual': model }),
    visualCall: async () => { calls++; now += 45 * 60_000 + 1; return response({}); },
  });
  const routes = await h.output('route_detail');
  await coordinator.continue(h.runId, 'owner', { outputId: routes.id, outputRevision: routes.revision, expectedAccessRevision: 1 });
  await coordinator.settled(); const run = await h.read();
  assert.equal(run.status, 'interrupted'); assert.equal(run.preparation!.stopReason!.code, 'ACTIVE_LIMIT');
  assert.equal(run.executionAttempts![0]!.status, 'interrupted'); assert.ok(run.executionAttempts![0]!.finishedAt);
  assert.ok(run.preparation!.calls.every(call => call.status !== 'running')); assert.equal(calls, 1);
  await assert.rejects(coordinator.report(h.runId, 'owner', 'partial'), { code: 'ACTIVE_LIMIT' });
  await h.store.remove(h.runId, 'owner'); await assert.rejects(h.store.read(h.runId), { code: 'RUN_NOT_FOUND' });
});

test('T9.1 relatório parcial preserva interrupção e reenvio não consome chamadas adicionais', async t => {
  const h = await flow(t); await h.toRoutes();
  await h.store.update(h.runId, ({ run }) => { run.status = 'running'; run.preparation!.finishedAt = null; return { save: true, value: undefined }; });
  await h.store.recoverInterrupted(); assert.equal((await h.read()).status, 'interrupted');
  await h.coordinator.report(h.runId, 'owner', 'partial'); await h.coordinator.settled();
  const run = await h.read(); assert.equal(run.status, 'interrupted'); assert.equal(run.phase, 'route_detail'); assert.ok(run.publishedReport);
  const calls = h.calls.length;
  assert.deepEqual(await h.coordinator.report(h.runId, 'owner', 'partial'), { accepted: false });
  assert.equal(h.calls.length, calls);
});

test('T9.1 pergunta de resultado invalidado não muda a espera de aprovação de casos novos', async t => {
  const h = await flow(t); await h.toRoutes(); h.setBlock(true); await h.next(await h.output('route_detail'), true);
  const execution = (await h.read()).outputs.find(output => output.phase === 'execution')!;
  const request = { outputId: execution.id, outputRevision: execution.revision, questionId: 'execution:CASE-0', text: 'Mude a pré-condição do caso.' };
  await h.coordinator.answer(h.runId, 'owner', request); h.setFeedback('cases');
  await h.coordinator.resume(h.runId, 'owner'); await h.coordinator.settled();
  const run = await h.read(); assert.equal(run.status, 'awaiting_approval'); assert.equal(run.phase, 'case_design');
  await assert.rejects(h.coordinator.answer(h.runId, 'owner', { ...request, text: 'Resposta tardia.', expectedAnswerRevision: 1 }), { code: 'QUESTION_NOT_FOUND' });
  assert.deepEqual(await h.read(), run);
});
