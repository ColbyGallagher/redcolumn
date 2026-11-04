/// <reference lib="webworker" />
import { coarsen, diffMasks, diffWords, findOffset, inkMask, mergeBoxes, type Box, type DiffOptions, type Difference, type Word } from './diff';

export interface CompareWorkRequest {
  id: number;
  /** Both pages rendered, when graphics are compared or the pages lined up; else null. */
  pixels: {
    old: { rgba: Uint8ClampedArray; width: number; height: number };
    cur: { rgba: Uint8ClampedArray; width: number; height: number };
    /** Pixels per point of the renderings. */
    scale: number;
    /** Largest shift searched when aligning, in pixels; 0 for no alignment. */
    maxShift: number;
    /** False to only line the pages up (Overlay Pages). */
    diff: boolean;
    options: Omit<DiffOptions, 'offset'>;
  } | null;
  /** Text compare, in points: old words already where they land before the offset. */
  words: { old: Word[]; cur: Word[]; tolerance: number; region: Box | null } | null;
  /** Most differences kept for the page; more are merged into bigger boxes. */
  max: number;
}

export interface CompareWorkResult {
  id: number;
  /** Where the old page lands on the new one, in points. */
  offset: [number, number];
  /** In the new page's points. */
  differences: Difference[];
  /** How many differences were found before merging down to `max`. */
  found: number;
  error?: string;
}

const scaleBox = <T extends Box>(b: T, k: number): T => ({ ...b, x: b.x * k, y: b.y * k, w: b.w * k, h: b.h * k });

/** The work of Compare Documents for one pair of pages, off the main thread. */
self.onmessage = (e: MessageEvent<CompareWorkRequest>) => {
  const { id, pixels, words, max } = e.data;
  try {
    let offset: [number, number] = [0, 0];
    let differences: Difference[] = [];
    if (pixels) {
      const { old, cur, scale, maxShift, diff, options } = pixels;
      const a = inkMask(old.rgba, old.width, old.height);
      const b = inkMask(cur.rgba, cur.width, cur.height);
      const px = maxShift > 0 ? findOffset(a, b, maxShift) : ([0, 0] as [number, number]);
      offset = [px[0] / scale, px[1] / scale];
      if (diff) differences = diffMasks(a, b, { ...options, offset: px }).map((d) => scaleBox(d, 1 / scale));
    }
    if (words) {
      const r = words.region;
      const inside = (w: { x0: number; y0: number }) => !r || (w.x0 >= r.x && w.x0 <= r.x + r.w && w.y0 >= r.y && w.y0 <= r.y + r.h);
      const changed = diffWords(words.old, words.cur.filter(inside), offset, words.tolerance).filter((d) => d.kind !== 'removed' || inside({ x0: d.x, y0: d.y }));
      differences = mergeBoxes([...differences, ...changed]);
    }
    const found = differences.length;
    self.postMessage({ id, offset, differences: coarsen(differences, max), found } satisfies CompareWorkResult);
  } catch (err) {
    self.postMessage({ id, offset: [0, 0], differences: [], found: 0, error: err instanceof Error ? err.message : String(err) } satisfies CompareWorkResult);
  }
};
