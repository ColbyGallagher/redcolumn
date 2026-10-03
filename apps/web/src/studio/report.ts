import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { Markup } from '@nb/markup';
import type { RecordEntry, SessionMeta } from './protocol';

/** A session document's markups, for the report. */
export interface ReportDocument {
  name: string;
  markups: readonly Markup[];
  /** What a markup is called in the report (e.g. "Cloud", "Area 12.5 m²"). */
  describe: (m: Markup) => string;
  /** A page's name (sheet number, else "Page 3"). */
  pageLabel: (pageIndex: number) => string;
}

const A4: [number, number] = [595, 842];
const MARGIN = 48;

/** Lays text out top to bottom, starting new pages as needed. */
class Writer {
  private page!: PDFPage;
  private y = 0;
  private doc: PDFDocument;
  private font: PDFFont;
  private bold: PDFFont;
  private footer: string;
  constructor(doc: PDFDocument, font: PDFFont, bold: PDFFont, footer: string) {
    this.doc = doc;
    this.font = font;
    this.bold = bold;
    this.footer = footer;
    this.newPage();
  }

  private newPage() {
    this.page = this.doc.addPage(A4);
    this.y = A4[1] - MARGIN;
    const n = this.doc.getPageCount();
    this.page.drawText(`${this.footer} · page ${n}`, { x: MARGIN, y: 24, size: 8, font: this.font, color: rgb(0.45, 0.45, 0.45) });
  }

  private ensure(h: number) {
    if (this.y - h < MARGIN) this.newPage();
  }

  /** Characters the standard font can draw. */
  private clean(s: string) {
    return [...s.replace(/[\r\n\t]+/g, ' ')].map((c) => (c.charCodeAt(0) < 256 ? c : c === '’' || c === '‘' ? "'" : c === '“' || c === '”' ? '"' : c === '–' || c === '—' ? '-' : c === '…' ? '...' : c === '²' ? '2' : '?')).join('');
  }

  /** Splits text into lines that fit `width`. */
  private wrap(text: string, size: number, width: number, font = this.font): string[] {
    const words = this.clean(text).split(' ');
    const lines: string[] = [];
    let line = '';
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(next, size) <= width || !line) line = next;
      else {
        lines.push(line);
        line = w;
      }
    }
    if (line) lines.push(line);
    // A single word longer than the width is cut.
    return lines.map((l) => {
      let t = l;
      while (t.length > 1 && font.widthOfTextAtSize(t, size) > width) t = t.slice(0, -1);
      return t;
    });
  }

  heading(text: string, size = 14) {
    this.ensure(size * 2.2);
    this.y -= size * 0.6;
    this.page.drawText(this.clean(text), { x: MARGIN, y: this.y - size, size, font: this.bold });
    this.y -= size * 1.6;
  }

  text(text: string, size = 10, color = rgb(0, 0, 0)) {
    for (const line of this.wrap(text, size, A4[0] - MARGIN * 2)) {
      this.ensure(size * 1.35);
      this.page.drawText(line, { x: MARGIN, y: this.y - size, size, font: this.font, color });
      this.y -= size * 1.35;
    }
  }

  /** A table: column widths as fractions of the page width; the header row repeats on new pages. */
  table(columns: { label: string; width: number }[], rows: string[][], size = 8.5) {
    const total = A4[0] - MARGIN * 2;
    const xs: number[] = [];
    let x = MARGIN;
    for (const c of columns) {
      xs.push(x);
      x += c.width * total;
    }
    const drawRow = (cells: string[], font: PDFFont, shade: boolean) => {
      const wrapped = cells.map((c, i) => this.wrap(c, size, columns[i]!.width * total - 4, font));
      const h = Math.max(1, ...wrapped.map((w) => w.length)) * size * 1.3 + 3;
      if (this.y - h < MARGIN) {
        this.newPage();
        if (font !== this.bold) drawRow(columns.map((c) => c.label), this.bold, true);
      }
      if (shade) this.page.drawRectangle({ x: MARGIN, y: this.y - h, width: total, height: h, color: rgb(0.93, 0.94, 0.96) });
      wrapped.forEach((lines, i) => lines.forEach((l, k) => this.page.drawText(l, { x: xs[i]! + 2, y: this.y - 2 - size * (k + 1) * 1.3 + size * 0.3, size, font })));
      this.y -= h;
    };
    this.ensure(size * 4);
    drawRow(columns.map((c) => c.label), this.bold, true);
    for (const r of rows) drawRow(r, this.font, false);
    this.y -= 6;
  }
}

const when = (t: number | null | undefined) => (t ? new Date(t).toLocaleString() : '');

/**
 * Session Report: what the session was (name, host, dates), who took part, its documents and
 * every markup in them, and the Record (chat and everything that happened), as a PDF.
 */
export async function sessionReportPdf(meta: SessionMeta, record: readonly RecordEntry[], documents: readonly ReportDocument[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${meta.name} — Session Report`);
  doc.setCreator('redcolumn');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const w = new Writer(doc, font, bold, `${meta.name} · Session Report`);

  w.heading(`${meta.name} — Session Report`, 18);
  w.text(`Session ${meta.id} · hosted by ${meta.host}`);
  w.text(`Started ${when(meta.createdAt)}${meta.status === 'finished' ? ` · finished ${when(meta.endedAt)}` : meta.expiresAt ? ` · ends ${when(meta.expiresAt)}` : ' · still active'}`);
  w.text(`Report made ${new Date().toLocaleString()}`, 9, rgb(0.4, 0.4, 0.4));

  w.heading('Attendees');
  w.table(
    [
      { label: 'Name', width: 0.3 },
      { label: 'Email', width: 0.3 },
      { label: 'First joined', width: 0.2 },
      { label: 'Last seen', width: 0.2 },
    ],
    meta.attendees.map((a) => [a.name + (a.name === meta.host ? ' (host)' : ''), a.email ?? '', when(a.firstJoined), when(a.lastSeen)]),
  );

  w.heading('Documents');
  w.table(
    [
      { label: 'Document', width: 0.45 },
      { label: 'Added by', width: 0.2 },
      { label: 'Added', width: 0.23 },
      { label: 'Markups', width: 0.12 },
    ],
    meta.documents.map((d) => [d.name + (d.version && d.version > 1 ? ` (revision ${d.version})` : ''), d.addedBy, when(d.addedAt), String(documents.find((x) => x.name === d.name)?.markups.length ?? '')]),
  );

  for (const d of documents) {
    w.heading(`Markups in ${d.name}`, 12);
    if (!d.markups.length) {
      w.text('No markups.', 9, rgb(0.4, 0.4, 0.4));
      continue;
    }
    const sorted = [...d.markups].sort((a, b) => a.pageIndex - b.pageIndex || a.createdAt - b.createdAt);
    w.table(
      [
        { label: 'Page', width: 0.1 },
        { label: 'Markup', width: 0.2 },
        { label: 'Author', width: 0.14 },
        { label: 'Status', width: 0.1 },
        { label: 'Comment', width: 0.3 },
        { label: 'Date', width: 0.16 },
      ],
      sorted.map((m) => [
        d.pageLabel(m.pageIndex),
        d.describe(m),
        m.author,
        m.status === 'none' ? '' : m.status,
        [m.comment ?? m.text ?? '', ...(m.replies ?? []).map((r) => `${r.author}: ${r.text}`)].filter(Boolean).join(' / '),
        when(m.modifiedAt),
      ]),
    );
  }

  w.heading('Record');
  w.table(
    [
      { label: 'Time', width: 0.2 },
      { label: 'Who', width: 0.16 },
      { label: 'What', width: 0.64 },
    ],
    record.map((e) => [when(e.at), e.author, `${e.kind === 'chat' ? 'said: ' : e.kind === 'alert' ? 'Markup Alert: ' : ''}${e.text}`]),
  );
  return doc.save();
}
