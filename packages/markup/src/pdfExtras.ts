import { decodePDFRawStream, PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef, type PDFObject } from 'pdf-lib';
import { arr, dict, nameOf, num, PdfName, refNum, str, type PdfDictValue, type PdfExtras, type PdfPageExtras, type PdfValue } from './bluebeam';
import { toPdfValue } from './pdfValue';
import { pageMatrix } from './export';

/** Above this size the raw read is skipped (PDFium's view of the annotations still applies). */
const MAX_BYTES = 400 * 1024 * 1024;

/**
 * Reads what PDFium cannot report about a PDF's annotations: their dictionaries as plain values,
 * Bluebeam's per-page viewports and Spaces, custom columns, layer names and image markups'
 * pictures. Everything is copied out, so `bytes` may be handed elsewhere afterwards. Null when the
 * file is too large or cannot be parsed.
 */
export async function readPdfExtras(bytes: ArrayBuffer | Uint8Array): Promise<PdfExtras | null> {
  if (bytes.byteLength > MAX_BYTES) return null;
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
  } catch {
    return null;
  }
  const ctx = doc.context;

  const value = (obj: PDFObject | undefined, key: string | null, depth: number): PdfValue => toPdfValue(ctx, obj, key, depth);
  const dictValue = (obj: PDFObject | undefined): PdfDictValue | null => dict(value(obj, null, 0));

  const images = new Map<number, string>();
  const pages: PdfPageExtras[] = [];
  for (const page of doc.getPages()) {
    const annots: (PdfDictValue | null)[] = [];
    const objectNumbers: number[] = [];
    for (const entry of page.node.Annots()?.asArray() ?? []) {
      objectNumbers.push(entry instanceof PDFRef ? entry.objectNumber : 0);
      const a = dictValue(entry);
      annots.push(a);
      const image = refNum(a?.Image);
      if (image !== null && !images.has(image)) {
        const url = await imageDataUrl(ctx.lookup(PDFRef.of(image)));
        if (url) images.set(image, url);
      }
    }
    const list = (key: string) => arr(value(page.node.get(PDFName.of(key)), key, 0)).flatMap((v) => (dict(v) ? [dict(v)!] : []));
    const turned = page.getRotation().angle % 180 !== 0;
    const crop = page.getCropBox();
    pages.push({
      matrix: pageMatrix(page),
      width: turned ? crop.height : crop.width,
      height: turned ? crop.width : crop.height,
      annots,
      objectNumbers,
      viewports: list('VP'),
      spaces: list('BSISpaces'),
    });
  }

  const ocgNames = new Map<number, string>();
  const props = doc.catalog.lookupMaybe(PDFName.of('OCProperties'), PDFDict);
  for (const ref of props?.lookupMaybe(PDFName.of('OCGs'), PDFArray)?.asArray() ?? []) {
    if (!(ref instanceof PDFRef)) continue;
    const name = str(dictValue(ref)?.Name);
    if (name) ocgNames.set(ref.objectNumber, name);
  }

  const columns = arr(value(doc.catalog.get(PDFName.of('BSIAnnotColumns')), 'BSIAnnotColumns', 0)).flatMap((c) => (dict(c) ? [dict(c)!] : []));
  return { pages, ocgNames, columns, images };
}

/** An image XObject as a PNG (or, for JPEG data, JPEG) data URL; null if it cannot be decoded here. */
async function imageDataUrl(obj: PDFObject | undefined): Promise<string | null> {
  if (!(obj instanceof PDFRawStream)) return null;
  const d = obj.dict;
  const filters = [d.lookup(PDFName.of('Filter'))].flatMap((f) => (f instanceof PDFArray ? f.asArray() : f ? [f] : [])).map((f) => (f instanceof PDFName ? f.decodeText() : ''));
  try {
    if (filters.length === 1 && filters[0] === 'DCTDecode') return `data:image/jpeg;base64,${base64(obj.contents)}`;
    if (filters.includes('DCTDecode') || filters.includes('JPXDecode') || filters.includes('JBIG2Decode') || filters.includes('CCITTFaxDecode')) return null;
    const width = num(simple(d.lookup(PDFName.of('Width'))));
    const height = num(simple(d.lookup(PDFName.of('Height'))));
    const bpc = num(simple(d.lookup(PDFName.of('BitsPerComponent')))) ?? 8;
    if (!width || !height || bpc !== 8) return null;
    const components = colorComponents(d.lookup(PDFName.of('ColorSpace')));
    if (!components) return null;
    const data = unpredict(decodePDFRawStream(obj).decode(), d.lookup(PDFName.of('DecodeParms')), width, components);
    if (data.length < width * height * components) return null;
    let alpha: Uint8Array | null = null;
    const smask = d.lookup(PDFName.of('SMask'));
    if (smask instanceof PDFRawStream) {
      const sw = num(simple(smask.dict.lookup(PDFName.of('Width'))));
      const sh = num(simple(smask.dict.lookup(PDFName.of('Height'))));
      if (sw === width && sh === height) alpha = unpredict(decodePDFRawStream(smask).decode(), smask.dict.lookup(PDFName.of('DecodeParms')), width, 1);
    }
    const rgba = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      const s = i * components;
      let r: number, g: number, b: number;
      if (components === 1) r = g = b = data[s]!;
      else if (components === 3) [r, g, b] = [data[s]!, data[s + 1]!, data[s + 2]!];
      else {
        const k = 1 - data[s + 3]! / 255;
        [r, g, b] = [0, 1, 2].map((j) => Math.round((255 - data[s + j]!) * k)) as [number, number, number];
      }
      rgba.set([r, g, b, alpha ? (alpha[i] ?? 255) : 255], i * 4);
    }
    return `data:image/png;base64,${base64(await encodePng(width, height, rgba))}`;
  } catch {
    return null;
  }
}

/**
 * Undoes a Flate stream's /Predictor (PNG row filters, or TIFF predictor 2), which pdf-lib's
 * decoder leaves in place. 8 bits per component only.
 */
function unpredict(data: Uint8Array, parms: PDFObject | undefined, width: number, components: number): Uint8Array {
  const p = parms instanceof PDFArray ? parms.lookup(0) : parms;
  if (!(p instanceof PDFDict)) return data;
  const predictor = num(simple(p.lookup(PDFName.of('Predictor')))) ?? 1;
  if (predictor < 2) return data;
  const colors = num(simple(p.lookup(PDFName.of('Colors')))) ?? components;
  const columns = num(simple(p.lookup(PDFName.of('Columns')))) ?? width;
  const bpp = colors;
  const row = columns * colors;
  if (predictor === 2) {
    const out = data.slice();
    for (let y = 0; y * row < out.length; y++) for (let x = bpp; x < row; x++) out[y * row + x] = (out[y * row + x]! + out[y * row + x - bpp]!) & 255;
    return out;
  }
  const rows = Math.floor(data.length / (row + 1));
  const out = new Uint8Array(rows * row);
  for (let y = 0; y < rows; y++) {
    const type = data[y * (row + 1)]!;
    const src = y * (row + 1) + 1;
    const dst = y * row;
    for (let x = 0; x < row; x++) {
      const raw = data[src + x]!;
      const left = x >= bpp ? out[dst + x - bpp]! : 0;
      const up = y > 0 ? out[dst - row + x]! : 0;
      const upLeft = y > 0 && x >= bpp ? out[dst - row + x - bpp]! : 0;
      let v: number;
      if (type === 1) v = raw + left;
      else if (type === 2) v = raw + up;
      else if (type === 3) v = raw + ((left + up) >> 1);
      else if (type === 4) {
        const pa = Math.abs(up - upLeft);
        const pb = Math.abs(left - upLeft);
        const pc = Math.abs(left + up - 2 * upLeft);
        v = raw + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft);
      } else v = raw;
      out[dst + x] = v & 255;
    }
  }
  return out;
}

/** A number or name, for reading image dictionaries. */
function simple(obj: PDFObject | undefined): PdfValue {
  if (obj instanceof PDFNumber) return obj.asNumber();
  if (obj instanceof PDFName) return new PdfName(obj.decodeText());
  return null;
}

/** Components per pixel of a colour space; null for ones not handled (Indexed, Lab, ...). */
function colorComponents(cs: PDFObject | undefined): number | null {
  if (cs instanceof PDFName) return ({ DeviceGray: 1, DeviceRGB: 3, DeviceCMYK: 4, CalGray: 1, CalRGB: 3 } as Record<string, number>)[cs.decodeText()] ?? null;
  if (cs instanceof PDFArray) {
    const kind = nameOf(simple(cs.lookup(0)));
    if (kind === 'ICCBased') {
      const icc = cs.lookup(1);
      const n = icc instanceof PDFRawStream ? num(simple(icc.dict.lookup(PDFName.of('N')))) : null;
      return n === 1 || n === 3 || n === 4 ? n : null;
    }
    if (kind === 'CalRGB') return 3;
    if (kind === 'CalGray') return 1;
  }
  return null;
}

function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

let crcTable: Uint32Array | null = null;
function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (const b of bytes) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** An 8-bit RGBA PNG. */
async function encodePng(width: number, height: number, rgba: Uint8Array): Promise<Uint8Array> {
  const raw = new Uint8Array(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  };
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', await deflate(raw)), chunk('IEND', new Uint8Array())];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
