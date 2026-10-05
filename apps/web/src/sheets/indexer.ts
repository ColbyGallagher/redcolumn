import { PdfEngine, type PdfDocument } from '@nb/pdf-core';
import { DEFAULT_STATUSES, importAnnotations, importColumns, statusIdOf, type ImportedExtras, type Markup, type MarkupStore, type StoredStitchGroup } from '@nb/markup';
import { SheetLookup, type DetectedLink } from '@nb/sheets';
import { stitchSet, type StitchPage } from '@nb/stitch';
import { detectLinks, detectSheets, type PageText, type SheetInfo } from '@nb/sheets';

export interface IndexProgress {
  phase: 'annotations' | 'text' | 'links' | 'stitch';
  done: number;
  total: number;
}

/**
 * A second PDF engine for background work (text extraction), so indexing a 500-sheet set never
 * queues behind the viewer's tile renders. One engine is shared by the jobs that run back to back
 * (each loads PDFium afresh otherwise), and shut down once nothing has used it for a while.
 */
const IDLE_MS = 30_000;
let background: PdfEngine | null = null;
let users = 0;
let idleTimer: ReturnType<typeof setTimeout> | undefined;

/** Runs `fn` on `bytes` opened in the background engine; the document is closed afterwards. */
async function withBackgroundDoc<T>(bytes: ArrayBuffer, fn: (doc: PdfDocument) => Promise<T>): Promise<T> {
  clearTimeout(idleTimer);
  if (!background?.alive) background = new PdfEngine();
  const engine = background;
  users++;
  let doc: PdfDocument | null = null;
  try {
    doc = await engine.open(bytes);
    return await fn(doc);
  } finally {
    if (doc) await doc.close().catch(() => {});
    if (--users === 0)
      idleTimer = setTimeout(() => {
        if (users === 0 && background === engine) {
          engine.terminate();
          background = null;
        }
      }, IDLE_MS);
  }
}

/**
 * Text layers extracted this session, by file hash. Extraction means parsing every page, which is
 * the slow part on large sets, so re-running link detection (e.g. after AI fixes sheet numbers)
 * reuses it.
 */
const textCache = new Map<string, PageText[]>();

/** Drops cached text for a document, after its pages changed. */
export function forgetText(fileHash: string) {
  textCache.delete(fileHash);
}

/** Text of every page (cached for the session). `bytes` must return a fresh buffer. */
export async function loadPageTexts(bytes: () => Promise<ArrayBuffer>, store: MarkupStore, onProgress: (p: IndexProgress) => void, signal?: AbortSignal): Promise<PageText[]> {
  return textCache.get(store.fileHash) ?? pageTexts(await bytes(), store, onProgress, signal);
}

async function pageTexts(bytes: ArrayBuffer, store: MarkupStore, onProgress: (p: IndexProgress) => void, signal?: AbortSignal): Promise<PageText[]> {
  const cached = textCache.get(store.fileHash);
  if (cached) return cached;
  return withBackgroundDoc(bytes, async (doc) => {
    const pages: PageText[] = [];
    for (let i = 0; i < doc.pages.length; i++) {
      signal?.throwIfAborted();
      const size = doc.pages[i]!;
      pages.push({ width: size.width, height: size.height, words: await doc.text(i) });
      onProgress({ phase: 'text', done: i + 1, total: doc.pages.length });
    }
    textCache.set(store.fileHash, pages);
    return pages;
  });
}

/**
 * Finds sheet-to-sheet hyperlinks using the current sheet numbers (detected, AI-read or edited).
 * `bytes` must return a fresh buffer on each call (engines take ownership of what they are given);
 * it is only called when this file's text is not already cached.
 */
export async function linkFromText(bytes: () => Promise<ArrayBuffer>, store: MarkupStore, onProgress: (p: IndexProgress) => void, signal?: AbortSignal) {
  const pages = textCache.get(store.fileHash) ?? (await pageTexts(await bytes(), store, onProgress, signal));
  onProgress({ phase: 'links', done: 0, total: 1 });
  const sheets = store.allSheets();
  store.setDetectedLinks(detectLinks(pages, pages.map((_, i) => sheets[i]?.number ?? null)));
}

/**
 * Finds match lines and stitches the sheets they connect into continuous views. Vector geometry
 * is only loaded for sheets whose text mentions a match line, which keeps memory bounded on large
 * sets. `bytes` must return a fresh buffer on each call.
 */
export async function stitchFromText(bytes: () => Promise<ArrayBuffer>, store: MarkupStore, onProgress: (p: IndexProgress) => void, signal?: AbortSignal) {
  const pages = textCache.get(store.fileHash) ?? (await pageTexts(await bytes(), store, onProgress, signal));
  const candidates = pages.flatMap((p, i) => (p.words.some((w) => /^MATCH/i.test(w.text)) ? [i] : []));
  if (candidates.length < 2) {
    store.setStitch([]);
    return;
  }
  await withBackgroundDoc(await bytes(), async (doc) => {
    const stitchPages: StitchPage[] = pages.map((p) => ({ ...p, segments: new Float32Array() }));
    let done = 0;
    for (const i of candidates) {
      signal?.throwIfAborted();
      stitchPages[i]!.segments = (await doc.geometry(i)).segments;
      onProgress({ phase: 'stitch', done: ++done, total: candidates.length });
    }
    const sheets = store.allSheets();
    const result = stitchSet(stitchPages, pages.map((_, i) => sheets[i]?.number ?? null));
    const groups: StoredStitchGroup[] = result.groups.map((g) => ({
      placements: g.placements.map((p) => ({
        pageIndex: p.pageIndex,
        toWorld: [...p.toWorld] as StoredStitchGroup['placements'][number]['toWorld'],
        clips: p.clips.map((c) => ({ point: [...c.point] as [number, number], normal: [...c.normal] as [number, number] })),
      })),
      edges: g.edges.map((e) => ({ a: e.a, b: e.b, station: e.station, votes: e.alignment.votes, confidence: e.alignment.confidence })),
    }));
    store.setStitch(groups);
  });
}

/**
 * One-time import of the PDF's own markups and links into the document's store. `bytes` must
 * return a fresh buffer.
 */
export async function importPdfAnnotations(bytes: () => Promise<ArrayBuffer>, store: MarkupStore, onProgress: (p: IndexProgress) => void, signal?: AbortSignal, keep?: (m: Markup) => boolean) {
  const found = await readPdfAnnotations(await bytes(), store, onProgress, signal);
  store.importAnnotations(keep ? found.markups.filter(keep) : found.markups, found.links, found.imported, found.extras);
  // The PDF's own page labels name pages nothing else has (plain page numbers say nothing).
  const sheets = store.allSheets();
  const labelled = found.labels.flatMap((label, i): [number, SheetInfo][] =>
    label && label !== String(i + 1) && !sheets[i]?.number ? [[i, { number: label, title: sheets[i]?.title ?? null, discipline: sheets[i]?.discipline ?? null, scaleText: sheets[i]?.scaleText ?? null, revision: sheets[i]?.revision ?? null, source: 'pdf', confidence: 1 }]] : [],
  );
  if (labelled.length) store.setDetectedSheets(labelled);
}

/**
 * Markups another PDF tool made, as opposed to ones this app wrote into the PDF (which come back
 * with their own IDs). A Project file's markups are shared live, so only these come from its PDF.
 */
export const fromOtherTools = (m: Markup) => m.id.startsWith('pdf-');

/**
 * A PDF's own markups and links, which of its annotations they stand for (to hide those), and the
 * scales, viewports, custom columns, statuses and Spaces other tools (Bluebeam Revu) record with them.
 */
export async function readPdfAnnotations(bytes: ArrayBuffer, store: MarkupStore, onProgress: (p: IndexProgress) => void = () => {}, signal?: AbortSignal) {
  // Read before the engine takes the buffer; without it markups still import from PDFium's view.
  const { encodePng, readPdfExtras } = await import('@nb/markup/pdfExtras');
  const raw = await readPdfExtras(bytes).catch(() => null);
  if (raw) raw.appearances = new Map();
  return withBackgroundDoc(bytes, async (doc) => {
    const sheets = store.allSheets();
    const lookup = new SheetLookup(doc.pages.map((_, i) => sheets[i]?.number ?? null));
    const markups: Markup[] = [];
    const links: DetectedLink[] = [];
    const imported: Record<number, number[]> = {};
    const extras: ImportedExtras = { scales: {}, viewports: [], spaces: {} };
    const states = new Set<string>();
    const labels = await doc.pageLabels().catch(() => doc.pages.map(() => null));
    for (let i = 0; i < doc.pages.length; i++) {
      signal?.throwIfAborted();
      const annotations = await doc.annotations(i);
      // Other tools' stamps come in as pictures of their own appearance.
      for (const a of annotations) {
        if (!raw || a.subtype !== 'Stamp' || a.appData || a.flags & (1 | 2 | 32)) continue;
        const image = await doc.annotationImage(i, a.index, 3).catch(() => null);
        if (image) raw.appearances!.set(`${i}:${a.index}`, `data:image/png;base64,${toBase64(await encodePng(image.width, image.height, image.rgba))}`);
      }
      const result = importAnnotations(i, annotations, (name) => lookup.find(name), raw);
      markups.push(...result.markups);
      links.push(...result.links);
      if (result.imported.length) imported[i] = result.imported;
      if (result.scale) extras.scales![i] = result.scale;
      extras.viewports!.push(...(result.viewports ?? []));
      for (const s of result.statuses ?? []) states.add(s);
      const spaces = result.markups.flatMap((m) => (m.pdfAnnot?.space ? [m.pdfAnnot.index] : []));
      if (spaces.length) extras.spaces![i] = spaces;
      onProgress({ phase: 'annotations', done: i + 1, total: doc.pages.length });
    }
    if (raw?.columns.length) extras.columns = importColumns(raw.columns);
    const known = new Set(DEFAULT_STATUSES.map((s) => s.id));
    extras.statuses = [...states].filter((s) => !known.has(statusIdOf(s))).map((name) => ({ id: statusIdOf(name), name, color: '#9aa1a9' }));
    return { markups, links, imported, extras, labels };
  });
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Offline pass over the text layer. Fast and free; fills whatever the title blocks make readable. */
export async function indexFromText(bytes: ArrayBuffer, store: MarkupStore, onProgress: (p: IndexProgress) => void, signal?: AbortSignal) {
  const pages = await pageTexts(bytes, store, onProgress, signal);
  store.setDetectedSheets(detectSheets(pages).map((info, i) => [i, info] as [number, SheetInfo]));
  // Text is cached by now, so `bytes` (already handed to an engine) is not read again.
  await linkFromText(async () => bytes, store, onProgress, signal);
}
