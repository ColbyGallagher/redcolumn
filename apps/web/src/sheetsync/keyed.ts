import { threadReplies, type MarkupStatusDef } from '@nb/markup';
import type { ListColumn, ListRowData } from '../columns/listColumns';
import type { TableCell } from './table';

/**
 * The Markups list as a table a spreadsheet can send back: every row has a key, and every column
 * says whether edits to it are taken on import and what values it holds.
 */

export interface SyncColumn {
  /** 'status', 'comment', 'custom:<id>', 'reply:1', ... */
  key: string;
  /** Header text. */
  label: string;
  edit: 'locked' | 'editable';
  kind: 'text' | 'number' | 'date' | 'choice' | 'check';
  /** The values a choice column accepts. */
  options?: string[];
}

export interface SyncRow {
  /** The markup's id, or `<markup id>/<reply id>` for a reply row. */
  key: string;
  /**
   * One cell per column. Locked columns hold what the list shows. Editable ones hold the value in a
   * fixed form: text as it is, a number, a date as yyyy-mm-dd, a checkmark as Yes or No, a choice as
   * its option's text.
   */
  cells: TableCell[];
  /** A row whose cells are never taken on import (a reply row). */
  locked?: boolean;
  /** What a row is found by when its key is gone: the markup's ID, its sheet number and its comment. */
  match?: { itemNo: number | null; sheet: string; comment: string };
  /** The texts of the markup's replies, so a response that is already there is not added again. */
  replies?: string[];
}

export interface SyncTable {
  columns: SyncColumn[];
  rows: SyncRow[];
}

/** A column holding the Nth reply of a comment's thread (1-based). */
export const replyKey = (n: number) => `reply:${n}`;
/** A blank column on the plain Markups list export: text typed in it becomes a new reply. */
export const NEW_REPLY = 'newReply';
/** Which reply a thread column holds (1-based), 0 for the new-reply column, or null for other columns. */
export function replyIndex(key: string): number | null {
  if (key === NEW_REPLY) return 0;
  const m = /^reply:(\d+)$/.exec(key);
  return m ? Number(m[1]) : null;
}

export const YES = 'Yes';
export const NO = 'No';

/** Built-in columns whose edits are taken on import. */
const EDITABLE: Record<string, SyncColumn['kind']> = { status: 'choice', comment: 'text', subject: 'text', label: 'text', layer: 'text', checked: 'check' };

/** A list column as a sync column: what it holds and whether an edit to it is taken. */
export function syncColumn(c: ListColumn, statuses: readonly MarkupStatusDef[]): SyncColumn {
  if (c.custom) {
    const t = c.custom.type;
    if (t === 'formula') return { key: c.key, label: c.label, edit: 'locked', kind: 'text' };
    const kind = t === 'choice' ? 'choice' : t === 'number' ? 'number' : t === 'date' ? 'date' : t === 'checkmark' ? 'check' : 'text';
    return { key: c.key, label: c.label, edit: 'editable', kind, ...(kind === 'choice' ? { options: [...(c.custom.options ?? [])] } : {}) };
  }
  const kind = EDITABLE[c.key];
  if (!kind) return { key: c.key, label: c.label, edit: 'locked', kind: 'text' };
  return { key: c.key, label: c.label, edit: 'editable', kind, ...(c.key === 'status' ? { options: statuses.filter((s) => s.id !== 'none').map((s) => s.name) } : {}) };
}

/** A thread column. */
export function replyColumn(key: string, label: string): SyncColumn {
  return { key, label, edit: 'editable', kind: 'text' };
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/;

/** A date as yyyy-mm-dd, or null when the text is not a date. */
export function isoDate(text: string): string | null {
  const t = text.trim();
  const ms = ISO_DATE.test(t) ? Date.parse(`${t.slice(0, 10)}T00:00:00Z`) : Date.parse(t);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString().slice(0, 10);
}

const TRUE = new Set(['yes', 'y', 'true', '1', '✓', '✔', 'x', 'checked']);
const FALSE = new Set(['', 'no', 'n', 'false', '0']);

/** Text with one kind of line break and no trailing space, so the same words always compare equal. */
export function plainText(text: string): string {
  return text.replace(/\r\n?/g, '\n').trimEnd();
}

/**
 * A cell's value as the text it is compared and stored by: a number as its shortest form, a date as
 * yyyy-mm-dd, a checkmark as true or false, a choice as its option. Null when the value does not
 * fit the column (text in a number column, a choice that is not offered).
 *
 * `aliases` maps other words for a choice (lower case) to the option they mean.
 */
export function canon(col: Pick<SyncColumn, 'kind' | 'options'>, value: TableCell | boolean | null, aliases?: Readonly<Record<string, string>>): string | null {
  const text = value === null ? '' : typeof value === 'boolean' ? (value ? 'TRUE' : 'FALSE') : String(value);
  switch (col.kind) {
    case 'check': {
      const t = text.trim().toLowerCase();
      return TRUE.has(t) ? 'true' : FALSE.has(t) ? 'false' : null;
    }
    case 'number': {
      if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null;
      if (typeof value === 'boolean') return null;
      const t = text.trim();
      if (t === '') return '';
      const n = Number(t.replace(/[,\s]/g, ''));
      return Number.isFinite(n) ? String(n) : null;
    }
    case 'date':
      return text.trim() === '' ? '' : isoDate(text);
    case 'choice': {
      const t = text.trim();
      if (t === '') return '';
      const lower = t.toLowerCase();
      const option = col.options?.find((o) => o.trim().toLowerCase() === lower);
      if (option !== undefined) return option;
      const alias = aliases?.[lower];
      return alias !== undefined && (col.options?.includes(alias) ?? false) ? alias : null;
    }
    default:
      return plainText(text);
  }
}

/** `canon` for a value the app made itself: one that does not fit its column is kept as its text. */
export function canonOwn(col: Pick<SyncColumn, 'kind' | 'options'>, value: TableCell): string {
  return canon(col, value) ?? plainText(String(value));
}

export interface SyncContext {
  statuses: readonly MarkupStatusDef[];
  /** Thread columns to add after the list's columns. */
  replyColumns?: readonly SyncColumn[];
}

/**
 * The list's rows and columns as a keyed table. Reply rows (when the list shows threads) are kept
 * but locked: a reply is answered through a thread column, not by editing its row.
 */
export function toSyncTable(rows: readonly ListRowData[], columns: readonly ListColumn[], ctx: SyncContext): SyncTable {
  const cols = [...columns.map((c) => syncColumn(c, ctx.statuses)), ...(ctx.replyColumns ?? [])];
  const out: SyncRow[] = rows.map((r) => {
    const thread = r.reply ? [] : threadReplies(r.markup.replies ?? []).map((t) => t.reply.text);
    const cells = cols.map((c, i): TableCell => {
      const at = replyIndex(c.key);
      if (at !== null) return at === 0 ? '' : (thread[at - 1] ?? '');
      const list = columns[i]!;
      if (list.key === 'date') return new Date(r.reply?.at ?? r.markup.modifiedAt).toISOString().replace('T', ' ').slice(0, 19);
      const v = r.cells[list.key];
      if (!v) return c.kind === 'check' && c.edit === 'editable' ? NO : '';
      if (v.error) return `#${v.error}`;
      if (list.key === 'subject' && r.reply) return `${'> '.repeat(r.reply.depth)}${v.text}`;
      // Numeric cells go as numbers, so the sheet can sum them; a measurement keeps its units.
      if (c.edit === 'locked') return v.num !== null && list.key !== 'measurement' ? v.num : v.text;
      if (c.kind === 'check') return v.num ? YES : NO;
      if (c.kind === 'number') return v.num ?? v.text;
      if (c.kind === 'date') return v.num !== null ? new Date(v.num).toISOString().slice(0, 10) : v.text;
      return v.text;
    });
    if (r.reply) return { key: `${r.markup.id}/${r.reply.id}`, cells, locked: true };
    return {
      key: r.markup.id,
      cells,
      match: { itemNo: r.markup.seq ?? null, sheet: r.cells.sheet?.text ?? '', comment: plainText(r.cells.comment?.text ?? '') },
      replies: (r.markup.replies ?? []).map((x) => plainText(x.text)),
    };
  });
  return { columns: cols, rows: out };
}
