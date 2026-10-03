import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareSheetNumbers, neighbourSheet, setSheets, unindexed, type DrawingSet } from './sets.ts';

const set: DrawingSet = {
  id: 's',
  name: 'Tender',
  sort: 'sheet',
  collapsed: false,
  entries: [{ fileId: 'arch', category: 'Architectural' }, { fileId: 'misc' }, { fileId: 'struct', category: 'Structural' }, { fileId: 'arch2', category: 'Architectural' }, { fileId: 'new' }],
};
const index = {
  arch: { pageCount: 2, sheets: [{ number: 'A-10' }, { number: 'A-2', title: 'Plan' }] },
  arch2: { pageCount: 2, sheets: [{ number: 'A-1' }, null] },
  struct: { pageCount: 1, sheets: [{ number: 'S-1' }] },
  misc: { pageCount: 1, sheets: [null] },
};

test('sheet numbers sort naturally', () => {
  assert.deepEqual(['A-10', 'A-2', 'a-1', 'S-1'].sort(compareSheetNumbers), ['a-1', 'A-2', 'A-10', 'S-1']);
});

test('a set lists sheets by category, then sheet number, unnumbered pages last', () => {
  const list = setSheets(set, index).map((s) => `${s.category}:${s.number ?? `${s.fileId}#${s.page}`}`);
  assert.deepEqual(list, ['Architectural:A-1', 'Architectural:A-2', 'Architectural:A-10', 'Architectural:arch2#1', 'Structural:S-1', 'Other:misc#0']);
  assert.deepEqual(unindexed(set, index), ['new']);
});

test('in file order, sheets keep their files\' order', () => {
  const list = setSheets({ ...set, sort: 'files' }, index).map((s) => s.number);
  assert.deepEqual(list, ['A-10', 'A-2', 'A-1', null, 'S-1', null]);
});

test('next and previous sheet cross files', () => {
  const list = setSheets(set, index);
  assert.deepEqual(neighbourSheet(list, 'arch', 1, 1), { fileId: 'arch', page: 0, category: 'Architectural', number: 'A-10', title: null });
  assert.equal(neighbourSheet(list, 'arch2', 0, -1), null);
  assert.equal(neighbourSheet(list, 'struct', 0, 1)?.fileId, 'misc');
});
