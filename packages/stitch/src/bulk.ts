import type { Vec } from './affine.ts';

/**
 * Bulk stitching: civil sets put their match lines in the same places on every discipline's
 * plans, so a stitch set up on one discipline's sheets can be copied onto another's. Each source
 * sheet is paired with a target sheet, its match lines are copied to the same page coordinates,
 * then each copy is nudged onto the drawn match line found close by on the target.
 */

/** One row of the pairing: a source sheet and the target sheet it is copied onto (null: skipped). */
export interface SheetPair {
  source: number;
  target: number | null;
}

/**
 * Pairs source sheets (in page order) with target sheets in the order given. Targets that are
 * also sources (`exclude`), or repeated, are dropped; sources left over are skipped (target null).
 */
export function pairInOrder(sources: readonly number[], targets: readonly number[], exclude: readonly number[] = sources): SheetPair[] {
  const src = [...new Set(sources)].sort((a, b) => a - b);
  const tgt = usableTargets(targets, exclude);
  return src.map((source, i) => ({ source, target: tgt[i] ?? null }));
}

/** How many targets `pairInOrder` leaves over once every source has one. */
export function leftoverTargets(sources: readonly number[], targets: readonly number[], exclude: readonly number[] = sources): number {
  return Math.max(0, usableTargets(targets, exclude).length - new Set(sources).size);
}

function usableTargets(targets: readonly number[], exclude: readonly number[]): number[] {
  const used = new Set(exclude);
  const out: number[] = [];
  for (const t of targets) {
    if (used.has(t)) continue;
    used.add(t);
    out.push(t);
  }
  return out;
}

/** Points per millimetre of paper. */
export const PT_PER_MM = 72 / 25.4;

/** Drawn line work lying along a match line: how far across it sits, and where along it runs. */
export interface LineworkFind {
  /** Across the line (points, along perp(p1 - p0)). */
  offset: number;
  /** Where the found line work starts and ends, along the line from p0 (points). */
  tMin: number;
  tMax: number;
  /** How much of the line's length the line work covers, 0..1. */
  coverage: number;
  /** How much the next-best candidate covers, 0..1 (a parallel road edge close by, say). */
  runnerUp: number;
}

/**
 * Segments must run within this angle of the line. A segment also has to lie wholly inside the
 * band `tolerance` either side of the line, which allows a long segment far less skew than
 * this (atan(2 · tolerance / length)); the smaller of the two applies.
 */
const PARALLEL = (1 * Math.PI) / 180;
/** Candidates whose offsets are this close (points) are one drawn line. */
const SAME_LINE = 0.6;

/**
 * Only the segments of `segments` that could lie along one of `lines`: those touching a line's
 * bounding box grown by `tolerance`. Cuts a heavy sheet down to a few thousand segments, once,
 * before each line is searched.
 */
export function segmentsNear(segments: ArrayLike<number>, lines: readonly { p0: Vec; p1: Vec }[], tolerance: number): Float32Array {
  const boxes = lines.map((l) => [Math.min(l.p0[0], l.p1[0]) - tolerance, Math.min(l.p0[1], l.p1[1]) - tolerance, Math.max(l.p0[0], l.p1[0]) + tolerance, Math.max(l.p0[1], l.p1[1]) + tolerance] as const);
  const out: number[] = [];
  for (let i = 0; i + 3 < segments.length; i += 4) {
    const ax = segments[i]!;
    const ay = segments[i + 1]!;
    const bx = segments[i + 2]!;
    const by = segments[i + 3]!;
    const x0 = Math.min(ax, bx);
    const x1 = Math.max(ax, bx);
    const y0 = Math.min(ay, by);
    const y1 = Math.max(ay, by);
    for (const [bx0, by0, bx1, by1] of boxes) {
      if (x1 >= bx0 && x0 <= bx1 && y1 >= by0 && y0 <= by1) {
        out.push(ax, ay, bx, by);
        break;
      }
    }
  }
  return Float32Array.from(out);
}

/**
 * The drawn line work within `tolerance` points of the line p0-p1 that runs along it, or null
 * when there is none. Of several parallel lines, the one covering most of the line's length wins,
 * with lines nearer `expected` (the offset across) preferred.
 */
export function findLinework(p0: Vec, p1: Vec, segments: ArrayLike<number>, tolerance: number, expected = 0): LineworkFind | null {
  const dx = p1[0] - p0[0];
  const dy = p1[1] - p0[1];
  const L = Math.hypot(dx, dy);
  if (L < 1 || !(tolerance > 0)) return null;
  const ux = dx / L;
  const uy = dy / L;
  // perp(u)
  const nx = -uy;
  const ny = ux;
  const cosTol = Math.cos(PARALLEL);
  const found: { d: number; a: number; b: number }[] = [];
  for (let i = 0; i + 3 < segments.length; i += 4) {
    const ax = segments[i]! - p0[0];
    const ay = segments[i + 1]! - p0[1];
    const bx = segments[i + 2]! - p0[0];
    const by = segments[i + 3]! - p0[1];
    // Cheapest rejection first: both ends inside the band either side of the line.
    const da = ax * nx + ay * ny;
    if (da > tolerance || da < -tolerance) continue;
    const db = bx * nx + by * ny;
    if (db > tolerance || db < -tolerance) continue;
    const vx = bx - ax;
    const vy = by - ay;
    const sl = Math.hypot(vx, vy);
    if (sl < 0.5 || Math.abs(vx * ux + vy * uy) / sl < cosTol) continue;
    const ta = ax * ux + ay * uy;
    const tb = bx * ux + by * uy;
    const lo = Math.min(ta, tb);
    const hi = Math.max(ta, tb);
    // It has to run alongside the line, not lie beyond its ends.
    if (hi < 0 || lo > L) continue;
    found.push({ d: (da + db) / 2, a: lo, b: hi });
  }
  if (!found.length) return null;
  found.sort((x, y) => x.d - y.d);
  // Group candidates into drawn lines by their offset across.
  const groups: (typeof found)[] = [];
  for (const f of found) {
    const last = groups[groups.length - 1];
    if (last && f.d - last[last.length - 1]!.d <= SAME_LINE) last.push(f);
    else groups.push([f]);
  }
  const overlap = (f: (typeof found)[number]) => Math.max(0, Math.min(f.b, L) - Math.max(f.a, 0));
  const scored = groups.map((g) => {
    const coverage = covered(g, L) / L;
    const weight = g.reduce((s, f) => s + overlap(f), 0) || 1;
    const offset = g.reduce((s, f) => s + f.d * overlap(f), 0) / weight;
    const score = coverage * (1 - (0.5 * Math.min(Math.abs(offset - expected), tolerance)) / tolerance);
    return { g, coverage, offset, score };
  });
  scored.sort((x, y) => y.score - x.score);
  const best = scored[0]!;
  return {
    offset: best.offset,
    tMin: Math.min(...best.g.map((f) => f.a)),
    tMax: Math.max(...best.g.map((f) => f.b)),
    coverage: best.coverage,
    runnerUp: scored[1]?.coverage ?? 0,
  };
}

/** How much of [0, L] the intervals cover. */
function covered(list: readonly { a: number; b: number }[], L: number): number {
  const iv = list.map((f): [number, number] => [Math.max(0, f.a), Math.min(L, f.b)]).filter(([a, b]) => b > a);
  iv.sort((x, y) => x[0] - y[0]);
  let total = 0;
  let start = 0;
  let end = -Infinity;
  for (const [a, b] of iv) {
    if (a > end) {
      if (end > -Infinity) total += end - start;
      start = a;
      end = b;
    } else end = Math.max(end, b);
  }
  if (end > -Infinity) total += end - start;
  return Math.min(total, L);
}

export interface LineRefine {
  p0: [number, number];
  p1: [number, number];
  /** How far the copy moved: along the line and across it (points). */
  shift: [number, number];
  /** 0..1: how sure the copy sits on the target's drawn match line. */
  confidence: number;
  /** False when the copy was left where it was copied to. */
  snapped: boolean;
  /** Why it was not moved, when it was not. */
  reason?: string;
}

/** Confidence below this leaves the copied line where it is. */
export const SNAP_CONFIDENCE = 0.5;
/** Found line work shorter than this fraction of the line says too little to snap to. */
const MIN_COVERAGE = 0.3;

/** a / b or b / a, whichever is at most 1 (1 when both are 0). */
const likeness = (a: number, b: number) => (Math.max(a, b) > 0 ? Math.min(a, b) / Math.max(a, b) : 1);

/**
 * Nudges a match line copied from a source sheet onto a target sheet at the same page
 * coordinates. On both sheets it looks for the drawn match line within `tolerance` points of the
 * line, then moves the copy so it sits on the target's drawn line exactly as the original sits
 * on the source's: across it, and along it when both drawn lines are the same length.
 *
 * Confidence is how alike the two drawn lines are: how much of the line each covers, how long
 * each runs (a long kerb or frame line is not a short dashed match line), how far the target's
 * is from where the source's says it should be, and whether another line close by is nearly as
 * good on either sheet. The copy is kept where it is when the source line has no drawn line
 * under it, the target has none close by, the move would be farther than `tolerance`, or the
 * confidence is below SNAP_CONFIDENCE.
 */
export function refineCopiedLine(line: { p0: Vec; p1: Vec }, source: ArrayLike<number> | null, target: ArrayLike<number>, tolerance: number): LineRefine {
  const keep = (reason: string, confidence = 0): LineRefine => ({ p0: [line.p0[0], line.p0[1]], p1: [line.p1[0], line.p1[1]], shift: [0, 0], confidence, snapped: false, reason });
  const fs = source ? findLinework(line.p0, line.p1, source, tolerance) : null;
  if (!fs || fs.coverage < MIN_COVERAGE) return keep('No drawn line under the source match line');
  const ft = findLinework(line.p0, line.p1, target, tolerance, fs.offset);
  if (!ft || ft.coverage < MIN_COVERAGE) return keep('No matching line close by on the target sheet');
  const dx = line.p1[0] - line.p0[0];
  const dy = line.p1[1] - line.p0[1];
  const L = Math.hypot(dx, dy);
  const [ux, uy] = [dx / L, dy / L];
  const [nx, ny] = [-uy, ux];
  const across = ft.offset - fs.offset;
  const spanS = fs.tMax - fs.tMin;
  const spanT = ft.tMax - ft.tMin;
  // The drawn lines' ends say how far the target slid along, when both lines show both ends.
  const sameLength = Math.abs(spanT - spanS) <= SAME_LINE * 2;
  const alongRaw = (ft.tMin - fs.tMin + (ft.tMax - fs.tMax)) / 2;
  const along = sameLength ? alongRaw : 0;
  if (Math.hypot(along, across) > tolerance) return keep('The line close by on the target sheet is farther than the tolerance');

  let confidence = likeness(ft.coverage, fs.coverage) * likeness(spanT, spanS);
  // The farther the move, the likelier it found some other line.
  confidence *= 1 - (0.3 * Math.hypot(along, across)) / tolerance;
  // Another line nearly as long close by: the pick may be the wrong one.
  if (ft.runnerUp >= ft.coverage * 0.8) confidence *= 0.5;
  if (fs.runnerUp >= fs.coverage * 0.8) confidence *= 0.7;
  confidence = Math.round(confidence * 100) / 100;
  if (confidence < SNAP_CONFIDENCE) return keep('The line close by on the target sheet is unlike the source', confidence);
  const mx = ux * along + nx * across;
  const my = uy * along + ny * across;
  return {
    p0: [line.p0[0] + mx, line.p0[1] + my],
    p1: [line.p1[0] + mx, line.p1[1] + my],
    shift: [along, across],
    confidence,
    snapped: true,
  };
}
