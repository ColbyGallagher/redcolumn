import { PDFDocument, type PDFPage } from 'pdf-lib';
import { applyMatrix, pageMatrix } from '@nb/markup/export';
import { openForEdit } from './incremental';

/** A rectangle in page space: points, origin at the top-left of the displayed (rotated) page. */
export interface PageRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** How content on a page moved in page space: `p → p × scale + (dx, dy)`. */
export interface PageTransform {
  scale: number;
  dx: number;
  dy: number;
}

/** A page's displayed size (its crop box, turned by /Rotate). */
export function displayedSize(page: PDFPage): { width: number; height: number } {
  const { width, height } = page.getCropBox();
  const turned = page.getRotation().angle % 180 !== 0;
  return turned ? { width: height, height: width } : { width, height };
}

/**
 * Replace Pages: pages `targetPages` of the document become pages `sourcePages` of `source`, in
 * order (the two lists are the same length). Markups stay on the same page numbers.
 */
export async function replacePages(target: ArrayBuffer | Uint8Array, source: ArrayBuffer | Uint8Array, targetPages: readonly number[], sourcePages: readonly number[]): Promise<Uint8Array> {
  if (targetPages.length !== sourcePages.length) throw new Error('Replace needs as many new pages as pages being replaced');
  const { doc, save } = await openForEdit(target);
  const src = await PDFDocument.load(source, { ignoreEncryption: true });
  const copies = await doc.copyPages(src, [...sourcePages]);
  targetPages.forEach((at, i) => {
    doc.removePage(at);
    doc.insertPage(at, copies[i]!);
  });
  return save();
}

/** Pages `sourcePages` of `source` added after the document's last page. */
export async function appendPages(target: ArrayBuffer | Uint8Array, source: ArrayBuffer | Uint8Array, sourcePages: readonly number[]): Promise<Uint8Array> {
  const { doc, save } = await openForEdit(target);
  const src = await PDFDocument.load(source, { ignoreEncryption: true });
  for (const page of await doc.copyPages(src, [...sourcePages])) doc.addPage(page);
  return save();
}

/**
 * Crop Pages: each page's crop box becomes `rect` (page space). Returns how page-space content
 * moved, so markups can follow.
 */
export async function cropPages(bytes: ArrayBuffer | Uint8Array, crops: ReadonlyMap<number, PageRect>): Promise<{ bytes: Uint8Array; transforms: Map<number, PageTransform> }> {
  const { doc, save } = await openForEdit(bytes);
  const pages = doc.getPages();
  const transforms = new Map<number, PageTransform>();
  for (const [i, r] of crops) {
    const page = pages[i];
    if (!page || r.w <= 0 || r.h <= 0) continue;
    const m = pageMatrix(page);
    const a = applyMatrix(m, [r.x, r.y]);
    const b = applyMatrix(m, [r.x + r.w, r.y + r.h]);
    const x = Math.min(a[0], b[0]);
    const y = Math.min(a[1], b[1]);
    page.setCropBox(x, y, Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
    // The displayed page now starts at the crop's top-left corner.
    transforms.set(i, { scale: 1, dx: -r.x, dy: -r.y });
  }
  return { bytes: await save(), transforms };
}

/**
 * Crop rectangles from margins (points) trimmed off each edge of the displayed page.
 */
export function marginRect(size: { width: number; height: number }, m: { top: number; right: number; bottom: number; left: number }): PageRect | null {
  const w = size.width - m.left - m.right;
  const h = size.height - m.top - m.bottom;
  return w > 1 && h > 1 ? { x: m.left, y: m.top, w, h } : null;
}

/**
 * Page Setup: each page becomes a new page of `size` (displayed, points) with the old page's content
 * centred on it, scaled to fit (`fit`) or at full size. Rotation is kept. Returns how page-space
 * content moved.
 */
export async function resizePages(bytes: ArrayBuffer | Uint8Array, pages: readonly number[], size: { width: number; height: number }, fit: boolean): Promise<{ bytes: Uint8Array; transforms: Map<number, PageTransform> }> {
  const { doc, save } = await openForEdit(bytes);
  const all = doc.getPages();
  const transforms = new Map<number, PageTransform>();
  for (const i of [...pages].sort((a, b) => a - b)) {
    const old = all[i];
    if (!old) continue;
    const shown = displayedSize(old);
    const scale = fit ? Math.min(size.width / shown.width, size.height / shown.height) : 1;
    const box = old.getCropBox();
    // A blank page (no content stream) has nothing to place.
    const embedded = old.node.Contents() ? await doc.embedPage(old, { left: box.x, bottom: box.y, right: box.x + box.width, top: box.y + box.height }) : null;
    const angle = old.getRotation().angle;
    const turned = angle % 180 !== 0;
    // The new page in user space (before its /Rotate), with the old content centred on it.
    const uw = turned ? size.height : size.width;
    const uh = turned ? size.width : size.height;
    const page = doc.insertPage(i, [uw, uh]);
    page.setRotation(old.getRotation());
    if (embedded) page.drawPage(embedded, { x: (uw - box.width * scale) / 2, y: (uh - box.height * scale) / 2, xScale: scale, yScale: scale });
    doc.removePage(i + 1);
    // Centred, so in the displayed page the content is scaled about the new page's centre.
    transforms.set(i, { scale, dx: (size.width - shown.width * scale) / 2, dy: (size.height - shown.height * scale) / 2 });
  }
  return { bytes: await save(), transforms };
}

/** New PDFs made of the given page lists (Split Document, one file per page). */
export async function splitPdf(bytes: ArrayBuffer | Uint8Array, parts: readonly (readonly number[])[]): Promise<Uint8Array[]> {
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const out: Uint8Array[] = [];
  for (const pages of parts) {
    const doc = await PDFDocument.create();
    for (const p of await doc.copyPages(src, [...pages])) doc.addPage(p);
    out.push(await doc.save());
  }
  return out;
}

/** Page lists of `size` pages each, for splitting a `count`-page document. */
export function chunkPages(count: number, size: number): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < count; i += Math.max(1, size)) out.push(Array.from({ length: Math.min(size, count - i) }, (_, k) => i + k));
  return out;
}

/** Page lists that start at each of `starts` (e.g. top-level bookmarks) and run to the next. */
export function rangesFromStarts(count: number, starts: readonly number[]): number[][] {
  const s = [...new Set(starts.filter((p) => p >= 0 && p < count))].sort((a, b) => a - b);
  if (!s.length || s[0] !== 0) s.unshift(0);
  return s.map((from, i) => Array.from({ length: (s[i + 1] ?? count) - from }, (_, k) => from + k));
}

/**
 * Splits into files of at most `maxBytes` each, taking pages in order: a part grows a page at a time
 * until the next page would push it over. A single page larger than the limit gets a file of its own.
 */
export async function splitPdfBySize(bytes: ArrayBuffer | Uint8Array, maxBytes: number): Promise<{ parts: Uint8Array[]; ranges: number[][] }> {
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const parts: Uint8Array[] = [];
  const ranges: number[][] = [];
  let doc: PDFDocument | null = null;
  let pages: number[] = [];
  let saved: Uint8Array | null = null;
  for (let p = 0; p < src.getPageCount(); p++) {
    doc ??= await PDFDocument.create();
    const [copy] = await doc.copyPages(src, [p]);
    doc.addPage(copy!);
    const next = await doc.save();
    if (next.length > maxBytes && saved) {
      // Close the part without this page (the saved copy from before it), and start the next with it.
      parts.push(saved);
      ranges.push(pages);
      doc = await PDFDocument.create();
      const [again] = await doc.copyPages(src, [p]);
      doc.addPage(again!);
      saved = await doc.save();
      pages = [p];
    } else {
      saved = next;
      pages.push(p);
    }
  }
  if (saved) {
    parts.push(saved);
    ranges.push(pages);
  }
  return { parts, ranges };
}

/** How split parts are named: the number (`#`) pattern before or after the file name, or bookmark titles. */
export interface SplitNaming {
  mode: 'prefix' | 'suffix' | 'bookmarks';
  /** `#` marks where the part number goes; without one, the number goes at the end. */
  pattern: string;
}

/** A split part's file name (without `.pdf`), numbered from 1 and zero-padded so the files sort in order. */
export function splitPartName(base: string, index: number, total: number, naming: SplitNaming, bookmarkTitle?: string): string {
  const safe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '-').trim();
  const num = String(index + 1).padStart(String(total).length, '0');
  if (naming.mode === 'bookmarks' && bookmarkTitle?.trim()) return `${num} ${safe(bookmarkTitle)}`;
  const raw = naming.pattern.trim() || '#';
  const label = safe(raw.includes('#') ? raw.replace(/#/g, num) : `${raw}${num}`);
  return naming.mode === 'prefix' ? `${label} ${safe(base)}` : `${safe(base)} ${label}`;
}

/** Split Document's choices: every N pages, files up to a size, or at top-level bookmarks. */
export interface SplitSpec {
  by: 'count' | 'size' | 'bookmarks';
  count: number;
  /** Largest file, in megabytes, when splitting by size. */
  maxMb: number;
  naming: SplitNaming;
}

/** Splits a document as `spec` says, returning each part with its file name. */
export async function splitDocument(
  bytes: ArrayBuffer | Uint8Array,
  base: string,
  bookmarks: readonly { pageIndex: number; title: string }[],
  spec: SplitSpec,
): Promise<{ name: string; data: Uint8Array }[]> {
  const count = (await PDFDocument.load(bytes, { ignoreEncryption: true })).getPageCount();
  const marks = [...bookmarks].sort((a, b) => a.pageIndex - b.pageIndex);
  if (spec.by === 'bookmarks' && !marks.length) throw new Error('No bookmarks to split at');
  let parts: Uint8Array[];
  let ranges: number[][];
  if (spec.by === 'size') ({ parts, ranges } = await splitPdfBySize(bytes, Math.max(0.01, spec.maxMb) * 1024 * 1024));
  else {
    ranges = spec.by === 'bookmarks' ? rangesFromStarts(count, marks.map((b) => b.pageIndex)) : chunkPages(count, spec.count);
    parts = await splitPdf(bytes, ranges);
  }
  return parts.map((data, i) => {
    const title = spec.by === 'bookmarks' ? marks.find((b) => b.pageIndex === ranges[i]![0])?.title : undefined;
    return { name: `${splitPartName(base, i, parts.length, spec.naming, title)}.pdf`, data };
  });
}
