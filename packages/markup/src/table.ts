import { boundsOf, type Markup, type Point, type Rect } from './model';

/**
 * A table markup's grid. Columns and rows are shares of the box (only their ratios matter), so
 * resizing the box scales every cell, while inserting or deleting a line grows or shrinks the box
 * by exactly that line and leaves the others as they were.
 */
export interface TableData {
  /** Width of each column. */
  cols: number[];
  /** Height of each row. */
  rows: number[];
  /** Cell text, `cells[row][col]`. */
  cells: string[][];
}

/** Most rows or columns a table can have. */
export const MAX_TABLE_LINES = 50;

/** Rows and columns a table gets when none were chosen. */
const DEFAULT_LINES = 3;

/** A table of `rows` by `cols` equal, empty cells. */
export function newTable(rows: number, cols: number): TableData {
  const r = clampLines(rows);
  const c = clampLines(cols);
  return { cols: Array<number>(c).fill(1), rows: Array<number>(r).fill(1), cells: Array.from({ length: r }, () => Array<string>(c).fill('')) };
}

/** A line count made whole and kept within 1..MAX_TABLE_LINES. */
export function clampLines(n: number): number {
  return Number.isFinite(n) ? Math.min(MAX_TABLE_LINES, Math.max(1, Math.round(n))) : 1;
}

const share = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 1);

/**
 * The markup's grid with its shape made consistent: at least one row and column, a positive size
 * for each, and a text for every cell. A table without a grid (placed by another route) is 3 by 3.
 */
export function tableOf(m: Pick<Markup, 'table'>): TableData {
  const t = m.table;
  if (!t) return newTable(DEFAULT_LINES, DEFAULT_LINES);
  const rows = (Array.isArray(t.rows) && t.rows.length ? t.rows : [1]).slice(0, MAX_TABLE_LINES).map(share);
  const cols = (Array.isArray(t.cols) && t.cols.length ? t.cols : [1]).slice(0, MAX_TABLE_LINES).map(share);
  const cells = rows.map((_, r) => cols.map((__, c) => (typeof t.cells?.[r]?.[c] === 'string' ? t.cells[r]![c]! : '')));
  return { cols, rows, cells };
}

const sum = (n: readonly number[]) => n.reduce((a, b) => a + b, 0);

/** Where the grid lines fall: `xs` has one more entry than there are columns, `ys` one more than rows. */
export function tableGrid(m: Pick<Markup, 'points' | 'table'>): { xs: number[]; ys: number[] } {
  const b = boundsOf(m.points);
  const t = tableOf(m);
  const lines = (from: number, length: number, shares: number[]) => {
    const total = sum(shares);
    let at = 0;
    return [from, ...shares.map((s) => from + length * (at += s) / total)];
  };
  return { xs: lines(b.x, b.w, t.cols), ys: lines(b.y, b.h, t.rows) };
}

/** The box of one cell. */
export function tableCellRect(m: Pick<Markup, 'points' | 'table'>, row: number, col: number): Rect {
  const { xs, ys } = tableGrid(m);
  const x0 = xs[col] ?? xs[0]!;
  const y0 = ys[row] ?? ys[0]!;
  return { x: x0, y: y0, w: (xs[col + 1] ?? x0) - x0, h: (ys[row + 1] ?? y0) - y0 };
}

/** The cell under a page point, or null outside the table. A point on a line belongs to the cell after it. */
export function tableCellAt(m: Pick<Markup, 'points' | 'table'>, p: Point): { row: number; col: number } | null {
  const b = boundsOf(m.points);
  if (p[0] < b.x || p[0] > b.x + b.w || p[1] < b.y || p[1] > b.y + b.h) return null;
  const { xs, ys } = tableGrid(m);
  const find = (lines: number[], v: number) => {
    let i = 0;
    while (i < lines.length - 2 && v >= lines[i + 1]!) i++;
    return i;
  };
  return { row: find(ys, p[1]), col: find(xs, p[0]) };
}

/** The cells of a table with their boxes, row by row. */
export function tableCells(m: Pick<Markup, 'points' | 'table'>): { row: number; col: number; rect: Rect; text: string }[] {
  const t = tableOf(m);
  return t.rows.flatMap((_, row) => t.cols.map((__, col) => ({ row, col, rect: tableCellRect(m, row, col), text: t.cells[row]![col]! })));
}

/** A cell as a text box, so its text is laid out and drawn like any other. */
export function tableCellText(m: Markup, cell: { rect: Rect; text: string }): Markup {
  const { x, y, w, h } = cell.rect;
  return { ...m, type: 'text', points: [[x, y], [x + w, y + h]], text: cell.text, rotation: undefined };
}

/** The changes an edit makes to a table markup. */
export interface TableEdit {
  points: Point[];
  table: TableData;
}

/** The box with its height or width replaced, keeping its top left corner. */
function resizedTo(m: Pick<Markup, 'points'>, w: number, h: number): Point[] {
  const b = boundsOf(m.points);
  return [[b.x, b.y], [b.x + w, b.y + h]];
}

/** The table with an empty row at `index` (0 is above the first), as tall as row `like`. The box grows by it. Null at the size limit. */
export function insertTableRow(m: Pick<Markup, 'points' | 'table'>, index: number, like: number): TableEdit | null {
  const t = tableOf(m);
  if (t.rows.length >= MAX_TABLE_LINES) return null;
  const at = Math.min(Math.max(0, index), t.rows.length);
  const size = t.rows[Math.min(Math.max(0, like), t.rows.length - 1)]!;
  const b = boundsOf(m.points);
  const rows = [...t.rows.slice(0, at), size, ...t.rows.slice(at)];
  const cells = [...t.cells.slice(0, at), t.cols.map(() => ''), ...t.cells.slice(at)];
  return { points: resizedTo(m, b.w, (b.h * sum(rows)) / sum(t.rows)), table: { ...t, rows, cells } };
}

/** The table without row `row`, the box shrinking by its height. Null when it is the only row. */
export function deleteTableRow(m: Pick<Markup, 'points' | 'table'>, row: number): TableEdit | null {
  const t = tableOf(m);
  if (t.rows.length <= 1 || row < 0 || row >= t.rows.length) return null;
  const b = boundsOf(m.points);
  const rows = t.rows.filter((_, i) => i !== row);
  return { points: resizedTo(m, b.w, (b.h * sum(rows)) / sum(t.rows)), table: { ...t, rows, cells: t.cells.filter((_, i) => i !== row) } };
}

/** The table with an empty column at `index` (0 is left of the first), as wide as column `like`. The box grows by it. Null at the size limit. */
export function insertTableColumn(m: Pick<Markup, 'points' | 'table'>, index: number, like: number): TableEdit | null {
  const t = tableOf(m);
  if (t.cols.length >= MAX_TABLE_LINES) return null;
  const at = Math.min(Math.max(0, index), t.cols.length);
  const size = t.cols[Math.min(Math.max(0, like), t.cols.length - 1)]!;
  const b = boundsOf(m.points);
  const cols = [...t.cols.slice(0, at), size, ...t.cols.slice(at)];
  const cells = t.cells.map((r) => [...r.slice(0, at), '', ...r.slice(at)]);
  return { points: resizedTo(m, (b.w * sum(cols)) / sum(t.cols), b.h), table: { ...t, cols, cells } };
}

/** The table without column `col`, the box shrinking by its width. Null when it is the only column. */
export function deleteTableColumn(m: Pick<Markup, 'points' | 'table'>, col: number): TableEdit | null {
  const t = tableOf(m);
  if (t.cols.length <= 1 || col < 0 || col >= t.cols.length) return null;
  const b = boundsOf(m.points);
  const cols = t.cols.filter((_, i) => i !== col);
  return { points: resizedTo(m, (b.w * sum(cols)) / sum(t.cols), b.h), table: { ...t, cols, cells: t.cells.map((r) => r.filter((_, i) => i !== col)) } };
}

/** The table with one cell's text replaced. */
export function setTableCell(m: Pick<Markup, 'table'>, row: number, col: number, text: string): TableData {
  const t = tableOf(m);
  return { ...t, cells: t.cells.map((r, i) => (i === row ? r.map((c, j) => (j === col ? text : c)) : r)) };
}

/** What a table says, for other tools' lists and search: a line per row, a tab between cells. */
export function tableSummary(m: Pick<Markup, 'table'>): string {
  return tableOf(m)
    .cells.map((r) => r.map((c) => c.replace(/\s*\n\s*/g, ' ')).join('\t'))
    .join('\n')
    .trim();
}
