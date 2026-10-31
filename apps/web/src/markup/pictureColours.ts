// Colour changes on the pixels of a picture (a Snapshot, or any Image markup), and the clip of a
// Snapshot to a polygon. Pure functions on pixel arrays and point lists, so they run anywhere.
import type { Point } from '@nb/markup';

/**
 * How a picture's colours change: grey, black on white (everything but white goes black), the
 * colours swapped for their opposites, or one colour replaced with another (colours within
 * `tolerance`, 0–1 per channel, of `replace` become `with`; #rrggbb, or null for see-through).
 */
export type PictureColours = 'grayscale' | 'blackAndWhite' | 'invert' | { replace: string; with: string | null; tolerance: number };

const rgbOfHex = (hex: string): [number, number, number] => {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** Recolours RGBA pixels in place. Transparent pixels keep their transparency. */
export function recolourPixels(data: Uint8ClampedArray, mode: PictureColours): void {
  if (typeof mode === 'object') {
    const from = rgbOfHex(mode.replace);
    const to = mode.with ? rgbOfHex(mode.with) : null;
    const tol = mode.tolerance * 255 + 1e-6;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) continue;
      if (Math.abs(data[i]! - from[0]) > tol || Math.abs(data[i + 1]! - from[1]) > tol || Math.abs(data[i + 2]! - from[2]) > tol) continue;
      if (to) {
        data[i] = to[0];
        data[i + 1] = to[1];
        data[i + 2] = to[2];
      } else data[i + 3] = 0;
    }
    return;
  }
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    if (mode === 'invert') {
      data[i] = 255 - r;
      data[i + 1] = 255 - g;
      data[i + 2] = 255 - b;
      continue;
    }
    const grey = 0.299 * r + 0.587 * g + 0.114 * b;
    const v = mode === 'grayscale' ? grey : grey > 242 ? 255 : 0;
    data[i] = data[i + 1] = data[i + 2] = Math.round(v);
  }
}

/** The smallest box round the points, as the area to render for a polygon Snapshot. */
export function polygonBox(points: readonly Point[]): { x: number; y: number; w: number; h: number } {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/**
 * The polygon in a rendered area's pixels: the area was rendered at `scale` pixels per page point
 * from the page's pixel `origin` (the page's own pixels at that scale).
 */
export function polygonInPixels(points: readonly Point[], scale: number, origin: Point): Point[] {
  return points.map((p): Point => [p[0] * scale - origin[0], p[1] * scale - origin[1]]);
}
