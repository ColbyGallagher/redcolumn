/**
 * Ink-mask primitives for aligning two renderings of a drawing. Everything here works on plain
 * typed arrays so it runs in both browser workers and Node without DOM or canvas APIs.
 */

import { applyAffine, affineScale, type Affine, type Box } from './affine.ts';

/** A binary mask: one byte per pixel, 1 where there is ink. */
export interface Mask {
  width: number;
  height: number;
  data: Uint8Array;
}

/** Overlap quality between two aligned ink masks. */
export interface MaskOverlapMetrics {
  oldInk: number;
  newInk: number;
  matchedOld: number;
  matchedNew: number;
  /** Fraction of old ink covered by (dilated) new ink. */
  recall: number;
  /** Fraction of new ink covered by (dilated) old ink. */
  precision: number;
  /** Harmonic mean of recall and precision (0 when either is 0). */
  f1: number;
}

/** Ink where a pixel is darker than `threshold` (0–255 luminance) and not transparent. */
export function inkMask(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number, threshold = 200): Mask {
  const data = new Uint8Array(width * height);
  for (let i = 0, p = 0; p < data.length; p++, i += 4) {
    const a = rgba[i + 3]!;
    if (a < 32) continue;
    // Composite over white, then luminance.
    const k = a / 255;
    const lum = (0.299 * rgba[i]! + 0.587 * rgba[i + 1]! + 0.114 * rgba[i + 2]!) * k + 255 * (1 - k);
    if (lum < threshold) data[p] = 1;
  }
  return { width, height, data };
}

/** Total ink pixel count in a mask. */
export function inkCount(mask: Mask): number {
  let n = 0;
  for (let i = 0; i < mask.data.length; i++) if (mask.data[i]) n++;
  return n;
}

/** Grows ink by `r` pixels in every direction (a square), so near misses still count as a match. */
export function dilate(mask: Mask, r: number): Mask {
  if (r <= 0) return mask;
  const { width: w, height: h, data } = mask;
  // Separable: rows, then columns, each with a running count over the window.
  const rows = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const o = y * w;
    let count = 0;
    for (let x = 0; x < Math.min(r, w); x++) count += data[o + x]!;
    for (let x = 0; x < w; x++) {
      if (x + r < w) count += data[o + x + r]!;
      if (x - r - 1 >= 0) count -= data[o + x - r - 1]!;
      rows[o + x] = count > 0 ? 1 : 0;
    }
  }
  const out = new Uint8Array(w * h);
  for (let x = 0; x < w; x++) {
    let count = 0;
    for (let y = 0; y < Math.min(r, h); y++) count += rows[y * w + x]!;
    for (let y = 0; y < h; y++) {
      if (y + r < h) count += rows[(y + r) * w + x]!;
      if (y - r - 1 >= 0) count -= rows[(y - r - 1) * w + x]!;
      out[y * w + x] = count > 0 ? 1 : 0;
    }
  }
  return { width: w, height: h, data: out };
}

/** Shrinks a mask by `f`: a cell has ink if any pixel in it does. */
export function shrink(mask: Mask, f: number): Mask {
  if (f <= 1) return mask;
  const width = Math.ceil(mask.width / f);
  const height = Math.ceil(mask.height / f);
  const data = new Uint8Array(width * height);
  for (let y = 0; y < mask.height; y++) {
    const row = y * mask.width;
    const out = Math.floor(y / f) * width;
    for (let x = 0; x < mask.width; x++) if (mask.data[row + x]) data[out + Math.floor(x / f)] = 1;
  }
  return { width, height, data };
}

/** Ink pixels of `a` that land on ink of `b` when `a` is moved by (dx, dy). */
export function overlap(a: Mask, b: Mask, dx: number, dy: number): number {
  let n = 0;
  const y0 = Math.max(0, -dy);
  const y1 = Math.min(a.height, b.height - dy);
  const x0 = Math.max(0, -dx);
  const x1 = Math.min(a.width, b.width - dx);
  for (let y = y0; y < y1; y++) {
    const ra = y * a.width;
    const rb = (y + dy) * b.width + dx;
    for (let x = x0; x < x1; x++) if (a.data[ra + x] && b.data[rb + x]) n++;
  }
  return n;
}

/**
 * The move (in pixels) that best lines the old page `a` up with the new page `b`, within
 * `maxShift` pixels either way. Searched coarse to fine so large shifts stay cheap.
 */
export function findOffset(a: Mask, b: Mask, maxShift: number): [dx: number, dy: number] {
  let best: [number, number] = [0, 0];
  // Start at a size where the search window is about ±24 cells, then halve down to full size.
  let f = 1;
  while (maxShift / f > 24 && f < 64) f *= 2;
  let range = Math.ceil(maxShift / f);
  for (; f >= 1; f /= 2) {
    const sa = shrink(a, f);
    const sb = shrink(b, f);
    const cx = Math.round(best[0] / f);
    const cy = Math.round(best[1] / f);
    // Ties go to the smallest move, so a blank or symmetric page stays where it is.
    let top = -1;
    let at: [number, number] = [cx, cy];
    for (let dy = cy - range; dy <= cy + range; dy++)
      for (let dx = cx - range; dx <= cx + range; dx++) {
        const score = overlap(sa, sb, dx, dy);
        const better = score > top || (score === top && Math.hypot(dx, dy) < Math.hypot(at[0], at[1]));
        if (better) {
          top = score;
          at = [dx, dy];
        }
      }
    best = [at[0] * f, at[1] * f];
    // The next finer level only needs to look around this answer.
    range = 2;
  }
  return best;
}

/** Copies mask `a` shifted by `(dx, dy)` pixels into a new mask of size `(width, height)`. */
export function shiftMask(a: Mask, dx: number, dy: number, width: number, height: number): Mask {
  const data = new Uint8Array(width * height);
  const ix = Math.round(dx);
  const iy = Math.round(dy);
  const y0 = Math.max(0, -iy);
  const y1 = Math.min(a.height, height - iy);
  const x0 = Math.max(0, -ix);
  const x1 = Math.min(a.width, width - ix);
  for (let y = y0; y < y1; y++) {
    const src = y * a.width;
    const dst = (y + iy) * width + ix;
    for (let x = x0; x < x1; x++) if (a.data[src + x]) data[dst + x] = 1;
  }
  return { width, height, data };
}

/**
 * Warps an ink mask from old-page pixel space (at `oldScale` px/pt) into new-page pixel space
 * (at `newScale` px/pt) through `map` (old-page points -> new-page points). Forward-splats ink
 * pixels so thin 1 px CAD lines survive both downscaling and upscaling.
 */
export function warpMask(mask: Mask, oldScale: number, map: Affine, newScale: number, outWidth: number, outHeight: number): Mask {
  const data = new Uint8Array(outWidth * outHeight);
  const pixelScale = (affineScale(map) * newScale) / oldScale;
  const radius = pixelScale > 1.25 ? Math.floor((pixelScale - 1) / 2) + 1 : 0;
  // Combined matrix from old pixels -> new pixels: S_new * map * S_old^-1.
  const k = newScale / oldScale;
  const m0 = map[0] * k;
  const m1 = map[1] * k;
  const m2 = map[2] * k;
  const m3 = map[3] * k;
  const m4 = map[4] * newScale;
  const m5 = map[5] * newScale;
  const { width: w, height: h, data: src } = mask;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    const py = y + 0.5;
    for (let x = 0; x < w; x++) {
      if (!src[row + x]) continue;
      const px = x + 0.5;
      const nx = Math.floor(m0 * px + m2 * py + m4);
      const ny = Math.floor(m1 * px + m3 * py + m5);
      if (radius === 0) {
        if (nx >= 0 && nx < outWidth && ny >= 0 && ny < outHeight) data[ny * outWidth + nx] = 1;
      } else {
        const x0 = Math.max(0, nx - radius);
        const x1 = Math.min(outWidth - 1, nx + radius);
        const y0 = Math.max(0, ny - radius);
        const y1 = Math.min(outHeight - 1, ny + radius);
        for (let oy = y0; oy <= y1; oy++) {
          const dst = oy * outWidth;
          for (let ox = x0; ox <= x1; ox++) data[dst + ox] = 1;
        }
      }
    }
  }
  return { width: outWidth, height: outHeight, data };
}

/** Computes overlap metrics from pre-aligned, same-size masks and their dilated counterparts. */
export function overlapMetricsFromDilated(oldAligned: Mask, newMask: Mask, dilatedOld: Mask, dilatedNew: Mask, region?: Box | null): MaskOverlapMetrics {
  const x0 = region ? Math.max(0, Math.floor(region.x)) : 0;
  const y0 = region ? Math.max(0, Math.floor(region.y)) : 0;
  const x1 = region ? Math.min(newMask.width, Math.ceil(region.x + region.w)) : newMask.width;
  const y1 = region ? Math.min(newMask.height, Math.ceil(region.y + region.h)) : newMask.height;
  let oldInk = 0;
  let newInk = 0;
  let matchedOld = 0;
  let matchedNew = 0;
  const w = newMask.width;
  for (let y = y0; y < y1; y++) {
    const row = y * w;
    for (let x = x0; x < x1; x++) {
      const p = row + x;
      const a = oldAligned.data[p]!;
      const b = newMask.data[p]!;
      if (a) {
        oldInk++;
        if (dilatedNew.data[p]) matchedOld++;
      }
      if (b) {
        newInk++;
        if (dilatedOld.data[p]) matchedNew++;
      }
    }
  }
  const recall = oldInk > 0 ? matchedOld / oldInk : 0;
  const precision = newInk > 0 ? matchedNew / newInk : 0;
  const f1 = recall + precision > 0 ? (2 * recall * precision) / (recall + precision) : 0;
  return { oldInk, newInk, matchedOld, matchedNew, recall, precision, f1 };
}

/**
 * Measures ink overlap between `a` (shifted by `dx, dy` pixels) and `b` within `proximity` pixels,
 * optionally restricted to pixel `region` in `b`'s frame.
 */
export function measureMaskOverlap(a: Mask, b: Mask, dx = 0, dy = 0, proximity = 1, region?: Box | null): MaskOverlapMetrics {
  const aligned = dx === 0 && dy === 0 && a.width === b.width && a.height === b.height ? a : shiftMask(a, dx, dy, b.width, b.height);
  const dilatedOld = dilate(aligned, proximity);
  const dilatedNew = dilate(b, proximity);
  return overlapMetricsFromDilated(aligned, b, dilatedOld, dilatedNew, region);
}

/** Maps a pixel box through an affine transform in page space (helper for tests/diagnostics). */
export function mapMaskPoint(m: Affine, x: number, y: number): [number, number] {
  return applyAffine(m, [x, y]);
}
