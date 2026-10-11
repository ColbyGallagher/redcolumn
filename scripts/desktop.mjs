import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';

const port = 5173;
const host = '127.0.0.1';

function waitForPort() {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.connect(port, host, () => {
        socket.end();
        resolve();
      });
      socket.on('error', () => {
        socket.destroy();
        if (Date.now() - started > 60_000) reject(new Error(`The dev server did not open ${host}:${port}`));
        else setTimeout(attempt, 200);
      });
    };
    attempt();
  });
}

// pnpm passes arguments after the script name straight to it. A `--` would reach Vite literally,
// and Vite would ignore every flag after it.
const web = spawn('pnpm', ['--filter', '@nb/web', 'dev', '--host', host, '--port', String(port), '--strictPort'], {
  stdio: 'inherit',
  shell: true,
  detached: process.platform !== 'win32',
});

let electron;
try {
  await waitForPort();
  electron = spawn('pnpm', ['--filter', '@nb/desktop', 'start'], {
    stdio: 'inherit',
    shell: true,
    detached: process.platform !== 'win32',
    env: { ...process.env, ELECTRON_DEV: '1' },
  });
} catch (err) {
  killTree(web);
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}

// With shell: true, kill() ends the shell and leaves Vite holding the port. End the whole tree.
function killTree(child) {
  if (!child || child.exitCode !== null || !child.pid) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      child.kill();
    }
  }
}

const stop = () => {
  killTree(electron);
  killTree(web);
};
electron.on('exit', () => {
  killTree(web);
  process.exit(0);
});
web.on('exit', () => {
  killTree(electron);
});
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
