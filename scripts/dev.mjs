import { spawn } from 'node:child_process';

const port = process.env.PORT ?? '3001';
const children = [];
let shuttingDown = false;

function start(script) {
  const child = spawn('yarn', ['workspace', script, 'dev'], {
    stdio: 'inherit',
    env: { ...process.env, PORT: port },
  });
  children.push(child);
  child.on('exit', (code, signal) => {
    if (shuttingDown || signal) return;
    shutdown(code ?? 1);
  });
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM');
  }
  setTimeout(() => process.exit(code), 100);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

start('@rustdesk-web/gateway');
start('@rustdesk-web/web');
