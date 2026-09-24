import { resolve } from 'node:path';
import type { PreparationRole, SpecialistModel } from './runtime/pi.js';

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

export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const environment = env.APP_ENV ?? 'local';
  if (!['local', 'development', 'production'].includes(environment)) {
    throw new Error('APP_ENV deve ser local, development ou production.');
  }
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT inválida.');
  const pilotAllowedEmails = [...new Set((env.PILOT_ALLOWED_EMAILS ?? '').split(',').map(normalizeEmail).filter(Boolean))];
  if (!pilotAllowedEmails.every(isValidEmail)) throw new Error('PILOT_ALLOWED_EMAILS contém e-mail inválido.');
  const preparationModels = {} as Record<PreparationRole, SpecialistModel>;
  let preparationConfigError: string | undefined;
  for (const [role, prefix] of [
    ['artifact-curator', 'PI_CURATOR'], ['test-designer', 'PI_PLANNER'], ['output-validator', 'PI_VALIDATOR'],
  ] as const) {
    const provider = env[`${prefix}_PROVIDER`]?.trim() ?? '';
    const model = env[`${prefix}_MODEL`]?.trim() ?? '';
    if (Boolean(provider) !== Boolean(model)) {
      preparationConfigError ??= `${prefix}_PROVIDER e ${prefix}_MODEL devem ser configurados juntos.`;
    }
    preparationModels[role] = provider || model ? { provider, model } : {
      provider: env.PI_PROVIDER?.trim() ?? '', model: env.PI_MODEL?.trim() ?? '',
    };
  }
  return {
    environment,
    port,
    host: env.HOST ?? '127.0.0.1',
    dataDir: resolve(env.DATA_DIR ?? '.data'),
    revision: env.APP_REVISION ?? 'local',
    appOrigin: applicationOrigin(env.APP_ORIGIN),
    pilotAllowedEmails,
    maxConcurrentBrowserSessions: 1,
    preparationModels,
    preparationConfigError,
  };
}

/** Validado ao iniciar, para permitir salvar rascunhos antes da configuração do Pi. */
export function resolvePreparationModels(config: ReturnType<typeof readConfig>) {
  if (config.preparationConfigError) throw new Error(config.preparationConfigError);
  for (const [role, model] of Object.entries(config.preparationModels)) {
    if (!model.provider || !model.model) {
      throw new Error(`Configure PI_PROVIDER e PI_MODEL, ou o par específico de ${role}, para preparar o plano.`);
    }
  }
  return config.preparationModels;
}
