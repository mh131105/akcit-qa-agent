import { InvalidPreparationOutput, type CurationPayload, type PlanPayload, type TestCase } from './preparation.js';
import { approvedCaseStillCurrent, latestExecutionOutputs, type ExecutionAttempt, type ExecutionPayload, type TestVerdict } from './test-execution.js';
import type { NavigationPayload } from './navigation.js';
import type { RunOutput, RunRecord, RunValidation } from '../storage/runs.js';

export type ReportMode = 'final' | 'partial';
export type ReportReference = { outputId: string; revision: number; phase: string; current: boolean };
export type ReportAttempt = ExecutionAttempt & {
  current: boolean; validatedResult: ExecutionPayload | null; resultRef: ReportReference | null;
  evidence: { id: string; assetId: string; caseId: string; attemptId: string; capture: 'original' | 'reproduction' }[];
};
export type ReportCase = Pick<TestCase, 'requirementIds' | 'ruleIds' | 'expected' | 'setup' | 'preconditions' | 'data' | 'sources'> & {
  caseId: string; current: boolean; observed: string; verdict: TestVerdict; reason: string; variation: boolean; attempts: ReportAttempt[];
};
export type ReportSnapshot = {
  runId: string; name: string; applicationName: string; createdAt: string; mode: ReportMode;
  counts: { total: number } & Record<TestVerdict, number>;
  scope: { objective: string; current: boolean; requirementIds: string[]; ruleIds: string[]; sources: TestCase['sources']; exclusions: { description: string; reason: string }[] };
  coverage: { requirementId: string; statement: string; rules: {
    ruleId: string; statement: string; selected: boolean; caseIds: string[]; attemptedCaseIds: string[];
    validatedCaseIds: string[]; pendingCaseIds: string[]; uncovered: boolean; partial: boolean; limitation: string | null;
  }[] }[];
  cases: ReportCase[]; questions: RunRecord['questions']; answers: RunRecord['answers'];
  pending: { caseId: string; reason: string }[];
  references: ReportReference[]; validations: RunValidation[]; limitations: string[];
};
export type ReportNarrative = { summary: string; scope: string; limitations: string[]; conclusion: string };
export type TestReportPayload = { snapshot: ReportSnapshot; narrative: ReportNarrative };

export function isApprovedOutput(run: RunRecord, output: RunOutput): boolean {
  const verdicts = run.validations.filter(item => item.outputId === output.id && item.outputRevision === output.revision &&
    item.validator === 'output-validator' && item.status !== 'error');
  return verdicts.length === 1 && verdicts[0]!.status === 'approved';
}
const latestApproved = (run: RunRecord, phase: string) => run.outputs.filter(output =>
  output.phase === phase && isApprovedOutput(run, output)).reduce<RunOutput | undefined>((last, output) =>
  !last || output.revision > last.revision ? output : last, undefined);
function currentOutput(run: RunRecord, output: RunOutput, visited = new Set<string>()): boolean {
  const key = `${output.id}:${output.revision}`;
  if (visited.has(key) || run.outputs.some(other => other.id === output.id && other.revision > output.revision &&
    (output.phase !== 'execution' || other.payload.attemptId === output.payload.attemptId)) ||
    (run.invalidations ?? []).some(item => item.outputId === output.id && item.outputRevision === output.revision)) return false;
  // Resultado é observado numa versão de percurso. Remapear outro caso não desfaz
  // essa observação; sua vigência depende do caso lógico e da invalidação localizada.
  if (output.phase === 'execution') return true;
  return output.dependsOn.every(ref => {
    const dependency = run.outputs.find(item => item.id === ref.outputId && item.revision === ref.revision);
    return !!dependency && currentOutput(run, dependency, new Set([...visited, key]));
  });
}

/** Cobertura e contagens são dados do backend. O redator nunca recebe autorização para editá-los. */
export function buildReportSnapshot(run: RunRecord, mode: ReportMode): ReportSnapshot {
  latestExecutionOutputs(run); // Recusa IDs concorrentes por caso antes de consolidar.
  const reference = (output: RunOutput): ReportReference => ({ outputId: output.id, revision: output.revision, phase: output.phase, current: currentOutput(run, output) });
  const curation = latestApproved(run, 'curation'), plan = latestApproved(run, 'planning'), casesOutput = latestApproved(run, 'case_design');
  const mapping = latestApproved(run, 'mapping'), routes = latestApproved(run, 'route_detail');
  const requirements = (curation?.payload as CurationPayload | undefined)?.requirements ?? [];
  const planned = (plan?.payload as PlanPayload | undefined)?.testPlan;
  const testCases = (casesOutput?.payload.testCases ?? []) as TestCase[];
  const pending = structuredClone((routes?.payload.pending ?? []) as { caseId: string; reason: string }[]);
  const references = [curation, plan, casesOutput, mapping, routes].filter((output): output is RunOutput => !!output).map(reference);
  const questions = structuredClone(run.questions);
  const addQuestion = (output: RunOutput, question: Record<string, unknown>) => {
    if (!questions.some(item => item.id === question.id && item.outputId === output.id && item.outputRevision === output.revision)) {
      questions.push({ ...question, outputId: output.id, outputRevision: output.revision });
    }
  };
  if (mapping) ((mapping.payload as NavigationPayload).pending ?? []).forEach((item, index) => {
    addQuestion(mapping, { id: `mapping:${index}`, cause: item.description, description: item.description,
      caseIds: item.affectedCaseIds, blocking: true });
    if (!routes) item.affectedCaseIds.forEach(caseId => pending.push({ caseId, reason: item.description }));
  });
  if (routes) pending.forEach(item => addQuestion(routes, { id: `route:${item.caseId}`, cause: item.reason,
    description: item.reason, caseIds: [item.caseId], blocking: true }));
  const cases: ReportCase[] = testCases.map(testCase => {
    const caseCurrent = currentOutput(run, casesOutput!);
    const attempts: ReportAttempt[] = (run.executionAttempts ?? []).filter(attempt => attempt.caseId === testCase.id).map(attempt => {
      let current = caseCurrent && approvedCaseStillCurrent(run, attempt, testCase, casesOutput);
      const approvedCases = run.outputs.find(output => output.id === attempt.approvedCaseRevision.outputId && output.revision === attempt.approvedCaseRevision.revision);
      if (approvedCases && !references.some(ref => ref.outputId === approvedCases.id && ref.revision === approvedCases.revision)) references.push(reference(approvedCases));
      const result = run.outputs.filter(output => output.phase === 'execution' && output.payload.caseId === testCase.id &&
        output.payload.attemptId === attempt.id && isApprovedOutput(run, output))
        .reduce<RunOutput | undefined>((last, output) => !last || output.revision > last.revision ? output : last, undefined);
      if (result) references.push(reference(result));
      if (result && !currentOutput(run, result)) current = false;
      if (result && (run.invalidations ?? []).some(item => item.outputId === result.id && item.outputRevision === result.revision &&
        (!item.caseIds.length || item.caseIds.includes(testCase.id)))) current = false;
      const payload = result?.payload as ExecutionPayload | undefined;
      if (result && payload?.question) addQuestion(result, { id: `execution:${testCase.id}`, cause: payload.reason,
        description: payload.question, caseIds: [testCase.id], blocking: true });
      const evidence = attempt.evidenceIds.flatMap(id => {
        const observation = run.observations?.find(item => item.id === id && item.caseId === testCase.id && item.attemptId === attempt.id);
        return observation ? [{ id, assetId: observation.assetId, caseId: testCase.id, attemptId: attempt.id,
          capture: attempt.reproducesAttemptId ? 'reproduction' as const : 'original' as const }] : [];
      });
      // Candidatos rejeitados permanecem nos registros técnicos, sem reaparecer como conclusões publicadas.
      return { ...structuredClone(attempt), verdict: payload?.verdict ?? null,
        observed: payload?.observed ?? '', reason: payload?.reason ?? 'Tentativa sem conclusão validada.',
        setupObservation: payload?.setupObservation ?? '', current, validatedResult: payload ? structuredClone(payload) : null,
        resultRef: result ? reference(result) : null, evidence };
    });
    const current = attempts.filter(attempt => attempt.current);
    const attemptedCurrentCase = caseCurrent && attempts.some(attempt => attempt.current ||
      attempt.approvedCaseRevision.outputId === casesOutput!.id && attempt.approvedCaseRevision.revision === casesOutput!.revision);
    const sustainedFailure = current.find(attempt => attempt.validatedResult?.verdict === 'failed');
    const latest = current.at(-1);
    const chosen = sustainedFailure ?? latest;
    const question = questions.find(question => question.blocking === true && Array.isArray(question.caseIds) &&
      question.caseIds.includes(testCase.id) && !run.answers.some(answer => answer.questionId === question.id));
    const blocker = pending.find(item => item.caseId === testCase.id)?.reason ??
      (question ? String(question.cause ?? question.description) : undefined);
    const verdict: TestVerdict = chosen?.validatedResult?.verdict ?? (attemptedCurrentCase ? 'inconclusive' : blocker ? 'blocked' : 'not_run');
    return { caseId: testCase.id, current: caseCurrent, requirementIds: [...testCase.requirementIds], ruleIds: [...testCase.ruleIds],
      expected: testCase.expected, setup: testCase.setup, preconditions: [...testCase.preconditions], data: structuredClone(testCase.data), sources: structuredClone(testCase.sources),
      observed: chosen?.validatedResult?.observed ?? '', verdict,
      reason: chosen?.validatedResult?.reason ?? (attemptedCurrentCase ? 'Houve tentativa, mas não há conclusão validada suficiente.' : blocker ?? 'Não houve tentativa nem impedimento específico registrado.'),
      variation: new Set(current.flatMap(attempt => attempt.validatedResult ? [attempt.validatedResult.verdict] : [])).size > 1, attempts };
  });
  const counts = { total: cases.length, passed: 0, failed: 0, blocked: 0, inconclusive: 0, not_run: 0 };
  for (const testCase of cases) counts[testCase.verdict]++;
  const coverage = requirements.map(requirement => ({ requirementId: requirement.id, statement: requirement.statement,
    rules: requirement.rules.map(rule => {
      const matching = cases.filter(testCase => testCase.ruleIds.includes(rule.id));
      const validatedCaseIds = matching.filter(testCase => ['passed', 'failed'].includes(testCase.verdict)).map(testCase => testCase.caseId);
      const pendingCaseIds = matching.filter(testCase => !validatedCaseIds.includes(testCase.caseId)).map(testCase => testCase.caseId);
      return { ruleId: rule.id, statement: rule.statement, selected: planned?.ruleIds.includes(rule.id) ?? false,
        caseIds: matching.map(testCase => testCase.caseId), attemptedCaseIds: matching.filter(testCase => testCase.current && testCase.attempts.some(attempt =>
          attempt.current || attempt.approvedCaseRevision.outputId === casesOutput?.id && attempt.approvedCaseRevision.revision === casesOutput?.revision)).map(testCase => testCase.caseId),
        validatedCaseIds, pendingCaseIds, uncovered: validatedCaseIds.length === 0, partial: validatedCaseIds.length > 0 && pendingCaseIds.length > 0,
        limitation: validatedCaseIds.length ? null : !planned?.ruleIds.includes(rule.id) ? 'Critério fora do escopo selecionado; consulte as exclusões e pendências.'
          : !matching.length ? 'Não há caso validado associado ao critério.' : 'Os casos associados ainda não possuem conclusão de execução suficiente.' };
    }) }));
  const limitations = [
    ...(mode === 'partial' ? ['Relatório parcial; o encerramento técnico da execução permanece registrado.'] : []),
    ...(!cases.length ? ['Nenhum conjunto de casos validado está disponível; não há cobertura de execução a afirmar.'] : []),
    ...(references.some(ref => !ref.current) ? ['Há referências históricas: versões e invalidações permanecem rastreáveis; somente casos logicamente idênticos e não afetados conservam conclusões anteriores.'] : []),
    ...(counts.blocked + counts.inconclusive + counts.not_run > 0 ? ['Existem casos bloqueados, inconclusivos ou não executados.'] : []),
    ...(cases.some(testCase => testCase.variation) ? ['Há variação entre tentativas; uma reprodução aprovada não apaga uma falha sustentada.'] : []),
    ...(cases.some(testCase => testCase.attempts.some(attempt => !attempt.current)) ? ['Tentativas de versões anteriores são históricas e não contam como execução dos casos vigentes.'] : []),
    ...((mapping?.payload as NavigationPayload | undefined)?.limitations ?? []),
    ...(cases.some(testCase => testCase.attempts.some(attempt => attempt.evidence.length !== attempt.evidenceIds.length))
      ? ['Há referências de captura indisponíveis ou sem vínculo válido com a tentativa; não foram apresentadas como evidências do caso.'] : []),
  ];
  const validations = run.validations.filter(validation => references.some(ref => ref.outputId === validation.outputId && ref.revision === validation.outputRevision));
  return structuredClone({ runId: run.id, name: run.name, applicationName: run.applicationName, createdAt: run.createdAt, mode, counts,
    scope: { objective: planned?.objective ?? String(run.input.objective ?? ''), current: [curation, plan, casesOutput].every(output => !output || currentOutput(run, output)),
      requirementIds: planned?.requirementIds ?? [], ruleIds: planned?.ruleIds ?? [],
      sources: planned?.sources ?? [], exclusions: planned?.exclusions ?? [] },
    coverage, cases, questions, answers: run.answers, pending, references, validations, limitations });
}

export function buildTestReport(value: unknown, snapshot: ReportSnapshot): TestReportPayload {
  const fail = (): never => { throw new InvalidPreparationOutput(); };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  const item = value as Record<string, unknown>;
  if (Object.keys(item).length !== 4 || ['summary', 'scope', 'limitations', 'conclusion'].some(key => !Object.hasOwn(item, key))) return fail();
  const text = (value: unknown): string => typeof value === 'string' && !!value.trim() && value.length <= 12_000 ? value : fail();
  if (!Array.isArray(item.limitations) || item.limitations.length > 50) return fail();
  return { snapshot: structuredClone(snapshot), narrative: { summary: text(item.summary), scope: text(item.scope),
    limitations: item.limitations.map(text), conclusion: text(item.conclusion) } };
}

/** Uma revisão rejeitada ou em correção nunca substitui a versão pública. */
export function publishedReport(run: RunRecord): RunOutput | undefined {
  const publication = run.publishedReport;
  if (!publication) return undefined;
  const output = run.outputs.find(output => output.phase === 'report' && output.id === publication.outputId && output.revision === publication.revision);
  return output && isApprovedOutput(run, output) ? output : undefined;
}
