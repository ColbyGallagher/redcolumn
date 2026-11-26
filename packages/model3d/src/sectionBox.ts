import * as THREE from 'three';
import { svgEl, SvgOverlay } from './overlay.ts';

type Vec3 = [number, number, number];

export interface SectionBoxHost {
  container: HTMLElement;
  camera: () => THREE.Camera;
  /** Puts a clipping plane on the renderer or takes it off. */
  setPlane: (active: boolean, plane: THREE.Plane) => void;
  /** The box moved (a wall was dragged): its new corners. */
  onChange: (corners: [Vec3, Vec3]) => void;
  /** A wall drag started or ended (the camera should stay still meanwhile). */
  onDrag?: (dragging: boolean) => void;
}

/** A wall of the box: the axis it is across (0 x, 1 y, 2 z) and whether it is the low or high side. */
interface Wall {
  axis: 0 | 1 | 2;
  side: 0 | 1;
  plane: THREE.Plane;
  handle: SVGGElement;
  face: SVGPolygonElement;
}

interface Drag {
  wall: Wall;
  pointerId: number;
  /** Where along the wall's axis the pointer started, and the wall then. */
  start: number;
  startValue: number;
}

const ACCENT = '#2f9bff';
const HOT = '#ffd43b';
/** The box never gets thinner than this (metres) when a wall is dragged in. */
const MIN_SIZE = 0.01;

/**
 * The section box: six clipping planes around a box, drawn as its edges with a handle in the
 * middle of each wall. Dragging a handle moves that wall in or out along its own axis only,
 * clipping as it goes; the camera stays put while a wall is dragged.
 */
export class SectionBoxController {
  private readonly host: SectionBoxHost;
  private readonly overlay: SvgOverlay;
  private readonly edges: SVGPathElement;
  private readonly edgesHalo: SVGPathElement;
  private readonly walls: Wall[] = [];
  private box: [Vec3, Vec3] | null = null;
  private drag: Drag | null = null;
  private hot: Wall | null = null;
  private readonly offs: (() => void)[] = [];
  private disposed = false;

  constructor(host: SectionBoxHost) {
    this.host = host;
    this.overlay = new SvgOverlay(host.container, host.camera, 'm3d-section-layer', 4);
    this.overlay.svg.style.display = 'none';
    const faces = svgEl('g');
    this.edgesHalo = svgEl('path', { fill: 'none', stroke: 'rgba(0,0,0,0.45)', 'stroke-width': 3 });
    this.edges = svgEl('path', { fill: 'none', stroke: ACCENT, 'stroke-width': 1.5, 'stroke-dasharray': '6 4' });
    const handles = svgEl('g');
    this.overlay.svg.append(faces, this.edgesHalo, this.edges, handles);
    for (const axis of [0, 1, 2] as const) {
      for (const side of [0, 1] as const) {
        const face = svgEl('polygon', { fill: HOT, 'fill-opacity': 0, stroke: 'none' });
        const handle = svgEl('g', { cursor: axis === 1 ? 'ns-resize' : 'move' });
        handle.style.pointerEvents = 'auto';
        handle.append(
          // A larger clear circle to grab, then the handle drawn in it.
          svgEl('circle', { r: 13, fill: 'transparent' }),
          svgEl('circle', { r: 7, fill: ACCENT, stroke: '#ffffff', 'stroke-width': 2 }),
        );
        const title = svgEl('title');
        title.textContent = 'Drag to move this wall of the section box';
        handle.append(title);
        faces.append(face);
        handles.append(handle);
        const wall: Wall = { axis, side, plane: new THREE.Plane(), handle, face };
        this.walls.push(wall);
        this.listen(handle, 'pointerdown', (e) => this.onDown(wall, e as PointerEvent));
        this.listen(handle, 'pointerenter', () => this.setHot(wall));
        this.listen(handle, 'pointerleave', () => {
          if (!this.drag) this.setHot(null);
        });
        // Clicks on a handle stay out of selecting and measuring.
        for (const type of ['click', 'dblclick', 'mousedown', 'contextmenu']) this.listen(handle, type, (e) => e.stopPropagation());
      }
    }
    this.listen(window, 'pointermove', (e) => this.onMove(e as PointerEvent));
    this.listen(window, 'pointerup', (e) => this.onUp(e as PointerEvent));
    this.listen(window, 'pointercancel', (e) => this.onUp(e as PointerEvent));
  }

  get active(): boolean {
    return !!this.box;
  }

  /** The box's corners, while there is one. */
  corners(): [Vec3, Vec3] | null {
    return this.box ? [[...this.box[0]], [...this.box[1]]] : null;
  }

  /** Puts the box around [min, max] (replacing one already there). */
  set(min: Vec3, max: Vec3): void {
    const lo: Vec3 = [Math.min(min[0], max[0]), Math.min(min[1], max[1]), Math.min(min[2], max[2])];
    const hi: Vec3 = [Math.max(min[0], max[0]), Math.max(min[1], max[1]), Math.max(min[2], max[2])];
    const had = !!this.box;
    this.box = [lo, hi];
    this.updatePlanes();
    if (!had) for (const w of this.walls) this.host.setPlane(true, w.plane);
    this.overlay.svg.style.display = '';
  }

  clear(): void {
    if (this.drag) this.endDrag();
    if (this.box) for (const w of this.walls) this.host.setPlane(false, w.plane);
    this.box = null;
    this.setHot(null);
    this.overlay.svg.style.display = 'none';
  }

  /** Each plane keeps what is inside the box: three.js clips the negative side, so normals point in. */
  private updatePlanes(): void {
    const box = this.box;
    if (!box) return;
    for (const w of this.walls) {
      const normal = new THREE.Vector3();
      normal.setComponent(w.axis, w.side === 0 ? 1 : -1);
      const value = box[w.side][w.axis];
      // n·p + c = 0 on the wall: c = -n·p.
      w.plane.set(normal, w.side === 0 ? -value : value);
    }
  }

  private setHot(wall: Wall | null): void {
    if (this.hot === wall) return;
    this.hot = wall;
    this.draw();
  }

  private axisVector(axis: number): THREE.Vector3 {
    return new THREE.Vector3().setComponent(axis, 1);
  }

  /** Where along a wall's axis (a world coordinate) the pointer's ray passes closest, or null when the ray runs along it. */
  private along(wall: Wall, clientX: number, clientY: number): number | null {
    const box = this.box;
    const ray = this.overlay.ray(clientX, clientY);
    if (!box || !ray) return null;
    const a = this.axisVector(wall.axis);
    const c = this.wallCentre(wall);
    const d = ray.direction;
    const b = a.dot(d);
    const denom = 1 - b * b;
    // Looking straight along the axis, the pointer cannot say how far the wall should go.
    if (denom < 1e-4) return null;
    const w = c.clone().sub(ray.origin);
    const s = (b * d.dot(w) - a.dot(w)) / denom;
    return c.getComponent(wall.axis) + s;
  }

  private wallCentre(wall: Wall): THREE.Vector3 {
    const [lo, hi] = this.box!;
    const c = new THREE.Vector3((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2);
    c.setComponent(wall.axis, this.box![wall.side][wall.axis]);
    return c;
  }

  private onDown(wall: Wall, e: PointerEvent): void {
    if (!this.box || e.button !== 0) return;
    // The camera's controls and selecting never see this press.
    e.stopPropagation();
    e.preventDefault();
    const start = this.along(wall, e.clientX, e.clientY);
    if (start === null) return;
    try {
      wall.handle.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic events may have no active pointer.
    }
    this.drag = { wall, pointerId: e.pointerId, start, startValue: this.box[wall.side][wall.axis] };
    this.setHot(wall);
    this.host.onDrag?.(true);
  }

  private onMove(e: PointerEvent): void {
    const drag = this.drag;
    const box = this.box;
    if (!drag || !box || e.pointerId !== drag.pointerId) return;
    e.preventDefault();
    e.stopPropagation();
    const at = this.along(drag.wall, e.clientX, e.clientY);
    if (at === null) return;
    const { axis, side } = drag.wall;
    let value = drag.startValue + (at - drag.start);
    // A wall stops short of the one across from it.
    if (side === 0) value = Math.min(value, box[1][axis] - MIN_SIZE);
    else value = Math.max(value, box[0][axis] + MIN_SIZE);
    if (value === box[side][axis]) return;
    box[side][axis] = value;
    this.updatePlanes();
    this.host.onChange(this.corners()!);
    this.draw();
  }

  private onUp(e: PointerEvent): void {
    if (!this.drag || e.pointerId !== this.drag.pointerId) return;
    e.stopPropagation();
    this.endDrag();
  }

  private endDrag(): void {
    const drag = this.drag;
    if (!drag) return;
    try {
      if (drag.wall.handle.hasPointerCapture(drag.pointerId)) drag.wall.handle.releasePointerCapture(drag.pointerId);
    } catch {
      // Ignore.
    }
    this.drag = null;
    this.setHot(null);
    this.host.onDrag?.(false);
  }

  /** Draws the box over the frame just rendered (called after every frame). */
  draw(): void {
    const box = this.box;
    if (this.disposed || !box) return;
    const [lo, hi] = box;
    const corner = (x: number, y: number, z: number) => new THREE.Vector3(x ? hi[0] : lo[0], y ? hi[1] : lo[1], z ? hi[2] : lo[2]);
    const o = this.overlay;
    let d = '';
    for (const [x, y, z] of [
      [0, 0, 0],
      [1, 1, 0],
      [1, 0, 1],
      [0, 1, 1],
    ] as const) {
      for (const [a, b] of [
        [corner(x, y, z), corner(1 - x, y, z)],
        [corner(x, y, z), corner(x, 1 - y, z)],
        [corner(x, y, z), corner(x, y, 1 - z)],
      ] as const) {
        const s = o.segment(a, b);
        if (s) d += `M${s[0][0].toFixed(1)} ${s[0][1].toFixed(1)}L${s[1][0].toFixed(1)} ${s[1][1].toFixed(1)}`;
      }
    }
    this.edges.setAttribute('d', d);
    this.edgesHalo.setAttribute('d', d);

    const cam = this.host.camera();
    const camPos = cam.getWorldPosition(new THREE.Vector3());
    const camDir = cam.getWorldDirection(new THREE.Vector3());
    for (const w of this.walls) {
      const c = this.wallCentre(w);
      const s = o.project(c);
      const lit = this.hot === w;
      // A wall facing away from the camera (seen from inside the box) still has its handle, fainter.
      const outward = this.axisVector(w.axis).multiplyScalar(w.side === 0 ? -1 : 1);
      const toCam = cam instanceof THREE.OrthographicCamera ? camDir.clone().negate() : camPos.clone().sub(c);
      const facing = outward.dot(toCam) > 0;
      if (!s) {
        w.handle.style.display = 'none';
        w.face.setAttribute('points', '');
        continue;
      }
      w.handle.style.display = '';
      w.handle.setAttribute('transform', `translate(${s[0].toFixed(1)} ${s[1].toFixed(1)})`);
      const dotEl = w.handle.children[1] as SVGCircleElement;
      dotEl.setAttribute('fill', lit ? HOT : ACCENT);
      dotEl.setAttribute('r', lit ? '8.5' : '7');
      w.handle.style.opacity = facing || lit ? '1' : '0.55';
      // The wall itself lights up under a hovered or dragged handle.
      if (lit) {
        const v = w.side;
        const pts =
          w.axis === 0
            ? [corner(v, 0, 0), corner(v, 1, 0), corner(v, 1, 1), corner(v, 0, 1)]
            : w.axis === 1
              ? [corner(0, v, 0), corner(1, v, 0), corner(1, v, 1), corner(0, v, 1)]
              : [corner(0, 0, v), corner(1, 0, v), corner(1, 1, v), corner(0, 1, v)];
        const sp = pts.map((p) => o.project(p));
        if (sp.every(Boolean)) {
          w.face.setAttribute('points', sp.map((p) => `${p![0].toFixed(1)},${p![1].toFixed(1)}`).join(' '));
          w.face.setAttribute('fill-opacity', '0.22');
        } else w.face.setAttribute('points', '');
      } else {
        w.face.setAttribute('points', '');
      }
    }
  }

  private listen(target: EventTarget, type: string, fn: (e: Event) => void): void {
    target.addEventListener(type, fn);
    this.offs.push(() => target.removeEventListener(type, fn));
  }

  dispose(): void {
    if (this.disposed) return;
    this.clear();
    this.disposed = true;
    for (const off of this.offs) off();
    this.offs.length = 0;
    this.overlay.dispose();
  }
}
