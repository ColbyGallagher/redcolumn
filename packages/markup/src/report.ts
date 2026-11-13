import { PDFDocument, PDFFont, PDFPage, rgb, StandardFonts } from 'pdf-lib';
import { safe, wrap } from './summary';

/**
 * Takeoff reports as data (a `ReportTable`) and as PDF pages. The tables are built by the app from
 * the measurements; this file only knows how to show them: group headings, subtotal and grand-total
 * lines, right-aligned numbers and "Page x of y".
 */

/** How a column's numbers read: a quantity, an amount of money, a percentage, or plain text. */
export type ReportFormat = 'text' | 'qty' | 'money' | 'pct';

export interface ReportColumn {
  key: string;
  label: string;
  align: 'left' | 'right';
  format: ReportFormat;
}

export type ReportCell = string | number | null;
export type ReportRow = Record<string, ReportCell>;

export interface ReportGroup {
  heading?: string;
  rows: ReportRow[];
  subtotal?: ReportRow;
}

export interface ReportTable {
  title: string;
  columns: ReportColumn[];
  groups: ReportGroup[];
  grandTotal?: ReportRow;
  /** Short lines under the table (e.g. that quantities in different units are not added). */
  notes?: string[];
}

const group3 = (s: string) => s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** A cell as shown on paper: quantities to 2 places, money to cents, percentages to 1, all grouped by thousands. */
export function formatCell(col: Pick<ReportColumn, 'format'>, v: ReportCell | undefined): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (!Number.isFinite(v)) return '';
  const fixed = (n: number, d: number) => {
    const [i, f] = Math.abs(n).toFixed(d).split('.');
    const neg = n < 0 && Number(Math.abs(n).toFixed(d)) !== 0;
    return `${neg ? '-' : ''}${group3(i!)}${f ? `.${f}` : ''}`;
  };
  if (col.format === 'money') return fixed(v, 2);
  if (col.format === 'pct') return `${fixed(v, 1).replace(/\.0$/, '')}%`;
  if (col.format === 'qty') return fixed(v, 2);
  return String(v);
}

export interface ReportPdfOptions {
  /** The document or project the figures are from. */
  project: string;
  /** Shown in the header, e.g. "2026-03-12". */
  date: string;
  /** What the figures cover, e.g. "All pages" or "Page A-101". */
  scope: string;
  /** Set when the pages measured use different scales. */
  scaleNote?: string;
  paper: 'a4' | 'letter';
  reports: ReportTable[];
}

const PAPER = { a4: { w: 841.89, h: 595.28 }, letter: { w: 792, h: 612 } } as const;
const MARGIN = 36;
const FONT = 8;
const LINE = 10;
const PAD = 3;
const INK = rgb(0.1, 0.1, 0.12);
const MUTED = rgb(0.4, 0.42, 0.45);

/** Column widths: by the longest entry in each column (capped), scaled to the page. */
function columnWidths(table: ReportTable, usable: number): number[] {
  const rows = table.groups.flatMap((g) => [...g.rows, ...(g.subtotal ? [g.subtotal] : [])]).concat(table.grandTotal ? [table.grandTotal] : []);
  const weights = table.columns.map((c) => {
    const longest = rows.slice(0, 300).reduce((n, r) => Math.max(n, formatCell(c, r[c.key]).length), 0);
    const head = c.label.split(/\s+/).reduce((n, w) => Math.max(n, w.length), 0);
    const cap = c.format === 'text' ? 38 : 14;
    return Math.max(5, head, Math.min(cap, longest)) + 2;
  });
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  return weights.map((w) => (w / total) * usable);
}

/** Draws the reports as PDF pages: each report starts a new page, and pages are numbered across the whole file. */
export async function reportPdf(opts: ReportPdfOptions): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${opts.project} - takeoff reports`);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const paper = PAPER[opts.paper];
  const usable = paper.w - MARGIN * 2;
  const reports: ReportTable[] = opts.reports.length ? opts.reports : [{ title: 'Takeoff report', columns: [], groups: [] }];

  for (const table of reports) {
    const widths = columnWidths(table, usable);
    let page!: PDFPage;
    let y = 0;

    const text = (s: string, x: number, size: number, f: PDFFont, ty: number, color = INK, right = false, width = 0) => {
      const t = safe(f, s);
      const w = f.widthOfTextAtSize(t, size);
      page.drawText(t, { x: right ? x + width - w : x, y: ty, size, font: f, color });
    };

    const header = () => {
      page = doc.addPage([paper.w, paper.h]);
      y = paper.h - MARGIN;
      text(opts.project, MARGIN, 11, bold, y - 10);
      const dateW = font.widthOfTextAtSize(safe(font, opts.date), 9);
      text(opts.date, paper.w - MARGIN - dateW, 9, font, y - 10, MUTED);
      y -= 18;
      text(table.title, MARGIN, 16, bold, y - 14);
      y -= 22;
      text(`Scope: ${opts.scope}`, MARGIN, 9, font, y - 9, MUTED);
      y -= 12;
      if (opts.scaleNote) {
        for (const l of wrap(font, safe(font, opts.scaleNote), usable, 8)) {
          text(l, MARGIN, 8, font, y - 8, MUTED);
          y -= 10;
        }
      }
      page.drawLine({ start: { x: MARGIN, y: y - 2 }, end: { x: paper.w - MARGIN, y: y - 2 }, thickness: 1, color: rgb(0.23, 0.51, 0.96) });
      y -= 8;
    };

    const columnHeader = () => {
      const lines = table.columns.map((c, i) => wrap(bold, safe(bold, c.label), widths[i]! - PAD * 2, FONT));
      const h = Math.max(1, ...lines.map((l) => l.length)) * LINE + PAD * 2;
      page.drawRectangle({ x: MARGIN, y: y - h, width: usable, height: h, color: rgb(0.16, 0.2, 0.28) });
      let x = MARGIN;
      lines.forEach((ls, i) => {
        ls.forEach((l, li) => text(l, x + PAD, FONT, bold, y - PAD - (li + 1) * LINE + 2.5, rgb(1, 1, 1), table.columns[i]!.align === 'right', widths[i]! - PAD * 2));
        x += widths[i]!;
      });
      y -= h;
    };

    const room = (h: number) => {
      if (y - h < MARGIN + 16) {
        header();
        columnHeader();
      }
    };

    const drawRow = (row: ReportRow, style: 'row' | 'subtotal' | 'total', shade: boolean) => {
      const f = style === 'row' ? font : bold;
      const cells = table.columns.map((c, i) => wrap(f, safe(f, formatCell(c, row[c.key])), widths[i]! - PAD * 2, FONT));
      const h = Math.max(1, ...cells.map((l) => l.length)) * LINE + PAD * 2;
      room(h);
      if (style === 'total') page.drawRectangle({ x: MARGIN, y: y - h, width: usable, height: h, color: rgb(0.9, 0.93, 0.98) });
      else if (shade) page.drawRectangle({ x: MARGIN, y: y - h, width: usable, height: h, color: rgb(0.96, 0.97, 0.98) });
      let x = MARGIN;
      cells.forEach((ls, i) => {
        ls.forEach((l, li) => text(l, x + PAD, FONT, f, y - PAD - (li + 1) * LINE + 2.5, INK, table.columns[i]!.align === 'right', widths[i]! - PAD * 2));
        x += widths[i]!;
      });
      const heavy = style !== 'row';
      page.drawLine({ start: { x: MARGIN, y: y - h }, end: { x: paper.w - MARGIN, y: y - h }, thickness: heavy ? 0.9 : 0.4, color: heavy ? MUTED : rgb(0.8, 0.82, 0.85) });
      y -= h;
    };

    header();
    columnHeader();
    for (const g of table.groups) {
      if (g.heading) {
        // A heading never sits alone at the foot of a page: it needs a row under it.
        room(LINE * 2 + PAD * 4);
        page.drawRectangle({ x: MARGIN, y: y - LINE - PAD * 2, width: usable, height: LINE + PAD * 2, color: rgb(0.85, 0.88, 0.93) });
        text(g.heading, MARGIN + PAD, 8.5, bold, y - PAD - LINE + 2.5);
        y -= LINE + PAD * 2;
      }
      g.rows.forEach((r, i) => drawRow(r, 'row', i % 2 === 1));
      if (g.subtotal) drawRow(g.subtotal, 'subtotal', false);
    }
    if (!table.groups.some((g) => g.rows.length)) {
      room(20);
      text('Nothing to report for this scope.', MARGIN + PAD, 9, font, y - 14, MUTED);
      y -= 20;
    }
    if (table.grandTotal) {
      y -= 4;
      drawRow(table.grandTotal, 'total', false);
    }
    for (const note of table.notes ?? []) {
      for (const l of wrap(font, safe(font, note), usable, 8)) {
        room(12);
        text(l, MARGIN, 8, font, y - 12, MUTED);
        y -= 11;
      }
    }
  }

  const count = doc.getPageCount();
  for (let i = 0; i < count; i++) {
    const t = `Page ${i + 1} of ${count}`;
    const p = doc.getPage(i);
    p.drawText(t, { x: paper.w - MARGIN - font.widthOfTextAtSize(t, 8), y: MARGIN - 18, size: 8, font, color: MUTED });
    p.drawText(safe(font, opts.project), { x: MARGIN, y: MARGIN - 18, size: 8, font, color: MUTED });
  }
  return doc.save();
}
