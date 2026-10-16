import { useSyncExternalStore } from 'react';
import { DEFAULT_SCALE, SCALE_PRESETS, type LengthUnit, type Scale } from '@nb/measure';

/**
 * App preferences (File → Preferences…), kept per browser. Unlike profiles they are not about the
 * workspace layout but about how the app behaves: zoom steps, snapping, tool library placement.
 */
export type UnitSystem = 'imperial' | 'metric';

/** Scale preset groups offered for a measurement system. */
export const SCALE_GROUPS: Record<UnitSystem, readonly ('Architectural' | 'Engineering' | 'Metric')[]> = {
  imperial: ['Architectural', 'Engineering'],
  metric: ['Metric'],
};

const SYSTEM_UNITS: Record<UnitSystem, readonly string[]> = {
  imperial: ['in', 'ft', 'yd', 'mi'],
  metric: ['mm', 'cm', 'm', 'km'],
};

/** `units` limited to a system's own, plus `keep` (the one already in use) so it never vanishes from a picker. */
export function unitsFor<U extends string>(system: UnitSystem, units: readonly U[], keep?: U): U[] {
  return units.filter((u) => u === keep || SYSTEM_UNITS[system].includes(u));
}

/** The system a length unit belongs to. */
export const systemOf = (unit: LengthUnit): UnitSystem => (SYSTEM_UNITS.metric.includes(unit) ? 'metric' : 'imperial');

/** Units offered as defaults (Preferences › Units) for lengths, areas (their square) and volumes (their cube). */
export const DEFAULT_UNIT_CHOICES: Record<UnitSystem, Record<'length' | 'area' | 'volume', readonly LengthUnit[]>> = {
  metric: { length: ['mm', 'cm', 'm', 'km'], area: ['mm', 'cm', 'm', 'km'], volume: ['mm', 'cm', 'm'] },
  imperial: { length: ['in', 'ft', 'yd', 'mi'], area: ['in', 'ft', 'yd', 'mi'], volume: ['in', 'ft', 'yd'] },
};

const SYSTEM_DEFAULTS: Record<UnitSystem, Pick<Settings, 'lengthUnit' | 'areaUnit' | 'volumeUnit'>> = {
  metric: { lengthUnit: 'm', areaUnit: 'm', volumeUnit: 'm' },
  imperial: { lengthUnit: 'ft', areaUnit: 'ft', volumeUnit: 'ft' },
};

/** Decimal places lengths get in a unit when the app picks the unit itself. */
const UNIT_PRECISION: Record<LengthUnit, number> = { mm: 0, cm: 1, m: 2, km: 3, in: 2, ft: 2, yd: 2, mi: 3 };

/** The unit the grid is spaced in on paper: millimetres for metric, inches for imperial. */
export const gridUnitOf = (system: UnitSystem): 'mm' | 'in' => (system === 'metric' ? 'mm' : 'in');

/** A grid spacing of `mm` millimetres, rounded to a whole millimetre or a sixteenth of an inch. */
function roundGrid(mm: number, system: UnitSystem): number {
  return system === 'metric' ? Math.max(1, Math.round(mm)) : Math.max(1 / 16, Math.round((mm / 25.4) * 16) / 16);
}

/**
 * The settings that change with the unit system: default units not in it go back to the system's
 * own, and the grid spacing is converted to the new system's paper unit.
 */
export function switchUnitSystem(s: Settings, system: UnitSystem): Partial<Settings> {
  if (s.unitSystem === system) return {};
  const choices = DEFAULT_UNIT_CHOICES[system];
  const own = SYSTEM_DEFAULTS[system];
  return {
    unitSystem: system,
    lengthUnit: choices.length.includes(s.lengthUnit) ? s.lengthUnit : own.lengthUnit,
    areaUnit: choices.area.includes(s.areaUnit) ? s.areaUnit : own.areaUnit,
    volumeUnit: choices.volume.includes(s.volumeUnit) ? s.volumeUnit : own.volumeUnit,
    gridSize: roundGrid(s.gridSize * (gridUnitOf(s.unitSystem) === 'mm' ? 1 : 25.4), system),
  };
}

/**
 * A page scale with the default units (Preferences › Units) filled in: areas and volumes in the
 * default units unless the scale already names its own, and a built-in preset's lengths in the
 * default length unit. Scales in the other unit system are left as they are.
 */
export function withDefaultUnits(scale: Scale, s: Settings = current): Scale {
  if (systemOf(scale.unit) !== s.unitSystem) return scale;
  const next: Scale = { ...scale, areaUnit: scale.areaUnit ?? s.areaUnit, volumeUnit: scale.volumeUnit ?? s.volumeUnit };
  const preset = SCALE_PRESETS.find((p) => p.label === scale.label)?.scale;
  if (preset && scale.unit === preset.unit && s.lengthUnit !== scale.unit) {
    next.unit = s.lengthUnit;
    next.feetInches = next.feetInches && (next.unit === 'ft' || next.unit === 'in');
    // The preset's own precision follows the unit; one picked in a dialog is kept.
    if (!next.feetInches && (scale.feetInches || scale.precision === preset.precision)) next.precision = UNIT_PRECISION[next.unit];
  }
  return next;
}

/** A Sets category: sheets whose tag value starts with `filter` belong to it. */
export interface SetCategory {
  name: string;
  filter: string;
}

/** A named list of Sets categories (Preferences › Sets › Categories). */
export interface SetTemplate {
  /** The sheet tag categories are matched against. */
  assignBy: string;
  categories: SetCategory[];
}

/** A Sets sheet tag: AutoMark tags are read off the title block automatically. */
export interface SetTag {
  name: string;
  type: 'text' | 'number' | 'date';
  autoMark: boolean;
}

export const CONSTRUCTION_TEMPLATE: SetTemplate = {
  assignBy: 'Drawing Number',
  categories: (
    [
      ['General', 'G'],
      ['Civil', 'C'],
      ['Landscape', 'L'],
      ['Structural', 'S'],
      ['Architectural Demolition', 'AD'],
      ['Architectural', 'A'],
      ['Interiors', 'I'],
      ['Plumbing', 'P'],
      ['Mechanical', 'M'],
      ['Fire Protection', 'FP'],
      ['Electrical', 'E'],
      ['Telecommunications', 'T'],
    ] as const
  ).map(([name, filter]) => ({ name, filter })),
};

export interface Settings {
  /** Units, metric or imperial: only its scales and units are offered in scale and unit pickers. */
  unitSystem: UnitSystem;
  /** Default units within the system: lengths, areas (the unit squared) and volumes (the unit cubed). */
  lengthUnit: LengthUnit;
  areaUnit: LengthUnit;
  volumeUnit: LengthUnit;
  /** Ctrl + mouse wheel: zoom step per wheel notch (each step scales the zoom by 1 + 2 × this). */
  ctrlWheelZoomStep: number;
  /** Plain mouse wheel where it zooms (single page view): percentage points per notch. */
  wheelZoomStep: number;
  /** Wheel up zooms out instead of in. */
  invertWheelZoom: boolean;
  /** Zoom buttons and Ctrl +/-: percentage points per press. */
  buttonZoomStep: number;
  /** Drawing tools snap to drawing geometry when a document opens. */
  snapToGeometry: boolean;
  /** Hyperlink areas are outlined when a document opens. */
  showHyperlinks: boolean;
  /** Tool Library tools saved from a markup place an exact copy of it, or draw new markups in its style. */
  toolChestMode: 'copy' | 'style';
  /** After placing a Tool Library copy, keep the tool armed to place more (Esc to stop). */
  toolChestSticky: boolean;
  /** Ask before deleting markups with the Delete key. */
  confirmDelete: boolean;
  /** With Select, dragging on an empty part of the page draws a selection box instead of panning. */
  dragToSelect: boolean;
  /** A dotted, non-printing grid over the page (View → Show Grid). */
  showGrid: boolean;
  /** Drawing tools snap to the nearest grid point when no drawing geometry is nearer. */
  snapToGrid: boolean;
  /** Drawing tools snap to the corners and vertices of other markups. */
  snapToMarkup: boolean;
  /** Grid spacing on the page (paper): millimetres with metric units, inches with imperial. */
  gridSize: number;
  /** Rulers along the top and left of the view (View → Rulers). */
  showRulers: boolean;
  /** Full-screen crosshair cursor (View → Full-Screen Crosshair). */
  crosshair: boolean;
  /** How latitudes and longitudes on maps (geospatial PDFs) are shown: decimal degrees or degrees, minutes and seconds. */
  geoFormat: 'decimal' | 'dms';
  /** Draw Spaces on the page (Spaces panel). Hidden Spaces still group markups. */
  showSpaces: boolean;
  /** Draw to Scale: type exact lengths, angles and sizes while drawing. */
  sketchToScale: boolean;
  /**
   * Draw to Scale, Ellipse tool: corner to corner by width and height, or a circle from its centre
   * by radius or diameter.
   */
  sketchEllipse: 'ellipse' | 'radius' | 'diameter';
  /** Page colours on screen: as printed, Dark Mode (inverted) or the Dimmer. */
  pageFilter: 'none' | 'dark' | 'dim';
  /** Disable Line Weights: PDF lines drawn as hairlines. */
  thinLines: boolean;
  /** Keep the tool active after placing a markup (status bar Reuse). */
  reuseTool: boolean;
  /** Eraser size, and whether it deletes whole markups (annotation eraser) rather than parts of strokes. */
  eraserSize: 'small' | 'medium' | 'large';
  eraserWhole: boolean;
  /**
   * Offset: the distance copies are made at, as typed in the page's units (empty: through the
   * clicked point), and how many copies each click makes.
   */
  offsetDistance: string;
  offsetCount: number;
  /** Fillet radius and Chamfer distance as typed (empty: a sharp corner). */
  filletRadius: string;
  chamferDistance: string;
  /** Lengthen: change by an amount, set the total, or a percentage of the length; and the value typed. */
  lengthenMode: 'delta' | 'total' | 'percent';
  lengthenValue: string;
  /** Polar and Path Array: items (the original included), the angle a polar array fills, and whether items turn. */
  arrayCount: number;
  arrayAngle: number;
  arrayRotate: boolean;
  arrayAlign: boolean;
  /** Divide: into equal parts, or a mark every spacing (AutoCAD's Measure). */
  divideMode: 'count' | 'spacing';
  divideCount: number;
  divideSpacing: string;
  /** Mirror keeps the originals (copies the mirror image). */
  mirrorKeep: boolean;
  /** Rotate: an angle typed (counter-clockwise degrees), else by reference points. */
  rotateAngle: string;
  /** Align scales to fit the second pair of points. */
  alignScale: boolean;
  /** Languages OCR reads (Tesseract codes). */
  ocrLanguages: string[];
  /** A speech bubble with the reply count on markups that have replies (View menu). */
  replyIndicators: boolean;
  /** How the page shows markups the Markups list's filter leaves out. */
  filteredMarkups: 'show' | 'dim' | 'hide';
  /** File › Open Recent: how many documents, and how far back (days; 0 no limit). */
  recentCount: number;
  recentDays: number;
  /** Reopen the documents that were open when the app was last closed. */
  restoreTabs: boolean;
  /** The start screen (no document open) shows a step-by-step tip from the help. */
  startTips: boolean;
  /** Snapshot: resolution of the picture it copies, in dots per inch. */
  snapshotDpi: number;

  // Preferences laid out after Bluebeam Revu's. Those marked "stored" are kept, imported and
  // exported with the rest, but nothing in RedColumn reads them yet.

  // General › Options
  /** Which part of a long document name the tabs cut short. */
  tabTruncation: 'start' | 'middle' | 'end';
  /** Library id of a document opened (in front) every time the app starts; '' for none. */
  startupFile: string;
  // General › Document
  /** Changes not saved to a document's file survive closing it and restarting (it stays marked unsaved); off, Don't Save discards them. */
  documentRecovery: boolean;
  /** How a document is laid out when first shown: Auto puts drawings (larger than tabloid) a page at a time and scrolls smaller pages. */
  pageLayout: 'auto' | 'single' | 'continuous' | 'sideBySide' | 'continuousSideBySide';
  /** Highest zoom the view allows, in percent. */
  maxZoom: number;
  // General › Navigation
  /** What the plain mouse wheel does in single page view and in continuous view. */
  singlePageWheel: 'zoom' | 'scroll';
  continuousWheel: 'zoom' | 'scroll';
  /** How far a wheel notch scrolls, and how fast a trackpad zooms (1–10; 4 is the browser's rate). */
  wheelSensitivity: number;
  // General › Grid & Snap
  /** Snap to Content: nearest point on straight lines. */
  snapLines: boolean;
  /** Snap to Content also snaps onto curves (arcs, circles, splines) in the drawing. */
  snapCurves: boolean;
  /** Which kinds of drawing geometry Snap to Content snaps to. */
  snapMidpoints: boolean;
  snapEndpoints: boolean;
  snapIntersections: boolean;
  /** Centres of circles and arcs, and their quadrants (top, bottom, left and right). */
  snapCenters: boolean;
  snapQuadrants: boolean;
  /** Geometric centres of closed markups (rectangles, polygons, areas). */
  snapGeoCenters: boolean;
  /** From the point being drawn from: the foot of a perpendicular to a line or circle, or a tangent to a circle. */
  snapPerpendicular: boolean;
  snapTangent: boolean;
  /** Where two lines near the pointer would cross if they were extended. */
  snapApparent: boolean;
  /** Extension: an acquired line end gives a path on past it. */
  snapExtension: boolean;
  /** Parallel: resting on a line acquires its direction, giving a path that way from the point being drawn from. */
  snapParallel: boolean;
  /** Object Snap Tracking: resting on a snap acquires it, giving paths straight across and up and down from it. */
  objectSnapTracking: boolean;
  /** Polar Tracking: paths from the point being drawn from at multiples of `polarAngle` degrees. */
  polarTracking: boolean;
  polarAngle: number;
  /** Object Snap Tracking follows every polar angle, not only straight across and up and down. */
  polarForObjects: boolean;
  /** How near (screen pixels) the pointer must come to a point to snap to it. */
  snapSensitivity: number;
  /** Colour of the snap marker. */
  snapColour: string;
  // General › Spelling
  /** Browser spell check (underlines) while typing markup text and comments. */
  spellCheck: boolean;
  /** Check Spelling also checks words in capitals (often abbreviations on drawings). */
  spellUpperCase: boolean;
  /** Dictionary Check Spelling uses. */
  dictionary: 'en-AU' | 'en-GB' | 'en-US';
  // Interface › Markups List
  /** Selecting a markup in the list zooms to fit it (otherwise the view only goes to its page). */
  zoomFitSelected: boolean;
  richTextComments: boolean; // stored
  /** Markup exports (CSV, Markup Summary) leave out the markups the list's filters hide. */
  excludeFilteredOnExport: boolean;
  /** Opacity of markups the list's filter dims, in percent. */
  filteredDim: number;
  // Interface › Layers
  /** Hiding a PDF layer hides the layers nested in it too (and showing it shows them). */
  hideChildLayers: boolean;
  /** The Layers panel lists only the layers the current page uses. */
  layersOnPageOnly: boolean;
  /** The Layers Dial shows one layer alone (Isolate) or draws the other markup layers faintly (Fade). */
  layerDial: 'isolate' | 'fade';
  // Tools › Markup
  /** Text boxes and callouts are fitted to their text whenever it is edited. */
  autoSizeText: boolean;
  /** Pasted markups stay on the layer they were copied from (else they go on no layer). */
  retainLayerOnCopy: boolean;
  /** Saved documents embed the font files markup text uses, instead of only naming standard fonts. */
  embedFonts: boolean;
  /** Comment pop-ups (shown when the pointer rests on a markup) start with its author and date. */
  popupAuthorDate: boolean;
  /** Opacity of comment pop-ups, in percent. */
  popupOpacity: number;
  /** Highlight, underline and strikeout markups get the text they mark as their comment. */
  copyHighlightedText: boolean;
  /** How placed pictures are stored: Auto (photos JPEG, others lossless), JPEG, or Flate (lossless PNG). */
  imageEncoding: 'auto' | 'jpeg' | 'flate';
  // Tools › Sketch
  /** Draw to Scale angles: from east (Absolute) or from the previous segment's direction (Relative). */
  rotationInput: 'absolute' | 'relative';
  // Tools › Forms
  /** How fillable form fields are tinted on the page. */
  formHighlightColour: string;
  formHighlightOpacity: number;
  /** With the Forms panel open, T, C, R, D, L, B and S start drawing that kind of field. */
  formSingleKeys: boolean;
  // Tools › Signature
  /** Minutes a Digital ID stays unlocked after its password is typed (0: ask every time). */
  signaturePasswordTimeout: number;
  /** Digest new signatures are made over. */
  signatureAlgorithm: 'SHA-256' | 'SHA-384' | 'SHA-512';
  /** Refuse changes to a signed document that rewrite it (and so invalidate its signatures). */
  restrictSignedChanges: boolean;
  // Sets › Set Options (the Sets panel)
  setOpenDocuments: 'inPlace' | 'newTab';
  setOpenEdited: 'inPlace' | 'newTab';
  setShow: 'fileAndLabel' | 'fileName' | 'pageLabel';
  setPreview: boolean;
  setCategories: 'auto' | 'manual' | 'none';
  setDefaultTemplate: string;
  setPromptTemplate: boolean;
  // Sets › Sorting
  setSortBy: 'fileAndLabel' | 'fileName' | 'pageLabel' | 'sheetNumber';
  setSortTagged: boolean;
  setSortOrder: 'asc' | 'desc';
  setStackMultiPage: boolean;
  setRevisionFilter: 'auto' | 'none' | 'wildcard';
  setWildcard: string;
  setPreviousRevisions: 'crossOut' | 'hide' | 'none';
  setCurrentRevisions: 'stack' | 'none';
  setCopyMarkups: boolean;
  setUnflatten: boolean;
  setFlattenAfter: boolean;
  setStampSuperseded: boolean;
  // Sets › Categories and Tags
  setTemplates: Record<string, SetTemplate>;
  setTags: SetTag[];
  setAutoTagRevision: boolean;
  setAutoTagDiscipline: boolean;
  setAutoTagSheetType: boolean;
  // Import/Export › Images: the camera (File › Create › From Camera), pictures placed or dropped on a
  // page, pictures made into PDFs, and File › Export › Page Images.
  photoResolution: 'low' | 'medium' | 'high';
  videoResolution: 'low' | 'medium' | 'high';
  cameraOrientation: 'none' | 'rotate90' | 'rotate180' | 'rotate270';
  importImageResolution: 'original' | '300' | '150' | '72';
  imageDrop: 'attachPhoto' | 'image' | 'newPage';
  importColourspace: 'auto' | 'colour' | 'grey' | 'mono';
  importResolution: 'auto' | '72' | '150' | '300' | '600';
  scannedJpeg: boolean;
  exportColourspace: 'auto' | 'colour' | 'grey' | 'mono';
  exportResolution: 'auto' | '72' | '150' | '300' | '600';
  tiffCompression: 'ccittG4' | 'lzw' | 'none';
  multiPageTiff: boolean;
  imagePageNumber: string;
}

/** Grid spacing in PDF points. */
export function gridSpacingPoints(s: Pick<Settings, 'gridSize' | 'unitSystem'>): number {
  return s.gridSize * (gridUnitOf(s.unitSystem) === 'mm' ? 72 / 25.4 : 72);
}

export const DEFAULT_SETTINGS: Settings = {
  unitSystem: 'metric',
  lengthUnit: 'm',
  areaUnit: 'm',
  volumeUnit: 'm',
  ctrlWheelZoomStep: 5,
  wheelZoomStep: 10,
  invertWheelZoom: false,
  buttonZoomStep: 10,
  snapToGeometry: true,
  showHyperlinks: true,
  toolChestMode: 'copy',
  toolChestSticky: false,
  confirmDelete: false,
  dragToSelect: false,
  showGrid: false,
  snapToGrid: false,
  snapToMarkup: true,
  gridSize: 5,
  showRulers: false,
  crosshair: false,
  geoFormat: 'decimal',
  showSpaces: true,
  sketchToScale: false,
  sketchEllipse: 'ellipse',
  pageFilter: 'none',
  thinLines: false,
  reuseTool: true,
  eraserSize: 'medium',
  eraserWhole: false,
  offsetDistance: '',
  offsetCount: 1,
  filletRadius: '',
  chamferDistance: '',
  lengthenMode: 'delta',
  lengthenValue: '',
  arrayCount: 4,
  arrayAngle: 360,
  arrayRotate: true,
  arrayAlign: true,
  divideMode: 'count',
  divideCount: 4,
  divideSpacing: '',
  mirrorKeep: true,
  rotateAngle: '',
  alignScale: false,
  filteredMarkups: 'show',
  replyIndicators: false,
  ocrLanguages: ['eng'],
  recentCount: 10,
  recentDays: 0,
  restoreTabs: false,
  startTips: true,
  snapshotDpi: 200,

  tabTruncation: 'end',
  startupFile: '',
  documentRecovery: true,
  pageLayout: 'auto',
  maxZoom: 6400,
  singlePageWheel: 'zoom',
  continuousWheel: 'scroll',
  wheelSensitivity: 4,
  snapLines: true,
  snapCurves: true,
  snapMidpoints: true,
  snapEndpoints: true,
  snapIntersections: true,
  snapCenters: true,
  snapQuadrants: true,
  snapGeoCenters: true,
  snapPerpendicular: true,
  snapTangent: false,
  snapApparent: false,
  snapExtension: true,
  snapParallel: false,
  objectSnapTracking: true,
  polarTracking: false,
  polarAngle: 45,
  polarForObjects: false,
  snapSensitivity: 10,
  snapColour: '#d946ef',
  spellCheck: true,
  spellUpperCase: false,
  dictionary: 'en-AU',
  zoomFitSelected: true,
  richTextComments: false,
  excludeFilteredOnExport: false,
  filteredDim: 20,
  hideChildLayers: true,
  layersOnPageOnly: false,
  layerDial: 'isolate',
  autoSizeText: false,
  retainLayerOnCopy: true,
  embedFonts: true,
  popupAuthorDate: false,
  popupOpacity: 70,
  copyHighlightedText: true,
  imageEncoding: 'auto',
  rotationInput: 'absolute',
  formHighlightColour: '#c0c0ff',
  formHighlightOpacity: 25,
  formSingleKeys: false,
  signaturePasswordTimeout: 5,
  signatureAlgorithm: 'SHA-256',
  restrictSignedChanges: true,
  setOpenDocuments: 'inPlace',
  setOpenEdited: 'newTab',
  setShow: 'fileAndLabel',
  setPreview: true,
  setCategories: 'auto',
  setDefaultTemplate: 'Construction',
  setPromptTemplate: false,
  setSortBy: 'fileAndLabel',
  setSortTagged: true,
  setSortOrder: 'asc',
  setStackMultiPage: false,
  setRevisionFilter: 'auto',
  setWildcard: '',
  setPreviousRevisions: 'crossOut',
  setCurrentRevisions: 'stack',
  setCopyMarkups: true,
  setUnflatten: true,
  setFlattenAfter: false,
  setStampSuperseded: true,
  setTemplates: { Construction: CONSTRUCTION_TEMPLATE },
  setTags: [
    { name: 'Sheet Name', type: 'text', autoMark: true },
    { name: 'Sheet Number', type: 'text', autoMark: true },
    { name: 'Revision Number', type: 'number', autoMark: false },
  ],
  setAutoTagRevision: true,
  setAutoTagDiscipline: false,
  setAutoTagSheetType: false,
  photoResolution: 'medium',
  videoResolution: 'low',
  cameraOrientation: 'none',
  importImageResolution: 'original',
  imageDrop: 'attachPhoto',
  importColourspace: 'auto',
  importResolution: 'auto',
  scannedJpeg: true,
  exportColourspace: 'auto',
  exportResolution: 'auto',
  tiffCompression: 'ccittG4',
  multiPageTiff: true,
  imagePageNumber: 'Page 001',
};

const KEY = 'nb.settings';

function load(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, unknown>;
    // Settings since removed are dropped, so they are not written back.
    const known = Object.entries(saved).filter(([k]) => k in DEFAULT_SETTINGS);
    const loaded: Settings = { ...DEFAULT_SETTINGS, ...(Object.fromEntries(known) as Partial<Settings>) };
    // Grid spacing once had a unit of its own; it now follows the unit system.
    const oldUnit = saved.gridUnit as 'in' | 'cm' | 'mm' | 'pt' | undefined;
    if (oldUnit && typeof saved.gridSize === 'number') loaded.gridSize = roundGrid(saved.gridSize * { in: 25.4, cm: 10, mm: 1, pt: 25.4 / 72 }[oldUnit], loaded.unitSystem);
    return loaded;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

let current = load();
const listeners = new Set<() => void>();

/** Pages with no scale set measure at full size, shown in the default units. */
function applyDefaultScale(s: Settings) {
  Object.assign(DEFAULT_SCALE, { unit: s.lengthUnit, areaUnit: s.areaUnit, volumeUnit: s.volumeUnit, feetInches: false, precision: UNIT_PRECISION[s.lengthUnit] });
}
applyDefaultScale(current);

export const settings = {
  get: (): Settings => current,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  set(patch: Partial<Settings>) {
    current = { ...current, ...(patch.unitSystem ? switchUnitSystem(current, patch.unitSystem) : {}), ...patch };
    applyDefaultScale(current);
    try {
      localStorage.setItem(KEY, JSON.stringify(current));
    } catch {
      // Not persisted; applies for this visit.
    }
    listeners.forEach((l) => l());
  },
  reset() {
    settings.set({ ...DEFAULT_SETTINGS });
  },
  /** Preferences exported to a file, read back: unknown keys and values of the wrong type are dropped. */
  parse(json: string): Partial<Settings> {
    const raw = JSON.parse(json) as { settings?: Record<string, unknown> };
    const out: Record<string, unknown> = {};
    const defaults = DEFAULT_SETTINGS as unknown as Record<string, unknown>;
    for (const [k, v] of Object.entries(raw.settings ?? {})) {
      const d = defaults[k];
      if (d !== undefined && v !== null && typeof v === typeof d && Array.isArray(v) === Array.isArray(d)) out[k] = v;
    }
    return out as Partial<Settings>;
  },
};

export function useSettings(): Settings {
  return useSyncExternalStore(settings.subscribe, settings.get);
}

/**
 * Zoom after `notches` steps. Each step scales the zoom by 1 + 2 × `stepPercent` / 100 (10 → ×1.2),
 * so a notch feels the same at 10% and at 2000%; flat percentage-point steps crawled when zoomed
 * in and leapt when zoomed out.
 */
export function steppedZoom(zoom: number, stepPercent: number, notches: number): number {
  const f = 1 + (stepPercent / 100) * 2;
  return zoom * Math.pow(f, notches);
}
