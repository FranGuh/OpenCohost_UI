import { spawn } from 'node:child_process';

const env = { ...process.env, OPENCOHOST_DEBUG: '1' };

const proc = spawn('pnpm', ['tauri', 'dev'], {
  stdio: 'inherit',
  env,
  shell: true,
});

proc.on('exit', (code) => {
  process.exit(code ?? 0);
});
