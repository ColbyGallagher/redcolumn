import type { Axis } from './arrange';
import { imageFrame } from './imageCrop';
import { rotatePoint, rotationCentre, type Markup, type Rect, type VectorPicture } from './model';

/**
 * A vector Snapshot (`Markup.vector`) is a one-page PDF of the area it was taken from. Drawing it,
 * snapping to it and writing it to PDF all place that page the same way: its shown space (points,
 * y down, `width` × `height`) is stretched over the picture's whole rectangle (`imageFrame`'s
 * `full`), turned over when flipped, then clipped to the box and turned with the markup.
 */

/** [a, b, c, d, e, f]: x' = a·x + c·y + e, y' = b·x + d·y + f (PDF's order). */
export type Matrix = [number, number, number, number, number, number];

/** The picture's shown space → the markup's own unrotated frame (page points, y down). */
export function pictureMatrix(m: Pick<Markup, 'points' | 'crop'> & { vector: VectorPicture }): Matrix {
  const { full } = imageFrame(m);
  const v = m.vector;
  const sx = full.w / (v.width || 1);
  const sy = full.h / (v.height || 1);
  return [v.flipX ? -sx : sx, 0, 0, v.flipY ? -sy : sy, v.flipX ? full.x + full.w : full.x, v.flipY ? full.y + full.h : full.y];
}

/** `m` then `n`. */
export function multiply(m: Matrix, n: Matrix): Matrix {
  return [m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3], m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3], m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5]];
}

/**
 * A PDF page's user space → its shown space (top-left origin, y down, /Rotate applied), for a page
 * whose box is [l, b, r, t] and that turns `rotate` degrees clockwise, as viewers show it.
 */
export function userToShown(box: { l: number; b: number; r: number; t: number }, rotate: number): Matrix {
  const { l, b, r, t } = box;
  switch ((((Math.round(rotate / 90) % 4) + 4) % 4) * 90) {
    case 90:
      return [0, 1, 1, 0, -b, -l];
    case 180:
      return [-1, 0, 0, 1, r, -b];
    case 270:
      return [0, -1, -1, 0, t, r];
    default:
      return [1, 0, 0, -1, -l, t];
  }
}

/** The part of segment (x1, y1)–(x2, y2) inside `r` (Liang–Barsky), or null when it misses. */
function clipSegment(x1: number, y1: number, x2: number, y2: number, r: Rect): [number, number, number, number] | null {
  const dx = x2 - x1;
  const dy = y2 - y1;
  let t0 = 0;
  let t1 = 1;
  const edges: [number, number][] = [
    [-dx, x1 - r.x],
    [dx, r.x + r.w - x1],
    [-dy, y1 - r.y],
    [dy, r.y + r.h - y1],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const t = q / p;
    if (p < 0) {
      if (t > t1) return null;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return null;
      if (t < t1) t1 = t;
    }
  }
  return [x1 + t0 * dx, y1 + t0 * dy, x1 + t1 * dx, y1 + t1 * dy];
}

/**
 * The picture's line work (flat [x1, y1, x2, y2, ...] in its shown space, as PDFium gives a page's
 * geometry) placed on the page: stretched and flipped with the markup, cut to its box (a crop)
 * and turned with it. `curves` (1 per segment) follows the segments kept.
 */
export function pictureSegments(m: Markup & { vector: VectorPicture }, segments: ArrayLike<number>, curves?: ArrayLike<number>): { segments: Float32Array; curves: Uint8Array } {
  const t = pictureMatrix(m);
  const { clip } = imageFrame(m);
  const centre = m.rotation ? rotationCentre(m) : null;
  const out: number[] = [];
  const outCurves: number[] = [];
  for (let i = 0, k = 0; i + 3 < segments.length; i += 4, k++) {
    const x1 = segments[i]!;
    const y1 = segments[i + 1]!;
    const x2 = segments[i + 2]!;
    const y2 = segments[i + 3]!;
    const cut = clipSegment(t[0] * x1 + t[2] * y1 + t[4], t[1] * x1 + t[3] * y1 + t[5], t[0] * x2 + t[2] * y2 + t[4], t[1] * x2 + t[3] * y2 + t[5], clip);
    if (!cut) continue;
    if (centre) {
      const a = rotatePoint([cut[0], cut[1]], centre, m.rotation!);
      const b = rotatePoint([cut[2], cut[3]], centre, m.rotation!);
      out.push(a[0], a[1], b[0], b[1]);
    } else out.push(...cut);
    outCurves.push(curves?.[k] ?? 0);
  }
  return { segments: new Float32Array(out), curves: new Uint8Array(outCurves) };
}

/** The vector picture turned over with its markup (Flip). */
export function mirrorVector(v: VectorPicture, axis: Axis): VectorPicture {
  return axis === 'horizontal' ? { ...v, flipX: !v.flipX } : { ...v, flipY: !v.flipY };
}

/** The markup has a vector picture it can be drawn from. */
export function hasVector(m: Markup): m is Markup & { vector: VectorPicture } {
  return m.type === 'image' && !!m.vector?.pdf && m.vector.width > 0 && m.vector.height > 0;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
