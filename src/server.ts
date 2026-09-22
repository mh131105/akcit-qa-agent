import { createApp } from './app.js';
import { readConfig } from './config.js';

const config = readConfig();
const server = await createApp(config);
server.listen(config.port, config.host, () => {
  console.log(JSON.stringify({ event: 'server-ready', environment: config.environment, port: config.port }));
});
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10000).unref();
  });
}
