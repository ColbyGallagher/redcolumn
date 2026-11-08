import { arcPoints } from './arc';
import { flatten, markupShape } from './geometry';
import { TYPE_INFO } from './types';
import { boundsOf, contentBox, isTextType, mapGeometry, rotatePoint, rotationCentre, type Geometry, type Markup, type Point, type Rect } from './model';

export type Alignment = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';
export type Axis = 'horizontal' | 'vertical';

/** The box a markup's own geometry occupies (an arc's curve included), without stroke or decorations. */
export function shapeBounds(m: Markup): Rect {
  return boundsOf(m.type === 'arc' ? arcPoints(m.points) : m.points);
}

/** The box a markup occupies on the page: `shapeBounds`, turned by its rotation. */
function visibleBounds(m: Markup): Rect {
  const b = shapeBounds(m);
  if (!m.rotation) return b;
  const c: Point = [b.x + b.w / 2, b.y + b.h / 2];
  return boundsOf(([[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]] as Point[]).map((p) => rotatePoint(p, c, m.rotation!)));
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

/**
 * New geometry moving the markups together so the centre of their combined bounds sits on the
 * centre of the page. Their positions relative to each other stay as they are.
 */
export function centerOnPage(markups: readonly Markup[], pageW: number, pageH: number): Map<string, Geometry> {
  const out = new Map<string, Geometry>();
  if (!markups.length) return out;
  const all = unionBounds(markups.map(visibleBounds));
  const dx = pageW / 2 - (all.x + all.w / 2);
  const dy = pageH / 2 - (all.y + all.h / 2);
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return out;
  for (const m of markups) out.set(m.id, shift(m, dx, dy));
  return out;
}

/** A markup's geometry stretched by (`sx`, `sy`) about `base`, unlike `scaledAbout` text size and offsets are left alone. */
function stretchedAbout(m: Markup, base: Point, sx: number, sy: number): Geometry {
  return mapGeometry(m, ([x, y]) => [base[0] + (x - base[0]) * sx, base[1] + (y - base[1]) * sy]);
}

/**
 * New geometry giving each target the `reference` markup's width, height or both, as they show on
 * the page. Each is stretched about its own centre; text boxes change shape but keep their font
 * size. A target turned a quarter turn is stretched along its own axes the other way round, so it
 * still ends up the right size on the page; at other angles it is stretched in its own frame.
 * Markups with no extent along an axis are left alone on that axis.
 */
export function matchSize(reference: Markup, targets: readonly Markup[], dimension: 'width' | 'height' | 'both'): Map<string, Geometry> {
  const out = new Map<string, Geometry>();
  const want = visibleBounds(reference);
  for (const m of targets) {
    if (m.id === reference.id) continue;
    const seen = visibleBounds(m);
    let sx = dimension !== 'height' && seen.w > 1e-9 ? want.w / seen.w : 1;
    let sy = dimension !== 'width' && seen.h > 1e-9 ? want.h / seen.h : 1;
    if (Math.round((m.rotation ?? 0) / 90) % 2 !== 0 && (m.rotation ?? 0) % 90 === 0) [sx, sy] = [sy, sx];
    if (Math.abs(sx - 1) < 1e-9 && Math.abs(sy - 1) < 1e-9) continue;
    const b = shapeBounds(m);
    out.set(m.id, stretchedAbout(m, [b.x + b.w / 2, b.y + b.h / 2], sx, sy));
  }
  return out;
}

/**
 * New geometry mirroring the markups across the centre line of their combined bounds. Rotated
 * boxes turn the other way too. Pictures and stamps are moved and turned but their pixels are not
 * mirrored.
 */
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
      { ...mapGeometry(m, ([x, y]) => (axis === 'horizontal' ? [2 * cx - x, y] : [x, 2 * cy - y])), ...(m.bulges ? { bulges: m.bulges.map((b) => -b) } : {}), ...(m.holeBulges ? { holeBulges: m.holeBulges.map((h) => h?.map((b) => -b) ?? null) } : {}), ...(m.rotation ? { rotation: -m.rotation } : {}) },
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

/** The rectangle as a polygon, corner by corner. */
const rectPolygon = (r: Rect): Point[] => [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]];

/** True if segments a-b and c-d share a point (touching ends and collinear overlaps count). */
function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const orient = (p: Point, q: Point, r: Point) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const onSeg = (p: Point, q: Point, r: Point) => Math.min(p[0], q[0]) <= r[0] && r[0] <= Math.max(p[0], q[0]) && Math.min(p[1], q[1]) <= r[1] && r[1] <= Math.max(p[1], q[1]);
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  if (((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0))) return true;
  return (o1 === 0 && onSeg(a, b, c)) || (o2 === 0 && onSeg(a, b, d)) || (o3 === 0 && onSeg(c, d, a)) || (o4 === 0 && onSeg(c, d, b));
}

/**
 * The lines a markup draws and the rings it fills, in page space (turned by its rotation). Text
 * boxes, pictures and stamps count as filled boxes, and area measurements as filled even when
 * their tint is off, so a selection reaches them anywhere inside.
 */
function drawnGeometry(m: Markup): { lines: Point[][]; filled: Point[][] } {
  const lines: Point[][] = [];
  const filled: Point[][] = [];
  const solidArea = m.type === 'area' || m.type === 'volume' || m.type === 'space';
  for (const part of markupShape(m)) {
    if (part.clip) continue;
    for (const ring of flatten(part.path)) {
      if (part.stroke || part.decoration) lines.push(ring);
      if ((part.fill || (solidArea && !part.decoration)) && ring.length > 2) filled.push(ring);
    }
  }
  const info = TYPE_INFO[m.type];
  if (info.solid || info.content === 'text' || info.content === 'image') filled.push(rectPolygon(contentBox(m)));
  if (!lines.length && !filled.length) lines.push(m.type === 'arc' ? arcPoints(m.points) : [...m.points]);
  if (!m.rotation) return { lines, filled };
  const c = rotationCentre(m);
  const turn = (ring: Point[]) => ring.map((p) => rotatePoint(p, c, m.rotation!));
  return { lines: lines.map(turn), filled: filled.map(turn) };
}

/**
 * True if the markup's drawn geometry touches the polygon (crossing selection): a line of it
 * crosses the polygon's edge or lies inside it, or the polygon sits inside something it fills.
 * Real outlines are tested, not bounding boxes.
 */
export function touchesPolygon(m: Markup, polygon: readonly Point[]): boolean {
  if (polygon.length < 3) return false;
  const { lines, filled } = drawnGeometry(m);
  const edges: [Point, Point][] = polygon.map((p, i) => [p, polygon[(i + 1) % polygon.length]!]);
  for (const ring of lines) {
    if (ring.some((p) => pointIn(p, polygon))) return true;
    for (let i = 1; i < ring.length; i++) if (edges.some(([c, d]) => segmentsCross(ring[i - 1]!, ring[i]!, c, d))) return true;
  }
  for (const ring of filled) {
    // The polygon may sit wholly inside what is filled, or the fill's closing edge may cross it.
    if (ring.some((p) => pointIn(p, polygon)) || pointIn(polygon[0]!, ring)) return true;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!;
      const b = ring[(i + 1) % ring.length]!;
      if (edges.some(([c, d]) => segmentsCross(a, b, c, d))) return true;
    }
  }
  return false;
}

/** True if the markup's drawn geometry touches the rectangle (crossing selection by box). */
export function touchesRect(m: Markup, r: Rect): boolean {
  return touchesPolygon(m, rectPolygon(r));
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
const PAINTED_KEYS = ['stroke', 'fill', 'fillOpacity', 'width', 'opacity', 'dash', 'dashArray', 'lineStyle', 'hatch', 'hatchColor', 'hatchScale', 'hatchSpec', 'fontFamily', 'bold', 'italic', 'underline', 'strikethrough', 'textColor', 'textAlign', 'verticalAlign', 'startCap', 'endCap', 'capScale', 'blendMode'] as const;

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

/**
 * A markup grown or shrunk by `factor` about `base` (AutoCAD's Scale): its points and cutouts,
 * the text size of text boxes, and a dimension's offsets. Line widths stay as they are.
 */
export function scaledAbout(m: Markup, base: Point, factor: number): Partial<Markup> {
  const [bx, by] = base;
  const out: Partial<Markup> = mapGeometry(m, ([x, y]) => [bx + (x - bx) * factor, by + (y - by) * factor]);
  const style = { ...m.style };
  let restyled = false;
  for (const key of ['leader', 'labelOffset'] as const) {
    if (style[key]) {
      style[key] = style[key]! * factor;
      restyled = true;
    }
  }
  if (isTextType(m.type) && style.fontSize) {
    style.fontSize = Math.round(style.fontSize * factor * 100) / 100;
    restyled = true;
  }
  return restyled ? { ...out, style } : out;
}
