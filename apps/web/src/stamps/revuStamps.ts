import { PdfEngine } from '@nb/pdf-core';
import { artStamp, parseStampPdf, textStamp, type ParsedStamp, type StampDef } from '@nb/markup';
import { updateWorkspace } from '../workspace/profiles';

/** `EuropeanDateTime.pdf` → `European Date Time`. */
const humanName = (file: string) =>
  file
    .replace(/\.pdf$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim();

/** Stamp artwork is drawn this many pixels to the point: sharp when placed large. */
const ART_SCALE = 4;

/**
 * The stamp's artwork as a PNG data URL on a transparent background: its page with the text boxes
 * hidden (they are drawn live), cut to the stamp's box. Null when nothing is left to draw.
 */
async function renderArtwork(bytes: ArrayBuffer, p: ParsedStamp): Promise<string | null> {
  const engine = new PdfEngine();
  try {
    const doc = await engine.open(bytes);
    try {
      const page = doc.pages[0];
      if (!page) return null;
      await doc.hideAnnotations(0, p.texts.map((t) => t.annot));
      const x = Math.floor(p.box.x * ART_SCALE);
      const y = Math.floor((page.height - p.box.y - p.box.h) * ART_SCALE);
      const w = Math.max(1, Math.ceil(p.box.w * ART_SCALE));
      const h = Math.max(1, Math.ceil(p.box.h * ART_SCALE));
      const { bitmap } = await doc.renderTile(0, ART_SCALE, x, y, w, h, { transparent: true });
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close?.();
      const alpha = ctx.getImageData(0, 0, w, h).data;
      for (let i = 3; i < alpha.length; i += 4) if (alpha[i]) return canvas.toDataURL('image/png');
      return null;
    } finally {
      await doc.close().catch(() => {});
    }
  } finally {
    engine.terminate();
  }
}

/** One Revu stamp PDF as a stamp of ours: editable text where it is only text, else a picture with live text. */
export async function stampFromPdf(bytes: ArrayBuffer, fileName: string): Promise<StampDef> {
  const parsed = await parseStampPdf(bytes, humanName(fileName));
  parsed.name = humanName(fileName) || parsed.name;
  if (!parsed.texts.length && !parsed.hasArtwork) throw new Error('nothing on its page to use as a stamp');
  const id = crypto.randomUUID();
  if (parsed.hasArtwork) {
    const image = await renderArtwork(bytes.slice(0), parsed);
    if (image) return artStamp(parsed, image, id);
  }
  if (!parsed.texts.length) throw new Error('nothing on its page to use as a stamp');
  return textStamp(parsed, id);
}

/**
 * Imports Revu stamps (the PDFs in its Stamps folder) into the active profile's library. A stamp
 * imported again replaces the one of the same name. Returns what was added and what failed.
 */
export async function importRevuStamps(files: File[]): Promise<{ added: StampDef[]; failed: string[] }> {
  const added: StampDef[] = [];
  const failed: string[] = [];
  for (const f of files) {
    try {
      added.push(await stampFromPdf(await f.arrayBuffer(), f.name));
    } catch (err) {
      failed.push(`${f.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (added.length) {
    updateWorkspace((w) => ({ ...w, stamps: [...w.stamps.filter((s) => !added.some((a) => a.name === s.name)), ...added] }));
  }
  return { added, failed };
}
