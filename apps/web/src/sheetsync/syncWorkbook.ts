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
  /**
   * Cells written as given instead of from the table, with the exported value recorded for them: row
   * key → column key. Live sync uses it to leave a cell alone in Excel (a conflict waiting for an
   * answer) while still writing the rest of the sheet.
   */
  keep?: ReadonlyMap<string, ReadonlyMap<string, { cell: TableCell; base: string }>>;
  /**
   * Where the hidden key column goes: before the columns (the default) or after them. A register puts
   * it last, so the client's columns sit where the client's layout has them.
   */
  keyAt?: 'first' | 'last';
  /** Column widths in characters, per column of the table; a long text column is 50 when none is given. */
  widths?: readonly (number | undefined)[];
  /** How a register's statuses are worded, recorded with the export so it can be read back on a computer without the template. */
  register?: RegisterRecord;
  /**
   * Rows of the sheet that are not the table's and never were: the sign-off block below the table of a
   * client's own file, each as its first cell's text. An import passes over them without a word.
   */
  ignore?: readonly string[];
}

/** What a register export records about its template. */
export interface RegisterRecord {
  templateId: string;
  /** Per status id: the word the register shows for it, and other words that mean it. */
  statuses: { id: string; word: string; also: string[] }[];
}

/** Excel holds 32,767 characters in a cell. */
const MAX_IGNORE = 30_000;

/** The rows to pass over, as one cell: as many as fit. */
function ignoreCell(rows: readonly string[] | undefined): string {
  const kept: string[] = [];
  let size = 2;
  for (const r of new Set(rows ?? [])) {
    const more = JSON.stringify(r).length + 1;
    if (size + more > MAX_IGNORE) break;
    kept.push(r);
    size += more;
  }
  return kept.length ? JSON.stringify(kept) : '';
}

function ignoreRows(value: CellValue | undefined): string[] {
  if (typeof value !== 'string' || !value || value.length > MAX_IGNORE + 100) return [];
  try {
    const v: unknown = JSON.parse(value);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
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
    [MARK, VERSION, opts.docId, opts.exportedAt, opts.sheet, opts.origin?.row ?? 0, opts.origin?.col ?? 0, cols.length, table.rows.length, opts.register ? JSON.stringify(opts.register) : '', ignoreCell(opts.ignore)],
    ['key', 'itemNo', ...cols.map((c) => c.key)],
    [KEY_LABEL, '', ...cols.map((c) => c.label)],
    ...table.rows.map((r): TableCell[] => [r.key, r.match?.itemNo ?? '', ...cols.map((c, i) => opts.keep?.get(r.key)?.get(c.key)?.base ?? (editable[i] && !r.locked ? canonOwn(c, r.cells[i] ?? '') : ''))]),
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
  // The key column is first or last; `off` is how far that moves the table's columns along.
  const last = opts.keyAt === 'last';
  const off = last ? 0 : 1;
  const keyed = <T,>(key: T, rest: T[]): T[] => (last ? [...rest, key] : [key, ...rest]);
  cols.forEach((c, i) => {
    if (!editable[i]) return;
    const column = i + off;
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
  const formats = keyed<XlsxNumberFormat | undefined>(undefined, cols.map((c, i) => (editable[i] && c.kind === 'date' ? ('date' as const) : undefined)));
  const long = new Set(cols.flatMap((c, i) => (isLong(c) ? [i + off] : [])));
  const visible: SheetSpec = {
    name: opts.sheet,
    table: [keyed<TableCell>(KEY_LABEL, cols.map((c) => c.label)), ...table.rows.map((r) => keyed<TableCell>(r.key, cols.map((c, i) => shown(c, opts.keep?.get(r.key)?.get(c.key)?.cell ?? r.cells[i] ?? ''))))],
    formats,
    hiddenColumns: new Set([last ? cols.length : 0]),
    wrap: long,
    widths: keyed<number | undefined>(undefined, cols.map((c, i) => opts.widths?.[i] ?? (isLong(c) ? 50 : undefined))),
    validations,
    ...(opts.origin ? { origin: opts.origin } : {}),
    ...(opts.cells ? { cells: opts.cells } : {}),
    ...(opts.protect ? { protection: { ...(opts.protect.password ? { password: opts.protect.password } : {}), unlocked: new Set(editable.flatMap((e, i) => (e ? [i + off] : []))) } } : {}),
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
  /** Set when the export was a register: its template and status wording. */
  register?: RegisterRecord;
  /** Rows that were below the table when it was written (a sign-off block), each as its first cell's text. */
  ignore: string[];
}

/** The register record as written, or nothing when it is missing or not what this app writes. */
function registerRecord(value: CellValue | undefined): RegisterRecord | undefined {
  if (typeof value !== 'string' || !value || value.length > 100_000) return undefined;
  try {
    const v = JSON.parse(value) as { templateId?: unknown; statuses?: unknown };
    if (typeof v.templateId !== 'string' || !Array.isArray(v.statuses) || v.statuses.length > 200) return undefined;
    const statuses = v.statuses.flatMap((s: { id?: unknown; word?: unknown; also?: unknown }) =>
      typeof s?.id === 'string' && typeof s.word === 'string' ? [{ id: s.id.slice(0, 200), word: s.word.slice(0, 200), also: Array.isArray(s.also) ? s.also.filter((a): a is string => typeof a === 'string').slice(0, 50).map((a) => a.slice(0, 200)) : [] }] : [],
    );
    return { templateId: v.templateId.slice(0, 200), statuses };
  } catch {
    return undefined;
  }
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
  return { docId: text(meta[2]), exportedAt: text(meta[3]), sheet: text(meta[4]), headerRow: Number(meta[5]) || 0, firstCol: Number(meta[6]) || 0, columns, rows, ignore: ignoreRows(meta[10]), ...(registerRecord(meta[9]) ? { register: registerRecord(meta[9])! } : {}) };
}
