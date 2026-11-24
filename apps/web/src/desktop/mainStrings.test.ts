import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mainProcessStrings } from './mainStrings.ts';

const desktopSrc = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../desktop/src');

test('every text the desktop main process shows has a translation entry', () => {
  const table = mainProcessStrings();
  const used = new Set<string>();
  for (const file of readdirSync(desktopSrc).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))) {
    for (const m of readFileSync(path.join(desktopSrc, file), 'utf8').matchAll(/\bt\('((?:[^'\\]|\\.)*)'\)/g)) used.add(m[1]!.replace(/\\'/g, "'"));
  }
  assert.ok(used.size > 10);
  for (const english of used) assert.ok(english in table, `apps/web/src/desktop/mainStrings.ts has no entry for "${english}"`);
  // In English the table gives the English back.
  for (const [english, shown] of Object.entries(table)) assert.equal(shown, english);
});
