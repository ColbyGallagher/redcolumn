import { PDFArray, PDFBool, PDFContext, PDFDict, PDFDocument, PDFFont, PDFHexString, PDFImage, PDFName, PDFNull, PDFNumber, PDFPage, PDFRef, PDFStream, PDFString, StandardFonts, type PDFObject } from 'pdf-lib';

// pdf-lib does not export its literal dictionary type; recover it from a non-overloaded signature.
type LiteralObject = NonNullable<Parameters<PDFContext['flateStream']>[1]>;
import { areaLabelOf, areaUnitOf, DEFAULT_SCALE, expandArcs, METERS_PER_UNIT, volumeLabelOf, volumeUnitOf, type Scale } from '@nb/measure';
import { markupShape, type PathCmd } from './geometry';
import { lineStyleFonts, lineStyleReach, styledParts, type ArtText, type LineArt } from './lineStyle';
import { arcPoints, circleThrough } from './arc';
import { calloutLanding } from './callout';
import { markupLines } from './textSelect';
import { legendLayout, legendRows, legendSymbol } from './legend';
import { tableCells, tableCellText, tableSummary } from './table';
import { stampLayout, stampTick } from './stamp';
import { TYPE_INFO } from './types';
import { boundsOf, contentBox, isImageType, isMeasureKind, isTextType, markerSize, markupBounds, rotationCentre, threadReplies, type CountShape, type Markup, type MarkupStyle, type MarkupType, type Point, type Reply, type StatusChange } from './model';
import { dimensionText, measurementLabel, textBoxLines } from './render';
import { hatchDraw, resolveHatch, type HatchDraw } from './hatches';
import { dashPattern, HATCH_PATTERNS, labelStyle, lineEnds, styleCapabilities, textColor, type FontFamily, type LineEnding } from './style';
import type { StoredLink } from './store';
import type { Bookmark, Place } from './bookmarks';
import { scaleOfMarkup, type Viewport } from './viewports';
import { importViewports } from './bluebeam';
import { isGeoViewport } from './geo';
import type { CustomColumn, MarkupStatusDef } from './columns';
import type { Assembly } from './assemblies';
import { markupDigest, unchangedSinceImport } from './digest';
import { bsiLegendValue } from './bsiLegend';
import { defaultSubject } from './bluebeamTypes';
import { toPdfDict } from './pdfValue';

/**
 * Key under which each exported annotation carries its markup's full data, so re-opening the file
 * here restores it exactly. Must match pdf-core's APP_DATA_KEY, which reads it back.
 */
const APP_DATA_KEY = 'NBData';
/** The catalog key the document's assemblies are kept under (read back by `readPdfExtras`). */
export const ASSEMBLIES_KEY = 'NBAssemblies';

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

/** A name Bluebeam looks up by its text: written as a plain string, as Bluebeam writes its own, unless it needs Unicode. */
function plainText(s: string) {
  return /^[\x20-\x7e]*$/.test(s) ? PDFString.of(s) : PDFHexString.fromText(s);
}

/** Bluebeam's /CountStyle for each of our count markers. */
const COUNT_STYLE_NAMES: Record<CountShape, string> = { circle: 'Circle', check: 'Checkmark', square: 'Square', diamond: 'Diamond', triangle: 'Triangle', cross: 'Cross' };

/** A count marker's outline, centred on (cx, cy), `r` from the centre to its edge (page space, y down). */
function countMarker(shape: CountShape, cx: number, cy: number, r: number): Point[] {
  const at = (pts: readonly (readonly [number, number])[]): Point[] => pts.map(([x, y]) => [cx + x * r, cy + y * r]);
  switch (shape) {
    case 'check':
      // Bluebeam's own checkmark, scaled to the marker.
      return at([[-1, 0.02], [-0.773, -0.205], [-0.271, 0.297], [0.773, -0.749], [1, -0.522], [-0.271, 0.749]]);
    case 'square':
      return at([[-1, -1], [1, -1], [1, 1], [-1, 1]]);
    case 'diamond':
      return at([[0, -1], [1, 0], [0, 1], [-1, 0]]);
    case 'triangle':
      return at([[0, -1], [0.9, 0.75], [-0.9, 0.75]]);
    case 'cross': {
      // A plus with arms under a third of the width, turned 45 degrees.
      const w = 0.3;
      const plus: [number, number][] = [[-w, -1], [w, -1], [w, -w], [1, -w], [1, w], [w, w], [w, 1], [-w, 1], [-w, w], [-1, w], [-1, -w], [-w, -w]];
      return at(plus.map(([x, y]) => [(x - y) / Math.SQRT2, (x + y) / Math.SQRT2] as [number, number]));
    }
    default:
      return at(Array.from({ length: 24 }, (_, i) => [Math.cos((i / 24) * 2 * Math.PI), Math.sin((i / 24) * 2 * Math.PI)] as [number, number]));
  }
}

/** Bluebeam's name for a hatch: its label in the Standard set, or an imported hatch's own name. */
function hatchName(id: string, resolved: string): string {
  if (id.startsWith('set:')) return id.slice(id.indexOf('/') + 1);
  return HATCH_PATTERNS.find((p) => p.value === resolved)?.label ?? resolved;
}

/** Plain values with their strings as PDF text (`context.obj` would turn plain strings into names). */
function textValues(v: unknown): unknown {
  if (typeof v === 'string') return pdfText(v);
  if (Array.isArray(v)) return v.map(textValues);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, textValues(x)]));
  return v;
}

/** The markup data written into its annotation: without its link to an imported annotation, and attachment bytes (kept once, in the file). */
function appData(m: Markup): Omit<Markup, 'pdfAnnot'> {
  const { pdfAnnot: _link, ...rest } = m;
  return rest.attachment ? { ...rest, attachment: { ...rest.attachment, data: '' } } : rest;
}

const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** One line of text as a rich text paragraph. Its leading spaces (a nested list's indent) become no-break spaces, which XHTML would otherwise collapse. */
function richParagraph(line: string): string {
  return line ? `<p>${escapeXml(line.replace(/^ +/, (spaces) => ' '.repeat(spaces.length)))}</p>` : '<p />';
}

/** A text markup's default style (/DS) and rich text (/RC), which Bluebeam and Acrobat lay text out from. */
function richText(m: Markup): { DS: PDFHexString; RC: PDFHexString } {
  const s = m.style;
  const family = { sans: 'Helvetica', serif: 'Times New Roman', mono: 'Courier' }[s.fontFamily ?? 'sans'];
  const ds = [
    `font: ${family} ${fmt(s.fontSize ?? 12)}pt`,
    `text-align:${s.textAlign ?? 'left'}`,
    ...(s.verticalAlign && s.verticalAlign !== 'top' ? [`text-valign:${s.verticalAlign}`] : []),
    `color:${textColor(s).toUpperCase()}`,
    ...(s.bold ? ['font-weight:bold'] : []),
    ...(s.italic ? ['font-style:italic'] : []),
    ...(s.underline ? ['text-decoration:underline'] : []),
  ].join('; ');
  const paragraphs = (m.text ?? '').split('\n').map(richParagraph);
  const rc = `<?xml version="1.0"?><body xmlns="http://www.w3.org/1999/xhtml" xmlns:xfa="http://www.xfa.org/schema/xfa-data/1.0/" xfa:APIVersion="Acrobat:11.0.0" xfa:spec="2.0.2" style="${escapeXml(ds)}">${paragraphs.join('')}</body>`;
  return { DS: pdfText(ds), RC: pdfText(rc) };
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

/** The standard font a custom line style's text is set in. */
const artStandardFont = (t: Pick<ArtText, 'font' | 'bold' | 'italic'>): StandardFonts => STANDARD_FONTS[t.font][(t.bold ? 1 : 0) + (t.italic ? 2 : 0)]!;

/** A custom line style's laid out strokes, fills and text as content stream operators, in the line color. */
function artOps(art: LineArt, ctx: Ctx, color: [number, number, number], fontRefs: Record<string, PDFRef>): string[] {
  const ops: string[] = ['/GS0 gs [] 0 d'];
  const [r, g, b] = color;
  if (art.fill.length) ops.push(`${fmt(r)} ${fmt(g)} ${fmt(b)} rg`, pathOps(art.fill), 'f');
  if (art.stroke.length) ops.push(pathOps(art.stroke), 'S');
  if (art.texts.length) {
    ops.push('/GS1 gs', `${fmt(r)} ${fmt(g)} ${fmt(b)} rg`);
    for (const t of art.texts) {
      const name = artStandardFont(t);
      const font = ctx.fonts.get(name);
      if (!font) continue;
      const text = safeText(font, t.text);
      const w = font.widthOfTextAtSize(text, t.size);
      const cos = Math.cos(t.angle);
      const sin = Math.sin(t.angle);
      // Centred on its point along the line and on the line itself; glyphs flipped upright in y-down page space.
      const x = t.x - (w / 2) * cos - t.size * 0.35 * sin;
      const y = t.y - (w / 2) * sin + t.size * 0.35 * cos;
      fontRefs[`FL${name}`] = font.ref;
      ops.push('BT', `/FL${name} ${fmt(t.size)} Tf`, `${[cos, sin, sin, -cos, x, y].map(fmt).join(' ')} Tm`, `${font.encodeText(text).toString()} Tj`, 'ET');
    }
  }
  return ops;
}

/** Encodes text for a standard font, replacing characters WinAnsi cannot represent. */
function safeText(font: PDFFont, s: string): string {
  const supported = new Set(font.getCharacterSet());
  return [...s].map((ch) => (supported.has(ch.codePointAt(0)!) ? ch : '?')).join('');
}

/** Characters outside Latin-1 that the standard fonts' WinAnsi encoding still has. */
const WIN_ANSI_EXTRA = new Set([0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178]);

/** The words a markup draws as text: its text, stamp lines and table cells. */
function drawnStrings(m: Markup): string[] {
  return [m.text, ...(m.stamp?.lines ?? []), ...(m.stamp?.art?.texts.map((t) => t.text) ?? []), ...(m.table?.cells.flat() ?? [])].filter((t): t is string => !!t);
}

/** Whether the standard fonts cannot show every character of the text markups draw. */
function needsUnicodeFont(markups: readonly Markup[]): boolean {
  return markups.some((m) => drawnStrings(m).some((t) => [...t].some((ch) => {
    const cp = ch.codePointAt(0)!;
    return cp >= 0x100 && !WIN_ANSI_EXTRA.has(cp);
  })));
}

/** Like `safeText` for text laid out in paragraphs: its line breaks stay (any kind), and a tab is four spaces. */
function safeParagraphs(font: PDFFont, s: string): string {
  return s
    .split(/\r\n|\r|\n/)
    .map((line) => safeText(font, line.replace(/\t/g, '    ')))
    .join('\n');
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
    A: [format(areaLabelOf(scale), (METERS_PER_UNIT[scale.unit] / METERS_PER_UNIT[areaUnitOf(scale)]) ** 2)],
    V: [format(volumeLabelOf(scale), (METERS_PER_UNIT[scale.unit] / METERS_PER_UNIT[volumeUnitOf(scale)]) ** 3)],
    T: [{ Type: 'NumberFormat', U: PDFHexString.fromText('°'), C: 1, D: 10 ** (scale.anglePrecision ?? 1) }],
  };
}

const dashOp = (dash: number[]) => `[${dash.map(fmt).join(' ')}] 0 d`;

/**
 * One tiling pattern: the tile clipped to its cell, repeated by XStep and YStep. Uncolored (the
 * painter picks the colour) unless `color` is given, which colours it, as Bluebeam's own are.
 */
function hatchPatternStream(doc: PDFDocument, draw: HatchDraw, color?: [number, number, number]) {
  const { cellW, cellH, lineWidth } = draw.metrics;
  const ops = [`0 0 ${fmt(cellW)} ${fmt(cellH)} re W n`, `${fmt(lineWidth)} w`, '0 J 0 j'];
  if (color) ops.push(`${color.map(fmt).join(' ')} RG`, `${color.map(fmt).join(' ')} rg`);
  if (draw.lines.length) {
    for (const l of draw.lines) ops.push(`${fmt(l.x1)} ${fmt(l.y1)} m ${fmt(l.x2)} ${fmt(l.y2)} l`);
    ops.push('S');
  }
  // PDF has no arc operator: a dot is four cubic Béziers.
  for (const { x, y, r } of draw.dots) {
    const k = r * 0.5522847498;
    ops.push(
      `${fmt(x + r)} ${fmt(y)} m`,
      `${fmt(x + r)} ${fmt(y + k)} ${fmt(x + k)} ${fmt(y + r)} ${fmt(x)} ${fmt(y + r)} c`,
      `${fmt(x - k)} ${fmt(y + r)} ${fmt(x - r)} ${fmt(y + k)} ${fmt(x - r)} ${fmt(y)} c`,
      `${fmt(x - r)} ${fmt(y - k)} ${fmt(x - k)} ${fmt(y - r)} ${fmt(x)} ${fmt(y - r)} c`,
      `${fmt(x + k)} ${fmt(y - r)} ${fmt(x + r)} ${fmt(y - k)} ${fmt(x + r)} ${fmt(y)} c f`,
    );
  }
  return doc.context.flateStream(ops.join('\n'), {
    Type: 'Pattern',
    PatternType: 1,
    PaintType: color ? 1 : 2,
    TilingType: 1,
    BBox: [0, 0, cellW, cellH],
    XStep: cellW,
    YStep: cellH,
  });
}

function underlineOps(x: number, y: number, w: number, size: number): string {
  return `${fmt(Math.max(size * 0.06, 0.25))} w 0 J [] 0 d ${fmt(x)} ${fmt(y)} m ${fmt(x + w)} ${fmt(y)} l S`;
}

function appearance(ctx: Ctx, m: Markup, rect: [number, number, number, number]): PDFRef {
  const { doc, matrix } = ctx;
  const { style } = m;
  const fillAlpha = style.opacity * (style.fillOpacity ?? 1);
  const [sr, sg, sb] = rgb(style.stroke);
  const [tr, tg, tb] = rgb(textColor(style));
  const dash = style.dashArray ?? dashPattern(style.dash, style.width);
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
  let hatchPattern: PDFRef | null = null;
  const artFonts: Record<string, PDFRef> = {};
  const measure = (text: string, family: ArtText['font'], bold: boolean, italic: boolean, size: number) => {
    const font = ctx.fonts.get(artStandardFont({ font: family, bold, italic }));
    return font ? font.widthOfTextAtSize(safeText(font, text), size) : text.length * size * 0.55;
  };
  for (const part of styledParts(markupShape(m), style.lineStyle, style.width, measure)) {
    if (part.art) {
      ops.push(...artOps(part.art, ctx, [sr, sg, sb], artFonts));
      continue;
    }
    if (part.hatch && part.clip) {
      const draw = hatchDraw(part.hatch.id, part.hatch.scale, part.hatch.spec);
      if (draw) {
        const [hr, hg, hb] = rgb(part.hatch.color);
        hatchPattern = doc.context.register(hatchPatternStream(doc, draw));
        ops.push(
          'q',
          pathOps(part.clip),
          part.evenOdd ? 'W* n' : 'W n',
          '/GSH gs',
          '/CsH cs',
          `${fmt(hr)} ${fmt(hg)} ${fmt(hb)} /P0 scn`,
          pathOps(part.clip),
          part.evenOdd ? 'f*' : 'f',
          'Q',
        );
      }
      continue;
    }
    ops.push(part.decoration ? '/GSD gs [] 0 d' : `/GS0 gs ${dashOp(dash)}`);
    // An exact dash pattern has flat ends, as it does in other viewers.
    if (style.dashArray) ops.push(part.decoration ? '1 J' : '0 J');
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
      GSH: { Type: 'ExtGState', CA: fillAlpha, ca: fillAlpha },
    },
  };
  if (hatchPattern) {
    resources.Pattern = { P0: hatchPattern };
    resources.ColorSpace = { CsH: ['Pattern', 'DeviceRGB'] };
  }

  const label = measurementLabel(m, ctx.scale);
  if (label) {
    const font = ctx.fonts.get(standardFont(style, true))!;
    const { size, background } = labelStyle(m);
    const text = safeText(font, label.text);
    const textW = font.widthOfTextAtSize(text, size);
    const w = textW + size * 0.6;
    const h = size * 1.4;
    let [x, y] = label.at;
    // A turned label is drawn about its own centre.
    if (label.angle) {
      const [cos, sin] = [Math.cos(label.angle), Math.sin(label.angle)];
      ops.push('q', `${[cos, sin, -sin, cos, x, y].map(fmt).join(' ')} cm`);
      x = y = 0;
    }
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
    if (label.angle) ops.push('Q');
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

  const image = (isImageType(m.type) || m.type === 'attachment') && m.image ? ctx.images.get(m.image) : undefined;
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
    const lines = textBoxLines({ ...m, text: safeParagraphs(font, m.text) }, (s) => font.widthOfTextAtSize(s, size));
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

  const stampArt = m.type === 'stamp' ? m.stamp?.art : undefined;
  if (stampArt) {
    // A picture with its text over it, the text placed by fractions of the box.
    const b = boundsOf(m.points);
    const picture = ctx.images.get(stampArt.image);
    if (picture) {
      ops.push('q /GS1 gs', `${fmt(b.w)} 0 0 ${fmt(-b.h)} ${fmt(b.x)} ${fmt(b.y + b.h)} cm`, '/Im0 Do', 'Q');
      resources.XObject = { Im0: picture.ref };
    }
    const fonts: Record<string, PDFRef> = {};
    ops.push('/GS1 gs', 'BT');
    for (const t of stampArt.texts) {
      const fontName = t.bold ? (t.italic ? StandardFonts.HelveticaBoldOblique : StandardFonts.HelveticaBold) : t.italic ? StandardFonts.HelveticaOblique : StandardFonts.Helvetica;
      const font = ctx.fonts.get(fontName);
      if (!font) continue;
      fonts[fontName] = font.ref;
      const size = t.size * b.h;
      const text = safeText(font, t.text);
      const w = font.widthOfTextAtSize(text, size);
      // Shrunk to fit the text's box width, as the canvas does.
      const fit = Math.min(1, (t.w * b.w) / Math.max(w, 1e-6));
      const drawn = w * fit;
      const left = b.x + t.x * b.w;
      const x = t.align === 'left' ? left : t.align === 'right' ? left + t.w * b.w - drawn : left + (t.w * b.w - drawn) / 2;
      const [r, g, bl] = rgb(t.color);
      ops.push(`${fmt(r)} ${fmt(g)} ${fmt(bl)} rg`, `/${fontName} ${fmt(size * fit)} Tf`, `1 0 0 -1 ${fmt(x)} ${fmt(b.y + (t.y + t.h / 2) * b.h + size * fit * 0.35)} Tm`, `${font.encodeText(text).toString()} Tj`);
    }
    ops.push('ET');
    resources.Font = fonts;
  } else if (m.type === 'stamp' && m.stamp) {
    const bold = ctx.fonts.get(StandardFonts.HelveticaBold)!;
    const regular = ctx.fonts.get(StandardFonts.Helvetica)!;
    const [sr, sg, sb] = rgb(style.stroke);
    const lines = stampLayout(boundsOf(m.points), m.stamp, (s, b) => (b ? bold : regular).widthOfTextAtSize(safeText(b ? bold : regular, s), 1));
    ops.push('/GS1 gs', `${fmt(sr)} ${fmt(sg)} ${fmt(sb)} rg`, 'BT');
    for (const line of lines) {
      const font = line.bold ? bold : regular;
      const t = safeText(font, line.text);
      const w = font.widthOfTextAtSize(t, line.size);
      // Centred on its point (or starting at it); the baseline sits about a third of the size below the middle.
      const x = line.align === 'left' ? line.x : line.x - w / 2;
      ops.push(`/${line.bold ? 'F1' : 'F0'} ${fmt(line.size)} Tf`, `1 0 0 -1 ${fmt(x)} ${fmt(line.y + line.size * 0.35)} Tm`, `${font.encodeText(t).toString()} Tj`);
    }
    ops.push('ET');
    // Tick boxes, outlined in the stamp's colour.
    const boxes = lines.filter((l) => l.box);
    if (boxes.length) ops.push('q');
    for (const { box } of boxes) {
      if (!box) continue;
      ops.push(`${fmt(sr)} ${fmt(sg)} ${fmt(sb)} RG`, '[] 0 d', `${fmt(box.size * 0.1)} w`, `${fmt(box.x)} ${fmt(box.y)} ${fmt(box.size)} ${fmt(box.size)} re S`);
      if (box.ticked) {
        const [[ax, ay], [bx, by], [cx, cy]] = stampTick(box) as [[number, number], [number, number], [number, number]];
        ops.push(`${fmt(box.size * 0.16)} w`, '1 J 1 j', `${fmt(ax)} ${fmt(ay)} m ${fmt(bx)} ${fmt(by)} l ${fmt(cx)} ${fmt(cy)} l S`, '0 J 0 j');
      }
    }
    if (boxes.length) ops.push('Q');
    resources.Font = { F0: regular.ref, F1: bold.ref };
  }

  if (m.type === 'table') {
    // The grid is drawn with the shape; each cell's text is laid out in its box and clipped to it,
    // in the cell's own font, size and colour. The table's font is F0, any others F1, F2, ...
    const tableFont = ctx.fonts.get(standardFont(style, false))!;
    const fontNames = new Map<StandardFonts, string>([[standardFont(style, false), 'F0']]);
    const fontRefs: Record<string, PDFRef> = { F0: tableFont.ref };
    for (const cell of tableCells(m)) {
      if (!cell.text) continue;
      const { x, y, w, h } = cell.rect;
      const fontName = standardFont(cell.style, false);
      const font = ctx.fonts.get(fontName)!;
      if (!fontNames.has(fontName)) {
        fontNames.set(fontName, `F${fontNames.size}`);
        fontRefs[fontNames.get(fontName)!] = font.ref;
      }
      const size = cell.style.fontSize ?? 12;
      const ascent = font.heightAtSize(size, { descender: false });
      const [cr, cg, cb] = rgb(textColor(cell.style));
      const lines = textBoxLines(tableCellText(m, { rect: cell.rect, text: safeParagraphs(font, cell.text), style: cell.style }), (s) => font.widthOfTextAtSize(s, size));
      ops.push('q', '/GS1 gs', `${fmt(cr)} ${fmt(cg)} ${fmt(cb)} rg`, `${fmt(x)} ${fmt(y)} ${fmt(w)} ${fmt(h)} re W n`, 'BT', `/${fontNames.get(fontName)} ${fmt(size)} Tf`);
      for (const line of lines) ops.push(`1 0 0 -1 ${fmt(line.x)} ${fmt(line.y + ascent)} Tm`, `${font.encodeText(line.text).toString()} Tj`);
      ops.push('ET');
      if (cell.style.underline) {
        ops.push(`${fmt(cr)} ${fmt(cg)} ${fmt(cb)} RG`);
        for (const line of lines) if (line.text) ops.push(underlineOps(line.x, line.y + size * 0.98, line.width, size));
      }
      ops.push('Q');
    }
    resources.Font = fontRefs;
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
      // A band separator, then the symbol drawn as a small copy of the markup, as on screen.
      const [dr, dg, db] = rgb(style.stroke);
      ops.push('q', `${fmt(dr)} ${fmt(dg)} ${fmt(db)} RG 0.5 w`, `${fmt(L.box.x)} ${fmt(r.y)} m ${fmt(L.box.x + L.box.w)} ${fmt(r.y)} l S`, 'Q');
      const symbol = legendSymbol(row.sample, r.symbol);
      const [cr, cg, cb] = rgb(symbol.style.stroke);
      ops.push('q', `${fmt(cr)} ${fmt(cg)} ${fmt(cb)} RG`, `${fmt(symbol.style.width)} w`, '1 J 1 j', dashOp(symbol.style.dashArray ?? dashPattern(symbol.style.dash, symbol.style.width)));
      for (const part of markupShape(symbol)) {
        if (part.hatch && part.clip) continue;
        ops.push(pathOps(part.path));
        if (part.fill) {
          const [fr, fg, fb] = rgb(part.fill);
          ops.push(`${fmt(fr)} ${fmt(fg)} ${fmt(fb)} rg`);
        }
        const star = part.evenOdd ? '*' : '';
        ops.push(part.fill && part.stroke ? `B${star}` : part.fill ? `f${star}` : part.stroke ? 'S' : 'n');
      }
      ops.push('Q');
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
  if (Object.keys(artFonts).length) resources.Font = { ...(resources.Font as LiteralObject | undefined), ...artFonts };

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

/** A custom line style's pattern as PDF values: its text as literal strings, as Bluebeam writes it. */
function lineStyleValue(v: unknown): unknown {
  if (typeof v === 'string') return /^[ -~]*$/.test(v) ? PDFString.of(v) : PDFHexString.fromText(v);
  return Array.isArray(v) ? v.map(lineStyleValue) : v;
}

/** Bluebeam's cloud intensity (0–2) for a cloud's arc size: about 3 pt per step. */
function cloudEffect(m: Markup): LiteralObject {
  return { S: 'C', I: Math.max(0, Math.min(2, Math.round((m.style.arcRadius ?? 6) / 3))) };
}

/**
 * A dimension line's /LL leader length: the offset of the line from its points, positive on the
 * left of the direction in user space (ours is positive the other way in page space, y down).
 */
function leaderLength(m: Markup, matrix: Matrix): LiteralObject {
  const offset = m.style.leader;
  if (!offset || m.points.length < 2) return {};
  const [a, b] = [m.points[0]!, m.points[m.points.length - 1]!];
  const d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  // Our offset point in page space, then which side of the user-space line it lands on.
  const p: Point = [(a[0] + b[0]) / 2 - ((b[1] - a[1]) / d) * offset, (a[1] + b[1]) / 2 + ((b[0] - a[0]) / d) * offset];
  const [ua, ub, up] = [a, b, p].map((q) => apply(matrix, q)) as [Point, Point, Point];
  const side = Math.sign((ub[0] - ua[0]) * (up[1] - ua[1]) - (ub[1] - ua[1]) * (up[0] - ua[0]));
  return { LL: side * Math.abs(offset) };
}

/** A markup's bounds with its measurement label and dimension text, which its appearance draws too. */
function boundsWithText(ctx: Ctx, m: Markup): { x: number; y: number; w: number; h: number } {
  let { x, y, w, h } = markupBounds(m);
  let x1 = x + w;
  let y1 = y + h;
  const take = (cx: number, cy: number, rx: number, ry: number) => {
    x = Math.min(x, cx - rx);
    y = Math.min(y, cy - ry);
    x1 = Math.max(x1, cx + rx);
    y1 = Math.max(y1, cy + ry);
  };
  const label = measurementLabel(m, ctx.scale);
  const labelFont = ctx.fonts.get(standardFont(m.style, true));
  if (label && labelFont) {
    const { size } = labelStyle(m);
    const rx = (labelFont.widthOfTextAtSize(safeText(labelFont, label.text), size) + size * 0.6) / 2;
    // A turned label reaches as far as its corners do.
    const [cos, sin] = [Math.abs(Math.cos(label.angle)), Math.abs(Math.sin(label.angle))];
    take(label.at[0], label.at[1], rx * cos + size * 0.7 * sin, rx * sin + size * 0.7 * cos);
  }
  const dim = dimensionText(m);
  const dimFont = ctx.fonts.get(standardFont(m.style, false));
  if (dim && dimFont) {
    const r = dimFont.widthOfTextAtSize(safeText(dimFont, dim.text), dim.size) / 2 + dim.size;
    take(dim.at[0], dim.at[1], r, r);
  }
  // A custom line style reaches off the line: symbols, text and parallel lines.
  if (m.style.lineStyle) {
    const reach = lineStyleReach(m.style.lineStyle, m.style.width);
    x -= reach;
    y -= reach;
    x1 += reach;
    y1 += reach;
  }
  return { x, y, w: x1 - x, h: y1 - y };
}

/**
 * Bluebeam's Arc tool writes a Circle annotation (/IT /CircleArc) of the circle the arc is part of.
 * A three-point arc goes out as that, so it is still an arc when Bluebeam edits it, rather than a
 * polyline. Three points in a line have no circle and stay a polyline.
 */
function bluebeamArc(m: Markup): Markup {
  if (m.type !== 'arc' || m.points.length < 3) return m;
  const [a, via, b] = m.points as [Point, Point, Point];
  const circle = circleThrough(a, via, b);
  if (!circle) return m;
  const { cx, cy, r } = circle;
  const angle = (p: Point) => Math.atan2(p[1] - cy, p[0] - cx);
  const turn = (from: number, to: number) => (((to - from) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  // As `arcPoints` sweeps it: positive is clockwise on the page (y down).
  let sweep = turn(angle(a), angle(b));
  if (turn(angle(a), angle(via)) > sweep) sweep -= 2 * Math.PI;
  // An elliptical arc runs counter-clockwise from its first angle to its second, measured as on paper.
  const paper = (p: Point) => ((((-angle(p) * 180) / Math.PI) % 360) + 360) % 360;
  const clockwise = sweep > 0;
  const [startCap, endCap] = lineEnds(m);
  return {
    ...m,
    type: 'ellipticalArc',
    points: [[cx - r, cy - r], [cx + r, cy + r]],
    arcAngles: clockwise ? [paper(b), paper(a)] : [paper(a), paper(b)],
    // Line endings belong to the arc's ends: swapped when it is described from its far end.
    style: { ...m.style, startCap: clockwise ? endCap : startCap, endCap: clockwise ? startCap : endCap },
  };
}

function annotationDict(ctx: Ctx, source: Markup): PDFDict {
  const { doc, matrix } = ctx;
  const m = bluebeamArc(source);
  const b = boundsWithText(ctx, m);
  const corners = [apply(matrix, [b.x, b.y]), apply(matrix, [b.x + b.w, b.y + b.h])];
  const rect: [number, number, number, number] = [
    Math.min(corners[0]![0], corners[1]![0]),
    Math.min(corners[0]![1], corners[1]![1]),
    Math.max(corners[0]![0], corners[1]![0]),
    Math.max(corners[0]![1], corners[1]![1]),
  ];
  if (m.type === 'callout' && m.points.length >= 4) {
    // A callout's box goes in /RD, whose top and bottom insets Bluebeam reads the other way up from
    // other readers: equal ones (Rect grown to match) mean the same box to all of them.
    const box = contentBox(m);
    const ys = [apply(matrix, [box.x, box.y])[1], apply(matrix, [box.x + box.w, box.y + box.h])[1]];
    const inset = Math.max(rect[3] - Math.max(...ys), Math.min(...ys) - rect[1]);
    rect[1] = Math.min(...ys) - inset;
    rect[3] = Math.max(...ys) + inset;
  }
  const user = m.points.map((p) => apply(matrix, p));
  const flat = (pts: Point[]) => pts.flatMap(([x, y]) => [x, y]);
  // Arc segments go out as short straight ones (other readers see the shape; ours read NBData).
  const curved = (closed: boolean): Point[] => (m.bulges?.some(Boolean) ? expandArcs(m.points, m.bulges, closed).map((p) => apply(matrix, p)) : user);
  const color = rgb(m.style.stroke);
  const fill = m.style.fill ? rgb(m.style.fill) : null;
  // A boxless text box has no border for other readers to draw.
  const borderWidth = (m.style.noBox && m.type === 'text') || (m.style.borderless && (m.type === 'text' || m.type === 'callout')) ? 0 : m.style.width;
  const dash = m.style.dashArray ?? dashPattern(m.style.dash, m.style.width);
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
    AP: { N: appearance(ctx, source, rect) },
    // An attachment's bytes live once, in its embedded file, not in the data copy too.
    [APP_DATA_KEY]: pdfText(JSON.stringify(appData(source))),
  };
  if (m.style.lineStyle) {
    base.LineStyle = lineStyleValue(m.style.lineStyle.spec) as never;
    base.LineStyleName = pdfText(m.style.lineStyle.name) as never;
  }
  const label = measurementLabel(m, ctx.scale);
  const signed = m.signature ? `Signed by ${m.signature.signer} on ${new Date(m.signature.signedAt).toLocaleString()}${m.signature.reason ? ` (${m.signature.reason})` : ''}` : null;
  const contents = isTextType(m.type) || m.type === 'dimension' || m.type === 'replaceText' ? [m.text, m.type === 'replaceText' ? m.comment : null].filter(Boolean).join(' — ') : [signed, label?.text, m.comment].filter(Boolean).join(' — ');
  // Bluebeam's Markups List names and groups markups by subject: without one they sit under a blank group.
  base.Subj = pdfText(m.subject || defaultSubject(m));
  if (contents) base.Contents = pdfText(contents);
  if (fill) base.IC = fill;
  // Bluebeam keeps a shape's hatch as a pattern, its name and its colour; a shape without them is
  // redrawn with no hatch as soon as it is edited. (Our appearance already draws it.)
  const hatch = styleCapabilities(m.type).hatch ? resolveHatch(m.style.hatch, m.style.hatchSpec) : null;
  const hatched = hatch ? hatchDraw(m.style.hatch, m.style.hatchScale, m.style.hatchSpec) : null;
  if (hatch && hatched) {
    const hatchColor = rgb(m.style.hatchColor ?? m.style.stroke);
    base.Pattern = doc.context.register(hatchPatternStream(doc, hatched, hatchColor));
    base.PatternName = plainText(hatchName(m.style.hatch!, hatch.id));
    base.PatternColor = hatchColor;
  }

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
      specific = { Subtype: 'Polygon', Vertices: flat(verts), BE: cloudEffect(m), IT: 'PolygonCloud' };
      break;
    }
    case 'polygonCloud':
      specific = { Subtype: 'Polygon', Vertices: flat(user), BE: cloudEffect(m), IT: 'PolygonCloud' };
      break;
    case 'ellipticalArc': {
      // Bluebeam's arc: a Circle annotation's ellipse, between two angles (counter-clockwise from
      // east in user space, so turned with the page).
      const box = boundsOf(m.points);
      const c = apply(matrix, [box.x + box.w / 2, box.y + box.h / 2]);
      const corner = apply(matrix, [box.x + box.w, box.y + box.h]);
      // The ellipse's half axes in user space (a turned page swaps them).
      const ux = Math.abs(corner[0] - c[0]) || 1;
      const uy = Math.abs(corner[1] - c[1]) || 1;
      const [a1, a2] = m.arcAngles ?? [0, 180];
      const at = (deg: number): Point => {
        const t = (deg * Math.PI) / 180;
        return apply(matrix, [box.x + box.w / 2 + (box.w / 2) * Math.cos(t), box.y + box.h / 2 - (box.h / 2) * Math.sin(t)]);
      };
      // Angles on the ellipse (its parameter), as Bluebeam reads them.
      const angle = (p: Point) => ((((Math.atan2((p[1] - c[1]) / uy, (p[0] - c[0]) / ux) * 180) / Math.PI) % 360) + 360) % 360;
      specific = { Subtype: 'Circle', IT: 'CircleArc', RD: rd, Angle1: angle(at(a1)), Angle2: angle(at(a2)), LE: le };
      break;
    }
    case 'pen':
    case 'highlighter':
      specific = { Subtype: 'Ink', InkList: [flat(user)], ...(m.type === 'highlighter' ? { BM: 'Multiply' } : {}) };
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
      specific = { Subtype: 'Line', L: flat(user.slice(0, 2)), LE: le, IT: 'LineDimension', Measure: measureDict(ctx.scale), ...leaderLength(m, matrix) };
      break;
    case 'dimension':
      // Bluebeam's unscaled dimension is a line dimension without a /Measure.
      specific = { Subtype: 'Line', L: flat(user.slice(0, 2)), LE: le, IT: 'LineDimension', Cap: true, ...(filledEnd ? { IC: color } : {}), ...leaderLength(m, matrix) };
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
        Measure: measureDict(ctx.scale),
        // Revu tells a polylength from a perimeter by its rise and drop.
        ...(m.type === 'polylength' ? { IT: 'PolyLineDimension', LE: le, RiseDrop: 0 } : { IT: 'PolyLineAngle' }),
      };
      break;
    case 'area':
    case 'perimeter':
    case 'volume': {
      const holes = (m.holes ?? []).filter((h) => h.length > 2);
      specific = {
        Subtype: 'Polygon',
        Vertices: flat(curved(true)),
        IT: m.type === 'volume' ? 'PolygonVolume' : 'PolygonDimension',
        Measure: measureDict(ctx.scale),
        // Cutouts as Bluebeam records them, so it measures them too.
        ...(holes.length ? { Cutouts: holes.map((h) => flat(h.map((p) => apply(matrix, p)))) } : {}),
        // Curved cutout edges as Bluebeam's Bézier handles.
        ...(holes.length && m.holeBulges?.some((b) => b?.some(Boolean))
          ? { CutoutsCurves: holes.map((h) => { const b = m.holeBulges?.[(m.holes ?? []).indexOf(h)]; return b && b.length === h.length ? bezierHandles(h, b, true, matrix) : []; }) }
          : {}),
      };
      break;
    }
    case 'redaction':
      // A standard redaction mark: other tools can apply it too. IC is the colour it leaves.
      specific = { Subtype: 'Redact', QuadPoints: [rect[0], rect[3], rect[2], rect[3], rect[0], rect[1], rect[2], rect[1]], IC: fill ?? [0, 0, 0] };
      break;
    case 'space':
      specific = { Subtype: 'Polygon', Vertices: flat(user) };
      base.Contents = pdfText(`Space: ${m.subject || 'Space'}`);
      break;
    case 'diameter':
      // Other tools see the circle; ours come back as the measurement from NBData.
      specific = { Subtype: 'Circle', RD: rd, Measure: measureDict(ctx.scale), IT: 'CircleDimension' };
      break;
    case 'radius': {
      // Bluebeam's radius is a three-vertex polygon: a point on the circle, the centre, the arc's end
      // (the same point again for a whole circle). Its handles sit on those, not on a box.
      const [centre, edge, end] = user as [Point, Point, Point | undefined];
      const arcEnd = end ?? edge;
      specific = { Subtype: 'Polygon', Vertices: flat([edge, centre, arcEnd]), IT: 'PolygonRadius', Measure: measureDict(ctx.scale) };
      break;
    }
    case 'arcLength':
      specific = { Subtype: 'PolyLine', Vertices: flat(arcPoints(m.points).map((p) => apply(matrix, p))), IT: 'PolyLineDimension', Measure: measureDict(ctx.scale), LE: le };
      break;
    case 'count': {
      // Bluebeam's count is one polygon per item, drawn as its marker (the caller writes the rest and groups them).
      const [cx, cy] = m.points[0] ?? [0, 0];
      const shape = m.style.countShape ?? 'circle';
      specific = {
        Subtype: 'Polygon',
        Vertices: flat(countMarker(shape, cx, cy, markerSize(m)).map((p) => apply(matrix, p))),
        IT: 'PolygonCount',
        CountStyle: COUNT_STYLE_NAMES[shape],
        MeasurementTypes: 128,
        BBMeasure: measureDict(ctx.scale),
      };
      break;
    }
    case 'signature':
      specific = { Subtype: 'Stamp', Name: 'Signature' };
      break;
    case 'text':
    case 'flagLabel':
    case 'typewriter': {
      const [r, g, bl] = rgb(textColor(m.style));
      const font = DA_FONT_NAMES[m.style.fontFamily ?? 'sans'];
      specific = {
        Subtype: 'FreeText',
        RD: rd,
        DA: PDFString.of(`/${font} ${m.style.fontSize ?? 12} Tf ${fmt(r)} ${fmt(g)} ${fmt(bl)} rg`),
        Q: m.style.textAlign === 'center' ? 1 : m.style.textAlign === 'right' ? 2 : 0,
        ...richText(m),
        // A FreeText's /C is its background, not its border.
        C: fill && !m.style.noBox && m.type === 'text' ? fill : [],
        ...(fill && m.style.fillOpacity !== undefined && m.style.fillOpacity < 1 ? { FillOpacity: m.style.fillOpacity } : {}),
        ...(m.type === 'typewriter' ? { IT: 'FreeTextTypeWriter' } : {}),
      };
      if (m.type === 'flagLabel') {
        // Its box reaches the flag's point; the text sits right of it (RD's left inset).
        const box = contentBox(m);
        const corners = [apply(matrix, [box.x, box.y]), apply(matrix, [box.x + box.w, box.y + box.h])];
        specific.RD = [Math.min(corners[0]![0], corners[1]![0]) - rect[0], rd[1]!, rd[2]!, rd[3]!];
        specific.C = fill ?? [];
      }
      delete base.IC;
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
      // Other tools see a stamp, not a text box: they redraw a FreeText from its text when it is
      // resized (losing the symbols and bands), but only scale a stamp's appearance. The rows are
      // in /Contents for lists and search; ours come back as a live legend.
      const rows = legendRows(m, ctx.all, ctx.scaleFor, ctx.scaleOf);
      base.Contents = pdfText(['Legend', ...rows.map((r) => `${r.label}: ${r.count}${r.measure ? ` (${r.measure})` : ''}`)].join('\n'));
      // Bluebeam's own legend is a snapshot stamp with its keys and totals in /BSILegend, which it
      // keeps current as markups change.
      specific = { Subtype: 'Stamp', IT: 'StampSnapshot', BSILegend: textValues(bsiLegendValue(m, ctx.all, ctx.pages.length, ctx.scaleFor, ctx.scaleOf)) as never };
      break;
    }
    case 'table': {
      // Other tools see a stamp too (a text box would be redrawn from its text, losing the grid); the
      // cells are in /Contents for lists and search, and ours come back as a live table.
      base.Contents = pdfText(tableSummary(m));
      specific = { Subtype: 'Stamp', Name: 'Table' };
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
        ...richText(m),
        C: fill && !m.style.noBox ? fill : [],
      };
      delete base.IC;
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

/**
 * New replies, parents before the replies that answer them, each pointing at the annotation it
 * answers (a reply, or the markup). Replies already in `known` are left as they are.
 */
function placeReplies(doc: PDFDocument, markupRef: PDFRef, m: Markup, known: Map<string, PDFRef>): PDFRef[] {
  const made: PDFRef[] = [];
  for (const { reply } of threadReplies((m.replies ?? []).filter((r) => !known.has(r.id)))) {
    const irt = (reply.parentId && known.get(reply.parentId)) || markupRef;
    const ref = doc.context.register(replyDict(doc, irt, m, reply));
    known.set(reply.id, ref);
    made.push(ref);
  }
  return made;
}

/** Page-space rect → [left, bottom, right, top] in the page's user space. */
function userRect(matrix: Matrix, r: { x: number; y: number; w: number; h: number }): [number, number, number, number] {
  const a = apply(matrix, [r.x, r.y]);
  const b = apply(matrix, [r.x + r.w, r.y + r.h]);
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
}

/** An explicit destination: an area (FitR), a top-left point (XYZ), or the whole page (Fit). */
function destArray(pages: PDFPage[], pageIndex: number, rect: { x: number; y: number; w: number; h: number } | null, zoom?: number | null): PDFObject[] | null {
  const page = pages[pageIndex];
  if (!page) return null;
  const m = pageMatrix(page);
  if (rect && rect.w > 0 && rect.h > 0) return [page.ref, PDFName.of('FitR'), ...userRect(m, rect).map((n) => PDFNumber.of(n))];
  if (rect) {
    const [x, y] = apply(m, [rect.x, rect.y]);
    return [page.ref, PDFName.of('XYZ'), PDFNumber.of(x), PDFNumber.of(y), zoom ? PDFNumber.of(zoom) : PDFNull];
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
        const dest = destArray(pages, b.pageIndex, b.rect, b.zoom);
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

/** Keys an edited markup's annotation keeps from the original even when its kind of annotation changes. */
const KEEP_ALWAYS = new Set(['P', 'Subj', 'T', 'NM', 'CreationDate', 'BSIColumnData', 'OC', 'IRT', 'RT', 'GroupNesting', 'Popup', 'StructParent', 'ITEx']);
/** Keys of the original an edited markup's annotation drops: they describe the old look or shape. */
const STALE = new Set(['AP', 'AS', 'RC', 'Curves', 'Cutouts', 'CutoutsCurves', 'LineStyle', 'LineStyleName', APP_DATA_KEY]);
/** Keys where the original's value wins over ours: identity, and the other tool's own kind of markup. */
const PREFER_ORIGINAL = new Set(['NM', 'CreationDate', 'IT']);
/** Annotation flags we set (Invisible, Hidden, Print, NoView, Locked); others the original had stay. */
const OUR_FLAGS = 1 | 2 | 4 | 32 | 128;

const nameValue = (d: PDFDict, key: string) => d.lookupMaybe(PDFName.of(key), PDFName)?.decodeText() ?? null;
const numbers = (d: PDFDict, key: string): number[] =>
  d
    .lookupMaybe(PDFName.of(key), PDFArray)
    ?.asArray()
    .flatMap((x) => {
      const v = d.context.lookup(x);
      return v instanceof PDFNumber ? [v.asNumber()] : [];
    }) ?? [];

/**
 * Where an edited markup that came from another tool keeps that tool's form of annotation, the
 * values that rebuild it from the markup (a Bluebeam count keeps its marker shape, an arc its
 * /Angle1-/Angle2 circle, a radius its three points). Null when ours is used as is.
 */
function nativeForm(orig: PDFDict, m: Markup, matrix: Matrix): LiteralObject | null {
  const subtype = nameValue(orig, 'Subtype');
  const intent = nameValue(orig, 'IT');
  if (m.type === 'count' && subtype === 'Polygon' && intent === 'PolygonCount' && m.points.length === 1) {
    const v = numbers(orig, 'Vertices');
    if (v.length < 2) return null;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let i = 0; i + 1 < v.length; i += 2) {
      x0 = Math.min(x0, v[i]!);
      x1 = Math.max(x1, v[i]!);
      y0 = Math.min(y0, v[i + 1]!);
      y1 = Math.max(y1, v[i + 1]!);
    }
    const [cx, cy] = apply(matrix, m.points[0]!);
    const dx = cx - (x0 + x1) / 2;
    const dy = cy - (y0 + y1) / 2;
    const rect = numbers(orig, 'Rect');
    const contents = orig.get(PDFName.of('Contents'));
    return {
      Subtype: 'Polygon',
      // Bluebeam's count shows the group's total, not this item's.
      ...(contents ? { Contents: contents as never } : {}),
      Vertices: v.map((n, i) => n + (i % 2 ? dy : dx)),
      ...(rect.length === 4 ? { Rect: [rect[0]! + dx, rect[1]! + dy, rect[2]! + dx, rect[3]! + dy] } : {}),
    };
  }
  if (m.type === 'radius' && subtype === 'Polygon' && intent === 'PolygonRadius' && m.points.length >= 2) {
    const [c, p, end] = m.points.map((q) => apply(matrix, q)) as [Point, Point, Point | undefined];
    const e = end ?? p;
    return { Subtype: 'Polygon', Vertices: [p[0], p[1], c[0], c[1], e[0], e[1]] };
  }
  if ((m.type === 'area' || m.type === 'volume' || m.type === 'polylength' || m.type === 'perimeter') && orig.has(PDFName.of('Curves')) && m.bulges?.some(Boolean)) {
    // Bluebeam draws curved edges from its /Curves handles: the vertices stay the corners.
    return { Vertices: m.points.flatMap((p) => apply(matrix, p)), Curves: bezierHandles(m.points, m.bulges, m.type !== 'polylength', matrix) };
  }
  if (m.type === 'image' && subtype === 'Square' && orig.has(PDFName.of('Image'))) return { Subtype: 'Square' };
  if (m.type === 'image' && subtype === 'Stamp' && m.pdfAnnot?.image && m.image && markupDigest({ image: m.image } as Markup) === m.pdfAnnot.image) {
    // Another tool's stamp, moved or resized only: its own (vector) appearance, fitted to the new box.
    const name = orig.get(PDFName.of('Name'));
    return { Subtype: 'Stamp', [KEEP_APPEARANCE]: true, ...(name ? { Name: name as never } : {}) };
  }
  if (m.type === 'attachment' && subtype === 'FileAttachment' && m.pdfAnnot?.image && m.image && markupDigest({ image: m.image } as Markup) === m.pdfAnnot.image) {
    // Another tool's attachment, moved or resized only: its own appearance, fitted to the new box.
    return { [KEEP_APPEARANCE]: true };
  }
  if ((m.type === 'note' || m.type === 'flag') && subtype === 'Text') {
    const name = nameValue(orig, 'Name');
    return name ? { Name: name } : null;
  }
  return null;
}

/**
 * Bluebeam's /Curves for a path with arc segments: per vertex on a curve, its index and two Bézier
 * handles (before it, after it), each arc drawn as one cubic.
 */
function bezierHandles(pts: readonly Point[], bulges: readonly number[] | null | undefined, closed: boolean, matrix: Matrix): number[] {
  const before = pts.map((p) => p);
  const after = pts.map((p) => p);
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const b = bulges?.[i] ?? 0;
    if (!b) continue;
    const p = pts[i]!;
    const q = pts[(i + 1) % pts.length]!;
    const arc = expandArcs([p, q], [b]);
    if (arc.length < 3) continue;
    const chord = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const theta = 4 * Math.atan(Math.abs(b));
    const radius = chord / (2 * Math.sin(theta / 2));
    const h = (4 / 3) * Math.tan(theta / 4) * radius;
    const unit = (a: readonly number[], c: readonly number[]): Point => {
      const d = Math.hypot(c[0]! - a[0]!, c[1]! - a[1]!) || 1;
      return [(c[0]! - a[0]!) / d, (c[1]! - a[1]!) / d];
    };
    const t0 = unit(arc[0]!, arc[1]!);
    const t1 = unit(arc[arc.length - 2]!, arc[arc.length - 1]!);
    after[i] = [p[0] + t0[0] * h, p[1] + t0[1] * h];
    before[(i + 1) % pts.length] = [q[0] - t1[0] * h, q[1] - t1[1] * h];
  }
  const out: number[] = [];
  pts.forEach((p, k) => {
    if (before[k] === p && after[k] === p) return;
    out.push(k, ...apply(matrix, before[k]!), ...apply(matrix, after[k]!));
  });
  return out;
}

/** A native form's flag: keep the original annotation's appearance stream rather than ours. */
const KEEP_APPEARANCE = '__keepAppearance';

function circleThroughPoints(a: Point, b: Point, c: Point): { cx: number; cy: number; r: number } | null {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  if (Math.abs(d) < 1e-9) return null;
  const sq = (p: Point) => p[0] * p[0] + p[1] * p[1];
  const cx = (sq(a) * (b[1] - c[1]) + sq(b) * (c[1] - a[1]) + sq(c) * (a[1] - b[1])) / d;
  const cy = (sq(a) * (c[0] - b[0]) + sq(b) * (a[0] - c[0]) + sq(c) * (b[0] - a[0])) / d;
  return { cx, cy, r: Math.hypot(a[0] - cx, a[1] - cy) };
}

/**
 * An edited markup written over its original annotation: ours, plus every key of the original we
 * have no equivalent for (another tool's measurement data, custom column values, reply links).
 */
function mergeAnnotation(doc: PDFDocument, orig: PDFDict, ours: PDFDict, native: LiteralObject | null): PDFDict {
  const keepAppearance = !!native?.[KEEP_APPEARANCE];
  if (native) {
    const changesKind = !!native.Subtype && native.Subtype !== nameValue(ours, 'Subtype');
    for (const [k, v] of Object.entries(native)) if (k !== KEEP_APPEARANCE) ours.set(PDFName.of(k), doc.context.obj(v as LiteralObject));
    // Our ink circles or polyline mean nothing on the other tool's own form of the markup.
    if (changesKind) for (const k of ['InkList', 'Vertices', 'L', 'LE']) if (!(k in native)) ours.delete(PDFName.of(k));
  }
  const same = nameValue(orig, 'Subtype') === nameValue(ours, 'Subtype');
  const out = doc.context.obj({});
  for (const [k, v] of orig.entries()) {
    const key = k.decodeText();
    if (STALE.has(key) || (!same && !KEEP_ALWAYS.has(key))) continue;
    out.set(k, v);
  }
  for (const [k, v] of ours.entries()) {
    const key = k.decodeText();
    if (PREFER_ORIGINAL.has(key) && out.has(k) && (key !== 'IT' || same)) continue;
    out.set(k, v);
  }
  const f = (d: PDFDict) => d.lookupMaybe(PDFName.of('F'), PDFNumber)?.asNumber() ?? 0;
  out.set(PDFName.of('F'), PDFNumber.of((f(orig) & ~OUR_FLAGS) | f(ours)));
  // Viewers fit the appearance's BBox to /Rect; ours is drawn in absolute coordinates, so a Rect
  // the other tool's form moved needs the same box, or the drawing is stretched.
  const rect = out.lookupMaybe(PDFName.of('Rect'), PDFArray);
  const normal = out.lookupMaybe(PDFName.of('AP'), PDFDict)?.lookupMaybe(PDFName.of('N'), PDFStream);
  if (native?.Rect && rect && normal) normal.dict.set(PDFName.of('BBox'), rect);
  if (keepAppearance && orig.has(PDFName.of('AP'))) out.set(PDFName.of('AP'), orig.get(PDFName.of('AP'))!);
  // Rich text the original had says what /Contents now says, in the original's default style.
  if (orig.has(PDFName.of('RC')) && !out.has(PDFName.of('RC'))) refreshRichText(out, true);
  return out;
}

/** An annotation's /RC rewritten from its /Contents, in its /DS style (only where it has rich text, unless `always`). */
function refreshRichText(d: PDFDict, always = false) {
  if (!always && !d.has(PDFName.of('RC'))) return;
  const text = d.lookupMaybe(PDFName.of('Contents'), PDFString, PDFHexString)?.decodeText() ?? '';
  const ds = d.lookupMaybe(PDFName.of('DS'), PDFString, PDFHexString)?.decodeText();
  const body = text.split(/\r\n?|\n/).map(richParagraph).join('');
  d.set(PDFName.of('RC'), pdfText(`<?xml version="1.0"?><body xmlns="http://www.w3.org/1999/xhtml" xmlns:xfa="http://www.xfa.org/schema/xfa-data/1.0/" xfa:APIVersion="Acrobat:11.0.0" xfa:spec="2.0.2"${ds ? ` style="${escapeXml(ds)}"` : ''}>${body}</body>`));
}

/**
 * A review-state annotation as Bluebeam and Acrobat write one: a status set on the markup, by
 * `change.author` at `change.at` (the markup's author, now, without one).
 */
function stateDict(doc: PDFDocument, parent: PDFRef, m: Markup, state: string, model = 'Review', change?: StatusChange, n = 0): PDFDict {
  const at = change?.at ?? Date.now();
  const author = change ? change.author : m.author;
  return doc.context.obj({
    Type: 'Annot',
    Subtype: 'Text',
    Rect: [0, 0, 0, 0],
    F: 2 | 4 | 8 | 16, // Hidden, Print, NoZoom, NoRotate: listed with the markup, never drawn
    Name: 'Note',
    IRT: parent,
    StateModel: pdfText(model),
    State: pdfText(state),
    Subj: pdfText(model === 'Marked' ? (state === 'Marked' ? 'Checked' : 'Unchecked') : `Set to ${state}`),
    // As Bluebeam words it in the status history.
    ...(model === 'Marked' ? {} : { Contents: pdfText(author ? `${state} set by ${author}` : state) }),
    T: pdfText(author),
    NM: pdfText(`${m.id}-state-${at}${n ? `-${n}` : ''}`),
    M: pdfDate(at),
    CreationDate: pdfDate(at),
  });
}

/**
 * The status changes to write for a markup: those of its history not yet in the file (all of them
 * for a markup new to the file). A status set before histories were kept is one change, by the
 * markup's author, when it differs from the status in the file.
 */
function statesToWrite(m: Markup, inFile: boolean, statuses: readonly MarkupStatusDef[]): { state: string; model: string; change?: StatusChange }[] {
  const history = (m.statusHistory ?? []).filter((c) => !inFile || !c.nm);
  if (history.length) return history.map((c) => ({ state: c.state, model: c.model, change: c }));
  const was = inFile ? (m.pdfAnnot?.status ?? 'none') : 'none';
  if (m.status === was || (!inFile && m.status === 'none')) return [];
  return [{ state: stateName(m.status, statuses), model: stateModel(m.status, statuses) }];
}

/** A status id's name for a review state: its definition's, else the id capitalised. */
function stateName(id: string, statuses: readonly MarkupStatusDef[]): string {
  return statuses.find((s) => s.id === id)?.name || (id === 'none' ? 'None' : id.charAt(0).toUpperCase() + id.slice(1));
}

/** The state model a status is set in: its custom status set's, else Review. */
function stateModel(id: string, statuses: readonly MarkupStatusDef[]): string {
  return statuses.find((s) => s.id === id)?.model || 'Review';
}

// ---- Bluebeam custom columns --------------------------------------------------------------------

const BB_COLUMN_TYPES: Record<CustomColumn['type'], string> = {
  text: 'Text',
  multiline: 'Text',
  choice: 'Choice',
  number: 'Number',
  date: 'Date',
  checkmark: 'Checkmark',
  formula: 'Formula',
};

interface ColumnLayout {
  /**
   * The columns in the order their values are stored. Null is a column deleted in Bluebeam: it
   * stays in the file, hidden, keeping its place and the values stored for it.
   */
  columns: (CustomColumn | null)[];
  /** For each column, its position in the file's original list (-1 for a new one). */
  from: number[];
  /** Stored values changed position (a column was removed or reordered): every annotation's values are realigned. */
  moved: boolean;
}

/**
 * Writes the document's custom columns as Bluebeam's /BSIAnnotColumns (columns the file had keep
 * their own settings, and their place) and says where each column's values sit. Null when there are
 * none to write.
 */
function writeColumns(doc: PDFDocument, columns: readonly CustomColumn[], used: boolean): ColumnLayout | null {
  const existing = doc.catalog.lookupMaybe(PDFName.of('BSIAnnotColumns'), PDFArray);
  if (!columns.length || (!existing && !used)) return null;
  const original = (existing?.asArray() ?? []).map((x) => doc.context.lookup(x)).map((d) => (d instanceof PDFDict ? d : null));
  const nameOfColumn = (d: PDFDict | null) => d?.lookupMaybe(PDFName.of('Name'), PDFString, PDFHexString)?.decodeText().trim() ?? '';
  const deleted = (d: PDFDict | null) => d?.lookupMaybe(PDFName.of('Deleted'), PDFBool)?.asBoolean() === true;
  // A deleted column can share its name with a live one ("Priority" removed, then added again).
  const at = (c: CustomColumn) => original.findIndex((d) => !deleted(d) && nameOfColumn(d) === c.name.trim());
  // Columns the file had, in the file's order (deleted ones kept as they are), then new ones.
  const slots: { c: CustomColumn | null; from: number }[] = [];
  original.forEach((d, i) => {
    if (deleted(d)) slots.push({ c: null, from: i });
    else for (const c of columns) if (at(c) === i) slots.push({ c, from: i });
  });
  for (const c of columns) if (at(c) < 0) slots.push({ c, from: -1 });
  const ordered = slots.map((s) => s.c);
  const from = slots.map((s) => s.from);
  const moved = from.some((f, i) => f >= 0 && f !== i) || original.length > from.filter((f) => f >= 0).length;
  const display = new Map(columns.map((c, i) => [c.id, i]));
  const entries = ordered.map((c, i) => {
    const d = from[i]! >= 0 ? (original[from[i]!]!.clone(doc.context) as PDFDict) : doc.context.obj({});
    if (!c) return d;
    const type = BB_COLUMN_TYPES[c.type];
    if (nameValue(d, 'Subtype') !== type) d.set(PDFName.of('Subtype'), PDFName.of(type));
    if (d.lookupMaybe(PDFName.of('DisplayOrder'), PDFNumber)?.asNumber() !== (display.get(c.id) ?? i)) d.set(PDFName.of('DisplayOrder'), PDFNumber.of(display.get(c.id) ?? i));
    // Text values are only replaced when they differ, so an unchanged column stays byte for byte.
    const setText = (key: string, value: string) => {
      if (d.lookupMaybe(PDFName.of(key), PDFString, PDFHexString)?.decodeText() !== value) d.set(PDFName.of(key), pdfText(value));
    };
    setText('Name', c.name);
    if (c.type === 'multiline' && d.lookupMaybe(PDFName.of('Multiline'), PDFBool)?.asBoolean() !== true) d.set(PDFName.of('Multiline'), PDFBool.True);
    if (c.defaultValue !== undefined) setText('DefaultValue', c.type === 'checkmark' ? (c.defaultValue === 'true' ? 'True' : 'False') : c.defaultValue);
    if (c.type === 'number' || c.type === 'formula') {
      if (!d.has(PDFName.of('Format'))) d.set(PDFName.of('Format'), PDFName.of('Normal'));
      if (c.decimals !== undefined && d.lookupMaybe(PDFName.of('Precision'), PDFNumber)?.asNumber() !== c.decimals) d.set(PDFName.of('Precision'), PDFNumber.of(c.decimals));
    }
    if (c.type === 'formula' && c.formula) setText('Expression', c.formula);
    if (c.type === 'date' && !d.has(PDFName.of('Format'))) d.set(PDFName.of('Format'), pdfText('MM/dd/yyyy'));
    if (c.type === 'choice') {
      const items = d.lookupMaybe(PDFName.of('Items'), PDFArray)?.asArray().map((x) => (doc.context.lookup(x) as PDFString | PDFHexString | undefined)?.decodeText?.() ?? null);
      const options = c.options ?? [];
      if (!items || items.length !== options.length || items.some((x, i) => x !== options[i])) d.set(PDFName.of('Items'), doc.context.obj(options.map((o) => pdfText(o))));
    }
    return d;
  });
  const unchanged =
    existing &&
    !moved &&
    entries.length === original.length &&
    entries.every((d, i) => original[i] && d.toString() === original[i]!.toString());
  // Bluebeam ignores the columns when the catalog holds the array itself: it must be an indirect object, as Bluebeam writes it.
  if (!unchanged) doc.catalog.set(PDFName.of('BSIAnnotColumns'), doc.context.register(doc.context.obj(entries)));
  return { columns: ordered, from, moved };
}

/**
 * A markup's custom column values as Bluebeam's /BSIColumnData. Deleted columns keep the values
 * `old` (the annotation's own /BSIColumnData) had for them.
 */
function columnData(doc: PDFDocument, m: Markup, layout: ColumnLayout, old?: PDFArray): PDFArray {
  const values = layout.columns.map((c, i) => {
    if (!c) {
      const f = layout.from[i]!;
      const v = f >= 0 && old && f < old.size() ? old.lookup(f) : undefined;
      return v instanceof PDFString || v instanceof PDFHexString ? v.decodeText() : '';
    }
    const v = m.fields?.[c.id] ?? '';
    // Bluebeam works calculations out itself.
    if (c.type === 'formula') return '';
    if (c.type === 'checkmark') return v === 'true' ? 'True' : v === 'false' ? 'False' : '';
    if (c.type === 'date') {
      const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
      return d ? `D:${d[1]}${d[2]}${d[3]}000000` : v;
    }
    return v;
  });
  return doc.context.obj(values.map((v) => pdfText(v)));
}

/** An untouched annotation's column values moved to where the columns now sit. */
function realignColumnData(doc: PDFDocument, annot: PDFDict, layout: ColumnLayout) {
  const old = annot.lookupMaybe(PDFName.of('BSIColumnData'), PDFArray);
  if (!old) return;
  const values = old.asArray();
  annot.set(PDFName.of('BSIColumnData'), doc.context.obj(layout.from.map((f) => (f >= 0 && values[f] ? values[f]! : pdfText('')))));
}

// ---- Bluebeam Spaces and viewports ----------------------------------------------------------------

/** Writes the page's Bluebeam Spaces back: unchanged ones as they were, edited ones updated, deleted ones gone. */
function writeSpaces(doc: PDFDocument, page: PDFPage, matrix: Matrix, spaces: readonly Markup[], imported: readonly number[]) {
  const list = page.node.lookupMaybe(PDFName.of('BSISpaces'), PDFArray);
  if (!list) return;
  const byIndex = new Map(spaces.map((m) => [m.pdfAnnot!.index, m]));
  const keep: PDFObject[] = [];
  list.asArray().forEach((entry, i) => {
    if (!imported.includes(i)) {
      keep.push(entry);
      return;
    }
    const m = byIndex.get(i);
    if (!m) return;
    if (unchangedSinceImport(m)) {
      keep.push(entry);
      return;
    }
    const orig = doc.context.lookup(entry);
    const d = orig instanceof PDFDict ? (orig.clone(doc.context) as PDFDict) : doc.context.obj({ Type: 'Space' });
    d.set(PDFName.of('Title'), pdfText(m.subject || 'Space'));
    d.set(PDFName.of('Path'), doc.context.obj(m.points.map((p) => apply(matrix, p))));
    d.set(PDFName.of('C'), doc.context.obj(rgb(m.style.fill ?? m.style.stroke)));
    d.set(PDFName.of('CA'), PDFNumber.of(m.style.fillOpacity ?? 0.1));
    d.set(PDFName.of(APP_DATA_KEY), pdfText(JSON.stringify(appData(m))));
    keep.push(entry instanceof PDFRef ? (doc.context.assign(entry, d), entry) : d);
  });
  if (keep.length) page.node.set(PDFName.of('BSISpaces'), doc.context.obj(keep));
  else page.node.delete(PDFName.of('BSISpaces'));
}

/**
 * Markups grouped here are grouped for Bluebeam too: one annotation leads (it lists the members in
 * /GroupNesting) and the rest point at it with /IRT and /RT /Group. A Cloud+ (a cloud with its
 * callout) leads with the callout and carries the Cloud+ name and PolyText intent, as Bluebeam's does.
 */
function writeGroups(doc: PDFDocument, made: ReadonlyMap<Markup, { dict: PDFDict; ref: PDFRef }>) {
  const groups = new Map<string, Markup[]>();
  for (const m of made.keys()) {
    if (!m.groupId) continue;
    if (!groups.has(m.groupId)) groups.set(m.groupId, []);
    groups.get(m.groupId)!.push(m);
  }
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const cloud = members.find((m) => m.type === 'cloud');
    const callout = members.find((m) => m.type === 'callout');
    const cloudPlus = members.length === 2 && !!cloud && !!callout;
    const leader = (cloudPlus ? callout : members[0])!;
    const name = cloudPlus ? 'Cloud+' : 'Group';
    const lead = made.get(leader)!;
    lead.dict.set(PDFName.of('GroupNesting'), doc.context.obj([PDFHexString.fromText(name), PDFHexString.fromText(`/${leader.id}`), ...members.filter((m) => m !== leader).map((m) => PDFHexString.fromText(`/${m.id}`))]));
    for (const m of members) {
      const { dict } = made.get(m)!;
      if (m !== leader) {
        dict.set(PDFName.of('IRT'), lead.ref);
        dict.set(PDFName.of('RT'), PDFName.of('Group'));
      }
      if (cloudPlus) {
        dict.set(PDFName.of('Subj'), pdfText(name));
        dict.set(PDFName.of('ITEx'), PDFName.of('PolyText'));
      }
    }
  }
}

/** The document's assemblies as JSON in the catalog (other tools ignore the key); none removes it. */
function writeAssemblies(doc: PDFDocument, assemblies: readonly Assembly[]) {
  const key = PDFName.of(ASSEMBLIES_KEY);
  if (!assemblies.length) {
    doc.catalog.delete(key);
    return;
  }
  const json = JSON.stringify(assemblies);
  if (doc.catalog.lookupMaybe(key, PDFString, PDFHexString)?.decodeText() !== json) doc.catalog.set(key, pdfText(json));
}

/** A new Space in its page's /BSISpaces, the entry Bluebeam's Spaces panel lists. */
function addSpace(doc: PDFDocument, page: PDFPage, matrix: Matrix, m: Markup) {
  const entry = doc.context.obj({
    Type: 'Space',
    Title: pdfText(m.subject || 'Space'),
    Path: m.points.map((p) => apply(matrix, p)),
    C: rgb(m.style.fill ?? m.style.stroke),
    CA: m.style.fillOpacity ?? 0.1,
    // What Bluebeam has no place for (comments, fields, hatching): ours come back whole from here.
    [APP_DATA_KEY]: pdfText(JSON.stringify(appData(m))),
  });
  const key = PDFName.of('BSISpaces');
  const list = page.node.lookupMaybe(key, PDFArray);
  if (list) list.push(entry);
  else page.node.set(key, doc.context.obj([entry]));
}

/** Takes a deleted annotation's /Flag out of the catalog's /BSIFlags, so the Flags panel does not list it. */
function dropFlag(doc: PDFDocument, annot: PDFObject | undefined) {
  if (!(annot instanceof PDFDict)) return;
  const flag = annot.get(PDFName.of('Flag'));
  const list = doc.catalog.lookupMaybe(PDFName.of('BSIFlags'), PDFArray);
  if (!flag || !list) return;
  const at = list.asArray().findIndex((e) => e === flag);
  if (at >= 0) list.remove(at);
}

/**
 * Makes a flag label one of Bluebeam's Flags: the annotation points at a /Flag dictionary (whose
 * parent is the annotation), and the catalog's /BSIFlags lists them for the Flags panel.
 */
function addFlag(doc: PDFDocument, annot: PDFDict, ref: PDFRef) {
  const flag = doc.context.register(doc.context.obj({ Type: 'Flag', Parent: ref }));
  annot.set(PDFName.of('Flag'), flag);
  const key = PDFName.of('BSIFlags');
  const list = doc.catalog.lookupMaybe(key, PDFArray);
  if (list) list.push(flag);
  else doc.catalog.set(key, doc.context.obj([flag]));
}

const yOf = (s: Scale) => s.yMetersPerPoint ?? s.metersPerPoint;
const sameScale = (a: Scale | null, b: Scale | null) =>
  a === b ||
  (!!a && !!b && a.unit === b.unit && a.feetInches === b.feetInches && Math.abs(a.metersPerPoint / b.metersPerPoint - 1) < 1e-6 && Math.abs(yOf(a) / yOf(b) - 1) < 1e-6);

/**
 * Writes the page's scale and viewports as Bluebeam's /VP when they differ from what the file
 * already says, so Bluebeam measures at the same scale.
 */
function writeViewports(doc: PDFDocument, page: PDFPage, pageIndex: number, scale: Scale | null, viewports: readonly Viewport[]) {
  const matrix = pageMatrix(page);
  const existing = page.node.lookupMaybe(PDFName.of('VP'), PDFArray);
  // Map registrations (geospatial PDFs) are not scales: they stay as the file has them.
  const geo = existing?.asArray().filter((v) => isGeoViewport(toPdfDict(doc.context, v))) ?? [];
  const crop = page.getCropBox();
  const turned = page.getRotation().angle % 180 !== 0;
  if (existing) {
    const current = importViewports(pageIndex, {
      matrix,
      width: turned ? crop.height : crop.width,
      height: turned ? crop.width : crop.height,
      annots: [],
      objectNumbers: [],
      viewports: existing.asArray().flatMap((v) => {
        const d = toPdfDict(doc.context, v);
        return d ? [d] : [];
      }),
      spaces: [],
    });
    const near = (x: number, y: number) => Math.abs(x - y) < 0.5;
    const same =
      sameScale(current.scale, scale) &&
      current.viewports.length === viewports.length &&
      viewports.every((v) => current.viewports.some((c) => sameScale(c.scale, v.scale) && near(c.rect.x, v.rect.x) && near(c.rect.y, v.rect.y) && near(c.rect.w, v.rect.w) && near(c.rect.h, v.rect.h)));
    if (same) return;
  } else if (!scale && !viewports.length) return;
  const entries = [
    ...(scale ? [doc.context.obj({ Type: 'Viewport', BBox: [crop.x, crop.y, crop.x + crop.width, crop.y + crop.height], Measure: measureDict(scale) })] : []),
    ...viewports.map((v) => doc.context.obj({ Type: 'Viewport', BBox: userRect(matrix, v.rect), Name: pdfText(v.name), Measure: measureDict(v.scale) })),
    ...geo,
  ];
  if (entries.length) page.node.set(PDFName.of('VP'), doc.context.obj(entries));
  else page.node.delete(PDFName.of('VP'));
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
  /** The PDF's own Bluebeam Spaces that were imported (by page, /BSISpaces index). */
  importedSpaces?: Record<number, number[]>;
  /**
   * Pages' own scales (only those set), written as Bluebeam's /VP with `viewports` where they differ
   * from the file's, so other tools measure at the same scale.
   */
  pageScales?: Readonly<Record<number, Scale>>;
  /** The document's custom columns, written as Bluebeam's columns and each markup's values. */
  columns?: readonly CustomColumn[];
  /** The document's statuses, for the names of review states. */
  statuses?: readonly MarkupStatusDef[];
  /** The document's assemblies, kept in the catalog's /NBAssemblies; unset leaves the file's own as they are. */
  assemblies?: readonly Assembly[];
  /**
   * Embeds a font file in place of a standard 14 font (which is only named, and which PDF/A does
   * not allow): e.g. a TrueType font with the same widths. Unset, the standard fonts are used.
   */
  embedFont?: (doc: PDFDocument, name: StandardFonts) => Promise<PDFFont>;
  /**
   * Used in place of the standard fonts (even without `embedFont`) when some markup text has
   * characters they cannot show (Greek, Cyrillic), which would otherwise be drawn as question marks.
   */
  fallbackFont?: (doc: PDFDocument, name: StandardFonts) => Promise<PDFFont>;
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
  const pages = doc.getPages();
  const statuses = options.statuses ?? [];

  // Imported markups stand for annotations already in the file (or Bluebeam Spaces): unchanged ones
  // leave them exactly as they are, changed ones are written over them in place.
  const importedSet = (p: number) => new Set(options.imported?.[p] ?? []);
  const linkedTo = (m: Markup): 'annot' | 'space' | null => {
    const l = m.pdfAnnot;
    if (!l || (l.id ?? m.id) !== m.id) return null;
    if (l.space) return options.importedSpaces?.[m.pageIndex]?.includes(l.index) ? 'space' : null;
    return importedSet(m.pageIndex).has(l.index) ? 'annot' : null;
  };
  // Only one markup may stand for each annotation part (a copy keeps the link but is a new markup).
  const claimed = new Set<string>();
  const link = new Map<Markup, 'annot' | 'space'>();
  for (const m of [...markups].sort((a, b) => a.createdAt - b.createdAt)) {
    const kind = linkedTo(m);
    const key = kind && `${kind}:${m.pageIndex}:${m.pdfAnnot!.index}:${m.pdfAnnot!.part ?? 0}`;
    if (!kind || claimed.has(key!)) continue;
    claimed.add(key!);
    link.set(m, kind);
  }
  const changed = (m: Markup) => !link.has(m) || !unchangedSinceImport(m);
  // A new Space belongs in the page's /BSISpaces, where Bluebeam keeps them, not among its annotations.
  const isNewSpace = (m: Markup) => m.type === 'space' && !link.has(m);
  // What gets an annotation written from it: new and changed markups, never Bluebeam Spaces.
  const written = markups.filter((m) => link.get(m) !== 'space' && !isNewSpace(m) && changed(m));

  // Embed only the fonts some written markup's text or label uses.
  const fonts = new Map<StandardFonts, PDFFont>();
  const embedder = options.fallbackFont && needsUnicodeFont(written) ? options.fallbackFont : options.embedFont;
  for (const m of written) {
    // Stamps always letter in Helvetica, the headline bold.
    const names = [
      ...(m.type === 'stamp'
        ? [StandardFonts.HelveticaBold, StandardFonts.Helvetica, ...(m.stamp?.art ? [StandardFonts.HelveticaBoldOblique, StandardFonts.HelveticaOblique] : [])]
        : styleCapabilities(m.type).font ? [standardFont(m.style, isMeasureKind(m.type))] : []),
      // A table's cells can each have a font of their own.
      ...(m.type === 'table' ? tableCells(m).map((c) => standardFont(c.style, false)) : []),
      ...(m.style.lineStyle ? lineStyleFonts(m.style.lineStyle).map(artStandardFont) : []),
    ];
    for (const name of names) if (!fonts.has(name)) fonts.set(name, await (embedder ? embedder(doc, name) : doc.embedFont(name)));
  }
  const images = new Map<string, PDFImage>();
  for (const m of written) {
    const src = isImageType(m.type) || m.type === 'attachment' ? m.image : m.type === 'stamp' ? m.stamp?.art?.image : undefined;
    if (!src || images.has(src)) continue;
    const img = await embedDataUrl(doc, src);
    if (img) images.set(src, img);
  }
  const placeNames = addPlaces(doc, pages, options.places ?? []);
  if (options.bookmarks) writeOutline(doc, pages, options.bookmarks, placeNames);
  if (options.pageLabels?.some((l) => l)) writePageLabels(doc, options.pageLabels);
  const columns = writeColumns(doc, options.columns ?? [], markups.some((m) => m.fields && Object.keys(m.fields).length));
  if (options.assemblies) writeAssemblies(doc, options.assemblies);
  if (options.pageScales || options.viewports?.length) {
    pages.forEach((page, i) => writeViewports(doc, page, i, options.pageScales?.[i] ?? null, (options.viewports ?? []).filter((v) => v.pageIndex === i)));
  }
  const layerRefs = addMarkupLayers(doc, written);

  const byPage = new Map<number, Markup[]>();
  for (const m of markups) {
    if (!byPage.has(m.pageIndex)) byPage.set(m.pageIndex, []);
    byPage.get(m.pageIndex)!.push(m);
  }
  const pageIndexes = new Set([...byPage.keys(), ...Object.keys(options.imported ?? {}).map(Number), ...Object.keys(options.importedSpaces ?? {}).map(Number)]);
  for (const pageIndex of [...pageIndexes].sort((a, b) => a - b)) {
    const page = pages[pageIndex];
    if (!page) continue;
    const list = (byPage.get(pageIndex) ?? []).sort((a, b) => a.createdAt - b.createdAt);
    const ctx: Ctx = { doc, page, matrix: pageMatrix(page), fonts, images, scale: scaleFor(pageIndex), all: markups, scaleFor, scaleOf, pages, placeNames };
    const build = (m: Markup, orig?: PDFDict) => {
      const dict = annotationDict({ ...ctx, scale: scaleOf(m) }, m);
      // Markups on a layer show and hide with it in other viewers too.
      const oc = m.layer ? layerRefs.get(m.layer) : undefined;
      if (oc) dict.set(PDFName.of('OC'), oc);
      if (columns && (m.fields || dict.has(PDFName.of('BSIColumnData')))) dict.set(PDFName.of('BSIColumnData'), columnData(doc, m, columns, orig?.lookupMaybe(PDFName.of('BSIColumnData'), PDFArray)));
      return dict;
    };

    // The page's imported annotations, by /Annots index, with the markups standing for them.
    const annots = page.node.Annots();
    const imported = importedSet(pageIndex);
    const parts = new Map<number, Markup[]>();
    for (const m of list) {
      if (link.get(m) !== 'annot') continue;
      const i = m.pdfAnnot!.index;
      if (!parts.has(i)) parts.set(i, []);
      parts.get(i)!.push(m);
    }
    // Annotations saved with another's markup: popups, replies, states, and a count's other items.
    const owned = new Set([...parts.values()].flat().flatMap((m) => [...(m.pdfAnnot?.owned ?? []), ...(m.pdfAnnot?.members?.slice(1) ?? [])]));
    const remove = new Set<number>();
    const added: PDFRef[] = [];
    if (annots) {
      for (const index of imported) {
        if (index >= annots.size()) continue;
        const entry = annots.get(index);
        const orig = doc.context.lookup(entry);
        const ms = (parts.get(index) ?? []).sort((a, b) => (a.pdfAnnot!.part ?? 0) - (b.pdfAnnot!.part ?? 0));
        if (!ms.length) {
          // Its markup was deleted (a popup, reply or state goes with the markup it belongs to).
          if (!owned.has(index)) remove.add(index);
          continue;
        }
        if (!(orig instanceof PDFDict)) continue;
        const inkPaths = orig.lookupMaybe(PDFName.of('InkList'), PDFArray)?.size();
        const allParts = ms[0]!.pdfAnnot!.part === undefined || ms.length === inkPaths;
        if (allParts && ms.every((m) => !changed(m))) {
          if (columns?.moved) realignColumnData(doc, orig, columns);
          continue;
        }
        const main = ms[0]!;
        // A count imported from one annotation per item writes each item over its own annotation.
        const items = main.type === 'count' && main.pdfAnnot!.members ? main.points.map((p) => ({ ...main, points: [p] })) : null;
        const first = items?.[0] ?? main;
        const ours = build(first, orig);
        // Ink strokes split into several markups go back as one annotation.
        if (ms.length > 1 && (main.type === 'pen' || main.type === 'highlighter')) ours.set(PDFName.of('InkList'), doc.context.obj(ms.map((m) => m.points.flatMap((p) => apply(ctx.matrix, p)))));
        const merged = mergeAnnotation(doc, orig, ours, nativeForm(orig, first, ctx.matrix));
        if (columns?.moved && !merged.has(PDFName.of('BSIColumnData'))) realignColumnData(doc, merged, columns);
        // Written over the same object, so anything pointing at it (popups, replies, groups) still does.
        let parentRef: PDFRef;
        if (entry instanceof PDFRef) {
          doc.context.assign(entry, merged);
          parentRef = entry;
        } else {
          parentRef = doc.context.register(merged);
          annots.set(index, parentRef);
        }

        // Replies and review states: those still here stay, removed ones go, new ones are added.
        const replies = new Map((main.replies ?? []).map((r) => [r.id, r]));
        const known = new Map<string, PDFRef>();
        for (const i of main.pdfAnnot!.owned ?? []) {
          const entryI = annots.get(i);
          const o = doc.context.lookup(entryI);
          if (!(o instanceof PDFDict) || nameValue(o, 'Subtype') !== 'Text' || o.has(PDFName.of('StateModel'))) continue;
          const id = o.lookupMaybe(PDFName.of('NM'), PDFString, PDFHexString)?.decodeText() ?? `pdf-${pageIndex}-${i}`;
          const reply = replies.get(id);
          if (!reply) {
            remove.add(i);
            continue;
          }
          if (entryI instanceof PDFRef) known.set(id, entryI);
          if ((o.lookupMaybe(PDFName.of('Contents'), PDFString, PDFHexString)?.decodeText() ?? '').replace(/\r\n?/g, '\n').replace(/\n+$/, '') !== reply.text) {
            o.set(PDFName.of('Contents'), pdfText(reply.text));
            o.delete(PDFName.of('RC'));
          }
          replies.delete(id);
        }
        added.push(...placeReplies(doc, parentRef, main, known));
        statesToWrite(main, true, statuses).forEach((s, n) => added.push(doc.context.register(stateDict(doc, parentRef, main, s.state, s.model, s.change, n))));
        if (!!main.checked !== !!main.pdfAnnot!.checked) added.push(doc.context.register(stateDict(doc, parentRef, main, main.checked ? 'Marked' : 'Unmarked', 'Marked')));
        if (items) {
          const members = main.pdfAnnot!.members!;
          const names: PDFObject[] = [];
          items.forEach((item, k) => {
            const at = members[k];
            const entryK = k === 0 ? entry : at !== undefined && at < annots.size() ? annots.get(at) : null;
            const origK = entryK ? doc.context.lookup(entryK) : null;
            const own = origK instanceof PDFDict ? origK : orig;
            const dict = k === 0 ? merged : mergeAnnotation(doc, own, build(item), nativeForm(own, item, ctx.matrix));
            // Every item says the count's total.
            dict.set(PDFName.of('NumCounts'), PDFNumber.of(items.length));
            dict.set(PDFName.of('Contents'), pdfText(String(items.length)));
            refreshRichText(dict);
            if (k > 0 && !(origK instanceof PDFDict)) {
              // A new item: the first item's form, in its group.
              dict.set(PDFName.of('NM'), pdfText(`${main.id}-${k}`));
              dict.set(PDFName.of('IRT'), parentRef);
              dict.set(PDFName.of('RT'), PDFName.of('Group'));
              dict.delete(PDFName.of('GroupNesting'));
              added.push(doc.context.register(dict));
            } else if (k > 0 && entryK instanceof PDFRef) doc.context.assign(entryK, dict);
            names.push(PDFHexString.fromText(`/${dict.lookupMaybe(PDFName.of('NM'), PDFString, PDFHexString)?.decodeText() ?? ''}`));
          });
          // Items deleted here go; the group lists those left.
          for (const at of members.slice(items.length)) remove.add(at);
          const nesting = merged.lookupMaybe(PDFName.of('GroupNesting'), PDFArray);
          if (nesting) merged.set(PDFName.of('GroupNesting'), doc.context.obj([nesting.get(0), ...names]));
        }
        // Further strokes than the annotation had are new annotations.
        if (!(main.type === 'pen' || main.type === 'highlighter')) for (const extra of ms.slice(1)) added.push(doc.context.register(build(extra)));
      }
      // Annotations that were not imported keep their column values where the columns now are.
      if (columns?.moved) {
        annots.asArray().forEach((entry, i) => {
          if (imported.has(i)) return;
          const d = doc.context.lookup(entry);
          if (d instanceof PDFDict) realignColumnData(doc, d, columns);
        });
      }
      for (const i of [...remove].sort((a, b) => b - a)) {
        dropFlag(doc, doc.context.lookup(annots.get(i)));
        annots.remove(i);
      }
    }
    for (const ref of added) page.node.addAnnot(ref);

    // Bluebeam Spaces stay in /BSISpaces.
    const importedSpaces = options.importedSpaces?.[pageIndex];
    if (importedSpaces?.length) writeSpaces(doc, page, ctx.matrix, list.filter((m) => link.get(m) === 'space'), importedSpaces);

    // New markups, and imported ones whose annotation is gone, are added.
    const made = new Map<Markup, { dict: PDFDict; ref: PDFRef }>();
    for (const m of list) {
      if (link.has(m)) continue;
      if (isNewSpace(m)) {
        addSpace(doc, page, ctx.matrix, m);
        continue;
      }
      // A count is one annotation per item, grouped, each saying the group's total (and only the first carries our data).
      const items = m.type === 'count' && m.points.length ? m.points.map((p, i) => ({ ...m, id: i ? `${m.id}~${i}` : m.id, points: [p], style: { ...m.style, showLabel: false } })) : [m];
      const dict = build(items[0]!);
      if (m.type === 'count') {
        dict.set(PDFName.of(APP_DATA_KEY), pdfText(JSON.stringify(appData(m))));
        dict.set(PDFName.of('NumCounts'), PDFNumber.of(items.length));
        dict.set(PDFName.of('Contents'), pdfText(String(items.length)));
      }
      const ref = doc.context.register(dict);
      page.node.addAnnot(ref);
      made.set(m, { dict, ref });
      if (m.type === 'count' && items.length > 1) {
        const others = items.slice(1).map((item) => {
          const d = build(item);
          d.set(PDFName.of(APP_DATA_KEY), pdfText(JSON.stringify({ replyTo: m.id })));
          d.set(PDFName.of('NumCounts'), PDFNumber.of(items.length));
          d.set(PDFName.of('Contents'), pdfText(String(items.length)));
          d.set(PDFName.of('IRT'), ref);
          d.set(PDFName.of('RT'), PDFName.of('Group'));
          page.node.addAnnot(doc.context.register(d));
          return item.id;
        });
        dict.set(PDFName.of('GroupNesting'), doc.context.obj([PDFString.of('Count Measurement'), PDFHexString.fromText(`/${m.id}`), ...others.map((id) => PDFHexString.fromText(`/${id}`))]));
      }
      if (m.type === 'flagLabel') addFlag(doc, dict, ref);
      for (const replyRef of placeReplies(doc, ref, m, new Map())) page.node.addAnnot(replyRef);
      statesToWrite(m, false, statuses).forEach((s, n) => page.node.addAnnot(doc.context.register(stateDict(doc, ref, m, s.state, s.model, s.change, n))));
      if (m.checked) page.node.addAnnot(doc.context.register(stateDict(doc, ref, m, 'Marked', 'Marked')));
    }
    writeGroups(doc, made);
  }
  if (options.links) addLinks(doc, pages, options.links);
  return doc.save();
}
