// The CAD-style Modify tools (Trim, Extend, Break, Lengthen, Fillet, Chamfer, Mirror, Rotate,
// Align, arrays, Divide and Stretch) as click-by-click steps: each click either asks for the next
// pick, picks what to work on, or finishes with the changes to make. The geometry is in @nb/markup's
// cad.ts; MarkupTools feeds clicks in and applies what comes out.
import {
  alignment,
  boundsOf,
  breakPath,
  canCorner,
  canCut,
  cornerCut,
  cornerVertex,
  divisionPoints,
  edgesOf,
  extendPath,
  lengthenPath,
  lineEnds,
  markupBounds,
  mirrorAcross,
  nearestOnPath,
  pathArray,
  pathOf,
  polarArray,
  rotationAbout,
  stretchMarkup,
  transformMarkup,
  trimPath,
  type Affine,
  type Markup,
  type MarkupType,
  type Point,
  type Rect,
} from '@nb/markup';
import { settings } from '../settings/settings';

export type CadTool = 'trim' | 'extend' | 'break' | 'lengthen' | 'fillet' | 'chamfer' | 'mirror' | 'arrayPolar' | 'arrayPath' | 'divide' | 'rotateRef' | 'align' | 'stretch';

export const CAD_TOOL_LABELS: Record<CadTool, string> = {
  trim: 'Trim',
  extend: 'Extend',
  break: 'Break',
  lengthen: 'Lengthen',
  fillet: 'Fillet',
  chamfer: 'Chamfer',
  mirror: 'Mirror',
  arrayPolar: 'Polar Array',
  arrayPath: 'Path Array',
  divide: 'Divide / Measure',
  rotateRef: 'Rotate',
  align: 'Align to Points',
  stretch: 'Stretch',
};

export const isCadTool = (t: string): t is CadTool => t in CAD_TOOL_LABELS;

/** Tools that work on the selection (picked by the first click when there is none). */
const ON_SELECTION: ReadonlySet<CadTool> = new Set<CadTool>(['mirror', 'arrayPolar', 'arrayPath', 'rotateRef', 'align']);

/** A point clicked, and the markup clicked on when the step picks one. */
export interface CadPick {
  at: Point;
  id?: string;
}

/** What the tools need from the page. */
export interface CadContext {
  /** The page's markups, in drawing order. */
  page: readonly Markup[];
  /** The selected markups on the page that can be edited. */
  selected: readonly Markup[];
  /** The topmost markup under a point. */
  hit: (p: Point) => Markup | undefined;
  /** Locked, or not the user's to change. */
  frozen: (m: Markup) => boolean;
  /** The ids of a markup and its group. */
  group: (m: Markup) => string[];
  /** A length typed in the units of `m`'s scale (the page's when null), in points; null if not a length. */
  length: (text: string, m: Markup | null) => number | null;
  /** A new markup of a type, styled like `like` when given. */
  create: (type: MarkupType, points: Point[], like?: Markup) => Markup;
  /** A copy of a markup (new id, no group, lock or status) with changes. */
  clone: (m: Markup, patch: Partial<Markup>) => Markup;
  /** Shift held: Trim extends and Extend trims, as in AutoCAD. */
  shift: boolean;
}

/** Edits to apply as one undo step. */
export interface CadChanges {
  update: [id: string, patch: Partial<Markup>][];
  add: Markup[];
  remove: string[];
}

export type CadResult =
  /** Carry on: the next step needs another click. */
  | { picks: CadPick[] }
  /** The click picked what the tool works on. */
  | { select: string[] }
  /** Done: apply, select `select`, and start over (`again`) or go back to Select. */
  | { done: CadChanges; select: string[]; again: boolean }
  /** The click did nothing, and why. */
  | { error: string };

const none = (): CadChanges => ({ update: [], add: [], remove: [] });
const sub = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]];
const angleOf = (v: Point) => (Math.atan2(v[1], v[0]) * 180) / Math.PI;

/** Each markup's drawn lines, kept while the markup is unchanged (the preview asks on every pointer move). */
const EDGES = new WeakMap<Markup, Point[][]>();

/** Every line drawn on the page except `skip`'s: what Trim cuts to and Extend reaches. */
function edges(ctx: CadContext, skip: Markup): Point[][] {
  return ctx.page
    .filter((m) => m.id !== skip.id)
    .flatMap((m) => {
      let e = EDGES.get(m);
      if (!e) EDGES.set(m, (e = edgesOf(m)));
      return e;
    });
}

/** A path split into pieces: the first keeps the markup, the rest become copies; none deletes it. */
function splitInto(ctx: CadContext, m: Markup, pieces: Point[][], out: CadChanges): string[] {
  if (!pieces.length) {
    out.remove.push(m.id);
    return [];
  }
  const [start, end] = lineEnds(m);
  const ends = (i: number) => (pieces.length > 1 && (start !== 'none' || end !== 'none') ? { style: { ...m.style, startCap: i === 0 ? start : 'none', endCap: i === pieces.length - 1 ? end : 'none' } } : {});
  out.update.push([m.id, { points: pieces[0]!, ...ends(0) }]);
  const ids = [m.id];
  pieces.slice(1).forEach((points, k) => {
    const c = ctx.clone(m, { points, ...ends(k + 1) });
    out.add.push(c);
    ids.push(c.id);
  });
  return ids;
}

/** A typed length that may be negative (Lengthen's "change by"). */
function signedLength(ctx: CadContext, text: string, m: Markup): number | null {
  const t = text.trim();
  const neg = t.startsWith('-');
  const v = ctx.length(neg ? t.slice(1) : t, m);
  return v === null ? null : neg ? -v : v;
}

/** A fillet radius or chamfer distance: empty is zero (a sharp corner). */
function cornerSize(ctx: CadContext, text: string, m: Markup): number | null {
  return text.trim() === '' || Number(text) === 0 ? 0 : ctx.length(text, m);
}

/** Both arms of a Fillet or Chamfer between two different markups, or why not. */
function cornerBetween(ctx: CadContext, tool: 'fillet' | 'chamfer', m1: Markup, at1: Point, m2: Markup, at2: Point, size: number): CadResult {
  const closed = (m: Markup) => !['line', 'arrow', 'polyline', 'length', 'polylength'].includes(m.type);
  if (closed(m1) || closed(m2)) return { error: 'Pick two segments of the same outline, or two open lines' };
  const s1 = nearestOnPath(m1.points, at1).segment;
  const s2 = nearestOnPath(m2.points, at2).segment;
  const p = { a: m1.points[s1]!, b: m1.points[s1 + 1]!, click: at1 };
  const q = { a: m2.points[s2]!, b: m2.points[s2 + 1]!, click: at2 };
  const cut = cornerCut(p, q, size, tool === 'chamfer');
  if (!cut) return { error: size ? 'The lines are parallel, or too short for that size' : 'The lines are parallel' };
  const out = none();
  // Each markup's end on the corner side moves; it must be the end of the path.
  const moved = (m: Markup, s: number, keep: Point, to: Point): Point[] | null => {
    const kept = m.points[s]![0] === keep[0] && m.points[s]![1] === keep[1] ? s : s + 1;
    const end = kept === s ? s + 1 : s;
    if (end !== 0 && end !== m.points.length - 1) return null;
    const pts = m.points.map((x) => [x[0], x[1]] as Point);
    pts[end] = to;
    return pts;
  };
  const a = moved(m1, s1, cut.keepP, cut.endP);
  const b = moved(m2, s2, cut.keepQ, cut.endQ);
  if (!a || !b) return { error: 'Pick the end segments of the lines' };
  out.update.push([m1.id, { points: a }], [m2.id, { points: b }]);
  const select = [m1.id, m2.id];
  if (size > 0) {
    const join = cut.mid ? ctx.create('arc', [cut.endP, cut.mid, cut.endQ], m1) : ctx.create('line', [cut.endP, cut.endQ], m1);
    out.add.push(join);
    select.push(join.id);
  }
  return { done: out, select, again: true };
}

function cornerClick(ctx: CadContext, tool: 'fillet' | 'chamfer', picks: CadPick[], p: Point): CadResult {
  const hit = ctx.hit(p);
  if (!hit || ctx.frozen(hit) || !canCorner(hit)) return { error: 'Click a line, polyline or polygon segment' };
  if (!picks.length) return { picks: [{ at: p, id: hit.id }] };
  const first = ctx.page.find((m) => m.id === picks[0]!.id);
  if (!first) return { picks: [] };
  const s = settings.get();
  const size = cornerSize(ctx, tool === 'fillet' ? s.filletRadius : s.chamferDistance, first);
  if (size === null) return { error: `The ${tool === 'fillet' ? 'radius' : 'distance'} is not a length` };
  if (hit.id !== first.id) return cornerBetween(ctx, tool, first, picks[0]!.at, hit, p, size);
  // Two segments of one path: the corner between them.
  const closed = !['line', 'arrow', 'polyline', 'length', 'polylength'].includes(hit.type);
  const n = hit.points.length;
  const s1 = nearestOnPath(hit.points, picks[0]!.at, closed).segment;
  const s2 = nearestOnPath(hit.points, p, closed).segment;
  let vertex = -1;
  if (closed ? (s1 + 1) % n === s2 : s1 + 1 === s2) vertex = s2;
  else if (closed ? (s2 + 1) % n === s1 : s2 + 1 === s1) vertex = s1;
  if (vertex < 0) return { error: 'Pick two segments that meet' };
  if (!size) return { error: `Set a ${tool === 'fillet' ? 'radius' : 'distance'} to round a corner of one path` };
  const r = cornerVertex(hit, vertex, size, tool === 'chamfer');
  if (!r) return { error: 'Too big for that corner' };
  return { done: { update: [[hit.id, { points: r.points, ...(r.bulges ? { bulges: r.bulges } : {}) }]], add: [], remove: [] }, select: [hit.id], again: true };
}

/** The reference point of what is being copied or moved: the middle of its bounds. */
function selectionCentre(ms: readonly Markup[]): Point {
  const corners = ms.flatMap((m) => {
    const b = markupBounds(m);
    return [
      [b.x, b.y],
      [b.x + b.w, b.y + b.h],
    ] as Point[];
  });
  const b = boundsOf(corners);
  return [b.x + b.w / 2, b.y + b.h / 2];
}

/** The selection moved by `t`, or copied when `copy`. */
function transformSelection(ctx: CadContext, ts: readonly Affine[], copy: boolean, keepOriginals = true): { done: CadChanges; select: string[]; again: boolean } {
  const out = none();
  const select: string[] = keepOriginals || !copy ? ctx.selected.map((m) => m.id) : [];
  for (const t of ts) {
    // Each copy is grouped like its originals, under a group of its own.
    const groups = new Map<string, string>();
    for (const m of ctx.selected) {
      const patch = transformMarkup(m, t);
      if (copy) {
        const groupId = m.groupId ? (groups.get(m.groupId) ?? groups.set(m.groupId, crypto.randomUUID()).get(m.groupId)) : undefined;
        const c = ctx.clone(m, { ...patch, groupId });
        out.add.push(c);
        select.push(c.id);
      } else out.update.push([m.id, patch]);
    }
  }
  return { done: out, select, again: false };
}

/** Rotate by reference: base, reference direction and new direction; null if a direction is missing. */
function rotationByReference([base, ref, to]: [Point, Point, Point]): Affine | null {
  const from = sub(ref, base);
  const onto = sub(to, base);
  if (Math.hypot(...from) < 1e-6 || Math.hypot(...onto) < 1e-6) return null;
  return rotationAbout(base, angleOf(onto) - angleOf(from));
}

/** The crossing window of a Stretch from its first two picks. */
const windowOf = (a: Point, b: Point): Rect => ({ x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(b[0] - a[0]), h: Math.abs(b[1] - a[1]) });

/** A click with the tool: what it does with the picks so far. */
export function cadClick(tool: CadTool, picks: CadPick[], p: Point, ctx: CadContext): CadResult {
  const s = settings.get();
  if (ON_SELECTION.has(tool) && !ctx.selected.length) {
    const hit = ctx.hit(p);
    return hit && !ctx.frozen(hit) ? { select: ctx.group(hit) } : { error: 'Click a markup, or select some first' };
  }
  switch (tool) {
    case 'trim':
    case 'extend': {
      const hit = ctx.hit(p);
      if (!hit || ctx.frozen(hit) || !canCut(hit)) return { error: 'Click a line or polyline' };
      const trim = (tool === 'trim') !== ctx.shift;
      const out = none();
      if (trim) {
        const pieces = trimPath(hit.points, edges(ctx, hit), p);
        if (!pieces) return { error: 'Nothing crosses it there' };
        return { done: out, select: splitInto(ctx, hit, pieces, out), again: true };
      }
      const pts = extendPath(hit.points, edges(ctx, hit), p);
      if (!pts) return { error: 'Nothing lies ahead of that end' };
      out.update.push([hit.id, { points: pts }]);
      return { done: out, select: [hit.id], again: true };
    }
    case 'break': {
      if (!picks.length) {
        const hit = ctx.hit(p);
        if (!hit || ctx.frozen(hit) || !canCut(hit)) return { error: 'Click a line or polyline' };
        return { picks: [{ at: nearestOnPath(hit.points, p).point, id: hit.id }] };
      }
      const m = ctx.page.find((x) => x.id === picks[0]!.id);
      if (!m) return { picks: [] };
      const out = none();
      return { done: out, select: splitInto(ctx, m, breakPath(m.points, picks[0]!.at, p), out), again: true };
    }
    case 'lengthen': {
      const hit = ctx.hit(p);
      if (!hit || ctx.frozen(hit) || !canCut(hit)) return { error: 'Click near the end of a line or polyline' };
      const value = s.lengthenMode === 'percent' ? Number(s.lengthenValue) : s.lengthenMode === 'delta' ? signedLength(ctx, s.lengthenValue, hit) : ctx.length(s.lengthenValue, hit);
      if (value === null || !Number.isFinite(value) || s.lengthenValue.trim() === '') return { error: 'Type the length first' };
      const pts = lengthenPath(hit.points, p, s.lengthenMode, value);
      if (!pts) return { error: 'That would leave nothing' };
      return { done: { update: [[hit.id, { points: pts }]], add: [], remove: [] }, select: [hit.id], again: true };
    }
    case 'fillet':
    case 'chamfer':
      return cornerClick(ctx, tool, picks, p);
    case 'mirror': {
      if (!picks.length) return { picks: [{ at: p }] };
      const a = picks[0]!.at;
      if (Math.hypot(...sub(p, a)) < 1e-6) return { error: 'Pick a second point on the mirror line' };
      return transformSelection(ctx, [mirrorAcross(a, p)], s.mirrorKeep);
    }
    case 'rotateRef': {
      const typed = s.rotateAngle.trim();
      if (typed) {
        const deg = Number(typed);
        if (!Number.isFinite(deg)) return { error: 'The angle is not a number' };
        // A typed angle turns counter-clockwise on paper, as in AutoCAD: negative in page space.
        return transformSelection(ctx, [rotationAbout(p, -deg)], false);
      }
      const picked = [...picks, { at: p }];
      if (picked.length < 3) return { picks: picked };
      const t = rotationByReference(picked.map((x) => x.at) as [Point, Point, Point]);
      if (!t) return { error: 'Pick points away from the base' };
      return transformSelection(ctx, [t], false);
    }
    case 'align': {
      const picked = [...picks, { at: p }];
      if (picked.length < 4) return { picks: picked };
      const [s1, d1, s2, d2] = picked.map((x) => x.at) as [Point, Point, Point, Point];
      const t = alignment(s1, d1, s2, d2, s.alignScale);
      if (!t) return { error: 'The two points of each pair must be apart' };
      return transformSelection(ctx, [t], false);
    }
    case 'arrayPolar': {
      const ref = selectionCentre(ctx.selected);
      const ts = polarArray(p, s.arrayCount, s.arrayAngle, s.arrayRotate, ref);
      if (!ts.length) return { error: 'Set more than one item' };
      return transformSelection(ctx, ts, true);
    }
    case 'arrayPath': {
      const hit = ctx.hit(p);
      const path = hit && !ctx.selected.some((m) => m.id === hit.id) ? pathOf(hit) : null;
      if (!hit || !path) return { error: 'Click the line or outline to array along' };
      const ts = pathArray(path.points, path.closed, s.arrayCount, s.arrayAlign, selectionCentre(ctx.selected));
      if (!ts.length) return { error: 'That path has no length' };
      // The originals take the first place along the path; copies fill the rest.
      const moved = transformSelection(ctx, ts.slice(0, 1), false);
      const copies = transformSelection(ctx, ts.slice(1), true, false);
      return { done: { update: moved.done.update, add: copies.done.add, remove: [] }, select: [...moved.select, ...copies.select], again: false };
    }
    case 'divide': {
      const hit = ctx.hit(p);
      const path = hit ? pathOf(hit) : null;
      if (!hit || !path) return { error: 'Click a line or outline to divide' };
      let by: { count: number } | { spacing: number };
      if (s.divideMode === 'spacing') {
        const spacing = ctx.length(s.divideSpacing, hit);
        if (spacing === null) return { error: 'Type the spacing first' };
        by = { spacing };
      } else by = { count: s.divideCount };
      const marks = divisionPoints(path.points, path.closed, by);
      if (!marks.length) return { error: 'No marks fit along it' };
      const count = ctx.create('count', marks.map((x) => x.point));
      return { done: { update: [], add: [count], remove: [] }, select: [count.id], again: true };
    }
    case 'stretch': {
      const picked = [...picks, { at: p }];
      if (picked.length < 4) {
        if (picked.length === 2 && !stretchTargets(ctx, windowOf(picked[0]!.at, p)).length) return { error: 'No points inside that window' };
        return { picks: picked };
      }
      const win = windowOf(picked[0]!.at, picked[1]!.at);
      const [dx, dy] = sub(p, picked[2]!.at);
      const out = none();
      for (const m of stretchTargets(ctx, win)) {
        const patch = stretchMarkup(m, win, dx, dy);
        if (patch) out.update.push([m.id, patch]);
      }
      return { done: out, select: out.update.map(([id]) => id), again: true };
    }
  }
}

/** Stretch works on the selection, else everything on the page it can change, with a point in the window. */
function stretchTargets(ctx: CadContext, win: Rect): Markup[] {
  const pool = ctx.selected.length ? ctx.selected : ctx.page.filter((m) => !ctx.frozen(m));
  return pool.filter((m) => stretchMarkup(m, win, 0, 0));
}

/** What the next click with the tool does, for the tool bar. */
export function cadPrompt(tool: CadTool, picks: CadPick[], ctx: Pick<CadContext, 'selected' | 'shift'>): string {
  const s = settings.get();
  if (ON_SELECTION.has(tool) && !ctx.selected.length) return 'Click a markup to work on, or select some first';
  const n = picks.length;
  switch (tool) {
    case 'trim':
      return 'Click the part of a line to cut away · Shift: extend instead';
    case 'extend':
      return 'Click near the end of a line to extend · Shift: trim instead';
    case 'break':
      return n ? 'Click the second break point (the same point splits it)' : 'Click a line at the first break point';
    case 'lengthen':
      return 'Click near the end to change';
    case 'fillet':
    case 'chamfer':
      return n ? 'Click the second line or segment' : 'Click the first line or segment';
    case 'mirror':
      return n ? 'Click the second point of the mirror line' : 'Click the first point of the mirror line';
    case 'rotateRef':
      return !n ? (s.rotateAngle.trim() ? `Click the base point to turn ${s.rotateAngle.trim()}°` : 'Click the base point') : n === 1 ? 'Click the reference direction' : 'Click the new direction';
    case 'align':
      return ['Click the first source point', 'Click where it goes', 'Click the second source point', 'Click where that goes'][n]!;
    case 'arrayPolar':
      return 'Click the centre of the array';
    case 'arrayPath':
      return 'Click the path to array along';
    case 'divide':
      return 'Click a line or outline to mark along';
    case 'stretch':
      return ['Click a corner of the crossing window', 'Click the opposite corner', 'Click the base point', 'Click the second point'][n]!;
  }
}

/**
 * A preview of the click at `hover`: the markups as they would be. Steps that need more clicks show
 * what they can (Align's move, Stretch's window).
 */
export function cadPreview(tool: CadTool, picks: CadPick[], hover: Point, ctx: CadContext): { ghosts: Markup[]; guides: Point[][] } {
  const guides: Point[][] = [];
  if (tool === 'stretch' && picks.length === 1) {
    const w = windowOf(picks[0]!.at, hover);
    guides.push([[w.x, w.y], [w.x + w.w, w.y], [w.x + w.w, w.y + w.h], [w.x, w.y + w.h], [w.x, w.y]]);
    return { ghosts: [], guides };
  }
  if (tool === 'stretch' && picks.length >= 2) {
    const w = windowOf(picks[0]!.at, picks[1]!.at);
    guides.push([[w.x, w.y], [w.x + w.w, w.y], [w.x + w.w, w.y + w.h], [w.x, w.y + w.h], [w.x, w.y]]);
  }
  if ((tool === 'mirror' || tool === 'rotateRef' || tool === 'align' || tool === 'stretch') && picks.length) guides.push([picks.at(-1)!.at, hover]);
  if (tool === 'align' && picks.length === 1) {
    const [dx, dy] = sub(hover, picks[0]!.at);
    return { ghosts: ctx.selected.map((m) => ({ ...m, points: m.points.map(([x, y]) => [x + dx, y + dy] as Point) })), guides };
  }
  if (tool === 'stretch' && picks.length < 3) return { ghosts: [], guides };
  if (tool === 'divide' || tool === 'arrayPath' || tool === 'trim' || tool === 'extend' || tool === 'lengthen' || tool === 'break' || tool === 'fillet' || tool === 'chamfer') {
    // Only once the pointer is on something to work on.
    if (!ctx.hit(hover) && !(tool === 'break' && picks.length)) return { ghosts: [], guides };
  }
  if (tool === 'fillet' || tool === 'chamfer') {
    if (!picks.length) return { ghosts: [], guides };
  }
  const r = cadClick(tool, picks, hover, ctx);
  if (!('done' in r)) return { ghosts: [], guides };
  const byId = new Map(ctx.page.map((m) => [m.id, m]));
  const ghosts: Markup[] = [];
  for (const [id, patch] of r.done.update) {
    const m = byId.get(id);
    if (m) ghosts.push({ ...m, ...patch });
  }
  ghosts.push(...r.done.add);
  return { ghosts, guides };
}

