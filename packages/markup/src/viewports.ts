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

/**
 * The rectangle two opposite corners span, clipped to the page. Null when none of it is on the
 * page. The Viewport tool and the assistant's place_viewport both use this, so the same corners
 * give the same viewport.
 */
export function viewportRectFromCorners(a: Point, b: Point, size?: { width: number; height: number } | null): Rect | null {
  const x0 = Math.max(0, Math.min(a[0], b[0]));
  const y0 = Math.max(0, Math.min(a[1], b[1]));
  const x1 = size ? Math.min(size.width, Math.max(a[0], b[0])) : Math.max(a[0], b[0]);
  const y1 = size ? Math.min(size.height, Math.max(a[1], b[1])) : Math.max(a[1], b[1]);
  if (!(x1 > x0) || !(y1 > y0)) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
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
