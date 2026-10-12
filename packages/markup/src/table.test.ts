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
  mergeTableCells,
  moveTableLine,
  newTable,
  setTableCell,
  splitTableCell,
  tableCellAt,
  tableCellRect,
  tableCells,
  tableGrid,
  tableLineAt,
  tableLines,
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

test('merged cells are one cell: its box covers them all and a point in any of them finds the first', () => {
  const m = withCells(table(3, 3, [[0, 0], [300, 90]]), [[0, 0, 'A'], [0, 1, 'B'], [1, 0, 'C'], [1, 1, 'D']]);
  const merged = { ...m, table: mergeTableCells(m, { row: 0, col: 0 }, { row: 1, col: 1 })! };
  assert.deepEqual(tableCellRect(merged, 1, 1), { x: 0, y: 0, w: 200, h: 60 });
  assert.deepEqual(tableCellAt(merged, [150, 50]), { row: 0, col: 0 });
  assert.equal(tableOf(merged).cells[0]![0], 'A\nB\nC\nD', 'the text of every merged cell is kept');
  assert.deepEqual(tableOf(merged).cells[1], ['', '', '']);
  assert.equal(tableCells(merged).length, 9 - 3);
});

test('merging a range grows it to take in the merged cells it touches, and one cell is no merge', () => {
  let m = table(4, 4);
  m = { ...m, table: mergeTableCells(m, { row: 0, col: 0 }, { row: 0, col: 1 })! };
  const t = mergeTableCells(m, { row: 0, col: 1 }, { row: 1, col: 2 })!;
  assert.deepEqual(t.merges, [{ row: 0, col: 0, rowSpan: 2, colSpan: 3 }]);
  assert.equal(mergeTableCells(m, { row: 2, col: 2 }, { row: 2, col: 2 }), null);
  assert.equal(mergeTableCells(m, { row: 0, col: 0 }, { row: 0, col: 0 }), null, 'a merged cell on its own is already one');
});

test('a merged cell can be split, leaving its text in the first cell', () => {
  let m = withCells(table(2, 2), [[0, 0, 'Hi']]);
  m = { ...m, table: mergeTableCells(m, { row: 0, col: 0 }, { row: 1, col: 1 })! };
  const split = splitTableCell(m, 1, 1)!;
  assert.equal(split.merges, undefined);
  assert.equal(split.cells[0]![0], 'Hi');
  assert.equal(splitTableCell({ table: split }, 0, 0), null);
});

test('no line is drawn inside a merged cell, and none can be grabbed there', () => {
  let m = table(2, 3, [[0, 0], [300, 100]]);
  assert.equal(tableLines(m).length, 2 + 1);
  m = { ...m, table: mergeTableCells(m, { row: 0, col: 0 }, { row: 0, col: 1 })! };
  assert.deepEqual(tableLines(m).filter((l) => l[0] === l[2]), [[100, 50, 100, 100], [200, 0, 200, 100]]);
  assert.deepEqual(tableLineAt(m, [100, 25], 3), null);
  assert.deepEqual(tableLineAt(m, [100, 75], 3), { axis: 'col', line: 1 });
  assert.deepEqual(tableLineAt(m, [50, 50], 3), { axis: 'row', line: 1 });
  assert.equal(tableLineAt(m, [150, 20], 3), null);
});

test('dragging a line trades space with its neighbour and keeps the table size', () => {
  const m = table(2, 2, [[0, 0], [200, 100]]);
  const wider = { ...m, table: moveTableLine(m, { axis: 'col', line: 1 }, 150)! };
  assert.deepEqual(tableGrid(wider).xs, [0, 150, 200]);
  const taller = { ...m, table: moveTableLine(m, { axis: 'row', line: 1 }, 20)! };
  assert.deepEqual(tableGrid(taller).ys, [0, 20, 100]);
  assert.deepEqual(tableGrid({ ...m, table: moveTableLine(m, { axis: 'col', line: 1 }, 9999, 10)! }).xs, [0, 190, 200], 'it stops short of squashing the next column');
  assert.equal(moveTableLine(m, { axis: 'col', line: 2 }, 100), null);
  assert.equal(moveTableLine(m, { axis: 'row', line: 0 }, 100), null);
});

test('merges follow rows and columns being added and removed', () => {
  let m = table(4, 4);
  m = { ...m, table: mergeTableCells(m, { row: 1, col: 1 }, { row: 2, col: 2 })! };
  assert.deepEqual(applied(m, insertTableRow(m, 0, 0)).table!.merges, [{ row: 2, col: 1, rowSpan: 2, colSpan: 2 }]);
  assert.deepEqual(applied(m, insertTableRow(m, 2, 1)).table!.merges, [{ row: 1, col: 1, rowSpan: 3, colSpan: 2 }], 'inside it, the merged cell grows');
  assert.deepEqual(applied(m, insertTableColumn(m, 3, 0)).table!.merges, [{ row: 1, col: 1, rowSpan: 2, colSpan: 2 }], 'after it, nothing changes');
  assert.deepEqual(applied(m, deleteTableColumn(m, 0)).table!.merges, [{ row: 1, col: 0, rowSpan: 2, colSpan: 2 }]);
  assert.deepEqual(applied(m, deleteTableRow(m, 2)).table!.merges, [{ row: 1, col: 1, rowSpan: 1, colSpan: 2 }]);
  const one = { ...table(3, 3), table: mergeTableCells(table(3, 3), { row: 0, col: 0 }, { row: 1, col: 0 })! };
  assert.equal(applied(one, deleteTableRow(one, 1)).table!.merges, undefined, 'a merge down to one cell is a merge no more');
});

test('deleting the first row of a merged cell hands its text to the next', () => {
  let m = withCells(table(3, 2), [[0, 0, 'Keep']]);
  m = { ...m, table: mergeTableCells(m, { row: 0, col: 0 }, { row: 1, col: 0 })! };
  const t = applied(m, deleteTableRow(m, 0)).table!;
  assert.equal(t.merges, undefined);
  assert.equal(t.cells[0]![0], 'Keep');
});

test('a damaged merge list is ignored: overlaps, one cell and out of range', () => {
  const t = tableOf({ table: { rows: [1, 1], cols: [1, 1], cells: [], merges: [{ row: 0, col: 0, rowSpan: 2, colSpan: 2 }, { row: 1, col: 1, rowSpan: 1, colSpan: 2 }, { row: 5, col: 0, rowSpan: 2, colSpan: 2 }, { row: 0, col: 0, rowSpan: 1, colSpan: 1 }] } });
  assert.deepEqual(t.merges, [{ row: 0, col: 0, rowSpan: 2, colSpan: 2 }]);
});

test('merged cells keep their grid when saved to PDF', async () => {
  let m = withCells(table(2, 2, [[50, 50], [250, 130]]), [[0, 0, 'Wide']]);
  m = { ...m, table: mergeTableCells(m, { row: 0, col: 0 }, { row: 0, col: 1 })! };
  const doc = await PDFDocument.create();
  doc.addPage([400, 400]);
  const bytes = await exportWithAnnotations((await doc.save()).buffer as ArrayBuffer, [m]);
  const page = (await PDFDocument.load(bytes)).getPage(0);
  const dict = page.doc.context.lookup(page.node.Annots()!.get(0), PDFDict);
  const data = JSON.parse((dict.get(PDFName.of('NBData')) as PDFHexString).decodeText()) as Markup;
  assert.deepEqual(data.table!.merges, [{ row: 0, col: 0, rowSpan: 1, colSpan: 2 }]);
});
