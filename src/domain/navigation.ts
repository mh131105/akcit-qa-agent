// T8.2 — Contrato do mapa de navegação observado pelo executor visual.
// Validação estrutural de telas, transições, caminhos, referências a observações
// e ações registradas pelas ferramentas; o modelo não pode inventar evidências.
export type ObservationReference = string;
export type ActionReference = string;

export type NavigationScreen = {
  id: string;
  name: string;
  recognition: string;
  // Observações reais que sustentam a tela; IDs criados exclusivamente pelas ferramentas.
  observationIds: ObservationReference[];
};
export type NavigationTransition = {
  id: string;
  from: string;
  // Ação registrada (cursor/teclado) que produziu a transição observada.
  actionId: ActionReference;
  to: string;
  observationIds: ObservationReference[];
};
export type NavigationPath = {
  id: string;
  startScreenId: string;
  transitionIds: string[];
};
export type NavigationPending = {
  id: string;
  description: string;
  affectedCaseIds: string[];
};
export type NavigationAuthentication =
  | { status: 'not_authenticated'; observationId: null }
  | { status: 'authenticated'; observationId: ObservationReference };
export type NavigationMap = {
  screens: NavigationScreen[];
  transitions: NavigationTransition[];
  paths: NavigationPath[];
};
export type NavigationPayload = {
  authentication: NavigationAuthentication;
  map: NavigationMap;
  pending: NavigationPending[];
  limitations: string[];
};

export type NavigationParseContext = {
  // IDs de observações e ações já registradas para esta execução (reais, não inventadas).
  observations: readonly string[];
  actions: readonly string[];
  caseIds: readonly string[];
};

export class InvalidNavigationOutput extends Error {
  constructor(readonly code: 'INVALID_MODEL_OUTPUT' | 'IMAGE_LIMIT' | 'SCREEN_LIMIT' | 'ACTION_LIMIT' | 'ACTION_NOT_SUPPORTED' = 'INVALID_MODEL_OUTPUT') {
    super(code === 'IMAGE_LIMIT'
      ? 'O mapa referencia observações demais para a validação visual desta revisão.'
      : code === 'SCREEN_LIMIT'
      ? 'O mapa excede o limite de telas, transições, caminhos ou pendências.'
      : code === 'ACTION_LIMIT'
      ? 'O limite de cem ações de exploração foi esgotado.'
      : code === 'ACTION_NOT_SUPPORTED'
      ? 'Uma ação registrada com erro não sustenta uma transição bem-sucedida do mapa.'
      : 'A resposta do executor não atende ao contrato do mapa de navegação.');
    this.name = 'InvalidNavigationOutput';
  }
}

export const MAP_LIMITS = {
  screens: 40,
  transitions: 100,
  paths: 50,
  pending: 30,
  limitations: 30,
  refsPerItem: 6,
  text: 4000,
  // Capturas carregadas pelo validador em uma chamada; excesso pede mapa mais enxuto.
  validatorImages: 24,
} as const;

function fail(): never { throw new InvalidNavigationOutput(); }
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  const item = value as Record<string, unknown>;
  if (keys.some(key => !Object.hasOwn(item, key)) || Object.keys(item).some(key => !keys.includes(key))) return fail();
  return item;
}
function array(value: unknown, minimum = 0, maximum = 300): unknown[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) return fail();
  return value;
}
function text(value: unknown, maximum: number = MAP_LIMITS.text): string {
  if (typeof value !== 'string' || !value.trim() || [...value].length > maximum) return fail();
  return value;
}
function id(value: unknown): string {
  const result = text(value, 128);
  return /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(result) ? result : fail();
}
function uniqueId(value: unknown, seen: Set<string>): string {
  const result = id(value);
  if (seen.has(result)) return fail();
  seen.add(result);
  return result;
}
function references(value: unknown, allowed: Set<string>, label: string): string[] {
  const refs = array(value, 1, MAP_LIMITS.refsPerItem).map(item => {
    const reference = id(item);
    if (!allowed.has(reference)) return fail();
    return reference;
  });
  if (new Set(refs).size !== refs.length) return fail();
  void label;
  return refs;
}
function payloadSize(value: unknown) {
  try {
    if (JSON.stringify(value).length > 200_000) return fail();
  } catch { return fail(); }
}

/** Valida a estrutura do mapa e a existência real das observações/ações referenciadas. */
export function parseNavigation(value: unknown, context: NavigationParseContext): NavigationPayload {
  payloadSize(value);
  const root = object(value, ['authentication', 'map', 'pending', 'limitations']);
  const rawAuthentication = object(root.authentication, ['status', 'observationId']);
  if (rawAuthentication.status !== 'authenticated' && rawAuthentication.status !== 'not_authenticated') return fail();
  let authentication: NavigationAuthentication;
  if (rawAuthentication.status === 'not_authenticated') {
    if (rawAuthentication.observationId !== null) return fail();
    authentication = { status: 'not_authenticated', observationId: null };
  } else {
    const observationId = id(rawAuthentication.observationId);
    if (!context.observations.includes(observationId)) return fail();
    authentication = { status: 'authenticated', observationId };
  }
  const observations = new Set(context.observations);
  const actions = new Set(context.actions);
  const rawMap = object(root.map, ['screens', 'transitions', 'paths']);
  const seen = new Set<string>();
  const screens = array(rawMap.screens, 1, MAP_LIMITS.screens).map(raw => {
    const item = object(raw, ['id', 'name', 'recognition', 'observationIds']);
    return { id: uniqueId(item.id, seen), name: text(item.name, 200), recognition: text(item.recognition),
      observationIds: references(item.observationIds, observations, 'screen') };
  });
  const screenIds = new Set(screens.map(screen => screen.id));
  const transitions = array(rawMap.transitions, 0, MAP_LIMITS.transitions).map(raw => {
    const item = object(raw, ['id', 'from', 'actionId', 'to', 'observationIds']);
    const from = id(item.from), to = id(item.to);
    if (!screenIds.has(from) || !screenIds.has(to)) return fail();
    const actionId = id(item.actionId);
    if (!actions.has(actionId)) return fail();
    return { id: uniqueId(item.id, seen), from, actionId, to,
      observationIds: references(item.observationIds, observations, 'transition') };
  });
  const transitionById = new Map(transitions.map(transition => [transition.id, transition]));
  const paths = array(rawMap.paths, 0, MAP_LIMITS.paths).map(raw => {
    const item = object(raw, ['id', 'startScreenId', 'transitionIds']);
    const startScreenId = id(item.startScreenId);
    if (!screenIds.has(startScreenId)) return fail();
    const transitionIds = array(item.transitionIds, 0, MAP_LIMITS.transitions).map(rawId => {
      const reference = id(rawId);
      if (!transitionById.has(reference)) return fail();
      return reference;
    });
    if (new Set(transitionIds).size !== transitionIds.length) return fail();
    // O caminho declarado precisa encadear de fato: cada transição parte da tela anterior.
    let current = startScreenId;
    for (const transitionId of transitionIds) {
      const transition = transitionById.get(transitionId)!;
      if (transition.from !== current) return fail();
      current = transition.to;
    }
    return { id: uniqueId(item.id, seen), startScreenId, transitionIds };
  });
  const caseIds = new Set(context.caseIds);
  const pending = array(root.pending, 0, MAP_LIMITS.pending).map(raw => {
    const item = object(raw, ['id', 'description', 'affectedCaseIds']);
    const affectedCaseIds = array(item.affectedCaseIds, 0, 30).map(rawId => {
      const caseId = id(rawId);
      if (!caseIds.has(caseId)) return fail();
      return caseId;
    });
    if (new Set(affectedCaseIds).size !== affectedCaseIds.length) return fail();
    return { id: uniqueId(item.id, seen), description: text(item.description), affectedCaseIds };
  });
  const limitations = array(root.limitations, 0, MAP_LIMITS.limitations).map(item => text(item, 2000));
  return { authentication, map: { screens, transitions, paths }, pending, limitations };
}

/** Campos públicos do mapa, sem expor nada além do contrato. */
export function publicNavigation(payload: Record<string, unknown>) {
  return {
    authentication: payload.authentication,
    map: payload.map,
    pending: payload.pending,
    limitations: payload.limitations,
    accessRevision: typeof payload.accessRevision === 'number' ? payload.accessRevision : null,
  };
}
