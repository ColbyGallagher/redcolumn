import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDict, PDFDocument, PDFHexString, PDFName } from 'pdf-lib';
import { exportWithAnnotations } from './export.ts';
import { hitTest, markupShape, resizedBox } from './geometry.ts';
import { DEFAULT_STYLES, boundsOf, type Markup, type Point } from './model.ts';
import { drawMarkup } from './render.ts';
import {
  deleteTableColumn,
  deleteTableRow,
  insertTableColumn,
  insertTableRow,
  MAX_TABLE_LINES,
  newTable,
  setTableCell,
  tableCellAt,
  tableCellRect,
  tableGrid,
  tableOf,
  tableSummary,
} from './table.ts';

function table(rows: number, cols: number, points: Point[] = [[100, 100], [100 + cols * 50, 100 + rows * 20]], extra: Partial<Markup> = {}): Markup {
  return { id: 'table-1', type: 'table', pageIndex: 0, points, style: { ...DEFAULT_STYLES.table }, table: newTable(rows, cols), status: 'none', author: 'Test', createdAt: 1, modifiedAt: 1, ...extra };
}

/** The markup with these cells' text set. */
const withCells = (m: Markup, cells: [row: number, col: number, text: string][]): Markup => ({ ...m, table: cells.reduce((t, [r, c, text]) => setTableCell({ table: t }, r, c, text), tableOf(m)) });

/** The markup with an edit applied, as the store would. */
const applied = (m: Markup, edit: { points: Point[]; table: Markup['table'] } | null): Markup => ({ ...m, ...edit! });

test('a new table has the rows and columns asked for, all empty and equal', () => {
  const t = newTable(4, 3);
  assert.equal(t.rows.length, 4);
  assert.equal(t.cols.length, 3);
  assert.deepEqual(t.cells, Array.from({ length: 4 }, () => ['', '', '']));
  assert.deepEqual(newTable(0, 999), newTable(1, MAX_TABLE_LINES));
  assert.deepEqual(newTable(Number.NaN, 2.6).cols, [1, 1, 1]);
});

test('a table with no grid, or a damaged one, is read as a usable grid', () => {
  assert.deepEqual([tableOf({}).rows.length, tableOf({}).cols.length], [3, 3]);
  const t = tableOf({ table: { rows: [2, -1, 0], cols: [1], cells: [['a'], [], ['c', 'x']] } });
  assert.deepEqual(t.rows, [2, 1, 1]);
  assert.deepEqual(t.cells, [['a'], [''], ['c']]);
});

test('grid lines divide the box by each column and row share', () => {
  const m = table(2, 2, [[0, 0], [100, 60]], { table: { rows: [1, 2], cols: [3, 1], cells: [['', ''], ['', '']] } });
  assert.deepEqual(tableGrid(m), { xs: [0, 75, 100], ys: [0, 20, 60] });
  assert.deepEqual(tableCellRect(m, 1, 0), { x: 0, y: 20, w: 75, h: 40 });
});

test('the cell under a point, none outside, and a line belongs to the cell after it', () => {
  const m = table(2, 3, [[0, 0], [300, 100]]);
  assert.deepEqual(tableCellAt(m, [10, 10]), { row: 0, col: 0 });
  assert.deepEqual(tableCellAt(m, [299, 99]), { row: 1, col: 2 });
  assert.deepEqual(tableCellAt(m, [100, 50]), { row: 1, col: 1 });
  assert.deepEqual(tableCellAt(m, [300, 100]), { row: 1, col: 2 });
  assert.equal(tableCellAt(m, [301, 10]), null);
  assert.equal(tableCellAt(m, [10, -1]), null);
});

test('inserting a row adds an empty one and grows the box by that row, leaving the others as they were', () => {
  let m = table(2, 2, [[0, 0], [100, 80]]);
  m = withCells(m, [[0, 0, 'top'], [1, 1, 'bottom']]);
  const above = applied(m, insertTableRow(m, 1, 1));
  assert.equal(tableOf(above).rows.length, 3);
  assert.deepEqual(above.table!.cells, [['top', ''], ['', ''], ['', 'bottom']]);
  assert.deepEqual(boundsOf(above.points), { x: 0, y: 0, w: 100, h: 120 });
  assert.deepEqual(tableGrid(above).ys, [0, 40, 80, 120]);
  const end = applied(m, insertTableRow(m, 2, 1));
  assert.deepEqual(end.table!.cells, [['top', ''], ['', 'bottom'], ['', '']]);
  const first = applied(m, insertTableRow(m, 0, 0));
  assert.deepEqual(first.table!.cells[0], ['', '']);
  assert.equal(first.table!.cells[1]![0], 'top');
});

test('a new row is as tall as the row it was inserted beside', () => {
  const m = table(2, 1, [[0, 0], [100, 90]], { table: { rows: [1, 2], cols: [1], cells: [[''], ['']] } });
  const next = applied(m, insertTableRow(m, 2, 1));
  assert.deepEqual(tableGrid(next).ys, [0, 30, 90, 150]);
});

test('inserting a column adds an empty one and grows the box by that column', () => {
  let m = table(2, 2, [[0, 0], [100, 80]]);
  m = withCells(m, [[0, 1, 'right']]);
  const left = applied(m, insertTableColumn(m, 1, 0));
  assert.deepEqual(left.table!.cells, [['', '', 'right'], ['', '', '']]);
  assert.deepEqual(boundsOf(left.points), { x: 0, y: 0, w: 150, h: 80 });
  assert.deepEqual(tableGrid(left).xs, [0, 50, 100, 150]);
});

test('deleting a row or column removes its cells and shrinks the box by it', () => {
  let m = table(3, 3, [[10, 10], [310, 130]]);
  m = withCells(m, [[1, 1, 'mid'], [2, 2, 'end']]);
  const row = applied(m, deleteTableRow(m, 0));
  assert.deepEqual(row.table!.cells, [['', 'mid', ''], ['', '', 'end']]);
  assert.deepEqual(boundsOf(row.points), { x: 10, y: 10, w: 300, h: 80 });
  const col = applied(m, deleteTableColumn(m, 1));
  assert.deepEqual(col.table!.cells, [['', ''], ['', ''], ['', 'end']]);
  assert.deepEqual(boundsOf(col.points), { x: 10, y: 10, w: 200, h: 120 });
});

test('the last row and the last column cannot be deleted, and tables stop growing at the limit', () => {
  assert.equal(deleteTableRow(table(1, 3), 0), null);
  assert.equal(deleteTableColumn(table(3, 1), 0), null);
  assert.equal(deleteTableRow(table(3, 3), 3), null);
  assert.equal(insertTableRow(table(MAX_TABLE_LINES, 1), 0, 0), null);
  assert.equal(insertTableColumn(table(1, MAX_TABLE_LINES), 0, 0), null);
});

test('editing keeps the top left corner, whichever corner the box was dragged from', () => {
  const m = table(2, 2, [[100, 100], [0, 0]]);
  const next = applied(m, insertTableRow(m, 2, 1));
  assert.deepEqual(boundsOf(next.points), { x: 0, y: 0, w: 100, h: 150 });
});

test('drawn, a table is its frame plus a line between each pair of rows and columns', () => {
  const parts = markupShape(table(3, 4, [[0, 0], [400, 90]]));
  assert.equal(parts.length, 2);
  assert.equal(parts[1]!.path.filter((c) => c[0] === 'M').length, 2 + 3);
  assert.equal(markupShape(table(1, 1)).length, 1, 'a single cell has no inner lines');
});

test('a table is grabbed anywhere inside it, and resizing the box scales its cells', () => {
  const m = table(2, 2, [[0, 0], [100, 40]]);
  assert.ok(hitTest(m, [50, 20], 2));
  assert.ok(!hitTest(m, [150, 20], 2));
  const bigger = { ...m, points: resizedBox(m, 200, 80) };
  assert.deepEqual(tableGrid(bigger).xs, [0, 100, 200]);
});

test('cell text is drawn inside its cell', () => {
  const texts: { text: string; x: number; y: number }[] = [];
  const ctx = new Proxy({} as Record<string | symbol, unknown>, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === 'measureText') return (s: string) => ({ width: s.length * 6 });
      if (key === 'fillText') return (text: string, x: number, y: number) => texts.push({ text, x, y });
      return () => undefined;
    },
    set(target, key, value) {
      target[key] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  let m = table(2, 2, [[0, 0], [200, 100]]);
  m = withCells(m, [[0, 1, 'B1'], [1, 0, 'A2']]);
  drawMarkup(ctx, m);
  assert.deepEqual(texts.map((t) => t.text), ['B1', 'A2']);
  assert.ok(texts[0]!.x >= 100 && texts[0]!.y < 50, 'B1 sits in the top right cell');
  assert.ok(texts[1]!.x < 100 && texts[1]!.y >= 50, 'A2 sits in the bottom left cell');
});

test('what a table says is its rows, a tab between cells', () => {
  let m = table(2, 2);
  assert.equal(tableSummary(m), '');
  m = withCells(m, [[0, 0, 'Item'], [1, 1, 'two\nlines']]);
  assert.equal(tableSummary(m), 'Item\t\n\ttwo lines');
});

test('a table saved to PDF is a stamp with its text for other tools, and keeps its grid for ours', async () => {
  let m = table(3, 2, [[50, 50], [250, 170]]);
  m = withCells(m, [[0, 0, 'Door'], [2, 1, 'Fire rated']]);
  const doc = await PDFDocument.create();
  doc.addPage([400, 400]);
  const original = await doc.save();
  const bytes = await exportWithAnnotations(original.buffer as ArrayBuffer, [m]);
  const page = (await PDFDocument.load(bytes)).getPage(0);
  const dict = page.doc.context.lookup(page.node.Annots()!.get(0), PDFDict);
  assert.equal(dict.get(PDFName.of('Subtype'))?.toString(), '/Stamp');
  assert.equal((dict.get(PDFName.of('Contents')) as PDFHexString).decodeText(), 'Door\t\n\t\n\tFire rated');
  const data = JSON.parse((dict.get(PDFName.of('NBData')) as PDFHexString).decodeText()) as Markup;
  assert.equal(data.type, 'table');
  assert.deepEqual(data.table, m.table);
});
