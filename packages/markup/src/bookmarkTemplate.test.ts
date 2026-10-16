import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Bookmark } from './bookmarks.ts';
import { applyBookmarkTemplate, DEFAULT_BOOKMARK_TEMPLATE, parseBookmarkTemplate, sheetSeries } from './bookmarkTemplate.ts';
import { categoriesToXml, parseCategoriesXml } from './setCategories.ts';

const XML = `\uFEFF<?xml version="1.0" encoding="utf-8"?>
<root>
  <bookmark dname="Cover Sheet" manual="1" />
  <bookmark dname="General Information" manual="0">
    <bookmark dname="Sheet Index" manual="1" />
    <bookmark dname="G-000" manual="1" />
    <bookmark dname="G-100" manual="1" />
    <bookmark dname="Other" manual="1" />
  </bookmark>
  <bookmark dname="Civil" manual="0">
    <bookmark dname="C-000" manual="1" />
    <bookmark dname="C-100" manual="1" />
    <bookmark dname="C-200" manual="1" />
    <bookmark dname="Other" manual="1" />
  </bookmark>
  <bookmark dname="Architectural Demolition" manual="0">
    <bookmark dname="AD-100" manual="1" />
    <bookmark dname="Other" manual="1" />
  </bookmark>
  <bookmark dname="Architectural" manual="0">
    <bookmark dname="A-100" manual="1" />
  </bookmark>
</root>`;

const ids = () => {
  let n = 0;
  return () => `id${n++}`;
};
const shape = (tree: readonly Bookmark[]): unknown[] => tree.map((b) => (b.children.length ? [b.title, b.pageIndex, shape(b.children)] : [b.title, b.pageIndex]));

test('a template is read as folders and slots, keeping order and the manual flag', () => {
  const t = parseBookmarkTemplate(XML, 'Construction Documents');
  assert.equal(t.name, 'Construction Documents');
  assert.deepEqual(
    t.nodes.map((n) => [n.name, n.manual, n.children.length]),
    [['Cover Sheet', true, 0], ['General Information', false, 4], ['Civil', false, 4], ['Architectural Demolition', false, 2], ['Architectural', false, 1]],
  );
  assert.throws(() => parseBookmarkTemplate('<other/>'), /not a bookmark template/);
  assert.throws(() => parseBookmarkTemplate('<root></root>'), /not a bookmark template/);
});

test('a sheet number is filed by its prefix and hundreds series', () => {
  assert.deepEqual(sheetSeries('A-101'), { prefix: 'A', series: 100 });
  assert.deepEqual(sheetSeries('A1.01'), { prefix: 'A', series: 100 });
  assert.deepEqual(sheetSeries('AD-100 Demolition Plan'), { prefix: 'AD', series: 100 });
  assert.deepEqual(sheetSeries('G001'), { prefix: 'G', series: 0 });
  assert.deepEqual(sheetSeries('fp 305'), { prefix: 'FP', series: 300 });
  assert.equal(sheetSeries('Cover Sheet'), null);
});

test('pages go into the slot their sheet number belongs to, and empty folders are left out', () => {
  const t = parseBookmarkTemplate(XML);
  const labels = ['Cover Sheet', 'G-001', 'C-101', 'C-205', 'C-999', 'A-101', 'AD-100', 'Z-1', 'C-102', 'Sheet Index'];
  const { tree, unmatched } = applyBookmarkTemplate(t, labels.map((label, pageIndex) => ({ pageIndex, label })), ids());
  assert.deepEqual(shape(tree), [
    ['Cover Sheet', 0, [['Cover Sheet', 0]]],
    ['General Information', 1, [['Sheet Index', 9, [['Sheet Index', 9]]], ['G-000', 1, [['G-001', 1]]]]],
    ['Civil', 2, [['C-100', 2, [['C-101', 2], ['C-102', 8]]], ['C-200', 3, [['C-205', 3]]], ['Other', 4, [['C-999', 4]]]]],
    ['Architectural Demolition', 6, [['AD-100', 6, [['AD-100', 6]]]]],
    ['Architectural', 5, [['A-100', 5, [['A-101', 5]]]]],
  ]);
  assert.deepEqual(unmatched, [7], 'Z-1 has no discipline');
});

test('a folder with no Other slot leaves a stray series unfiled', () => {
  const t = parseBookmarkTemplate(XML);
  const { tree, unmatched } = applyBookmarkTemplate(t, [{ pageIndex: 0, label: 'A-501' }], ids());
  assert.deepEqual(tree, []);
  assert.deepEqual(unmatched, [0]);
});

test('the built-in template files a typical set', () => {
  const labels = ['A-101', 'S-201', 'FP-100', 'SE-100', 'E-401', 'T-000'];
  const { tree, unmatched } = applyBookmarkTemplate(DEFAULT_BOOKMARK_TEMPLATE, labels.map((label, pageIndex) => ({ pageIndex, label })), ids());
  assert.deepEqual(unmatched, []);
  assert.deepEqual(tree.map((b) => b.title), ['Architectural', 'Structural', 'Electrical', 'Fire Protection', 'Telecom', 'Security']);
});

test('a sheet of a discipline with no folder goes in the Other folder', () => {
  const { tree, unmatched } = applyBookmarkTemplate(DEFAULT_BOOKMARK_TEMPLATE, [{ pageIndex: 0, label: 'Z-101' }, { pageIndex: 1, label: 'Notes' }], ids());
  assert.deepEqual(shape(tree), [['Other', 0, [['Other', 0, [['Z-101', 0]]]]]]);
  assert.deepEqual(unmatched, [1], 'a page with no sheet number at all is still unfiled');
});

const CATEGORIES = `\uFEFF<?xml version="1.0" encoding="utf-8"?>
<?categories version="1"?>
<AIA_x0020_Standards>
  <Category>
    <Discipline>General</Discipline>
    <Abbrev>G</Abbrev>
  </Category>
  <Category>
    <Discipline>Fire &amp; Safety</Discipline>
    <Abbrev>FP</Abbrev>
  </Category>
</AIA_x0020_Standards>`;

test('a categories file is read with its decoded name, and written back so Revu reads it', () => {
  const set = parseCategoriesXml(CATEGORIES);
  assert.deepEqual(set, { name: 'AIA Standards', categories: [{ name: 'General', filter: 'G' }, { name: 'Fire & Safety', filter: 'FP' }] });
  const xml = categoriesToXml(set);
  assert.match(xml, /<AIA_x0020_Standards>/);
  assert.match(xml, /<\?categories version="1"\?>/);
  assert.deepEqual(parseCategoriesXml(xml), set);
  assert.deepEqual(parseCategoriesXml(categoriesToXml({ name: '2nd <Set>', categories: [{ name: 'X', filter: 'x' }] })).name, '2nd <Set>');
  assert.throws(() => parseCategoriesXml('<a><b/></a>'), /not a Revu categories file/);
});

// Run with REVU_SETTINGS_DIR pointing at a Revu settings folder to read its own files.
const dir = process.env.REVU_SETTINGS_DIR;
test("Revu's Construction.xml is the built-in template, and its categories read", { skip: dir ? false : 'REVU_SETTINGS_DIR is not set' }, () => {
  const t = parseBookmarkTemplate(readFileSync(`${dir}/Construction.xml`, 'utf8'), 'Construction Documents');
  assert.deepEqual(t, DEFAULT_BOOKMARK_TEMPLATE);
  const c = parseCategoriesXml(readFileSync(`${dir}/Categories/Construction.xml`, 'utf8'));
  assert.equal(c.name, 'AIA Standards');
  assert.equal(c.categories.length, 12);
});
