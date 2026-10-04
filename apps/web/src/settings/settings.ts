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
  gridUnit: 'in' | 'mm';
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
}

/** Grid spacing in PDF points. */
export function gridSpacingPoints(s: Pick<Settings, 'gridSize' | 'gridUnit'>): number {
  return s.gridSize * (s.gridUnit === 'in' ? 72 : 72 / 25.4);
}

export const DEFAULT_SETTINGS: Settings = {
  unitSystem: 'imperial',
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
};

const KEY = 'nb.settings';

function load(): Settings {
  try {
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>) };
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
