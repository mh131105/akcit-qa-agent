import { resolve } from 'node:path';

export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const environment = env.APP_ENV ?? 'local';
  if (!['local', 'development', 'production'].includes(environment)) {
    throw new Error('APP_ENV deve ser local, development ou production.');
  }
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT inválida.');
  return {
    environment,
    port,
    host: env.HOST ?? '127.0.0.1',
    dataDir: resolve(env.DATA_DIR ?? '.data'),
    revision: env.APP_REVISION ?? 'local',
    maxConcurrentBrowserSessions: 1,
  };
}
