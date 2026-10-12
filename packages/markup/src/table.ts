import { boundsOf, type Markup, type MarkupStyle, type Point, type Rect } from './model';

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
  /** Cell text, `cells[row][col]`. A merged cell's text is in its top left cell. */
  cells: string[][];
  /** Blocks of cells merged into one, each at least two cells and none overlapping. */
  merges?: TableRegion[];
  /** What each formatted cell has of its own, keyed `"row,col"`; a merged cell's is under its top left cell. Cells not here take the table's look. */
  formats?: Record<string, CellFormat>;
}

/** The text settings a cell can have of its own, over the table's, and a background. */
export interface CellFormat {
  fontFamily?: MarkupStyle['fontFamily'];
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  textColor?: string;
  textAlign?: MarkupStyle['textAlign'];
  verticalAlign?: MarkupStyle['verticalAlign'];
  /** Background of the cell. */
  fill?: string;
}

/** What a cell's format can set, and the kind of value each takes. */
const FORMAT_FIELDS: Record<keyof CellFormat, 'string' | 'number' | 'boolean'> = {
  fontFamily: 'string',
  fontSize: 'number',
  bold: 'boolean',
  italic: 'boolean',
  underline: 'boolean',
  textColor: 'string',
  textAlign: 'string',
  verticalAlign: 'string',
  fill: 'string',
};

/** The settings of a cell's format that are text style, which a markup's style also has. */
export const CELL_STYLE_KEYS = ['fontFamily', 'fontSize', 'bold', 'italic', 'underline', 'textColor', 'textAlign', 'verticalAlign'] as const satisfies readonly (keyof CellFormat)[];

/** A block of cells: its top left cell and how many rows and columns it covers. */
export interface TableRegion {
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
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
  const merges = cleanMerges(t.merges, rows.length, cols.length);
  const formats = cleanFormats(t.formats, rows.length, cols.length);
  return { cols, rows, cells, ...(merges.length ? { merges } : {}), ...(formats ? { formats } : {}) };
}

/** The cell formats that are at cells of the grid and say something valid; undefined when none are left. */
function cleanFormats(raw: unknown, rows: number, cols: number): Record<string, CellFormat> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const out: Record<string, CellFormat> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const [row, col] = key.split(',').map(Number);
    if (!Number.isInteger(row) || !Number.isInteger(col) || row! < 0 || col! < 0 || row! >= rows || col! >= cols || !value || typeof value !== 'object') continue;
    const format: Record<string, unknown> = {};
    for (const [field, kind] of Object.entries(FORMAT_FIELDS)) {
      const v = (value as Record<string, unknown>)[field];
      if (typeof v === kind && (kind !== 'number' || (v as number) > 0)) format[field] = v;
    }
    if (Object.keys(format).length) out[key] = format as CellFormat;
  }
  return Object.keys(out).length ? out : undefined;
}

const whole = (n: unknown): number => (typeof n === 'number' && Number.isInteger(n) ? n : -1);

/** The merges that fit the grid, without overlaps; damaged or one-cell ones are dropped. */
function cleanMerges(raw: unknown, rows: number, cols: number): TableRegion[] {
  if (!Array.isArray(raw)) return [];
  const taken = new Set<number>();
  const out: TableRegion[] = [];
  for (const g of raw as Partial<TableRegion>[]) {
    const row = whole(g?.row);
    const col = whole(g?.col);
    if (row < 0 || col < 0 || row >= rows || col >= cols) continue;
    const rowSpan = Math.min(whole(g?.rowSpan), rows - row);
    const colSpan = Math.min(whole(g?.colSpan), cols - col);
    if (rowSpan < 1 || colSpan < 1 || rowSpan * colSpan < 2) continue;
    const keys = Array.from({ length: rowSpan * colSpan }, (_, i) => (row + Math.floor(i / colSpan)) * MAX_TABLE_LINES + col + (i % colSpan));
    if (keys.some((k) => taken.has(k))) continue;
    for (const k of keys) taken.add(k);
    out.push({ row, col, rowSpan, colSpan });
  }
  return out;
}

const within = (g: TableRegion, row: number, col: number) => row >= g.row && row < g.row + g.rowSpan && col >= g.col && col < g.col + g.colSpan;

/** The block of cells (a merge, or the one cell) that holds this cell. */
export function tableRegion(t: Pick<TableData, 'merges'>, row: number, col: number): TableRegion {
  return t.merges?.find((g) => within(g, row, col)) ?? { row, col, rowSpan: 1, colSpan: 1 };
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

/** The box of a block of cells. */
export function tableRegionRect(m: Pick<Markup, 'points' | 'table'>, g: TableRegion): Rect {
  const { xs, ys } = tableGrid(m);
  const x0 = xs[g.col] ?? xs[0]!;
  const y0 = ys[g.row] ?? ys[0]!;
  return { x: x0, y: y0, w: (xs[g.col + g.colSpan] ?? x0) - x0, h: (ys[g.row + g.rowSpan] ?? y0) - y0 };
}

/** The box of one cell; a merged cell's box covers all it merges, whichever of its cells is asked for. */
export function tableCellRect(m: Pick<Markup, 'points' | 'table'>, row: number, col: number): Rect {
  return tableRegionRect(m, tableRegion(tableOf(m), row, col));
}

/** The grid column or row a position falls in; a position on a line belongs to the one after it. */
function slot(lines: number[], v: number): number {
  let i = 0;
  while (i < lines.length - 2 && v >= lines[i + 1]!) i++;
  return i;
}

/** The cell under a page point, or null outside the table. A point on a line belongs to the cell after it; in a merged cell it is the top left cell. */
export function tableCellAt(m: Pick<Markup, 'points' | 'table'>, p: Point): { row: number; col: number } | null {
  const b = boundsOf(m.points);
  if (p[0] < b.x || p[0] > b.x + b.w || p[1] < b.y || p[1] > b.y + b.h) return null;
  const { xs, ys } = tableGrid(m);
  const g = tableRegion(tableOf(m), slot(ys, p[1]), slot(xs, p[0]));
  return { row: g.row, col: g.col };
}

const formatKey = (row: number, col: number) => `${row},${col}`;

/** What one cell has of its own over the table's look (a merged cell's is its top left cell's). */
export function tableCellFormat(m: Pick<Markup, 'table'>, row: number, col: number): CellFormat {
  const t = tableOf(m);
  const g = tableRegion(t, row, col);
  return t.formats?.[formatKey(g.row, g.col)] ?? {};
}

/** A style with a cell's own text settings over it. */
function styleWith(style: MarkupStyle, format: CellFormat): MarkupStyle {
  const own = Object.fromEntries(CELL_STYLE_KEYS.flatMap((k) => (format[k] === undefined ? [] : [[k, format[k]]])));
  return { ...style, ...own };
}

/** The style a cell's text is drawn in: the table's, with what the cell sets of its own over it. */
export function tableCellStyle(m: Pick<Markup, 'style' | 'table'>, row: number, col: number): MarkupStyle {
  return styleWith(m.style, tableCellFormat(m, row, col));
}

/** The cells of a table with their boxes, text and text style, row by row. A merged cell is one, at its top left. */
export function tableCells(m: Pick<Markup, 'points' | 'table' | 'style'>): { row: number; col: number; rect: Rect; text: string; style: MarkupStyle; fill?: string }[] {
  const t = tableOf(m);
  const { xs, ys } = tableGrid(m);
  return t.rows.flatMap((_, row) =>
    t.cols.flatMap((__, col) => {
      const g = tableRegion(t, row, col);
      if (g.row !== row || g.col !== col) return [];
      const format = t.formats?.[formatKey(row, col)] ?? {};
      const x = xs[g.col]!;
      const y = ys[g.row]!;
      const rect = { x, y, w: xs[g.col + g.colSpan]! - x, h: ys[g.row + g.rowSpan]! - y };
      return [{ row, col, rect, text: t.cells[row]![col]!, style: styleWith(m.style, format), ...(format.fill ? { fill: format.fill } : {}) }];
    }),
  );
}

/**
 * The table with `patch` set on every cell in `range` (a merged cell once); a field set to undefined
 * goes back to the table's. Formats left saying nothing are dropped.
 */
export function formatTableCells(m: Pick<Markup, 'table'>, range: TableRegion, patch: Partial<CellFormat>): TableData {
  const t = tableOf(m);
  const formats: Record<string, CellFormat> = { ...t.formats };
  for (let row = range.row; row < range.row + range.rowSpan; row++) {
    for (let col = range.col; col < range.col + range.colSpan; col++) {
      const g = tableRegion(t, row, col);
      if (g.row !== row || g.col !== col) continue;
      const next: Record<string, unknown> = { ...formats[formatKey(row, col)] };
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) delete next[k];
        else next[k] = v;
      }
      if (Object.keys(next).length) formats[formatKey(row, col)] = next as CellFormat;
      else delete formats[formatKey(row, col)];
    }
  }
  return withFormats(t, formats);
}

/** The table with these settings taken off every cell (what changing the whole table's text style does), or its cells' formats cleared when no keys are given. */
export function clearTableFormats(m: Pick<Markup, 'table'>, keys?: readonly (keyof CellFormat)[], range?: TableRegion): TableData {
  const t = tableOf(m);
  const formats: Record<string, CellFormat> = {};
  for (const [key, format] of Object.entries(t.formats ?? {})) {
    const [row, col] = key.split(',').map(Number) as [number, number];
    const inside = !range || (row >= range.row && row < range.row + range.rowSpan && col >= range.col && col < range.col + range.colSpan);
    if (!inside) formats[key] = format;
    else if (keys) {
      const rest: Record<string, unknown> = { ...format };
      for (const k of keys) delete rest[k];
      if (Object.keys(rest).length) formats[key] = rest as CellFormat;
    }
  }
  return withFormats(t, formats);
}

/** The table with `formats` set, or without the key when there are none. */
function withFormats(t: TableData, formats: Record<string, CellFormat>): TableData {
  const { formats: _, ...rest } = t;
  return Object.keys(formats).length ? { ...rest, formats } : rest;
}

/** Cell formats after cells move: `to` says where the cell at a row and column goes, or null when it is gone. */
function remapFormats(formats: Record<string, CellFormat> | undefined, to: (row: number, col: number) => [number, number] | null): Record<string, CellFormat> {
  const out: Record<string, CellFormat> = {};
  for (const [key, format] of Object.entries(formats ?? {})) {
    const [row, col] = key.split(',').map(Number) as [number, number];
    const at = to(row, col);
    if (at) out[formatKey(at[0], at[1])] = format;
  }
  return out;
}

/** Whether two cells are parts of one merged cell. */
function joined(t: Pick<TableData, 'merges'>, r1: number, c1: number, r2: number, c2: number): boolean {
  const g = tableRegion(t, r1, c1);
  return g.rowSpan * g.colSpan > 1 && within(g, r2, c2);
}

/** The grid lines between rows and columns as segments `[x1, y1, x2, y2]`, leaving out the stretches inside merged cells. */
export function tableLines(m: Pick<Markup, 'points' | 'table'>): [number, number, number, number][] {
  const t = tableOf(m);
  const { xs, ys } = tableGrid(m);
  const out: [number, number, number, number][] = [];
  for (let i = 1; i < t.cols.length; i++) {
    let from = -1;
    for (let r = 0; r <= t.rows.length; r++) {
      const open = r < t.rows.length && !joined(t, r, i - 1, r, i);
      if (open && from < 0) from = r;
      else if (!open && from >= 0) {
        out.push([xs[i]!, ys[from]!, xs[i]!, ys[r]!]);
        from = -1;
      }
    }
  }
  for (let j = 1; j < t.rows.length; j++) {
    let from = -1;
    for (let c = 0; c <= t.cols.length; c++) {
      const open = c < t.cols.length && !joined(t, j - 1, c, j, c);
      if (open && from < 0) from = c;
      else if (!open && from >= 0) {
        out.push([xs[from]!, ys[j]!, xs[c]!, ys[j]!]);
        from = -1;
      }
    }
  }
  return out;
}

/** A grid line that can be dragged: `line` is the column or row it lies before, so it divides `line - 1` from `line`. */
export interface TableLine {
  axis: 'col' | 'row';
  line: number;
}

/** The inner grid line within `tol` of a page point (the nearer one at a crossing), or null. Stretches inside merged cells are not lines. */
export function tableLineAt(m: Pick<Markup, 'points' | 'table'>, p: Point, tol: number): TableLine | null {
  const b = boundsOf(m.points);
  if (p[0] < b.x - tol || p[0] > b.x + b.w + tol || p[1] < b.y - tol || p[1] > b.y + b.h + tol) return null;
  const t = tableOf(m);
  const { xs, ys } = tableGrid(m);
  const row = slot(ys, Math.min(Math.max(p[1], b.y), b.y + b.h));
  const col = slot(xs, Math.min(Math.max(p[0], b.x), b.x + b.w));
  let best: (TableLine & { d: number }) | null = null;
  for (let i = 1; i < t.cols.length; i++) {
    const d = Math.abs(p[0] - xs[i]!);
    if (d <= tol && p[1] >= b.y && p[1] <= b.y + b.h && !joined(t, row, i - 1, row, i) && (!best || d < best.d)) best = { axis: 'col', line: i, d };
  }
  for (let j = 1; j < t.rows.length; j++) {
    const d = Math.abs(p[1] - ys[j]!);
    if (d <= tol && p[0] >= b.x && p[0] <= b.x + b.w && !joined(t, j - 1, col, j, col) && (!best || d < best.d)) best = { axis: 'row', line: j, d };
  }
  return best && { axis: best.axis, line: best.line };
}

/** Smallest a row or column can be dragged to, in page units. */
export const MIN_TABLE_LINE = 4;

/**
 * The grid with a line dragged to page position `to` (x for a column line, y for a row line). The
 * two columns or rows either side of it trade space, so the table keeps its size. Null when it cannot move.
 */
export function moveTableLine(m: Pick<Markup, 'points' | 'table'>, { axis, line }: TableLine, to: number, min = MIN_TABLE_LINE): TableData | null {
  const t = tableOf(m);
  const { xs, ys } = tableGrid(m);
  const lines = axis === 'col' ? xs : ys;
  const shares = axis === 'col' ? t.cols : t.rows;
  const length = lines[lines.length - 1]! - lines[0]!;
  if (line < 1 || line >= shares.length || !(length > 0) || !Number.isFinite(to)) return null;
  const lo = lines[line - 1]! + min;
  const hi = lines[line + 1]! - min;
  if (lo > hi) return null;
  const at = Math.min(Math.max(to, lo), hi);
  const k = sum(shares) / length;
  const next = [...shares];
  next[line - 1] = (at - lines[line - 1]!) * k;
  next[line] = (lines[line + 1]! - at) * k;
  return axis === 'col' ? { ...t, cols: next } : { ...t, rows: next };
}

const covers = (outer: TableRegion, g: TableRegion) => g.row >= outer.row && g.row + g.rowSpan <= outer.row + outer.rowSpan && g.col >= outer.col && g.col + g.colSpan <= outer.col + outer.colSpan;

/** The block of cells between two corner cells, grown to take in every merged cell it touches. */
export function tableRange(m: Pick<Markup, 'table'>, a: { row: number; col: number }, b: { row: number; col: number }): TableRegion {
  const t = tableOf(m);
  const clamp = (n: number, size: number) => Math.min(Math.max(0, n), size - 1);
  const r0 = clamp(Math.min(a.row, b.row), t.rows.length);
  const c0 = clamp(Math.min(a.col, b.col), t.cols.length);
  const r1 = clamp(Math.max(a.row, b.row), t.rows.length);
  const c1 = clamp(Math.max(a.col, b.col), t.cols.length);
  let range: TableRegion = { row: r0, col: c0, rowSpan: r1 - r0 + 1, colSpan: c1 - c0 + 1 };
  for (let grew = true; grew; ) {
    grew = false;
    for (const g of t.merges ?? []) {
      const touches = g.row < range.row + range.rowSpan && g.row + g.rowSpan > range.row && g.col < range.col + range.colSpan && g.col + g.colSpan > range.col;
      if (!touches || covers(range, g)) continue;
      const row = Math.min(range.row, g.row);
      const col = Math.min(range.col, g.col);
      range = { row, col, rowSpan: Math.max(range.row + range.rowSpan, g.row + g.rowSpan) - row, colSpan: Math.max(range.col + range.colSpan, g.col + g.colSpan) - col };
      grew = true;
    }
  }
  return range;
}

/**
 * The table with the cells between two corner cells merged into one, which keeps all their text
 * (a line for each cell that has some, top to bottom). Null when that is a single cell.
 */
export function mergeTableCells(m: Pick<Markup, 'table'>, a: { row: number; col: number }, b: { row: number; col: number }): TableData | null {
  const t = tableOf(m);
  const r = tableRange(m, a, b);
  if (r.rowSpan * r.colSpan < 2 || t.merges?.some((g) => g.row === r.row && g.col === r.col && g.rowSpan === r.rowSpan && g.colSpan === r.colSpan)) return null;
  const text: string[] = [];
  const cells = t.cells.map((line, row) =>
    line.map((cell, col) => {
      if (!within(r, row, col)) return cell;
      if (cell) text.push(cell);
      return '';
    }),
  );
  cells[r.row]![r.col] = text.join('\n');
  // Only the merged cell's first cell keeps a format of its own.
  const formats = remapFormats(t.formats, (row, col) => (within(r, row, col) && (row !== r.row || col !== r.col) ? null : [row, col]));
  return withFormats({ ...t, cells, merges: [...(t.merges ?? []).filter((g) => !covers(r, g)), r] }, formats);
}

/** The table with the merged cell holding this cell split back into single cells, its text staying in the first. Null when it is not merged. */
export function splitTableCell(m: Pick<Markup, 'table'>, row: number, col: number): TableData | null {
  const t = tableOf(m);
  const g = t.merges?.find((x) => within(x, row, col));
  return g ? withMerges(t, t.merges!.filter((x) => x !== g)) : null;
}

/** The table with `merges` set, or without the key when there are none. */
function withMerges(t: TableData, merges: TableRegion[]): TableData {
  const { merges: _, ...rest } = t;
  return merges.length ? { ...rest, merges } : rest;
}

type Axis = 'row' | 'col';

/** Merges after a row or column is inserted before `at`: ones it falls inside grow, ones after it move on. */
function mergesAfterInsert(merges: TableRegion[] | undefined, axis: Axis, at: number): TableRegion[] {
  return (merges ?? []).map((g) => {
    const [pos, span] = axis === 'row' ? [g.row, g.rowSpan] : [g.col, g.colSpan];
    if (at <= pos) return axis === 'row' ? { ...g, row: g.row + 1 } : { ...g, col: g.col + 1 };
    if (at < pos + span) return axis === 'row' ? { ...g, rowSpan: g.rowSpan + 1 } : { ...g, colSpan: g.colSpan + 1 };
    return g;
  });
}

/** Merges after a row or column is deleted: ones it was part of shrink (and go at one cell), ones after it move back. */
function mergesAfterDelete(merges: TableRegion[] | undefined, axis: Axis, at: number): TableRegion[] {
  return (merges ?? [])
    .map((g) => {
      const [pos, span] = axis === 'row' ? [g.row, g.rowSpan] : [g.col, g.colSpan];
      if (at < pos) return axis === 'row' ? { ...g, row: g.row - 1 } : { ...g, col: g.col - 1 };
      if (at < pos + span) return axis === 'row' ? { ...g, rowSpan: g.rowSpan - 1 } : { ...g, colSpan: g.colSpan - 1 };
      return g;
    })
    .filter((g) => g.rowSpan * g.colSpan > 1);
}

/** A cell as a text box, so its text is laid out and drawn like any other. */
export function tableCellText(m: Markup, cell: { rect: Rect; text: string; style?: MarkupStyle }): Markup {
  const { x, y, w, h } = cell.rect;
  return { ...m, type: 'text', points: [[x, y], [x + w, y + h]], text: cell.text, style: cell.style ?? m.style, rotation: undefined };
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
  return { points: resizedTo(m, b.w, (b.h * sum(rows)) / sum(t.rows)), table: withMerges(withFormats({ ...t, rows, cells }, remapFormats(t.formats, (r, c) => [r >= at ? r + 1 : r, c])), mergesAfterInsert(t.merges, 'row', at)) };
}

/** The table without row `row`, the box shrinking by its height. Null when it is the only row. */
export function deleteTableRow(m: Pick<Markup, 'points' | 'table'>, row: number): TableEdit | null {
  const t = tableOf(m);
  if (t.rows.length <= 1 || row < 0 || row >= t.rows.length) return null;
  const b = boundsOf(m.points);
  const rows = t.rows.filter((_, i) => i !== row);
  // A merged cell that began in this row begins in the next one, taking its text along.
  const carried = t.cells.map((line) => [...line]);
  const carriedFormats = { ...t.formats };
  for (const g of t.merges ?? []) {
    if (g.row !== row || g.rowSpan < 2) continue;
    carried[row + 1]![g.col] = carried[row]![g.col]!;
    const own = t.formats?.[formatKey(row, g.col)];
    if (own) carriedFormats[formatKey(row + 1, g.col)] = own;
  }
  const formats = remapFormats(carriedFormats, (r, c) => (r === row ? null : [r > row ? r - 1 : r, c]));
  return { points: resizedTo(m, b.w, (b.h * sum(rows)) / sum(t.rows)), table: withMerges(withFormats({ ...t, rows, cells: carried.filter((_, i) => i !== row) }, formats), mergesAfterDelete(t.merges, 'row', row)) };
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
  return { points: resizedTo(m, (b.w * sum(cols)) / sum(t.cols), b.h), table: withMerges(withFormats({ ...t, cols, cells }, remapFormats(t.formats, (r, c) => [r, c >= at ? c + 1 : c])), mergesAfterInsert(t.merges, 'col', at)) };
}

/** The table without column `col`, the box shrinking by its width. Null when it is the only column. */
export function deleteTableColumn(m: Pick<Markup, 'points' | 'table'>, col: number): TableEdit | null {
  const t = tableOf(m);
  if (t.cols.length <= 1 || col < 0 || col >= t.cols.length) return null;
  const b = boundsOf(m.points);
  const cols = t.cols.filter((_, i) => i !== col);
  const carried = t.cells.map((line) => [...line]);
  const carriedFormats = { ...t.formats };
  for (const g of t.merges ?? []) {
    if (g.col !== col || g.colSpan < 2) continue;
    carried[g.row]![col + 1] = carried[g.row]![col]!;
    const own = t.formats?.[formatKey(g.row, col)];
    if (own) carriedFormats[formatKey(g.row, col + 1)] = own;
  }
  const formats = remapFormats(carriedFormats, (r, c) => (c === col ? null : [r, c > col ? c - 1 : c]));
  return { points: resizedTo(m, (b.w * sum(cols)) / sum(t.cols), b.h), table: withMerges(withFormats({ ...t, cols, cells: carried.map((r) => r.filter((_, i) => i !== col)) }, formats), mergesAfterDelete(t.merges, 'col', col)) };
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
