// Live Sessions in Google Drive and OneDrive have no server, so each attendee's app writes Record
// lines for its own edits.
import * as Y from 'yjs';
import { isTextType, MARKUP_LABELS, type Markup, type MarkupType } from '@nb/markup';
import type { RecordEntry } from './protocol';

type MarkupLike = Pick<Markup, 'type' | 'pageIndex' | 'status' | 'comment' | 'text' | 'replies'>;

type MarkupChange =
  | { action: 'add'; id: string; value: MarkupLike }
  | { action: 'update'; id: string; value: MarkupLike; old: MarkupLike }
  | { action: 'delete'; id: string; old: MarkupLike };

const BULK = 10;
const COALESCE_MS = 60_000;
const STATUS_TEXT: Record<string, string> = { none: 'cleared the status of', accepted: 'accepted', rejected: 'rejected', completed: 'completed' };

const label = (type: string) => MARKUP_LABELS[type as MarkupType] ?? 'Markup';

let seq = 0;
export const recordId = () => `${Date.now().toString(36)}-${(seq++).toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

export function describeChanges(changes: readonly MarkupChange[], author: string, docId: string, docName: string, now: number): RecordEntry[] {
  const base = { author, kind: 'markup' as const, docId, at: now };
  if (changes.length > BULK) {
    const adds = changes.filter((c) => c.action === 'add').length;
    const deletes = changes.filter((c) => c.action === 'delete').length;
    const parts = [adds && `added ${adds}`, deletes && `deleted ${deletes}`, changes.length - adds - deletes && `modified ${changes.length - adds - deletes}`].filter(Boolean);
    return [{ ...base, id: recordId(), text: `${parts.join(', ')} markups in ${docName}` }];
  }
  return changes.map((c) => {
    const m = c.action === 'delete' ? c.old : c.value;
    const where = `${label(m.type)} on page ${m.pageIndex + 1} of ${docName}`;
    let text: string;
    if (c.action === 'add') text = `added ${where}`;
    else if (c.action === 'delete') text = `deleted ${where}`;
    else if ((c.value.status ?? 'none') !== (c.old.status ?? 'none')) text = `${STATUS_TEXT[c.value.status ?? 'none'] ?? 'set the status of'} ${where}`;
    else if ((c.value.comment ?? '') !== (c.old.comment ?? '') && c.value.comment) text = `commented on ${where}: “${c.value.comment}”`;
    else if ((c.value.replies?.length ?? 0) > (c.old.replies?.length ?? 0)) text = `replied to ${where}: “${c.value.replies!.at(-1)!.text}”`;
    else if (isTextType(c.value.type) && (c.value.text ?? '') !== (c.old.text ?? '')) text = `edited the text of ${where}`;
    else text = `modified ${where}`;
    return { ...base, id: recordId(), text, page: m.pageIndex, markupId: c.id };
  });
}

function coalesces(last: RecordEntry | undefined, next: RecordEntry): boolean {
  return (
    !!last &&
    last.kind === 'markup' &&
    !!next.markupId &&
    last.markupId === next.markupId &&
    last.author === next.author &&
    last.text.startsWith('modified') &&
    next.text.startsWith('modified') &&
    next.at - last.at < COALESCE_MS
  );
}

/** Appends lines, collapsing repeated "modified" lines for one markup (dragging it about). */
export function appendRecord(log: Y.Array<RecordEntry>, entries: readonly RecordEntry[]) {
  if (!entries.length) return;
  log.doc!.transact(() => {
    for (const e of entries) {
      const last = log.length ? log.get(log.length - 1) : undefined;
      if (coalesces(last, e)) log.delete(log.length - 1, 1);
      log.push([e]);
    }
  });
}

/**
 * Calls `onChanges` with the markup changes made to `doc` by transactions from `origin` (this
 * attendee's own edits), for writing to the Record.
 */
export function watchMarkups(doc: Y.Doc, isOwn: (origin: unknown) => boolean, onChanges: (changes: MarkupChange[]) => void): () => void {
  const map = doc.getMap<MarkupLike>('markups');
  const observer = (event: Y.YMapEvent<MarkupLike>, tx: Y.Transaction) => {
    if (!isOwn(tx.origin)) return;
    const changes: MarkupChange[] = [];
    for (const [id, change] of event.changes.keys) {
      const value = map.get(id);
      if (change.action === 'add' && value) changes.push({ action: 'add', id, value });
      else if (change.action === 'update' && value) changes.push({ action: 'update', id, value, old: change.oldValue as MarkupLike });
      else if (change.action === 'delete') changes.push({ action: 'delete', id, old: change.oldValue as MarkupLike });
    }
    if (changes.length) onChanges(changes);
  };
  map.observe(observer);
  return () => map.unobserve(observer);
}
