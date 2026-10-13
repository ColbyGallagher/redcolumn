import { useSyncExternalStore } from 'react';

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

export type GridUnit = 'in' | 'cm' | 'mm' | 'pt';

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
  /** Measurement system: only its scales and units are offered in scale and unit pickers. */
  unitSystem: UnitSystem;
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
  /** Grid spacing on the page (paper), in `gridUnit`s. */
  gridSize: number;
  gridUnit: GridUnit;
  /** Rulers along the top and left of the view (View → Rulers). */
  showRulers: boolean;
  /** Full-screen crosshair cursor (View → Full-Screen Crosshair). */
  crosshair: boolean;
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
  autoSizeText: boolean; // stored
  scaleGroupAppearance: boolean; // stored
  retainLayerOnCopy: boolean; // stored
  embedFonts: boolean; // stored
  popupAuthorDate: boolean; // stored
  printPopups: boolean; // stored
  popupOpacity: number; // stored
  copyHighlightedText: boolean; // stored
  imageEncoding: 'auto' | 'jpeg' | 'flate'; // stored
  // Tools › Sketch
  rotationInput: 'absolute' | 'relative'; // stored
  // Tools › Forms
  formHighlightColour: string; // stored
  formHighlightOpacity: number; // stored
  formSingleKeys: boolean; // stored
  // Tools › Signature
  signaturePasswordTimeout: number; // stored
  signatureAlgorithm: 'SHA-256' | 'SHA-384' | 'SHA-512'; // stored
  restrictSignedChanges: boolean; // stored
  // Sets › Set Options (stored)
  setOpenDocuments: 'inPlace' | 'newTab';
  setOpenEdited: 'inPlace' | 'newTab';
  setRelativePaths: boolean;
  setShowPaths: boolean;
  setShow: 'fileAndLabel' | 'fileName' | 'pageLabel';
  setPreview: boolean;
  setCategories: 'auto' | 'manual' | 'none';
  setDefaultTemplate: string;
  setPromptTemplate: boolean;
  // Sets › Sorting (stored)
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
  // Sets › Categories and Tags (stored)
  setTemplates: Record<string, SetTemplate>;
  setTags: SetTag[];
  setAutoTagRevision: boolean;
  setAutoTagDiscipline: boolean;
  setAutoTagSheetType: boolean;
  // Import/Export › Images (stored)
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
export function gridSpacingPoints(s: Pick<Settings, 'gridSize' | 'gridUnit'>): number {
  return s.gridSize * { in: 72, cm: 72 / 2.54, mm: 72 / 25.4, pt: 1 }[s.gridUnit];
}

export const DEFAULT_SETTINGS: Settings = {
  unitSystem: 'metric',
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
  gridSize: 0.25,
  gridUnit: 'in',
  showRulers: false,
  crosshair: false,
  showSpaces: true,
  sketchToScale: false,
  sketchEllipse: 'ellipse',
  pageFilter: 'none',
  thinLines: false,
  reuseTool: true,
  eraserSize: 'medium',
  eraserWhole: false,
  filteredMarkups: 'show',
  replyIndicators: false,
  ocrLanguages: ['eng'],
  recentCount: 10,
  recentDays: 0,
  restoreTabs: false,
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
  scaleGroupAppearance: true,
  retainLayerOnCopy: true,
  embedFonts: true,
  popupAuthorDate: false,
  printPopups: true,
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
  setRelativePaths: true,
  setShowPaths: false,
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
    return { ...DEFAULT_SETTINGS, ...(Object.fromEntries(known) as Partial<Settings>) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

let current = load();
const listeners = new Set<() => void>();

export const settings = {
  get: (): Settings => current,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  set(patch: Partial<Settings>) {
    current = { ...current, ...patch };
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
