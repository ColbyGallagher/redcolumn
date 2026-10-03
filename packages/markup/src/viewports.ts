import type { Scale } from '@nb/measure';
import type { Markup, Point, Rect } from './model';

/** A region of a page drawn at its own scale (a detail or section on a sheet with a plan). */
export interface Viewport {
  id: string;
  pageIndex: number;
  name: string;
  rect: Rect;
  scale: Scale;
}

function inside(r: Rect, [x, y]: Point): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

/** The viewport on a page containing a point; the smallest when viewports overlap. */
export function viewportAt(viewports: readonly Viewport[], pageIndex: number, p: Point): Viewport | null {
  let best: Viewport | null = null;
  for (const v of viewports) {
    if (v.pageIndex !== pageIndex || !inside(v.rect, p)) continue;
    if (!best || v.rect.w * v.rect.h < best.rect.w * best.rect.h) best = v;
  }
  return best;
}

/**
 * The point that decides which viewport a markup is measured in: its first point, as is usual
 * where a measurement starts.
 */
export function markupAnchor(m: Pick<Markup, 'points'>): Point | null {
  return m.points[0] ?? null;
}

/** The scale a markup is measured at: its viewport's, else the page's. */
export function scaleOfMarkup(m: Pick<Markup, 'points' | 'pageIndex'>, pageScale: Scale, viewports: readonly Viewport[]): Scale {
  const at = markupAnchor(m);
  return (at && viewportAt(viewports, m.pageIndex, at)?.scale) || pageScale;
}
