import type { MarkupStatusDef } from '@nb/markup';
import type { ListColumn, ListRowData } from '../columns/listColumns';
import { NEW_REPLY, replyColumn, replyIndex, toSyncTable, type SyncColumn, type SyncTable } from './keyed';
import { mergeWorkbook, type MergeOptions, type MergeResult } from './merge';
import { buildSyncSheets, readSnapshot } from './syncWorkbook';
import { buildWorkbook, sheetName } from './xlsx';
import type { ReadWorkbook } from './xlsxRead';

/** The Markups list export that can be imported again, and reading an edited one back. */

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
}

/** The document as the table an edited workbook is merged into: every column, plus the thread columns the workbook has. */
export function currentTable(book: ReadWorkbook, src: ImportSource): SyncTable {
  const snap = readSnapshot(book);
  const threads: SyncColumn[] = snap ? snap.columns.filter((c) => replyIndex(c.key) !== null).map((c) => replyColumn(c.key, c.label)) : [replyColumn(NEW_REPLY, NEW_REPLY_LABEL)];
  return toSyncTable(src.rows, src.columns, { statuses: src.statuses, replyColumns: threads });
}

/** What importing the workbook would change. */
export function planImport(book: ReadWorkbook, src: ImportSource, opts: MergeOptions): MergeResult {
  return mergeWorkbook(book, currentTable(book, src), opts);
}
