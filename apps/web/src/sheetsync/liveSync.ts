import type { ExcelLiveOptions, ExcelRead } from '../desktop/host';
import { NO, YES, replyIndex, type SyncColumn, type SyncTable } from './keyed';
import { mergeWorkbook, onByDefault, type CellChange } from './merge';
import { buildSyncSheets, readSnapshot } from './syncWorkbook';
import type { TableCell } from './table';
import { HIDDEN_SHEET, excelSerial, type SheetSpec } from './xlsx';
import { readWorkbook, type CellValue, type ReadWorkbook } from './xlsxRead';

/**
 * One cycle of two-way Sync to Excel: read what Excel has, merge it with the document, and work out
 * what to write back. Pure: the hook does the reading, applying and writing.
 *
 * Edits typed in Excel are applied to the document. A cell changed on both sides is a conflict: it
 * is left as it is in Excel, shown in the sync window, and stays that way until the person picks a
 * side. Rows keep the order they have in Excel, so a sorted sheet stays sorted.
 */

/** What the desktop app read, as a workbook: the saved file, or the cells of the workbook open in Excel. Null when there is none yet. */
export async function bookFromRead(read: ExcelRead): Promise<ReadWorkbook | null> {
  if (read.kind === 'none') return null;
  if (read.kind === 'file') return readWorkbook(read.bytes);
  return { date1904: false, sheets: read.sheets.map((s) => ({ name: s.name, state: s.name === HIDDEN_SHEET ? ('veryHidden' as const) : ('visible' as const), rows: s.rows, dates: new Set<string>() })) };
}

export interface SyncIssue {
  /** `<row key>\n<column key>`. */
  id: string;
  rowKey: string;
  column: SyncColumn;
  /**
   * `conflict`: changed in Excel and in the document. `replyEdit`: an earlier reply rewritten in
   * Excel. `unknown`: a value the column does not take. `blocked`: the document did not take the
   * change (someone else's markup, or a read-only document).
   */
  kind: 'conflict' | 'replyEdit' | 'unknown' | 'blocked';
  /** The document's value and Excel's, as text. */
  mine: string;
  theirs: string;
  /** The change that taking Excel's value makes; absent when Excel's value cannot be taken. */
  change?: CellChange;
}

export interface CyclePlan {
  /** Changes typed in Excel to apply to the document now. When there are any, nothing is written this cycle: the document changes first. */
  apply: CellChange[];
  issues: SyncIssue[];
  /** The visible sheet and the hidden one, as they should be after this cycle. */
  sheets: SheetSpec[];
  /** Excel already holds exactly these sheets: nothing to write. */
  upToDate: boolean;
}

export interface CycleOptions {
  sheet: string;
  docId: string;
  exportedAt: string;
  /** Changes already tried (`changeId`): one that is still there was not taken by the document. */
  attempted: ReadonlySet<string>;
  /** Issues answered "use redcolumn's value" (issue ids): written over Excel's value this cycle. */
  forced: ReadonlySet<string>;
}

export const issueId = (rowKey: string, columnKey: string) => `${rowKey}\n${columnKey}`;
/** A change and the value it sets, so the same edit is not tried twice but a new one is. */
export const changeId = (c: CellChange) => `${c.rowKey}\n${c.column.key}\n${c.to}`;

/** A compared value as the cell Excel should show. */
function cellFor(col: SyncColumn, value: string): TableCell {
  if (col.kind === 'check') return value === 'true' ? YES : NO;
  if (col.kind === 'number') return value === '' || !Number.isFinite(Number(value)) ? value : Number(value);
  return value;
}

const norm = (rows: readonly (readonly (CellValue | TableCell)[])[]) => {
  const out = rows.map((row) => {
    const cells = row.map((v) => (v === null ? '' : v));
    while (cells.length && cells[cells.length - 1] === '') cells.pop();
    return cells;
  });
  while (out.length && !out[out.length - 1]!.length) out.pop();
  return JSON.stringify(out);
};

/** The cells a sheet spec writes, dates as the serial numbers Excel holds. */
const written = (spec: SheetSpec) => spec.table;

/** Works out one cycle. `book` is what Excel has now (null when the workbook does not exist yet); `table` is the document. */
export function planCycle(book: ReadWorkbook | null, table: SyncTable, opts: CycleOptions): CyclePlan {
  const snap = book ? readSnapshot(book) : null;
  // Only a sheet this document wrote is merged. Anything else (an older one-way sheet, another document's) is written over, as before.
  const result = book && snap && snap.docId === opts.docId ? mergeWorkbook(book, table, { docId: opts.docId }) : null;
  const apply: CellChange[] = [];
  const issues: SyncIssue[] = [];
  const keep = new Map<string, Map<string, { cell: TableCell; base: string }>>();
  const hold = (rowKey: string, col: SyncColumn, cell: TableCell) => {
    const base = snap?.rows.get(rowKey)?.values.get(col.key) ?? '';
    keep.set(rowKey, (keep.get(rowKey) ?? new Map()).set(col.key, { cell, base }));
  };
  if (result && !result.noTable) {
    for (const c of result.changes) {
      const id = issueId(c.rowKey, c.column.key);
      if (opts.forced.has(id)) continue;
      const firm = c.via === 'key' || c.via === 'hidden';
      if (firm && onByDefault(c) && !opts.attempted.has(changeId(c))) {
        apply.push(c);
        continue;
      }
      const kind = c.kind === 'conflict' ? 'conflict' : c.kind === 'replyEdit' ? 'replyEdit' : 'blocked';
      issues.push({ id, rowKey: c.rowKey, column: c.column, kind, mine: c.from, theirs: c.to, ...(kind === 'blocked' ? {} : { change: c }) });
      hold(c.rowKey, c.column, c.column.kind === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(c.to) ? excelSerial(Date.parse(`${c.to}T00:00:00Z`)) : cellFor(c.column, c.to));
    }
    const index = new Map(table.columns.map((c, i) => [c.key, i]));
    const rowOf = new Map(table.rows.map((r) => [r.key, r]));
    for (const u of result.unknown) {
      for (const m of u.rows) {
        const id = issueId(m.key, u.column.key);
        if (opts.forced.has(id)) continue;
        const mine = rowOf.get(m.key)?.cells[index.get(u.column.key) ?? -1];
        issues.push({ id, rowKey: m.key, column: u.column, kind: 'unknown', mine: mine === undefined ? '' : String(mine), theirs: u.value });
        hold(m.key, u.column, u.value);
      }
    }
  }
  // Rows in the order Excel has them; markups it does not have yet go at the end.
  const order = new Map((result?.matched ?? []).map((m, i) => [m.key, i]));
  const rows = [...table.rows].sort((a, b) => (order.get(a.key) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.key) ?? Number.MAX_SAFE_INTEGER));
  const sheets = buildSyncSheets({ columns: table.columns, rows }, { sheet: opts.sheet, docId: opts.docId, exportedAt: snap?.docId === opts.docId ? snap.exportedAt : opts.exportedAt, keep });
  const has = (name: string) => book?.sheets.find((s) => s.name === name)?.rows;
  const upToDate = !!book && sheets.every((s) => {
    const rows = has(s.name);
    return !!rows && norm(rows) === norm(written(s));
  });
  return { apply, issues, sheets, upToDate };
}

/** The dropdowns and checks of the visible sheet, in the form the desktop app sets them on an open workbook. */
export function liveOptions(visible: SheetSpec, stamp: string | undefined): ExcelLiveOptions {
  return {
    ...(stamp ? { stamp } : {}),
    hideKey: true,
    text: true,
    hidden: [HIDDEN_SHEET],
    validations: (visible.validations ?? []).map((v) => (v.kind === 'list' ? { col: v.column + 1, type: 'list' as const, formula: `=${v.source}` } : { col: v.column + 1, type: v.kind })),
  };
}

/** Whether a column is a thread column (a reply is added, not a value set). */
export const isThread = (col: SyncColumn) => replyIndex(col.key) !== null;
