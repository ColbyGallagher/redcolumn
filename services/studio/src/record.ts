import type { RecordEntry } from './protocol.ts';

/** The fields of a markup (packages/markup/src/model.ts) the Record describes. */
export interface MarkupLike {
  type: string;
  pageIndex: number;
  status?: string;
  comment?: string;
  text?: string;
  replies?: { text: string }[];
}

/** Markup type names, as in packages/markup/src/types.ts (this service does not depend on it). */
const LABELS: Record<string, string> = {
  line: 'Line',
  arrow: 'Arrow',
  polyline: 'Polyline',
  arc: 'Arc',
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  polygon: 'Polygon',
  cloud: 'Cloud',
  pen: 'Pen',
  highlighter: 'Highlight',
  textHighlight: 'Text Highlight',
  underline: 'Underline',
  strikeout: 'Strikethrough',
  squiggly: 'Squiggly',
  text: 'Text Box',
  callout: 'Callout',
  typewriter: 'Typewriter',
  note: 'Note',
  image: 'Image',
  signature: 'Signature',
  length: 'Length',
  polylength: 'Polylength',
  area: 'Area',
  perimeter: 'Perimeter',
  count: 'Count',
  angle: 'Angle',
};

export function markupLabel(type: string): string {
  return LABELS[type] ?? 'Markup';
}

export type MarkupChange =
  | { action: 'add'; id: string; value: MarkupLike }
  | { action: 'update'; id: string; value: MarkupLike; old: MarkupLike }
  | { action: 'delete'; id: string; old: MarkupLike };

/** Above this many markups in one change, the Record gets a single summary line. */
const BULK = 10;

const STATUS_TEXT: Record<string, string> = { none: 'cleared the status of', accepted: 'accepted', rejected: 'rejected', completed: 'completed' };

/**
 * Record lines for one batch of markup changes by one attendee. Moves and restyles read as
 * "modified"; status and comment changes are called out.
 */
export function describeChanges(changes: readonly MarkupChange[], author: string, docId: string, docName: string, now: number, newId: () => string): RecordEntry[] {
  const base = { author, kind: 'markup' as const, docId, at: now };
  if (changes.length > BULK) {
    const adds = changes.filter((c) => c.action === 'add').length;
    const deletes = changes.filter((c) => c.action === 'delete').length;
    const parts = [adds && `added ${adds}`, deletes && `deleted ${deletes}`, changes.length - adds - deletes && `modified ${changes.length - adds - deletes}`].filter(Boolean);
    return [{ ...base, id: newId(), text: `${parts.join(', ')} markups in ${docName}` }];
  }
  return changes.map((c) => {
    const m = c.action === 'delete' ? c.old : c.value;
    const where = `${markupLabel(m.type)} on page ${m.pageIndex + 1} of ${docName}`;
    let text: string;
    if (c.action === 'add') text = `added ${where}`;
    else if (c.action === 'delete') text = `deleted ${where}`;
    else if ((c.value.status ?? 'none') !== (c.old.status ?? 'none')) text = `${STATUS_TEXT[c.value.status ?? 'none'] ?? 'set the status of'} ${where}`;
    else if ((c.value.comment ?? '') !== (c.old.comment ?? '') && c.value.comment) text = `commented on ${where}: “${c.value.comment}”`;
    else if ((c.value.replies?.length ?? 0) > (c.old.replies?.length ?? 0)) text = `replied to ${where}: “${c.value.replies!.at(-1)!.text}”`;
    else if (['text', 'callout', 'typewriter'].includes(c.value.type) && (c.value.text ?? '') !== (c.old.text ?? '')) text = `edited the text of ${where}`;
    else text = `modified ${where}`;
    return { ...base, id: newId(), text, page: m.pageIndex, markupId: c.id };
  });
}

/** Repeated "modified" lines for the same markup by the same person collapse within this window. */
export const COALESCE_MS = 60_000;

/** Whether `next` should replace `last` rather than follow it (dragging a markup around). */
export function coalesces(last: RecordEntry | undefined, next: RecordEntry): boolean {
  return (
    !!last &&
    last.kind === 'markup' &&
    next.kind === 'markup' &&
    !!next.markupId &&
    last.markupId === next.markupId &&
    last.author === next.author &&
    last.text.startsWith('modified') &&
    next.text.startsWith('modified') &&
    next.at - last.at < COALESCE_MS
  );
}
