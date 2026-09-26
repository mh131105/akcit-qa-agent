import { isDeepStrictEqual } from 'node:util';
import { InvalidPreparationOutput, type TestCase, type TestCasesPayload } from './preparation.js';
import type { NavigationPayload } from './navigation.js';

export type ApprovedCaseRevision = { outputId: string; revision: number };
export type RouteAssociation = { caseId: string; pathId: string | null; reason: string | null };
export type DetailedTestCase = Omit<TestCase, 'pathId'> & {
  pathId: string | null; approvedCaseRevision: ApprovedCaseRevision;
};
export type RouteDetailPayload = {
  testCases: DetailedTestCase[];
  pending: { caseId: string; reason: string }[];
};

const fail = (): never => { throw new InvalidPreparationOutput(); };
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  const item = value as Record<string, unknown>;
  if (keys.some(key => !Object.hasOwn(item, key)) || Object.keys(item).some(key => !keys.includes(key))) return fail();
  return item;
}

/** O modelo fornece somente associações; os campos lógicos nunca vêm da resposta. */
export function parseRouteAssociations(value: unknown, cases: TestCasesPayload, navigation: NavigationPayload): RouteAssociation[] {
  const root = object(value, ['routes']);
  if (!Array.isArray(root.routes) || root.routes.length !== cases.testCases.length) return fail();
  const caseIds = new Set(cases.testCases.map(item => item.id));
  const pathIds = new Set(navigation.map.paths.map(item => item.id));
  const seen = new Set<string>();
  return root.routes.map(raw => {
    const item = object(raw, ['caseId', 'pathId', 'reason']);
    if (typeof item.caseId !== 'string' || !caseIds.has(item.caseId) || seen.has(item.caseId)) return fail();
    seen.add(item.caseId);
    if (item.pathId === null) {
      if (typeof item.reason !== 'string' || !item.reason.trim() || [...item.reason].length > 4000) return fail();
    } else if (typeof item.pathId !== 'string' || !pathIds.has(item.pathId) || item.reason !== null) return fail();
    return { caseId: item.caseId, pathId: item.pathId as string | null, reason: item.reason as string | null };
  });
}

export function buildRouteDetail(value: unknown, cases: TestCasesPayload, navigation: NavigationPayload,
  approvedCaseRevision: ApprovedCaseRevision): RouteDetailPayload {
  const routes = parseRouteAssociations(value, cases, navigation);
  const payload: RouteDetailPayload = {
    testCases: cases.testCases.map(item => ({ ...structuredClone(item),
      pathId: routes.find(route => route.caseId === item.id)!.pathId,
      approvedCaseRevision: { ...approvedCaseRevision } })),
    pending: routes.filter(route => route.pathId === null).map(route => ({ caseId: route.caseId, reason: route.reason! })),
  };
  return validateRouteDetail(payload, cases, navigation, approvedCaseRevision);
}

/** Valida também saídas persistidas: comparação estrutural, inclusive campos extras. */
export function validateRouteDetail(value: unknown, cases: TestCasesPayload, navigation: NavigationPayload,
  approvedCaseRevision: ApprovedCaseRevision): RouteDetailPayload {
  const root = object(value, ['testCases', 'pending']);
  if (!Array.isArray(root.testCases) || !Array.isArray(root.pending) || root.testCases.length !== cases.testCases.length) return fail();
  const pending = root.pending.map(raw => {
    const item = object(raw, ['caseId', 'reason']);
    if (typeof item.caseId !== 'string' || typeof item.reason !== 'string') return fail();
    return { caseId: item.caseId, reason: item.reason };
  });
  if (new Set(pending.map(item => item.caseId)).size !== pending.length) return fail();
  const testCases = root.testCases.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail();
    const { pathId, approvedCaseRevision: reference, ...protectedFields } = raw as DetailedTestCase;
    if (!isDeepStrictEqual(reference, approvedCaseRevision) ||
      !isDeepStrictEqual({ ...protectedFields, pathId: null }, cases.testCases[index])) return fail();
    return raw as DetailedTestCase;
  });
  parseRouteAssociations({ routes: testCases.map(item => ({ caseId: item.id, pathId: item.pathId,
    reason: pending.find(entry => entry.caseId === item.id)?.reason ?? null })) }, cases, navigation);
  if (pending.length !== testCases.filter(item => item.pathId === null).length ||
    pending.some(item => !testCases.some(testCase => testCase.id === item.caseId && testCase.pathId === null))) return fail();
  return structuredClone({ testCases, pending });
}
