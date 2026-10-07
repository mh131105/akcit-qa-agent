import { resolve } from 'node:path';
import type { PreparationRole, SpecialistModel, ThinkingLevel } from './runtime/pi.js';

export const normalizeEmail = (email: string): string => email.trim().toLowerCase();
export const isValidEmail = (email: string): boolean =>
  email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

function applicationOrigin(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  const origin = value.trim();
  try {
    const url = new URL(origin);
    const loopback = url.hostname === 'localhost' || url.hostname === '[::1]' ||
      /^127(?:\.\d{1,3}){3}$/.test(url.hostname);
    if (origin !== url.origin || (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))) {
      throw new Error();
    }
    return origin;
  } catch {
    throw new Error('APP_ORIGIN deve ser uma origem HTTPS exata, ou HTTP em loopback, sem caminho.');
  }
}

function parseTargetAllowedOrigins(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  const entries = [...new Set(value.split(',').map(item => item.trim()).filter(Boolean))];
  return entries.map(entry => {
    try {
      const url = new URL(entry);
      if (url.origin !== entry || (url.protocol !== 'http:' && url.protocol !== 'https:')) {
        throw new Error();
      }
      return url.origin;
    } catch {
      throw new Error('TARGET_ALLOWED_ORIGINS contém origem inválida.');
    }
  });
}

const VALID_THINKING_LEVELS = new Set<string>(['off', 'low', 'high']);

export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const environment = env.APP_ENV ?? 'local';
  if (!['local', 'development', 'production'].includes(environment)) {
    throw new Error('APP_ENV deve ser local, development ou production.');
  }
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT inválida.');
  const targetAllowedOrigins = parseTargetAllowedOrigins(env.TARGET_ALLOWED_ORIGINS);
  const preparationModels = {} as Record<PreparationRole, SpecialistModel>;
  let preparationConfigError: string | undefined;
  const visualModels = { executor: {} as SpecialistModel, 'validator-visual': {} as SpecialistModel };
  let visualConfigError: string | undefined;
  const globalThinking = env.PI_THINKING_LEVEL?.trim();
  for (const [profile, prefix] of [
    ['executor', 'PI_EXECUTOR'], ['validator-visual', 'PI_VALIDATOR_VISUAL'],
  ] as const) {
    const provider = env[prefix + '_PROVIDER']?.trim() ?? '';
    const model = env[prefix + '_MODEL']?.trim() ?? '';
    if (Boolean(provider) !== Boolean(model)) {
      visualConfigError ??= prefix + '_PROVIDER e ' + prefix + '_MODEL devem ser configurados juntos.';
    }
    const profileThinking = env[prefix + '_THINKING_LEVEL']?.trim();
    if (profileThinking && !VALID_THINKING_LEVELS.has(profileThinking)) {
      visualConfigError ??= prefix + '_THINKING_LEVEL deve ser off, low ou high.';
    }
    visualModels[profile] = {
      provider,
      model,
      ...(profileThinking && VALID_THINKING_LEVELS.has(profileThinking)
        ? { thinkingLevel: profileThinking as ThinkingLevel } : {}),
    };
  }
  if (globalThinking && !VALID_THINKING_LEVELS.has(globalThinking)) {
    preparationConfigError ??= 'PI_THINKING_LEVEL deve ser off, low ou high.';
  }
  for (const [role, prefix] of [
    ['artifact-curator', 'PI_CURATOR'], ['test-designer', 'PI_PLANNER'], ['output-validator', 'PI_VALIDATOR'],
  ] as const) {
    const provider = env[`${prefix}_PROVIDER`]?.trim() ?? '';
    const model = env[`${prefix}_MODEL`]?.trim() ?? '';
    if (Boolean(provider) !== Boolean(model)) {
      preparationConfigError ??= `${prefix}_PROVIDER e ${prefix}_MODEL devem ser configurados juntos.`;
    }
    const roleThinking = env[`${prefix}_THINKING_LEVEL`]?.trim();
    if (roleThinking && !VALID_THINKING_LEVELS.has(roleThinking)) {
      preparationConfigError ??= `${prefix}_THINKING_LEVEL deve ser off, low ou high.`;
    }
    const rawThinking = roleThinking || globalThinking;
    const thinkingLevel = (rawThinking && VALID_THINKING_LEVELS.has(rawThinking))
      ? (rawThinking as ThinkingLevel)
      : undefined;
    preparationModels[role] = {
      provider: provider || env.PI_PROVIDER?.trim() || '',
      model: model || env.PI_MODEL?.trim() || '',
      ...(thinkingLevel ? { thinkingLevel } : {}),
    };
  }
  const reportProvider = env.PI_REPORT_PROVIDER?.trim() ?? '';
  const reportModel = env.PI_REPORT_MODEL?.trim() ?? '';
  const reportThinking = env.PI_REPORT_THINKING_LEVEL?.trim() || 'low';
  const reportConfigError = Boolean(reportProvider) !== Boolean(reportModel) || !VALID_THINKING_LEVELS.has(reportThinking)
    ? 'Configure PI_REPORT_PROVIDER/MODEL juntos e PI_REPORT_THINKING_LEVEL válido.' : undefined;
  return {
    reportModel: { provider: reportProvider, model: reportModel, thinkingLevel: reportThinking as ThinkingLevel },
    reportConfigError,
    environment,
    port,
    host: env.HOST ?? '127.0.0.1',
    dataDir: resolve(env.DATA_DIR ?? '.data'),
    revision: env.APP_REVISION ?? 'local',
    appOrigin: applicationOrigin(env.APP_ORIGIN),
    targetAllowedOrigins,
    maxConcurrentBrowserSessions: 1,
    preparationModels,
    preparationConfigError,
    visualModels,
    visualConfigError,
    piAuthPath: env.PI_AUTH_PATH?.trim() ? resolve(env.PI_AUTH_PATH.trim()) : undefined,
  };
}

/** Validado ao iniciar, para permitir salvar rascunhos antes da configuração do Pi.
 * Resolve explicitamente thinkingLevel para cada especialista; na ausência,
 * aplica a compatibilidade: deepseek-v4-pro -> high, deepseek-flash -> low, demais -> off.
 */
export type VisualProfile = 'executor' | 'validator-visual';
export type ResolvedVisualModels = Record<VisualProfile, SpecialistModel & { thinkingLevel: ThinkingLevel }>;
/** Perfis visuais do card T8.2: executor e validador visual usam Flash com raciocínio
 * alto por padrão; o validador textual permanece configurado separadamente em Pro/high. */
export function resolveVisualModels(config: ReturnType<typeof readConfig>): ResolvedVisualModels {
  if (config.visualConfigError) throw new Error(config.visualConfigError);
  const resolved = {} as ResolvedVisualModels;
  for (const profile of ['executor', 'validator-visual'] as const) {
    const model = config.visualModels[profile];
    if (!model.provider || !model.model) {
      throw new Error('Configure PI_EXECUTOR_PROVIDER/MODEL e PI_VALIDATOR_VISUAL_PROVIDER/MODEL para o mapeamento visual.');
    }
    resolved[profile] = { provider: model.provider, model: model.model, thinkingLevel: model.thinkingLevel ?? 'high' };
  }
  return resolved;
}

export function resolvePreparationModels(config: ReturnType<typeof readConfig>): Record<PreparationRole, SpecialistModel & { thinkingLevel: ThinkingLevel }> {
  if (config.preparationConfigError) throw new Error(config.preparationConfigError);
  const resolved = {} as Record<PreparationRole, SpecialistModel & { thinkingLevel: ThinkingLevel }>;
  for (const [role, model] of Object.entries(config.preparationModels) as [PreparationRole, SpecialistModel][]) {
    if (!model.provider || !model.model) {
      throw new Error(`Configure PI_PROVIDER e PI_MODEL, ou o par específico de ${role}, para preparar o plano.`);
    }
    const defaultThinkingLevel: ThinkingLevel = model.provider === 'deepseek'
      ? (model.model === 'deepseek-v4-pro' ? 'high' : model.model === 'deepseek-flash' ? 'low' : 'off')
      : 'off';
    resolved[role] = {
      provider: model.provider,
      model: model.model,
      thinkingLevel: model.thinkingLevel ?? defaultThinkingLevel,
    };
  }
  return resolved;
}

/** O redator só é exigido quando o usuário solicita o relatório. */
export function resolveReportModels(config: ReturnType<typeof readConfig>) {
  if (config.reportConfigError || !config.reportModel.provider || !config.reportModel.model) {
    throw new Error(config.reportConfigError ?? 'Configure PI_REPORT_PROVIDER e PI_REPORT_MODEL para gerar o relatório.');
  }
  return { ...resolvePreparationModels(config), 'report-writer': config.reportModel };
}
