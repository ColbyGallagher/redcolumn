import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { exportWithAnnotations } from './export.ts';
import { markupShape } from './geometry.ts';
import { DEFAULT_STYLES, type Markup, type Point } from './model.ts';
import { drawMarkup } from './render.ts';
import {
  clearTableFormats,
  deleteTableColumn,
  deleteTableRow,
  formatTableCells,
  insertTableColumn,
  insertTableRow,
  mergeTableCells,
  newTable,
  setTableCell,
  tableCellFormat,
  tableCells,
  tableCellStyle,
  tableOf,
} from './table.ts';

function table(rows: number, cols: number, points: Point[] = [[100, 100], [100 + cols * 50, 100 + rows * 20]], extra: Partial<Markup> = {}): Markup {
  return { id: 'table-1', type: 'table', pageIndex: 0, points, style: { ...DEFAULT_STYLES.table }, table: newTable(rows, cols), status: 'none', author: 'Test', createdAt: 1, modifiedAt: 1, ...extra };
}

const one = (row: number, col: number) => ({ row, col, rowSpan: 1, colSpan: 1 });
const all = (rows: number, cols: number) => ({ row: 0, col: 0, rowSpan: rows, colSpan: cols });
const applied = (m: Markup, edit: { points: Point[]; table: Markup['table'] } | null): Markup => ({ ...m, ...edit! });
const withCells = (m: Markup, cells: [row: number, col: number, text: string][]): Markup => ({ ...m, table: cells.reduce((t, [r, c, text]) => setTableCell({ table: t }, r, c, text), tableOf(m)) });

test('a cell can have its own font, size, colour and background over the table look', () => {
  let m = table(2, 2, [[0, 0], [200, 100]], { style: { ...DEFAULT_STYLES.table, fontSize: 10, textColor: '#111111' } });
  m = { ...m, table: formatTableCells(m, one(0, 1), { fontSize: 20, bold: true, textColor: '#ff0000', fill: '#ffff00' }) };
  assert.deepEqual(tableCellFormat(m, 0, 1), { fontSize: 20, bold: true, textColor: '#ff0000', fill: '#ffff00' });
  assert.equal(tableCellStyle(m, 0, 1).fontSize, 20);
  assert.equal(tableCellStyle(m, 0, 1).bold, true);
  assert.equal(tableCellStyle(m, 0, 0).fontSize, 10, 'other cells keep the table look');
  assert.equal(tableCellStyle(m, 0, 0).textColor, '#111111');
  const cells = tableCells(m);
  assert.equal(cells.find((c) => c.row === 0 && c.col === 1)!.fill, '#ffff00');
  assert.equal(cells.find((c) => c.row === 0 && c.col === 0)!.fill, undefined);
});

test('formatting a block sets every cell in it, a merged cell once, and undefined goes back to the table look', () => {
  let m = table(3, 3);
  m = { ...m, table: mergeTableCells(m, { row: 0, col: 0 }, { row: 0, col: 1 })! };
  m = { ...m, table: formatTableCells(m, { row: 0, col: 0, rowSpan: 2, colSpan: 3 }, { italic: true }) };
  assert.deepEqual(Object.keys(m.table!.formats!).sort(), ['0,0', '0,2', '1,0', '1,1', '1,2']);
  m = { ...m, table: formatTableCells(m, { row: 0, col: 0, rowSpan: 2, colSpan: 3 }, { italic: undefined }) };
  assert.equal(m.table!.formats, undefined, 'cells left saying nothing have no format');
});

test('changing the whole table text style takes it off the cells that had their own', () => {
  let m = table(2, 2);
  m = { ...m, table: formatTableCells(m, all(2, 2), { fontSize: 18, fill: '#eeeeee' }) };
  assert.deepEqual(Object.values(clearTableFormats(m, ['fontSize']).formats!), Array(4).fill({ fill: '#eeeeee' }));
  const top = clearTableFormats(m, undefined, { row: 0, col: 0, rowSpan: 1, colSpan: 2 });
  assert.deepEqual(Object.keys(top.formats!).sort(), ['1,0', '1,1'], 'with no settings named, the cells asked for lose all of them');
});

test('cell formats follow their cells when rows and columns are added and removed', () => {
  let m = table(3, 3);
  m = { ...m, table: formatTableCells(m, one(1, 1), { bold: true }) };
  assert.deepEqual(Object.keys(applied(m, insertTableRow(m, 0, 0)).table!.formats!), ['2,1']);
  assert.deepEqual(Object.keys(applied(m, insertTableColumn(m, 2, 0)).table!.formats!), ['1,1']);
  assert.deepEqual(Object.keys(applied(m, deleteTableRow(m, 0)).table!.formats!), ['0,1']);
  assert.equal(applied(m, deleteTableColumn(m, 1)).table!.formats, undefined, 'a deleted cell takes its format with it');
});

test('a merged cell has its first cell format, which deleting its first row hands on', () => {
  let m = table(3, 2);
  m = { ...m, table: formatTableCells(m, all(3, 2), { underline: true }) };
  m = { ...m, table: mergeTableCells(m, { row: 0, col: 0 }, { row: 1, col: 0 })! };
  assert.equal(m.table!.formats!['1,0'], undefined, 'the cells it merged keep nothing');
  const next = applied(m, deleteTableRow(m, 0)).table!;
  assert.equal(next.merges, undefined);
  assert.deepEqual(next.formats!['0,0'], { underline: true });
});

test('a damaged format list is ignored', () => {
  const bad = { '0,0': { fontSize: -3, bold: 'yes', fill: '#fff', junk: 1 }, '4,4': { bold: true }, x: { bold: true }, '0,1': null };
  const t = tableOf({ table: { rows: [1], cols: [1], cells: [], formats: bad as never } });
  assert.deepEqual(t.formats, { '0,0': { fill: '#fff' } });
});

test('each cell is drawn in its own font, size and colour, and its background fills under the lines', () => {
  const texts: { text: string; font: unknown; color: unknown }[] = [];
  const ctx = new Proxy({} as Record<string | symbol, unknown>, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === 'measureText') return (s: string) => ({ width: s.length * 6 });
      if (key === 'fillText') return (text: string) => texts.push({ text, font: target.font, color: target.fillStyle });
      return () => undefined;
    },
    set(target, key, value) {
      target[key] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  let m = withCells(table(1, 2, [[0, 0], [200, 50]]), [[0, 0, 'A'], [0, 1, 'B']]);
  m = { ...m, table: formatTableCells(m, one(0, 1), { fontSize: 30, italic: true, textColor: '#00ff00' }) };
  drawMarkup(ctx, m);
  assert.deepEqual(texts.map((t) => t.text), ['A', 'B']);
  assert.match(String(texts[1]!.font), /^italic 30px /);
  assert.equal(texts[1]!.color, '#00ff00');
  assert.match(String(texts[0]!.font), /^12px /);
  assert.notEqual(texts[0]!.color, '#00ff00');
  const shaded = markupShape({ ...m, table: formatTableCells(m, one(0, 0), { fill: '#ffff00' }) });
  assert.deepEqual(shaded.map((p) => [p.fill, p.stroke]), [['#ffff00', false], [null, true], [null, true]], 'cell fill, then the frame, then the lines');
});

test('cell fonts, sizes and colours are in the saved PDF, and the formats come back with the table', async () => {
  let m = withCells(table(1, 2, [[50, 50], [250, 100]]), [[0, 0, 'Plain'], [0, 1, 'Loud']]);
  m = { ...m, table: formatTableCells(m, one(0, 1), { fontFamily: 'serif', bold: true, textColor: '#ff0000', fontSize: 20 }) };
  const doc = await PDFDocument.create();
  doc.addPage([400, 400]);
  const bytes = await exportWithAnnotations((await doc.save()).buffer as ArrayBuffer, [m]);
  const page = (await PDFDocument.load(bytes)).getPage(0);
  const context = page.doc.context;
  const dict = context.lookup(page.node.Annots()!.get(0), PDFDict);
  const ap = context.lookup(dict.get(PDFName.of('AP')), PDFDict);
  const stream = context.lookup(ap.get(PDFName.of('N'))) as PDFRawStream;
  const content = new TextDecoder('latin1').decode(decodePDFRawStream(stream).decode());
  assert.match(content, /\/F1 20 Tf/, 'the second cell has a font of its own');
  assert.match(content, /1 0 0 rg/, 'and a colour');
  const fonts = context.lookup(context.lookup(stream.dict.get(PDFName.of('Resources')), PDFDict).get(PDFName.of('Font')), PDFDict);
  assert.deepEqual(fonts.keys().map((k) => k.decodeText()).sort(), ['F0', 'F1']);
  const data = JSON.parse((dict.get(PDFName.of('NBData')) as PDFHexString).decodeText()) as Markup;
  assert.deepEqual(data.table!.formats, m.table!.formats);
});
