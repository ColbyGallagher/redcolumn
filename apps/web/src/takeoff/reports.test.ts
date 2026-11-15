import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveAssemblies, type Assembly, type Item, type Markup } from '@nb/markup';
import { formatCell, reportPdf, type ReportTable } from '@nb/markup/report';
import type { Scale } from '@nb/measure';
import type { CellContext } from '../columns/listColumns';
import { buildWorkbook } from '../sheetsync/xlsx';
import { csvField, reportCsv, reportSheet, reportsXlsx } from './reportFiles';
import { buildReport, buildReports, reportPageLabel, scaleNote, scopeMarkups, type ReportInput } from './reports';

/** One PDF point is one foot. */
const FEET: Scale = { metersPerPoint: 0.3048, unit: 'ft', feetInches: false, precision: 2, label: 'test' };
/** Page 2 (index 1) is metric: one point is a metre. */
const METRIC: Scale = { metersPerPoint: 1, unit: 'm', feetInches: false, precision: 2, label: 'metric' };

const drywall: Item = { id: 'dw', name: 'Drywall sheet', itemNo: 'DW-1', description: '1/2 in board', category: 'material', unit: 'sheets', unitCost: 15, waste: 10, roundUp: true, roundTo: 2 };
const labour: Item = { id: 'lab', name: 'Hanging labour', category: 'labor', unit: 'hr', unitCost: 50 };
const raw: Assembly[] = [
  {
    id: 'lined',
    name: 'Lined wall',
    variables: [],
    items: [
      { id: 'i1', itemId: 'dw', name: '', unit: '', formula: '[Area] / 32' },
      { id: 'i2', itemId: 'lab', name: '', unit: '', formula: '[Area] / 100' },
    ],
  },
  { id: 'trim', name: 'Trim', variables: [], items: [{ id: 't1', name: 'Trim', unit: 'ft', formula: '[Length]' }] },
];
const assemblies = resolveAssemblies(raw, [drywall, labour], []);

let seq = 0;
const markup = (type: Markup['type'], points: [number, number][], extra: Partial<Markup> = {}): Markup => ({
  id: `m${++seq}`,
  type,
  pageIndex: 0,
  points,
  style: { stroke: '#f00', fill: null, width: 1, opacity: 1 },
  status: 'none',
  author: 'me',
  createdAt: seq,
  modifiedAt: 0,
  ...extra,
});
const rect = (w: number, h: number): [number, number][] => [[0, 0], [w, 0], [w, h], [0, h]];

// Page 1: a 10x10 room with the assembly; a 10x10 roof at 12:12 (no assembly); trim 20 ft; 3 door counts and a typed 4.
// Page 2: a 20x10 room with a 5x4 cutout and the assembly (in metres); a typed count of 2.
const room1 = markup('area', rect(10, 10), { subject: 'Room A', assemblyId: 'lined' });
const roof = markup('area', rect(10, 10), { subject: 'Roof', slope: { kind: 'pitch', value: 12 } });
const trim = markup('polylength', [[0, 0], [20, 0]], { subject: 'Trim run', assemblyId: 'trim' });
const doors = markup('count', [[1, 1], [2, 2], [3, 3]], { subject: 'Door' });
const doorsTyped = markup('manual', [[5, 5]], { subject: 'Door', manual: { kind: 'count', value: 4 } });
const room2 = markup('area', rect(20, 10), { subject: 'Room B', pageIndex: 1, assemblyId: 'lined', holes: [[[0, 0], [5, 0], [5, 4], [0, 4]]] });
const windows = markup('manual', [[5, 5]], { subject: 'Window', pageIndex: 1, manual: { kind: 'count', value: 2 } });
const note = markup('text', [[0, 0], [5, 5]], { subject: 'Note' });
const all = [room1, roof, trim, doors, doorsTyped, room2, windows, note];

const ctx: CellContext = { scaleOf: (m) => (m.pageIndex === 1 ? METRIC : FEET), sheets: { 0: { number: 'A-101' } as never }, statuses: [], columns: [], assemblies };
const input: ReportInput = { markups: all, assemblies, items: [drywall, labour], ctx, pageLabel: reportPageLabel(ctx.sheets) };
const near = (a: unknown, b: number) => assert.ok(typeof a === 'number' && Math.abs(a - b) < 1e-6, `${String(a)} not near ${b}`);

test('Quantity Summary by Item groups by category, rounds the order once and totals the cost', () => {
  const t = buildReport('byItem', input);
  assert.deepEqual(t.columns.map((c) => c.key), ['itemNo', 'description', 'category', 'unit', 'net', 'waste', 'gross', 'order', 'unitCost', 'cost']);
  assert.deepEqual(t.groups.map((g) => g.heading), ['Material', 'Labour', 'Uncategorised']);
  // Room A is 100 sf in feet; Room B is 180 m² net (cutout off) on a metric page: the formulas read each page's own units.
  const dw = t.groups[0]!.rows[0]!;
  assert.equal(dw.itemNo, 'DW-1');
  assert.equal(dw.description, 'Drywall sheet - 1/2 in board');
  assert.equal(dw.unit, 'sheets');
  near(dw.net, 100 / 32 + 180 / 32);
  assert.equal(dw.waste, 10);
  near(dw.gross, (100 / 32 + 180 / 32) * 1.1);
  // 9.625 sheets in multiples of 2 is 10, priced once.
  assert.equal(dw.order, 10);
  assert.equal(dw.unitCost, 15);
  assert.equal(dw.cost, 150);
  const hours = t.groups[1]!.rows[0]!;
  near(hours.order, 2.8);
  near(hours.cost, 140);
  // Trim has no catalog item: its own group.
  assert.equal(t.groups[2]!.rows[0]!.description, 'Trim');
  near(t.groups[0]!.subtotal!.cost, 150);
  near(t.grandTotal!.cost, 290);
});

test('By Assembly has a heading and a cost subtotal per assembly', () => {
  const t = buildReport('byAssembly', input);
  assert.deepEqual(t.groups.map((g) => g.heading), ['Lined wall', 'Trim']);
  assert.equal(t.groups[0]!.rows.length, 2);
  near(t.groups[0]!.subtotal!.cost, 290);
  assert.equal(t.groups[0]!.subtotal!.description, 'Subtotal - Lined wall');
  assert.equal(t.groups[1]!.subtotal!.cost, null);
  near(t.grandTotal!.cost, 290);
});

test('By Sheet groups by page label, falling back to Page N', () => {
  const t = buildReport('bySheet', input);
  assert.deepEqual(t.groups.map((g) => g.heading), ['A-101', 'Page 2']);
  // Page 1 only: 100 sf = 3.125 sheets +10% = 3.4375, to 4 in multiples of 2, at 15.
  const dw = t.groups[0]!.rows.find((r) => r.unit === 'sheets')!;
  assert.equal(dw.order, 4);
  assert.equal(dw.cost, 60);
  near(t.groups[0]!.subtotal!.cost, 60 + 50 * 1);
  assert.equal(t.groups[1]!.rows.length, 2);
});

test('Quantities in different units are separate rows and never summed', () => {
  const sameName: Assembly[] = [
    { id: 'a', name: 'A', variables: [], items: [{ id: 'x', name: 'Pipe', unit: 'ft', formula: '[Length]' }] },
    { id: 'b', name: 'B', variables: [], items: [{ id: 'y', name: 'Pipe', unit: 'm', formula: '[Length]' }] },
  ];
  const ms = [markup('polylength', [[0, 0], [10, 0]], { assemblyId: 'a' }), markup('polylength', [[0, 0], [10, 0]], { assemblyId: 'b' })];
  const t = buildReport('byItem', { ...input, markups: ms, assemblies: sameName });
  const rows = t.groups.flatMap((g) => g.rows);
  assert.deepEqual(rows.map((r) => r.unit).sort(), ['ft', 'm']);
  assert.equal(rows.length, 2);
});

test('Measurement Detail has a row per measurement with plan, slope, cutouts and manual flag', () => {
  const t = buildReport('detail', input);
  const rows = t.groups[0]!.rows;
  assert.equal(rows.length, 7, 'the text note is not a measurement');
  const by = (subject: string) => rows.find((r) => r.subject === subject)!;
  const flat = by('Room A');
  assert.equal(flat.page, 'A-101');
  near(flat.planQty, 100);
  near(flat.trueQty, 100);
  assert.equal(flat.unit, 'sf');
  assert.equal(flat.slope, '');
  near(flat.slopeFactor, 1);
  assert.equal(flat.assembly, 'Lined wall');
  const sloped = by('Roof');
  near(sloped.planQty, 100);
  near(sloped.slopeFactor, Math.SQRT2);
  near(sloped.trueQty, 100 * Math.SQRT2);
  assert.notEqual(sloped.slope, '');
  const cut = by('Room B');
  assert.equal(cut.page, 'Page 2');
  assert.equal(cut.cutouts, 1);
  near(cut.cutoutArea, 20);
  near(cut.trueQty, 180);
  assert.equal(cut.unit, 'm²');
  assert.equal(by('Window').manual, 'Yes');
  assert.equal(by('Window').unit, 'ea');
  assert.equal(by('Room A').manual, '');
});

test('Count Schedule pivots subjects by sheet and includes manual counts', () => {
  const t = buildReport('counts', input);
  assert.deepEqual(t.columns.map((c) => c.label), ['Subject', 'A-101', 'Page 2', 'Total']);
  const rows = t.groups[0]!.rows;
  assert.deepEqual(rows.map((r) => r.subject), ['Door', 'Window']);
  assert.deepEqual(rows[0], { subject: 'Door', p0: 7, p1: null, total: 7 });
  assert.deepEqual(rows[1], { subject: 'Window', p0: null, p1: 2, total: 2 });
  assert.deepEqual(t.grandTotal, { subject: 'Total', p0: 7, p1: 2, total: 9 });
});

test('scopes pick the markups; the scale note appears only for mixed scales', () => {
  const none = new Set<string>();
  assert.equal(scopeMarkups(all, 'all', { pageIndex: 0, selected: none }).length, all.length);
  assert.deepEqual(scopeMarkups(all, 'page', { pageIndex: 1, selected: none }).map((m) => m.id), [room2.id, windows.id]);
  assert.deepEqual(scopeMarkups(all, 'selection', { pageIndex: 0, selected: new Set([roof.id]) }), [roof]);
  assert.deepEqual(scopeMarkups(all, 'list', { pageIndex: 0, selected: none, listIds: new Set([trim.id]) }), [trim]);
  assert.match(scaleNote(all, ctx, input.pageLabel) ?? '', /different scales/);
  assert.equal(scaleNote([room1, roof], ctx, input.pageLabel), undefined);
});

test('buildReports keeps the catalogue order and an empty scope still builds', () => {
  assert.deepEqual(buildReports(['counts', 'byItem'], input).map((t) => t.title), ['Quantity Summary by Item', 'Count Schedule']);
  const empty = buildReport('byItem', { ...input, markups: [] });
  assert.equal(empty.groups.length, 0);
  assert.equal(empty.grandTotal!.cost, null);
});

test('formatCell shows quantities, money and percentages for the page', () => {
  assert.equal(formatCell({ format: 'qty' }, 1234.5678), '1,234.57');
  assert.equal(formatCell({ format: 'money' }, 1234.5), '1,234.50');
  assert.equal(formatCell({ format: 'pct' }, 10), '10%');
  assert.equal(formatCell({ format: 'pct' }, 12.5), '12.5%');
  assert.equal(formatCell({ format: 'qty' }, null), '');
});

test('CSV escapes quotes, commas, line breaks and formula-looking text', () => {
  assert.equal(csvField('plain'), 'plain');
  assert.equal(csvField('a,b'), '"a,b"');
  assert.equal(csvField('say "hi"'), '"say ""hi"""');
  assert.equal(csvField('two\nlines'), '"two\nlines"');
  assert.equal(csvField('=1+1'), "'=1+1");
  assert.equal(csvField('-3/4 board'), "'-3/4 board");
  assert.equal(csvField(-3), '-3');
  const t: ReportTable = {
    title: 'T',
    columns: [
      { key: 'a', label: 'Name, with comma', align: 'left', format: 'text' },
      { key: 'b', label: 'Qty', align: 'right', format: 'qty' },
    ],
    groups: [{ heading: 'G', rows: [{ a: '@SUM(1)', b: 1.5 }], subtotal: { a: 'Subtotal', b: 1.5 } }],
    grandTotal: { a: 'Total', b: 1.5 },
  };
  assert.equal(reportCsv(t), ['Group,"Name, with comma",Qty', "G,'@SUM(1),1.5", ',Total,1.5'].join('\r\n'));
});

/** Reads the stored entries of a zip back out. */
function unzip(zip: Uint8Array): Map<string, string> {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const out = new Map<string, string>();
  const eocd = zip.length - 22;
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  for (let i = 0; i < count; i++) {
    const size = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const local = view.getUint32(p + 42, true);
    const name = new TextDecoder().decode(zip.subarray(p + 46, p + 46 + nameLen));
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    out.set(name, new TextDecoder().decode(zip.subarray(start, start + size)));
    p += 46 + nameLen;
  }
  return out;
}

test('a workbook has a sheet per report with numbers kept numeric and bold totals', () => {
  const tables = buildReports(['byItem', 'counts'], input);
  const parts = unzip(reportsXlsx(tables, [['Project: Plan']]));
  const book = parts.get('xl/workbook.xml')!;
  assert.match(book, /name="Quantity Summary by Item" sheetId="1" r:id="rId1"/);
  assert.match(book, /name="Count Schedule" sheetId="2" r:id="rId2"/);
  for (const n of ['xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml']) assert.ok(parts.has(n), n);
  assert.match(parts.get('[Content_Types].xml')!, /sheet2\.xml/);
  assert.match(parts.get('xl/_rels/workbook.xml.rels')!, /Id="rId3"[^>]*styles\.xml/);
  const first = parts.get('xl/worksheets/sheet1.xml')!;
  assert.match(first, /<pane ySplit="1"/);
  // Order qty (column H) is a number with the number style; the header row is bold text.
  assert.match(first, /<c r="H3" s="2"><v>10<\/v><\/c>/);
  assert.match(first, /<c r="A1" s="1" t="inlineStr">/);
  assert.match(first, /Project: Plan/);
  assert.ok(!first.includes('<autoFilter'));
});

test('two sheets with the same name get different names, and formula-looking text is quoted', () => {
  const parts = unzip(buildWorkbook([{ name: 'Quantities', table: [['Name'], ['=A1']] }, { name: 'quantities', table: [['x']] }]));
  const book = parts.get('xl/workbook.xml')!;
  assert.match(book, /name="Quantities"/);
  assert.match(book, /name="quantities 2"/);
  assert.match(parts.get('xl/worksheets/sheet1.xml')!, /<c r="A2" s="6" t="inlineStr">/);
});

test('the sheet layout puts headings, subtotals and the total in bold rows', () => {
  const sheet = reportSheet(buildReport('byAssembly', input));
  assert.deepEqual(sheet.table[0]!.slice(0, 3), ['Item No', 'Description', 'Category']);
  assert.ok(sheet.boldRows!.has(1), 'the first assembly heading');
  assert.equal(sheet.formats![5], 'pct');
  assert.equal(sheet.formats![1], undefined);
});

test('the PDF has a header and Page x of y on every page', async () => {
  const bytes = await reportPdf({ project: 'Plan', date: '2026-01-01', scope: 'All pages', scaleNote: 'Mixed scales', paper: 'a4', reports: buildReports(['byItem', 'detail'], input) });
  assert.equal(new TextDecoder().decode(bytes.subarray(0, 5)), '%PDF-');
  const { PDFDocument } = await import('pdf-lib');
  const doc = await PDFDocument.load(bytes);
  assert.equal(doc.getPageCount(), 2);
  assert.ok(Math.abs(doc.getPage(0).getWidth() - 841.89) < 0.01);
  const letter = await PDFDocument.load(await reportPdf({ project: 'Plan', date: 'd', scope: 's', paper: 'letter', reports: [] }));
  assert.equal(letter.getPage(0).getWidth(), 792);
});
