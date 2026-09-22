import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const port = Number(process.env.LOCAL_DEV_PORT ?? 3111);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('LOCAL_DEV_PORT inválida');
const knownHosts = fileURLToPath(new URL('../deploy/known_hosts', import.meta.url));
const children = new Set();
const server = createServer(client => {
  const args = ['-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', `UserKnownHostsFile=${knownHosts}`, '-o', 'ConnectTimeout=15'];
  if (process.env.AKCIT_SSH_KEY) args.push('-i', process.env.AKCIT_SSH_KEY, '-o', 'IdentitiesOnly=yes');
  const ssh = spawn('ssh', [...args, 'matheus@76.13.175.64', 'akcit-dev-access'], { stdio: ['pipe', 'pipe', 'inherit'] });
  children.add(ssh);
  client.pipe(ssh.stdin);
  ssh.stdout.pipe(client);
  client.on('error', () => ssh.kill());
  ssh.stdin.on('error', () => client.destroy());
  ssh.on('error', error => { console.error(error.message); client.destroy(); });
  ssh.on('exit', code => {
    children.delete(ssh);
    if (code) console.error('Acesso recusado. Confira sua chave SSH e o cadastro de acesso à VPS.');
    client.destroy();
  });
  client.on('close', () => ssh.kill());
});
server.listen(port, '127.0.0.1', () => console.log(`Desenvolvimento remoto: http://127.0.0.1:${port} · Ctrl+C para encerrar`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  server.close();
  for (const child of children) child.kill();
});
