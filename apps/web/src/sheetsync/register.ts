import type { MarkupStatusDef } from '@nb/markup';
import type { ListColumn, ListRowData } from '../columns/listColumns';
import { replyColumn, replyKey, responderKey, syncColumn, toSyncTable, type SyncColumn, type SyncTable } from './keyed';
import { buildSyncSheets, type RegisterRecord } from './syncWorkbook';
import type { TableCell } from './table';
import { buildWorkbook, columnName, sheetName, type LooseCell, type SheetSpec } from './xlsx';

/**
 * Comment register templates. A register is the Markups list in a client's layout: their column
 * headings in their order, one row per comment with the thread spread across columns (Comment,
 * Designer Response, Reviewer Close-out), their words for the statuses, and a block of project
 * details above the table. A template is saved per client, beside that client's drawing standard,
 * and can be shared as a file.
 *
 * The export is the same keyed workbook the Markups list export makes, so it comes back through
 * File › Import › Markups from Excel.
 */

/** What a register column holds: a column of the Markups list, the Nth reply of the thread, or who wrote that reply. */
export type RegisterField = { kind: 'column'; key: string } | { kind: 'reply'; index: number } | { kind: 'responder'; index: number };

export interface RegisterColumn {
  /** The client's heading. */
  header: string;
  field: RegisterField;
  /** Width in characters. */
  width?: number;
}

export interface RegisterStatus {
  /** The document's status id; `none` is a comment with no status. */
  id: string;
  /** The client's word for it. */
  word: string;
  /** Counts as closed out. A register's "Rejected" is usually still open. */
  closed: boolean;
  /** Other words that mean this status when they are typed in the register. */
  also: string[];
}

/** A detail of the export that a cell above the table can show. */
export type RegisterValue = 'document' | 'project' | 'package' | 'revision' | 'exportDate' | 'reviewer';
export const REGISTER_VALUES: { value: RegisterValue; label: string }[] = [
  { value: 'document', label: 'Document name' },
  { value: 'project', label: 'Project' },
  { value: 'package', label: 'Package' },
  { value: 'revision', label: 'Revision' },
  { value: 'exportDate', label: 'Export date' },
  { value: 'reviewer', label: 'Reviewer' },
];

/** A cell outside the table: fixed text, or a detail filled in at export. Ignored on import. */
export interface RegisterCell {
  row: number;
  col: number;
  text?: string;
  value?: RegisterValue;
  bold?: boolean;
}

export interface RegisterTemplate {
  id: string;
  name: string;
  /** The client's drawing standard this template is kept beside, if any. */
  standardId?: string;
  /** The sheet's name. */
  sheet: string;
  /** Where the table's header row is, and its first column (0-based). Clients' registers have a title block above the table. */
  headerRow: number;
  firstCol: number;
  columns: RegisterColumn[];
  statuses: RegisterStatus[];
  /**
   * `protected`: only the columns to fill in can be changed, and the sheet can be filtered but not
   * sorted (Excel will not sort locked cells). `open`: nothing is locked, so it can be sorted.
   */
  protection: 'protected' | 'open';
  /** Written in the workbook's Read me sheet: protection is against accidents, not people. */
  password?: string;
  cells: RegisterCell[];
  /**
   * The client's own register file, on this computer (Windows desktop app): an export can fill in a
   * copy of it instead of making a workbook that looks like it. `id` is the desktop app's name for
   * the file; it means nothing on another computer, so it is not shared with the template.
   */
  clientFile?: { id: string; name: string };
  updatedAt: number;
}

/** A column of the client's file that the register has nothing for: its heading is checked and its cells are left alone. */
export const blankKey = (n: number) => `blank:${n}`;

/** The password of a protected register whose template sets none. */
export const DEFAULT_PASSWORD = 'redcolumn';
export const README_SHEET = 'Read me';

const column = (header: string, key: string, width?: number): RegisterColumn => ({ header, field: { kind: 'column', key }, ...(width ? { width } : {}) });

/** Statuses a new template counts as closed. */
const CLOSED = new Set(['accepted', 'completed', 'cancelled']);

/** One entry per status of the document, keeping the template's wording where it has some. A comment with no status reads Open. */
export function withStatuses(t: RegisterTemplate, statuses: readonly MarkupStatusDef[]): RegisterTemplate {
  const known = new Map(t.statuses.map((s) => [s.id, s]));
  const ids = new Set(statuses.map((s) => s.id));
  const merged = statuses.map((s) => known.get(s.id) ?? { id: s.id, word: s.id === 'none' ? 'Open' : s.name, closed: CLOSED.has(s.id), also: [] });
  // Wording for statuses this document does not have is kept for the documents that do.
  return { ...t, statuses: [...merged, ...t.statuses.filter((s) => !ids.has(s.id))] };
}

/** A template to start from: the columns most registers have. */
export function starterTemplate(id: string, statuses: readonly MarkupStatusDef[], now: number): RegisterTemplate {
  return withStatuses(
    {
      id,
      name: 'Comment register',
      sheet: 'Register',
      headerRow: 4,
      firstCol: 0,
      columns: [
        column('Item No', 'seq', 9),
        column('Sheet', 'sheet', 16),
        column('Comment', 'comment', 50),
        column('Raised by', 'author', 16),
        column('Date raised', 'created', 20),
        column('Status', 'status', 14),
        { header: 'Designer Response', field: { kind: 'reply', index: 1 }, width: 50 },
        { header: 'Response by', field: { kind: 'responder', index: 1 }, width: 16 },
        { header: 'Reviewer Close-out', field: { kind: 'reply', index: 2 }, width: 40 },
      ],
      statuses: [],
      protection: 'protected',
      cells: [
        { row: 0, col: 0, text: 'Comment register', bold: true },
        { row: 1, col: 0, text: 'Document' },
        { row: 1, col: 2, value: 'document' },
        { row: 2, col: 0, text: 'Exported' },
        { row: 2, col: 2, value: 'exportDate' },
      ],
      updatedAt: now,
    },
    statuses,
  );
}

export const fieldKey = (f: RegisterField): string => (f.kind === 'column' ? f.key : f.kind === 'reply' ? replyKey(f.index) : responderKey(f.index));

/** The template's columns, without a field used a second time (a field can only be in one column). */
export function uniqueColumns(t: RegisterTemplate): RegisterColumn[] {
  const seen = new Set<string>();
  return t.columns.filter((c) => {
    const key = fieldKey(c.field);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** What a register export records about its wording, for the import. */
export function registerRecord(t: RegisterTemplate): RegisterRecord {
  return { templateId: t.id, statuses: t.statuses.filter((s) => s.word.trim()).map((s) => ({ id: s.id, word: s.word.trim(), also: s.also.map((a) => a.trim()).filter(Boolean) })) };
}

/** A register's status wording, both ways. */
export function wording(record: RegisterRecord, statuses: readonly MarkupStatusDef[]) {
  const wordOf = new Map(record.statuses.map((s) => [s.id, s.word]));
  const idOf = new Map(record.statuses.map((s) => [s.word.toLowerCase(), s.id]));
  // A status the template has no word for keeps the document's name.
  const words = statuses.map((s) => wordOf.get(s.id) ?? (s.id === 'none' ? '' : s.name)).filter(Boolean);
  return {
    /** The words offered in the Status column, in the document's order. */
    words: [...new Set(words)],
    /** The register's word for a status, by the name the list shows ('' is no status). */
    toWord: (name: string): string => {
      const def = name === '' ? statuses.find((s) => s.id === 'none') : statuses.find((s) => s.name === name);
      return (def && wordOf.get(def.id)) ?? name;
    },
    /** The status id a word means. */
    statusId: (word: string): string | undefined => idOf.get(word.trim().toLowerCase()) ?? (word.trim() === '' ? 'none' : statuses.find((s) => s.name.toLowerCase() === word.trim().toLowerCase())?.id),
    /** Other words (lower case) and the word each means. */
    aliases: Object.fromEntries(record.statuses.flatMap((s) => s.also.map((a) => [a.toLowerCase(), s.word]))),
  };
}

/** A keyed table with its Status column in the register's words. */
export function reword(table: SyncTable, record: RegisterRecord, statuses: readonly MarkupStatusDef[]): SyncTable {
  const at = table.columns.findIndex((c) => c.key === 'status');
  if (at < 0) return table;
  const w = wording(record, statuses);
  return {
    columns: table.columns.map((c, i) => (i === at ? { ...c, options: w.words } : c)),
    rows: table.rows.map((r) => (r.locked ? r : { ...r, cells: r.cells.map((cell, i) => (i === at ? w.toWord(String(cell)) : cell)) })),
  };
}

/**
 * The document as a register: one row per comment, the template's columns in its order. `rows` are
 * markup rows (no reply rows); `columns` is every list column the document has.
 */
export function registerTable(rows: readonly ListRowData[], columns: readonly ListColumn[], t: RegisterTemplate, statuses: readonly MarkupStatusDef[]): SyncTable {
  const byKey = new Map(columns.map((c) => [c.key, c]));
  const fields = uniqueColumns(t);
  const list = fields.flatMap((c) => (c.field.kind === 'column' && byKey.has(c.field.key) ? [byKey.get(c.field.key)!] : []));
  const threads = fields.flatMap((c): SyncColumn[] => (c.field.kind === 'column' ? [] : [replyColumn(fieldKey(c.field), c.header)]));
  const built = reword(toSyncTable(rows.filter((r) => !r.reply), list, { statuses, replyColumns: threads }), registerRecord(t), statuses);
  const index = new Map(built.columns.map((c, i) => [c.key, i]));
  const cols = fields.map((c): SyncColumn => {
    const key = fieldKey(c.field);
    const made = built.columns[index.get(key) ?? -1];
    // A column this document does not have (another project's custom column) is kept, blank and locked.
    return made ? { ...made, label: c.header } : { ...syncColumn({ key, label: c.header, defaultWidth: 0 }, statuses), edit: 'locked' };
  });
  return {
    columns: cols,
    rows: built.rows.map((r) => ({ ...r, cells: cols.map((c): TableCell => r.cells[index.get(c.key) ?? -1] ?? '') })),
  };
}

export interface RegisterExport {
  /** The comments to export, as list rows. */
  rows: readonly ListRowData[];
  /** Every list column the document has. */
  columns: readonly ListColumn[];
  statuses: readonly MarkupStatusDef[];
  template: RegisterTemplate;
  docId: string;
  /** When the export is made (ISO). */
  exportedAt: string;
  /** The details cells above the table can show. */
  values: Partial<Record<RegisterValue, string>>;
}

function readMe(e: RegisterExport, table: SyncTable): SheetSpec {
  const t = e.template;
  const fill = table.columns.filter((c) => c.edit === 'editable').map((c) => c.label);
  const lines = [
    t.name,
    `Exported from redcolumn on ${e.exportedAt.slice(0, 10)}${e.values.document ? ` for ${e.values.document}` : ''}.`,
    '',
    `Columns to fill in on the "${sheetName(t.sheet)}" sheet: ${fill.join(', ') || 'none'}.`,
    'Other columns come from the drawing review. Changes to them are not taken back.',
    'Columns with a dropdown only accept the values in the dropdown.',
    '',
    ...(t.protection === 'protected'
      ? [
          'The sheet is protected so that columns are not changed or deleted by accident. You can filter it. Excel does not sort a protected sheet.',
          `To sort or restructure it, unprotect it first: Review > Unprotect Sheet, password: ${t.password || DEFAULT_PASSWORD}`,
          '',
        ]
      : []),
    'The sheet has a hidden column, and the workbook a hidden sheet. They tie each row to its comment: leave them in place.',
    'Rows added here are not imported, and deleting a row does not delete its comment.',
    'When you are done, save the workbook and send it back. It is imported with File > Import > Markups from Excel.',
  ];
  return { name: README_SHEET, filter: false, widths: [110], wrap: new Set([0]), table: lines.map((l) => [l]) };
}

/** The register's sheets: the register, a Read me, and the hidden record. */
export function registerSheets(e: RegisterExport): SheetSpec[] {
  const t = e.template;
  const table = registerTable(e.rows, e.columns, t, e.statuses);
  const fields = uniqueColumns(t);
  const row0 = Math.max(0, t.headerRow);
  const cells: LooseCell[] = t.cells.flatMap((c) => {
    const value = c.value ? (e.values[c.value] ?? '') : (c.text ?? '');
    return value && c.row >= 0 && c.col >= 0 && c.row < row0 ? [{ row: c.row, col: c.col, value, ...(c.bold ? { bold: true } : {}) }] : [];
  });
  const [visible, hidden] = buildSyncSheets(table, {
    sheet: sheetName(t.sheet || 'Register'),
    docId: e.docId,
    exportedAt: e.exportedAt,
    origin: { row: row0, col: Math.max(0, t.firstCol) },
    cells,
    keyAt: 'last',
    widths: fields.map((c) => c.width),
    register: registerRecord(t),
    ...(t.protection === 'protected' ? { protect: { password: t.password || DEFAULT_PASSWORD } } : {}),
  });
  return [visible!, readMe(e, table), hidden!];
}

export function exportRegisterWorkbook(e: RegisterExport): Uint8Array {
  return buildWorkbook(registerSheets(e));
}

/** `B3` for a cell (0-based row and column). */
export const cellRef = (row: number, col: number) => `${columnName(col)}${row + 1}`;

/** The cell a reference names, or null when it is not one. */
export function parseCellRef(ref: string): { row: number; col: number } | null {
  const m = /^\s*([A-Za-z]{1,3})\s*(\d{1,7})\s*$/.exec(ref);
  if (!m) return null;
  let col = 0;
  for (const ch of m[1]!.toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64);
  const row = Number(m[2]) - 1;
  return row >= 0 && col >= 1 ? { row, col: col - 1 } : null;
}

// Sharing a template as a file.

const FORMAT = 'redcolumn.register-template';
const VERSION = 1;
const MAX_FILE = 500_000;
const MAX_COLUMNS = 100;

function fail(why: string): never {
  throw new Error(`This register template cannot be read: ${why}.`);
}
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
function str(v: unknown, max: number, what: string): string {
  if (typeof v !== 'string' || v.length > max) fail(`${what} is missing or too long`);
  return v;
}
function whole(v: unknown, max: number, what: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > max) fail(`${what} is not a number it can be`);
  return v;
}

export function exportTemplate(t: RegisterTemplate): string {
  // Which client it is kept beside is this person's own arrangement.
  const { standardId: _standard, clientFile: _file, ...shared } = t;
  return JSON.stringify({ format: FORMAT, version: VERSION, template: shared }, null, 2);
}

export function templateFileName(t: RegisterTemplate): string {
  return `${t.name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'Register'}.rcregister`;
}

/** Reads a `.rcregister` file. It comes from someone else, so every field is checked and only known fields are kept. */
export function parseTemplateFile(content: string): RegisterTemplate {
  if (content.length > MAX_FILE) fail('the file is too large');
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    fail('the file is not JSON');
  }
  if (!isObject(data) || data.format !== FORMAT) fail('the file is another kind of file');
  if (typeof data.version !== 'number' || data.version > VERSION) fail('the file was made by a newer version of redcolumn');
  const t = data.template;
  if (!isObject(t)) fail('the template is missing');
  if (!Array.isArray(t.columns) || !t.columns.length || t.columns.length > MAX_COLUMNS) fail('the columns are missing');
  const columns = t.columns.map((c: unknown): RegisterColumn => {
    if (!isObject(c) || !isObject(c.field)) fail('a column has no field');
    const f = c.field;
    const field: RegisterField =
      f.kind === 'column' ? { kind: 'column', key: str(f.key, 200, "a column's field") } : f.kind === 'reply' || f.kind === 'responder' ? { kind: f.kind, index: whole(f.index, 20, "a thread column's number") || 1 } : fail('a column has a field this version does not know');
    return { header: str(c.header, 200, "a column's heading"), field, ...(c.width === undefined ? {} : { width: Math.max(1, whole(c.width, 255, "a column's width")) }) };
  });
  if (!Array.isArray(t.statuses) || t.statuses.length > 200) fail('the status wording is missing');
  const statuses = t.statuses.map((s: unknown): RegisterStatus => {
    if (!isObject(s)) fail('a status is not readable');
    const also = Array.isArray(s.also) ? s.also.slice(0, 50).map((a) => str(a, 200, 'a status word')) : [];
    return { id: str(s.id, 200, "a status's id"), word: str(s.word, 200, "a status's word"), closed: s.closed === true, also };
  });
  if (!Array.isArray(t.cells) || t.cells.length > 500) fail('the cells above the table are missing');
  const values = new Set<string>(REGISTER_VALUES.map((v) => v.value));
  const cells = t.cells.map((c: unknown): RegisterCell => {
    if (!isObject(c)) fail('a cell is not readable');
    const cell: RegisterCell = { row: whole(c.row, 10_000, "a cell's row"), col: whole(c.col, 500, "a cell's column") };
    if (typeof c.value === 'string' && values.has(c.value)) cell.value = c.value as RegisterValue;
    else cell.text = str(c.text ?? '', 2000, "a cell's text");
    if (c.bold === true) cell.bold = true;
    return cell;
  });
  return {
    id: str(t.id, 200, 'the id'),
    name: str(t.name, 200, 'the name').trim() || 'Register',
    sheet: str(t.sheet, 31, "the sheet's name"),
    headerRow: whole(t.headerRow, 10_000, 'the header row'),
    firstCol: whole(t.firstCol, 500, 'the first column'),
    columns,
    statuses,
    protection: t.protection === 'open' ? 'open' : 'protected',
    ...(typeof t.password === 'string' && t.password ? { password: str(t.password, 60, 'the password') } : {}),
    cells,
    updatedAt: typeof t.updatedAt === 'number' ? t.updatedAt : 0,
  };
}

/** The template a document's export starts on: the one kept beside its drawing standard, else the first. */
export function templateFor(templates: readonly RegisterTemplate[], standardId: string | undefined): RegisterTemplate | undefined {
  return (standardId ? templates.find((t) => t.standardId === standardId) : undefined) ?? templates[0];
}
