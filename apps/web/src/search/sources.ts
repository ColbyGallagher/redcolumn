import type { PdfDocument, DocumentInfo } from '@nb/pdf-core';
import { boundsOf, MARKUP_LABELS, MarkupStore, type Markup } from '@nb/markup';
import type { PageText } from '@nb/sheets';
import type { FormModel } from '../documents/forms';
import { loadPageTexts, readForSearch } from '../sheets/indexer';
import { readFile, type StoredFile } from '../storage/fileStore';

/** A piece of text on a page that is not the page's own text: a form field value or a markup's text. */
export interface Labelled {
  pageIndex: number;
  rect: { x: number; y: number; w: number; h: number };
  label: string;
  text: string;
}

/**
 * One document the Search panel looks through. Each part is read only when its option is on, so
 * a filename search across a folder never extracts any text.
 */
export interface SearchSource {
  /** The library id of the document, or `file:<path>` for a file in a chosen folder. */
  id: string;
  name: string;
  /** Searches this page only (Current Page). */
  page?: number;
  text(onProgress: (done: number, total: number) => void): Promise<PageText[]>;
  properties(): Promise<Record<string, string>>;
  fields(): Promise<Labelled[]>;
  markups(): Promise<Labelled[]>;
}

/** Document › Properties entries worth searching, with the names Bluebeam shows them under. */
const PROPERTY_NAMES: [keyof DocumentInfo, string][] = [
  ['title', 'Title'],
  ['author', 'Author'],
  ['subject', 'Subject'],
  ['keywords', 'Keywords'],
  ['creator', 'Creator'],
  ['producer', 'Producer'],
];

const propertiesOf = (info: DocumentInfo) => Object.fromEntries(PROPERTY_NAMES.flatMap(([k, name]) => (info[k] ? [[name, String(info[k])]] : [])));

const fieldsOf = (model: FormModel | null | undefined): Labelled[] => (model?.fields ?? []).flatMap((f) => (f.value && f.widgets[0] ? [{ pageIndex: f.widgets[0].pageIndex, rect: f.widgets[0].rect, label: f.name, text: f.value }] : []));

const markupsOf = (ms: readonly Markup[]): Labelled[] =>
  ms.flatMap((m) => {
    const text = [m.text, m.comment, ...(m.replies ?? []).map((r) => r.text)].filter(Boolean).join(' · ');
    return text ? [{ pageIndex: m.pageIndex, rect: boundsOf(m.points), label: m.subject || MARKUP_LABELS[m.type], text }] : [];
  });

async function formOf(bytes: () => Promise<ArrayBuffer>): Promise<FormModel | null> {
  try {
    const { readForm } = await import('../documents/forms');
    return await readForm(await bytes());
  } catch {
    // A form that can't be read has nothing to find.
    return null;
  }
}

/** A document open in a tab: its live markups, its form as last read, and its cached text. */
export function openSource(o: { file: StoredFile; doc: PdfDocument; store: MarkupStore }, form: FormModel | undefined, page?: number): SearchSource {
  const bytes = () => readFile(o.file.hash);
  return {
    id: o.file.id,
    name: o.file.name,
    ...(page !== undefined ? { page } : {}),
    text: (report) => loadPageTexts(bytes, o.store, (p) => report(p.done, p.total)),
    properties: async () => propertiesOf(await o.doc.info()),
    fields: async () => fieldsOf(form ?? (await formOf(bytes))),
    markups: async () => markupsOf(o.store.all()),
  };
}

/** A library document that is not open: read from device storage, with its saved markups. */
export function librarySource(file: StoredFile): SearchSource {
  const bytes = () => readFile(file.hash);
  const read = (report: (done: number, total: number) => void = () => {}) => readForSearch(file.hash, bytes, report);
  return {
    id: file.id,
    name: file.name,
    text: async (report) => (await read(report)).pages,
    properties: async () => propertiesOf((await read()).info),
    fields: async () => fieldsOf(await formOf(bytes)),
    markups: async () => {
      const store = await MarkupStore.open(file.id);
      try {
        // The PDF's own markups were imported into the store when it was first opened.
        return markupsOf(store.all());
      } finally {
        void store.destroy();
      }
    },
  };
}

/** A PDF in a folder on disk; `path` is relative to the chosen folder. */
export function fileSource(file: File, path: string): SearchSource {
  const bytes = () => file.arrayBuffer();
  const read = (report: (done: number, total: number) => void = () => {}) => readForSearch(`file:${path}:${file.size}:${file.lastModified}`, bytes, report);
  return {
    id: `file:${path}`,
    name: file.name,
    text: async (report) => (await read(report)).pages,
    properties: async () => propertiesOf((await read()).info),
    fields: async () => fieldsOf(await formOf(bytes)),
    markups: async () => (await read()).notes,
  };
}
