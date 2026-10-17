// Helpers for the A3 Bluebeam test set: page geometry, base drawing, a cell grid that places and
// captions each test, and the markup factory. Everything is laid out in display space (top-left,
// y down, rotation applied), the same space redcolumn's markups use.
import { PDFDocument, PDFFont, PDFPage, StandardFonts, closePath, degrees, fill, fillAndStroke, lineTo, moveTo, popGraphicsState, pushGraphicsState, rgb, setDashPattern, setFillingRgbColor, setLineWidth, setStrokingRgbColor, stroke } from 'pdf-lib';
import type { Scale } from '@nb/measure';
import { DEFAULT_STYLES, type Markup, type MarkupStyle, type MarkupType, type Point, type Rect } from '../../../src/model.ts';
import type { CustomColumn, MarkupStatusDef } from '../../../src/columns.ts';
import type { Bookmark, Place } from '../../../src/bookmarks.ts';
import type { Viewport } from '../../../src/viewports.ts';
import type { Assembly } from '../../../src/assemblies.ts';

export const A3W = 1190.55;
export const A3H = 841.89;
export const T0 = Date.UTC(2026, 9, 17, 9, 0, 0);

export type Rot = 0 | 90 | 180 | 270;

export interface PageOpts {
  title: string;
  sheet: string;
  /** Visible box in user space. Defaults to the A3 landscape media box at the origin. */
  box?: { x: number; y: number; w: number; h: number };
  /** Media box when different from `box` (then `box` is written as the CropBox). */
  media?: { x: number; y: number; w: number; h: number };
  rotate?: Rot;
  scale?: Scale;
  note?: string;
}

export interface PageSpec extends PageOpts {
  /** Display size. */
  w: number;
  h: number;
  captions: { x: number; y: number; text: string; size?: number }[];
  extras: ((c: Canvas) => void)[];
  text: { x: number; y: number; text: string; size: number; bold?: boolean }[];
  markups: Markup[];
  /** AcroForm fields to add (page 'forms'). */
  form?: boolean;
}

/** Draws in display space onto a pdf-lib page, whatever the page's rotation and box. */
export class Canvas {
  readonly page: PDFPage;
  readonly spec: PageSpec;
  readonly font: PDFFont;
  readonly bold: PDFFont;
  constructor(page: PDFPage, spec: PageSpec, font: PDFFont, bold: PDFFont) {
    this.page = page;
    this.spec = spec;
    this.font = font;
    this.bold = bold;
  }
  private get box() {
    return this.spec.box ?? { x: 0, y: 0, w: A3W, h: A3H };
  }
  /** Display point to user space. */
  u(dx: number, dy: number): { x: number; y: number } {
    const b = this.box;
    switch (this.spec.rotate ?? 0) {
      case 90:
        return { x: b.x + dy, y: b.y + dx };
      case 180:
        return { x: b.x + b.w - dx, y: b.y + dy };
      case 270:
        return { x: b.x + b.w - dy, y: b.y + b.h - dx };
      default:
        return { x: b.x + dx, y: b.y + b.h - dy };
    }
  }
  get angle(): number {
    return this.spec.rotate ?? 0;
  }
  line(a: Point, b: Point, o: { width?: number; color?: [number, number, number]; dash?: number[] } = {}) {
    this.page.drawLine({ start: this.u(a[0], a[1]), end: this.u(b[0], b[1]), thickness: o.width ?? 0.5, color: rgb(...(o.color ?? [0, 0, 0])), ...(o.dash ? { dashArray: o.dash } : {}) });
  }
  poly(pts: Point[], o: { width?: number; stroke?: [number, number, number] | null; fill?: [number, number, number] | null; dash?: number[]; close?: boolean } = {}) {
    if (pts.length < 2) return;
    const ops = [pushGraphicsState(), setLineWidth(o.width ?? 0.5)];
    if (o.stroke !== null) ops.push(setStrokingRgbColor(...(o.stroke ?? [0, 0, 0])));
    if (o.fill) ops.push(setFillingRgbColor(...o.fill));
    if (o.dash) ops.push(setDashPattern(o.dash, 0));
    pts.forEach((p, i) => {
      const q = this.u(p[0], p[1]);
      ops.push(i ? lineTo(q.x, q.y) : moveTo(q.x, q.y));
    });
    if (o.close !== false && (o.fill || o.close)) ops.push(closePath());
    ops.push(o.fill && o.stroke !== null ? fillAndStroke() : o.fill ? fill() : stroke(), popGraphicsState());
    this.page.pushOperators(...ops);
  }
  rect(r: Rect, o: Parameters<Canvas['poly']>[1] = {}) {
    this.poly([[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]], { ...o, close: true });
  }
  text(s: string, x: number, y: number, size = 8, o: { bold?: boolean; color?: [number, number, number] } = {}) {
    const p = this.u(x, y);
    this.page.drawText(s, { x: p.x, y: p.y, size, font: o.bold ? this.bold : this.font, color: rgb(...(o.color ?? [0, 0, 0])), rotate: degrees(this.angle) });
  }
  width(s: string, size: number, bold = false): number {
    return (bold ? this.bold : this.font).widthOfTextAtSize(s, size);
  }
}

// ---- Markup factory ------------------------------------------------------------------------

let counter = 0;
export const resetIds = () => {
  counter = 0;
};

export function mk(type: MarkupType, pageIndex: number, points: Point[], extra: Partial<Markup> = {}, style: Partial<MarkupStyle> = {}): Markup {
  counter++;
  return {
    id: `a3-${String(counter).padStart(4, '0')}`,
    seq: counter,
    type,
    pageIndex,
    points,
    style: { ...DEFAULT_STYLES[type], ...style },
    status: 'none',
    author: 'A3 Tester',
    createdAt: T0 + counter * 1000,
    modifiedAt: T0 + counter * 1000,
    ...extra,
  };
}

// ---- Page with a cell grid -------------------------------------------------------------------

export interface Cell extends Rect {
  /** Inner area with padding. */
  ix: number;
  iy: number;
  iw: number;
  ih: number;
}

export const inner = (c: Rect, pad = 14): Rect => ({ x: c.x + pad, y: c.y + pad + 6, w: c.w - pad * 2, h: c.h - pad * 2 - 6 });
export const mid = (r: Rect): Point => [r.x + r.w / 2, r.y + r.h / 2];

/** A page being built: a grid that hands out captioned cells, and the markups placed in them. */
export class PageBuilder {
  readonly spec: PageSpec;
  private used: boolean[][];
  readonly cols: number;
  readonly rows: number;
  private cw: number;
  private ch: number;
  private left = 28;
  private top = 40;
  seqLabel = 0;

  readonly pageIndex: number;
  constructor(pageIndex: number, opts: PageOpts & { cols?: number; rows?: number; bottomReserve?: number; portrait?: boolean }) {
    this.pageIndex = pageIndex;
    const rot = opts.rotate ?? 0;
    const box = opts.box ?? { x: 0, y: 0, w: opts.portrait ? A3H : A3W, h: opts.portrait ? A3W : A3H };
    const sw = rot === 90 || rot === 270 ? box.h : box.w;
    const sh = rot === 90 || rot === 270 ? box.w : box.h;
    this.spec = { ...opts, box, w: sw, h: sh, captions: [], extras: [], text: [], markups: [] };
    this.cols = opts.cols ?? Math.max(1, Math.floor(sw / 196));
    this.rows = opts.rows ?? Math.max(1, Math.floor((sh - this.top - (opts.bottomReserve ?? 110)) / 112));
    this.cw = (sw - this.left * 2) / this.cols;
    this.ch = (sh - this.top - (opts.bottomReserve ?? 110)) / this.rows;
    this.used = Array.from({ length: this.rows }, () => Array<boolean>(this.cols).fill(false));
  }
  get w() {
    return this.spec.w;
  }
  get h() {
    return this.spec.h;
  }
  /** Marks cells as taken without placing anything (to keep clear of a base drawing). */
  reserve(col: number, row: number, cols: number, rows: number) {
    for (let r = row; r < row + rows; r++) for (let c = col; c < col + cols; c++) if (this.used[r]?.[c] !== undefined) this.used[r]![c] = true;
  }
  /** Next free block of `cols` x `rows` cells, row-major. Throws when the page is full. */
  alloc(cols = 1, rows = 1): Rect {
    for (let r = 0; r + rows <= this.rows; r++) {
      for (let c = 0; c + cols <= this.cols; c++) {
        let free = true;
        for (let rr = r; rr < r + rows && free; rr++) for (let cc = c; cc < c + cols; cc++) if (this.used[rr]![cc]) free = false;
        if (!free) continue;
        this.reserve(c, r, cols, rows);
        return { x: this.left + c * this.cw, y: this.top + r * this.ch, w: cols * this.cw, h: rows * this.ch };
      }
    }
    throw new Error(`page ${this.spec.sheet}: no room for a ${cols}x${rows} cell (${this.spec.title})`);
  }
  /** A captioned cell: `fn` gets the inner rectangle and returns its markups. */
  cell(label: string, size: [number, number] | null, fn: (r: Rect, c: Rect) => Markup[], note?: string) {
    const [cols, rows] = size ?? [1, 1];
    const c = this.alloc(cols, rows);
    this.spec.extras.push((cv) => cv.rect({ x: c.x + 2, y: c.y + 2, w: c.w - 4, h: c.h - 4 }, { width: 0.25, stroke: [0.8, 0.8, 0.8] }));
    this.spec.captions.push({ x: c.x + 5, y: c.y + 9, text: label, size: 6.5 });
    if (note) this.spec.captions.push({ x: c.x + 5, y: c.y + c.h - 5, text: note, size: 5.5 });
    const ms = fn(inner(c), c);
    for (const m of ms) {
      m.pageIndex = this.pageIndex;
      if (!m.subject) m.subject = label.length > 60 ? label.slice(0, 57) + '...' : label;
    }
    this.spec.markups.push(...ms);
    return ms;
  }
  add(...ms: Markup[]) {
    for (const m of ms) m.pageIndex = this.pageIndex;
    this.spec.markups.push(...ms);
  }
  /** Fixed-position text on the page (not a markup), for text markups to sit over. */
  baseText(x: number, y: number, text: string, size = 11, bold = false) {
    this.spec.text.push({ x, y, text, size, bold });
  }
}

// ---- Document model ----------------------------------------------------------------------------

export interface DocParts {
  pages: PageSpec[];
  columns?: CustomColumn[];
  statuses?: MarkupStatusDef[];
  viewports?: Viewport[];
  places?: Place[];
  bookmarks?: Bookmark[];
  assemblies?: Assembly[];
  /** Page labels by page index. */
  labels?: string[];
}

export const rgbOf = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

/** The base PDF: blank A3 pages with frame, grid, title block, captions and the base text. */
export async function baseDocument(pages: readonly PageSpec[], projectName: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(projectName);
  doc.setAuthor('redcolumn A3 test generator');
  doc.setCreationDate(new Date(T0));
  doc.setModificationDate(new Date(T0));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  for (const spec of pages) {
    const box = spec.box!;
    const media = spec.media ?? box;
    const page = doc.addPage([media.w, media.h]);
    page.setMediaBox(media.x, media.y, media.w, media.h);
    if (spec.media) page.setCropBox(box.x, box.y, box.w, box.h);
    if (spec.rotate) page.setRotation(degrees(spec.rotate));
    const cv = new Canvas(page, spec, font, bold);
    // Faint 50 pt grid with display-space coordinates along two edges.
    for (let x = 0; x <= spec.w; x += 50) cv.line([x, 0], [x, spec.h], { width: 0.15, color: [0.88, 0.9, 0.95] });
    for (let y = 0; y <= spec.h; y += 50) cv.line([0, y], [spec.w, y], { width: 0.15, color: [0.88, 0.9, 0.95] });
    for (let x = 100; x < spec.w; x += 100) cv.text(String(x), x + 1, 7, 4.5, { color: [0.45, 0.5, 0.6] });
    for (let y = 100; y < spec.h; y += 100) cv.text(String(y), 1, y - 1, 4.5, { color: [0.45, 0.5, 0.6] });
    cv.rect({ x: 18, y: 18, w: spec.w - 36, h: spec.h - 36 }, { width: 1.2 });
    for (const e of spec.extras) e(cv);
    for (const t of spec.text) cv.text(t.text, t.x, t.y, t.size, { bold: t.bold });
    for (const c of spec.captions) cv.text(c.text, c.x, c.y, c.size ?? 7, { color: [0.2, 0.25, 0.45] });
    // Title block, bottom right.
    const tb = { x: spec.w - 18 - 330, y: spec.h - 18 - 84, w: 330, h: 84 };
    cv.rect(tb, { width: 1, fill: [1, 1, 1] });
    cv.line([tb.x, tb.y + 28], [tb.x + tb.w, tb.y + 28], { width: 0.6 });
    cv.line([tb.x + 250, tb.y + 28], [tb.x + 250, tb.y + tb.h], { width: 0.6 });
    cv.text(projectName.toUpperCase(), tb.x + 6, tb.y + 12, 8, { bold: true });
    cv.text(spec.title, tb.x + 6, tb.y + 22, 7);
    cv.text(spec.note ?? `A3 ${spec.rotate ? `rotate ${spec.rotate}` : 'landscape'}`, tb.x + 6, tb.y + 42, 6.5);
    cv.text(`Scale: ${spec.scale?.label ?? 'not set'}`, tb.x + 6, tb.y + 52, 6.5);
    cv.text(`Size: ${Math.round(spec.w)} x ${Math.round(spec.h)} pt (display)`, tb.x + 6, tb.y + 62, 6.5);
    cv.text(`Rev A  17-Oct-2026`, tb.x + 6, tb.y + 72, 6.5);
    cv.text('SHEET', tb.x + 256, tb.y + 36, 6);
    cv.text(spec.sheet, tb.x + 256, tb.y + 62, 20, { bold: true });
    if (spec.form) addFormFields(doc, page, cv);
  }
  return doc.save();
}

// ---- Shared measuring and layout helpers ---------------------------------------------------------

const metricsDoc = await PDFDocument.create();
const metricsFont = await metricsDoc.embedFont(StandardFonts.Helvetica);
const metricsBold = await metricsDoc.embedFont(StandardFonts.HelveticaBold);
/** Width of Helvetica text, as the base page will draw it. */
export const textWidth = (s: string, size: number, bold = false): number => (bold ? metricsBold : metricsFont).widthOfTextAtSize(s, size);

/** The i-th of n equal boxes across a rectangle, as the two corner points markups use. */
export function split(r: Rect, i: number, n: number, gap = 3): Point[] {
  const w = r.w / n;
  return [[r.x + i * w + gap / 2, r.y], [r.x + (i + 1) * w - gap / 2, r.y + r.h]];
}

/** Where the form-field page puts its AcroForm fields (display space, page not rotated). */
export const FORM_LAYOUT = {
  text: { name: 'full_name', x: 40, y: 60, w: 220, h: 22 },
  multi: { name: 'comments', x: 40, y: 110, w: 220, h: 80 },
  check: { name: 'agree', x: 40, y: 210, w: 16, h: 16 },
  radio: { name: 'choice', x: 40, y: 250, w: 16, h: 16, options: ['Option A', 'Option B', 'Option C'] },
  drop: { name: 'discipline', x: 300, y: 110, w: 160, h: 22, options: ['Architectural', 'Structural', 'Mechanical'] },
  list: { name: 'zones', x: 300, y: 150, w: 160, h: 70, options: ['Zone 1', 'Zone 2', 'Zone 3', 'Zone 4'] },
};

function addFormFields(doc: PDFDocument, page: PDFPage, cv: Canvas) {
  const form = doc.getForm();
  const at = (f: { x: number; y: number; w: number; h: number }) => ({ ...cv.u(f.x, f.y + f.h), width: f.w, height: f.h });
  const L = FORM_LAYOUT;
  const text = form.createTextField(L.text.name);
  text.setText('A3 Tester');
  text.addToPage(page, at(L.text));
  const multi = form.createTextField(L.multi.name);
  multi.enableMultiline();
  multi.setText('Multi-line comment\nsecond line');
  multi.addToPage(page, at(L.multi));
  const check = form.createCheckBox(L.check.name);
  check.check();
  check.addToPage(page, at(L.check));
  const radio = form.createRadioGroup(L.radio.name);
  L.radio.options.forEach((o, i) => radio.addOptionToPage(o, page, at({ ...L.radio, y: L.radio.y + i * 24 })));
  radio.select(L.radio.options[1]!);
  const drop = form.createDropdown(L.drop.name);
  drop.addOptions(L.drop.options);
  drop.select(L.drop.options[0]!);
  drop.addToPage(page, at(L.drop));
  const list = form.createOptionList(L.list.name);
  list.addOptions(L.list.options);
  list.select(L.list.options[1]!);
  list.addToPage(page, at(L.list));
  const labels: [string, number, number][] = [['Full name', 40, 56], ['Comments', 40, 106], ['Agree (check box)', 62, 222], ['Choice (radio)', 62, 262], ['Discipline (drop-down)', 300, 106], ['Zones (list)', 300, 146]];
  for (const [t, x, y] of labels) cv.text(t, x, y, 6.5, { color: [0.2, 0.25, 0.45] });
}
