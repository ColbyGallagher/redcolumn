import { decodePDFRawStream, PDFArray, PDFDict, PDFName, PDFNumber, PDFRawStream, PDFRef, PDFStream, type PDFContext } from 'pdf-lib';

/**
 * Pictures far sharper than the page shows them (a 24-megapixel photo placed three inches wide, a
 * 600 dpi scan) cost a renderer the decoding and scaling of every pixel each time the page is
 * opened, and memory to match. In the render copy they are scaled down to what the page can show.
 */

/** Resolution kept, in pixels per inch of the picture as placed: sharp at several times 100% zoom. */
export const KEEP_DPI = 300;
/** Pictures sharper than KEEP_DPI by less than this are left alone (rescaling costs quality). */
const MIN_EXCESS = 1.5;
/** Pictures this small are left alone however they are placed. */
const MIN_PIXELS = 2_000_000;

const N = (s: string) => PDFName.of(s);

/** A picture the copy can rescale: 8-bit RGB or grey, JPEG or deflated pixels, no masks. */
export interface Rescalable {
  format: 'jpeg' | 'raw';
  channels: 1 | 3;
  width: number;
  height: number;
}

/** Channels of a colour space that rescaled pixels can keep (DeviceGray/RGB, ICC with 1 or 3), else 0. */
function channelsOf(cs: unknown): 0 | 1 | 3 {
  if (cs === N('DeviceRGB')) return 3;
  if (cs === N('DeviceGray')) return 1;
  if (cs instanceof PDFArray && cs.lookup(0) === N('ICCBased')) {
    const profile = cs.lookup(1);
    const n = profile instanceof PDFStream ? profile.dict.lookup(N('N')) : null;
    if (n instanceof PDFNumber && (n.asNumber() === 1 || n.asNumber() === 3)) return n.asNumber() as 1 | 3;
  }
  return 0;
}

/** The picture as one the copy can rescale, or null. */
export function rescalable(stream: unknown): Rescalable | null {
  if (!(stream instanceof PDFRawStream)) return null;
  const d = stream.dict;
  if (d.lookup(N('Subtype')) !== N('Image')) return null;
  // Masks, decode ranges and anything but 8 bits a channel would need more than rescaling.
  if (d.has(N('ImageMask')) || d.has(N('Mask')) || d.has(N('SMask')) || d.has(N('Decode')) || d.has(N('SMaskInData'))) return null;
  const bpc = d.lookup(N('BitsPerComponent'));
  if (!(bpc instanceof PDFNumber) || bpc.asNumber() !== 8) return null;
  const w = d.lookup(N('Width'));
  const h = d.lookup(N('Height'));
  if (!(w instanceof PDFNumber) || !(h instanceof PDFNumber)) return null;
  const channels = channelsOf(d.lookup(N('ColorSpace')));
  if (!channels) return null;
  const f = d.lookup(N('Filter'));
  const filter = f instanceof PDFArray ? (f.size() === 1 ? f.lookup(0) : null) : f;
  const format = filter === N('DCTDecode') ? 'jpeg' : filter === N('FlateDecode') ? 'raw' : null;
  if (!format) return null;
  return { format, channels, width: w.asNumber(), height: h.asNumber() };
}

/**
 * The size to rescale a picture to, given the largest size (points) it is placed at, or null when
 * it is not sharp enough beyond need to be worth it.
 */
export function rescaledSize(img: { width: number; height: number }, placed: { w: number; h: number }): { width: number; height: number } | null {
  if (img.width * img.height < MIN_PIXELS || placed.w <= 0 || placed.h <= 0) return null;
  const dpi = Math.max(img.width / (placed.w / 72), img.height / (placed.h / 72));
  if (dpi < KEEP_DPI * MIN_EXCESS) return null;
  const k = KEEP_DPI / dpi;
  return { width: Math.max(1, Math.round(img.width * k)), height: Math.max(1, Math.round(img.height * k)) };
}

/** Whether this runtime can decode and encode pictures (a browser worker; not Node). */
export const canRescale = () => typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap !== 'undefined';

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(out).arrayBuffer());
}

/** The picture rescaled to `size`, as a new image stream with the old one's dictionary updated. */
export async function rescale(ref: PDFRef, img: Rescalable, size: { width: number; height: number }, context: PDFContext): Promise<PDFRawStream> {
  const old = context.lookup(ref) as PDFRawStream;
  const resize = { resizeWidth: size.width, resizeHeight: size.height, resizeQuality: 'high' as const };
  let source: ImageBitmap;
  if (img.format === 'jpeg') {
    source = await createImageBitmap(new Blob([old.contents as BlobPart], { type: 'image/jpeg' }), resize);
  } else {
    const raw = decodePDFRawStream(old).decode();
    if (raw.length < img.width * img.height * img.channels) throw new Error('The picture has fewer pixels than its size says');
    const rgba = new Uint8ClampedArray(img.width * img.height * 4);
    for (let i = 0, j = 0; i < rgba.length; i += 4, j += img.channels) {
      rgba[i] = raw[j]!;
      rgba[i + 1] = raw[j + (img.channels === 3 ? 1 : 0)]!;
      rgba[i + 2] = raw[j + (img.channels === 3 ? 2 : 0)]!;
      rgba[i + 3] = 255;
    }
    source = await createImageBitmap(new ImageData(rgba, img.width, img.height), resize);
  }
  const canvas = new OffscreenCanvas(size.width, size.height);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(source, 0, 0);
  source.close();

  const dict = old.dict.clone(context) as PDFDict;
  dict.set(N('Width'), PDFNumber.of(size.width));
  dict.set(N('Height'), PDFNumber.of(size.height));
  dict.delete(N('DecodeParms'));
  let bytes: Uint8Array;
  if (img.format === 'jpeg') {
    // A canvas writes colour JPEGs: the picture becomes RGB.
    bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 })).arrayBuffer());
    dict.set(N('Filter'), N('DCTDecode'));
    dict.set(N('ColorSpace'), N('DeviceRGB'));
  } else {
    const rgba = ctx.getImageData(0, 0, size.width, size.height).data;
    const raw = new Uint8Array(size.width * size.height * img.channels);
    for (let i = 0, j = 0; i < rgba.length; i += 4, j += img.channels) {
      raw[j] = rgba[i]!;
      if (img.channels === 3) {
        raw[j + 1] = rgba[i + 1]!;
        raw[j + 2] = rgba[i + 2]!;
      }
    }
    bytes = await deflate(raw);
    dict.set(N('Filter'), N('FlateDecode'));
  }
  dict.set(N('Length'), PDFNumber.of(bytes.length));
  return PDFRawStream.of(dict, bytes);
}
