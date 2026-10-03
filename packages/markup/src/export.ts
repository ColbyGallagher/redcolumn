import { PDFArray, PDFContext, PDFDict, PDFDocument, PDFFont, PDFHexString, PDFImage, PDFName, PDFNull, PDFNumber, PDFPage, PDFRef, PDFString, StandardFonts, type PDFObject } from 'pdf-lib';

// pdf-lib does not export its literal dictionary type; recover it from a non-overloaded signature.
type LiteralObject = NonNullable<Parameters<PDFContext['flateStream']>[1]>;
import { AREA_LABELS, DEFAULT_SCALE, expandArcs, METERS_PER_UNIT, type Scale } from '@nb/measure';
import { markupShape, type PathCmd } from './geometry';
import { arcPoints } from './arc';
import { calloutLanding } from './callout';
import { markupLines } from './textSelect';
import { legendLayout, legendRows } from './legend';
import { stampLayout } from './stamp';
import { TYPE_INFO } from './types';
import { boundsOf, contentBox, isImageType, isMeasureKind, isTextType, markerSize, markupBounds, rotationCentre, type Markup, type MarkupStyle, type Point, type Reply } from './model';
import { dimensionText, measurementLabel, textBoxLines } from './render';
import { dashPattern, labelStyle, lineEnds, styleCapabilities, textColor, type FontFamily, type LineEnding } from './style';
import type { StoredLink } from './store';
import type { Bookmark, Place } from './bookmarks';
import { scaleOfMarkup, type Viewport } from './viewports';

/**
 * Key under which each exported annotation carries its markup's full data, so re-opening the file
 * here restores it exactly. Must match pdf-core's APP_DATA_KEY, which reads it back.
 */
const APP_DATA_KEY = 'NBData';

/** Affine [a b c d e f] mapping page space (top-left, y down, rotated) to PDF user space. */
export type Matrix = [number, number, number, number, number, number];

export function applyMatrix(m: Matrix, p: Point): Point {
  return apply(m, p);
}

function apply(m: Matrix, [u, v]: Point): Point {
  return [m[0] * u + m[2] * v + m[4], m[1] * u + m[3] * v + m[5]];
}

/** Page space → user space for the page's crop box and /Rotate, matching how PDFium lays pages out. */
export function pageMatrix(page: PDFPage): Matrix {
  const { x, y, width, height } = page.getCropBox();
  const x1 = x + width;
  const y1 = y + height;
  switch (((page.getRotation().angle % 360) + 360) % 360) {
    case 90:
      return [0, 1, 1, 0, x, y];
    case 180:
      return [-1, 0, 0, 1, x1, y];
    case 270:
      return [0, -1, -1, 0, x1, y1];
    default:
      return [1, 0, 0, -1, x, y1];
  }
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', '').padEnd(6, '0').slice(0, 6), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const fmt = (n: number) => (Math.round(n * 1000) / 1000).toString();

function pathOps(path: PathCmd[]): string {
  return path
    .map((c) => {
      if (c[0] === 'M') return `${fmt(c[1])} ${fmt(c[2])} m`;
      if (c[0] === 'L') return `${fmt(c[1])} ${fmt(c[2])} l`;
      if (c[0] === 'C') return `${c.slice(1).map((n) => fmt(n as number)).join(' ')} c`;
      return 'h';
    })
    .join('\n');
}

function pdfText(s: string) {
  // PDFHexString.fromText writes UTF-16BE, which every viewer decodes for text strings.
  return PDFHexString.fromText(s);
}

function pdfDate(ms: number) {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return PDFString.of(`D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`);
}

/** The standard 14 font for a family and weight/slant, so exports need no embedded font files. */
const STANDARD_FONTS: Record<FontFamily, [StandardFonts, StandardFonts, StandardFonts, StandardFonts]> = {
  sans: [StandardFonts.Helvetica, StandardFonts.HelveticaBold, StandardFonts.HelveticaOblique, StandardFonts.HelveticaBoldOblique],
  serif: [StandardFonts.TimesRoman, StandardFonts.TimesRomanBold, StandardFonts.TimesRomanItalic, StandardFonts.TimesRomanBoldItalic],
  mono: [StandardFonts.Courier, StandardFonts.CourierBold, StandardFonts.CourierOblique, StandardFonts.CourierBoldOblique],
};

/** Acrobat's default-resource names for each family, used in FreeText /DA strings. */
const DA_FONT_NAMES: Record<FontFamily, string> = { sans: 'Helv', serif: 'TiRo', mono: 'Cour' };

function standardFont(style: MarkupStyle, measure: boolean): StandardFonts {
  const bold = style.bold ?? measure;
  return STANDARD_FONTS[style.fontFamily ?? 'sans'][(bold ? 1 : 0) + (style.italic ? 2 : 0)]!;
}

/** Encodes text for a standard font, replacing characters WinAnsi cannot represent. */
function safeText(font: PDFFont, s: string): string {
  const supported = new Set(font.getCharacterSet());
  return [...s].map((ch) => (supported.has(ch.codePointAt(0)!) ? ch : '?')).join('');
}

interface Ctx {
  doc: PDFDocument;
  page: PDFPage;
  matrix: Matrix;
  fonts: Map<StandardFonts, PDFFont>;
  /** Embedded markup images (signatures) by data URL. */
  images: Map<string, PDFImage>;
  scale: Scale;
  /** Every markup being exported and each page's scale, for legends. */
  all: readonly Markup[];
  scaleFor: (pageIndex: number) => Scale;
  scaleOf: (m: Markup) => Scale;
  /** Every page, for hyperlink destinations. */
  pages: PDFPage[];
  /** Named destination written for each Place, by Place id. */
  placeNames: Map<string, string>;
}

/** Embeds a PNG or JPEG data URL; null for anything else. */
async function embedDataUrl(doc: PDFDocument, url: string): Promise<PDFImage | null> {
  const m = /^data:image\/(png|jpe?g);base64,(.*)$/i.exec(url);
  if (!m) return null;
  const bin = atob(m[2]!);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  try {
    return m[1]!.toLowerCase() === 'png' ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
  } catch {
    return null;
  }
}

/** PDF measurement dictionary (rectilinear) so other viewers can re-measure at the same scale. */
function measureDict(scale: Scale): LiteralObject {
  const format = (unit: string, factor: number) => ({ Type: 'NumberFormat', U: PDFString.of(unit), C: factor, D: 100 });
  const unitsPerPoint = scale.metersPerPoint / METERS_PER_UNIT[scale.unit];
  return {
    Type: 'Measure',
    Subtype: 'RL',
    R: PDFString.of(scale.label),
    X: [format(scale.unit, unitsPerPoint)],
    D: [format(scale.unit, 1)],
    A: [format(AREA_LABELS[scale.unit], 1)],
  };
}

const dashOp = (dash: number[]) => `[${dash.map(fmt).join(' ')}] 0 d`;

function underlineOps(x: number, y: number, w: number, size: number): string {
  return `${fmt(Math.max(size * 0.06, 0.25))} w 0 J [] 0 d ${fmt(x)} ${fmt(y)} m ${fmt(x + w)} ${fmt(y)} l S`;
}

function appearance(ctx: Ctx, m: Markup, rect: [number, number, number, number]): PDFRef {
  const { doc, matrix } = ctx;
  const { style } = m;
  const fillAlpha = style.opacity * (style.fillOpacity ?? 1);
  const [sr, sg, sb] = rgb(style.stroke);
  const [tr, tg, tb] = rgb(textColor(style));
  const dash = dashPattern(style.dash, style.width);
  const ops: string[] = ['q', `${matrix.map(fmt).join(' ')} cm`];
  if (m.rotation) {
    // Turn about the box's centre in page space (clockwise, as y points down).
    const [cx, cy] = rotationCentre(m);
    const a = (m.rotation * Math.PI) / 180;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    ops.push(`${[cos, sin, -sin, cos, cx - cx * cos + cy * sin, cy - cx * sin - cy * cos].map(fmt).join(' ')} cm`);
  }
  ops.push('/GS0 gs', `${fmt(style.width)} w`, '1 J 1 j', `${fmt(sr)} ${fmt(sg)} ${fmt(sb)} RG`);
  if (m.type === 'highlighter') ops.push('0 J');
  for (const part of markupShape(m)) {
    if (part.clip) {
      ops.push('q', pathOps(part.clip), part.evenOdd ? 'W* n' : 'W n', `${fmt(style.width / 2)} w [] 0 d`, pathOps(part.path), 'S', 'Q');
      continue;
    }
    ops.push(part.decoration ? '/GSD gs [] 0 d' : `/GS0 gs ${dashOp(dash)}`);
    ops.push(pathOps(part.path));
    if (part.fill) {
      const [fr, fg, fb] = rgb(part.fill);
      ops.push(`${fmt(fr)} ${fmt(fg)} ${fmt(fb)} rg`);
    }
    const star = part.evenOdd ? '*' : '';
    ops.push(part.fill && part.stroke ? `B${star}` : part.fill ? `f${star}` : part.stroke ? 'S' : 'n');
  }
  ops.push('[] 0 d');

  const resources: LiteralObject = {
    ExtGState: {
      GS0: { Type: 'ExtGState', CA: style.opacity, ca: fillAlpha, ...(TYPE_INFO[m.type].multiply ? { BM: 'Multiply' } : {}) },
      GSD: { Type: 'ExtGState', CA: style.opacity, ca: style.opacity },
      GS1: { Type: 'ExtGState', CA: style.opacity, ca: style.opacity },
      GSL: { Type: 'ExtGState', CA: 0.85 * style.opacity, ca: 0.85 * style.opacity },
    },
  };

  const label = measurementLabel(m, ctx.scale);
  if (label) {
    const font = ctx.fonts.get(standardFont(style, true))!;
    const { size, background } = labelStyle(m);
    const text = safeText(font, label.text);
    const textW = font.widthOfTextAtSize(text, size);
    const w = textW + size * 0.6;
    const h = size * 1.4;
    const [x, y] = label.at;
    if (background) {
      const [br, bg, bb] = rgb(background);
      ops.push(`/GSL gs ${fmt(br)} ${fmt(bg)} ${fmt(bb)} rg`, `${fmt(x - w / 2)} ${fmt(y - h / 2)} ${fmt(w)} ${fmt(h)} re f`);
    }
    ops.push(
      '/GS1 gs',
      `${fmt(tr)} ${fmt(tg)} ${fmt(tb)} rg`,
      'BT',
      `/F0 ${fmt(size)} Tf`,
      // Page space is y-down; flip the text matrix so glyphs stay upright. Baseline sits ~0.35em
      // below the label's vertical center.
      `1 0 0 -1 ${fmt(x - textW / 2)} ${fmt(y + size * 0.35)} Tm`,
      `${font.encodeText(text).toString()} Tj`,
      'ET',
    );
    if (style.underline) ops.push(`${fmt(tr)} ${fmt(tg)} ${fmt(tb)} RG`, underlineOps(x - textW / 2, y + size * 0.45, textW, size));
    resources.Font = { F0: font.ref };
  }

  const dim = dimensionText(m);
  if (dim) {
    const font = ctx.fonts.get(standardFont(style, false))!;
    const text = safeText(font, dim.text);
    const w = font.widthOfTextAtSize(text, dim.size);
    const cos = Math.cos(dim.angle);
    const sin = Math.sin(dim.angle);
    // Centred on its point along the line, the baseline just above it; glyphs flipped upright.
    const x = dim.at[0] - (w / 2) * cos;
    const y = dim.at[1] - (w / 2) * sin;
    ops.push('/GS1 gs', `${fmt(tr)} ${fmt(tg)} ${fmt(tb)} rg`, 'BT', `/F0 ${fmt(dim.size)} Tf`, `${[cos, sin, sin, -cos, x, y].map(fmt).join(' ')} Tm`, `${font.encodeText(text).toString()} Tj`, 'ET');
    resources.Font = { F0: font.ref };
  }

  const image = isImageType(m.type) && m.image ? ctx.images.get(m.image) : undefined;
  if (image) {
    const b = boundsOf(m.points);
    // Image space is a unit square with y up; page space is y down.
    ops.push('q /GS1 gs', `${fmt(b.w)} 0 0 ${fmt(-b.h)} ${fmt(b.x)} ${fmt(b.y + b.h)} cm`, '/Im0 Do', 'Q');
    resources.XObject = { Im0: image.ref };
  }

  if (isTextType(m.type) && m.text) {
    const font = ctx.fonts.get(standardFont(style, false))!;
    const b = contentBox(m);
    const size = style.fontSize ?? 12;
    const lines = textBoxLines({ ...m, text: safeText(font, m.text) }, (s) => font.widthOfTextAtSize(s, size));
    const ascent = font.heightAtSize(size, { descender: false });
    ops.push('/GS1 gs', `${fmt(tr)} ${fmt(tg)} ${fmt(tb)} rg`, `${fmt(b.x)} ${fmt(b.y)} ${fmt(b.w)} ${fmt(b.h)} re W n`, 'BT', `/F0 ${fmt(size)} Tf`);
    for (const line of lines) {
      // Page space is y-down; flip the text matrix so glyphs stay upright.
      ops.push(`1 0 0 -1 ${fmt(line.x)} ${fmt(line.y + ascent)} Tm`, `${font.encodeText(line.text).toString()} Tj`);
    }
    ops.push('ET');
    if (style.underline) {
      ops.push(`${fmt(tr)} ${fmt(tg)} ${fmt(tb)} RG`);
      for (const line of lines) if (line.text) ops.push(underlineOps(line.x, line.y + size * 0.98, line.width, size));
    }
    resources.Font = { F0: font.ref };
  }

  if (m.type === 'stamp' && m.stamp) {
    const bold = ctx.fonts.get(StandardFonts.HelveticaBold)!;
    const regular = ctx.fonts.get(StandardFonts.Helvetica)!;
    const [sr, sg, sb] = rgb(style.stroke);
    const lines = stampLayout(boundsOf(m.points), m.stamp, (s, b) => (b ? bold : regular).widthOfTextAtSize(safeText(b ? bold : regular, s), 1));
    ops.push('/GS1 gs', `${fmt(sr)} ${fmt(sg)} ${fmt(sb)} rg`, 'BT');
    for (const line of lines) {
      const font = line.bold ? bold : regular;
      const t = safeText(font, line.text);
      const w = font.widthOfTextAtSize(t, line.size);
      // Centred on its point; the baseline sits about a third of the size below the middle.
      ops.push(`/${line.bold ? 'F1' : 'F0'} ${fmt(line.size)} Tf`, `1 0 0 -1 ${fmt(line.x - w / 2)} ${fmt(line.y + line.size * 0.35)} Tm`, `${font.encodeText(t).toString()} Tj`);
    }
    ops.push('ET');
    resources.Font = { F0: regular.ref, F1: bold.ref };
  }

  if (m.type === 'legend') {
    // Title and one band per row: a swatch in the row's colour, its name, quantity and total.
    const font = ctx.fonts.get(standardFont(style, false))!;
    const rows = legendRows(m, ctx.all, ctx.scaleFor, ctx.scaleOf);
    const L = legendLayout(m, Math.max(rows.length, 1));
    const size = L.fontSize;
    const baseline = (y: number, h: number) => y + h / 2 + size * 0.35;
    const text = (s: string, x: number, y: number, align: 'left' | 'right') => {
      const t = safeText(font, s);
      const w = font.widthOfTextAtSize(t, size);
      ops.push(`1 0 0 -1 ${fmt(align === 'right' ? x - w : x)} ${fmt(y)} Tm`, `${font.encodeText(t).toString()} Tj`);
    };
    const bandH = L.rows[0]!.h;
    ops.push('/GS1 gs', `${fmt(L.box.x)} ${fmt(L.box.y)} ${fmt(L.box.w)} ${fmt(L.box.h)} re W n`);
    for (const [i, row] of rows.entries()) {
      const r = L.rows[i]!;
      const [cr, cg, cb] = rgb(row.sample.style.stroke);
      const [fr, fg, fb] = rgb(row.sample.style.fill ?? row.sample.style.stroke);
      ops.push(`${fmt(fr)} ${fmt(fg)} ${fmt(fb)} rg ${fmt(cr)} ${fmt(cg)} ${fmt(cb)} RG 0.5 w`, `${fmt(r.symbol.x)} ${fmt(r.symbol.y)} ${fmt(r.symbol.w)} ${fmt(r.symbol.h)} re B`);
    }
    ops.push(`${fmt(tr)} ${fmt(tg)} ${fmt(tb)} rg`, 'BT', `/F0 ${fmt(size)} Tf`);
    text('Legend', L.title.x, baseline(L.box.y, bandH), 'left');
    rows.forEach((row, i) => {
      const r = L.rows[i]!;
      text(row.label, r.labelX, baseline(r.y, r.h), 'left');
      text(String(row.count), r.countX, baseline(r.y, r.h), 'right');
      if (row.measure) text(row.measure, r.measureX, baseline(r.y, r.h), 'right');
    });
    ops.push('ET');
    resources.Font = { F0: font.ref };
  }
  ops.push('Q');

  const stream = doc.context.flateStream(ops.join('\n'), {
    Type: 'XObject',
    Subtype: 'Form',
    BBox: rect,
    Resources: resources,
  });
  return doc.context.register(stream);
}

/** PDF line ending names (ISO 32000 table 176) for each of ours. */
const PDF_LINE_ENDINGS: Record<LineEnding, string> = {
  none: 'None',
  openArrow: 'OpenArrow',
  closedArrow: 'ClosedArrow',
  filledArrow: 'ClosedArrow',
  circle: 'Circle',
  filledCircle: 'Circle',
  square: 'Square',
  filledSquare: 'Square',
  diamond: 'Diamond',
  filledDiamond: 'Diamond',
  tick: 'Butt',
  slash: 'Slash',
};

function annotationDict(ctx: Ctx, m: Markup): PDFDict {
  const { doc, matrix } = ctx;
  const b = markupBounds(m);
  const corners = [apply(matrix, [b.x, b.y]), apply(matrix, [b.x + b.w, b.y + b.h])];
  const rect: [number, number, number, number] = [
    Math.min(corners[0]![0], corners[1]![0]),
    Math.min(corners[0]![1], corners[1]![1]),
    Math.max(corners[0]![0], corners[1]![0]),
    Math.max(corners[0]![1], corners[1]![1]),
  ];
  const user = m.points.map((p) => apply(matrix, p));
  const flat = (pts: Point[]) => pts.flatMap(([x, y]) => [x, y]);
  // Arc segments go out as short straight ones (other readers see the shape; ours read NBData).
  const curved = (closed: boolean): Point[] => (m.bulges?.some(Boolean) ? expandArcs(m.points, m.bulges, closed).map((p) => apply(matrix, p)) : user);
  const color = rgb(m.style.stroke);
  const fill = m.style.fill ? rgb(m.style.fill) : null;
  // A boxless text box has no border for other readers to draw.
  const borderWidth = m.style.noBox && m.type === 'text' ? 0 : m.style.width;
  const dash = dashPattern(m.style.dash, m.style.width);
  const [startCap, endCap] = lineEnds(m);
  const le = [PDF_LINE_ENDINGS[startCap], PDF_LINE_ENDINGS[endCap]];
  const filledEnd = [startCap, endCap].some((c) => c.startsWith('filled'));

  const base: LiteralObject = {
    Type: 'Annot',
    Rect: rect,
    F: (m.hidden ? 2 : 4) | (m.locked ? 128 : 0), // Print (Hidden when hidden), and Locked when locked
    C: color,
    CA: m.style.opacity,
    BS: dash.length ? { Type: 'Border', W: borderWidth, S: 'D', D: dash } : { Type: 'Border', W: borderWidth, S: 'S' },
    T: pdfText(m.author),
    NM: pdfText(m.id),
    M: pdfDate(m.modifiedAt),
    CreationDate: pdfDate(m.createdAt),
    AP: { N: appearance(ctx, m, rect) },
    // An attachment's bytes live once, in its embedded file, not in the data copy too.
    [APP_DATA_KEY]: pdfText(JSON.stringify(m.attachment ? { ...m, attachment: { ...m.attachment, data: '' } } : m)),
  };
  const label = measurementLabel(m, ctx.scale);
  const signed = m.signature ? `Signed by ${m.signature.signer} on ${new Date(m.signature.signedAt).toLocaleString()}${m.signature.reason ? ` (${m.signature.reason})` : ''}` : null;
  const contents = isTextType(m.type) || m.type === 'dimension' || m.type === 'replaceText' ? [m.text, m.type === 'replaceText' ? m.comment : null].filter(Boolean).join(' — ') : [signed, label?.text, m.comment].filter(Boolean).join(' — ');
  if (m.subject) base.Subj = pdfText(m.subject);
  if (contents) base.Contents = pdfText(contents);
  if (fill) base.IC = fill;

  const ub = boundsOf(user);
  // Rect is padded for stroke width and decorations; RD (left, top, right, bottom) tells editors
  // where the shape's own box sits inside it.
  const rd = [ub.x - rect[0], rect[3] - (ub.y + ub.h), rect[2] - (ub.x + ub.w), ub.y - rect[1]];
  let specific: LiteralObject;
  switch (m.type) {
    case 'line':
    case 'arrow':
      specific = {
        Subtype: 'Line',
        L: flat(user.slice(0, 2)),
        LE: le,
        ...(filledEnd ? { IC: color } : {}),
      };
      break;
    case 'polyline':
      specific = { Subtype: 'PolyLine', Vertices: flat(user), LE: le, ...(filledEnd ? { IC: color } : {}) };
      break;
    case 'arc':
      // PDF has no arc annotation; a polyline along the curve keeps its look in other viewers.
      specific = { Subtype: 'PolyLine', Vertices: flat(arcPoints(m.points, 24).map((p) => apply(matrix, p))), LE: le, ...(filledEnd ? { IC: color } : {}) };
      break;
    case 'polygon':
      specific = { Subtype: 'Polygon', Vertices: flat(user) };
      break;
    case 'note':
      // A sticky note: /Contents holds the comment; the icon is our appearance stream.
      specific = { Subtype: 'Text', Name: 'Comment', ...(fill ? { C: fill } : {}) };
      break;
    case 'image':
      specific = { Subtype: 'Stamp', Name: 'Image' };
      break;
    case 'rect':
      specific = { Subtype: 'Square', RD: rd };
      break;
    case 'ellipse':
      specific = { Subtype: 'Circle', RD: rd };
      break;
    case 'cloud': {
      // Other PDF markup tools model clouds as polygons with a cloudy border effect.
      const box = boundsOf(m.points);
      const verts = [
        [box.x, box.y],
        [box.x + box.w, box.y],
        [box.x + box.w, box.y + box.h],
        [box.x, box.y + box.h],
      ].map((p) => apply(matrix, p as Point));
      specific = { Subtype: 'Polygon', Vertices: flat(verts), BE: { S: 'C', I: 1 }, IT: 'PolygonCloud' };
      break;
    }
    case 'pen':
    case 'highlighter':
      specific = { Subtype: 'Ink', InkList: [flat(user)] };
      break;
    case 'textHighlight':
    case 'underline':
    case 'strikeout':
    case 'squiggly': {
      // One quadrilateral per line: upper left, upper right, lower left, lower right.
      const quads = markupLines(m.points).flatMap((r) =>
        flat([[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]].map((p) => apply(matrix, p as Point))),
      );
      const subtype = { textHighlight: 'Highlight', underline: 'Underline', strikeout: 'StrikeOut', squiggly: 'Squiggly' }[m.type];
      specific = { Subtype: subtype, QuadPoints: quads };
      break;
    }
    case 'length':
      specific = { Subtype: 'Line', L: flat(user.slice(0, 2)), LE: le, IT: 'LineDimension', Measure: measureDict(ctx.scale) };
      break;
    case 'dimension':
      specific = { Subtype: 'Line', L: flat(user.slice(0, 2)), LE: le, Cap: true, ...(filledEnd ? { IC: color } : {}) };
      break;
    case 'replaceText': {
      const quads = markupLines(m.points).flatMap((r) =>
        flat([[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]].map((p) => apply(matrix, p as Point))),
      );
      specific = { Subtype: 'StrikeOut', QuadPoints: quads, IT: 'StrikeOutTextEdit' };
      break;
    }
    case 'flag':
      specific = { Subtype: 'Text', Name: 'Flag', ...(fill ? { C: fill } : {}) };
      break;
    case 'attachment': {
      const a = m.attachment;
      specific = { Subtype: 'FileAttachment', Name: 'Paperclip' };
      if (a) {
        const bin = atob(a.data);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const file = doc.context.register(doc.context.flateStream(bytes, { Type: 'EmbeddedFile', Subtype: a.mime || 'application/octet-stream', Params: { Size: bytes.length } }));
        specific.FS = doc.context.obj({ Type: 'Filespec', F: pdfText(a.name), UF: pdfText(a.name), Desc: pdfText(a.name), EF: { F: file } });
      }
      break;
    }
    case 'polylength':
    case 'angle':
      specific = {
        Subtype: 'PolyLine',
        Vertices: flat(curved(false)),
        ...(m.type === 'polylength' ? { IT: 'PolyLineDimension', Measure: measureDict(ctx.scale), LE: le } : {}),
      };
      break;
    case 'area':
    case 'perimeter':
    case 'volume':
      specific = { Subtype: 'Polygon', Vertices: flat(curved(true)), IT: 'PolygonDimension', Measure: measureDict(ctx.scale) };
      break;
    case 'redaction':
      // A standard redaction mark: other tools can apply it too. IC is the colour it leaves.
      specific = { Subtype: 'Redact', QuadPoints: [rect[0], rect[3], rect[2], rect[3], rect[0], rect[1], rect[2], rect[1]], IC: fill ?? [0, 0, 0] };
      break;
    case 'space':
      specific = { Subtype: 'Polygon', Vertices: flat(user) };
      base.Contents = pdfText(`Space: ${m.subject || 'Space'}`);
      break;
    case 'diameter':
    case 'radius':
      // Other tools see the circle; ours come back as the measurement from NBData.
      specific = { Subtype: 'Circle', RD: rd, Measure: measureDict(ctx.scale) };
      break;
    case 'arcLength':
      specific = { Subtype: 'PolyLine', Vertices: flat(arcPoints(m.points).map((p) => apply(matrix, p))), IT: 'PolyLineDimension', Measure: measureDict(ctx.scale), LE: le };
      break;
    case 'count': {
      // No standard count annotation; each item is an ink circle so the markers survive round trips.
      const r = markerSize(m);
      const circles = m.points.map(([cx, cy]) =>
        flat(Array.from({ length: 17 }, (_, i) => apply(matrix, [cx + r * Math.cos((i / 16) * 2 * Math.PI), cy + r * Math.sin((i / 16) * 2 * Math.PI)]))),
      );
      specific = { Subtype: 'Ink', InkList: circles };
      break;
    }
    case 'signature':
      specific = { Subtype: 'Stamp', Name: 'Signature' };
      break;
    case 'text':
    case 'typewriter': {
      const [r, g, bl] = rgb(textColor(m.style));
      const font = DA_FONT_NAMES[m.style.fontFamily ?? 'sans'];
      specific = {
        Subtype: 'FreeText',
        RD: rd,
        DA: PDFString.of(`/${font} ${m.style.fontSize ?? 12} Tf ${fmt(r)} ${fmt(g)} ${fmt(bl)} rg`),
        Q: m.style.textAlign === 'center' ? 1 : m.style.textAlign === 'right' ? 2 : 0,
        ...(m.type === 'typewriter' ? { IT: 'FreeTextTypeWriter' } : {}),
      };
      break;
    }
    case 'stamp':
      specific = { Subtype: 'Stamp', Name: (m.stamp?.lines[0] ?? 'Stamp').replace(/[^A-Za-z0-9]+/g, '') || 'Stamp' };
      base.Contents = pdfText([...(m.stamp?.lines ?? []), m.comment].filter(Boolean).join('\n'));
      break;
    case 'hyperlink': {
      // A standard link; ours come back as the markup (with its action) from NBData.
      specific = { Subtype: 'Link', H: 'I', Border: [0, 0, m.style.width] };
      const a = m.link;
      if (a?.kind === 'url') specific.A = { S: 'URI', URI: PDFString.of(a.url) };
      // Another file, next to this one: page numbers count from 0 in a remote destination.
      else if (a?.kind === 'file') specific.A = { S: 'GoToR', F: PDFString.of(a.name), D: [a.pageIndex, 'Fit'], NewWindow: false };
      else if (a?.kind === 'place') {
        const name = ctx.placeNames.get(a.placeId);
        if (name) specific.Dest = PDFName.of(name);
      } else if (a?.kind === 'page') {
        const dest = destArray(ctx.pages, a.pageIndex, a.rect);
        if (dest) specific.Dest = dest;
      }
      break;
    }
    case 'legend': {
      // Other tools see a text box listing the rows; ours come back as a live legend.
      const rows = legendRows(m, ctx.all, ctx.scaleFor, ctx.scaleOf);
      base.Contents = pdfText(['Legend', ...rows.map((r) => `${r.label}: ${r.count}${r.measure ? ` (${r.measure})` : ''}`)].join('\n'));
      specific = { Subtype: 'FreeText', RD: rd, DA: PDFString.of(`/Helv ${m.style.fontSize ?? 10} Tf 0 0 0 rg`) };
      break;
    }
    case 'callout': {
      const [r, g, bl] = rgb(textColor(m.style));
      const font = DA_FONT_NAMES[m.style.fontFamily ?? 'sans'];
      const box = contentBox(m);
      const corners = [apply(matrix, [box.x, box.y]), apply(matrix, [box.x + box.w, box.y + box.h])];
      const bx = [Math.min(corners[0]![0], corners[1]![0]), Math.min(corners[0]![1], corners[1]![1]), Math.max(corners[0]![0], corners[1]![0]), Math.max(corners[0]![1], corners[1]![1])] as const;
      const land = m.points.length >= 4 ? calloutLanding(m.points[1]!, box) : null;
      const leader = land ? [m.points[0]!, land.knee, land.attach] : m.points.slice(0, 2);
      specific = {
        Subtype: 'FreeText',
        IT: 'FreeTextCallout',
        // The text box inside Rect (left, top, right, bottom insets); the leader fills the rest.
        RD: [bx[0] - rect[0], rect[3] - bx[3], rect[2] - bx[2], bx[1] - rect[1]],
        CL: flat(leader.map((p) => apply(matrix, p))),
        LE: PDF_LINE_ENDINGS[startCap],
        DA: PDFString.of(`/${font} ${m.style.fontSize ?? 12} Tf ${fmt(r)} ${fmt(g)} ${fmt(bl)} rg`),
        Q: m.style.textAlign === 'center' ? 1 : m.style.textAlign === 'right' ? 2 : 0,
      };
      break;
    }
  }
  // context.obj converts plain strings to PDF names (Subtype, LE, ...), arrays and numbers as-is.
  return doc.context.obj({ ...base, ...specific });
}

/**
 * A reply as other PDF tools write one: a Text annotation "in reply to" its markup, with no icon
 * of its own. Our own data key marks it so re-opening the file does not make it a sticky note.
 */
function replyDict(doc: PDFDocument, parent: PDFRef, m: Markup, r: Reply): PDFDict {
  const rect = [0, 0, 0, 0];
  const empty = doc.context.register(doc.context.flateStream('', { Type: 'XObject', Subtype: 'Form', BBox: rect }));
  return doc.context.obj({
    Type: 'Annot',
    Subtype: 'Text',
    Rect: rect,
    F: 4 | 8 | 16, // Print, NoZoom, NoRotate: shown only in comment lists
    IRT: parent,
    RT: 'R',
    T: pdfText(r.author),
    Contents: pdfText(r.text),
    NM: pdfText(r.id),
    M: pdfDate(r.createdAt),
    CreationDate: pdfDate(r.createdAt),
    AP: { N: empty },
    [APP_DATA_KEY]: pdfText(JSON.stringify({ replyTo: m.id })),
  });
}

/** Page-space rect → [left, bottom, right, top] in the page's user space. */
function userRect(matrix: Matrix, r: { x: number; y: number; w: number; h: number }): [number, number, number, number] {
  const a = apply(matrix, [r.x, r.y]);
  const b = apply(matrix, [r.x + r.w, r.y + r.h]);
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
}

/** An explicit destination: an area (FitR), a top-left point (XYZ), or the whole page (Fit). */
function destArray(pages: PDFPage[], pageIndex: number, rect: { x: number; y: number; w: number; h: number } | null): PDFObject[] | null {
  const page = pages[pageIndex];
  if (!page) return null;
  const m = pageMatrix(page);
  if (rect && rect.w > 0 && rect.h > 0) return [page.ref, PDFName.of('FitR'), ...userRect(m, rect).map((n) => PDFNumber.of(n))];
  if (rect) {
    const [x, y] = apply(m, [rect.x, rect.y]);
    return [page.ref, PDFName.of('XYZ'), PDFNumber.of(x), PDFNumber.of(y), PDFNull];
  }
  return [page.ref, PDFName.of('Fit')];
}

/**
 * Places as named destinations in the catalog's /Dests dictionary (kept alongside any the file
 * already has). Returns the name written for each Place id.
 */
function addPlaces(doc: PDFDocument, pages: PDFPage[], places: readonly Place[]): Map<string, string> {
  const names = new Map<string, string>();
  if (!places.length) return names;
  const existing = doc.catalog.lookupMaybe(PDFName.of('Dests'), PDFDict);
  const dests = existing ?? doc.context.obj({});
  const used = new Set<string>();
  for (const p of places) {
    const dest = destArray(pages, p.pageIndex, p.rect);
    if (!dest) continue;
    let name = p.name.trim() || 'Place';
    for (let i = 2; used.has(name); i++) name = `${p.name.trim() || 'Place'} (${i})`;
    used.add(name);
    names.set(p.id, name);
    dests.set(PDFName.of(name), doc.context.obj(dest));
  }
  if (!existing) doc.catalog.set(PDFName.of('Dests'), doc.context.register(dests));
  return names;
}

/** Page labels as the catalog's /PageLabels number tree: one entry per page. */
export function writePageLabels(doc: PDFDocument, labels: readonly (string | null)[]) {
  const nums: PDFObject[] = [];
  labels.forEach((label, i) => {
    nums.push(PDFNumber.of(i));
    // A labelled page is all prefix; others keep their page number (decimal, starting at i + 1).
    nums.push(label ? doc.context.obj({ P: pdfText(label) }) : doc.context.obj({ S: 'D', St: i + 1 }));
  });
  doc.catalog.set(PDFName.of('PageLabels'), doc.context.obj({ Nums: nums }));
}

/** Bookmarks as the document outline (/Outlines), replacing any the file had. */
function writeOutline(doc: PDFDocument, pages: PDFPage[], bookmarks: readonly Bookmark[], placeNames: Map<string, string>) {
  if (!bookmarks.length) {
    doc.catalog.delete(PDFName.of('Outlines'));
    return;
  }
  const root = doc.context.nextRef();
  // Writes a level of items under `parent`; returns their refs and how many items are open below.
  const level = (items: readonly Bookmark[], parent: PDFRef): { refs: PDFRef[]; count: number } => {
    const refs = items.map(() => doc.context.nextRef());
    let count = 0;
    items.forEach((b, i) => {
      const kids = level(b.children, refs[i]!);
      const dict: Record<string, PDFObject> = { Title: pdfText(b.title), Parent: parent };
      const a = b.action;
      if (a?.kind === 'url') dict.A = doc.context.obj({ S: 'URI', URI: PDFString.of(a.url) });
      else if (a?.kind === 'file') dict.A = doc.context.obj({ S: 'GoToR', F: PDFString.of(a.name), D: [a.pageIndex, 'Fit'], NewWindow: false });
      else if (a?.kind === 'place' && placeNames.get(a.placeId)) dict.Dest = PDFName.of(placeNames.get(a.placeId)!);
      else {
        const dest = destArray(pages, b.pageIndex, b.rect);
        if (dest) dict.Dest = doc.context.obj(dest);
      }
      if (i > 0) dict.Prev = refs[i - 1]!;
      if (i < items.length - 1) dict.Next = refs[i + 1]!;
      if (kids.refs.length) {
        dict.First = kids.refs[0]!;
        dict.Last = kids.refs.at(-1)!;
        // Negative: closed, so new bookmark trees start collapsed.
        dict.Count = PDFNumber.of(-kids.refs.length);
      }
      doc.context.assign(refs[i]!, doc.context.obj(dict));
      count += 1;
    });
    return { refs, count };
  };
  const top = level(bookmarks, root);
  doc.context.assign(root, doc.context.obj({ Type: 'Outlines', First: top.refs[0]!, Last: top.refs.at(-1)!, Count: top.count }));
  doc.catalog.set(PDFName.of('Outlines'), root);
}

/**
 * Hyperlinks as standard /Link annotations with explicit destinations: zoomed to the referenced
 * detail when it was located, otherwise the whole target sheet.
 */
function addLinks(doc: PDFDocument, pages: PDFPage[], links: readonly StoredLink[]) {
  for (const link of links) {
    const page = pages[link.pageIndex];
    const target = pages[link.targetPage];
    if (!page || !target || link.status === 'rejected') continue;
    const dest = link.targetRect ? [target.ref, 'FitR', ...userRect(pageMatrix(target), link.targetRect)] : [target.ref, 'Fit'];
    const annot = doc.context.obj({
      Type: 'Annot',
      Subtype: 'Link',
      Rect: userRect(pageMatrix(page), link.rect),
      Border: [0, 0, 0],
      NM: pdfText(link.id),
      Dest: dest,
    });
    page.node.addAnnot(doc.context.register(annot));
  }
}

/** Removes annotations by /Annots index (they were imported and are rewritten from the store). */
function stripAnnotations(page: PDFPage, indices: readonly number[]) {
  const annots = page.node.Annots();
  if (!annots) return;
  for (const i of [...indices].sort((a, b) => b - a)) if (i < annots.size()) annots.remove(i);
}

export interface ExportOptions {
  /** Drawing scale per page, for measurement labels and /Measure dictionaries. */
  scaleFor?: (pageIndex: number) => Scale;
  /** Viewports: regions of pages with their own scale, which measurements inside them use. */
  viewports?: readonly Viewport[];
  /** Sheet hyperlinks to write as /Link annotations (rejected links are skipped). */
  links?: readonly StoredLink[];
  /** Named views that hyperlinks jump to, written as named destinations. */
  places?: readonly Place[];
  /**
   * A label per page (e.g. its sheet number), written as the /PageLabels tree so other readers show
   * it; null keeps that page's plain number. Leave unset to keep the file's own labels.
   */
  pageLabels?: readonly (string | null)[];
  /** The bookmark tree, written as the outline; leave unset to keep the file's own. */
  bookmarks?: readonly Bookmark[];
  /** The PDF's own annotations that were imported (by page, /Annots index): replaced, not duplicated. */
  imported?: Record<number, number[]>;
}

/**
 * An optional-content group (PDF layer) for each markup layer, added to the document's own
 * layers (a layer the file already has with that name is reused).
 */
function addMarkupLayers(doc: PDFDocument, markups: readonly Markup[]): Map<string, PDFRef> {
  const names = [...new Set(markups.flatMap((m) => (m.layer ? [m.layer] : [])))];
  const out = new Map<string, PDFRef>();
  if (!names.length) return out;
  let props = doc.catalog.lookupMaybe(PDFName.of('OCProperties'), PDFDict);
  if (!props) {
    props = doc.context.obj({ OCGs: [], D: { Order: [], ON: [], OFF: [] } });
    doc.catalog.set(PDFName.of('OCProperties'), props);
  }
  let ocgs = props.lookupMaybe(PDFName.of('OCGs'), PDFArray);
  if (!ocgs) {
    ocgs = doc.context.obj([]);
    props.set(PDFName.of('OCGs'), ocgs);
  }
  let d = props.lookupMaybe(PDFName.of('D'), PDFDict);
  if (!d) {
    d = doc.context.obj({});
    props.set(PDFName.of('D'), d);
  }
  let order = d.lookupMaybe(PDFName.of('Order'), PDFArray);
  if (!order) {
    order = doc.context.obj([]);
    d.set(PDFName.of('Order'), order);
  }
  const existing = new Map<string, PDFRef>();
  for (const x of ocgs.asArray()) {
    if (!(x instanceof PDFRef)) continue;
    const name = doc.context.lookupMaybe(x, PDFDict)?.lookupMaybe(PDFName.of('Name'), PDFString, PDFHexString)?.decodeText();
    if (name) existing.set(name, x);
  }
  for (const name of names) {
    let ref = existing.get(name);
    if (!ref) {
      ref = doc.context.register(doc.context.obj({ Type: 'OCG', Name: pdfText(name) }));
      ocgs.push(ref);
      order.push(ref);
    }
    out.set(name, ref);
  }
  return out;
}

/**
 * Returns a copy of `original` with `markups` written as standard PDF annotations, each with an
 * appearance stream so every viewer draws them identically, plus any hyperlinks.
 */
export async function exportWithAnnotations(original: ArrayBuffer, markups: readonly Markup[], options: ExportOptions = {}): Promise<Uint8Array> {
  const scaleFor = options.scaleFor ?? (() => DEFAULT_SCALE);
  const scaleOf = (m: Markup) => scaleOfMarkup(m, scaleFor(m.pageIndex), options.viewports ?? []);
  const doc = await PDFDocument.load(original, { updateMetadata: false });
  // Embed only the standard fonts some markup's text or label uses.
  const fonts = new Map<StandardFonts, PDFFont>();
  for (const m of markups) {
    // Stamps always letter in Helvetica, the headline bold.
    const names = m.type === 'stamp' ? [StandardFonts.HelveticaBold, StandardFonts.Helvetica] : styleCapabilities(m.type).font ? [standardFont(m.style, isMeasureKind(m.type))] : [];
    for (const name of names) if (!fonts.has(name)) fonts.set(name, await doc.embedFont(name));
  }
  const images = new Map<string, PDFImage>();
  for (const m of markups) {
    if (!isImageType(m.type) || !m.image || images.has(m.image)) continue;
    const img = await embedDataUrl(doc, m.image);
    if (img) images.set(m.image, img);
  }
  const pages = doc.getPages();
  for (const [pageIndex, indices] of Object.entries(options.imported ?? {})) {
    const page = pages[Number(pageIndex)];
    if (page) stripAnnotations(page, indices);
  }
  const placeNames = addPlaces(doc, pages, options.places ?? []);
  if (options.bookmarks) writeOutline(doc, pages, options.bookmarks, placeNames);
  if (options.pageLabels?.some((l) => l)) writePageLabels(doc, options.pageLabels);
  const byPage = new Map<number, Markup[]>();
  for (const m of markups) {
    if (!byPage.has(m.pageIndex)) byPage.set(m.pageIndex, []);
    byPage.get(m.pageIndex)!.push(m);
  }
  const layerRefs = addMarkupLayers(doc, markups);
  for (const [pageIndex, list] of byPage) {
    const page = pages[pageIndex];
    if (!page) continue;
    const ctx: Ctx = { doc, page, matrix: pageMatrix(page), fonts, images, scale: scaleFor(pageIndex), all: markups, scaleFor, scaleOf, pages, placeNames };
    for (const m of list.sort((a, b) => a.createdAt - b.createdAt)) {
      const dict = annotationDict({ ...ctx, scale: scaleOf(m) }, m);
      // Markups on a layer show and hide with it in other viewers too.
      const oc = m.layer ? layerRefs.get(m.layer) : undefined;
      if (oc) dict.set(PDFName.of('OC'), oc);
      const ref = doc.context.register(dict);
      page.node.addAnnot(ref);
      for (const r of m.replies ?? []) page.node.addAnnot(doc.context.register(replyDict(doc, ref, m, r)));
    }
  }
  if (options.links) addLinks(doc, pages, options.links);
  return doc.save();
}
