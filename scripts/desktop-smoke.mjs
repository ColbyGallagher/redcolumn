#!/usr/bin/env node
// Builds the real packaged desktop app (unpacked) and launches it in smoke mode. It passes only
// if the window renders (#root has content) with no console errors. Unit tests cannot catch a
// blank window; this does.
//
//   pnpm desktop:smoke               build, then launch
//   pnpm desktop:smoke --skip-build  launch the last build again
//   pnpm desktop:smoke --timeout 120 allow 120 seconds for the app to finish (default 90)
//
// The app runs with its own temporary profile, so your installed redcolumn can stay open (a
// running copy would otherwise make the smoke run quit early and look like a pass). The build goes
// to a short temp folder because long paths break Windows packaging.
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { c, flag, fmtSeconds, root, show } from './lib/cli.mjs';

const args = process.argv.slice(2);
const skipBuild = flag(args, '--skip-build');
const timeoutMs = Number(flag(args, '--timeout', true) ?? 90) * 1000;

const desktop = join(root, 'apps', 'desktop');
const platform = process.platform;
const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
// A fixed folder (not a fresh one each run) so --skip-build can find the last build.
const outDir = join(platform === 'win32' ? (process.env.SystemDrive ? `${process.env.SystemDrive}\\` : 'C:\\') : tmpdir(), 'rc-smoke-build');

const exe =
  platform === 'win32'
    ? join(outDir, arch === 'arm64' ? 'win-arm64-unpacked' : 'win-unpacked', 'redcolumn.exe')
    : platform === 'darwin'
      ? join(outDir, arch === 'arm64' ? 'mac-arm64' : 'mac', 'redcolumn.app', 'Contents', 'MacOS', 'redcolumn')
      : join(outDir, 'linux-unpacked', 'redcolumn');
const target = platform === 'win32' ? '--win' : platform === 'darwin' ? '--mac' : '--linux';

function step(name, cmd, cmdArgs, opts = {}) {
  console.log(c.cyan(`\n▶ ${name}`));
  const t = Date.now();
  const code = show(cmd, cmdArgs, opts);
  if (code !== 0) {
    console.error(c.red(`\n${name} failed (exit ${code}).`));
    process.exit(1);
  }
  console.log(c.dim(fmtSeconds(Date.now() - t)));
}

if (!skipBuild) {
  step('Build the web app', 'pnpm', ['--filter', '@nb/web', 'build']);
  step('Compile the desktop app', 'pnpm', ['--filter', '@nb/desktop', 'build']);
  step('Fetch the assistant Node binary', 'node', ['scripts/fetch-assistant-node.mjs', `--arch=${arch}`], { cwd: desktop });
  rmSync(outDir, { recursive: true, force: true });
  step('Package (unpacked)', 'pnpm', [
    '--filter', '@nb/desktop', 'exec', 'electron-builder', target, `--${arch}`, '--dir', '--publish', 'never',
    `-c.directories.output=${outDir}`,
  ], { env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' } });
}

if (!existsSync(exe)) {
  console.error(c.red(`\nNo packaged app at ${exe}. Run without --skip-build.`));
  process.exit(1);
}

const profile = mkdtempSync(join(tmpdir(), 'rc-smoke-profile-'));
mkdirSync(join(profile, 'ud'), { recursive: true });
console.log(c.cyan('\n▶ Launch in smoke mode'));
console.log(c.dim(exe));
const t = Date.now();
const r = spawnSync(exe, [`--user-data-dir=${join(profile, 'ud')}`], {
  env: { ...process.env, RECOLUMN_SMOKE: '1', APPDATA: profile, XDG_CONFIG_HOME: profile },
  stdio: 'inherit',
  timeout: timeoutMs,
});
rmSync(profile, { recursive: true, force: true });
// The build stays at outDir so --skip-build can launch it again; the next full run replaces it.

if (r.error?.code === 'ETIMEDOUT' || r.signal) {
  console.error(c.red(`\nSmoke test FAILED: the app did not finish within ${timeoutMs / 1000} s (${r.signal ?? 'timeout'}).`));
  process.exit(1);
}
if (r.status !== 0) {
  console.error(c.red(`\nSmoke test FAILED (exit ${r.status}). The window did not render cleanly. The build is kept at ${outDir}.`));
  process.exit(1);
}
console.log(c.green(`\nSmoke test passed in ${fmtSeconds(Date.now() - t)}: the window rendered with no console errors.`));
