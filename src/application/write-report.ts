import { isDeepStrictEqual } from 'node:util';
import { buildReportSnapshot, buildTestReport, isApprovedOutput, type ReportMode } from '../domain/test-report.js';
import { eligibleExecutionCases, latestExecutionOutputs } from '../domain/test-execution.js';
import type { RouteDetailPayload } from '../domain/route-detail.js';
import type { RunOutput, RunRecord } from '../storage/runs.js';
import { latestOutput, PreparationError } from './prepare-plan.js';
import { produceValidatedText, type TextServices } from './analyze-feedback.js';

/** Encerramento deliberado não se confunde com cancelar ou maquiar falha técnica. */
export function reportEligibility(run: RunRecord, mode: ReportMode, now = Date.now()) {
  if (!run.preparation || run.preparation.finishedAt === null || run.status === 'cancelled' ||
    (mode === 'partial' ? !['interrupted', 'error'].includes(run.status) : !['ready', 'awaiting_input'].includes(run.status))) {
    throw new PreparationError('INVALID_STATE', mode === 'partial'
      ? 'O relatório parcial exige uma execução interrompida ou com erro, sem trabalho ativo.'
      : 'Encerre com pendências somente quando não houver trabalho ativo e restarem pendências não executáveis.');
  }
  const spent = run.preparation.accumulatedActiveMs ?? Math.max(0,
    Date.parse(run.preparation.finishedAt) - Date.parse(run.preparation.startedAt));
  if (spent >= run.preparation.limits.activeMs || !Number.isFinite(now)) {
    throw new PreparationError('ACTIVE_LIMIT', 'O orçamento ativo foi esgotado; os registros foram preservados sem novas chamadas.');
  }
  if (mode === 'final') {
    const routes = latestOutput(run, 'route_detail');
    if (routes && isApprovedOutput(run, routes) && eligibleExecutionCases(run,
      (routes.payload as RouteDetailPayload).testCases, routes).length) {
      throw new PreparationError('CASES_REMAIN', 'Ainda há casos independentes executáveis. Execute-os antes de encerrar com pendências.');
    }
    if (run.status === 'ready' && !['route_detail', 'execution'].includes(run.phase)) {
      throw new PreparationError('INVALID_STATE', 'Há uma etapa independente aguardando continuidade.');
    }
    const outputs = [...['curation', 'planning', 'case_design', 'mapping', 'route_detail', 'feedback'].map(phase => latestOutput(run, phase)), ...latestExecutionOutputs(run)]
      .filter((output): output is RunOutput => !!output);
    if (outputs.some(output => {
      const verdict = run.validations.filter(item => item.outputId === output.id && item.outputRevision === output.revision && item.status !== 'error').at(-1);
      return verdict?.status === 'changes_requested' || output.phase === 'execution' && !isApprovedOutput(run, output);
    })) throw new PreparationError('INSUFFICIENT_VALIDATION', 'Uma saída vigente ainda exige correção ou validação antes do encerramento regular.');
  }
  return buildReportSnapshot(run, mode);
}

export function canWriteReport(run: RunRecord, mode: ReportMode): boolean {
  try { reportEligibility(run, mode); return true; } catch { return false; }
}

export async function produceReport(services: TextServices, mode: ReportMode): Promise<RunOutput | null> {
  const snapshot = buildReportSnapshot((await services.read()).run, mode);
  const check = (run: RunRecord) => {
    if (!isDeepStrictEqual(buildReportSnapshot(run, mode), snapshot)) {
      throw new PreparationError('STALE_VERSION', 'Os resultados utilizados no relatório foram alterados durante a redação.');
    }
  };
  const output = await produceValidatedText(services, { phase: 'report', role: 'report-writer', context: { consolidated: snapshot },
    dependsOn: snapshot.references.map(ref => ({ outputId: ref.outputId, revision: ref.revision })), check,
    parse: value => buildTestReport(value, snapshot) });
  if (!output) return null;
  await services.update(run => {
    check(run);
    if (!isApprovedOutput(run, output)) throw new PreparationError('INSUFFICIENT_VALIDATION', 'O relatório só pode ser publicado com parecer aprovado.');
    run.publishedReport = { outputId: output.id, revision: output.revision };
    if (mode === 'final') run.phase = 'done';
  });
  await services.finish('completed', null);
  return output;
}
