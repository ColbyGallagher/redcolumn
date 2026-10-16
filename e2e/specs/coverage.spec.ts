import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { COVERAGE } from '../coverage.ts';
import { expect, test } from '../support/app.ts';

// Commands that exist in one app only (desktop() in apps/web/src/desktop/host.ts decides).
const WEB_ONLY = new Set(['help.install']);
const DESKTOP_ONLY = new Set<string>([]);

test('every command is in coverage.ts', async ({ app }, info) => {
  await app.open('plan.pdf');
  const live = new Set((await app.commands()).map((c) => c.id));
  const missing = [...live].filter((id) => !(id in COVERAGE));
  expect(missing, 'Commands with no entry in e2e/coverage.ts: add a test, or list them as todo or skip').toEqual([]);

  const elsewhere = info.project.name === 'desktop' ? WEB_ONLY : DESKTOP_ONLY;
  const gone = Object.keys(COVERAGE).filter((id) => !live.has(id) && !elsewhere.has(id));
  expect(gone, 'e2e/coverage.ts lists commands the app no longer has').toEqual([]);
});

test('covered commands name a spec that uses them', () => {
  const wrong: string[] = [];
  for (const [id, c] of Object.entries(COVERAGE)) {
    if (typeof c !== 'object' || !('spec' in c)) continue;
    const file = join(import.meta.dirname, `${c.spec}.spec.ts`);
    // A tool command is used as app.tool('<name>') or in a table of tool names.
    const name = id.startsWith('tool.') ? id.slice(5) : id;
    if (!existsSync(file) || !readFileSync(file, 'utf8').includes(`'${name}'`)) wrong.push(`${id} -> ${c.spec}.spec.ts`);
  }
  expect(wrong, 'Each covered command must appear in its spec').toEqual([]);
});

test('coverage report', async ({}, info) => {
  const entries = Object.entries(COVERAGE);
  const covered = entries.filter(([, c]) => typeof c === 'object' && 'spec' in c).length;
  const skipped = entries.filter(([, c]) => typeof c === 'object' && 'skip' in c).length;
  const todo = entries.filter(([, c]) => c === 'todo').map(([id]) => id);
  const summary = `${covered} covered, ${skipped} skipped, ${todo.length} todo of ${entries.length} commands`;
  console.log(`[${info.project.name}] coverage: ${summary}`);
  await info.attach('coverage', { body: `${summary}\n\nTodo:\n${todo.join('\n')}\n`, contentType: 'text/plain' });
  if (process.env.E2E_STRICT_COVERAGE === '1') expect(todo, 'Commands without a test').toEqual([]);
});
