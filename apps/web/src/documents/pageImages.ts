import type { PdfDocument } from '@nb/pdf-core';
import { convertColourspace, type Colourspace } from './imagePdf';
import { TiffBuilder, type TiffCompression } from './tiff';

/** Most pixels one page image may have (about 60 MP); larger pages are rendered at a lower resolution. */
const MAX_PIXELS = 60_000_000;

export interface PageImageOptions {
  /** Dots per inch (72 = one pixel per point). */
  dpi: number;
  format: 'png' | 'jpeg' | 'tiff';
  /** Pictures turned grey or black and white; colour or auto keep them as rendered. */
  colour?: Colourspace;
  /** TIFF: its compression, and whether every page goes into one file. */
  tiff?: { compression: TiffCompression; multiPage: boolean };
  /** JPEG quality, 0..1. */
  quality?: number;
  /** Draws a page's markups over it (page space, `zoom` pixels per point); omit for the drawing alone. */
  drawMarkups?: (ctx: OffscreenCanvasRenderingContext2D, pageIndex: number, zoom: number) => void;
  /** Called after each page, for progress. */
  onPage?: (done: number, total: number) => void;
}

/**
 * Renders pages to PNG, JPEG or TIFF images, with their markups if asked. A multi-page TIFF is
 * one file for all the pages; otherwise there is one image per page.
 */
export async function renderPageImages(doc: PdfDocument, pages: readonly number[], options: PageImageOptions): Promise<Uint8Array[]> {
  const out: Uint8Array[] = [];
  const colour = options.colour ?? 'auto';
  const tiffOptions = { compression: options.tiff?.compression ?? 'lzw', colour: colour === 'grey' || colour === 'mono' ? colour : 'colour', dpi: options.dpi } as const;
  const multi = options.format === 'tiff' && options.tiff?.multiPage ? new TiffBuilder(tiffOptions) : null;
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
    if (options.format === 'tiff') {
      const page = { width: w, height: h, rgba: ctx.getImageData(0, 0, w, h).data };
      if (multi) multi.add(page);
      else {
        const one = new TiffBuilder(tiffOptions);
        one.add(page);
        out.push(one.result());
      }
    } else {
      if (colour === 'grey' || colour === 'mono') {
        const px = ctx.getImageData(0, 0, w, h);
        convertColourspace(px.data, colour);
        ctx.putImageData(px, 0, 0);
      }
      const blob = await canvas.convertToBlob(options.format === 'png' ? { type: 'image/png' } : { type: 'image/jpeg', quality: options.quality ?? 0.9 });
      out.push(new Uint8Array(await blob.arrayBuffer()));
    }
    options.onPage?.(n + 1, pages.length);
  }
  if (multi?.count) out.push(multi.result());
  return out;
}

/** A page's name from a pattern like "Page 001": its last number is replaced by `n`, padded to as many digits. */
export function pageNumberLabel(pattern: string, n: number): string {
  const m = /\d+(?!.*\d)/.exec(pattern);
  if (!m) return `${pattern.trim() || 'Page'} ${n}`;
  return pattern.slice(0, m.index) + String(n).padStart(m[0].length, '0') + pattern.slice(m.index + m[0].length);
}
