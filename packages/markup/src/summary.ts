import { PDFDocument, PDFFont, PDFPage, rgb, StandardFonts } from 'pdf-lib';

/**
 * Markup summaries: a table of markups (the list's columns) as
 * PDF pages, on its own or appended to the end of the marked-up document.
 */

export interface SummaryColumn {
  label: string;
  /** Relative width (the list's pixel width); columns are scaled to fit the page. */
  width: number;
  align?: 'right';
}

export interface SummaryRow {
  cells: string[];
  /** Markup colour, shown as a swatch in the first column. */
  color?: string;
}

export interface SummaryOptions {
  title: string;
  subtitle?: string;
  columns: SummaryColumn[];
  rows: SummaryRow[];
  /** Short text lines shown under the table (e.g. takeoff totals). */
  totals?: string[];
}

const PAGE = { w: 792, h: 612 }; // US Letter, landscape
const MARGIN = 36;
const FONT_SIZE = 8;
const LINE = 10;
const PAD = 3;
const HEADER_H = 18;

function hex(color: string) {
  const n = parseInt(color.replace('#', '').padEnd(6, '0').slice(0, 6), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/** Replaces characters the standard fonts cannot encode. */
function safe(font: PDFFont, s: string): string {
  const supported = new Set(font.getCharacterSet());
  return [...s.replace(/\t/g, ' ')].map((ch) => (ch === '\n' || supported.has(ch.codePointAt(0)!) ? ch : '?')).join('');
}

/** Word-wraps `text` to `width` points, breaking words that do not fit on their own. */
function wrap(font: PDFFont, text: string, width: number, size: number): string[] {
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/(\s+)/)) {
      if (!word) continue;
      const next = line + word;
      if (font.widthOfTextAtSize(next.trimEnd(), size) <= width) {
        line = next;
        continue;
      }
      if (line.trim()) lines.push(line.trimEnd());
      line = word.trimStart();
      while (font.widthOfTextAtSize(line, size) > width && line.length > 1) {
        let cut = line.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(line.slice(0, cut), size) > width) cut--;
        lines.push(line.slice(0, cut));
        line = line.slice(cut);
      }
    }
    lines.push(line.trimEnd());
  }
  return lines.length ? lines : [''];
}

/** Adds summary pages to the end of `doc`. */
export async function appendSummary(doc: PDFDocument, opts: SummaryOptions): Promise<void> {
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const usable = PAGE.w - MARGIN * 2;
  const total = opts.columns.reduce((s, c) => s + Math.max(c.width, 1), 0) || 1;
  const widths = opts.columns.map((c) => (Math.max(c.width, 1) / total) * usable);
  const first = doc.getPageCount();
  const muted = rgb(0.4, 0.42, 0.45);
  const border = rgb(0.8, 0.82, 0.85);

  let page: PDFPage;
  let y = 0;

  const drawHeaderRow = () => {
    page.drawRectangle({ x: MARGIN, y: y - HEADER_H, width: usable, height: HEADER_H, color: rgb(0.16, 0.2, 0.28) });
    let x = MARGIN;
    opts.columns.forEach((c, i) => {
      const label = safe(bold, c.label);
      const lines = wrap(bold, label, widths[i]! - PAD * 2, FONT_SIZE);
      const text = lines[0] ?? '';
      const tw = bold.widthOfTextAtSize(text, FONT_SIZE);
      page.drawText(text, { x: c.align === 'right' ? x + widths[i]! - PAD - tw : x + PAD, y: y - HEADER_H + 6, size: FONT_SIZE, font: bold, color: rgb(1, 1, 1) });
      x += widths[i]!;
    });
    y -= HEADER_H;
  };

  const newPage = (withTitle: boolean) => {
    page = doc.addPage([PAGE.w, PAGE.h]);
    y = PAGE.h - MARGIN;
    if (withTitle) {
      page.drawText(safe(bold, opts.title), { x: MARGIN, y: y - 14, size: 16, font: bold, color: rgb(0.1, 0.1, 0.12) });
      y -= 22;
      if (opts.subtitle) {
        page.drawText(safe(font, opts.subtitle), { x: MARGIN, y: y - 9, size: 9, font, color: muted });
        y -= 14;
      }
      page.drawLine({ start: { x: MARGIN, y: y - 2 }, end: { x: PAGE.w - MARGIN, y: y - 2 }, thickness: 1, color: rgb(0.23, 0.51, 0.96) });
      y -= 10;
    }
    drawHeaderRow();
  };

  newPage(true);
  opts.rows.forEach((row, r) => {
    const cellLines = row.cells.map((text, i) => wrap(font, safe(font, text), widths[i]! - PAD * 2 - (i === 0 && row.color ? 9 : 0), FONT_SIZE));
    const h = Math.max(...cellLines.map((l) => l.length)) * LINE + PAD * 2;
    if (y - h < MARGIN + 14) newPage(false);
    if (r % 2) page.drawRectangle({ x: MARGIN, y: y - h, width: usable, height: h, color: rgb(0.96, 0.97, 0.98) });
    let x = MARGIN;
    cellLines.forEach((lines, i) => {
      let tx = x + PAD;
      if (i === 0 && row.color) {
        page.drawRectangle({ x: tx, y: y - PAD - 7, width: 6, height: 6, color: hex(row.color) });
        tx += 9;
      }
      lines.forEach((line, li) => {
        const lx = opts.columns[i]?.align === 'right' ? x + widths[i]! - PAD - font.widthOfTextAtSize(line, FONT_SIZE) : tx;
        page.drawText(line, { x: lx, y: y - PAD - (li + 1) * LINE + 2.5, size: FONT_SIZE, font, color: rgb(0.1, 0.1, 0.12) });
      });
      x += widths[i]!;
    });
    page.drawLine({ start: { x: MARGIN, y: y - h }, end: { x: PAGE.w - MARGIN, y: y - h }, thickness: 0.5, color: border });
    y -= h;
  });
  if (!opts.rows.length) {
    page!.drawText('No markups.', { x: MARGIN + PAD, y: y - 14, size: 9, font, color: muted });
    y -= 20;
  }
  for (const t of opts.totals ?? []) {
    if (y - 14 < MARGIN + 14) newPage(false);
    page!.drawText(safe(bold, t), { x: MARGIN, y: y - 14, size: 9, font: bold, color: rgb(0.1, 0.1, 0.12) });
    y -= 14;
  }

  const count = doc.getPageCount() - first;
  for (let i = 0; i < count; i++) {
    const p = doc.getPage(first + i);
    const text = `${safe(font, opts.title)} — markup summary page ${i + 1} of ${count}`;
    p.drawText(text, { x: PAGE.w - MARGIN - font.widthOfTextAtSize(text, 7.5), y: MARGIN - 18, size: 7.5, font, color: muted });
  }
}

/** A summary as a PDF of its own, or appended to `base` (e.g. the document exported with its markups). */
export async function summaryPdf(opts: SummaryOptions, base?: ArrayBuffer | Uint8Array): Promise<Uint8Array> {
  const doc = base ? await PDFDocument.load(base, { updateMetadata: false }) : await PDFDocument.create();
  if (!base) doc.setTitle(`${opts.title} — Markup Summary`);
  await appendSummary(doc, opts);
  return doc.save();
}
