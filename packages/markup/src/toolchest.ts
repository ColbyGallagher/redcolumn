import { MARKUP_LABELS, type Markup, type MarkupStyle, type MarkupType } from './model';
import type { FontFamily, LineDash, LineEnding } from './style';

/**
 * .btx tool sets. A .btx is XML: a <Title> and one <ToolChestItem> per tool, whose
 * <Raw> holds the tool's PDF annotation dictionary, usually zlib-compressed and hex-encoded. The
 * dictionary gives the annotation type (/Subtype, and /IT for clouds and measurements) and its
 * appearance (/C, /IC, /CA, /BS, /LE, /DA, /DS), which become one of our tools and its style.
 * A tool can have <Child> items: markups Revu draws with it as a group (a Cloud+'s callout, the
 * number in a numbered circle), optionally numbered on by a <Sequence>.
 */

export interface ToolChestItem {
  id: string;
  name: string;
  /** Revu's Subject (what the markup list shows); often the same as the name. */
  subject: string;
  /** Our equivalent tool, or null when there is none yet (stamps, images, symbols, ...). */
  type: MarkupType | null;
  style: MarkupStyle;
  /** The file's annotation class name (the ...Annotations.AnnotationSquare string in the .btx). */
  revuType: string;
  /** Drawn with our Cloud+ tool (a cloud with a callout) rather than as `type` alone. */
  tool?: 'cloudPlus';
  /**
   * A group placed as a copy (the tool and its children, at the origin, in page space): set when
   * the tool has children we can draw and is not a Cloud+.
   */
  template?: Markup[];
  /** Numbers each copy's text on from the last one in the document (Revu's <Sequence>). */
  sequence?: { start: number; increment: number };
}

export interface ToolSet {
  id: string;
  title: string;
  items: ToolChestItem[];
  importedAt: number;
}

// --- A small PDF object parser (enough for annotation dictionaries) --------------------------

export type PdfValue = number | boolean | null | string | PdfName | PdfValue[] | PdfDict;
export interface PdfName {
  name: string;
}
export type PdfDict = { [key: string]: PdfValue };

const isName = (v: PdfValue | undefined): v is PdfName => typeof v === 'object' && v !== null && !Array.isArray(v) && 'name' in v && typeof (v as PdfName).name === 'string' && Object.keys(v).length === 1;

/** Parses one PDF object (a dictionary, usually) from its text form. */
export function parsePdfObject(src: string): PdfValue {
  let i = 0;
  const ws = () => {
    for (;;) {
      while (i < src.length && /[\s\0]/.test(src[i]!)) i++;
      if (src[i] === '%') while (i < src.length && src[i] !== '\n' && src[i] !== '\r') i++;
      else return;
    }
  };
  const delim = (c: string | undefined) => c === undefined || /[\s\0()<>[\]{}/%]/.test(c);
  const value = (): PdfValue => {
    ws();
    const c = src[i];
    if (c === '<' && src[i + 1] === '<') {
      i += 2;
      const dict: PdfDict = {};
      for (;;) {
        ws();
        if (src[i] === '>' && src[i + 1] === '>') {
          i += 2;
          return dict;
        }
        if (i >= src.length) return dict;
        const key = value();
        const val = value();
        if (isName(key)) dict[key.name] = val;
      }
    }
    if (c === '[') {
      i++;
      const arr: PdfValue[] = [];
      for (;;) {
        ws();
        if (src[i] === ']' || i >= src.length) {
          i++;
          return arr;
        }
        const v = value();
        // Indirect references (`12 0 R`) collapse to null: tool sets do not use them.
        if (src.slice(i).match(/^\s*R\b/) && typeof v === 'number' && typeof arr[arr.length - 1] === 'number') {
          i = src.indexOf('R', i) + 1;
          arr.pop();
          arr.push(null);
        } else arr.push(v);
      }
    }
    if (c === '/') {
      i++;
      let n = '';
      while (!delim(src[i])) n += src[i++];
      return { name: n.replace(/#([0-9a-f]{2})/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16))) };
    }
    if (c === '(') {
      i++;
      let depth = 1;
      let out = '';
      while (i < src.length) {
        const ch = src[i++]!;
        if (ch === '\\') {
          const e = src[i++]!;
          const map: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' };
          if (map[e]) out += map[e];
          else if (/[0-7]/.test(e)) {
            let oct = e;
            while (oct.length < 3 && /[0-7]/.test(src[i]!)) oct += src[i++];
            out += String.fromCharCode(parseInt(oct, 8));
          } else if (e === '\r' || e === '\n') {
            if (e === '\r' && src[i] === '\n') i++;
          } else out += e;
        } else if (ch === '(') {
          depth++;
          out += ch;
        } else if (ch === ')') {
          if (--depth === 0) break;
          out += ch;
        } else out += ch;
      }
      return decodeText(out);
    }
    if (c === '<') {
      const end = src.indexOf('>', i);
      const hex = src.slice(i + 1, end).replace(/\s/g, '');
      i = end + 1;
      let out = '';
      for (let k = 0; k < hex.length; k += 2) out += String.fromCharCode(parseInt(hex.slice(k, k + 2).padEnd(2, '0'), 16));
      return decodeText(out);
    }
    let tok = '';
    while (!delim(src[i])) tok += src[i++];
    if (!tok) {
      i++;
      return null;
    }
    if (tok === 'true') return true;
    if (tok === 'false') return false;
    if (tok === 'null') return null;
    const n = Number(tok);
    return Number.isFinite(n) ? n : null;
  };
  return value();
}

/** PDF text strings: UTF-16BE with a byte-order mark, else PDFDocEncoding (treated as Latin-1). */
function decodeText(raw: string): string {
  if (raw.charCodeAt(0) === 0xfe && raw.charCodeAt(1) === 0xff) {
    let s = '';
    for (let k = 2; k + 1 < raw.length; k += 2) s += String.fromCharCode((raw.charCodeAt(k) << 8) | raw.charCodeAt(k + 1));
    return s;
  }
  return raw;
}

// --- .btx files ------------------------------------------------------------------------------

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unxml = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) =>
      e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (XML_ENTITIES[e] ?? m),
    )
    .trim();

function tag(xml: string, name: string): string | null {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(xml);
  return m ? unxml(m[1]!) : null;
}

async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const latin1 = (b: Uint8Array) => {
  let s = '';
  for (let k = 0; k < b.length; k += 0x8000) s += String.fromCharCode(...b.subarray(k, k + 0x8000));
  return s;
};

/** A tool's <Raw>: hex (or base64) of zlib-compressed or plain dictionary text. */
export async function decodeRaw(raw: string): Promise<string> {
  if (raw.trim().startsWith('<<')) return raw.trim();
  const text = raw.replace(/\s/g, '');
  let bytes: Uint8Array;
  if (/^[0-9a-f]+$/i.test(text) && text.length % 2 === 0) {
    bytes = new Uint8Array(text.length / 2);
    for (let k = 0; k < bytes.length; k++) bytes[k] = parseInt(text.slice(k * 2, k * 2 + 2), 16);
  } else {
    const bin = atob(text);
    bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
  }
  // zlib streams start 0x78 (deflate, 32K window).
  if (bytes[0] === 0x78) bytes = await inflate(bytes);
  return latin1(bytes);
}

let seq = 0;
const newId = (p: string) => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`;

type Defaults = Record<MarkupType, MarkupStyle>;

/**
 * Reads a .btx tool set; each tool's style is laid over `defaults` (DEFAULT_STYLES). Tools
 * we cannot draw yet are kept, marked `type: null`.
 */
export async function parseBtx(xml: string, defaults: Defaults, fallbackTitle = 'Imported tools'): Promise<ToolSet> {
  if (!/<BluebeamRevuToolSet/i.test(xml) && !/<ToolChestItem/i.test(xml)) throw new Error('This is not a .btx tool set file.');
  const title = (await decodedText(tag(xml, 'Title'))) || fallbackTitle;
  const items: ToolChestItem[] = [];
  const re = /<ToolChestItem\b[^>]*>([\s\S]*?)<\/ToolChestItem>/gi;
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    // The tool's own tags come before (or around) its <Child> items, which have tags of the same names.
    const children = [...m[1]!.matchAll(/<Child\b[^>]*>([\s\S]*?)<\/Child>/gi)].map((c) => c[1]!);
    const body = m[1]!.replace(/<Child\b[^>]*>[\s\S]*?<\/Child>/gi, '');
    const revuType = tag(body, 'Type') ?? '';
    const dict = await rawDict(tag(body, 'Raw'));
    const type = toolType(revuType, dict);
    const parts: Part[] = [];
    for (const c of children) {
      const childDict = await rawDict(tag(c, 'Raw'));
      parts.push({ type: toolType(tag(c, 'Type') ?? '', childDict), dict: childDict, x: Number(tag(c, 'X')) || 0, y: Number(tag(c, 'Y')) || 0 });
    }
    const seq = /<Sequence\b[^>]*>([\s\S]*?)<\/Sequence>/i.exec(body)?.[1];
    const sequence = seq && /true/i.test(tag(seq, 'Enabled') ?? '') ? { start: Number(tag(seq, 'Start')) || 1, increment: Number(tag(seq, 'Increment')) || 1 } : undefined;
    const style = type ? toolStyle(type, dict, defaults) : { ...defaults.rect };
    // A cloud with a callout child is Revu's Cloud+ (ours draws the callout itself).
    const cloudPlus = type === 'cloud' && (nm(dict.ITEx) === 'PolyText' || parts.some((c) => c.type === 'callout'));
    const template = type && !cloudPlus && parts.length ? groupTemplate({ type, dict, x: 0, y: 0 }, parts, style, defaults, sequence?.start) : undefined;
    const subject = str(dict.Subj) || tag(body, 'Subject') || '';
    const label = cloudPlus ? 'Cloud+' : template && sequence ? 'Numbered ' + MARKUP_LABELS[type!] : type ? MARKUP_LABELS[type] : '';
    // Revu (2017 on) names tools with a generated id, e.g. QRGOYETREOFCJYJO: what the tool is says more.
    const given = tag(body, 'Name') ?? '';
    const name = (given && !REVU_ID.test(given) ? given : '') || label || subject || str(dict.T) || 'Tool';
    items.push({
      id: newId('t'),
      name,
      subject: subject || name,
      type,
      style,
      revuType,
      ...(cloudPlus ? { tool: 'cloudPlus' as const } : {}),
      ...(template ? { template } : {}),
      ...(template && sequence ? { sequence } : {}),
    });
  }
  if (!items.length) throw new Error('This tool set has no tools in it.');
  return { id: newId('s'), title, items, importedAt: Date.now() };
}

/** Revu's generated ids: 16 capital letters. */
const REVU_ID = /^[A-Z]{16}$/;

/** A <Title> or <Name>, which Revu may store compressed like a <Raw>. */
async function decodedText(v: string | null): Promise<string> {
  if (!v) return '';
  if (!/^78[0-9a-f]+$/i.test(v) || v.length % 2) return v;
  try {
    return await decodeRaw(v);
  } catch {
    return v;
  }
}

async function rawDict(raw: string | null): Promise<PdfDict> {
  if (!raw) return {};
  try {
    const parsed = parsePdfObject(await decodeRaw(raw));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as PdfDict;
  } catch {
    // Kept as an unsupported tool.
  }
  return {};
}

interface Part {
  type: MarkupType | null;
  dict: PdfDict;
  /** Revu's offset of the child from its parent, in points (y up). */
  x: number;
  y: number;
}

/** Types placed from a box: their two points are its corners. */
const BOX_TYPES = new Set<MarkupType>(['rect', 'ellipse', 'cloud', 'text', 'typewriter']);

/** The box an annotation draws in, from its /Rect less its /RD insets, at the origin. */
function boxOf(d: PdfDict): { w: number; h: number; inset: [number, number, number, number] } | null {
  const r = Array.isArray(d.Rect) ? (d.Rect as PdfValue[]).map(num) : [];
  if (r.length !== 4 || r.some((v) => v === null)) return null;
  const [x0, y0, x1, y1] = r as number[];
  const rd = Array.isArray(d.RD) ? (d.RD as PdfValue[]).map((v) => num(v) ?? 0) : [0, 0, 0, 0];
  const w = Math.abs(x1! - x0!);
  const h = Math.abs(y1! - y0!);
  return w > 0 && h > 0 ? { w, h, inset: [rd[0] ?? 0, rd[1] ?? 0, rd[2] ?? 0, rd[3] ?? 0] } : null;
}

/**
 * A tool and its children as one group of markups: each is a box centred on the parent's centre
 * plus its offset. Null when a part is not a box we can place (lines, callouts, ...).
 */
function groupTemplate(parent: Part, children: Part[], parentStyle: MarkupStyle, defaults: Defaults, number?: number): Markup[] | undefined {
  const parts = [parent, ...children];
  if (parts.some((p) => !p.type || !BOX_TYPES.has(p.type) || !boxOf(p.dict))) return undefined;
  const pb = boxOf(parent.dict)!;
  const cx = pb.w / 2;
  const cy = pb.h / 2;
  return parts.map((p, i): Markup => {
    const { w, h, inset } = boxOf(p.dict)!;
    // Page space is y down; Revu's offsets are y up.
    const x = cx + (i ? p.x : 0) - w / 2;
    const y = cy - (i ? p.y : 0) - h / 2;
    const style = i ? toolStyle(p.type!, p.dict, defaults) : parentStyle;
    const text = p.type === 'text' || p.type === 'typewriter' ? (number !== undefined ? String(number) : str(p.dict.Contents)) : undefined;
    return {
      id: '',
      type: p.type!,
      pageIndex: 0,
      points: [
        [x + inset[0], y + inset[3]],
        [x + w - inset[2], y + h - inset[1]],
      ],
      style,
      ...(text !== undefined ? { text } : {}),
      groupId: 'group',
      status: 'none',
      author: '',
      createdAt: i,
      modifiedAt: i,
    };
  });
}

const str = (v: PdfValue | undefined) => (typeof v === 'string' ? v : '');
const nm = (v: PdfValue | undefined) => (isName(v) ? v.name : '');
const num = (v: PdfValue | undefined) => (typeof v === 'number' ? v : null);

/** Our tool for a Revu annotation class and dictionary. */
export function toolType(revuType: string, d: PdfDict): MarkupType | null {
  const t = revuType.toLowerCase();
  const sub = nm(d.Subtype);
  const it = nm(d.IT);
  // Bluebeam's Flag is a pennant-shaped text box.
  if (/flag/.test(t)) return sub === 'FreeText' || /freetext/.test(t) ? 'flagLabel' : null;
  if (/stamp|image|sketch|symbol|snapshot|3d|file|sound|link|hyperlink|redact|volume|dynamicfill/.test(t) || sub === 'Stamp') return null;
  if (/count/.test(t) || /Count/i.test(it)) return 'count';
  if (/angle/.test(t) || /Angle/i.test(it)) return 'angle';
  if (/polylength/.test(t)) return 'polylength';
  if (/perimeter/.test(t)) return 'perimeter';
  if (/area/.test(t) || it === 'PolygonDimension') return 'area';
  if (/measurelength|length|dimension/.test(t) || it === 'LineDimension') return 'length';
  if (it === 'PolyLineDimension') return 'polylength';
  if (/cloud/.test(t) || it === 'PolygonCloud' || (sub === 'Polygon' && nm((d.BE as PdfDict | undefined)?.S) === 'C')) return 'cloud';
  if (/highlight/.test(t) || sub === 'Highlight') return 'highlighter';
  if (/typewriter/.test(t) || it === 'FreeTextTypeWriter') return 'typewriter';
  if (/callout/.test(t) || it === 'FreeTextCallout') return 'callout';
  if (/freetext|textbox/.test(t) || sub === 'FreeText') return 'text';
  if (/note|sticky/.test(t) || sub === 'Text') return 'note';
  if (/polyline/.test(t)) return 'polyline';
  if (/polygon/.test(t)) return 'polygon';
  if (/annotationarc|(^|\.)arc$/.test(t)) return 'arc';
  if (/ellipse|circle/.test(t) || sub === 'Circle') return 'ellipse';
  if (/rectangle|square/.test(t) || sub === 'Square') return 'rect';
  if (/arrow/.test(t)) return 'arrow';
  if (/line/.test(t) || sub === 'Line') {
    const le = Array.isArray(d.LE) ? d.LE.map(nm) : [];
    return le.some((e) => /Arrow/.test(e)) ? 'arrow' : 'line';
  }
  if (/pen|ink|pencil/.test(t) || sub === 'Ink') {
    const ca = num(d.CA) ?? 1;
    const w = num((d.BS as PdfDict | undefined)?.W) ?? 1;
    return ca < 0.8 && w >= 6 ? 'highlighter' : 'pen';
  }
  if (sub === 'Polygon') return 'polygon';
  if (sub === 'PolyLine') return 'polyline';
  return null;
}

const hex2 = (x: number) => Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, '0');

/** A PDF colour array (gray, RGB or CMYK) as #rrggbb; null for none. */
export function pdfColor(v: PdfValue | undefined): string | null {
  if (!Array.isArray(v) || !v.length || v.some((x) => typeof x !== 'number')) return null;
  const c = v as number[];
  if (c.length === 1) return `#${hex2(c[0]!)}${hex2(c[0]!)}${hex2(c[0]!)}`;
  if (c.length === 3) return `#${hex2(c[0]!)}${hex2(c[1]!)}${hex2(c[2]!)}`;
  if (c.length === 4) {
    const [C, M, Y, K] = c as [number, number, number, number];
    return `#${hex2((1 - C) * (1 - K))}${hex2((1 - M) * (1 - K))}${hex2((1 - Y) * (1 - K))}`;
  }
  return null;
}

const LE: Record<string, LineEnding> = {
  None: 'none',
  OpenArrow: 'openArrow',
  ClosedArrow: 'filledArrow',
  ROpenArrow: 'openArrow',
  RClosedArrow: 'filledArrow',
  Circle: 'filledCircle',
  Square: 'filledSquare',
  Diamond: 'filledDiamond',
  Butt: 'tick',
  Slash: 'slash',
};

function dashFrom(d: PdfDict): LineDash | undefined {
  const bs = d.BS as PdfDict | undefined;
  if (nm(bs?.S) !== 'D') return undefined;
  const arr = (Array.isArray(bs?.D) ? bs!.D : Array.isArray(d.D) ? d.D : [3]) as number[];
  const on = arr[0] ?? 3;
  if (arr.length >= 4) return 'dashDot';
  if (on <= 1) return 'dotted';
  if (on >= 8) return 'longDash';
  return 'dashed';
}

/** Style of a tool from its annotation dictionary, over our defaults for the type. */
export function toolStyle(type: MarkupType, d: PdfDict, defaults: Defaults): MarkupStyle {
  const style: MarkupStyle = { ...defaults[type] };
  const stroke = pdfColor(d.C);
  if (stroke) style.stroke = stroke;
  const fill = pdfColor(d.IC);
  if (fill) style.fill = fill;
  else if (Array.isArray(d.IC) && !d.IC.length && type !== 'area' && type !== 'count') style.fill = null;
  const ca = num(d.CA);
  if (ca !== null) style.opacity = ca;
  const fillOpacity = num(d.FillOpacity) ?? num(d.ca);
  if (fillOpacity !== null && style.fill) style.fillOpacity = fillOpacity;
  const bs = d.BS as PdfDict | undefined;
  const border = Array.isArray(d.Border) ? num(d.Border[2]) : null;
  const w = num(bs?.W) ?? border;
  if (w !== null && w > 0) style.width = w;
  const dash = dashFrom(d);
  if (dash) style.dash = dash;
  if (Array.isArray(d.LE) && (type === 'line' || type === 'arrow' || type === 'length' || type === 'polylength')) {
    const [s, e] = d.LE.map((x) => LE[nm(x)]);
    if (s) style.startCap = s;
    if (e) style.endCap = e;
  }
  // Text: /DA "r g b rg /Helv 12 Tf", or Revu's /DS "font: Arial 12pt; color:#FF0000".
  const da = str(d.DA);
  const ds = str(d.DS);
  const size = Number(/([\d.]+)\s+Tf/.exec(da)?.[1] ?? /font(?:-size)?:[^;]*?([\d.]+)pt/i.exec(ds)?.[1]);
  if (size > 0) style.fontSize = size;
  const rg = /([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+rg/.exec(da);
  const dsColor = /(?:^|;)\s*color:\s*(#[0-9a-f]{6})/i.exec(ds)?.[1];
  const textColor = dsColor?.toLowerCase() ?? (rg ? `#${hex2(Number(rg[1]))}${hex2(Number(rg[2]))}${hex2(Number(rg[3]))}` : null);
  if (textColor && (type === 'text' || type === 'typewriter' || type === 'callout')) style.textColor = textColor;
  if (type === 'text' || type === 'callout') {
    const align = /text-align:\s*(left|center|right)/i.exec(ds)?.[1]?.toLowerCase();
    if (align) style.textAlign = align as MarkupStyle['textAlign'];
    const valign = /text-valign:\s*(top|middle|bottom)/i.exec(ds)?.[1]?.toLowerCase();
    if (valign) style.verticalAlign = valign as MarkupStyle['verticalAlign'];
  }
  // Revu callouts often have no line colour of their own: the leader is drawn in the text's.
  if (type === 'callout' && !stroke && textColor) style.stroke = textColor;
  // A text box with no border colour or width and no fill is just its text.
  if (type === 'text' && (!stroke || w === 0) && !fill) style.noBox = true;
  const font = `${/\/([^\s/]+)\s+[\d.]+\s+Tf/.exec(da)?.[1] ?? ''} ${/font(?:-family)?:\s*([^;]+)/i.exec(ds)?.[1] ?? ''}`.toLowerCase();
  const family: FontFamily | null = /times|tiro|serif(?!-)/.test(font) && !/sans/.test(font) ? 'serif' : /cour|mono/.test(font) ? 'mono' : null;
  if (family) style.fontFamily = family;
  if (/bold/.test(font) || /font-weight:\s*bold/i.test(ds)) style.bold = true;
  if (/italic|oblique/.test(font) || /font-style:\s*italic/i.test(ds)) style.italic = true;
  return style;
}
