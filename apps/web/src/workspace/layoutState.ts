/**
 * The window layout kept between launches: how wide the side panels are and the state of the
 * bottom Markups list (shown, collapsed to its strip, which tab, how tall). Which side panel is
 * open, and the ribbon and toolbar, are kept elsewhere (`nb.panel.*` and the workspace profile).
 * Whatever is read back is checked, so a stale or hand-edited value can never break the layout.
 */

export const LAYOUT_KEY = 'nb.layout';

export type BottomTabId = 'markups' | 'links';

export interface LayoutState {
  leftWidth: number;
  rightWidth: number;
  /** The Markups list is switched on (not closed from the Window menu). */
  showBottom: boolean;
  /** The list is open rather than collapsed to its thin strip. */
  dockOpen: boolean;
  bottomTab: BottomTabId;
  dockHeight: number;
}

export const SIDE_WIDTH_RANGE = { min: 180, max: 480 } as const;
export const DOCK_HEIGHT_MIN = 80;

export const DEFAULT_LAYOUT: LayoutState = {
  leftWidth: 440,
  rightWidth: 360,
  showBottom: true,
  dockOpen: true,
  bottomTab: 'markups',
  dockHeight: 180,
};

const clampNum = (v: unknown, min: number, max: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.max(min, Math.min(max, v))) : fallback;

/** Largest the Markups list may be: half the window, never below its minimum. */
export const maxDockHeight = (windowHeight: number) => Math.max(DOCK_HEIGHT_MIN, Math.floor(windowHeight * 0.5));

/** Room always left for the drawing between the two side panels. */
export const MIN_DRAWING_WIDTH = 400;

/** Shrinks two side widths together so they leave the drawing at least MIN_DRAWING_WIDTH. */
export function fitWidths(left: number, right: number, windowWidth: number): [number, number] {
  const cap = Math.max(SIDE_WIDTH_RANGE.min * 2, windowWidth - MIN_DRAWING_WIDTH);
  if (left + right <= cap) return [left, right];
  const k = cap / (left + right);
  const l = Math.max(SIDE_WIDTH_RANGE.min, Math.round(left * k));
  const r = Math.max(SIDE_WIDTH_RANGE.min, Math.round(right * k));
  return [l, r];
}

/** Reads a saved layout, replacing anything missing or out of range with the default. */
export function parseLayout(raw: string | null, windowHeight = 1000): LayoutState {
  let o: Record<string, unknown> = {};
  try {
    const v: unknown = JSON.parse(raw ?? 'null');
    if (v && typeof v === 'object' && !Array.isArray(v)) o = v as Record<string, unknown>;
  } catch {
    /* unreadable: use the defaults */
  }
  const d = DEFAULT_LAYOUT;
  // Widths stay as the user left them; `fitWidths` shrinks them for display in a small window.
  return {
    leftWidth: clampNum(o.leftWidth, SIDE_WIDTH_RANGE.min, SIDE_WIDTH_RANGE.max, d.leftWidth),
    rightWidth: clampNum(o.rightWidth, SIDE_WIDTH_RANGE.min, SIDE_WIDTH_RANGE.max, d.rightWidth),
    showBottom: typeof o.showBottom === 'boolean' ? o.showBottom : d.showBottom,
    dockOpen: typeof o.dockOpen === 'boolean' ? o.dockOpen : d.dockOpen,
    bottomTab: o.bottomTab === 'links' || o.bottomTab === 'markups' ? o.bottomTab : d.bottomTab,
    dockHeight: clampNum(o.dockHeight, DOCK_HEIGHT_MIN, maxDockHeight(windowHeight), d.dockHeight),
  };
}

export function serializeLayout(layout: LayoutState): string {
  return JSON.stringify(layout);
}

/** The saved layout, or null when none was kept (so callers keep their own first-run defaults). */
export function loadLayout(): LayoutState | null {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    return raw === null ? null : parseLayout(raw, window.innerHeight);
  } catch {
    return null;
  }
}

export function saveLayout(layout: LayoutState): void {
  try {
    localStorage.setItem(LAYOUT_KEY, serializeLayout(layout));
  } catch {
    /* storage off limits: the layout lasts for this session */
  }
}

export function clearLayout(): void {
  try {
    localStorage.removeItem(LAYOUT_KEY);
  } catch {
    /* nothing kept */
  }
}
