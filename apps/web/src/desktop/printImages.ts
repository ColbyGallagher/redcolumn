import { PdfEngine } from '@nb/pdf-core';
import type { RedcolumnDesktop } from './host';
import { ownedBytes } from './tokens';

/** Fine linework needs more than screen resolution. */
const TARGET_DPI = 200;
const MIN_DPI = 96;
/** Pixels per page, so a large sheet stays within memory and canvas limits (about ARCH E1 at 150 dpi). */
const MAX_PIXELS = 30_000_000;

/** Resolution for one page: the target, lowered for sheets too large to draw at it. */
export function printScale(widthPt: number, heightPt: number): number {
  const target = TARGET_DPI / 72;
  const pixels = widthPt * target * heightPt * target;
  const fit = pixels > MAX_PIXELS ? target * Math.sqrt(MAX_PIXELS / pixels) : target;
  return Math.max(MIN_DPI / 72, fit);
}

/**
 * Draws each page and has the main process print the pages. Used when the PDF viewer prints
 * blank. Pages go across one at a time as PNG (lossless, which keeps thin lines and small text),
 * so a long set never sits in memory all at once.
 */
export async function printPdfAsImages(bytes: Uint8Array, host: RedcolumnDesktop): Promise<void> {
  const engine = new PdfEngine();
  let job: string | null = null;
  try {
    const copy = ownedBytes(bytes);
    const doc = await engine.open(copy.buffer);
    try {
      job = await host.beginPrint();
      for (let i = 0; i < doc.pages.length; i++) {
        const page = doc.pages[i];
        if (!page) continue;
        const scale = printScale(page.width, page.height);
        const width = Math.max(1, Math.round(page.width * scale));
        const height = Math.max(1, Math.round(page.height * scale));
        const { bitmap } = await doc.renderTile(i, scale, 0, 0, width, height);
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Could not draw the page.');
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();
        const blob = await canvas.convertToBlob({ type: 'image/png' });
        await host.addPrintPage(job, new Uint8Array(await blob.arrayBuffer()), 'image/png', page.width, page.height);
      }
    } finally {
      await doc.close();
    }
    const finished = job;
    job = null;
    await host.finishPrint(finished);
  } finally {
    if (job) await host.cancelPrint(job).catch(() => undefined);
    engine.terminate();
  }
}
