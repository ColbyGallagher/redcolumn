import { PdfEngine, type DocumentInfo, type PdfDocument } from '@nb/pdf-core';
import { DEFAULT_STATUSES, importAnnotations, importColumns, importGeoRegions, importStatuses, statusIdOf, type ImportedExtras, type Markup, type MarkupStore, type StoredStitchGroup } from '@nb/markup';
import { DEFAULT_CHAINAGE_HINTS, DEFAULT_LINK_HINTS, detectChainageLinks, idTest, SheetLookup, type DetectedLink, type LinkHints, type SetHints } from '@nb/sheets';
import { stitchSet, type StitchPage } from '@nb/stitch';
import { detectLinks, detectSheets, type PageText, type SheetInfo } from '@nb/sheets';
import { findMarksOnPage, marksToLinks, mayHoldMarks, type MarkHit, type TaughtMark } from './marks';

export interface IndexProgress {
  phase: 'annotations' | 'text' | 'links' | 'marks' | 'stitch';
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

/** What the Search panel reads from a document that is not open: its text, properties and annotation text. */
export interface SearchableDoc {
  pages: PageText[];
  info: DocumentInfo;
  /** Annotations with text (comments, callouts, ...); form widgets and links are left out. */
  notes: { pageIndex: number; rect: { x: number; y: number; w: number; h: number }; label: string; text: string }[];
}

/** Read for searching, by `key` (a file hash, or name + size + date for a file on disk), kept for the session. */
const searchCache = new Map<string, SearchableDoc>();

/** A document's searchable contents, read in the background engine. `bytes` must return a fresh buffer. */
export async function readForSearch(key: string, bytes: () => Promise<ArrayBuffer>, onProgress: (done: number, total: number) => void = () => {}, signal?: AbortSignal): Promise<SearchableDoc> {
  const cached = searchCache.get(key);
  if (cached) return cached;
  const read = await withBackgroundDoc(await bytes(), async (doc) => {
    const known = textCache.get(key);
    const pages: PageText[] = [];
    const notes: SearchableDoc['notes'] = [];
    for (let i = 0; i < doc.pages.length; i++) {
      signal?.throwIfAborted();
      const size = doc.pages[i]!;
      pages.push(known?.[i] ?? { width: size.width, height: size.height, words: await doc.text(i) });
      for (const a of await doc.annotations(i)) if (a.contents.trim() && a.subtype !== 'Widget' && a.subtype !== 'Link' && a.subtype !== 'Popup') notes.push({ pageIndex: i, rect: a.rect, label: a.subtype, text: a.contents });
      onProgress(i + 1, doc.pages.length);
    }
    return { pages, info: await doc.info(), notes };
  });
  searchCache.set(key, read);
  return read;
}

/**
 * Finds sheet-to-sheet hyperlinks using the current sheet numbers (detected, AI-read or edited).
 * `bytes` must return a fresh buffer on each call (engines take ownership of what they are given);
 * it is only called when this file's text is not already cached.
 */
/** `standard`: the drawing standard the document is read with; without one, chainage links wait for review. */
export async function linkFromText(bytes: () => Promise<ArrayBuffer>, store: MarkupStore, onProgress: (p: IndexProgress) => void, signal?: AbortSignal, standard?: SetHints) {
  const pages = textCache.get(store.fileHash) ?? (await pageTexts(await bytes(), store, onProgress, signal));
  onProgress({ phase: 'links', done: 0, total: 1 });
  const sheets = store.allSheets();
  const numbers = pages.map((_, i) => sheets[i]?.number ?? null);
  store.setDetectedLinks([
    ...detectLinks(pages, numbers, standard?.links ?? DEFAULT_LINK_HINTS),
    ...detectChainageLinks(
      pages,
      pages.map((_, i) => sheets[i]),
      standard?.chainage ?? DEFAULT_CHAINAGE_HINTS,
      !!standard,
    ),
  ]);
}

/**
 * Finds the user's taught marks (section marks, titles, detail callouts) in the document and puts
 * every match in the Links tab's Needs review list. Line work is read one page at a time, and only
 * for pages whose text could hold a mark's label. `bytes` must return a fresh buffer on each call.
 */
export async function linkFromMarks(bytes: () => Promise<ArrayBuffer>, store: MarkupStore, marks: readonly TaughtMark[], onProgress: (p: IndexProgress) => void, signal?: AbortSignal, hints: LinkHints = DEFAULT_LINK_HINTS) {
  const pages = textCache.get(store.fileHash) ?? (await pageTexts(await bytes(), store, onProgress, signal));
  const sheets = store.allSheets();
  const numbers = pages.map((_, i) => sheets[i]?.number ?? null);
  const lookup = new SheetLookup(numbers, hints.calloutPart);
  const isId = idTest(hints);
  const hits: MarkHit[] = [];
  const wanted = marks.length ? pages.flatMap((p, i) => (mayHoldMarks(p, lookup, marks, isId) ? [i] : [])) : [];
  const shapes = marks.some((m) => m.lines.length >= 8);
  const search = async (doc: PdfDocument | null) => {
    let done = 0;
    for (const i of wanted) {
      signal?.throwIfAborted();
      const segments = doc ? (await doc.geometry(i)).segments : new Float32Array();
      hits.push(...findMarksOnPage({ ...pages[i]!, segments }, i, lookup, marks, isId));
      onProgress({ phase: 'marks', done: ++done, total: wanted.length });
    }
  };
  if (wanted.length && shapes) await withBackgroundDoc(await bytes(), search);
  else await search(null);
  store.setMarkLinks(marksToLinks(pages, numbers, hits, hints.calloutPart), marks.map((m) => m.id));
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
      edges: g.edges.map((e) => ({
        a: e.a,
        b: e.b,
        station: e.station,
        votes: e.alignment.votes,
        confidence: e.alignment.confidence,
        ...(e.line ? { line: { p0: [...e.line.p0] as [number, number], p1: [...e.line.p1] as [number, number], contentSide: e.line.contentSide } } : {}),
      })),
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
  // The PDF's own page labels were set by a person (in Bluebeam, say), so they win over numbers
  // read from the text; AI and manual numbers still win over them. Plain page numbers say nothing.
  const sheets = store.allSheets();
  const labelled = found.labels.flatMap((label, i): [number, SheetInfo][] =>
    label && label !== String(i + 1) ? [[i, { number: label, title: sheets[i]?.title ?? null, discipline: sheets[i]?.discipline ?? null, scaleText: sheets[i]?.scaleText ?? null, revision: sheets[i]?.revision ?? null, source: 'pdf', confidence: 1 }]] : [],
  );
  if (labelled.length) store.setDetectedSheets(labelled);
}

/**
 * Markups another PDF tool made, as opposed to ones this app wrote into the PDF (which come back
 * with their own IDs). A Project file's markups are shared live, so only these come from its PDF.
 */
export const fromOtherTools = (m: Markup) => m.id.startsWith('pdf-');

/**
 * Image markups an earlier import stored as empty rectangles get their pictures back from the
 * annotation appearance. One pass: markups that already have a picture are left alone.
 */
export async function repairSquareImages(bytes: () => Promise<ArrayBuffer>, store: MarkupStore, signal?: AbortSignal): Promise<void> {
  const { encodePng } = await import('@nb/markup/pdfExtras');
  await withBackgroundDoc(await bytes(), async (doc) => {
    const patches: { id: string; image: string; points: Markup['points'] }[] = [];
    for (let i = 0; i < doc.pages.length; i++) {
      signal?.throwIfAborted();
      for (const a of await doc.annotations(i)) {
        if (a.subtype !== 'Square' || a.intent !== 'SquareImage' || a.appData || a.flags & (1 | 2 | 32)) continue;
        const m = store.all().find((x) => {
          const link = x.pdfAnnot;
          return x.pageIndex === i && !!link && link.index === a.index && link.part == null;
        });
        if (!m || (m.type === 'image' && m.image)) continue;
        const image = await doc.annotationImage(i, a.index, 2).catch(() => null);
        if (!image) continue;
        patches.push({
          id: m.id,
          image: `data:image/png;base64,${toBase64(await encodePng(image.width, image.height, image.rgba))}`,
          points: [[a.rect.x, a.rect.y], [a.rect.x + a.rect.w, a.rect.y + a.rect.h]],
        });
      }
    }
    store.restoreImageMarkups(patches);
  });
}

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
    const states = new Map<string, string>();
    const labels = await doc.pageLabels().catch(() => doc.pages.map(() => null));
    for (let i = 0; i < doc.pages.length; i++) {
      signal?.throwIfAborted();
      const annotations = await doc.annotations(i);
      // Stamps, file attachments, and Bluebeam image markups whose embedded photo was not decoded,
      // come in as a picture of their own appearance. Otherwise a square image is imported as an
      // empty rectangle and the original picture is hidden.
      for (const a of annotations) {
        if (a.appData || a.flags & (1 | 2 | 32)) continue;
        const squareImage = a.subtype === 'Square' && a.intent === 'SquareImage';
        if (a.subtype !== 'Stamp' && a.subtype !== 'FileAttachment' && !squareImage) continue;
        if (squareImage && imageDecoded(raw, i, a)) continue;
        if (!raw && !squareImage) continue;
        const image = await doc.annotationImage(i, a.index, squareImage ? 2 : 3).catch(() => null);
        if (!image) continue;
        const url = `data:image/png;base64,${toBase64(await encodePng(image.width, image.height, image.rgba))}`;
        if (raw) raw.appearances!.set(`${i}:${a.index}`, url);
        else (a as { picture?: string }).picture = url;
      }
      const result = importAnnotations(i, annotations, (name) => lookup.find(name), raw);
      markups.push(...result.markups);
      links.push(...result.links);
      if (result.imported.length) imported[i] = result.imported;
      if (result.scale) extras.scales![i] = result.scale;
      extras.viewports!.push(...(result.viewports ?? []));
      for (const s of result.statuses ?? []) if (!states.has(s.name)) states.set(s.name, s.model);
      const spaces = result.markups.flatMap((m) => (m.pdfAnnot?.space ? [m.pdfAnnot.index] : []));
      if (spaces.length) extras.spaces![i] = spaces;
      onProgress({ phase: 'annotations', done: i + 1, total: doc.pages.length });
    }
    if (raw) extras.geo = raw.pages.flatMap((p, i) => importGeoRegions(i, p));
    if (raw?.columns.length) extras.columns = importColumns(raw.columns);
    if (raw?.assemblies?.length) extras.assemblies = raw.assemblies;
    // Custom status sets' states (with their colours), then any other states markups were set to.
    const sets = importStatuses(raw?.statusDefs ?? []);
    const known = new Set([...DEFAULT_STATUSES, ...sets].map((s) => s.id));
    extras.statuses = [
      ...sets.filter((s) => !DEFAULT_STATUSES.some((d) => d.id === s.id)),
      ...[...states].filter(([name]) => !known.has(statusIdOf(name))).map(([name, model]) => ({ id: statusIdOf(name), name, color: '#9aa1a9', ...(model !== 'Review' ? { model } : {}) })),
    ];
    return { markups, links, imported, extras, labels };
  });
}

/**
 * Reads the file's map registrations (geospatial PDFs) into the store, for documents whose
 * annotations were imported before they were read. A file too large to read records none.
 */
export async function readGeoRegions(bytes: ArrayBuffer, store: MarkupStore) {
  const { readPdfExtras } = await import('@nb/markup/pdfExtras');
  const raw = await readPdfExtras(bytes).catch(() => null);
  store.setGeoRegions(raw ? raw.pages.flatMap((p, i) => importGeoRegions(i, p)) : []);
}

/** True when this image markup's embedded photo was already decoded from the file. */
function imageDecoded(
  raw: { pages: { annots: ({ Image?: unknown } | null)[]; objectNumbers: number[] }[]; images: ReadonlyMap<number, string> } | null,
  pageIndex: number,
  a: { index: number; objectNumber?: number },
): boolean {
  if (!raw) return false;
  const page = raw.pages[pageIndex];
  if (!page) return false;
  let dict = page.annots[a.index] ?? null;
  if (a.objectNumber && page.objectNumbers[a.index] !== a.objectNumber) {
    const at = page.objectNumbers.indexOf(a.objectNumber);
    dict = at >= 0 ? (page.annots[at] ?? null) : null;
  }
  const image = dict?.Image;
  const num = image && typeof image === 'object' && 'num' in image && typeof (image as { num: unknown }).num === 'number' ? (image as { num: number }).num : null;
  return num != null && raw.images.has(num);
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Offline pass over the text layer. Fast and free; fills whatever the title blocks make readable. */
export async function indexFromText(bytes: ArrayBuffer, store: MarkupStore, onProgress: (p: IndexProgress) => void, signal?: AbortSignal, standard?: SetHints) {
  const pages = await pageTexts(bytes, store, onProgress, signal);
  store.setDetectedSheets(detectSheets(pages, standard?.sheets).map((info, i) => [i, info] as [number, SheetInfo]));
  // Text is cached by now, so `bytes` (already handed to an engine) is not read again.
  await linkFromText(async () => bytes, store, onProgress, signal, standard);
}
