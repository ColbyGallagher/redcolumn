// CAD-style edits (AutoCAD's Modify tools) as plain geometry: trim, extend, break, lengthen,
// fillet, chamfer, join, explode, mirror, rotate, align, arrays, divide and stretch. Paths are
// lists of points; the web app's tools pick what to work on and apply the results.
import { arcPoints as arcSegmentPoints, bulgeThrough } from '@nb/measure';
import { flatten, markupShape } from './geometry';
import { boundsOf, outlinePoints, rotatePoint, rotationCentre, ROTATABLE, isTextType, type Markup, type MarkupType, type Point, type Rect } from './model';
import { TYPE_INFO } from './types';

type Pt = readonly [number, number];

const EPS = 1e-6;

const sub = (a: Pt, b: Pt): Point => [a[0] - b[0], a[1] - b[1]];
const add = (a: Pt, b: Pt): Point => [a[0] + b[0], a[1] + b[1]];
const mul = (a: Pt, k: number): Point => [a[0] * k, a[1] * k];
const dot = (a: Pt, b: Pt) => a[0] * b[0] + a[1] * b[1];
const cross = (a: Pt, b: Pt) => a[0] * b[1] - a[1] * b[0];
const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const lerp = (a: Pt, b: Pt, t: number): Point => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const unit = (a: Pt): Point => {
  const l = Math.hypot(a[0], a[1]) || 1;
  return [a[0] / l, a[1] / l];
};
const copy = (p: Pt): Point => [p[0], p[1]];

// ---- What can be edited how ------------------------------------------------------------------

/** Open paths that Trim, Extend, Break and Lengthen cut and grow (straight segments only). */
const OPEN_PATHS: ReadonlySet<MarkupType> = new Set<MarkupType>(['line', 'arrow', 'polyline', 'length', 'polylength']);
/** Closed outlines whose corners Fillet and Chamfer round off. */
const CLOSED_PATHS: ReadonlySet<MarkupType> = new Set<MarkupType>(['polygon', 'area', 'perimeter', 'volume']);
/** Types whose segments can curve (`Markup.bulges`). */
const BULGE_TYPES: ReadonlySet<MarkupType> = new Set<MarkupType>(['polylength', 'area', 'perimeter', 'volume']);

/** True if Trim, Extend, Break and Lengthen work on the markup: an open path with straight segments. */
export function canCut(m: Pick<Markup, 'type' | 'points' | 'bulges'>): boolean {
  return OPEN_PATHS.has(m.type) && m.points.length >= 2 && !m.bulges?.some(Boolean);
}

/** True if Fillet and Chamfer work on the markup's segments (open paths, or the corners of closed outlines). */
export function canCorner(m: Pick<Markup, 'type' | 'points' | 'bulges'>): boolean {
  return (OPEN_PATHS.has(m.type) || CLOSED_PATHS.has(m.type)) && m.points.length >= 2 && !m.bulges?.some(Boolean);
}

/** True if Join can chain the markup onto others: an open path. */
export function canJoin(m: Pick<Markup, 'type' | 'points'>): boolean {
  return OPEN_PATHS.has(m.type) && m.points.length >= 2;
}

/** True if Explode splits the markup into single segments. */
export function canExplode(m: Pick<Markup, 'type' | 'points'>): boolean {
  return ((m.type === 'polyline' || m.type === 'polylength' || CLOSED_PATHS.has(m.type)) && m.points.length > 2) || m.type === 'rect';
}

// ---- Outlines --------------------------------------------------------------------------------

/**
 * The lines a markup is drawn with, in page space: the edges Trim cuts to and Extend reaches for.
 * Text, pictures and counts have none.
 */
export function edgesOf(m: Markup): Point[][] {
  const info = TYPE_INFO[m.type];
  if (info.content || m.type === 'count' || m.hidden || info.draw === 'place') return [];
  const parts = markupShape({ ...m, rotation: undefined, style: { ...m.style, hatch: undefined, hatchSpec: undefined } });
  const lines = parts.filter((p) => p.stroke && !p.decoration && p.path.length).flatMap((p) => flatten(p.path, 8));
  if (!m.rotation) return lines;
  const c = rotationCentre(m);
  return lines.map((l) => l.map((p) => rotatePoint(p, c, m.rotation!)));
}

/**
 * The path a markup runs along, for Divide, Measure and Path Array: its points (curves traced) and
 * whether it closes on itself. Null for markups that are not lines or outlines.
 */
export function pathOf(m: Markup): { points: Point[]; closed: boolean } | null {
  if (OPEN_PATHS.has(m.type)) return { points: outlinePoints(m).map(copy), closed: false };
  if (CLOSED_PATHS.has(m.type) || m.type === 'space') return m.points.length > 2 ? { points: outlinePoints(m).map(copy), closed: true } : null;
  const [edge] = edgesOf(m);
  if (!edge || edge.length < 2) return null;
  const closed = edge.length > 2 && dist(edge[0]!, edge.at(-1)!) < EPS;
  return { points: closed ? edge.slice(0, -1) : edge, closed };
}

/** Total length of a path. */
export function pathLengthOf(points: readonly Pt[], closed = false): number {
  let l = 0;
  const n = closed ? points.length : points.length - 1;
  for (let i = 0; i < n; i++) l += dist(points[i]!, points[(i + 1) % points.length]!);
  return l;
}

/** Where a path is `s` along it, and its direction there in degrees (clockwise from east, page space). */
export function pointAlong(points: readonly Pt[], closed: boolean, s: number): { point: Point; angle: number } {
  const n = closed ? points.length : points.length - 1;
  let left = s;
  for (let i = 0; i < n; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    const l = dist(a, b);
    if (left <= l + EPS || i === n - 1) {
      const t = l ? Math.min(1, Math.max(0, left / l)) : 0;
      return { point: lerp(a, b, t), angle: (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI };
    }
    left -= l;
  }
  return { point: copy(points[0] ?? [0, 0]), angle: 0 };
}

/**
 * Divide (`count` equal parts) or Measure (every `spacing`): the points along a path where the
 * marks go. An open path gets marks between its ends; a closed one starts at its first point.
 */
export function divisionPoints(points: readonly Pt[], closed: boolean, by: { count: number } | { spacing: number }): { point: Point; angle: number }[] {
  const total = pathLengthOf(points, closed);
  if (!(total > EPS)) return [];
  const at: number[] = [];
  if ('count' in by) {
    const n = Math.max(2, Math.floor(by.count));
    for (let k = closed ? 0 : 1; k < n; k++) at.push((total * k) / n);
  } else {
    if (!(by.spacing > EPS)) return [];
    for (let s = closed ? 0 : by.spacing; s < total - EPS && at.length < 10000; s += by.spacing) at.push(s);
  }
  return at.map((s) => pointAlong(points, closed, s));
}

// ---- Intersections ---------------------------------------------------------------------------

/** Where segments p0→p1 and q0→q1 cross: the fraction along each, or null if they do not. */
function segmentHit(p0: Pt, p1: Pt, q0: Pt, q1: Pt): { t: number; u: number } | null {
  const r = sub(p1, p0);
  const s = sub(q1, q0);
  const den = cross(r, s);
  if (Math.abs(den) < 1e-12) return null;
  const qp = sub(q0, p0);
  const t = cross(qp, s) / den;
  const u = cross(qp, r) / den;
  if (u < -EPS || u > 1 + EPS) return null;
  return { t, u };
}

/** Where infinite lines through a→b and c→d meet, or null if parallel. */
export function lineIntersection(a: Pt, b: Pt, c: Pt, d: Pt): Point | null {
  const r = sub(b, a);
  const s = sub(d, c);
  const den = cross(r, s);
  if (Math.abs(den) < 1e-12) return null;
  const t = cross(sub(c, a), s) / den;
  return add(a, mul(r, t));
}

/** Path positions (segment index plus fraction) where an open path crosses any of the edges, in order. */
function crossings(points: readonly Pt[], edges: readonly (readonly Pt[])[]): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    for (const e of edges) {
      for (let j = 0; j + 1 < e.length; j++) {
        const h = segmentHit(points[i]!, points[i + 1]!, e[j]!, e[j + 1]!);
        if (h && h.t >= -EPS && h.t <= 1 + EPS) out.push(i + Math.min(1, Math.max(0, h.t)));
      }
    }
  }
  return out.sort((a, b) => a - b);
}

/** The nearest point on a path to `p`: its position (segment index plus fraction) and distance. */
export function nearestOnPath(points: readonly Pt[], p: Pt, closed = false): { at: number; segment: number; point: Point; distance: number } {
  let best = { at: 0, segment: 0, point: copy(points[0] ?? [0, 0]), distance: Infinity };
  const n = closed ? points.length : points.length - 1;
  for (let i = 0; i < n; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    const d = sub(b, a);
    const len2 = dot(d, d);
    const t = len2 ? Math.max(0, Math.min(1, dot(sub(p, a), d) / len2)) : 0;
    const q = add(a, mul(d, t));
    const dd = dist(p, q);
    if (dd < best.distance) best = { at: i + t, segment: i, point: q, distance: dd };
  }
  return best;
}

/** The point at a path position (segment index plus fraction). */
function at(points: readonly Pt[], s: number): Point {
  const i = Math.min(points.length - 2, Math.max(0, Math.floor(s)));
  return lerp(points[i]!, points[i + 1]!, s - i);
}

/** The part of an open path between two positions. */
export function subPath(points: readonly Pt[], from: number, to: number): Point[] {
  const out: Point[] = [at(points, from)];
  for (let i = Math.floor(from) + 1; i < to - EPS && i < points.length; i++) out.push(copy(points[i]!));
  const end = at(points, to);
  if (dist(end, out.at(-1)!) > EPS || out.length === 1) out.push(end);
  return out;
}

const longEnough = (p: readonly Pt[]) => p.length >= 2 && pathLengthOf(p) > 1e-3;

// ---- Trim, Extend, Break, Lengthen -----------------------------------------------------------

/**
 * Trim: what is left of an open path after cutting out the piece around `click` between the
 * nearest edges crossing it on either side. Null when no edge crosses the piece clicked.
 */
export function trimPath(points: readonly Pt[], edges: readonly (readonly Pt[])[], click: Pt): Point[][] | null {
  const c = nearestOnPath(points, click).at;
  const end = points.length - 1;
  // Crossings at the very ends do not bound a piece.
  const hits = crossings(points, edges).filter((s) => s > EPS && s < end - EPS);
  const lo = hits.filter((s) => s < c).at(-1);
  const hi = hits.find((s) => s > c);
  if (lo === undefined && hi === undefined) return null;
  const pieces: Point[][] = [];
  if (lo !== undefined) pieces.push(subPath(points, 0, lo));
  if (hi !== undefined) pieces.push(subPath(points, hi, end));
  return pieces.filter(longEnough);
}

/** The part of the path a Trim click at `click` would remove (between the crossings either side of it); null when nothing crosses it. */
export function trimmedPart(points: readonly Pt[], edges: readonly (readonly Pt[])[], click: Pt): Point[] | null {
  const c = nearestOnPath(points, click).at;
  const end = points.length - 1;
  const hits = crossings(points, edges).filter((s) => s > EPS && s < end - EPS);
  const lo = hits.filter((s) => s < c).at(-1);
  const hi = hits.find((s) => s > c);
  if (lo === undefined && hi === undefined) return null;
  return subPath(points, lo ?? 0, hi ?? end);
}

/** Which end of an open path is nearer `click` along it: 0 for the start, 1 for the end. */
export function nearerEnd(points: readonly Pt[], click: Pt): 0 | 1 {
  const c = nearestOnPath(points, click).at;
  const s = pathLengthOf(subPath(points, 0, c));
  return s <= pathLengthOf(points) / 2 ? 0 : 1;
}

/**
 * Extend: the open path with its end nearer `click` carried on in a straight line to the nearest
 * edge it meets. Null when nothing lies ahead.
 */
export function extendPath(points: readonly Pt[], edges: readonly (readonly Pt[])[], click: Pt): Point[] | null {
  const which = nearerEnd(points, click);
  const pts = points.map(copy);
  const tip = which === 0 ? pts[0]! : pts.at(-1)!;
  const prev = which === 0 ? pts[1]! : pts.at(-2)!;
  const dir = sub(tip, prev);
  if (Math.hypot(dir[0], dir[1]) < EPS) return null;
  let best = Infinity;
  for (const e of edges) {
    for (let j = 0; j + 1 < e.length; j++) {
      const h = segmentHit(prev, tip, e[j]!, e[j + 1]!);
      // Beyond the tip (t > 1), not back along the path.
      if (h && h.t > 1 + 1e-4 && h.t < best) best = h.t;
    }
  }
  if (!Number.isFinite(best)) return null;
  const to = add(prev, mul(dir, best));
  if (which === 0) pts[0] = to;
  else pts[pts.length - 1] = to;
  return pts;
}

/**
 * Break: an open path with the part between two points on it taken out, or split in two at one
 * point when they meet.
 */
export function breakPath(points: readonly Pt[], a: Pt, b: Pt): Point[][] {
  let s = nearestOnPath(points, a).at;
  let t = nearestOnPath(points, b).at;
  if (s > t) [s, t] = [t, s];
  const end = points.length - 1;
  if (t - s < 1e-4) return [subPath(points, 0, s), subPath(points, s, end)].filter(longEnough);
  return [subPath(points, 0, s), subPath(points, t, end)].filter(longEnough);
}

/** Lengthen's ways of setting the new length: change by an amount, a total, or a percentage. */
export type LengthenMode = 'delta' | 'total' | 'percent';

/**
 * Lengthen: an open path made longer or shorter at its end nearer `click`. Longer carries the end
 * segment straight on; shorter cuts back along the path. Null if it would vanish.
 */
export function lengthenPath(points: readonly Pt[], click: Pt, mode: LengthenMode, value: number): Point[] | null {
  const total = pathLengthOf(points);
  const target = mode === 'total' ? value : mode === 'percent' ? (total * value) / 100 : total + value;
  if (!(target > 1e-3) || !Number.isFinite(target)) return null;
  const which = nearerEnd(points, click);
  const pts = which === 0 ? [...points].reverse().map(copy) : points.map(copy);
  let out: Point[];
  if (target >= total) {
    const tip = pts.at(-1)!;
    const d = unit(sub(tip, pts.at(-2)!));
    out = [...pts.slice(0, -1), add(tip, mul(d, target - total))];
  } else {
    // Walk to `target` from the far end.
    let left = target;
    out = [pts[0]!];
    for (let i = 0; i + 1 < pts.length; i++) {
      const l = dist(pts[i]!, pts[i + 1]!);
      if (left <= l) {
        out.push(lerp(pts[i]!, pts[i + 1]!, l ? left / l : 0));
        break;
      }
      out.push(pts[i + 1]!);
      left -= l;
    }
  }
  return which === 0 ? out.reverse() : out;
}

// ---- Fillet and Chamfer ----------------------------------------------------------------------

/** A segment picked for Fillet or Chamfer: its two ends (from the vertex side outward) and where it was clicked. */
export interface CornerArm {
  a: Point;
  b: Point;
  click: Point;
}

/**
 * The corner where two segments' lines meet, rounded with radius `r` (Fillet) or cut back by
 * distance `d` along each (Chamfer, `chamfer: true`). Each arm keeps the side of the corner it was
 * clicked on. Returns the corner, the new end of each arm, and for a fillet a point midway along
 * the arc. Null for parallel segments or when the cut does not fit on an arm.
 */
export function cornerCut(p: CornerArm, q: CornerArm, size: number, chamfer = false): { corner: Point; endP: Point; endQ: Point; mid: Point | null; keepP: Point; keepQ: Point } | null {
  const corner = lineIntersection(p.a, p.b, q.a, q.b);
  if (!corner) return null;
  // Each arm runs away from the corner toward the side it was clicked on.
  const arm = (s: CornerArm) => {
    const d = unit(sub(s.b, s.a));
    const along = dot(sub(s.click, corner), d);
    const u = along >= 0 ? d : mul(d, -1);
    // The end kept is the one furthest from the corner on the clicked side.
    const ea = dot(sub(s.a, corner), u);
    const eb = dot(sub(s.b, corner), u);
    return { u, reach: Math.max(ea, eb), keep: ea >= eb ? s.a : s.b };
  };
  const ap = arm(p);
  const aq = arm(q);
  const cos = Math.max(-1, Math.min(1, dot(ap.u, aq.u)));
  const theta = Math.acos(cos);
  if (theta < 1e-6 || Math.PI - theta < 1e-6) return null;
  const dp = chamfer ? size : size / Math.tan(theta / 2);
  const dq = chamfer ? size : dp;
  if (dp > ap.reach + EPS || dq > aq.reach + EPS) return null;
  const endP = add(corner, mul(ap.u, dp));
  const endQ = add(corner, mul(aq.u, dq));
  let mid: Point | null = null;
  if (!chamfer && size > 0) {
    const w = unit(add(ap.u, aq.u));
    const centre = add(corner, mul(w, size / Math.sin(theta / 2)));
    mid = sub(centre, mul(w, size));
  }
  return { corner, endP, endQ, mid, keepP: copy(ap.keep), keepQ: copy(aq.keep) };
}

/** Points tracing the arc from `a` through `mid` to `b` (not including `a`), for paths that cannot curve. */
export function arcThrough(a: Pt, mid: Pt, b: Pt, steps = 8): Point[] {
  const bulge = bulgeThrough(a, b, mid);
  return arcSegmentPoints(a, b, bulge, steps).map(copy);
}

/**
 * Fillet or Chamfer a vertex of a path where segments `i` and `j` meet (adjacent, `j` after `i`).
 * The vertex is replaced by the two cut points, joined by an arc (a bulge where the type curves,
 * else traced with points) or a straight edge.
 */
export function cornerVertex(
  m: Pick<Markup, 'type' | 'points' | 'bulges'>,
  vertex: number,
  size: number,
  chamfer: boolean,
): { points: Point[]; bulges?: number[] } | null {
  const pts = m.points;
  const n = pts.length;
  const closed = CLOSED_PATHS.has(m.type);
  if (!closed && (vertex <= 0 || vertex >= n - 1)) return null;
  const v = pts[vertex]!;
  const before = pts[(vertex - 1 + n) % n]!;
  const after = pts[(vertex + 1) % n]!;
  const cut = cornerCut({ a: v, b: before, click: before }, { a: v, b: after, click: after }, size, chamfer);
  if (!cut) return null;
  const middle: Point[] = [cut.endP];
  let bulge = 0;
  if (cut.mid) {
    if (BULGE_TYPES.has(m.type)) bulge = bulgeThrough(cut.endP, cut.endQ, cut.mid);
    else middle.push(...arcThrough(cut.endP, cut.mid, cut.endQ).slice(0, -1));
  }
  middle.push(cut.endQ);
  const points = [...pts.slice(0, vertex).map(copy), ...middle, ...pts.slice(vertex + 1).map(copy)];
  if (!BULGE_TYPES.has(m.type)) return { points };
  const segs = closed ? n : n - 1;
  const old = Array.from({ length: segs }, (_, k) => m.bulges?.[k] ?? 0);
  const bulges = [...old.slice(0, vertex), bulge, ...old.slice(vertex)];
  return { points, ...(bulges.some(Boolean) ? { bulges } : {}) };
}

/** An open path whose last point sits on its first: a loop drawn as a polyline, with a corner where it closes. */
export function closesOnItself(m: Pick<Markup, 'type' | 'points'>): boolean {
  const n = m.points.length;
  return !CLOSED_PATHS.has(m.type) && n >= 4 && dist(m.points[0]!, m.points[n - 1]!) < 0.01;
}

/**
 * Fillet or Chamfer the corner where an open path closes on itself (see `closesOnItself`). The path
 * then starts and ends at the cut points, joined by the arc or straight edge, so it still closes.
 */
export function cornerClosing(
  m: Pick<Markup, 'type' | 'points' | 'bulges'>,
  size: number,
  chamfer: boolean,
): { points: Point[]; bulges?: number[] } | null {
  const pts = m.points;
  const n = pts.length;
  const v = pts[0]!;
  const before = pts[n - 2]!;
  const after = pts[1]!;
  const cut = cornerCut({ a: v, b: before, click: before }, { a: v, b: after, click: after }, size, chamfer);
  if (!cut) return null;
  const arc: Point[] = [];
  let bulge = 0;
  if (cut.mid) {
    if (BULGE_TYPES.has(m.type)) bulge = bulgeThrough(cut.endP, cut.endQ, cut.mid);
    else arc.push(...arcThrough(cut.endP, cut.mid, cut.endQ).slice(0, -1));
  }
  const points = [cut.endQ, ...pts.slice(1, n - 1).map(copy), cut.endP, ...arc, copy(cut.endQ)];
  if (!BULGE_TYPES.has(m.type)) return { points };
  const old = Array.from({ length: n - 1 }, (_, k) => m.bulges?.[k] ?? 0);
  const bulges = [...old, bulge];
  return { points, ...(bulges.some(Boolean) ? { bulges } : {}) };
}

// ---- Join and Explode ------------------------------------------------------------------------

/** A path Join chains: its points and (where it curves) bulges. */
export interface JoinPiece {
  points: Point[];
  bulges?: number[];
}

/** A path run backwards: its points reversed and each curve turned the other way. */
function reversed(p: JoinPiece): JoinPiece {
  return { points: [...p.points].reverse(), ...(p.bulges ? { bulges: [...p.bulges].reverse().map((b) => -b) } : {}) };
}

/**
 * Join: chains of the pieces whose ends meet within `tol`, in order. Each chain lists the pieces it
 * took (by index), its points and bulges, and whether it closed into a loop. Pieces that touch
 * nothing come back as chains of one.
 */
export function joinPaths(pieces: readonly JoinPiece[], tol: number): { members: number[]; points: Point[]; bulges: number[]; closed: boolean }[] {
  const left = new Set(pieces.map((_, i) => i));
  const out: { members: number[]; points: Point[]; bulges: number[]; closed: boolean }[] = [];
  const segBulges = (p: JoinPiece) => Array.from({ length: p.points.length - 1 }, (_, k) => p.bulges?.[k] ?? 0);
  while (left.size) {
    const first = [...left][0]!;
    left.delete(first);
    let points = pieces[first]!.points.map(copy);
    let bulges = segBulges(pieces[first]!);
    const members = [first];
    let grew = true;
    while (grew) {
      grew = false;
      for (const i of left) {
        const p = pieces[i]!;
        const head = points[0]!;
        const tail = points.at(-1)!;
        let piece: JoinPiece | null = null;
        let atEnd = true;
        if (dist(tail, p.points[0]!) <= tol) piece = p;
        else if (dist(tail, p.points.at(-1)!) <= tol) piece = reversed(p);
        else if (dist(head, p.points.at(-1)!) <= tol) [piece, atEnd] = [p, false];
        else if (dist(head, p.points[0]!) <= tol) [piece, atEnd] = [reversed(p), false];
        if (!piece) continue;
        if (atEnd) {
          points = [...points, ...piece.points.slice(1).map(copy)];
          bulges = [...bulges, ...segBulges(piece)];
        } else {
          points = [...piece.points.slice(0, -1).map(copy), ...points];
          bulges = [...segBulges(piece), ...bulges];
        }
        members.push(i);
        left.delete(i);
        grew = true;
      }
    }
    const closed = members.length > 1 && points.length > 3 && dist(points[0]!, points.at(-1)!) <= tol;
    if (closed) points.pop();
    out.push({ members, points, bulges, closed });
  }
  return out;
}

/**
 * Explode: the single segments of a path or outline, each as two ends and its bulge. Rectangles
 * give their four (turned) sides.
 */
export function explodeSegments(m: Markup): { a: Point; b: Point; bulge: number }[] {
  let pts: Point[] = m.points;
  let closed = CLOSED_PATHS.has(m.type);
  if (m.type === 'rect') {
    const b = boundsOf(m.points);
    const c = rotationCentre(m);
    pts = ([[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]] as Point[]).map((p) => (m.rotation ? rotatePoint(p, c, m.rotation) : p));
    closed = true;
  }
  const out: { a: Point; b: Point; bulge: number }[] = [];
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) out.push({ a: copy(pts[i]!), b: copy(pts[(i + 1) % pts.length]!), bulge: m.bulges?.[i] ?? 0 });
  return out;
}

/** The point midway along a curved segment (for an Arc markup through it). */
export function bulgeMidpoint(a: Pt, b: Pt, bulge: number): Point {
  const chord = sub(b, a);
  const c = Math.hypot(chord[0], chord[1]);
  // The sagitta off the chord's middle, the way `bulgeThrough` measures it.
  const h = (bulge * c) / 2;
  const n: Point = c ? [chord[1] / c, -chord[0] / c] : [0, 0];
  return add(lerp(a, b, 0.5), mul(n, h));
}

// ---- Transforms: mirror, rotate, align, arrays -----------------------------------------------

/** An affine map of the page: p ↦ [a·x + c·y + e, b·x + d·y + f]. The tools only make similarities. */
export interface Affine {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export function applyAffine(t: Affine, [x, y]: Pt): Point {
  return [t.a * x + t.c * y + t.e, t.b * x + t.d * y + t.f];
}

/** `t` after `s` (s applied first). */
export function compose(t: Affine, s: Affine): Affine {
  return {
    a: t.a * s.a + t.c * s.b,
    b: t.b * s.a + t.d * s.b,
    c: t.a * s.c + t.c * s.d,
    d: t.b * s.c + t.d * s.d,
    e: t.a * s.e + t.c * s.f + t.e,
    f: t.b * s.e + t.d * s.f + t.f,
  };
}

/** Moving by (dx, dy). */
export const translation = (dx: number, dy: number): Affine => ({ a: 1, b: 0, c: 0, d: 1, e: dx, f: dy });

/** Turning `degrees` clockwise (page space, y down) about `c`. */
export function rotationAbout(c: Pt, degrees: number): Affine {
  const r = (degrees * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return { a: cos, b: sin, c: -sin, d: cos, e: c[0] - cos * c[0] + sin * c[1], f: c[1] - sin * c[0] - cos * c[1] };
}

/** Mirroring across the line through `p` and `q`. */
export function mirrorAcross(p: Pt, q: Pt): Affine {
  const phi = 2 * Math.atan2(q[1] - p[1], q[0] - p[0]);
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  // Reflection matrix [[cos, sin], [sin, -cos]], fixed on p.
  return { a: cos, b: sin, c: sin, d: -cos, e: p[0] - cos * p[0] - sin * p[1], f: p[1] - sin * p[0] + cos * p[1] };
}

/**
 * Align: the transform taking `s1` to `d1` and the direction s1→s2 onto d1→d2, scaled so s2 lands
 * on d2 when `scale` is set. Null when either pair of points coincides.
 */
export function alignment(s1: Pt, d1: Pt, s2: Pt, d2: Pt, scale: boolean): Affine | null {
  const vs = sub(s2, s1);
  const vd = sub(d2, d1);
  const ls = Math.hypot(vs[0], vs[1]);
  const ld = Math.hypot(vd[0], vd[1]);
  if (ls < EPS || ld < EPS) return null;
  const turn = Math.atan2(vd[1], vd[0]) - Math.atan2(vs[1], vs[0]);
  const k = scale ? ld / ls : 1;
  const cos = k * Math.cos(turn);
  const sin = k * Math.sin(turn);
  return { a: cos, b: sin, c: -sin, d: cos, e: d1[0] - (cos * s1[0] - sin * s1[1]), f: d1[1] - (sin * s1[0] + cos * s1[1]) };
}

/** Types whose two points are opposite corners of a box. */
const isBox = (m: Pick<Markup, 'type'>) => TYPE_INFO[m.type].handles === 'box' && m.type !== 'callout';

/**
 * A markup moved by a similarity transform (`Affine`) (Mirror, Rotate, Align, arrays): its points, cutouts and
 * curves; boxes keep their shape and turn when they can; text grows with the scale. Mirrored text
 * and pictures stay readable, as AutoCAD leaves mirrored text.
 */
export function transformMarkup(m: Markup, t: Affine): Partial<Markup> {
  const det = t.a * t.d - t.b * t.c;
  const flip = det < 0;
  const k = Math.sqrt(Math.abs(det));
  // Rounded to a millionth of a point so square turns and mirrors land exactly.
  const tidy = (v: number) => Math.round(v * 1e6) / 1e6;
  const f = (p: Pt): Point => {
    const [x, y] = applyAffine(t, p);
    return [tidy(x), tidy(y)];
  };
  const out: Partial<Markup> = {};
  const scaleBox = (pts: readonly Point[]): Point[] => {
    const b = boundsOf(pts);
    const c = f([b.x + b.w / 2, b.y + b.h / 2]);
    const w = (b.w * k) / 2;
    const h = (b.h * k) / 2;
    return [
      [c[0] - w, c[1] - h],
      [c[0] + w, c[1] + h],
    ];
  };
  if (isBox(m)) {
    out.points = scaleBox(m.points);
    if (ROTATABLE.has(m.type)) {
      // Where the box's own x-axis goes decides its new turn.
      const r0 = ((m.rotation ?? 0) * Math.PI) / 180;
      const ax = applyAffine({ ...t, e: 0, f: 0 }, [Math.cos(r0), Math.sin(r0)]);
      let rot = (Math.atan2(ax[1], ax[0]) * 180) / Math.PI;
      rot = Math.round(rot * 1e6) / 1e6;
      if (Math.abs(rot) > 1e-6 || m.rotation) out.rotation = rot || undefined;
      if (flip && m.arcAngles) out.arcAngles = [-m.arcAngles[1], -m.arcAngles[0]];
    }
  } else if (m.type === 'callout' && m.points.length >= 4) {
    out.points = [...m.points.slice(0, 2).map(f), ...scaleBox(m.points.slice(2, 4))];
  } else {
    out.points = m.points.map(f);
    if (m.holes) out.holes = m.holes.map((h) => h.map(f));
    if (flip && m.bulges) out.bulges = m.bulges.map((b) => -b);
    if (flip && m.holeBulges) out.holeBulges = m.holeBulges.map((h) => h?.map((b) => -b) ?? null);
  }
  const style = { ...m.style };
  let restyled = false;
  if (Math.abs(k - 1) > 1e-9) {
    for (const key of ['leader', 'labelOffset'] as const) {
      if (style[key]) {
        style[key] = style[key]! * k;
        restyled = true;
      }
    }
    if (isTextType(m.type) && style.fontSize) {
      style.fontSize = Math.round(style.fontSize * k * 100) / 100;
      restyled = true;
    }
  }
  // A mirrored dimension keeps its offset on the mirrored side.
  if (flip && style.labelOffset) {
    style.labelOffset = -style.labelOffset;
    restyled = true;
  }
  return restyled ? { ...out, style } : out;
}

/**
 * Polar Array: the transforms for `count` items (the original included, first) spread through
 * `fill` degrees counter-clockwise about `centre` (as on paper). Items keep their turn unless
 * `rotate`; then only their reference point travels round.
 */
export function polarArray(centre: Pt, count: number, fill: number, rotate: boolean, ref: Pt): Affine[] {
  const n = Math.max(1, Math.floor(count));
  const full = Math.abs(Math.abs(fill) - 360) < 1e-9;
  const step = n > 1 ? fill / (full ? n : n - 1) : 0;
  const out: Affine[] = [];
  for (let k = 1; k < n; k++) {
    // Counter-clockwise on paper is anticlockwise on screen: negative in page space (y down).
    const r = rotationAbout(centre, -step * k);
    if (rotate) out.push(r);
    else {
      const to = applyAffine(r, ref);
      out.push(translation(to[0] - ref[0], to[1] - ref[1]));
    }
  }
  return out;
}

/**
 * Path Array: transforms placing `count` items (the original stays put) with their reference point
 * spaced evenly along a path from its start, turned with the path when `align`.
 */
export function pathArray(points: readonly Pt[], closed: boolean, count: number, align: boolean, ref: Pt): Affine[] {
  const n = Math.max(1, Math.floor(count));
  const total = pathLengthOf(points, closed);
  if (!(total > EPS)) return [];
  const start = pointAlong(points, closed, 0);
  const out: Affine[] = [];
  for (let k = 0; k < n; k++) {
    const s = closed ? (total * k) / n : n > 1 ? (total * k) / (n - 1) : 0;
    const p = pointAlong(points, closed, s);
    let t = translation(p.point[0] - ref[0], p.point[1] - ref[1]);
    if (align) t = compose(rotationAbout(p.point, p.angle - start.angle), t);
    out.push(t);
  }
  return out;
}

// ---- Stretch ---------------------------------------------------------------------------------

const inRect = (r: Rect, [x, y]: Pt) => x >= r.x - EPS && x <= r.x + r.w + EPS && y >= r.y - EPS && y <= r.y + r.h + EPS;

/**
 * Stretch: a markup with the points inside the crossing window moved by (dx, dy). Markups wholly
 * inside move; turned boxes only move whole. Null when no point is inside.
 */
export function stretchMarkup(m: Markup, window: Rect, dx: number, dy: number): Partial<Markup> | null {
  const move = (p: Point): Point => [p[0] + dx, p[1] + dy];
  const mv = (p: Point): Point => (inRect(window, p) ? move(p) : p);
  if (isBox(m)) {
    const b = boundsOf(m.points);
    const hit = (x: number, y: number) => inRect(window, [x, y]);
    const [l, t, r, btm] = [b.x, b.y, b.x + b.w, b.y + b.h];
    const corners = [hit(l, t), hit(r, t), hit(r, btm), hit(l, btm)];
    if (!corners.some(Boolean)) return null;
    if (corners.every(Boolean)) return { points: m.points.map(move) };
    // A turned or fixed-size box only moves whole.
    if (m.rotation || TYPE_INFO[m.type].draw === 'place') return null;
    // Each side moves with the corners on it that are inside.
    const x0 = l + (corners[0] || corners[3] ? dx : 0);
    const x1 = r + (corners[1] || corners[2] ? dx : 0);
    const y0 = t + (corners[0] || corners[1] ? dy : 0);
    const y1 = btm + (corners[2] || corners[3] ? dy : 0);
    return { points: [[x0, y0], [x1, y1]] };
  }
  const inside = m.points.filter((p) => inRect(window, p)).length;
  if (!inside) return null;
  if (inside === m.points.length) return { points: m.points.map(move), ...(m.holes ? { holes: m.holes.map((h) => h.map(move)) } : {}) };
  if (m.type === 'count' || TYPE_INFO[m.type].draw === 'place' || TYPE_INFO[m.type].draw === 'text') return null;
  return { points: m.points.map(mv), ...(m.holes ? { holes: m.holes.map((h) => h.map(mv)) } : {}) };
}

// ---- Scale and Reverse -----------------------------------------------------------------------

/** Growing (or shrinking) by `factor` about `base` (AutoCAD's Scale). */
export function scalingAbout(base: Pt, factor: number): Affine {
  return { a: factor, b: 0, c: 0, d: factor, e: base[0] * (1 - factor), f: base[1] * (1 - factor) };
}

/** Lines and paths whose direction Reverse can flip (it decides which end has which ending). */
const REVERSIBLE: ReadonlySet<MarkupType> = new Set<MarkupType>(['line', 'arrow', 'polyline', 'arc', 'length', 'polylength', 'dimension']);

/** True if Reverse works on the markup. */
export function canReverse(m: Pick<Markup, 'type' | 'points'>): boolean {
  return REVERSIBLE.has(m.type) && m.points.length >= 2;
}

/**
 * Reverse: the markup running the other way, its line endings swapped so what was at the start is
 * at the new start. Curves keep their shape (their bulges turn round); a dimension stays on the
 * same side.
 */
export function reversedMarkup(m: Markup): Partial<Markup> {
  const out: Partial<Markup> = { points: [...m.points].reverse().map(copy) };
  if (m.bulges) out.bulges = [...m.bulges].reverse().map((b) => (b ? -b : 0));
  const natural = TYPE_INFO[m.type].ends;
  const style = { ...m.style };
  if (natural) {
    const start = m.style.startCap ?? natural[0];
    const end = m.style.endCap ?? natural[1];
    style.startCap = end;
    style.endCap = start;
  }
  if (style.labelOffset) style.labelOffset = -style.labelOffset;
  out.style = style;
  return out;
}

/** True if Convert to Cloud works on the markup: a polygon or rectangle. */
export function canCloud(m: Pick<Markup, 'type' | 'points'>): boolean {
  return (m.type === 'polygon' && m.points.length >= 3) || m.type === 'rect';
}
