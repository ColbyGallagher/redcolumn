/**
 * What the 3D view can be asked to do and what it reports back: plain data with no three.js, so the
 * app's ribbon and commands can use it (as types) without loading the viewer.
 */

export type ModelNav = 'Orbit' | 'FirstPerson' | 'Plan';
export type ModelProjection = 'Perspective' | 'Orthographic';
/** What a click in the view does: pick an element, place a clipping plane, or measure. */
export type ModelTool = 'select' | 'clip' | 'length' | 'area' | 'angle' | 'volume';
export type ViewDirection = 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right' | 'iso';

export interface ModelViewEntry {
  id: string;
  label: string;
  kind: 'storey' | 'elevation';
}

export interface ModelState {
  nav: ModelNav;
  projection: ModelProjection;
  tool: ModelTool;
  grid: boolean;
  /** Hidden and isolated-away elements show faintly instead of disappearing. */
  ghost: boolean;
  sectionBox: boolean;
  clipPlanes: number;
  /** Elements selected. */
  selected: number;
  /** Elements hidden (Hide, or everything else after Isolate). */
  hidden: boolean;
  measurements: number;
  /** Storey plans and elevations made from the models. */
  views: ModelViewEntry[];
  openView: string | null;
}

export const INITIAL_STATE: ModelState = {
  nav: 'Orbit',
  projection: 'Perspective',
  tool: 'select',
  grid: false,
  ghost: false,
  sectionBox: false,
  clipPlanes: 0,
  selected: 0,
  hidden: false,
  measurements: 0,
  views: [],
  openView: null,
};

export type ModelAction =
  | { type: 'nav'; mode: ModelNav }
  | { type: 'projection'; projection: ModelProjection }
  | { type: 'fitAll' }
  | { type: 'fitSelection' }
  | { type: 'direction'; direction: ViewDirection }
  | { type: 'tool'; tool: ModelTool }
  | { type: 'grid' }
  | { type: 'ghost' }
  | { type: 'sectionBox' }
  | { type: 'clearClips' }
  | { type: 'isolate' }
  | { type: 'hide' }
  | { type: 'showAll' }
  | { type: 'clearSelection' }
  | { type: 'openView'; id: string | null }
  | { type: 'clearMeasurements' };

/** What the ribbon and commands can reach while a model is in front. */
export interface ModelControls {
  state(): ModelState;
  run(action: ModelAction): void;
  /** Which way the camera looks, for the view cube: yaw about up (radians, 0 = looking north) and pitch (0 level, -π/2 straight down). */
  orientation(): { yaw: number; pitch: number };
}

type Vec3 = [number, number, number];

/**
 * Where the camera goes, relative to the target, to look from a direction, at `distance`.
 * The scene is Y-up (three.js); north is -Z.
 */
export function directionOffset(direction: ViewDirection, distance: number): Vec3 {
  const d = distance;
  switch (direction) {
    case 'top':
      // A hair off vertical, so the camera keeps a north-up heading.
      return [0, d, d * 1e-4];
    case 'bottom':
      return [0, -d, d * 1e-4];
    case 'front':
      return [0, 0, d];
    case 'back':
      return [0, 0, -d];
    case 'left':
      return [-d, 0, 0];
    case 'right':
      return [d, 0, 0];
    case 'iso': {
      const k = d / Math.sqrt(3);
      return [k, k, k];
    }
  }
}

/**
 * The six clipping planes of a section box around [min, max]: each as an inward-facing normal and a
 * point on it (three.js clips what is on the negative side of a plane, so normals point inside).
 */
export function boxPlanes(min: Vec3, max: Vec3): { normal: Vec3; point: Vec3 }[] {
  return [
    { normal: [1, 0, 0], point: [min[0], 0, 0] },
    { normal: [-1, 0, 0], point: [max[0], 0, 0] },
    { normal: [0, 1, 0], point: [0, min[1], 0] },
    { normal: [0, -1, 0], point: [0, max[1], 0] },
    { normal: [0, 0, 1], point: [0, 0, min[2]] },
    { normal: [0, 0, -1], point: [0, 0, max[2]] },
  ];
}

/** A box grown by `margin` of its largest side on every face, so the section box starts just outside what it frames. */
export function padBox(min: Vec3, max: Vec3, margin = 0.05): [Vec3, Vec3] {
  const pad = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2], 1e-6) * margin;
  return [
    [min[0] - pad, min[1] - pad, min[2] - pad],
    [max[0] + pad, max[1] + pad, max[2] + pad],
  ];
}

/** The camera's yaw and pitch from the direction it looks (Y-up, north -Z). */
export function orientationOf(dir: Vec3): { yaw: number; pitch: number } {
  const [x, y, z] = dir;
  const len = Math.hypot(x, y, z) || 1;
  return { yaw: Math.atan2(x, -z), pitch: Math.asin(Math.max(-1, Math.min(1, y / len))) };
}
