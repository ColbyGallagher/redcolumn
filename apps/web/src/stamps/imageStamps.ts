import { imageStamp, imageStampName, MAX_STAMP_IMAGE_BYTES, stampImageSize, type StampDef } from '@nb/markup';
import { updateWorkspace } from '../workspace/profiles';
import { importRevuStamps } from './revuStamps';

/** What the Stamps dialog's file picker offers: stamp PDFs and pictures. */
export const STAMP_FILE_ACCEPT = '.pdf,application/pdf,.png,.jpg,.jpeg,.gif,.bmp,.webp,image/png,image/jpeg,image/gif,image/bmp,image/webp';

export const isImageFile = (f: { name: string; type: string }) => /^image\//i.test(f.type) || /\.(png|jpe?g|gif|bmp|webp|svg)$/i.test(f.name);

/**
 * A picture (PNG, JPEG, GIF, BMP or WebP, whatever the browser can decode) as a stamp. Transparency
 * is kept (as a PNG); a picture with none stays a JPEG, so a photo does not balloon. Long sides over
 * 1600 pixels are scaled down. SVG is refused: it can carry scripts and links and is not decoded here.
 */
export async function stampFromImage(file: File): Promise<StampDef> {
  if (/svg/i.test(file.type) || /\.svg$/i.test(file.name)) throw new Error('SVG pictures are not supported; use a PNG or JPEG');
  if (file.size > MAX_STAMP_IMAGE_BYTES) throw new Error(`the picture is over ${Math.round(MAX_STAMP_IMAGE_BYTES / 1048576)} MB`);
  if (!file.size) throw new Error('the file is empty');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('this is not a picture that can be read (PNG, JPEG, GIF, BMP or WebP)');
  }
  try {
    const { width, height } = stampImageSize(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(bitmap, 0, 0, width, height);
    const px = ctx.getImageData(0, 0, width, height).data;
    let transparent = false;
    for (let i = 3; i < px.length; i += 4) {
      if (px[i]! < 255) {
        transparent = true;
        break;
      }
    }
    const jpeg = !transparent && /jpe?g/i.test(file.type || file.name);
    const url = canvas.toDataURL(jpeg ? 'image/jpeg' : 'image/png', 0.92);
    return imageStamp(url, width, height, imageStampName(file.name), crypto.randomUUID());
  } finally {
    bitmap.close();
  }
}

/** Imports stamp PDFs and pictures into the active profile's library. A stamp of the same name is replaced. */
export async function importStampFiles(files: File[]): Promise<{ added: StampDef[]; failed: string[] }> {
  const pictures = files.filter(isImageFile);
  const pdfs = files.filter((f) => !isImageFile(f));
  const added: StampDef[] = [];
  const failed: string[] = [];
  for (const f of pictures) {
    try {
      added.push(await stampFromImage(f));
    } catch (err) {
      failed.push(`${f.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (added.length) updateWorkspace((w) => ({ ...w, stamps: [...w.stamps.filter((s) => !added.some((a) => a.name === s.name)), ...added] }));
  if (pdfs.length) {
    const r = await importRevuStamps(pdfs);
    added.push(...r.added);
    failed.push(...r.failed);
  }
  return { added, failed };
}
