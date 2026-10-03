import type { PdfDocument } from '@nb/pdf-core';
import { diffWords, mergeBoxes, type Box, type Difference } from './diff';
import type { CompareWorkRequest } from './compare.worker';
import type { PagePair } from './pairing';
export { pairPages, type PagePair } from './pairing';
import { mapBox, type Affine } from './affine';
export * from './affine';

export interface CompareOptions {
  /** Rendering resolution. */
  dpi: number;
  /** Line up the old page with the new one (for a sheet re-plotted with a different margin). */
  align: boolean;
  /** Largest move searched when aligning, in points. */
  maxShift: number;
  /** Ink within this distance (points) of ink in the other page is not a change. */
  proximity: number;
  /** Changed pixels a cluster cell needs; higher ignores more noise. */
  sensitivity: number;
  /** Cluster size in points: changes this close together are clouded as one. */
  cluster: number;
  graphics: boolean;
  text: boolean;
  /** Only this part of the new page is compared (points). */
  region?: Box | null;
  /**
   * The old page scaled to the new one's size when both have the same shape but not the same
   * size (a sheet printed at another paper size).
   */
  scaleToFit?: boolean;
  /**
   * Where the old page lands on the new one, set by hand (3-point alignment): page space of the
   * old page to page space of the new. Automatic alignment still refines the position after it.
   */
  transform?: Affine | null;
}

const IDENTITY: Affine = [1, 0, 0, 1, 0, 0];
const isIdentity = (m: Affine) => m.every((v, i) => Math.abs(v - IDENTITY[i]!) < 1e-9);

export const DEFAULT_COMPARE: CompareOptions = { dpi: 100, align: true, maxShift: 72, proximity: 1.5, sensitivity: 6, cluster: 12, graphics: true, text: true, region: null };

export interface PageComparison extends PagePair {
  /** Where the old page's content lands on the new page, in points (after any scaling). */
  offset: [number, number];
  /** Old page space to new page space: the scaling or 3-point map, then the offset found. */
  transform: Affine;
  /** In the new page's space (points). */
  differences: Difference[];
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (v: { offset: [number, number]; differences: Difference[] }) => void; reject: (e: Error) => void }>();

function compareWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./compare.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<{ id: number; offset?: [number, number]; differences?: Difference[]; error?: string }>) => {
    const job = pending.get(e.data.id);
    if (!job) return;
    pending.delete(e.data.id);
    if (e.data.error) job.reject(new Error(e.data.error));
    else job.resolve({ offset: e.data.offset!, differences: e.data.differences! });
  };
  return worker;
}

/**
 * Renders a whole page over white, at `scale` pixels per point; with `into`, the page is drawn
 * through `map` (its page space to the other page's) onto a canvas the other page's size.
 */
async function renderPage(doc: PdfDocument, pageIndex: number, scale: number, into?: { width: number; height: number; map: Affine }) {
  const size = doc.pages[pageIndex]!;
  // Drawn through a map, the page is rendered as sharp as it will appear.
  const k = into ? Math.sqrt(Math.abs(into.map[0] * into.map[3] - into.map[1] * into.map[2])) : 1;
  const own = Math.min(scale * k, 7000 / Math.max(size.width, size.height));
  const width = Math.max(1, Math.ceil(size.width * own));
  const height = Math.max(1, Math.ceil(size.height * own));
  const { bitmap } = await doc.renderTile(pageIndex, own, 0, 0, width, height);
  const out = into ? { width: Math.max(1, Math.ceil(into.width * scale)), height: Math.max(1, Math.ceil(into.height * scale)) } : { width, height };
  const canvas = new OffscreenCanvas(out.width, out.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, out.width, out.height);
  if (into) {
    // Pixels of the other page ← its points ← this page's points ← this page's pixels.
    const m = into.map;
    ctx.setTransform((scale * m[0]) / own, (scale * m[1]) / own, (scale * m[2]) / own, (scale * m[3]) / own, scale * m[4], scale * m[5]);
  }
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return { rgba: ctx.getImageData(0, 0, out.width, out.height).data, width: out.width, height: out.height };
}

const scaleBox = <T extends Box>(b: T, k: number): T => ({ ...b, x: b.x * k, y: b.y * k, w: b.w * k, h: b.h * k });

/** Compares one page of the old document with one of the new. */
export async function comparePages(oldDoc: PdfDocument, newDoc: PdfDocument, pair: PagePair, options: CompareOptions): Promise<PageComparison> {
  const oldSize = oldDoc.pages[pair.oldPage]!;
  const newSize = newDoc.pages[pair.newPage]!;
  // Big sheets drop resolution so neither page goes over about 40 megapixels.
  const longest = Math.max(oldSize.width, oldSize.height, newSize.width, newSize.height);
  const scale = Math.min(options.dpi / 72, 7000 / longest);
  // The old page brought onto the new one before comparing: by hand, or scaled to fit.
  let pre: Affine = options.transform ?? IDENTITY;
  if (!options.transform && options.scaleToFit) {
    const kx = newSize.width / oldSize.width;
    const ky = newSize.height / oldSize.height;
    if (Math.abs(kx - ky) / Math.max(kx, ky) < 0.03 && Math.abs(kx - 1) > 0.01) pre = [(kx + ky) / 2, 0, 0, (kx + ky) / 2, 0, 0];
  }
  let offset: [number, number] = [0, 0];
  let differences: Difference[] = [];
  if (options.graphics || options.align) {
    const [old, cur] = await Promise.all([renderPage(oldDoc, pair.oldPage, scale, isIdentity(pre) ? undefined : { width: newSize.width, height: newSize.height, map: pre }), renderPage(newDoc, pair.newPage, scale)]);
    const request: CompareWorkRequest = {
      id: nextId++,
      old,
      cur,
      maxShift: options.align ? Math.round(options.maxShift * scale) : 0,
      diff: options.graphics,
      options: {
        proximity: Math.max(0, Math.round(options.proximity * scale)),
        cell: Math.max(2, Math.round(options.cluster * scale)),
        minPixels: options.sensitivity,
        pad: Math.round(3 * scale),
        region: options.region ? scaleBox(options.region, scale) : null,
      },
    };
    const w = compareWorker();
    const result = await new Promise<{ offset: [number, number]; differences: Difference[] }>((resolve, reject) => {
      pending.set(request.id, { resolve, reject });
      w.postMessage(request, [old.rgba.buffer, cur.rgba.buffer]);
    });
    offset = [result.offset[0] / scale, result.offset[1] / scale];
    if (options.graphics) differences = result.differences.map((d) => scaleBox(d, 1 / scale));
  }
  if (options.text) {
    const [rawOld, newWords] = await Promise.all([oldDoc.text(pair.oldPage), newDoc.text(pair.newPage)]);
    // Old words where they land on the new page before the offset.
    const oldWords = isIdentity(pre)
      ? rawOld
      : rawOld.map((w) => {
          const b = mapBox(pre, { x: w.x0, y: w.y0, w: w.x1 - w.x0, h: w.y1 - w.y0 });
          return { ...w, x0: b.x, y0: b.y, x1: b.x + b.w, y1: b.y + b.h };
        });
    const r = options.region;
    const inside = (w: { x0: number; y0: number }) => !r || (w.x0 >= r.x && w.x0 <= r.x + r.w && w.y0 >= r.y && w.y0 <= r.y + r.h);
    const words = diffWords(oldWords, newWords.filter(inside), offset, Math.max(2, options.proximity * 2)).filter((d) => d.kind !== 'removed' || inside({ x0: d.x, y0: d.y }));
    differences = mergeBoxes([...differences, ...words]);
  }
  const transform: Affine = [pre[0], pre[1], pre[2], pre[3], pre[4] + offset[0], pre[5] + offset[1]];
  return { ...pair, offset, transform, differences };
}
