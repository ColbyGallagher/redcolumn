import type { StampDef } from './stamp';

/** Pictures larger than this many bytes are refused as stamps. */
export const MAX_STAMP_IMAGE_BYTES = 15 * 1024 * 1024;
/** A stamp's artwork is scaled down to fit this many pixels on its longer side. */
export const MAX_STAMP_IMAGE_SIDE = 1600;

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
