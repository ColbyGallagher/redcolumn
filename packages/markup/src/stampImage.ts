import type { StampDef } from './stamp';

/** Pictures larger than this many bytes are refused as stamps. */
export const MAX_STAMP_IMAGE_BYTES = 15 * 1024 * 1024;
/** A stamp's artwork is scaled down to fit this many pixels on its longer side. */
export const MAX_STAMP_IMAGE_SIDE = 1280;
/** Pictures with more pixels than this are refused before they are decoded (it would take gigabytes). */
export const MAX_STAMP_IMAGE_PIXELS = 64_000_000;
/**
 * The most characters a stamp's picture may take as a data URL. The library is kept in the browser's
 * local storage (about 5 MB for everything), so each picture is encoded smaller until it fits.
 */
export const STAMP_IMAGE_BUDGET = 600_000;
/** Longer-side sizes to try, largest first, until the picture fits `STAMP_IMAGE_BUDGET`. */
export const STAMP_IMAGE_SIDES = [MAX_STAMP_IMAGE_SIDE, 1024, 768, 512, 384, 256];

/**
 * A picture's size in pixels from its first bytes (PNG, JPEG, GIF, BMP, WebP), without decoding it;
 * null when it is none of those.
 */
export function imageDimensions(b: Uint8Array): { width: number; height: number } | null {
  const u16be = (i: number) => (b[i]! << 8) | b[i + 1]!;
  const u16le = (i: number) => b[i]! | (b[i + 1]! << 8);
  const u24le = (i: number) => b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16);
  const u32be = (i: number) => ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0;
  const u32le = (i: number) => (b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16) | (b[i + 3]! << 24)) >>> 0;
  const ascii = (i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));
  if (b.length >= 24 && b[0] === 0x89 && ascii(1, 3) === 'PNG') return { width: u32be(16), height: u32be(20) };
  if (b.length >= 10 && ascii(0, 3) === 'GIF') return { width: u16le(6), height: u16le(8) };
  if (b.length >= 26 && ascii(0, 2) === 'BM') {
    const headerSize = u32le(14);
    return headerSize === 12 ? { width: u16le(18), height: u16le(20) } : { width: u32le(18) | 0, height: Math.abs(u32le(22) | 0) };
  }
  if (b.length >= 30 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    const kind = ascii(12, 4);
    if (kind === 'VP8X') return { width: u24le(24) + 1, height: u24le(27) + 1 };
    if (kind === 'VP8L') {
      const bits = u32le(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    if (kind === 'VP8 ') return { width: u16le(26) & 0x3fff, height: u16le(28) & 0x3fff };
    return null;
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = b[i + 1]!;
      if (marker === 0xff) {
        i++;
        continue;
      }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2;
        continue;
      }
      // Start-of-frame markers carry the size (not DHT, JPG and DAC, which sit among them).
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { height: u16be(i + 5), width: u16be(i + 7) };
      i += 2 + u16be(i + 2);
    }
  }
  return null;
}

/** The artwork size to keep: the picture's own, or scaled down (never up) to fit `MAX_STAMP_IMAGE_SIDE`. */
export function stampImageSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, MAX_STAMP_IMAGE_SIDE / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** `Company_Seal.png` → `Company Seal`. */
export function imageStampName(file: string): string {
  return file.replace(/\.[a-z0-9]{1,5}$/i, '').replace(/_+/g, ' ').trim() || 'Image Stamp';
}

/**
 * A stamp that is just a picture (a signature, a seal, a logo): `image` is a PNG or JPEG data URL,
 * `width` and `height` its size in pixels. Transparency in a PNG is kept when the stamp is placed
 * and written to a PDF.
 */
export function imageStamp(image: string, width: number, height: number, name: string, id: string): StampDef {
  if (!/^data:image\/(png|jpe?g);base64,/i.test(image)) throw new Error('the picture must be a PNG or JPEG');
  if (!(width > 0) || !(height > 0)) throw new Error('the picture has no size');
  return { id, name, lines: [name], color: '#000000', frame: 'none', art: { image, aspect: width / height, texts: [] } };
}
