import { arcPoints } from './arc';
import { boundsOf, mapGeometry, type Geometry, type Markup, type Point, type Rect } from './model';

export type Alignment = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';
export type Axis = 'horizontal' | 'vertical';

/** The box a markup's own geometry occupies (an arc's curve included), without stroke or decorations. */
export function shapeBounds(m: Markup): Rect {
  return boundsOf(m.type === 'arc' ? arcPoints(m.points) : m.points);
}

function unionBounds(rects: readonly Rect[]): Rect {
  const x0 = Math.min(...rects.map((r) => r.x));
  const y0 = Math.min(...rects.map((r) => r.y));
  const x1 = Math.max(...rects.map((r) => r.x + r.w));
  const y1 = Math.max(...rects.map((r) => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

const shift = (m: Markup, dx: number, dy: number): Geometry => mapGeometry(m, ([x, y]) => [x + dx, y + dy]);

/**
 * New geometry for each markup, lined up along one edge or centre line of the markups' combined
 * bounds. Markups already in place are left out.
 */
export function align(markups: readonly Markup[], how: Alignment): Map<string, Geometry> {
  const out = new Map<string, Geometry>();
  if (markups.length < 2) return out;
  const boxes = markups.map(shapeBounds);
  const all = unionBounds(boxes);
  markups.forEach((m, i) => {
    const b = boxes[i]!;
    const dx =
      how === 'left' ? all.x - b.x : how === 'right' ? all.x + all.w - (b.x + b.w) : how === 'center' ? all.x + all.w / 2 - (b.x + b.w / 2) : 0;
    const dy =
      how === 'top' ? all.y - b.y : how === 'bottom' ? all.y + all.h - (b.y + b.h) : how === 'middle' ? all.y + all.h / 2 - (b.y + b.h / 2) : 0;
    if (dx || dy) out.set(m.id, shift(m, dx, dy));
  });
  return out;
}

/**
 * New geometry spacing three or more markups evenly along an axis: the outermost two stay put and
 * the gaps between neighbouring markups become equal.
 */
export function distribute(markups: readonly Markup[], axis: Axis): Map<string, Geometry> {
  const out = new Map<string, Geometry>();
  if (markups.length < 3) return out;
  const h = axis === 'horizontal';
  const items = markups.map((m) => ({ m, b: shapeBounds(m) })).sort((a, b) => (h ? a.b.x - b.b.x : a.b.y - b.b.y));
  const start = h ? items[0]!.b.x : items[0]!.b.y;
  const last = items[items.length - 1]!.b;
  const end = h ? last.x + last.w : last.y + last.h;
  const sizes = items.map(({ b }) => (h ? b.w : b.h));
  const gap = (end - start - sizes.reduce((a, s) => a + s, 0)) / (items.length - 1);
  let at = start;
  items.forEach(({ m, b }, i) => {
    const d = at - (h ? b.x : b.y);
    if (Math.abs(d) > 1e-9) out.set(m.id, h ? shift(m, d, 0) : shift(m, 0, d));
    at += sizes[i]! + gap;
  });
  return out;
}

/** New geometry mirroring the markups across the centre line of their combined bounds. */
export function flip(markups: readonly Markup[], axis: Axis): Map<string, Geometry> {
  const out = new Map<string, Geometry>();
  if (!markups.length) return out;
  const all = unionBounds(markups.map(shapeBounds));
  const cx = all.x + all.w / 2;
  const cy = all.y + all.h / 2;
  for (const m of markups) {
    out.set(
      m.id,
      // A mirror image turns curved segments the other way.
      { ...mapGeometry(m, ([x, y]) => (axis === 'horizontal' ? [2 * cx - x, y] : [x, 2 * cy - y])), ...(m.bulges ? { bulges: m.bulges.map((b) => -b) } : {}), ...(m.holeBulges ? { holeBulges: m.holeBulges.map((h) => h?.map((b) => -b) ?? null) } : {}) },
    );
  }
  return out;
}

/**
 * Creation times that move markups one step up (`forward`) or down (`backward`) in their page's
 * stacking order, past the nearest markup that is not being moved. Markups draw in creation order.
 */
export function restack(page: readonly Markup[], ids: ReadonlySet<string>, direction: 'forward' | 'backward'): Map<string, number> {
  const order = [...page].sort((a, b) => a.createdAt - b.createdAt).map((m) => ({ id: m.id, t: m.createdAt }));
  const out = new Map<string, number>();
  const step = direction === 'forward' ? 1 : -1;
  // Walk from the end the markups move toward, so moved markups do not leapfrog each other.
  const indices = order.map((_, i) => i);
  if (direction === 'forward') indices.reverse();
  for (const i of indices) {
    const j = i + step;
    if (!ids.has(order[i]!.id) || j < 0 || j >= order.length || ids.has(order[j]!.id)) continue;
    const a = order[i]!;
    const b = order[j]!;
    [a.t, b.t] = [b.t, a.t];
    [order[i], order[j]] = [b, a];
    out.set(a.id, a.t);
    out.set(b.id, b.t);
  }
  return out;
}

/**
 * Where each copy of a selection goes when multiplied into a grid: offsets (dx, dy) for every
 * cell except the original's, in rows then columns. `gapX` and `gapY` are the space between
 * neighbouring copies.
 */
export function multiplyOffsets(bounds: Rect, rows: number, columns: number, gapX: number, gapY: number): [number, number][] {
  const out: [number, number][] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      if (r === 0 && c === 0) continue;
      out.push([c * (bounds.w + gapX), r * (bounds.h + gapY)]);
    }
  }
  return out;
}

/** True if every point of the markup's shape lies inside the polygon (lasso selection). */
export function insidePolygon(m: Markup, polygon: readonly Point[]): boolean {
  const pts = m.type === 'arc' ? arcPoints(m.points) : m.points;
  return pts.length > 0 && pts.every((p) => pointIn(p, polygon));
}

/** True if the markup's shape lies entirely inside the rectangle (box selection). */
export function insideRect(m: Markup, r: Rect): boolean {
  const b = shapeBounds(m);
  return b.x >= r.x && b.y >= r.y && b.x + b.w <= r.x + r.w && b.y + b.h <= r.y + r.h;
}

function pointIn([px, py]: readonly [number, number], poly: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Style keys a Format Painter carries from one markup to another. */
const PAINTED_KEYS = ['stroke', 'fill', 'fillOpacity', 'width', 'opacity', 'dash', 'hatch', 'fontFamily', 'bold', 'italic', 'underline', 'textColor', 'textAlign', 'verticalAlign', 'startCap', 'endCap', 'capScale'] as const;

/**
 * The style `target` takes when painted with `source`'s format: its appearance (colours, line,
 * fill, font) but not sizes chosen for the zoom it was drawn at (cloud arcs, count markers, label
 * size) unless both markups are the same type.
 */
export function paintedStyle(source: Markup, target: Markup): Markup['style'] {
  if (source.type === target.type) return { ...source.style };
  const style: Record<string, unknown> = { ...target.style };
  for (const k of PAINTED_KEYS) {
    const v = source.style[k];
    if (v === undefined) delete style[k];
    else style[k] = v;
  }
  return style as unknown as Markup['style'];
}
