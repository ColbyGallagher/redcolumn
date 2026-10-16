// The compatibility matrix's logic: statuses come from counts, failures are named, and a missing
// check reads Not run rather than a pass. Run with the compat loader (see package.json).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderMatrix, statusOf, type Cell, type Results, type Table } from './matrix.ts';
import { parseCompare } from './run.ts';

const cell = (over: Partial<Cell>): Cell => ({ items: 0, revuItems: 0, failed: [], failedCount: 0, extra: [], extraCount: 0, ...over });

test('a cell with every item through and Revu-made items is Supported', () => {
  assert.deepEqual(statusOf(cell({ items: 4, revuItems: 4 }), undefined), { status: 'Supported', detail: '4/4' });
});

test('a cell with every item through but only synthetic items is Partial, never Supported', () => {
  assert.equal(statusOf(cell({ items: 4, revuItems: 0 }), undefined).status, 'Partial');
});

test('a missing item is counted as not through, and the cell is Partial', () => {
  assert.deepEqual(statusOf(cell({ items: 5, revuItems: 5, failed: ['a'], failedCount: 1 }), undefined), { status: 'Partial', detail: '4/5' });
});

test('an extra item is not subtracted from the pass count, and it keeps the cell from Supported', () => {
  assert.deepEqual(statusOf(cell({ items: 3, revuItems: 3, extra: ['x'], extraCount: 1 }), undefined), { status: 'Partial', detail: '3/3 (+1 extra)' });
});

test('nothing through is Not yet', () => {
  assert.equal(statusOf(cell({ items: 2, revuItems: 2, failed: ['a', 'b'], failedCount: 2 }), undefined).status, 'Not yet');
});

test('a column with no writer is Not yet whatever was read', () => {
  assert.equal(statusOf(cell({ items: 7, revuItems: 7, writer: false }), undefined).status, 'Not yet');
});

test('no items with a reason is Not run, and with no reason is a dash', () => {
  assert.equal(statusOf(undefined, 'REVU_SETTINGS_DIR is not set').status, 'Not run');
  assert.equal(statusOf(undefined, undefined).status, '—');
});

test('a fixture that threw is Error, not a skip', () => {
  assert.equal(statusOf(cell({ error: 'boom' }), 'a reason').status, 'Error');
});

test('compare.py output: an annotation problem is keyed by its page and position', () => {
  const out = [
    'page 1: 21 annotations in source, 21 saved',
    'page 1: 0.00% of pixels differ when rendered',
    'PROBLEMS:',
    'p1#3 /Square Note: keys lost [\'/NM\']',
    'page 2 renders differently (1.20%)',
    'catalog /Names lost',
  ].join('\n');
  const r = parseCompare(out);
  assert.equal(r.rendered, true);
  assert.deepEqual([...r.annotations.keys()], ['p1#3']);
  assert.equal(r.annotations.get('p1#3'), "keys lost ['/NM']");
  assert.deepEqual(r.renderFailed, [2]);
  assert.deepEqual(r.structure, ['catalog /Names lost']);
});

test('compare.py output with no problems is a clean report', () => {
  const r = parseCompare('page 1: 0.00% of pixels differ when rendered\nNO PROBLEMS\n');
  assert.equal(r.annotations.size, 0);
  assert.equal(r.renderFailed.length, 0);
  assert.equal(r.structure.length, 0);
});

test('the rendered doc names failures, shows extras, and marks a missing column Not run', () => {
  const t = (rows: string[], cols: string[], cells: Table['cells'], notRun: Table['notRun']): Table => ({ rows, columns: cols, cells, notRun });
  const results: Results = {
    annotations: t(
      ['Shapes & lines', 'Stamps'],
      ['PDF save (unedited)', 'XFDF round trip'],
      { 'Shapes & lines': { 'PDF save (unedited)': cell({ items: 2, revuItems: 2, failed: ['f.pdf · p1#0 /Square: keys lost'], failedCount: 1 }) } },
      { 'Stamps|XFDF round trip': 'revu-markups.xfdf not found' },
    ),
    exchange: t(['.btx tool sets'], ['Read', 'Write'], {}, { 'Read': 'REVU_SETTINGS_DIR is not set' }),
    fixtures: [],
    skipped: [],
  };
  const md = renderMatrix(results);
  assert.match(md, /\*\*Partial\*\* 1\/2/);
  assert.match(md, /- missing: f\.pdf · p1#0 \/Square: keys lost/);
  assert.match(md, /\*\*Not run\*\* revu-markups\.xfdf not found/);
  assert.match(md, /\| \.btx tool sets \| \*\*Not run\*\* REVU_SETTINGS_DIR is not set \| — \|/);
});
