import type { Pt } from './measure.ts';

/**
 * Object snap tracking and polar tracking, after AutoCAD's. Points acquired by resting the pointer
 * on a snap give alignment paths through them (straight across and up and down, or at every polar
 * angle); an endpoint acquired on a line also gives its extension, and a line acquired for
 * parallel gives a path from the point being drawn from in its direction. Polar tracking gives
 * paths from that point at multiples of an angle. The pointer locks onto a path it comes near,
 * onto where two paths cross, or onto where a path crosses the drawing's lines.
 */

/** A point acquired for tracking, with the directions of any lines it ends (their extensions). */
export interface TrackPoint {
  point: Pt;
  /** Unit vectors pointing out past the end of the lines it was acquired on. */
  extensions?: readonly Pt[];
}

export type TrackPathKind = 'tracking' | 'polar' | 'extension' | 'parallel';

/** A line the pointer can lock onto: through `origin` along the unit vector `dir`. */
export interface TrackPath {
  origin: [number, number];
  dir: [number, number];
  kind: TrackPathKind;
  /** Direction on paper in degrees, counter-clockwise from east, in [0, 360). */
  angle: number;
  /** Only the half beyond `origin` (an extension past a line's end). */
  ray: boolean;
}

export interface Tracked {
  point: [number, number];
  /** The one or two paths it is on. */
  paths: TrackPath[];
  /** Where a path crosses a line of the drawing, rather than following the path alone. */
  onLine?: boolean;
}

export interface TrackOptions {
  /** Points acquired for object snap tracking. */
  acquired: readonly TrackPoint[];
  /** The point the line being drawn starts from (polar tracking and parallel paths start here). */
  from?: Pt | null;
  /** Object snap tracking: alignment paths through the acquired points. */
  objectTracking: boolean;
  /** Polar tracking's angle step in degrees, or null for none. */
  polarStep: number | null;
  /** Track acquired points along every polar angle, not only straight across and up and down. */
  polarForObjects?: boolean;
  /** Extensions of lines past acquired endpoints. */
  extensions: boolean;
  /** Unit directions of lines acquired for parallel: paths from `from` that way. */
  parallels?: readonly Pt[];
}

/** Paper angle (counter-clockwise from east, page y down) of a unit direction, in [0, 360). */
function angleOf(dir: Pt): number {
  const a = (Math.atan2(-dir[1], dir[0]) * 180) / Math.PI;
  return Math.round((((a % 360) + 360) % 360) * 1e6) / 1e6;
}

function dirAt(degrees: number): [number, number] {
  const a = (degrees * Math.PI) / 180;
  // Exact zeros keep straight paths exactly straight.
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [Math.abs(c) < 1e-12 ? 0 : c, Math.abs(s) < 1e-12 ? 0 : -s];
}

/** The angles a polar step gives, through a whole turn. */
function polarAngles(step: number): number[] {
  const out: number[] = [];
  for (let a = 0; a < 360 - 1e-9 && out.length < 360; a += step) out.push(a);
  return out;
}

/** Every path the options give. */
export function trackingPaths(o: TrackOptions): TrackPath[] {
  const paths: TrackPath[] = [];
  const add = (origin: Pt, dir: Pt, kind: TrackPathKind, ray: boolean) => paths.push({ origin: [origin[0], origin[1]], dir: [dir[0], dir[1]], kind, angle: angleOf(dir), ray });
  if (o.from && o.polarStep && o.polarStep > 0) for (const a of polarAngles(o.polarStep)) add(o.from, dirAt(a), 'polar', true);
  if (o.from) for (const d of o.parallels ?? []) {
    add(o.from, d, 'parallel', false);
  }
  for (const t of o.acquired) {
    if (o.objectTracking) {
      const angles = o.polarForObjects && o.polarStep ? polarAngles(o.polarStep) : [0, 90, 180, 270];
      for (const a of angles) add(t.point, dirAt(a), 'tracking', true);
    }
    if (o.extensions) for (const d of t.extensions ?? []) add(t.point, d, 'extension', true);
  }
  return paths;
}

/** Where `p` falls on a path: its distance off it and the point on it (null behind a ray's origin). */
function onPath(p: Pt, path: TrackPath): { d: number; at: [number, number]; t: number } | null {
  const t = (p[0] - path.origin[0]) * path.dir[0] + (p[1] - path.origin[1]) * path.dir[1];
  if (path.ray && t < 0) return null;
  const at: [number, number] = [path.origin[0] + t * path.dir[0], path.origin[1] + t * path.dir[1]];
  return { d: Math.hypot(p[0] - at[0], p[1] - at[1]), at, t };
}

/** Where two paths cross, or null when they are parallel or start from the same point. */
function crossing(a: TrackPath, b: TrackPath): [number, number] | null {
  const den = a.dir[0] * b.dir[1] - a.dir[1] * b.dir[0];
  if (Math.abs(den) < 1e-9) return null;
  if (Math.hypot(a.origin[0] - b.origin[0], a.origin[1] - b.origin[1]) < 1e-9) return null;
  const t = ((b.origin[0] - a.origin[0]) * b.dir[1] - (b.origin[1] - a.origin[1]) * b.dir[0]) / den;
  const u = ((b.origin[0] - a.origin[0]) * a.dir[1] - (b.origin[1] - a.origin[1]) * a.dir[0]) / den;
  if ((a.ray && t < -1e-9) || (b.ray && u < -1e-9)) return null;
  return [a.origin[0] + t * a.dir[0], a.origin[1] + t * a.dir[1]];
}

/**
 * The tracked point for the pointer at `p`, or null when no path is within `radius`. Two paths
 * crossing near the pointer win, then a path crossing one of `lines` (flat [x1, y1, x2, y2, ...],
 * the drawing near the pointer), then the nearest path. A path must run at least `radius` from
 * its origin before it is followed, so resting on an acquired point does not lock onto it.
 */
export function track(p: Pt, radius: number, options: TrackOptions, lines: ArrayLike<number> = []): Tracked | null {
  const near: { path: TrackPath; d: number; at: [number, number] }[] = [];
  for (const path of trackingPaths(options)) {
    const hit = onPath(p, path);
    if (hit && hit.d <= radius && Math.abs(hit.t) > radius) near.push({ path, d: hit.d, at: hit.at });
  }
  if (!near.length) return null;
  near.sort((a, b) => a.d - b.d);

  let best: Tracked | null = null;
  let bestD = Infinity;
  for (let i = 0; i < near.length; i++) {
    for (let j = i + 1; j < near.length; j++) {
      const x = crossing(near[i]!.path, near[j]!.path);
      if (!x) continue;
      const d = Math.hypot(x[0] - p[0], x[1] - p[1]);
      if (d <= radius && d < bestD) {
        bestD = d;
        best = { point: x, paths: [near[i]!.path, near[j]!.path] };
      }
    }
  }
  if (best) return best;

  for (const { path } of near) {
    for (let k = 0; k + 3 < lines.length; k += 4) {
      const x = crossSegment(path, lines[k]!, lines[k + 1]!, lines[k + 2]!, lines[k + 3]!);
      if (!x) continue;
      const d = Math.hypot(x[0] - p[0], x[1] - p[1]);
      if (d <= radius && d < bestD) {
        bestD = d;
        best = { point: x, paths: [path], onLine: true };
      }
    }
  }
  if (best) return best;
  return { point: near[0]!.at, paths: [near[0]!.path] };
}

/** Where a path crosses a segment, or null. */
function crossSegment(path: TrackPath, x1: number, y1: number, x2: number, y2: number): [number, number] | null {
  const qx = x2 - x1;
  const qy = y2 - y1;
  const den = path.dir[0] * qy - path.dir[1] * qx;
  if (Math.abs(den) < 1e-9 * Math.max(1e-9, Math.hypot(qx, qy))) return null;
  const t = ((x1 - path.origin[0]) * qy - (y1 - path.origin[1]) * qx) / den;
  const u = ((x1 - path.origin[0]) * path.dir[1] - (y1 - path.origin[1]) * path.dir[0]) / den;
  if (u < -1e-9 || u > 1 + 1e-9 || (path.ray && t < 0)) return null;
  return [path.origin[0] + t * path.dir[0], path.origin[1] + t * path.dir[1]];
}
