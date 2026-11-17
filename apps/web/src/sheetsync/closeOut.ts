import { isTextType, type Markup, type MarkupStatusDef } from '@nb/markup';
import type { SheetInfo } from '@nb/sheets';
import { csvCell } from '../columns/listColumns';
import type { RegisterTemplate } from './register';

/**
 * Close-out: what is still open on each sheet, and what a comment was raised on.
 *
 * A comment records the revision of its sheet the first time it is exported to a register or its
 * sheet is slip-sheeted (`Markup.raisedRev`). The close-out view lists the comments by sheet with the
 * sheet's revision now, and counts them open or closed by the client's register template: there
 * "Rejected" is usually still open, where "no status" used to be the only meaning of open.
 */

/** Statuses that count as closed when no register template says otherwise. */
export const DEFAULT_CLOSED: readonly string[] = ['accepted', 'completed', 'cancelled'];

/** The status ids that count as closed: the template's, or the usual ones. */
export function closedStatuses(template: Pick<RegisterTemplate, 'statuses'> | null | undefined): Set<string> {
  return new Set(template?.statuses.length ? template.statuses.filter((s) => s.closed).map((s) => s.id) : DEFAULT_CLOSED);
}

/** Whether a markup is a comment: it says something (a comment, its text, or a reply). A space never is. */
export function isComment(m: Markup): boolean {
  return m.type !== 'space' && (!!(isTextType(m.type) ? m.text : m.comment)?.trim() || !!m.replies?.length);
}

type Sheets = Readonly<Record<number, Pick<SheetInfo, 'number' | 'title' | 'revision'> | undefined>>;

/**
 * The revision each comment was raised on, for those that do not have one yet: its sheet's revision
 * now. `pages` limits it to comments on those pages. A comment on a sheet with no revision found is
 * left for a later time.
 */
export function raisedRevisions(markups: readonly Markup[], sheets: Sheets, pages?: ReadonlySet<number>): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of markups) {
    if (m.raisedRev || !isComment(m) || (pages && !pages.has(m.pageIndex))) continue;
    const rev = sheets[m.pageIndex]?.revision?.trim();
    if (rev) out.set(m.id, rev);
  }
  return out;
}

/** The closed comments on these pages: what Slip Sheet leaves behind when asked. */
export function closedComments(markups: readonly Markup[], pages: ReadonlySet<number>, closed: ReadonlySet<string>): Markup[] {
  return markups.filter((m) => pages.has(m.pageIndex) && isComment(m) && closed.has(m.status || 'none'));
}

export interface CloseOutComment {
  id: string;
  /** The markup's ID as people quote it. */
  itemNo: number | null;
  text: string;
  author: string;
  status: string;
  statusName: string;
  closed: boolean;
  /** The revision it was raised on; '' when none is recorded yet. */
  raisedRev: string;
  replies: number;
}

export interface CloseOutSheet {
  pageIndex: number;
  /** The sheet number, else `Page 3`. */
  sheet: string;
  title: string;
  /** The sheet's revision now; '' when none was found. */
  revision: string;
  open: number;
  closed: number;
  comments: CloseOutComment[];
}

/** The comments by sheet, in page order, with how many are open and closed. Sheets with no comments are left out. */
export function closeOut(markups: readonly Markup[], sheets: Sheets, closed: ReadonlySet<string>, statuses: readonly MarkupStatusDef[]): CloseOutSheet[] {
  const byPage = new Map<number, CloseOutSheet>();
  const ordered = markups.filter(isComment).sort((a, b) => a.pageIndex - b.pageIndex || (a.seq ?? 0) - (b.seq ?? 0) || a.createdAt - b.createdAt);
  for (const m of ordered) {
    const info = sheets[m.pageIndex];
    const sheet = byPage.get(m.pageIndex) ?? { pageIndex: m.pageIndex, sheet: info?.number?.trim() || `Page ${m.pageIndex + 1}`, title: info?.title?.trim() ?? '', revision: info?.revision?.trim() ?? '', open: 0, closed: 0, comments: [] };
    byPage.set(m.pageIndex, sheet);
    const status = m.status || 'none';
    const isClosed = closed.has(status);
    if (isClosed) sheet.closed++;
    else sheet.open++;
    sheet.comments.push({
      id: m.id,
      itemNo: m.seq ?? null,
      text: ((isTextType(m.type) ? m.text : m.comment) ?? '').trim(),
      author: m.author,
      status,
      statusName: status === 'none' ? 'Open' : (statuses.find((s) => s.id === status)?.name ?? status),
      closed: isClosed,
      raisedRev: m.raisedRev ?? '',
      replies: m.replies?.length ?? 0,
    });
  }
  return [...byPage.values()];
}

/** The close-out as CSV: one line per comment (the caller adds a BOM for Excel). */
export function closeOutCsv(sheets: readonly CloseOutSheet[]): string {
  const header = ['Sheet', 'Title', 'Revision', 'ID', 'Comment', 'Author', 'Status', 'Open or closed', 'Raised at revision', 'Replies'].join(',');
  const lines = sheets.flatMap((s) => s.comments.map((c) => [s.sheet, s.title, s.revision, c.itemNo === null ? '' : String(c.itemNo), c.text, c.author, c.statusName, c.closed ? 'Closed' : 'Open', c.raisedRev, String(c.replies)].map(csvCell).join(',')));
  return [header, ...lines].join('\r\n');
}
