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
