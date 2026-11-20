import { decodePDFRawStream, PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRawStream, PDFRef, PDFString, type PDFObject } from 'pdf-lib';
import type { StampArt, StampArtText, StampDef, StampField } from './stamp';
import { unescapeXml } from './xml';

/**
 * Bluebeam Revu's stamps are PDF files: one page whose FreeText annotations are the stamp's text
 * (with `&[Date]`-style fields) and whose page content, or other annotations, are its artwork.
 * Revu keeps them in its Stamps folder.
 */

/** One piece of a stamp's text, in points, with the origin at the top left of the stamp's box. */
export interface StampPdfText {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  size: number;
  color: string;
  bold: boolean;
  italic: boolean;
  align: 'left' | 'center' | 'right';
  /** Position in the page's /Annots array. */
  annot: number;
}

export interface ParsedStamp {
  name: string;
  /** The stamp's box in points. */
  width: number;
  height: number;
  /** The box on the page (y up), for drawing its artwork. */
  box: { x: number; y: number; w: number; h: number };
  texts: StampPdfText[];
  /** Anything but text: the page's own content, or annotations that are not text boxes. */
  hasArtwork: boolean;
  /**
   * Blanks to fill in, from the stamp's form fields: each a text field (or a list to pick from),
   * used in `texts` as `{Label}`.
   */
  fields: StampField[];
}

/** Revu's fields (`&[Date]`) as ours (`{Date}`). Names we do not know stay as they are. */
const FIELDS: Record<string, string> = {
  date: '{Date}',
  time: '{Time}',
  file: '{File}',
  filename: '{File}',
  path: '{Path}',
  page: '{Page}',
  name: '{User}',
  user: '{User}',
  username: '{User}',
  dd: '{dd}',
  mm: '{mm}',
  yyyy: '{yyyy}',
};

export const revuFields = (text: string) => text.replace(/&\[([A-Za-z]{1,16})\]/g, (all, name: string) => FIELDS[name.toLowerCase()] ?? all);

const toHex = (r: number, g: number, b: number) => '#' + [r, g, b].map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('');

const numbers = (a: PDFObject | undefined): number[] | null => {
  if (!(a instanceof PDFArray)) return null;
  const out = a.asArray().map((v) => (v instanceof PDFNumber ? v.asNumber() : NaN));
  return out.every(Number.isFinite) ? out : null;
};

const textOf = (v: PDFObject | undefined): string => (v instanceof PDFString || v instanceof PDFHexString ? v.decodeText() : '');

/**
 * The text of a rich text value (`/RC`): its tags are dropped, paragraphs and breaks become new
 * lines. Read tag by tag with no pattern to trip over, with entities decoded last so text such as
 * `&lt;b&gt;` stays text.
 */
function richText(xml: string): string {
  const NL = String.fromCharCode(10);
  let out = '';
  let i = 0;
  while (i < xml.length) {
    const open = xml.indexOf('<', i);
    if (open < 0) {
      out += xml.slice(i);
      break;
    }
    out += xml.slice(i, open);
    const close = xml.indexOf('>', open);
    if (close < 0) break;
    const tag = xml.slice(open + 1, close).trim().toLowerCase();
    const closing = tag.startsWith('/');
    const name = tag.slice(closing ? 1 : 0).split(/[\s/]/)[0];
    if (name === 'br' || name === 'p' || name === 'div') {
      if (name === 'br' || closing) out += NL;
      else if (out && !out.endsWith(NL)) out += NL;
    }
    i = close + 1;
  }
  return unescapeXml(out)
    .split(NL)
    .map((l) => l.trim())
    .filter(Boolean)
    .join(NL);
}

/** What the annotation's appearance stream draws: its text, font, size and colour. */
function appearanceText(annot: PDFDict): { text: string; font: string; size: number; color: string | null } | null {
  const ap = annot.lookupMaybe(PDFName.of('AP'), PDFDict);
  const n = ap?.get(PDFName.of('N'));
  const stream = n instanceof PDFRef ? annot.context.lookup(n) : n;
  if (!(stream instanceof PDFRawStream)) return null;
  const src = new TextDecoder('latin1').decode(decodePDFRawStream(stream).decode());
  const block = /BT([\s\S]*?)ET/.exec(src)?.[1];
  if (!block) return null;
  const font = /\/(\S+)\s+([\d.]+)\s+Tf/.exec(block);
  const rgb = [...block.matchAll(/([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+rg/g)].pop();
  const text = [...block.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)].map((m) => m[1]!.replace(/\\([()\\])/g, '$1')).join('\n');
  return { text, font: font?.[1] ?? '', size: Number(font?.[2]) || 12, color: rgb ? toHex(Number(rgb[1]), Number(rgb[2]), Number(rgb[3])) : null };
}

/** A form field's entry, from the widget or the field above it (fields inherit from their parents). */
function inherited(d: PDFDict, key: string): PDFObject | undefined {
  let at: PDFDict | undefined = d;
  for (let depth = 0; at && depth < 16; depth++) {
    const v = at.lookup(PDFName.of(key));
    if (v !== undefined) return v;
    at = at.lookupMaybe(PDFName.of('Parent'), PDFDict);
  }
  return undefined;
}

/** A form field's full name: its own and its parents', joined by dots. */
function fieldName(d: PDFDict): string {
  const parts: string[] = [];
  let at: PDFDict | undefined = d;
  for (let depth = 0; at && depth < 16; depth++) {
    const t = textOf(at.lookup(PDFName.of('T')));
    if (t) parts.unshift(t);
    at = at.lookupMaybe(PDFName.of('Parent'), PDFDict);
  }
  return parts.join('.');
}

/** The scripts a field runs to work out and show its value (calculate, format, keystroke), joined. */
function fieldScripts(d: PDFDict): string {
  const out: string[] = [];
  let at: PDFDict | undefined = d;
  for (let depth = 0; at && depth < 16; depth++) {
    const aa = at.lookupMaybe(PDFName.of('AA'), PDFDict);
    for (const key of ['C', 'F', 'K']) {
      const js = aa?.lookupMaybe(PDFName.of(key), PDFDict)?.lookup(PDFName.of('JS'));
      if (js instanceof PDFRawStream) out.push(new TextDecoder('latin1').decode(decodePDFRawStream(js).decode()));
      else if (js) out.push(textOf(js));
    }
    at = at.lookupMaybe(PDFName.of('Parent'), PDFDict);
  }
  return out.join('\n');
}

/** The script string literal starting at `i` (after any spaces): its value and where it ends. */
function jsString(src: string, i: number): { value: string; end: number } | null {
  while (/\s/.test(src[i] ?? '')) i++;
  const q = src[i];
  if (q !== '"' && q !== "'") return null;
  let value = '';
  for (let j = i + 1; j < src.length; j++) {
    const c = src[j]!;
    if (c === '\\') {
      const n = src[++j] ?? '';
      value += n === 'n' ? ' ' : n;
    } else if (c === q) return { value, end: j + 1 };
    else value += c;
  }
  return null;
}

/** The string given for `key:` in an object literal in a script. */
function jsNamed(src: string, key: string): string | undefined {
  const at = new RegExp(`\\b${key}\\s*:`).exec(src);
  return at ? jsString(src, at.index + at[0].length)?.value : undefined;
}

/** The leading string arguments of a call whose `(` is at `i`. */
function jsArgs(src: string, i: number): string[] {
  const out: string[] = [];
  let at = i + 1;
  for (;;) {
    const s = jsString(src, at);
    if (!s) return out;
    out.push(s.value);
    at = s.end;
    while (/\s/.test(src[at] ?? '')) at++;
    if (src[at] !== ',') return out;
    at++;
  }
}

/**
 * What a stamp's form field shows, from the script that fills it in: the user's name, the date or
 * time, the file name, or a question asked when the stamp is placed (`app.response`). No script is
 * run: one that does anything else leaves the field a blank to fill in.
 */
function scriptedValue(js: string): { token: string } | { question: string; value?: string } | null {
  if (!js.trim()) return null;
  const ask = /app\.response\s*\(/.exec(js);
  if (ask) {
    const open = ask.index + ask[0].length - 1;
    const tail = js.slice(open, open + 2000);
    // app.response("Question", "Title", "Default") or app.response({ cQuestion: ..., cDefault: ... }).
    const args = jsArgs(js, open);
    const question = (args.length ? args[0] : jsNamed(tail, 'cQuestion')) ?? '';
    const value = args.length ? args[2] : jsNamed(tail, 'cDefault');
    return { question, ...(value ? { value } : {}) };
  }
  if (/identity\.(name|loginName)/.test(js)) return { token: '{User}' };
  if (/documentFileName/.test(js)) return { token: '{File}' };
  const printd = /util\.printd\s*\(/.exec(js) ?? /AFDate_Format(?:Ex)?\s*\(/.exec(js);
  const format = printd ? jsArgs(js, printd.index + printd[0].length - 1)[0] : undefined;
  if (printd || /new\s+Date\s*\(/.test(js)) {
    // The script's date format: d, m and y for the date; h, H, M and t for the time.
    const f = format ?? 'mm/dd/yyyy';
    const date = /[dmy]/.test(f);
    const time = /[hHMt]/.test(f);
    return { token: date && time ? '{Date} {Time}' : time ? '{Time}' : '{Date}' };
  }
  return null;
}

/** A field's label: its question, tooltip or name, without a trailing colon or question mark (or braces). */
const fieldLabel = (s: string) => s.replace(/\s+/g, ' ').replace(/[{}]/g, '').replace(/[\s:?]+$/, '').trim();

/** Reads a Revu stamp PDF. Throws when it has no page to read. */
export async function parseStampPdf(bytes: Uint8Array | ArrayBuffer, fallbackName = 'Stamp'): Promise<ParsedStamp> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  if (!doc.getPageCount()) throw new Error('This PDF has no pages.');
  const page = doc.getPage(0);
  const node = page.node;
  const annots = node.lookupMaybe(PDFName.of('Annots'), PDFArray);
  const dicts = (annots?.asArray() ?? []).map((a) => (a instanceof PDFRef ? doc.context.lookup(a) : a));

  const artBox = numbers(node.lookupMaybe(PDFName.of('ArtBox'), PDFArray) ?? undefined);
  let box: { x: number; y: number; w: number; h: number };
  if (artBox && artBox.length === 4) box = { x: Math.min(artBox[0]!, artBox[2]!), y: Math.min(artBox[1]!, artBox[3]!), w: Math.abs(artBox[2]! - artBox[0]!), h: Math.abs(artBox[3]! - artBox[1]!) };
  else {
    // No art box: the box round the annotations.
    const rects = dicts.flatMap((d) => (d instanceof PDFDict ? [numbers(d.lookupMaybe(PDFName.of('Rect'), PDFArray) ?? undefined)] : [])).filter((r): r is number[] => !!r && r.length === 4);
    if (!rects.length) throw new Error('This PDF has nothing on its page to use as a stamp.');
    const x0 = Math.min(...rects.map((r) => Math.min(r[0]!, r[2]!)));
    const y0 = Math.min(...rects.map((r) => Math.min(r[1]!, r[3]!)));
    box = { x: x0, y: y0, w: Math.max(...rects.map((r) => Math.max(r[0]!, r[2]!))) - x0, h: Math.max(...rects.map((r) => Math.max(r[1]!, r[3]!))) - y0 };
  }
  if (!(box.w > 0 && box.h > 0)) throw new Error('This stamp has no size.');

  const texts: StampPdfText[] = [];
  let hasArtwork = false;
  const contents = node.lookup(PDFName.of('Contents'));
  if (contents instanceof PDFArray ? contents.size() : contents) hasArtwork = true;
  const resources = node.lookupMaybe(PDFName.of('Resources'), PDFDict);
  if (resources?.lookupMaybe(PDFName.of('XObject'), PDFDict)?.keys().length) hasArtwork = true;

  const fields: StampField[] = [];
  const labels = new Set<string>();
  /**
   * A text field or a list on the stamp as one of its texts: a dynamic field ({User}, {Date}) when
   * its script fills one in, else a field of the stamp's own to fill in. False for other widgets.
   */
  const widget = (d: PDFDict, rect: number[], annot: number): boolean => {
    const ft = inherited(d, 'FT');
    const kind = ft instanceof PDFName ? ft.decodeText() : '';
    if (kind !== 'Tx' && kind !== 'Ch') return false;
    const name = fieldName(d);
    const scripted = scriptedValue(fieldScripts(d));
    let text: string;
    const same = name ? fields.find((f) => f.id === name) : undefined;
    if (scripted && 'token' in scripted) text = scripted.token;
    // Another widget of a field already read shows the same value.
    else if (same) text = `{${same.label}}`;
    else {
      const base = fieldLabel(scripted?.question || textOf(inherited(d, 'TU')) || name) || 'Field';
      let label = base;
      for (let n = 2; labels.has(label.toLowerCase()); n++) label = `${base} ${n}`;
      labels.add(label.toLowerCase());
      const opt = inherited(d, 'Opt');
      const choices = opt instanceof PDFArray ? opt.asArray().map((o) => (o instanceof PDFArray ? textOf(o.get(1)) || textOf(o.get(0)) : textOf(o))).filter(Boolean) : [];
      const value = textOf(inherited(d, 'V')) || textOf(inherited(d, 'DV')) || (scripted && 'value' in scripted ? scripted.value : '') || '';
      fields.push({ id: name || label, label, kind: 'text', value: revuFields(value), ...(choices.length ? { choices } : {}) });
      text = `{${label}}`;
    }
    const da = textOf(inherited(d, 'DA'));
    const font = /\/(\S+)\s+[\d.]+\s+Tf/.exec(da)?.[1] ?? '';
    const daRgb = /([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+rg/.exec(da);
    const daGrey = /(?:^|\s)([\d.]+)\s+g(?:\s|$)/.exec(da);
    const q = inherited(d, 'Q');
    const align = q instanceof PDFNumber ? q.asNumber() : 0;
    const x0 = Math.min(rect[0]!, rect[2]!);
    const x1 = Math.max(rect[0]!, rect[2]!);
    const y0 = Math.min(rect[1]!, rect[3]!);
    const y1 = Math.max(rect[1]!, rect[3]!);
    texts.push({
      text,
      x: x0 - box.x,
      y: box.y + box.h - y1,
      w: x1 - x0,
      h: y1 - y0,
      // Size 0 is "fit the box": about two thirds of its height.
      size: Number(/\/\S+\s+([\d.]+)\s+Tf/.exec(da)?.[1]) || (y1 - y0) * 0.65,
      color: daRgb ? toHex(Number(daRgb[1]), Number(daRgb[2]), Number(daRgb[3])) : daGrey ? toHex(Number(daGrey[1]), Number(daGrey[1]), Number(daGrey[1])) : '#000000',
      // Form fonts are often named HeBo, TiBo, CoBo and so on.
      bold: /bld|bold|^[A-Z][a-z]Bo/i.test(font),
      italic: /obl|ital/i.test(font),
      align: align === 1 ? 'center' : align === 2 ? 'right' : 'left',
      annot,
    });
    return true;
  };

  dicts.forEach((d, annot) => {
    if (!(d instanceof PDFDict)) return;
    const subtype = d.lookupMaybe(PDFName.of('Subtype'), PDFName)?.decodeText();
    if (subtype === 'Popup') return;
    const rect = numbers(d.lookupMaybe(PDFName.of('Rect'), PDFArray) ?? undefined);
    if (subtype === 'Widget' && rect?.length === 4 && widget(d, rect, annot)) return;
    if (subtype !== 'FreeText' || !rect || rect.length !== 4) {
      hasArtwork = true;
      return;
    }
    const appearance = appearanceText(d);
    const rc = d.get(PDFName.of('RC'));
    const rich = rc instanceof PDFRawStream ? new TextDecoder('utf-8').decode(decodePDFRawStream(rc).decode()) : textOf(rc);
    const text = revuFields(rich ? richText(rich) : (appearance?.text ?? textOf(d.get(PDFName.of('Contents')))));
    if (!text.trim()) return;
    const da = textOf(d.get(PDFName.of('DA')));
    const ds = textOf(d.get(PDFName.of('DS')));
    const font = appearance?.font || /\/(\S+)\s+[\d.]+\s+Tf/.exec(da)?.[1] || '';
    const dsColor = /(?:^|[;\s])color:\s*(#[0-9a-f]{6})/i.exec(ds)?.[1];
    const daRgb = /([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+rg/.exec(da);
    const x0 = Math.min(rect[0]!, rect[2]!);
    const x1 = Math.max(rect[0]!, rect[2]!);
    const y1 = Math.max(rect[1]!, rect[3]!);
    texts.push({
      text,
      x: x0 - box.x,
      y: box.y + box.h - y1,
      w: x1 - x0,
      h: y1 - Math.min(rect[1]!, rect[3]!),
      size: appearance?.size ?? (Number(/\/\S+\s+([\d.]+)\s+Tf/.exec(da)?.[1]) || 12),
      color: appearance?.color ?? dsColor ?? (daRgb ? toHex(Number(daRgb[1]), Number(daRgb[2]), Number(daRgb[3])) : '#000000'),
      bold: /bld|bold/i.test(font) || /font:\s*bold|font-weight:\s*bold/i.test(ds),
      italic: /obl|ital|(^|[^a-z])it$/i.test(font) || /font:[^;]*italic|font-style:\s*italic/i.test(ds),
      align: /text-align:\s*left/i.test(ds) ? 'left' : /text-align:\s*right/i.test(ds) ? 'right' : 'center',
      annot,
    });
  });

  const title = doc.getTitle()?.trim();
  return { name: title || fallbackName, width: box.w, height: box.h, box, texts, hasArtwork, fields };
}

/** A stamp of text alone as one of ours: its lines top to bottom, in the colour of the largest. */
export function textStamp(p: ParsedStamp, id: string): StampDef {
  const ordered = [...p.texts].sort((a, b) => a.y - b.y || a.x - b.x);
  const lead = [...p.texts].sort((a, b) => b.size - a.size)[0];
  // Texts side by side (a label and the field beside it) are one line, left to right.
  const rows: StampPdfText[][] = [];
  for (const t of ordered) {
    const mid = t.y + t.h / 2;
    const row = t.text.includes('\n') ? undefined : rows.find((r) => r.every((o) => !o.text.includes('\n') && Math.abs(o.y + o.h / 2 - mid) < Math.min(o.h, t.h) / 2));
    if (row) row.push(t);
    else rows.push([t]);
  }
  return {
    id,
    name: p.name,
    lines: rows.flatMap((r) => (r.length > 1 ? [r.sort((a, b) => a.x - b.x).map((t) => t.text).join(' ')] : r[0]!.text.split('\n'))),
    color: lead?.color ?? '#000000',
    frame: 'none',
    ...(p.fields.length ? { fields: structuredClone(p.fields) } : {}),
  };
}

/** A stamp with artwork: the rendered picture of it (no text) with the stamp's text over it. */
export function artStamp(p: ParsedStamp, image: string, id: string): StampDef {
  const texts: StampArtText[] = p.texts.map((t) => ({
    text: t.text.replace(/\n/g, ' '),
    x: t.x / p.width,
    y: t.y / p.height,
    w: t.w / p.width,
    h: t.h / p.height,
    size: t.size / p.height,
    color: t.color,
    bold: t.bold,
    italic: t.italic,
    align: t.align,
  }));
  const art: StampArt = { image, aspect: p.width / p.height, texts };
  const base = textStamp(p, id);
  return { ...base, lines: texts.map((t) => t.text), art };
}
