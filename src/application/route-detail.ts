import { isDeepStrictEqual } from 'node:util';
import { parseNavigation } from '../domain/navigation.js';
import { parseTestCases, type CurationPayload, type PlanPayload } from '../domain/preparation.js';
import { validDecision } from '../domain/plan-approval.js';
import { validateRouteDetail } from '../domain/route-detail.js';
import type { RunOutput, RunRecord } from '../storage/runs.js';
import type { readConfig } from '../config.js';
import { caseDependencies, answersCurrent, latestOutput, PreparationError } from './prepare-plan.js';

type Config = Pick<ReturnType<typeof readConfig>, 'targetAllowedOrigins'>;
export type RouteDetailRequest = { outputId: string; outputRevision: number };

/** Sem inferência ou navegador; confere toda a cadeia aprovada e o acesso do mapa. */
export function routeDependencies(run: RunRecord, request: RouteDetailRequest, config: Config) {
  const stale = (message = 'O mapa ou suas dependências foram alterados. Consulte a versão vigente.'): never => {
    throw new PreparationError('STALE_VERSION', message);
  };
  const mapping = latestOutput(run, 'mapping'), cases = latestOutput(run, 'case_design'), plan = latestOutput(run, 'planning');
  if (!mapping || !cases || !plan || mapping.id !== request.outputId || mapping.revision !== request.outputRevision) return stale();
  const dependencies = caseDependencies(run, { outputId: plan.id, outputRevision: plan.revision }, false);
  const approved = (output: RunOutput) => {
    const verdicts = run.validations.filter(item => item.outputId === output.id && item.outputRevision === output.revision &&
      item.validator === 'output-validator' && item.status !== 'error');
    if (verdicts.length !== 1 || verdicts[0]?.status !== 'approved') {
      throw new PreparationError('INSUFFICIENT_VALIDATION', 'Casos e mapa precisam de parecer aprovado nas revisões vigentes.');
    }
  };
  approved(cases); approved(mapping);
  const approvals = run.approvals.filter(item => item.outputId === cases.id && item.outputRevision === cases.revision);
  if (approvals.length !== 1 || approvals[0]?.decision !== 'approved' || !validDecision(approvals[0])) {
    throw new PreparationError('DECISION_MISSING', 'Não há uma aprovação humana válida para a revisão vigente dos casos.');
  }
  const hasDependencies = (output: RunOutput, required: RunOutput[]) => output.dependsOn.length === required.length &&
    required.every(item => output.dependsOn.some(ref => ref.outputId === item.id && ref.revision === item.revision));
  if (!hasDependencies(cases, [dependencies.curation, plan]) || !hasDependencies(mapping, [dependencies.curation, plan, cases]) ||
    !answersCurrent(run, cases) ||
    !answersCurrent(run, mapping)) return stale();
  const accessRevision = run.input.accessRevision;
  if (!Number.isSafeInteger(accessRevision) || (accessRevision as number) < 1 || mapping.payload.accessRevision !== accessRevision ||
    run.input.authorizedTarget !== true || typeof run.input.credentialRef !== 'string') return stale('O acesso mudou desde o mapa validado.');
  try {
    if (!config.targetAllowedOrigins.includes(new URL(run.input.startUrl as string).origin)) return stale('O destino do mapa não está autorizado.');
    const artifacts = [...run.artifacts, ...(run.answerArtifacts ?? [])] as import('../domain/preparation.js').Artifact[];
    const logicalCases = parseTestCases(cases.payload, artifacts, dependencies.curation.payload as CurationPayload, plan.payload as PlanPayload);
    const navigation = parseNavigation({ authentication: mapping.payload.authentication, map: mapping.payload.map,
      pending: mapping.payload.pending, limitations: mapping.payload.limitations }, {
      caseIds: logicalCases.testCases.map(item => item.id), observations: (run.observations ?? []).map(item => item.id),
      actions: (run.mappingActions ?? []).filter(item => item.outcome === 'ok').map(item => item.id),
    });
    if (navigation.authentication.status !== 'authenticated') return stale('O mapa não comprova autenticação na aplicação.');
    return { curation: dependencies.curation, plan, cases, mapping, artifacts, logicalCases, navigation,
      caseApproval: approvals[0]!, accessRevision: accessRevision as number,
      // Snapshot público, sem credenciais. Detecta alterações mesmo conservando IDs.
      access: structuredClone(run.input) };
  } catch (error) {
    if (error instanceof PreparationError) throw error;
    return stale('Casos, mapa ou fontes não atendem mais ao contrato validado.');
  }
}
export type RouteDependencies = ReturnType<typeof routeDependencies>;

export function routeEligibility(run: RunRecord, request: RouteDetailRequest, config: Config) {
  const dependencies = routeDependencies(run, request, config);
  if (run.status !== 'ready' || run.phase !== 'mapping' || !run.preparation || run.preparation.finishedAt === null) {
    throw new PreparationError('INVALID_STATE', 'O detalhamento inicia somente a partir de um mapa validado aguardando continuidade.');
  }
  const spent = run.preparation.accumulatedActiveMs ?? Math.max(0,
    Date.parse(run.preparation.finishedAt) - Date.parse(run.preparation.startedAt));
  if (spent >= run.preparation.limits.activeMs) throw new PreparationError('ACTIVE_LIMIT', 'O orçamento ativo desta execução foi esgotado.');
  return dependencies;
}

export function canDetailRoutes(run: RunRecord, config: Config): boolean {
  const mapping = latestOutput(run, 'mapping');
  if (!mapping) return false;
  try { routeEligibility(run, { outputId: mapping.id, outputRevision: mapping.revision }, config); return true; }
  catch { return false; }
}

export function currentRouteDetail(run: RunRecord, output: RunOutput, config: Config): boolean {
  try {
    const mapping = latestOutput(run, 'mapping');
    if (!mapping) return false;
    const current = routeDependencies(run, { outputId: mapping.id, outputRevision: mapping.revision }, config);
    if (output.accessRevision !== current.accessRevision || output.dependsOn.length !== 4 ||
      ![current.curation, current.plan, current.cases, mapping].every(item => output.dependsOn.some(ref => ref.outputId === item.id && ref.revision === item.revision)) ||
      !isDeepStrictEqual(output.answerRefs ?? [], mapping.answerRefs ?? [])) return false;
    validateRouteDetail(output.payload, current.logicalCases, current.navigation, { outputId: current.cases.id, revision: current.cases.revision });
    return true;
  } catch { return false; }
}
