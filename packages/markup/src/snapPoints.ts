import { polygonCentroid, type Snap } from '@nb/measure';
import { boundsOf, circleOf, rotatePoint, rotationCentre, type Markup, type Point } from './model';
import { TYPE_INFO } from './types';

/**
 * Points on a markup that drawing snaps to: a box's four corners, the middles of its edges and its
 * geometric centre, a circle or ellipse's centre and compass points, and a line or outline's
 * vertices, the middles of its segments and (closed) its centroid. An open line's ends carry the
 * direction out past them, for extension tracking. Rotated markups give their points where they
 * are drawn.
 */
export function markupSnapPoints(m: Markup): Snap[] {
  const out = unrotatedSnapPoints(m);
  if (!m.rotation) return out;
  const c = rotationCentre(m);
  const turn = (d: [number, number]) => rotatePoint(d, [0, 0], m.rotation!);
  return out.map((s) => ({ ...s, point: rotatePoint(s.point, c, m.rotation!), ...(s.dir ? { dir: turn(s.dir) } : {}) }));
}

function unrotatedSnapPoints(m: Markup): Snap[] {
  const { points } = m;
  if (!points.length) return [];
  const circle = circleOf(m);
  if (circle) {
    const { cx, cy, r } = circle;
    return [
      { point: [cx, cy], kind: 'center' },
      ...compass(cx, cy, r, r),
      ...points.map((p): Snap => ({ point: p, kind: 'endpoint' })),
    ];
  }
  if (m.type === 'ellipse' || m.type === 'ellipticalArc') {
    const b = boundsOf(points);
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    const centre: Snap = { point: [cx, cy], kind: 'center' };
    return m.type === 'ellipse' ? [centre, ...compass(cx, cy, b.w / 2, b.h / 2)] : [centre];
  }
  const handles = TYPE_INFO[m.type].handles;
  if (handles === 'box') {
    const b = boundsOf(points);
    const [x0, y0, x1, y1] = [b.x, b.y, b.x + b.w, b.y + b.h];
    const corners: Point[] = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    return [...corners.map((p): Snap => ({ point: p, kind: 'endpoint' })), ...segmentMids(corners, true), { point: [x0 + b.w / 2, y0 + b.h / 2], kind: 'geocenter' }];
  }
  const closed = TYPE_INFO[m.type].closed;
  const vertices = points.map((p, i): Snap => {
    // An open line's ends: the way it runs out past them.
    const back = closed || points.length < 2 ? undefined : i === 0 ? points[1] : i === points.length - 1 ? points[i - 1] : undefined;
    const d = back && Math.hypot(p[0] - back[0], p[1] - back[1]);
    return back && d ? { point: p, kind: 'endpoint', dir: [(p[0] - back[0]) / d, (p[1] - back[1]) / d] } : { point: p, kind: 'endpoint' };
  });
  if (handles === 'none') return vertices;
  const outline = handles === 'ends' ? points.slice(0, 2) : points;
  const centroid: Snap[] = closed && outline.length >= 3 ? [{ point: polygonCentroid(outline), kind: 'geocenter' }] : [];
  return [...vertices, ...segmentMids(outline, closed), ...centroid];
}

function compass(cx: number, cy: number, rx: number, ry: number): Snap[] {
  return ([[cx, cy - ry], [cx + rx, cy], [cx, cy + ry], [cx - rx, cy]] as Point[]).map((p) => ({ point: p, kind: 'quadrant' }));
}

function segmentMids(points: readonly Point[], closed: boolean): Snap[] {
  const out: Snap[] = [];
  const n = points.length;
  for (let i = 0; i < (closed && n > 2 ? n : n - 1); i++) {
    const a = points[i]!;
    const b = points[(i + 1) % n]!;
    out.push({ point: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], kind: 'midpoint' });
  }
  return out;
}
