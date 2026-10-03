/**
 * Symbol Search on scanned sheets: the boxed symbol's pixels matched across a page by normalised
 * cross-correlation (bright paper and dark ink alike, whatever the scan's contrast), coarse first
 * on shrunken images, then refined at full size around each promising spot.
 */

export interface GrayImage {
  width: number;
  height: number;
  /** One byte per pixel, 0 black to 255 white. */
  data: Uint8Array | Uint8ClampedArray;
}

export interface RasterMatch {
  /** Pixel position of the match's top-left corner, in the page image. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Quarter turns of the template that matched (0–3). */
  turns: number;
  /** Correlation, −1 to 1. */
  score: number;
}

export interface RasterSearchOptions {
  /** Correlation a match needs. Default 0.75. */
  threshold?: number;
  /** Also look for the symbol turned by 90°, 180° and 270°. */
  rotations?: boolean;
}

/** Luminance (0–255) from RGBA pixels. */
export function toGray(rgba: ArrayLike<number>, width: number, height: number): GrayImage {
  const data = new Uint8Array(width * height);
  for (let i = 0; i < data.length; i++) data[i] = (rgba[i * 4]! * 299 + rgba[i * 4 + 1]! * 587 + rgba[i * 4 + 2]! * 114) / 1000;
  return { width, height, data };
}

/** Part of an image. */
export function crop(img: GrayImage, x: number, y: number, w: number, h: number): GrayImage {
  const out = new Uint8Array(w * h);
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) out[r * w + c] = img.data[(y + r) * img.width + (x + c)] ?? 255;
  return { width: w, height: h, data: out };
}

/** Shrinks by a whole factor, averaging each block. */
export function shrink(img: GrayImage, f: number): GrayImage {
  if (f <= 1) return img;
  const w = Math.max(1, Math.floor(img.width / f));
  const h = Math.max(1, Math.floor(img.height / f));
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let dy = 0; dy < f; dy++) for (let dx = 0; dx < f; dx++) sum += img.data[(y * f + dy) * img.width + x * f + dx]!;
      out[y * w + x] = sum / (f * f);
    }
  return { width: w, height: h, data: out };
}

/** The image turned a quarter turn clockwise. */
export function turn(img: GrayImage): GrayImage {
  const { width: w, height: h } = img;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[x * h + (h - 1 - y)] = img.data[y * w + x]!;
  return { width: h, height: w, data: out };
}

/** Correlation of the template with the page at (x, y); null over flat page areas. */
function ncc(page: GrayImage, t: GrayImage, tMean: number, tNorm: number, x: number, y: number): number | null {
  let sum = 0;
  let sum2 = 0;
  let cross = 0;
  const n = t.width * t.height;
  for (let r = 0; r < t.height; r++) {
    const row = (y + r) * page.width + x;
    const trow = r * t.width;
    for (let c = 0; c < t.width; c++) {
      const p = page.data[row + c]!;
      sum += p;
      sum2 += p * p;
      cross += p * (t.data[trow + c]! - tMean);
    }
  }
  const variance = sum2 - (sum * sum) / n;
  if (variance < n * 4) return null; // blank paper
  return cross / (Math.sqrt(variance) * tNorm);
}

function stats(t: GrayImage) {
  let sum = 0;
  for (const v of t.data) sum += v;
  const mean = sum / t.data.length;
  let norm = 0;
  for (const v of t.data) norm += (v - mean) * (v - mean);
  return { mean, norm: Math.sqrt(norm) };
}

/** Every place the template appears on the page (the original included), best first per spot. */
export function rasterSearch(page: GrayImage, template: GrayImage, options: RasterSearchOptions = {}): RasterMatch[] {
  const threshold = options.threshold ?? 0.75;
  const templates = [template];
  if (options.rotations) for (let k = 1; k < 4; k++) templates.push(turn(templates[k - 1]!));
  // Shrink so the template is about 12 pixels across for the coarse pass.
  const f = Math.max(1, Math.floor(Math.min(template.width, template.height) / 12));
  const small = shrink(page, f);
  const found: RasterMatch[] = [];
  templates.forEach((t, turns) => {
    const st = stats(t);
    if (st.norm < 1) return;
    const ts = shrink(t, f);
    const sts = stats(ts);
    if (sts.norm < 1) return;
    const coarse: [number, number][] = [];
    for (let y = 0; y + ts.height <= small.height; y++)
      for (let x = 0; x + ts.width <= small.width; x++) {
        const s = ncc(small, ts, sts.mean, sts.norm, x, y);
        if (s !== null && s >= threshold - 0.15) coarse.push([x, y]);
      }
    // Refine each candidate at full size within one coarse pixel.
    for (const [cx, cy] of coarse) {
      let best: RasterMatch | null = null;
      for (let y = Math.max(0, cy * f - f); y <= Math.min(page.height - t.height, cy * f + f); y++)
        for (let x = Math.max(0, cx * f - f); x <= Math.min(page.width - t.width, cx * f + f); x++) {
          const s = ncc(page, t, st.mean, st.norm, x, y);
          if (s !== null && s >= threshold && (!best || s > best.score)) best = { x, y, w: t.width, h: t.height, turns, score: s };
        }
      if (best) found.push(best);
    }
  });
  // One match per place.
  const out: RasterMatch[] = [];
  for (const m of found.sort((a, b) => b.score - a.score)) {
    if (!out.some((o) => Math.abs(o.x + o.w / 2 - (m.x + m.w / 2)) < Math.min(o.w, m.w) / 2 && Math.abs(o.y + o.h / 2 - (m.y + m.h / 2)) < Math.min(o.h, m.h) / 2)) out.push(m);
  }
  return out.sort((a, b) => a.y - b.y || a.x - b.x);
}
