#!/usr/bin/env node
// Ratchet on untested commands: the commands that e2e/coverage.ts marks 'todo' may only shrink.
//
// e2e/coverage-todo.json lists the commands that were 'todo' when this check was added. A command
// that is 'todo' in coverage.ts but not in that list (a new command, or one whose test was
// removed) fails the check: give it a test ({ spec: '<file>' }), or a { skip: 'reason' } that a
// reviewer can judge. When a listed command gets its test, delete it from coverage-todo.json too,
// so the list stays exact and cannot be refilled.
//
// This reads coverage.ts only, so it needs no browser. That every live command is listed in
// coverage.ts at all is checked by e2e/specs/coverage.spec.ts, which runs in the e2e CI job.
//
//   pnpm check:e2e-coverage
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** What changed against the baseline: new 'todo' commands (fail) and listed ones no longer 'todo' (fail: tidy the list). */
export function compareTodo(coverage, baseline) {
  const todo = Object.entries(coverage)
    .filter(([, c]) => c === 'todo')
    .map(([id]) => id);
  const listed = new Set(baseline);
  const now = new Set(todo);
  return {
    added: todo.filter((id) => !listed.has(id)).sort(),
    resolved: baseline.filter((id) => !now.has(id)).sort(),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { COVERAGE } = await import(pathToFileURL(join(root, 'e2e', 'coverage.ts')).href);
  const baseline = JSON.parse(readFileSync(join(root, 'e2e', 'coverage-todo.json'), 'utf8'));
  const { added, resolved } = compareTodo(COVERAGE, baseline);
  let failed = false;
  if (added.length) {
    failed = true;
    console.error(`Commands marked 'todo' in e2e/coverage.ts that are not in e2e/coverage-todo.json:`);
    for (const id of added) console.error(`  ${id}`);
    console.error(`New commands need an end-to-end test ({ spec: '<file>' }) or a { skip: 'reason' } entry, not 'todo'.\n`);
  }
  if (resolved.length) {
    failed = true;
    console.error(`Commands in e2e/coverage-todo.json that are no longer 'todo': delete them from that file.`);
    for (const id of resolved) console.error(`  ${id}`);
  }
  if (failed) process.exit(1);
  console.log(`${baseline.length} commands still 'todo', none new.`);
}
