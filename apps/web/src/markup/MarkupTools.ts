import {
  align,
  boundsOf,
  canOffset,
  eraseStroke,
  calloutLanding,
  calloutLeaders,
  calloutPoints,
  contentBox,
  isCalloutTip,
  CLICK_SHAPES,
  DEFAULT_STYLES,
  drawMarkup,
  drawSelection,
  distribute,
  flip,
  handlePositions,
  hitTest,
  markupSegments,
  insidePolygon,
  insideRect,
  isMeasureKind,
  isTextType,
  lineRects,
  markupLines,
  MARKUP_LABELS,
  TYPE_INFO,
  multiplyOffsets,
  offsetDistance,
  offsetPoints,
  onImageLoad,
  paintedStyle,
  resolveStamp,
  restack,
  selectRange,
  stampAspect,
  shapeBounds,
  translated,
  moved,
  polarPoint,
  segmentPolar,
  type Geometry,
  type Alignment,
  type Axis,
  type Markup,
  type MarkupStore,
  type MarkupStyle,
  type MarkupType,
  type Point,
  type SignatureInfo,
  type StampDef,
  wordAt,
  type WordBox,
  type StoredLink,
  markupBounds,
  rotateHandle,
  rotatePoint,
  rotationCentre,
  type Attachment,
} from '@nb/markup';
import { bulgeThrough, dynamicFill, formatLength, pathLength, type Scale, type Snap, type SnapIndex } from '@nb/measure';
import { gridSpacingPoints, settings } from '../settings/settings';
import type { PagePoint, TileViewer, ViewerOverlay } from '../viewer/TileViewer';

/**
 * `calibrate` draws a temporary line whose real length the user then enters. `labelRegion` draws a
 * box around title-block text to read page labels from (it makes no markup). `lasso` selects the
 * markups inside a free-form outline; `painter` (Format Painter) copies one markup's look onto
 * the markups clicked next.
 */
export type Tool = 'select' | MarkupType | 'calibrate' | 'labelRegion' | 'lasso' | 'painter' | 'cloudPlus' | 'eraser' | 'offset' | 'cutout' | 'viewport' | 'dynamicFill' | 'visualSearch' | 'cropArea' | 'eraseContent' | 'selectText' | 'editText' | 'formField' | 'pan' | 'zoomBox' | 'dynamicZoom' | 'snapshot' | 'cutContent';

/** Tools that draw a markup (not select, calibrate, a label region, lasso or format painter). */
export const isMarkupTool = (t: Tool): t is MarkupType => !(t in OTHER_TOOL_LABELS);

const OTHER_TOOL_LABELS: Record<Exclude<Tool, MarkupType>, string> = {
  select: 'Select',
  calibrate: 'Calibrate',
  labelRegion: 'Page Label Region',
  lasso: 'Lasso',
  painter: 'Format Painter',
  cloudPlus: 'Cloud+',
  eraser: 'Eraser',
  offset: 'Offset',
  cutout: 'Cutout',
  viewport: 'Viewport',
  dynamicFill: 'Smart Fill',
  visualSearch: 'Symbol Search',
  cropArea: 'Crop Area',
  eraseContent: 'Erase Content',
  selectText: 'Select Text',
  editText: 'Edit Text',
  formField: 'Form Field',
  snapshot: 'Snapshot',
  cutContent: 'Cut Content',
  pan: 'Pan',
  zoomBox: 'Zoom',
  dynamicZoom: 'Dynamic Zoom',
};

/** Tools that pick out an area of the page (drawn as a plain box, never snapped). */
const REGION_TOOLS: ReadonlySet<Tool> = new Set<Tool>(['labelRegion', 'viewport', 'visualSearch', 'cropArea', 'eraseContent', 'formField', 'snapshot', 'cutContent']);

/** A form field's widget, for clicking to fill it in. */
export interface FormWidgetHit {
  name: string;
  pageIndex: number;
  rect: PageRect;
  /** Check box and radio widgets: the value this one stands for. */
  onValue?: string;
  readOnly: boolean;
}

/** A tool's name in menus and tooltips. */
export function toolLabel(tool: Tool): string {
  return isMarkupTool(tool) ? MARKUP_LABELS[tool] : OTHER_TOOL_LABELS[tool];
}

/** Screen pixels within which a click hits a markup or handle. */
const HIT_PX = 5;
/** Screen radius within which the cursor snaps to drawing geometry. */
const SNAP_PX = 10;
/** On-screen radius of cloud arcs when the cloud is drawn. */
const CLOUD_ARC_PX = 8;
/** On-screen size of count markers / dimension ticks, and of measurement labels, at creation. */
const MARKER_PX = 5;
const LABEL_PX = 11;
/** Default size of a text box placed with a click instead of a drag. */
const TEXT_BOX = { w: 160, h: 40 };
/** On-screen size of a sticky note icon when placed. */
const NOTE_PX = 22;
/** On-screen width of a stamp placed with a click. */
const STAMP_PX = 200;
/** On-screen size of a legend placed with a click. */
const LEGEND_PX = { w: 280, h: 150 };
/** On-screen radius of the eraser, by size. */
const ERASER_PX = { small: 5, medium: 10, large: 20 } as const;
/** Screen distance within which a text markup drag picks up a word. */
const TEXT_REACH_PX = 6;
/** A new callout's box (points) and the on-screen length of its leader's landing. */
const CALLOUT_BOX = { w: 140, h: 36 };
const CALLOUT_LANDING_PX = 14;
/** On-screen width of an image placed with a click instead of a drag. */
const IMAGE_PX = 240;
/** Drag distance (screen px) that turns a click into a drag. */
const DRAG_PX = 4;
const CALIBRATE_STYLE: MarkupStyle = { stroke: '#2563eb', fill: null, width: 1, opacity: 1 };
const REGION_STYLE: MarkupStyle = { stroke: '#2563eb', fill: '#2563eb', width: 1, opacity: 1, fillOpacity: 0.08, dash: 'dashed' };

type Gesture =
  /** Drag-to-draw shapes (line, rectangle, pen, ...). */
  | { kind: 'draw'; markup: Markup }
  /** Click-by-click measurements; `hover` is the rubber-band point under the cursor. */
  | { kind: 'multi'; markup: Markup; hover: Point | null; down: Point; calibrate: boolean }
  | { kind: 'move'; start: Point; dx: number; dy: number }
  /** Dragging a grouped callout's text box (Cloud+): the box and knee move, the arrow tip stays put. */
  | { kind: 'calloutBox'; id: string; start: Point; dx: number; dy: number }
  | { kind: 'handle'; id: string; index: number; point: Point }
  /** Alt-dragging a segment's midpoint knob of a measurement: the segment curves through the pointer. */
  | { kind: 'bend'; id: string; segment: number; bulge: number }
  /** Turning a selected markup by its rotate handle; `angle` in degrees. */
  | { kind: 'rotate'; id: string; angle: number }
  /** Press on a hyperlink; followed on release unless the pointer moved. */
  | { kind: 'link'; link: StoredLink; start: Point }
  | { kind: 'formField'; widget: FormWidgetHit; start: Point }
  /** Press on a hyperlink markup: followed on release, or selected and moved if dragged. */
  | { kind: 'hyperlink'; markup: Markup; start: Point }
  /** Text markup tools: the words from where the drag began to the pointer get marked. */
  | { kind: 'textMark'; markup: Markup; from: Point; copyOnly?: boolean }
  /** Eraser: rubbing out parts of pen and highlighter strokes. */
  | { kind: 'erase'; pageIndex: number }
  /** Drag on empty page with Select: markups wholly inside the box get selected. */
  | { kind: 'box'; start: Point; end: Point; add: boolean }
  /** Lasso: markups wholly inside the free-form outline get selected. */
  | { kind: 'lasso'; pageIndex: number; path: Point[]; add: boolean };

type PageRect = { x: number; y: number; w: number; h: number };
/** How long a navigation target stays highlighted. */
const FLASH_MS = 1600;

/** Tool chest tools and signatures: a tool armed with a saved look, subject or image. */
export interface ToolPreset {
  /** Tool chest item id, to show which tool is armed. */
  id?: string;
  style?: MarkupStyle;
  subject?: string;
  /** Signature image (data URL) and its width / height. */
  image?: string;
  aspect?: number;
  signature?: SignatureInfo;
  /** Stamp tool: the library stamp to place (its fields are filled in when placed). */
  stamp?: StampDef;
  /** Place one markup, then go back to Select (signatures). */
  once?: boolean;
  /** File Attachment tool: the file to embed. */
  attachment?: Attachment;
  /**
   * Exact markups saved in the Tool Library (geometry, text and all): each click places a copy
   * centred on the pointer instead of drawing a new shape.
   */
  template?: Markup[];
  /** Template text that numbers on: each copy's number follows the last one in the document. */
  sequence?: { start: number; increment: number };
}

export interface ToolsState {
  tool: Tool;
  selected: ReadonlySet<string>;
  styles: Readonly<Record<MarkupType, MarkupStyle>>;
  snap: boolean;
  /** A click-by-click measurement is in progress. */
  measuring: boolean;
  /** Draw hyperlink areas (they stay clickable either way). */
  showLinks: boolean;
  /** A Tool Library tool or signature in use: new markups of its type take its style, subject and image. */
  preset: (ToolPreset & { type: MarkupType }) | null;
  /** Format Painter: the markup whose look is being copied; Offset: the markup being offset. */
  painterSource: Markup | null;
  /** What Smart Fill makes from the region it finds. */
  fillAs: FillType;
  /** Draw to Size: the next segment (click-drawn tools) or box (after a click) can be typed. */
  sketch: SketchState | null;
}

export interface SketchState {
  /** `segment`: a length (and angle) from `from`; `box`: a width and height from corner `from`. */
  mode: 'segment' | 'box';
  type: MarkupType;
  pageIndex: number;
  from: Point;
}

/** Drag-drawn shapes Draw to Size sizes by width and height after a click. */
const SKETCH_BOX_TYPES: readonly MarkupType[] = ['rect', 'ellipse', 'cloud'];
/** Drag-drawn lines Draw to Size draws point to point, so their length and angle can be typed. */
const SKETCH_LINE_TYPES: readonly MarkupType[] = ['line', 'arrow'];
/** Click-drawn tools whose next point can be typed as a length and angle. */
const sketchesSegments = (type: MarkupType) => !['count', 'angle', 'arc', 'arcLength'].includes(type);

/** Markups Smart Fill can make from a region. */
export const FILL_TYPES = ['area', 'perimeter', 'volume', 'polygon', 'space', 'polylength'] as const;
export type FillType = (typeof FILL_TYPES)[number];

interface Modifiers {
  shiftKey: boolean;
  altKey: boolean;
}

export interface MarkupToolsOptions {
  author: () => string;
  /** A text markup needs its text entered or edited. */
  onEditText: (id: string) => void;
  /** The user drew a calibration line `lengthPoints` long on `pageIndex`, starting at `at`. */
  onCalibrate: (pageIndex: number, lengthPoints: number, at: Point) => void;
  /** The user clicked PDF text with the `editText` tool. */
  onEditPdfText?: (pageIndex: number, at: Point) => void;
  /** The user selected PDF text with the `selectText` tool. */
  onTextSelected?: (text: string) => void;
  /** The user drew an area to erase the PDF content in (the `eraseContent` tool). */
  onEraseContent?: (pageIndex: number, rect: PageRect) => void;
  /** The user drew where a new form field goes (the `formField` tool). */
  onFormFieldDrawn?: (pageIndex: number, rect: PageRect) => void;
  /** The user clicked a form field's widget to fill it in. */
  onFormField?: (widget: FormWidgetHit) => void;
  /** The user drew the area to crop pages to (the `cropArea` tool). */
  onCropArea?: (pageIndex: number, rect: PageRect) => void;
  /** The user drew a box around a symbol to find (the `visualSearch` tool). */
  onVisualSearch?: (pageIndex: number, rect: PageRect) => void;
  /** The user drew a viewport (the `viewport` tool). */
  onViewport?: (pageIndex: number, rect: PageRect) => void;
  /** The user clicked a hyperlink. */
  onFollowLink: (link: StoredLink) => void;
  /** The user clicked a hyperlink markup (not selected, no modifier keys). */
  onFollowHyperlink?: (m: Markup) => void;
  /** A hyperlink was drawn or double-clicked: choose its action. */
  onEditHyperlink?: (id: string) => void;
  /** Values new markups start with in the document's custom columns. */
  defaultFields?: () => Record<string, string> | undefined;
  /** A markup was drawn (for Recent Tools). */
  onCreated?: (m: Markup) => void;
  /** The user drew a page-label region (the `labelRegion` tool). */
  onRegion?: (pageIndex: number, rect: PageRect) => void;
  /** A short message for the user (e.g. Smart Fill found no enclosed region). */
  onNotice?: (text: string) => void;
  /** A Space was drawn: it needs a name. */
  onSpaceDrawn?: (id: string) => void;
  /** A note needs its comment entered or edited. */
  onEditComment?: (id: string) => void;
  /** The Image tool was chosen without a picture: ask for one (null if the user cancels). */
  requestImage?: () => Promise<{ image: string; aspect: number } | null>;
  /** The File Attachment tool was chosen without a file: ask for one (null if the user cancels). */
  requestAttachment?: () => Promise<Attachment | null>;
  /** A file attachment was double-clicked: open or save its file. */
  onOpenAttachment?: (m: Markup) => void;
  /** A dimension's text or a Replace Text markup's new wording needs entering or editing. */
  onEditLabel?: (id: string) => void;
  /** The user drew the area to cut from the PDF (copied as a picture, then erased). */
  onCutContent?: (pageIndex: number, rect: PageRect) => void;
  /** The user drew the area to copy as a picture (the `snapshot` tool). */
  onSnapshot?: (pageIndex: number, rect: PageRect) => void;
  /** The Stamp tool was chosen without a stamp: the one to use (e.g. the last used). */
  defaultStamp?: () => StampDef | null;
  /** File name and page label for a stamp's {File} and {Page} fields. */
  stampValues?: (pageIndex: number) => { file: string; page: string };
}

/** Drawing with this type snaps its points to drawing geometry (not freehand, text or pictures). */
function snapsWhileDrawing(type: MarkupType): boolean {
  const info = TYPE_INFO[type];
  return (info.draw === 'drag' || info.draw === 'click') && !info.content;
}

/** Other markups' points this one can be snapped to (not freehand strokes, text or notes). */
function snapTarget(type: MarkupType): boolean {
  const info = TYPE_INFO[type];
  return info.draw !== 'freehand' && info.draw !== 'place' && info.content !== 'text';
}

/** Click-by-click point rules for a tool: measurements, calibration and click-drawn shapes. */
function clickSpec(tool: Tool): { min: number; fixed?: number; closes?: boolean } | null {
  if (tool === 'calibrate') return { min: 2, fixed: 2 };
  if (tool === 'cutout') return { min: 3, closes: true };
  // Draw to Size: lines go point to point (a drag still works), so the second point can be typed.
  if (SKETCH_LINE_TYPES.includes(tool as MarkupType) && settings.get().sketchToScale) return { min: 2, fixed: 2 };
  return (isMarkupTool(tool) && CLICK_SHAPES[tool]) || null;
}

/**
 * Viewer overlay implementing CAD-style markup and measurement tools. Committed markups
 * live in the MarkupStore; in-progress gestures are kept local and written once when finished,
 * so each gesture is a single undo step and a single sync update.
 */
export class MarkupTools implements ViewerOverlay {
  private store: MarkupStore | null = null;
  private unsubscribe: (() => void) | null = null;
  private gesture: Gesture | null = null;
  private listeners = new Set<() => void>();
  /** Markups the Markups list's filter leaves out, and whether they show faintly or not at all. */
  private filteredOut: ((m: Markup) => boolean) | null = null;
  private filterMode: 'show' | 'dim' | 'hide' = 'show';
  /** Markup layers switched off in the Layers panel ('' is markups on no layer). */
  private hiddenLayers: ReadonlySet<string> = new Set();
  private state: ToolsState = { tool: 'select', selected: new Set(), styles: loadToolStyles(), snap: settings.get().snapToGeometry, measuring: false, showLinks: settings.get().showHyperlinks, preset: null, painterSource: null, fillAs: 'area', sketch: null };
  /** Where a Tool Library copy would land, previewed under the pointer. */
  private ghost: { pageIndex: number; at: Point } | null = null;
  private hoveredLink: string | null = null;
  private regions: readonly PageRect[] = [];
  private flashing: { pageIndex: number; rect: PageRect; until: number } | null = null;
  /** Search matches to highlight, and which one is current. */
  private highlights: { pageIndex: number; rects: PageRect[] }[] = [];
  private activeHighlight = -1;
  private snapSource: ((pageIndex: number) => Promise<SnapIndex>) | null = null;
  private textSource: ((pageIndex: number) => Promise<readonly WordBox[]>) | null = null;
  private pageWords = new Map<number, readonly WordBox[] | 'loading'>();
  private snapIndexes = new Map<number, SnapIndex | 'loading'>();
  /** Snap target under the cursor, drawn as an indicator. */
  private snapHit: Snap | null = null;
  private snapPage = -1;
  /** Page the current pointer event is on (pages differ across a stitched view). */
  private page = 0;

  constructor(
    private viewer: TileViewer,
    private options: MarkupToolsOptions,
  ) {
    onImageLoad(() => this.viewer.invalidate());
    // Grid and snapping preferences change what is drawn.
    settings.subscribe(() => this.refreshSketch());
  }

  // --- state for React -------------------------------------------------------------------

  getState = (): ToolsState => this.state;
  /**
   * The kind of pointer last pressed: fingers get larger hit areas, drag thresholds and handles
   * than a mouse or pen. Starts from the device's main pointer (coarse on phones and tablets).
   */
  private pointerKind: string = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches ? 'touch' : 'mouse';
  private get hitPx() {
    return this.pointerKind === 'touch' ? 14 : this.pointerKind === 'pen' ? 7 : HIT_PX;
  }
  private get dragPx() {
    return this.pointerKind === 'touch' ? 10 : DRAG_PX;
  }
  /** A markup is being drawn, moved or edited (a multi-point shape, a sketch, a drag). */
  get inProgress(): boolean {
    return !!this.gesture || !!this.state.sketch;
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private setState(patch: Partial<ToolsState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
    this.viewer.invalidate();
  }

  private setGesture(g: Gesture | null) {
    this.gesture = g;
    if (g) this.sketchAnchor = null;
    const measuring = g?.kind === 'multi';
    const sketch = this.sketchState();
    if (measuring !== this.state.measuring || !sameSketch(sketch, this.state.sketch)) this.setState({ measuring, sketch });
    else this.viewer.invalidate();
  }

  /** Box types: the corner a click placed, waiting for a typed width and height. */
  private sketchAnchor: { type: MarkupType; pageIndex: number; at: Point } | null = null;

  private sketchState(): SketchState | null {
    if (!settings.get().sketchToScale) return null;
    const g = this.gesture;
    if (g?.kind === 'multi' && !g.calibrate && sketchesSegments(g.markup.type) && g.markup.points.length) {
      return { mode: 'segment', type: g.markup.type, pageIndex: g.markup.pageIndex, from: g.markup.points.at(-1)! };
    }
    const a = this.sketchAnchor;
    return a ? { mode: 'box', type: a.type, pageIndex: a.pageIndex, from: a.at } : null;
  }

  private refreshSketch() {
    const sketch = this.sketchState();
    if (!sameSketch(sketch, this.state.sketch)) this.setState({ sketch });
    else this.viewer.invalidate();
  }

  /**
   * Draw to Size: places the next point `length` points from the last one, at `angle` degrees
   * (counter-clockwise from east, as on paper), or toward the pointer when no angle is given.
   */
  sketchSegment(length: number, angle: number | null) {
    const g = this.gesture;
    if (g?.kind !== 'multi' || !g.markup.points.length || !(length > 0)) return;
    const from = g.markup.points.at(-1)!;
    const h = g.hover;
    const toward = h && Math.hypot(h[0] - from[0], h[1] - from[1]) > 1e-6 ? segmentPolar(from, h).angle : 0;
    const p = polarPoint(from, length, angle ?? toward);
    g.markup.points = [...g.markup.points, p];
    g.down = p;
    g.hover = p;
    this.completeIfFixed();
    this.refreshSketch();
  }

  /** Draw to Size: draws the anchored box type `width` by `height` points (right and down). */
  sketchBox(width: number, height: number) {
    const a = this.sketchAnchor;
    if (!a || !this.store || !(width > 0) || !(height > 0)) return;
    this.sketchAnchor = null;
    const m = this.newMarkup(a.type, a.pageIndex, [a.at, [a.at[0] + width, a.at[1] + height]]);
    this.store.checkpoint();
    this.store.add(m);
    this.options.onCreated?.(m);
    this.refreshSketch();
  }

  /** Drops a waiting Draw to Size corner. */
  cancelSketch() {
    if (!this.sketchAnchor) return;
    this.sketchAnchor = null;
    this.refreshSketch();
  }

  setStore(store: MarkupStore | null) {
    this.unsubscribe?.();
    this.store = store;
    this.setGesture(null);
    this.unsubscribe =
      store?.subscribe(() => {
        // Drop selections of markups that were deleted (locally, by undo, or by a collaborator).
        const alive = [...this.state.selected].filter((id) => store.get(id));
        if (alive.length !== this.state.selected.size) this.setState({ selected: new Set(alive) });
        else this.viewer.invalidate();
      }) ?? null;
    this.setState({ selected: new Set() });
  }

  /** Where page vector geometry comes from; resets cached snap indexes (new document). */
  setSnapSource(source: ((pageIndex: number) => Promise<SnapIndex>) | null) {
    this.snapSource = source;
    this.snapIndexes.clear();
    this.snapHit = null;
  }

  /** Where page text comes from, for the text markup tools; resets cached words (new document). */
  setTextSource(source: ((pageIndex: number) => Promise<readonly WordBox[]>) | null) {
    this.textSource = source;
    this.pageWords.clear();
  }

  /** A page's words, loading them in the background on first use. */
  private wordsFor(pageIndex: number): readonly WordBox[] | null {
    const cached = this.pageWords.get(pageIndex);
    if (cached && cached !== 'loading') return cached;
    if (!cached && this.textSource) {
      this.pageWords.set(pageIndex, 'loading');
      const source = this.textSource;
      source(pageIndex)
        .then((words) => {
          if (this.textSource === source) this.pageWords.set(pageIndex, words);
        })
        .catch((err) => {
          console.error('Loading page text failed', err);
          this.pageWords.delete(pageIndex);
        });
    }
    return null;
  }

  setShowLinks(showLinks: boolean) {
    this.setState({ showLinks });
  }

  /** Briefly highlights a page area, e.g. the detail a hyperlink jumped to. */
  flash(pageIndex: number, rect: PageRect) {
    this.flashing = { pageIndex, rect, until: performance.now() + FLASH_MS };
    this.viewer.invalidate();
  }

  /** Highlights search matches; `active` is the index of the current one. */
  setHighlights(hits: { pageIndex: number; rects: PageRect[] }[], active = -1) {
    this.highlights = hits;
    this.activeHighlight = active;
    this.viewer.invalidate();
  }

  setSnap(snap: boolean) {
    this.snapHit = null;
    this.setState({ snap });
  }

  /** Chooses a tool; `preset` arms it with a tool library look or a signature image. */
  setTool(tool: Tool, preset?: ToolPreset) {
    // Pan and the zoom tools are the viewer's own.
    this.viewer.setNavTool(tool === 'pan' || tool === 'zoomBox' || tool === 'dynamicZoom' ? tool : null);
    if (tool === 'stamp' && !preset?.stamp && !preset?.template) {
      const stamp = this.options.defaultStamp?.();
      if (stamp) this.setTool('stamp', { ...preset, stamp });
      return;
    }
    if (tool === 'attachment' && !preset?.attachment && !preset?.template) {
      void this.options.requestAttachment?.().then((file) => {
        if (file) this.setTool('attachment', { ...preset, attachment: file, once: true });
      });
      return;
    }
    if (tool === 'image' && !preset?.image && !preset?.template) {
      // An image needs a picture first; the tool is armed once the user has chosen one.
      void this.options.requestImage?.().then((picked) => {
        if (picked) this.setTool('image', { ...preset, image: picked.image, aspect: picked.aspect });
      });
      return;
    }
    // Switching tools completes a measurement in progress (e.g. a count) rather than losing it.
    if (this.gesture?.kind === 'multi') this.finish();
    this.sketchAnchor = null;
    this.setGesture(null);
    this.snapHit = null;
    this.ghost = null;
    if (tool === 'offset') {
      // Offset copies the one selected line or shape at the distance the pointer picks.
      const [id] = this.state.selected;
      const source = this.state.selected.size === 1 && id ? this.store?.get(id) : undefined;
      if (!source || !canOffset(source)) return;
      this.ghost = null;
      this.setState({ tool, preset: null, painterSource: structuredClone(source) });
      return;
    }
    if (tool === 'painter') {
      // The Format Painter copies the look of the one selected markup.
      const [id] = this.state.selected;
      const source = this.state.selected.size === 1 && id ? this.store?.get(id) : undefined;
      if (!source) return;
      this.setState({ tool, preset: null, painterSource: structuredClone(source) });
      return;
    }
    // Cloud+ draws its cloud with the preset (a Tool Library Cloud+); the callout keeps its own style.
    const drawn = tool === 'cloudPlus' ? 'cloud' : tool;
    const armed = !isMarkupTool(drawn) || !preset ? null : { ...preset, type: drawn, ...(preset.style ? { style: { ...preset.style } } : {}) };
    this.setState({ tool, selected: tool === 'select' || tool === 'lasso' ? this.state.selected : new Set(), preset: armed, painterSource: null });
  }

  /** Shows markups the Markups list filters out faintly ('dim'), not at all ('hide') or normally. */
  setFilterView(filteredOut: ((m: Markup) => boolean) | null, mode: 'show' | 'dim' | 'hide') {
    this.filteredOut = filteredOut;
    this.filterMode = filteredOut ? mode : 'show';
    this.viewer.invalidate();
  }

  /** Hides the markups on these layers ('' for markups on no layer). */
  setHiddenLayers(layers: ReadonlySet<string>) {
    this.hiddenLayers = layers;
    this.viewer.invalidate();
  }

  /** Midpoint knobs between the vertices of a selected outline or path: drag one to add a vertex. */
  private drawVertexKnobs(ctx: CanvasRenderingContext2D, m: Markup, zoom: number) {
    if (this.frozen(m)) return;
    const px = 1 / zoom;
    ctx.save();
    ctx.lineWidth = px;
    ctx.strokeStyle = '#3b82f6';
    ctx.fillStyle = 'rgba(59, 130, 246, 0.35)';
    for (const { at } of midpoints(m)) {
      ctx.beginPath();
      ctx.arc(at[0], at[1], 3 * px, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Picks a Tool Library tool: its markup type, drawing with its own style until another tool is chosen. */
  usePreset(preset: { id: string; type: MarkupType; style: MarkupStyle; subject?: string }) {
    this.setTool(preset.type, preset);
  }

  /** The markup under a screen position (for context menus), or undefined. */
  markupAtClient(clientX: number, clientY: number): Markup | undefined {
    if (!this.store) return undefined;
    const page = this.viewer.pageNearClient(clientX, clientY);
    this.page = page;
    return this.hitAt(toPoint(this.viewer.clientToPage(clientX, clientY, page)));
  }

  /** Selects markups, together with the rest of any group they belong to. */
  select(ids: Iterable<string>) {
    this.setState({ selected: this.withGroups(ids) });
  }

  /** `ids` plus every markup sharing a group with one of them. */
  private withGroups(ids: Iterable<string>): Set<string> {
    const out = new Set(ids);
    if (!this.store) return out;
    const groups = new Set([...out].map((id) => this.store!.get(id)?.groupId).filter((g): g is string => !!g));
    if (groups.size) for (const m of this.store.all()) if (m.groupId && groups.has(m.groupId)) out.add(m.id);
    return out;
  }

  /**
   * Locked, or someone else's markup this person may not edit (in a Live Session): it cannot be
   * moved, reshaped, restyled or deleted.
   */
  private frozen(m: Markup): boolean {
    return !!m.locked || (!!this.store && !this.store.mayEdit(m));
  }

  /** Selected markups that exist and can be edited (not frozen). */
  private editable(): Markup[] {
    if (!this.store) return [];
    return [...this.state.selected].map((id) => this.store!.get(id)).filter((m): m is Markup => !!m && !this.frozen(m));
  }

  /** Writes new points for markups as one undo step. */
  private movePoints(moves: Map<string, Geometry>) {
    if (!this.store || this.store.readOnly || !moves.size) return;
    const store = this.store;
    store.checkpoint();
    store.batch(() => {
      for (const [id, geometry] of moves) store.update(id, geometry);
    });
  }

  /** Lines the selected markups up on an edge or centre line of their combined bounds. */
  alignSelected(how: Alignment) {
    this.movePoints(align(this.editable(), how));
  }

  /** Spaces three or more selected markups evenly. */
  distributeSelected(axis: Axis) {
    this.movePoints(distribute(this.editable(), axis));
  }

  /** Mirrors the selected markups across their centre. */
  flipSelected(axis: Axis) {
    this.movePoints(flip(this.editable(), axis));
  }

  /** Joins the selected markups into one group (selected, moved and deleted together). */
  group() {
    const ms = this.editable();
    if (!this.store || this.store.readOnly || ms.length < 2) return;
    const groupId = crypto.randomUUID();
    const store = this.store;
    store.checkpoint();
    store.batch(() => {
      for (const m of ms) store.update(m.id, { groupId });
    });
  }

  /** Splits the selected groups back into separate markups. */
  ungroup() {
    if (!this.store || this.store.readOnly) return;
    const grouped = this.editable().filter((m) => m.groupId);
    if (!grouped.length) return;
    const store = this.store;
    store.checkpoint();
    store.batch(() => {
      for (const m of grouped) store.update(m.id, { groupId: undefined });
    });
  }

  /** Locks or unlocks the selected markups. */
  setLocked(locked: boolean) {
    if (!this.store || this.store.readOnly) return;
    const store = this.store;
    store.checkpoint();
    store.batch(() => {
      for (const id of this.state.selected) if (store.get(id)) store.update(id, { locked: locked || undefined });
    });
  }

  /** Copies the selected markups onto every other page at the same position. */
  applyToAllPages(pageCount: number) {
    const ms = this.editable();
    if (!this.store || this.store.readOnly || !ms.length) return;
    const now = Date.now();
    const store = this.store;
    store.checkpoint();
    let n = 0;
    store.batch(() => {
      for (let page = 0; page < pageCount; page++) {
        const groups = new Map<string, string>();
        for (const m of ms) {
          if (m.pageIndex === page) continue;
          const groupId = m.groupId ? (groups.get(m.groupId) ?? groups.set(m.groupId, crypto.randomUUID()).get(m.groupId)!) : undefined;
          store.add({ ...structuredClone(m), id: crypto.randomUUID(), pageIndex: page, groupId, status: 'none', author: this.options.author(), createdAt: now + n, modifiedAt: now + n });
          n++;
        }
      }
    });
  }

  /**
   * Copies the selection into a grid of `rows` × `columns` (the original is the top-left cell),
   * `gapX` / `gapY` points apart. The copies become the selection.
   */
  multiply(rows: number, columns: number, gapX: number, gapY: number) {
    const ms = this.editable();
    if (!this.store || this.store.readOnly || !ms.length || rows * columns < 2) return;
    const all = ms.map(shapeBounds);
    const x0 = Math.min(...all.map((b) => b.x));
    const y0 = Math.min(...all.map((b) => b.y));
    const bounds = { x: x0, y: y0, w: Math.max(...all.map((b) => b.x + b.w)) - x0, h: Math.max(...all.map((b) => b.y + b.h)) - y0 };
    const now = Date.now();
    const ids: string[] = [];
    const store = this.store;
    store.checkpoint();
    store.batch(() => {
      for (const [dx, dy] of multiplyOffsets(bounds, rows, columns, gapX, gapY)) {
        const groups = new Map<string, string>();
        for (const m of ms) {
          const id = crypto.randomUUID();
          ids.push(id);
          const groupId = m.groupId ? (groups.get(m.groupId) ?? groups.set(m.groupId, crypto.randomUUID()).get(m.groupId)!) : undefined;
          store.add({ ...structuredClone(m), id, groupId, ...moved(m, dx, dy), status: 'none', author: this.options.author(), createdAt: now + ids.length, modifiedAt: now + ids.length });
        }
      }
    });
    this.select([...this.state.selected, ...ids]);
  }

  /** Updates the style for `type` (future markups) and applies it to selected markups of that type. */
  setStyle(type: MarkupType, patch: Partial<MarkupStyle>) {
    const { preset } = this.state;
    // A Tool Library tool keeps its own style; changing it leaves the type's defaults alone.
    if (preset?.type === type && preset.style) this.setState({ preset: { ...preset, style: mergeStyle(preset.style, patch) } });
    else {
      const styles = { ...this.state.styles, [type]: mergeStyle(this.state.styles[type], patch) };
      this.setState({ styles });
      saveToolStyles(styles);
    }
    const store = this.store;
    if (!store) return;
    store.checkpoint();
    store.batch(() => {
      for (const id of this.state.selected) {
        const m = store.get(id);
        if (m && m.type === type && !this.frozen(m)) store.update(id, { style: { ...m.style, ...patch } });
      }
    });
  }

  /** Changes the default style for new markups of `type`, without touching existing markups. */
  setDefaultStyle(type: MarkupType, patch: Partial<MarkupStyle>) {
    this.setState({ styles: { ...this.state.styles, [type]: mergeStyle(this.state.styles[type], patch) } });
    saveToolStyles(this.state.styles);
  }

  /** Applies a style change to specific markups (of any type). Rapid changes merge into one undo step. */
  applyStyle(ids: Iterable<string>, patch: Partial<MarkupStyle>) {
    const store = this.store;
    if (!store) return;
    store.batch(() => {
      for (const id of ids) {
        const m = store.get(id);
        if (m && !this.frozen(m)) store.update(id, { style: mergeStyle(m.style, patch) });
      }
    });
  }

  /** Topmost markup at a point on a page (for right-click menus). */
  markupAt(pt: PagePoint, pageIndex: number): Markup | undefined {
    const tol = this.hitPx / this.viewer.zoomFor(pageIndex);
    return this.pageMarkups(pageIndex)
      .reverse()
      .find((m) => hitTest(m, pt as Point, tol));
  }

  /** Copies of the selected markups, for the clipboard. */
  copySelected(): Markup[] {
    if (!this.store) return [];
    return [...this.state.selected].map((id) => this.store!.get(id)).filter((m): m is Markup => !!m).map((m) => structuredClone(m));
  }

  /**
   * Pastes markups as new ones on `pageIndex`: with their top-left corner at `at`, exactly where
   * they were copied from (`'inPlace'`), or nudged from there (null). They become the selection.
   */
  paste(markups: readonly Markup[], pageIndex: number, at: PagePoint | 'inPlace' | null) {
    if (!this.store || this.store.readOnly || !markups.length) return;
    const all = markups.flatMap((m) => m.points);
    const minX = Math.min(...all.map((p) => p[0]));
    const minY = Math.min(...all.map((p) => p[1]));
    const [dx, dy] = at === 'inPlace' ? [0, 0] : at ? [at[0] - minX, at[1] - minY] : [12, 12];
    const groups = new Map<string, string>();
    const now = Date.now();
    const ids: string[] = [];
    this.store.checkpoint();
    markups.forEach((m, i) => {
      const id = crypto.randomUUID();
      ids.push(id);
      // Pasted groups stay grouped, as new groups of their own.
      const groupId = m.groupId ? (groups.get(m.groupId) ?? groups.set(m.groupId, crypto.randomUUID()).get(m.groupId)!) : undefined;
      this.store!.add({
        ...structuredClone(m),
        id,
        pageIndex,
        groupId,
        locked: undefined,
        ...moved(m, dx, dy),
        status: 'none',
        author: this.options.author(),
        createdAt: now + i,
        modifiedAt: now + i,
      });
    });
    this.setTool('select');
    this.select(ids);
  }

  /**
   * Places copies of Tool Library markups on `pageIndex`, centred on `at`. They become the
   * selection unless the tool stays armed for more.
   */
  placeTemplate(template: readonly Markup[], pageIndex: number, at: PagePoint, keepTool = false, sequence = this.state.preset?.sequence) {
    if (!this.store || this.store.readOnly || !template.length) return;
    if (sequence) template = this.numbered(template, sequence);
    const b = boundsOf(template.flatMap((m) => m.points));
    const dx = at[0] - (b.x + b.w / 2);
    const dy = at[1] - (b.y + b.h / 2);
    const now = Date.now();
    const fields = this.options.defaultFields?.();
    const ids: string[] = [];
    // Each placement gets its own groups, so two copies of a Cloud+ do not move as one.
    const groups = new Map<string, string>();
    this.store.checkpoint();
    template.forEach((m, i) => {
      const id = crypto.randomUUID();
      ids.push(id);
      const groupId = m.groupId ? (groups.get(m.groupId) ?? groups.set(m.groupId, crypto.randomUUID()).get(m.groupId)!) : undefined;
      this.store!.add({
        ...structuredClone(m),
        id,
        groupId,
        pageIndex,
        ...moved(m, dx, dy),
        status: 'none',
        author: this.options.author(),
        createdAt: now + i,
        modifiedAt: now + i,
        ...(m.fields || !fields || !Object.keys(fields).length ? {} : { fields }),
      });
    });
    if (keepTool) return;
    this.setTool('select');
    this.select(ids);
  }

  /**
   * A numbered template with the next number in the document: one more step than the highest in
   * groups placed from it before (the same types and subject, with a number for text).
   */
  private numbered(template: readonly Markup[], sequence: { start: number; increment: number }): Markup[] {
    const numberedText = (m: Markup) => isTextType(m.type) && /^\d+$/.test(m.text?.trim() ?? '');
    if (!this.store || !template.some(numberedText)) return [...template];
    const shape = (ms: readonly Markup[]) => ms.map((m) => `${m.type}:${m.subject ?? ''}`).sort().join('|');
    const want = shape(template);
    const groups = new Map<string, Markup[]>();
    for (const m of this.store.all()) if (m.groupId) groups.set(m.groupId, [...(groups.get(m.groupId) ?? []), m]);
    let last: number | null = null;
    for (const g of groups.values()) {
      if (shape(g) !== want) continue;
      for (const m of g) if (numberedText(m)) last = Math.max(last ?? -Infinity, Number(m.text!.trim()));
    }
    const next = last === null ? sequence.start : last + sequence.increment;
    return template.map((m) => (numberedText(m) ? { ...m, text: String(next) } : m));
  }

  /** Bring to front / forward / backward / send to back: markups draw in creation order. */
  arrange(ids: Iterable<string>, where: 'front' | 'back' | 'forward' | 'backward') {
    if (!this.store) return;
    const chosen = [...ids].map((id) => this.store!.get(id)).filter((m): m is Markup => !!m);
    if (!chosen.length) return;
    if (where === 'forward' || where === 'backward') {
      const moves = restack(this.store.forPage(chosen[0]!.pageIndex), new Set(chosen.map((m) => m.id)), where);
      if (!moves.size) return;
      const store = this.store;
      store.checkpoint();
      store.batch(() => {
        for (const [id, createdAt] of moves) store.update(id, { createdAt });
      });
      return;
    }
    const page = this.store.forPage(chosen[0]!.pageIndex).map((m) => m.createdAt);
    const edge = where === 'front' ? Math.max(...page) + 1 : Math.min(...page) - chosen.length;
    const store = this.store;
    store.checkpoint();
    store.batch(() => chosen.sort((a, b) => a.createdAt - b.createdAt).forEach((m, i) => store.update(m.id, { createdAt: edge + i })));
  }

  /** Gives a callout another leader, on the side of its text box away from the existing ones. */
  addCalloutLeader(id: string) {
    const m = this.store?.get(id);
    if (!this.store || !m || m.type !== 'callout' || this.frozen(m) || m.points.length < 4) return;
    const z = this.viewer.zoomFor(m.pageIndex);
    const box = contentBox(m);
    const [cx, cy] = [box.x + box.w / 2, box.y + box.h / 2];
    const land = CALLOUT_LANDING_PX / z;
    const reach = 50 / z;
    const used = calloutLeaders(m.points).length;
    // Opposite the first leader, then fanned out so further ones do not sit on top of each other.
    const opposite = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' } as const;
    const side = opposite[calloutLanding(m.points[1]!, box).side];
    const fan = (((used - 1) % 3) - 1) * 30 / z;
    const [knee, tip]: [Point, Point] =
      side === 'left'
        ? [[box.x - land, cy + fan], [box.x - land - reach, cy + fan + 30 / z]]
        : side === 'right'
          ? [[box.x + box.w + land, cy + fan], [box.x + box.w + land + reach, cy + fan + 30 / z]]
          : side === 'top'
            ? [[cx + fan, box.y - land], [cx + fan + 30 / z, box.y - land - reach]]
            : [[cx + fan, box.y + box.h + land], [cx + fan + 30 / z, box.y + box.h + land + reach]];
    this.store.checkpoint();
    this.store.update(id, { points: [...m.points, tip, knee] });
    this.select([id]);
  }

  /** Takes away a callout's most recently added leader (the first one stays). */
  removeCalloutLeader(id: string) {
    const m = this.store?.get(id);
    if (!this.store || !m || m.type !== 'callout' || this.frozen(m) || m.points.length < 6) return;
    this.store.checkpoint();
    this.store.update(id, { points: m.points.slice(0, m.points.length - 2) });
  }

  /** Deletes the selected markups, except locked ones (which stay selected). */
  deleteSelected() {
    if (!this.store || !this.state.selected.size) return;
    const doomed = this.editable().map((m) => m.id);
    if (!doomed.length) return;
    this.store.checkpoint();
    this.store.remove(doomed);
    this.setState({ selected: new Set([...this.state.selected].filter((id) => !doomed.includes(id))) });
  }

  /** Escape: abandon the gesture, else leave the tool, else clear the selection. */
  cancel() {
    if (this.gesture) this.setGesture(null);
    else if (this.state.tool !== 'select') this.setTool('select');
    else this.select([]);
  }

  /**
   * A press the viewer took back (a second finger turned it into a pinch, or it became a long
   * press): undo what it started. A click-by-click shape loses only the point that press added.
   */
  pointerCancel() {
    const g = this.gesture;
    if (!g) return;
    if (g.kind === 'multi' && g.markup.points.length > 1) {
      g.markup.points = g.markup.points.slice(0, -1);
      g.down = g.markup.points.at(-1)!;
      this.refreshSketch();
      this.viewer.invalidate();
      return;
    }
    this.setGesture(null);
  }

  /** Enter / double-click: complete a click-by-click measurement. */
  finish() {
    const g = this.gesture;
    if (g?.kind !== 'multi' || !this.store) return;
    this.setGesture(null);
    const zoom = this.viewer.zoomFor(g.markup.pageIndex);
    // A double-click lands two clicks on the same spot; collapse consecutive near-duplicates.
    const points = g.markup.points.filter((p, i, all) => i === 0 || Math.hypot(p[0] - all[i - 1]![0], p[1] - all[i - 1]![1]) * zoom > 2);
    if (g.calibrate) {
      if (points.length >= 2) this.options.onCalibrate(g.markup.pageIndex, pathLength(points.slice(0, 2)), points[0]!);
      return;
    }
    if (this.state.tool === 'cutout') {
      this.addCutout(points);
      return;
    }
    const spec = clickSpec(g.markup.type);
    if (!spec || points.length < spec.min) return;
    this.store.checkpoint();
    const done = { ...g.markup, points, createdAt: Date.now(), modifiedAt: Date.now() };
    this.store.add(done);
    this.options.onCreated?.(done);
    if (done.type === 'space') this.options.onSpaceDrawn?.(done.id);
  }

  setFillAs(fillAs: FillType) {
    this.setState({ fillAs });
  }

  /**
   * Smart Fill: finds the region enclosed by the drawing's lines (and markups, so a drawn line
   * can close a gap) around a point and makes it the chosen kind of markup.
   */
  private async fillAt(pageIndex: number, at: Point) {
    const store = this.store;
    const size = this.viewer.pageSize(pageIndex);
    if (!store || !size || !this.snapSource) return;
    let index: SnapIndex;
    try {
      const cached = this.snapIndexes.get(pageIndex);
      index = cached && cached !== 'loading' ? cached : await this.snapSource(pageIndex);
    } catch {
      this.options.onNotice?.('Could not read the drawing on this page.');
      return;
    }
    const walls: number[] = [];
    for (const m of store.forPage(pageIndex)) if (m.type !== 'space' && !TYPE_INFO[m.type].content && TYPE_INFO[m.type].draw !== 'text') walls.push(...markupSegments(m));
    const segments = walls.length ? Float32Array.from([...index.segments, ...walls]) : index.segments;
    const polygon = dynamicFill(segments, at, { width: size.width, height: size.height })?.map(([x, y]): Point => [x, y]);
    if (!polygon) {
      this.options.onNotice?.('No enclosed area there: click inside a closed outline, or draw a line to close the gap.');
      return;
    }
    const type = this.state.fillAs;
    const m = this.newMarkup(type, pageIndex, type === 'polylength' ? [...polygon, polygon[0]!] : polygon);
    store.checkpoint();
    store.add(m);
    this.options.onCreated?.(m);
    if (type === 'space') this.options.onSpaceDrawn?.(m.id);
  }

  /** Area or volume whose next cutout the Cutout tool draws. */
  private cutoutTarget: string | null = null;

  /** Starts drawing a cutout (a hole) in an area or volume measurement. */
  startCutout(id: string) {
    const m = this.store?.get(id);
    if (!m || this.frozen(m)) return;
    this.cutoutTarget = id;
    this.setTool('cutout');
    this.select([id]);
  }

  private addCutout(points: Point[]) {
    const m = this.store?.get(this.cutoutTarget ?? '');
    const id = this.cutoutTarget;
    this.cutoutTarget = null;
    this.setState({ tool: 'select' });
    if (!m || !id || points.length < 3) return;
    this.store!.checkpoint();
    this.store!.update(id, { holes: [...(m.holes ?? []), points] });
    this.select([id]);
  }

  /** Backspace during a measurement removes the last placed point. */
  removeLastPoint() {
    const g = this.gesture;
    if (g?.kind !== 'multi') return;
    g.markup.points = g.markup.points.slice(0, -1);
    if (!g.markup.points.length) this.setGesture(null);
    else this.refreshSketch();
  }

  // --- ViewerOverlay ---------------------------------------------------------------------

  draw(ctx: CanvasRenderingContext2D, pageIndex: number, zoom: number) {
    if (!this.store) return;
    // Load snap geometry as soon as a drawing tool is in use, so the very first click snaps.
    if (this.state.tool !== 'select' && this.state.snap) this.snapIndexFor(pageIndex);
    const scale = this.store.scaleFor(pageIndex);
    if (settings.get().showGrid) drawGrid(ctx, this.viewer.pageSize(pageIndex), gridSpacingPoints(settings.get()), zoom);
    const store = this.store;
    const legends = { all: () => store.all(), scaleFor: (p: number) => store.scaleFor(p), scaleOf: (m: Markup) => store.scaleOf(m) };
    this.drawViewports(ctx, pageIndex, zoom);
    for (const m of this.pageMarkups(pageIndex)) {
      const shown = this.previewOf(m);
      // Markups the list's filter leaves out show faintly (or not at all, see setFilterView).
      const faint = this.filterMode === 'dim' && this.filteredOut?.(m) && !this.state.selected.has(m.id);
      if (faint) {
        ctx.save();
        ctx.globalAlpha = 0.2;
      }
      drawMarkup(ctx, shown, zoom, store.scaleOf(shown), legends);
      if (faint) ctx.restore();
      if (m.replies?.length && settings.get().replyIndicators) drawReplyIndicator(ctx, shown, zoom);
      if (this.state.selected.has(m.id)) {
        drawSelection(ctx, shown, zoom, this.pointerKind === 'touch' ? 14 : 6);
        if (this.state.selected.size === 1) this.drawVertexKnobs(ctx, shown, zoom);
      }
    }
    this.drawFormWidgets(ctx, pageIndex);
    this.drawLinks(ctx, pageIndex, zoom);
    this.drawRegions(ctx, zoom);
    const g = this.gesture;
    if (g?.kind === 'textMark' && g.markup.pageIndex === pageIndex && g.markup.type !== 'textHighlight') {
      // The words under the pointer show as a highlight while an underline, strikeout or other text tool drags.
      ctx.save();
      ctx.fillStyle = 'rgba(59, 130, 246, 0.3)';
      for (const r of markupLines(g.markup.points)) ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.restore();
    }
    if ((g?.kind === 'draw' || g?.kind === 'textMark') && g.markup.pageIndex === pageIndex && g.markup.points.length) drawMarkup(ctx, g.markup, zoom, store.scaleOf(g.markup), legends);
    if (g?.kind === 'multi' && g.markup.pageIndex === pageIndex) {
      const { markup, hover } = g;
      const live = hover && markup.type !== 'count' ? { ...markup, points: [...markup.points, hover] } : markup;
      drawMarkup(ctx, live, zoom, store.scaleOf(live));
      // Draw to Size: the length and angle of the segment under the pointer (measurements label themselves).
      const from = markup.points.at(-1);
      if (this.state.sketch && from && hover && !isMeasureKind(markup.type)) drawSketchReadout(ctx, from, hover, store.scaleAt(pageIndex, from), zoom);
    }
    if (this.snapHit && this.snapPage === pageIndex) drawSnapIndicator(ctx, this.snapHit, zoom);
    if (this.ghost?.pageIndex === pageIndex && this.state.tool === 'eraser') {
      const [x, y] = this.ghost.at;
      ctx.save();
      ctx.strokeStyle = '#e11d48';
      ctx.lineWidth = 1 / zoom;
      ctx.beginPath();
      ctx.arc(x, y, ERASER_PX[settings.get().eraserSize] / zoom, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    const offsetSource = this.state.tool === 'offset' ? this.state.painterSource : null;
    if (offsetSource && this.ghost?.pageIndex === pageIndex && offsetSource.pageIndex === pageIndex) {
      const points = offsetPoints(offsetSource, offsetDistance(offsetSource, this.ghost.at));
      if (points) {
        ctx.save();
        ctx.globalAlpha = 0.5;
        drawMarkup(ctx, { ...offsetSource, points }, zoom, scale);
        ctx.restore();
      }
    }
    if (g?.kind === 'box' && pageIndex === this.page) drawSelectionOutline(ctx, [g.start, [g.end[0], g.start[1]], g.end, [g.start[0], g.end[1]]], zoom);
    if (g?.kind === 'lasso' && g.pageIndex === pageIndex) drawSelectionOutline(ctx, g.path, zoom);
    const template = this.state.preset?.template;
    if (template && this.ghost?.pageIndex === pageIndex) {
      const b = boundsOf(template.flatMap((m) => m.points));
      const [x, y] = this.ghost.at;
      ctx.save();
      ctx.globalAlpha = 0.5;
      for (const m of template) drawMarkup(ctx, { ...m, points: translated(m, x - (b.x + b.w / 2), y - (b.y + b.h / 2)) }, zoom, scale);
      ctx.restore();
    }
  }

  /** Viewports: dashed outlines with their name and scale, so measurements inside are explained. */
  private drawViewports(ctx: CanvasRenderingContext2D, pageIndex: number, zoom: number) {
    const viewports = this.store?.allViewports().filter((v) => v.pageIndex === pageIndex) ?? [];
    if (!viewports.length) return;
    const px = 1 / zoom;
    ctx.save();
    ctx.font = `${11 * px}px system-ui, sans-serif`;
    ctx.textBaseline = 'top';
    for (const v of viewports) {
      const { x, y, w, h } = v.rect;
      ctx.strokeStyle = '#0d9488';
      ctx.lineWidth = px;
      ctx.setLineDash([6 * px, 4 * px]);
      ctx.strokeRect(x, y, w, h);
      const label = `${v.name} · ${v.scale.label}`;
      const tw = ctx.measureText(label).width + 8 * px;
      ctx.fillStyle = 'rgba(13, 148, 136, 0.85)';
      ctx.fillRect(x, y, tw, 16 * px);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, x + 4 * px, y + 2.5 * px);
    }
    ctx.restore();
  }

  /** Page-label regions to outline on every page (they apply at the same place on each sheet). */
  setRegions(regions: readonly PageRect[]) {
    this.regions = regions;
    this.viewer.invalidate();
  }

  private drawRegions(ctx: CanvasRenderingContext2D, zoom: number) {
    if (!this.regions.length) return;
    ctx.save();
    ctx.lineWidth = 1.5 / zoom;
    ctx.setLineDash([6 / zoom, 4 / zoom]);
    ctx.font = `600 ${12 / zoom}px system-ui, sans-serif`;
    this.regions.forEach((r, i) => {
      ctx.strokeStyle = REGION_STYLE.stroke;
      ctx.fillStyle = 'rgba(37, 99, 235, 0.08)';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeRect(r.x, r.y, r.w, r.h);
      const tag = String(i + 1);
      const s = 16 / zoom;
      ctx.fillStyle = REGION_STYLE.stroke;
      ctx.fillRect(r.x, r.y - s, s, s);
      ctx.fillStyle = '#fff';
      ctx.fillText(tag, r.x + 4 / zoom, r.y - 4 / zoom);
    });
    ctx.restore();
  }

  /** While a measurement is being clicked out, pointer positions are wanted in its page's space. */
  activePage(): number | null {
    return this.gesture?.kind === 'multi' ? this.gesture.markup.pageIndex : null;
  }

  pointerDown(e: PointerEvent, pt: PagePoint, pageIndex: number): boolean {
    this.page = pageIndex;
    this.pointerKind = e.pointerType || 'mouse';
    if (!this.store) return false;
    const { tool } = this.state;

    if (tool === 'painter') {
      const hit = this.hitAt(toPoint(pt));
      const source = this.state.painterSource;
      if (hit && source && !this.frozen(hit) && !this.store.readOnly) {
        this.store.checkpoint();
        this.store.update(hit.id, { style: paintedStyle(source, hit) });
      }
      return true;
    }

    if (tool === 'eraser') {
      if (e.button !== 0 || this.store.readOnly) return false;
      this.store.checkpoint();
      this.setGesture({ kind: 'erase', pageIndex });
      this.eraseAt(pageIndex, toPoint(pt));
      return true;
    }

    if (tool === 'offset') {
      const source = this.state.painterSource;
      if (e.button !== 0 || !source || this.store.readOnly) return false;
      const points = offsetPoints(source, offsetDistance(source, toPoint(pt)));
      if (!points) return true;
      const now = Date.now();
      const copy: Markup = { ...structuredClone(source), id: crypto.randomUUID(), points, groupId: undefined, locked: undefined, status: 'none', author: this.options.author(), createdAt: now, modifiedAt: now };
      this.store.checkpoint();
      this.store.add(copy);
      this.ghost = null;
      this.setState({ tool: 'select', painterSource: null, selected: new Set([copy.id]) });
      return true;
    }

    if (tool === 'editText') {
      if (e.button !== 0) return false;
      this.options.onEditPdfText?.(pageIndex, toPoint(pt));
      return true;
    }

    if (tool === 'dynamicFill') {
      if (e.button !== 0) return false;
      void this.fillAt(pageIndex, toPoint(pt));
      return true;
    }

    if (tool === 'lasso') {
      this.setGesture({ kind: 'lasso', pageIndex, path: [toPoint(pt)], add: e.shiftKey });
      return true;
    }

    const template = this.state.preset?.template;
    if (template && tool !== 'select') {
      if (e.button !== 0) return false;
      this.ghost = null;
      this.placeTemplate(template, pageIndex, pt, !this.state.preset?.once);
      return true;
    }

    const spec = clickSpec(tool);
    if (spec) {
      const g = this.gesture;
      const p = this.resolve(pt, e, g?.kind === 'multi' ? g.markup.points.at(-1)! : null);
      if (g?.kind === 'multi') {
        const { markup } = g;
        const first = markup.points[0]!;
        const closes = !!spec.closes && markup.points.length >= 3 && Math.hypot(p[0] - first[0], p[1] - first[1]) * this.viewer.zoomFor(this.page) <= SNAP_PX;
        if (closes) {
          this.finish();
          return true;
        }
        markup.points = [...markup.points, p];
        g.down = p;
        this.completeIfFixed();
        this.refreshSketch();
        return true;
      }
      // A cutout is drawn inside its area, on the area's page.
      if (tool === 'cutout' && this.store.get(this.cutoutTarget ?? '')?.pageIndex !== pageIndex) return false;
      const markup = this.newMarkup(tool === 'calibrate' ? 'line' : tool === 'cutout' ? 'polygon' : (tool as MarkupType), pageIndex, [p]);
      if (tool === 'calibrate') markup.style = { ...CALIBRATE_STYLE };
      if (tool === 'cutout') markup.style = { ...CALIBRATE_STYLE, dash: 'dashed' };
      this.setGesture({ kind: 'multi', markup, hover: p, down: p, calibrate: tool === 'calibrate' });
      return true;
    }

    this.store.checkpoint();

    if (REGION_TOOLS.has(tool)) {
      const p = toPoint(pt);
      const markup = this.newMarkup('rect', pageIndex, [p, p]);
      markup.style = { ...REGION_STYLE };
      this.setGesture({ kind: 'draw', markup });
      return true;
    }

    if ((isMarkupTool(tool) && TYPE_INFO[tool].draw === 'text') || tool === 'selectText') {
      if (e.button !== 0) return false;
      // Select Text shows its selection like a highlight, but only copies the text.
      const markup = this.newMarkup(tool === 'selectText' ? 'textHighlight' : tool, pageIndex, []);
      if (tool === 'selectText') markup.style = { ...markup.style, stroke: '#3b82f6', opacity: 0.35 };
      this.setGesture({ kind: 'textMark', markup, from: toPoint(pt) });
      this.wordsFor(pageIndex);
      return true;
    }

    // Calibration is click-by-click and handled above.
    if (tool !== 'select' && tool !== 'calibrate') {
      // Cloud+ draws a cloud, then adds a callout pointing at it.
      const type: MarkupType = tool === 'cloudPlus' ? 'cloud' : (tool as MarkupType);
      const p = snapsWhileDrawing(type) ? this.resolve(pt, e, null) : toPoint(pt);
      const markup = this.newMarkup(type, pageIndex, TYPE_INFO[type].draw === 'freehand' ? [p] : [p, p]);
      this.setGesture({ kind: 'draw', markup });
      return true;
    }

    // Handles of a single selected markup take priority.
    const p = toPoint(pt);
    const zoom = this.viewer.zoomFor(this.page);
    const tol = this.hitPx / zoom;
    if (this.state.selected.size === 1) {
      const [id] = this.state.selected;
      const m = this.store.get(id!);
      const knob = m ? rotateHandle(m, zoom) : null;
      if (m && knob && Math.hypot(knob.at[0] - p[0], knob.at[1] - p[1]) <= tol * 1.5 && !this.store.readOnly) {
        this.setGesture({ kind: 'rotate', id: m.id, angle: m.rotation ?? 0 });
        return true;
      }
      const index = m && !this.frozen(m) ? handlePositions(m).findIndex(([x, y]) => Math.abs(x - p[0]) <= tol && Math.abs(y - p[1]) <= tol) : -1;
      if (m && index >= 0) {
        // Ctrl- or Alt-click on a vertex removes it (keeping the least the shape needs).
        if ((e.ctrlKey || e.metaKey || e.altKey) && canEditVertices(m) && m.points.length > (CLICK_SHAPES[m.type]?.min ?? 2)) {
          // The two segments meeting there become one straight one.
          const bulges = m.bulges ? [...m.bulges] : undefined;
          bulges?.splice(Math.max(0, index - 1), index === 0 || index === m.points.length - 1 ? 1 : 2, ...(index === 0 || index === m.points.length - 1 ? [] : [0]));
          this.store.update(m.id, { points: m.points.filter((_, i) => i !== index), ...(bulges ? { bulges } : {}) });
          return true;
        }
        this.setGesture({ kind: 'handle', id: m.id, index, point: p });
        return true;
      }
      const mid = m && !this.frozen(m) ? midpoints(m).find(({ at }) => Math.hypot(at[0] - p[0], at[1] - p[1]) <= tol) : undefined;
      if (m && mid && e.altKey && ARC_TYPES.has(m.type)) {
        // Alt-dragging a midpoint knob curves that segment (arc segments in measurements).
        this.setGesture({ kind: 'bend', id: m.id, segment: mid.index - 1, bulge: m.bulges?.[mid.index - 1] ?? 0 });
        return true;
      }
      if (m && mid) {
        // Dragging a midpoint knob adds a vertex there (splitting a curved segment into two straight ones).
        const points = [...m.points];
        points.splice(mid.index, 0, mid.at);
        const bulges = m.bulges ? [...m.bulges] : undefined;
        bulges?.splice(mid.index - 1, 1, 0, 0);
        this.store.update(m.id, { points, ...(bulges ? { bulges } : {}) });
        this.setGesture({ kind: 'handle', id: m.id, index: mid.index, point: p });
        return true;
      }
    }

    const hit = this.hitAt(p);
    if (!hit) {
      const widget = e.shiftKey ? undefined : this.formAt(p);
      if (widget) {
        this.select([]);
        this.setGesture({ kind: 'formField', widget, start: p });
        return true;
      }
      const link = this.linkAt(p);
      if (link && !e.shiftKey) {
        this.select([]);
        this.setGesture({ kind: 'link', link, start: p });
        return true;
      }
      // Shift+drag always draws a selection box; a plain drag does too if the preference says so,
      // otherwise it pans the view.
      if (e.shiftKey || settings.get().dragToSelect) {
        this.setGesture({ kind: 'box', start: p, end: p, add: e.shiftKey });
        return true;
      }
      this.select([]);
      // Pressing on a word of the page's text selects text (copy only); elsewhere the drag pans.
      const words = e.button === 0 ? this.wordsFor(pageIndex) : null;
      if (words && wordAt(words, p, TEXT_REACH_PX / zoom) >= 0) {
        const markup = this.newMarkup('textHighlight', pageIndex, []);
        markup.style = { ...markup.style, stroke: '#3b82f6', opacity: 0.35 };
        this.setGesture({ kind: 'textMark', markup, from: p, copyOnly: true });
        return true;
      }
      return false;
    }
    // A plain click on a markup with an action follows it; Ctrl/Alt-click, Shift-click or dragging selects it.
    if (hit.link && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey && !this.state.selected.has(hit.id)) {
      this.setGesture({ kind: 'hyperlink', markup: hit, start: p });
      return true;
    }
    // A callout's text box drags on its own, leaving the arrow tip where it points.
    if (hit.type === 'callout' && !this.frozen(hit) && !e.shiftKey && !this.store.readOnly && hit.points.length >= 4) {
      const box = boundsOf(hit.points.slice(2, 4));
      if (p[0] >= box.x && p[0] <= box.x + box.w && p[1] >= box.y && p[1] <= box.y + box.h) {
        // The whole group (a Cloud+'s cloud and callout) is selected, but only the text box moves.
        if (!this.state.selected.has(hit.id)) this.select(this.withGroups([hit.id]));
        this.setGesture({ kind: 'calloutBox', id: hit.id, start: p, dx: 0, dy: 0 });
        return true;
      }
    }
    const members = this.withGroups([hit.id]);
    if (e.shiftKey) {
      const next = new Set(this.state.selected);
      const on = !next.has(hit.id);
      for (const id of members) {
        if (on) next.add(id);
        else next.delete(id);
      }
      this.select(next);
    } else if (!this.state.selected.has(hit.id)) {
      this.select(members);
    }
    this.setGesture({ kind: 'move', start: p, dx: 0, dy: 0 });
    return true;
  }

  pointerMove(e: PointerEvent, pt: PagePoint, pageIndex: number) {
    this.page = pageIndex;
    const g = this.gesture;
    if (!g || g.kind === 'link' || g.kind === 'formField') return;
    if (g.kind === 'hyperlink') {
      const p = toPoint(pt);
      if (Math.hypot(p[0] - g.start[0], p[1] - g.start[1]) * this.viewer.zoomFor(this.page) < this.dragPx) return;
      this.select(this.withGroups([g.markup.id]));
      this.setGesture({ kind: 'move', start: g.start, dx: p[0] - g.start[0], dy: p[1] - g.start[1] });
      this.viewer.invalidate();
      return;
    }
    if (g.kind === 'erase') {
      this.eraseAt(g.pageIndex, toPoint(pt));
      return;
    }
    if (g.kind === 'textMark') {
      const words = this.wordsFor(g.markup.pageIndex);
      const reach = TEXT_REACH_PX / this.viewer.zoomFor(g.markup.pageIndex);
      const { points, text } = lineRects(words ? selectRange(words, g.from, toPoint(pt), reach) : []);
      g.markup.points = points;
      g.markup.comment = text;
    } else if (g.kind === 'box') {
      g.end = toPoint(pt);
    } else if (g.kind === 'lasso') {
      const p = toPoint(pt);
      const last = g.path[g.path.length - 1]!;
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) * this.viewer.zoomFor(this.page) >= 3) g.path = [...g.path, p];
    } else if (g.kind === 'multi') {
      g.hover = this.resolve(pt, e, g.markup.points.at(-1)!);
    } else if (g.kind === 'draw') {
      const m = g.markup;
      if (TYPE_INFO[m.type].draw === 'freehand') {
        const p = toPoint(pt);
        const last = m.points[m.points.length - 1]!;
        if (Math.hypot(p[0] - last[0], p[1] - last[1]) * this.viewer.zoomFor(this.page) >= 1.5) m.points = [...m.points, p];
      } else if (m.type === 'signature' || m.type === 'image') {
        m.points = [m.points[0]!, keepAspect(m.points[0]!, toPoint(pt), this.state.preset?.aspect ?? 3)];
      } else if (m.type === 'stamp') {
        m.points = [m.points[0]!, keepAspect(m.points[0]!, toPoint(pt), m.stamp ? stampAspect(m.stamp) : 3)];
      } else if (m.type === 'callout') {
        // The arrow tip stays where the drag began; the box follows the pointer.
        m.points = calloutPoints(m.points[0]!, toPoint(pt), CALLOUT_BOX.w, CALLOUT_BOX.h, CALLOUT_LANDING_PX / this.viewer.zoomFor(this.page));
      } else if (TYPE_INFO[m.type].draw === 'place') {
        // Placed with a click at a fixed size; dragging does not size them.
      } else if (e.shiftKey) {
        this.snapHit = null;
        m.points = [m.points[0]!, constrain(m.type, m.points[0]!, toPoint(pt))];
      } else {
        // Boxes that pick out a region (a label region, viewport or symbol to search for) do not snap.
        const region = REGION_TOOLS.has(this.state.tool);
        m.points = [m.points[0]!, m.type === 'text' || region ? toPoint(pt) : this.resolve(pt, e, null)];
      }
    } else if (g.kind === 'bend') {
      const m = this.store?.get(g.id);
      if (m) {
        const a = m.points[g.segment]!;
        const b = m.points[(g.segment + 1) % m.points.length]!;
        // Nearly straight snaps straight; at most three-quarters of a circle.
        const bulge = bulgeThrough(a, b, toPoint(pt));
        g.bulge = Math.abs(bulge) < 0.02 ? 0 : Math.max(-2.4, Math.min(2.4, bulge));
      }
    } else if (g.kind === 'move' || g.kind === 'calloutBox') {
      const p = toPoint(pt);
      g.dx = p[0] - g.start[0];
      g.dy = p[1] - g.start[1];
    } else if (g.kind === 'rotate') {
      const m = this.store?.get(g.id);
      if (m) {
        const [cx, cy] = rotationCentre(m);
        // The handle sits above the box, so pointing straight up is no turn; Shift snaps to 15°.
        let angle = (Math.atan2(pt[1] - cy, pt[0] - cx) * 180) / Math.PI + 90;
        angle = e.shiftKey ? Math.round(angle / 15) * 15 : Math.round(angle * 10) / 10;
        g.angle = ((angle % 360) + 360) % 360;
      }
    } else {
      const m = this.store?.get(g.id);
      const anchor = m && CLICK_SHAPES[m.type] ? (m.points[g.index - 1] ?? m.points[g.index + 1] ?? null) : null;
      g.point = this.resolve(pt, e, anchor, g.id);
    }
    this.viewer.invalidate();
  }

  pointerUp(e: PointerEvent, pt: PagePoint, pageIndex: number) {
    this.page = pageIndex;
    const g = this.gesture;
    if (!g || !this.store) return;
    if (g.kind === 'multi') {
      // Pressing, dragging and releasing places the second point, so a length can be dragged out.
      const p = this.resolve(pt, e, g.markup.points.at(-1)!);
      if (g.markup.points.length === 1 && Math.hypot(p[0] - g.down[0], p[1] - g.down[1]) * this.viewer.zoomFor(this.page) > this.dragPx) {
        g.markup.points = [...g.markup.points, p];
        this.completeIfFixed();
        this.refreshSketch();
      }
      return;
    }
    this.setGesture(null);
    if (g.kind === 'link') {
      if (Math.hypot(pt[0] - g.start[0], pt[1] - g.start[1]) * this.viewer.zoomFor(this.page) < this.dragPx) this.options.onFollowLink(g.link);
      return;
    }
    if (g.kind === 'hyperlink') {
      this.options.onFollowHyperlink?.(g.markup);
      return;
    }
    if (g.kind === 'formField') {
      if (Math.hypot(pt[0] - g.start[0], pt[1] - g.start[1]) * this.viewer.zoomFor(this.page) < this.dragPx) this.options.onFormField?.(g.widget);
      return;
    }
    if (g.kind === 'textMark') {
      if (g.markup.points.length < 2) return;
      if (g.copyOnly || this.state.tool === 'selectText') {
        if (g.markup.comment) this.options.onTextSelected?.(g.markup.comment);
        return;
      }
      this.store.checkpoint();
      this.store.add({ ...g.markup, createdAt: Date.now(), modifiedAt: Date.now() });
      this.options.onCreated?.(g.markup);
      if (g.markup.type === 'replaceText') this.options.onEditLabel?.(g.markup.id);
      return;
    }
    if (g.kind === 'box' || g.kind === 'lasso') {
      const page = g.kind === 'lasso' ? g.pageIndex : this.page;
      const inside = this.pageMarkups(page).filter((m) =>
        g.kind === 'box' ? insideRect(m, boundsOf([g.start, g.end])) : g.path.length > 2 && insidePolygon(m, g.path),
      );
      const ids = inside.map((m) => m.id);
      this.select(g.add ? [...this.state.selected, ...ids] : ids);
      return;
    }
    if (g.kind === 'draw') this.commitDraft(g.markup);
    else if (g.kind === 'move') {
      if (g.dx || g.dy) {
        const store = this.store;
        store.batch(() => {
          for (const id of this.state.selected) {
            const m = store.get(id);
            if (m && !this.frozen(m)) store.update(id, moved(m, g.dx, g.dy));
          }
        });
      }
    } else if (g.kind === 'calloutBox') {
      const m = this.store.get(g.id);
      if (m && (g.dx || g.dy)) this.store.update(g.id, { points: calloutBoxMoved(m.points, g.dx, g.dy) });
    } else if (g.kind === 'handle') {
      const m = this.store.get(g.id);
      if (m) this.store.update(g.id, { points: handleEdit(m, g.index, g.point) });
    } else if (g.kind === 'bend') {
      const m = this.store.get(g.id);
      if (m) this.store.update(g.id, { bulges: withBulge(m, g.segment, g.bulge) });
    } else if (g.kind === 'rotate') {
      const m = this.store.get(g.id);
      if (m) this.store.update(g.id, { rotation: g.angle || undefined });
    }
    this.snapHit = null;
  }

  /** Double-click finishes a measurement, or edits the text box under the pointer. */
  doubleClick(pt: PagePoint, pageIndex: number) {
    this.page = pageIndex;
    if (this.gesture?.kind === 'multi') {
      this.finish();
      return;
    }
    const hit = this.state.tool === 'select' ? this.hitAt(toPoint(pt)) : undefined;
    if (hit && isTextType(hit.type) && !this.frozen(hit)) this.options.onEditText(hit.id);
    else if (hit?.type === 'note' || hit?.type === 'flag') this.options.onEditComment?.(hit.id);
    else if (hit?.type === 'attachment') this.options.onOpenAttachment?.(hit);
    else if ((hit?.type === 'dimension' || hit?.type === 'replaceText') && !this.frozen(hit)) this.options.onEditLabel?.(hit.id);
    else if (hit?.type === 'hyperlink' && !this.frozen(hit)) this.options.onEditHyperlink?.(hit.id);
  }

  hover(pt: PagePoint | null, pageIndex: number): string | null {
    this.page = pageIndex;
    const { tool } = this.state;
    if (!pt) {
      this.snapHit = null;
      this.ghost = null;
      if (this.gesture?.kind === 'multi') this.gesture.hover = null;
      this.viewer.invalidate();
      return null;
    }
    if (tool === 'painter') return this.hitAt(toPoint(pt)) ? 'copy' : 'not-allowed';
    if (tool === 'eraser' || tool === 'offset') {
      this.ghost = { pageIndex, at: toPoint(pt) };
      this.viewer.invalidate();
      return tool === 'eraser' ? 'none' : 'crosshair';
    }
    if (tool === 'editText') return 'text';
    if ((isMarkupTool(tool) && TYPE_INFO[tool].draw === 'text') || tool === 'selectText') {
      const words = this.wordsFor(pageIndex);
      return words && wordAt(words, toPoint(pt), TEXT_REACH_PX / this.viewer.zoomFor(pageIndex)) >= 0 ? 'text' : 'default';
    }
    if (tool === 'lasso') return 'crosshair';
    if (tool === 'select') {
      const p = toPoint(pt);
      const hit = this.hitAt(p);
      const widget = hit ? undefined : this.formAt(p);
      if (widget) return widget.readOnly ? 'not-allowed' : 'pointer';
      const link = hit ? null : this.linkAt(p);
      const words = hit || widget || link ? null : this.wordsFor(pageIndex);
      const overText = !!words && wordAt(words, p, TEXT_REACH_PX / this.viewer.zoomFor(pageIndex)) >= 0;
      const hyper = hit?.link && !this.state.selected.has(hit.id) ? hit : null;
      const hovered = link?.id ?? hyper?.id ?? null;
      if (this.snapHit || hovered !== this.hoveredLink) {
        this.snapHit = null;
        this.hoveredLink = hovered;
        this.viewer.invalidate();
      }
      return link || hyper ? 'pointer' : hit ? 'move' : overText ? 'text' : null;
    }
    if (this.state.preset?.template) {
      this.ghost = { pageIndex, at: toPoint(pt) };
      this.viewer.invalidate();
      return 'copy';
    }
    // Preview the snap target before the first click, and rubber-band between clicks.
    const g = this.gesture;
    const mods = lastModifiers;
    if (g?.kind === 'multi') g.hover = this.resolve(pt, mods, g.markup.points.at(-1)!);
    else if (tool === 'calibrate' || (isMarkupTool(tool) && snapsWhileDrawing(tool))) this.resolve(pt, mods, null);
    this.viewer.invalidate();
    return 'crosshair';
  }

  // --- helpers ---------------------------------------------------------------------------

  private formWidgets: FormWidgetHit[] = [];

  /** The document's form fields, for clicking to fill in (drawn as light boxes). */
  setFormWidgets(widgets: FormWidgetHit[]) {
    this.formWidgets = widgets;
    this.viewer.invalidate();
  }

  private formAt([x, y]: Point): FormWidgetHit | undefined {
    return this.formWidgets.find((w) => w.pageIndex === this.page && x >= w.rect.x && x <= w.rect.x + w.rect.w && y >= w.rect.y && y <= w.rect.y + w.rect.h);
  }

  /** Form fields as light boxes, so they can be found on the page. */
  private drawFormWidgets(ctx: CanvasRenderingContext2D, pageIndex: number) {
    const list = this.formWidgets.filter((w) => w.pageIndex === pageIndex);
    if (!list.length) return;
    ctx.save();
    for (const w of list) {
      ctx.fillStyle = w.readOnly ? 'rgba(100, 116, 139, 0.08)' : 'rgba(37, 99, 235, 0.1)';
      ctx.fillRect(w.rect.x, w.rect.y, w.rect.w, w.rect.h);
    }
    ctx.restore();
  }

  private pageLinks(pageIndex: number): StoredLink[] {
    return this.store ? this.store.allLinks().filter((l) => l.pageIndex === pageIndex && l.status !== 'rejected') : [];
  }

  private linkAt([x, y]: Point): StoredLink | undefined {
    return this.pageLinks(this.page).find((l) => x >= l.rect.x && x <= l.rect.x + l.rect.w && y >= l.rect.y && y <= l.rect.y + l.rect.h);
  }

  /** Link areas as light boxes (dashed when awaiting review), plus the post-navigation flash. */
  private drawLinks(ctx: CanvasRenderingContext2D, pageIndex: number, zoom: number) {
    const px = 1 / zoom;
    ctx.save();
    // Hyperlink markups drawn without a border still show where they are while links are shown.
    for (const m of this.pageMarkups(pageIndex)) {
      if (m.type !== 'hyperlink' || (!this.state.showLinks && m.id !== this.hoveredLink)) continue;
      const b = boundsOf(m.points);
      ctx.fillStyle = m.id === this.hoveredLink ? 'rgba(37, 99, 235, 0.25)' : 'rgba(37, 99, 235, 0.08)';
      ctx.fillRect(b.x, b.y, b.w, b.h);
    }
    if (this.state.showLinks) {
      for (const l of this.pageLinks(pageIndex)) {
        const hovered = l.id === this.hoveredLink;
        ctx.fillStyle = hovered ? 'rgba(37, 99, 235, 0.25)' : 'rgba(37, 99, 235, 0.08)';
        ctx.fillRect(l.rect.x, l.rect.y, l.rect.w, l.rect.h);
        ctx.strokeStyle = l.status === 'review' ? '#d97706' : '#2563eb';
        ctx.lineWidth = (hovered ? 2 : 1) * px;
        ctx.setLineDash(l.status === 'review' ? [4 * px, 3 * px] : []);
        ctx.strokeRect(l.rect.x, l.rect.y, l.rect.w, l.rect.h);
      }
    }
    this.highlights.forEach((h, i) => {
      if (h.pageIndex !== pageIndex) return;
      ctx.setLineDash([]);
      ctx.fillStyle = i === this.activeHighlight ? 'rgba(249, 115, 22, 0.45)' : 'rgba(250, 204, 21, 0.4)';
      for (const r of h.rects) ctx.fillRect(r.x, r.y, r.w, r.h);
    });
    const f = this.flashing;
    if (f && f.pageIndex === pageIndex) {
      const left = f.until - performance.now();
      if (left > 0) {
        ctx.setLineDash([]);
        ctx.strokeStyle = `rgba(234, 88, 12, ${Math.min(1, left / 600)})`;
        ctx.lineWidth = 3 * px;
        ctx.strokeRect(f.rect.x, f.rect.y, f.rect.w, f.rect.h);
        requestAnimationFrame(() => this.viewer.invalidate());
      } else {
        this.flashing = null;
      }
    }
    ctx.restore();
  }

  private newMarkup(type: MarkupType, pageIndex: number, points: Point[]): Markup {
    const zoom = this.viewer.zoomFor(this.page);
    const preset = this.state.preset?.type === type ? this.state.preset : null;
    const style = { ...(preset?.style ?? this.state.styles[type]) };
    // Size decorations for the current zoom so they look consistent on screen when drawn.
    // Sizes the user set explicitly in the tool's defaults are kept as they are.
    if (preset?.stamp) style.stroke = preset.stamp.color;
    if (type === 'cloud') style.arcRadius ??= CLOUD_ARC_PX / zoom;
    if (type === 'legend') style.fontSize ??= LABEL_PX / zoom;
    if (type === 'space') style.fontSize ??= (LABEL_PX * 1.4) / zoom;
    if (isMeasureKind(type)) {
      style.arcRadius ??= MARKER_PX / zoom;
      style.fontSize ??= LABEL_PX / zoom;
    }
    const now = Date.now();
    const fields = this.options.defaultFields?.();
    return {
      id: crypto.randomUUID(),
      type,
      pageIndex,
      points,
      style,
      status: 'none',
      author: this.options.author(),
      createdAt: now,
      modifiedAt: now,
      ...(preset?.subject ? { subject: preset.subject } : preset?.stamp ? { subject: preset.stamp.name } : {}),
      ...(preset?.image ? { image: preset.image } : {}),
      ...(preset?.attachment ? { attachment: preset.attachment } : {}),
      ...(preset?.signature ? { signature: preset.signature } : {}),
      ...(preset?.stamp ? { stamp: resolveStamp(preset.stamp, { user: this.options.author(), now: new Date(now), ...(this.options.stampValues?.(pageIndex) ?? { file: '', page: String(pageIndex + 1) }) }) } : {}),
      ...(fields && Object.keys(fields).length ? { fields } : {}),
    };
  }

  private completeIfFixed() {
    const g = this.gesture;
    if (g?.kind !== 'multi') return;
    const needed = g.calibrate ? 2 : clickSpec(g.markup.type)?.fixed;
    if (needed && g.markup.points.length >= needed) this.finish();
  }

  /**
   * Final position for a pointer location: Shift constrains to 45° steps from `anchor`; otherwise
   * the point snaps to nearby drawing geometry and markup vertices (hold Alt to bypass snapping).
   */
  private resolve(pt: PagePoint, mods: Modifiers, anchor: Point | null, excludeId?: string): Point {
    const p = toPoint(pt);
    this.snapHit = null;
    if (mods.shiftKey && anchor) return constrain('line', anchor, p);
    const prefs = settings.get();
    if (mods.altKey || (!this.state.snap && !prefs.snapToGrid && !prefs.snapToMarkup)) return p;
    // In a stitched view the pointer can be over a neighbouring sheet: snap to that sheet's
    // geometry, then map the result back into the gesture's page.
    const under = this.viewer.pageUnder(this.page, p) ?? this.page;
    const hit = this.snapOnPage(under, this.viewer.mapPoint(this.page, under, p), excludeId);
    if (!hit) {
      if (!prefs.snapToGrid) return p;
      // No drawing geometry nearby: the nearest grid point.
      const g = gridSpacingPoints(prefs);
      const q: Point = [Math.round(p[0] / g) * g, Math.round(p[1] / g) * g];
      this.snapHit = { point: q, kind: 'endpoint' };
      this.snapPage = this.page;
      return q;
    }
    const back = this.viewer.mapPoint(under, this.page, hit.point);
    this.snapHit = { ...hit, point: [back[0], back[1]] };
    this.snapPage = this.page;
    return [back[0], back[1]];
  }

  private snapOnPage(pageIndex: number, p: Point, excludeId?: string): Snap | null {
    const index = this.state.snap ? this.snapIndexFor(pageIndex) : null;
    const extra: Point[] = [];
    if (settings.get().snapToMarkup) {
      for (const m of this.pageMarkups(pageIndex)) {
        if (m.id === excludeId || !snapTarget(m.type)) continue;
        extra.push(...m.points);
      }
    }
    const g = this.gesture;
    // Earlier vertices of the measurement in progress (in its own page's space), so a polygon can
    // close on its start.
    if (g?.kind === 'multi') for (const q of g.markup.points) extra.push(this.viewer.mapPoint(g.markup.pageIndex, pageIndex, q));
    const radius = SNAP_PX / this.viewer.zoomFor(pageIndex);
    return index ? index.snap(p, radius, extra) : nearestPoint(p, extra, radius);
  }

  /** Cached snap index for a page, loading it in the background on first use. */
  private snapIndexFor(pageIndex: number): SnapIndex | null {
    const cached = this.snapIndexes.get(pageIndex);
    if (cached && cached !== 'loading') return cached;
    if (!cached && this.snapSource) {
      this.snapIndexes.set(pageIndex, 'loading');
      const source = this.snapSource;
      source(pageIndex)
        .then((index) => {
          if (this.snapSource === source) this.snapIndexes.set(pageIndex, index);
        })
        .catch((err) => {
          console.error('Loading snap geometry failed', err);
          this.snapIndexes.delete(pageIndex);
        });
    }
    return null;
  }

  private commitDraft(m: Markup) {
    const zoom = this.viewer.zoomFor(this.page);
    if (REGION_TOOLS.has(this.state.tool)) {
      const b = boundsOf(m.points);
      if (Math.min(b.w, b.h) * zoom < this.dragPx) return;
      if (this.state.tool === 'formField') {
        // The tool stays on, for drawing several fields.
        this.options.onFormFieldDrawn?.(m.pageIndex, b);
      } else if (this.state.tool === 'eraseContent') {
        // The tool stays on, for erasing several areas.
        this.options.onEraseContent?.(m.pageIndex, b);
      } else if (this.state.tool === 'cropArea') {
        this.options.onCropArea?.(m.pageIndex, b);
        this.setState({ tool: 'select' });
      } else if (this.state.tool === 'visualSearch') {
        this.options.onVisualSearch?.(m.pageIndex, b);
        this.setState({ tool: 'select' });
      } else if (this.state.tool === 'viewport') {
        this.options.onViewport?.(m.pageIndex, b);
        this.setState({ tool: 'select' });
      } else if (this.state.tool === 'snapshot') {
        this.options.onSnapshot?.(m.pageIndex, b);
        this.setState({ tool: 'select' });
      } else if (this.state.tool === 'cutContent') {
        this.options.onCutContent?.(m.pageIndex, b);
        this.setState({ tool: 'select' });
      } else this.options.onRegion?.(m.pageIndex, b);
      return;
    }
    const [a, b] = [m.points[0]!, m.points[m.points.length - 1]!];
    const tiny = Math.hypot(b[0] - a[0], b[1] - a[1]) * zoom < this.dragPx;
    if (m.type === 'signature' || m.type === 'image') {
      if (!m.image) return;
      if (tiny) {
        // A click places the picture at a comfortable on-screen size, centred on the click.
        const w = (m.type === 'image' ? IMAGE_PX : 180) / zoom;
        const h = w / (this.state.preset?.aspect ?? 3);
        m.points = [[a[0] - w / 2, a[1] - h / 2], [a[0] + w / 2, a[1] + h / 2]];
      }
    } else if (m.type === 'stamp') {
      if (!m.stamp) return;
      if (tiny) {
        // A click places the stamp at a comfortable on-screen width, centred on the click.
        const w = STAMP_PX / zoom;
        const h = w / stampAspect(m.stamp);
        m.points = [[a[0] - w / 2, a[1] - h / 2], [a[0] + w / 2, a[1] + h / 2]];
      }
    } else if (m.type === 'legend' && tiny) {
      m.points = [a, [a[0] + LEGEND_PX.w / zoom, a[1] + LEGEND_PX.h / zoom]];
    } else if (m.type === 'note' || m.type === 'attachment' || m.type === 'flag') {
      if (m.type === 'attachment' && !m.attachment) return;
      const s = NOTE_PX / zoom;
      m.points = [a, [a[0] + s * (m.type === 'flag' ? 0.8 : 1), a[1] + s]];
    } else if (m.type === 'typewriter') {
      // Sized to its text once typed (see TextEditor); start one line high.
      const size = m.style.fontSize ?? 12;
      m.points = [a, [a[0] + size * 4, a[1] + size * 1.2 + 8]];
    } else if (m.type === 'text' && tiny) {
      m.points = [a, [a[0] + TEXT_BOX.w, a[1] + TEXT_BOX.h]];
    } else if (m.type === 'callout') {
      const tip = m.points[0]!;
      const box = m.points.length >= 4 ? m.points[2]! : tip;
      // A click (or a drag that barely moved the box) puts the box up and to the right.
      if (m.points.length < 4 || Math.hypot(box[0] - tip[0], box[1] - tip[1]) * zoom < this.dragPx * 4) {
        m.points = calloutPoints(tip, [tip[0] + 60 / zoom, tip[1] - 50 / zoom], CALLOUT_BOX.w, CALLOUT_BOX.h, CALLOUT_LANDING_PX / zoom);
      }
    } else if (TYPE_INFO[m.type].draw === 'freehand') {
      if (m.points.length < 2) m.points = [a, [a[0] + 0.01, a[1]]];
    } else if (tiny) {
      // Draw to Size: a click puts down the corner; the size is typed.
      if (settings.get().sketchToScale && SKETCH_BOX_TYPES.includes(m.type)) {
        this.sketchAnchor = { type: m.type, pageIndex: m.pageIndex, at: a };
        this.refreshSketch();
      }
      return;
    }
    if (this.state.tool === 'cloudPlus') {
      this.addCloudCallout(m);
      return;
    }
    this.store!.add(m);
    this.options.onCreated?.(m);
    if (m.type === 'signature' || this.state.preset?.once || (!settings.get().reuseTool && !this.state.preset)) {
      this.setState({ tool: 'select', preset: null, selected: new Set([m.id]) });
      return;
    }
    if (isTextType(m.type)) {
      // Text boxes switch to select so the new box can be edited and moved immediately.
      this.setState({ tool: 'select', selected: new Set([m.id]) });
      this.options.onEditText(m.id);
    } else if (m.type === 'note') {
      this.setState({ tool: 'select', selected: new Set([m.id]) });
      this.options.onEditComment?.(m.id);
    } else if (m.type === 'hyperlink' && !m.link) {
      this.setState({ tool: 'select', selected: new Set([m.id]) });
      this.options.onEditHyperlink?.(m.id);
    } else if (m.type === 'dimension') {
      this.options.onEditLabel?.(m.id);
    }
  }

  /**
   * Rubs out the parts of pen and highlighter strokes on a page within the eraser's reach; the
   * annotation eraser deletes whole markups it touches.
   */
  private eraseAt(pageIndex: number, at: Point) {
    if (!this.store) return;
    const r = ERASER_PX[settings.get().eraserSize] / this.viewer.zoomFor(pageIndex);
    this.ghost = { pageIndex, at };
    if (settings.get().eraserWhole) {
      const touched = this.pageMarkups(pageIndex).filter((m) => !this.frozen(m) && hitTest(m, at, r));
      if (touched.length) this.store.remove(touched.map((m) => m.id));
      this.viewer.invalidate();
      return;
    }
    const store = this.store;
    store.batch(() => {
      for (const m of this.pageMarkups(pageIndex)) {
        if (TYPE_INFO[m.type].draw !== 'freehand' || this.frozen(m)) continue;
        const pieces = eraseStroke(m.points, at, r + m.style.width / 2);
        if (!pieces) continue;
        store.remove([m.id]);
        // Each surviving piece is its own stroke, keeping the original's place in the stacking order.
        pieces.forEach((points, i) => store.add({ ...m, id: i === 0 ? m.id : crypto.randomUUID(), points, createdAt: m.createdAt + i * 1e-3 }));
      }
    });
    this.viewer.invalidate();
  }

  /** Cloud+: the cloud just drawn, plus a callout from its top-right corner, as one group. */
  private addCloudCallout(cloud: Markup) {
    const zoom = this.viewer.zoomFor(this.page);
    const b = boundsOf(cloud.points);
    const groupId = crypto.randomUUID();
    const tip: Point = [b.x + b.w, b.y];
    const callout = this.newMarkup('callout', cloud.pageIndex, calloutPoints(tip, [tip[0] + 40 / zoom, tip[1] - 40 / zoom], CALLOUT_BOX.w, CALLOUT_BOX.h, CALLOUT_LANDING_PX / zoom));
    // The callout takes the cloud's colour, so the pair reads as one markup.
    callout.style = { ...callout.style, stroke: cloud.style.stroke };
    if (cloud.subject) callout.subject = cloud.subject;
    this.store!.add({ ...cloud, groupId });
    this.store!.add({ ...callout, groupId, createdAt: cloud.createdAt + 1, modifiedAt: cloud.createdAt + 1 });
    this.options.onCreated?.(cloud);
    this.setState({ tool: 'select', selected: new Set([cloud.id, callout.id]) });
    this.options.onEditText(callout.id);
  }

  /** A page's markups in drawing order: Spaces underneath everything, then oldest first. */
  private pageMarkups(pageIndex: number): Markup[] {
    if (!this.store) return [];
    const showSpaces = settings.get().showSpaces;
    return this.store
      .forPage(pageIndex)
      .filter((m) => !m.hidden && !this.hiddenLayers.has(m.layer ?? '') && (showSpaces || m.type !== 'space') && (this.filterMode !== 'hide' || !this.filteredOut?.(m)))
      .sort((a, b) => Number(b.type === 'space') - Number(a.type === 'space') || a.createdAt - b.createdAt);
  }

  /** Topmost markup under `p` on the current page. */
  private hitAt(p: Point): Markup | undefined {
    const tol = this.hitPx / this.viewer.zoomFor(this.page);
    return this.pageMarkups(this.page)
      .reverse()
      .find((m) => hitTest(m, p, tol));
  }

  /** The markup as it should appear mid-gesture (moved or reshaped), without committing. */
  private previewOf(m: Markup): Markup {
    const g = this.gesture;
    if (g?.kind === 'move' && this.state.selected.has(m.id) && !this.frozen(m)) return { ...m, ...moved(m, g.dx, g.dy) };
    if (g?.kind === 'calloutBox' && g.id === m.id) return { ...m, points: calloutBoxMoved(m.points, g.dx, g.dy) };
    if (g?.kind === 'handle' && g.id === m.id) return { ...m, points: handleEdit(m, g.index, g.point) };
    if (g?.kind === 'bend' && g.id === m.id) return { ...m, bulges: withBulge(m, g.segment, g.bulge) };
    if (g?.kind === 'rotate' && g.id === m.id) return { ...m, rotation: g.angle };
    return m;
  }
}

/**
 * Modifier keys at the last pointer or key event. Hover events come from the viewer without the
 * originating event, so track modifiers globally (Shift/Alt pressed while hovering count too).
 */
const lastModifiers: Modifiers = { shiftKey: false, altKey: false };
for (const type of ['pointermove', 'keydown', 'keyup'] as const) {
  window.addEventListener(type, (e) => {
    lastModifiers.shiftKey = e.shiftKey;
    lastModifiers.altKey = e.altKey;
  });
}

/** A small speech bubble with the number of replies, at a markup's top-right corner. */
function drawReplyIndicator(ctx: CanvasRenderingContext2D, m: Markup, zoom: number) {
  const b = markupBounds(m);
  const px = 1 / zoom;
  const w = 16 * px;
  const h = 12 * px;
  const x = b.x + b.w + 2 * px;
  const y = b.y - h - 2 * px;
  ctx.save();
  ctx.fillStyle = '#2563eb';
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 3 * px);
  ctx.moveTo(x + 3 * px, y + h);
  ctx.lineTo(x + 3 * px, y + h + 4 * px);
  ctx.lineTo(x + 7 * px, y + h);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${9 * px}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(m.replies!.length), x + w / 2, y + h / 2 + 0.5 * px);
  ctx.restore();
}

/** Paths and outlines whose vertices can be added and removed (not fixed-point shapes or counts). */
function canEditVertices(m: Markup): boolean {
  const click = CLICK_SHAPES[m.type];
  return TYPE_INFO[m.type].handles === 'vertices' && !!click && !click.fixed && m.type !== 'count';
}

/** Measurements whose segments can curve. */
const ARC_TYPES: ReadonlySet<MarkupType> = new Set<MarkupType>(['polylength', 'area', 'perimeter', 'volume']);

/** A markup's bulges with one segment's changed (all straight is none at all). */
function withBulge(m: Markup, segment: number, bulge: number): number[] | undefined {
  const edges = TYPE_INFO[m.type].closed ? m.points.length : m.points.length - 1;
  const out = Array.from({ length: edges }, (_, i) => (i === segment ? bulge : (m.bulges?.[i] ?? 0)));
  return out.some(Boolean) ? out : undefined;
}

/** Where a vertex can be added: the middle of each edge (closing edge included for outlines). */
function midpoints(m: Markup): { index: number; at: Point }[] {
  if (!canEditVertices(m) || m.points.length < 2) return [];
  const out: { index: number; at: Point }[] = [];
  const n = m.points.length;
  const edges = TYPE_INFO[m.type].closed && n > 2 ? n : n - 1;
  for (let i = 0; i < edges; i++) {
    const a = m.points[i]!;
    const b = m.points[(i + 1) % n]!;
    // On a curved segment the knob sits on the arc: the chord's middle moved out by the sagitta.
    const bulge = m.bulges?.[i] ?? 0;
    const c = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const h = (bulge * c) / 2;
    out.push({ index: i + 1, at: [(a[0] + b[0]) / 2 + ((b[1] - a[1]) / c) * h, (a[1] + b[1]) / 2 - ((b[0] - a[0]) / c) * h] });
  }
  return out;
}

/**
 * A markup's points after dragging handle `index` to `point`. A rotated box keeps its opposite
 * corner where it is on the page: both corners are worked out in the turned frame of the new box.
 */
function handleEdit(m: Markup, index: number, point: Point): Point[] {
  const points = [...m.points];
  if (!m.rotation || TYPE_INFO[m.type].handles !== 'ends' || points.length !== 2) {
    points[index] = point;
    return points;
  }
  const other = rotatePoint(points[1 - index]!, rotationCentre(m), m.rotation);
  const centre: Point = [(other[0] + point[0]) / 2, (other[1] + point[1]) / 2];
  points[index] = rotatePoint(point, centre, -m.rotation);
  points[1 - index] = rotatePoint(other, centre, -m.rotation);
  return points;
}

/** A callout's points with everything but the arrow tips (the knee and the box) moved by (dx, dy). */
function calloutBoxMoved(points: readonly Point[], dx: number, dy: number): Point[] {
  return points.map((q, i): Point => (isCalloutTip(i) ? q : [q[0] + dx, q[1] + dy]));
}

function toPoint(pt: PagePoint): Point {
  return [pt[0], pt[1]];
}

function nearestPoint(p: Point, points: readonly Point[], radius: number): Snap | null {
  let best: Snap | null = null;
  let bestD = radius;
  for (const [x, y] of points) {
    const d = Math.hypot(x - p[0], y - p[1]);
    if (d <= bestD) {
      bestD = d;
      best = { point: [x, y], kind: 'endpoint' };
    }
  }
  return best;
}

/** Second corner of a box from `a` toward `b` with width / height = `aspect`. */
function keepAspect(a: Point, b: Point, aspect: number): Point {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const w = Math.max(Math.abs(dx), Math.abs(dy) * aspect);
  return [a[0] + Math.sign(dx || 1) * w, a[1] + Math.sign(dy || 1) * (w / aspect)];
}

/** Shift-constrain: 45° steps for lines, squares/circles for boxes. */
function constrain(type: MarkupType, a: Point, b: Point): Point {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  if (type === 'rect' || type === 'ellipse' || type === 'cloud' || type === 'text') {
    const s = Math.max(Math.abs(dx), Math.abs(dy));
    return [a[0] + Math.sign(dx || 1) * s, a[1] + Math.sign(dy || 1) * s];
  }
  const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  const len = Math.hypot(dx, dy);
  return [a[0] + Math.cos(angle) * len, a[1] + Math.sin(angle) * len];
}

const TOOL_STYLES_KEY = 'nb-tool-styles';

/** Tool defaults the user customized, remembered per browser. */
function loadToolStyles(): Record<MarkupType, MarkupStyle> {
  const styles = { ...DEFAULT_STYLES };
  try {
    const saved = JSON.parse(localStorage.getItem(TOOL_STYLES_KEY) ?? '{}') as Partial<Record<MarkupType, MarkupStyle>>;
    for (const type of Object.keys(styles) as MarkupType[]) {
      const s = saved[type];
      if (s && typeof s.stroke === 'string' && typeof s.width === 'number') styles[type] = s;
    }
  } catch {
    // Storage unavailable or corrupt: built-in defaults.
  }
  return styles;
}

function saveToolStyles(styles: Readonly<Record<MarkupType, MarkupStyle>>) {
  try {
    localStorage.setItem(TOOL_STYLES_KEY, JSON.stringify(styles));
  } catch {
    // Not persisted; the defaults still apply for this session.
  }
}

/** `style` with `patch` applied; a key patched to undefined is removed (back to its default). */
function mergeStyle(style: MarkupStyle, patch: Partial<MarkupStyle>): MarkupStyle {
  const out: Record<string, unknown> = { ...style, ...patch };
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out as unknown as MarkupStyle;
}

/** The non-printing dotted grid, `spacing` points apart; sparser when zoomed far out. */
function drawGrid(ctx: CanvasRenderingContext2D, size: { width: number; height: number } | null, spacing: number, zoom: number) {
  if (!size || spacing <= 0) return;
  // Keep dots at least 8 px apart on screen by skipping grid lines.
  const step = spacing * Math.max(1, Math.ceil(8 / (spacing * zoom)));
  const r = 1 / zoom;
  ctx.save();
  ctx.fillStyle = 'rgba(59, 130, 246, 0.55)';
  const t = ctx.getTransform();
  // Only the visible part of the page.
  const inv = t.inverse();
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const corners = [inv.transformPoint({ x: 0, y: 0 }), inv.transformPoint({ x: w, y: 0 }), inv.transformPoint({ x: 0, y: h }), inv.transformPoint({ x: w, y: h })];
  const x0 = Math.max(0, Math.min(...corners.map((c) => c.x)));
  const x1 = Math.min(size.width, Math.max(...corners.map((c) => c.x)));
  const y0 = Math.max(0, Math.min(...corners.map((c) => c.y)));
  const y1 = Math.min(size.height, Math.max(...corners.map((c) => c.y)));
  for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) {
    for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  ctx.restore();
}

/** Dashed outline of a selection box or lasso being dragged. */
function drawSelectionOutline(ctx: CanvasRenderingContext2D, path: readonly Point[], zoom: number) {
  if (path.length < 2) return;
  ctx.save();
  ctx.lineWidth = 1 / zoom;
  ctx.strokeStyle = '#3b82f6';
  ctx.fillStyle = 'rgba(59, 130, 246, 0.08)';
  ctx.setLineDash([4 / zoom, 3 / zoom]);
  ctx.beginPath();
  path.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/** Length and angle of the rubber-band segment, in a tag beside the pointer. */
function drawSketchReadout(ctx: CanvasRenderingContext2D, from: Point, to: Point, scale: Scale, zoom: number) {
  const { length, angle } = segmentPolar(from, to);
  if (length * zoom < 2) return;
  const text = `${formatLength(length * scale.metersPerPoint, scale)}  ∠ ${angle.toFixed(1)}°`;
  const px = 1 / zoom;
  ctx.save();
  ctx.font = `${12 * px}px system-ui, sans-serif`;
  ctx.textBaseline = 'middle';
  const w = ctx.measureText(text).width + 12 * px;
  const h = 20 * px;
  const x = to[0] + 14 * px;
  const y = to[1] + 18 * px;
  ctx.fillStyle = 'rgba(17, 24, 39, 0.85)';
  ctx.beginPath();
  ctx.roundRect(x, y - h / 2, w, h, 4 * px);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, x + 6 * px, y);
  ctx.restore();
}

/** CAD-style snap glyphs: square = endpoint, X = intersection, triangle = midpoint, ◇ = on line. */
function drawSnapIndicator(ctx: CanvasRenderingContext2D, snap: Snap, zoom: number) {
  const [x, y] = snap.point;
  const s = 6 / zoom;
  ctx.save();
  ctx.strokeStyle = '#d946ef';
  ctx.lineWidth = 1.5 / zoom;
  ctx.beginPath();
  switch (snap.kind) {
    case 'endpoint':
      ctx.rect(x - s, y - s, s * 2, s * 2);
      break;
    case 'intersection':
      ctx.moveTo(x - s, y - s);
      ctx.lineTo(x + s, y + s);
      ctx.moveTo(x + s, y - s);
      ctx.lineTo(x - s, y + s);
      break;
    case 'midpoint':
      ctx.moveTo(x, y - s);
      ctx.lineTo(x + s, y + s);
      ctx.lineTo(x - s, y + s);
      ctx.closePath();
      break;
    case 'nearest':
      ctx.moveTo(x, y - s);
      ctx.lineTo(x + s, y);
      ctx.lineTo(x, y + s);
      ctx.lineTo(x - s, y);
      ctx.closePath();
      break;
  }
  ctx.stroke();
  ctx.restore();
}

function sameSketch(a: SketchState | null, b: SketchState | null): boolean {
  if (!a || !b) return a === b;
  return a.mode === b.mode && a.type === b.type && a.pageIndex === b.pageIndex && a.from[0] === b.from[0] && a.from[1] === b.from[1];
}
