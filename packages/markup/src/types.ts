import type { MarkupStyle, MarkupType } from './model';
import type { LineEnding, StyleCapabilities } from './style';

/**
 * Everything that differs between markup types, apart from their shapes (geometry.ts) and PDF
 * annotation form (export.ts / import.ts), in one table. Adding a type starts here.
 */
export interface MarkupTypeInfo {
  label: string;
  /** Look of a new markup of this type. */
  style: MarkupStyle;
  /**
   * How the tool draws it: drag out two points (`drag`), a freehand stroke (`freehand`), point by
   * point (`click`, see `click`), or one click that places it at a set size (`place`).
   */
  draw: 'drag' | 'freehand' | 'click' | 'place' | 'text';
  /** Click-drawn: at least `min` points, done when `fixed` are placed; `closes` on the first point. */
  click?: { min: number; fixed?: number; closes?: boolean };
  /** An outline enclosing an area: fill and hatching apply (polygons once they have three points). */
  closed: boolean;
  /** Handles when selected: the two defining points, every vertex, or none (move only). */
  handles: 'ends' | 'vertices' | 'none';
  /** Grabbed anywhere inside its box, even without a fill. */
  solid: boolean;
  /** Typed text or a picture drawn in its box. */
  content?: 'text' | 'image';
  /** Line endings it has by default; unset for types without line endings. */
  ends?: readonly [LineEnding, LineEnding];
  /** Measurement label and scale apply. */
  measure: boolean;
  /** Drawn multiplied with the page, so the drawing shows through (highlighters). */
  multiply?: boolean;
  /** Properties panel: which style properties mean something. */
  caps: StyleCapabilities;
}

const NONE: StyleCapabilities = { fill: false, hatch: false, dash: false, lineEnds: false, font: false, textLayout: false, label: false, leader: false, arcRadius: null };
const caps = (c: Partial<StyleCapabilities>): StyleCapabilities => ({ ...NONE, ...c });

const RED = '#e11d48';
const line = (style?: Partial<MarkupStyle>): MarkupStyle => ({ stroke: RED, fill: null, width: 1.5, opacity: 1, ...style });

/** Lines and open paths: dashes and line endings. */
const OPEN = caps({ dash: true, lineEnds: true });
/** Closed shapes: fill, hatching and dashes. */
const SHAPE = caps({ fill: true, hatch: true, dash: true });
/** Measurements: their label; closed ones also fill. */
const MEASURE = caps({ dash: true, font: true, label: true });

export const TYPE_INFO: Readonly<Record<MarkupType, MarkupTypeInfo>> = {
  line: { label: 'Line', style: line(), draw: 'drag', closed: false, handles: 'ends', solid: false, ends: ['none', 'none'], measure: false, caps: OPEN },
  arrow: { label: 'Arrow', style: line(), draw: 'drag', closed: false, handles: 'ends', solid: false, ends: ['none', 'filledArrow'], measure: false, caps: OPEN },
  polyline: { label: 'Polyline', style: line(), draw: 'click', click: { min: 2 }, closed: false, handles: 'vertices', solid: false, ends: ['none', 'none'], measure: false, caps: OPEN },
  arc: { label: 'Arc', style: line(), draw: 'click', click: { min: 3, fixed: 3 }, closed: false, handles: 'vertices', solid: false, ends: ['none', 'none'], measure: false, caps: OPEN },
  rect: { label: 'Rectangle', style: line(), draw: 'drag', closed: true, handles: 'ends', solid: false, measure: false, caps: SHAPE },
  ellipse: { label: 'Ellipse', style: line(), draw: 'drag', closed: true, handles: 'ends', solid: false, measure: false, caps: SHAPE },
  polygon: { label: 'Polygon', style: line(), draw: 'click', click: { min: 3, closes: true }, closed: true, handles: 'vertices', solid: false, measure: false, caps: SHAPE },
  cloud: { label: 'Cloud', style: line(), draw: 'drag', closed: true, handles: 'ends', solid: false, measure: false, caps: { ...SHAPE, arcRadius: 'Arc size' } },
  pen: { label: 'Pen', style: line({ stroke: '#2563eb' }), draw: 'freehand', closed: false, handles: 'none', solid: false, measure: false, caps: caps({ dash: true }) },
  highlighter: { label: 'Highlight', style: { stroke: '#facc15', fill: null, width: 12, opacity: 0.4 }, draw: 'freehand', closed: false, handles: 'none', solid: false, measure: false, multiply: true, caps: NONE },
  // Text markups follow the PDF's own text: drag across words to mark them.
  textHighlight: { label: 'Text Highlight', style: { stroke: '#facc15', fill: null, width: 1, opacity: 0.5 }, draw: 'text', closed: false, handles: 'none', solid: true, measure: false, multiply: true, caps: NONE },
  underline: { label: 'Underline', style: { stroke: '#16a34a', fill: null, width: 1, opacity: 1 }, draw: 'text', closed: false, handles: 'none', solid: true, measure: false, caps: NONE },
  strikeout: { label: 'Strikethrough', style: { stroke: '#e11d48', fill: null, width: 1, opacity: 1 }, draw: 'text', closed: false, handles: 'none', solid: true, measure: false, caps: NONE },
  squiggly: { label: 'Squiggly', style: { stroke: '#2563eb', fill: null, width: 0.75, opacity: 1 }, draw: 'text', closed: false, handles: 'none', solid: true, measure: false, caps: NONE },
  text: {
    label: 'Text Box',
    style: line({ width: 1, fontSize: 12 }),
    draw: 'drag',
    closed: false,
    handles: 'ends',
    solid: true,
    content: 'text',
    measure: false,
    caps: caps({ fill: true, dash: true, font: true, textLayout: true }),
  },
  callout: {
    label: 'Callout',
    style: line({ width: 1, fontSize: 12 }),
    draw: 'drag',
    closed: false,
    handles: 'vertices',
    solid: true,
    content: 'text',
    ends: ['filledArrow', 'none'],
    measure: false,
    caps: caps({ fill: true, dash: true, lineEnds: true, font: true, textLayout: true }),
  },
  typewriter: {
    label: 'Typewriter',
    style: line({ width: 0, fontSize: 12 }),
    draw: 'place',
    closed: false,
    handles: 'ends',
    solid: true,
    content: 'text',
    measure: false,
    caps: caps({ font: true, textLayout: true }),
  },
  note: { label: 'Note', style: { stroke: '#a16207', fill: '#fde047', width: 0.75, opacity: 1 }, draw: 'place', closed: false, handles: 'none', solid: true, measure: false, caps: caps({ fill: true }) },
  image: { label: 'Image', style: { stroke: '#000000', fill: null, width: 0, opacity: 1 }, draw: 'drag', closed: false, handles: 'ends', solid: true, content: 'image', measure: false, caps: NONE },
  signature: { label: 'Signature', style: { stroke: '#1e3a8a', fill: null, width: 0, opacity: 1 }, draw: 'drag', closed: false, handles: 'ends', solid: true, content: 'image', measure: false, caps: NONE },
  stamp: {
    label: 'Stamp',
    style: { stroke: '#15803d', fill: null, width: 2, opacity: 0.9 },
    draw: 'drag',
    closed: false,
    handles: 'ends',
    solid: true,
    measure: false,
    caps: caps({ fill: true }),
  },
  legend: {
    label: 'Legend',
    // No font size: new legends get one that reads well at the zoom they are drawn at.
    style: { stroke: '#374151', fill: '#ffffff', width: 0.75, opacity: 1 },
    draw: 'drag',
    closed: false,
    handles: 'ends',
    solid: true,
    measure: false,
    caps: caps({ fill: true, font: true }),
  },
  // A named region (room, zone, level); its name is the subject, drawn at its centre.
  space: {
    label: 'Space',
    // No font size: new Spaces get one that reads well at the zoom they are drawn at.
    style: { stroke: '#0369a1', fill: '#0ea5e9', width: 1.5, opacity: 1, fillOpacity: 0.1 },
    draw: 'click',
    click: { min: 3, closes: true },
    closed: true,
    handles: 'vertices',
    solid: false,
    measure: false,
    caps: caps({ fill: true, hatch: true, dash: true, font: true }),
  },
  // An area marked for redaction: Apply Redactions removes the content under it and covers it.
  redaction: {
    label: 'Redaction',
    style: { stroke: '#dc2626', fill: '#000000', width: 1.5, opacity: 1, fillOpacity: 0.25, dash: 'dashed' },
    draw: 'drag',
    closed: true,
    handles: 'ends',
    solid: true,
    measure: false,
    caps: caps({ fill: true }),
  },
  // A line with arrows at both ends and typed text along it; not scaled (Length measures).
  dimension: {
    label: 'Dimension',
    style: line({ stroke: '#1d4ed8', width: 1, fontSize: 10 }),
    draw: 'drag',
    closed: false,
    handles: 'ends',
    solid: false,
    ends: ['filledArrow', 'filledArrow'],
    measure: false,
    caps: caps({ dash: true, lineEnds: true, font: true }),
  },
  // A file embedded in the PDF, shown as a paperclip icon.
  attachment: { label: 'File Attachment', style: { stroke: '#1d4ed8', fill: '#dbeafe', width: 0.75, opacity: 1 }, draw: 'place', closed: false, handles: 'none', solid: true, measure: false, caps: caps({ fill: true }) },
  // A flag on the page to come back to (Flags panel).
  flag: { label: 'Flag', style: { stroke: '#991b1b', fill: '#ef4444', width: 0.75, opacity: 1 }, draw: 'place', closed: false, handles: 'none', solid: true, measure: false, caps: caps({ fill: true }) },
  // Struck-out PDF text with the replacement (its text) marked by a caret.
  replaceText: { label: 'Replace Text', style: { stroke: '#2563eb', fill: null, width: 1, opacity: 1 }, draw: 'text', closed: false, handles: 'none', solid: true, measure: false, caps: NONE },
  // A clickable area; its action (link) is chosen after drawing it.
  hyperlink: { label: 'Hyperlink', style: { stroke: '#2563eb', fill: null, width: 1, opacity: 1 }, draw: 'drag', closed: false, handles: 'ends', solid: true, measure: false, caps: caps({ dash: true }) },
  diameter: {
    label: 'Diameter',
    style: { stroke: '#0d9488', fill: null, width: 1, opacity: 1 },
    draw: 'click',
    click: { min: 2, fixed: 2 },
    closed: false,
    handles: 'vertices',
    solid: false,
    ends: ['filledArrow', 'filledArrow'],
    measure: true,
    caps: { ...MEASURE, fill: true, lineEnds: true },
  },
  radius: {
    label: 'Radius',
    style: { stroke: '#0d9488', fill: null, width: 1, opacity: 1 },
    draw: 'click',
    click: { min: 2, fixed: 2 },
    closed: false,
    handles: 'vertices',
    solid: false,
    ends: ['none', 'filledArrow'],
    measure: true,
    caps: { ...MEASURE, fill: true, lineEnds: true },
  },
  arcLength: {
    label: 'Arc Length',
    style: { stroke: '#ea580c', fill: null, width: 1, opacity: 1 },
    draw: 'click',
    click: { min: 3, fixed: 3 },
    closed: false,
    handles: 'vertices',
    solid: false,
    ends: ['tick', 'tick'],
    measure: true,
    caps: { ...MEASURE, lineEnds: true },
  },
  volume: {
    label: 'Volume',
    style: { stroke: '#4f46e5', fill: '#4f46e5', width: 1, opacity: 1, fillOpacity: 0.2 },
    draw: 'click',
    click: { min: 3, closes: true },
    closed: true,
    handles: 'vertices',
    solid: false,
    measure: true,
    caps: { ...MEASURE, fill: true, hatch: true },
  },
  length: {
    label: 'Length',
    // New lengths get arrowheads; older ones without these set keep their ticks.
    style: { stroke: '#dc2626', fill: null, width: 1, opacity: 1, startCap: 'filledArrow', endCap: 'filledArrow' },
    draw: 'click',
    click: { min: 2, fixed: 2 },
    closed: false,
    handles: 'vertices',
    solid: false,
    ends: ['tick', 'tick'],
    measure: true,
    caps: { ...MEASURE, lineEnds: true, leader: true },
  },
  polylength: {
    label: 'Polylength',
    style: { stroke: '#ea580c', fill: null, width: 1, opacity: 1 },
    draw: 'click',
    click: { min: 2 },
    closed: false,
    handles: 'vertices',
    solid: false,
    ends: ['none', 'none'],
    measure: true,
    caps: { ...MEASURE, lineEnds: true },
  },
  area: {
    label: 'Area',
    style: { stroke: '#16a34a', fill: '#16a34a', width: 1, opacity: 1, fillOpacity: 0.2 },
    draw: 'click',
    click: { min: 3, closes: true },
    closed: true,
    handles: 'vertices',
    solid: false,
    measure: true,
    caps: { ...MEASURE, fill: true, hatch: true },
  },
  perimeter: {
    label: 'Perimeter',
    style: { stroke: '#0891b2', fill: null, width: 1, opacity: 1 },
    draw: 'click',
    click: { min: 3, closes: true },
    closed: true,
    handles: 'vertices',
    solid: false,
    measure: true,
    caps: { ...MEASURE, fill: true, hatch: true },
  },
  count: {
    label: 'Count',
    style: { stroke: '#9333ea', fill: '#9333ea', width: 1, opacity: 1, fillOpacity: 0.5 },
    draw: 'click',
    click: { min: 1 },
    closed: false,
    handles: 'vertices',
    solid: false,
    measure: true,
    caps: { ...MEASURE, fill: true, dash: false, arcRadius: 'Marker size' },
  },
  angle: {
    label: 'Angle',
    style: { stroke: '#db2777', fill: null, width: 1, opacity: 1 },
    draw: 'click',
    click: { min: 3, fixed: 3 },
    closed: false,
    handles: 'vertices',
    solid: false,
    measure: true,
    caps: MEASURE,
  },
};
