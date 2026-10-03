import { PdfEngine, type PdfDocument } from '@nb/pdf-core';
import { importAnnotations, type Markup, type MarkupStore, type StoredStitchGroup } from '@nb/markup';
import { SheetLookup, type DetectedLink } from '@nb/sheets';
import { stitchSet, type StitchPage } from '@nb/stitch';
import { detectLinks, detectSheets, type PageText, type SheetInfo } from '@nb/sheets';
import { isOnline, offlineReason } from '../offline/network';

/** AI service base URL; the dev server proxies /api to services/ai. */
const AI_URL = (import.meta.env.VITE_AI_URL as string | undefined) ?? '/api';
/** Long edge of images sent to the model; larger images are downscaled by the API anyway. */
const IMAGE_PX = 1568;
/** The title block is looked for in the sheet's bottom-right corner (covers right-edge strips too). */
const TITLE_REGION = { x: 0.6, y: 0.6 };
const AI_CONCURRENCY = 3;

/**
 * Rough per-sheet cost for the confirmation prompt: two ~1568 px images (~2.2k tokens each) plus a
 * short structured answer, at Claude Opus 5 list prices ($5 / $25 per million tokens).
 */
export const ESTIMATED_AI_COST_PER_SHEET = (4_600 * 5 + 600 * 25) / 1_000_000;

export interface IndexProgress {
  phase: 'annotations' | 'text' | 'ai' | 'links' | 'stitch';
  done: number;
  total: number;
}

export class AiUnavailableError extends Error {}

/**
 * A second PDF engine for background work (text extraction, rendering images for the model), so
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
export async function importPdfAnnotations(bytes: () => Promise<ArrayBuffer>, store: MarkupStore, onProgress: (p: IndexProgress) => void, signal?: AbortSignal) {
  const { engine, doc } = await openBackgroundDoc(await bytes());
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
    store.importAnnotations(markups, links, imported);
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

async function toJpegBase64(bitmap: ImageBitmap): Promise<string> {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
  bitmap.close();
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

async function renderForModel(doc: PdfDocument, pageIndex: number) {
  const { width, height } = doc.pages[pageIndex]!;
  const pageScale = IMAGE_PX / Math.max(width, height);
  const page = await doc.renderTile(pageIndex, pageScale, 0, 0, Math.ceil(width * pageScale), Math.ceil(height * pageScale));
  // Crop the title-block corner at higher resolution so small title text stays legible.
  const cw = width * (1 - TITLE_REGION.x);
  const ch = height * (1 - TITLE_REGION.y);
  const cropScale = IMAGE_PX / Math.max(cw, ch);
  const crop = await doc.renderTile(pageIndex, cropScale, Math.floor(width * TITLE_REGION.x * cropScale), Math.floor(height * TITLE_REGION.y * cropScale), Math.ceil(cw * cropScale), Math.ceil(ch * cropScale));
  return { page: await toJpegBase64(page.bitmap), titleBlock: await toJpegBase64(crop.bitmap) };
}

async function identify(body: unknown, signal?: AbortSignal): Promise<Omit<SheetInfo, 'source'>> {
  if (!isOnline()) throw new AiUnavailableError(offlineReason('AI indexing'));
  let res: Response;
  try {
    res = await fetch(`${AI_URL}/v1/sheet-index`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new AiUnavailableError('Could not reach the AI service. AI indexing needs an internet connection.');
  }
  const json = (await res.json().catch(() => ({}))) as { error?: string } & Omit<SheetInfo, 'source'>;
  if (res.status === 503 || res.status === 502 || res.status === 504) throw new AiUnavailableError(json.error ?? `AI service unavailable (${res.status}).`);
  if (!res.ok) throw new Error(json.error ?? `AI request failed (${res.status}).`);
  return json;
}

/**
 * Online pass: sends each sheet's image and title-block crop to Claude and records what it reads.
 * Manual edits are never overwritten. Stops early if the service is unreachable or unconfigured.
 */
export async function indexWithAi(
  bytes: ArrayBuffer,
  store: MarkupStore,
  pageIndexes: number[],
  onProgress: (p: IndexProgress) => void,
  signal?: AbortSignal,
): Promise<{ failed: number[] }> {
  const { engine, doc } = await openBackgroundDoc(bytes);
  const queue = [...pageIndexes];
  const failed: number[] = [];
  let done = 0;
  let fatal: unknown = null;
  const worker = async () => {
    while (queue.length && !fatal) {
      const pageIndex = queue.shift()!;
      try {
        signal?.throwIfAborted();
        const hint = store.allSheets()[pageIndex];
        const images = await renderForModel(doc, pageIndex);
        const result = await identify({ ...images, textHint: hint ? { number: hint.number, title: hint.title } : null }, signal);
        store.setDetectedSheets([[pageIndex, { ...result, source: 'ai' }]]);
      } catch (err) {
        if (err instanceof AiUnavailableError || signal?.aborted) fatal = err;
        else {
          console.error(`AI index failed for page ${pageIndex + 1}`, err);
          failed.push(pageIndex);
        }
      }
      onProgress({ phase: 'ai', done: ++done, total: pageIndexes.length });
    }
  };
  try {
    await Promise.all(Array.from({ length: AI_CONCURRENCY }, worker));
  } finally {
    engine.terminate();
  }
  if (fatal) throw fatal;
  return { failed };
}
