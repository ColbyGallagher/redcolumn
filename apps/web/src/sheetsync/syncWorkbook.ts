import { NO, YES, canonOwn, replyIndex, type SyncColumn, type SyncTable } from './keyed';
import type { TableCell } from './table';
import { HIDDEN_SHEET, excelSerial, listRange, type LooseCell, type SheetSpec, type SheetValidation, type XlsxNumberFormat } from './xlsx';
import { findSheet, type CellValue, type ReadWorkbook } from './xlsxRead';

/**
 * A keyed table as the sheets of a workbook, and the way back.
 *
 * The visible sheet has a hidden first column holding each row's key. The very hidden `_redcolumn`
 * sheet holds what was exported: which document and when, the columns, and per row its key, its
 * Item No and the value of every editable cell. That copy is the base of the three-way merge on
 * import, and it survives sorting, filtering and deleted columns on the visible sheet. The lists
 * that validation offers live on the same sheet, to the right of the rows.
 */

/** Header of the hidden key column. Rows are found by it, so it is not a name a list column would have. */
export const KEY_LABEL = 'redcolumn key';
const MARK = 'redcolumn-sync';
const VERSION = 1;
/** Rows of the hidden sheet above the first exported row: what was exported, column keys, column labels. */
const HEAD_ROWS = 3;
/** Columns of the hidden sheet before the first column's value: the row key and the Item No. */
const LEAD_COLS = 2;

export interface SyncSheetOptions {
  /** The visible sheet's name. */
  sheet: string;
  /** Identifies the document, so a workbook is not imported into another one. */
  docId: string;
  /** When the export was made (ISO). */
  exportedAt: string;
  /** Where the header row's first cell goes. The hidden key column takes that place; the list's columns follow it. */
  origin?: { row: number; col: number };
  /** Cells outside the table, such as a project name above a register. */
  cells?: readonly LooseCell[];
  /** Locks every cell but those of the editable columns. A password is optional. */
  protect?: { password?: string };
}

/** A column people read a paragraph in: it wraps and gets a set width. */
const isLong = (c: SyncColumn) => c.key === 'comment' || replyIndex(c.key) !== null;

function shown(col: SyncColumn, cell: TableCell): TableCell {
  if (col.edit === 'editable' && col.kind === 'date' && typeof cell === 'string') {
    const ms = /^\d{4}-\d{2}-\d{2}$/.test(cell) ? Date.parse(`${cell}T00:00:00Z`) : Number.NaN;
    return Number.isNaN(ms) ? cell : excelSerial(ms);
  }
  return cell;
}

/** The visible sheet and the hidden one, in that order. */
export function buildSyncSheets(table: SyncTable, opts: SyncSheetOptions): SheetSpec[] {
  const cols = table.columns;
  const editable = cols.map((c) => c.edit === 'editable');
  const base: TableCell[][] = [
    [MARK, VERSION, opts.docId, opts.exportedAt, opts.sheet, opts.origin?.row ?? 0, opts.origin?.col ?? 0, cols.length, table.rows.length],
    ['key', 'itemNo', ...cols.map((c) => c.key)],
    [KEY_LABEL, '', ...cols.map((c) => c.label)],
    ...table.rows.map((r): TableCell[] => [r.key, r.match?.itemNo ?? '', ...cols.map((c, i) => (editable[i] && !r.locked ? canonOwn(c, r.cells[i] ?? '') : ''))]),
  ];
  // Validation lists, one column each, after a gap to the right of the rows.
  const validations: SheetValidation[] = [];
  let listCol = LEAD_COLS + cols.length + 1;
  const put = (r: number, c: number, v: TableCell) => {
    while (base.length <= r) base.push([]);
    const row = base[r]!;
    while (row.length < c) row.push('');
    row[c] = v;
  };
  cols.forEach((c, i) => {
    if (!editable[i]) return;
    const column = i + 1;
    const options = c.kind === 'check' ? [YES, NO] : c.kind === 'choice' ? (c.options ?? []) : [];
    if (options.length) {
      put(1, listCol, `list:${c.key}`);
      options.forEach((o, n) => put(HEAD_ROWS + n, listCol, o));
      const names = options.join(', ');
      validations.push({ column, kind: 'list', source: listRange(HIDDEN_SHEET, listCol, HEAD_ROWS, options.length), message: `${c.label} is one of: ${names}`.slice(0, 250) });
      listCol++;
    } else if (c.kind === 'date') validations.push({ column, kind: 'date', message: `${c.label} is a date.` });
    else if (c.kind === 'number') validations.push({ column, kind: 'number', message: `${c.label} is a number.` });
  });
  const formats: (XlsxNumberFormat | undefined)[] = [undefined, ...cols.map((c, i) => (editable[i] && c.kind === 'date' ? ('date' as const) : undefined))];
  const long = new Set(cols.flatMap((c, i) => (isLong(c) ? [i + 1] : [])));
  const visible: SheetSpec = {
    name: opts.sheet,
    table: [[KEY_LABEL, ...cols.map((c) => c.label)], ...table.rows.map((r) => [r.key, ...cols.map((c, i) => shown(c, r.cells[i] ?? ''))])],
    formats,
    hiddenColumns: new Set([0]),
    wrap: long,
    widths: [undefined, ...cols.map((c) => (isLong(c) ? 50 : undefined))],
    validations,
    ...(opts.origin ? { origin: opts.origin } : {}),
    ...(opts.cells ? { cells: opts.cells } : {}),
    ...(opts.protect ? { protection: { ...(opts.protect.password ? { password: opts.protect.password } : {}), unlocked: new Set(editable.flatMap((e, i) => (e ? [i + 1] : []))) } } : {}),
  };
  return [visible, { name: HIDDEN_SHEET, state: 'veryHidden', filter: false, table: base }];
}

/** What the hidden sheet says was exported. */
export interface Snapshot {
  docId: string;
  exportedAt: string;
  /** The visible sheet's name, and where its header row was. */
  sheet: string;
  headerRow: number;
  firstCol: number;
  columns: { key: string; label: string }[];
  /** Per row key: its Item No and the exported value of each column, by column key. */
  rows: Map<string, { itemNo: number | null; values: Map<string, string> }>;
}

const text = (v: CellValue | undefined) => (v === null || v === undefined ? '' : String(v));

/** Reads the hidden sheet, or null when the workbook has none this app wrote (it was copied into another file, say). */
export function readSnapshot(book: ReadWorkbook): Snapshot | null {
  const sheet = findSheet(book, HIDDEN_SHEET);
  const meta = sheet?.rows[0];
  if (!sheet || !meta || meta[0] !== MARK || meta[1] !== VERSION) return null;
  const count = Number(meta[7]);
  const rowCount = Number(meta[8]);
  if (!Number.isInteger(count) || !Number.isInteger(rowCount) || count < 0 || rowCount < 0) return null;
  const keys = sheet.rows[1] ?? [];
  const labels = sheet.rows[2] ?? [];
  const columns = Array.from({ length: count }, (_, i) => ({ key: text(keys[LEAD_COLS + i]), label: text(labels[LEAD_COLS + i]) }));
  const rows: Snapshot['rows'] = new Map();
  for (let r = 0; r < rowCount; r++) {
    const row = sheet.rows[HEAD_ROWS + r] ?? [];
    const key = text(row[0]);
    if (!key) continue;
    const itemNo = typeof row[1] === 'number' ? row[1] : null;
    rows.set(key, { itemNo, values: new Map(columns.map((c, i) => [c.key, text(row[LEAD_COLS + i])])) });
  }
  return { docId: text(meta[2]), exportedAt: text(meta[3]), sheet: text(meta[4]), headerRow: Number(meta[5]) || 0, firstCol: Number(meta[6]) || 0, columns, rows };
}
