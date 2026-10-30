import {
  align,
  boundsOf,
  canOffset,
  canExplode,
  canJoin,
  canReverse,
  canCloud,
  reversedMarkup,
  explodeSegments,
  joinPaths,
  bulgeMidpoint,
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
  BOX_OPPOSITE,
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
  offsetCopies,
  offsetDistance,
  onImageLoad,
  paintedStyle,
  resolveStamp,
  restack,
  selectRange,
  stampAspect,
  stampColor,
  shapeBounds,
  translated,
  moved,
  circleBox,
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
  edgesOf,
  markupBounds,
  dimensionLine,
  labelHandles,
  markupSnapPoints,
  rotateHandle,
  scaledAbout,
  rotatePoint,
  rotationCentre,
  type Attachment,
  newTable,
  CELL_STYLE_KEYS,
  clearTableFormats,
  formatTableCells,
  tableCellStyle,
  type CellFormat,
  mergeTableCells,
  moveTableLine,
  splitTableCell,
  tableCellAt,
  tableLineAt,
  tableOf,
  tableRange,
  tableRegion,
  tableRegionRect,
  type TableLine,
  anchorsOf,
  canConnect,
  FLOW_SHAPES,
  relinkCopies,
  addBend,
  connectorLabel,
  moveSegment,
  removeSegment,
  routeConnector,
  routeHandles,
  editableRoute,
  type ConnectorLinks,
  type ManualRoute,
  type FlowShapeKind,
  type Side,
} from '@nb/markup';
import { bulgeThrough, dynamicFill, expandArcs, formatLength, METERS_PER_UNIT, parseLength, pathLength, SnapIndex, track, type Snap, type SnapKind, type Tracked, type TrackPathKind, type TrackPoint } from '@nb/measure';
import { gridSpacingPoints, settings } from '../settings/settings';
import type { PagePoint, TileViewer, ViewerOverlay } from '../viewer/TileViewer';
import { applyAffine, type Affine } from '../viewer/affine';
import { CAD_TOOL_LABELS, cadClick, cadPickTarget, cadPreview, cadPrompt, isCadTool, type CadContext, type CadPick, type CadTool } from './cadTools';

/**
 * `calibrate` draws a temporary line whose real length the user then enters. `labelRegion` draws a
 * box around title-block text to read page labels from (it makes no markup). `lasso` selects the
 * markups inside a free-form outline; `painter` (Format Painter) copies one markup's look onto
 * the markups clicked next.
 */
export type Tool = 'select' | MarkupType | 'calibrate' | 'labelRegion' | 'lasso' | 'painter' | 'cloudPlus' | 'eraser' | 'offset' | 'cutout' | 'viewport' | 'dynamicFill' | 'visualSearch' | 'cropArea' | 'eraseContent' | 'selectText' | 'editText' | 'formField' | 'pan' | 'zoomBox' | 'dynamicZoom' | 'snapshot' | 'cutContent' | 'scaleLength' | 'matchLine' | 'stitchRegion' | 'stitchPolygon' | 'stitchMove' | 'teachMark' | CadTool;

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
  scaleLength: 'Scale to Length',
  matchLine: 'Match Line',
  stitchRegion: 'Stitch Region',
  stitchPolygon: 'Stitch Region (Polygon)',
  stitchMove: 'Move Sheet',
  teachMark: 'Teach a Mark',
  pan: 'Pan',
  zoomBox: 'Zoom',
  dynamicZoom: 'Dynamic Zoom',
  ...CAD_TOOL_LABELS,
};

/** Tools that pick out an area of the page (drawn as a plain box, never snapped). */
const REGION_TOOLS: ReadonlySet<Tool> = new Set<Tool>(['labelRegion', 'viewport', 'visualSearch', 'cropArea', 'eraseContent', 'formField', 'snapshot', 'cutContent', 'stitchRegion', 'teachMark']);

/** Hand-placed match lines and stitch regions, drawn while the Stitching panel is open. */
export interface StitchGuides {
  lines: { id: string; pageIndex: number; p0: Point; p1: Point; contentSide: 1 | -1; name: string; paired: boolean; problem?: boolean }[];
  regions: Record<number, Point[]>;
  selected?: string | null;
}

/**
 * A model or CAD file laid over sheets while the Geospatial panel aligns it. It is placed in a
 * "world" (a sheet's own page space, or a stitched view's space); each layer is a sheet with the
 * model drawn on it in page space and the sheet's page → world map. Alignment pairs are in world
 * space. `mode` says what a press on a sheet does: drag the model ('move'), or pick a point on the
 * model ('pickModel') or on the drawing ('pickPage').
 */
export interface GeoOverlay {
  layers: { pageIndex: number; paths: Point[][]; points: Point[]; bounds: Point[]; toWorld: Affine; fromWorld: Affine }[];
  pairs: { model?: Point; page?: Point }[];
  mode: 'none' | 'move' | 'pickModel' | 'pickPage';
  /** Draw each layer only inside its bounds (stitched sheets overlap at their match lines). */
  clip?: boolean;
}

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
/** Snap radius in screen pixels (Preferences › Grid & Snap › Sensitivity). */
const snapPx = () => settings.get().snapSensitivity;

/** The kinds of drawing geometry Snap to Content snaps to. */
function snapKinds(): Set<SnapKind> {
  const s = settings.get();
  const kinds = new Set<SnapKind>();
  if (s.snapEndpoints) kinds.add('endpoint');
  if (s.snapIntersections) kinds.add('intersection');
  if (s.snapMidpoints) kinds.add('midpoint');
  if (s.snapLines) kinds.add('nearest');
  if (s.snapCenters) kinds.add('center');
  if (s.snapQuadrants) kinds.add('quadrant');
  if (s.snapGeoCenters) kinds.add('geocenter');
  if (s.snapPerpendicular) kinds.add('perpendicular');
  if (s.snapTangent) kinds.add('tangent');
  if (s.snapApparent) kinds.add('apparent');
  return kinds;
}
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
/** On-screen size of one cell of a table placed with a click. */
const TABLE_CELL_PX = { w: 90, h: 26 };
/** On-screen size of a flag label placed with a click. */
const FLAG_LABEL_PX = { w: 150, h: 30 };
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
const MATCH_LINE_STYLE: MarkupStyle = { stroke: '#dc2626', fill: null, width: 2, opacity: 1, dash: 'dashed' };
const REGION_STYLE: MarkupStyle = { stroke: '#2563eb', fill: '#2563eb', width: 1, opacity: 1, fillOpacity: 0.08, dash: 'dashed' };

type Gesture =
  /** Dragging one end (`end` 0 or 1) of a hand-placed match line. */
  | { kind: 'guideEnd'; id: string; end: 0 | 1; from: Point }
  /** Move Sheet: dragging a stitched sheet; `start` is where the drag began in the view's world space. */
  | { kind: 'stitchMove'; start: Point }
  /** Dragging the Geospatial panel's model across the page. */
  | { kind: 'geoMove'; start: Point; dx: number; dy: number; pageIndex: number }
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
  /** Dragging a middle segment of an elbow connector across (to `to`, a y or an x), as Visio's segment handles do. */
  | { kind: 'segment'; id: string; route: ManualRoute; mid: number; runs: 'h' | 'v'; to: number; start: Point }
  /** Turning a selected markup by its rotate handle; `angle` in degrees. */
  | { kind: 'rotate'; id: string; angle: number }
  /**
   * Scale to Length (AutoCAD's Scale › Reference): two points on the selected markups give the
   * length they have now (`ref`, the first staying put); then either a typed length (`ask`, the
   * app asks for it) or two more points (`target`) give the length they should have.
   */
  | { kind: 'scaleRef'; ids: string[]; pageIndex: number; ref: Point[]; target: Point[]; stage: 'ref' | 'ask' | 'target'; hover: Point | null }
  /** Dragging a Length or Dimension's text: off the line moves the line (`leader`), along it slides the text (`along`). */
  | { kind: 'label'; id: string; start: Point; from: { leader: number; along: number }; leader: number; along: number }
  /** Turning a Length or Dimension's text by its knob; `angle` in degrees from where it would sit. */
  | { kind: 'labelRotate'; id: string; centre: Point; base: number; angle: number }
  /** Press on a hyperlink; followed on release unless the pointer moved. */
  | { kind: 'link'; link: StoredLink; start: Point }
  | { kind: 'formField'; widget: FormWidgetHit; start: Point }
  /** Press on a hyperlink markup: followed on release, or selected and moved if dragged. */
  | { kind: 'hyperlink'; markup: Markup; start: Point }
  /** Text markup tools: the words from where the drag began to the pointer get marked. */
  | { kind: 'textMark'; markup: Markup; from: Point; copyOnly?: boolean }
  /**
   * Highlight tool while the page's words are still loading. The drag is kept as a stroke until
   * the words arrive: if it began on a word it becomes a text highlight, otherwise the stroke stays.
   */
  | { kind: 'pendingHighlight'; markup: Markup; from: Point }
  /** Eraser: rubbing out parts of pen and highlighter strokes. */
  | { kind: 'erase'; pageIndex: number }
  /** Drag on empty page with Select: markups wholly inside the box get selected. */
  | { kind: 'box'; start: Point; end: Point; add: boolean }
  /** Lasso: markups wholly inside the free-form outline get selected. */
  | { kind: 'lasso'; pageIndex: number; path: Point[]; add: boolean }
  /** Dragging a row or column line of the selected table; `to` is its page position (x or y). */
  | { kind: 'tableLine'; id: string; line: TableLine; to: number }
  /** Dragging across the cells of the selected table to select a block of them. */
  | { kind: 'tableCells'; id: string; from: TableCell };

/** A cell of a table markup. */
export interface TableCell {
  row: number;
  col: number;
}

/** The cells selected in a table: the block between the cell clicked and the one dragged or Shift-clicked to. */
export interface TableSelection {
  id: string;
  anchor: TableCell;
  focus: TableCell;
}

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
  /** The cells selected in the one selected table, if any. */
  tableCells: TableSelection | null;
  /** A CAD Modify tool (Trim, Fillet, Mirror...): the points picked so far, and why the last click did nothing. */
  cad: { picks: number; error: string | null } | null;
  /** The shape the Flowchart Shape tool draws (Diagram tab). */
  flowShape: FlowShapeKind;
  /** How new connectors bend: at right angles, or straight from shape to shape. */
  connectorRoute: 'elbow' | 'straight';
  /** PDF text the user selected by dragging over it: it stays highlighted until they copy it, mark it or click away. */
  textSelection: { text: string; pageIndex: number } | null;
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
/** Draw to Scale: the Ellipse tool is set to draw circles from their centre. */
const sketchesCircle = (type: MarkupType) => type === 'ellipse' && settings.get().sketchEllipse !== 'ellipse';
/** Drag-drawn lines Draw to Size draws point to point, so their length and angle can be typed. */
const SKETCH_LINE_TYPES: readonly MarkupType[] = ['line', 'arrow'];
/** Click-drawn tools whose next point can be typed as a length and angle. */
const sketchesSegments = (type: MarkupType) => !['count', 'angle', 'arc', 'arcLength'].includes(type);

/** Draw to Scale: a box type's first click, the markup it will become, and the pointer since. */
interface SketchAnchor {
  type: MarkupType;
  pageIndex: number;
  at: Point;
  markup: Markup;
  hover?: Point;
}

/** Markups Smart Fill can make from a region. */
export const FILL_TYPES = ['area', 'perimeter', 'volume', 'polygon', 'space', 'polylength'] as const;
export type FillType = (typeof FILL_TYPES)[number];

interface Modifiers {
  shiftKey: boolean;
  altKey: boolean;
  /** Ctrl or ⌘: the Highlight tool draws a free stroke instead of marking words. */
  ctrlKey: boolean;
}

/** A table just drawn, waiting for its rows and columns (see `MarkupTools.addTable`). */
export interface TableDraft {
  markup: Markup;
  /** Clicked rather than dragged: the table gets a comfortable size for its cells. */
  tiny: boolean;
  /** The page's zoom when it was drawn. */
  zoom: number;
}

export interface MarkupToolsOptions {
  author: () => string;
  /** A text markup needs its text entered or edited. */
  onEditText: (id: string) => void;
  /** The user drew a calibration line `lengthPoints` long on `pageIndex`, starting at `at`. */
  onCalibrate: (pageIndex: number, lengthPoints: number, at: Point) => void;
  /**
   * Scale to Length: the reference points are picked; ask what length they should be, then call
   * `scaleSelectionBy`, `pickScaleTarget` (pick two points on the page instead) or `cancel`.
   */
  onScaleToLength?: (pageIndex: number, ref: [Point, Point]) => void;
  /**
   * Scale to Length or a measuring tool was used where the page has no scale. The click is
   * ignored (the tool stays armed) so the page's scale can be set first. Without it, no scale is needed.
   */
  onScaleRequired?: (pageIndex: number, tool: Tool) => void;
  /** The user clicked PDF text with the `editText` tool. */
  onEditPdfText?: (pageIndex: number, at: Point) => void;
  /** The user drew an area to erase the PDF content in (the `eraseContent` tool). */
  onEraseContent?: (pageIndex: number, rect: PageRect) => void;
  /** The user drew where a new form field goes (the `formField` tool). */
  onFormFieldDrawn?: (pageIndex: number, rect: PageRect) => void;
  /** The user clicked a form field's widget to fill it in. */
  onFormField?: (widget: FormWidgetHit) => void;
  /** The user drew the area to crop pages to (the `cropArea` tool). */
  onCropArea?: (pageIndex: number, rect: PageRect) => void;
  /** The user boxed an example of a section mark, title or detail callout (the `teachMark` tool). */
  onTeachMark?: (pageIndex: number, rect: PageRect) => void;
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
  /** Double-click on a stamp with fields: fill them in again. */
  onEditStamp?: (id: string) => void;
  /** A table was drawn: ask how many rows and columns, then place it with `addTable`. */
  onNewTable?: (draft: TableDraft) => void;
  /** A table's cell was double-clicked: edit its text. */
  onEditTableCell?: (id: string, row: number, col: number, text?: string) => void;
  /** Values new markups start with in the document's custom columns. */
  defaultFields?: () => Record<string, string> | undefined;
  /** A markup was drawn (for Recent Tools). */
  onCreated?: (m: Markup) => void;
  /** The user drew a page-label region (the `labelRegion` tool). */
  onRegion?: (pageIndex: number, rect: PageRect) => void;
  /** The user clicked both ends of a match line (the `matchLine` tool). */
  onMatchLine?: (pageIndex: number, p0: Point, p1: Point) => void;
  /** The user dragged an end of a hand-placed match line to a new place; false turns the edit down (the end goes back). */
  onMatchLineEdited?: (id: string, p0: Point, p1: Point) => boolean | void;
  /** Move Sheet: the pointer has dragged `delta` (world space) since the press; `done` on release. */
  onStitchDrag?: (delta: Point, done: boolean) => void;
  /** The Geospatial panel's model was dragged by an offset in its world (see GeoOverlay). */
  onGeoMoved?: (dx: number, dy: number) => void;
  /** A point (in the model's world) was picked for the Geospatial panel's alignment: on the model (its nearest vertex) or on the drawing (snapped). */
  onGeoPick?: (target: 'model' | 'page', p: Point) => void;
  /** The user outlined the part of a sheet holding the drawing, for stitching (`stitchRegion`, `stitchPolygon`). */
  onStitchRegion?: (pageIndex: number, points: Point[]) => void;
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
  /** Subject, label and assembly the Measurements panel applies to the next measurement. */
  measureDefaults?: () => { subject?: string; label?: string; assemblyId?: string };
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

/** How long the pointer rests on a snap before tracking picks it up, in milliseconds. */
const ACQUIRE_MS = 400;
/** An empty index, for snapping to markups alone when Snap to Content is off. */
const NO_LINES = new SnapIndex(new Float32Array(0));

/** Tools whose result is a real-world size, so they need the page's scale (angles and counts do not). */
function needsScale(tool: Tool): boolean {
  return tool === 'scaleLength' || (isMeasureKind(tool) && tool !== 'angle' && tool !== 'count');
}

/** Click-by-click point rules for a tool: measurements, calibration and click-drawn shapes. */
function clickSpec(tool: Tool): { min: number; fixed?: number; closes?: boolean } | null {
  if (tool === 'calibrate') return { min: 2, fixed: 2 };
  if (tool === 'matchLine') return { min: 2, fixed: 2 };
  if (tool === 'cutout' || tool === 'stitchPolygon') return { min: 3, closes: true };
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
  /** Called when which markups the drawing shows changes (see subscribeView). */
  private viewListeners = new Set<() => void>();
  /** Markup layers drawn faintly (the Layers Dial in Fade mode). */
  private fadedLayers: ReadonlySet<string> = new Set();
  private state: ToolsState = { tool: 'select', selected: new Set(), styles: loadToolStyles(), snap: settings.get().snapToGeometry, measuring: false, showLinks: settings.get().showHyperlinks, preset: null, painterSource: null, fillAs: 'area', sketch: null, tableCells: null, cad: null, flowShape: 'process', connectorRoute: 'elbow', textSelection: null };
  /** The lines of the selected PDF text (see `ToolsState.textSelection`). */
  private pickedText: Markup | null = null;
  /** Where a Tool Library copy would land, previewed under the pointer. */
  private ghost: { pageIndex: number; at: Point } | null = null;
  /** The pointer while drawing or dragging a connector end: the shape under it shows its connection points. */
  private connectHover: { pageIndex: number; at: Point } | null = null;
  /** Where the connector being drawn began (its first point is moved onto the shape it glues to). */
  private connectStart: Point | null = null;
  /** A CAD Modify tool's steps: the page, the points picked so far and where the pointer is. */
  private cad: { tool: CadTool; pageIndex: number; picks: CadPick[]; hover: Point | null; shift: boolean } | null = null;
  /** The markups the pointer is over that the tool's next click would pick (highlighted so it is clear what a click takes). */
  private pickIds: string[] = [];
  private hoveredLink: string | null = null;
  /** The markup whose comment pop-up shows (after the pointer rests on it for a moment). */
  private popup: { id: string; timer: ReturnType<typeof setTimeout> | null; shown: boolean } | null = null;
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
  /** The snap target is a grid point (no name shown beside it). */
  private snapIsGrid = false;
  private snapPage = -1;
  /**
   * Object snap tracking: points picked up by resting the pointer on a snap (with the directions
   * of the lines they end, for extensions), and line directions picked up for parallel, on `page`.
   */
  private tracking: { page: number; points: TrackPoint[]; parallels: { at: Point; dir: Point }[] } = { page: -1, points: [], parallels: [] };
  /** The alignment the pointer is locked onto (no snap under it), drawn as dotted paths. */
  private tracked: Tracked | null = null;
  /** The snap the pointer is resting on, and the timer that picks it up. */
  private dwell: { key: string; timer: ReturnType<typeof setTimeout> } | null = null;
  /** Markup outlines as snap lines, worked out once per markup version. */
  private outlineCache = new WeakMap<Markup, number[]>();
  /** Page the current pointer event is on (pages differ across a stitched view). */
  private page = 0;

  constructor(
    private viewer: TileViewer,
    private options: MarkupToolsOptions,
  ) {
    onImageLoad(() => this.viewer.invalidate());
    // Grid and snapping preferences change what is drawn; Show Spaces changes which markups show.
    settings.subscribe(() => {
      this.refreshSketch();
      for (const l of this.viewListeners) l();
    });
    window.addEventListener('keydown', this.onModifierKey);
    window.addEventListener('keyup', this.onModifierKey);
  }

  /** Drops the modifier-key listener. */
  dispose() {
    window.removeEventListener('keydown', this.onModifierKey);
    window.removeEventListener('keyup', this.onModifierKey);
  }

  /**
   * Ctrl (and ⌘) change whether Highlight marks words or draws a stroke, so the cursor follows
   * the key even when the pointer stays still. The global modifier record is updated first.
   */
  private onModifierKey = (e: KeyboardEvent) => {
    if (e.repeat || (e.key !== 'Control' && e.key !== 'Meta' && e.key !== 'Shift' && e.key !== 'Alt')) return;
    this.viewer.refreshPointerCursor();
  };

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
    // A tool finishing (or changing) lets go of its snap marker and tracking lines.
    if (patch.tool !== undefined && patch.tool !== this.state.tool) {
      this.snapHit = null;
      this.clearTracking();
      this.pickIds = [];
    }
    this.state = { ...this.state, ...patch };
    // Cells stay selected only while their table is the one thing selected.
    const cells = this.state.tableCells;
    if (cells && (this.state.selected.size !== 1 || !this.state.selected.has(cells.id) || this.state.tool !== 'select')) this.state = { ...this.state, tableCells: null };
    for (const l of this.listeners) l();
    this.viewer.invalidate();
  }

  private setGesture(g: Gesture | null) {
    this.gesture = g;
    // Finishing or dropping a shape lets go of what tracking had picked up.
    if (!g) this.clearTracking();
    if (g) this.sketchAnchor = null;
    const measuring = g?.kind === 'multi';
    const sketch = this.sketchState();
    if (measuring !== this.state.measuring || !sameSketch(sketch, this.state.sketch)) this.setState({ measuring, sketch });
    else this.viewer.invalidate();
  }

  /** Box types: the corner (a circle's centre) a click placed, waiting for its size. */
  private sketchAnchor: SketchAnchor | null = null;

  private sketchState(): SketchState | null {
    if (!settings.get().sketchToScale) return null;
    const g = this.gesture;
    if (g?.kind === 'multi' && !g.calibrate && sketchesSegments(g.markup.type) && g.markup.points.length) {
      return { mode: 'segment', type: g.markup.type, pageIndex: g.markup.pageIndex, from: g.markup.points.at(-1)! };
    }
    const a = this.sketchAnchor;
    return a ? { mode: 'box', type: a.type, pageIndex: a.pageIndex, from: a.at } : null;
  }

  /** What typed angles are measured from: east, or with Relative rotation input the last segment's direction. */
  private sketchBaseAngle(points: readonly Point[]): number {
    if (settings.get().rotationInput !== 'relative' || points.length < 2) return 0;
    return segmentPolar(points.at(-2)!, points.at(-1)!).angle;
  }

  private refreshSketch() {
    const sketch = this.sketchState();
    if (!sameSketch(sketch, this.state.sketch)) this.setState({ sketch });
    else this.viewer.invalidate();
  }

  /**
   * Draw to Size: places the next point `length` points from the last one, at `angle` degrees
   * (counter-clockwise from east, as on paper; with Preferences › Sketch › Rotation Input set to
   * Relative, from the direction of the segment before), or toward the pointer when no angle is given.
   */
  sketchSegment(length: number, angle: number | null) {
    const g = this.gesture;
    if (g?.kind !== 'multi' || !g.markup.points.length || !(length > 0)) return;
    const from = g.markup.points.at(-1)!;
    const h = g.hover;
    const toward = h && Math.hypot(h[0] - from[0], h[1] - from[1]) > 1e-6 ? segmentPolar(from, h).angle : 0;
    const p = polarPoint(from, length, angle === null ? toward : angle + this.sketchBaseAngle(g.markup.points));
    g.markup.points = [...g.markup.points, p];
    g.down = p;
    g.hover = p;
    this.completeIfFixed();
    this.refreshSketch();
  }

  /**
   * Draw to Scale: draws the anchored box type `width` by `height` points, toward the pointer
   * (right and down when it has not moved).
   */
  sketchBox(width: number, height: number) {
    const a = this.sketchAnchor;
    if (!a || !(width > 0) || !(height > 0)) return;
    const h = a.hover;
    const sx = h && h[0] < a.at[0] ? -1 : 1;
    const sy = h && h[1] < a.at[1] ? -1 : 1;
    this.placeSketchBox([a.at, [a.at[0] + sx * width, a.at[1] + sy * height]]);
  }

  /** Draw to Scale: draws the anchored circle `radius` points about its centre. */
  sketchCircle(radius: number) {
    const a = this.sketchAnchor;
    if (!a || !(radius > 0)) return;
    this.placeSketchBox(circleBox(a.at, radius));
  }

  /**
   * Draw to Scale: the anchored box's points with the pointer (or a click) at `to`: the opposite
   * corner, or for a circle a point on it.
   */
  private sketchBoxPoints(a: SketchAnchor, to: Point): Point[] {
    return sketchesCircle(a.type) ? circleBox(a.at, Math.hypot(to[0] - a.at[0], to[1] - a.at[1])) : [a.at, to];
  }

  /** Draw to Scale: finishes the anchored box with its two corners. */
  private placeSketchBox(points: Point[]) {
    const a = this.sketchAnchor;
    if (!a || !this.store) return;
    this.sketchAnchor = null;
    const now = Date.now();
    const m: Markup = { ...a.markup, points, createdAt: now, modifiedAt: now };
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
      source(pageIndex).then(
        (words) => {
          if (this.textSource !== source) return;
          this.pageWords.set(pageIndex, words);
          const g = this.gesture;
          if (g?.kind === 'pendingHighlight' && g.markup.pageIndex === pageIndex) this.resolvePendingHighlight(g, g.markup.points.at(-1) ?? g.from);
          this.viewer.refreshPointerCursor();
        },
        (err) => {
          console.error('Loading page text failed', err);
          this.pageWords.delete(pageIndex);
        },
      );
    }
    return null;
  }

  /** True when `p` sits on a word of the page. Words still loading count as not. */
  private overText(pageIndex: number, p: Point): boolean {
    const words = this.wordsFor(pageIndex);
    return !!words && wordAt(words, p, TEXT_REACH_PX / this.viewer.zoomFor(pageIndex)) >= 0;
  }

  /**
   * Starts a Highlight drag. Over a word it marks the text; with no words loaded yet the stroke
   * is kept until they arrive. Returns false to draw a free stroke (off the text, or Ctrl held).
   */
  private startHighlighter(e: PointerEvent, pageIndex: number, p: Point): boolean {
    if (e.button !== 0 || e.ctrlKey || e.metaKey) return false;
    if (!this.wordsFor(pageIndex)) {
      this.setGesture({ kind: 'pendingHighlight', markup: this.newMarkup('highlighter', pageIndex, [p]), from: p });
      return true;
    }
    if (!this.overText(pageIndex, p)) return false;
    this.setGesture({ kind: 'textMark', markup: this.textHighlightFromTool(pageIndex), from: p });
    return true;
  }

  /** A text highlight in the Highlight tool's colour and opacity. */
  private textHighlightFromTool(pageIndex: number): Markup {
    const markup = this.newMarkup('textHighlight', pageIndex, []);
    const preset = this.state.preset?.type === 'highlighter' ? this.state.preset : null;
    const look = preset?.style ?? this.state.styles.highlighter;
    markup.style = { ...markup.style, stroke: look.stroke, opacity: look.opacity };
    if (preset?.subject) markup.subject = preset.subject;
    return markup;
  }

  /** Lets go of the selected PDF text. */
  clearTextSelection() {
    if (!this.pickedText) return;
    this.pickedText = null;
    this.setState({ textSelection: null });
  }

  /** The selected PDF text, to copy. */
  selectedPdfText(): string | null {
    return this.pickedText?.comment ?? null;
  }

  /** Turns the selected PDF text into a text markup (highlight, underline, strikeout or squiggly). */
  markSelectedText(type: 'textHighlight' | 'underline' | 'strikeout' | 'squiggly') {
    const picked = this.pickedText;
    if (!picked || !this.store || this.store.readOnly) return;
    const markup = type === 'textHighlight' ? this.textHighlightFromTool(picked.pageIndex) : this.newMarkup(type, picked.pageIndex, []);
    markup.points = picked.points;
    // Preferences › Markup › Copy Highlighted Text into Markup Comment (the words marked are kept otherwise).
    markup.comment = settings.get().copyHighlightedText ? picked.comment : undefined;
    this.store.checkpoint();
    this.store.add({ ...markup, createdAt: Date.now(), modifiedAt: Date.now() });
    this.options.onCreated?.(markup);
    this.clearTextSelection();
  }

  /** The words from `from` to `to` become `markup`'s lines and comment. */
  private applyTextMark(markup: Markup, from: Point, to: Point) {
    const words = this.wordsFor(markup.pageIndex);
    const reach = TEXT_REACH_PX / this.viewer.zoomFor(markup.pageIndex);
    const { points, text } = lineRects(words ? selectRange(words, from, to, reach) : []);
    markup.points = points;
    markup.comment = text;
  }

  /**
   * When the page's words have arrived, a pending Highlight drag becomes a text highlight if it
   * began on a word, otherwise the free stroke already drawn. Returns false while the words are unknown.
   */
  private resolvePendingHighlight(g: { markup: Markup; from: Point }, at: Point): boolean {
    const pageIndex = g.markup.pageIndex;
    if (!this.wordsFor(pageIndex)) return false;
    if (this.overText(pageIndex, g.from)) {
      const markup = this.textHighlightFromTool(pageIndex);
      this.applyTextMark(markup, g.from, at);
      this.setGesture({ kind: 'textMark', markup, from: g.from });
    } else this.setGesture({ kind: 'draw', markup: g.markup });
    return true;
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
    if (tool !== this.state.tool) this.clearTextSelection();
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
    this.cad = isCadTool(tool) ? { tool, pageIndex: this.page, picks: [], hover: null, shift: false } : null;
    if (tool === 'offset') {
      // Offset copies the one selected line or shape; with nothing suitable selected, the first click picks it.
      const [id] = this.state.selected;
      const source = this.state.selected.size === 1 && id ? this.store?.get(id) : undefined;
      this.setState({ tool, preset: null, painterSource: source && canOffset(source) ? structuredClone(source) : null, cad: null });
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
    const keepSelection = tool === 'select' || tool === 'lasso' || tool === 'scaleLength' || isCadTool(tool);
    this.setState({ tool, selected: keepSelection ? this.state.selected : new Set(), preset: armed, painterSource: null, cad: this.cad ? { picks: 0, error: null } : null });
    // Highlight decides from the words under the pointer, so load them as soon as the tool is picked.
    if (tool === 'highlighter') this.wordsFor(this.page);
    this.viewer.refreshPointerCursor();
  }

  /** Shows markups the Markups list filters out faintly ('dim'), not at all ('hide') or normally. */
  setFilterView(filteredOut: ((m: Markup) => boolean) | null, mode: 'show' | 'dim' | 'hide') {
    this.filteredOut = filteredOut;
    this.filterMode = filteredOut ? mode : 'show';
    this.viewChanged();
  }

  /** Hides the markups on these layers ('' for markups on no layer). */
  setHiddenLayers(layers: ReadonlySet<string>) {
    this.hiddenLayers = layers;
    this.viewChanged();
  }

  /**
   * Calls `listener` when which markups the drawing shows changes: layers switched off, the Markups
   * list's filter in hide mode, or Show Spaces. Returns the unsubscribe.
   */
  subscribeView(listener: () => void): () => void {
    this.viewListeners.add(listener);
    return () => this.viewListeners.delete(listener);
  }

  private viewChanged() {
    this.viewer.invalidate();
    for (const l of this.viewListeners) l();
  }

  /** Shows the comment pop-up of markup `id` once the pointer has rested on it; null hides it. */
  private hoverPopup(id: string | null) {
    if (this.popup?.id === id) return;
    this.hidePopup();
    if (!id) return;
    const popup: NonNullable<typeof this.popup> = { id, timer: null, shown: false };
    popup.timer = setTimeout(() => {
      popup.timer = null;
      popup.shown = true;
      this.viewer.invalidate();
    }, POPUP_DELAY_MS);
    this.popup = popup;
  }

  private hidePopup() {
    if (!this.popup) return;
    if (this.popup.timer) clearTimeout(this.popup.timer);
    const shown = this.popup.shown;
    this.popup = null;
    if (shown) this.viewer.invalidate();
  }

  /** Draws the markups on these layers faintly ('' for markups on no layer). */
  setFadedLayers(layers: ReadonlySet<string>) {
    if (layers.size === this.fadedLayers.size && [...layers].every((l) => this.fadedLayers.has(l))) return;
    this.fadedLayers = layers;
    this.viewer.invalidate();
  }

  /**
   * The markups whose handles show and drag: the one selected markup, or the members of one selected
   * group (a Cloud+'s cloud and callout). A callout comes first so its arrow tip wins where it sits on
   * a corner of the cloud.
   */
  private handleTargets(): Markup[] {
    const store = this.store;
    if (!store || this.state.selected.size === 0) return [];
    const ms = [...this.state.selected].map((id) => store.get(id)).filter((m): m is Markup => !!m);
    if (ms.length !== this.state.selected.size) return [];
    if (ms.length === 1) return ms;
    const groupId = ms[0]!.groupId;
    if (!groupId || ms.some((m) => m.groupId !== groupId || m.pageIndex !== ms[0]!.pageIndex)) return [];
    // Only the whole group counts; a group selected along with other markups moves as one.
    if (store.all().some((m) => m.groupId === groupId && !this.state.selected.has(m.id))) return [];
    return ms.sort((a, b) => Number(b.type === 'callout') - Number(a.type === 'callout'));
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

  /** A diamond on each middle segment of a selected elbow connector: drag one to move the segment. */
  private drawSegmentHandles(ctx: CanvasRenderingContext2D, m: Markup, zoom: number) {
    const r = 4 / zoom;
    ctx.save();
    ctx.lineWidth = 1 / zoom;
    ctx.strokeStyle = '#a16207';
    ctx.fillStyle = '#facc15';
    for (const { at } of routeHandles(m.points, m.connect?.bends)) {
      ctx.beginPath();
      ctx.moveTo(at[0], at[1] - r);
      ctx.lineTo(at[0] + r, at[1]);
      ctx.lineTo(at[0], at[1] + r);
      ctx.lineTo(at[0] - r, at[1]);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Picks a Tool Library tool: its markup type, drawing with its own style until another tool is chosen. */
  /** Arms the Flowchart Shape tool with `kind` (Diagram tab). */
  setFlowShape(kind: FlowShapeKind) {
    this.setTool('flowShape');
    this.setState({ flowShape: kind });
  }

  /** Diagram › Change Shape: the selected flowchart shapes become `kind`, keeping their box, text and connectors. */
  changeFlowShape(kind: FlowShapeKind) {
    const store = this.store;
    const changing = this.editable().filter((m) => m.type === 'flowShape' && (m.flowShape ?? 'process') !== kind);
    if (!store || store.readOnly || !changing.length) return;
    store.checkpoint();
    store.batch(() => {
      for (const m of changing) store.update(m.id, { flowShape: kind });
    });
  }

  /** Whether a connector's segments can be moved by hand: an elbow connector that can be edited. */
  private reroutable(m: Markup): boolean {
    return m.type === 'connector' && (m.connect?.route ?? 'elbow') === 'elbow' && !this.frozen(m) && !this.store?.readOnly;
  }

  /** The connector with a hand-set route (or none: routed automatically again), its points routed by it. */
  private withBends(m: Markup, bends: ManualRoute | undefined): Markup {
    const { bends: _, ...rest } = m.connect ?? {};
    const connect: ConnectorLinks = bends ? { ...rest, bends } : rest;
    const next = { ...m, connect };
    return { ...next, points: routeConnector(next, (id) => this.store?.get(id)) };
  }

  private setBends(m: Markup, bends: ManualRoute | undefined) {
    const next = this.withBends(m, bends);
    this.store?.update(m.id, { connect: next.connect, points: next.points });
  }

  /**
   * One connector's route, whatever else is selected: right angles, straight, or `reset` to drop the
   * segments set by hand and route it automatically again.
   */
  setRouteOf(id: string, route: 'elbow' | 'straight' | 'reset') {
    const store = this.store;
    const m = store?.get(id);
    if (!store || store.readOnly || !m || m.type !== 'connector' || this.frozen(m)) return;
    store.checkpoint();
    if (route === 'reset') return this.setBends(m, undefined);
    const next = { ...m, connect: { ...m.connect, route } };
    store.update(id, { connect: next.connect, points: routeConnector(next, (x) => store.get(x)) });
  }

  /** How connectors bend: new ones, and the selected ones as one undo step. */
  setConnectorRoute(route: 'elbow' | 'straight') {
    this.setState({ connectorRoute: route });
    const store = this.store;
    const targets = this.editable().filter((m) => m.type === 'connector' && (m.connect?.route ?? 'elbow') !== route);
    if (!store || store.readOnly || !targets.length) return;
    store.checkpoint();
    store.batch(() => {
      for (const m of targets) store.update(m.id, { connect: { ...m.connect, route } });
    });
  }

  /**
   * The shape a connector end at `p` glues to, and the side when it is dropped on one of the
   * shape's connection points (else the side facing the other end is used, and changes as they move).
   */
  private glueAt(pageIndex: number, p: Point, exclude?: string): { shape: Markup; side?: Side } | null {
    const zoom = this.viewer.zoomFor(pageIndex);
    const reach = (this.hitPx * 1.6) / zoom;
    const shapes = this.pageMarkups(pageIndex)
      .filter((m) => m.id !== exclude && canConnect(m))
      .reverse();
    for (const shape of shapes) {
      const near = anchorsOf(shape).find((a) => Math.hypot(a.at[0] - p[0], a.at[1] - p[1]) <= reach);
      if (near) return { shape, side: near.side };
    }
    const hit = shapes.find((m) => hitTest(m, p, this.hitPx / zoom));
    return hit ? { shape: hit } : null;
  }

  /** A connector drawn from `from` to `to`, its ends glued to the shapes there and routed between them. */
  private connectorBetween(m: Markup, from: Point, to: Point): Markup {
    const a = this.glueAt(m.pageIndex, from);
    const b = this.glueAt(m.pageIndex, to, a?.shape.id);
    const connect: ConnectorLinks = { route: m.connect?.route ?? this.state.connectorRoute };
    if (a) connect.from = { id: a.shape.id, ...(a.side ? { side: a.side } : {}) };
    if (b) connect.to = { id: b.shape.id, ...(b.side ? { side: b.side } : {}) };
    const next = { ...m, points: [from, to], connect };
    return { ...next, points: routeConnector(next, (id) => this.store?.get(id)) };
  }

  /** A connector with end `end` (0 the start, 1 the end) dragged to `p`: glued to the shape there, or loose. */
  private connectorEndMoved(m: Markup, end: number, p: Point): Markup {
    const key = end === 0 ? 'from' : 'to';
    const other = m.connect?.[end === 0 ? 'to' : 'from'];
    const glue = this.glueAt(m.pageIndex, p, other?.id);
    const connect: ConnectorLinks = { ...m.connect };
    if (glue) connect[key] = { id: glue.shape.id, ...(glue.side ? { side: glue.side } : {}) };
    else delete connect[key];
    // A route set by hand was for the old end: glued elsewhere, the connector is routed afresh.
    const was = m.connect?.[key];
    if (connect.bends && (was?.id !== connect[key]?.id || was?.side !== connect[key]?.side)) delete connect.bends;
    const next = { ...m, points: end === 0 ? [p, m.points[m.points.length - 1]!] : [m.points[0]!, p], connect };
    return { ...next, points: routeConnector(next, (id) => this.store?.get(id)) };
  }

  /** The one selected markup a connector can glue to, if that is what is selected. */
  private selectedShape(): Markup | null {
    const ms = this.editable();
    return ms.length === 1 && canConnect(ms[0]!) ? ms[0]! : null;
  }

  /**
   * Adds a Process step beside the selected shape (toward `side`), joined to it by a connector,
   * and starts typing its text: a flowchart grows a step at a time (Change Shape makes it a
   * decision or another shape). It moves on past shapes already there.
   */
  addNextShape(side: Side): boolean {
    const store = this.store;
    const from = this.selectedShape();
    if (!store || store.readOnly || !from) return false;
    const kind: FlowShapeKind = 'process';
    const b = boundsOf(from.points);
    const [w, h] = from.type === 'flowShape' && (from.flowShape ?? 'process') === kind ? [b.w, b.h] : (FLOW_SHAPES.find((s) => s.kind === kind)?.size ?? [120, 60]);
    const gap = 40;
    const [dx, dy] = side === 'bottom' ? [0, 1] : side === 'top' ? [0, -1] : side === 'right' ? [1, 0] : [-1, 0];
    let x = dx ? (dx > 0 ? b.x + b.w + gap : b.x - gap - w) : b.x + b.w / 2 - w / 2;
    let y = dy ? (dy > 0 ? b.y + b.h + gap : b.y - gap - h) : b.y + b.h / 2 - h / 2;
    const others = this.pageMarkups(from.pageIndex).filter((m) => m.id !== from.id && canConnect(m)).map((m) => boundsOf(m.points));
    const overlaps = () => others.some((r) => r.x < x + w && x < r.x + r.w && r.y < y + h && y < r.y + r.h);
    for (let i = 0; i < 50 && overlaps(); i++) {
      x += dx * (w + gap);
      y += dy * (h + gap);
    }
    const shape = this.newMarkup('flowShape', from.pageIndex, [[x, y], [x + w, y + h]]);
    shape.flowShape = kind;
    // A step after a flowchart shape looks like it.
    if (from.type === 'flowShape') shape.style = { ...from.style };
    const connector = this.newMarkup('connector', from.pageIndex, [[b.x + b.w / 2, b.y + b.h / 2], [x + w / 2, y + h / 2]]);
    connector.connect = { from: { id: from.id }, to: { id: shape.id }, route: this.state.connectorRoute };
    connector.createdAt = shape.createdAt + 1;
    store.checkpoint();
    store.batch(() => {
      store.add(shape);
      store.add(connector);
    });
    this.setState({ tool: 'select', selected: new Set([shape.id]) });
    this.options.onEditText(shape.id);
    return true;
  }

  /**
   * Joins the selected shapes one after another with connectors, in reading order: top to bottom
   * when they are spread more up and down, else left to right. Pairs already joined are skipped.
   */
  connectSelected(): number {
    const store = this.store;
    const shapes = this.editable().filter((m) => canConnect(m));
    if (!store || store.readOnly || shapes.length < 2) return 0;
    const centre = (m: Markup): Point => {
      const b = boundsOf(m.points);
      return [b.x + b.w / 2, b.y + b.h / 2];
    };
    const cs = shapes.map(centre);
    const spread = (i: 0 | 1) => Math.max(...cs.map((c) => c[i])) - Math.min(...cs.map((c) => c[i]));
    const [major, minor] = spread(1) >= spread(0) ? [1, 0] : [0, 1];
    const ordered = [...shapes].sort((a, b) => centre(a)[major]! - centre(b)[major]! || centre(a)[minor]! - centre(b)[minor]!);
    const joined = new Set(
      store
        .forPage(ordered[0]!.pageIndex)
        .filter((m) => m.type === 'connector' && m.connect?.from && m.connect.to)
        .flatMap((m) => [`${m.connect!.from!.id}>${m.connect!.to!.id}`, `${m.connect!.to!.id}>${m.connect!.from!.id}`]),
    );
    const made: Markup[] = [];
    for (let i = 1; i < ordered.length; i++) {
      const [a, b] = [ordered[i - 1]!, ordered[i]!];
      if (a.pageIndex !== b.pageIndex || joined.has(`${a.id}>${b.id}`)) continue;
      const c = this.newMarkup('connector', a.pageIndex, [centre(a), centre(b)]);
      c.connect = { from: { id: a.id }, to: { id: b.id }, route: this.state.connectorRoute };
      c.createdAt += i;
      made.push(c);
    }
    if (!made.length) return 0;
    store.checkpoint();
    store.batch(() => {
      for (const c of made) store.add(c);
    });
    return made.length;
  }

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

  /** Whether these tools are editing this drawing (the one on screen in their pane). */
  owns(store: MarkupStore): boolean {
    return this.store === store;
  }

  /**
   * Places a markup the way finishing its tool does: the armed tool's defaults, one undo step,
   * then the new markup is selected. A note, flag, or typewriter given one point grows a box
   * sized for the current zoom.
   */
  place(type: MarkupType, pageIndex: number, points: Point[], extras?: { text?: string; comment?: string; subject?: string }): Markup {
    const store = this.store;
    if (!store) throw new Error('No document is open.');
    if (store.readOnly) throw new Error('This drawing is read-only.');
    const zoom = this.viewer.zoomFor(pageIndex) || 1;
    let placed = points;
    if (points.length === 1 && (type === 'note' || type === 'flag' || type === 'typewriter')) {
      const a = points[0]!;
      if (type === 'typewriter') {
        const size = (this.state.preset?.type === type ? this.state.preset.style?.fontSize : undefined) ?? this.state.styles[type]?.fontSize ?? 12;
        placed = [a, [a[0] + size * 4, a[1] + size * 1.2 + 8]];
      } else {
        const s = NOTE_PX / zoom;
        placed = [a, [a[0] + s * (type === 'flag' ? 0.8 : 1), a[1] + s]];
      }
    }
    const markup = this.newMarkup(type, pageIndex, placed);
    if (extras?.text) markup.text = extras.text;
    if (extras?.comment) markup.comment = extras.comment;
    if (extras?.subject) markup.subject = extras.subject;
    store.checkpoint();
    store.add(markup);
    this.options.onCreated?.(markup);
    this.select([markup.id]);
    return store.get(markup.id) ?? markup;
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
    this.applyToPages(Array.from({ length: pageCount }, (_, i) => i));
  }

  /** Copies the selected markups onto `pages` (0-based) at the same position, skipping each one's own page. */
  applyToPages(pages: readonly number[]) {
    const ms = this.editable();
    if (!this.store || this.store.readOnly || !ms.length) return;
    const now = Date.now();
    const store = this.store;
    store.checkpoint();
    let n = 0;
    store.batch(() => {
      for (const page of pages) {
        const groups = new Map<string, string>();
        const onPage = ms.filter((m) => m.pageIndex !== page);
        const ids = new Map(onPage.map((m) => [m.id, crypto.randomUUID()]));
        for (const m of relinkCopies(onPage, ids)) {
          const groupId = m.groupId ? (groups.get(m.groupId) ?? groups.set(m.groupId, crypto.randomUUID()).get(m.groupId)!) : undefined;
          store.add({ ...structuredClone(m), id: ids.get(m.id)!, pageIndex: page, groupId, status: 'none', author: this.options.author(), createdAt: now + n, modifiedAt: now + n });
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
        const copyOf = new Map(ms.map((m) => [m.id, crypto.randomUUID()]));
        for (const m of relinkCopies(ms, copyOf)) {
          const id = copyOf.get(m.id)!;
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
    // With cells selected, the text settings are theirs: the table and the tool's defaults stay as they are.
    if (type === 'table' && this.state.tableCells && Object.keys(patch).every(isCellStyleKey)) {
      this.applyCellStyle(patch as Partial<CellFormat>);
      return;
    }
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
        if (m && m.type === type && !this.frozen(m)) store.update(id, { style: { ...m.style, ...patch }, ...tableOwnStyleCleared(m, patch) });
      }
    });
  }

  /** Changes the default style for new markups of `type`, without touching existing markups. */
  setDefaultStyle(type: MarkupType, patch: Partial<MarkupStyle>) {
    // A text highlight is made by the Highlight tool: it takes that tool's colour and opacity.
    if (type === 'textHighlight') {
      const look: Partial<MarkupStyle> = { stroke: patch.stroke, opacity: patch.opacity };
      type = 'highlighter';
      patch = Object.fromEntries(Object.entries(look).filter(([, v]) => v !== undefined));
    }
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
        if (m && !this.frozen(m)) store.update(id, { style: mergeStyle(m.style, patch), ...tableOwnStyleCleared(m, patch) });
      }
    });
  }

  /**
   * Sets text style and background on the selected table cells, as in a spreadsheet: a field set to
   * undefined goes back to the table's. Rapid changes merge into one undo step.
   */
  applyCellStyle(patch: Partial<CellFormat>) {
    const s = this.tableSelection();
    const store = this.store;
    if (!s || !store || store.readOnly || this.frozen(s.markup)) return;
    store.batch(() => store.update(s.markup.id, { table: formatTableCells(s.markup, s.range, patch) }));
  }

  /** Takes every setting of its own off the selected cells, so they look like the rest of the table. */
  clearCellFormatting() {
    const s = this.tableSelection();
    const store = this.store;
    if (!s || !store || store.readOnly || this.frozen(s.markup)) return;
    store.checkpoint();
    store.update(s.markup.id, { table: clearTableFormats(s.markup, undefined, s.range) });
  }

  /** The text style of the selected cell (the first of several), with the table's under it. */
  selectedCellStyle(): MarkupStyle | null {
    const s = this.tableSelection();
    return s ? tableCellStyle(s.markup, s.range.row, s.range.col) : null;
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
    const ids = markups.map(() => crypto.randomUUID());
    // Pasted connectors join the pasted copies of their shapes.
    const copyOf = new Map(markups.map((m, i) => [m.id, ids[i]!]));
    markups = relinkCopies(markups, copyOf);
    this.store.checkpoint();
    markups.forEach((m, i) => {
      const id = ids[i]!;
      // Pasted groups stay grouped, as new groups of their own.
      const groupId = m.groupId ? (groups.get(m.groupId) ?? groups.set(m.groupId, crypto.randomUUID()).get(m.groupId)!) : undefined;
      this.store!.add({
        ...structuredClone(m),
        id,
        pageIndex,
        groupId,
        locked: undefined,
        // Preferences › Markup › Retain Layer Information when copying Markups.
        layer: settings.get().retainLayerOnCopy ? m.layer : undefined,
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
    const ids = template.map(() => crypto.randomUUID());
    template = relinkCopies(template, new Map(template.map((m, i) => [m.id, ids[i]!])));
    // Each placement gets its own groups, so two copies of a Cloud+ do not move as one.
    const groups = new Map<string, string>();
    this.store.checkpoint();
    template.forEach((m, i) => {
      const id = ids[i]!;
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
    if (this.pickedText) {
      this.clearTextSelection();
      return;
    }
    if (this.cad?.picks.length) {
      // Escape steps back to the tool's first pick, then leaves it.
      this.cad.picks = [];
      this.setState({ cad: { picks: 0, error: null } });
      return;
    }
    const g = this.gesture;
    // A dragged line end goes back, and a dragged sheet back to where the store has it.
    if (g?.kind === 'guideEnd') {
      const line = this.stitchGuides?.lines.find((l) => l.id === g.id);
      if (line) line[g.end ? 'p1' : 'p0'] = g.from;
    } else if (g?.kind === 'stitchMove') this.options.onStitchDrag?.([0, 0], false);
    if (g?.kind === 'geoMove') this.viewer.invalidate();
    if (g) this.setGesture(null);
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
    if (this.state.tool === 'matchLine') {
      // The tool stays on, for the next sheet's line.
      if (points.length >= 2) this.options.onMatchLine?.(g.markup.pageIndex, points[0]!, points[1]!);
      return;
    }
    if (this.state.tool === 'stitchPolygon') {
      if (points.length >= 3) this.options.onStitchRegion?.(g.markup.pageIndex, points);
      return;
    }
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
  private async fillAt(pageIndex: number, at: Point, extras?: { text?: string; comment?: string; subject?: string }): Promise<{ markup?: Markup; error?: string }> {
    const store = this.store;
    const size = this.viewer.pageSize(pageIndex);
    if (!store || !size || !this.snapSource) return { error: 'Smart Fill is not ready on this page.' };
    let index: SnapIndex;
    try {
      const cached = this.snapIndexes.get(pageIndex);
      index = cached && cached !== 'loading' ? cached : await this.snapSource(pageIndex);
    } catch {
      return { error: 'Could not read the drawing on this page.' };
    }
    const walls: number[] = [];
    for (const m of store.forPage(pageIndex)) if (m.type !== 'space' && !TYPE_INFO[m.type].content && TYPE_INFO[m.type].draw !== 'text') walls.push(...markupSegments(m));
    const segments = walls.length ? Float32Array.from([...index.segments, ...walls]) : index.segments;
    const polygon = dynamicFill(segments, at, { width: size.width, height: size.height })?.map(([x, y]): Point => [x, y]);
    if (!polygon) return { error: 'No enclosed area there: click inside a closed outline, or draw a line to close the gap.' };
    const type = this.state.fillAs;
    const m = this.newMarkup(type, pageIndex, type === 'polylength' ? [...polygon, polygon[0]!] : polygon);
    if (extras?.text) m.text = extras.text;
    if (extras?.comment) m.comment = extras.comment;
    if (extras?.subject) m.subject = extras.subject;
    store.checkpoint();
    store.add(m);
    this.options.onCreated?.(m);
    if (type === 'space') this.options.onSpaceDrawn?.(m.id);
    return { markup: store.get(m.id) ?? m };
  }

  /** Smart Fill at a point, for the assistant: the markup the armed fill type makes, or the reason it could not. */
  async fill(pageIndex: number, at: Point, extras?: { text?: string; comment?: string; subject?: string }): Promise<Markup> {
    const { markup, error } = await this.fillAt(pageIndex, at, extras);
    if (!markup) throw new Error(error ?? 'Smart Fill found nothing there.');
    return markup;
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
    const editable = new Set(this.handleTargets().map((t) => t.id));
    for (const m of this.pageMarkups(pageIndex)) {
      const shown = this.previewOf(m);
      // Markups the list's filter leaves out show faintly (or not at all, see setFilterView).
      const faint = ((this.filterMode === 'dim' && this.filteredOut?.(m)) || this.fadedLayers.has(m.layer ?? '')) && !this.state.selected.has(m.id);
      if (faint) {
        ctx.save();
        ctx.globalAlpha = settings.get().filteredDim / 100;
      }
      drawMarkup(ctx, shown, zoom, store.scaleOf(shown), legends);
      if (faint) ctx.restore();
      if (m.replies?.length && settings.get().replyIndicators) drawReplyIndicator(ctx, shown, zoom);
      if (this.state.selected.has(m.id)) {
        drawSelection(ctx, shown, zoom, this.pointerKind === 'touch' ? 14 : 6);
        if (editable.has(m.id)) this.drawVertexKnobs(ctx, shown, zoom);
        if (editable.has(m.id) && this.reroutable(m)) this.drawSegmentHandles(ctx, shown, zoom);
        if (this.state.tableCells?.id === m.id) this.drawTableCells(ctx, shown, this.state.tableCells, zoom);
      }
    }
    const popup = this.popup?.shown ? store.get(this.popup.id) : undefined;
    if (popup?.pageIndex === pageIndex && popup.comment?.trim()) drawPopup(ctx, popup, zoom);
    this.drawFormWidgets(ctx, pageIndex);
    this.drawLinks(ctx, pageIndex, zoom);
    this.drawRegions(ctx, zoom);
    this.drawStitchGuides(ctx, pageIndex, zoom);
    this.drawGeoOverlay(ctx, pageIndex, zoom);
    const g = this.gesture;
    if (this.pickedText?.pageIndex === pageIndex && !g) {
      ctx.save();
      ctx.fillStyle = 'rgba(59, 130, 246, 0.35)';
      for (const r of markupLines(this.pickedText.points)) ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.restore();
    }
    if (g?.kind === 'textMark' && g.markup.pageIndex === pageIndex && g.markup.type !== 'textHighlight') {
      // The words under the pointer show as a highlight while an underline, strikeout or other text tool drags.
      ctx.save();
      ctx.fillStyle = 'rgba(59, 130, 246, 0.3)';
      for (const r of markupLines(g.markup.points)) ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.restore();
    }
    if ((g?.kind === 'draw' || g?.kind === 'textMark' || g?.kind === 'pendingHighlight') && g.markup.pageIndex === pageIndex && g.markup.points.length) drawMarkup(ctx, g.markup, zoom, store.scaleOf(g.markup), legends);
    if (g?.kind === 'multi' && g.markup.pageIndex === pageIndex) {
      const { markup, hover } = g;
      const live = hover && markup.type !== 'count' ? { ...markup, points: [...markup.points, hover] } : markup;
      drawMarkup(ctx, live, zoom, store.scaleOf(live));
      // Draw to Size: the length and angle of the segment under the pointer (measurements label themselves).
      const from = markup.points.at(-1);
      if (this.state.sketch && from && hover && !isMeasureKind(markup.type)) {
        const { length, angle: absolute } = segmentPolar(from, hover);
        // The readout shows angles as they are typed: relative to the last segment when set so.
        const angle = settings.get().rotationInput === 'relative' && markup.points.length >= 2 ? ((((absolute - this.sketchBaseAngle(markup.points)) % 360) + 540) % 360) - 180 : absolute;
        const scale = store.scaleAt(pageIndex, from);
        if (length * zoom >= 2) drawSketchReadout(ctx, `${formatLength(length * scale.metersPerPoint, scale)}  ∠ ${angle.toFixed(1)}°`, hover, zoom);
      }
    }
    // Draw to Scale: the box from its first corner to the pointer, with its width and height.
    const anchor = this.sketchAnchor;
    if (!g && anchor?.pageIndex === pageIndex && anchor.hover) {
      const [a, b] = [anchor.at, anchor.hover];
      drawMarkup(ctx, { ...anchor.markup, points: this.sketchBoxPoints(anchor, b) }, zoom, store.scaleOf(anchor.markup));
      const scale = store.scaleAt(pageIndex, a);
      const size = (d: number) => formatLength(Math.abs(d) * scale.metersPerPoint, scale);
      const r = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (r * zoom >= 2) {
        if (sketchesCircle(anchor.type)) {
          // The radius, from the centre out to the pointer.
          ctx.save();
          ctx.strokeStyle = '#2563eb';
          ctx.lineWidth = 1 / zoom;
          ctx.setLineDash([4 / zoom, 3 / zoom]);
          ctx.beginPath();
          ctx.moveTo(a[0], a[1]);
          ctx.lineTo(b[0], b[1]);
          ctx.stroke();
          ctx.restore();
          drawSketchReadout(ctx, settings.get().sketchEllipse === 'diameter' ? `Ø ${size(2 * r)}` : `R ${size(r)}`, b, zoom);
        } else drawSketchReadout(ctx, `${size(b[0] - a[0])} × ${size(b[1] - a[1])}`, b, zoom);
      }
    }
    if (g?.kind === 'scaleRef' && g.pageIndex === pageIndex) {
      const scale = store.scaleAt(pageIndex, g.ref[0]!);
      const size = (a: Point, b: Point) => formatLength(Math.hypot(b[0] - a[0], b[1] - a[1]) * scale.metersPerPoint, scale);
      const ref = g.ref.length === 2 ? g.ref : g.stage === 'ref' && g.hover ? [g.ref[0]!, g.hover] : g.ref;
      drawScaleLine(ctx, ref, '#2563eb', zoom);
      if (ref.length === 2 && g.stage === 'ref') drawSketchReadout(ctx, `Reference ${size(ref[0]!, ref[1]!)}`, ref[1]!, zoom);
      if (g.stage === 'target') {
        const target = g.target.length === 1 && g.hover ? [g.target[0]!, g.hover] : g.target;
        drawScaleLine(ctx, target, '#ea580c', zoom);
        const factor = scaleFactor(g);
        if (target.length === 2 && factor) drawSketchReadout(ctx, `${size(target[0]!, target[1]!)}  ×${+factor.toFixed(4)}`, target[1]!, zoom);
      }
    }
    if (this.tracking.page === pageIndex) drawAcquired(ctx, this.tracking.points, this.tracking.parallels, zoom);
    if (this.tracked && this.snapPage === pageIndex) {
      const tracked = this.tracked;
      drawTracked(ctx, tracked, zoom);
      const scale = store.scaleAt(pageIndex, tracked.point);
      const one = tracked.paths.length === 1 ? tracked.paths[0]! : null;
      const distance = one ? `: ${formatLength(Math.hypot(tracked.point[0] - one.origin[0], tracked.point[1] - one.origin[1]) * scale.metersPerPoint, scale)}` : '';
      const paths = tracked.paths.map((q) => `${PATH_NAMES[q.kind]}${one ? distance : ''} < ${+q.angle.toFixed(1)}°`).join(', ');
      drawSnapTip(ctx, tracked.onLine ? `Intersection, ${paths}` : paths, tracked.point, zoom);
    }
    if (this.snapHit && this.snapPage === pageIndex) {
      drawSnapIndicator(ctx, this.snapHit, zoom);
      if (!this.snapIsGrid) drawSnapTip(ctx, SNAP_NAMES[this.snapHit.kind], this.snapHit.point, zoom);
    }
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
      ctx.save();
      ctx.globalAlpha = 0.5;
      for (const points of this.offsetCopiesAt(offsetSource, this.ghost.at)) drawMarkup(ctx, { ...offsetSource, points }, zoom, scale);
      ctx.restore();
    }
    this.drawPickTargets(ctx, pageIndex, zoom);
    this.drawConnectionPoints(ctx, pageIndex, zoom);
    this.drawCad(ctx, pageIndex, zoom);
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

  /** With the Connector tool, or dragging a connector's end: the connection points of the shape under the pointer. */
  private drawConnectionPoints(ctx: CanvasRenderingContext2D, pageIndex: number, zoom: number) {
    const hover = this.connectHover;
    const g = this.gesture;
    const dragging = g?.kind === 'handle' && this.store?.get(g.id)?.type === 'connector' ? this.store.get(g.id)! : null;
    const drawing = g?.kind === 'draw' && g.markup.type === 'connector' ? g.markup : null;
    if (hover?.pageIndex !== pageIndex || (this.state.tool !== 'connector' && !dragging)) return;
    // Not the shape the other end is glued to.
    const other = drawing?.connect?.from?.id ?? (dragging && g?.kind === 'handle' ? dragging.connect?.[g.index === 0 ? 'to' : 'from']?.id : undefined);
    const glue = this.glueAt(pageIndex, hover.at, other);
    if (!glue) return;
    const r = 4 / zoom;
    ctx.save();
    ctx.lineWidth = 1.5 / zoom;
    ctx.strokeStyle = '#2563eb';
    const b = boundsOf(glue.shape.points);
    ctx.setLineDash([3 / zoom, 2 / zoom]);
    ctx.save();
    if (glue.shape.rotation) {
      const c = rotationCentre(glue.shape);
      ctx.translate(c[0], c[1]);
      ctx.rotate((glue.shape.rotation * Math.PI) / 180);
      ctx.translate(-c[0], -c[1]);
    }
    ctx.strokeRect(b.x - 2 / zoom, b.y - 2 / zoom, b.w + 4 / zoom, b.h + 4 / zoom);
    ctx.restore();
    ctx.setLineDash([]);
    for (const { side, at } of anchorsOf(glue.shape)) {
      ctx.beginPath();
      ctx.arc(at[0], at[1], side === glue.side ? r * 1.4 : r, 0, Math.PI * 2);
      ctx.fillStyle = side === glue.side ? '#2563eb' : '#ffffff';
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  /** The selected cells of a table: tinted, with a heavier outline round the block. */
  private drawTableCells(ctx: CanvasRenderingContext2D, m: Markup, sel: TableSelection, zoom: number) {
    const r = tableRegionRect(m, tableRange(m, sel.anchor, sel.focus));
    ctx.save();
    ctx.fillStyle = 'rgba(37, 99, 235, 0.16)';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = '#2563eb';
    ctx.lineWidth = 2 / zoom;
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.restore();
  }

  /** The cells selected in the selected table, as the block of cells they cover (merged cells taken whole). */
  tableSelection(): { markup: Markup; cell: TableCell; range: ReturnType<typeof tableRange> } | null {
    const sel = this.state.tableCells;
    const m = sel && this.store?.get(sel.id);
    if (!sel || !m || m.type !== 'table') return null;
    const range = tableRange(m, sel.anchor, sel.focus);
    return { markup: m, cell: { row: range.row, col: range.col }, range };
  }

  /** Selects one cell of a table (selecting the table if need be). */
  selectTableCell(id: string, cell: TableCell) {
    this.setState({ tool: 'select', selected: new Set([id]), tableCells: { id, anchor: cell, focus: cell } });
  }

  /** Whether the selected cells can be merged: more than one cell, and not exactly one merged cell already. */
  canMergeCells(): boolean {
    const sel = this.state.tableCells;
    const s = this.tableSelection();
    return !!s && !!sel && !!mergeTableCells(s.markup, sel.anchor, sel.focus);
  }

  /** Whether any of the selected cells is a merged cell. */
  canSplitCells(): boolean {
    const s = this.tableSelection();
    return !!s && (tableOf(s.markup).merges ?? []).some((g) => g.row < s.range.row + s.range.rowSpan && g.row + g.rowSpan > s.range.row && g.col < s.range.col + s.range.colSpan && g.col + g.colSpan > s.range.col);
  }

  /** Merges the selected cells into one. Returns false when fewer than two cells are selected (or the table is locked). */
  mergeSelectedCells(): boolean {
    const s = this.tableSelection();
    const sel = this.state.tableCells;
    if (!s || !sel || !this.store || this.store.readOnly || this.frozen(s.markup)) return false;
    const table = mergeTableCells(s.markup, sel.anchor, sel.focus);
    if (!table) return false;
    this.store.checkpoint();
    this.store.update(s.markup.id, { table });
    this.setState({ tableCells: { id: s.markup.id, anchor: s.cell, focus: s.cell } });
    return true;
  }

  /** Splits the merged cells within the selected cells back into single cells. Returns false when none was merged. */
  splitSelectedCells(): boolean {
    const s = this.tableSelection();
    if (!s || !this.store || this.store.readOnly || this.frozen(s.markup)) return false;
    let table = tableOf(s.markup);
    let any = false;
    for (let row = s.range.row; row < s.range.row + s.range.rowSpan; row++) {
      for (let col = s.range.col; col < s.range.col + s.range.colSpan; col++) {
        const g = tableRegion(table, row, col);
        if (g.rowSpan * g.colSpan < 2) continue;
        const next = splitTableCell({ table }, row, col);
        if (next) {
          table = next;
          any = true;
        }
      }
    }
    if (!any) return false;
    this.store.checkpoint();
    this.store.update(s.markup.id, { table });
    return true;
  }

  /** Edits the text of the selected cell (the first of several), starting with `text` already typed. */
  editSelectedCell(text?: string): boolean {
    const s = this.tableSelection();
    if (!s || !this.store || this.store.readOnly || this.frozen(s.markup)) return false;
    this.options.onEditTableCell?.(s.markup.id, s.cell.row, s.cell.col, text);
    return true;
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

  private geoOverlay: GeoOverlay | null = null;

  /** Shows (or, with null, hides) the Geospatial panel's model over its sheets. */
  setGeoOverlay(overlay: GeoOverlay | null) {
    this.geoOverlay = overlay;
    this.viewer.invalidate();
  }

  private geoLayer(pageIndex: number) {
    return this.geoOverlay?.layers.find((l) => l.pageIndex === pageIndex) ?? null;
  }

  /** The model vertex nearest a page point, within reach on screen. */
  private geoVertexAt(p: Point, pageIndex: number): Point | null {
    const layer = this.geoLayer(pageIndex);
    if (!layer) return null;
    const reach = (this.hitPx * 2.5) / this.viewer.zoomFor(pageIndex);
    let best: Point | null = null;
    let dist = reach;
    const consider = (q: Point) => {
      const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (d <= dist) {
        dist = d;
        best = q;
      }
    };
    for (const path of layer.paths) for (const q of path) consider(q);
    for (const q of layer.points) consider(q);
    return best;
  }

  /** The drag so far, as an offset on one sheet (through the world, from the sheet pressed). */
  private geoDragOn(pageIndex: number): Point {
    const g = this.gesture;
    if (g?.kind !== 'geoMove' || (!g.dx && !g.dy)) return [0, 0];
    const from = this.geoLayer(g.pageIndex);
    const to = this.geoLayer(pageIndex);
    if (!from || !to) return [0, 0];
    const vec = (m: Affine, [x, y]: Point): Point => {
      const o = applyAffine(m, [0, 0]);
      const v = applyAffine(m, [x, y]);
      return [v[0] - o[0], v[1] - o[1]];
    };
    return vec(to.fromWorld, vec(from.toWorld, [g.dx, g.dy]));
  }

  private drawGeoOverlay(ctx: CanvasRenderingContext2D, pageIndex: number, zoom: number) {
    const o = this.geoOverlay;
    const layer = this.geoLayer(pageIndex);
    if (!o || !layer) return;
    const [dx, dy] = this.geoDragOn(pageIndex);
    ctx.save();
    const outline = () => {
      ctx.beginPath();
      layer.bounds.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      ctx.closePath();
    };
    if (layer.bounds.length) {
      ctx.strokeStyle = '#0891b2';
      ctx.lineWidth = 1 / zoom;
      ctx.setLineDash([4 / zoom, 4 / zoom]);
      outline();
      ctx.stroke();
      ctx.setLineDash([]);
      if (o.clip) {
        outline();
        ctx.clip();
      }
    }
    ctx.translate(dx, dy);
    ctx.strokeStyle = 'rgba(8, 145, 178, 0.9)';
    ctx.lineWidth = 1.25 / zoom;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (const path of layer.paths) path.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    ctx.stroke();
    ctx.fillStyle = 'rgba(8, 145, 178, 0.9)';
    const r = 2 / zoom;
    for (const p of layer.points) ctx.fillRect(p[0] - r, p[1] - r, 2 * r, 2 * r);
    ctx.translate(-dx, -dy);
    // Alignment pairs: the model's point (cyan ring), the drawing's (red cross), joined by a line.
    ctx.font = `600 ${11 / zoom}px system-ui, sans-serif`;
    const onPage = (w: Point): Point => applyAffine(layer.fromWorld, w);
    o.pairs.forEach((pair, i) => {
      const model = pair.model && onPage(pair.model);
      const page = pair.page && onPage(pair.page);
      if (model && page) {
        ctx.strokeStyle = '#7c3aed';
        ctx.lineWidth = 1 / zoom;
        ctx.setLineDash([3 / zoom, 3 / zoom]);
        ctx.beginPath();
        ctx.moveTo(model[0], model[1]);
        ctx.lineTo(page[0], page[1]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (model) {
        ctx.strokeStyle = '#0891b2';
        ctx.lineWidth = 2 / zoom;
        ctx.beginPath();
        ctx.arc(model[0], model[1], 6 / zoom, 0, 2 * Math.PI);
        ctx.stroke();
        ctx.fillStyle = '#0891b2';
        ctx.fillText(`M${i + 1}`, model[0] + 8 / zoom, model[1] - 8 / zoom);
      }
      if (page) {
        const sz = 7 / zoom;
        ctx.strokeStyle = '#dc2626';
        ctx.lineWidth = 2 / zoom;
        ctx.beginPath();
        ctx.moveTo(page[0] - sz, page[1]);
        ctx.lineTo(page[0] + sz, page[1]);
        ctx.moveTo(page[0], page[1] - sz);
        ctx.lineTo(page[0], page[1] + sz);
        ctx.stroke();
        ctx.fillStyle = '#dc2626';
        ctx.fillText(`P${i + 1}`, page[0] + 8 / zoom, page[1] + 14 / zoom);
      }
    });
    ctx.restore();
  }

  private stitchGuides: StitchGuides | null = null;

  /** Shows (or, with null, hides) the hand-placed match lines and stitch regions. */
  setStitchGuides(guides: StitchGuides | null) {
    this.stitchGuides = guides;
    this.viewer.invalidate();
  }

  /** The end of a shown match line under a page point, if any. */
  private guideEndAt(p: Point, pageIndex: number): { id: string; end: 0 | 1 } | null {
    const tol = this.hitPx / this.viewer.zoomFor(pageIndex);
    for (const l of this.stitchGuides?.lines ?? []) {
      if (l.pageIndex !== pageIndex) continue;
      if (Math.hypot(p[0] - l.p0[0], p[1] - l.p0[1]) <= tol) return { id: l.id, end: 0 };
      if (Math.hypot(p[0] - l.p1[0], p[1] - l.p1[1]) <= tol) return { id: l.id, end: 1 };
    }
    return null;
  }

  private drawStitchGuides(ctx: CanvasRenderingContext2D, pageIndex: number, zoom: number) {
    const guides = this.stitchGuides;
    if (!guides) return;
    ctx.save();
    const region = guides.regions[pageIndex];
    const size = this.viewer.pageSize(pageIndex);
    if (region?.length && size) {
      // Shade what the stitch leaves out (title block, legend...), and outline what it keeps.
      ctx.beginPath();
      ctx.rect(0, 0, size.width, size.height);
      region.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      ctx.closePath();
      ctx.fillStyle = 'rgba(100, 116, 139, 0.28)';
      ctx.fill('evenodd');
      ctx.beginPath();
      region.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      ctx.closePath();
      ctx.strokeStyle = '#7c3aed';
      ctx.lineWidth = 1.5 / zoom;
      ctx.setLineDash([6 / zoom, 4 / zoom]);
      ctx.stroke();
    }
    ctx.font = `600 ${12 / zoom}px system-ui, sans-serif`;
    for (const l of guides.lines) {
      if (l.pageIndex !== pageIndex) continue;
      const colour = l.problem ? '#d97706' : l.paired ? '#16a34a' : '#dc2626';
      ctx.strokeStyle = colour;
      ctx.fillStyle = colour;
      ctx.lineWidth = (l.id === guides.selected ? 4 : 2.5) / zoom;
      ctx.setLineDash([10 / zoom, 5 / zoom]);
      ctx.beginPath();
      ctx.moveTo(l.p0[0], l.p0[1]);
      ctx.lineTo(l.p1[0], l.p1[1]);
      ctx.stroke();
      ctx.setLineDash([]);
      // An arrow from the middle of the line into the side this sheet keeps.
      const [dx, dy] = [l.p1[0] - l.p0[0], l.p1[1] - l.p0[1]];
      const length = Math.hypot(dx, dy) || 1;
      const [nx, ny] = [(-dy / length) * l.contentSide, (dx / length) * l.contentSide];
      const mid: Point = [(l.p0[0] + l.p1[0]) / 2, (l.p0[1] + l.p1[1]) / 2];
      const tip: Point = [mid[0] + (nx * 28) / zoom, mid[1] + (ny * 28) / zoom];
      const back = 8 / zoom;
      ctx.beginPath();
      ctx.moveTo(mid[0], mid[1]);
      ctx.lineTo(tip[0], tip[1]);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(tip[0] + nx * 2 / zoom, tip[1] + ny * 2 / zoom);
      ctx.lineTo(tip[0] - nx * back + (dx / length) * back * 0.6, tip[1] - ny * back + (dy / length) * back * 0.6);
      ctx.lineTo(tip[0] - nx * back - (dx / length) * back * 0.6, tip[1] - ny * back - (dy / length) * back * 0.6);
      ctx.closePath();
      ctx.fill();
      for (const end of [l.p0, l.p1]) {
        ctx.beginPath();
        ctx.arc(end[0], end[1], 4 / zoom, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillText(l.name, tip[0] + 4 / zoom, tip[1] - 4 / zoom);
    }
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
    // Pan and Select Text still select (and move) a markup that is pressed.
    const tool = this.selectsHere(pageIndex, pt) ? 'select' : this.state.tool;
    // Pressing anywhere else lets go of selected text (a drag over words picks new text).
    if (e.button === 0) this.clearTextSelection();

    // The Geospatial panel's model: dragged, or a point on it or the sheet picked for alignment.
    const geo = this.geoOverlay;
    const layer = this.geoLayer(pageIndex);
    if (e.button === 0 && geo && layer && geo.mode !== 'none') {
      const p = toPoint(pt);
      const world = (q: Point): Point => applyAffine(layer.toWorld, q);
      if (geo.mode === 'move') this.setGesture({ kind: 'geoMove', start: p, dx: 0, dy: 0, pageIndex });
      else if (geo.mode === 'pickModel') this.options.onGeoPick?.('model', world(this.geoVertexAt(p, pageIndex) ?? p));
      else this.options.onGeoPick?.('page', world(this.resolve(pt, e, null)));
      return true;
    }

    // With the Stitching panel open, the ends of its match lines can be dragged.
    if (e.button === 0 && !this.store.readOnly && (tool === 'select' || (tool === 'matchLine' && this.gesture?.kind !== 'multi'))) {
      const end = this.guideEndAt(toPoint(pt), pageIndex);
      if (end) {
        const line = this.stitchGuides!.lines.find((l) => l.id === end.id)!;
        this.setGesture({ kind: 'guideEnd', ...end, from: end.end ? line.p1 : line.p0 });
        return true;
      }
    }

    if (tool === 'stitchMove') {
      if (e.button !== 0 || this.store.readOnly) return false;
      if (!this.viewer.isStitched) {
        this.options.onNotice?.('Move Sheet works in the Stitched View: turn it on from the Stitching panel.');
        return true;
      }
      this.setGesture({ kind: 'stitchMove', start: toPoint(this.viewer.pageToWorld(pageIndex, pt)) });
      return true;
    }

    if (isCadTool(tool)) {
      if (e.button !== 0 || this.store.readOnly) return false;
      this.cadClickAt(tool, pt, e, pageIndex);
      return true;
    }

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
      if (e.button !== 0 || this.store.readOnly) return false;
      if (!source) {
        const hit = this.hitAt(toPoint(pt));
        if (hit && canOffset(hit)) this.setState({ painterSource: structuredClone(hit), selected: new Set([hit.id]) });
        return true;
      }
      const copies = this.offsetCopiesAt(source, toPoint(pt));
      if (!copies.length) return true;
      const store = this.store;
      const now = Date.now();
      const made = copies.map((points, k): Markup => ({ ...structuredClone(source), id: crypto.randomUUID(), points, groupId: undefined, locked: undefined, status: 'none', author: this.options.author(), createdAt: now + k, modifiedAt: now + k }));
      store.checkpoint();
      store.batch(() => made.forEach((m) => store.add(m)));
      this.ghost = null;
      const selected = new Set(made.map((m) => m.id));
      // Like CAD offset the tool stays on for the next pick (unless Reuse is off); Escape ends it.
      if (settings.get().reuseTool) this.setState({ painterSource: null, selected });
      else this.setState({ tool: 'select', painterSource: null, selected });
      return true;
    }

    if (tool === 'editText') {
      if (e.button !== 0) return false;
      this.options.onEditPdfText?.(pageIndex, toPoint(pt));
      return true;
    }

    if (tool === 'dynamicFill') {
      if (e.button !== 0) return false;
      void this.fillAt(pageIndex, toPoint(pt)).then(({ error }) => {
        if (error) this.options.onNotice?.(error);
      });
      return true;
    }

    if (tool === 'lasso') {
      this.setGesture({ kind: 'lasso', pageIndex, path: [toPoint(pt)], add: e.shiftKey });
      return true;
    }

    // Real-world lengths need the page's scale: ask for it before starting.
    if (e.button === 0 && !this.gesture && needsScale(tool) && this.options.onScaleRequired && !this.store.isScaledAt(pageIndex, toPoint(pt))) {
      this.options.onScaleRequired(pageIndex, tool);
      return true;
    }

    const template = this.state.preset?.template;
    if (template && tool !== 'select') {
      if (e.button !== 0) return false;
      this.ghost = null;
      this.placeTemplate(template, pageIndex, pt, !this.state.preset?.once);
      return true;
    }

    // Draw to Scale: a click after the first corner places the opposite one.
    const anchor = this.sketchAnchor;
    if (anchor && tool === anchor.type && anchor.pageIndex === pageIndex && e.button === 0) {
      const to = this.resolve(pt, e, anchor.at);
      const zoom = this.viewer.zoomFor(pageIndex);
      const [dx, dy] = [Math.abs(to[0] - anchor.at[0]) * zoom, Math.abs(to[1] - anchor.at[1]) * zoom];
      if (sketchesCircle(anchor.type) ? Math.hypot(dx, dy) >= this.dragPx : dx >= this.dragPx && dy >= this.dragPx) this.placeSketchBox(this.sketchBoxPoints(anchor, to));
      return true;
    }

    if (tool === 'scaleLength') {
      if (e.button === 0) this.scaleClick(pt, e, pageIndex);
      return true;
    }

    const spec = clickSpec(tool);
    if (spec) {
      const g = this.gesture;
      const p = this.resolve(pt, e, g?.kind === 'multi' ? g.markup.points.at(-1)! : null);
      if (g?.kind === 'multi') {
        const { markup } = g;
        const first = markup.points[0]!;
        const closes = !!spec.closes && markup.points.length >= 3 && Math.hypot(p[0] - first[0], p[1] - first[1]) * this.viewer.zoomFor(this.page) <= snapPx();
        if (closes) {
          this.finish();
          return true;
        }
        markup.points = [...markup.points, p];
        g.down = p;
        this.clearTracking();
        this.completeIfFixed();
        this.refreshSketch();
        return true;
      }
      // A cutout is drawn inside its area, on the area's page.
      if (tool === 'cutout' && this.store.get(this.cutoutTarget ?? '')?.pageIndex !== pageIndex) return false;
      const markup = this.newMarkup(tool === 'calibrate' || tool === 'matchLine' ? 'line' : tool === 'cutout' || tool === 'stitchPolygon' ? 'polygon' : (tool as MarkupType), pageIndex, [p]);
      if (tool === 'calibrate') markup.style = { ...CALIBRATE_STYLE };
      if (tool === 'matchLine') markup.style = { ...MATCH_LINE_STYLE };
      if (tool === 'cutout' || tool === 'stitchPolygon') markup.style = { ...CALIBRATE_STYLE, dash: 'dashed' };
      // A match line, like a calibration line, is two points and makes no markup.
      this.setGesture({ kind: 'multi', markup, hover: p, down: p, calibrate: tool === 'calibrate' || tool === 'matchLine' });
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
      // Highlight marks the words under the pointer. Ctrl draws a free stroke, including over text.
      if (tool === 'highlighter' && this.startHighlighter(e, pageIndex, toPoint(pt))) return true;
      // Cloud+ draws a cloud, then adds a callout pointing at it.
      const type: MarkupType = tool === 'cloudPlus' ? 'cloud' : (tool as MarkupType);
      // A connector glues to shapes rather than snapping to points.
      const p = snapsWhileDrawing(type) && type !== 'connector' ? this.resolve(pt, e, null) : toPoint(pt);
      if (type === 'connector') this.connectStart = p;
      const markup = this.newMarkup(type, pageIndex, TYPE_INFO[type].draw === 'freehand' ? [p] : [p, p]);
      this.setGesture({ kind: 'draw', markup });
      return true;
    }

    // Handles of a single selected markup take priority.
    const p = toPoint(pt);
    const zoom = this.viewer.zoomFor(this.page);
    const tol = this.hitPx / zoom;
    for (const m of this.handleTargets()) {
      const text = m && !this.frozen(m) && !this.store.readOnly ? labelHandles(m, zoom) : null;
      if (m && text && Math.hypot(text.rotate.at[0] - p[0], text.rotate.at[1] - p[1]) <= tol * 1.5) {
        const rotation = m.style.labelRotation ?? 0;
        this.setGesture({ kind: 'labelRotate', id: m.id, centre: text.move, base: text.angle - rotation, angle: rotation });
        return true;
      }
      if (m && text && Math.hypot(text.move[0] - p[0], text.move[1] - p[1]) <= tol * 1.5) {
        const from = { leader: m.style.leader ?? 0, along: m.style.labelOffset ?? 0 };
        this.setGesture({ kind: 'label', id: m.id, start: p, from, ...from });
        return true;
      }
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
      const seg = m && this.reroutable(m) ? routeHandles(m.points, m.connect?.bends).find(({ at }) => Math.hypot(at[0] - p[0], at[1] - p[1]) <= tol * 1.5) : undefined;
      if (m && seg) {
        const route = editableRoute(m.points, m.connect?.bends)!;
        if (e.ctrlKey || e.metaKey || e.altKey) {
          // Ctrl- or Alt-click takes the segment out, if the route stays at right angles.
          const next = removeSegment(route, seg.mid, m.points[0]!, m.points[m.points.length - 1]!);
          if (next !== null) this.setBends(m, next);
          return true;
        }
        this.setGesture({ kind: 'segment', id: m.id, route, mid: seg.mid, runs: seg.runs, to: seg.runs === 'h' ? seg.at[1] : seg.at[0], start: m.points[0]! });
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
      // A row or column line of the selected table drags to resize the two cells either side of it.
      const line = m?.type === 'table' && !this.frozen(m) && !this.store.readOnly && !e.shiftKey ? tableLineAt(m, p, tol) : null;
      if (m && line) {
        this.store.checkpoint();
        this.setGesture({ kind: 'tableLine', id: m.id, line, to: line.axis === 'col' ? p[0] : p[1] });
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
      // Dragging on empty page draws a selection box (Shift adds to the selection). Panning is
      // the Pan tool, the middle button, or the wheel; text is picked with Select Text.
      if (e.button !== 0) return false;
      this.setGesture({ kind: 'box', start: p, end: p, add: e.shiftKey });
      return true;
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
    if (hit.type === 'table' && members.size === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const cell = tableCellAt(hit, p);
      const only = this.state.selected.size === 1 && this.state.selected.has(hit.id);
      const b = boundsOf(hit.points);
      const onFrame = Math.min(p[0] - b.x, b.x + b.w - p[0], p[1] - b.y, b.y + b.h - p[1]) <= tol;
      if (cell && only && e.shiftKey) {
        // Shift-click stretches the selected cells to this one.
        const at = this.state.tableCells;
        this.setState({ tableCells: { id: hit.id, anchor: at?.id === hit.id ? at.anchor : cell, focus: cell } });
        return true;
      }
      if (cell && !e.shiftKey && !onFrame) {
        this.setState({ selected: new Set([hit.id]), tableCells: { id: hit.id, anchor: cell, focus: cell } });
        // Dragging inside a table already selected selects a block of cells; the first press on one moves it.
        this.setGesture(only ? { kind: 'tableCells', id: hit.id, from: cell } : { kind: 'move', start: p, dx: 0, dy: 0 });
        return true;
      }
    }
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
    if (g.kind === 'guideEnd') {
      const line = this.stitchGuides?.lines.find((l) => l.id === g.id);
      if (!line) return;
      const p = this.resolve(pt, e, g.end ? line.p0 : line.p1);
      if (g.end) line.p1 = p;
      else line.p0 = p;
      this.viewer.invalidate();
      return;
    }
    if (g.kind === 'stitchMove') {
      const w = this.viewer.pageToWorld(pageIndex, pt);
      this.options.onStitchDrag?.([w[0] - g.start[0], w[1] - g.start[1]], false);
      return;
    }
    if (g.kind === 'geoMove') {
      const p = toPoint(pt);
      g.dx = p[0] - g.start[0];
      g.dy = p[1] - g.start[1];
      this.viewer.invalidate();
      return;
    }
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
      this.applyTextMark(g.markup, g.from, toPoint(pt));
    } else if (g.kind === 'pendingHighlight') {
      const m = g.markup;
      const p = toPoint(pt);
      const last = m.points[m.points.length - 1]!;
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) * this.viewer.zoomFor(this.page) >= 1.5) m.points = [...m.points, p];
      if (this.resolvePendingHighlight(g, p)) this.pointerMove(e, pt, pageIndex);
      else this.viewer.invalidate();
      return;
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
      } else if (m.type === 'connector') {
        const p = toPoint(pt);
        const next = this.connectorBetween(m, this.connectStart ?? m.points[0]!, p);
        m.points = next.points;
        m.connect = next.connect;
        this.connectHover = { pageIndex, at: p };
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
    } else if (g.kind === 'segment') {
      const p = toPoint(pt);
      g.to = g.runs === 'h' ? p[1] : p[0];
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
    } else if (g.kind === 'tableLine') {
      g.to = g.line.axis === 'col' ? pt[0] : pt[1];
    } else if (g.kind === 'tableCells') {
      const m = this.store?.get(g.id);
      if (m) {
        const b = boundsOf(m.points);
        const cell = tableCellAt(m, [Math.min(Math.max(pt[0], b.x), b.x + b.w), Math.min(Math.max(pt[1], b.y), b.y + b.h)]);
        const now = this.state.tableCells;
        if (cell && (now?.focus.row !== cell.row || now.focus.col !== cell.col)) this.setState({ tableCells: { id: g.id, anchor: g.from, focus: cell } });
      }
    } else if (g.kind === 'label') {
      const m = this.store?.get(g.id);
      const line = m ? dimensionLine(m) : null;
      if (line) {
        const dx = pt[0] - g.start[0];
        const dy = pt[1] - g.start[1];
        // Shift keeps the text on its line; near the middle it settles there.
        const along = g.from.along + dx * line.dir[0] + dy * line.dir[1];
        g.along = Math.abs(along) * this.viewer.zoomFor(this.page) < this.hitPx ? 0 : along;
        g.leader = e.shiftKey ? g.from.leader : g.from.leader + dx * line.normal[0] + dy * line.normal[1];
      }
    } else if (g.kind === 'labelRotate') {
      // The knob sits above the text, so pointing straight up is no turn; Shift snaps to 15°.
      let angle = (Math.atan2(pt[1] - g.centre[1], pt[0] - g.centre[0]) * 180) / Math.PI + 90 - g.base;
      angle = ((((angle + 180) % 360) + 360) % 360) - 180;
      g.angle = e.shiftKey ? Math.round(angle / 15) * 15 : Math.abs(angle) < 2 ? 0 : Math.round(angle * 10) / 10;
    } else if (g.kind === 'rotate') {
      const m = this.store?.get(g.id);
      if (m) {
        const [cx, cy] = rotationCentre(m);
        // The handle sits above the box, so pointing straight up is no turn; Shift snaps to 15°.
        let angle = (Math.atan2(pt[1] - cy, pt[0] - cx) * 180) / Math.PI + 90;
        angle = e.shiftKey ? Math.round(angle / 15) * 15 : Math.round(angle * 10) / 10;
        g.angle = ((angle % 360) + 360) % 360;
      }
    } else if (g.kind === 'scaleRef') {
      if (g.stage !== 'ask' && g.pageIndex === pageIndex) g.hover = this.resolve(pt, e, (g.stage === 'ref' ? g.ref[0] : g.target[0]) ?? null);
    } else {
      const m = this.store?.get(g.id);
      const anchor = m && CLICK_SHAPES[m.type] ? (m.points[g.index - 1] ?? m.points[g.index + 1] ?? null) : null;
      g.point = m?.type === 'connector' ? toPoint(pt) : this.resolve(pt, e, anchor, g.id);
      if (m?.type === 'connector') this.connectHover = { pageIndex, at: g.point };
    }
    this.viewer.invalidate();
  }

  pointerUp(e: PointerEvent, pt: PagePoint, pageIndex: number) {
    this.page = pageIndex;
    const g = this.gesture;
    if (!g || !this.store) return;
    if (g.kind === 'guideEnd') {
      this.setGesture(null);
      const line = this.stitchGuides?.lines.find((l) => l.id === g.id);
      const now = g.end ? line?.p1 : line?.p0;
      // A press on an end that didn't move it changes nothing.
      if (line && now && (now[0] !== g.from[0] || now[1] !== g.from[1]) && this.options.onMatchLineEdited?.(line.id, line.p0, line.p1) === false) {
        line[g.end ? 'p1' : 'p0'] = g.from;
        this.viewer.invalidate();
      }
      return;
    }
    if (g.kind === 'stitchMove') {
      this.setGesture(null);
      const w = this.viewer.pageToWorld(pageIndex, pt);
      this.options.onStitchDrag?.([w[0] - g.start[0], w[1] - g.start[1]], true);
      return;
    }
    if (g.kind === 'geoMove') {
      const o = this.geoOverlay;
      const from = this.geoLayer(g.pageIndex);
      if (o && from && (g.dx || g.dy)) {
        // Drawn where it was dropped until the panel places it there.
        const shifted = o.layers.map((l) => {
          const [dx, dy] = this.geoDragOn(l.pageIndex);
          const shift = (q: Point): Point => [q[0] + dx, q[1] + dy];
          return { ...l, paths: l.paths.map((path) => path.map(shift)), points: l.points.map(shift) };
        });
        const a = applyAffine(from.toWorld, g.start);
        const b = applyAffine(from.toWorld, [g.start[0] + g.dx, g.start[1] + g.dy]);
        this.geoOverlay = { ...o, layers: shifted };
        this.options.onGeoMoved?.(b[0] - a[0], b[1] - a[1]);
      }
      this.setGesture(null);
      this.viewer.invalidate();
      return;
    }
    if (g.kind === 'pendingHighlight') {
      const at = toPoint(pt);
      const m = g.markup;
      const last = m.points[m.points.length - 1]!;
      if (Math.hypot(at[0] - last[0], at[1] - last[1]) * this.viewer.zoomFor(this.page) >= 1.5) m.points = [...m.points, at];
      if (!this.resolvePendingHighlight(g, at)) this.setGesture({ kind: 'draw', markup: m });
      this.pointerUp(e, pt, pageIndex);
      return;
    }
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
    // Scale to Length goes click by click.
    if (g.kind === 'scaleRef') return;
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
        // The words stay highlighted; copying or marking them is the user's next step.
        if (g.markup.comment) {
          this.pickedText = g.markup;
          this.setState({ textSelection: { text: g.markup.comment, pageIndex: g.markup.pageIndex } });
        }
        return;
      }
      // Preferences › Markup › Copy Highlighted Text into Markup Comment (the words marked are kept otherwise).
      if (!settings.get().copyHighlightedText) g.markup.comment = undefined;
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
      if (m?.type === 'connector') {
        const next = this.connectorEndMoved(m, g.index, g.point);
        this.store.update(g.id, { points: next.points, connect: next.connect });
      } else if (m) this.store.update(g.id, { points: handleEdit(m, g.index, g.point) });
    } else if (g.kind === 'bend') {
      const m = this.store.get(g.id);
      if (m) this.store.update(g.id, { bulges: withBulge(m, g.segment, g.bulge) });
    } else if (g.kind === 'segment') {
      const m = this.store.get(g.id);
      if (m) this.setBends(m, moveSegment(g.route, g.mid, g.to, g.start));
    } else if (g.kind === 'rotate') {
      const m = this.store.get(g.id);
      if (m) this.store.update(g.id, { rotation: g.angle || undefined });
    } else if (g.kind === 'label' || g.kind === 'labelRotate') {
      const m = this.store.get(g.id);
      if (m) this.store.update(g.id, { style: labelStyled(m, g) });
    } else if (g.kind === 'tableLine') {
      const m = this.store.get(g.id);
      const table = m && moveTableLine(m, g.line, g.to);
      if (table) this.store.update(g.id, { table });
    }
    this.snapHit = null;
  }

  /** Double-click finishes a measurement, or edits the text box (or stamp's fields) under the pointer. */
  doubleClick(pt: PagePoint, pageIndex: number) {
    this.page = pageIndex;
    if (this.gesture?.kind === 'multi') {
      this.finish();
      return;
    }
    const hit = this.state.tool === 'select' ? this.hitAt(toPoint(pt)) : undefined;
    // Ctrl+double-click on a selected elbow connector (away from its text) adds a bend there; a plain one edits its text.
    if (hit && lastModifiers.ctrlKey && this.state.selected.has(hit.id) && this.reroutable(hit)) {
      const p = toPoint(pt);
      const label = connectorLabel(hit);
      const onLabel = label && Math.abs(p[0] - label.at[0]) <= label.size * Math.max(2, label.text.length * 0.35) && Math.abs(p[1] - label.at[1]) <= label.size;
      const bends = onLabel ? null : addBend(hit.points, p, this.hitPx / this.viewer.zoomFor(pageIndex));
      if (bends) {
        this.store?.checkpoint();
        this.setBends(hit, bends);
        return;
      }
    }
    if (hit && isTextType(hit.type) && !this.frozen(hit)) this.options.onEditText(hit.id);
    else if (hit?.type === 'note' || hit?.type === 'flag') this.options.onEditComment?.(hit.id);
    else if (hit?.type === 'attachment') this.options.onOpenAttachment?.(hit);
    else if ((hit?.type === 'dimension' || hit?.type === 'replaceText' || hit?.type === 'connector') && !this.frozen(hit)) this.options.onEditLabel?.(hit.id);
    else if (hit?.type === 'hyperlink' && !this.frozen(hit)) this.options.onEditHyperlink?.(hit.id);
    else if (hit?.type === 'stamp' && hit.stamp?.form && !this.frozen(hit)) this.options.onEditStamp?.(hit.id);
    else if (hit?.type === 'table' && !this.frozen(hit)) {
      const cell = tableCellAt(hit, toPoint(pt));
      if (cell) {
        this.setState({ selected: new Set([hit.id]), tableCells: { id: hit.id, anchor: cell, focus: cell } });
        this.options.onEditTableCell?.(hit.id, cell.row, cell.col);
      }
    }
  }

  /**
   * Places a table drawn with the Table tool once its size is chosen. A click (no drag) gives each
   * cell a comfortable on-screen size; a dragged box is divided into equal cells.
   */
  addTable(draft: TableDraft, rows: number, cols: number): Markup | null {
    const store = this.store;
    if (!store || store.readOnly) return null;
    const table = newTable(rows, cols);
    const m: Markup = { ...draft.markup, table };
    if (draft.tiny) {
      const a = m.points[0]!;
      m.points = [a, [a[0] + (table.cols.length * TABLE_CELL_PX.w) / draft.zoom, a[1] + (table.rows.length * TABLE_CELL_PX.h) / draft.zoom]];
    }
    store.add(m);
    this.options.onCreated?.(m);
    this.setState({ tool: 'select', selected: new Set([m.id]) });
    return m;
  }

  /** Pan and Select Text act as Select over a markup, so one can always be picked up. */
  private selectsHere(pageIndex: number, pt: PagePoint): boolean {
    const { tool } = this.state;
    if (tool !== 'pan' && tool !== 'selectText') return false;
    const prev = this.page;
    this.page = pageIndex;
    const hit = !!this.hitAt(toPoint(pt));
    this.page = prev;
    return hit;
  }

  hitsMarkup(pt: PagePoint, pageIndex: number): boolean {
    return this.selectsHere(pageIndex, pt);
  }

  hover(pt: PagePoint | null, pageIndex: number): string | null {
    this.page = pageIndex;
    const tool = pt && this.selectsHere(pageIndex, pt) ? 'select' : this.state.tool;
    if (!pt) {
      this.hidePopup();
      this.snapHit = null;
      this.ghost = null;
      this.pickIds = [];
      this.connectHover = null;
      if (this.gesture?.kind === 'multi') this.gesture.hover = null;
      this.viewer.invalidate();
      return null;
    }
    const geo = this.geoOverlay;
    if (geo && geo.mode !== 'none' && this.geoLayer(pageIndex)) {
      if (geo.mode === 'move') return this.gesture?.kind === 'geoMove' ? 'grabbing' : 'move';
      if (geo.mode === 'pickPage') {
        this.resolve(pt, lastModifiers, null);
        this.viewer.invalidate();
      }
      return 'crosshair';
    }
    this.updatePickTargets(pageIndex, toPoint(pt));
    if (tool === 'stitchMove') return this.viewer.isStitched ? 'move' : 'not-allowed';
    if ((tool === 'select' || tool === 'matchLine') && this.gesture?.kind !== 'multi' && this.guideEndAt(toPoint(pt), pageIndex)) return 'grab';
    if (tool === 'painter') return this.hitAt(toPoint(pt)) ? 'copy' : 'not-allowed';
    if (isCadTool(tool) && this.cad) {
      if (this.cad.pageIndex !== pageIndex && this.cad.picks.length) return 'not-allowed';
      this.cad.pageIndex = pageIndex;
      this.cad.shift = lastModifiers.shiftKey;
      this.cad.hover = this.cadPoint(tool, pt, lastModifiers);
      this.viewer.invalidate();
      return this.pickIds.length ? 'pointer' : 'crosshair';
    }
    if (tool === 'offset' && !this.state.painterSource) {
      const hit = this.hitAt(toPoint(pt));
      return hit && canOffset(hit) ? 'pointer' : 'default';
    }
    if (tool === 'eraser' || tool === 'offset') {
      this.ghost = { pageIndex, at: toPoint(pt) };
      this.viewer.invalidate();
      return tool === 'eraser' ? 'none' : 'crosshair';
    }
    if (tool === 'editText') return 'text';
    if (tool === 'highlighter') return !lastModifiers.ctrlKey && this.overText(pageIndex, toPoint(pt)) ? 'text' : 'crosshair';
    if (tool === 'selectText') return 'text';
    if (isMarkupTool(tool) && TYPE_INFO[tool].draw === 'text') {
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
      const hyper = hit?.link && !this.state.selected.has(hit.id) ? hit : null;
      this.hoverPopup(hit && !this.gesture && hit.comment?.trim() ? hit.id : null);
      const hovered = link?.id ?? hyper?.id ?? null;
      if (this.snapHit || hovered !== this.hoveredLink) {
        this.snapHit = null;
        this.hoveredLink = hovered;
        this.viewer.invalidate();
      }
      if (hit?.type === 'table' && this.state.selected.size === 1 && this.state.selected.has(hit.id) && !this.frozen(hit) && !this.store?.readOnly) {
        const line = this.gesture?.kind === 'tableLine' ? this.gesture.line : tableLineAt(hit, p, this.hitPx / this.viewer.zoomFor(pageIndex));
        if (line) return line.axis === 'col' ? 'col-resize' : 'row-resize';
        return 'cell';
      }
      // A markup shows the pick cursor; an already selected one shows move, as a drag will move it.
      return link || hyper ? 'pointer' : hit ? (this.state.selected.has(hit.id) ? 'move' : 'pointer') : 'default';
    }
    if (this.state.preset?.template) {
      this.ghost = { pageIndex, at: toPoint(pt) };
      this.viewer.invalidate();
      return 'copy';
    }
    if (tool === 'connector') {
      // The shape under the pointer shows where a connector can glue to it.
      this.connectHover = { pageIndex, at: toPoint(pt) };
      this.viewer.invalidate();
      return 'crosshair';
    }
    // Preview the snap target before the first click, and rubber-band between clicks.
    const g = this.gesture;
    const mods = lastModifiers;
    const anchor = this.sketchAnchor;
    if (g?.kind === 'multi') g.hover = this.resolve(pt, mods, g.markup.points.at(-1)!);
    else if (g?.kind === 'scaleRef') {
      if (g.stage !== 'ask' && g.pageIndex === pageIndex) g.hover = this.resolve(pt, mods, (g.stage === 'ref' ? g.ref[0] : g.target[0]) ?? null);
    } else if (tool === 'scaleLength') {
      // Before the first point: pointing at a markup picks it when nothing is selected.
      if (!this.scaleTargets(pageIndex).length) {
        this.snapHit = null;
        this.viewer.invalidate();
        return this.hitAt(toPoint(pt)) ? 'pointer' : 'crosshair';
      }
      this.resolve(pt, mods, null);
    } else if (anchor && anchor.pageIndex === pageIndex) anchor.hover = this.resolve(pt, mods, anchor.at);
    else if (tool === 'calibrate' || tool === 'matchLine' || tool === 'stitchPolygon' || (isMarkupTool(tool) && snapsWhileDrawing(tool))) this.resolve(pt, mods, null);
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
    // Fillable fields in Preferences › Forms › Highlight Colour and Opacity; read-only ones faintly grey.
    const { formHighlightColour, formHighlightOpacity } = settings.get();
    ctx.save();
    for (const w of list) {
      ctx.fillStyle = w.readOnly ? 'rgba(100, 116, 139, 0.08)' : formHighlightColour;
      ctx.globalAlpha = w.readOnly ? 1 : formHighlightOpacity / 100;
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
    if (preset?.stamp) style.stroke = stampColor(preset.stamp);
    if (type === 'cloud' || type === 'polygonCloud') style.arcRadius ??= CLOUD_ARC_PX / zoom;
    if (type === 'legend' || type === 'table') style.fontSize ??= LABEL_PX / zoom;
    if (type === 'space') style.fontSize ??= (LABEL_PX * 1.4) / zoom;
    if (isMeasureKind(type)) {
      style.arcRadius ??= MARKER_PX / zoom;
      style.fontSize ??= LABEL_PX / zoom;
    }
    const now = Date.now();
    const fields = this.options.defaultFields?.();
    const drawnDefaults = isMeasureKind(type) && !preset?.template ? this.options.measureDefaults?.() : undefined;
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
      ...(preset?.subject ? { subject: preset.subject } : drawnDefaults?.subject ? { subject: drawnDefaults.subject } : preset?.stamp ? { subject: preset.stamp.name } : {}),
      ...(drawnDefaults?.label ? { text: drawnDefaults.label } : {}),
      ...(drawnDefaults?.assemblyId && type !== 'angle' ? { assemblyId: drawnDefaults.assemblyId } : {}),
      ...(preset?.image ? { image: preset.image } : {}),
      ...(preset?.attachment ? { attachment: preset.attachment } : {}),
      ...(preset?.signature ? { signature: preset.signature } : {}),
      ...(preset?.stamp ? { stamp: resolveStamp(preset.stamp, { user: this.options.author(), now: new Date(now), ...(this.options.stampValues?.(pageIndex) ?? { file: '', page: String(pageIndex + 1) }) }) } : {}),
      ...(fields && Object.keys(fields).length ? { fields } : {}),
      ...(type === 'flowShape' ? { flowShape: this.state.flowShape } : {}),
      ...(type === 'connector' ? { connect: { route: this.state.connectorRoute } } : {}),
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
  /** The selected markups Scale to Length works on, on a page. */
  private scaleTargets(pageIndex: number): Markup[] {
    return this.editable().filter((m) => m.pageIndex === pageIndex && !this.frozen(m));
  }

  /** A Scale to Length click: picks the markup, then the reference points, then the new length's points. */
  private scaleClick(pt: PagePoint, e: Modifiers, pageIndex: number) {
    const g = this.gesture;
    if (g?.kind !== 'scaleRef') {
      const targets = this.scaleTargets(pageIndex);
      if (!targets.length) {
        // Nothing selected: the click picks what to scale.
        const hit = this.hitAt(toPoint(pt));
        if (hit && !this.frozen(hit)) this.setState({ selected: new Set(hit.groupId ? this.pageMarkups(pageIndex).filter((m) => m.groupId === hit.groupId).map((m) => m.id) : [hit.id]) });
        return;
      }
      const p = this.resolve(pt, e, null);
      this.setGesture({ kind: 'scaleRef', ids: targets.map((m) => m.id), pageIndex, ref: [p], target: [], stage: 'ref', hover: p });
      return;
    }
    if (g.pageIndex !== pageIndex || g.stage === 'ask') return;
    const from = (g.stage === 'ref' ? g.ref[0] : g.target[0]) ?? null;
    const p = this.resolve(pt, e, from);
    const zoom = this.viewer.zoomFor(pageIndex);
    // The two points of a length must be apart.
    if (from && Math.hypot(p[0] - from[0], p[1] - from[1]) * zoom < 2) return;
    this.clearTracking();
    if (g.stage === 'ref') {
      g.ref.push(p);
      g.stage = 'ask';
      g.hover = null;
      this.viewer.invalidate();
      this.options.onScaleToLength?.(pageIndex, [g.ref[0]!, g.ref[1]!]);
      return;
    }
    g.target.push(p);
    if (g.target.length === 2) this.scaleSelectionBy(scaleFactor(g)!);
    else this.viewer.invalidate();
  }

  /** Scale to Length: grows the markups by `factor` about the first reference point, as one undo step. */
  scaleSelectionBy(factor: number) {
    const g = this.gesture;
    if (g?.kind !== 'scaleRef' || !this.store || !Number.isFinite(factor) || factor <= 0) return;
    const store = this.store;
    const base = g.ref[0]!;
    store.checkpoint();
    store.batch(() => {
      for (const id of g.ids) {
        const m = store.get(id);
        if (m && !this.frozen(m)) store.update(id, scaledAbout(m, base, factor));
      }
    });
    this.setGesture(null);
    this.setState({ tool: 'select', selected: new Set(g.ids) });
  }

  /** Scale to Length: the new length is to be picked as two points on the page rather than typed. */
  pickScaleTarget() {
    const g = this.gesture;
    if (g?.kind !== 'scaleRef' || g.stage !== 'ask') return;
    g.stage = 'target';
    this.viewer.invalidate();
  }

  private resolve(pt: PagePoint, mods: Modifiers, anchor: Point | null, excludeId?: string): Point {
    const p = toPoint(pt);
    this.snapHit = null;
    this.snapIsGrid = false;
    this.tracked = null;
    if (mods.shiftKey && anchor) return constrain('line', anchor, p);
    const prefs = settings.get();
    const tracks = prefs.objectSnapTracking || prefs.polarTracking || prefs.snapExtension || prefs.snapParallel;
    if (mods.altKey || (!this.state.snap && !prefs.snapToGrid && !prefs.snapToMarkup && !tracks)) {
      this.rest(null);
      return p;
    }
    // Perpendicular, tangent, polar and parallel are taken from the point the shape is drawn from.
    const from = anchor ?? this.drawnFrom();
    // In a stitched view the pointer can be over a neighbouring sheet: snap to that sheet's
    // geometry, then map the result back into the gesture's page.
    const under = this.viewer.pageUnder(this.page, p) ?? this.page;
    const hit = this.snapOnPage(under, this.viewer.mapPoint(this.page, under, p), excludeId, from && this.viewer.mapPoint(this.page, under, from));
    if (hit) {
      const back = this.viewer.mapPoint(under, this.page, hit.point);
      this.snapHit = { ...hit, point: [back[0], back[1]] };
      this.snapPage = this.page;
      this.rest(this.snapHit);
      return [back[0], back[1]];
    }
    this.rest(null);
    const tracked = tracks ? this.trackAt(p, from, excludeId) : null;
    if (tracked) {
      this.tracked = tracked;
      this.snapPage = this.page;
      return tracked.point;
    }
    if (!prefs.snapToGrid) return p;
    // No drawing geometry nearby: the nearest grid point.
    const g = gridSpacingPoints(prefs);
    const q: Point = [Math.round(p[0] / g) * g, Math.round(p[1] / g) * g];
    this.snapHit = { point: q, kind: 'endpoint' };
    this.snapIsGrid = true;
    this.snapPage = this.page;
    return q;
  }

  /** The point the shape being drawn starts from (its last point), if any. */
  private drawnFrom(): Point | null {
    const g = this.gesture;
    if (g?.kind === 'multi') return g.markup.points.at(-1) ?? null;
    if (g?.kind === 'draw' && TYPE_INFO[g.markup.type].draw === 'drag') return g.markup.points[0] ?? null;
    return this.sketchAnchor?.pageIndex === this.page ? this.sketchAnchor.at : null;
  }

  /** Lets go of the points and directions tracking had picked up. */
  private clearTracking() {
    if (this.dwell) clearTimeout(this.dwell.timer);
    this.dwell = null;
    this.tracked = null;
    if (this.tracking.points.length || this.tracking.parallels.length) this.viewer.invalidate();
    this.tracking = { page: -1, points: [], parallels: [] };
  }

  /**
   * The pointer is resting on `hit` (or on nothing): after a moment there, the point is picked up
   * for tracking (or put down again if it already was), as AutoCAD does. Resting on a line picks
   * up its direction for parallel tracking.
   */
  private rest(hit: Snap | null) {
    const prefs = settings.get();
    const point = !!hit && hit.kind !== 'nearest' && (prefs.objectSnapTracking || (prefs.snapExtension && !!hit.dir));
    const parallel = hit?.kind === 'nearest' && !!hit.dir && prefs.snapParallel;
    const key = hit && (point || parallel) ? `${this.page}:${hit.kind}:${hit.point[0].toFixed(2)},${hit.point[1].toFixed(2)}` : null;
    if (key === (this.dwell?.key ?? null)) return;
    if (this.dwell) clearTimeout(this.dwell.timer);
    this.dwell = null;
    if (!key || !hit) return;
    const page = this.page;
    const timer = setTimeout(() => {
      this.dwell = null;
      if (this.tracking.page !== page) this.tracking = { page, points: [], parallels: [] };
      const t = this.tracking;
      const at: Point = [hit.point[0], hit.point[1]];
      const dir = hit.dir;
      if (parallel && dir) {
        // A line already picked up is put down; at most two directions are kept.
        const same = t.parallels.findIndex((q) => Math.abs(q.dir[0] * dir[1] - q.dir[1] * dir[0]) < 1e-6);
        if (same >= 0) t.parallels.splice(same, 1);
        else t.parallels = [...t.parallels, { at, dir }].slice(-2);
      } else {
        const same = t.points.findIndex((q) => Math.hypot(q.point[0] - at[0], q.point[1] - at[1]) < 1e-6);
        if (same >= 0) t.points.splice(same, 1);
        // AutoCAD keeps the last seven.
        else t.points = [...t.points, { point: at, ...(dir ? { extensions: [dir] } : {}) }].slice(-7);
      }
      this.viewer.invalidate();
    }, ACQUIRE_MS);
    this.dwell = { key, timer };
  }

  /** Where tracking lines the pointer up, from the picked-up points and the point drawn from. */
  private trackAt(p: Point, from: Point | null, excludeId?: string): Tracked | null {
    const prefs = settings.get();
    const t = this.tracking.page === this.page ? this.tracking : { points: [], parallels: [] };
    const radius = snapPx() / this.viewer.zoomFor(this.page);
    const index = this.state.snap ? this.snapIndexFor(this.page) : null;
    // Paths stop where they cross the drawing's lines or the markups' outlines.
    const lines = [...(index?.linesNear(p, radius, prefs.snapCurves) ?? []), ...(prefs.snapToMarkup ? this.outlines(this.page, excludeId) : [])];
    return track(
      p,
      radius,
      {
        acquired: t.points,
        from,
        objectTracking: prefs.objectSnapTracking,
        polarStep: prefs.polarTracking ? prefs.polarAngle : null,
        polarForObjects: prefs.polarForObjects,
        extensions: prefs.snapExtension,
        parallels: prefs.snapParallel ? t.parallels.map((q) => q.dir) : [],
      },
      lines,
    );
  }

  /** Other markups' outlines on a page as flat snap lines (turned with any rotation). */
  private outlines(pageIndex: number, excludeId?: string): number[] {
    const out: number[] = [];
    for (const m of this.pageMarkups(pageIndex)) {
      if (m.id === excludeId || !snapTarget(m.type)) continue;
      let lines = this.outlineCache.get(m);
      if (!lines) {
        lines = markupSegments(m);
        if (m.rotation) {
          const c = rotationCentre(m);
          for (let i = 0; i + 1 < lines.length; i += 2) [lines[i], lines[i + 1]] = rotatePoint([lines[i]!, lines[i + 1]!], c, m.rotation);
        }
        this.outlineCache.set(m, lines);
      }
      for (const v of lines) out.push(v);
    }
    return out;
  }

  private snapOnPage(pageIndex: number, p: Point, excludeId?: string, from?: Point | null): Snap | null {
    const prefs = settings.get();
    const index = (this.state.snap ? this.snapIndexFor(pageIndex) : null) ?? NO_LINES;
    const extra: (Point | Snap)[] = [];
    if (prefs.snapToMarkup) {
      const off = new Set<SnapKind>();
      if (!prefs.snapCenters) off.add('center');
      if (!prefs.snapQuadrants) off.add('quadrant');
      if (!prefs.snapGeoCenters) off.add('geocenter');
      for (const m of this.pageMarkups(pageIndex)) {
        if (m.id === excludeId || !snapTarget(m.type)) continue;
        for (const q of markupSnapPoints(m)) if (!off.has(q.kind)) extra.push(q);
      }
    }
    const g = this.gesture;
    // Earlier vertices of the measurement in progress (in its own page's space), so a polygon can
    // close on its start.
    if (g?.kind === 'multi') for (const q of g.markup.points) extra.push(this.viewer.mapPoint(g.markup.pageIndex, pageIndex, q));
    const radius = snapPx() / this.viewer.zoomFor(pageIndex);
    // Markup outlines are snapped onto and crossed (nearest, perpendicular), not at their own ends.
    const lines = prefs.snapToMarkup ? this.outlines(pageIndex, excludeId) : undefined;
    return index.snap(p, radius, extra, snapKinds(), prefs.snapCurves, { from, lines });
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
      } else if (this.state.tool === 'teachMark') {
        this.options.onTeachMark?.(m.pageIndex, b);
        this.setState({ tool: 'select' });
      } else if (this.state.tool === 'viewport') {
        this.options.onViewport?.(m.pageIndex, b);
        this.setState({ tool: 'select' });
      } else if (this.state.tool === 'snapshot') {
        this.options.onSnapshot?.(m.pageIndex, b);
        this.setState({ tool: 'select' });
      } else if (this.state.tool === 'stitchRegion') {
        // The tool stays on, for the next sheet.
        this.options.onStitchRegion?.(m.pageIndex, [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]]);
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
    } else if (m.type === 'table') {
      // The rows and columns are asked for first; the table is placed once they are chosen.
      const draft = { markup: m, tiny, zoom };
      if (this.options.onNewTable) this.options.onNewTable(draft);
      else this.addTable(draft, 3, 3);
      return;
    } else if (m.type === 'legend' && tiny) {
      m.points = [a, [a[0] + LEGEND_PX.w / zoom, a[1] + LEGEND_PX.h / zoom]];
    } else if (m.type === 'flowShape' && tiny) {
      // A click places the shape at its usual size, centred on the click.
      const [w, h] = FLOW_SHAPES.find((s) => s.kind === m.flowShape)?.size ?? [120, 60];
      m.points = [[a[0] - w / 2, a[1] - h / 2], [a[0] + w / 2, a[1] + h / 2]];
    } else if (m.type === 'connector') {
      this.connectStart = null;
      this.connectHover = null;
      // A click is not a connector; drag from one shape to another.
      if (tiny) return;
    } else if (m.type === 'flagLabel' && tiny) {
      // The flag's point is at the click; the label's text sits right of it.
      m.points = [a, [a[0] + FLAG_LABEL_PX.w / zoom, a[1] + FLAG_LABEL_PX.h / zoom]];
      m.text ||= 'FLAG';
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
        this.sketchAnchor = { type: m.type, pageIndex: m.pageIndex, at: a, markup: m };
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
    const callout = this.cloudCalloutPair(cloud);
    this.options.onCreated?.(cloud);
    this.setState({ tool: 'select', selected: new Set([cloud.id, callout.id]) });
    this.options.onEditText(callout.id);
  }

  /** Adds `cloud` and its callout to the drawing as one group, and returns the callout. */
  private cloudCalloutPair(cloud: Markup): Markup {
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
    return callout;
  }

  /** Cloud+ for the assistant: a cloud over two corners with a callout from its top-right, as one undo step. `text` goes on the callout. */
  placeCloudPlus(pageIndex: number, points: Point[], extras?: { text?: string; comment?: string; subject?: string }): { cloud: Markup; callout: Markup } {
    const store = this.store;
    if (!store) throw new Error('No document is open.');
    if (store.readOnly) throw new Error('This drawing is read-only.');
    const cloud = this.newMarkup('cloud', pageIndex, points);
    if (extras?.comment) cloud.comment = extras.comment;
    if (extras?.subject) cloud.subject = extras.subject;
    store.checkpoint();
    const callout = this.cloudCalloutPair(cloud);
    if (extras?.text) store.update(callout.id, { text: extras.text });
    this.options.onCreated?.(cloud);
    this.select([cloud.id, callout.id]);
    return { cloud: store.get(cloud.id) ?? cloud, callout: store.get(callout.id) ?? callout };
  }

  /** A page's markups in drawing order: Spaces underneath everything, then oldest first. */
  private pageMarkups(pageIndex: number): Markup[] {
    if (!this.store) return [];
    return this.shownMarkups(this.store.forPage(pageIndex));
  }

  /** The markups of `markups` the drawing shows, in drawing order (as pageMarkups). Page thumbnails use it too. */
  shownMarkups(markups: readonly Markup[]): Markup[] {
    const showSpaces = settings.get().showSpaces;
    return markups
      .filter((m) => !m.hidden && !this.hiddenLayers.has(m.layer ?? '') && (showSpaces || m.type !== 'space') && (this.filterMode !== 'hide' || !this.filteredOut?.(m)))
      .sort((a, b) => Number(b.type === 'space') - Number(a.type === 'space') || a.createdAt - b.createdAt);
  }

  /** Topmost markup under `p` on the current page. */
  /**
   * The markups under `p` that the tool in use would pick with its next click: the line a Modify
   * step asks for, the shape Offset copies, what Scale to Length or the Format Painter takes.
   */
  private pickTargetsAt(pageIndex: number, p: Point): Markup[] {
    const { tool, painterSource } = this.state;
    if (!this.store || this.gesture) return [];
    if (tool !== 'offset' && tool !== 'painter' && tool !== 'scaleLength' && !isCadTool(tool)) return [];
    if (isCadTool(tool)) return this.cad ? cadPickTarget(tool, this.cad.picks, p, this.cadContext(pageIndex, lastModifiers.shiftKey)) : [];
    const ctx = this.cadContext(pageIndex, false);
    const hit = ctx.hit(p);
    if (!hit) return [];
    if (tool === 'offset') return !painterSource && canOffset(hit) ? [hit] : [];
    if (tool === 'painter') return painterSource && hit.id !== painterSource.id && !this.frozen(hit) ? [hit] : [];
    if (tool === 'scaleLength' && !this.scaleTargets(pageIndex).length && !this.frozen(hit)) {
      const ids = new Set(ctx.group(hit));
      return ctx.page.filter((m) => ids.has(m.id));
    }
    return [];
  }

  /** Follows the pointer: highlights what the next click would pick, redrawing only when that changes. */
  private updatePickTargets(pageIndex: number, p: Point) {
    const ids = this.pickTargetsAt(pageIndex, p).map((m) => m.id);
    if (ids.length === this.pickIds.length && ids.every((id, i) => id === this.pickIds[i])) return;
    this.pickIds = ids;
    this.viewer.invalidate();
  }

  /** The highlight on the markups the next click would pick. */
  private drawPickTargets(ctx: CanvasRenderingContext2D, pageIndex: number, zoom: number) {
    for (const id of this.pickIds) {
      const m = this.store?.get(id);
      if (m && m.pageIndex === pageIndex) drawPickHighlight(ctx, m, zoom);
    }
  }

  /** What the page gives a CAD Modify tool to work with. */
  private cadContext(pageIndex: number, shift: boolean): CadContext {
    const store = this.store!;
    const page = this.pageMarkups(pageIndex);
    const now = Date.now();
    return {
      page,
      selected: this.editable().filter((m) => m.pageIndex === pageIndex),
      hit: (p) => this.pageMarkups(pageIndex).reverse().find((m) => hitTest(m, p, this.hitPx / this.viewer.zoomFor(pageIndex))),
      frozen: (m) => this.frozen(m),
      group: (m) => (m.groupId ? page.filter((x) => x.groupId === m.groupId).map((x) => x.id) : [m.id]),
      length: (text, m) => {
        const scale = m ? store.scaleOf(m) : store.scaleFor(pageIndex);
        const v = text.trim() ? parseLength(text, scale.unit) : null;
        return v === null ? null : (v * METERS_PER_UNIT[scale.unit]) / scale.metersPerPoint;
      },
      create: (type, points, like) => {
        const m = this.newMarkup(type, pageIndex, points);
        if (like) {
          m.style = { ...m.style, stroke: like.style.stroke, width: like.style.width, opacity: like.style.opacity, dash: like.style.dash };
          if (like.layer) m.layer = like.layer;
        }
        return m;
      },
      clone: (m, patch) => ({
        ...structuredClone(m),
        ...patch,
        id: crypto.randomUUID(),
        seq: undefined,
        groupId: patch.groupId,
        locked: undefined,
        pdfAnnot: undefined,
        replies: undefined,
        status: 'none',
        statusHistory: undefined,
        author: this.options.author(),
        createdAt: now,
        modifiedAt: now,
      }),
      shift,
    };
  }

  /** Where a CAD tool's click lands: snapped for tools that pick points, as is for those that pick a markup. */
  private cadPoint(tool: CadTool, pt: PagePoint, mods: Modifiers): Point {
    const c = this.cad;
    const picks = c?.picks ?? [];
    const onPoints = tool === 'stretch' || (tool === 'break' && picks.length > 0) || (CAD_POINT_TOOLS.has(tool) && this.editable().some((m) => m.pageIndex === this.page));
    if (!onPoints) {
      this.snapHit = null;
      return toPoint(pt);
    }
    return this.resolve(pt, mods, picks.at(-1)?.at ?? null);
  }

  /** A click with a CAD Modify tool: the next pick, a markup picked, or the edit made as one undo step. */
  private cadClickAt(tool: CadTool, pt: PagePoint, e: Modifiers, pageIndex: number) {
    const store = this.store!;
    let c = this.cad;
    if (!c || c.tool !== tool) c = this.cad = { tool, pageIndex, picks: [], hover: null, shift: false };
    if (c.pageIndex !== pageIndex) {
      c.picks = [];
      c.pageIndex = pageIndex;
    }
    c.shift = e.shiftKey;
    // What was under the pointer is picked (or not) now; the next move finds the next target.
    this.pickIds = [];
    const p = this.cadPoint(tool, pt, e);
    const r = cadClick(tool, c.picks, p, this.cadContext(pageIndex, e.shiftKey));
    if ('error' in r) {
      this.setState({ cad: { picks: c.picks.length, error: r.error } });
      return;
    }
    if ('done' in r) {
      const { update, add, remove } = r.done;
      store.checkpoint();
      store.batch(() => {
        if (remove.length) store.remove(remove);
        for (const [id, patch] of update) store.update(id, patch);
        for (const m of add) store.add(m);
      });
      c.picks = r.picks ?? [];
      // The step is done: its snap marker and tracking lines go until the pointer moves again.
      this.snapHit = null;
      this.clearTracking();
      const selected = new Set(r.select.filter((id) => store.get(id)));
      if (r.again) this.setState({ selected, cad: { picks: c.picks.length, error: null } });
      else {
        this.cad = null;
        this.setState({ tool: 'select', selected, cad: null });
        this.viewer.refreshPointerCursor();
      }
      return;
    }
    if ('select' in r) {
      this.setState({ selected: new Set(r.select), cad: { picks: c.picks.length, error: null } });
      return;
    }
    c.picks = r.picks;
    this.setState({ cad: { picks: c.picks.length, error: null } });
  }

  /**
   * Join: the selected lines and paths whose ends meet become one polyline (a polygon when they
   * close), or a Polylength / Perimeter when they are all lengths. One undo step; false if none met.
   */
  joinSelected(): boolean {
    const store = this.store;
    if (!store || store.readOnly) return false;
    const pages = new Map<number, Markup[]>();
    for (const m of this.editable().filter(canJoin)) pages.set(m.pageIndex, [...(pages.get(m.pageIndex) ?? []), m]);
    const update: [string, Partial<Markup>][] = [];
    const remove: string[] = [];
    for (const [pageIndex, ms] of pages) {
      const tol = JOIN_PX / this.viewer.zoomFor(pageIndex);
      for (const chain of joinPaths(ms.map((m) => ({ points: m.points, bulges: m.bulges })), tol)) {
        if (chain.members.length < 2) continue;
        const parts = chain.members.map((i) => ms[i]!);
        const lengths = parts.every((m) => m.type === 'length' || m.type === 'polylength');
        const type: MarkupType = lengths ? (chain.closed ? 'perimeter' : 'polylength') : chain.closed ? 'polygon' : 'polyline';
        const curved = chain.bulges.some(Boolean);
        // Only measurements keep curves; plain paths trace them.
        const points = curved && !lengths ? expandArcs(chain.points, chain.bulges, chain.closed).map(([x, y]) => [x, y] as Point) : chain.points;
        if (curved && !lengths && chain.closed && points.length > 1) {
          const [f, l] = [points[0]!, points.at(-1)!];
          if (f[0] === l[0] && f[1] === l[1]) points.pop();
        }
        update.push([parts[0]!.id, { type, points, bulges: curved && lengths ? chain.bulges : undefined }]);
        remove.push(...parts.slice(1).map((m) => m.id));
      }
    }
    if (!update.length) return false;
    store.checkpoint();
    store.batch(() => {
      store.remove(remove);
      for (const [id, patch] of update) store.update(id, patch);
    });
    this.setState({ selected: new Set(update.map(([id]) => id)) });
    return true;
  }

  /**
   * Explode: the selected polylines, polygons, rectangles and path measurements become one line per
   * segment (an Arc where a segment curves; a Length for measurements). One undo step.
   */
  explodeSelected(): boolean {
    const store = this.store;
    if (!store || store.readOnly) return false;
    const targets = this.editable().filter(canExplode);
    if (!targets.length) return false;
    const add: Markup[] = [];
    for (const m of targets) {
      const ctx = this.cadContext(m.pageIndex, false);
      const measure = isMeasureKind(m.type);
      for (const seg of explodeSegments(m)) {
        const curved = !!seg.bulge;
        const type: MarkupType = curved ? 'arc' : measure ? 'length' : 'line';
        const points = curved ? [seg.a, bulgeMidpoint(seg.a, seg.b, seg.bulge), seg.b] : [seg.a, seg.b];
        const piece = ctx.clone(m, { type, points, bulges: undefined, holes: undefined, holeBulges: undefined, rotation: undefined, depth: undefined, ...(measure ? { text: undefined } : {}) });
        if (curved) piece.style = { ...DEFAULT_STYLES.arc, stroke: m.style.stroke, width: m.style.width, opacity: m.style.opacity, dash: m.style.dash };
        add.push(piece);
      }
    }
    store.checkpoint();
    store.batch(() => {
      store.remove(targets.map((m) => m.id));
      for (const m of add) store.add(m);
    });
    this.setState({ selected: new Set(add.map((m) => m.id)) });
    return true;
  }

  /**
   * Select Similar: adds every markup on the selection's pages that is like one selected (same
   * type, subject, line colour and layer). Returns how many are selected now.
   */
  selectSimilar(): number {
    const store = this.store;
    if (!store) return 0;
    const key = (m: Markup) => [m.type, m.subject ?? '', m.style.stroke.toLowerCase(), m.layer ?? ''].join('\u0000');
    const picked = [...this.state.selected].map((id) => store.get(id)).filter((m): m is Markup => !!m);
    if (!picked.length) return 0;
    const keys = new Set(picked.map(key));
    const pages = new Set(picked.map((m) => m.pageIndex));
    const ids = [...pages].flatMap((p) => this.pageMarkups(p).filter((m) => keys.has(key(m))).map((m) => m.id));
    this.setState({ selected: new Set([...this.state.selected, ...ids]) });
    return this.state.selected.size;
  }

  /**
   * Convert to Cloud (AutoCAD's Revcloud › Object): the selected polygons become polygon clouds and
   * rectangles box clouds, keeping their outline, look and comments. One undo step.
   */
  convertToCloud(): boolean {
    const store = this.store;
    if (!store || store.readOnly) return false;
    const targets = this.editable().filter(canCloud);
    if (!targets.length) return false;
    store.checkpoint();
    store.batch(() => {
      for (const m of targets) {
        const arcRadius = m.style.arcRadius ?? CLOUD_ARC_PX / this.viewer.zoomFor(m.pageIndex);
        store.update(m.id, { type: m.type === 'rect' ? 'cloud' : 'polygonCloud', style: { ...m.style, arcRadius } });
      }
    });
    return true;
  }

  /** Reverse: the selected lines and paths run the other way, swapping their end styles. One undo step. */
  reverseSelected(): boolean {
    const store = this.store;
    if (!store || store.readOnly) return false;
    const targets = this.editable().filter(canReverse);
    if (!targets.length) return false;
    store.checkpoint();
    store.batch(() => {
      for (const m of targets) store.update(m.id, reversedMarkup(m));
    });
    return true;
  }

  /** What the next click with the CAD tool in use does, for its tool bar. */
  cadPromptText(): string | null {
    const c = this.cad;
    if (!c || c.tool !== this.state.tool) return null;
    return cadPrompt(c.tool, c.picks, { selected: this.editable().filter((m) => m.pageIndex === c.pageIndex), shift: c.shift });
  }

  /** The CAD tool's preview: the markups as the next click would leave them, its guide lines and the points picked. */
  private drawCad(ctx: CanvasRenderingContext2D, pageIndex: number, zoom: number) {
    const c = this.cad;
    if (!c || c.pageIndex !== pageIndex || !this.store || c.tool !== this.state.tool) return;
    if (c.hover) {
      const { ghosts, guides, removed } = cadPreview(c.tool, c.picks, c.hover, this.cadContext(pageIndex, c.shift));
      ctx.save();
      ctx.globalAlpha = 0.6;
      // At least 2 px wide so the preview reads at any zoom.
      for (const m of ghosts) drawMarkup(ctx, { ...m, style: { ...m.style, stroke: CAD_PREVIEW, width: Math.max(m.style.width, 2 / zoom) } }, zoom, this.store.scaleOf(m));
      ctx.restore();
      // Trim: the section that goes, over what stays.
      if (removed.length) {
        ctx.save();
        ctx.strokeStyle = '#dc2626';
        ctx.lineWidth = 4 / zoom;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        for (const path of removed) {
          ctx.beginPath();
          path.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
          ctx.stroke();
        }
        ctx.restore();
      }
      for (const g of guides) drawGuide(ctx, g, zoom);
    }
    for (const pick of c.picks) drawPickMark(ctx, pick.at, zoom);
  }

  /**
   * Offset: the copies a click at `p` makes. The pointer's side picks the direction; the distance is
   * the one typed (in the markup's scale) or, with none, through the pointer.
   */
  private offsetCopiesAt(source: Markup, p: Point): Point[][] {
    const through = offsetDistance(source, p);
    const { offsetDistance: typed, offsetCount } = settings.get();
    const scale = this.store?.scaleOf(source);
    const value = typed.trim() && scale ? parseLength(typed, scale.unit) : null;
    const d = value !== null && value > 0 ? ((value * METERS_PER_UNIT[scale!.unit]) / scale!.metersPerPoint) * (through < 0 ? -1 : 1) : through;
    if (!d) return [];
    return offsetCopies(source, d, Math.min(100, Math.max(1, offsetCount || 1)));
  }

  private hitAt(p: Point): Markup | undefined {
    const tol = this.hitPx / this.viewer.zoomFor(this.page);
    return this.pageMarkups(this.page)
      .reverse()
      .find((m) => hitTest(m, p, tol));
  }

  /** The markup as it should appear mid-gesture; connectors follow their shapes as those move. */
  private previewOf(m: Markup): Markup {
    const own = this.ownPreview(m);
    const g = this.gesture;
    if (m.type !== 'connector' || !m.connect || !g || !['move', 'handle', 'rotate', 'scaleRef', 'calloutBox'].includes(g.kind)) return own;
    const get = (id: string) => {
      const s = this.store?.get(id);
      return s && this.ownPreview(s);
    };
    const points = routeConnector(own, get);
    return points === own.points ? own : { ...own, points };
  }

  /** The markup as it should appear mid-gesture (moved or reshaped), without committing. */
  private ownPreview(m: Markup): Markup {
    const g = this.gesture;
    if (g?.kind === 'move' && this.state.selected.has(m.id) && !this.frozen(m)) return { ...m, ...moved(m, g.dx, g.dy) };
    if (g?.kind === 'calloutBox' && g.id === m.id) return { ...m, points: calloutBoxMoved(m.points, g.dx, g.dy) };
    if (g?.kind === 'handle' && g.id === m.id) return m.type === 'connector' ? this.connectorEndMoved(m, g.index, g.point) : { ...m, points: handleEdit(m, g.index, g.point) };
    if (g?.kind === 'bend' && g.id === m.id) return { ...m, bulges: withBulge(m, g.segment, g.bulge) };
    if (g?.kind === 'segment' && g.id === m.id) return this.withBends(m, moveSegment(g.route, g.mid, g.to, g.start));
    if (g?.kind === 'rotate' && g.id === m.id) return { ...m, rotation: g.angle };
    if (g?.kind === 'scaleRef' && g.ids.includes(m.id)) {
      const factor = scaleFactor(g);
      if (factor) return { ...m, ...scaledAbout(m, g.ref[0]!, factor) };
    }
    if ((g?.kind === 'label' || g?.kind === 'labelRotate') && g.id === m.id) return { ...m, style: labelStyled(m, g) };
    if (g?.kind === 'tableLine' && g.id === m.id) return { ...m, table: moveTableLine(m, g.line, g.to) ?? m.table };
    return m;
  }
}

/**
 * Modifier keys at the last pointer or key event. Hover events come from the viewer without the
 * originating event, so track modifiers globally (Shift, Alt and Ctrl pressed while hovering count too).
 */
const lastModifiers: Modifiers = { shiftKey: false, altKey: false, ctrlKey: false };
for (const type of ['pointermove', 'keydown', 'keyup'] as const) {
  window.addEventListener(type, (e) => {
    lastModifiers.shiftKey = e.shiftKey;
    lastModifiers.altKey = e.altKey;
    lastModifiers.ctrlKey = e.ctrlKey || e.metaKey;
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

/** How long the pointer rests on a markup before its comment pops up. */
const POPUP_DELAY_MS = 500;
/** A pop-up's width and its most lines of comment, on screen. */
const POPUP_W_PX = 240;
const POPUP_MAX_LINES = 10;

/**
 * A markup's comment in a pop-up beside it, at Preferences › Markup › Pop-Up Opacity, headed by
 * its author and date when Show Author and Date in Pop-Ups is on.
 */
function drawPopup(ctx: CanvasRenderingContext2D, m: Markup, zoom: number) {
  const prefs = settings.get();
  const b = markupBounds(m);
  const px = 1 / zoom;
  const pad = 8 * px;
  const lineH = 16 * px;
  const width = POPUP_W_PX * px;
  ctx.save();
  ctx.font = `${12 * px}px system-ui, sans-serif`;
  const lines: string[] = [];
  for (const para of m.comment!.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(next).width > width - 2 * pad) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    lines.push(line);
  }
  if (lines.length > POPUP_MAX_LINES) lines.splice(POPUP_MAX_LINES - 1, Infinity, '…');
  const head = prefs.popupAuthorDate ? `${m.author || 'Unknown'} · ${new Date(m.modifiedAt || m.createdAt).toLocaleString()}` : null;
  const h = pad * 2 + lines.length * lineH + (head ? lineH + 4 * px : 0);
  const x = b.x + b.w + 6 * px;
  const y = b.y;
  ctx.globalAlpha = prefs.popupOpacity / 100;
  ctx.fillStyle = '#fffbea';
  ctx.strokeStyle = '#b8a24a';
  ctx.lineWidth = px;
  ctx.beginPath();
  ctx.roundRect(x, y, width, h, 4 * px);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#1f2937';
  ctx.textBaseline = 'top';
  let ty = y + pad;
  if (head) {
    ctx.font = `bold ${11 * px}px system-ui, sans-serif`;
    ctx.fillText(head, x + pad, ty, width - 2 * pad);
    ty += lineH + 4 * px;
    ctx.font = `${12 * px}px system-ui, sans-serif`;
  }
  for (const line of lines) {
    ctx.fillText(line, x + pad, ty);
    ty += lineH;
  }
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
 * A markup's points after dragging handle `index` to `point`. A box's corner handles move two of its
 * edges, its edge handles one; whichever it is, the handle across from it stays where it is on the
 * page, rotated box or not.
 */
function handleEdit(m: Markup, index: number, point: Point): Point[] {
  const points = [...m.points];
  if (TYPE_INFO[m.type].handles !== 'box' || points.length !== 2) {
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
  // The edit in the box's own frame (a rotated box's pointer position turned back first).
  const c0 = rotationCentre(m);
  const u = m.rotation ? rotatePoint(point, c0, -m.rotation) : point;
  const [a, b] = [points[0]!, points[1]!];
  let [ax, ay, bx, by] = [a[0], a[1], b[0], b[1]];
  switch (index) {
    case 0: [ax, ay] = u; break;
    case 1: [bx, by] = u; break;
    case 2: [bx, ay] = u; break;
    case 3: [ax, by] = u; break;
    case 4: ay = u[1]; break;
    case 5: by = u[1]; break;
    case 6: ax = u[0]; break;
    default: bx = u[0];
  }
  const edited: Point[] = [[ax, ay], [bx, by]];
  if (!m.rotation) return edited;
  // The turned box keeps the handle across from the one dragged where it was on the page.
  const across = handlePositions({ ...m, points: edited, rotation: 0 })[BOX_OPPOSITE[index]!]!;
  const anchor = rotatePoint(across, c0, m.rotation);
  const c1 = rotationCentre({ type: m.type, points: edited });
  // Its new centre sits where the anchor is, plus its offset from the handle across, turned.
  const [ox, oy] = rotatePoint([c1[0] - across[0], c1[1] - across[1]], [0, 0], m.rotation);
  return edited.map((q): Point => [q[0] + anchor[0] + ox - c1[0], q[1] + anchor[1] + oy - c1[1]]);
}

/** A callout's points with everything but the arrow tips (the knee and the box) moved by (dx, dy). */
function calloutBoxMoved(points: readonly Point[], dx: number, dy: number): Point[] {
  return points.map((q, i): Point => (isCalloutTip(i) ? q : [q[0] + dx, q[1] + dy]));
}

/** A Length or Dimension's style with its text dragged or turned (zero offsets and turns left unset). */
function labelStyled(m: Markup, g: Extract<Gesture, { kind: 'label' | 'labelRotate' }>): MarkupStyle {
  const { leader: _l, labelOffset: _o, labelRotation: _r, ...rest } = m.style;
  const leader = g.kind === 'label' ? g.leader : m.style.leader;
  const along = g.kind === 'label' ? g.along : m.style.labelOffset;
  const turn = g.kind === 'labelRotate' ? g.angle : m.style.labelRotation;
  return { ...rest, ...(leader ? { leader } : {}), ...(along ? { labelOffset: along } : {}), ...(turn ? { labelRotation: turn } : {}) };
}

function toPoint(pt: PagePoint): Point {
  return [pt[0], pt[1]];
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

const isCellStyleKey = (key: string): key is (typeof CELL_STYLE_KEYS)[number] => (CELL_STYLE_KEYS as readonly string[]).includes(key);

/**
 * What changing a whole table's text style does to its cells: ones that had their own setting for it
 * lose that, so the change shows on every cell.
 */
function tableOwnStyleCleared(m: Markup, patch: Partial<MarkupStyle>): Partial<Markup> {
  if (m.type !== 'table' || !m.table?.formats) return {};
  const keys = Object.keys(patch).filter(isCellStyleKey);
  return keys.length ? { table: clearTableFormats(m, keys) } : {};
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
/** CAD Modify tools: the colour their previews are drawn in. */
const CAD_PREVIEW = '#2563eb';

/** Join: ends this close on screen count as meeting. */
const JOIN_PX = 3;

/** CAD tools whose clicks are points in space (snapped) once there is a selection to work on. */
const CAD_POINT_TOOLS: ReadonlySet<CadTool> = new Set<CadTool>(['move', 'copy', 'scale', 'mirror', 'rotateRef', 'align', 'arrayPolar']);

/** A CAD tool's guide: a thin dashed line through the points. */
function drawGuide(ctx: CanvasRenderingContext2D, path: readonly Point[], zoom: number) {
  if (path.length < 2) return;
  ctx.save();
  ctx.lineWidth = 1 / zoom;
  ctx.strokeStyle = CAD_PREVIEW;
  ctx.setLineDash([5 / zoom, 4 / zoom]);
  ctx.beginPath();
  path.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.stroke();
  ctx.restore();
}

/** A markup a click would pick: a soft, wide blue band along the lines it is drawn with (its box when it has none). */
function drawPickHighlight(ctx: CanvasRenderingContext2D, m: Markup, zoom: number) {
  let lines = edgesOf(m);
  if (!lines.length) {
    const b = markupBounds(m);
    lines = [[[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h], [b.x, b.y]]];
  }
  ctx.save();
  ctx.strokeStyle = 'rgba(37, 99, 235, 0.45)';
  ctx.lineWidth = Math.max(m.style.width, 0) + 6 / zoom;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (const line of lines) line.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.stroke();
  ctx.restore();
}

/** A point a CAD tool has picked: a small cross. */
function drawPickMark(ctx: CanvasRenderingContext2D, [x, y]: Point, zoom: number) {
  const r = 5 / zoom;
  ctx.save();
  ctx.lineWidth = 1.5 / zoom;
  ctx.strokeStyle = CAD_PREVIEW;
  ctx.beginPath();
  ctx.moveTo(x - r, y - r);
  ctx.lineTo(x + r, y + r);
  ctx.moveTo(x - r, y + r);
  ctx.lineTo(x + r, y - r);
  ctx.stroke();
  ctx.restore();
}

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

/** Draw to Scale: the size of what is being drawn, in a tag beside the pointer at `to`. */
function drawSketchReadout(ctx: CanvasRenderingContext2D, text: string, to: Point, zoom: number) {
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

/** Scale to Length: the factor its points give (the new length over the reference), or null before there is one. */
function scaleFactor(g: Extract<Gesture, { kind: 'scaleRef' }>): number | null {
  const [a, b] = g.ref;
  const target = g.target.length === 2 ? g.target : g.target.length === 1 && g.hover ? [g.target[0]!, g.hover] : null;
  if (g.stage !== 'target' || !a || !b || !target) return null;
  const ref = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const len = Math.hypot(target[1]![0] - target[0]![0], target[1]![1] - target[0]![1]);
  return ref > 0 && len > 0 ? len / ref : null;
}

/** A Scale to Length line: dashed between its points, with a dot on each. */
function drawScaleLine(ctx: CanvasRenderingContext2D, points: readonly Point[], colour: string, zoom: number) {
  if (!points.length) return;
  ctx.save();
  ctx.strokeStyle = colour;
  ctx.fillStyle = colour;
  ctx.lineWidth = 1.5 / zoom;
  ctx.setLineDash([6 / zoom, 4 / zoom]);
  ctx.beginPath();
  points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.stroke();
  for (const [x, y] of points) {
    ctx.beginPath();
    ctx.arc(x, y, 3 / zoom, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Names of the snaps, shown beside the marker as AutoCAD does. */
const SNAP_NAMES: Record<SnapKind, string> = {
  endpoint: 'Endpoint',
  center: 'Centre',
  geocenter: 'Geometric Centre',
  intersection: 'Intersection',
  apparent: 'Apparent Intersection',
  midpoint: 'Midpoint',
  quadrant: 'Quadrant',
  perpendicular: 'Perpendicular',
  tangent: 'Tangent',
  nearest: 'Nearest',
};

const PATH_NAMES: Record<TrackPathKind, string> = { tracking: 'Tracking', polar: 'Polar', extension: 'Extension', parallel: 'Parallel' };

/** A snap's or tracking path's name in a small tag above and to the right of `at`. */
function drawSnapTip(ctx: CanvasRenderingContext2D, text: string, at: readonly number[], zoom: number) {
  const px = 1 / zoom;
  ctx.save();
  ctx.font = `${11 * px}px system-ui, sans-serif`;
  ctx.textBaseline = 'middle';
  const w = ctx.measureText(text).width + 10 * px;
  const h = 18 * px;
  const x = at[0]! + 12 * px;
  const y = at[1]! - 16 * px;
  ctx.fillStyle = 'rgba(17, 24, 39, 0.85)';
  ctx.beginPath();
  ctx.roundRect(x, y - h / 2, w, h, 3 * px);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, x + 5 * px, y);
  ctx.restore();
}

/** Points picked up for tracking (a small +) and lines picked up for parallel (a // on the line). */
function drawAcquired(ctx: CanvasRenderingContext2D, points: readonly TrackPoint[], parallels: readonly { at: Point; dir: Point }[], zoom: number) {
  const s = 5 / zoom;
  ctx.save();
  ctx.strokeStyle = settings.get().snapColour;
  ctx.lineWidth = 1.5 / zoom;
  ctx.beginPath();
  for (const { point: [x, y] } of points) {
    ctx.moveTo(x - s, y);
    ctx.lineTo(x + s, y);
    ctx.moveTo(x, y - s);
    ctx.lineTo(x, y + s);
  }
  for (const { at, dir } of parallels) {
    for (const k of [-1, 1]) {
      // Two short strokes along the line, side by side across it.
      const ox = -dir[1] * k * s * 0.6;
      const oy = dir[0] * k * s * 0.6;
      ctx.moveTo(at[0] + ox - dir[0] * s, at[1] + oy - dir[1] * s);
      ctx.lineTo(at[0] + ox + dir[0] * s, at[1] + oy + dir[1] * s);
    }
  }
  ctx.stroke();
  ctx.restore();
}

/** The tracking paths the pointer is locked onto, dotted from their origins out past it, and an × where it lands. */
function drawTracked(ctx: CanvasRenderingContext2D, tracked: Tracked, zoom: number) {
  const reach = 4000 / zoom;
  const [x, y] = tracked.point;
  ctx.save();
  ctx.strokeStyle = settings.get().snapColour;
  ctx.lineWidth = 1 / zoom;
  ctx.setLineDash([2 / zoom, 4 / zoom]);
  ctx.beginPath();
  for (const { origin, dir } of tracked.paths) {
    // On from the origin through the pointer, whichever way along the path it lies.
    const way = (x - origin[0]) * dir[0] + (y - origin[1]) * dir[1] >= 0 ? 1 : -1;
    ctx.moveTo(origin[0], origin[1]);
    ctx.lineTo(x + dir[0] * way * reach, y + dir[1] * way * reach);
  }
  ctx.stroke();
  ctx.setLineDash([]);
  const s = 4 / zoom;
  ctx.lineWidth = 1.5 / zoom;
  ctx.beginPath();
  ctx.moveTo(x - s, y - s);
  ctx.lineTo(x + s, y + s);
  ctx.moveTo(x + s, y - s);
  ctx.lineTo(x - s, y + s);
  ctx.stroke();
  ctx.restore();
}

/**
 * CAD-style snap glyphs: square = endpoint, X = intersection, boxed X = apparent intersection,
 * triangle = midpoint, ◇ = on line, ⊕ = centre, ◇ round a dot = quadrant, ⊛ = geometric centre,
 * right angle = perpendicular, circle under a line = tangent.
 */
function drawSnapIndicator(ctx: CanvasRenderingContext2D, snap: Snap, zoom: number) {
  const [x, y] = snap.point;
  const s = 6 / zoom;
  ctx.save();
  ctx.strokeStyle = settings.get().snapColour;
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
    case 'center':
      ctx.arc(x, y, s, 0, Math.PI * 2);
      ctx.moveTo(x - s * 0.5, y);
      ctx.lineTo(x + s * 0.5, y);
      ctx.moveTo(x, y - s * 0.5);
      ctx.lineTo(x, y + s * 0.5);
      break;
    case 'quadrant':
      ctx.arc(x, y, s * 0.6, 0, Math.PI * 2);
      ctx.moveTo(x + s, y);
      ctx.lineTo(x, y + s);
      ctx.lineTo(x - s, y);
      ctx.lineTo(x, y - s);
      ctx.closePath();
      break;
    case 'geocenter':
      // A star of three crossing strokes in a circle.
      ctx.arc(x, y, s, 0, Math.PI * 2);
      for (const a of [0, Math.PI / 3, (2 * Math.PI) / 3]) {
        ctx.moveTo(x + Math.cos(a) * s * 0.6, y + Math.sin(a) * s * 0.6);
        ctx.lineTo(x - Math.cos(a) * s * 0.6, y - Math.sin(a) * s * 0.6);
      }
      break;
    case 'apparent':
      // An X in a box.
      ctx.rect(x - s, y - s, s * 2, s * 2);
      ctx.moveTo(x - s * 0.6, y - s * 0.6);
      ctx.lineTo(x + s * 0.6, y + s * 0.6);
      ctx.moveTo(x + s * 0.6, y - s * 0.6);
      ctx.lineTo(x - s * 0.6, y + s * 0.6);
      break;
    case 'perpendicular':
      // A right angle.
      ctx.moveTo(x - s, y - s);
      ctx.lineTo(x - s, y + s);
      ctx.lineTo(x + s, y + s);
      ctx.moveTo(x - s, y);
      ctx.lineTo(x, y);
      ctx.lineTo(x, y + s);
      break;
    case 'tangent':
      // A circle with a line along its top.
      ctx.arc(x, y + s * 0.3, s * 0.7, 0, Math.PI * 2);
      ctx.moveTo(x - s, y - s * 0.4);
      ctx.lineTo(x + s, y - s * 0.4);
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
