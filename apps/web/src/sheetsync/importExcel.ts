import type { MarkupStatusDef } from '@nb/markup';
import type { ListColumn, ListRowData } from '../columns/listColumns';
import { NEW_REPLY, replyColumn, replyIndex, replyKey, responderIndex, toSyncTable, type SyncColumn, type SyncTable } from './keyed';
import { mergeWorkbook, type MergeOptions, type MergeResult } from './merge';
import { registerRecord, registerTable, reword, wording, type RegisterTemplate } from './register';
import { buildSyncSheets, readSnapshot, type RegisterRecord } from './syncWorkbook';
import { buildWorkbook, sheetName } from './xlsx';
import type { ReadWorkbook } from './xlsxRead';

/** The Markups list export that can be imported again, and reading an edited workbook (a list export or a register) back. */

export const NEW_REPLY_LABEL = 'New reply';

export interface ListExport {
  /** The rows and columns to export, as the list shows them. */
  rows: readonly ListRowData[];
  columns: readonly ListColumn[];
  statuses: readonly MarkupStatusDef[];
  docId: string;
  /** When the export is made (ISO). */
  exportedAt: string;
  sheet?: string;
}

/**
 * The Markups list as an .xlsx: the list's rows and columns, a blank New reply column, and the keys
 * and exported values an import needs. The sheet is left unprotected so it can be sorted; dropdowns
 * and date and number checks are set on the columns that have them.
 */
export function exportListWorkbook(e: ListExport): Uint8Array {
  const table = toSyncTable(e.rows, e.columns, { statuses: e.statuses, replyColumns: [replyColumn(NEW_REPLY, NEW_REPLY_LABEL)] });
  return buildWorkbook(buildSyncSheets(table, { sheet: sheetName(e.sheet ?? 'Markups'), docId: e.docId, exportedAt: e.exportedAt }));
}

export interface ImportSource {
  /** Every markup of the document as list rows (not only the ones the list's filters show), reply rows included. */
  rows: readonly ListRowData[];
  /** Every column the document has, shown in the list or not. */
  columns: readonly ListColumn[];
  statuses: readonly MarkupStatusDef[];
  /** The register templates on this computer: a register that has lost its hidden sheet is recognised by its headings. */
  templates?: readonly RegisterTemplate[];
}

/** What importing a workbook would change, and, for a register, its status wording. */
export type ImportPlan = MergeResult & { register?: RegisterRecord };

/** The document as the table an edited workbook is merged into: every column, plus the thread columns the workbook has. */
export function currentTable(book: ReadWorkbook, src: ImportSource): SyncTable {
  const snap = readSnapshot(book);
  const threads: SyncColumn[] = snap ? snap.columns.filter((c) => replyIndex(c.key) !== null || responderIndex(c.key) !== null).map((c) => replyColumn(c.key, c.label)) : [replyColumn(NEW_REPLY, NEW_REPLY_LABEL)];
  const table = toSyncTable(src.rows, src.columns, { statuses: src.statuses, replyColumns: threads });
  return snap?.register ? reword(table, snap.register, src.statuses) : table;
}

/**
 * A responder column says who a new response is from. Its edits are not changes of their own: the
 * name goes onto the reply added from the same row's response column.
 */
function foldResponders(result: MergeResult): MergeResult {
  const names = new Map<string, string>();
  for (const c of result.changes) {
    const n = responderIndex(c.column.key);
    if (n !== null && c.to) names.set(`${c.rowKey}\n${replyKey(n)}`, c.to);
  }
  const changes = result.changes.filter((c) => responderIndex(c.column.key) === null).map((c) => (c.kind === 'replyAdd' && names.has(`${c.rowKey}\n${c.column.key}`) ? { ...c, author: names.get(`${c.rowKey}\n${c.column.key}`)! } : c));
  return { ...result, changes, unknown: result.unknown.filter((u) => responderIndex(u.column.key) === null) };
}

/** What importing the workbook would change. */
export function planImport(book: ReadWorkbook, src: ImportSource, opts: MergeOptions): ImportPlan {
  const snap = readSnapshot(book);
  const merge = (table: SyncTable, record: RegisterRecord | undefined): ImportPlan => {
    // The register's own other words for a status, then the ones mapped in this import.
    const status = record ? { ...wording(record, src.statuses).aliases, ...opts.aliases?.status } : opts.aliases?.status;
    const result = foldResponders(mergeWorkbook(book, table, { ...opts, aliases: { ...opts.aliases, ...(status ? { status } : {}) } }));
    return record ? { ...result, register: record } : result;
  };
  const plain = merge(currentTable(book, src), snap?.register);
  if (snap || !plain.noTable) return plain;
  // No hidden sheet and no list headings: a register copied into another workbook. Its headings say which template it was.
  for (const t of src.templates ?? []) {
    const result = merge(registerTable(src.rows, src.columns, t, src.statuses), registerRecord(t));
    if (!result.noTable) return result;
  }
  return plain;
}
