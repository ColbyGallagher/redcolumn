import { currentLocale, msg, msgc } from '@nb/i18n';
import type { CountShape, FlowShapeKind, LineDash, MarkupType } from '@nb/markup';
import type { LengthUnit, ScalePreset } from '@nb/measure';
import type { CadTool } from '../markup/cadTools';
import type { OtherTool } from '../markup/MarkupTools';
import type { CommandCategory } from '../commands/appCommands';

/**
 * Translated names of tools, markup kinds and flowchart shapes, for the interface only.
 *
 * The English names in @nb/markup (`MARKUP_LABELS`, `flowShapeLabel`) stay as they are: they are
 * written into PDFs as subjects and read back by other PDF tools, so they never change with the
 * interface language. Show these instead wherever a person reads the name.
 */

type Names<K extends string> = () => Record<K, string>;

// One table per language, built on first use after the language is chosen.
function cached<K extends string>(build: Names<K>): (key: K) => string {
  let locale: unknown = null;
  let table: Record<K, string> | null = null;
  return (key) => {
    if (!table || locale !== currentLocale()) {
      table = build();
      locale = currentLocale();
    }
    return table[key];
  };
}

/** A kind of markup's name ('Line', 'Cloud', 'Count'). */
export const markupName = cached<MarkupType>(() => ({
  line: msgc('tool', 'Line'),
  arrow: msgc('tool', 'Arrow'),
  polyline: msgc('tool', 'Polyline'),
  arc: msgc('tool', 'Arc'),
  rect: msgc('tool', 'Rectangle'),
  ellipse: msgc('tool', 'Ellipse'),
  polygon: msgc('tool', 'Polygon'),
  cloud: msgc('tool', 'Cloud'),
  polygonCloud: msgc('tool', 'Polygon Cloud'),
  ellipticalArc: msgc('tool', 'Elliptical Arc'),
  pen: msgc('tool', 'Pen'),
  highlighter: msgc('tool', 'Highlight'),
  textHighlight: msgc('tool', 'Text Highlight'),
  underline: msgc('tool', 'Underline'),
  strikeout: msgc('tool', 'Strikethrough'),
  squiggly: msgc('tool', 'Squiggly'),
  text: msgc('tool', 'Text Box'),
  callout: msgc('tool', 'Callout'),
  typewriter: msgc('tool', 'Typewriter'),
  note: msgc('tool', 'Note'),
  image: msgc('tool', 'Image'),
  signature: msgc('tool', 'Signature'),
  stamp: msgc('tool', 'Stamp'),
  legend: msgc('tool', 'Legend'),
  table: msgc('tool', 'Table'),
  space: msgc('tool', 'Space'),
  redaction: msgc('tool', 'Redaction'),
  dimension: msgc('tool', 'Dimension'),
  attachment: msgc('tool', 'File Attachment'),
  flag: msgc('tool', 'Flag'),
  flagLabel: msgc('tool', 'Flag Label'),
  flowShape: msgc('tool', 'Flowchart Shape'),
  connector: msgc('tool', 'Connector'),
  replaceText: msgc('tool', 'Replace Text'),
  hyperlink: msgc('tool', 'Hyperlink'),
  diameter: msgc('tool', 'Diameter'),
  radius: msgc('tool', 'Radius'),
  arcLength: msgc('tool', 'Arc Length'),
  volume: msgc('tool', 'Volume'),
  length: msgc('tool', 'Length'),
  polylength: msgc('tool', 'Polylength'),
  area: msgc('tool', 'Area'),
  perimeter: msgc('tool', 'Perimeter'),
  count: msgc('tool', 'Count'),
  manual: msgc('tool', 'Manual'),
  angle: msgc('tool', 'Angle'),
}));

/** A CAD Modify tool's name. */
export const cadToolName = cached<CadTool>(() => ({
  move: msgc('tool', 'Move'),
  copy: msgc('tool', 'Copy by Base Point'),
  scale: msgc('tool', 'Scale'),
  trim: msgc('tool', 'Trim'),
  extend: msgc('tool', 'Extend'),
  break: msgc('tool', 'Break'),
  lengthen: msgc('tool', 'Lengthen'),
  fillet: msgc('tool', 'Fillet'),
  chamfer: msgc('tool', 'Chamfer'),
  mirror: msgc('tool', 'Mirror'),
  arrayPolar: msgc('tool', 'Polar Array'),
  arrayPath: msgc('tool', 'Path Array'),
  divide: msgc('tool', 'Divide / Measure'),
  rotateRef: msgc('tool', 'Rotate'),
  align: msgc('tool', 'Align to Points'),
  stretch: msgc('tool', 'Stretch'),
}));

/** The names of tools that do not draw a markup (Select, Calibrate, Lasso…), apart from the CAD tools. */
export const otherToolName = cached<OtherTool>(() => ({
  select: msgc('tool', 'Select'),
  calibrate: msgc('tool', 'Calibrate'),
  labelRegion: msgc('tool', 'Page Label Region'),
  lasso: msgc('tool', 'Lasso'),
  painter: msgc('tool', 'Format Painter'),
  cloudPlus: msgc('tool', 'Cloud+'),
  eraser: msgc('tool', 'Eraser'),
  offset: msgc('tool', 'Offset'),
  cutout: msgc('tool', 'Cutout'),
  viewport: msgc('tool', 'Viewport'),
  dynamicFill: msgc('tool', 'Smart Fill'),
  visualSearch: msgc('tool', 'Symbol Search'),
  cropArea: msgc('tool', 'Crop Area'),
  cropImage: msgc('tool', 'Crop Image'),
  eraseContent: msgc('tool', 'Erase Content'),
  selectText: msgc('tool', 'Select Text'),
  editText: msgc('tool', 'Edit Text'),
  formField: msgc('tool', 'Form Field'),
  snapshot: msgc('tool', 'Snapshot'),
  cutContent: msgc('tool', 'Cut Content'),
  scaleLength: msgc('tool', 'Scale to Length'),
  matchLine: msgc('tool', 'Match Line'),
  stitchRegion: msgc('tool', 'Stitch Region'),
  stitchPolygon: msgc('tool', 'Stitch Region (Polygon)'),
  portalPolygon: msgc('tool', 'Define Portal'),
  stitchMove: msgc('tool', 'Move Sheet'),
  pan: msgc('tool', 'Pan'),
  zoomBox: msgc('tool', 'Zoom'),
  dynamicZoom: msgc('tool', 'Dynamic Zoom'),
}));

/** A flowchart shape's name. */
export const flowShapeName = cached<FlowShapeKind>(() => ({
  process: msgc('flowchart shape', 'Process'),
  decision: msgc('flowchart shape', 'Decision'),
  terminator: msgc('flowchart shape', 'Start / End'),
  data: msgc('flowchart shape', 'Data'),
  document: msgc('flowchart shape', 'Document'),
  predefined: msgc('flowchart shape', 'Subprocess'),
  preparation: msgc('flowchart shape', 'Preparation'),
  manualInput: msgc('flowchart shape', 'Manual Input'),
  database: msgc('flowchart shape', 'Database'),
  circle: msgc('flowchart shape', 'On-page Reference'),
}));


/** A length unit's name, with its symbol: 'Metres (m)'. */
export const lengthUnitName = cached<LengthUnit>(() => ({
  mm: msg('Millimetres (mm)'),
  cm: msg('Centimetres (cm)'),
  m: msg('Metres (m)'),
  km: msg('Kilometres (km)'),
  in: msg('Inches (in)'),
  ft: msg('Feet (ft)'),
  yd: msg('Yards (yd)'),
  mi: msg('Miles (mi)'),
}));

/** A command category's name, as the command palette and Keyboard Shortcuts show it (the category itself stays English). */
export const categoryName = cached<CommandCategory>(() => ({
  File: msgc('command category', 'File'),
  Edit: msgc('command category', 'Edit'),
  View: msgc('command category', 'View'),
  Document: msgc('command category', 'Document'),
  Bulk: msgc('command category', 'Bulk'),
  Tools: msgc('command category', 'Tools'),
  Window: msgc('command category', 'Window'),
  Help: msgc('command category', 'Help'),
}));

/** A group of preset drawing scales. */
export const scaleGroupName = cached<ScalePreset['group']>(() => ({
  Architectural: msgc('scale group', 'Architectural'),
  Engineering: msgc('scale group', 'Engineering'),
  Metric: msgc('scale group', 'Metric'),
}));

/** A built-in line dash style. */
export const lineDashName = cached<LineDash>(() => ({
  solid: msgc('line style', 'Solid'),
  dashed: msgc('line style', 'Dashed'),
  longDash: msgc('line style', 'Long dash'),
  dotted: msgc('line style', 'Dotted'),
  dashDot: msgc('line style', 'Dash dot'),
  dashDotDot: msgc('line style', 'Dash dot dot'),
}));

/** A built-in count marker shape. */
export const countShapeName = cached<CountShape>(() => ({
  circle: msgc('count marker', 'Circle'),
  square: msgc('count marker', 'Square'),
  triangle: msgc('count marker', 'Triangle'),
  diamond: msgc('count marker', 'Diamond'),
  cross: msgc('count marker', 'Cross'),
  check: msgc('count marker', 'Checkmark'),
}));
