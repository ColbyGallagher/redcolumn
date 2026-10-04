import { arcPoints } from './arc';
import { expandArcs } from '@nb/measure';
import { calloutLanding, calloutLeaders } from './callout';
import { markupLines } from './textSelect';
import { boundsOf, outlinePoints, rotatePoint, rotationCentre, capSize, circleOf, cloudRadius, mapGeometry, type Geometry, contentBox, markerSize, markupBounds, unrotate, type Markup, type Point } from './model';
import { TYPE_INFO } from './types';
import { HATCH_ANGLES, lineEnds, type LineEnding } from './style';

/** Path commands in page space. `C` is a cubic Bézier: two control points, then the end point. */
export type PathCmd = ['M', number, number] | ['L', number, number] | ['C', number, number, number, number, number, number] | ['Z'];

export interface ShapePart {
  path: PathCmd[];
  stroke: boolean;
  /** Fill color, or null for none. */
  fill: string | null;
  /**
   * Line endings and other solid details: never dashed, and filled at the markup's opacity rather
   * than its fill opacity.
   */
  decoration?: boolean;
  /** Hatch lines: clipped to this path and drawn thinner than the outline. */
  clip?: PathCmd[];
  /** Fill (or clip) with the even-odd rule, so inner rings are holes. */
  evenOdd?: boolean;
}

/** Cubic Bézier constant for approximating a quarter circle. */
const KAPPA = 0.5522847498;

/** Vector shapes that draw a markup. Text content is laid out separately (see `layoutText`). */
export function markupShape(m: Markup): ShapePart[] {
  const parts = baseShape(m);
  const hatch = m.style.hatch;
  if (hatch && hatch !== 'none' && parts[0] && isClosed(m)) {
    const spacing = Math.max(3, m.style.width * 4);
    parts.push({ path: hatchLines(boundsOf(m.points), HATCH_ANGLES[hatch], spacing), stroke: true, fill: null, decoration: true, clip: parts[0].path, evenOdd: parts[0].evenOdd });
  }
  return parts;
}

function isClosed(m: Markup): boolean {
  // Click-drawn outlines only enclose an area once they have three points.
  return TYPE_INFO[m.type].closed && (TYPE_INFO[m.type].draw !== 'click' || m.points.length > 2);
}

function baseShape(m: Markup): ShapePart[] {
  const { points, style } = m;
  switch (m.type) {
    case 'line':
    case 'arrow':
      return withEnds(m, points.slice(0, 2));
    case 'polyline':
      return withEnds(m, points);
    case 'arc':
      return withEnds(m, arcPoints(points));
    case 'rect':
    case 'text':
    case 'typewriter':
    case 'image':
    case 'signature': {
      const b = boundsOf(points);
      const path: PathCmd[] = [['M', b.x, b.y], ['L', b.x + b.w, b.y], ['L', b.x + b.w, b.y + b.h], ['L', b.x, b.y + b.h], ['Z']];
      const boxless = style.noBox && m.type === 'text';
      return [{ path, stroke: !boxless && (m.type === 'rect' || style.width > 0), fill: boxless ? null : style.fill }];
    }
    case 'polygon':
      return [{ path: points.length > 2 ? [...polyline(points), ['Z']] : polyline(points), stroke: true, fill: style.fill }];
    case 'callout': {
      if (points.length < 4) return withEnds(m, points.slice(0, 2));
      const box = contentBox(m);
      const leaders = calloutLeaders(points).flatMap(([tip, knee]) => {
        const land = calloutLanding(knee, box);
        return withEnds(m, [tip, land.knee, land.attach]);
      });
      const rect: PathCmd[] = [['M', box.x, box.y], ['L', box.x + box.w, box.y], ['L', box.x + box.w, box.y + box.h], ['L', box.x, box.y + box.h], ['Z']];
      return [{ path: rect, stroke: style.width > 0 && !style.noBox, fill: style.noBox ? null : style.fill }, ...leaders];
    }
    case 'note':
      return notePath(boundsOf(points), style.fill);
    case 'dimension':
      return withEnds(m, points.slice(0, 2));
    case 'attachment':
      return attachmentPath(boundsOf(points), style.fill);
    case 'flag':
      return flagPath(boundsOf(points), style.fill);
    case 'replaceText': {
      // Struck through, with a caret under the end of the last line where the new text goes.
      const lines = markupLines(points);
      const strikes = lines.map((r) => ({ path: textLine('strikeout', r), stroke: true, fill: null }));
      const last = lines.at(-1);
      if (!last) return strikes;
      const s = Math.max(2, last.h * 0.35);
      const x = last.x + last.w;
      const y = last.y + last.h;
      return [...strikes, { path: [['M', x - s, y + s], ['L', x, y - s * 0.2], ['L', x + s, y + s]] as PathCmd[], stroke: true, fill: null, decoration: true }];
    }
    case 'stamp': {
      const b = boundsOf(points);
      const frame = m.stamp?.frame ?? 'rounded';
      const path = frame === 'rounded' ? roundedRect(b, Math.min(b.w, b.h) * 0.18) : rectPath(b);
      return [{ path, stroke: frame !== 'none', fill: style.fill }];
    }
    case 'hyperlink':
    case 'redaction':
      return [{ path: rectPath(boundsOf(points)), stroke: style.width > 0, fill: style.fill }];
    case 'legend':
      // The frame; rows and text are drawn from the markups it lists (see legend.ts).
      return [{ path: rectPath(boundsOf(points)), stroke: style.width > 0, fill: style.fill }];
    case 'textHighlight':
      return markupLines(points).map((r) => ({ path: rectPath(r), stroke: false, fill: style.stroke }));
    case 'underline':
    case 'strikeout':
    case 'squiggly': {
      const kind = m.type;
      return markupLines(points).map((r) => ({ path: textLine(kind, r), stroke: true, fill: null }));
    }
    case 'ellipse':
      return [{ path: ellipsePath(boundsOf(points)), stroke: true, fill: style.fill }];
    case 'cloud':
      return [{ path: cloudPath(boundsOf(points), cloudRadius(m), !!style.cloudInside), stroke: true, fill: style.fill }];
    case 'pen':
    case 'highlighter':
      return [{ path: polyline(points), stroke: true, fill: null }];
    case 'polylength':
      return withEnds(m, m.bulges?.some(Boolean) ? expandArcs(points, m.bulges) : points);
    case 'length': {
      const [a, b] = [points[0]!, points[points.length - 1]!];
      const offset = style.leader ?? 0;
      if (!offset) return withEnds(m, [a, b]);
      // Offset dimension: the dimension line runs parallel to the measured points, joined to them
      // by extension lines that start a small gap off the object and run just past the line.
      const [nx, ny] = dimensionNormal(a, b);
      const sign = Math.sign(offset);
      const gap = Math.min(markerSize(m) * 0.5, Math.abs(offset) / 2);
      const over = markerSize(m) * 0.75;
      const ext = (p: Point): PathCmd[] => [
        ['M', p[0] + nx * gap * sign, p[1] + ny * gap * sign],
        ['L', p[0] + nx * (offset + over * sign), p[1] + ny * (offset + over * sign)],
      ];
      const shifted: Point[] = [a, b].map((p) => [p[0] + nx * offset, p[1] + ny * offset] as Point);
      return [...withEnds(m, shifted), { path: [...ext(a), ...ext(b)], stroke: true, fill: null, decoration: true }];
    }
    case 'area':
    case 'perimeter':
    case 'volume':
    case 'space': {
      const edge = m.type !== 'space' && m.bulges?.some(Boolean) && points.length > 2 ? expandArcs(points, m.bulges, true) : points;
      const outline: PathCmd[] = edge.length > 2 ? [...polyline(edge), ['Z']] : polyline(edge);
      const holes = (m.holes ?? []).filter((h) => h.length > 2);
      if (!holes.length) return [{ path: outline, stroke: true, fill: style.fill }];
      return [{ path: [...outline, ...holes.flatMap((h): PathCmd[] => [...polyline(h), ['Z']])], stroke: true, fill: style.fill, evenOdd: true }];
    }
    case 'diameter':
    case 'radius': {
      const c = circleOf(m);
      if (!c || points.length < 2) return [{ path: polyline(points), stroke: true, fill: null }];
      return [{ path: ellipsePath({ x: c.cx - c.r, y: c.cy - c.r, w: c.r * 2, h: c.r * 2 }), stroke: true, fill: style.fill }, ...withEnds(m, points.slice(0, 2))];
    }
    case 'arcLength':
      return withEnds(m, arcPoints(points));
    case 'count': {
      const r = markerSize(m);
      return points.map(([x, y]) => ({ path: ellipsePath({ x: x - r, y: y - r, w: r * 2, h: r * 2 }), stroke: true, fill: style.fill }));
    }
    case 'angle': {
      if (points.length < 3) return [{ path: polyline(points), stroke: true, fill: null }];
      const [a, v, c] = points as [Point, Point, Point];
      const r = markerSize(m) * 3;
      let a1 = Math.atan2(a[1] - v[1], a[0] - v[0]);
      let a2 = Math.atan2(c[1] - v[1], c[0] - v[0]);
      // Sweep the short way round.
      if (a2 - a1 > Math.PI) a1 += 2 * Math.PI;
      else if (a1 - a2 > Math.PI) a2 += 2 * Math.PI;
      const arc: Point[] = [];
      for (let i = 0; i <= 16; i++) {
        const t = a1 + ((a2 - a1) * i) / 16;
        arc.push([v[0] + Math.cos(t) * r, v[1] + Math.sin(t) * r]);
      }
      return [
        { path: polyline([a, v, c]), stroke: true, fill: null },
        { path: polyline(arc), stroke: true, fill: null },
      ];
    }
  }
}

/** Unit normal of segment a→b; a length's positive `leader` offsets its dimension line this way. */
export function dimensionNormal(a: Point, b: Point): [number, number] {
  const d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return [-(b[1] - a[1]) / d, (b[0] - a[0]) / d];
}

/**
 * Length and direction of segment a→b, the angle in degrees counter-clockwise from east as on
 * paper (page y runs down), in [0, 360).
 */
export function segmentPolar(a: Point, b: Point): { length: number; angle: number } {
  const dx = b[0] - a[0];
  const dy = a[1] - b[1];
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  return { length: Math.hypot(dx, dy), angle: angle < 0 ? angle + 360 : angle };
}

/** The point `length` from `from` at `angle` degrees counter-clockwise from east. */
export function polarPoint(from: Point, length: number, angle: number): Point {
  const r = (angle * Math.PI) / 180;
  return [from[0] + Math.cos(r) * length, from[1] - Math.sin(r) * length];
}

/**
 * Points with segment `i` (from point i to i + 1) set to `length` at `angle` degrees: point i + 1
 * and everything after it move together, so the rest of the path keeps its shape.
 */
export function withSegment(points: readonly Point[], i: number, length: number, angle: number): Point[] {
  const out = points.map((p): Point => [p[0], p[1]]);
  if (i < 0 || i + 1 >= out.length) return out;
  const end = polarPoint(out[i]!, length, angle);
  const dx = end[0] - out[i + 1]![0];
  const dy = end[1] - out[i + 1]![1];
  for (let j = i + 1; j < out.length; j++) out[j] = [out[j]![0] + dx, out[j]![1] + dy];
  return out;
}

/**
 * A two-point box `width` by `height`, growing away from its first corner (which stays where it
 * is on the page, even when the box is rotated).
 */
export function resizedBox(m: Pick<Markup, 'type' | 'points' | 'rotation'>, width: number, height: number): Point[] {
  const [p, q] = [m.points[0]!, m.points[1]!];
  const points: Point[] = [[p[0], p[1]], [p[0] + (q[0] < p[0] ? -width : width), p[1] + (q[1] < p[1] ? -height : height)]];
  if (!m.rotation) return points;
  const before = rotatePoint(p, rotationCentre(m), m.rotation);
  const after = rotatePoint(p, rotationCentre({ type: m.type, points }), m.rotation);
  const [dx, dy] = [before[0] - after[0], before[1] - after[1]];
  return points.map(([x, y]): Point => [x + dx, y + dy]);
}

/** An open path with the markup's line endings; the shaft is trimmed so it ends at each ending's base. */
function withEnds(m: Markup, pts: readonly Point[]): ShapePart[] {
  if (pts.length < 2) return [{ path: polyline(pts), stroke: true, fill: null }];
  const [startCap, endCap] = lineEnds(m);
  const size = capSize(m);
  const shaft = pts.map((p) => [p[0], p[1]] as Point);
  const n = shaft.length;
  const parts: ShapePart[] = [];
  const end = (tip: Point, from: Point, kind: LineEnding): number => {
    const dx = tip[0] - from[0];
    const dy = tip[1] - from[1];
    const d = Math.hypot(dx, dy) || 1;
    const cap = lineEnding(kind, tip, [dx / d, dy / d], size, m.style.stroke);
    parts.push(...cap.parts);
    // Never trim a segment away entirely (short lines with big endings).
    return Math.min(cap.trim, d * (n === 2 ? 0.45 : 0.9));
  };
  const trimStart = end(pts[0]!, pts[1]!, startCap);
  const trimEnd = end(pts[n - 1]!, pts[n - 2]!, endCap);
  moveToward(shaft[0]!, pts[1]!, trimStart);
  moveToward(shaft[n - 1]!, pts[n - 2]!, trimEnd);
  return [{ path: polyline(shaft), stroke: true, fill: null }, ...parts];
}

function moveToward(p: Point, target: Point, dist: number) {
  if (!dist) return;
  const d = Math.hypot(target[0] - p[0], target[1] - p[1]) || 1;
  p[0] += ((target[0] - p[0]) / d) * dist;
  p[1] += ((target[1] - p[1]) / d) * dist;
}

/**
 * One line ending at `tip`, pointing along unit vector `u`, `size` points long. `trim` is how far
 * the line itself stops short of the tip so it does not poke through the ending.
 */
function lineEnding(kind: LineEnding, tip: Point, [ux, uy]: [number, number], size: number, color: string): { parts: ShapePart[]; trim: number } {
  const at = (along: number, across: number): Point => [tip[0] + ux * along - uy * across, tip[1] + uy * along + ux * across];
  const shape = (pts: Point[], filled: boolean): ShapePart => ({ path: [...polyline(pts), ['Z']], stroke: true, fill: filled ? color : null, decoration: true });
  const half = size * 0.45;
  switch (kind) {
    case 'none':
      return { parts: [], trim: 0 };
    case 'openArrow':
      return { parts: [{ path: polyline([at(-size, half), tip, at(-size, -half)]), stroke: true, fill: null, decoration: true }], trim: 0 };
    case 'closedArrow':
      return { parts: [shape([tip, at(-size, half), at(-size, -half)], false)], trim: size };
    case 'filledArrow':
      // Unstroked so the point stays sharp however thick the line is.
      return { parts: [{ ...shape([tip, at(-size, half), at(-size, -half)], true), stroke: false }], trim: size };
    case 'circle':
    case 'filledCircle': {
      const r = size * 0.3;
      const path = ellipsePath({ x: tip[0] - r, y: tip[1] - r, w: r * 2, h: r * 2 });
      return { parts: [{ path, stroke: true, fill: kind === 'filledCircle' ? color : null, decoration: true }], trim: kind === 'circle' ? r : 0 };
    }
    case 'square':
    case 'filledSquare': {
      const s = size * 0.3;
      return { parts: [shape([at(-s, -s), at(-s, s), at(s, s), at(s, -s)], kind === 'filledSquare')], trim: kind === 'square' ? s : 0 };
    }
    case 'diamond':
    case 'filledDiamond': {
      const s = size * 0.4;
      return { parts: [shape([at(-s, 0), at(0, s), at(s, 0), at(0, -s)], kind === 'filledDiamond')], trim: kind === 'diamond' ? s : 0 };
    }
    case 'tick':
      return { parts: [{ path: polyline([at(0, -size / 2), at(0, size / 2)]), stroke: true, fill: null, decoration: true }], trim: 0 };
    case 'slash': {
      const k = size / 2 / Math.SQRT2;
      return { parts: [{ path: polyline([at(-k, -k), at(k, k)]), stroke: true, fill: null, decoration: true }], trim: 0 };
    }
  }
}

/** Parallel lines at each angle (degrees), `spacing` apart, covering `b`; the caller clips them to the shape. */
function hatchLines(b: { x: number; y: number; w: number; h: number }, angles: readonly number[], spacing: number): PathCmd[] {
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const reach = Math.hypot(b.w, b.h) / 2 + spacing;
  const count = Math.min(500, Math.ceil(reach / spacing));
  const path: PathCmd[] = [];
  for (const deg of angles) {
    const t = (deg * Math.PI) / 180;
    const dx = Math.cos(t);
    const dy = Math.sin(t);
    for (let i = -count; i <= count; i++) {
      const ox = cx - dy * i * spacing;
      const oy = cy + dx * i * spacing;
      path.push(['M', ox - dx * reach, oy - dy * reach], ['L', ox + dx * reach, oy + dy * reach]);
    }
  }
  return path;
}

/** A rectangle with quarter-circle corners of radius `r`. */
function roundedRect(b: { x: number; y: number; w: number; h: number }, r: number): PathCmd[] {
  const k = r * (1 - KAPPA);
  const [x0, y0, x1, y1] = [b.x, b.y, b.x + b.w, b.y + b.h];
  return [
    ['M', x0 + r, y0],
    ['L', x1 - r, y0],
    ['C', x1 - k, y0, x1, y0 + k, x1, y0 + r],
    ['L', x1, y1 - r],
    ['C', x1, y1 - k, x1 - k, y1, x1 - r, y1],
    ['L', x0 + r, y1],
    ['C', x0 + k, y1, x0, y1 - k, x0, y1 - r],
    ['L', x0, y0 + r],
    ['C', x0, y0 + k, x0 + k, y0, x0 + r, y0],
    ['Z'],
  ];
}

function rectPath(r: { x: number; y: number; w: number; h: number }): PathCmd[] {
  return [['M', r.x, r.y], ['L', r.x + r.w, r.y], ['L', r.x + r.w, r.y + r.h], ['L', r.x, r.y + r.h], ['Z']];
}

/** The line under (underline), through (strikeout) or wavy under (squiggly) one line of text. */
function textLine(type: 'underline' | 'strikeout' | 'squiggly', r: { x: number; y: number; w: number; h: number }): PathCmd[] {
  if (type === 'strikeout') return [['M', r.x, r.y + r.h * 0.55], ['L', r.x + r.w, r.y + r.h * 0.55]];
  const y = r.y + r.h * 0.95;
  if (type === 'underline') return [['M', r.x, y], ['L', r.x + r.w, y]];
  // Squiggly: a zigzag about a sixth of the line height tall.
  const amp = Math.max(0.5, r.h * 0.08);
  const step = amp * 2;
  const path: PathCmd[] = [['M', r.x, y]];
  for (let x = r.x + step, up = true; x <= r.x + r.w + 1e-6; x += step, up = !up) path.push(['L', Math.min(x, r.x + r.w), y + (up ? -amp : amp)]);
  return path;
}

/** A file attachment: a rounded tag with a paperclip. */
function attachmentPath(b: { x: number; y: number; w: number; h: number }, fill: string | null): ShapePart[] {
  const cx = b.x + b.w / 2;
  const w = b.w * 0.26;
  const top = b.y + b.h * 0.14;
  const bottom = b.y + b.h * 0.86;
  const k = 0.5523 * w;
  // The clip: an outer loop down the left and up the right, and an inner loop.
  const clip: PathCmd[] = [
    ['M', cx + w, b.y + b.h * 0.4],
    ['L', cx + w, bottom - w],
    ['C', cx + w, bottom - w + k, cx + k, bottom, cx, bottom],
    ['C', cx - k, bottom, cx - w, bottom - w + k, cx - w, bottom - w],
    ['L', cx - w, top + w * 0.7],
    ['C', cx - w, top + w * 0.7 - k * 0.7, cx - k * 0.7, top, cx, top],
    ['C', cx + k * 0.7, top, cx + w * 0.55, top + w * 0.7 - k * 0.7, cx + w * 0.55, top + w * 0.7],
    ['L', cx + w * 0.55, bottom - w * 1.1],
    ['C', cx + w * 0.55, bottom - w * 0.6, cx - w * 0.45, bottom - w * 0.6, cx - w * 0.45, bottom - w * 1.1],
    ['L', cx - w * 0.45, b.y + b.h * 0.4],
  ];
  return [
    { path: roundedRect(b, Math.min(b.w, b.h) * 0.2), stroke: true, fill },
    { path: clip, stroke: true, fill: null, decoration: true },
  ];
}

/** A flag on a pole. */
function flagPath(b: { x: number; y: number; w: number; h: number }, fill: string | null): ShapePart[] {
  const pole = b.x + b.w * 0.18;
  const cloth: PathCmd[] = [['M', pole, b.y + b.h * 0.06], ['L', b.x + b.w * 0.95, b.y + b.h * 0.3], ['L', pole, b.y + b.h * 0.55], ['Z']];
  return [
    { path: cloth, stroke: true, fill },
    { path: [['M', pole, b.y + b.h * 0.04], ['L', pole, b.y + b.h]], stroke: true, fill: null, decoration: true },
  ];
}

/** A sticky note: a page with a folded bottom-right corner and three lines of "writing". */
function notePath(b: { x: number; y: number; w: number; h: number }, fill: string | null): ShapePart[] {
  const fold = Math.min(b.w, b.h) * 0.3;
  const right = b.x + b.w;
  const bottom = b.y + b.h;
  const body: PathCmd[] = [['M', b.x, b.y], ['L', right, b.y], ['L', right, bottom - fold], ['L', right - fold, bottom], ['L', b.x, bottom], ['Z']];
  const flap: PathCmd[] = [['M', right, bottom - fold], ['L', right - fold, bottom - fold], ['L', right - fold, bottom]];
  const lines: PathCmd[] = [];
  for (const f of [0.28, 0.48, 0.68]) {
    const y = b.y + b.h * f;
    lines.push(['M', b.x + b.w * 0.2, y], ['L', b.x + b.w * (f > 0.6 ? 0.55 : 0.8), y]);
  }
  return [
    { path: body, stroke: true, fill },
    { path: [...flap, ...lines], stroke: true, fill: null, decoration: true },
  ];
}

export function pointInPolygon([px, py]: Point, poly: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function polyline(points: readonly Point[]): PathCmd[] {
  return points.map(([x, y], i) => [i === 0 ? 'M' : 'L', x, y] as PathCmd);
}

function ellipsePath(b: { x: number; y: number; w: number; h: number }): PathCmd[] {
  const rx = b.w / 2;
  const ry = b.h / 2;
  const cx = b.x + rx;
  const cy = b.y + ry;
  const ox = rx * KAPPA;
  const oy = ry * KAPPA;
  return [
    ['M', cx + rx, cy],
    ['C', cx + rx, cy + oy, cx + ox, cy + ry, cx, cy + ry],
    ['C', cx - ox, cy + ry, cx - rx, cy + oy, cx - rx, cy],
    ['C', cx - rx, cy - oy, cx - ox, cy - ry, cx, cy - ry],
    ['C', cx + ox, cy - ry, cx + rx, cy - oy, cx + rx, cy],
    ['Z'],
  ];
}

/** Revision cloud: each edge of the box is split into semicircular bumps bulging outward. */
function cloudPath(b: { x: number; y: number; w: number; h: number }, radius: number, inside = false): PathCmd[] {
  const corners: Point[] = [
    [b.x, b.y],
    [b.x + b.w, b.y],
    [b.x + b.w, b.y + b.h],
    [b.x, b.y + b.h],
  ];
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const path: PathCmd[] = [['M', b.x, b.y]];
  for (let i = 0; i < 4; i++) {
    const p = corners[i]!;
    const q = corners[(i + 1) % 4]!;
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (len === 0) continue;
    const n = Math.max(1, Math.round(len / (radius * 2)));
    const ux = (q[0] - p[0]) / len;
    const uy = (q[1] - p[1]) / len;
    // Outward normal: perpendicular to the edge, pointing away from the box center.
    let nx = -uy;
    let ny = ux;
    const mx = (p[0] + q[0]) / 2;
    const my = (p[1] + q[1]) / 2;
    if (((mx - cx) * nx + (my - cy) * ny < 0) !== inside) {
      nx = -nx;
      ny = -ny;
    }
    const r = len / n / 2;
    for (let s = 0; s < n; s++) {
      const ax = p[0] + ux * r * 2 * s;
      const ay = p[1] + uy * r * 2 * s;
      const px = ax + ux * r + nx * r;
      const py = ay + uy * r + ny * r;
      const bx = ax + ux * r * 2;
      const by = ay + uy * r * 2;
      const k = KAPPA * r;
      path.push(['C', ax + nx * k, ay + ny * k, px - ux * k, py - uy * k, px, py]);
      path.push(['C', px + ux * k, py + uy * k, bx + nx * k, by + ny * k, bx, by]);
    }
  }
  path.push(['Z']);
  return path;
}

/** Flattens a path into polylines (one per subpath) for hit testing. */
export function flatten(path: PathCmd[], steps = 8): Point[][] {
  const out: Point[][] = [];
  let cur: Point[] = [];
  let start: Point = [0, 0];
  let last: Point = [0, 0];
  for (const cmd of path) {
    switch (cmd[0]) {
      case 'M':
        if (cur.length > 1) out.push(cur);
        start = last = [cmd[1], cmd[2]];
        cur = [last];
        break;
      case 'L':
        last = [cmd[1], cmd[2]];
        cur.push(last);
        break;
      case 'C': {
        const [, x1, y1, x2, y2, x, y] = cmd;
        const [x0, y0] = last;
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          const mt = 1 - t;
          cur.push([
            mt ** 3 * x0 + 3 * mt * mt * t * x1 + 3 * mt * t * t * x2 + t ** 3 * x,
            mt ** 3 * y0 + 3 * mt * mt * t * y1 + 3 * mt * t * t * y2 + t ** 3 * y,
          ]);
        }
        last = [x, y];
        break;
      }
      case 'Z':
        cur.push(start);
        last = start;
        break;
    }
  }
  if (cur.length > 1) out.push(cur);
  return out;
}

function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** True if `p` (page space) hits the markup within `tolerance` points. */
export function hitTest(m: Markup, p: Point, tolerance: number): boolean {
  if (m.rotation) {
    // Test in the markup's own frame.
    p = unrotate(m, p);
    m = { ...m, rotation: 0 };
  }
  const b = markupBounds(m);
  if (p[0] < b.x - tolerance || p[0] > b.x + b.w + tolerance || p[1] < b.y - tolerance || p[1] > b.y + b.h + tolerance) return false;
  if (m.type === 'area' || m.type === 'volume' || m.type === 'space' || (m.type === 'polygon' && (m.style.fill || (m.style.hatch && m.style.hatch !== 'none')))) {
    if (pointInPolygon(p, outlinePoints(m)) && !(m.holes ?? []).some((h) => h.length > 2 && pointInPolygon(p, h))) return true;
  } else if (m.type === 'count') {
    const r = markerSize(m) + tolerance;
    if (m.points.some(([x, y]) => Math.hypot(x - p[0], y - p[1]) <= r)) return true;
  } else if (TYPE_INFO[m.type].draw === 'text') {
    // Text markups: anywhere on one of their lines.
    return markupLines(m.points).some((r) => p[0] >= r.x - tolerance && p[0] <= r.x + r.w + tolerance && p[1] >= r.y - tolerance && p[1] <= r.y + r.h + tolerance);
  } else if (TYPE_INFO[m.type].solid || m.style.fill || (m.style.hatch && m.style.hatch !== 'none')) {
    // Text boxes and filled shapes are grabbable anywhere inside.
    const inner = contentBox(m);
    if (p[0] >= inner.x && p[0] <= inner.x + inner.w && p[1] >= inner.y && p[1] <= inner.y + inner.h) return true;
  }
  const tol = tolerance + m.style.width / 2;
  for (const part of markupShape(m)) {
    if (part.clip) continue;
    for (const line of flatten(part.path)) {
      for (let i = 1; i < line.length; i++) if (distToSegment(p, line[i - 1]!, line[i]!) <= tol) return true;
    }
  }
  return false;
}

/** `m`'s points moved by (dx, dy). */
export function translated(m: Markup, dx: number, dy: number): Point[] {
  return m.points.map(([x, y]) => [x + dx, y + dy] as Point);
}

/**
 * A markup's drawn lines as flat [x1, y1, x2, y2, ...] segments, e.g. to act as boundaries for
 * Smart Fill alongside the drawing's own line work.
 */
export function markupSegments(m: Markup): number[] {
  const out: number[] = [];
  for (const part of markupShape(m)) {
    if (part.clip || !part.stroke) continue;
    for (const line of flatten(part.path)) for (let i = 1; i < line.length; i++) out.push(line[i - 1]![0], line[i - 1]![1], line[i]![0], line[i]![1]);
  }
  return out;
}

/** A markup's points and cutouts moved by (dx, dy). */
export function moved(m: Geometry, dx: number, dy: number): Geometry {
  return mapGeometry(m, ([x, y]) => [x + dx, y + dy]);
}

export const TEXT_PADDING = 4;
export const TEXT_LINE_HEIGHT = 1.2;

/**
 * Greedy word wrap into lines no wider than `maxWidth`. `measure` returns the width of a string at
 * the markup's font size, so the same layout serves canvas and PDF output.
 */
export function layoutText(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/(\s+)/)) {
      const next = line + word;
      if (line && measure(next.trimEnd()) > maxWidth) {
        lines.push(line.trimEnd());
        line = word.trimStart();
      } else {
        line = next;
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}
