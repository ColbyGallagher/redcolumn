import * as THREE from 'three';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** A point on screen: CSS pixels from the view's top left. */
export type ScreenPoint = [number, number];

/**
 * An SVG layer over the 3D view for what is drawn on top of the model (measurements, the section
 * box's walls): crisp lines of any width, always in front, and redrawn from 3D points each frame so
 * it follows the camera. It takes no pointer events itself; elements that want them opt in.
 */
export class SvgOverlay {
  readonly svg: SVGSVGElement;
  private readonly container: HTMLElement;
  private readonly camera: () => THREE.Camera;
  private readonly view = new THREE.Vector3();
  private readonly ndc = new THREE.Vector3();

  constructor(container: HTMLElement, camera: () => THREE.Camera, className: string, zIndex: number) {
    this.container = container;
    this.camera = camera;
    this.svg = document.createElementNS(SVG_NS, 'svg');
    this.svg.setAttribute('class', className);
    this.svg.setAttribute('aria-hidden', 'true');
    Object.assign(this.svg.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
      overflow: 'visible',
      zIndex: String(zIndex),
    });
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
    container.appendChild(this.svg);
  }

  get width(): number {
    return this.container.clientWidth;
  }

  get height(): number {
    return this.container.clientHeight;
  }

  /** Where a world point shows on screen, or null when it is behind the camera. */
  project(p: THREE.Vector3): ScreenPoint | null {
    const cam = this.camera();
    cam.updateMatrixWorld();
    this.view.copy(p).applyMatrix4(cam.matrixWorldInverse);
    if (cam instanceof THREE.PerspectiveCamera && this.view.z > -cam.near) return null;
    return this.toScreen(this.view);
  }

  /** A segment's ends on screen, cut where it passes behind the camera (null when all of it is). */
  segment(a: THREE.Vector3, b: THREE.Vector3): [ScreenPoint, ScreenPoint] | null {
    const cam = this.camera();
    cam.updateMatrixWorld();
    const va = a.clone().applyMatrix4(cam.matrixWorldInverse);
    const vb = b.clone().applyMatrix4(cam.matrixWorldInverse);
    if (cam instanceof THREE.PerspectiveCamera) {
      const near = -cam.near * 1.01;
      if (va.z > near && vb.z > near) return null;
      if (va.z > near) va.lerp(vb, (va.z - near) / (va.z - vb.z));
      else if (vb.z > near) vb.lerp(va, (vb.z - near) / (vb.z - va.z));
    }
    return [this.toScreen(va), this.toScreen(vb)];
  }

  /** The points of a 3D polyline on screen, as an SVG points list (pieces behind the camera dropped). */
  polyline(points: THREE.Vector3[], closed = false): string[] {
    const runs: string[] = [];
    let run: ScreenPoint[] = [];
    const flush = () => {
      if (run.length > 1) runs.push(run.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' '));
      run = [];
    };
    const n = closed ? points.length : points.length - 1;
    for (let i = 0; i < n; i++) {
      const s = this.segment(points[i]!, points[(i + 1) % points.length]!);
      if (!s) {
        flush();
        continue;
      }
      const last = run[run.length - 1];
      if (!last || Math.hypot(last[0] - s[0][0], last[1] - s[0][1]) > 0.5) {
        flush();
        run.push(s[0]);
      }
      run.push(s[1]);
    }
    flush();
    return runs;
  }

  /** The ray from the camera through a point on screen (client coordinates). */
  ray(clientX: number, clientY: number): THREE.Ray | null {
    const rect = this.container.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const caster = new THREE.Raycaster();
    caster.setFromCamera(new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1), this.camera());
    return caster.ray;
  }

  /** A point in client coordinates, relative to the layer. */
  local(clientX: number, clientY: number): ScreenPoint {
    const rect = this.container.getBoundingClientRect();
    return [clientX - rect.left, clientY - rect.top];
  }

  private toScreen(view: THREE.Vector3): ScreenPoint {
    const cam = this.camera();
    this.ndc.copy(view).applyMatrix4(cam.projectionMatrix);
    return [((this.ndc.x + 1) / 2) * this.width, ((1 - this.ndc.y) / 2) * this.height];
  }

  dispose(): void {
    this.svg.remove();
  }
}

/** Text safe to put in SVG markup. */
export function esc(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/** A label with a dark halo, so it reads over any model. */
export function label([x, y]: ScreenPoint, text: string, colour = '#ffffff'): string {
  return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" dominant-baseline="central" font-size="12" font-weight="600" font-family="system-ui, sans-serif" fill="${colour}" stroke="rgba(0,0,0,0.85)" stroke-width="3.5" stroke-linejoin="round" paint-order="stroke">${esc(text)}</text>`;
}

export function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}
