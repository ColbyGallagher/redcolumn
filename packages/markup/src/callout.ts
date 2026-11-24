import type { Point, Rect } from './model';

export type CalloutSide = 'left' | 'right' | 'top' | 'bottom';

/**
 * How a leader lands on the text box: it always meets a left or right side head-on (horizontal) or the
 * top or bottom head-on (vertical), never at an angle. The side is the one the knee sits furthest
 * beyond; `knee` is the knee slid along that side's line so the final stretch is straight, and
 * `attach` is where it touches the box. A knee inside the box lands on the top or bottom middle.
 */
export function calloutLanding(knee: Point, box: Rect): { side: CalloutSide; knee: Point; attach: Point } {
  const right = box.x + box.w;
  const bottom = box.y + box.h;
  const dx = Math.max(box.x - knee[0], knee[0] - right, 0);
  const dy = Math.max(box.y - knee[1], knee[1] - bottom, 0);
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  if (dx > 0 && dx >= dy) {
    const y = clamp(knee[1], box.y, bottom);
    const side = knee[0] < box.x ? 'left' : 'right';
    return { side, knee: [knee[0], y], attach: [side === 'left' ? box.x : right, y] };
  }
  if (dy > 0) {
    const x = clamp(knee[0], box.x, right);
    const side = knee[1] < box.y ? 'top' : 'bottom';
    return { side, knee: [x, knee[1]], attach: [x, side === 'top' ? box.y : bottom] };
  }
  // A knee on the box's own edge (a two-point leader that ends there, as Bluebeam writes) lands where it is.
  const eps = 0.01;
  if (knee[0] >= box.x - eps && knee[0] <= right + eps && knee[1] >= box.y - eps && knee[1] <= bottom + eps) {
    const onLeft = Math.abs(knee[0] - box.x) <= eps;
    const onRight = Math.abs(knee[0] - right) <= eps;
    const onTop = Math.abs(knee[1] - box.y) <= eps;
    const onBottom = Math.abs(knee[1] - bottom) <= eps;
    if (onLeft || onRight) {
      const y = clamp(knee[1], box.y, bottom);
      return { side: onLeft ? 'left' : 'right', knee: [knee[0], y], attach: [onLeft ? box.x : right, y] };
    }
    if (onTop || onBottom) {
      const x = clamp(knee[0], box.x, right);
      return { side: onTop ? 'top' : 'bottom', knee: [x, knee[1]], attach: [x, onTop ? box.y : bottom] };
    }
  }
  const cx = box.x + box.w / 2;
  const top = knee[1] < box.y + box.h / 2;
  return { side: top ? 'top' : 'bottom', knee: [cx, knee[1]], attach: [cx, top ? box.y : bottom] };
}

/** Where a callout's leader meets its box (see `calloutLanding`). */
export function calloutAttach(knee: Point, box: Rect): Point {
  return calloutLanding(knee, box).attach;
}

/**
 * A callout's points for an arrow at `tip` and a box of `w` × `h` whose near side sits at `at`:
 * [tip, knee, box corner, opposite box corner]. The knee makes a short horizontal landing of
 * `landing` points before the box, on the side facing the tip.
 */
export function calloutPoints(tip: Point, at: Point, w: number, h: number, landing: number): Point[] {
  const right = at[0] >= tip[0];
  const knee: Point = [at[0] + (right ? -landing : landing), at[1]];
  const x0 = right ? at[0] : at[0] - w;
  return [tip, knee, [x0, at[1] - h / 2], [x0 + w, at[1] + h / 2]];
}

/**
 * A callout's leaders as [tip, knee] pairs. The first leader is points 0-1; any others follow the
 * box corners (points 2-3) as further tip and knee points.
 */
export function calloutLeaders(points: readonly Point[]): [Point, Point][] {
  const out: [Point, Point][] = points.length >= 2 ? [[points[0]!, points[1]!]] : [];
  for (let i = 4; i + 1 < points.length; i += 2) out.push([points[i]!, points[i + 1]!]);
  return out;
}

/** True for the points of a callout that are an arrow tip (they stay put when the text box moves). */
export function isCalloutTip(index: number): boolean {
  return index === 0 || (index >= 4 && index % 2 === 0);
}

/** True for the points of a callout that are a leader's knee (bend between arrow and landing stub). */
export function isCalloutKnee(index: number): boolean {
  return index === 1 || (index >= 5 && index % 2 === 1);
}

/** Indices of all leader knees in a callout's points array. */
export function calloutKneeIndices(points: readonly Point[]): number[] {
  const out: number[] = points.length >= 2 ? [1] : [];
  for (let i = 5; i < points.length; i += 2) out.push(i);
  return out;
}

/** All knee indices stacked at the same position as `kneeIndex` (within `tol`), always including `kneeIndex`. */
export function calloutStackedKnees(points: readonly Point[], kneeIndex: number, tol: number): number[] {
  const origin = points[kneeIndex];
  if (!origin || !isCalloutKnee(kneeIndex)) return [];
  const out: number[] = [];
  for (const k of calloutKneeIndices(points)) {
    const q = points[k]!;
    if (k === kneeIndex || Math.hypot(q[0] - origin[0], q[1] - origin[1]) <= tol) out.push(k);
  }
  return out;
}

/** Which side of `box` faces `pt` (used to route a leader so it does not cross over the text box). */
export function calloutSideForPoint(pt: Point, box: Rect): CalloutSide {
  const right = box.x + box.w;
  const bottom = box.y + box.h;
  const dx = Math.max(box.x - pt[0], pt[0] - right, 0);
  const dy = Math.max(box.y - pt[1], pt[1] - bottom, 0);
  if (dx > 0 && dx >= dy) return pt[0] < box.x ? 'left' : 'right';
  if (dy > 0) return pt[1] < box.y ? 'top' : 'bottom';
  const nx = box.w > 0 ? (pt[0] - (box.x + box.w / 2)) / (box.w / 2) : 0;
  const ny = box.h > 0 ? (pt[1] - (box.y + box.h / 2)) / (box.h / 2) : 0;
  if (Math.abs(nx) >= Math.abs(ny)) return nx < 0 ? 'left' : 'right';
  return ny < 0 ? 'top' : 'bottom';
}

/** A knee placed on `side` of `box`, offset outward by `landing`, optionally at `along` (default: side midpoint). */
export function calloutKneeForSide(side: CalloutSide, box: Rect, landing: number, along?: number): Point {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  switch (side) {
    case 'left': return [box.x - landing, along ?? cy];
    case 'right': return [box.x + box.w + landing, along ?? cy];
    case 'top': return [along ?? cx, box.y - landing];
    case 'bottom': return [along ?? cx, box.y + box.h + landing];
  }
}

/** The current landing stub length of `knee` on `box`, or `fallback` when the knee sits on the box edge. */
export function calloutLandingLength(knee: Point, box: Rect, fallback: number): number {
  const land = calloutLanding(knee, box);
  const len = Math.hypot(land.knee[0] - land.attach[0], land.knee[1] - land.attach[1]);
  return len > 0.5 ? len : fallback;
}

/**
 * Relocates a leader's knee when its arrow tip moves to a different side of the text box, so the
 * leader never overlaps the text. While the tip stays on the same side as the knee, the knee stays
 * put (preserving custom positions and stacked leaders).
 */
export function calloutRelocateKneeForTip(tip: Point, currentKnee: Point, box: Rect, defaultLanding: number): Point {
  const currentSide = calloutLanding(currentKnee, box).side;
  const targetSide = calloutSideForPoint(tip, box);
  if (targetSide === currentSide) return currentKnee;
  return calloutKneeForSide(targetSide, box, calloutLandingLength(currentKnee, box, defaultLanding));
}

/**
 * Snaps a dragged callout knee to:
 * 1. Another leader's knee (stacking their landing stubs into one shared line), or
 * 2. One of the text box's corner or edge-midpoint node alignments on the active side,
 * while still allowing free placement anywhere else along the side.
 */
export function snapCalloutKnee(
  point: Point,
  box: Rect,
  otherKnees: readonly Point[],
  tol: number,
): { point: Point; snappedTo: Point | null; stacked: boolean } {
  let bestKnee: Point | null = null;
  let bestDist = tol;
  for (const k of otherKnees) {
    const d = Math.hypot(point[0] - k[0], point[1] - k[1]);
    if (d <= bestDist) {
      bestDist = d;
      bestKnee = k;
    }
  }
  if (bestKnee) return { point: [bestKnee[0], bestKnee[1]], snappedTo: [bestKnee[0], bestKnee[1]], stacked: true };

  const land = calloutLanding(point, box);
  if (land.side === 'left' || land.side === 'right') {
    const attachX = land.side === 'left' ? box.x : box.x + box.w;
    const targets = [box.y, box.y + box.h / 2, box.y + box.h];
    let bestY: number | null = null;
    let dMin = tol;
    for (const ty of targets) {
      const d = Math.abs(point[1] - ty);
      if (d <= dMin) {
        dMin = d;
        bestY = ty;
      }
    }
    if (bestY !== null) {
      return { point: [point[0], bestY], snappedTo: [attachX, bestY], stacked: false };
    }
  } else {
    const attachY = land.side === 'top' ? box.y : box.y + box.h;
    const targets = [box.x, box.x + box.w / 2, box.x + box.w];
    let bestX: number | null = null;
    let dMin = tol;
    for (const tx of targets) {
      const d = Math.abs(point[0] - tx);
      if (d <= dMin) {
        dMin = d;
        bestX = tx;
      }
    }
    if (bestX !== null) {
      return { point: [bestX, point[1]], snappedTo: [bestX, attachY], stacked: false };
    }
  }
  return { point, snappedTo: null, stacked: false };
}
