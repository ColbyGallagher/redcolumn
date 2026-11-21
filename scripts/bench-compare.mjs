#!/usr/bin/env node
// Runs the render benchmark on a PDF and compares it with a saved baseline, so a slowdown shows up
// before it ships.
//
//   pnpm bench:compare <file.pdf> [pages, e.g. 1,2,40] [--save] [--runs 3] [--threshold 15]
//
// First run it with --save on a good build: that records this PDF's times on this machine in
// bench-baselines.local (never committed; times only mean something on the same machine). After
// that, running it without --save compares and exits non-zero if the optimised render got more
// than --threshold percent slower (default 15). Each measurement is the median of --runs runs.
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { c, flag, root, run } from './lib/cli.mjs';

const args = process.argv.slice(2);
const save = flag(args, '--save');
const runs = Number(flag(args, '--runs', true) ?? 3);
const threshold = Number(flag(args, '--threshold', true) ?? 15);
const [file, pages = 'all'] = args;
let fileSize = 0;
try {
  fileSize = file ? statSync(file).size : 0;
} catch {
  // handled below
}
if (!file || !fileSize) {
  console.error('Usage: pnpm bench:compare <file.pdf> [pages] [--save] [--runs 3] [--threshold 15]');
  process.exit(2);
}

const baselineFile = join(root, 'bench-baselines.local');
let baselines = {};
try {
  baselines = JSON.parse(readFileSync(baselineFile, 'utf8'));
} catch {
  // no baseline file yet
}
const key = `${basename(file)}|${fileSize}|${pages}`;

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const samples = { before: [], after: [], build: [] };
const benchArgs = [
  '--experimental-transform-types', '--no-warnings', '--import', './apps/web/test/resolve-ts.mjs',
  'scripts/render-bench.mjs', file, ...(pages === 'all' ? [] : [pages]),
];

for (let i = 1; i <= runs; i++) {
  process.stdout.write(c.dim(`run ${i}/${runs}... `));
  const r = run(process.execPath, benchArgs);
  const text = `${r.stdout}\n${r.stderr}`;
  const total = /total ([\d.]+) s -> ([\d.]+) s/.exec(text);
  const build = /Optimised copy built in ([\d.]+) s/.exec(text);
  if (r.status !== 0 || !total) {
    console.error(c.red('\nThe benchmark did not finish.'));
    console.error(text.split('\n').slice(-12).join('\n'));
    process.exit(1);
  }
  samples.before.push(Number(total[1]));
  samples.after.push(Number(total[2]));
  if (build) samples.build.push(Number(build[1]));
  console.log(`${total[1]} s -> ${total[2]} s`);
}

const now = { before: median(samples.before), after: median(samples.after), build: samples.build.length ? median(samples.build) : null };
console.log(`\n${c.bold(basename(file))}${pages === 'all' ? '' : ` pages ${pages}`}  (median of ${runs})`);
console.log(`  original draw     ${now.before.toFixed(1)} s`);
console.log(`  optimised draw    ${now.after.toFixed(1)} s`);
if (now.build !== null) console.log(`  optimised build   ${now.build.toFixed(1)} s`);

if (save) {
  baselines[key] = { ...now, savedAt: new Date().toISOString(), commit: run('git', ['rev-parse', '--short', 'HEAD']).stdout.trim() };
  writeFileSync(baselineFile, `${JSON.stringify(baselines, null, 2)}\n`);
  console.log(c.green(`\nBaseline saved to bench-baselines.local.`));
  process.exit(0);
}

const base = baselines[key];
if (!base) {
  console.log(c.yellow('\nNo baseline for this file and page set. Run again with --save on a build you trust.'));
  process.exit(0);
}

console.log(c.dim(`\nBaseline from ${base.savedAt.slice(0, 10)} at ${base.commit}`));
let regressed = false;
for (const [label, k] of [['optimised draw', 'after'], ['original draw', 'before'], ['optimised build', 'build']]) {
  if (now[k] === null || base[k] == null) continue;
  const change = ((now[k] - base[k]) / base[k]) * 100;
  const bad = change > threshold;
  // The benchmark rounds to 0.1 s, so ignore moves of 0.1 s or less on short runs.
  const noise = Math.abs(now[k] - base[k]) <= 0.1;
  if (bad && !noise) regressed = true;
  const text = `${change >= 0 ? '+' : ''}${change.toFixed(0)}%  (${base[k].toFixed(1)} s -> ${now[k].toFixed(1)} s)`;
  console.log(`  ${label.padEnd(16)} ${bad && !noise ? c.red(text) : change < -threshold ? c.green(text) : text}`);
}
console.log(regressed ? c.red(`\nSlower than the baseline by more than ${threshold}%.`) : c.green('\nNo regression.'));
process.exit(regressed ? 1 : 0);
