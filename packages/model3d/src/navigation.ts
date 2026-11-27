import * as THREE from 'three';
import CameraControls from 'camera-controls';
import type * as OBC from '@thatopen/components';
import {
  DEFAULT_NAV_PREFS,
  matchesBinding,
  normalizeWheelNotches,
  parseBinding,
  zoomDistanceStep,
  type ModelNav,
  type ModelNavPrefs,
  type ModelProjection,
} from './controls.ts';

export interface NavHost {
  container: HTMLElement;
  world: OBC.SimpleWorld<OBC.SimpleScene, OBC.OrthoPerspectiveCamera, OBC.SimpleRenderer>;
  /** Nearest visible surface point under screen coordinates (clientX, clientY), or null. */
  raycastAt: (clientX: number, clientY: number) => Promise<THREE.Vector3 | null>;
  /** Bounding box of all visible models (may be empty). */
  modelBounds: () => THREE.Box3;
  /** True when the event is over an overlay (e.g. mini-map) that owns its own clicks. */
  isBlocked: (e: MouseEvent) => boolean;
  /** Called once a damped camera motion settles, so fragments refresh LOD. */
  onRest: () => void;
  /** A double-click of the middle button (Zoom Extents). */
  onDoubleMiddle?: () => void;
}

type DragKind = 'pan' | 'orbit';

interface ActiveDrag {
  kind: DragKind;
  pointerId: number;
  button: number;
  startX: number;
  startY: number;
  /** True once movement passes the drag threshold (immediate for middle/right, 4px for left). */
  committed: boolean;
  /** True once the initial raycast (if any) has resolved and start state is ready. */
  ready: boolean;
  startPos: THREE.Vector3;
  startTarget: THREE.Vector3;
  /** Orbit: pivot point in world space. */
  pivot: THREE.Vector3;
  /** Orbit: horizontal right axis of the camera at drag start (unit, horizontal). */
  orbitRight: THREE.Vector3;
  /** Orbit: initial pitch angle of the look direction (radians). */
  startPitch: number;
  /** Orbit: target and current smoothed yaw/pitch deltas (radians). */
  targetYaw: number;
  targetPitch: number;
  curYaw: number;
  curPitch: number;
  /** Pan: camera right and up unit vectors at drag start. */
  panRight: THREE.Vector3;
  panUp: THREE.Vector3;
  /** Pan: world units per CSS pixel at the grabbed surface depth. */
  worldPerPixel: number;
  /** Pan: target and current smoothed screen pixel deltas. */
  targetDx: number;
  targetDy: number;
  curDx: number;
  curDy: number;
}

interface WheelCache {
  clientX: number;
  clientY: number;
  point: THREE.Vector3 | null;
  time: number;
}

interface ZoomAnim {
  targetPos: THREE.Vector3;
  targetLook: THREE.Vector3;
  targetZoom: number | null;
}

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const DRAG_THRESHOLD_PX = 4;
const MIN_SURFACE_GAP = 0.02;
const PITCH_LIMIT = Math.PI / 2 - 0.02;
const WHEEL_CACHE_MS = 280;
const WHEEL_CACHE_PX = 5;
/** Two middle-button clicks this close in time (ms) and place (px), neither of them a drag, are a double-click. */
const DOUBLE_MIDDLE_MS = 350;
const DOUBLE_MIDDLE_PX = 5;

/**
 * Custom 3D navigation controller for Orbit and Plan modes:
 * - Modifier-aware mouse bindings for Pan (default Middle) and Orbit (default Shift + Middle).
 * - Distance-scaled zoom to cursor that slows as you approach a surface and never passes through it.
 * - Cursor-centered orbit around the surface point under the pointer, with an optional 3D pivot marker.
 * - 1:1 surface-depth panning and configurable exponential damping.
 */
export class NavigationController {
  private readonly host: NavHost;
  private prefs: ModelNavPrefs = { ...DEFAULT_NAV_PREFS };
  private navMode: ModelNav = 'Orbit';
  private projection: ModelProjection = 'Perspective';
  private drag: ActiveDrag | null = null;
  private dragGen = 0;
  private wheelCache: WheelCache | null = null;
  private wheelInFlight = false;
  private wheelPendingNotches = 0;
  private wheelPendingClientX = 0;
  private wheelPendingClientY = 0;
  private zoomAnim: ZoomAnim | null = null;
  private animFrame = 0;
  private lastAnimTime = 0;
  private suppressContextMenu = false;
  private suppressClick = false;
  private disposed = false;
  private pivotMarker: THREE.Group | null = null;
  /** The middle button's press being watched for a click (not a drag), and the last such click. */
  private middleDown: { pointerId: number; x: number; y: number; time: number; moved: boolean } | null = null;
  private middleClick: { x: number; y: number; time: number } | null = null;
  private readonly offs: (() => void)[] = [];

  constructor(host: NavHost) {
    this.host = host;
    const { container } = host;
    this.listen(container, 'pointerdown', (e) => this.onPointerDown(e as PointerEvent));
    this.listen(window, 'pointermove', (e) => this.onPointerMove(e as PointerEvent));
    this.listen(window, 'pointerup', (e) => this.onPointerUp(e as PointerEvent));
    this.listen(window, 'pointercancel', (e) => this.onPointerUp(e as PointerEvent));
    this.listen(container, 'wheel', (e) => this.onWheel(e as WheelEvent), { passive: false });
    this.listen(container, 'contextmenu', (e) => this.onContextMenu(e as MouseEvent));
    this.listen(
      container,
      'click',
      (e) => {
        if (this.suppressClick) {
          this.suppressClick = false;
          e.stopPropagation();
          e.preventDefault();
        }
      },
      { capture: true },
    );
    this.listen(container, 'mousedown', (e) => {
      // Prevent browser middle-click auto-scroll on the 3D canvas.
      if ((e as MouseEvent).button === 1 && !this.host.isBlocked(e as MouseEvent)) e.preventDefault();
    });
    this.syncCameraMode('Orbit', 'Perspective');
  }

  setPrefs(patch: Partial<ModelNavPrefs>): void {
    this.prefs = { ...this.prefs, ...patch };
    if (!this.prefs.showPivot) this.hidePivot();
    this.syncCameraMode(this.navMode, this.projection);
  }

  /**
   * Re-applies camera-controls configuration after That Open's mode or projection switch,
   * which overwrites `mouseButtons`, `minDistance`, and `maxDistance`.
   */
  syncCameraMode(mode: ModelNav, projection: ModelProjection): void {
    this.navMode = mode;
    this.projection = projection;
    this.cancelDrag();
    this.stopZoomAnim();
    const controls = this.host.world.camera.controls;
    if (mode === 'Orbit' || mode === 'Plan') {
      controls.mouseButtons.left = CameraControls.ACTION.NONE;
      controls.mouseButtons.middle = CameraControls.ACTION.NONE;
      controls.mouseButtons.right = CameraControls.ACTION.NONE;
      controls.mouseButtons.wheel = CameraControls.ACTION.NONE;
      controls.minDistance = 0.01;
      controls.maxDistance = Infinity;
      controls.minZoom = 0.001;
      controls.maxZoom = 10_000;
    } else {
      // FirstPerson / Walk: keep camera-controls native look & dolly.
      controls.mouseButtons.left = CameraControls.ACTION.ROTATE;
      controls.mouseButtons.right = CameraControls.ACTION.NONE;
      controls.mouseButtons.middle = CameraControls.ACTION.NONE;
      controls.mouseButtons.wheel = CameraControls.ACTION.DOLLY;
    }
  }

  private get active(): boolean {
    return !this.disposed && (this.navMode === 'Orbit' || this.navMode === 'Plan');
  }

  private matchDragKind(e: PointerEvent): DragKind | null {
    if (this.navMode === 'Plan') {
      if (matchesBinding(this.prefs.pan, e)) return 'pan';
      // In Plan mode, plain left-drag also pans if not overridden.
      if (e.button === 0 && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) return 'pan';
      return null;
    }
    // Check Orbit before Pan so if both share a binding, Orbit wins predictably.
    if (matchesBinding(this.prefs.orbit, e)) return 'orbit';
    if (matchesBinding(this.prefs.pan, e)) return 'pan';
    return null;
  }

  /**
   * Watches the middle button for a double-click: the second press of two quick clicks in the same
   * place (neither of them dragged) runs onDoubleMiddle instead of starting a pan.
   */
  private doubleMiddle(e: PointerEvent): boolean {
    if (e.button !== 1 || e.pointerType === 'touch' || this.disposed) return false;
    const now = performance.now();
    const last = this.middleClick;
    if (last && now - last.time <= DOUBLE_MIDDLE_MS && Math.hypot(e.clientX - last.x, e.clientY - last.y) < DOUBLE_MIDDLE_PX) {
      this.middleClick = null;
      this.middleDown = null;
      e.preventDefault();
      this.host.onDoubleMiddle?.();
      return true;
    }
    this.middleDown = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, time: now, moved: false };
    return false;
  }

  private onPointerDown(e: PointerEvent): void {
    if (this.host.isBlocked(e)) return;
    if (this.host.onDoubleMiddle && this.doubleMiddle(e)) return;
    if (!this.active || e.pointerType === 'touch') return;
    const kind = this.matchDragKind(e);
    if (!kind) return;

    this.stopZoomAnim();
    const controls = this.host.world.camera.controls;
    const startPos = controls.getPosition(new THREE.Vector3(), false);
    const startTarget = controls.getTarget(new THREE.Vector3(), false);
    // Freeze any in-progress camera-controls transition at the current pose.
    void controls.setLookAt(startPos.x, startPos.y, startPos.z, startTarget.x, startTarget.y, startTarget.z, false);

    const cam = this.host.world.camera.three;
    cam.updateMatrixWorld();
    const panRight = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0).normalize();
    const panUp = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1).normalize();
    const lookDir = startTarget.clone().sub(startPos);
    const lookLen = lookDir.length() || 1;
    lookDir.divideScalar(lookLen);
    const startPitch = Math.asin(Math.max(-1, Math.min(1, lookDir.y)));
    const orbitRight = new THREE.Vector3().crossVectors(lookDir, WORLD_UP);
    if (orbitRight.lengthSq() < 1e-6) orbitRight.copy(panRight).setY(0);
    if (orbitRight.lengthSq() < 1e-6) orbitRight.set(1, 0, 0);
    orbitRight.normalize();

    const committed = e.button !== 0;
    if (committed) {
      e.preventDefault();
      if (e.button === 2) this.suppressContextMenu = true;
      try {
        this.host.container.setPointerCapture(e.pointerId);
      } catch {
        // Synthetic events in tests may not have an active pointer id.
      }
    }

    const gen = ++this.dragGen;
    const defaultDepth = Math.max(0.5, lookLen);
    const drag: ActiveDrag = {
      kind,
      pointerId: e.pointerId,
      button: e.button,
      startX: e.clientX,
      startY: e.clientY,
      committed,
      ready: false,
      startPos,
      startTarget,
      pivot: startTarget.clone(),
      orbitRight,
      startPitch,
      targetYaw: 0,
      targetPitch: 0,
      curYaw: 0,
      curPitch: 0,
      panRight,
      panUp,
      worldPerPixel: this.computeWorldPerPixel(defaultDepth),
      targetDx: 0,
      targetDy: 0,
      curDx: 0,
      curDy: 0,
    };
    this.drag = drag;

    const needsHit = (kind === 'orbit' && this.prefs.orbitAtCursor) || (kind === 'pan' && cam instanceof THREE.PerspectiveCamera);
    if (!needsHit) {
      drag.ready = true;
      if (kind === 'orbit' && committed && this.prefs.showPivot) this.showPivot(drag.pivot);
      return;
    }

    void this.host.raycastAt(e.clientX, e.clientY).then((hit) => {
      if (this.disposed || this.drag !== drag || gen !== this.dragGen) return;
      if (kind === 'orbit') {
        drag.pivot = hit ?? this.fallbackPivot(startPos, startTarget);
        if (drag.committed && this.prefs.showPivot) this.showPivot(drag.pivot);
      } else if (kind === 'pan' && hit) {
        const depth = Math.max(0.05, hit.clone().sub(startPos).dot(lookDir));
        drag.worldPerPixel = this.computeWorldPerPixel(depth);
      }
      drag.ready = true;
      if (drag.committed && (drag.targetDx || drag.targetDy || drag.targetYaw || drag.targetPitch)) {
        this.applyOrAnimateDrag();
      }
    });
  }

  private onPointerMove(e: PointerEvent): void {
    const md = this.middleDown;
    if (md && e.pointerId === md.pointerId && Math.hypot(e.clientX - md.x, e.clientY - md.y) >= DOUBLE_MIDDLE_PX) md.moved = true;
    const drag = this.drag;
    if (!drag || e.pointerId !== drag.pointerId) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (!drag.committed) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      drag.committed = true;
      if (drag.button === 0) this.suppressClick = true;
      if (drag.button === 2) this.suppressContextMenu = true;
      try {
        this.host.container.setPointerCapture(e.pointerId);
      } catch {
        // Ignore if capture is unavailable.
      }
      if (drag.kind === 'orbit' && drag.ready && this.prefs.showPivot) this.showPivot(drag.pivot);
    }
    e.preventDefault();

    if (drag.kind === 'pan') {
      drag.targetDx = dx;
      drag.targetDy = dy;
    } else {
      const h = Math.max(200, this.host.container.clientHeight);
      // At default orbitSpeed = 5, dragging across the viewport height rotates ~270 deg.
      const radPerPx = ((Math.PI * 1.5) / h) * (this.prefs.orbitSpeed / 5);
      drag.targetYaw = -dx * radPerPx;
      const rawPitch = (this.prefs.invertOrbitY ? 1 : -1) * dy * radPerPx;
      drag.targetPitch = Math.max(-PITCH_LIMIT - drag.startPitch, Math.min(PITCH_LIMIT - drag.startPitch, rawPitch));
    }

    if (drag.ready) this.applyOrAnimateDrag();
  }

  private onPointerUp(e: PointerEvent): void {
    const md = this.middleDown;
    if (md && e.pointerId === md.pointerId && e.button === 1) {
      this.middleDown = null;
      const still = !md.moved && Math.hypot(e.clientX - md.x, e.clientY - md.y) < DOUBLE_MIDDLE_PX;
      this.middleClick = still ? { x: md.x, y: md.y, time: md.time } : null;
    }
    const drag = this.drag;
    if (!drag || e.pointerId !== drag.pointerId) return;
    try {
      if (this.host.container.hasPointerCapture(e.pointerId)) this.host.container.releasePointerCapture(e.pointerId);
    } catch {
      // Ignore.
    }
    if (drag.committed && drag.ready && this.prefs.smoothing > 0) {
      // Let remaining damped inertia finish smoothly, then clear drag in tick().
      const finish = drag;
      this.hidePivot();
      // Mark pointerId as -1 so no further pointermove updates it, while animation finishes.
      finish.pointerId = -1;
      this.ensureAnimLoop();
      return;
    }
    this.hidePivot();
    this.drag = null;
    if (drag.committed) this.host.onRest();
  }

  private onContextMenu(e: MouseEvent): void {
    if (!this.active) return;
    if (this.suppressContextMenu || parseBinding(this.prefs.pan).button === 2 || parseBinding(this.prefs.orbit).button === 2) {
      e.preventDefault();
      this.suppressContextMenu = false;
    }
  }

  private onWheel(e: WheelEvent): void {
    if (!this.active || this.host.isBlocked(e)) return;
    e.preventDefault();
    const rawNotches = normalizeWheelNotches(e.deltaY, e.deltaMode);
    if (!rawNotches) return;
    const notches = this.prefs.invertZoom ? -rawNotches : rawNotches;

    const cam = this.host.world.camera.three;
    if (cam instanceof THREE.OrthographicCamera) {
      this.applyOrthoZoom(notches, e.clientX, e.clientY);
      return;
    }

    if (!this.prefs.zoomToCursor) {
      this.applyPerspectiveZoom(notches, null, e.clientX, e.clientY);
      return;
    }

    const now = performance.now();
    const cache = this.wheelCache;
    if (cache && now - cache.time < WHEEL_CACHE_MS && Math.hypot(e.clientX - cache.clientX, e.clientY - cache.clientY) < WHEEL_CACHE_PX) {
      cache.time = now;
      this.applyPerspectiveZoom(notches, cache.point, e.clientX, e.clientY);
      return;
    }

    // Coalesce rapid wheel ticks while a single raycast is in flight.
    this.wheelPendingNotches += notches;
    this.wheelPendingClientX = e.clientX;
    this.wheelPendingClientY = e.clientY;
    if (this.wheelInFlight) return;
    this.wheelInFlight = true;
    const cx = e.clientX;
    const cy = e.clientY;
    void this.host.raycastAt(cx, cy).then((hit) => {
      this.wheelInFlight = false;
      if (this.disposed || !this.active) {
        this.wheelPendingNotches = 0;
        return;
      }
      this.wheelCache = { clientX: cx, clientY: cy, point: hit, time: performance.now() };
      const pending = this.wheelPendingNotches;
      this.wheelPendingNotches = 0;
      if (pending) this.applyPerspectiveZoom(pending, hit, this.wheelPendingClientX, this.wheelPendingClientY);
    });
  }

  private applyPerspectiveZoom(notches: number, hit: THREE.Vector3 | null, clientX: number, clientY: number): void {
    const controls = this.host.world.camera.controls;
    const cam = this.host.world.camera.three;
    const pos = this.zoomAnim ? this.zoomAnim.targetPos.clone() : controls.getPosition(new THREE.Vector3(), false);
    const target = this.zoomAnim ? this.zoomAnim.targetLook.clone() : controls.getTarget(new THREE.Vector3(), false);

    const bounds = this.host.modelBounds();
    const diag = bounds.isEmpty() ? 100 : Math.max(10, bounds.min.distanceTo(bounds.max));
    const maxDist = Math.max(5000, diag * 20);
    const minGap = Math.max(MIN_SURFACE_GAP, (cam instanceof THREE.PerspectiveCamera ? cam.near : 0.01) * 1.5);

    let dir: THREE.Vector3;
    let dist: number;
    if (hit && this.prefs.zoomToCursor) {
      dir = hit.clone().sub(pos);
      dist = dir.length();
      if (dist < 1e-6) return;
      dir.divideScalar(dist);
    } else if (this.prefs.zoomToCursor) {
      // Empty space under cursor: zoom along the cursor ray using distance to the target plane.
      dir = this.cursorRayDirection(clientX, clientY, pos);
      const look = target.clone().sub(pos);
      const lookLen = Math.max(0.5, look.length());
      const cos = Math.max(0.25, dir.dot(look.clone().normalize()));
      dist = lookLen / cos;
    } else {
      dir = target.clone().sub(pos);
      dist = Math.max(minGap, dir.length());
      dir.normalize();
    }

    const travel = zoomDistanceStep(dist, notches, this.prefs.zoomSpeed, minGap, maxDist);
    if (Math.abs(travel) < 1e-7) return;

    const delta = dir.multiplyScalar(travel);
    const nextPos = pos.clone().add(delta);
    const nextTarget = target.clone().add(delta);

    if (this.prefs.smoothing <= 0) {
      this.stopZoomAnim();
      void controls.setLookAt(nextPos.x, nextPos.y, nextPos.z, nextTarget.x, nextTarget.y, nextTarget.z, false);
      this.host.onRest();
    } else {
      this.zoomAnim = { targetPos: nextPos, targetLook: nextTarget, targetZoom: null };
      this.ensureAnimLoop();
    }
  }

  private applyOrthoZoom(notches: number, clientX: number, clientY: number): void {
    const controls = this.host.world.camera.controls;
    const cam = this.host.world.camera.three;
    if (!(cam instanceof THREE.OrthographicCamera)) return;

    const pos = this.zoomAnim ? this.zoomAnim.targetPos.clone() : controls.getPosition(new THREE.Vector3(), false);
    const target = this.zoomAnim ? this.zoomAnim.targetLook.clone() : controls.getTarget(new THREE.Vector3(), false);
    const curZoom = this.zoomAnim?.targetZoom ?? cam.zoom;

    const fraction = Math.max(1, Math.min(10, this.prefs.zoomSpeed)) * 0.04;
    const scale = Math.pow(1 / (1 - fraction), notches);
    const nextZoom = Math.max(controls.minZoom, Math.min(controls.maxZoom, curZoom * scale));
    const ratio = nextZoom / curZoom;
    if (Math.abs(ratio - 1) < 1e-6) return;

    const nextPos = pos.clone();
    const nextTarget = target.clone();
    if (this.prefs.zoomToCursor) {
      const rect = this.host.container.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
        const ndcY = -(((clientY - rect.top) / rect.height) * 2 - 1);
        const wx = (ndcX * ((cam.right - cam.left) / 2)) / curZoom;
        const wy = (ndcY * ((cam.top - cam.bottom) / 2)) / curZoom;
        cam.updateMatrixWorld();
        const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0).normalize();
        const up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1).normalize();
        const shift = right.multiplyScalar(wx * (1 - 1 / ratio)).add(up.multiplyScalar(wy * (1 - 1 / ratio)));
        nextPos.add(shift);
        nextTarget.add(shift);
      }
    }

    if (this.prefs.smoothing <= 0) {
      this.stopZoomAnim();
      void controls.zoomTo(nextZoom, false);
      void controls.setLookAt(nextPos.x, nextPos.y, nextPos.z, nextTarget.x, nextTarget.y, nextTarget.z, false);
      this.host.onRest();
    } else {
      this.zoomAnim = { targetPos: nextPos, targetLook: nextTarget, targetZoom: nextZoom };
      this.ensureAnimLoop();
    }
  }

  private applyOrAnimateDrag(): void {
    const drag = this.drag;
    if (!drag) return;
    if (this.prefs.smoothing <= 0) {
      drag.curDx = drag.targetDx;
      drag.curDy = drag.targetDy;
      drag.curYaw = drag.targetYaw;
      drag.curPitch = drag.targetPitch;
      this.commitDragPose(drag);
    } else {
      this.ensureAnimLoop();
    }
  }

  private commitDragPose(drag: ActiveDrag): void {
    const controls = this.host.world.camera.controls;
    if (drag.kind === 'pan') {
      const delta = drag.panRight
        .clone()
        .multiplyScalar(-drag.curDx * drag.worldPerPixel)
        .addScaledVector(drag.panUp, drag.curDy * drag.worldPerPixel);
      const p = drag.startPos.clone().add(delta);
      const t = drag.startTarget.clone().add(delta);
      void controls.setLookAt(p.x, p.y, p.z, t.x, t.y, t.z, false);
      return;
    }

    const qPitch = new THREE.Quaternion().setFromAxisAngle(drag.orbitRight, drag.curPitch);
    const qYaw = new THREE.Quaternion().setFromAxisAngle(WORLD_UP, drag.curYaw);
    const q = qYaw.multiply(qPitch);
    const p = drag.startPos.clone().sub(drag.pivot).applyQuaternion(q).add(drag.pivot);
    const t = drag.startTarget.clone().sub(drag.pivot).applyQuaternion(q).add(drag.pivot);
    void controls.setLookAt(p.x, p.y, p.z, t.x, t.y, t.z, false);
    if (this.pivotMarker?.visible) this.scalePivot(p);
  }

  private ensureAnimLoop(): void {
    if (this.animFrame) return;
    this.lastAnimTime = performance.now();
    this.animFrame = requestAnimationFrame(this.tick);
  }

  private readonly tick = (now: number): void => {
    this.animFrame = 0;
    if (this.disposed) return;
    const dt = Math.min(0.1, Math.max(0.001, (now - this.lastAnimTime) / 1000));
    this.lastAnimTime = now;
    // smoothing 1..10 -> time constant 0.025s .. 0.25s (snappy at 1-3, silky at 6-10).
    const tau = Math.max(0.015, this.prefs.smoothing * 0.025);
    const alpha = 1 - Math.exp(-dt / tau);
    let more = false;

    const drag = this.drag;
    if (drag && drag.committed && drag.ready) {
      if (drag.kind === 'pan') {
        drag.curDx += (drag.targetDx - drag.curDx) * alpha;
        drag.curDy += (drag.targetDy - drag.curDy) * alpha;
        const settled = Math.hypot(drag.targetDx - drag.curDx, drag.targetDy - drag.curDy) < 0.05;
        if (settled) {
          drag.curDx = drag.targetDx;
          drag.curDy = drag.targetDy;
        }
        this.commitDragPose(drag);
        if (!settled || drag.pointerId !== -1) more = true;
        else {
          this.drag = null;
          this.host.onRest();
        }
      } else {
        drag.curYaw += (drag.targetYaw - drag.curYaw) * alpha;
        drag.curPitch += (drag.targetPitch - drag.curPitch) * alpha;
        const settled = Math.abs(drag.targetYaw - drag.curYaw) < 1e-4 && Math.abs(drag.targetPitch - drag.curPitch) < 1e-4;
        if (settled) {
          drag.curYaw = drag.targetYaw;
          drag.curPitch = drag.targetPitch;
        }
        this.commitDragPose(drag);
        if (!settled || drag.pointerId !== -1) more = true;
        else {
          this.drag = null;
          this.host.onRest();
        }
      }
    }

    const anim = this.zoomAnim;
    if (anim) {
      const controls = this.host.world.camera.controls;
      const curPos = controls.getPosition(new THREE.Vector3(), false);
      const curLook = controls.getTarget(new THREE.Vector3(), false);
      curPos.lerp(anim.targetPos, alpha);
      curLook.lerp(anim.targetLook, alpha);
      const posDist = curPos.distanceTo(anim.targetPos);
      const scaleEps = Math.max(1e-4, curPos.distanceTo(curLook) * 1e-4);
      let zoomDone = true;
      if (anim.targetZoom !== null && this.host.world.camera.three instanceof THREE.OrthographicCamera) {
        const curZ = this.host.world.camera.three.zoom;
        const nextZ = curZ + (anim.targetZoom - curZ) * alpha;
        zoomDone = Math.abs(anim.targetZoom - nextZ) / Math.max(1e-6, anim.targetZoom) < 1e-3;
        void controls.zoomTo(zoomDone ? anim.targetZoom : nextZ, false);
      }
      if (posDist < scaleEps && zoomDone) {
        void controls.setLookAt(anim.targetPos.x, anim.targetPos.y, anim.targetPos.z, anim.targetLook.x, anim.targetLook.y, anim.targetLook.z, false);
        this.zoomAnim = null;
        this.host.onRest();
      } else {
        void controls.setLookAt(curPos.x, curPos.y, curPos.z, curLook.x, curLook.y, curLook.z, false);
        more = true;
      }
    }

    if (more) this.animFrame = requestAnimationFrame(this.tick);
  };

  private computeWorldPerPixel(depth: number): number {
    const cam = this.host.world.camera.three;
    const h = Math.max(1, this.host.container.clientHeight);
    const speedScale = this.prefs.panSpeed / 5;
    if (cam instanceof THREE.OrthographicCamera) {
      return ((cam.top - cam.bottom) / cam.zoom / h) * speedScale;
    }
    const fovRad = THREE.MathUtils.degToRad(cam.fov);
    return ((2 * depth * Math.tan(fovRad / 2)) / h) * speedScale;
  }

  private cursorRayDirection(clientX: number, clientY: number, camPos: THREE.Vector3): THREE.Vector3 {
    const rect = this.host.container.getBoundingClientRect();
    const ndcX = rect.width ? ((clientX - rect.left) / rect.width) * 2 - 1 : 0;
    const ndcY = rect.height ? -(((clientY - rect.top) / rect.height) * 2 - 1) : 0;
    const p = new THREE.Vector3(ndcX, ndcY, 0.5).unproject(this.host.world.camera.three);
    return p.sub(camPos).normalize();
  }

  private fallbackPivot(camPos: THREE.Vector3, curTarget: THREE.Vector3): THREE.Vector3 {
    const bounds = this.host.modelBounds();
    if (!bounds.isEmpty()) {
      const centre = bounds.getCenter(new THREE.Vector3());
      const look = curTarget.clone().sub(camPos).normalize();
      // If the current target is behind the camera, use the model's centre instead.
      if (curTarget.clone().sub(camPos).dot(look) <= 0) return centre;
    }
    return curTarget.clone();
  }

  private showPivot(point: THREE.Vector3): void {
    if (!this.pivotMarker) {
      const group = new THREE.Group();
      const ringGeo = new THREE.RingGeometry(0.7, 1, 24);
      const ringMat = new THREE.MeshBasicMaterial({ color: '#2f9bff', side: THREE.DoubleSide, depthTest: false, transparent: true, opacity: 0.9 });
      const dotGeo = new THREE.SphereGeometry(0.28, 12, 12);
      const dotMat = new THREE.MeshBasicMaterial({ color: '#ffffff', depthTest: false, transparent: true, opacity: 0.95 });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      const dot = new THREE.Mesh(dotGeo, dotMat);
      ring.renderOrder = 998;
      dot.renderOrder = 999;
      group.add(ring, dot);
      this.host.world.scene.three.add(group);
      this.pivotMarker = group;
    }
    this.pivotMarker.position.copy(point);
    this.pivotMarker.visible = true;
    const camPos = this.host.world.camera.controls.getPosition(new THREE.Vector3(), false);
    this.scalePivot(camPos);
  }

  private scalePivot(camPos: THREE.Vector3): void {
    const marker = this.pivotMarker;
    if (!marker) return;
    const cam = this.host.world.camera.three;
    const h = Math.max(1, this.host.container.clientHeight);
    let worldPerPx: number;
    if (cam instanceof THREE.OrthographicCamera) {
      worldPerPx = (cam.top - cam.bottom) / cam.zoom / h;
    } else {
      const d = Math.max(0.05, camPos.distanceTo(marker.position));
      worldPerPx = (2 * d * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2)) / h;
    }
    marker.scale.setScalar(worldPerPx * 8);
    marker.quaternion.copy(cam.quaternion);
  }

  private hidePivot(): void {
    if (this.pivotMarker) this.pivotMarker.visible = false;
  }

  private cancelDrag(): void {
    this.dragGen++;
    this.drag = null;
    this.hidePivot();
  }

  private stopZoomAnim(): void {
    this.zoomAnim = null;
    this.wheelPendingNotches = 0;
  }

  private listen(target: EventTarget, type: string, fn: (e: Event) => void, options?: AddEventListenerOptions): void {
    target.addEventListener(type, fn, options);
    this.offs.push(() => target.removeEventListener(type, fn, options));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.animFrame);
    this.animFrame = 0;
    this.cancelDrag();
    this.stopZoomAnim();
    for (const off of this.offs) off();
    this.offs.length = 0;
    if (this.pivotMarker) {
      this.pivotMarker.removeFromParent();
      this.pivotMarker.traverse((o) => {
        const mesh = o as THREE.Mesh;
        mesh.geometry?.dispose();
        const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
        for (const m of mats) m.dispose();
      });
      this.pivotMarker = null;
    }
  }
}
