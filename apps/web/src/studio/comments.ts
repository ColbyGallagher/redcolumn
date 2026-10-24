import type { Markup, MarkupStatusDef } from '@nb/markup';
import { csvCell } from '../columns/listColumns';

/**
 * Every comment and reply across the files of a Project or a Live Session, as one table: so a
 * reviewer can see all the open feedback without opening each document.
 */

/** One comment (a markup's own comment) or reply. */
export interface CommentRow {
  /** Unique in the table: the markup id, or the markup and reply ids. */
  key: string;
  fileId: string;
  file: string;
  pageIndex: number;
  /** The sheet number, else `Page 3`. */
  sheet: string;
  markupId: string;
  /** Set for a reply. */
  replyId?: string;
  author: string;
  text: string;
  /** The markup's status id; a reply shows its markup's. */
  status: string;
  statusName: string;
  /** When it was written (a comment: the markup's last change). */
  at: number;
}

export interface CommentSource {
  fileId: string;
  file: string;
  markups: readonly Markup[];
  pageLabel: (pageIndex: number) => string;
}

/** A status name from its id, for statuses a document defines. */
export const statusNameOf = (id: string, statuses: readonly MarkupStatusDef[]) => statuses.find((s) => s.id === id)?.name ?? (id === 'none' || !id ? 'None' : id);

/** The comment and replies on each markup of a file, in page order. Markups with neither are left out. */
export function commentRows(src: CommentSource, statuses: readonly MarkupStatusDef[]): CommentRow[] {
  const rows: CommentRow[] = [];
  const markups = [...src.markups].sort((a, b) => a.pageIndex - b.pageIndex || a.createdAt - b.createdAt);
  for (const m of markups) {
    const base = { fileId: src.fileId, file: src.file, pageIndex: m.pageIndex, sheet: src.pageLabel(m.pageIndex), markupId: m.id, status: m.status || 'none', statusName: statusNameOf(m.status, statuses) };
    if (m.comment?.trim()) rows.push({ ...base, key: m.id, author: m.author, text: m.comment.trim(), at: m.modifiedAt });
    for (const r of m.replies ?? []) if (r.text.trim()) rows.push({ ...base, key: `${m.id}/${r.id}`, replyId: r.id, author: r.author, text: r.text.trim(), at: r.createdAt });
  }
  return rows;
}

/** `open`: no status yet. `resolved`: any status set. Otherwise one status id. */
export type StatusFilter = 'all' | 'open' | 'resolved' | `status:${string}`;

export function filterComments(rows: readonly CommentRow[], status: StatusFilter, fileId: string | null, text = ''): CommentRow[] {
  const q = text.trim().toLowerCase();
  return rows.filter(
    (r) =>
      (status === 'all' || (status === 'open' ? r.status === 'none' : status === 'resolved' ? r.status !== 'none' : r.status === status.slice(7))) &&
      (!fileId || r.fileId === fileId) &&
      (!q || r.text.toLowerCase().includes(q) || r.author.toLowerCase().includes(q)),
  );
}

export type CommentColumn = 'file' | 'sheet' | 'author' | 'text' | 'status' | 'at';

export const COMMENT_COLUMNS: { key: CommentColumn; label: string }[] = [
  { key: 'file', label: 'File' },
  { key: 'sheet', label: 'Sheet' },
  { key: 'author', label: 'Author' },
  { key: 'text', label: 'Comment' },
  { key: 'status', label: 'Status' },
  { key: 'at', label: 'Date' },
];

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Sorted by a column; ties keep the file, page and thread order. */
export function sortComments(rows: readonly CommentRow[], key: CommentColumn, dir: 1 | -1): CommentRow[] {
  const value = (r: CommentRow) => (key === 'status' ? r.statusName : key === 'at' ? r.at : key === 'sheet' ? r.sheet : r[key]);
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      const x = value(a.r);
      const y = value(b.r);
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : collator.compare(String(x), String(y));
      return c * dir || a.i - b.i;
    })
    .map((e) => e.r);
}

/** The table as CSV (the caller adds a BOM for Excel), with a Type column saying comment or reply. */
export function commentsToCsv(rows: readonly CommentRow[]): string {
  const header = ['File', 'Sheet', 'Page', 'Type', 'Author', 'Comment', 'Status', 'Date'].join(',');
  const lines = rows.map((r) => [r.file, r.sheet, String(r.pageIndex + 1), r.replyId ? 'Reply' : 'Comment', r.author, r.text, r.statusName, new Date(r.at).toISOString()].map(csvCell).join(','));
  return [header, ...lines].join('\r\n');
}
