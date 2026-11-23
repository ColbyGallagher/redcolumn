import {
  COUNT_SYMBOL_BUDGET,
  COUNT_SYMBOL_SIDES,
  imageCountSymbol,
  imageDimensions,
  imageStampName,
  MAX_STAMP_IMAGE_BYTES,
  MAX_STAMP_IMAGE_PIXELS,
  type CountSymbol,
} from '@nb/markup';
import { browserPictureEnv, type PictureEnv } from '../stamps/pictureStamp';

/** Picture formats accepted when importing a custom count symbol image. */
export const COUNT_SYMBOL_FILE_ACCEPT = '.png,.jpg,.jpeg,.gif,.bmp,.webp,image/png,image/jpeg,image/gif,image/bmp,image/webp';

const MB = 1048576;

/**
 * Decodes a picture (PNG, JPEG, GIF, BMP or WebP) into a lightweight `CountSymbol` (at most 256 px
 * on its longer side and within `COUNT_SYMBOL_BUDGET`), keeping transparency as PNG.
 */
export async function countSymbolFromImage(file: File, env: PictureEnv = browserPictureEnv): Promise<CountSymbol> {
  if (/svg/i.test(file.type) || /\.svg$/i.test(file.name)) throw new Error('SVG pictures are not supported; use a PNG or JPEG');
  if (!file.size) throw new Error('the file is empty');
  if (file.size > MAX_STAMP_IMAGE_BYTES) throw new Error(`the picture is over ${Math.round(MAX_STAMP_IMAGE_BYTES / MB)} MB`);
  let dims = imageDimensions(new Uint8Array(await file.slice(0, 64 * 1024).arrayBuffer()));
  if (!dims && file.size > 64 * 1024) {
    const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
    if (head[0] === 0xff && head[1] === 0xd8) dims = imageDimensions(new Uint8Array(await file.slice(0, 1024 * 1024).arrayBuffer()));
  }
  if (!dims || !(dims.width > 0) || !(dims.height > 0)) throw new Error('this is not a picture that can be read (PNG, JPEG, GIF, BMP or WebP)');
  if (dims.width * dims.height > MAX_STAMP_IMAGE_PIXELS) throw new Error(`the picture is too large (${dims.width} x ${dims.height} pixels)`);

  const first = COUNT_SYMBOL_SIDES[0];
  let bitmap;
  try {
    bitmap = await env.decode(file, dims.width >= dims.height ? (dims.width > first ? { width: first } : {}) : dims.height > first ? { height: first } : {});
  } catch {
    throw new Error('this is not a picture that can be read (PNG, JPEG, GIF, BMP or WebP)');
  }
  try {
    let hasAlpha: boolean | null = null;
    for (const side of COUNT_SYMBOL_SIDES) {
      const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = env.canvas();
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('the picture cannot be drawn here');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bitmap, 0, 0, width, height);
      if (hasAlpha === null) {
        const px = ctx.getImageData(0, 0, width, height).data;
        hasAlpha = false;
        for (let i = 3; i < px.length; i += 4) {
          if (px[i]! < 255) {
            hasAlpha = true;
            break;
          }
        }
      }
      const url = hasAlpha ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.88);
      if (url.length <= COUNT_SYMBOL_BUDGET) return imageCountSymbol(url, width, height, imageStampName(file.name), crypto.randomUUID());
    }
    throw new Error('the picture is too detailed to keep as a count symbol; use a simpler or smaller one');
  } finally {
    bitmap.close();
  }
}
