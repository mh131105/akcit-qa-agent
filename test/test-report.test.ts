import assert from 'node:assert/strict';
import test from 'node:test';
import { buildReportSnapshot, buildTestReport, publishedReport } from '../src/domain/test-report.js';
import { reportEligibility, produceReport } from '../src/application/write-report.js';
import type { TextServices } from '../src/application/analyze-feedback.js';
import type { RunOutput, RunRecord } from '../src/storage/runs.js';
import type { ExecutionAttempt } from '../src/domain/test-execution.js';

const at = '2026-09-26T12:00:00.000Z';
const approved = { status: 'approved' as const, reason: 'Fiel à consolidação.', findings: [] };
const narrative = { summary: 'Resultados observados.', scope: 'Reservas.', limitations: [], conclusion: 'Há pendências.' };
function fixture(): RunRecord {
  const record: RunRecord = { id: 'run-report', ownerId: 'owner', name: 'Relatório', applicationName: 'Reservas', createdAt: at,
    status: 'ready', phase: 'execution', input: {}, artifacts: [], questions: [], answers: [], approvals: [], validations: [], budgetCycles: [], validationPolicy: {}, outputs: [],
    preparation: { id: 'work', budgetCycleId: 'cycle', startedAt: at, finishedAt: at, accumulatedActiveMs: 1000,
      activeRole: null, activity: null, stopReason: null, calls: [],
      limits: { activeMs: 2700000, maxRequirements: 10, maxRevisions: 3, maxValidatorAttempts: 2, timeoutMs: 120000 } } };
  const add = (output: RunOutput) => { record.outputs.push(output); record.validations.push({ outputId: output.id, outputRevision: output.revision, validator: 'output-validator', ...approved }); };
  const rules = ['R-PASS', 'R-FAIL', 'R-BLOCK', 'R-UNCLEAR', 'R-NONE', 'R-EXCLUDED'].map(id => ({ id, statement: id, sources: [] }));
  add({ id: 'curation', phase: 'curation', revision: 1, dependsOn: [], payload: { requirements: [{ id: 'REQ', statement: 'Reservas', sources: [], rules }], questions: [] } });
  add({ id: 'plan', phase: 'planning', revision: 1, dependsOn: [], payload: { testPlan: { objective: 'Avaliar reservas.', requirementIds: ['REQ'], ruleIds: rules.slice(0, -1).map(rule => rule.id),
    sources: [], exclusions: [{ description: 'R-EXCLUDED', reason: 'Fora desta avaliação.' }] } } });
  add({ id: 'cases', phase: 'case_design', revision: 1, dependsOn: [], payload: { testCases: rules.slice(0, -1).map(rule => ({ id: rule.id.replace('R-', 'CT-'),
    requirementIds: ['REQ'], ruleIds: [rule.id], expected: 'Resultado esperado.', setup: 'Estado inicial.', preconditions: [], data: { value: 1 }, sources: [], pathId: null })) } });
  add({ id: 'routes', phase: 'route_detail', revision: 1, dependsOn: [], payload: { testCases: [], pending: [{ caseId: 'CT-BLOCK', reason: 'Preparo indisponível.' }] } });
  const attempt = (caseId: string, verdict: 'passed' | 'failed' | 'inconclusive', index = 1, validated = true) => {
    const id = `${caseId}-${index}`, obs = `obs-${id}`;
    const item: ExecutionAttempt = { id, caseId, approvedCaseRevision: { outputId: 'cases', revision: 1 }, routeDetailRef: { outputId: 'routes', revision: 1 },
      startedAt: at, finishedAt: at, status: 'completed', setupObservation: 'Preparo confirmado.', events: [], observed: 'Observação aprovada.', verdict,
      reason: 'Motivo aprovado.', evidenceIds: [obs], evidenceGaps: [], ...(index > 1 ? { reproducesAttemptId: `${caseId}-1` } : {}) };
    (record.executionAttempts ??= []).push(item);
    (record.observations ??= []).push({ id: obs, assetId: `asset-${id}`, at, width: 1366, height: 768, caseId, attemptId: id });
    const output: RunOutput = { id: `result-${caseId}`, phase: 'execution', revision: index, dependsOn: [], payload: {
      caseId, attemptId: id, setupObservation: item.setupObservation, observed: item.observed, verdict,
      reason: item.reason, evidenceIds: [obs], evidenceGaps: [], question: null, reproduce: false } };
    if (validated) add(output); else record.outputs.push(output);
  };
  attempt('CT-PASS', 'passed'); attempt('CT-FAIL', 'failed'); attempt('CT-FAIL', 'passed', 2); attempt('CT-UNCLEAR', 'failed', 1, false);
  return record;
}

test('relatório: contagens incluem cinco vereditos, falha anterior persiste e critérios sem cobertura são explícitos', () => {
  const snapshot = buildReportSnapshot(fixture(), 'final');
  assert.deepEqual(snapshot.counts, { total: 5, passed: 1, failed: 1, blocked: 1, inconclusive: 1, not_run: 1 });
  const failed = snapshot.cases.find(item => item.caseId === 'CT-FAIL')!;
  assert.equal(failed.variation, true); assert.deepEqual(failed.attempts.map(item => item.verdict), ['failed', 'passed']);
  assert.equal(failed.attempts[1]!.evidence[0]?.capture, 'reproduction');
  assert.equal(snapshot.coverage[0]?.rules.find(item => item.ruleId === 'R-EXCLUDED')?.uncovered, true);
  assert.equal(snapshot.coverage[0]?.rules.find(item => item.ruleId === 'R-PASS')?.uncovered, false);
  assert.equal(snapshot.scope.exclusions[0]?.reason, 'Fora desta avaliação.');
});

test('relatório: conclusão sem aprovação e captura do mapa não aparecem como achado do caso', () => {
  const record = fixture(); const attempt = record.executionAttempts!.find(item => item.caseId === 'CT-UNCLEAR')!;
  record.observations!.push({ id: 'map-image', assetId: 'map-asset', at, width: 1366, height: 768 });
  attempt.evidenceIds.push('map-image');
  const snapshot = buildReportSnapshot(record, 'partial'), unclear = snapshot.cases.find(item => item.caseId === 'CT-UNCLEAR')!;
  assert.equal(unclear.verdict, 'inconclusive'); assert.equal(unclear.observed, '');
  assert.equal(unclear.attempts[0]?.validatedResult, null);
  assert.equal(unclear.attempts[0]?.verdict, null);
  assert.ok(!unclear.attempts[0]?.evidence.some(item => item.assetId === 'map-asset'));
  assert.ok(snapshot.limitations.some(item => item.includes('sem vínculo')));
});

test('relatório: revisão lógica nova não herda cobertura anterior e redator não pode alterar snapshot', () => {
  const record = fixture(); const cases = record.outputs.find(item => item.phase === 'case_design')!;
  record.outputs.push({ ...structuredClone(cases), revision: 2, payload: { testCases: (cases.payload.testCases as Record<string, unknown>[])
    .map(testCase => ({ ...testCase, expected: 'Uma expectativa alterada para a nova revisão.' })) } });
  record.validations.push({ outputId: cases.id, outputRevision: 2, validator: 'output-validator', ...approved });
  const snapshot = buildReportSnapshot(record, 'partial');
  assert.equal(snapshot.counts.failed, 0); assert.equal(snapshot.counts.passed, 0);
  assert.ok(snapshot.cases.flatMap(item => item.attempts).every(item => !item.current));
  const report = buildTestReport(narrative, snapshot);
  assert.deepEqual(report.snapshot, snapshot); assert.notEqual(report.snapshot, snapshot);
  assert.throws(() => buildTestReport({ ...narrative, counts: { passed: 99 } }, snapshot));
});

test('relatório: revisão localizada de um caso conserva resultado e referência original do independente', () => {
  const record = fixture(), cases = record.outputs.find(item => item.phase === 'case_design')!;
  const revised = { ...structuredClone(cases), revision: 2 };
  (revised.payload.testCases as Record<string, unknown>[]).find(item => item.id === 'CT-FAIL')!.expected = 'Nova expectativa do caso afetado.';
  record.outputs.push(revised);
  record.validations.push({ outputId: cases.id, outputRevision: 2, validator: 'output-validator', ...approved });
  record.invalidations = [{ id: 'invalidate-case', outputId: cases.id, outputRevision: 1, reason: 'Revisar somente CT-FAIL.', at,
    feedbackRef: { outputId: 'feedback', revision: 1 }, caseIds: ['CT-FAIL'] }];
  const before = structuredClone(record.executionAttempts);
  const snapshot = buildReportSnapshot(record, 'partial');
  const independent = snapshot.cases.find(item => item.caseId === 'CT-PASS')!;
  assert.equal(independent.verdict, 'passed'); assert.equal(independent.attempts[0]?.current, true);
  assert.deepEqual(independent.attempts[0]?.approvedCaseRevision, { outputId: cases.id, revision: 1 });
  assert.deepEqual(snapshot.references.filter(ref => ref.outputId === cases.id).map(ref => ref.revision), [2, 1]);
  assert.deepEqual(snapshot.coverage[0]?.rules.find(item => item.ruleId === 'R-PASS')?.attemptedCaseIds, ['CT-PASS']);
  assert.equal(snapshot.cases.find(item => item.caseId === 'CT-FAIL')?.verdict, 'not_run');
  assert.ok(snapshot.cases.find(item => item.caseId === 'CT-FAIL')?.attempts.every(attempt => !attempt.current));
  assert.deepEqual(record.executionAttempts, before, 'a referência da tentativa não deve ser reescrita para herdar a revisão nova');
});

test('relatório: execução sem casos fica sem cobertura inventada', () => {
  const record = fixture(); record.outputs = []; record.validations = []; record.executionAttempts = [];
  const snapshot = buildReportSnapshot(record, 'final');
  assert.equal(snapshot.counts.total, 0); assert.deepEqual(snapshot.coverage, []);
  assert.ok(snapshot.limitations.some(item => item.includes('Nenhum conjunto')));
});

test('relatório: invalidação localizada retira cobertura afetada e mantém tentativas independentes', () => {
  const record = fixture(); record.invalidations = [{ id: 'invalidate', outputId: 'result-CT-PASS', outputRevision: 1,
    reason: 'Reobservar caminho do caso.', at, feedbackRef: { outputId: 'feedback', revision: 1 }, caseIds: ['CT-PASS'] }];
  const snapshot = buildReportSnapshot(record, 'partial');
  assert.equal(snapshot.counts.passed, 0); assert.equal(snapshot.counts.failed, 1);
  assert.equal(snapshot.cases.find(item => item.caseId === 'CT-PASS')?.verdict, 'inconclusive');
  assert.equal(snapshot.cases.find(item => item.caseId === 'CT-PASS')?.attempts[0]?.current, false);
  assert.equal(snapshot.cases.find(item => item.caseId === 'CT-FAIL')?.attempts[0]?.current, true);
  assert.ok(snapshot.limitations.some(item => item.includes('históricas')));
});

test('relatório parcial: aprovação anterior à revisão rejeitada é rotulada histórica sem cobertura atual', () => {
  const record = fixture(); const cases = record.outputs.find(item => item.phase === 'case_design')!;
  record.outputs.push({ ...cases, revision: 2 });
  record.validations.push({ outputId: cases.id, outputRevision: 2, validator: 'output-validator', status: 'changes_requested' });
  const snapshot = buildReportSnapshot(record, 'partial');
  assert.equal(snapshot.scope.current, false);
  assert.ok(snapshot.cases.every(item => !item.current));
  assert.ok(snapshot.coverage.flatMap(item => item.rules).every(rule => rule.validatedCaseIds.length === 0));
  assert.equal(snapshot.references.find(item => item.outputId === cases.id)?.current, false);
  const stale = fixture();
  stale.outputs.find(item => item.phase === 'case_design')!.dependsOn = [{ outputId: 'plan', revision: 1 }];
  stale.outputs.find(item => item.phase === 'planning')!.dependsOn = [{ outputId: 'curation', revision: 1 }];
  stale.outputs.push({ ...stale.outputs.find(item => item.phase === 'curation')!, revision: 2 });
  assert.ok(buildReportSnapshot(stale, 'partial').cases.every(item => !item.current), 'dependência antiga também torna o conjunto histórico');
});

test('relatório: encerramento recusa independentes, saída rejeitada, cancelamento e orçamento esgotado', () => {
  const record = fixture(); record.outputs.find(item => item.phase === 'route_detail')!.payload.testCases = [{ id: 'CT-NONE', pathId: 'path' }];
  assert.throws(() => reportEligibility(record, 'final'), /independentes/);
  record.outputs.find(item => item.phase === 'route_detail')!.payload.testCases = [];
  assert.throws(() => reportEligibility(record, 'final'), /validação/);
  record.status = 'interrupted'; assert.equal(reportEligibility(record, 'partial').mode, 'partial');
  record.status = 'cancelled'; assert.throws(() => reportEligibility(record, 'partial'), /interrompida/);
  record.status = 'error'; record.preparation!.accumulatedActiveMs = 2700000;
  assert.throws(() => reportEligibility(record, 'partial'), /orçamento/);
});

test('relatório: revisão em correção mantém publicação anterior; só o parecer aprovado publica a nova', async () => {
  const record = fixture(); record.status = 'running'; record.phase = 'report';
  const old: RunOutput = { id: 'report', revision: 1, phase: 'report', dependsOn: [], payload: buildTestReport(narrative, buildReportSnapshot(record, 'partial')) };
  record.outputs.push(old); record.validations.push({ outputId: old.id, outputRevision: 1, validator: 'output-validator', ...approved });
  record.publishedReport = { outputId: old.id, revision: 1 };
  let validations = 0;
  const session: TextServices = { read: async () => ({ schemaVersion: 1, run: structuredClone(record), workIntents: [] }),
    update: async change => change(record), time: () => at, finish: async () => { record.status = 'interrupted'; },
    call: async (role, _phase, _attempt, _revision, input, parse) => {
      assert.equal(publishedReport(record)?.revision, 1);
      if (role === 'report-writer') return parse(narrative);
      assert.deepEqual((input.output as RunOutput).payload.snapshot, input.consolidated);
      return parse(++validations === 1 ? { status: 'changes_requested', reason: 'Explicitar limitação.',
        findings: [{ code: 'LIMITATION', message: 'Revisar limitação.', location: 'narrative.limitations' }] } : approved);
    } };
  const output = await produceReport(session, 'partial');
  assert.equal(output?.revision, 3); assert.equal(publishedReport(record)?.revision, 3);
  assert.equal(record.status, 'interrupted'); assert.equal(record.phase, 'report');
  assert.equal(record.outputs.filter(item => item.phase === 'report').length, 3);
});
