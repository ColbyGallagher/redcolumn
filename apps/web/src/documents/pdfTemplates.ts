import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { TEMPLATE_DEFS } from './builtinTemplates';

/** Builds the built-in templates listed in builtinTemplates.ts. */

const MM = 72 / 25.4;

/** A new PDF of `pages` copies of the built-in template `id`. Each page's title block fields are its own. */
export async function buildTemplate(id: string, pages = 1): Promise<Uint8Array> {
  const def = TEMPLATE_DEFS.find((d) => d.id === id);
  if (!def) throw new Error(`Unknown template: ${id}`);
  const doc = await PDFDocument.create();
  doc.setTitle(def.name);
  doc.setCreator('Red Column');
  const fonts = { regular: await doc.embedFont(StandardFonts.Helvetica), bold: await doc.embedFont(StandardFonts.HelveticaBold) };
  for (let i = 0; i < Math.max(1, pages); i++) {
    const page = doc.addPage([def.width, def.height]);
    if (def.kind === 'sheet') drawingSheet(doc, page, fonts, def.sheet, pages > 1 ? `_${i + 1}` : '', i + 1, pages);
    else gridPaper(page, def.step);
  }
  return doc.save();
}

type Fonts = { regular: PDFFont; bold: PDFFont };
const INK = rgb(0, 0, 0);
const LABEL = rgb(0.35, 0.35, 0.35);

/** Drawing helpers in millimetres from the page's top-left corner. */
function pen(page: PDFPage) {
  const H = page.getHeight();
  return {
    line(x1: number, y1: number, x2: number, y2: number, w: number, color = INK) {
      page.drawLine({ start: { x: x1 * MM, y: H - y1 * MM }, end: { x: x2 * MM, y: H - y2 * MM }, thickness: w * MM, color });
    },
    rect(x: number, y: number, w: number, h: number, t: number) {
      page.drawRectangle({ x: x * MM, y: H - (y + h) * MM, width: w * MM, height: h * MM, borderWidth: t * MM, borderColor: INK });
    },
    /** `y` is the baseline. */
    text(s: string, x: number, y: number, pt: number, font: PDFFont, color = INK, align: 'left' | 'center' = 'left') {
      const dx = align === 'center' ? font.widthOfTextAtSize(s, pt) / 2 : 0;
      page.drawText(s, { x: x * MM - dx, y: H - y * MM, size: pt, font, color });
    },
  };
}

/** Zone letters run down the sides; I and O are skipped so they are not read as 1 and 0. */
const ZONE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

interface Cell {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  field?: string;
  pt?: number;
  bold?: boolean;
  multiline?: boolean;
  value?: string;
}

/** Title block, 180 mm wide (ISO 7200), with a revision table on top that fills upwards. Millimetres from its top-left. */
function titleBlockCells(sheet: string, sheetNo: number, sheets: number): { cells: Cell[]; height: number } {
  const cells: Cell[] = [];
  const revCols: [string, string, number][] = [
    ['REV', 'Letter', 12],
    ['DESCRIPTION', 'Description', 98],
    ['DATE', 'Date', 30],
    ['BY', 'By', 20],
    ['APPD', 'Approved', 20],
  ];
  let x = 0;
  for (const [label, , w] of revCols) {
    cells.push({ x, y: 24, w, h: 5, label });
    x += w;
  }
  for (let r = 1; r <= 4; r++) {
    x = 0;
    for (const [, key, w] of revCols) {
      cells.push({ x, y: (4 - r) * 6, w, h: 6, label: '', field: `Rev${r}${key}`, pt: 7 });
      x += w;
    }
  }
  const t = 29;
  cells.push(
    { x: 0, y: t, w: 50, h: 36, label: 'COMPANY', field: 'Company', pt: 10, bold: true, multiline: true },
    { x: 50, y: t, w: 130, h: 10, label: 'CLIENT', field: 'Client', pt: 9 },
    { x: 50, y: t + 10, w: 130, h: 10, label: 'PROJECT', field: 'Project', pt: 9 },
    { x: 50, y: t + 20, w: 130, h: 16, label: 'DRAWING TITLE', field: 'Title', pt: 12, bold: true, multiline: true },
    { x: 0, y: t + 36, w: 45, h: 10, label: 'DRAWN', field: 'Drawn', pt: 8 },
    { x: 45, y: t + 36, w: 45, h: 10, label: 'CHECKED', field: 'Checked', pt: 8 },
    { x: 90, y: t + 36, w: 45, h: 10, label: 'APPROVED', field: 'ApprovedBy', pt: 8 },
    { x: 135, y: t + 36, w: 45, h: 10, label: 'DATE', field: 'IssueDate', pt: 8 },
    { x: 0, y: t + 46, w: 30, h: 11, label: 'SCALE', field: 'Scale', pt: 9 },
    { x: 30, y: t + 46, w: 22, h: 11, label: 'SIZE', field: 'SheetSize', pt: 9, value: sheet },
    { x: 52, y: t + 46, w: 83, h: 11, label: 'DRAWING NO.', field: 'DrawingNumber', pt: 11, bold: true },
    { x: 135, y: t + 46, w: 25, h: 11, label: 'SHEET', field: 'Sheet', pt: 9, value: `${sheetNo} OF ${sheets}` },
    { x: 160, y: t + 46, w: 20, h: 11, label: 'REV', field: 'Revision', pt: 11, bold: true },
  );
  return { cells, height: t + 57 };
}

function drawingSheet(doc: PDFDocument, page: PDFPage, fonts: Fonts, sheet: string, suffix: string, sheetNo: number, sheets: number) {
  const p = pen(page);
  const W = page.getWidth() / MM;
  const H = page.getHeight() / MM;
  // ISO 5457: a 20 mm filing margin on the left, 10 mm elsewhere.
  const fx0 = 20;
  const fy0 = 10;
  const fx1 = W - 10;
  const fy1 = H - 10;
  p.rect(fx0, fy0, fx1 - fx0, fy1 - fy0, 0.7);

  // Zone references, about 50 mm apart, on sheets large enough to need them.
  if (Math.max(W, H) > 300) {
    const zones = (len: number) => Math.max(2, Math.round(len / 50 / 2) * 2);
    const cols = zones(fx1 - fx0);
    const rows = Math.min(zones(fy1 - fy0), ZONE_LETTERS.length);
    const cw = (fx1 - fx0) / cols;
    const rh = (fy1 - fy0) / rows;
    for (let i = 0; i <= cols; i++) {
      const x = fx0 + i * cw;
      if (i > 0 && i < cols) {
        p.line(x, fy0, x, fy0 - 5, 0.35);
        p.line(x, fy1, x, fy1 + 5, 0.35);
      }
      if (i < cols) {
        const n = String(i + 1);
        p.text(n, x + cw / 2, fy0 - 3.2, 8, fonts.regular, INK, 'center');
        p.text(n, x + cw / 2, fy1 + 6.8, 8, fonts.regular, INK, 'center');
      }
    }
    for (let j = 0; j <= rows; j++) {
      const y = fy0 + j * rh;
      if (j > 0 && j < rows) {
        p.line(fx0, y, fx0 - 5, y, 0.35);
        p.line(fx1, y, fx1 + 5, y, 0.35);
      }
      if (j < rows) {
        const l = ZONE_LETTERS[j]!;
        p.text(l, fx0 - 5, y + rh / 2 + 1.4, 8, fonts.regular, INK, 'center');
        p.text(l, fx1 + 5, y + rh / 2 + 1.4, 8, fonts.regular, INK, 'center');
      }
    }
  }

  // Title block in the bottom-right corner of the frame.
  const { cells, height } = titleBlockCells(sheet, sheetNo, sheets);
  const tw = Math.min(180, fx1 - fx0);
  const k = tw / 180;
  const tx = fx1 - tw;
  const ty = fy1 - height * k;
  const form = doc.getForm();
  for (const c of cells) {
    const x = tx + c.x * k;
    const y = ty + c.y * k;
    const w = c.w * k;
    const h = c.h * k;
    p.rect(x, y, w, h, 0.25);
    if (c.label) p.text(c.label, x + 1.2, y + 2.4, 5, c.field ? fonts.regular : fonts.bold, c.field ? LABEL : INK);
    if (!c.field) continue;
    const top = c.label ? 3 : 0.6;
    const f = form.createTextField(c.field + suffix);
    if (c.multiline) f.enableMultiline();
    if (c.value) f.setText(c.value);
    f.addToPage(page, {
      x: (x + 0.8) * MM,
      y: page.getHeight() - (y + h - 0.6) * MM,
      width: (w - 1.6) * MM,
      height: (h - top - 0.6) * MM,
      font: c.bold ? fonts.bold : fonts.regular,
      borderWidth: 0,
      backgroundColor: undefined,
      borderColor: undefined,
    });
    f.setFontSize(c.pt ?? 8);
    f.updateAppearances(c.bold ? fonts.bold : fonts.regular);
  }
  p.rect(tx, ty, tw, height * k, 0.5);
}

function gridPaper(page: PDFPage, step: number) {
  const p = pen(page);
  const W = page.getWidth() / MM;
  const H = page.getHeight() / MM;
  const m = 10;
  const nx = Math.floor((W - 2 * m) / step);
  const ny = Math.floor((H - 2 * m) / step);
  const x0 = (W - nx * step) / 2;
  const y0 = (H - ny * step) / 2;
  const minor = rgb(0.75, 0.85, 0.95);
  const major = rgb(0.45, 0.62, 0.82);
  const majorEvery = Math.max(1, Math.round(10 / step));
  for (const heavy of [false, true]) {
    for (let i = 0; i <= nx; i++) if ((i % majorEvery === 0) === heavy) p.line(x0 + i * step, y0, x0 + i * step, y0 + ny * step, heavy ? 0.2 : 0.1, heavy ? major : minor);
    for (let j = 0; j <= ny; j++) if ((j % majorEvery === 0) === heavy) p.line(x0, y0 + j * step, x0 + nx * step, y0 + j * step, heavy ? 0.2 : 0.1, heavy ? major : minor);
  }
}
