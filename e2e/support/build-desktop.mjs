// Builds what the desktop project runs: the web app with its test hook into apps/web/dist-e2e
// (VITE_E2E=1, never the shipped dist) and the Electron main process (apps/desktop/dist).
import { execSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const run = (cmd, env = {}) => execSync(cmd, { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } });

run('pnpm --filter @nb/web exec vite build --outDir dist-e2e --emptyOutDir', { VITE_E2E: '1' });
run('pnpm --filter @nb/desktop build');
