/**
 * Perspective correction for photographed pages: the page's four corners in the photo are mapped
 * to a flat rectangle (a homography), as a document scanner app does.
 */

export type Pt = [number, number];

/** Solves the 8×8 system for the homography taking `from[i]` to `to[i]` (four points each). */
export function homography(from: readonly Pt[], to: readonly Pt[]): number[] {
  const a: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = from[i]!;
    const [u, v] = to[i]!;
    a.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    a.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  // Gaussian elimination with partial pivoting.
  const n = 8;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r]![c]!) > Math.abs(a[p]![c]!)) p = r;
    [a[c], a[p]] = [a[p]!, a[c]!];
    [b[c], b[p]] = [b[p]!, b[c]!];
    const d = a[c]![c]!;
    if (Math.abs(d) < 1e-12) throw new Error('The corners do not make a quadrilateral');
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = a[r]![c]! / d;
      if (!f) continue;
      for (let k = c; k < n; k++) a[r]![k]! -= f * a[c]![k]!;
      b[r]! -= f * b[c]!;
    }
  }
  return [...b.map((v, i) => v / a[i]![i]!), 1];
}

export function applyHomography(h: readonly number[], [x, y]: Pt): Pt {
  const w = h[6]! * x + h[7]! * y + h[8]!;
  return [(h[0]! * x + h[1]! * y + h[2]!) / w, (h[3]! * x + h[4]! * y + h[5]!) / w];
}

/** The output size for a quad (top-left, top-right, bottom-right, bottom-left): its longer side lengths. */
export function flatSize(q: readonly Pt[]): { width: number; height: number } {
  const d = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  return { width: Math.round(Math.max(d(q[0]!, q[1]!), d(q[3]!, q[2]!))), height: Math.round(Math.max(d(q[0]!, q[3]!), d(q[1]!, q[2]!))) };
}

/**
 * The part of `src` inside quad `q` (top-left, top-right, bottom-right, bottom-left), straightened
 * into a `width` × `height` image (bilinear sampling).
 */
export function warpQuad(src: ImageData, q: readonly Pt[], width: number, height: number): ImageData {
  // Map each output pixel back into the photo.
  const h = homography([[0, 0], [width, 0], [width, height], [0, height]], q);
  const out = new ImageData(width, height);
  const s = src.data;
  const o = out.data;
  const sw = src.width;
  const sh = src.height;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [fx, fy] = applyHomography(h, [x + 0.5, y + 0.5]);
      const x0 = Math.max(0, Math.min(sw - 2, Math.floor(fx - 0.5)));
      const y0 = Math.max(0, Math.min(sh - 2, Math.floor(fy - 0.5)));
      const tx = Math.max(0, Math.min(1, fx - 0.5 - x0));
      const ty = Math.max(0, Math.min(1, fy - 0.5 - y0));
      const i00 = (y0 * sw + x0) * 4;
      const i10 = i00 + 4;
      const i01 = i00 + sw * 4;
      const i11 = i01 + 4;
      const k = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        o[k + c] = (s[i00 + c]! * (1 - tx) + s[i10 + c]! * tx) * (1 - ty) + (s[i01 + c]! * (1 - tx) + s[i11 + c]! * tx) * ty;
      }
      o[k + 3] = 255;
    }
  }
  return out;
}

/**
 * A guess at a page's corners in a photo: the bounding quad of the pixels clearly brighter than the
 * photo's average (paper on a desk). Falls back to an inset of the whole frame.
 */
export function guessCorners(img: ImageData): Pt[] {
  const { width: w, height: h, data } = img;
  const step = Math.max(1, Math.floor(Math.min(w, h) / 200));
  let sum = 0;
  let n = 0;
  for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) {
    const i = (y * w + x) * 4;
    sum += data[i]! + data[i + 1]! + data[i + 2]!;
    n++;
  }
  const bright = (sum / n) * 1.15;
  // The extreme bright points along the four diagonal directions are the page corners:
  // top-left has the least x + y, top-right the most x − y, bottom-right the most x + y,
  // bottom-left the most y − x.
  const score = [(x: number, y: number) => -(x + y), (x: number, y: number) => x - y, (x: number, y: number) => x + y, (x: number, y: number) => y - x];
  const best: { v: number; p: Pt }[] = score.map(() => ({ v: -Infinity, p: [0, 0] }));
  let found = 0;
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const i = (y * w + x) * 4;
      if (data[i]! + data[i + 1]! + data[i + 2]! < bright) continue;
      found++;
      score.forEach((f, k) => {
        const v = f(x, y);
        if (v > best[k]!.v) best[k] = { v, p: [x, y] };
      });
    }
  }
  // Too little bright area, or it fills the frame: no page edges to go by.
  if (found < n * 0.1 || found > n * 0.97) {
    const m = Math.min(w, h) * 0.05;
    return [[m, m], [w - m, m], [w - m, h - m], [m, h - m]];
  }
  return best.map((b) => b.p);
}
