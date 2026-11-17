import { isTextType, threadReplies, type CustomColumn, type Markup, type MarkupStatusDef, type Reply } from '@nb/markup';
import { replyIndex } from './keyed';
import type { CellChange } from './merge';

/**
 * Turns the changes ticked in the import preview into patches for the markup store. The caller
 * applies them in one batch, through `store.update`, so they are one undo step and pass the same
 * ownership rules as an edit made by hand.
 */

export interface ApplyContext {
  statuses: readonly MarkupStatusDef[];
  columns: readonly CustomColumn[];
  /** Who new replies are from. */
  replyAuthor: string;
  now: number;
  newId: () => string;
  /** The status id a status cell's text means, when it is not the status's own name (a register's wording). */
  statusId?: (text: string) => string | undefined;
}

/** Whether a change is one anybody may make to someone else's markup: its status, its checkmark, a reply. */
export function isOpenChange(change: CellChange): boolean {
  return change.column.key === 'status' || change.column.key === 'checked' || replyIndex(change.column.key) !== null;
}

/** One patch per markup, in the order the markups first appear in `changes`. */
export function patchesFor(changes: readonly CellChange[], get: (id: string) => Markup | undefined, ctx: ApplyContext): Map<string, Partial<Markup>> {
  const out = new Map<string, Partial<Markup>>();
  for (const c of changes) {
    const m = get(c.rowKey);
    if (!m) continue;
    const patch = out.get(m.id) ?? {};
    const key = c.column.key;
    const at = replyIndex(key);
    if (at !== null) {
      const replies: Reply[] = patch.replies ?? [...(m.replies ?? [])];
      if (c.kind === 'replyAdd') replies.push({ id: ctx.newId(), author: c.author?.trim() || ctx.replyAuthor, text: c.to, createdAt: ctx.now + replies.length });
      else {
        // The Nth reply of the thread, as exported.
        const target = threadReplies(m.replies ?? [])[at - 1]?.reply;
        const i = target ? replies.findIndex((r) => r.id === target.id) : -1;
        if (i < 0) continue;
        replies[i] = { ...replies[i]!, text: c.to };
      }
      patch.replies = replies;
    } else if (key === 'status') {
      const id = ctx.statusId?.(c.to) ?? (c.to === '' ? 'none' : ctx.statuses.find((s) => s.name === c.to)?.id);
      if (id === undefined) continue;
      patch.status = id;
    } else if (key === 'comment') {
      if (isTextType(m.type)) patch.text = c.to;
      else patch.comment = c.to || undefined;
    } else if (key === 'subject') patch.subject = c.to || undefined;
    else if (key === 'label') patch.label = c.to || undefined;
    else if (key === 'layer') patch.layer = c.to || undefined;
    else if (key === 'checked') patch.checked = c.to === 'true';
    else if (key.startsWith('custom:')) {
      const column = ctx.columns.find((x) => x.id === key.slice(7));
      if (!column || column.type === 'formula') continue;
      const fields = { ...(patch.fields ?? m.fields) };
      // An unticked checkmark and a cleared cell are stored as no value.
      if (c.to === '' || (column.type === 'checkmark' && c.to !== 'true')) delete fields[column.id];
      else fields[column.id] = c.to;
      patch.fields = fields;
    } else continue;
    out.set(m.id, patch);
  }
  return out;
}
