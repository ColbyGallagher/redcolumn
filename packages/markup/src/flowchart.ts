import { boundsOf, rotatePoint, rotationCentre, type FlowShapeKind, type ManualRoute, type Markup, type Point, type Rect, type Side } from './model';
import { TYPE_INFO } from './types';

/** The flowchart shapes in palette order, with what each means and the size a click places it at (points). */
export const FLOW_SHAPES: readonly { kind: FlowShapeKind; label: string; hint: string; size: readonly [w: number, h: number] }[] = [
  { kind: 'process', label: 'Process', hint: 'A step in the process', size: [120, 60] },
  { kind: 'decision', label: 'Decision', hint: 'A yes or no question; connectors leave it for each answer', size: [130, 80] },
  { kind: 'terminator', label: 'Start / End', hint: 'Where the process starts or ends', size: [120, 50] },
  { kind: 'data', label: 'Data', hint: 'Input or output', size: [130, 60] },
  { kind: 'document', label: 'Document', hint: 'A document or report', size: [120, 70] },
  { kind: 'predefined', label: 'Subprocess', hint: 'A process described elsewhere', size: [130, 60] },
  { kind: 'preparation', label: 'Preparation', hint: 'Setting up for a later step', size: [130, 60] },
  { kind: 'manualInput', label: 'Manual Input', hint: 'Information entered by hand', size: [120, 60] },
  { kind: 'database', label: 'Database', hint: 'Stored data', size: [90, 80] },
  { kind: 'circle', label: 'On-page Reference', hint: 'Joins flow lines across the page', size: [50, 50] },
];

/** A flowchart shape's name. */
export function flowShapeLabel(kind: FlowShapeKind | undefined): string {
  return FLOW_SHAPES.find((s) => s.kind === (kind ?? 'process'))?.label ?? 'Process';
}

/** Markups a connector can be glued to: flowchart shapes and other boxes and outlines (not lines or connectors). */
export function canConnect(m: Pick<Markup, 'type' | 'points'>): boolean {
  const info = TYPE_INFO[m.type];
  return m.type !== 'connector' && m.points.length >= 2 && (info.handles === 'box' || (info.closed && m.points.length > 2));
}

const SIDES: readonly Side[] = ['top', 'right', 'bottom', 'left'];
const NORMALS: Record<Side, Point> = { top: [0, -1], right: [1, 0], bottom: [0, 1], left: [-1, 0] };

type Shape = Pick<Markup, 'type' | 'points' | 'rotation'>;

/** Where a connector meets a side of a shape (the middle of that side of its box) and the way it leaves, both turned with the shape. */
export function anchorOf(shape: Shape, side: Side): { at: Point; dir: Point } {
  const b = boundsOf(shape.points);
  const at: Point = side === 'top' ? [b.x + b.w / 2, b.y] : side === 'bottom' ? [b.x + b.w / 2, b.y + b.h] : side === 'left' ? [b.x, b.y + b.h / 2] : [b.x + b.w, b.y + b.h / 2];
  const dir = NORMALS[side];
  if (!shape.rotation) return { at, dir };
  const c = rotationCentre(shape);
  // Directions on an axis stay exact, so an elbow route still fits a shape turned a quarter.
  const [dx, dy] = rotatePoint(dir, [0, 0], shape.rotation).map((v) => (Math.abs(v) < 1e-9 ? 0 : v));
  return { at: rotatePoint(at, c, shape.rotation), dir: [dx!, dy!] };
}

/** A shape's four connection points. */
export function anchorsOf(shape: Shape): { side: Side; at: Point }[] {
  return SIDES.map((side) => ({ side, at: anchorOf(shape, side).at }));
}

/** The side whose connection point is nearest `p`. */
export function nearestSide(shape: Shape, p: Point): Side {
  let best: Side = 'top';
  let bestD = Infinity;
  for (const { side, at } of anchorsOf(shape)) {
    const d = Math.hypot(at[0] - p[0], at[1] - p[1]);
    if (d < bestD) {
      bestD = d;
      best = side;
    }
  }
  return best;
}

/** Bounds of a shape as it is drawn (turned with it). */
function shapeRect(shape: Shape): Rect {
  const b = boundsOf(shape.points);
  if (!shape.rotation) return b;
  const c = rotationCentre(shape);
  return boundsOf(([[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]] as Point[]).map((p) => rotatePoint(p, c, shape.rotation!)));
}

/**
 * The sides two boxes face each other with: one above the other joins bottom to top, side by side
 * joins right to left, whichever gap between them is the larger.
 */
export function facingSides(a: Rect, b: Rect): [Side, Side] {
  const gapX = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
  const gapY = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
  const dx = b.x + b.w / 2 - (a.x + a.w / 2);
  const dy = b.y + b.h / 2 - (a.y + a.h / 2);
  if (gapY >= gapX) return dy >= 0 ? ['bottom', 'top'] : ['top', 'bottom'];
  return dx >= 0 ? ['right', 'left'] : ['left', 'right'];
}

/** How far an elbow connector runs straight out of a shape before it first turns, in points. */
export const CONNECTOR_STUB = 12;

/**
 * A connector's points, routed between the shapes its ends are glued to (`get` looks them up). An
 * end that is not glued, or whose shape is gone (or on another page), stays where it is; it glues
 * again if the shape comes back (undoing its deletion). Unglued connectors keep their points.
 */
export function routeConnector(c: Pick<Markup, 'points' | 'connect' | 'pageIndex'>, get: (id: string) => Markup | undefined): Point[] {
  const links = c.connect;
  const first = c.points[0];
  const last = c.points[c.points.length - 1];
  if (!links || !first || !last) return c.points;
  const glued = (id: string | undefined) => {
    const m = id ? get(id) : undefined;
    return m && m.pageIndex === c.pageIndex && canConnect(m) ? m : undefined;
  };
  const from = glued(links.from?.id);
  const to = glued(links.to?.id);
  if (!from && !to) return c.points;
  const fromRect = from ? shapeRect(from) : { x: first[0], y: first[1], w: 0, h: 0 };
  const toRect = to ? shapeRect(to) : { x: last[0], y: last[1], w: 0, h: 0 };
  const [sideA, sideB] = facingSides(fromRect, toRect);
  const a: End = from ? anchorOf(from, links.from?.side ?? sideA) : { at: first, dir: null };
  const b: End = to ? anchorOf(to, links.to?.side ?? sideB) : { at: last, dir: null };
  if (links.route === 'straight') return [a.at, b.at];
  const boxes = [from ? fromRect : null, to ? toRect : null].filter((r): r is Rect => !!r);
  // A route set by hand is kept while it still leaves and enters the right way and misses the shapes.
  const manual = links.bends && manualRoute(a, b, links.bends);
  if (manual && routeCost(manual, a, b, boxes) < 1e4) return manual;
  return elbowRoute(a, b, boxes);
}

const turn = (o: 'h' | 'v'): 'h' | 'v' => (o === 'h' ? 'v' : 'h');

/** The points of a hand-set route between two ends (null when it cannot leave or enter them along their sides). */
export function manualRoute(a: End, b: End, route: ManualRoute): Point[] | null {
  const n = route.mids.length + 2;
  const orient = (i: number) => (i % 2 ? turn(route.first) : route.first);
  const axisOf = (d: Point | null) => (!d ? null : d[0] !== 0 && d[1] === 0 ? 'h' : d[1] !== 0 && d[0] === 0 ? 'v' : 'x');
  const da = axisOf(a.dir);
  const db = axisOf(b.dir);
  if ((da && da !== orient(0)) || (db && db !== orient(n - 1))) return null;
  return simplify(routePath(a.at, b.at, route));
}

/** Every vertex of a hand-set route from `a` to `b`, segments of no length included. */
function routePath(a: Point, b: Point, route: ManualRoute): Point[] {
  const n = route.mids.length + 2;
  const orient = (i: number) => (i % 2 ? turn(route.first) : route.first);
  const base = (i: number) => (orient(i) === 'h' ? a[1] : a[0]);
  const coord = (i: number) => (i === 0 ? base(0) : i === n - 1 ? (orient(n - 1) === 'h' ? b[1] : b[0]) : base(i) + route.mids[i - 1]!);
  const path: Point[] = [a];
  for (let i = 1; i < n; i++) path.push(orient(i - 1) === 'h' ? [coord(i), coord(i - 1)] : [coord(i - 1), coord(i)]);
  path.push(b);
  return path;
}

const samePath = (p: readonly Point[], q: readonly Point[]) => p.length === q.length && p.every((a, i) => Math.abs(a[0] - q[i]![0]) < 1e-6 && Math.abs(a[1] - q[i]![1]) < 1e-6);

/**
 * The route to edit on a connector drawn along `points`: its hand-set one while that is what is
 * drawn (keeping segments of no length, such as a bend just added), else the drawn path's own.
 */
export function editableRoute(points: readonly Point[], bends?: ManualRoute): ManualRoute | null {
  const a = points[0];
  const b = points[points.length - 1];
  if (bends && a && b && samePath(simplify(routePath(a, b, bends)), simplify([...points]))) return bends;
  return routeOf(points);
}

/** A right-angled path by its segments: which way the first runs, and where each runs. Null when a piece is slanted or doubles back. */
function segmentsOf(points: readonly Point[]): { first: 'h' | 'v'; coords: number[]; path: Point[] } | null {
  const path = simplify([...points]);
  if (path.length < 2) return null;
  const orients: ('h' | 'v')[] = [];
  const coords: number[] = [];
  for (let i = 1; i < path.length; i++) {
    const [s, e] = [path[i - 1]!, path[i]!];
    if (Math.abs(s[1] - e[1]) < 1e-6) {
      orients.push('h');
      coords.push(s[1]);
    } else if (Math.abs(s[0] - e[0]) < 1e-6) {
      orients.push('v');
      coords.push(s[0]);
    } else return null;
  }
  // Simplified, each piece turns from the last; two running the same way are a U-turn.
  if (orients.some((o, i) => i > 0 && o === orients[i - 1])) return null;
  return { first: orients[0]!, coords, path };
}

/** Segment coordinates (where each runs) as a route's `mids`: those of the middle segments, measured from the start. */
function midsOf(first: 'h' | 'v', coords: readonly number[], start: Point): number[] {
  return coords.slice(1, -1).map((c, i) => c - ((i % 2 ? first : turn(first)) === 'h' ? start[1] : start[0]));
}

/** A right-angled path as a route to edit by hand. Null when a piece is slanted, or it has no middle segment to move. */
export function routeOf(points: readonly Point[]): ManualRoute | null {
  const segs = segmentsOf(points);
  return segs && segs.coords.length >= 3 ? { first: segs.first, mids: midsOf(segs.first, segs.coords, segs.path[0]!) } : null;
}

/**
 * The handle on each middle segment of a connector drawn along `points` (by `bends` while that is its
 * route): where it is drawn, its index in the route's `mids`, and which way the segment runs.
 */
export function routeHandles(points: readonly Point[], bends?: ManualRoute): { mid: number; at: Point; runs: 'h' | 'v' }[] {
  const route = editableRoute(points, bends);
  if (!route || points.length < 2) return [];
  const path = routePath(points[0]!, points[points.length - 1]!, route);
  return route.mids.map((_, i) => {
    const [s, e] = [path[i + 1]!, path[i + 2]!];
    return { mid: i, at: [(s[0] + e[0]) / 2, (s[1] + e[1]) / 2] as Point, runs: (i % 2 ? route.first : turn(route.first)) as 'h' | 'v' };
  });
}

/** A middle segment moved across to `to` (a y for an across segment, an x for an up-and-down one) on a route from `start`. */
export function moveSegment(route: ManualRoute, mid: number, to: number, start: Point): ManualRoute {
  const across = (mid % 2 ? route.first : turn(route.first)) === 'h';
  return { ...route, mids: route.mids.map((c, i) => (i === mid ? to - (across ? start[1] : start[0]) : c)) };
}

/**
 * A bend added where `at` falls on a right-angled path: the segment there splits in two with a step
 * of no length between them, to be dragged out. Null when `at` is not on a segment.
 */
export function addBend(points: readonly Point[], at: Point, tolerance = 4): ManualRoute | null {
  const segs = segmentsOf(points);
  if (!segs) return null;
  const { path, coords } = segs;
  for (let k = 0; k < coords.length; k++) {
    const [s, e] = [path[k]!, path[k + 1]!];
    const across = (k % 2 ? turn(segs.first) : segs.first) === 'h';
    const [lo, hi] = across ? [Math.min(s[0], e[0]), Math.max(s[0], e[0])] : [Math.min(s[1], e[1]), Math.max(s[1], e[1])];
    const along = across ? at[0] : at[1];
    const off = Math.abs((across ? at[1] : at[0]) - coords[k]!);
    if (off > tolerance || along < lo || along > hi) continue;
    const next = [...coords.slice(0, k + 1), along, coords[k]!, ...coords.slice(k + 1)];
    return { first: segs.first, mids: midsOf(segs.first, next, path[0]!) };
  }
  return null;
}

/**
 * The route with middle segment `mid` taken out, the segments either side joining up: where an end
 * segment runs if one of them is one, else where the one before ran. `undefined` when the two ends
 * then meet in one straight run (no route to keep), null when they would not line up.
 */
export function removeSegment(route: ManualRoute, mid: number, a: Point, b: Point): ManualRoute | null | undefined {
  const n = route.mids.length + 2;
  const orient = (i: number) => (i % 2 ? turn(route.first) : route.first);
  const base = (i: number) => (orient(i) === 'h' ? a[1] : a[0]);
  const c = [base(0), ...route.mids.map((m, i) => base(i + 1) + m), orient(n - 1) === 'h' ? b[1] : b[0]];
  const s = mid + 1;
  if (s - 1 === 0 && s + 1 === n - 1) return Math.abs(c[0]! - c[n - 1]!) < 1e-6 ? undefined : null;
  const joined = s + 1 === n - 1 ? c[n - 1]! : s - 1 === 0 ? c[0]! : c[s - 1]!;
  const next = [...c.slice(0, s - 1), joined, ...c.slice(s + 2)];
  return { first: route.first, mids: midsOf(route.first, next, a) };
}

/** An end of a route: where it is, and the way it must leave or enter (any way when null). */
export type End = { at: Point; dir: Point | null };

/**
 * An orthogonal path from `a` to `b`: out of each glued end along its direction, then whichever
 * candidate has the fewest turns and shortest run without cutting through either shape or
 * doubling back on itself.
 */
export function elbowRoute(a: End, b: End, boxes: readonly Rect[] = []): Point[] {
  // A shape turned to an odd angle leaves off the axes; a straight line suits it best.
  const square = (d: Point | null) => !d || d[0] === 0 || d[1] === 0;
  if (!square(a.dir) || !square(b.dir)) return [a.at, b.at];
  const out = (e: End): Point => (e.dir ? [e.at[0] + e.dir[0] * CONNECTOR_STUB, e.at[1] + e.dir[1] * CONNECTOR_STUB] : e.at);
  const xs: number[] = [];
  const ys: number[] = [];
  // Ways round the shapes, for ends that face away from each other.
  for (const r of boxes) {
    xs.push(r.x - CONNECTOR_STUB, r.x + r.w + CONNECTOR_STUB);
    ys.push(r.y - CONNECTOR_STUB, r.y + r.h + CONNECTOR_STUB);
  }
  let best: Point[] = [a.at, b.at];
  let bestScore = Infinity;
  const consider = (path: Point[]) => {
    const p = simplify(path);
    const score = routeCost(p, a, b, boxes);
    if (score < bestScore) {
      bestScore = score;
      best = p;
    }
  };
  // From just outside each shape, and (for shapes close together) straight from the ends themselves.
  for (const [a1, b1] of [[out(a), out(b)], [a.at, b.at]] as [Point, Point][]) {
    const px = new Set([(a1[0] + b1[0]) / 2, a1[0], b1[0], ...xs]);
    const py = new Set([(a1[1] + b1[1]) / 2, a1[1], b1[1], ...ys]);
    const via = (...mid: Point[]) => consider([a.at, a1, ...mid, b1, b.at]);
    via([a1[0], b1[1]]);
    via([b1[0], a1[1]]);
    for (const x of px) via([x, a1[1]], [x, b1[1]]);
    for (const y of py) via([a1[0], y], [b1[0], y]);
    // Three turns: out along one axis, across, then over to the other end.
    for (const x of px) {
      for (const y of py) {
        via([x, a1[1]], [x, y], [b1[0], y]);
        via([a1[0], y], [x, y], [x, b1[1]]);
      }
    }
  }
  return best;
}

/** Length and turns, plus penalties for a slanted piece, cutting through a shape, doubling back, or leaving or entering a shape the wrong way. */
function routeCost(path: Point[], a: End, b: End, boxes: readonly Rect[]): number {
  let cost = 0;
  let prev: Point | null = null;
  for (let i = 1; i < path.length; i++) {
    const [p, q] = [path[i - 1]!, path[i]!];
    if (Math.abs(q[0] - p[0]) > 1e-6 && Math.abs(q[1] - p[1]) > 1e-6) cost += 1e6;
    const dir: Point = [Math.sign(q[0] - p[0]), Math.sign(q[1] - p[1])];
    if (prev) cost += prev[0] === -dir[0] && prev[1] === -dir[1] ? 1e5 : 20;
    prev = dir;
    cost += Math.hypot(q[0] - p[0], q[1] - p[1]);
    for (const r of boxes) if (crosses(p, q, r)) cost += 1e4;
  }
  const leave = path.length > 1 ? unit(path[0]!, path[1]!) : null;
  const enter = path.length > 1 ? unit(path[path.length - 1]!, path[path.length - 2]!) : null;
  if (a.dir && leave && leave[0] * a.dir[0] + leave[1] * a.dir[1] < 0.5) cost += 1e4;
  if (b.dir && enter && enter[0] * b.dir[0] + enter[1] * b.dir[1] < 0.5) cost += 1e4;
  return cost;
}

function unit(p: Point, q: Point): Point | null {
  const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
  return d > 1e-9 ? [(q[0] - p[0]) / d, (q[1] - p[1]) / d] : null;
}

/** Whether the axis-aligned piece p–q runs through the inside of `r` (along its edge does not count). */
function crosses(p: Point, q: Point, r: Rect): boolean {
  const e = 0.5;
  const [x0, x1] = [Math.min(p[0], q[0]), Math.max(p[0], q[0])];
  const [y0, y1] = [Math.min(p[1], q[1]), Math.max(p[1], q[1])];
  return x1 > r.x + e && x0 < r.x + r.w - e && y1 > r.y + e && y0 < r.y + r.h - e;
}

/** The path without repeated points or points in the middle of a straight run (a U-turn stays, and costs). */
function simplify(path: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of path) {
    const last = out[out.length - 1];
    if (!last || Math.abs(last[0] - p[0]) > 1e-9 || Math.abs(last[1] - p[1]) > 1e-9) out.push(p);
  }
  for (let i = out.length - 2; i > 0; i--) {
    const [a, b, c] = [out[i - 1]!, out[i]!, out[i + 1]!];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    const dot = (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]);
    if (Math.abs(cross) < 1e-9 && dot >= 0) out.splice(i, 1);
  }
  return out;
}

/** Whether a connector is glued to any of `ids`. */
export function gluedTo(c: Pick<Markup, 'type' | 'connect'>, ids: ReadonlySet<string>): boolean {
  return c.type === 'connector' && (!!(c.connect?.from && ids.has(c.connect.from.id)) || !!(c.connect?.to && ids.has(c.connect.to.id)));
}

/**
 * Copies of markups made together (pasted, multiplied...): each copied connector is glued to the
 * copies of its shapes (`ids` maps old ids to new), and comes loose from shapes that were not copied.
 */
export function relinkCopies<T extends Pick<Markup, 'type' | 'connect'>>(copies: readonly T[], ids: ReadonlyMap<string, string>): T[] {
  return copies.map((m) => {
    if (m.type !== 'connector' || !m.connect) return m;
    const { from, to, ...rest } = m.connect;
    const fromId = from && ids.get(from.id);
    const toId = to && ids.get(to.id);
    return { ...m, connect: { ...rest, ...(fromId ? { from: { ...from, id: fromId } } : {}), ...(toId ? { to: { ...to, id: toId } } : {}) } };
  });
}

/** Where a connector's text goes: halfway along its path. */
export function connectorLabel(m: Pick<Markup, 'type' | 'points' | 'text' | 'style'>): { text: string; at: Point; size: number } | null {
  if (m.type !== 'connector' || !m.text?.trim() || m.points.length < 2) return null;
  let total = 0;
  for (let i = 1; i < m.points.length; i++) total += Math.hypot(m.points[i]![0] - m.points[i - 1]![0], m.points[i]![1] - m.points[i - 1]![1]);
  let left = total / 2;
  let at = m.points[0]!;
  for (let i = 1; i < m.points.length; i++) {
    const [p, q] = [m.points[i - 1]!, m.points[i]!];
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (len >= left && len > 0) {
      at = [p[0] + ((q[0] - p[0]) * left) / len, p[1] + ((q[1] - p[1]) * left) / len];
      break;
    }
    left -= len;
    at = q;
  }
  return { text: m.text.trim(), at, size: m.style.fontSize ?? 9 };
}
