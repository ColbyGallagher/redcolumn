// Colour changes on the pixels of a picture (a Snapshot, or any Image markup), and the clip of a
// Snapshot to a polygon. Pure functions on pixel arrays and point lists, so they run anywhere.
import type { Point } from '@nb/markup';

/** A colour the picture uses and what it becomes: another colour (#rrggbb), or null for see-through. */
export interface ColourSwap {
  from: string;
  to: string | null;
}

/**
 * How a picture's colours change: each of its main colours (see `dominantColours`) swapped for
 * another. Every pixel follows the main colour nearest to it, shifted by the same amount, so soft
 * edges stay soft; list the colours that stay too, so pixels near them are not taken by a colour
 * that changes.
 */
export interface PictureColours {
  swaps: ColourSwap[];
}

const rgbOfHex = (hex: string): [number, number, number] => {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const hexOfRgb = (r: number, g: number, b: number) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

/**
 * The main colours of RGBA pixels, commonest first: at most `max`, none that is under 0.5% of the
 * pixels or close to a commoner one. Mostly see-through pixels are not counted.
 */
export function dominantColours(data: Uint8ClampedArray, max = 8): { hex: string; share: number }[] {
  const counts = new Map<number, number>();
  let total = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3]! < 128) continue;
    total++;
    const key = (data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  // Commonest first; a colour close to one already taken counts towards it.
  const picked: { rgb: [number, number, number]; n: number }[] = [];
  for (const [key, n] of [...counts].sort((x, y) => y[1] - x[1])) {
    const rgb: [number, number, number] = [key >> 16, (key >> 8) & 255, key & 255];
    const near = picked.find((q) => Math.hypot(q.rgb[0] - rgb[0], q.rgb[1] - rgb[1], q.rgb[2] - rgb[2]) < 48);
    if (near) near.n += n;
    else if (picked.length < max) picked.push({ rgb, n });
  }
  return picked
    .filter((q) => q.n >= total * 0.005)
    .sort((x, y) => y.n - x.n)
    .map((q) => ({ hex: hexOfRgb(...q.rgb), share: q.n / Math.max(1, total) }));
}

/** Recolours RGBA pixels in place. Transparent pixels keep their transparency. */
export function recolourPixels(data: Uint8ClampedArray, mode: PictureColours): void {
  const swaps = mode.swaps.map((w) => ({ from: rgbOfHex(w.from), to: w.to ? rgbOfHex(w.to) : null, same: w.to?.toLowerCase() === w.from.toLowerCase() }));
  if (swaps.every((w) => w.same)) return;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    let best = swaps[0]!;
    let bestD = Infinity;
    for (const w of swaps) {
      const d = (w.from[0] - r) ** 2 + (w.from[1] - g) ** 2 + (w.from[2] - b) ** 2;
      if (d < bestD) {
        best = w;
        bestD = d;
      }
    }
    if (best.same) continue;
    if (!best.to) data[i + 3] = 0;
    else {
      data[i] = r + best.to[0] - best.from[0];
      data[i + 1] = g + best.to[1] - best.from[1];
      data[i + 2] = b + best.to[2] - best.from[2];
    }
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

/** How a picture is lightened, darkened or toned. Every field's rest value changes nothing. */
export interface PictureAdjust {
  /** -100 (black) to 100 (white); 0 leaves the picture as it is. */
  brightness: number;
  /** -100 (flat grey) to 100 (hard); 0 leaves the picture as it is. */
  contrast: number;
  greyscale: boolean;
  invert: boolean;
  /** 0 keeps every pixel; above 0 makes the near-white pixels see-through (the larger, the more white goes). */
  whiteOut: number;
}

/** How many levels below the cut-off a light pixel fades out over. */
const WHITE_FADE = 16;

export const NO_ADJUST: PictureAdjust = { brightness: 0, contrast: 0, greyscale: false, invert: false, whiteOut: 0 };

/** Whether the adjustment changes any pixel. */
export const adjustsPicture = (a: PictureAdjust): boolean => a.brightness !== 0 || a.contrast !== 0 || a.greyscale || a.invert || a.whiteOut > 0;

/**
 * Adjusts RGBA pixels in place: greyscale, then brightness, then contrast, then invert, then the
 * near-white pixels made see-through (fading over the last few levels). Transparency is kept.
 */
export function adjustPixels(data: Uint8ClampedArray, a: PictureAdjust): void {
  if (!adjustsPicture(a)) return;
  const shift = (a.brightness / 100) * 255;
  const c = a.contrast * 2.55;
  const k = (259 * (c + 255)) / (255 * (259 - c));
  const cut = 255 - a.whiteOut * 2.55;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    let r = data[i]!;
    let g = data[i + 1]!;
    let b = data[i + 2]!;
    if (a.greyscale) r = g = b = 0.299 * r + 0.587 * g + 0.114 * b;
    r += shift;
    g += shift;
    b += shift;
    if (a.contrast !== 0) {
      r = k * (r - 128) + 128;
      g = k * (g - 128) + 128;
      b = k * (b - 128) + 128;
    }
    r = Math.max(0, Math.min(255, r));
    g = Math.max(0, Math.min(255, g));
    b = Math.max(0, Math.min(255, b));
    if (a.invert) {
      r = 255 - r;
      g = 255 - g;
      b = 255 - b;
    }
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    if (a.whiteOut > 0) {
      // Fully white goes; a little under that fades out, so soft edges leave no pale halo.
      const light = Math.min(r, g, b);
      if (light >= cut) data[i + 3] = 0;
      else if (light > cut - WHITE_FADE) data[i + 3] = Math.round((data[i + 3]! * (cut - light)) / WHITE_FADE);
    }
  }
}
