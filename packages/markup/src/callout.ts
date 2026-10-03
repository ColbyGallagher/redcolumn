import type { Point, Rect } from './model';

/**
 * Where a callout's leader meets its box: the middle of the side facing the knee (left or right),
 * or of the top or bottom when the knee is above or below the box.
 */
export function calloutAttach(knee: Point, box: Rect): Point {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  if (knee[0] < box.x) return [box.x, cy];
  if (knee[0] > box.x + box.w) return [box.x + box.w, cy];
  return knee[1] < cy ? [cx, box.y] : [cx, box.y + box.h];
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
