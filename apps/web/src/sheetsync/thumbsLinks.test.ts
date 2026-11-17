import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_STATUSES, type Markup } from '@nb/markup';
import { DEFAULT_SCALE } from '@nb/measure';
import { buildRows, listColumns, withThreads, type CellContext } from '../columns/listColumns.ts';
import { planFill } from './clientFile.ts';
import { planImport } from './importExcel.ts';
import { checkMarkupLink, linkedFile, markupLinkUrl, parseMarkupQuery } from './links.ts';
import { THUMB_KEY, exportRegisterWorkbook, exportTemplate, parseTemplateFile, registerSheets, starterTemplate, type RegisterExport, type RegisterTemplate, type RegisterThumb } from './register.ts';
import { buildWorkbook, isLinkUrl, type LooseCell } from './xlsx.ts';
import { readWorkbook, workbookParts } from './xlsxRead.ts';

// Thumbnails and links in a register: what the workbook holds, and that it still imports.
// scripts/sheetsync-pictures-check.mjs checks that Excel opens such a workbook without repair.

function markup(n: number, patch: Partial<Markup> = {}): Markup {
  return { id: `m${n}`, seq: n, type: 'cloud', pageIndex: 0, points: [[10, 10], [50, 40]], style: { stroke: '#ff0000', strokeWidth: 1 }, author: 'Rae Reviewer', createdAt: Date.UTC(2026, 10, n), modifiedAt: n, status: 'none', ...patch } as Markup;
}
const ctx = (): CellContext => ({ scaleOf: () => DEFAULT_SCALE, sheets: { 0: { number: 'KR-C-101', title: 'General arrangement' } as never }, statuses: DEFAULT_STATUSES, columns: [] });
const all = listColumns([]);
const rowsOf = (markups: Markup[]) => withThreads(buildRows(markups, ctx(), {}, null), ctx());
const markups = () => [markup(1, { comment: 'Kerb line clashes with pit lid' }), markup(2, { comment: 'Show the batter extent' }), markup(3, { comment: 'Label the culvert' })];
// A few bytes are enough: the writer stores a picture's bytes as they are.
const jpeg = (n: number): RegisterThumb => ({ data: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, n, 0xff, 0xd9]), type: 'jpeg', width: 200, height: 120 + n });
const template = (patch: Partial<RegisterTemplate> = {}): RegisterTemplate => {
  const t = starterTemplate('tpl-1', DEFAULT_STATUSES, 1);
  // The picture goes between Sheet and Comment.
  return { ...t, firstCol: 1, links: true, columns: [...t.columns.slice(0, 2), { header: 'Location', field: { kind: 'column', key: THUMB_KEY } }, ...t.columns.slice(2)], ...patch };
};
const link = (id: string) => markupLinkUrl({ kind: 'desktop' }, { doc: 'doc-1', markup: id, name: 'KR-C-101 General arrangement.pdf' });
const exportOf = (patch: Partial<RegisterExport> = {}): RegisterExport => ({
  rows: rowsOf(markups()),
  columns: all,
  statuses: DEFAULT_STATUSES,
  template: template(),
  docId: 'doc-1',
  exportedAt: '2026-11-16T03:00:00.000Z',
  values: {},
  thumbnails: new Map([
    ['m1', jpeg(1)],
    ['m3', jpeg(3)],
  ]),
  linkOf: link,
  ...patch,
});

test('a link to a comment is the desktop scheme or the web address, and reads back as three plain values', () => {
  const l = { doc: 'doc 1/α', markup: 'm&1', name: 'KR-C-101 General arrangement.pdf' };
  assert.equal(markupLinkUrl({ kind: 'desktop' }, l), 'redcolumn://markup/?doc=doc+1%2F%CE%B1&markup=m%261&name=KR-C-101+General+arrangement.pdf');
  // The web address keeps its path and drops whatever else was in the query or after the #.
  const web = markupLinkUrl({ kind: 'web', href: 'https://app.example/redcolumn/?project=abc#key' }, l);
  assert.equal(web, 'https://app.example/redcolumn/?doc=doc+1%2F%CE%B1&markup=m%261&name=KR-C-101+General+arrangement.pdf');
  assert.deepEqual(parseMarkupQuery(new URL(web).search), l);
  assert.ok(isLinkUrl(web) && isLinkUrl(markupLinkUrl({ kind: 'desktop' }, l)));

  assert.equal(parseMarkupQuery('?action=open'), null);
  assert.equal(parseMarkupQuery('?markup=m1'), null, 'no document');
  assert.equal(checkMarkupLink({ doc: 'd', markup: 'x'.repeat(301) }), null);
  assert.equal(checkMarkupLink({ doc: 'd\u0000', markup: 'm' }), null);
  assert.deepEqual(checkMarkupLink({ doc: 'd', markup: 'm', name: 7 }), { doc: 'd', markup: 'm', name: '' });
});

test('a link finds its document by id, else by a file name only one document has', () => {
  const files = [
    { id: 'a', name: 'KR-C-101.pdf' },
    { id: 'b', name: 'KR-C-102.pdf' },
    { id: 'c', name: 'KR-C-102.pdf' },
  ];
  assert.equal(linkedFile(files, { doc: 'b', markup: 'm', name: 'KR-C-101.pdf' })?.id, 'b');
  assert.equal(linkedFile(files, { doc: 'from another computer', markup: 'm', name: 'KR-C-101.pdf' })?.id, 'a');
  assert.equal(linkedFile(files, { doc: 'x', markup: 'm', name: 'KR-C-102.pdf' }), undefined, 'two documents share the name');
  assert.equal(linkedFile(files, { doc: 'x', markup: 'm', name: '' }), undefined);
});

test('only web addresses and links of this app become hyperlinks', () => {
  for (const url of ['file:///C:/Windows/system32/calc.exe', 'javascript:alert(1)', '\\\\server\\share\\x', 'https://a b', 'ms-excel:ofe|u|https://x', `https://x/${'a'.repeat(2000)}`]) assert.equal(isLinkUrl(url), false, url);
});

test('a register with a thumbnail column and links: pictures in their cells, a link on each item number', async () => {
  const sheets = registerSheets(exportOf());
  const visible = sheets[0]!;
  // Header on row 5 (index 4), table from column B: Item No is B, the picture column D.
  assert.deepEqual(visible.images!.map((i) => [i.row, i.col, i.width, i.height]), [
    [5, 3, 200, 121],
    [7, 3, 200, 123],
  ]);
  assert.deepEqual([...visible.rowHeights!], [
    [5, 96],
    [7, 97],
  ]);
  assert.deepEqual(visible.links, [5, 6, 7].map((row, i) => ({ row, col: 1, url: link(`m${i + 1}`) })));
  // The picture column is wide enough for the picture, and holds no text.
  assert.equal(visible.widths![2], 31);
  assert.deepEqual(visible.table.slice(1).map((r) => r[2]), ['', '', '']);

  const bytes = exportRegisterWorkbook(exportOf());
  const parts = workbookParts(bytes);
  assert.deepEqual(parts.names.filter((n) => /media|drawing/.test(n)).sort(), ['xl/drawings/_rels/drawing1.xml.rels', 'xl/drawings/drawing1.xml', 'xl/media/image1.jpeg', 'xl/media/image2.jpeg']);
  const types = (await parts.text('[Content_Types].xml'))!;
  assert.match(types, /<Default Extension="jpeg" ContentType="image\/jpeg"\/>/);
  assert.match(types, /PartName="\/xl\/drawings\/drawing1\.xml"/);
  const sheet = (await parts.text('xl/worksheets/sheet1.xml'))!;
  assert.match(sheet, /<row r="6" ht="96" customHeight="1">/);
  assert.match(sheet, /<hyperlinks><hyperlink ref="B6" r:id="rId1"\/><hyperlink ref="B7" r:id="rId2"\/><hyperlink ref="B8" r:id="rId3"\/><\/hyperlinks><drawing r:id="rId4"\/><\/worksheet>$/);
  // The order of a sheet's parts is fixed: validation before links, links before the drawing.
  assert.ok(sheet.indexOf('<dataValidations') < sheet.indexOf('<hyperlinks>'));
  const rels = (await parts.text('xl/worksheets/_rels/sheet1.xml.rels'))!;
  assert.match(rels, /Id="rId1" Type="[^"]+\/hyperlink" Target="redcolumn:\/\/markup\/\?doc=doc-1&amp;markup=m1&amp;name=[^"]+" TargetMode="External"/);
  assert.match(rels, /Id="rId4" Type="[^"]+\/drawing" Target="\.\.\/drawings\/drawing1\.xml"/);
  const drawing = (await parts.text('xl/drawings/drawing1.xml'))!;
  assert.equal(drawing.match(/<xdr:twoCellAnchor editAs="oneCell">/g)?.length, 2);
  assert.match(drawing, /<xdr:from><xdr:col>3<\/xdr:col><xdr:colOff>19050<\/xdr:colOff><xdr:row>5<\/xdr:row>/);

  // It imports like any register: the pictures and links are not values.
  const result = planImport(await readWorkbook(bytes), { rows: rowsOf(markups()), columns: all, statuses: DEFAULT_STATUSES }, { docId: 'doc-1' });
  assert.equal(result.matched.length, 3);
  assert.deepEqual([result.changes, result.unknown, result.skipped], [[], [], []]);
});

test('without pictures or links asked for, the workbook has neither', async () => {
  const plain = exportRegisterWorkbook(exportOf({ thumbnails: undefined, template: template({ links: undefined }) }));
  const parts = workbookParts(plain);
  assert.deepEqual(parts.names.filter((n) => /media|drawing|sheet1\.xml\.rels/.test(n)), []);
  assert.doesNotMatch((await parts.text('xl/worksheets/sheet1.xml'))!, /hyperlink|drawing/);
  // A template that links, exported where no address can be made, has no links either.
  assert.equal(registerSheets(exportOf({ linkOf: undefined }))[0]!.links, undefined);
  // An address that is not a link is left out, row by row.
  assert.deepEqual(registerSheets(exportOf({ linkOf: (id) => (id === 'm2' ? 'file:///c:/x' : link(id)) }))[0]!.links!.map((l) => l.row), [5, 7]);
});

test('linking is part of a shared template; a register with no Item No links its first column', () => {
  assert.equal(parseTemplateFile(exportTemplate(template())).links, true);
  assert.equal(parseTemplateFile(exportTemplate(template({ links: undefined }))).links, undefined);
  const t = template();
  const noItem = { ...t, columns: t.columns.filter((c) => !(c.field.kind === 'column' && c.field.key === 'seq')) };
  assert.deepEqual(registerSheets(exportOf({ template: noItem }))[0]!.links!.map((l) => l.col), [1, 1, 1]);
});

test('the client’s own file gets the links, through Excel, and no pictures', async () => {
  const t = template({ sheet: 'Review Comments', headerRow: 6, firstCol: 1 });
  const cells: LooseCell[] = t.columns.map((c, i) => ({ row: 6, col: 1 + i, value: c.header }));
  const book = await readWorkbook(buildWorkbook([{ name: 'Review Comments', filter: false, table: [], cells }]));
  const plan = planFill(book, exportOf({ template: t }));
  assert.ok(plan.ok);
  assert.deepEqual(plan.fill.links, { col: 2, urls: ['m1', 'm2', 'm3'].map(link) });
  // The picture column is left as the file has it.
  assert.deepEqual(plan.fill.columns.map((c) => c.col), [2, 3, 5, 6, 7, 8, 9, 10, 11]);
});
