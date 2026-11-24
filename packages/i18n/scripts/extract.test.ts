import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTemplate, checkCatalog, extractFromSource, mergeCatalog } from './extract.ts';
import { poHeader } from '../src/po.ts';

const SRC = `
import { msg, msgc } from '@nb/i18n';
export function Panel({ n }: { n: number }) {
  // translators: shown on the ribbon's File tab
  const a = msg('Save all');
  const b = msgc('verb', \`Count\`);
  const c = msg('{n, plural, one {# sheet} other {# sheets}}', { n });
  const name = 'x';
  const bad = msg(name);
  const broken = msg('Open {name');
  return <button title={msg('Close')}>{msgc('noun', 'Count')}</button>;
}
`;

test('finds literal messages, contexts and translator notes', () => {
  const { messages, errors } = extractFromSource('apps/web/src/Panel.tsx', SRC);
  assert.deepEqual(
    messages.map((m) => [m.context ?? '', m.id, m.note ?? '']),
    [
      ['', 'Save all', "shown on the ribbon's File tab"],
      ['verb', 'Count', ''],
      ['', '{n, plural, one {# sheet} other {# sheets}}', ''],
      ['', 'Open {name', ''],
      ['', 'Close', ''],
      ['noun', 'Count', ''],
    ],
  );
  assert.equal(errors.length, 2);
  assert.match(errors[0]!, /Panel\.tsx:9: msg\(\) needs literal text/);
  assert.match(errors[1]!, /Panel\.tsx:10: Expected/);
});

test('template merges repeats and sorts by file', () => {
  const t = buildTemplate([
    { id: 'B', ref: 'b.ts' },
    { id: 'A', ref: 'b.ts', note: 'n' },
    { id: 'B', ref: 'a.ts' },
  ]);
  assert.deepEqual(t, [
    { id: 'B', str: '', refs: ['a.ts', 'b.ts'] },
    { id: 'A', str: '', notes: ['n'], refs: ['b.ts'] },
  ]);
});

test('merge keeps translations, flags and comments, and drops unused messages', () => {
  const merged = mergeCatalog(
    [poHeader('de'), { id: 'Keep', str: 'Behalten', flags: ['fuzzy'], comments: ['reviewed'] }, { id: 'Gone', str: 'Weg' }],
    [{ id: 'Keep', str: '', refs: ['a.ts'] }, { id: 'New', str: '', refs: ['a.ts'] }],
    'de',
  );
  assert.deepEqual(merged.slice(1), [
    { comments: ['reviewed'], id: 'Keep', str: 'Behalten', refs: ['a.ts'], flags: ['fuzzy'] },
    { id: 'New', str: '', refs: ['a.ts'] },
  ]);
  assert.match(merged[0]!.str, /Language: de/);
});

test('check flags placeholder mismatches and syntax errors', () => {
  const errors = checkCatalog('de.po', [
    { id: 'Open {name}', str: 'Öffnen {name}' },
    { id: 'Open {name}', str: 'Öffnen {file}' },
    { id: '{n} pages', str: '{n Seiten' },
    { id: 'Untranslated', str: '' },
    { id: 'Open…', str: 'Öffnen' },
    { id: 'Save As…', str: 'Speichern unter…' },
  ]);
  assert.equal(errors.length, 3);
  assert.match(errors[0]!, /placeholders \{file\} should be \{name\}/);
  assert.match(errors[1]!, /Expected/);
  assert.match(errors[2]!, /"Open…": should end with "…"/);
});
