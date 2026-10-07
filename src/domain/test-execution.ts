import { isDeepStrictEqual } from 'node:util';
import type { TestCase } from './preparation.js';
import type { RunOutput, RunRecord, MappingActionRecord } from '../storage/runs.js';
import type { ApprovedCaseRevision, DetailedTestCase } from './route-detail.js';

export const EXECUTION_LIMITS = { actions: 50, attemptsPerCase: 2, validatorImages: 24 } as const;
export const TEST_VERDICTS = ['passed', 'failed', 'blocked', 'inconclusive', 'not_run'] as const;
export type TestVerdict = typeof TEST_VERDICTS[number];
export type ExecutionAttempt = {
  id: string; caseId: string; approvedCaseRevision: ApprovedCaseRevision; routeDetailRef: ApprovedCaseRevision;
  startedAt: string; finishedAt: string | null; status: 'running' | 'completed' | 'interrupted' | 'cancelled';
  setupObservation: string; events: MappingActionRecord[]; observed: string; verdict: TestVerdict | null;
  reason: string; evidenceIds: string[]; evidenceGaps: string[]; reproducesAttemptId?: string;
};
export type ExecutionCandidate = {
  setupObservation: string; observed: string; verdict: Exclude<TestVerdict, 'not_run'>; reason: string;
  evidenceIds: string[]; evidenceGaps: string[]; question: string | null; reproduce: boolean;
};
export type ExecutionPayload = ExecutionCandidate & { caseId: string; attemptId: string };
export class InvalidExecutionOutput extends Error {
  readonly code = 'INVALID_MODEL_OUTPUT';
  constructor(message = 'A conclusão não atende ao contrato de execução ou referencia evidência de outra tentativa.') {
    super(message); this.name = 'InvalidExecutionOutput';
  }
}
const fail = (): never => { throw new InvalidExecutionOutput(); };
const text = (value: unknown): value is string => typeof value === 'string' && !!value.trim() && [...value].length <= 4000;
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 50 && value.every(text);

/** Só conclusões vêm do modelo: identificadores, eventos, datas e arquivos são do backend. */
export function parseExecutionCandidate(value: unknown, attempt: ExecutionAttempt): ExecutionCandidate {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  const item = value as Record<string, unknown>;
  const keys = ['setupObservation', 'observed', 'verdict', 'reason', 'evidenceIds', 'evidenceGaps', 'question', 'reproduce'];
  if (keys.some(key => !Object.hasOwn(item, key)) || Object.keys(item).some(key => !keys.includes(key)) ||
    !text(item.setupObservation) || !text(item.observed) || !text(item.reason) ||
    !['passed', 'failed', 'blocked', 'inconclusive'].includes(item.verdict as string) ||
    !strings(item.evidenceIds) || !strings(item.evidenceGaps) ||
    item.evidenceIds.length > EXECUTION_LIMITS.validatorImages || new Set(item.evidenceIds).size !== item.evidenceIds.length ||
    item.evidenceIds.some(id => !attempt.evidenceIds.includes(id)) ||
    (item.question !== null && !text(item.question)) || typeof item.reproduce !== 'boolean') return fail();
  if (['passed', 'failed'].includes(item.verdict as string) && (!item.evidenceIds.length || item.evidenceGaps.length)) return fail();
  if (item.verdict === 'blocked' && item.question === null) return fail();
  if (item.verdict === 'inconclusive' && !item.evidenceGaps.length) return fail();
  if (item.reproduce && !['failed', 'inconclusive'].includes(item.verdict as string)) return fail();
  return structuredClone(item) as ExecutionCandidate;
}

/** Ao contrário de latestOutput, uma fase de execução tem um ID estável por caso. */
export function latestExecutionOutputs(run: Pick<RunRecord, 'outputs'>): RunOutput[] {
  const current = new Map<string, RunOutput>();
  for (const output of run.outputs.filter(item => item.phase === 'execution')) {
    const caseId = output.payload.caseId;
    if (typeof caseId !== 'string') throw new InvalidExecutionOutput('Resultado sem vínculo com um caso.');
    const previous = current.get(caseId);
    if (previous && (previous.id !== output.id || previous.revision === output.revision)) {
      throw new InvalidExecutionOutput('Resultados concorrentes para o mesmo caso.');
    }
    if (!previous || output.revision > previous.revision) current.set(caseId, output);
  }
  return [...current.values()];
}
export function latestExecutionOutput(run: Pick<RunRecord, 'outputs'>, caseId: string): RunOutput | undefined {
  return latestExecutionOutputs(run).find(output => output.payload.caseId === caseId);
}

/** A revisão do conjunto pode mudar sem mudar um caso independente. Conserva
 * o vínculo original da tentativa e compara todos os campos lógicos e fontes. */
export function approvedCaseStillCurrent(run: RunRecord, attempt: ExecutionAttempt,
  currentCase: TestCase | DetailedTestCase, casesOutput?: RunOutput): boolean {
  const current = casesOutput ?? run.outputs.filter(output => output.phase === 'case_design')
    .reduce<RunOutput | undefined>((last, output) => !last || output.revision > last.revision ? output : last, undefined);
  const previous = run.outputs.find(output => output.phase === 'case_design' &&
    output.id === attempt.approvedCaseRevision.outputId && output.revision === attempt.approvedCaseRevision.revision);
  if (!current || !previous || current.phase !== 'case_design' || attempt.caseId !== currentCase.id) return false;
  const logical = (testCase: TestCase | DetailedTestCase) => {
    const { pathId: _path, approvedCaseRevision: _revision, ...content } = testCase as DetailedTestCase;
    return content;
  };
  const savedCase = (output: RunOutput) => Array.isArray(output.payload.testCases)
    ? (output.payload.testCases as TestCase[]).find(item => item.id === attempt.caseId) : undefined;
  const oldCase = savedCase(previous), newCase = savedCase(current);
  if (!oldCase || !newCase || !isDeepStrictEqual(logical(oldCase), logical(currentCase)) ||
    !isDeepStrictEqual(logical(newCase), logical(currentCase))) return false;
  const related = [previous, current, ...run.outputs.filter(output => output.phase === 'execution' && output.payload.attemptId === attempt.id)];
  return !(run.invalidations ?? []).some(item => (!item.caseIds.length || item.caseIds.includes(attempt.caseId)) &&
    related.some(output => output.id === item.outputId && output.revision === item.outputRevision));
}

/** Uma resposta/remapeamento pode liberar um bloqueado, mas nunca repete ação
 * interrompida automaticamente. O teto original + uma reprodução inclui retomadas. */
export function eligibleExecutionCases(run: RunRecord, cases: DetailedTestCase[], routeDetail: RunOutput): DetailedTestCase[] {
  const attempts = run.executionAttempts ?? [];
  return cases.filter(testCase => {
    if (!testCase.pathId) return false;
    const history = attempts.filter(attempt => attempt.caseId === testCase.id);
    if (!history.length) return true;
    if (history.length >= EXECUTION_LIMITS.attemptsPerCase || history.some(attempt => attempt.status !== 'completed')) return false;
    const last = history.at(-1)!;
    return !approvedCaseStillCurrent(run, last, testCase) || last.verdict === 'blocked' &&
      (last.routeDetailRef.outputId !== routeDetail.id || last.routeDetailRef.revision !== routeDetail.revision);
  });
}
