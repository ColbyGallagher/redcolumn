/**
 * What the 3D view can be asked to do and what it reports back: plain data with no three.js, so the
 * app's ribbon and commands can use it (as types) without loading the viewer.
 */

/** Walk: first person at eye height over the floor, kept out of walls (W A S D or the arrow keys). */
export type ModelNav = 'Orbit' | 'FirstPerson' | 'Plan' | 'Walk';
export type ModelProjection = 'Perspective' | 'Orthographic';
/** What a click in the view does: pick an element, place a clipping plane, or measure. */
export type ModelTool = 'select' | 'clip' | 'length' | 'area' | 'angle' | 'volume';
/** A corner of the view cube: above or below, and which way across the map (north is -Z, east +X). */
export type CornerDirection = `${'top' | 'bottom'}-${'ne' | 'nw' | 'se' | 'sw'}`;
/** 'iso' is the top south-east corner. */
export type ViewDirection = 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right' | 'iso' | CornerDirection;

/** The eight cube corners, with their names, in the order menus list them. */
export const CORNER_DIRECTIONS: readonly (readonly [CornerDirection, string])[] = [
  ['top-ne', 'Top North-East'],
  ['top-nw', 'Top North-West'],
  ['top-se', 'Top South-East'],
  ['top-sw', 'Top South-West'],
  ['bottom-ne', 'Bottom North-East'],
  ['bottom-nw', 'Bottom North-West'],
  ['bottom-se', 'Bottom South-East'],
  ['bottom-sw', 'Bottom South-West'],
];

/** A mouse button with an optional modifier key, for 3D pan and orbit. */
export type MouseBinding =
  | 'left'
  | 'middle'
  | 'right'
  | 'shift+left'
  | 'shift+middle'
  | 'shift+right'
  | 'alt+left'
  | 'alt+middle'
  | 'alt+right'
  | 'ctrl+left'
  | 'ctrl+middle'
  | 'ctrl+right';

/** Choices offered in Preferences › 3D › Navigation for Pan and Orbit mouse bindings. */
export const MOUSE_BINDINGS: readonly (readonly [MouseBinding, string])[] = [
  ['middle', 'Middle Mouse'],
  ['shift+middle', 'Shift + Middle Mouse'],
  ['right', 'Right Mouse'],
  ['shift+right', 'Shift + Right Mouse'],
  ['left', 'Left Mouse'],
  ['shift+left', 'Shift + Left Mouse'],
  ['alt+left', 'Alt + Left Mouse'],
  ['alt+middle', 'Alt + Middle Mouse'],
  ['alt+right', 'Alt + Right Mouse'],
  ['ctrl+left', 'Ctrl + Left Mouse'],
  ['ctrl+middle', 'Ctrl + Middle Mouse'],
  ['ctrl+right', 'Ctrl + Right Mouse'],
];

/** User-configurable 3D navigation behaviour (Preferences › 3D › Navigation). */
export interface ModelNavPrefs {
  /** Mouse button + modifier to pan the view. */
  pan: MouseBinding;
  /** Mouse button + modifier to orbit the view. */
  orbit: MouseBinding;
  /** Zoom toward the point under the cursor, scaling speed by distance to the surface. */
  zoomToCursor: boolean;
  /** Orbit around the surface point under the cursor when starting an orbit. */
  orbitAtCursor: boolean;
  /** Show a subtle 3D marker at the orbit pivot point while orbiting. */
  showPivot: boolean;
  /** Wheel zoom speed (1–10; 5 moves ~20% of the distance to the surface per notch). */
  zoomSpeed: number;
  /** Reverse scroll-wheel zoom direction. */
  invertZoom: boolean;
  /** Orbit drag sensitivity (1–10; 5 is default). */
  orbitSpeed: number;
  /** Invert vertical (up/down) orbit drag. */
  invertOrbitY: boolean;
  /** Pan drag sensitivity (1–10; 5 tracks 1:1 with the surface under the cursor). */
  panSpeed: number;
  /** Camera inertia / damping (0 = instant, 1–10 = progressively smoother). */
  smoothing: number;
}

export const DEFAULT_NAV_PREFS: ModelNavPrefs = {
  pan: 'middle',
  orbit: 'shift+middle',
  zoomToCursor: true,
  orbitAtCursor: true,
  showPivot: true,
  zoomSpeed: 5,
  invertZoom: false,
  orbitSpeed: 5,
  invertOrbitY: false,
  panSpeed: 5,
  smoothing: 0,
};

export type ModelBackground = 'theme' | 'dark' | 'light' | 'sky' | 'custom';
export type ModelLighting = 'daylight' | 'overcast' | 'contrast' | 'custom';

/** Look-and-feel settings for the 3D scene (Display & Scene panel). */
export interface ModelDisplayPrefs {
  background: ModelBackground;
  backgroundColour: string;
  lighting: ModelLighting;
  /** 0..4 */
  ambientIntensity: number;
  /** 0..5 */
  sunIntensity: number;
  /** Horizontal sun angle in degrees (0..360). */
  sunAzimuth: number;
  /** Vertical sun elevation in degrees (10..85). */
  sunElevation: number;
  /** Perspective vertical field of view in degrees (25..95). */
  fov: number;
  /** Opacity of ghosted/hidden elements (0.05..0.6). */
  ghostOpacity: number;
  /** Draw model meshes in wireframe mode. */
  wireframe: boolean;
  /** How far the camera sees, in metres (its far clipping distance, VIEW_DISTANCE_RANGE). */
  viewDistance: number;
}

/** The view distance's range in metres: far enough to find a model a long way from the origin. */
export const VIEW_DISTANCE_RANGE = { min: 100, max: 100_000 } as const;

export const LIGHTING_PRESETS: Record<Exclude<ModelLighting, 'custom'>, Pick<ModelDisplayPrefs, 'ambientIntensity' | 'sunIntensity' | 'sunAzimuth' | 'sunElevation'>> = {
  daylight: { ambientIntensity: 1.6, sunIntensity: 2.2, sunAzimuth: 45, sunElevation: 55 },
  overcast: { ambientIntensity: 2.6, sunIntensity: 0.9, sunAzimuth: 30, sunElevation: 70 },
  contrast: { ambientIntensity: 0.9, sunIntensity: 3.2, sunAzimuth: 60, sunElevation: 38 },
};

export const DEFAULT_DISPLAY_PREFS: ModelDisplayPrefs = {
  background: 'theme',
  backgroundColour: '#1c2026',
  lighting: 'daylight',
  ...LIGHTING_PRESETS.daylight,
  fov: 60,
  ghostOpacity: 0.12,
  wireframe: false,
  viewDistance: 10_000,
};

/** A view distance clamped into VIEW_DISTANCE_RANGE (a bad saved value falls back to the default). */
export function clampViewDistance(metres: number): number {
  if (!Number.isFinite(metres)) return DEFAULT_DISPLAY_PREFS.viewDistance;
  return Math.max(VIEW_DISTANCE_RANGE.min, Math.min(VIEW_DISTANCE_RANGE.max, metres));
}

/**
 * The radius to frame for a bounding sphere: grown by `pad` so what is framed has room around it,
 * and never under `min` metres so a tiny element is not zoomed in on until it fills the view.
 */
export function framedRadius(radius: number, pad = 1.4, min = 0.5): number {
  return Math.max(min, (Number.isFinite(radius) ? radius : 0) * pad);
}

/**
 * The camera's near clipping distance for how far it is from what it looks at: close enough that
 * a small element framed up close is not cut, far enough that distant surfaces do not fight.
 */
export function nearFor(distance: number): number {
  return Math.max(0.02, Math.min(0.5, (Number.isFinite(distance) ? distance : 0) * 0.002));
}

const BUTTON_CODE = { left: 0, middle: 1, right: 2 } as const;

/** Parses a mouse binding string into its DOM button code and required modifiers. */
export function parseBinding(binding: MouseBinding): { button: 0 | 1 | 2; shift: boolean; ctrl: boolean; alt: boolean } {
  const parts = binding.split('+');
  const btn = parts[parts.length - 1] as 'left' | 'middle' | 'right';
  return {
    button: BUTTON_CODE[btn] ?? 1,
    shift: parts.includes('shift'),
    ctrl: parts.includes('ctrl'),
    alt: parts.includes('alt'),
  };
}

/** Whether a pointer/mouse event matches a configured mouse binding (exact modifiers). */
export function matchesBinding(
  binding: MouseBinding,
  e: { button: number; shiftKey: boolean; ctrlKey: boolean; metaKey?: boolean; altKey: boolean },
): boolean {
  const b = parseBinding(binding);
  const ctrl = e.ctrlKey || !!e.metaKey;
  return e.button === b.button && e.shiftKey === b.shift && ctrl === b.ctrl && e.altKey === b.alt;
}

/** Normalises a WheelEvent's deltaY into wheel notches (positive = zoom in, negative = zoom out). */
export function normalizeWheelNotches(deltaY: number, deltaMode: number): number {
  let raw: number;
  if (deltaMode === 1) raw = -deltaY / 3;
  else if (deltaMode === 2) raw = -deltaY * 3;
  else raw = -deltaY / 100;
  return Math.max(-4, Math.min(4, raw));
}

/**
 * Distance to travel along the ray toward a surface point at `distance` for `notches` wheel steps
 * (positive = zoom in, negative = zoom out). Exponentially approaches `minGap` so distant objects
 * zoom fast, close objects slow down, and the camera never passes through the surface.
 */
export function zoomDistanceStep(
  distance: number,
  notches: number,
  speed: number,
  minGap = 0.02,
  maxDistance = 50_000,
): number {
  if (!notches || !(distance > 0)) return 0;
  const clampedSpeed = Math.max(1, Math.min(10, speed));
  const fraction = clampedSpeed * 0.04; // 0.04 .. 0.40 per notch (default 5 -> 0.20)
  const k = 1 - fraction;
  const target = Math.max(minGap, Math.min(maxDistance, distance * Math.pow(k, notches)));
  return distance - target;
}

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
  /** Goes up whenever the selection changes, so the Properties panel knows to look again. */
  selectionVersion: number;
  /** Goes up when models load or are shown or hidden, so the 3D panel lists them again. */
  modelsVersion: number;
  /** The colour profile shown (its id), or null. */
  profileId: string | null;
  /** A model's position on the map is known (its IFC map conversion was given): sheets can be shown in it. */
  georeferenced: boolean;
  /** The models' lowest and highest heights (metres, the map's height datum), once georeferenced. */
  heights: [number, number] | null;
  /** Drapes still being laid over the model. */
  draping: number;
  /** A small plan of the models in a corner, with the camera on it. */
  miniMap: boolean;
  /** The other revision the model is being compared with (its name), or null. */
  comparing: string | null;
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
  selectionVersion: 0,
  modelsVersion: 0,
  profileId: null,
  georeferenced: false,
  heights: null,
  draping: 0,
  miniMap: false,
  comparing: null,
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
  | { type: 'clearMeasurements' }
  | BrowseAction
  | { type: 'georeference'; modelId: string; matrix: number[] }
  | { type: 'sheetOverlays'; overlays: SheetOverlay[] }
  /** Moves the camera to look from `position` at `target` (grid easting, northing, height). */
  | { type: 'lookAtPlace'; camera: PlaceCamera }
  | { type: 'miniMap' }
  /** Looks straight down on a place at a scale and heading (Plan navigation), as a synced sheet shows it. */
  | { type: 'planView'; view: PlanView }
  /** Takes the other revision away, and the colours the comparison gave. */
  | { type: 'endCompare' }
  /** Updates 3D navigation preferences (pan/orbit bindings, zoom-to-cursor, speeds, smoothing). */
  | { type: 'navPrefs'; prefs: Partial<ModelNavPrefs> }
  /** Updates 3D scene display preferences (background, lighting, FOV, ghost opacity, wireframe). */
  | { type: 'displayPrefs'; prefs: Partial<ModelDisplayPrefs> };

/** A plan on the map: its centre (grid easting, northing), its scale and which way is up on screen (a unit grid direction). */
export interface PlanView {
  centre: [number, number];
  metresPerPixel: number;
  up: [number, number];
}

/** A camera on the map: where it is and what it looks at, as grid easting, northing and height. */
export interface PlaceCamera {
  position: [number, number, number];
  target: [number, number, number];
  projection: ModelProjection;
  /** Perspective: the vertical field of view, in degrees. */
  fov: number;
}

/**
 * A sheet shown in the 3D view where it lies on the map: as a picture on a level plane, or its
 * markups draped over the model's surface. Corners and lines are grid eastings and northings.
 */
export interface SheetOverlay {
  id: string;
  mode: 'plane' | 'drape';
  /** Plane: its height (metres, the map's height datum). */
  height: number;
  /** 0..1 */
  opacity: number;
  /** Plane: the picture's corners on the map, top-left, top-right, bottom-right, bottom-left. */
  corners: [number, number][];
  /** Plane: the sheet drawn with its markups (null: a drape). */
  image: HTMLCanvasElement | null;
  /** Drape: lines to lay over the model, each with its colour. */
  lines: { points: [number, number][]; colour: string }[];
  /** Changes when what is drawn changes, so an unchanged overlay is kept as it is. */
  version: string;
}

/** What the ribbon and commands can reach while a model is in front. */
export interface ModelControls extends ModelBrowser {
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
    case 'iso':
      return directionOffset('top-se', d);
    default: {
      // A corner: equal parts up or down, east or west, north (-Z) or south (+Z).
      const [v, h] = direction.split('-') as ['top' | 'bottom', string];
      const k = d / Math.sqrt(3);
      return [h.includes('e') ? k : -k, v === 'top' ? k : -k, h.includes('s') ? k : -k];
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

// --- the 3D sidebar: models, the spatial tree, classes, properties, saved views, search sets and colours ---

/** Elements by model: model id to the elements' local ids (plain data, so it can be kept and sent around). */
export type ItemMap = Record<string, number[]>;

export interface ModelInfo {
  id: string;
  name: string;
  visible: boolean;
  /** Elements with geometry. */
  elements: number;
}

/** A node of a model's spatial structure (project, site, building, storey, element). */
export interface TreeNode {
  modelId: string;
  localId: number | null;
  /** IFC class, e.g. IFCBUILDINGSTOREY. */
  category: string;
  name: string;
  children: TreeNode[];
}

/** Elements of one IFC class across the models. */
export interface ClassEntry {
  category: string;
  count: number;
  items: ItemMap;
}

export interface PropertyGroup {
  /** 'Attributes', or a property or quantity set's name. */
  title: string;
  /** A quantity set (lengths, areas, volumes measured for the element), not a property set. */
  quantities?: boolean;
  rows: [name: string, value: string][];
}

/** What is selected, for the Properties panel. */
export interface SelectionInfo {
  count: number;
  /** The first selected element's name, class and properties (null when nothing is selected). */
  first: { modelId: string; localId: number; name: string; category: string; guid: string | null; groups: PropertyGroup[] } | null;
}

/** A saved search: elements of a class (optional) whose property matches a value (optional). */
export interface SearchSet {
  id: string;
  name: string;
  /** IFC class, matched whole and ignoring case (e.g. IFCWALL); empty: any class. */
  category: string;
  /** Property or attribute name, matched whole and ignoring case; empty: no property test. */
  property: string;
  /** Text the value contains, ignoring case; empty: any value (the property only has to exist). */
  value: string;
}

/** What a colour profile does to the elements of a set. */
export type ColourAction = { kind: 'colour'; colour: string } | { kind: 'hide' } | { kind: 'ghost' };

export interface ColourRule {
  setId: string;
  action: ColourAction;
}

/** Colours, hides or ghosts elements set by set; later rules win where sets overlap. */
export interface ColourProfile {
  id: string;
  name: string;
  rules: ColourRule[];
}

/** A camera, section box, hidden elements and colour profile, kept to come back to. */
export interface SavedView {
  id: string;
  name: string;
  camera: { position: Vec3; target: Vec3; projection: ModelProjection };
  /** The section box's corners, or null for none. */
  sectionBox: [Vec3, Vec3] | null;
  /** Hidden elements by model, as IFC GlobalIds (they outlast a fresh conversion of the file). */
  hidden: Record<string, string[]>;
  ghost: boolean;
  /** The colour profile shown (its id), or null. */
  profileId: string | null;
  /** Optional JPEG data URL preview captured when the view was saved. */
  thumbnail?: string | null;
}

/** What the 3D sidebar asks the view (beyond the ribbon's ModelControls). */
export interface ModelBrowser {
  models(): ModelInfo[];
  tree(): Promise<TreeNode[]>;
  classes(): Promise<ClassEntry[]>;
  selection(): Promise<SelectionInfo>;
  /** The elements a search set finds. */
  find(set: SearchSet): Promise<ItemMap>;
  /** The view as it is now, to save. */
  capture(name: string, profileId: string | null): Promise<SavedView>;
  /** Where the selection lies on the map: its bounds' centre as grid easting, northing and height; null when nothing is selected or the model is not on the map. */
  selectionPlace(): Promise<[number, number, number] | null>;
  /**
   * Selects and frames the topmost element at a map position (grid easting and northing), looking
   * straight down; returns false when nothing is there or the model is not on the map.
   */
  findAt(easting: number, northing: number): Promise<boolean>;
  /** The camera on the map, or null when the model is not on the map. */
  cameraPlace(): PlaceCamera | null;
  /** The plan shown, while the view looks straight down in Plan navigation; null otherwise or off the map. */
  planView(): PlanView | null;
  /** A picture of the view as it is now (a JPEG data URL), at most `maxWidth` pixels wide. */
  snapshot(maxWidth: number): string | null;
  /**
   * Loads another revision of the model (an IFC file) beside it and compares the two element by
   * element (by GlobalId): what only this model has, what only the other has, and what changed.
   */
  compare(ifc: Uint8Array, name: string): Promise<RevisionDiff>;
  /** Count, length, area and volume of the elements (all, or the selection), grouped by class or a property. */
  quantities(groupBy: string, scope: 'all' | 'selection'): Promise<QuantityTable>;
}

/** Sidebar actions, run like the ribbon's. */
export type BrowseAction =
  | { type: 'modelVisible'; modelId: string; visible: boolean }
  | { type: 'fitModel'; modelId: string }
  | { type: 'removeModel'; modelId: string }
  | { type: 'selectItems'; items: ItemMap; fit?: boolean }
  | { type: 'isolateItems'; items: ItemMap }
  | { type: 'itemsVisible'; items: ItemMap; visible: boolean }
  | { type: 'applyView'; view: SavedView; profile: ResolvedProfile | null }
  | { type: 'applyProfile'; id: string | null; profile: ResolvedProfile | null };

/** A colour profile with each rule's set already searched: what the view applies. */
export type ResolvedProfile = { items: ItemMap; action: ColourAction }[];

/** Whether a search set has anything to search by (a class or a property). */
export function searchable(set: SearchSet): boolean {
  return !!(set.category.trim() || set.property.trim());
}

/** Whether an IFC class is the one a search set asks for (whole name, any case; no class asked: any). */
export function matchesCategory(set: SearchSet, category: string): boolean {
  const want = set.category.trim().toLowerCase();
  return !want || category.toLowerCase() === want;
}

/**
 * Points along a line at most `step` apart (its own points kept), so a drape follows the ground
 * between them; at most about `max` points in all, the step growing to fit.
 */
export function densify(points: readonly (readonly [number, number])[], step: number, max = 2000): [number, number][] {
  if (points.length < 2) return points.map(([x, y]) => [x, y]);
  let length = 0;
  for (let i = 1; i < points.length; i++) length += Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1]);
  const s = Math.max(step, length / Math.max(1, max - points.length));
  const out: [number, number][] = [[points[0]![0], points[0]![1]]];
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1]!;
    const [bx, by] = points[i]!;
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / s));
    for (let k = 1; k <= n; k++) out.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n]);
  }
  return out;
}

/** Elements in an ItemMap. */
export function itemCount(items: ItemMap): number {
  return Object.values(items).reduce((n, ids) => n + ids.length, 0);
}

/** Search sets from a JSON file (an exported list, or one set); malformed entries are skipped. */
export function parseSearchSets(json: string): SearchSet[] {
  const data: unknown = JSON.parse(json);
  const list = Array.isArray(data) ? data : data && typeof data === 'object' && Array.isArray((data as { sets?: unknown }).sets) ? (data as { sets: unknown[] }).sets : [data];
  const text = (v: unknown) => (typeof v === 'string' ? v : '');
  return list
    .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
    .map((s) => ({ id: text(s.id) || crypto.randomUUID(), name: text(s.name) || 'Search set', category: text(s.category), property: text(s.property), value: text(s.value) }))
    .filter(searchable);
}

/** Distinct colours for colouring by class: evenly spaced hues, readable on white and dark backgrounds. */
export function paletteColour(i: number): string {
  const hue = Math.round((i * 137.508) % 360);
  return `hsl(${hue}, 65%, 50%)`;
}

// --- review tools: version compare, quantities and walking ---

/** An element of a revision, as compared: its properties (by "set.name") and its bounds. */
export interface RevisionItem {
  guid: string;
  localId: number;
  name: string;
  category: string;
  props: Record<string, string>;
  box: [Vec3, Vec3] | null;
}

export interface RevisionEntry {
  guid: string;
  name: string;
  category: string;
  /** Where to find it: the model (this one, or the other revision) and its local id there. */
  modelId: string;
  localId: number;
  /** Changed: its shape or position moved. */
  geometry?: boolean;
  /** Changed: properties, as "set.name: before → after" (this model's value second). */
  changes?: string[];
}

export interface RevisionDiff {
  /** The other revision's name. */
  other: string;
  /** Only in this model. */
  added: RevisionEntry[];
  /** Only in the other revision. */
  removed: RevisionEntry[];
  changed: RevisionEntry[];
  unchanged: number;
}

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/**
 * Compares two revisions element by element, by GlobalId. Bounds are compared after taking away
 * the shift most elements share (two conversions of a file can place it differently); a corner
 * moving more than `tolerance` (metres) counts as a change of shape. Returns that shift too: the
 * other revision moved by it lines up with this one.
 */
export function diffRevisions(
  mine: readonly RevisionItem[],
  theirs: readonly RevisionItem[],
  ids: { mine: string; theirs: string; other: string },
  tolerance = 0.002,
): { diff: RevisionDiff; shift: Vec3 } {
  const byGuid = new Map(theirs.map((t) => [t.guid, t]));
  const mineGuids = new Set(mine.map((m) => m.guid));
  const centre = (b: [Vec3, Vec3]): Vec3 => [(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2, (b[0][2] + b[1][2]) / 2];
  const deltas: Vec3[] = [];
  for (const m of mine) {
    const t = byGuid.get(m.guid);
    if (m.box && t?.box) {
      const [a, b] = [centre(m.box), centre(t.box)];
      deltas.push([a[0] - b[0], a[1] - b[1], a[2] - b[2]]);
    }
  }
  const shift: Vec3 = [median(deltas.map((d) => d[0])), median(deltas.map((d) => d[1])), median(deltas.map((d) => d[2]))];
  const entry = (x: RevisionItem, modelId: string): RevisionEntry => ({ guid: x.guid, name: x.name, category: x.category, modelId, localId: x.localId });
  const moved = (a: [Vec3, Vec3], b: [Vec3, Vec3]) => [0, 1].some((c) => [0, 1, 2].some((i) => Math.abs(a[c]![i]! - b[c]![i]! - shift[i]!) > tolerance));
  const diff: RevisionDiff = { other: ids.other, added: [], removed: [], changed: [], unchanged: 0 };
  for (const m of mine) {
    const t = byGuid.get(m.guid);
    if (!t) {
      diff.added.push(entry(m, ids.mine));
      continue;
    }
    const changes: string[] = [];
    for (const k of [...new Set([...Object.keys(t.props), ...Object.keys(m.props)])].sort()) {
      const [before, after] = [t.props[k] ?? '', m.props[k] ?? ''];
      if (before !== after) changes.push(`${k}: ${before || '(none)'} → ${after || '(none)'}`);
    }
    const geometry = m.box && t.box ? moved(m.box, t.box) : !!m.box !== !!t.box;
    if (!changes.length && !geometry) diff.unchanged++;
    else diff.changed.push({ ...entry(m, ids.mine), ...(geometry ? { geometry } : {}), ...(changes.length ? { changes } : {}) });
  }
  for (const t of theirs) if (!mineGuids.has(t.guid)) diff.removed.push(entry(t, ids.theirs));
  const byName = (a: RevisionEntry, b: RevisionEntry) => a.name.localeCompare(b.name);
  diff.added.sort(byName);
  diff.removed.sort(byName);
  diff.changed.sort(byName);
  return { diff, shift };
}

export interface QuantityRow {
  /** The class, or the property's value ('' when the elements do not have it). */
  key: string;
  count: number;
  /** Metres, square metres and cubic metres, summed from the elements' quantity sets. */
  length: number;
  area: number;
  volume: number;
  /** The volume was measured from the shapes, as no quantity set gave one. */
  measuredVolume?: boolean;
  items: ItemMap;
}

export interface QuantityTable {
  groupBy: string;
  rows: QuantityRow[];
  /** Property names the elements have, to group by. */
  properties: string[];
}

/** What grouping by class is called (any other name groups by that property). */
export const BY_CLASS = 'Class';

/** Walking: eye height, the highest step taken in a stride, how close to walls, and speeds (m, m/s). */
export const WALK = { eye: 1.7, step: 0.5, reach: 0.35, speed: 1.6, run: 5 };

/**
 * How far to move this frame, on the ground (scene x and z), for the keys held: W/S or up/down
 * forward and back, A/D or left/right sideways, looking toward `yaw` (0 = north, -z).
 */
export function walkMove(keys: ReadonlySet<string>, yaw: number, dt: number, run = false): [number, number] {
  const has = (...k: string[]) => k.some((x) => keys.has(x));
  const fwd = (has('w', 'arrowup') ? 1 : 0) - (has('s', 'arrowdown') ? 1 : 0);
  const side = (has('d', 'arrowright') ? 1 : 0) - (has('a', 'arrowleft') ? 1 : 0);
  if (!fwd && !side) return [0, 0];
  const d = ((run ? WALK.run : WALK.speed) * dt) / Math.hypot(fwd, side);
  // Forward is (sin yaw, -cos yaw); right is (cos yaw, sin yaw).
  return [(fwd * Math.sin(yaw) + side * Math.cos(yaw)) * d, (-fwd * Math.cos(yaw) + side * Math.sin(yaw)) * d];
}
