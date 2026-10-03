/** Affine maps between two pages' spaces (points, y down), for aligning revisions. */

import type { Box } from './diff';

/** [a b c d e f]: x' = a·x + c·y + e, y' = b·x + d·y + f. */
export type Affine = [number, number, number, number, number, number];

export const applyAffine = (m: Affine, [x, y]: readonly [number, number]): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

export function invertAffine(m: Affine): Affine {
  const det = m[0] * m[3] - m[1] * m[2];
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
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
