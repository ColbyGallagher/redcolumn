import { decodePDFRawStream, PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRawStream, PDFRef, PDFString, type PDFObject } from 'pdf-lib';
import type { StampArt, StampArtText, StampDef } from './stamp';
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

/** The text of a rich text value (`/RC`): paragraphs and breaks become new lines. */
function richText(xml: string): string {
  const body = /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(xml)?.[1] ?? xml;
  return unescapeXml(
    body
      .replace(/<\/p>\s*<p\b[^>]*>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]*>/g, ''),
  )
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');
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

  dicts.forEach((d, annot) => {
    if (!(d instanceof PDFDict)) return;
    const subtype = d.lookupMaybe(PDFName.of('Subtype'), PDFName)?.decodeText();
    if (subtype === 'Popup') return;
    const rect = numbers(d.lookupMaybe(PDFName.of('Rect'), PDFArray) ?? undefined);
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
  return { name: title || fallbackName, width: box.w, height: box.h, box, texts, hasArtwork };
}

/** A stamp of text alone as one of ours: its lines top to bottom, in the colour of the largest. */
export function textStamp(p: ParsedStamp, id: string): StampDef {
  const ordered = [...p.texts].sort((a, b) => a.y - b.y || a.x - b.x);
  const lead = [...p.texts].sort((a, b) => b.size - a.size)[0];
  return {
    id,
    name: p.name,
    lines: ordered.flatMap((t) => t.text.split('\n')),
    color: lead?.color ?? '#000000',
    frame: 'none',
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
