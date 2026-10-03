import { expandArcs, isMeasureKind, type MeasureKind, type MeasureProps, type Slope } from '@nb/measure';
import { arcPoints } from './arc';
import { TYPE_INFO } from './types';
import type { StampContent } from './stamp';
import type { LinkAction } from './bookmarks';
import { lineEnds, type FontFamily, type HatchPattern, type LineDash, type LineEnding, type TextAlign, type VerticalAlign } from './style';

/** Point in page space: PDF points, origin at the top-left of the displayed (rotated) page, y down. */
export type Point = [x: number, y: number];

export type MarkupType =
  | 'line'
  | 'arrow'
  | 'polyline'
  | 'arc'
  | 'rect'
  | 'ellipse'
  | 'polygon'
  | 'cloud'
  | 'pen'
  | 'highlighter'
  | 'textHighlight'
  | 'underline'
  | 'strikeout'
  | 'squiggly'
  | 'text'
  | 'callout'
  | 'typewriter'
  | 'note'
  | 'image'
  | 'signature'
  | 'stamp'
  | 'legend'
  | 'hyperlink'
  | 'space'
  | 'redaction'
  | 'dimension'
  | 'attachment'
  | 'flag'
  | 'replaceText'
  | MeasureKind;

/** Every markup type, in menu order. */
export const MARKUP_TYPES = Object.keys(TYPE_INFO) as MarkupType[];

export { isMeasureKind };

/** Markups whose content is typed text laid out in their box. */
export function isTextType(type: string): type is 'text' | 'callout' | 'typewriter' {
  return TYPE_INFO[type as MarkupType]?.content === 'text';
}

/** Markups that draw a picture (`Markup.image`) in their box. */
export function isImageType(type: string): type is 'image' | 'signature' {
  return TYPE_INFO[type as MarkupType]?.content === 'image';
}

/** Markups drawn click by click (including measurements), and their point rules. */
export const CLICK_SHAPES: Partial<Record<MarkupType, { min: number; fixed?: number; closes?: boolean }>> = Object.fromEntries(
  MARKUP_TYPES.flatMap((t) => (TYPE_INFO[t].click ? [[t, TYPE_INFO[t].click]] : [])),
);

export interface MarkupStyle {
  /** CSS hex color, e.g. `#ff0000`. */
  stroke: string;
  /** Fill color, or null for none. */
  fill: string | null;
  /** Line width in PDF points. */
  width: number;
  /** 0..1 */
  opacity: number;
  /** Font size in points (text markups). */
  fontSize?: number;
  /**
   * Radius in points of a cloud's arcs or a count's markers; set at creation so they look the
   * same size on screen whatever the zoom was.
   */
  arcRadius?: number;
  /** Clouds: arcs bulge inward rather than outward. */
  cloudInside?: boolean;
  /** Fill opacity (0..1) multiplied with `opacity`; used for translucent area fills. */
  fillOpacity?: number;
  /** Line style; solid when unset. */
  dash?: LineDash;
  /** Line endings (line, arrow, length, polylength); unset uses the type's default look. */
  startCap?: LineEnding;
  endCap?: LineEnding;
  /** Line ending size as a multiple of the default size. */
  capScale?: number;
  /** Hatch pattern drawn inside closed shapes, in the line color. */
  hatch?: HatchPattern;
  /** Font for text boxes and measurement labels. */
  fontFamily?: FontFamily;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  /** Text and label color; the line color when unset. */
  textColor?: string;
  textAlign?: TextAlign;
  verticalAlign?: VerticalAlign;
  /** Measurement label visibility (default shown) and background (default white; null for none). */
  showLabel?: boolean;
  labelBackground?: string | null;
  /** Length dimensions: offset of the dimension line from the measured points, with extension lines. */
  leader?: number;
}

/** A file embedded in the PDF (File Attachment markups, sound notes). */
export interface Attachment {
  name: string;
  /** MIME type, e.g. `application/pdf`, `audio/webm`. */
  mime: string;
  size: number;
  /** The file's bytes, base64 encoded. */
  data: string;
}

/** Id of one of the document's statuses (see `MarkupStatusDef`); `none` means no status. */
export type MarkupStatus = string;

/** A reply in a markup's comment thread. */
export interface Reply {
  id: string;
  author: string;
  text: string;
  createdAt: number;
}

/** Who signed, when, and a digest of the document's markups at that moment (see the Signatures panel). */
export interface SignatureInfo {
  signer: string;
  signedAt: number;
  /** SHA-256 over the file and every non-signature markup when the signature was placed. */
  digest: string;
  /** Optional reason shown with the signature, e.g. "Approved for construction". */
  reason?: string;
}

export interface Markup {
  id: string;
  type: MarkupType;
  pageIndex: number;
  /**
   * Geometry. line/arrow/length: [start, end]. rect/ellipse/cloud/text/typewriter/note/image/hyperlink: two
   * opposite corners. callout: [arrow tip, knee, box corner, opposite box corner].
   * textHighlight/underline/strikeout/squiggly: two opposite corners per line of text. pen/highlighter/polyline/polylength: the path. polygon/area/perimeter:
   * vertices (implicitly closed). arc: [start, a point on the arc, end]. count: one point per item.
   * angle: [ray end, vertex, ray end]. space: its outline (implicitly closed); its name is `subject`. diameter: the two ends of a diameter. radius: [centre, a
   * point on the circle]. arcLength: [start, a point on the arc, end]. volume: like area.
   */
  points: Point[];
  style: MarkupStyle;
  text?: string;
  /** Free-form comment shown in the markup list. */
  comment?: string;
  /** Replies to the markup, oldest first. */
  replies?: Reply[];
  /** Stamps: the wording (dynamic fields already filled in when placed) and frame. */
  stamp?: StampContent;
  /** Area, volume and perimeter measurements: cutouts, each a polygon inside the outline. */
  holes?: Point[][];
  /** Measurements: depth or height in meters (volume for areas, wall area for lengths). */
  depth?: number;
  /** Measurements: slope of the measured surface or run. */
  slope?: Slope;
  /** Polylength, area, perimeter and volume: curved segments (per segment, its bulge; see @nb/measure's arcSegment). */
  bulges?: number[];
  /** Hyperlinks: where clicking the markup goes. */
  link?: LinkAction;
  /** Legends: which markups they list, those on their own page or in the whole document. */
  legend?: { scope: 'page' | 'document' };
  /** Subject shown in the markup list; the type's name when unset (tool library tools set it). */
  subject?: string;
  /** Values of the document's custom columns, keyed by column id. */
  fields?: Record<string, string>;
  /** Image drawn in the markup's box (images, signatures): a PNG or JPEG data URL. */
  image?: string;
  signature?: SignatureInfo;
  /** Locked markups cannot be moved, reshaped, restyled or deleted; their status and comments stay editable. */
  locked?: boolean;
  /** Markups sharing a group id are selected, moved and deleted together. */
  groupId?: string;
  /** The markup layer it is on (Layers panel); exported as a PDF layer of that name. */
  layer?: string;
  /** Flagged for follow-up (a linked flag, listed in the Flags panel). */
  flagged?: boolean;
  /** Hidden markups are not drawn or printed; they stay in the markups list. */
  hidden?: boolean;
  /** Clockwise rotation in degrees about the centre of the markup's box (box-shaped types). */
  rotation?: number;
  /** File Attachment markups: the embedded file. */
  attachment?: Attachment;
  status: MarkupStatus;
  author: string;
  createdAt: number;
  modifiedAt: number;
}

/** Look of a new markup of each type. */
export const DEFAULT_STYLES = Object.fromEntries(MARKUP_TYPES.map((t) => [t, TYPE_INFO[t].style])) as Record<MarkupType, MarkupStyle>;

/** Each type's name, as shown in menus and the markups list. */
export const MARKUP_LABELS = Object.fromEntries(MARKUP_TYPES.map((t) => [t, TYPE_INFO[t].label])) as Record<MarkupType, string>;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The box a markup's text or picture sits in: a callout's box, else the bounds of its points. */
export function contentBox(m: Pick<Markup, 'type' | 'points'>): Rect {
  return boundsOf(m.type === 'callout' && m.points.length >= 4 ? m.points.slice(2, 4) : m.points);
}

/** Axis-aligned bounds of a set of points. */
export function boundsOf(points: readonly Point[]): Rect {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of points) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Diameter and radius measurements: the circle they measure. */
export function circleOf(m: Pick<Markup, 'type' | 'points'>): { cx: number; cy: number; r: number } | null {
  const [a, b] = m.points;
  if (!a) return null;
  if (!b) return { cx: a[0], cy: a[1], r: 0 };
  if (m.type === 'radius') return { cx: a[0], cy: a[1], r: Math.hypot(b[0] - a[0], b[1] - a[1]) };
  if (m.type === 'diameter') return { cx: (a[0] + b[0]) / 2, cy: (a[1] + b[1]) / 2, r: Math.hypot(b[0] - a[0], b[1] - a[1]) / 2 };
  return null;
}

/** A markup's geometry: its points and any cutouts. */
export type Geometry = Pick<Markup, 'points' | 'holes' | 'bulges'>;

/** The markup's points and cutouts passed through `f` (a move, flip or rotation). */
export function mapGeometry(m: Geometry, f: (p: Point) => Point): Geometry {
  return m.holes ? { points: m.points.map(f), holes: m.holes.map((h) => h.map(f)) } : { points: m.points.map(f) };
}

/** What a markup's measurement depends on besides its points. */
export function measureProps(m: Pick<Markup, 'holes' | 'depth' | 'slope' | 'bulges'>): MeasureProps {
  return { holes: m.holes, depth: m.depth, slope: m.slope, ...(m.bulges?.some(Boolean) ? { bulges: m.bulges } : {}) };
}

/** Bounds including stroke width and decorations (arrowheads, cloud bulges). */
export function markupBounds(m: Markup): Rect {
  const b = unrotatedBounds(m);
  if (!m.rotation) return b;
  // A rotated markup's bounds hold its box's rotated corners.
  const c = rotationCentre(m);
  const corners = ([[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]] as Point[]).map((p) => rotatePoint(p, c, m.rotation!));
  return boundsOf(corners);
}

/** Types that can be turned to any angle (Rotate): box-shaped markups. */
export const ROTATABLE: ReadonlySet<MarkupType> = new Set<MarkupType>(['rect', 'ellipse', 'cloud', 'text', 'typewriter', 'image', 'signature', 'stamp']);

/** The point a markup turns about: the centre of its box. */
export function rotationCentre(m: Pick<Markup, 'type' | 'points'>): Point {
  const b = contentBox(m);
  return [b.x + b.w / 2, b.y + b.h / 2];
}

/** `p` turned `degrees` clockwise (page space is y down) about `c`. */
export function rotatePoint(p: Point, c: Point, degrees: number): Point {
  const a = (degrees * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const dx = p[0] - c[0];
  const dy = p[1] - c[1];
  return [c[0] + dx * cos - dy * sin, c[1] + dx * sin + dy * cos];
}

/** A page point in a rotated markup's own (unrotated) frame. */
export function unrotate(m: Markup, p: Point): Point {
  return m.rotation ? rotatePoint(p, rotationCentre(m), -m.rotation) : p;
}

/** The points of a markup's outline, with curved measurement segments traced along their arcs. */
export function outlinePoints(m: Pick<Markup, 'type' | 'points' | 'bulges'>): Point[] {
  if (!m.bulges?.some(Boolean)) return m.points;
  return expandArcs(m.points, m.bulges, m.type !== 'polylength');
}

function unrotatedBounds(m: Markup): Rect {
  const circle = circleOf(m);
  // An arc bulges past its three defining points; a circle past its diameter.
  const b = circle ? { x: circle.cx - circle.r, y: circle.cy - circle.r, w: circle.r * 2, h: circle.r * 2 } : boundsOf(m.type === 'arc' || m.type === 'arcLength' ? arcPoints(m.points) : outlinePoints(m));
  const ends = lineEnds(m);
  const pad =
    m.style.width / 2 +
    (ends[0] !== 'none' || ends[1] !== 'none' ? capSize(m) : 0) +
    (m.type === 'cloud' ? cloudRadius(m) : 0) +
    (isMeasureKind(m.type) ? markerSize(m) * (m.type === 'angle' ? 3 : 1) : 0) +
    (m.type === 'length' ? Math.abs(m.style.leader ?? 0) : 0);
  return { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
}

/** Count marker radius, dimension tick half-length, and angle arc unit, in points. */
export function markerSize(m: Markup): number {
  return m.style.arcRadius ?? Math.max(3, m.style.width * 3);
}

/** Length of a line ending (arrowhead length, tick length, circle diameter), in points. */
export function capSize(m: Markup): number {
  const base = isMeasureKind(m.type) ? markerSize(m) * 2 : Math.max(6, m.style.width * 4);
  return base * (m.style.capScale ?? 1);
}

/** Radius of the arcs along a cloud's edge. */
export function cloudRadius(m: Markup): number {
  return m.style.arcRadius ?? Math.max(4, m.style.width * 4);
}
