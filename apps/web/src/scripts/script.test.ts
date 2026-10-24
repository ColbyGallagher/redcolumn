import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_STATUSES, DEFAULT_STYLES, type Markup, type MarkupType } from '@nb/markup';
import { parseScript, previewScript, type ScriptContext } from './script.ts';

const m = (id: string, type: MarkupType, extra: Partial<Markup> = {}): Markup => ({
  id,
  type,
  pageIndex: 0,
  points: [],
  style: { ...DEFAULT_STYLES[type] },
  status: 'none',
  author: 'Hana',
  createdAt: 1,
  modifiedAt: 1,
  ...extra,
});

const ctx: ScriptContext = {
  statuses: [...DEFAULT_STATUSES, { id: 'open', name: 'Open', color: '#f59e0b' }],
  columns: [{ id: 'c1', name: 'Responsibility', type: 'text' }, { id: 'c2', name: 'Qty', type: 'number' }],
  pageLabel: (i) => ['A-101', 'A-102', 'A-103'][i] ?? `${i + 1}`,
};

const doc = [
  m('a', 'cloud', { author: 'Sam', layer: 'Old notes', comment: 'Check lintel' }),
  m('b', 'cloud', { author: 'Hana', pageIndex: 1, fields: { c2: '12' } }),
  m('c', 'text', { author: 'Sam', text: 'NOTE 1', pageIndex: 2, layer: 'Old notes', fields: { c1: 'Builder', c2: '3' } }),
  m('d', 'rect', { author: 'Sam', locked: true }),
  m('e', 'arrow', { style: { ...DEFAULT_STYLES.arrow, stroke: '#ff0000' }, status: 'accepted' }),
];

const run = (src: string) => {
  const r = previewScript(src, doc, ctx);
  assert.deepEqual(r.errors, [], 'no errors');
  return r.run!;
};

test('a rule finds markups by field and changes them; only real changes count', () => {
  const r = run(`
    # Sam's clouds go red, on their own layer
    where type is cloud and author is "Sam"
    set color red
    set layer Review – Sam
  `);
  assert.deepEqual(r.found, [1]);
  assert.deepEqual(r.changes.map((c) => [c.id, c.changes]), [['a', ['colour → #ff0000', 'layer → Review – Sam']]]);
  assert.equal(r.changes[0]!.patch.style!.stroke, '#ff0000');
  assert.equal(r.changes[0]!.patch.layer, 'Review – Sam');
  // Already red: nothing to change.
  assert.deepEqual(run('where color is red\nset color #ff0000').changes, []);
});

test('rename layer, every markup, statuses by name, and columns', () => {
  assert.deepEqual(run('rename layer "Old notes" to "Notes"').changes.map((c) => [c.id, c.patch.layer]), [['a', 'Notes'], ['c', 'Notes']]);
  const r = run('every markup\nset status open');
  assert.deepEqual(r.changes.map((c) => c.id), ['a', 'b', 'c', 'e'], 'the locked rectangle is left alone');
  assert.deepEqual(r.skipped, ['Rectangle, page 1']);
  assert.ok(r.changes.every((c) => c.patch.status === 'open'));
  const cols = run('where column "Responsibility" is empty\nset column "Responsibility" to "Architect"');
  assert.deepEqual(cols.changes.map((c) => c.id), ['a', 'b', 'e']);
  assert.deepEqual(cols.changes[0]!.patch.fields, { c1: 'Architect' });
  // A text column compared as numbers.
  assert.deepEqual(run('where column "Qty" > 5\nset checked yes').changes.map((c) => c.id), ['b']);
});

test('conditions: not, or, brackets, contains, patterns, pages, sheets, type names', () => {
  assert.deepEqual(run('where (author is Sam or author is Hana) and not type is cloud\nset subject "Checked"').changes.map((c) => c.id), ['c', 'e']);
  assert.deepEqual(run('where comment contains LINTEL\nset status accepted').changes.map((c) => c.id), ['a']);
  assert.deepEqual(run('where text matches /^note \\d+$/i\nset color blue').changes.map((c) => c.id), ['c']);
  assert.deepEqual(run('where page >= 2\nset width 3').changes.map((c) => c.id), ['b', 'c']);
  assert.deepEqual(run('where sheet is A-103\nset width 3').changes.map((c) => c.id), ['c']);
  assert.deepEqual(run('where type is "text box"\nset width 2.5').changes.map((c) => c.id), ['c'], 'a type by its name');
  assert.deepEqual(run('where status is Accepted\nset opacity 50%').changes.map((c) => [c.id, c.patch.style?.opacity]), [['e', 0.5]]);
  // Rules run in order: the second sees what the first did.
  assert.deepEqual(run('where author is Hana\nset layer Hana\nwhere layer is Hana\nset color green').found, [2, 2]);
});

test('mistakes are reported with their line, and nothing runs', () => {
  const errs = (src: string) => parseScript(src).errors;
  assert.deepEqual(errs('set color red'), [{ line: 1, message: 'set comes after a where line (or every markup) that says which markups' }]);
  assert.match(errs('where colour is red\nset size 3')[0]!.message, /cannot set "size"/);
  assert.match(errs('where shape is cloud\nset color red')[0]!.message, /unknown field "shape"/);
  assert.match(errs('where type cloud\nset color red')[0]!.message, /expected is, is not/);
  assert.match(errs('where type is cloud')[0]!.message, /changes nothing/);
  assert.match(errs('where text matches /(/\nset color red')[0]!.message, /not a valid pattern/);
  assert.match(errs('where author is "Sam\nset color red')[0]!.message, /quote is not closed/);
  const bad = previewScript('every markup\nset status Approved', doc, ctx);
  assert.equal(bad.run, null);
  assert.equal(bad.errors[0]!.line, 2);
  assert.match(bad.errors[0]!.message, /no status "Approved"/);
  assert.match(previewScript('every markup\nset color 12', doc, ctx).errors[0]!.message, /not a colour/);
  // Comments and blank lines are fine; a colour with # is not a comment.
  assert.deepEqual(errs('// tidy up\n\nwhere type is cloud // only clouds\nset color #00ff00'), []);
});
