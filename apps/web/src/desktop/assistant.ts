import { measureProps, type Markup, type MarkupStore } from '@nb/markup';
import { isMeasureKind, measureLabel } from '@nb/measure';

/** One open drawing the assistant can see. Page indexes are 0-based, as the viewer stores them. */
export interface AssistantDocument {
  id: string;
  name: string;
  pageCount: number;
  pageIndex: number;
  active: boolean;
  store: MarkupStore;
}

/** The active drawing wins when the same file is open in both panes. */
export function assistantDocuments(tabs: readonly AssistantDocument[]): AssistantDocument[] {
  const active = tabs.find((t) => t.active);
  const ordered = active ? [active, ...tabs] : tabs;
  const out: AssistantDocument[] = [];
  const seen = new Set<string>();
  for (const tab of ordered) {
    if (seen.has(tab.id)) continue;
    seen.add(tab.id);
    out.push(tab);
  }
  return out;
}

function sheetOf(doc: AssistantDocument) {
  const info = doc.store.allSheets()[doc.pageIndex];
  return { sheetNumber: info?.number ?? null, sheetTitle: info?.title ?? null };
}

function publicDocument(doc: AssistantDocument) {
  return {
    id: doc.id,
    name: doc.name,
    pageCount: doc.pageCount,
    page: doc.pageIndex + 1,
    active: doc.active,
    ...sheetOf(doc),
  };
}

function measurement(doc: AssistantDocument, markup: Markup): string | undefined {
  if (!isMeasureKind(markup.type) || markup.points.length === 0) return undefined;
  return measureLabel(markup.type, markup.points, doc.store.scaleOf(markup), measureProps(markup));
}

function publicMarkup(doc: AssistantDocument, markup: Markup) {
  const columns = doc.store.columnSet();
  const status = columns.statuses.find((s) => s.id === markup.status)?.name ?? markup.status;
  const fields: Record<string, string> = {};
  for (const column of columns.columns) {
    const value = markup.fields?.[column.id];
    if (value) fields[column.name] = value;
  }
  return {
    id: markup.id,
    ...(markup.seq !== undefined ? { seq: markup.seq } : {}),
    type: markup.type,
    page: markup.pageIndex + 1,
    ...(markup.text ? { text: markup.text } : {}),
    ...(markup.subject ? { subject: markup.subject } : {}),
    ...(markup.comment ? { comment: markup.comment } : {}),
    status,
    author: markup.author,
    ...(measurement(doc, markup) ? { measurement: measurement(doc, markup) } : {}),
    ...(Object.keys(fields).length ? { fields } : {}),
    ...(markup.hidden ? { hidden: true } : {}),
  };
}

function findDocument(docs: readonly AssistantDocument[], name: unknown): AssistantDocument {
  const open = assistantDocuments(docs);
  if (!open.length) throw new Error('No document is open.');
  if (typeof name !== 'string' || !name.trim()) {
    const active = open.find((d) => d.active) ?? open[0];
    if (!active) throw new Error('No document is open.');
    return active;
  }
  const wanted = name.trim().toLowerCase();
  const matches = open.filter((d) => d.id === name || d.name.toLowerCase() === wanted);
  const found = matches.find((d) => d.active) ?? matches[0];
  if (!found) throw new Error(`No open document matches "${name}".`);
  return found;
}

function record(params: unknown): Record<string, unknown> {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return {};
  return params as Record<string, unknown>;
}

function listMarkups(docs: readonly AssistantDocument[], params: unknown) {
  const args = record(params);
  const doc = findDocument(docs, args.document);
  let markups = doc.store.all();
  if (args.page !== undefined) {
    const page = typeof args.page === 'number' ? args.page : Number(args.page);
    if (!Number.isInteger(page) || page < 1 || page > doc.pageCount) throw new Error(`Page ${String(args.page)} is not in ${doc.name} (1–${doc.pageCount}).`);
    markups = markups.filter((m) => m.pageIndex === page - 1);
  }
  return { document: doc.name, id: doc.id, markups: markups.map((m) => publicMarkup(doc, m)) };
}

function findMarkup(doc: AssistantDocument, args: Record<string, unknown>): Markup {
  if (typeof args.id === 'string' && args.id) {
    const found = doc.store.get(args.id);
    if (!found) throw new Error(`No markup ${args.id} is on ${doc.name}.`);
    return found;
  }
  const seq = typeof args.seq === 'number' ? args.seq : typeof args.seq === 'string' && args.seq ? Number(args.seq) : undefined;
  if (seq !== undefined && Number.isInteger(seq)) {
    const found = doc.store.all().find((m) => m.seq === seq);
    if (!found) throw new Error(`No markup ${seq} is on ${doc.name}.`);
    return found;
  }
  throw new Error('Say which markup to change: its id or its number (seq) from list_markups.');
}

function setMarkup(docs: readonly AssistantDocument[], params: unknown) {
  const args = record(params);
  const doc = findDocument(docs, args.document);
  if (doc.store.readOnly) throw new Error(`${doc.name} is read-only.`);
  const markup = findMarkup(doc, args);
  const patch: Partial<Omit<Markup, 'id'>> = {};
  if (typeof args.status === 'string') {
    const wanted = args.status.trim().toLowerCase();
    const status = doc.store.columnSet().statuses.find((s) => s.id.toLowerCase() === wanted || s.name.toLowerCase() === wanted);
    if (!status) throw new Error(`"${args.status}" is not a status on ${doc.name}.`);
    patch.status = status.id;
  }
  if (typeof args.comment === 'string') patch.comment = args.comment ? args.comment : undefined;
  if (typeof args.subject === 'string') patch.subject = args.subject ? args.subject : undefined;
  if (typeof args.field === 'string' && args.field) {
    const wanted = args.field.trim().toLowerCase();
    const column = doc.store.columnSet().columns.find((c) => c.id.toLowerCase() === wanted || c.name.toLowerCase() === wanted);
    if (!column) throw new Error(`${doc.name} has no column named "${args.field}".`);
    if (column.type === 'formula') throw new Error(`${column.name} is calculated, so it cannot be set.`);
    if (typeof args.value !== 'string') throw new Error(`Give a value for ${column.name}.`);
    patch.fields = { ...markup.fields, [column.id]: args.value };
  }
  if (!('status' in patch) && !('comment' in patch) && !('subject' in patch) && !patch.fields) throw new Error('Say what to change: status, comment, subject, or a column.');
  doc.store.checkpoint();
  doc.store.update(markup.id, patch);
  const next = doc.store.get(markup.id);
  if (!next) throw new Error(`No markup ${markup.id} is on ${doc.name}.`);
  if (patch.status !== undefined && next.status !== patch.status) throw new Error('That markup cannot be changed.');
  if ('comment' in patch && (next.comment ?? '') !== (patch.comment ?? '')) throw new Error('That markup cannot be changed.');
  if ('subject' in patch && (next.subject ?? '') !== (patch.subject ?? '')) throw new Error('That markup cannot be changed.');
  if (patch.fields) {
    for (const [id, value] of Object.entries(patch.fields)) {
      if ((next.fields?.[id] ?? '') !== value) throw new Error('That markup cannot be changed.');
    }
  }
  return { document: doc.name, markup: publicMarkup(doc, next) };
}

/** Runs one assistant tool against the drawings that are open right now. */
export function assistantCall(docs: readonly AssistantDocument[], method: string, params: unknown): unknown {
  if (method === 'list_open_documents') return { documents: assistantDocuments(docs).map(publicDocument) };
  if (method === 'list_markups') return listMarkups(docs, params);
  if (method === 'set_markup') return setMarkup(docs, params);
  throw new Error('Unknown tool.');
}
