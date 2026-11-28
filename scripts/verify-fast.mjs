#!/usr/bin/env node
// The quick merge check: client-data guard, typecheck and unit tests. No build and no end-to-end
// tests (pnpm verify runs those too).
//
//   pnpm verify:fast                 stop at the first failure
//   pnpm verify:fast --keep-going    run every step and list what failed
import { c, fmtSeconds, show } from './lib/cli.mjs';

const keepGoing = process.argv.includes('--keep-going');
const steps = [
  ['Client data guard', 'pnpm', ['check:client-data']],
  ['Test files are run', 'pnpm', ['check:tests']],
  ['No new untested commands', 'pnpm', ['check:e2e-coverage']],
  ['Typecheck', 'pnpm', ['typecheck']],
  ['Unit tests', 'pnpm', ['test']],
];

const results = [];
for (const [name, cmd, args] of steps) {
  console.log(c.cyan(`\n▶ ${name}`));
  const t = Date.now();
  const code = show(cmd, args);
  results.push({ name, ok: code === 0, ms: Date.now() - t });
  if (code !== 0 && !keepGoing) break;
}

console.log(`\n${c.bold('Summary')}`);
for (const r of results) console.log(`  ${r.ok ? c.green('✔') : c.red('✖')} ${r.name} ${c.dim(fmtSeconds(r.ms))}`);
const skipped = steps.slice(results.length).map(([n]) => n);
if (skipped.length) console.log(c.dim(`  skipped: ${skipped.join(', ')}`));
const failed = results.some((r) => !r.ok);
console.log(failed ? c.red('\nNot ready to merge.') : c.green('\nQuick checks pass. Run pnpm verify before merging for the full gate.'));
process.exit(failed ? 1 : 0);
