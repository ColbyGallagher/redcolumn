import type { BpxProfile } from './bpx';
import type { Dropped } from './diagnostics';
import type { HatchSet } from './hatchSet';
import type { LineSet } from './lineSet';
import type { Markup, MarkupStyle, MarkupType } from './model';
import type { LineEnding } from './style';
import { parsePdfObject, type PdfDict, type PdfName, type PdfValue, type RevuToolSource, type ToolChestItem, type ToolSet } from './toolchest';

/**
 * Writes Revu's settings files back out: .blx line style sets, .bhx hatch sets, .bpx markup-list
 * profiles and .btx tool sets. Each writer is the reverse of its reader (lineSet.ts, hatchSet.ts,
 * bpx.ts, toolchest.ts), laid out the way Revu writes the file (CRLF, two-space indent, titles as
 * hex of zlib-compressed text). Anything a writer cannot express is listed in `dropped`.
 */

const NL = '\r\n';
const BOM = '﻿';
const HEAD = '<?xml version="1.0" encoding="utf-8"?>';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const bool = (b: boolean) => (b ? 'True' : 'False');

/** A number as Revu writes it: plain decimals, never an exponent. */
export function fmt(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const s = String(n);
  if (!/e/i.test(s)) return s;
  return n
    .toFixed(10)
    .replace(/(\.\d*?)0+$/, '$1')
    .replace(/\.$/, '');
}

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const latin1Bytes = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 255);

/** Bytes held as Latin-1 characters (a PDF dictionary or object) as Revu stores them: hex of zlib-compressed bytes. */
export async function packText(text: string): Promise<string> {
  return hex(await deflate(latin1Bytes(text)));
}

/** A set's title as Revu stores it: hex of zlib-compressed UTF-8 (read back as UTF-8, else Latin-1). */
const packTitle = async (title: string) => hex(await deflate(new TextEncoder().encode(title)));

// --- .blx -----------------------------------------------------------------------------------

/** A line style set as a .blx file. Components that are not dashes, gaps, text or symbols are left out. */
export async function writeBlx(set: LineSet, dropped: Dropped[] = []): Promise<string> {
  const out = [HEAD, '<BluebeamRevuLineStyleSet Version="1">', `  <Title>${await packTitle(set.title)}</Title>`];
  set.styles.forEach((style, n) => {
    const item = `${n + 1}. ${style.name}`;
    const [scaled, ...lines] = style.spec;
    out.push(`  <LineStyle Name="${esc(style.name)}" ScaleWithLineWidth="${bool(scaled !== false)}">`);
    for (const line of lines) {
      if (!Array.isArray(line)) {
        dropped.push({ item, reason: 'a line in the pattern is not a list' });
        continue;
      }
      const [offset, ...parts] = line as unknown[];
      out.push(`    <Line Offset="${fmt(typeof offset === 'number' ? offset : 0)}">`);
      let index = 0;
      for (const part of parts) {
        const at = index;
        if (typeof part === 'number' && part !== 0) {
          out.push(`      <Component Type="${part > 0 ? 'Dash' : 'Space'}" Index="${at}" Width="${fmt(Math.abs(part))}" />`);
        } else if (Array.isArray(part) && typeof part[0] === 'string') {
          const [text, font, size, b, i, upright] = part as [string, unknown, unknown, unknown, unknown, unknown];
          out.push(
            `      <Component Type="Text" Index="${at}" Text="${esc(text)}">`,
            `        <Font>${esc(typeof font === 'string' ? font : 'Helvetica')}</Font>`,
            `        <Bold>${bool(b === true)}</Bold>`,
            `        <Italic>${bool(i === true)}</Italic>`,
            `        <Size>${fmt(typeof size === 'number' ? size : 6)}</Size>`,
            `        <Upright>${bool(upright !== false)}</Upright>`,
            '      </Component>',
          );
        } else if (Array.isArray(part) && typeof part[0] === 'number' && part.length > 4) {
          const [left, right, scale, fill, ...pts] = part as unknown[];
          const n = (v: unknown) => fmt(typeof v === 'number' ? v : 0);
          out.push(`      <Component Type="Vector" Index="${at}" Left="${n(left)}" Right="${n(right)}" Scale="${n(scale)}" Fill="${bool(fill === true)}">`);
          for (let k = 0, p = 0; k + 2 < pts.length; k += 3, p++) {
            const type = pts[k] === 0 ? 'Start' : pts[k] === 2 ? 'Curve' : 'Line';
            out.push(`        <Point Type="${type}" Index="${p}" X="${n(pts[k + 1])}" Y="${n(pts[k + 2])}" />`);
          }
          out.push('      </Component>');
        } else {
          dropped.push({ item, reason: 'a component is not a dash, gap, text or symbol' });
          continue;
        }
        index++;
      }
      out.push('    </Line>');
    }
    out.push('  </LineStyle>');
  });
  out.push('</BluebeamRevuLineStyleSet>');
  return BOM + out.join(NL) + NL;
}

// --- .bhx -----------------------------------------------------------------------------------

/** Revu's named tile sizes, by their edge in points. */
const TILE_NAMES: [number, string][] = [
  [18, 'QuarterInch'],
  [36, 'HalfInch'],
  [72, 'OneInch'],
  [72 / 2.54, 'Centimeter'],
  [72 / 25.4, 'Millimeter'],
];

type HatchEntry = Pick<HatchSet['hatches'][number], 'name' | 'spec'>;

/** A hatch set as a .bhx file. A tile size Revu has no name for is written as the nearest one, and reported. */
export async function writeBhx(set: { title: string; hatches: readonly HatchEntry[] }, dropped: Dropped[] = []): Promise<string> {
  const out = [HEAD, '<BluebeamRevuHatchSet Version="1">', `  <Title>${await packTitle(set.title)}</Title>`];
  set.hatches.forEach((h, n) => {
    const s = h.spec;
    const nearest = TILE_NAMES.reduce((a, b) => (Math.abs(b[0] - s.size) < Math.abs(a[0] - s.size) ? b : a));
    if (Math.abs(nearest[0] - s.size) > 1e-6) dropped.push({ item: `${n + 1}. ${h.name}`, reason: `a ${fmt(+s.size.toFixed(2))} pt tile has no Revu size, so ${nearest[1]} is written` });
    out.push(
      `  <Hatch Name="${esc(h.name)}">`,
      `    <ScaleX>${fmt(s.scaleX)}</ScaleX>`,
      `    <ScaleY>${fmt(s.scaleY)}</ScaleY>`,
      `    <Size>${nearest[1]}</Size>`,
      `    <LineWidth>${fmt(s.lineWidth)}</LineWidth>`,
      ...s.elements.map((e) =>
        e.type === 'line'
          ? `    <Element Type="Line" X1="${fmt(e.x1)}" Y1="${fmt(e.y1)}" X2="${fmt(e.x2)}" Y2="${fmt(e.y2)}" />`
          : `    <Element Type="Dot" X="${fmt(e.x)}" Y="${fmt(e.y)}" Size="${e.size === 'large' ? 'Large' : 'Small'}" />`,
      ),
      '  </Hatch>',
    );
  });
  out.push('</BluebeamRevuHatchSet>');
  return out.join(NL) + NL;
}

// --- .bpx -----------------------------------------------------------------------------------

/**
 * A markup-list profile as a .bpx file. Only the MarkupList record is written: Revu keeps its own
 * settings for everything else the profile does not mention.
 */
export function writeBpx(p: BpxProfile): string {
  const out = [HEAD, `<RevuProfile Version="1" Name="${esc(p.name)}">`, '  <Record Key="MarkupList">', '    <ActiveColumn>0</ActiveColumn>', '    <Columns>'];
  for (const c of p.columns)
    out.push(`      <Column Key="${esc(c.key)}">`, `        <Width>${Math.round(c.width)}</Width>`, `        <Visible>${bool(c.visible)}</Visible>`, `        <Added>${bool(c.added)}</Added>`, '      </Column>');
  out.push('    </Columns>', '    <DisplayOrder>', ...p.columns.map((c) => `      <Column Key="${esc(c.key)}" />`), '    </DisplayOrder>');
  if (p.customColumns.length) {
    out.push('    <CustomColumns>');
    p.customColumns.forEach((c, order) =>
      out.push(
        `      <BSIColumnItem Index="${c.index}" Subtype="${esc(c.subtype)}">`,
        `        <Name>${esc(c.name)}</Name>`,
        `        <DisplayOrder>${order}</DisplayOrder>`,
        `        <Deleted>${bool(c.deleted)}</Deleted>`,
        `        <Multiline>${bool(c.multiline)}</Multiline>`,
        '      </BSIColumnItem>',
      ),
    );
    out.push('    </CustomColumns>');
  }
  out.push('  </Record>', '</RevuProfile>');
  return BOM + out.join(NL) + NL;
}

// --- PDF objects ----------------------------------------------------------------------------

const isName = (v: PdfValue | undefined): v is PdfName => typeof v === 'object' && v !== null && !Array.isArray(v) && Object.keys(v).length === 1 && typeof (v as PdfName).name === 'string';
const name = (n: string): PdfName => ({ name: n });

/** A PDF object as text, the reverse of `parsePdfObject`. */
export function pdfText(v: PdfValue): string {
  if (v === null) return 'null';
  if (typeof v === 'boolean') return String(v);
  if (typeof v === 'number') return fmt(v);
  if (typeof v === 'string') {
    if (/^[\0-\xff]*$/.test(v)) return `(${v.replace(/[\\()]/g, '\\$&').replace(/\r/g, '\\r').replace(/\n/g, '\\n')})`;
    let h = 'feff';
    for (const ch of v) {
      const c = ch.codePointAt(0)!;
      if (c > 0xffff) {
        const u = c - 0x10000;
        h += (0xd800 + (u >> 10)).toString(16).padStart(4, '0') + (0xdc00 + (u & 0x3ff)).toString(16).padStart(4, '0');
      } else h += c.toString(16).padStart(4, '0');
    }
    return `<${h}>`;
  }
  if (Array.isArray(v)) return `[${v.map(pdfText).join(' ')}]`;
  if (isName(v)) return '/' + v.name.replace(/[^!-~]|[#()<>[\]{}/%]/g, (c) => '#' + c.charCodeAt(0).toString(16).padStart(2, '0'));
  return `<<${Object.entries(v)
    .map(([k, x]) => {
      const t = pdfText(x);
      return `${pdfText(name(k))}${/^[\w.+-]/.test(t) ? ' ' : ''}${t}`;
    })
    .join('')}>>`;
}

// --- .btx -----------------------------------------------------------------------------------

/** How one of our tool types is stored by Revu: its annotation class, /Subtype and /IT. */
interface RevuKind {
  cls: string;
  subtype: string;
  it?: string;
  /** Revu's /MeasurementTypes bits, for measurements. */
  mt?: number;
  geometry: 'box' | 'line' | 'poly' | 'ink' | 'point';
}

/** The tool types we can write, each as Revu's own tool sets store it (read back by `toolType`). */
const KINDS: Partial<Record<MarkupType, RevuKind>> = {
  rect: { cls: 'AnnotationSquare', subtype: 'Square', geometry: 'box' },
  ellipse: { cls: 'AnnotationCircle', subtype: 'Circle', geometry: 'box' },
  arc: { cls: 'AnnotationArc', subtype: 'Circle', geometry: 'box' },
  cloud: { cls: 'AnnotationPolygon', subtype: 'Polygon', it: 'PolygonCloud', geometry: 'poly' },
  polygon: { cls: 'AnnotationPolygon', subtype: 'Polygon', geometry: 'poly' },
  polyline: { cls: 'AnnotationPolyline', subtype: 'PolyLine', geometry: 'poly' },
  line: { cls: 'AnnotationLine', subtype: 'Line', geometry: 'line' },
  arrow: { cls: 'AnnotationLine', subtype: 'Line', it: 'LineArrow', geometry: 'line' },
  pen: { cls: 'AnnotationInk', subtype: 'Ink', geometry: 'ink' },
  highlighter: { cls: 'AnnotationInk', subtype: 'Ink', geometry: 'ink' },
  text: { cls: 'AnnotationFreeText', subtype: 'FreeText', geometry: 'box' },
  callout: { cls: 'AnnotationFreeText', subtype: 'FreeText', it: 'FreeTextCallout', geometry: 'box' },
  typewriter: { cls: 'AnnotationFreeText', subtype: 'FreeText', it: 'FreeTextTypeWriter', geometry: 'box' },
  note: { cls: 'AnnotationText', subtype: 'Text', geometry: 'point' },
  length: { cls: 'AnnotationLine', subtype: 'Line', it: 'LineDimension', mt: 130, geometry: 'line' },
  area: { cls: 'AnnotationMeasureArea', subtype: 'Polygon', it: 'PolygonDimension', mt: 129, geometry: 'poly' },
  perimeter: { cls: 'AnnotationMeasurePerimeter', subtype: 'PolyLine', it: 'PolyLineDimension', mt: 130, geometry: 'poly' },
  polylength: { cls: 'AnnotationMeasurePolylength', subtype: 'PolyLine', it: 'Polylength', mt: 130, geometry: 'poly' },
  count: { cls: 'AnnotationMeasureCount', subtype: 'Polygon', it: 'PolygonCount', mt: 128, geometry: 'poly' },
  angle: { cls: 'AnnotationMeasureAngle', subtype: 'PolyLine', it: 'PolyLineAngle', mt: 1152, geometry: 'poly' },
};

/** Tool types a .btx can carry (others are reported and left out). */
export const BTX_TYPES = Object.keys(KINDS) as MarkupType[];

const LE_NAMES: Record<LineEnding, string> = {
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

const DASHES: Record<string, number[]> = { dashed: [3], dotted: [1], longDash: [8], dashDot: [3, 2, 1, 2], dashDotDot: [3, 2, 1, 2, 1, 2] };

const rgb = (c: string): number[] => {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(c);
  return m ? [1, 2, 3].map((i) => +(parseInt(m[i]!, 16) / 255).toFixed(7)) : [0, 0, 0];
};

const TEXT_TYPES = new Set<MarkupType>(['text', 'callout', 'typewriter']);
const LINE_TYPES = new Set<MarkupType>(['line', 'arrow', 'length', 'polylength']);

/** Lays a tool's style onto its annotation dictionary: the keys `toolStyle` reads, nothing more. */
function applyStyle(d: PdfDict, type: MarkupType, s: MarkupStyle) {
  d.C = rgb(s.stroke);
  if (s.fill) d.IC = rgb(s.fill);
  else if (type !== 'area' && type !== 'count') d.IC = [];
  else delete d.IC;
  d.CA = s.opacity;
  if (s.fill && s.fillOpacity !== undefined) d.FillOpacity = s.fillOpacity;
  else delete d.FillOpacity;
  const bs: PdfDict = { W: s.width, S: name('S'), Type: name('Border') };
  if (s.dash && s.dash !== 'solid') {
    bs.S = name('D');
    bs.D = s.dashArray?.length ? s.dashArray : (DASHES[s.dash] ?? [3]);
  }
  d.BS = bs;
  delete d.Border;
  delete d.D;
  if (LINE_TYPES.has(type) && (s.startCap || s.endCap)) d.LE = [name(LE_NAMES[s.startCap ?? 'none']), name(LE_NAMES[s.endCap ?? 'none'])];
  // Only what the style sets: the reader takes any size, font or colour it finds as the tool's own,
  // for every type (a measurement's label too).
  const text = TEXT_TYPES.has(type);
  if (text || s.fontSize !== undefined || s.fontFamily || s.bold || s.italic || s.underline || s.strikethrough) {
    const [font, family] = s.fontFamily === 'serif' ? ['TiRo', 'Times New Roman'] : s.fontFamily === 'mono' ? ['Cour', 'Courier New'] : ['Helv', 'Helvetica'];
    const ds = [`font: ${family}${s.fontSize !== undefined ? ` ${fmt(s.fontSize)}pt` : ''}`];
    if (text && type !== 'typewriter' && s.textAlign) ds.push(`text-align:${s.textAlign}`);
    if (text && type !== 'typewriter' && s.verticalAlign) ds.push(`text-valign:${s.verticalAlign}`);
    if (text && s.textColor) ds.push(`color:${s.textColor.toUpperCase()}`);
    if (s.bold) ds.push('font-weight:bold');
    if (s.italic) ds.push('font-style:italic');
    if (s.underline || s.strikethrough) ds.push(`text-decoration:${[s.underline && 'underline', s.strikethrough && 'line-through'].filter(Boolean).join(' ')}`);
    d.DS = ds.join('; ');
    // A size of 0 is read as none.
    if (text) d.DA = `${s.textColor ? `${rgb(s.textColor).map(fmt).join(' ')} rg ` : ''}/${font} ${fmt(s.fontSize ?? 0)} Tf`;
    else delete d.DA;
  }
  // A text box drawn without its box has no border (see `toolStyle`).
  if (type === 'text' && s.noBox) bs.W = 0;
}

/** A fresh dictionary for a tool with no Revu original: its class keys and a small default shape. */
function baseDict(type: MarkupType, k: RevuKind, subject: string): PdfDict {
  const d: PdfDict = { Subtype: name(k.subtype), Subj: subject, F: 4 };
  if (k.it) d.IT = name(k.it);
  if (k.mt) {
    d.MeasurementTypes = k.mt;
    d.Measure = { Type: name('Measure'), Subtype: name('RL'), R: '1 in = 1 in', X: [{ Type: name('NumberFormat'), U: 'in', C: 0.01388889, D: 100 }], D: [{ Type: name('NumberFormat'), U: 'in', C: 1, D: 100 }], A: [{ Type: name('NumberFormat'), U: 'sq in', C: 1, D: 100 }] };
  }
  if (type === 'cloud') d.BE = { S: name('C'), I: 1 };
  if (type === 'arc') Object.assign(d, { Angle1: 0, Angle2: 180 });
  if (type === 'note') d.Name = name('Comment');
  if (k.geometry === 'box') Object.assign(d, { Rect: [0, 0, 100, 50] });
  else if (k.geometry === 'point') Object.assign(d, { Rect: [0, 0, 20, 20] });
  else if (k.geometry === 'line') Object.assign(d, { Rect: [0, 0, 110, 10], L: [5, 5, 105, 5] });
  else if (k.geometry === 'ink') Object.assign(d, { Rect: [0, 0, 110, 40], InkList: [[5, 20, 30, 35, 55, 20, 80, 5, 105, 20]] });
  else if (type === 'count') Object.assign(d, { Rect: [0, 0, 20, 20], Vertices: [10, 10] });
  else if (type === 'angle') Object.assign(d, { Rect: [0, 0, 110, 110], Vertices: [105, 5, 5, 5, 105, 105] });
  else Object.assign(d, { Rect: [0, 0, 110, 60], Vertices: [5, 55, 5, 5, 105, 5, 105, 55] });
  return d;
}

/** Where a template markup's shape goes: its dictionary geometry and its /Rect, in page space (y down). */
function shapeOf(m: Markup, geometry: RevuKind['geometry']): { d: PdfDict; x0: number; top: number } | null {
  const pad = Math.max(0.5, m.style.width / 2);
  const xs = m.points.map((p) => p[0]);
  const ys = m.points.map((p) => p[1]);
  if (!xs.length) return null;
  const x0 = Math.min(...xs) - pad;
  const top = Math.min(...ys) - pad;
  const w = Math.max(...xs) + pad - x0;
  const h = Math.max(...ys) + pad - top;
  // Page space to the part's own /Rect space (y up).
  const local = (p: readonly number[]) => [p[0]! - x0, top + h - p[1]!];
  const d: PdfDict = { Rect: [0, 0, w, h] };
  if (geometry === 'box' && m.points.length >= 2) d.RD = [pad, pad, pad, pad];
  else if (geometry === 'line' && m.points.length >= 2) d.L = [...local(m.points[0]!), ...local(m.points[1]!)];
  else if (geometry === 'poly') d.Vertices = m.points.flatMap(local);
  else return null;
  return { d, x0, top };
}

const PLACEABLE = new Set<MarkupType>(['rect', 'ellipse', 'cloud', 'text', 'typewriter', 'line', 'arrow', 'polygon', 'polyline']);

interface Written {
  type: string;
  raw: string;
  x: number;
  y: number;
}

/** A tool group's markups as Revu's tool and <Child> parts, each placed by its <X>/<Y> (the reverse of `groupTemplate`). */
function groupParts(template: readonly Markup[], subject: string): Written[] | null {
  const out: Written[] = [];
  for (const m of template) {
    const k = KINDS[m.type];
    if (!k || !PLACEABLE.has(m.type)) return null;
    // The reader places clouds (and every box type) from their /Rect.
    const shape = shapeOf(m, m.type === 'cloud' ? 'box' : k.geometry);
    if (!shape) return null;
    const d = { ...baseDict(m.type, k, m.subject ?? subject), ...shape.d };
    if (m.type === 'cloud') delete d.Vertices;
    applyStyle(d, m.type, m.style);
    if (m.text !== undefined) d.Contents = m.text;
    // Page y down, so the frame's y up is its negative: the /Rect's lower-left corner is at (x0, -(top + h)).
    const h = (shape.d.Rect as number[])[3]!;
    out.push({ type: `Bluebeam.PDF.Annotations.${k.cls}`, raw: pdfText(d), x: -shape.x0, y: shape.top + h });
  }
  return out;
}

/** The style a tool was imported with, so an unchanged one is written back as Revu stored it. */
const sameStyle = (a: MarkupStyle, b: MarkupStyle) => JSON.stringify(a) === JSON.stringify(b);

// --- Stamps, pictures and files a tool embeds -----------------------------------------------

/** An embedded object's id: Revu's are 16 capital letters, referred to as /BBObjPtr_<id>. */
const objId = (role: string) => `RC${role}XXXXXXXXXXXXXXXX`.slice(0, 16);
const ptr = (id: string) => name(`BBObjPtr_${id}`);

const latin1 = (b: Uint8Array) => {
  let s = '';
  for (let k = 0; k < b.length; k += 0x8000) s += String.fromCharCode(...b.subarray(k, k + 0x8000));
  return s;
};
const fromBase64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** A PDF stream object as text: its dictionary (with /Length) and its bytes. */
const streamObject = (d: PdfDict, bytes: Uint8Array) => `${pdfText({ ...d, Length: bytes.length })}\nstream\n${latin1(bytes)}\nendstream`;

async function resourceXml(id: string, object: string): Promise<string> {
  return ['    <Resources>', `      <ID>${await packText(id)}</ID>`, `      <Data>${await packText(object)}</Data>`, '    </Resources>'].join(NL);
}

interface Content {
  dict: PdfDict;
  cls: string;
  objects: [string, string][];
}

/** A picture as an image XObject (and its soft mask): JPEG as it is, 8-bit PNG unpacked. Null for anything else. */
async function imageObjects(url: string): Promise<[string, string][] | null> {
  const m = /^data:image\/(jpeg|jpg|png);base64,(.*)$/i.exec(url);
  if (!m) return null;
  const bytes = fromBase64(m[2]!);
  const id = objId('IMAGE');
  if (/jpe?g/i.test(m[1]!)) {
    // The size and colour count are in the first start-of-frame marker.
    for (let i = 2; i + 9 < bytes.length; ) {
      if (bytes[i] !== 0xff) return null;
      const marker = bytes[i + 1]!;
      const len = (bytes[i + 2]! << 8) | bytes[i + 3]!;
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        const h = (bytes[i + 5]! << 8) | bytes[i + 6]!;
        const w = (bytes[i + 7]! << 8) | bytes[i + 8]!;
        const cs = bytes[i + 9] === 1 ? 'DeviceGray' : bytes[i + 9] === 4 ? 'DeviceCMYK' : 'DeviceRGB';
        return [[id, streamObject({ Type: name('XObject'), Subtype: name('Image'), Width: w, Height: h, ColorSpace: name(cs), BitsPerComponent: 8, Filter: name('DCTDecode') }, bytes)]];
      }
      i += 2 + len;
    }
    return null;
  }
  // PNG: IHDR, then the IDAT chunks' zlib stream of filtered rows.
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 33 || view.getUint32(12) !== 0x49484452) return null;
  const w = view.getUint32(16);
  const h = view.getUint32(20);
  const depth = bytes[24]!;
  const colorType = bytes[25]!;
  const channels = ({ 0: 1, 2: 3, 4: 2, 6: 4 } as Record<number, number>)[colorType];
  if (depth !== 8 || !channels || bytes[28] !== 0) return null;
  const idat: Uint8Array[] = [];
  for (let i = 8; i + 8 <= bytes.length; ) {
    const len = view.getUint32(i);
    if (view.getUint32(i + 4) === 0x49444154) idat.push(bytes.subarray(i + 8, i + 8 + len));
    i += 12 + len;
  }
  const { removePredictor } = await import('./pdfExtras');
  const raw = removePredictor(await inflate(new Uint8Array(await new Blob(idat as BlobPart[]).arrayBuffer())), 15, w, channels);
  const colors = colorType === 0 || colorType === 4 ? 1 : 3;
  const hasAlpha = channels === 2 || channels === 4;
  const color = new Uint8Array(w * h * colors);
  const alpha = hasAlpha ? new Uint8Array(w * h) : null;
  for (let p = 0; p < w * h; p++) {
    for (let c = 0; c < colors; c++) color[p * colors + c] = raw[p * channels + c]!;
    if (alpha) alpha[p] = raw[p * channels + channels - 1]!;
  }
  const image: PdfDict = { Type: name('XObject'), Subtype: name('Image'), Width: w, Height: h, ColorSpace: name(colors === 1 ? 'DeviceGray' : 'DeviceRGB'), BitsPerComponent: 8, Filter: name('FlateDecode') };
  const out: [string, string][] = [];
  if (alpha) {
    const mask = objId('SMASK');
    image.SMask = ptr(mask);
    out.push([mask, streamObject({ Type: name('XObject'), Subtype: name('Image'), Width: w, Height: h, ColorSpace: name('DeviceGray'), BitsPerComponent: 8, Filter: name('FlateDecode') }, await deflate(alpha))]);
  }
  out.unshift([id, streamObject(image, await deflate(color))]);
  return out;
}

/** A stamp's wording as a form XObject: its lines in its colour, in a frame unless it has none. */
function stampForm(lines: readonly string[], frame: string, color: string, w: number, h: number): string {
  const [r, g, b] = rgb(color).map(fmt);
  const size = Math.max(4, Math.min(24, (h - 4) / Math.max(1, lines.length) / 1.2));
  const ops = ['q'];
  if (frame !== 'none') ops.push(`${r} ${g} ${b} RG 2 w 1 1 ${fmt(w - 2)} ${fmt(h - 2)} re S`);
  ops.push(`${r} ${g} ${b} rg`, 'BT', `/Helv ${fmt(+size.toFixed(2))} Tf`);
  lines.forEach((line, i) => {
    const text = line.replace(/[^\0-\xff]/g, '?');
    ops.push(`1 0 0 1 4 ${fmt(+(h - 2 - size * 1.2 * (i + 1) + size * 0.25).toFixed(2))} Tm`, `${pdfText(text)} Tj`);
  });
  ops.push('ET', 'Q');
  const body = latin1Bytes(ops.join('\n'));
  return streamObject({ Type: name('XObject'), Subtype: name('Form'), BBox: [0, 0, w, h], Resources: { Font: { Helv: { Type: name('Font'), Subtype: name('Type1'), BaseFont: name('Helvetica') } } } }, body);
}

/** A stamp, picture or file tool with no Revu original: its dictionary and the objects it embeds. */
async function contentOf(it: Pick<ToolChestItem, 'type' | 'template' | 'subject' | 'name'>): Promise<Content | null> {
  const m = it.template?.length === 1 ? it.template[0] : undefined;
  if (!m) return null;
  const xs = m.points.map((p) => p[0]);
  const ys = m.points.map((p) => p[1]);
  const w = Math.max(1, Math.max(...xs) - Math.min(...xs));
  const h = Math.max(1, Math.max(...ys) - Math.min(...ys));
  const base: PdfDict = { Subj: it.subject || it.name, Rect: [0, 0, w, h], F: 4 };
  if (it.type === 'stamp' && m.stamp) {
    const id = objId('STAMP');
    return { cls: 'AnnotationBRXStamp', dict: { ...base, Subtype: name('Stamp'), Name: name('Draft'), AP: { N: ptr(id) } }, objects: [[id, stampForm(m.stamp.lines, m.stamp.frame, m.style.stroke, w, h)]] };
  }
  if (it.type === 'attachment' && m.attachment) {
    const spec = objId('SPEC');
    const file = objId('FILE');
    const fname = m.attachment.name.replace(/[^\0-\xff]/g, '_');
    return {
      cls: 'AnnotationFileAttachment',
      dict: { ...base, Subtype: name('FileAttachment'), Name: name('Paperclip'), FS: ptr(spec) },
      objects: [
        [spec, pdfText({ Type: name('Filespec'), F: fname, UF: m.attachment.name, EF: { F: ptr(file) } })],
        [file, streamObject({ Type: name('EmbeddedFile') }, fromBase64(m.attachment.data))],
      ],
    };
  }
  if (it.type === 'image' && m.image) {
    const objects = await imageObjects(m.image);
    return objects && { cls: 'AnnotationBBImage', dict: { ...base, Subtype: name('Square'), Image: ptr(objects[0]![0]) }, objects };
  }
  return null;
}

/**
 * A tool set as a .btx file. A tool imported from Revu and not restyled is written back as Revu
 * stored it (its dictionary, children and embedded pictures); any other tool is built from its type
 * and style, a stamp, picture or file with what it places embedded. Tools Revu cannot carry are
 * listed in `dropped` and left out.
 */
export async function writeBtx(set: Pick<ToolSet, 'title' | 'items'>, dropped: Dropped[] = []): Promise<string> {
  const out = [HEAD, '<BluebeamRevuToolSet Version="1">', `  <Title>${await packTitle(set.title)}</Title>`];
  let index = 0;
  for (const [n, it] of set.items.entries()) {
    const item = `${n + 1}. ${it.name}`;
    const src: RevuToolSource | undefined = it.source;
    const verbatim = !!src && it.type === src.type && sameStyle(it.style, src.style) && (it.subject || it.name) === src.subject;
    let parts: Written[] | null = null;
    let resources = '';
    if (src && verbatim) {
      parts = [{ type: src.revuType, raw: src.raw, x: src.x, y: src.y }];
      resources = src.resources ?? '';
    } else if (src && it.type) {
      // Restyled since it came from Revu: Revu's dictionary with the new style laid over it.
      const parsed = parsePdfObject(src.raw);
      const d = parsed && typeof parsed === 'object' && !Array.isArray(parsed) && !isName(parsed) ? (parsed as PdfDict) : {};
      applyStyle(d, it.type, it.style);
      d.Subj = it.subject || it.name;
      parts = [{ type: src.revuType, raw: pdfText(d), x: src.x, y: src.y }];
      resources = src.resources ?? '';
    } else if (it.type === 'stamp' || it.type === 'image' || it.type === 'attachment') {
      const c = await contentOf(it);
      if (!c) {
        const picture = it.type === 'image' && it.template?.[0]?.image;
        dropped.push({ item, reason: picture ? 'only JPEG and 8-bit PNG pictures are written' : `the ${it.type} has no content to write` });
        continue;
      }
      applyStyle(c.dict, it.type, it.style);
      parts = [{ type: `Bluebeam.PDF.Annotations.${c.cls}`, raw: pdfText(c.dict), x: 0, y: 0 }];
      resources = (await Promise.all(c.objects.map(([id, obj]) => resourceXml(id, obj)))).join(NL);
    } else if (!it.type || !KINDS[it.type]) {
      dropped.push({ item, reason: it.type ? `${it.type} tools have no Revu equivalent yet` : 'the tool has no type' });
      continue;
    } else if (it.template?.length && !(it.template.length === 1 && it.template[0]!.type === it.type && !it.template[0]!.text)) {
      parts = groupParts(it.template, it.subject || it.name);
      if (!parts) {
        dropped.push({ item, reason: 'the tool is a group with parts Revu cannot carry' });
        continue;
      }
    } else {
      const k = KINDS[it.type]!;
      const d = baseDict(it.type, k, it.subject || it.name);
      if (it.tool === 'cloudPlus') d.ITEx = name('PolyText');
      applyStyle(d, it.type, it.style);
      parts = [{ type: `Bluebeam.PDF.Annotations.${k.cls}`, raw: pdfText(d), x: 5, y: 5 }];
    }
    const [self, ...children] = parts;
    out.push('  <ToolChestItem Version="1">');
    if (resources) out.push(resources);
    out.push(`    <Name>${esc(verbatim && src?.name && it.name === src.shown ? src.name : it.name)}</Name>`, `    <Type>${esc(self!.type)}</Type>`, `    <Raw>${await packText(self!.raw)}</Raw>`, `    <X>${fmt(self!.x)}</X>`, `    <Y>${fmt(self!.y)}</Y>`, `    <Index>${index++}</Index>`);
    // Revu's own children stay as they were, restyled or not.
    if (src?.children) out.push(src.children.replace(/<Index>\s*\d+\s*<\/Index>/g, () => `<Index>${index++}</Index>`));
    else
      for (const c of children)
        out.push('    <Child>', `      <Type>${esc(c.type)}</Type>`, `      <Raw>${await packText(c.raw)}</Raw>`, `      <X>${fmt(c.x)}</X>`, `      <Y>${fmt(c.y)}</Y>`, `      <Index>${index++}</Index>`, '    </Child>');
    out.push(`    <Mode>${src?.mode ?? (children.length || it.template ? 'drawing' : 'properties')}</Mode>`);
    if (it.sequence) out.push('    <Sequence>', '      <Enabled>True</Enabled>', '      <Style>Number</Style>', `      <Start>${it.sequence.start}</Start>`, `      <Increment>${it.sequence.increment}</Increment>`, '    </Sequence>');
    out.push('  </ToolChestItem>');
  }
  out.push('</BluebeamRevuToolSet>');
  return BOM + out.join(NL) + NL;
}


