import { imageDimensions, imageStamp, imageStampName, MAX_STAMP_IMAGE_BYTES, MAX_STAMP_IMAGE_PIXELS, STAMP_IMAGE_BUDGET, STAMP_IMAGE_SIDES, type StampDef } from '@nb/markup';

/** What the Stamps dialog's file picker offers: stamp PDFs and pictures (SVG is listed so it can be refused with a reason). */
export const STAMP_FILE_ACCEPT = '.pdf,application/pdf,.png,.jpg,.jpeg,.gif,.bmp,.webp,.svg,image/png,image/jpeg,image/gif,image/bmp,image/webp,image/svg+xml';

export const isImageFile = (f: { name: string; type: string }) => /^image\//i.test(f.type) || /\.(png|jpe?g|gif|bmp|webp|svg)$/i.test(f.name);

/** The parts of the browser that decoding a picture uses, so they can be stood in for in tests. */
export interface PictureSurface {
  drawImage(source: PictureBitmap, x: number, y: number, w: number, h: number): void;
  getImageData(x: number, y: number, w: number, h: number): { data: ArrayLike<number> };
  imageSmoothingEnabled: boolean;
  imageSmoothingQuality: 'low' | 'medium' | 'high';
}
export interface PictureCanvas {
  width: number;
  height: number;
  getContext(kind: '2d', options?: { willReadFrequently?: boolean }): PictureSurface | null;
  toDataURL(type: string, quality?: number): string;
}
export interface PictureBitmap {
  width: number;
  height: number;
  close(): void;
}
export interface PictureEnv {
  /** Decodes at most `box` pixels wide/high (as the decoder can scale while decoding), upright per its EXIF turn. */
  decode(file: File, box: { width?: number; height?: number }): Promise<PictureBitmap>;
  canvas(): PictureCanvas;
}

export const browserPictureEnv: PictureEnv = {
  decode: (file, box) => createImageBitmap(file, { imageOrientation: 'from-image', resizeQuality: 'high', ...box }),
  canvas: () => document.createElement('canvas'),
};

const MB = 1048576;

/**
 * A picture (PNG, JPEG, GIF, BMP or WebP, whatever the browser can decode) as a stamp. Transparency
 * is kept (as a PNG); a picture with none is stored as a JPEG. The picture is made smaller, step by
 * step, until it is small enough to keep in the library. SVG is refused: it can carry scripts and
 * links and is not decoded here.
 */
export async function stampFromImage(file: File, env: PictureEnv = browserPictureEnv): Promise<StampDef> {
  if (/svg/i.test(file.type) || /\.svg$/i.test(file.name)) throw new Error('SVG pictures are not supported; use a PNG or JPEG');
  if (!file.size) throw new Error('the file is empty');
  if (file.size > MAX_STAMP_IMAGE_BYTES) throw new Error(`the picture is over ${Math.round(MAX_STAMP_IMAGE_BYTES / MB)} MB`);
  // Its size from the header first: a small file can still hold a picture too big to decode.
  let dims = imageDimensions(new Uint8Array(await file.slice(0, 64 * 1024).arrayBuffer()));
  // A JPEG can hold a lot of metadata before its size: read further before giving up.
  if (!dims && file.size > 64 * 1024) {
    const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
    if (head[0] === 0xff && head[1] === 0xd8) dims = imageDimensions(new Uint8Array(await file.slice(0, 1024 * 1024).arrayBuffer()));
  }
  if (!dims || !(dims.width > 0) || !(dims.height > 0)) throw new Error('this is not a picture that can be read (PNG, JPEG, GIF, BMP or WebP)');
  if (dims.width * dims.height > MAX_STAMP_IMAGE_PIXELS) throw new Error(`the picture is too large (${dims.width} x ${dims.height} pixels)`);

  const first = STAMP_IMAGE_SIDES[0]!;
  let bitmap: PictureBitmap;
  try {
    // Scaled while it is decoded, so a big picture is never held at full size.
    bitmap = await env.decode(file, dims.width >= dims.height ? (dims.width > first ? { width: first } : {}) : dims.height > first ? { height: first } : {});
  } catch {
    throw new Error('this is not a picture that can be read (PNG, JPEG, GIF, BMP or WebP)');
  }
  try {
    let hasAlpha: boolean | null = null;
    for (const side of STAMP_IMAGE_SIDES) {
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
        // Read back premultiplied, so only whether any pixel is see-through is used, not its colour.
        const px = ctx.getImageData(0, 0, width, height).data;
        hasAlpha = false;
        for (let i = 3; i < px.length; i += 4) {
          if (px[i]! < 255) {
            hasAlpha = true;
            break;
          }
        }
      }
      const url = hasAlpha ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.9);
      if (url.length <= STAMP_IMAGE_BUDGET) return imageStamp(url, width, height, imageStampName(file.name), crypto.randomUUID());
    }
    throw new Error('the picture is too detailed to keep as a stamp; use a simpler or smaller one');
  } finally {
    bitmap.close();
  }
}

/** A stamp made only of a picture (not one with text on it, nor a text stamp). */
const isPictureStamp = (s: StampDef) => !!s.art && s.art.texts.length === 0;

/**
 * Adds picture stamps to a library. The last of each name in the batch wins; a stamp of the same
 * name is replaced only if it is itself a picture stamp, otherwise the new one is named "Name (2)".
 */
export function addPictureStamps(library: StampDef[], added: StampDef[]): { stamps: StampDef[]; added: StampDef[] } {
  const lastOfName = new Map<string, StampDef>();
  for (const s of added) lastOfName.set(s.name, s);
  const kept = [...lastOfName.values()];
  const stamps = library.filter((s) => !(isPictureStamp(s) && lastOfName.has(s.name)));
  const taken = new Set(stamps.map((s) => s.name));
  const result = kept.map((s) => {
    let name = s.name;
    for (let n = 2; taken.has(name); n++) name = `${s.name} (${n})`;
    taken.add(name);
    return name === s.name ? s : { ...s, name, lines: s.lines.map((l) => (l === s.name ? name : l)) };
  });
  return { stamps: [...stamps, ...result], added: result };
}

/**
 * Adds picture stamps through `update` (the workspace's updater, which says whether the change was
 * kept). When it was not, the library is put back exactly as it was, replaced stamps included.
 */
export function commitPictureStamps<W extends { stamps: StampDef[] }>(made: StampDef[], update: (fn: (w: W) => W) => boolean): { saved: boolean; added: StampDef[] } {
  let previous: StampDef[] | null = null;
  let result: ReturnType<typeof addPictureStamps> | null = null;
  const kept = update((w) => {
    previous = w.stamps;
    result = addPictureStamps(w.stamps, made);
    return { ...w, stamps: result.stamps };
  });
  if (kept && result) return { saved: true, added: (result as ReturnType<typeof addPictureStamps>).added };
  if (previous) {
    const stamps: StampDef[] = previous;
    update((w) => ({ ...w, stamps }));
  }
  return { saved: false, added: [] };
}
