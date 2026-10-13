import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONSTRUCTION_TEMPLATE } from '../settings/settings.ts';
import { compareSheetNumbers, matchCategory, neighbourSheet, revisionPairs, setSheets, sheetType, unindexed, wildcardMatch, type DrawingSet } from './sets.ts';

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
  const next = neighbourSheet(list, 'arch', 1, 1);
  assert.deepEqual([next?.fileId, next?.page, next?.category, next?.number], ['arch', 0, 'Architectural', 'A-10']);
  assert.equal(neighbourSheet(list, 'arch2', 0, -1), null);
  assert.equal(neighbourSheet(list, 'struct', 0, 1)?.fileId, 'misc');
});

const names: Record<string, string> = { r0: 'A-101_Rev0.pdf', r1: 'A-101_Rev1.pdf', r2: 'A-101_Rev2.pdf', s: 'S-201.pdf', m: 'misc.pdf' };
const revIndex = {
  r0: { pageCount: 1, sheets: [{ number: 'A-101', title: 'Ground Floor' }] },
  r1: { pageCount: 1, sheets: [{ number: 'A-101', title: 'Ground Floor' }] },
  r2: { pageCount: 1, sheets: [{ number: 'A-101', title: 'Ground Floor' }] },
  s: { pageCount: 1, sheets: [{ number: 'S-201' }] },
  m: { pageCount: 1, sheets: [null] },
};
const revSet: DrawingSet = { id: 'r', name: 'Revisions', sort: 'auto', collapsed: false, entries: ['r1', 'r0', 's', 'r2', 'm'].map((fileId) => ({ fileId })) };
const added: Record<string, number> = { r0: 1, r1: 2, r2: 3, s: 1, m: 1 };
const opts = { fileName: (id: string) => names[id]!, addedAt: (id: string) => added[id]! };

test('auto categories come from the template by the longest matching filter', () => {
  const list = setSheets(revSet, revIndex, { ...opts, categories: 'auto', template: CONSTRUCTION_TEMPLATE });
  assert.deepEqual([...new Set(list.map((s) => s.category))], ['Structural', 'Architectural', 'Other']);
  assert.equal(matchCategory(CONSTRUCTION_TEMPLATE, 'AD-101'), 'Architectural Demolition');
  assert.equal(matchCategory(CONSTRUCTION_TEMPLATE, 'A-101'), 'Architectural');
  assert.deepEqual(setSheets(revSet, revIndex, { ...opts, categories: 'none' }).map((s) => s.category), ['', '', '', '', '']);
});

test('revisions by sheet number: the latest is current, earlier ones crossed out, hidden or stacked', () => {
  const marked = setSheets(revSet, revIndex, { ...opts, revisionFilter: 'auto', autoTagRevision: true });
  const a101 = marked.filter((s) => s.number === 'A-101');
  assert.deepEqual(a101.map((s) => [s.fileId, s.revision, s.superseded, s.tags['Revision Number']]), [['r1', 1, true, '1'], ['r0', 0, true, '0'], ['r2', 2, false, '2']]);
  assert.deepEqual(setSheets(revSet, revIndex, { ...opts, revisionFilter: 'auto', previousRevisions: 'hide' }).filter((s) => s.number === 'A-101').map((s) => s.fileId), ['r2']);
  const stacked = setSheets(revSet, revIndex, { ...opts, revisionFilter: 'auto', currentRevisions: 'stack' });
  const current = stacked.filter((s) => s.number === 'A-101');
  assert.deepEqual(current.map((s) => s.fileId), ['r2']);
  assert.deepEqual(current[0]!.previous.map((s) => s.fileId), ['r0', 'r1']);
  assert.deepEqual(revisionPairs(stacked).map((p) => p.key), ['r0:0>r1:0', 'r1:0>r2:0']);
});

test('a typed revision number orders revisions before the date added', () => {
  const typed: DrawingSet = { ...revSet, tags: { 'r0:0': { 'Revision Number': 'C' }, 'r2:0': { 'Revision Number': 'A' }, 'r1:0': { 'Revision Number': 'B' } } };
  const list = setSheets(typed, revIndex, { ...opts, revisionFilter: 'auto', previousRevisions: 'hide' });
  assert.deepEqual(list.filter((s) => s.number === 'A-101').map((s) => s.fileId), ['r0']);
});

test('revisions by wildcard over file names', () => {
  assert.deepEqual(wildcardMatch('*_Rev#', 'A-101_Rev12.pdf'), { key: 'A-101|', revision: '12' });
  assert.equal(wildcardMatch('*_Rev#', 'S-201.pdf'), null);
  const list = setSheets(revSet, revIndex, { ...opts, revisionFilter: 'wildcard', wildcard: '*_Rev#', previousRevisions: 'hide' });
  assert.deepEqual(list.map((s) => s.fileId), ['r2', 's', 'm']);
});

test('sorting by file name, descending, with tagged pages first', () => {
  const byName = setSheets(revSet, revIndex, { ...opts, sortBy: 'fileName', sortTagged: false }).map((s) => s.fileId);
  assert.deepEqual(byName, ['r0', 'r1', 'r2', 'm', 's']);
  const desc = setSheets(revSet, revIndex, { ...opts, sortBy: 'fileName', sortTagged: false, sortOrder: 'desc' }).map((s) => s.fileId);
  assert.deepEqual(desc, ['s', 'm', 'r2', 'r1', 'r0']);
  const tagged = setSheets(revSet, revIndex, { ...opts, sortBy: 'fileName', sortTagged: true }).map((s) => s.fileId);
  assert.deepEqual(tagged, ['r1', 'r0', 'r2', 's', 'm']);
});

test('tags: typed values win, AutoMark off ignores what was read, discipline and sheet type follow the number', () => {
  const typed: DrawingSet = { ...revSet, tags: { 's:0': { 'Sheet Name': 'Footings', Floor: 'L1' } } };
  const list = setSheets(typed, revIndex, { ...opts, autoTagDiscipline: true, autoTagSheetType: true, autoMark: { number: true, title: false } });
  const s = list.find((x) => x.fileId === 's')!;
  assert.deepEqual(s.tags, { 'Sheet Name': 'Footings', Floor: 'L1', 'Sheet Number': 'S-201', Discipline: 'Structural', 'Sheet Type': 'Elevations' });
  assert.equal(list.find((x) => x.fileId === 'r0')!.title, null);
  assert.equal(sheetType('M2.01'), 'Elevations');
  assert.equal(sheetType('Cover'), null);
});
