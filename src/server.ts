import { createApp } from './app.js';
import { readConfig } from './config.js';

const config = readConfig();
const app = await createApp(config);
app.listen(config.port, config.host, () => {
  console.log(JSON.stringify({ event: 'server-ready', environment: config.environment, port: config.port }));
});
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    void (async () => {
      // Libera a reserva e encerra sessão/navegador antes de fechar o processo.
      await app.shutdown();
      app.close(() => process.exit(0));
      setTimeout(() => process.exit(1), 10000).unref();
    })();
  });
}
