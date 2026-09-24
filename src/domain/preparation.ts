export type Artifact = { id: string; name: string; version: string; text: string };
export type Source = { artifactId: string; locator: string; quote: string };
export type Rule = { id: string; statement: string; sources: Source[] };
export type Requirement = { id: string; statement: string; rules: Rule[]; sources: Source[] };
export type Question = {
  id: string; description: string; requirementIds: string[]; caseIds: string[];
  blocking: boolean; sources: Source[];
};
export type CurationPayload = { requirements: Requirement[]; questions: Question[] };
export type PlanPayload = { testPlan: {
  objective: string; requirementIds: string[]; ruleIds: string[];
  priorities: { ruleId: string; reason: string }[];
  exclusions: { description: string; reason: string }[];
  approach: string[]; preconditions: string[]; sources: Source[];
} };
export type Verdict = {
  status: 'approved' | 'changes_requested' | 'blocked';
  findings: { code: string; message: string; location: string | null }[];
  reason: string;
};

export class InvalidPreparationOutput extends Error {
  constructor(readonly code: 'INVALID_MODEL_OUTPUT' | 'INPUT_LIMIT' = 'INVALID_MODEL_OUTPUT') {
    super(code === 'INPUT_LIMIT'
      ? 'O material excede o limite de dez histórias de usuário. Reduza o escopo em um novo rascunho.'
      : 'A resposta do especialista não atende à estrutura, às referências ou às fontes exigidas.');
    this.name = 'InvalidPreparationOutput';
  }
}

function fail(): never { throw new InvalidPreparationOutput(); }
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  const item = value as Record<string, unknown>;
  if (Object.keys(item).length !== keys.length || keys.some(key => !Object.hasOwn(item, key))) return fail();
  return item;
}
function array(value: unknown, minimum = 0): unknown[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > 300) return fail();
  return value;
}
function text(value: unknown, maximum = 20_000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) return fail();
  return value;
}
function id(value: unknown): string {
  const result = text(value, 128);
  return /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(result) ? result : fail();
}
function ids(value: unknown, allowed: Set<string>, minimum = 0): string[] {
  const result = array(value, minimum).map(id);
  if (new Set(result).size !== result.length || result.some(item => !allowed.has(item))) return fail();
  return result;
}
function unique(value: string, seen: Set<string>): string {
  if (seen.has(value)) return fail();
  seen.add(value);
  return value;
}
function payload(value: unknown): unknown {
  // A chamada já entrega JSON decodificado. Não tentar extrair JSON de prosa ou
  // remover campos que o modelo não tinha autorização para definir.
  try {
    if (JSON.stringify(value).length > 200_000) return fail();
  } catch { return fail(); }
  return value;
}

function sources(value: unknown, artifacts: readonly Artifact[]): Source[] {
  return array(value, 1).map(raw => {
    const source = object(raw, ['artifactId', 'locator', 'quote']);
    const artifactId = id(source.artifactId);
    const locator = text(source.locator, 64);
    const quote = text(source.quote);
    const artifact = artifacts.find(item => item.id === artifactId);
    const match = /^L([1-9]\d*)(?:-L([1-9]\d*))?$/.exec(locator);
    if (!artifact || !match) return fail();
    const first = Number(match[1]);
    const last = Number(match[2] ?? match[1]);
    const lines = artifact.text.split('\n');
    if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) ||
      last < first || last > lines.length || !lines.slice(first - 1, last).join('\n').includes(quote)) return fail();
    return { artifactId, locator, quote };
  });
}

export function parseCuration(value: unknown, artifacts: readonly Artifact[]): CurationPayload {
  const root = object(payload(value), ['requirements', 'questions']);
  if (Array.isArray(root.requirements) && root.requirements.length > 10) throw new InvalidPreparationOutput('INPUT_LIMIT');
  const rawRequirements = array(root.requirements);
  const seen = new Set<string>();
  const requirements = rawRequirements.map(raw => {
    const item = object(raw, ['id', 'statement', 'rules', 'sources']);
    return {
      id: unique(id(item.id), seen), statement: text(item.statement), sources: sources(item.sources, artifacts),
      rules: array(item.rules).map(rawRule => {
        const rule = object(rawRule, ['id', 'statement', 'sources']);
        return { id: unique(id(rule.id), seen), statement: text(rule.statement), sources: sources(rule.sources, artifacts) };
      }),
    };
  });
  const requirementIds = new Set(requirements.map(item => item.id));
  const questions = array(root.questions, requirements.length ? 0 : 1).map(raw => {
    const item = object(raw, ['id', 'description', 'requirementIds', 'caseIds', 'blocking', 'sources']);
    if (typeof item.blocking !== 'boolean') return fail();
    return {
      id: unique(id(item.id), seen), description: text(item.description),
      requirementIds: ids(item.requirementIds, requirementIds, requirements.length ? 1 : 0), caseIds: ids(item.caseIds, new Set<string>()),
      blocking: item.blocking, sources: sources(item.sources, artifacts),
    };
  });
  if (!requirements.length && !questions.some(question => question.blocking)) return fail();
  // Sem CA não há base de planejamento; a lacuna deve continuar consultável.
  if (requirements.some(item => item.rules.length === 0 &&
    !questions.some(question => question.blocking && question.requirementIds.includes(item.id)))) return fail();
  return { requirements, questions };
}

export function eligibleRequirements(curation: CurationPayload): Requirement[] {
  const blocked = new Set(curation.questions.filter(item => item.blocking).flatMap(item => item.requirementIds));
  return curation.requirements.filter(item => item.rules.length > 0 && !blocked.has(item.id));
}

export function parsePlan(value: unknown, artifacts: readonly Artifact[], curation: CurationPayload): PlanPayload {
  const root = object(payload(value), ['testPlan']);
  const plan = object(root.testPlan, ['objective', 'requirementIds', 'ruleIds', 'priorities', 'exclusions', 'approach', 'preconditions', 'sources']);
  const eligible = eligibleRequirements(curation);
  const requirementIds = ids(plan.requirementIds, new Set(eligible.map(item => item.id)), 1);
  const selected = eligible.filter(item => requirementIds.includes(item.id));
  const ruleIds = ids(plan.ruleIds, new Set(selected.flatMap(item => item.rules.map(rule => rule.id))), 1);
  if (selected.some(item => !item.rules.some(rule => ruleIds.includes(rule.id)))) return fail();
  const priorities = array(plan.priorities, 1).map(raw => {
    const item = object(raw, ['ruleId', 'reason']);
    const ruleId = id(item.ruleId);
    if (!ruleIds.includes(ruleId)) return fail();
    return { ruleId, reason: text(item.reason) };
  });
  if (new Set(priorities.map(item => item.ruleId)).size !== priorities.length) return fail();
  const exclusions = array(plan.exclusions).map(raw => {
    const item = object(raw, ['description', 'reason']);
    return { description: text(item.description), reason: text(item.reason) };
  });
  return { testPlan: {
    objective: text(plan.objective), requirementIds, ruleIds, priorities, exclusions,
    approach: array(plan.approach, 1).map(item => text(item)),
    preconditions: array(plan.preconditions).map(item => text(item)), sources: sources(plan.sources, artifacts),
  } };
}

export function parseVerdict(value: unknown): Verdict {
  const verdict = object(payload(value), ['status', 'findings', 'reason']);
  if (verdict.status !== 'approved' && verdict.status !== 'changes_requested' && verdict.status !== 'blocked') return fail();
  const findings = array(verdict.findings, verdict.status === 'approved' ? 0 : 1).map(raw => {
    const item = object(raw, ['code', 'message', 'location']);
    return { code: id(item.code), message: text(item.message), location: item.location === null ? null : text(item.location, 1_000) };
  });
  return { status: verdict.status, findings, reason: text(verdict.reason) };
}
