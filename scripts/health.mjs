#!/usr/bin/env node
// Checks that this machine is set up to build, test and release redcolumn, and says how to fix
// anything that is not. Changes nothing.
//
//   pnpm health
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import net from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { c, root, tryOut } from './lib/cli.mjs';

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const results = [];
const add = (level, name, detail = '', fix = '') => results.push({ level, name, detail, fix });

// Node
const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor >= 24) add('ok', 'Node', `v${process.versions.node}`);
else add('fail', 'Node', `v${process.versions.node}`, 'CI and releases use Node 24. Install Node 24 or newer.');

// pnpm
const wantPnpm = (pkg.packageManager ?? '').replace('pnpm@', '');
const havePnpm = tryOut('pnpm', ['--version']);
if (!havePnpm) add('fail', 'pnpm', 'not found', `Install pnpm ${wantPnpm} (corepack enable).`);
else if (wantPnpm && havePnpm !== wantPnpm) add('warn', 'pnpm', `${havePnpm}, repo wants ${wantPnpm}`, `corepack use pnpm@${wantPnpm}`);
else add('ok', 'pnpm', havePnpm);

// git hooks
const hooks = tryOut('git', ['config', 'core.hooksPath']);
if (hooks && /(^|[\\/])\.githooks$/.test(hooks)) add('ok', 'Git hooks', '.githooks is active (client-data guard runs on commit)');
else add('fail', 'Git hooks', hooks ? `hooksPath is ${hooks}` : 'not set', 'git config core.hooksPath .githooks (or pnpm install)');

// dependencies
const modules = join(root, 'node_modules');
if (!existsSync(modules)) add('fail', 'Dependencies', 'node_modules is missing', 'pnpm install');
else {
  const marker = join(modules, '.modules.yaml');
  const lock = join(root, 'pnpm-lock.yaml');
  const stale = existsSync(marker) && existsSync(lock) && statSync(lock).mtimeMs > statSync(marker).mtimeMs;
  if (stale) add('warn', 'Dependencies', 'pnpm-lock.yaml is newer than the last install', 'pnpm install');
  else add('ok', 'Dependencies', 'installed');
}

// Electron binary (desktop app, desktop e2e, smoke test)
const electronDist = join(root, 'apps', 'desktop', 'node_modules', 'electron', 'dist');
if (existsSync(electronDist)) add('ok', 'Electron', 'binary downloaded');
else add('warn', 'Electron', 'binary not downloaded', 'pnpm install (or pnpm rebuild electron)');

// Playwright browser (web e2e)
const browsers =
  process.env.PLAYWRIGHT_BROWSERS_PATH ??
  (process.platform === 'win32'
    ? join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'ms-playwright')
    : process.platform === 'darwin'
      ? join(homedir(), 'Library', 'Caches', 'ms-playwright')
      : join(homedir(), '.cache', 'ms-playwright'));
const hasChromium = existsSync(browsers) && readdirSync(browsers).some((d) => d.startsWith('chromium'));
if (hasChromium) add('ok', 'Playwright Chromium', browsers);
else add('warn', 'Playwright Chromium', 'not installed', 'pnpm --filter @nb/e2e exec playwright install chromium');

// GitHub CLI (pr:status, branches:prune, release)
const gh = tryOut('gh', ['--version']);
if (!gh) add('warn', 'GitHub CLI', 'gh not found', 'Install gh from https://cli.github.com (needed for pr:status, branches:prune, release)');
else if (tryOut('gh', ['auth', 'status']) === null) add('warn', 'GitHub CLI', 'not signed in', 'gh auth login');
else add('ok', 'GitHub CLI', gh.split('\n')[0]);

// local client-data identifiers
if (existsSync(join(root, '.client-data.local'))) add('ok', 'Client identifiers', '.client-data.local present');
else add('warn', 'Client identifiers', '.client-data.local missing', 'Create it (one word per line) so the guard knows your clients and projects.');

// ports
function portFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => s.close(() => resolve(true)));
    s.listen(port, '127.0.0.1');
  });
}
const e2ePort = Number(process.env.E2E_PORT ?? 5179);
for (const [port, what] of [
  [5173, 'dev server (pnpm dev / pnpm desktop)'],
  [e2ePort, 'e2e server'],
]) {
  if (await portFree(port)) add('ok', `Port ${port}`, `free for the ${what}`);
  else add('warn', `Port ${port}`, `in use, so the ${what} cannot start`, 'Close the other dev server (maybe another session) or set E2E_PORT.');
}

const mark = { ok: c.green('✔'), warn: c.yellow('!'), fail: c.red('✖') };
for (const r of results) {
  console.log(`${mark[r.level]} ${c.bold(r.name)}${r.detail ? `  ${c.dim(r.detail)}` : ''}`);
  if (r.fix && r.level !== 'ok') console.log(`    → ${r.fix}`);
}
const fails = results.filter((r) => r.level === 'fail').length;
const warns = results.filter((r) => r.level === 'warn').length;
console.log(`\n${fails} problem${fails === 1 ? '' : 's'}, ${warns} warning${warns === 1 ? '' : 's'}.`);
process.exit(fails ? 1 : 0);
