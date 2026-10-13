import { PDFDocument } from 'pdf-lib';
import { settings } from '../settings/settings';

/** Picture types Open accepts and turns into PDFs. */
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/bmp', 'image/webp'];

/** Resolution assumed for pictures that do not record one (a screen's CSS pixel). */
const DEFAULT_DPI = 96;

export function isImageFile(file: { name: string; type: string }): boolean {
  return IMAGE_TYPES.includes(file.type) || /\.(png|jpe?g|gif|bmp|webp)$/i.test(file.name);
}

/**
 * Horizontal and vertical resolution recorded in a PNG (pHYs chunk) or JPEG (JFIF header), in
 * dots per inch, or null when the file does not say.
 */
export function imageDpi(bytes: Uint8Array): [number, number] | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // PNG: 8-byte signature, then chunks of length, type, data, CRC.
  if (bytes.length > 8 && view.getUint32(0) === 0x89504e47) {
    for (let at = 8; at + 12 <= bytes.length; ) {
      const len = view.getUint32(at);
      const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
      if (type === 'pHYs' && len >= 9) {
        const x = view.getUint32(at + 8);
        const y = view.getUint32(at + 12);
        // Unit 1 is pixels per metre.
        return bytes[at + 16] === 1 && x && y ? [x * 0.0254, y * 0.0254] : null;
      }
      if (type === 'IDAT' || type === 'IEND') return null;
      at += 12 + len;
    }
    return null;
  }
  // JPEG: SOI, then segments; APP0 "JFIF" carries a density.
  if (bytes.length > 4 && view.getUint16(0) === 0xffd8) {
    for (let at = 2; at + 4 <= bytes.length; ) {
      if (bytes[at] !== 0xff) return null;
      const marker = bytes[at + 1]!;
      const len = view.getUint16(at + 2);
      if (marker === 0xe0 && len >= 16 && String.fromCharCode(...bytes.subarray(at + 4, at + 9)) === 'JFIF\0') {
        const units = bytes[at + 11];
        const x = view.getUint16(at + 12);
        const y = view.getUint16(at + 14);
        if (!x || !y) return null;
        if (units === 1) return [x, y];
        if (units === 2) return [x * 2.54, y * 2.54];
        return null;
      }
      if (marker === 0xda) return null;
      at += 2 + len;
    }
  }
  return null;
}

/** Page size in points for a picture of `w` × `h` pixels at its recorded (or assumed) resolution. */
export function imagePageSize(w: number, h: number, dpi: [number, number] | null): { width: number; height: number } {
  const [dx, dy] = dpi && dpi[0] >= 10 && dpi[1] >= 10 ? dpi : [DEFAULT_DPI, DEFAULT_DPI];
  return { width: (w / dx) * 72, height: (h / dy) * 72 };
}

export type Colourspace = 'auto' | 'colour' | 'grey' | 'mono';

/** Pixels turned grey, or black and white (at half brightness), in place. */
export function convertColourspace(data: Uint8ClampedArray, to: Colourspace) {
  if (to !== 'grey' && to !== 'mono') return;
  for (let i = 0; i < data.length; i += 4) {
    let v = 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
    if (to === 'mono') v = v < 128 ? 0 : 255;
    data[i] = data[i + 1] = data[i + 2] = v;
  }
}

/** The scale (at most 1) that brings a picture of `dpi` down to `target` dots per inch; 'auto' keeps it. */
export function resolutionScale(dpi: [number, number] | null, target: 'auto' | 'original' | '72' | '150' | '300' | '600'): number {
  if (target === 'auto' || target === 'original') return 1;
  const [dx, dy] = dpi && dpi[0] >= 10 && dpi[1] >= 10 ? dpi : [DEFAULT_DPI, DEFAULT_DPI];
  return Math.min(1, Number(target) / Math.max(dx, dy));
}

/**
 * A one-page PDF showing a picture at its real size, per Preferences › Images › Import Image as
 * PDF Colourspace and Resolution. PNG and JPEG are embedded as they are when neither changes them;
 * otherwise (and for other formats) the picture is redrawn and stored as PNG (JPEG for photos).
 */
export async function imageToPdf(file: Blob & { type: string }): Promise<ArrayBuffer> {
  let bytes = new Uint8Array(await file.arrayBuffer());
  let kind = file.type === 'image/jpeg' ? 'jpeg' : file.type === 'image/png' ? 'png' : null;
  const dpi = kind ? imageDpi(bytes) : null;
  const { importColourspace: colour, importResolution } = settings.get();
  const scale = resolutionScale(dpi, importResolution);
  const recolour = colour === 'grey' || colour === 'mono';
  let natural: { width: number; height: number } | null = null;
  if (!kind || scale < 1 || recolour) {
    const bitmap = await createImageBitmap(file);
    natural = { width: bitmap.width, height: bitmap.height };
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    if (recolour) {
      const px = ctx.getImageData(0, 0, w, h);
      convertColourspace(px.data, colour);
      ctx.putImageData(px, 0, 0);
    }
    // Photos stay JPEG unless made black and white, which compresses far better losslessly.
    const jpeg = kind === 'jpeg' && colour !== 'mono';
    bytes = new Uint8Array(await (await canvas.convertToBlob(jpeg ? { type: 'image/jpeg', quality: 0.9 } : { type: 'image/png' })).arrayBuffer());
    kind = jpeg ? 'jpeg' : 'png';
  }
  const doc = await PDFDocument.create();
  const image = kind === 'jpeg' ? await doc.embedJpg(bytes) : await doc.embedPng(bytes);
  // The page keeps the picture's real size, whatever resolution it is stored at.
  const size = imagePageSize(natural?.width ?? image.width, natural?.height ?? image.height, dpi);
  doc.addPage([size.width, size.height]).drawImage(image, { x: 0, y: 0, width: size.width, height: size.height });
  const out = await doc.save();
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
}
