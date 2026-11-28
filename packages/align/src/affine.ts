/** Affine maps between two pages' spaces (points, y down), for aligning revisions. */

import { apply as applyAffine, IDENTITY, type Affine } from '@nb/stitch';

export { apply as applyAffine, compose as composeAffine, invert as invertAffine, scaleOf as affineScale, IDENTITY, type Affine, type Vec } from '@nb/stitch';

/** Axis-aligned rectangle in page points or pixels. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Page width and height in PDF points. */
export interface PageDimensions {
  width: number;
  height: number;
}

/** True when `m` is the identity affine transform within floating-point tolerance. */
export function isIdentityAffine(m: Affine): boolean {
  return m.every((v, i) => Math.abs(v - IDENTITY[i]!) < 1e-9);
}

/** The affine map taking three points to three others (3-point alignment). */
export function affineFromPoints(from: readonly [number, number][], to: readonly [number, number][]): Affine | null {
  if (from.length < 3 || to.length < 3) return null;
  const [[x1, y1], [x2, y2], [x3, y3]] = from as [[number, number], [number, number], [number, number]];
  const det = x1 * (y2 - y3) - y1 * (x2 - x3) + (x2 * y3 - x3 * y2);
  if (Math.abs(det) < 1e-9) return null;
  // Solve [x y 1]·[a c e] for each output coordinate by Cramer's rule.
  const solve = (u1: number, u2: number, u3: number): [number, number, number] => [
    (u1 * (y2 - y3) - y1 * (u2 - u3) + (u2 * y3 - u3 * y2)) / det,
    (x1 * (u2 - u3) - u1 * (x2 - x3) + (x2 * u3 - x3 * u2)) / det,
    (x1 * (y2 * u3 - y3 * u2) - y1 * (x2 * u3 - x3 * u2) + u1 * (x2 * y3 - x3 * y2)) / det,
  ];
  const [a, c, e] = solve(to[0]![0], to[1]![0], to[2]![0]);
  const [b, d, f] = solve(to[0]![1], to[1]![1], to[2]![1]);
  return [a, b, c, d, e, f];
}

/** A box's corners through a map, as a box. */
export function mapBox<T extends Box>(m: Affine, b: T): T {
  const pts = [
    [b.x, b.y],
    [b.x + b.w, b.y],
    [b.x, b.y + b.h],
    [b.x + b.w, b.y + b.h],
  ].map((p) => applyAffine(m, p as [number, number]));
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return { ...b, x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

/**
 * Uniform scale taking `oldSize` onto `newSize` when both pages have the same aspect ratio
 * (within 3%) but different paper sizes (differing by more than 1%); otherwise identity.
 */
export function scaleToFitTransform(oldSize: PageDimensions, newSize: PageDimensions): Affine {
  if (oldSize.width <= 0 || oldSize.height <= 0 || newSize.width <= 0 || newSize.height <= 0) return IDENTITY;
  const kx = newSize.width / oldSize.width;
  const ky = newSize.height / oldSize.height;
  if (Math.abs(kx - ky) / Math.max(kx, ky) < 0.03 && Math.abs(kx - 1) > 0.01) {
    const k = (kx + ky) / 2;
    return [k, 0, 0, k, 0, 0];
  }
  return IDENTITY;
}

/**
 * The initial transform bringing the old page onto the new one before fine offset search:
 * a caller-supplied manual transform, or `scaleToFitTransform` when `scaleToFit` is enabled.
 */
export function preAlignTransform(oldSize: PageDimensions, newSize: PageDimensions, options: { transform?: Affine | null; scaleToFit?: boolean } = {}): Affine {
  if (options.transform) return options.transform;
  if (options.scaleToFit) return scaleToFitTransform(oldSize, newSize);
  return IDENTITY;
}

/** Adds a translation `offset` (in new-page points) after an existing affine transform `m`. */
export function applyOffset(m: Affine, offset: readonly [number, number]): Affine {
  return [m[0], m[1], m[2], m[3], m[4] + offset[0], m[5] + offset[1]];
}

/**
 * Rendering scale (pixels per PDF point) for aligning two pages at `dpi`, capped so the longest
 * edge stays within `maxSide` pixels (about 40 megapixels at the default 7000).
 */
export function alignRenderScale(oldSize: PageDimensions, newSize: PageDimensions, dpi: number, maxSide = 7000): number {
  const longest = Math.max(oldSize.width, oldSize.height, newSize.width, newSize.height);
  if (longest <= 0) return dpi / 72;
  return Math.min(dpi / 72, maxSide / longest);
}

/** Clockwise rotation angle of an affine map in degrees (in y-down page space). */
export function affineRotationDegrees(m: Affine): number {
  return (Math.atan2(m[1], m[0]) * 180) / Math.PI;
}
