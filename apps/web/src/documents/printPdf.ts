import { PDFArray, PDFDict, PDFDocument, PDFName, StandardFonts, rgb } from 'pdf-lib';
import { flattenAnnotations } from './process';

/** What File › Print puts on paper: the drawing with markups, the drawing alone, or markups alone. */
export type PrintContent = 'all' | 'document' | 'markups';

/**
 * Pages from a range such as "1-3, 5, 8-" (1-based, in document order, no repeats), or null when
 * the text is not a valid range for `count` pages. Empty text means every page.
 */
export function parsePageRange(text: string, count: number): number[] | null {
  const t = text.trim();
  if (!t) return Array.from({ length: count }, (_, i) => i);
  const pages = new Set<number>();
  for (const part of t.split(/[,;\s]+/).filter(Boolean)) {
    const m = /^(\d*)(?:\s*(-)\s*(\d*))?$/.exec(part);
    if (!m || (!m[1] && !m[3])) return null;
    const from = m[1] ? Number(m[1]) : 1;
    const to = m[2] ? (m[3] ? Number(m[3]) : count) : from;
    if (from < 1 || to > count || from > to) return null;
    for (let p = from; p <= to; p++) pages.add(p - 1);
  }
  return [...pages].sort((a, b) => a - b);
}

/**
 * A PDF to print. `bytes` is the document with its markups written as annotations (for `all` and
 * `markups`), or the original file (for `document`). Only `pages` are kept.
 */
/** Paper sizes for tiling, in points (portrait). */
export const PAPER_SIZES: Record<string, [number, number]> = {
  Letter: [612, 792],
  Legal: [612, 1008],
  Tabloid: [792, 1224],
  A4: [595, 842],
  A3: [842, 1191],
};

export interface PrintOptions {
  /** Last page first. */
  reverse?: boolean;
  /**
   * Tile Large Pages: pages bigger than this paper are split across several sheets, overlapping
   * by `overlap` points, each labelled with its place in the grid.
   */
  tile?: { width: number; height: number; overlap: number } | null;
}

/**
 * Splits pages larger than the paper into tiles. Markups are flattened first (tiles are drawn from
 * the page's content), then each large page becomes a grid of paper-sized pages.
 */
async function tilePages(bytes: Uint8Array, tile: NonNullable<PrintOptions['tile']>): Promise<Uint8Array> {
  const flat = (await flattenAnnotations(bytes, null)).bytes;
  const src = await PDFDocument.load(flat, { updateMetadata: false });
  const out = await PDFDocument.create();
  const font = await out.embedFont(StandardFonts.Helvetica);
  for (const [i, page] of src.getPages().entries()) {
    const { width: W, height: H } = page.getSize();
    const [pw0, ph0] = [tile.width, tile.height];
    // Paper turned to match the page.
    const [pw, ph] = W > H === pw0 > ph0 ? [pw0, ph0] : [ph0, pw0];
    // A page with nothing drawn on it still needs a content stream to embed.
    if (!page.node.Contents()) page.node.set(PDFName.of('Contents'), src.context.register(src.context.flateStream('')));
    const embedded = await out.embedPage(page);
    if (W <= pw + 0.5 && H <= ph + 0.5) {
      out.addPage([W, H]).drawPage(embedded);
      continue;
    }
    const o = Math.min(tile.overlap, pw / 4, ph / 4);
    const cols = Math.max(1, Math.ceil((W - o) / (pw - o)));
    const rows = Math.max(1, Math.ceil((H - o) / (ph - o)));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const sheet = out.addPage([pw, ph]);
        // Tile (row r from the top, column c from the left) shows the page shifted under the paper.
        const x = c * (pw - o);
        const yTop = r * (ph - o);
        sheet.drawPage(embedded, { x: -x, y: -(H - yTop - ph) });
        const label = `Page ${i + 1} · tile ${String.fromCharCode(65 + r)}${c + 1} of ${rows}×${cols}`;
        sheet.drawRectangle({ x: 4, y: 4, width: font.widthOfTextAtSize(label, 7) + 6, height: 11, color: rgb(1, 1, 1), opacity: 0.8 });
        sheet.drawText(label, { x: 7, y: 7, size: 7, font, color: rgb(0.3, 0.3, 0.3) });
      }
    }
  }
  return out.save();
}

export async function printablePdf(bytes: ArrayBuffer | Uint8Array, content: PrintContent, pages: readonly number[], options: PrintOptions = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const all = doc.getPages();
  for (const page of all) {
    if (content === 'document') {
      // Drop markups (the file's own included) but keep form fields, which are part of the document.
      const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
      if (annots) {
        for (let i = annots.size() - 1; i >= 0; i--) {
          const a = annots.lookupMaybe(i, PDFDict);
          if (a?.get(PDFName.of('Subtype')) !== PDFName.of('Widget')) annots.remove(i);
        }
      }
    } else if (content === 'markups') {
      // Blank the drawing; annotation appearances carry their own resources.
      page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.flateStream('')));
    }
  }
  const keep = new Set(pages);
  for (let i = all.length - 1; i >= 0; i--) if (!keep.has(i)) doc.removePage(i);
  if (options.reverse) {
    const count = doc.getPageCount();
    // Move each page to the front in turn: the last ends up first.
    for (let i = 1; i < count; i++) {
      const page = doc.getPage(i);
      doc.removePage(i);
      doc.insertPage(0, page);
    }
  }
  const saved = await doc.save();
  return options.tile ? tilePages(saved, options.tile) : saved;
}

/**
 * Opens the browser's print dialog for a PDF, from a hidden frame so the page stays as it is.
 * Falls back to a new tab where the browser cannot print a PDF inside a frame.
 */
export function printPdfBytes(bytes: Uint8Array): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  frame.src = url;
  const cleanup = () => {
    frame.remove();
    URL.revokeObjectURL(url);
  };
  frame.onload = () => {
    try {
      frame.contentWindow!.focus();
      frame.contentWindow!.print();
      // The print dialog blocks in most browsers; leave time for those where it does not.
      setTimeout(cleanup, 60_000);
    } catch {
      cleanup();
      window.open(URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' })), '_blank', 'noopener');
    }
  };
  document.body.appendChild(frame);
}
