import * as THREE from 'three';
import { label, SvgOverlay, type ScreenPoint } from './overlay.ts';

export type MeasureKind = 'length' | 'area' | 'angle' | 'volume';

/** What the pointer lands on: a corner (vertex) of an element, a point on one of its edges, or on a surface. */
export interface SnapHit {
  point: THREE.Vector3;
  kind: 'vertex' | 'edge' | 'face';
  modelId: string;
  localId: number;
}

export interface MeasureHost {
  container: HTMLElement;
  /** The canvas the model is drawn in: clicks on it place points (not on overlays above it). */
  canvas: HTMLCanvasElement;
  camera: () => THREE.Camera;
  /** The snapped point under the pointer (client coordinates), or null over empty space. */
  snapAt: (clientX: number, clientY: number) => Promise<SnapHit | null>;
  /** An element's volume (m³) and bounds, or null when it has no closed shape to measure. */
  volumeOf: (modelId: string, localId: number) => Promise<{ volume: number; box: THREE.Box3 | null } | null>;
  /** True when the event is over something with its own clicks (the mini-map). */
  isBlocked: (e: MouseEvent) => boolean;
  /** The number of finished measurements changed. */
  onChange: (count: number) => void;
}

interface Measurement {
  kind: MeasureKind;
  points: THREE.Vector3[];
  /** Volume: the element's bounds, drawn as its outline. */
  box?: THREE.Box3 | null;
  value: number;
}

const COLOUR = '#ff4d4f';
const PREVIEW = '#ffd43b';
/** Clicks closer than this (CSS px) to the first point of an area close it; to the last, finish it. */
const CLOSE_PX = 10;

export const formatLength = (m: number) => (Math.abs(m) < 1 ? `${(m * 1000).toFixed(0)} mm` : `${m.toFixed(3)} m`);
export const formatArea = (m2: number) => `${m2.toFixed(3)} m²`;
export const formatVolume = (m3: number) => `${m3.toFixed(3)} m³`;
export const formatAngle = (deg: number) => `${deg.toFixed(1)}°`;

/** A polygon's area (m²) from its corners in 3D: the size of its vector area, exact when it is flat. */
export function polygonArea(points: THREE.Vector3[]): number {
  if (points.length < 3) return 0;
  const sum = new THREE.Vector3();
  const o = points[0]!;
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i]!.clone().sub(o);
    const b = points[i + 1]!.clone().sub(o);
    sum.add(a.cross(b));
  }
  return sum.length() / 2;
}

/** The angle at `b` between the lines to `a` and `c`, in degrees. */
export function angleAt(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): number {
  const u = a.clone().sub(b);
  const v = c.clone().sub(b);
  if (u.lengthSq() < 1e-12 || v.lengthSq() < 1e-12) return 0;
  return THREE.MathUtils.radToDeg(u.angleTo(v));
}

/** Points along the arc at `b` from the line to `a` round to the line to `c`, at `radius`. */
function arcPoints(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, radius: number, steps = 24): THREE.Vector3[] {
  const u = a.clone().sub(b).normalize();
  const v = c.clone().sub(b).normalize();
  const angle = u.angleTo(v);
  const axis = new THREE.Vector3().crossVectors(u, v);
  if (axis.lengthSq() < 1e-12 || !(angle > 1e-6)) return [];
  axis.normalize();
  const out: THREE.Vector3[] = [];
  for (let i = 0; i <= steps; i++) out.push(u.clone().applyAxisAngle(axis, (angle * i) / steps).multiplyScalar(radius).add(b));
  return out;
}

/** The twelve edges of a box, as pairs of corners. */
function boxEdges(box: THREE.Box3): [THREE.Vector3, THREE.Vector3][] {
  const { min: a, max: b } = box;
  const c = (x: number, y: number, z: number) => new THREE.Vector3(x ? b.x : a.x, y ? b.y : a.y, z ? b.z : a.z);
  const edges: [THREE.Vector3, THREE.Vector3][] = [];
  for (const [x, y, z] of [
    [0, 0, 0],
    [1, 1, 0],
    [1, 0, 1],
    [0, 1, 1],
  ] as const) {
    edges.push([c(x, y, z), c(1 - x, y, z)], [c(x, y, z), c(x, 1 - y, z)], [c(x, y, z), c(x, y, 1 - z)]);
  }
  return edges;
}

/**
 * The 3D view's measuring tools, self-contained: a click picks each point (snapped to a corner or
 * an edge of an element when one is close, else the surface under the pointer), a line follows the
 * pointer to the next point with its value, and finished measurements stay drawn with their labels.
 *
 * - Length: two clicks.
 * - Area: a click for each corner; double-click, Enter or a click on the first point finishes.
 * - Angle: three clicks, the second at the angle's vertex.
 * - Volume: a click on an element.
 */
export class MeasureController {
  private readonly host: MeasureHost;
  private readonly overlay: SvgOverlay;
  private tool: MeasureKind | null = null;
  private readonly done: Measurement[] = [];
  /** The points placed so far for the measurement being made. */
  private draft: THREE.Vector3[] = [];
  /** Where the pointer is snapped now (null over empty space). */
  private hover: SnapHit | null = null;
  private hoverGen = 0;
  private moveBusy = false;
  private movePending: { x: number; y: number } | null = null;
  private clickGen = 0;
  /** Clicks are handled one after another (each waits for its snap), so a quick pair is not lost. */
  private clicks: Promise<void> = Promise.resolve();
  private dirty = true;
  private disposed = false;
  private readonly offs: (() => void)[] = [];

  constructor(host: MeasureHost) {
    this.host = host;
    this.overlay = new SvgOverlay(host.container, host.camera, 'm3d-measure-layer', 3);
    const canvas = host.canvas;
    this.listen(canvas, 'pointermove', (e) => this.onMove(e as PointerEvent));
    this.listen(canvas, 'pointerleave', () => {
      this.hover = null;
      this.dirty = true;
    });
    this.listen(canvas, 'click', (e) => {
      const m = e as MouseEvent;
      if (!this.tool || m.button !== 0 || this.host.isBlocked(m)) return;
      const job = { x: m.clientX, y: m.clientY, gen: this.clickGen, tool: this.tool };
      this.clicks = this.clicks.then(() => this.onClick(job)).catch((err: unknown) => console.warn('3D view: measuring:', err));
    });
    this.listen(canvas, 'dblclick', (e) => {
      if (this.tool !== 'area') return;
      e.preventDefault();
      // After the clicks it ends (still waiting for their snaps).
      const gen = this.clickGen;
      this.clicks = this.clicks.then(() => {
        if (gen === this.clickGen && this.tool === 'area') this.finishArea();
      });
    });
  }

  /** The measuring tool in use, or null when another tool is. Switching drops a measurement half made. */
  setTool(tool: MeasureKind | null): void {
    if (tool === this.tool) return;
    this.tool = tool;
    this.draft = [];
    this.hover = null;
    this.hoverGen++;
    this.clickGen++;
    this.host.canvas.style.cursor = tool ? 'crosshair' : '';
    this.dirty = true;
  }

  get count(): number {
    return this.done.length;
  }

  /** Drops the measurement being made; true when there was one. */
  cancel(): boolean {
    const had = this.draft.length > 0;
    this.draft = [];
    this.clickGen++;
    this.dirty = true;
    return had;
  }

  /** Enter: finishes an area being traced. */
  commit(): void {
    if (this.tool === 'area') this.finishArea();
  }

  /** Delete: the last measurement made goes. */
  deleteLast(): void {
    if (this.draft.length) return void this.cancel();
    if (!this.done.length) return;
    this.done.pop();
    this.changed();
  }

  clear(): void {
    this.draft = [];
    this.done.length = 0;
    this.changed();
  }

  private changed(): void {
    this.dirty = true;
    this.host.onChange(this.done.length);
  }

  private onMove(e: PointerEvent): void {
    if (!this.tool || this.disposed) return;
    // While a button is held the camera is moving: the last snap stays until it stops.
    if (e.buttons) return;
    this.movePending = { x: e.clientX, y: e.clientY };
    if (this.moveBusy) return;
    void this.runMove();
  }

  private async runMove(): Promise<void> {
    this.moveBusy = true;
    try {
      while (this.movePending && !this.disposed) {
        const { x, y } = this.movePending;
        this.movePending = null;
        const gen = this.hoverGen;
        const hit = await this.host.snapAt(x, y).catch(() => null);
        if (gen !== this.hoverGen || !this.tool) continue;
        this.hover = hit;
        this.dirty = true;
      }
    } finally {
      this.moveBusy = false;
    }
  }

  private async onClick({ x, y, gen, tool }: { x: number; y: number; gen: number; tool: MeasureKind }): Promise<void> {
    if (gen !== this.clickGen || tool !== this.tool || this.disposed) return;
    const hit = await this.host.snapAt(x, y).catch(() => null);
    if (gen !== this.clickGen || tool !== this.tool || this.disposed) return;
    if (hit) this.hover = hit;
    if (tool === 'volume') {
      if (hit) await this.measureVolume(hit, gen);
      return;
    }
    if (!hit) return;
    const p = hit.point.clone();
    if (tool === 'area' && this.draft.length) {
      const at = this.overlay.local(x, y);
      const first = this.overlay.project(this.draft[0]!);
      const last = this.overlay.project(this.draft[this.draft.length - 1]!);
      // A click back on the first corner closes the shape; a second click on the last (a double-click) finishes it.
      if (this.draft.length >= 3 && first && near(first, at)) return this.finishArea();
      if (last && near(last, at)) return this.finishArea();
    }
    this.draft.push(p);
    this.dirty = true;
    if (tool === 'length' && this.draft.length === 2) {
      const [a, b] = this.draft as [THREE.Vector3, THREE.Vector3];
      this.done.push({ kind: 'length', points: [a, b], value: a.distanceTo(b) });
      this.draft = [];
      this.changed();
    } else if (tool === 'angle' && this.draft.length === 3) {
      const [a, b, c] = this.draft as [THREE.Vector3, THREE.Vector3, THREE.Vector3];
      this.done.push({ kind: 'angle', points: [a, b, c], value: angleAt(a, b, c) });
      this.draft = [];
      this.changed();
    }
  }

  private finishArea(): void {
    const pts = this.draft;
    this.draft = [];
    this.dirty = true;
    if (pts.length < 3) return;
    this.done.push({ kind: 'area', points: pts, value: polygonArea(pts) });
    this.changed();
  }

  private async measureVolume(hit: SnapHit, gen: number): Promise<void> {
    const v = await this.host.volumeOf(hit.modelId, hit.localId).catch(() => null);
    if (gen !== this.clickGen || this.tool !== 'volume' || this.disposed) return;
    const centre = v?.box && !v.box.isEmpty() ? v.box.getCenter(new THREE.Vector3()) : hit.point.clone();
    this.done.push({ kind: 'volume', points: [centre], box: v?.box ?? null, value: v?.volume ?? NaN });
    this.changed();
  }

  /** Draws the measurements over the frame just rendered (called after every frame). */
  draw(): void {
    if (this.disposed) return;
    const live = this.done.length > 0 || this.draft.length > 0 || !!this.hover;
    // Nothing to draw and nothing drawn: leave the layer alone.
    if (!live && !this.dirty) return;
    this.dirty = false;
    const o = this.overlay;
    let out = '';
    const line = (runs: string[], colour: string, dash = '') => {
      for (const r of runs)
        out += `<polyline points="${r}" fill="none" stroke="rgba(0,0,0,0.6)" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/><polyline points="${r}" fill="none" stroke="${colour}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
    };
    const dot = (p: THREE.Vector3, colour: string) => {
      const s = o.project(p);
      if (s) out += `<circle cx="${s[0].toFixed(1)}" cy="${s[1].toFixed(1)}" r="3.5" fill="${colour}" stroke="#000" stroke-width="1.2"/>`;
    };
    const tag = (p: THREE.Vector3, text: string, colour = '#ffffff') => {
      const s = o.project(p);
      if (s) out += label([s[0], s[1] - 12], text, colour);
    };
    const fill = (pts: THREE.Vector3[], colour: string) => {
      const s = pts.map((p) => o.project(p));
      if (s.length >= 3 && s.every(Boolean)) out += `<polygon points="${(s as ScreenPoint[]).map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')}" fill="${colour}" fill-opacity="0.18" stroke="none"/>`;
    };
    const drawAngle = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, colour: string, value: number) => {
      line(o.polyline([a, b, c]), colour);
      const r = 0.3 * Math.min(a.distanceTo(b), c.distanceTo(b));
      const arc = arcPoints(a, b, c, r);
      if (arc.length) line(o.polyline(arc), colour);
      for (const p of [a, b, c]) dot(p, colour);
      tag(arc[Math.floor(arc.length / 2)] ?? b, formatAngle(value), colour === PREVIEW ? PREVIEW : '#ffffff');
    };

    for (const m of this.done) {
      if (m.kind === 'length') {
        const [a, b] = m.points as [THREE.Vector3, THREE.Vector3];
        line(o.polyline([a, b]), COLOUR);
        dot(a, COLOUR);
        dot(b, COLOUR);
        tag(a.clone().lerp(b, 0.5), formatLength(m.value));
      } else if (m.kind === 'area') {
        fill(m.points, COLOUR);
        line(o.polyline(m.points, true), COLOUR);
        for (const p of m.points) dot(p, COLOUR);
        tag(centroid(m.points), formatArea(m.value));
      } else if (m.kind === 'angle') {
        const [a, b, c] = m.points as [THREE.Vector3, THREE.Vector3, THREE.Vector3];
        drawAngle(a, b, c, COLOUR, m.value);
      } else {
        if (m.box && !m.box.isEmpty()) for (const [a, b] of boxEdges(m.box)) line(o.polyline([a, b]), COLOUR, '5 3');
        tag(m.points[0]!, Number.isFinite(m.value) ? `V = ${formatVolume(m.value)}` : 'No volume');
      }
    }

    // The measurement being made, with a line to the pointer.
    const at = this.hover?.point;
    const d = this.draft;
    if (this.tool === 'length' && d.length === 1) {
      const a = d[0]!;
      dot(a, PREVIEW);
      if (at) {
        line(o.polyline([a, at]), PREVIEW, '6 4');
        tag(a.clone().lerp(at, 0.5), formatLength(a.distanceTo(at)), PREVIEW);
      }
    } else if (this.tool === 'area' && d.length) {
      const pts = at ? [...d, at] : d;
      if (pts.length >= 3) fill(pts, PREVIEW);
      line(o.polyline(d), PREVIEW);
      if (at) line(o.polyline([d[d.length - 1]!, at, ...(d.length >= 2 ? [d[0]!] : [])]), PREVIEW, '6 4');
      for (const p of d) dot(p, PREVIEW);
      if (pts.length >= 3) tag(centroid(pts), formatArea(polygonArea(pts)), PREVIEW);
    } else if (this.tool === 'angle' && d.length) {
      if (d.length === 1) {
        dot(d[0]!, PREVIEW);
        if (at) line(o.polyline([d[0]!, at]), PREVIEW, '6 4');
      } else if (at) drawAngle(d[0]!, d[1]!, at, PREVIEW, angleAt(d[0]!, d[1]!, at));
      else {
        line(o.polyline(d), PREVIEW);
        for (const p of d) dot(p, PREVIEW);
      }
    }

    // What the pointer snaps to: a square on a corner, a diamond on an edge, a ring on a surface.
    if (this.tool && this.hover) {
      const s = o.project(this.hover.point);
      if (s) {
        const [x, y] = s;
        const k = this.hover.kind;
        if (k === 'vertex') out += `<rect x="${(x - 6).toFixed(1)}" y="${(y - 6).toFixed(1)}" width="12" height="12" fill="none" stroke="#000" stroke-width="3.5"/><rect x="${(x - 6).toFixed(1)}" y="${(y - 6).toFixed(1)}" width="12" height="12" fill="none" stroke="#40c057" stroke-width="2"/>`;
        else if (k === 'edge') out += `<path d="M${x} ${y - 7}L${x + 7} ${y}L${x} ${y + 7}L${x - 7} ${y}Z" fill="none" stroke="#000" stroke-width="3.5"/><path d="M${x} ${y - 7}L${x + 7} ${y}L${x} ${y + 7}L${x - 7} ${y}Z" fill="none" stroke="#22b8cf" stroke-width="2"/>`;
        else out += `<circle cx="${x}" cy="${y}" r="5" fill="none" stroke="#000" stroke-width="3.5"/><circle cx="${x}" cy="${y}" r="5" fill="none" stroke="${PREVIEW}" stroke-width="2"/>`;
      }
    }
    this.overlay.svg.innerHTML = out;
  }

  private listen(target: EventTarget, type: string, fn: (e: Event) => void): void {
    target.addEventListener(type, fn);
    this.offs.push(() => target.removeEventListener(type, fn));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const off of this.offs) off();
    this.offs.length = 0;
    this.host.canvas.style.cursor = '';
    this.overlay.dispose();
  }
}

function near(a: ScreenPoint, b: ScreenPoint): boolean {
  return Math.hypot(a[0] - b[0], a[1] - b[1]) < CLOSE_PX;
}

function centroid(points: THREE.Vector3[]): THREE.Vector3 {
  const c = new THREE.Vector3();
  for (const p of points) c.add(p);
  return c.divideScalar(Math.max(1, points.length));
}
