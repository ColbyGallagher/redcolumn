#!/usr/bin/env node
// Runs end-to-end tests over and over and reports how often each one fails, to tell a real
// break from a flake.
//
//   pnpm e2e:flake <filter> [-n 10] [--project web|desktop] [--workers N] [--no-build] [--stop-on-fail]
//
// <filter> is anything Playwright accepts: a spec file name (markups), a path (specs/zoom.spec.ts)
// or --grep "text". Several filters are fine. For the desktop project the desktop build is made
// once first (skip with --no-build if you just did it). Set E2E_PORT to a free port if another
// checkout is running its own e2e.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { c, flag, fmtSeconds, root, run, show } from './lib/cli.mjs';

const args = process.argv.slice(2);
const runs = Number(flag(args, '-n', true) ?? flag(args, '--runs', true) ?? 10);
const project = flag(args, '--project', true) ?? 'web';
const workers = flag(args, '--workers', true);
const noBuild = flag(args, '--no-build');
const stopOnFail = flag(args, '--stop-on-fail');

if (!Number.isInteger(runs) || runs < 1) {
  console.error('-n must be a whole number, 1 or more.');
  process.exit(2);
}
if (!['web', 'desktop'].includes(project)) {
  console.error('--project must be web or desktop.');
  process.exit(2);
}
if (!args.length) {
  console.error('Usage: pnpm e2e:flake <spec or --grep "text"> [-n 10] [--project web|desktop] [--workers N] [--no-build] [--stop-on-fail]');
  process.exit(2);
}

if (project === 'desktop' && !noBuild) {
  console.log(c.cyan('Building the desktop test app once...'));
  if (show('node', ['e2e/support/build-desktop.mjs']) !== 0) process.exit(1);
}

const tmp = mkdtempSync(join(tmpdir(), 'rc-flake-'));
const failures = new Map(); // test title -> { count, message }
let failedRuns = 0;
let done = 0;
const started = Date.now();

/** Collects the titles of failed tests from Playwright's JSON report. */
function collect(suites, trail, into) {
  for (const s of suites ?? []) {
    const path = s.title && !s.title.endsWith('.ts') ? [...trail, s.title] : trail;
    for (const spec of s.specs ?? []) {
      if (spec.ok) continue;
      const result = spec.tests?.flatMap((t) => t.results ?? []).find((r) => r.status === 'failed' || r.status === 'timedOut');
      const message = (result?.error?.message ?? '').replace(/\x1b\[[0-9;]*m/g, '').split('\n').find((l) => l.trim()) ?? '';
      into.push({ title: [...path, spec.title].join(' › '), file: spec.file, message: message.trim().slice(0, 160) });
    }
    collect(s.suites, path, into);
  }
}

for (let i = 1; i <= runs; i++) {
  const report = join(tmp, `run-${i}.json`);
  const pw = ['--filter', '@nb/e2e', 'exec', 'playwright', 'test', ...args, `--project=${project}`, '--reporter=json'];
  if (workers) pw.push(`--workers=${workers}`);
  const r = run('pnpm', pw, { env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: report }, cwd: root });
  done = i;
  let failed = [];
  try {
    collect(JSON.parse(readFileSync(report, 'utf8')).suites, [], failed);
  } catch {
    // No report: the run did not start (a build error or a busy port). Show why.
    console.error(c.red(`\nRun ${i} produced no report.`));
    console.error((r.stderr || r.stdout || '').split('\n').slice(-15).join('\n'));
    process.exit(1);
  }
  if (r.status !== 0 && failed.length === 0) failed = [{ title: '(run failed without a failed test; see the output above)', message: '' }];
  if (failed.length) failedRuns++;
  for (const f of failed) {
    const prev = failures.get(f.title) ?? { count: 0, message: f.message };
    failures.set(f.title, { count: prev.count + 1, message: prev.message || f.message });
  }
  console.log(`${failed.length ? c.red('✖') : c.green('✔')} run ${i}/${runs}${failed.length ? ` ${c.red(`${failed.length} failed`)}` : ''}`);
  if (failed.length && stopOnFail) break;
}
rmSync(tmp, { recursive: true, force: true });

console.log(`\n${c.bold('Result')} ${done} run${done === 1 ? '' : 's'} in ${fmtSeconds(Date.now() - started)}: ${failedRuns} with failures (${((failedRuns / done) * 100).toFixed(0)}%)`);
if (failures.size) {
  console.log(c.bold('\nFailing tests (times failed / runs)'));
  for (const [title, f] of [...failures].sort((a, b) => b[1].count - a[1].count)) {
    console.log(`  ${String(f.count).padStart(3)}/${done}  ${title}`);
    if (f.message) console.log(c.dim(`           ${f.message}`));
  }
  const always = [...failures.values()].every((f) => f.count === done);
  console.log(
    always
      ? c.red('\nEvery failure happened on every run: a real break, not a flake.')
      : c.yellow('\nSome failures came and went: flaky. A test that fails on every run is a real break.'),
  );
} else console.log(c.green('No failures.'));
process.exit(failedRuns ? 1 : 0);
