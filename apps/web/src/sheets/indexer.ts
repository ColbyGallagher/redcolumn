import { PdfEngine, type PdfDocument } from '@nb/pdf-core';
import { importAnnotations, type Markup, type MarkupStore, type StoredStitchGroup } from '@nb/markup';
import { SheetLookup, type DetectedLink } from '@nb/sheets';
import { stitchSet, type StitchPage } from '@nb/stitch';
import { detectLinks, detectSheets, type PageText, type SheetInfo } from '@nb/sheets';

export interface IndexProgress {
  phase: 'annotations' | 'text' | 'links' | 'stitch';
  done: number;
  total: number;
}

/**
 * A second PDF engine for background work (text extraction), so
 * indexing a 500-sheet set never queues behind the viewer's tile renders.
 */
async function openBackgroundDoc(bytes: ArrayBuffer): Promise<{ engine: PdfEngine; doc: PdfDocument }> {
  const engine = new PdfEngine();
  try {
    return { engine, doc: await engine.open(bytes) };
  } catch (err) {
    engine.terminate();
    throw err;
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
  const { engine, doc } = await openBackgroundDoc(bytes);
  try {
    const pages: PageText[] = [];
    for (let i = 0; i < doc.pages.length; i++) {
      signal?.throwIfAborted();
      const size = doc.pages[i]!;
      pages.push({ width: size.width, height: size.height, words: await doc.text(i) });
      onProgress({ phase: 'text', done: i + 1, total: doc.pages.length });
    }
    textCache.set(store.fileHash, pages);
    return pages;
  } finally {
    engine.terminate();
  }
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
  const { engine, doc } = await openBackgroundDoc(await bytes());
  try {
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
  } finally {
    engine.terminate();
  }
}

/**
 * One-time import of the PDF's own markups and links into the document's store. `bytes` must
 * return a fresh buffer.
 */
export async function importPdfAnnotations(bytes: () => Promise<ArrayBuffer>, store: MarkupStore, onProgress: (p: IndexProgress) => void, signal?: AbortSignal, keep?: (m: Markup) => boolean) {
  const found = await readPdfAnnotations(await bytes(), store, onProgress, signal);
  store.importAnnotations(keep ? found.markups.filter(keep) : found.markups, found.links, found.imported);
}

/**
 * Markups another PDF tool made, as opposed to ones this app wrote into the PDF (which come back
 * with their own IDs). A Project file's markups are shared live, so only these come from its PDF.
 */
export const fromOtherTools = (m: Markup) => m.id.startsWith('pdf-');

/** A PDF's own markups and links, and which of its annotations they stand for (to hide those). */
export async function readPdfAnnotations(bytes: ArrayBuffer, store: MarkupStore, onProgress: (p: IndexProgress) => void = () => {}, signal?: AbortSignal) {
  const { engine, doc } = await openBackgroundDoc(bytes);
  const sheets = store.allSheets();
  const lookup = new SheetLookup(doc.pages.map((_, i) => sheets[i]?.number ?? null));
  try {
    const markups: Markup[] = [];
    const links: DetectedLink[] = [];
    const imported: Record<number, number[]> = {};
    for (let i = 0; i < doc.pages.length; i++) {
      signal?.throwIfAborted();
      const result = importAnnotations(i, await doc.annotations(i), (name) => lookup.find(name));
      markups.push(...result.markups);
      links.push(...result.links);
      if (result.imported.length) imported[i] = result.imported;
      onProgress({ phase: 'annotations', done: i + 1, total: doc.pages.length });
    }
    return { markups, links, imported };
  } finally {
    engine.terminate();
  }
}

/** Offline pass over the text layer. Fast and free; fills whatever the title blocks make readable. */
export async function indexFromText(bytes: ArrayBuffer, store: MarkupStore, onProgress: (p: IndexProgress) => void, signal?: AbortSignal) {
  const pages = await pageTexts(bytes, store, onProgress, signal);
  store.setDetectedSheets(detectSheets(pages).map((info, i) => [i, info] as [number, SheetInfo]));
  // Text is cached by now, so `bytes` (already handed to an engine) is not read again.
  await linkFromText(async () => bytes, store, onProgress, signal);
}
