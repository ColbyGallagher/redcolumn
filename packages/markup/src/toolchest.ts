import { MARKUP_LABELS, type Attachment, type Markup, type MarkupStyle, type MarkupType } from './model';
import { mimeOf } from './import';
import { removePredictor, rgbaToPngDataUrl, samplesToRgba } from './pdfExtras';
import type { StampContent } from './stamp';
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
  /** Our equivalent tool, or null when there is none yet (symbols, sounds, ...). */
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
    const subject = str(dict.Subj) || tag(body, 'Subject') || '';
    const style = type ? toolStyle(type, dict, defaults) : { ...defaults.rect };
    // A cloud with a callout child is Revu's Cloud+ (ours draws the callout itself).
    const cloudPlus = type === 'cloud' && (nm(dict.ITEx) === 'PolyText' || parts.some((c) => c.type === 'callout'));
    const grouped = type && !cloudPlus && parts.length ? groupTemplate({ type, dict, x: 0, y: 0 }, parts, style, defaults, sequence?.start) : undefined;
    // Revu (2017 on) names tools with a generated id, e.g. QRGOYETREOFCJYJO: what the tool is says more.
    // CopyItem is the name Revu stores when a markup is copied into a set; the subject says what it is.
    const given = tag(body, 'Name') ?? '';
    const named = given && !REVU_ID.test(given) && given !== 'CopyItem' ? given : '';
    // Stamps, pictures and file attachments carry their wording, pixels or embedded file, so a
    // placed copy is that tool and not an empty shape of the same type.
    const content =
      type && !grouped && (type === 'stamp' || type === 'image' || type === 'attachment')
        ? await contentTemplate(type, dict, style, await loadResources(body), subject || named)
        : undefined;
    const template = grouped ?? content;
    const label = cloudPlus ? 'Cloud+' : template && sequence ? 'Numbered ' + MARKUP_LABELS[type!] : type ? MARKUP_LABELS[type] : '';
    const name = named || (given === 'CopyItem' && subject ? subject : '') || label || subject || str(dict.T) || 'Tool';
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
  // Still no tool for these. Matched on the class name before stamp/image, so a symbol is not
  // imported as a stamp just because its annotation subtype is /Stamp.
  if (/symbol|sketch|3d|sound|hyperlink|redact|volume|dynamicfill/.test(t)) return null;
  if (/fileattachment/.test(t) || sub === 'FileAttachment') return 'attachment';
  // A saved snapshot is the captured picture (the same as a stamp imported from a PDF).
  if (it === 'StampSnapshot' || /snapshot/.test(t)) return 'image';
  if (/bbimage/.test(t) || (/image/.test(t) && sub !== 'Stamp')) return 'image';
  if (/stamp/.test(t) || sub === 'Stamp') return 'stamp';
  if (/link|file/.test(t)) return null;
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

// --- Pictures, stamps and files embedded in a tool ---------------------------------------------

interface RawObj {
  dict: PdfDict;
  /** Stream bytes, inflated when the object says /FlateDecode. */
  bytes: Uint8Array;
  /** Form and file streams as Latin-1; empty for images. */
  text: string;
}

/** `<Resources>` blocks on a tool: id → the PDF object Revu stored for that BBObjPtr. */
async function loadResources(xml: string): Promise<Map<string, RawObj>> {
  const map = new Map<string, RawObj>();
  for (const m of xml.matchAll(/<Resources\b[^>]*>([\s\S]*?)<\/Resources>/gi)) {
    const id = (await decodedText(tag(m[1]!, 'ID'))).trim();
    const data = tag(m[1]!, 'Data');
    if (!id || !data) continue;
    try {
      map.set(id, await parseStreamObject(await decodeRaw(data)));
    } catch {
      // One unreadable resource does not drop the tool.
    }
  }
  return map;
}

function dictEndAt(src: string): number {
  const start = src.indexOf('<<');
  if (start < 0) return 0;
  let depth = 0;
  for (let i = start; i < src.length - 1; i++) {
    if (src[i] === '<' && src[i + 1] === '<') {
      depth++;
      i++;
    } else if (src[i] === '>' && src[i + 1] === '>') {
      depth--;
      i++;
      if (depth === 0) return i + 1;
    }
  }
  return src.length;
}

function streamBytes(src: string, from: number, length: number | null): Uint8Array {
  const at = src.indexOf('stream', from);
  if (at < 0) return new Uint8Array();
  let start = at + 6;
  if (src[start] === '\r') start++;
  if (src[start] === '\n') start++;
  const n = length && length > 0 ? Math.min(length, src.length - start) : Math.max(0, (src.indexOf('endstream', start) < 0 ? src.length : src.indexOf('endstream', start)) - start);
  const bytes = new Uint8Array(n);
  for (let i = 0; i < n; i++) bytes[i] = src.charCodeAt(start + i)! & 255;
  return bytes;
}

function isFlate(d: PdfDict): boolean {
  const f = d.Filter;
  return nm(f) === 'FlateDecode' || (Array.isArray(f) && f.some((x) => nm(x) === 'FlateDecode'));
}

async function parseStreamObject(src: string): Promise<RawObj> {
  const end = dictEndAt(src);
  const parsed = end ? parsePdfObject(src.slice(0, end)) : {};
  const dict = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as PdfDict) : {};
  let bytes = streamBytes(src, end, num(dict.Length));
  if (isFlate(dict) && bytes.length) {
    try {
      bytes = await inflate(bytes);
    } catch {
      // Kept compressed; image and file reads then fail closed.
    }
  }
  return { dict, bytes, text: nm(dict.Subtype) === 'Image' ? '' : latin1(bytes) };
}

const ptrId = (v: PdfValue | undefined) => /^BBObjPtr_([A-Za-z0-9]+)$/.exec(nm(v))?.[1] ?? null;

function asDict(v: PdfValue | undefined): PdfDict | null {
  if (!v || typeof v !== 'object' || Array.isArray(v) || isName(v)) return null;
  return v;
}

function xobjects(obj: RawObj): PdfDict {
  const x = asDict(asDict(obj.dict.Resources)?.XObject);
  return x ?? {};
}

function eachForm(resources: Map<string, RawObj>, id: string | null, fn: (obj: RawObj) => void, seen = new Set<string>()) {
  if (!id || seen.has(id)) return;
  seen.add(id);
  const obj = resources.get(id);
  if (!obj || nm(obj.dict.Subtype) === 'Image') return;
  fn(obj);
  for (const v of Object.values(xobjects(obj))) eachForm(resources, ptrId(v), fn, seen);
}

function pdfLiteral(body: string): string {
  const v = parsePdfObject(`(${body})`);
  return typeof v === 'string' ? v : '';
}

/** Text drawn by a form appearance (`Tj` / `TJ`), in paint order. */
function formText(resources: Map<string, RawObj>, id: string | null): string[] {
  const lines: string[] = [];
  eachForm(resources, id, (obj) => {
    for (const m of obj.text.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)) {
      const s = pdfLiteral(m[1]!).trim();
      if (s && lines[lines.length - 1] !== s) lines.push(s);
    }
    for (const m of obj.text.matchAll(/\[([\s\S]*?)\]\s*TJ/g)) {
      let acc = '';
      for (const s of m[1]!.matchAll(/\(((?:\\.|[^\\)])*)\)/g)) acc += pdfLiteral(s[1]!);
      const t = acc.trim();
      if (t && lines[lines.length - 1] !== t) lines.push(t);
    }
  });
  return lines;
}

/** Fill colour of that text (`rg` in the same stream). */
function formTextColor(resources: Map<string, RawObj>, id: string | null): string | null {
  let color: string | null = null;
  eachForm(resources, id, (obj) => {
    if (!/\bTj\b|\bTJ\b/.test(obj.text)) return;
    for (const m of obj.text.matchAll(/([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+rg/g)) color = pdfColor([Number(m[1]), Number(m[2]), Number(m[3])]);
  });
  return color;
}

/** True when the appearance strokes or fills a path, rather than only clipping to one. */
function formDrawsShape(resources: Map<string, RawObj>, id: string | null): boolean {
  let drawn = false;
  eachForm(resources, id, (obj) => {
    if (/(^|[\s])(?:S|s|f\*?|F|b\*?|B\*?)(?=$|[\s])/.test(obj.text)) drawn = true;
  });
  return drawn;
}

function parmOf(d: PdfDict): { predictor: number; columns?: number; colors?: number } {
  const p = Array.isArray(d.DecodeParms) ? asDict(d.DecodeParms[0]) : asDict(d.DecodeParms);
  return { predictor: num(p?.Predictor) ?? 1, ...(num(p?.Columns) !== null ? { columns: num(p?.Columns)! } : {}), ...(num(p?.Colors) !== null ? { colors: num(p?.Colors)! } : {}) };
}

function componentsOf(d: PdfDict): number | null {
  const cs = nm(d.ColorSpace);
  if (cs === 'DeviceGray' || cs === 'CalGray') return 1;
  if (cs === 'DeviceRGB' || cs === 'CalRGB') return 3;
  if (cs === 'DeviceCMYK') return 4;
  return null;
}

interface RgbaImg {
  w: number;
  h: number;
  rgba: Uint8Array;
}

function imageOf(resources: Map<string, RawObj>, id: string, cache: Map<string, RgbaImg | null>): RgbaImg | null {
  if (cache.has(id)) return cache.get(id)!;
  const obj = resources.get(id);
  const fail = () => {
    cache.set(id, null);
    return null;
  };
  if (!obj || nm(obj.dict.Subtype) !== 'Image') return fail();
  const width = num(obj.dict.Width) ?? 0;
  const height = num(obj.dict.Height) ?? 0;
  const components = componentsOf(obj.dict);
  if (!width || !height || (num(obj.dict.BitsPerComponent) ?? 8) !== 8 || !components) return fail();
  const parms = parmOf(obj.dict);
  const data = removePredictor(obj.bytes, parms.predictor, parms.columns ?? width, parms.colors ?? components);
  let alpha: Uint8Array | null = null;
  const mask = resources.get(ptrId(obj.dict.SMask) ?? '');
  if (mask && num(mask.dict.Width) === width && num(mask.dict.Height) === height) {
    const mp = parmOf(mask.dict);
    const raw = removePredictor(mask.bytes, mp.predictor, mp.columns ?? width, mp.colors ?? 1);
    if (raw.length >= width * height) alpha = raw;
  }
  const rgba = samplesToRgba(width, height, components, data, alpha);
  const img = rgba ? { w: width, h: height, rgba } : null;
  cache.set(id, img);
  return img;
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function imageUrl(resources: Map<string, RawObj>, id: string): Promise<string | null> {
  const obj = resources.get(id);
  if (obj && nm(obj.dict.Filter) === 'DCTDecode' && obj.bytes.length) return `data:image/jpeg;base64,${toBase64(obj.bytes)}`;
  const img = imageOf(resources, id, new Map());
  return img ? rgbaToPngDataUrl(img.w, img.h, img.rgba) : null;
}

type Mtx = [number, number, number, number, number, number];
interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const mul = (m: Mtx, n: Mtx): Mtx => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];

const applyMtx = (m: Mtx, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

function mapRect(m: Mtx, x: number, y: number, w: number, h: number): Box {
  const p = [applyMtx(m, x, y), applyMtx(m, x + w, y), applyMtx(m, x, y + h), applyMtx(m, x + w, y + h)];
  const xs = p.map((q) => q[0]);
  const ys = p.map((q) => q[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

const clipTo = (a: Box, b: Box): Box => ({ x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) });

/** Pixels per point when a snapshot's appearance is drawn out to a picture. */
const SNAP_PX = 4;

function blitImage(img: RgbaImg, ctm: Mtx, clip: Box, dest: Uint8Array, pageW: number, pageH: number) {
  const dw = Math.ceil(pageW * SNAP_PX);
  const dh = Math.ceil(pageH * SNAP_PX);
  const corners = [0, 1].flatMap((y) => [0, 1].map((x) => applyMtx(ctm, x, y)));
  const bounds = {
    x0: Math.max(clip.x0, Math.min(...corners.map((p) => p[0]))),
    y0: Math.max(clip.y0, Math.min(...corners.map((p) => p[1]))),
    x1: Math.min(clip.x1, Math.max(...corners.map((p) => p[0]))),
    y1: Math.min(clip.y1, Math.max(...corners.map((p) => p[1]))),
  };
  if (bounds.x1 <= bounds.x0 || bounds.y1 <= bounds.y0) return;
  const det = ctm[0] * ctm[3] - ctm[2] * ctm[1];
  if (Math.abs(det) < 1e-9) return;
  const px0 = Math.max(0, Math.floor(bounds.x0 * SNAP_PX));
  const px1 = Math.min(dw, Math.ceil(bounds.x1 * SNAP_PX));
  const py0 = Math.max(0, Math.floor((pageH - bounds.y1) * SNAP_PX));
  const py1 = Math.min(dh, Math.ceil((pageH - bounds.y0) * SNAP_PX));
  for (let py = py0; py < py1; py++) {
    const y = pageH - (py + 0.5) / SNAP_PX;
    for (let px = px0; px < px1; px++) {
      const x = (px + 0.5) / SNAP_PX;
      const u = (ctm[3] * (x - ctm[4]) - ctm[2] * (y - ctm[5])) / det;
      const v = (-ctm[1] * (x - ctm[4]) + ctm[0] * (y - ctm[5])) / det;
      if (u < 0 || v < 0 || u >= 1 || v >= 1) continue;
      const ix = Math.min(img.w - 1, Math.floor(u * img.w));
      const iy = Math.min(img.h - 1, Math.floor((1 - v) * img.h));
      const si = (iy * img.w + ix) * 4;
      const di = (py * dw + px) * 4;
      const srcA = img.rgba[si + 3]! / 255;
      if (srcA <= 0) continue;
      const dstA = dest[di + 3]! / 255;
      const outA = srcA + dstA * (1 - srcA);
      const k = outA > 0 ? 1 / outA : 0;
      dest[di] = Math.round((img.rgba[si]! * srcA + dest[di]! * dstA * (1 - srcA)) * k);
      dest[di + 1] = Math.round((img.rgba[si + 1]! * srcA + dest[di + 1]! * dstA * (1 - srcA)) * k);
      dest[di + 2] = Math.round((img.rgba[si + 2]! * srcA + dest[di + 2]! * dstA * (1 - srcA)) * k);
      dest[di + 3] = Math.round(outA * 255);
    }
  }
}

type Tok = { k: 'num'; v: number } | { k: 'name'; v: string } | { k: 'op'; v: string } | { k: 'skip' };

function lexContent(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const delim = (c: string | undefined) => c === undefined || /[\s\0()<>[\]{}/%]/.test(c);
  while (i < src.length) {
    const c = src[i]!;
    if (/[\s\0]/.test(c)) {
      i++;
      continue;
    }
    if (c === '%') {
      while (i < src.length && src[i] !== '\n' && src[i] !== '\r') i++;
      continue;
    }
    if (c === '(') {
      i++;
      let depth = 1;
      while (i < src.length && depth) {
        if (src[i] === '\\') i += 2;
        else if (src[i] === '(') {
          depth++;
          i++;
        } else if (src[i] === ')') {
          depth--;
          i++;
        } else i++;
      }
      out.push({ k: 'skip' });
      continue;
    }
    if (c === '[') {
      let depth = 0;
      while (i < src.length) {
        if (src[i] === '(') {
          i++;
          let d = 1;
          while (i < src.length && d) {
            if (src[i] === '\\') i += 2;
            else if (src[i] === '(') {
              d++;
              i++;
            } else if (src[i] === ')') {
              d--;
              i++;
            } else i++;
          }
          continue;
        }
        if (src[i] === '[') depth++;
        else if (src[i] === ']' && --depth === 0) {
          i++;
          break;
        }
        i++;
      }
      out.push({ k: 'skip' });
      continue;
    }
    if (c === '<') {
      if (src[i + 1] === '<') {
        const end = dictEndAt(src.slice(i));
        i += end || 2;
      } else {
        const end = src.indexOf('>', i);
        i = end < 0 ? src.length : end + 1;
      }
      out.push({ k: 'skip' });
      continue;
    }
    if (c === '/') {
      i++;
      let n = '';
      while (!delim(src[i])) n += src[i++];
      out.push({ k: 'name', v: n });
      continue;
    }
    let tok = '';
    while (!delim(src[i])) tok += src[i++];
    if (/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(tok)) out.push({ k: 'num', v: Number(tok) });
    else if (tok) out.push({ k: 'op', v: tok });
  }
  return out;
}

function paintForm(obj: RawObj, ctm: Mtx, clip: Box, dest: Uint8Array, pageW: number, pageH: number, resources: Map<string, RawObj>, cache: Map<string, RgbaImg | null>, depth: number) {
  if (depth > 8) return;
  const matrix = Array.isArray(obj.dict.Matrix) ? (obj.dict.Matrix.slice(0, 6).map((v) => (typeof v === 'number' ? v : 0)) as Mtx) : ([1, 0, 0, 1, 0, 0] as Mtx);
  const next = mul(ctm, matrix.length === 6 ? matrix : [1, 0, 0, 1, 0, 0]);
  const bbox = Array.isArray(obj.dict.BBox) ? (obj.dict.BBox as PdfValue[]).map(num) : [];
  if (bbox.length === 4 && bbox.every((n) => n !== null)) {
    const [x0, y0, x1, y1] = bbox as number[];
    clip = clipTo(clip, mapRect(next, x0!, y0!, x1! - x0!, y1! - y0!));
  }
  execContent(obj, next, clip, dest, pageW, pageH, resources, cache, depth);
}

function execContent(obj: RawObj, ctm0: Mtx, clip0: Box, dest: Uint8Array, pageW: number, pageH: number, resources: Map<string, RawObj>, cache: Map<string, RgbaImg | null>, depth: number) {
  let ctm = ctm0;
  let clip = clip0;
  const saved: { ctm: Mtx; clip: Box }[] = [];
  let pending: Box | null = null;
  let args: Extract<Tok, { k: 'num' | 'name' }>[] = [];
  const nums = () => args.filter((a): a is { k: 'num'; v: number } => a.k === 'num').map((a) => a.v);
  for (const t of lexContent(obj.text)) {
    if (t.k === 'num' || t.k === 'name') {
      args.push(t);
      continue;
    }
    if (t.k !== 'op') {
      args = [];
      continue;
    }
    const op = t.v;
    if (op === 'q') saved.push({ ctm: [...ctm], clip: { ...clip } });
    else if (op === 'Q') {
      const s = saved.pop();
      if (s) {
        ctm = s.ctm;
        clip = s.clip;
      }
    } else if (op === 'cm') {
      const n = nums();
      if (n.length >= 6) ctm = mul(ctm, n.slice(0, 6) as Mtx);
    } else if (op === 're') {
      const n = nums();
      if (n.length >= 4) pending = mapRect(ctm, n[0]!, n[1]!, n[2]!, n[3]!);
    } else if (op === 'W' || op === 'W*') {
      if (pending) clip = clipTo(clip, pending);
    } else if (op === 'n') pending = null;
    else if (op === 'Do') {
      const name = [...args].reverse().find((a) => a.k === 'name');
      const id = name && name.k === 'name' ? ptrId(xobjects(obj)[name.v]) : null;
      const target = id ? resources.get(id) : undefined;
      if (target && id) {
        if (nm(target.dict.Subtype) === 'Image') {
          const img = imageOf(resources, id, cache);
          if (img) blitImage(img, ctm, clip, dest, pageW, pageH);
        } else paintForm(target, ctm, clip, dest, pageW, pageH, resources, cache, depth + 1);
      }
    }
    args = [];
  }
}

/** A stamp snapshot's appearance, drawn to a PNG. Null when it paints nothing we can rasterize. */
async function appearanceUrl(dict: PdfDict, resources: Map<string, RawObj>): Promise<string | null> {
  const id = ptrId(asDict(dict.AP)?.N);
  const obj = id ? resources.get(id) : undefined;
  const box = boxOf(dict);
  if (obj && nm(obj.dict.Subtype) === 'Image' && id) return imageUrl(resources, id);
  if (!obj || !box) return null;
  const pw = Math.max(1, Math.ceil(box.w * SNAP_PX));
  const ph = Math.max(1, Math.ceil(box.h * SNAP_PX));
  const rgba = new Uint8Array(pw * ph * 4);
  const cache = new Map<string, RgbaImg | null>();
  paintForm(obj, [1, 0, 0, 1, 0, 0], { x0: 0, y0: 0, x1: box.w, y1: box.h }, rgba, box.w, box.h, resources, cache, 0);
  let painted = false;
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i]) {
    painted = true;
    break;
  }
  return painted ? rgbaToPngDataUrl(pw, ph, rgba) : null;
}

async function attachmentOf(dict: PdfDict, resources: Map<string, RawObj>): Promise<Attachment | null> {
  const fs = resources.get(ptrId(dict.FS) ?? '');
  if (!fs) return null;
  const name = str(fs.dict.UF) || str(fs.dict.F) || 'attachment';
  const file = resources.get(ptrId(asDict(fs.dict.EF)?.F) ?? '');
  if (!file?.bytes.length) return null;
  return { name, mime: mimeOf(name), size: file.bytes.length, data: toBase64(file.bytes) };
}

/** One markup a tool places: the stamp's wording, the picture, or the embedded file, at the tool's size. */
async function contentTemplate(type: MarkupType, dict: PdfDict, style: MarkupStyle, resources: Map<string, RawObj>, label: string): Promise<Markup[] | undefined> {
  const box = boxOf(dict);
  const w = box?.w || (type === 'attachment' ? 18 : 80);
  const h = box?.h || (type === 'attachment' ? 20 : 32);
  const base = (): Markup => ({
    id: '',
    type,
    pageIndex: 0,
    points: [
      [0, 0],
      [w, h],
    ],
    style: { ...style },
    status: 'none',
    author: '',
    createdAt: 0,
    modifiedAt: 0,
  });
  if (type === 'attachment') {
    const file = await attachmentOf(dict, resources);
    return file ? [{ ...base(), attachment: file }] : undefined;
  }
  if (type === 'stamp') {
    const ap = ptrId(asDict(dict.AP)?.N);
    const lines = formText(resources, ap);
    const color = lines.length ? formTextColor(resources, ap) : null;
    if (color) style.stroke = color;
    const frame: StampContent['frame'] = lines.length && !formDrawsShape(resources, ap) ? 'none' : 'rounded';
    if (frame === 'none') style.width = 0;
    const wording = lines.length ? lines : [label || nm(dict.Name) || 'Stamp'];
    return [{ ...base(), style: { ...style }, stamp: { lines: wording, frame } }];
  }
  if (type === 'image') {
    const direct = ptrId(dict.Image);
    const url = direct ? await imageUrl(resources, direct) : await appearanceUrl(dict, resources);
    if (!url) {
      // A snapshot whose forms we could not paint still places its largest embedded picture.
      let best: { id: string; n: number } | null = null;
      for (const [id, obj] of resources) {
        if (nm(obj.dict.Subtype) !== 'Image') continue;
        const n = (num(obj.dict.Width) ?? 0) * (num(obj.dict.Height) ?? 0);
        if (!best || n > best.n) best = { id, n };
      }
      const fallback = best ? await imageUrl(resources, best.id) : null;
      return fallback ? [{ ...base(), image: fallback }] : undefined;
    }
    return [{ ...base(), image: url }];
  }
  return undefined;
}
