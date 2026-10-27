import { spawn } from 'node:child_process';

const run = (name, cmd, args, cwd) => {
  const p = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' });
  const tag = (d) =>
    d
      .toString()
      .split('\n')
      .filter(Boolean)
      .forEach((l) => console.log(`[${name}] ${l}`));
  p.stdout.on('data', tag);
  p.stderr.on('data', tag);
  p.on('exit', (code) => {
    console.log(`[${name}] exited (${code})`);
    process.exit(code ?? 0);
  });
  return p;
};
const procs = [run('api', 'npm', ['run', 'dev'], 'server'), run('web', 'npm', ['run', 'dev'], 'web')];
console.log('API: http://localhost:8787   UI: http://localhost:5173');
process.on('SIGINT', () => {
  procs.forEach((p) => p.kill());
  process.exit(0);
});
