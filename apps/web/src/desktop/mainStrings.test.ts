import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mainProcessStrings } from './mainStrings.ts';
import { usableLocale } from '../i18n/language.ts';

const desktopSrc = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../desktop/src');

test('the desktop main process and the translation table name the same texts', () => {
  const table = mainProcessStrings();
  const used = new Set<string>();
  const files = readdirSync(desktopSrc, { recursive: true })
    .map(String)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
  for (const file of files) {
    for (const m of readFileSync(path.join(desktopSrc, file), 'utf8').matchAll(/\bt\((['"])((?:(?!\1)[^\\]|\\.)*)\1\)/g)) used.add(m[2]!.replace(/\\(['"])/g, '$1'));
  }
  assert.ok(used.size > 10);
  for (const english of used) assert.ok(english in table, `apps/web/src/desktop/mainStrings.ts has no entry for "${english}"`);
  for (const english of Object.keys(table)) assert.ok(used.has(english), `"${english}" in mainStrings.ts is no longer used by the main process`);
  // In English the table gives the English back.
  for (const [english, shown] of Object.entries(table)) assert.equal(shown, english);
});

test('the system locale the desktop reports is made usable, or set aside', () => {
  assert.equal(usableLocale('de-DE'), 'de-DE');
  assert.equal(usableLocale('de_DE'), 'de-DE');
  assert.equal(usableLocale('de_DE.UTF-8'), 'de-DE');
  assert.equal(usableLocale('en_US@rg=dezzzz'), 'en-US');
  assert.equal(usableLocale('C'), null);
  assert.equal(usableLocale(''), null);
  assert.equal(usableLocale(undefined), null);
});
