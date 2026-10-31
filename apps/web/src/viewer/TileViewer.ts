import { RENDER_CANCELLED, type PdfDocument, type RenderResult } from '@nb/pdf-core';
import { isMac } from '../commands/keys';
import { settings, steppedZoom } from '../settings/settings';
import { deskColour } from '../theme/themes';
import { applyAffine, composeAffine, IDENTITY, invertAffine, rotationAffine, type Affine } from './affine';
import { spreadRows } from './layout';
import { LONG_PRESS_MS, LONG_PRESS_SLOP_PX, PenGuard, pinchStep, type Pt } from './gestures';

export { spreadRows };

/** Tile edge in device pixels. */
const TILE = 512;
/** ~160 MB of RGBA tiles. */
const TILE_BUDGET_PX = 160 * TILE * TILE;
/** Renders handed to the worker at once: one drawing, one ready to start. */
const MAX_IN_FLIGHT = 2;
/** Longest edge of the quick whole-page preview shown while a page's first render comes. */
const QUICK_PX = 512;
/**
 * A page at most this many device pixels is drawn as one image rather than tiles: every render
 * of a sheet pays for walking all its objects, so one whole-page render beats a dozen tiles.
 */
const WHOLE_PAGE_MAX_PX = 9_000_000;
/** ~190 MB of whole-page images (several sheets in a stitched view, and pages scrolled past). */
const PAGE_BUDGET_PX = 48_000_000;
/**
 * A page this costly to parse, or with this many objects, gets no quick preview: drawing even a
 * small one walks every object, so it would cost about as much as the real render.
 */
const OBJECT_HEAVY_PARSE_MS = 300;
const OBJECT_HEAVY_OBJECTS = 100_000;
const MIN_ZOOM = 0.1;
/** Highest zoom (Preferences › Document › Maximum Zoom), as a scale. */
const maxZoom = () => settings.get().maxZoom / 100;
/** Gap between pages in continuous layout, in points. */
const PAGE_GAP = 24;
/** Screen space (CSS px) kept above the first page and below the last when scrolled to the end. */
const SCROLL_MARGIN = 16;
/** Smallest scrollbar thumb, in CSS px. */
const MIN_THUMB = 24;
/** Canvas filters for Dark Mode (inverted, hues kept) and the Dimmer. */
const PAGE_FILTERS = { dark: 'invert(1) hue-rotate(180deg)', dim: 'brightness(0.65)' } as const;

/** How pages are coloured on screen: as printed, inverted for night work, or dimmed. */
export type PageFilter = 'none' | 'dark' | 'dim';

/** Navigation tools the viewer handles itself (Zoom tool, Dynamic Zoom, Pan). */
export type NavTool = 'zoomBox' | 'dynamicZoom' | 'pan' | null;

/** A view to copy into another pane: the page, the page point at the centre, and points per CSS px. */
export interface PageView {
  pageIndex: number;
  centre: PagePoint;
  zoom: number;
  rotation: number;
}

/** One page at a time; all pages in a scrolling column; or sheets joined at match lines. */
export type LayoutMode = 'single' | 'continuous' | 'stitch';

export interface ViewerStats {
  /** The page in focus: the displayed page, or in a stitched view the sheet at the centre. */
  pageIndex: number;
  pageCount: number;
  zoom: number;
  mode: LayoutMode;
  /** View rotation in clockwise quarter turns. */
  rotation: number;
}

/** Tile cache and render timings, for the development overlay. */
export interface ViewerDiagnostics {
  cachedTiles: number;
  queuedTiles: number;
  lastTileMs: number;
  avgTileMs: number;
  tilesRendered: number;
  /** Renders stopped because their tile or page left the view first. */
  cancelled: number;
}

/** What drawing a page has cost so far, learned from its renders. */
export interface PageCost {
  pageIndex: number;
  /** Parsing its content (the first render of it pays this). */
  parseMs: number;
  /** Top-level objects on the page as drawn. */
  objects: number;
  /** The last whole-page render: drawing time without parsing, and its size in megapixels. */
  pageMs: number;
  pageMpx: number;
  /** Drawn from the optimised render copy. */
  fromCopy: boolean;
}

const objectHeavy = (c: PageCost | undefined) => !!c && (c.parseMs >= OBJECT_HEAVY_PARSE_MS || c.objects >= OBJECT_HEAVY_OBJECTS);

export type PagePoint = [x: number, y: number];

export type { Affine };

/** Keeps the part of a sheet with dot(p - point, normal) >= 0 (page space). */
export interface HalfPlane {
  point: readonly [number, number];
  normal: readonly [number, number];
}

/** Where a page sits in the view's world space. */
export interface PagePlacement {
  pageIndex: number;
  toWorld: Affine;
  clips: readonly HalfPlane[];
  /** The part of the page shown (page space), before the clips cut it; the whole page when absent. */
  region?: readonly (readonly [number, number])[];
}

export interface ViewState {
  pageIndex: number;
  zoom: number;
  panX: number;
  panY: number;
  mode: LayoutMode;
}

/**
 * Content drawn above the pages (markups, tool previews) that can also claim pointer input.
 * `draw` is called once per visible page with the context mapped to that page's space (PDF points,
 * top-left origin); `zoom` is CSS px per point on that page. Pointer events come in the space of
 * the page under the pointer, or of `activePage()` while the overlay has a gesture on a page.
 */
export interface ViewerOverlay {
  draw(ctx: CanvasRenderingContext2D, pageIndex: number, zoom: number): void;
  /** Return true to claim the gesture; otherwise the viewer pans. */
  pointerDown(e: PointerEvent, pt: PagePoint, pageIndex: number): boolean;
  pointerMove(e: PointerEvent, pt: PagePoint, pageIndex: number): void;
  pointerUp(e: PointerEvent, pt: PagePoint, pageIndex: number): void;
  /**
   * Pointer moved with no gesture in progress (null when it left the canvas). Returns the cursor
   * to show, or null for the default grab cursor.
   */
  hover(pt: PagePoint | null, pageIndex: number): string | null;
  /** True when a markup is under the point; Pan still lets the overlay take a press there. */
  hitsMarkup?(pt: PagePoint, pageIndex: number): boolean;
  /** Page whose coordinates the overlay needs even when the pointer is over another sheet. */
  activePage(): number | null;
  /** A press the overlay claimed was taken back (it became a pinch or a long press). */
  pointerCancel?(): void;
}

interface TileJob {
  key: string;
  /** A tile; a whole page at the view's level; or a quick low-res page to show meanwhile. */
  kind: 'tile' | 'page' | 'quick';
  pageIndex: number;
  scale: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Screen distance from the viewport centre, for ordering (quick previews come first). */
  dist: number;
}

/** A whole page drawn as one image: the view's own level, or a quick preview under the tiles. */
interface PageImage {
  bitmap: ImageBitmap;
  scale: number;
  /** Drawn from content that has since changed (now drawn from the render copy): shown until replaced. */
  stale: boolean;
}

interface Placed extends PagePlacement {
  fromWorld: Affine;
  scale: number;
}


/** A "nice" ruler step (1, 2 or 5 × 10ⁿ) of at least `min`. */
function niceStep(min: number): number {
  const p = 10 ** Math.floor(Math.log10(min));
  for (const k of [1, 2, 5, 10]) if (k * p >= min) return k * p;
  return 10 * p;
}

/** Ruler units for a page: how many ruler units one PDF point is, and their name. */
export interface RulerUnits {
  perPoint: number;
  unit: string;
}

/** Ruler thickness in CSS px. */
const RULER = 18;

/** The page rectangle (or its region) cut down by half-planes (Sutherland–Hodgman), in page space. */
function clipPolygon(width: number, height: number, clips: readonly HalfPlane[], region?: PagePlacement['region']): [number, number][] {
  let poly: [number, number][] = region?.length
    ? region.map((p): [number, number] => [p[0], p[1]])
    : [
        [0, 0],
        [width, 0],
        [width, height],
        [0, height],
      ];
  for (const { point, normal } of clips) {
    const side = (p: [number, number]) => (p[0] - point[0]) * normal[0] + (p[1] - point[1]) * normal[1];
    const next: [number, number][] = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]!;
      const b = poly[(i + 1) % poly.length]!;
      const sa = side(a);
      const sb = side(b);
      if (sa >= 0) next.push(a);
      if (sa >= 0 !== sb >= 0) {
        const t = sa / (sa - sb);
        next.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    }
    poly = next;
  }
  return poly;
}

function insidePolygon([x, y]: readonly [number, number], poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Canvas viewer for one page, a continuous column of pages, or several sheets joined into one
 * view (a stitched plan set). Pages
 * are drawn as fixed-size tiles at quantized zoom levels, so tiles are reused across nearby
 * zooms, over a low-res preview. The camera works in world space: in single-page mode that is
 * simply the page's own space.
 */
export class TileViewer {
  private ctx: CanvasRenderingContext2D;
  private doc: PdfDocument | null = null;
  /** Page in focus: the displayed page, or the sheet at the centre of a stitched view. */
  private pageIndex = 0;
  private placements: Placed[] = [];
  /** Remembered so Back can return to a stitched view. */
  private stitchLayout: PagePlacement[] | null = null;
  private mode: LayoutMode = 'single';
  /** How pages show when not stitched. */
  private pageMode: 'single' | 'continuous' = 'single';
  /** CSS pixels per world unit. */
  private zoom = 1;
  /** Screen position (CSS px) of the world origin. */
  private panX = 0;
  private panY = 0;

  private tiles = new Map<string, ImageBitmap>();
  private tilePixels = 0;
  /** Renders handed to the worker, by key, with what stops them. */
  private inFlight = new Map<string, AbortController>();
  /** Tiles that failed to render: not retried until the tile cache is cleared. */
  private failed = new Set<string>();
  private queue: TileJob[] = [];
  /** Whole-page images by page; Map order doubles as LRU order. */
  private previews = new Map<number, PageImage>();
  private previewPixels = 0;
  /** What each page has cost to draw, for scheduling and the slow-drawing prompt. */
  private costs = new Map<number, PageCost>();
  private costListeners = new Set<(cost: PageCost) => void>();
  private frame = 0;
  private generation = 0;
  private tileTimes: number[] = [];
  private tilesRendered = 0;
  private cancelled = 0;
  private resizeObserver: ResizeObserver;
  private drag: { x: number; y: number; panX: number; panY: number } | null = null;
  private overlay: ViewerOverlay | null = null;
  /** Page the overlay's current gesture is on. */
  private gesturePage: number | null = null;
  /** Vertical scrollbar over the right edge of the canvas. */
  private scrollTrack: HTMLDivElement;
  private scrollThumb: HTMLDivElement;
  /** Scroll geometry from the last frame, for dragging the thumb. */
  private scroll = { total: 0, view: 0, pos: 0, track: 0, thumb: 0 };
  private thumbDrag: { y: number; panY: number } | null = null;
  /** View rotation in clockwise quarter turns (Rotate View); the document itself is unchanged. */
  private turns = 0;
  /** Rulers along the top and left edges, in the units this returns for a page (null: off). */
  private rulerUnits: ((pageIndex: number) => RulerUnits) | null = null;
  /** Full-screen crosshair at the pointer. */
  private crosshair = false;
  /** Pointer position in canvas CSS px, while it is over the canvas. */
  private pointer: { x: number; y: number } | null = null;
  private cursorListeners = new Set<(at: { pageIndex: number; point: PagePoint } | null) => void>();
  /** Pages per row (Side-by-Side) and whether the first page sits alone (Show Cover Page). */
  private columns: 1 | 2 = 1;
  private cover = false;
  private filter: PageFilter = 'none';
  private thinLines = false;
  /** Magnifier power (0: off). */
  private magnify = 0;
  private loupe: { key: string; pageIndex: number; rect: { x: number; y: number; w: number; h: number }; bitmap: ImageBitmap } | null = null;
  private loupeWanted: string | null = null;
  private loupeBusy = false;
  private navTool: NavTool = null;
  /** The Zoom tool's box, in canvas CSS px, while dragging. */
  private zoomBox: { x0: number; y0: number; x1: number; y1: number } | null = null;
  /** Dynamic Zoom's drag: start y and zoom at the start. */
  private dynZoom: { y: number; zoom: number; sx: number; sy: number } | null = null;
  private viewListeners = new Set<() => void>();
  /** Set while a view is applied from elsewhere (synchronised panes), so it is not echoed back. */
  private quietView = false;
  private lastViewKey = '';
  private lastStatsKey = '';
  // Touch: fingers down, the two-finger gesture, a long press waiting to open the menu, and the
  // pen guard (palm rejection). Fingers left over from a pinch are ignored until all lift.
  private touches = new Map<number, Pt>();
  private pinch: { ids: [number, number]; last: [Pt, Pt] } | null = null;
  private touchSpent = new Set<number>();
  private longPress: { id: number; x: number; y: number; timer: number; fired: boolean } | null = null;
  private pens = new PenGuard();
  private syntheticMenus = new WeakSet<Event>();
  /** Lifting the finger after a long press must not also click the menu that opened under it. */
  private swallowTap = false;

  constructor(
    private canvas: HTMLCanvasElement,
    private onStats: (s: ViewerStats) => void,
  ) {
    this.ctx = canvas.getContext('2d')!;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerUp);
    canvas.addEventListener('pointerleave', this.onPointerLeave);
    // The page handles its own pinch and pan; the browser must not scroll or zoom it.
    canvas.style.touchAction = 'none';
    // Registered first, so a press opens one menu: ours after a long press, or the browser's own.
    canvas.addEventListener('contextmenu', this.onContextMenu);
    canvas.addEventListener('touchend', this.onTouchEnd, { passive: false });
    window.addEventListener('nb-theme', this.onTheme);
    this.scrollTrack = document.createElement('div');
    this.scrollTrack.className = 'viewer-vscroll';
    this.scrollTrack.hidden = true;
    this.scrollThumb = document.createElement('div');
    this.scrollThumb.className = 'viewer-vscroll-thumb';
    this.scrollTrack.append(this.scrollThumb);
    this.scrollTrack.addEventListener('pointerdown', this.onTrackDown);
    this.scrollTrack.addEventListener('wheel', this.onWheel, { passive: false });
    this.scrollThumb.addEventListener('pointerdown', this.onThumbDown);
    this.scrollThumb.addEventListener('pointermove', this.onThumbMove);
    this.scrollThumb.addEventListener('pointerup', this.onThumbUp);
    this.scrollThumb.addEventListener('pointercancel', this.onThumbUp);
    canvas.parentElement?.append(this.scrollTrack);
    this.resize();
  }

  destroy() {
    this.resizeObserver.disconnect();
    window.removeEventListener('nb-theme', this.onTheme);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerUp);
    this.canvas.removeEventListener('pointerleave', this.onPointerLeave);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
    this.canvas.removeEventListener('touchend', this.onTouchEnd);
    this.endLongPress();
    cancelAnimationFrame(this.frame);
    this.scrollTrack.remove();
    this.clearTiles();
    this.loupe?.bitmap.close();
    this.loupe = null;
  }

  setOverlay(overlay: ViewerOverlay | null) {
    this.overlay = overlay;
    this.invalidate();
  }

  get currentPageIndex() {
    return this.pageIndex;
  }

  /** CSS px per point on the focused page. */
  get currentZoom() {
    return this.zoomFor(this.pageIndex);
  }

  get isStitched() {
    return this.mode === 'stitch';
  }

  get layoutMode(): LayoutMode {
    return this.mode;
  }

  /** Switches between one page at a time and a continuous scrolling column (leaves stitched views). */
  setPageMode(pageMode: 'single' | 'continuous') {
    this.pageMode = pageMode;
    this.stitchLayout = null;
    this.showPages(this.pageIndex);
  }

  /** CSS px per point on a given page (placements may be scaled). */
  zoomFor(pageIndex: number): number {
    return this.zoom * (this.placementOf(pageIndex)?.scale ?? 1);
  }

  private placementOf(pageIndex: number): Placed | undefined {
    return this.placements.find((p) => p.pageIndex === pageIndex);
  }

  private place(p: PagePlacement): Placed {
    const m = p.toWorld;
    return { ...p, fromWorld: invertAffine(m), scale: Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) };
  }

  pageToWorld(pageIndex: number, pt: PagePoint): PagePoint {
    const p = this.placementOf(pageIndex);
    return p ? applyAffine(p.toWorld, pt) : pt;
  }

  worldToPage(pageIndex: number, pt: PagePoint): PagePoint {
    const p = this.placementOf(pageIndex);
    return p ? applyAffine(p.fromWorld, pt) : pt;
  }

  private clientToWorld(clientX: number, clientY: number): PagePoint {
    const rect = this.canvas.getBoundingClientRect();
    return [(clientX - rect.left - this.panX) / this.zoom, (clientY - rect.top - this.panY) / this.zoom];
  }

  /** Client (viewport) coordinates to a page's space (default: the focused page). */
  clientToPage(clientX: number, clientY: number, pageIndex = this.pageIndex): PagePoint {
    return this.worldToPage(pageIndex, this.clientToWorld(clientX, clientY));
  }

  /** A page-space point to client (viewport) coordinates. */
  pageToClient(pt: PagePoint, pageIndex = this.pageIndex): PagePoint {
    const rect = this.canvas.getBoundingClientRect();
    const [x, y] = this.pageToWorld(pageIndex, pt);
    return [rect.left + this.panX + x * this.zoom, rect.top + this.panY + y * this.zoom];
  }

  /** The sheet whose visible (clipped) area contains a world point. */
  private pageAtWorld(pt: PagePoint): number | null {
    if (this.mode === 'single' && this.placements.length < 2) return this.pageIndex;
    for (let i = this.placements.length - 1; i >= 0; i--) {
      const p = this.placements[i]!;
      const size = this.doc?.pages[p.pageIndex];
      if (size && insidePolygon(applyAffine(p.fromWorld, pt), clipPolygon(size.width, size.height, p.clips, p.region))) return p.pageIndex;
    }
    return null;
  }

  /** The sheet under a point given in another page's space (stitched views), if any. */
  pageUnder(pageIndex: number, pt: PagePoint): number | null {
    return this.pageAtWorld(this.pageToWorld(pageIndex, pt));
  }

  /** Maps a point from one page's space to another's through the shared world space. */
  mapPoint(from: number, to: number, pt: PagePoint): PagePoint {
    return from === to ? pt : this.worldToPage(to, this.pageToWorld(from, pt));
  }

  /** The page under a client point, if any. */
  pageAtClient(clientX: number, clientY: number): number | null {
    return this.pageAtWorld(this.clientToWorld(clientX, clientY));
  }

  /**
   * The page under a client point, or else the nearest one: markups may hang past a page's edge,
   * so a point beside a page still belongs to it.
   */
  pageNearClient(clientX: number, clientY: number): number {
    const pt = this.clientToWorld(clientX, clientY);
    const under = this.pageAtWorld(pt);
    if (under !== null || !this.doc) return under ?? this.pageIndex;
    let best = this.pageIndex;
    let bestDist = Infinity;
    for (const p of this.placements) {
      const size = this.doc.pages[p.pageIndex];
      if (!size) continue;
      const [x, y] = applyAffine(p.fromWorld, pt);
      // Distance in world units, so pages shown at different scales compare fairly.
      const d = Math.hypot(Math.max(0, -x, x - size.width), Math.max(0, -y, y - size.height)) * p.scale;
      if (d < bestDist) {
        bestDist = d;
        best = p.pageIndex;
      }
    }
    return best;
  }

  setDocument(doc: PdfDocument) {
    this.doc = doc;
    this.stitchLayout = null;
    this.clearTiles();
    this.costs.clear();
    this.showPages(0);
  }

  /** Clears the open PDF so the canvas shows an empty stage. */
  clearDocument() {
    this.doc = null;
    this.stitchLayout = null;
    this.placements = [];
    this.pageIndex = 0;
    this.mode = 'single';
    this.clearTiles();
    this.costs.clear();
    this.invalidate();
    this.emitStats();
  }

  /** Single or continuous layout (per `pageMode`), showing page `index`. */
  private showPages(index: number) {
    if (!this.doc) return;
    this.pageIndex = Math.max(0, Math.min(this.doc.pages.length - 1, index));
    this.queue = [];
    // Sizes as shown: a quarter turn swaps width and height.
    const shown = this.doc.pages.map((p) => (this.turns % 2 ? { width: p.height, height: p.width } : p));
    const rows = spreadRows(this.doc.pages.length, this.columns, this.cover);
    /** Places one row of pages side by side, centred in `width`, tops at `y`; returns its height. */
    const placeRow = (row: number[], y: number, width: number, out: Placed[]) => {
      const rowWidth = row.reduce((w, i) => w + shown[i]!.width, 0) + PAGE_GAP * (row.length - 1);
      const rowHeight = Math.max(...row.map((i) => shown[i]!.height));
      // A lone cover page sits where the right-hand page of a spread would.
      let x = this.columns === 2 && this.cover && row.length === 1 && row[0] === 0 ? width / 2 + PAGE_GAP / 2 : (width - rowWidth) / 2;
      for (const i of row) {
        const p = this.doc!.pages[i]!;
        const rot = rotationAffine(this.turns, p.width, p.height);
        out.push(this.place({ pageIndex: i, toWorld: composeAffine([1, 0, 0, 1, x, y + (rowHeight - shown[i]!.height) / 2], rot), clips: [] }));
        x += shown[i]!.width + PAGE_GAP;
      }
      return rowHeight;
    };
    if (this.pageMode === 'single') {
      this.mode = 'single';
      const row = rows.find((r) => r.includes(this.pageIndex)) ?? [this.pageIndex];
      const out: Placed[] = [];
      const width = this.columns === 2 ? Math.max(...row.map((i) => shown[i]!.width)) * 2 + PAGE_GAP : shown[this.pageIndex]!.width;
      placeRow(row, 0, width, out);
      this.placements = out;
      this.fit();
      return;
    }
    const wasContinuous = this.mode === 'continuous';
    this.mode = 'continuous';
    const maxWidth = Math.max(...rows.map((r) => (this.columns === 2 ? Math.max(...r.map((i) => shown[i]!.width)) * 2 + PAGE_GAP : shown[r[0]!]!.width)));
    const out: Placed[] = [];
    let y = 0;
    for (const row of rows) y += placeRow(row, y, maxWidth, out) + PAGE_GAP;
    this.placements = out.sort((a, b) => a.pageIndex - b.pageIndex);
    if (!wasContinuous) this.fitWidth();
    this.scrollToPage(this.pageIndex);
  }

  /** Side-by-Side (two pages per row) and Show Cover Page. */
  setSpread(columns: 1 | 2, cover: boolean) {
    this.columns = columns;
    this.cover = cover;
    if (this.mode !== 'stitch') this.showPages(this.pageIndex);
  }

  get spread(): { columns: 1 | 2; cover: boolean } {
    return { columns: this.columns, cover: this.cover };
  }

  /** Page colours on screen (Dark Mode inverts them, Dimmer darkens them); printing is unaffected. */
  setPageFilter(filter: PageFilter) {
    this.filter = filter;
    this.invalidate();
  }

  get pageFilter(): PageFilter {
    return this.filter;
  }

  /** Disable Line Weights: every line drawn as a hairline. */
  setThinLines(on: boolean) {
    if (on === this.thinLines) return;
    this.thinLines = on;
    this.clearTiles();
    this.invalidate();
  }

  get thinLinesOn() {
    return this.thinLines;
  }

  /** The magnifier (loupe) under the pointer, at `power` times the view's zoom; 0 turns it off. */
  setMagnifier(power: number) {
    this.magnify = power;
    this.loupe?.bitmap.close();
    this.loupe = null;
    this.canvas.classList.toggle('magnifying', power > 0);
    this.invalidate();
  }

  get magnifier() {
    return this.magnify;
  }

  /**
   * Sets the cursor from the overlay at the pointer's last position. Modifier keys change what
   * Highlight does under a still pointer, so the cursor has to follow the key as well as the mouse.
   */
  refreshPointerCursor() {
    if (this.gesturePage !== null || this.drag || this.navTool || !this.pointer || !this.doc || !this.overlay) return;
    const rect = this.canvas.getBoundingClientRect();
    const clientX = rect.left + this.pointer.x;
    const clientY = rect.top + this.pointer.y;
    const page = this.pageAtClient(clientX, clientY);
    if (page === null) return;
    this.canvas.style.cursor = this.overlay.hover(this.clientToPage(clientX, clientY, page), page) || '';
  }

  /** Zoom tool (drag a box, click to zoom in, Alt-click out), Dynamic Zoom (drag up or down) or Pan. */
  setNavTool(tool: NavTool) {
    this.navTool = tool;
    this.zoomBox = null;
    this.dynZoom = null;
    this.canvas.style.cursor = tool === 'zoomBox' ? 'zoom-in' : tool === 'dynamicZoom' ? 'ns-resize' : tool === 'pan' ? 'grab' : '';
  }

  /** Calls `listener` after the view (page, zoom or pan) changes, except changes made by `setPageView`. */
  onViewChange(listener: () => void): () => void {
    this.viewListeners.add(listener);
    return () => this.viewListeners.delete(listener);
  }

  /** The focused page, the page point at the centre of the view and the zoom, for synchronising panes. */
  pageView(): PageView {
    const r = this.canvas.getBoundingClientRect();
    return { pageIndex: this.pageIndex, centre: this.clientToPage(r.left + r.width / 2, r.top + r.height / 2), zoom: this.zoomFor(this.pageIndex), rotation: this.turns };
  }

  /** Shows `view` (from another pane): its page, centred on its point at its zoom. Does not notify listeners. */
  setPageView(view: PageView) {
    if (!this.doc) return;
    const index = Math.max(0, Math.min(this.doc.pages.length - 1, view.pageIndex));
    if (view.rotation !== this.turns) this.rotateView(view.rotation - this.turns);
    if (!this.placementOf(index)) this.showPages(index);
    this.pageIndex = index;
    const scale = this.placementOf(index)?.scale ?? 1;
    this.zoom = Math.max(MIN_ZOOM, Math.min(maxZoom(), view.zoom / scale));
    const [wx, wy] = this.pageToWorld(index, view.centre);
    this.panX = this.canvas.clientWidth / 2 - wx * this.zoom;
    this.panY = this.canvas.clientHeight / 2 - wy * this.zoom;
    this.quietView = true;
    this.invalidate();
  }

  /** Zoom so the widest page (as shown, after any view rotation) fills the width. */
  private fitWidth() {
    const widest = Math.max(...(this.doc?.pages.map((p) => (this.turns % 2 ? p.height : p.width)) ?? [1]));
    const maxWidth = this.columns === 2 ? widest * 2 + PAGE_GAP : widest;
    this.zoom = Math.max(MIN_ZOOM, Math.min(maxZoom(), (this.canvas.clientWidth - 48) / maxWidth));
  }

  /** Continuous layout: bring a page's top edge to the top of the viewport. */
  private scrollToPage(index: number) {
    const p = this.placementOf(index);
    if (!p) return;
    const b = this.placementBounds(p);
    this.panX = this.canvas.clientWidth / 2 - (b.x + b.w / 2) * this.zoom;
    this.panY = 16 - b.y * this.zoom;
    this.invalidate();
  }

  /**
   * Lays the stitched set out again (a sheet nudged, a match line edited) without moving the view.
   * Not in a stitched view, or with a different set of sheets, it does nothing (and returns false).
   */
  updateStitch(layout: PagePlacement[]) {
    if (this.mode !== 'stitch' || !this.stitchLayout) return false;
    const pages = (l: readonly PagePlacement[]) => l.map((p) => p.pageIndex).sort((a, b) => a - b).join();
    if (pages(layout) !== pages(this.stitchLayout)) return false;
    this.stitchLayout = layout;
    const rot = rotationAffine(this.turns, 0, 0);
    this.placements = layout.map((p) => this.place({ ...p, toWorld: composeAffine(rot, p.toWorld) }));
    this.invalidate();
    return true;
  }

  /**
   * Shows sheets placed in one continuous view (null returns to single pages). The view opens on
   * `focusPage`, or fitted to the whole set.
   */
  setStitch(layout: PagePlacement[] | null, focusPage?: number) {
    if (!layout || layout.length === 0) {
      this.stitchLayout = null;
      this.showPages(focusPage ?? this.pageIndex);
      return;
    }
    this.stitchLayout = layout;
    this.mode = 'stitch';
    // View rotation turns the whole set about the world origin; fitting recentres it.
    const rot = rotationAffine(this.turns, 0, 0);
    this.placements = layout.map((p) => this.place({ ...p, toWorld: composeAffine(rot, p.toWorld) }));
    this.queue = [];
    if (focusPage !== undefined && this.placementOf(focusPage)) {
      this.pageIndex = focusPage;
      const size = this.doc?.pages[focusPage];
      if (size) this.zoomToRect({ x: 0, y: 0, w: size.width, h: size.height }, 1.05, focusPage);
    } else {
      this.fit();
    }
  }

  goToPage(index: number) {
    if (!this.doc) return;
    if (this.mode === 'continuous') {
      this.pageIndex = Math.max(0, Math.min(this.doc.pages.length - 1, index));
      this.scrollToPage(this.pageIndex);
      return;
    }
    // Within a stitched set, move to the sheet rather than leaving the stitched view.
    if (this.mode === 'stitch' && this.placementOf(index)) {
      this.pageIndex = index;
      const size = this.doc.pages[index]!;
      this.zoomToRect({ x: 0, y: 0, w: size.width, h: size.height }, 1.05, index);
      return;
    }
    this.showPages(index);
  }

  /** The row (spread) holding the focused page, when pages show side by side. */
  private currentRow(): number[] {
    if (!this.doc || this.columns === 1 || this.mode === 'stitch') return [this.pageIndex];
    return spreadRows(this.doc.pages.length, this.columns, this.cover).find((r) => r.includes(this.pageIndex)) ?? [this.pageIndex];
  }

  nextPage() {
    this.goToPage(this.currentRow().at(-1)! + 1);
  }

  prevPage() {
    const row = this.currentRow();
    if (row[0]! > 0) this.goToPage(row[0]! - 1);
  }

  /** World-space bounds of one placed sheet (its visible part). */
  private placementBounds(p: Placed) {
    const size = this.doc?.pages[p.pageIndex];
    const pts = size ? clipPolygon(size.width, size.height, p.clips, p.region).map((c) => applyAffine(p.toWorld, c)) : [];
    const xs = pts.map((q) => q[0]);
    const ys = pts.map((q) => q[1]);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }

  /** A page's size in points, or null without a document. */
  pageSize(pageIndex: number): { width: number; height: number } | null {
    return this.doc?.pages[pageIndex] ?? null;
  }

  /** Clockwise quarter turns the view is rotated by. */
  get rotation(): number {
    return this.turns;
  }

  /** Rotates the view (not the document) by quarter turns; positive is clockwise. */
  rotateView(quarterTurns: number) {
    this.turns = (((this.turns + quarterTurns) % 4) + 4) % 4;
    if (!this.doc) return;
    if (this.mode === 'stitch' && this.stitchLayout) this.setStitch(this.stitchLayout, this.pageIndex);
    else {
      const wasContinuous = this.mode === 'continuous';
      this.showPages(this.pageIndex);
      if (wasContinuous) {
        this.fitWidth();
        this.scrollToPage(this.pageIndex);
      }
    }
  }

  /** Shows rulers measuring in the units `units` gives for the focused page; null hides them. */
  setRulers(units: ((pageIndex: number) => RulerUnits) | null) {
    this.rulerUnits = units;
    this.invalidate();
  }

  setCrosshair(on: boolean) {
    this.crosshair = on;
    this.invalidate();
  }

  /** Calls `listener` with the page point under the pointer as it moves (null when it leaves). */
  onCursor(listener: (at: { pageIndex: number; point: PagePoint } | null) => void): () => void {
    this.cursorListeners.add(listener);
    return () => this.cursorListeners.delete(listener);
  }

  /** World-space bounds of everything shown. */
  private worldBounds() {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const p of this.placements) {
      const size = this.doc?.pages[p.pageIndex];
      if (!size) continue;
      for (const c of clipPolygon(size.width, size.height, p.clips, p.region)) {
        const [x, y] = applyAffine(p.toWorld, c);
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  fit() {
    if (this.mode === 'continuous') {
      this.fitWidth();
      this.scrollToPage(this.pageIndex);
      return;
    }
    const b = this.worldBounds();
    if (!Number.isFinite(b.w)) return;
    const { clientWidth: cw, clientHeight: ch } = this.canvas;
    const margin = 24;
    this.zoom = Math.max(MIN_ZOOM, Math.min((cw - margin * 2) / b.w, (ch - margin * 2) / b.h));
    this.panX = (cw - b.w * this.zoom) / 2 - b.x * this.zoom;
    this.panY = (ch - b.h * this.zoom) / 2 - b.y * this.zoom;
    this.invalidate();
  }

  /** Zoom so the page fills the viewport width. */
  fitToWidth() {
    this.fitWidth();
    if (this.mode === 'continuous') this.scrollToPage(this.pageIndex);
    else this.invalidate();
  }

  /** 100% zoom (one CSS pixel per PDF point). */
  actualSize() {
    this.zoomBy(1 / this.zoom);
  }

  /** Current page and camera, for back/forward navigation. */
  getView(): ViewState {
    return { pageIndex: this.pageIndex, zoom: this.zoom, panX: this.panX, panY: this.panY, mode: this.mode };
  }

  setView(view: ViewState) {
    if (view.mode === 'stitch' && this.stitchLayout) {
      if (this.mode !== 'stitch') this.setStitch(this.stitchLayout);
      this.pageIndex = view.pageIndex;
    } else if (view.mode !== 'stitch' && (this.mode !== view.mode || view.pageIndex !== this.pageIndex)) {
      this.pageMode = view.mode === 'continuous' ? 'continuous' : 'single';
      this.showPages(view.pageIndex);
    }
    this.zoom = view.zoom;
    this.panX = view.panX;
    this.panY = view.panY;
    this.invalidate();
  }

  /** Centers and zooms to a rect in a page's space, with `margin` (1 = edge to edge) around it. */
  zoomToRect(r: { x: number; y: number; w: number; h: number }, margin = 1.3, pageIndex = this.pageIndex) {
    const corners = [
      [r.x, r.y],
      [r.x + r.w, r.y],
      [r.x + r.w, r.y + r.h],
      [r.x, r.y + r.h],
    ].map((c) => this.pageToWorld(pageIndex, c as PagePoint));
    const xs = corners.map((c) => c[0]);
    const ys = corners.map((c) => c[1]);
    const w = Math.max(...xs) - Math.min(...xs);
    const h = Math.max(...ys) - Math.min(...ys);
    const { clientWidth: cw, clientHeight: ch } = this.canvas;
    this.zoom = Math.max(MIN_ZOOM, Math.min(maxZoom(), Math.min(cw / (w * margin), ch / (h * margin))));
    this.panX = cw / 2 - ((Math.max(...xs) + Math.min(...xs)) / 2) * this.zoom;
    this.panY = ch / 2 - ((Math.max(...ys) + Math.min(...ys)) / 2) * this.zoom;
    this.invalidate();
  }

  /** Zooms `notches` flat steps of `stepPercent` percentage points (negative zooms out). */
  zoomSteps(stepPercent: number, notches: number, sx?: number, sy?: number) {
    this.zoomBy(steppedZoom(this.zoom, stepPercent, notches) / this.zoom, sx, sy);
  }

  /** Zooms by `factor` keeping the screen point (sx, sy) fixed; defaults to canvas center. */
  zoomBy(factor: number, sx = this.canvas.clientWidth / 2, sy = this.canvas.clientHeight / 2) {
    const next = Math.max(MIN_ZOOM, Math.min(maxZoom(), this.zoom * factor));
    const k = next / this.zoom;
    this.panX = sx - (sx - this.panX) * k;
    this.panY = sy - (sy - this.panY) * k;
    this.zoom = next;
    this.invalidate();
  }

  private clearTiles() {
    for (const bmp of this.tiles.values()) bmp.close();
    this.tiles.clear();
    this.tilePixels = 0;
    this.queue = [];
    this.failed.clear();
    this.generation++;
    for (const c of this.inFlight.values()) c.abort();
    this.inFlight.clear();
    for (const p of this.previews.values()) p.bitmap.close();
    this.previews.clear();
    this.previewPixels = 0;
  }

  /**
   * Redraws pages whose content changed under the viewer (they are now drawn from an optimised
   * copy): their tiles go, and their page images stay on screen until replaced.
   */
  refreshPages(pages: Iterable<number>) {
    const set = new Set(pages);
    for (const [key, bmp] of this.tiles) {
      if (!set.has(Number(key.slice(0, key.indexOf(':'))))) continue;
      this.tilePixels -= bmp.width * bmp.height;
      bmp.close();
      this.tiles.delete(key);
    }
    for (const [key, c] of this.inFlight) if (set.has(Number(key.slice(0, key.indexOf(':'))))) c.abort();
    for (const i of set) {
      const p = this.previews.get(i);
      if (p) p.stale = true;
      this.costs.delete(i);
    }
    this.invalidate();
  }

  /** What drawing each page has cost, as far as the viewer has drawn it. */
  pageCosts(): PageCost[] {
    return [...this.costs.values()];
  }

  /** Called with a page's cost each time a render of it teaches something new. */
  onPageCost(listener: (cost: PageCost) => void): () => void {
    this.costListeners.add(listener);
    return () => this.costListeners.delete(listener);
  }

  private learn(job: TileJob, r: RenderResult) {
    const prev = this.costs.get(job.pageIndex);
    const cost: PageCost = {
      pageIndex: job.pageIndex,
      // Parsed once and then cached in the worker: keep the first (real) parse time.
      parseMs: r.parseMs || (prev?.fromCopy === r.fromCopy ? prev.parseMs : 0),
      objects: r.objects,
      pageMs: prev?.pageMs ?? 0,
      pageMpx: prev?.pageMpx ?? 0,
      fromCopy: r.fromCopy,
    };
    if (job.kind !== 'tile') {
      cost.pageMs = r.ms - r.parseMs;
      cost.pageMpx = (job.w * job.h) / 1e6;
    }
    this.costs.set(job.pageIndex, cost);
    for (const l of this.costListeners) l(cost);
  }

  /** Keeps a finished whole-page image, dropping the least recently drawn beyond the budget. */
  private keepPageImage(pageIndex: number, image: PageImage) {
    const old = this.previews.get(pageIndex);
    if (old) {
      this.previewPixels -= old.bitmap.width * old.bitmap.height;
      old.bitmap.close();
      this.previews.delete(pageIndex);
    }
    this.previews.set(pageIndex, image);
    this.previewPixels += image.bitmap.width * image.bitmap.height;
    for (const [i, p] of this.previews) {
      if (this.previewPixels <= PAGE_BUDGET_PX) break;
      if (i === pageIndex || i === this.pageIndex) continue;
      this.previewPixels -= p.bitmap.width * p.bitmap.height;
      p.bitmap.close();
      this.previews.delete(i);
    }
  }

  private resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(this.canvas.clientWidth * dpr);
    const h = Math.round(this.canvas.clientHeight * dpr);
    if (w === this.canvas.width && h === this.canvas.height) return;
    // Resizing a canvas clears it. ResizeObserver runs after the frame's animation callbacks and
    // before paint, so redrawing in the next frame would paint the cleared canvas: a flash while a
    // panel is dragged. Redraw right here instead.
    this.canvas.width = w;
    this.canvas.height = h;
    cancelAnimationFrame(this.frame);
    this.draw();
  }

  /** Drops rendered tiles and previews, e.g. after annotations were hidden in the document. */
  clearCache() {
    this.clearTiles();
    this.invalidate();
  }

  /** The theme changed: the pasteboard behind the pages has a new colour. */
  private onTheme = () => this.invalidate();

  invalidate() {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.draw());
  }

  /** Device px per point, snapped to half-powers of two so tiles are reused across small zoom changes. */
  private levelScale(pxPerPoint: number): number {
    const dpr = window.devicePixelRatio || 1;
    return 2 ** (Math.ceil(Math.log2(pxPerPoint * dpr) * 2) / 2);
  }

  private draw() {
    const { ctx, canvas } = this;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = deskColour();
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!this.doc) {
      this.scrollTrack.hidden = true;
      return;
    }

    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    this.clampScroll();
    // With several pages on screen, the focused page follows the centre of the screen.
    if (this.mode !== 'single') {
      const centre = this.pageAtWorld([(cw / 2 - this.panX) / this.zoom, (ch / 2 - this.panY) / this.zoom]);
      if (centre !== null) this.pageIndex = centre;
    }

    const wanted: TileJob[] = [];
    /** Every render this frame still needs, coming or not: renders in flight for anything else are stopped. */
    const needed = new Set<string>();
    /** Pages near enough the view that their markups may show, for the overlay pass. */
    const drawn: Placed[] = [];
    const screenToWorld = (sx: number, sy: number): PagePoint => [(sx - this.panX) / this.zoom, (sy - this.panY) / this.zoom];
    const viewCorners = [screenToWorld(0, 0), screenToWorld(cw, 0), screenToWorld(cw, ch), screenToWorld(0, ch)];

    for (const p of this.placements) {
      const size = this.doc.pages[p.pageIndex];
      if (!size) continue;
      // Visible part of this page, in page space.
      const vis = viewCorners.map((c) => applyAffine(p.fromWorld, c));
      const x0 = Math.max(0, Math.min(...vis.map((v) => v[0])));
      const y0 = Math.max(0, Math.min(...vis.map((v) => v[1])));
      const x1 = Math.min(size.width, Math.max(...vis.map((v) => v[0])));
      const y1 = Math.min(size.height, Math.max(...vis.map((v) => v[1])));
      if (x1 <= x0 || y1 <= y0) {
        // Markups can sit past the page edge (as Revu allows), so a page just off screen may still
        // have some in view: allow half a page of slack around it.
        const mx = size.width / 2;
        const my = size.height / 2;
        const near = vis.some((v) => v[0] > -mx) && vis.some((v) => v[0] < size.width + mx) && vis.some((v) => v[1] > -my) && vis.some((v) => v[1] < size.height + my);
        if (near) drawn.push(p);
        continue;
      }

      const m = p.toWorld;
      const poly = clipPolygon(size.width, size.height, p.clips, p.region);
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.translate(this.panX, this.panY);
      ctx.scale(this.zoom, this.zoom);
      ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
      ctx.beginPath();
      poly.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      if (this.mode !== 'stitch') {
        ctx.shadowColor = 'rgba(0,0,0,0.4)';
        ctx.shadowBlur = 8;
      }
      ctx.fillStyle = this.filter === 'dark' ? '#1b1c1f' : this.filter === 'dim' ? '#a6a6a6' : '#fff';
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.clip();
      if (this.filter !== 'none') ctx.filter = PAGE_FILTERS[this.filter];
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      const thin = this.thinLines ? ':thin' : '';
      /** Asks for a render unless it is already coming (or failed); `key` stays needed either way. */
      const want = (job: TileJob) => {
        needed.add(job.key);
        if (!this.inFlight.has(job.key) && !this.failed.has(job.key)) wanted.push(job);
      };
      const preview = this.previews.get(p.pageIndex);
      if (preview) {
        // Touch for LRU.
        this.previews.delete(p.pageIndex);
        this.previews.set(p.pageIndex, preview);
        ctx.drawImage(preview.bitmap, 0, 0, size.width, size.height);
      }

      const pxPerPoint = this.zoom * p.scale;
      const s = this.levelScale(pxPerPoint);
      const pageDevW = Math.ceil(size.width * s);
      const pageDevH = Math.ceil(size.height * s);
      const [cx, cy] = applyAffine(m, [size.width / 2, size.height / 2]);
      const pageDist = Math.hypot(this.panX + cx * this.zoom - cw / 2, this.panY + cy * this.zoom - ch / 2);
      if (pageDevW * pageDevH <= WHOLE_PAGE_MAX_PX) {
        // Zoomed out: the whole page as one image at this level, no tiles.
        if (!preview || preview.stale || preview.scale !== s) {
          want({ key: `${p.pageIndex}:${s}:page${thin}`, kind: 'page', pageIndex: p.pageIndex, scale: s, x: 0, y: 0, w: pageDevW, h: pageDevH, dist: pageDist });
        }
      } else {
        // A quick look at the page while its tiles come, unless that costs as much as they do.
        if (!preview && !objectHeavy(this.costs.get(p.pageIndex))) {
          const q = QUICK_PX / Math.max(size.width, size.height);
          want({ key: `${p.pageIndex}:quick${thin}`, kind: 'quick', pageIndex: p.pageIndex, scale: q, x: 0, y: 0, w: Math.ceil(size.width * q), h: Math.ceil(size.height * q), dist: -1 });
        }
        const tilePts = TILE / s;
        // Rotated tiles leave hairline seams at their edges; overdraw each by one device pixel.
        const bleed = 1 / (pxPerPoint * dpr);
        for (let ty = Math.floor(y0 / tilePts); ty * tilePts < y1; ty++) {
          for (let tx = Math.floor(x0 / tilePts); tx * tilePts < x1; tx++) {
            const dx = tx * TILE;
            const dy = ty * TILE;
            const w = Math.min(TILE, pageDevW - dx);
            const h = Math.min(TILE, pageDevH - dy);
            if (w <= 0 || h <= 0) continue;
            const key = `${p.pageIndex}:${s}:${tx}:${ty}${thin}`;
            const bmp = this.tiles.get(key);
            if (bmp) {
              // Touch for LRU.
              this.tiles.delete(key);
              this.tiles.set(key, bmp);
              ctx.drawImage(bmp, dx / s, dy / s, w / s + bleed, h / s + bleed);
            } else {
              const [wx, wy] = applyAffine(m, [(dx + w / 2) / s, (dy + h / 2) / s]);
              const dist = Math.hypot(this.panX + wx * this.zoom - cw / 2, this.panY + wy * this.zoom - ch / 2);
              want({ key, kind: 'tile', pageIndex: p.pageIndex, scale: s, x: dx, y: dy, w, h, dist });
            }
          }
        }
      }
      ctx.filter = 'none';
      ctx.restore();
      drawn.push(p);
    }

    // Markups draw after every sheet's content, unclipped: a comment can hang past the page edge
    // (as Revu draws it), and in a stitched view a measurement or cloud spanning a match line shows
    // on both sheets.
    for (const p of drawn) {
      const m = p.toWorld;
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.translate(this.panX, this.panY);
      ctx.scale(this.zoom, this.zoom);
      ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
      this.overlay?.draw(ctx, p.pageIndex, this.zoom * p.scale);
      ctx.restore();
    }

    if (this.magnify > 0 && this.pointer) this.drawLoupe(dpr);
    if (this.zoomBox) {
      const b = this.zoomBox;
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.strokeStyle = '#2ec4b6';
      ctx.fillStyle = 'rgba(46, 196, 182, 0.12)';
      ctx.setLineDash([4, 3]);
      const x = Math.min(b.x0, b.x1);
      const y = Math.min(b.y0, b.y1);
      ctx.fillRect(x, y, Math.abs(b.x1 - b.x0), Math.abs(b.y1 - b.y0));
      ctx.strokeRect(x + 0.5, y + 0.5, Math.abs(b.x1 - b.x0), Math.abs(b.y1 - b.y0));
      ctx.restore();
    }

    if (this.crosshair && this.pointer) {
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.strokeStyle = 'rgba(217, 70, 239, 0.8)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, Math.round(this.pointer.y) + 0.5);
      ctx.lineTo(cw, Math.round(this.pointer.y) + 0.5);
      ctx.moveTo(Math.round(this.pointer.x) + 0.5, 0);
      ctx.lineTo(Math.round(this.pointer.x) + 0.5, ch);
      ctx.stroke();
      ctx.restore();
    }
    if (this.rulerUnits) this.drawRulers(dpr, cw, ch);

    // Tiles still to come: say so, as a blank page reads as broken.
    if (wanted.length + this.inFlight.size > 0) this.drawLoading(dpr, cw, ch);

    wanted.sort((a, b) => a.dist - b.dist);
    this.queue = wanted;
    // Scrolled or zoomed past: stop what is still being drawn for the old view.
    for (const [key, c] of this.inFlight) {
      if (needed.has(key)) continue;
      c.abort();
      this.inFlight.delete(key);
    }
    this.pump();
    this.emitStats();
    const viewKey = `${this.pageIndex}:${this.zoom}:${this.panX}:${this.panY}:${this.turns}:${cw}:${ch}`;
    if (viewKey !== this.lastViewKey) {
      this.lastViewKey = viewKey;
      if (!this.quietView) for (const l of this.viewListeners) l();
    }
    this.quietView = false;
  }

  /** A small "Loading" pill at the bottom of the view while page content is still being drawn. */
  private drawLoading(dpr: number, cw: number, ch: number) {
    const { ctx } = this;
    const label = 'Loading page…';
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = '12px system-ui, sans-serif';
    const w = ctx.measureText(label).width + 28;
    const h = 24;
    const x = (cw - w) / 2;
    const y = ch - h - 16;
    ctx.fillStyle = 'rgba(20, 22, 26, 0.85)';
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, h / 2);
    ctx.fill();
    // A spinner arc, turning with the clock; the view redraws on each tile, and the app keeps
    // animating while tiles are pending.
    const a = (performance.now() / 250) % (Math.PI * 2);
    ctx.strokeStyle = '#2ec4b6';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x + 14, y + h / 2, 5, a, a + Math.PI * 1.4);
    ctx.stroke();
    ctx.fillStyle = '#e6e8eb';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + 24, y + h / 2 + 0.5);
    ctx.restore();
    this.invalidate();
  }

  /**
   * The magnifier: a circle at the pointer showing the page under it at `magnify` times the zoom,
   * rendered sharp for that zoom (the last render stays in place while the next one comes).
   */
  private drawLoupe(dpr: number) {
    const { ctx } = this;
    const pointer = this.pointer!;
    const rect = this.canvas.getBoundingClientRect();
    const page = this.pageAtClient(rect.left + pointer.x, rect.top + pointer.y);
    if (page === null || !this.doc) return;
    const size = this.doc.pages[page]!;
    const placed = this.placementOf(page);
    if (!placed) return;
    const radius = 110;
    const k = this.zoom * placed.scale * this.magnify;
    const pt = this.clientToPage(rect.left + pointer.x, rect.top + pointer.y, page);
    // Ask for a render of the region around the pointer (1.5× the loupe, so small moves stay sharp).
    const s = k * dpr;
    const half = (radius * 1.5) / k;
    const grid = half / 2;
    const cx = Math.round(pt[0] / grid) * grid;
    const cy = Math.round(pt[1] / grid) * grid;
    const want = { x: Math.max(0, cx - half), y: Math.max(0, cy - half), w: 0, h: 0 };
    want.w = Math.min(size.width, cx + half) - want.x;
    want.h = Math.min(size.height, cy + half) - want.y;
    const key = `${page}:${s.toFixed(3)}:${want.x.toFixed(1)}:${want.y.toFixed(1)}:${this.thinLines}`;
    if (this.loupe?.key !== key && want.w > 0 && want.h > 0) {
      this.loupeWanted = key;
      if (!this.loupeBusy) {
        this.loupeBusy = true;
        const doc = this.doc;
        void doc
          .renderTile(page, s, Math.floor(want.x * s), Math.floor(want.y * s), Math.max(1, Math.ceil(want.w * s)), Math.max(1, Math.ceil(want.h * s)), { thinLines: this.thinLines, copy: true })
          .then(({ bitmap }) => {
            if (doc !== this.doc || !this.magnify) return bitmap.close();
            this.loupe?.bitmap.close();
            this.loupe = { key, pageIndex: page, rect: { x: Math.floor(want.x * s) / s, y: Math.floor(want.y * s) / s, w: bitmap.width / s, h: bitmap.height / s }, bitmap };
          })
          .catch(() => {})
          .finally(() => {
            this.loupeBusy = false;
            if (this.loupeWanted !== this.loupe?.key) this.invalidate();
          });
      }
    }
    const [wx, wy] = this.pageToWorld(page, pt);
    const m = placed.toWorld;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.beginPath();
    ctx.arc(pointer.x, pointer.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = deskColour();
    ctx.fill();
    ctx.clip();
    ctx.translate(pointer.x, pointer.y);
    ctx.scale(this.zoom * this.magnify, this.zoom * this.magnify);
    ctx.translate(-wx, -wy);
    ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
    ctx.fillStyle = this.filter === 'dark' ? '#1b1c1f' : this.filter === 'dim' ? '#a6a6a6' : '#fff';
    ctx.fillRect(0, 0, size.width, size.height);
    if (this.filter !== 'none') ctx.filter = PAGE_FILTERS[this.filter];
    const preview = this.previews.get(page);
    if (preview) ctx.drawImage(preview.bitmap, 0, 0, size.width, size.height);
    if (this.loupe?.pageIndex === page) ctx.drawImage(this.loupe.bitmap, this.loupe.rect.x, this.loupe.rect.y, this.loupe.rect.w, this.loupe.rect.h);
    ctx.filter = 'none';
    this.overlay?.draw(ctx, page, this.zoom * placed.scale * this.magnify);
    ctx.restore();
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.beginPath();
    ctx.arc(pointer.x, pointer.y, radius, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Rulers along the top and left edges, measuring from the focused page's top-left corner as
   * shown, in its units (a drawing scale gives real-world lengths).
   */
  private drawRulers(dpr: number, cw: number, ch: number) {
    const p = this.placementOf(this.pageIndex);
    if (!p || !this.rulerUnits) return;
    const { ctx } = this;
    const { perPoint, unit } = this.rulerUnits(this.pageIndex);
    const origin = this.placementBounds(p);
    // Ruler units per CSS px on screen.
    const unitsPerPx = perPoint / (this.zoom * p.scale);
    const major = niceStep(unitsPerPx * 70);
    const minor = major / 5;
    const x0 = this.panX + origin.x * this.zoom;
    const y0 = this.panY + origin.y * this.zoom;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = 'rgba(32, 34, 37, 0.92)';
    ctx.fillRect(0, 0, cw, RULER);
    ctx.fillRect(0, 0, RULER, ch);
    ctx.strokeStyle = '#8b9096';
    ctx.fillStyle = '#c9cdd2';
    ctx.font = '10px system-ui, sans-serif';
    ctx.lineWidth = 1;
    const label = (v: number) => `${Number(v.toFixed(6))}`;
    ctx.beginPath();
    // Top ruler.
    for (let v = Math.ceil(((RULER - x0) * unitsPerPx) / minor) * minor; (x0 + v / unitsPerPx) < cw; v += minor) {
      const x = Math.round(x0 + v / unitsPerPx) + 0.5;
      const isMajor = Math.abs(v / major - Math.round(v / major)) < 1e-6;
      ctx.moveTo(x, RULER);
      ctx.lineTo(x, isMajor ? 4 : RULER - 5);
      if (isMajor) ctx.fillText(label(v), x + 3, 11);
    }
    // Left ruler, labels rotated to read upward.
    for (let v = Math.ceil(((RULER - y0) * unitsPerPx) / minor) * minor; (y0 + v / unitsPerPx) < ch; v += minor) {
      const y = Math.round(y0 + v / unitsPerPx) + 0.5;
      const isMajor = Math.abs(v / major - Math.round(v / major)) < 1e-6;
      ctx.moveTo(RULER, y);
      ctx.lineTo(isMajor ? 4 : RULER - 5, y);
      if (isMajor) {
        ctx.save();
        ctx.translate(11, y - 3);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText(label(v), 0, 0);
        ctx.restore();
      }
    }
    ctx.stroke();
    // Where the pointer is, on both rulers.
    if (this.pointer) {
      ctx.strokeStyle = '#d946ef';
      ctx.beginPath();
      ctx.moveTo(Math.round(this.pointer.x) + 0.5, 0);
      ctx.lineTo(Math.round(this.pointer.x) + 0.5, RULER);
      ctx.moveTo(0, Math.round(this.pointer.y) + 0.5);
      ctx.lineTo(RULER, Math.round(this.pointer.y) + 0.5);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(32, 34, 37, 1)';
    ctx.fillRect(0, 0, RULER, RULER);
    ctx.fillStyle = '#8b9096';
    ctx.font = '9px system-ui, sans-serif';
    ctx.fillText(unit, 2, 12);
    ctx.restore();
  }

  /**
   * Keeps the view from scrolling above the top of the first page or below the bottom of the last
   * (content shorter than the view stays within it), and updates the scrollbar to match. A single
   * page can be scrolled until its top or bottom edge is in the middle of the view, so either end
   * can be worked on in the centre of the screen.
   */
  private clampScroll() {
    const b = this.worldBounds();
    const ch = this.canvas.clientHeight;
    if (!Number.isFinite(b.h) || ch <= 0) {
      this.scrollTrack.hidden = true;
      return;
    }
    const margin = this.mode === 'single' ? Math.max(SCROLL_MARGIN, ch / 2) : SCROLL_MARGIN;
    const top = margin - b.y * this.zoom;
    const bottom = ch - margin - (b.y + b.h) * this.zoom;
    this.panY = Math.max(Math.min(top, bottom), Math.min(Math.max(top, bottom), this.panY));

    const total = b.h * this.zoom + margin * 2;
    // The scrollbar shows once the page itself is taller than the view, not for the extra room.
    const hidden = b.h * this.zoom + SCROLL_MARGIN * 2 <= ch + 0.5;
    this.scrollTrack.hidden = hidden;
    if (hidden) return;
    const track = this.scrollTrack.clientHeight || ch;
    const thumb = Math.max(MIN_THUMB, (track * ch) / total);
    const pos = top - this.panY;
    this.scroll = { total, view: ch, pos, track, thumb };
    this.scrollThumb.style.height = `${thumb}px`;
    this.scrollThumb.style.transform = `translateY(${(pos / (total - ch)) * (track - thumb)}px)`;
  }

  /** Scrolls the view by `dy` CSS px (positive moves down the document). */
  scrollBy(dy: number) {
    this.panY -= dy;
    this.invalidate();
  }

  private onThumbDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    this.scrollThumb.setPointerCapture(e.pointerId);
    this.thumbDrag = { y: e.clientY, panY: this.panY };
    this.scrollTrack.classList.add('dragging');
  };

  private onThumbMove = (e: PointerEvent) => {
    if (!this.thumbDrag) return;
    const { total, view, track, thumb } = this.scroll;
    const k = track > thumb ? (total - view) / (track - thumb) : 0;
    this.panY = this.thumbDrag.panY - (e.clientY - this.thumbDrag.y) * k;
    this.invalidate();
  };

  private onThumbUp = () => {
    this.thumbDrag = null;
    this.scrollTrack.classList.remove('dragging');
  };

  /** A click on the track, above or below the thumb, pages up or down. */
  private onTrackDown = (e: PointerEvent) => {
    if (e.button !== 0 || e.target !== this.scrollTrack) return;
    e.preventDefault();
    const { total, view, pos, track, thumb } = this.scroll;
    const thumbTop = (pos / (total - view)) * (track - thumb);
    const y = e.clientY - this.scrollTrack.getBoundingClientRect().top;
    this.scrollBy((y < thumbTop ? -1 : 1) * view * 0.9);
  };

  private pump() {
    const doc = this.doc;
    if (!doc) return;
    while (this.inFlight.size < MAX_IN_FLIGHT && this.queue.length) {
      const job = this.queue.shift()!;
      const gen = this.generation;
      const control = new AbortController();
      this.inFlight.set(job.key, control);
      doc
        .renderTile(job.pageIndex, job.scale, job.x, job.y, job.w, job.h, { thinLines: this.thinLines, copy: true, signal: control.signal })
        .then((r) => {
          this.recordTime(r.ms);
          if (gen !== this.generation) return r.bitmap.close();
          // Stopped too late to save the work: what it cost still counts.
          this.learn(job, r);
          if (control.signal.aborted) return r.bitmap.close();
          if (job.kind === 'tile') {
            this.tiles.set(job.key, r.bitmap);
            this.tilePixels += r.bitmap.width * r.bitmap.height;
            this.evict();
          } else {
            const kept = this.previews.get(job.pageIndex);
            // A quick preview never replaces a sharper image that arrived meanwhile.
            if (job.kind === 'quick' && kept && !kept.stale) r.bitmap.close();
            else this.keepPageImage(job.pageIndex, { bitmap: r.bitmap, scale: job.scale, stale: false });
          }
          // Out of flight before the redraw, so the loading pill goes once the last tile lands.
          if (this.inFlight.get(job.key) === control) this.inFlight.delete(job.key);
          this.invalidate();
        })
        .catch((err: unknown) => {
          if (err instanceof Error && err.message === RENDER_CANCELLED) {
            this.cancelled++;
            return;
          }
          if (gen === this.generation) this.failed.add(job.key);
          console.error('Tile render failed', err);
        })
        .finally(() => {
          if (this.inFlight.get(job.key) === control) this.inFlight.delete(job.key);
          this.pump();
          this.invalidate();
        });
    }
  }

  private evict() {
    for (const [key, bmp] of this.tiles) {
      if (this.tilePixels <= TILE_BUDGET_PX) break;
      this.tilePixels -= bmp.width * bmp.height;
      bmp.close();
      this.tiles.delete(key);
    }
  }

  private recordTime(ms: number) {
    this.tilesRendered++;
    this.tileTimes.push(ms);
    if (this.tileTimes.length > 50) this.tileTimes.shift();
  }

  /**
   * Reports the view to the app only when something it shows changed: this runs every frame, and
   * each report re-renders the app.
   */
  private emitStats() {
    const pageCount = this.doc?.pages.length ?? 0;
    const key = `${this.pageIndex}:${pageCount}:${Math.round(this.zoom * 1000)}:${this.mode}:${this.turns}`;
    if (key === this.lastStatsKey) return;
    this.lastStatsKey = key;
    this.onStats({ pageIndex: this.pageIndex, pageCount, zoom: this.zoom, mode: this.mode, rotation: this.turns });
  }

  diagnostics(): ViewerDiagnostics {
    const times = this.tileTimes;
    return {
      cachedTiles: this.tiles.size,
      queuedTiles: this.queue.length + this.inFlight.size,
      lastTileMs: times.at(-1) ?? 0,
      avgTileMs: times.length ? times.reduce((a, b) => a + b, 0) / times.length : 0,
      tilesRendered: this.tilesRendered,
      cancelled: this.cancelled,
    };
  }

  /** True in Pan when the pointer is over a markup, which can still be selected and moved. */
  private panOverMarkup(e: { clientX: number; clientY: number }): boolean {
    if (this.navTool !== 'pan' || !this.doc || !this.overlay?.hitsMarkup) return false;
    const page = this.eventPage(e);
    return this.overlay.hitsMarkup(this.clientToPage(e.clientX, e.clientY, page), page);
  }

  /** Page for an overlay event: the gesture's page, the overlay's active page, or the one under the pointer. */
  private eventPage(e: { clientX: number; clientY: number }): number {
    return this.gesturePage ?? this.overlay?.activePage() ?? this.pageNearClient(e.clientX, e.clientY);
  }

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    // By default the wheel scrolls a continuous column of pages and zooms elsewhere, as in CAD
    // markup tools (Preferences › Navigation). Ctrl+wheel (and trackpad pinch, which arrives as
    // ctrl+wheel) always zooms.
    const wheel = settings.get()[this.mode === 'continuous' ? 'continuousWheel' : 'singlePageWheel'];
    // Preferences › Navigation › Sensitivity: 4 is the browser's own rate.
    const sensitivity = settings.get().wheelSensitivity / 4;
    if (wheel === 'scroll' && !e.ctrlKey) {
      const k = (e.deltaMode === 1 ? 32 : 1) * sensitivity;
      this.panX -= (e.shiftKey ? e.deltaY : e.deltaX) * k;
      this.panY -= (e.shiftKey ? 0 : e.deltaY) * k;
      this.invalidate();
      return;
    }
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    // A mouse-wheel notch (line mode, or a large pixel delta) steps the zoom by the flat amount set
    // in Preferences; trackpad pinch sends small fractional deltas and keeps a smooth rate.
    const notch = e.deltaMode !== 0 || Math.abs(e.deltaY) >= 50;
    if (notch) {
      const prefs = settings.get();
      const notches = Math.max(1, Math.round(Math.abs(e.deltaY) / (e.deltaMode === 1 ? 3 : 100)));
      const dir = -Math.sign(e.deltaY) * (prefs.invertWheelZoom ? -1 : 1);
      this.zoomSteps(e.ctrlKey ? prefs.ctrlWheelZoomStep : prefs.wheelZoomStep, dir * notches, x, y);
      return;
    }
    this.zoomBy(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015 * sensitivity)), x, y);
  };

  private onPointerDown = (e: PointerEvent) => {
    if (e.pointerType === 'pen') this.pens.pen('down', e.timeStamp);
    if (e.pointerType === 'touch' && this.touchDown(e)) return;
    // Ctrl+click is a Mac's right-click: the menu follows, so it must not also start a drawing or a drag.
    if (e.button === 0 && e.ctrlKey && e.pointerType === 'mouse' && isMac()) return;
    this.canvas.setPointerCapture(e.pointerId);
    const page = this.eventPage(e);
    if (e.button === 0 && this.doc && (this.navTool === 'zoomBox' || this.navTool === 'dynamicZoom')) {
      const r = this.canvas.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      if (this.navTool === 'zoomBox') this.zoomBox = { x0: x, y0: y, x1: x, y1: y };
      else this.dynZoom = { y: e.clientY, zoom: this.zoom, sx: x, sy: y };
      return;
    }
    // Once a pen has been used, a single finger pans: the pen draws, a resting hand does not.
    if (e.button === 0 && ((this.navTool === 'pan' && !this.panOverMarkup(e)) || (e.pointerType === 'touch' && this.pens.penUsed))) {
      this.drag = { x: e.clientX, y: e.clientY, panX: this.panX, panY: this.panY };
      this.canvas.style.cursor = 'grabbing';
      return;
    }
    // Middle button always pans, as in CAD tools.
    if (e.button === 0 && this.doc && this.overlay?.pointerDown(e, this.clientToPage(e.clientX, e.clientY, page), page)) {
      this.gesturePage = page;
      return;
    }
    this.drag = { x: e.clientX, y: e.clientY, panX: this.panX, panY: this.panY };
    this.canvas.style.cursor = 'grabbing';
  };

  private onPointerMove = (e: PointerEvent) => {
    if (e.pointerType === 'pen') this.pens.pen('move', e.timeStamp);
    if (e.pointerType === 'touch' && this.touchMove(e)) return;
    this.trackPointer(e);
    if (this.zoomBox) {
      const r = this.canvas.getBoundingClientRect();
      this.zoomBox.x1 = e.clientX - r.left;
      this.zoomBox.y1 = e.clientY - r.top;
      this.invalidate();
      return;
    }
    if (this.dynZoom) {
      // Dragging up zooms in, down zooms out, about the point first pressed.
      const target = Math.max(MIN_ZOOM, Math.min(maxZoom(), this.dynZoom.zoom * Math.exp((this.dynZoom.y - e.clientY) * 0.01)));
      this.zoomBy(target / this.zoom, this.dynZoom.sx, this.dynZoom.sy);
      return;
    }
    if (this.navTool && !this.drag && this.gesturePage === null) {
      if (this.panOverMarkup(e)) {
        const page = this.eventPage(e);
        this.canvas.style.cursor = this.overlay?.hover(this.clientToPage(e.clientX, e.clientY, page), page) || 'pointer';
        return;
      }
      this.canvas.style.cursor = this.navTool === 'zoomBox' ? (e.altKey ? 'zoom-out' : 'zoom-in') : this.navTool === 'dynamicZoom' ? 'ns-resize' : 'grab';
      return;
    }
    if (this.gesturePage !== null) {
      this.overlay?.pointerMove(e, this.clientToPage(e.clientX, e.clientY, this.gesturePage), this.gesturePage);
      return;
    }
    if (!this.drag) {
      const page = this.eventPage(e);
      this.canvas.style.cursor = (this.doc && this.overlay?.hover(this.clientToPage(e.clientX, e.clientY, page), page)) || '';
      return;
    }
    this.panX = this.drag.panX + e.clientX - this.drag.x;
    this.panY = this.drag.panY + e.clientY - this.drag.y;
    this.invalidate();
  };

  private onPointerLeave = () => {
    this.pointer = null;
    for (const l of this.cursorListeners) l(null);
    if (this.crosshair || this.rulerUnits || this.magnify) this.invalidate();
    if (this.gesturePage === null && !this.drag) this.overlay?.hover(null, this.pageIndex);
  };

  /** Remembers the pointer for the crosshair and rulers, and reports its page position. */
  private trackPointer(e: PointerEvent) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    if (this.crosshair || this.rulerUnits || this.magnify) this.invalidate();
    if (!this.doc || !this.cursorListeners.size) return;
    const pageIndex = this.pageAtClient(e.clientX, e.clientY);
    const at = pageIndex === null ? null : { pageIndex, point: this.clientToPage(e.clientX, e.clientY, pageIndex) };
    for (const l of this.cursorListeners) l(at);
  }

  private onPointerUp = (e: PointerEvent) => {
    if (e.pointerType === 'pen') this.pens.pen('up', e.timeStamp);
    if (e.pointerType === 'touch' && this.touchUp(e)) return;
    if (this.zoomBox) {
      const b = this.zoomBox;
      this.zoomBox = null;
      const w = Math.abs(b.x1 - b.x0);
      const h = Math.abs(b.y1 - b.y0);
      if (w < 6 || h < 6) this.zoomBy(e.altKey ? 1 / 1.6 : 1.6, b.x0, b.y0);
      else {
        // The box's centre to the view's centre, its larger side filling the view.
        const k = Math.min(maxZoom() / this.zoom, Math.min(this.canvas.clientWidth / w, this.canvas.clientHeight / h));
        const cx = (b.x0 + b.x1) / 2;
        const cy = (b.y0 + b.y1) / 2;
        this.panX = this.canvas.clientWidth / 2 - (cx - this.panX) * k;
        this.panY = this.canvas.clientHeight / 2 - (cy - this.panY) * k;
        this.zoom *= k;
        this.invalidate();
      }
      return;
    }
    if (this.dynZoom) {
      this.dynZoom = null;
      return;
    }
    if (this.gesturePage !== null) {
      const page = this.gesturePage;
      this.gesturePage = null;
      this.overlay?.pointerUp(e, this.clientToPage(e.clientX, e.clientY, page), page);
      return;
    }
    this.drag = null;
    this.canvas.style.cursor = this.navTool === 'pan' ? 'grab' : '';
  };

  // --- Touch ---------------------------------------------------------------------------------

  /** Handles a finger going down; true when the viewer consumed it (the normal press is skipped). */
  private touchDown(e: PointerEvent): boolean {
    if (this.pens.rejects(e.timeStamp) || this.touchSpent.size) {
      this.touchSpent.add(e.pointerId);
      return true;
    }
    this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.touches.size === 2) {
      // A second finger: whatever the first one started becomes a pinch.
      this.endLongPress();
      if (this.gesturePage !== null) {
        this.gesturePage = null;
        this.overlay?.pointerCancel?.();
      }
      this.drag = null;
      const [a, b] = [...this.touches.entries()];
      this.canvas.setPointerCapture(e.pointerId);
      this.pinch = { ids: [a![0], b![0]], last: [a![1], b![1]] };
      return true;
    }
    if (this.touches.size > 2) {
      this.touchSpent.add(e.pointerId);
      return true;
    }
    this.startLongPress(e);
    return false;
  }

  private touchMove(e: PointerEvent): boolean {
    if (this.touchSpent.has(e.pointerId)) return true;
    if (!this.touches.has(e.pointerId)) return false;
    this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const lp = this.longPress;
    if (lp && lp.id === e.pointerId && Math.hypot(e.clientX - lp.x, e.clientY - lp.y) > LONG_PRESS_SLOP_PX) this.endLongPress();
    if (lp?.fired) return true;
    if (!this.pinch) return false;
    const [a, b] = this.pinch.ids;
    const next: [Pt, Pt] = [this.touches.get(a)!, this.touches.get(b)!];
    const rect = this.canvas.getBoundingClientRect();
    const step = pinchStep(this.pinch.last, next);
    this.pinch.last = next;
    this.panX += step.dx;
    this.panY += step.dy;
    this.zoomBy(step.scale, step.cx - rect.left, step.cy - rect.top);
    return true;
  }

  private touchUp(e: PointerEvent): boolean {
    if (this.touchSpent.delete(e.pointerId)) {
      if (!this.touches.size && !this.touchSpent.size) this.pinch = null;
      return true;
    }
    if (!this.touches.delete(e.pointerId)) return false;
    const fired = this.longPress?.fired && this.longPress.id === e.pointerId;
    if (fired) this.swallowTap = true;
    if (this.longPress?.id === e.pointerId) {
      clearTimeout(this.longPress.timer);
      this.longPress = null;
    }
    if (this.pinch) {
      // The fingers still down wait until they lift; they do not start drawing.
      for (const id of this.touches.keys()) this.touchSpent.add(id);
      this.touches.clear();
      this.pinch = null;
      return true;
    }
    return !!fired;
  }

  private startLongPress(e: PointerEvent) {
    this.endLongPress();
    const at = { id: e.pointerId, x: e.clientX, y: e.clientY, fired: false, timer: 0 };
    at.timer = window.setTimeout(() => {
      if (this.longPress !== at) return;
      at.fired = true;
      // The press becomes the menu, not a drag or a markup.
      if (this.gesturePage !== null) {
        this.gesturePage = null;
        this.overlay?.pointerCancel?.();
      }
      this.drag = null;
      this.canvas.style.cursor = '';
      const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: at.x, clientY: at.y, button: 2, buttons: 0 });
      this.syntheticMenus.add(menu);
      this.canvas.dispatchEvent(menu);
    }, LONG_PRESS_MS);
    this.longPress = at;
  }

  private endLongPress() {
    if (!this.longPress) return;
    clearTimeout(this.longPress.timer);
    if (!this.longPress.fired) this.longPress = null;
  }

  private onTouchEnd = (e: TouchEvent) => {
    if (!this.swallowTap) return;
    this.swallowTap = false;
    // Cancels the mouse events the browser would send for the tap.
    e.preventDefault();
  };

  /** The browser's own long-press menu (Android) and ours must not both open. */
  private onContextMenu = (e: MouseEvent) => {
    if (this.syntheticMenus.has(e)) return;
    const lp = this.longPress;
    if (!lp) return;
    if (lp.fired) {
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    // The browser's came first: it is the menu for this press.
    clearTimeout(lp.timer);
    lp.fired = true;
    if (this.gesturePage !== null) {
      this.gesturePage = null;
      this.overlay?.pointerCancel?.();
    }
    this.drag = null;
  };

}
