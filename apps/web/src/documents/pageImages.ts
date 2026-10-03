import type { PdfDocument } from '@nb/pdf-core';

/** Most pixels one page image may have (about 60 MP); larger pages are rendered at a lower resolution. */
const MAX_PIXELS = 60_000_000;

export interface PageImageOptions {
  /** Dots per inch (72 = one pixel per point). */
  dpi: number;
  format: 'png' | 'jpeg';
  /** JPEG quality, 0..1. */
  quality?: number;
  /** Draws a page's markups over it (page space, `zoom` pixels per point); omit for the drawing alone. */
  drawMarkups?: (ctx: OffscreenCanvasRenderingContext2D, pageIndex: number, zoom: number) => void;
  /** Called after each page, for progress. */
  onPage?: (done: number, total: number) => void;
}

/** Renders pages to PNG or JPEG images, with their markups if asked. */
export async function renderPageImages(doc: PdfDocument, pages: readonly number[], options: PageImageOptions): Promise<Uint8Array[]> {
  const out: Uint8Array[] = [];
  for (const [n, pageIndex] of pages.entries()) {
    const size = doc.pages[pageIndex];
    if (!size) continue;
    let scale = options.dpi / 72;
    if (size.width * size.height * scale * scale > MAX_PIXELS) scale = Math.sqrt(MAX_PIXELS / (size.width * size.height));
    const w = Math.max(1, Math.round(size.width * scale));
    const h = Math.max(1, Math.round(size.height * scale));
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    // Rendered in strips, so very large sheets stay within the renderer's limits.
    const strip = Math.max(256, Math.floor(16_000_000 / w));
    for (let y = 0; y < h; y += strip) {
      const { bitmap } = await doc.renderTile(pageIndex, scale, 0, y, w, Math.min(strip, h - y));
      ctx.drawImage(bitmap, 0, y);
      bitmap.close();
    }
    if (options.drawMarkups) {
      ctx.save();
      ctx.scale(scale, scale);
      options.drawMarkups(ctx, pageIndex, scale);
      ctx.restore();
    }
    const blob = await canvas.convertToBlob(options.format === 'png' ? { type: 'image/png' } : { type: 'image/jpeg', quality: options.quality ?? 0.9 });
    out.push(new Uint8Array(await blob.arrayBuffer()));
    options.onPage?.(n + 1, pages.length);
  }
  return out;
}
