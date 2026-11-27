/**
 * Deterministic generator of fictional architectural/structural PDF revision pairs for measuring
 * revision alignment and comment placement accuracy.
 *
 * Uses only Node's built-in `node:zlib` (no Python or third-party PDF writer required). Every
 * drawing coordinate is specified in redcolumn page space (PDF points, origin at top-left, y down)
 * and converted to PDF user space (y up) when emitting the content stream, so ground-truth comment
 * coordinates share the exact coordinate frame returned by PDFium.
 */

import { deflateSync } from 'node:zlib';
import { applyAffine, IDENTITY, type Affine, type CommentGeometry, type Point } from '../../packages/align/src/index.ts';

/** Standard ARCH C landscape sheet (24 × 18 in) in PDF points. */
export const ARCH_C = { width: 24 * 72, height: 18 * 72 } as const; // 1728 × 1296
/** Reduced ANSI B / 2/3-scale landscape sheet (16 × 12 in) in PDF points. */
export const REDUCED_SHEET = { width: 16 * 72, height: 12 * 72 } as const; // 1152 × 864

export type CaseId =
  | 'unchanged'
  | 'moved-views'
  | 'changed-scale'
  | 'renumbered-sheets'
  | 'redrawn-details'
  | 'deleted-content';

export interface GroundTruthComment {
  id: string;
  subcase: string;
  description: string;
  oldPage: number;
  oldGeometry: CommentGeometry;
  /** Expected target page and geometry on the new revision, or null when the subject no longer exists. */
  expected: { newPage: number; geometry: CommentGeometry } | null;
}

export interface RevisionPairFixture {
  id: CaseId;
  label: string;
  /** How sheets are paired in this case: by detected sheet number (default) or explicit page order. */
  pairBySheet: boolean;
  oldPdf: Uint8Array;
  newPdf: Uint8Array;
  oldSheets: string[];
  newSheets: string[];
  /** Ground-truth page-index pairs for confirmed sheet pairing mode (independent of comments). */
  sheetPairs: { oldPage: number; newPage: number }[];
  comments: GroundTruthComment[];
}

/** Deterministic Mulberry32 PRNG. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rnd: () => number, min: number, max: number): number {
  return Math.floor(rnd() * (max - min + 1)) + min;
}

function randRange(rnd: () => number, min: number, max: number): number {
  return min + rnd() * (max - min);
}

function randSign(rnd: () => number): number {
  return rnd() < 0.5 ? -1 : 1;
}

function pdfEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function f(n: number): string {
  return Number.isFinite(n) ? n.toFixed(2) : '0';
}

/**
 * Low-level page canvas that accepts page-space (top-left, y-down) drawing calls and emits a PDF
 * content stream. Supports an active affine viewport transform so view shifts and scale changes
 * apply identically to vector graphics, text, and ground-truth coordinates.
 */
class PageBuilder {
  readonly width: number;
  readonly height: number;
  private ops: string[] = [];
  private currentTransform: Affine = IDENTITY;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.ops.push('0 0 0 RG 0 0 0 rg 0.6 w');
  }

  private pt(x: number, y: number): [number, number] {
    const [px, py] = applyAffine(this.currentTransform, [x, y]);
    return [px, this.height - py];
  }

  private scaleFactor(): number {
    const m = this.currentTransform;
    return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
  }

  /** Runs `fn` with an affine transform in page space (y down). */
  withTransform(m: Affine, fn: () => void) {
    const prev = this.currentTransform;
    this.currentTransform = m;
    fn();
    this.currentTransform = prev;
  }

  lineWidth(w: number) {
    this.ops.push(`${f(Math.max(0.25, w * this.scaleFactor()))} w`);
  }

  strokeGray(g: number) {
    this.ops.push(`${f(g)} G`);
  }

  fillGray(g: number) {
    this.ops.push(`${f(g)} g`);
  }

  dash(on: number, off: number) {
    const k = this.scaleFactor();
    this.ops.push(`[${f(on * k)} ${f(off * k)}] 0 d`);
  }

  solid() {
    this.ops.push('[] 0 d');
  }

  line(x1: number, y1: number, x2: number, y2: number) {
    const [ax, ay] = this.pt(x1, y1);
    const [bx, by] = this.pt(x2, y2);
    this.ops.push(`${f(ax)} ${f(ay)} m ${f(bx)} ${f(by)} l S`);
  }

  polyline(pts: readonly Point[], close = false) {
    if (pts.length < 2) return;
    const cmds = pts.map(([x, y], i) => {
      const [px, py] = this.pt(x, y);
      return `${f(px)} ${f(py)} ${i === 0 ? 'm' : 'l'}`;
    });
    this.ops.push(`${cmds.join(' ')} ${close ? 's' : 'S'}`);
  }

  rect(x: number, y: number, w: number, h: number, fill?: number) {
    const corners: Point[] = [
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
    ];
    const cmds = corners.map(([cx, cy], i) => {
      const [px, py] = this.pt(cx, cy);
      return `${f(px)} ${f(py)} ${i === 0 ? 'm' : 'l'}`;
    });
    if (fill !== undefined) {
      this.ops.push(`q ${f(fill)} g ${cmds.join(' ')} h B Q`);
    } else {
      this.ops.push(`${cmds.join(' ')} s`);
    }
  }

  circle(cx: number, cy: number, r: number, fillWhite = false) {
    const k = 0.5522847498 * r;
    const c = (x: number, y: number) => {
      const [px, py] = this.pt(x, y);
      return `${f(px)} ${f(py)}`;
    };
    const path = [
      `${c(cx + r, cy)} m`,
      `${c(cx + r, cy + k)} ${c(cx + k, cy + r)} ${c(cx, cy + r)} c`,
      `${c(cx - k, cy + r)} ${c(cx - r, cy + k)} ${c(cx - r, cy)} c`,
      `${c(cx - r, cy - k)} ${c(cx - k, cy - r)} ${c(cx, cy - r)} c`,
      `${c(cx + k, cy - r)} ${c(cx + r, cy - k)} ${c(cx + r, cy)} c`,
    ].join(' ');
    if (fillWhite) this.ops.push(`q 1 g ${path} B Q`);
    else this.ops.push(`${path} S`);
  }

  /** Quarter-circle arc from angle a0 to a1 (radians, clockwise in y-down page space). */
  arc(cx: number, cy: number, r: number, a0: number, a1: number, steps = 12) {
    const pts: Point[] = [];
    for (let i = 0; i <= steps; i++) {
      const a = a0 + ((a1 - a0) * i) / steps;
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
    this.polyline(pts);
  }

  /** Diagonal hatch lines clipped cleanly inside a rectangle. */
  hatchRect(x: number, y: number, w: number, h: number, spacing = 10) {
    this.lineWidth(0.35);
    this.strokeGray(0.35);
    for (let d = -h; d < w; d += spacing) {
      const x1 = Math.max(x, x + d);
      const y1 = y + (x1 - (x + d));
      const x2 = Math.min(x + w, x + d + h);
      const y2 = y + (x2 - (x + d));
      if (x2 > x1 && y2 > y1) this.line(x1, y1, x2, y2);
    }
    this.strokeGray(0);
    this.lineWidth(0.7);
  }

  /** Draws text at page-space baseline `(x, y)` (y down). */
  text(x: number, y: number, value: string, size = 10) {
    const [px, py] = this.pt(x, y);
    const scaledSize = Math.max(3, size * this.scaleFactor());
    this.ops.push(`BT /F1 ${f(scaledSize)} Tf 1 0 0 1 ${f(px)} ${f(py)} Tm (${pdfEscape(value)}) Tj ET`);
  }

  /** Double-line architectural wall segment between `(x1, y1)` and `(x2, y2)`. */
  wall(x1: number, y1: number, x2: number, y2: number, thickness = 6) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * (thickness / 2);
    const ny = (dx / len) * (thickness / 2);
    this.lineWidth(1.1);
    this.line(x1 + nx, y1 + ny, x2 + nx, y2 + ny);
    this.line(x1 - nx, y1 - ny, x2 - nx, y2 - ny);
    this.lineWidth(0.6);
  }

  /** Door leaf + 90-degree swing arc + tag. */
  door(hingeX: number, hingeY: number, width: number, angleDeg: number, tag: string) {
    const rad = (angleDeg * Math.PI) / 180;
    const leafX = hingeX + Math.cos(rad) * width;
    const leafY = hingeY + Math.sin(rad) * width;
    this.lineWidth(0.9);
    this.line(hingeX, hingeY, leafX, leafY);
    this.lineWidth(0.45);
    this.dash(3, 2);
    this.arc(hingeX, hingeY, width, rad, rad + Math.PI / 2, 10);
    this.solid();
    this.lineWidth(0.6);
    this.text(hingeX + Math.cos(rad + 0.7) * (width * 0.65) - 10, hingeY + Math.sin(rad + 0.7) * (width * 0.65), tag, 7);
  }

  /** Dimension line with end ticks and centered label. */
  dimension(x1: number, y1: number, x2: number, y2: number, label: string) {
    this.lineWidth(0.45);
    this.line(x1, y1, x2, y2);
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * 5;
    const ny = (dx / len) * 5;
    this.line(x1 - nx, y1 - ny, x1 + nx, y1 + ny);
    this.line(x2 - nx, y2 - ny, x2 + nx, y2 + ny);
    this.text((x1 + x2) / 2 - label.length * 2.2, (y1 + y2) / 2 - 4, label, 7.5);
    this.lineWidth(0.6);
  }

  /** Detail/section callout bubble (top ID over target sheet). */
  calloutBubble(cx: number, cy: number, top: string, bottom: string, r = 16) {
    this.lineWidth(0.9);
    this.circle(cx, cy, r, true);
    this.line(cx - r, cy, cx + r, cy);
    this.text(cx - top.length * 2.8, cy - 3, top, 9);
    this.text(cx - bottom.length * 2.2, cy + 9, bottom, 7.5);
    this.lineWidth(0.6);
  }

  /** Draws a standard border and bottom-right title block compatible with `@nb/sheets`. */
  titleBlock(sheetNo: string, title: string, rev: string, scaleText: string, project = 'MAPLE CIVIC CENTRE') {
    const W = this.width;
    const H = this.height;
    this.lineWidth(1.4);
    this.rect(36, 36, W - 72, H - 72);
    this.lineWidth(1.0);
    const tbW = 340;
    const tbH = 160;
    const tbX = W - 36 - tbW;
    const tbY = H - 36 - tbH;
    this.rect(tbX, tbY, tbW, tbH, 1);
    this.line(tbX, tbY + 42, tbX + tbW, tbY + 42);
    this.line(tbX, tbY + 94, tbX + tbW, tbY + 94);
    this.line(tbX + 200, tbY + 94, tbX + 200, tbY + tbH);
    this.text(tbX + 12, tbY + 14, 'PROJECT', 7);
    this.text(tbX + 12, tbY + 32, project, 12);
    this.text(tbX + 12, tbY + 56, 'SHEET TITLE', 7);
    this.text(tbX + 12, tbY + 78, title, 12);
    this.text(tbX + 12, tbY + 112, `SCALE: ${scaleText}`, 8);
    this.text(tbX + 12, tbY + 132, `REVISION: ${rev}`, 8);
    this.text(tbX + 12, tbY + 148, 'DRAWN: N. HARPER   CHECKED: R. PATEL', 6.5);
    this.text(tbX + 212, tbY + 110, 'SHEET NO.', 7);
    this.text(tbX + 212, tbY + 146, sheetNo, 26);
    this.lineWidth(0.6);
  }

  buildStream(): Uint8Array {
    return Buffer.from(this.ops.join('\n'), 'latin1');
  }
}

/** Assembles one or more `PageBuilder` instances into a valid PDF 1.7 document. */
function buildPdf(pages: readonly PageBuilder[]): Uint8Array {
  const objs: Buffer[] = [];
  const add = (body: Buffer | string) => {
    objs.push(typeof body === 'string' ? Buffer.from(body, 'latin1') : body);
    return objs.length;
  };
  const catalog = add('');
  const pagesObj = add('');
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const kids: number[] = [];
  for (const p of pages) {
    const compressed = deflateSync(p.buildStream(), { level: 6 });
    const header = Buffer.from(`<< /Length ${compressed.length} /Filter /FlateDecode >>\nstream\n`, 'latin1');
    const footer = Buffer.from('\nendstream', 'latin1');
    const contentId = add(Buffer.concat([header, compressed, footer]));
    const pageId = add(
      `<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${f(p.width)} ${f(p.height)}] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
    kids.push(pageId);
  }
  objs[catalog - 1] = Buffer.from(`<< /Type /Catalog /Pages ${pagesObj} 0 R >>`, 'latin1');
  objs[pagesObj - 1] = Buffer.from(`<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`, 'latin1');

  const chunks: Buffer[] = [Buffer.from('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
  let offset = chunks[0]!.length;
  const offsets: number[] = [];
  for (let i = 0; i < objs.length; i++) {
    offsets.push(offset);
    const prefix = Buffer.from(`${i + 1} 0 obj\n`, 'latin1');
    const suffix = Buffer.from('\nendobj\n', 'latin1');
    chunks.push(prefix, objs[i]!, suffix);
    offset += prefix.length + objs[i]!.length + suffix.length;
  }
  const xrefOffset = offset;
  const xrefLines = [`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`];
  for (const o of offsets) xrefLines.push(`${String(o).padStart(10, '0')} 00000 n \n`);
  xrefLines.push(`trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);
  chunks.push(Buffer.from(xrefLines.join(''), 'latin1'));
  return new Uint8Array(Buffer.concat(chunks));
}

function mapGeometry(m: Affine, g: CommentGeometry): CommentGeometry {
  return {
    points: g.points.map((p) => applyAffine(m, p)),
    ...(g.holes ? { holes: g.holes.map((ring) => ring.map((p) => applyAffine(m, p))) } : {}),
    ...(g.rotation !== undefined ? { rotation: g.rotation } : {}),
  };
}

function boxComment(x: number, y: number, w: number, h: number): CommentGeometry {
  return {
    points: [
      [x, y],
      [x + w, y + h],
    ],
  };
}

function calloutComment(tipX: number, tipY: number, boxX: number, boxY: number, w = 80, h = 28): CommentGeometry {
  return {
    points: [
      [tipX, tipY],
      [(tipX + boxX) / 2, boxY + h / 2],
      [boxX, boxY],
      [boxX + w, boxY + h],
    ],
  };
}

function translate(dx: number, dy: number): Affine {
  return [1, 0, 0, 1, dx, dy];
}

function scaleAbout(cx: number, cy: number, k: number): Affine {
  return [k, 0, 0, k, cx * (1 - k), cy * (1 - k)];
}

/**
 * Draws a rich fictional architectural floor plan inside local coordinates `(0..960, 0..760)`,
 * placed at `(ox, oy)` in the active transform. Options toggle deletions or minor edits so the
 * same realistic plan drives multiple revision-pair cases.
 */
function drawFloorPlan(
  pb: PageBuilder,
  ox: number,
  oy: number,
  opts: {
    seed?: number;
    omitAnnex?: boolean;
    omitDoor14?: boolean;
    omitRtu2?: boolean;
    extraNote?: boolean;
    variant?: 'architectural' | 'framing' | 'roof' | 'demolition' | 'sections';
  } = {},
) {
  const rnd = mulberry32(opts.seed ?? 42);
  const variant = opts.variant ?? 'architectural';

  // Column grid (5 vertical A-E, 4 horizontal 1-4).
  const xs = [ox + 80, ox + 280, ox + 490, ox + 700, ox + 900];
  const ys = [oy + 90, oy + 290, oy + 490, oy + 680];
  const xLabels = ['A', 'B', 'C', 'D', 'E'];
  const yLabels = ['1', '2', '3', '4'];

  pb.lineWidth(0.35);
  pb.dash(8, 4);
  for (let i = 0; i < xs.length; i++) {
    pb.line(xs[i]!, oy + 45, xs[i]!, oy + 725);
  }
  for (let j = 0; j < ys.length; j++) {
    pb.line(ox + 35, ys[j]!, ox + 945, ys[j]!);
  }
  pb.solid();
  pb.lineWidth(0.8);
  for (let i = 0; i < xs.length; i++) {
    pb.circle(xs[i]!, oy + 28, 12, true);
    pb.text(xs[i]! - 3.5, oy + 31.5, xLabels[i]!, 10);
  }
  for (let j = 0; j < ys.length; j++) {
    pb.circle(ox + 18, ys[j]!, 12, true);
    pb.text(ox + 14.5, ys[j]! + 3.5, yLabels[j]!, 10);
  }

  // Distinct structural/discipline drawings for renumbered-sheet testing so unrelated sheets
  // genuinely look different (different walls, bays, trusses, symbols, labels).
  if (variant === 'framing') {
    pb.lineWidth(1.5);
    pb.rect(xs[0]!, ys[0]!, xs[4]! - xs[0]!, ys[3]! - ys[0]!);
    for (let i = 0; i < xs.length; i++) {
      for (let j = 0; j < ys.length; j++) {
        pb.rect(xs[i]! - 7, ys[j]! - 7, 14, 14, 0.15);
      }
    }
    // Primary and secondary steel beams with labels.
    pb.lineWidth(1.1);
    for (let j = 0; j < ys.length; j++) pb.line(xs[0]!, ys[j]!, xs[4]!, ys[j]!);
    for (let i = 0; i < xs.length - 1; i++) {
      for (let sub = 1; sub <= 2; sub++) {
        const bx = xs[i]! + ((xs[i + 1]! - xs[i]!) * sub) / 3;
        pb.lineWidth(0.75);
        pb.line(bx, ys[0]!, bx, ys[3]!);
        pb.text(bx + 4, ys[1]! - 40, `310UB40-${i + 1}${sub}`, 7.5);
      }
    }
    // Diagonal bracing in bay B-C, 2-3.
    pb.lineWidth(1.0);
    pb.line(xs[1]!, ys[1]!, xs[2]!, ys[2]!);
    pb.line(xs[2]!, ys[1]!, xs[1]!, ys[2]!);
    pb.text(xs[1]! + 55, ys[1]! + 115, 'BRACING BAY B2', 9);
    pb.text(xs[0]! + 25, ys[0]! + 35, '410UB54 PRIMARY GIRDER', 8.5);
    pb.text(xs[3]! + 20, ys[2]! + 95, 'SLAB DEPRESSION 40MM', 8.5);
    pb.dimension(xs[0]!, oy + 740, xs[4]!, oy + 740, '24600 TOTAL SPAN');
    return;
  }

  if (variant === 'roof') {
    // Sloped roof planes with ridges, valleys, drainage arrows, and skylight openings.
    pb.lineWidth(1.3);
    pb.rect(xs[0]! - 20, ys[0]! - 20, xs[4]! - xs[0]! + 40, ys[3]! - ys[0]! + 40);
    const midY = (ys[0]! + ys[3]!) / 2;
    pb.lineWidth(1.6);
    pb.line(xs[0]! + 100, midY, xs[4]! - 100, midY); // ridge
    pb.lineWidth(0.9);
    pb.line(xs[0]! - 20, ys[0]! - 20, xs[0]! + 100, midY);
    pb.line(xs[0]! - 20, ys[3]! + 20, xs[0]! + 100, midY);
    pb.line(xs[4]! + 20, ys[0]! - 20, xs[4]! - 100, midY);
    pb.line(xs[4]! + 20, ys[3]! + 20, xs[4]! - 100, midY);
    // Skylights & roof hatches.
    for (let k = 0; k < 3; k++) {
      const sx = xs[1]! + k * 190;
      pb.rect(sx, ys[0]! + 70, 90, 55);
      pb.line(sx, ys[0]! + 70, sx + 90, ys[0]! + 125);
      pb.line(sx + 90, ys[0]! + 70, sx, ys[0]! + 125);
      pb.text(sx + 10, ys[0]! + 140, `SKYLIGHT SK-0${k + 1}`, 8);
    }
    pb.rect(xs[2]! + 30, ys[2]! + 40, 140, 90);
    pb.hatchRect(xs[2]! + 30, ys[2]! + 40, 140, 90, 14);
    pb.text(xs[2]! + 40, ys[2]! + 145, 'SOLAR ARRAY ZONE', 9);
    pb.text(xs[1]! + 120, midY - 10, 'RIDGE RL +11.450 (FALL 1:40)', 9);
    return;
  }

  if (variant === 'demolition') {
    // Existing site boundaries + dashed demolition zones + tree protection circles.
    pb.dash(6, 3);
    pb.lineWidth(1.0);
    pb.rect(xs[0]! + 30, ys[0]! + 40, 360, 260);
    pb.hatchRect(xs[0]! + 30, ys[0]! + 40, 360, 260, 16);
    pb.rect(xs[2]! + 50, ys[1]! + 60, 280, 240);
    pb.solid();
    pb.text(xs[0]! + 95, ys[0]! + 175, 'DEMOLISH EXISTING SHED', 10);
    pb.text(xs[2]! + 80, ys[1]! + 185, 'REMOVE PAVING TO RL 98.2', 9);
    for (let k = 0; k < 5; k++) {
      const tx = xs[0]! + 60 + k * 175;
      const ty = ys[2]! + 110 + (k % 2) * 35;
      pb.circle(tx, ty, 32);
      pb.circle(tx, ty, 8);
      pb.text(tx - 16, ty + 46, `TPZ-0${k + 1}`, 7.5);
    }
    return;
  }

  if (variant === 'sections') {
    // Two long building cross-sections stacked vertically.
    for (let s = 0; s < 2; s++) {
      const base = oy + 290 + s * 340;
      pb.lineWidth(1.6);
      pb.line(ox + 60, base, ox + 900, base); // ground line
      pb.lineWidth(1.1);
      pb.rect(ox + 140, base - 180, 660, 180);
      pb.line(ox + 140, base - 95, ox + 800, base - 95); // level 1 slab
      // Roof truss profile.
      pb.polyline([
        [ox + 120, base - 180],
        [ox + 470, base - 255],
        [ox + 820, base - 180],
      ]);
      for (let k = 0; k < 5; k++) {
        const vx = ox + 220 + k * 125;
        pb.line(vx, base - 180, vx, base - 180 - (k <= 2 ? (k + 1) * 22 : (5 - k) * 22));
      }
      pb.text(ox + 160, base - 110, s === 0 ? 'SECTION AA - NORTH-SOUTH' : 'SECTION BB - EAST-WEST', 11);
      pb.text(ox + 160, base - 20, 'FFL +0.000', 8);
      pb.text(ox + 160, base - 102, 'LEVEL 1 +3.600', 8);
      pb.text(ox + 580, base - 195, 'EAVES +7.200', 8);
    }
    return;
  }

  // Default architectural floor plan: main building (A..D, 1..4) + optional east annex (D..E, 1..3).
  const mainX0 = xs[0]!;
  const mainX1 = xs[3]!;
  const mainY0 = ys[0]!;
  const mainY1 = ys[3]!;

  // Exterior walls of main building.
  pb.wall(mainX0, mainY0, mainX1, mainY0, 8);
  pb.wall(mainX0, mainY1, mainX1, mainY1, 8);
  pb.wall(mainX0, mainY0, mainX0, mainY1, 8);
  pb.wall(mainX1, mainY0, mainX1, mainY1, 8);

  // Interior corridor & room partitions.
  pb.wall(mainX0, ys[1]!, mainX1, ys[1]!, 5);
  pb.wall(mainX0, ys[2]!, mainX1, ys[2]!, 5);
  pb.wall(xs[1]!, mainY0, xs[1]!, ys[1]!, 5);
  pb.wall(xs[2]!, mainY0, xs[2]!, ys[1]!, 5);
  pb.wall(xs[2]!, ys[2]!, xs[2]!, mainY1, 5);
  // Optional removable interior partition & Door D-14 between Office 102 and Meeting 103.
  if (!opts.omitDoor14) {
    pb.wall(xs[1]!, ys[2]!, xs[1]!, mainY1, 5);
    pb.door(xs[1]!, ys[2]! + 55, 34, 0, 'D-14');
  }

  // Doors across main building.
  pb.door(xs[0]! + 75, ys[1]!, 36, 0, 'D-01');
  pb.door(xs[1]! + 80, ys[1]!, 36, 0, 'D-02');
  pb.door(xs[2]! + 75, ys[1]!, 36, 0, 'D-03');
  pb.door(xs[2]! + 60, ys[2]!, 36, 270, 'D-04');

  // Room labels.
  pb.text(xs[0]! + 45, ys[0]! + 95, 'LOBBY 101', 11);
  pb.text(xs[1]! + 45, ys[0]! + 95, 'OFFICE 102', 11);
  pb.text(xs[2]! + 45, ys[0]! + 95, 'MEETING 103', 11);
  pb.text(xs[1]! + 110, ys[1]! + 105, 'MAIN CORRIDOR 104', 11);
  pb.text(xs[0]! + 45, ys[2]! + 95, 'PLANT ROOM 105', 10);
  pb.text(xs[1]! + 45, ys[2]! + 95, 'WORKSHOP 106', 10);
  pb.text(xs[2]! + 45, ys[2]! + 95, 'ARCHIVE 107', 10);

  // Equipment symbols (AHU-1, DB-01, optional RTU-2).
  pb.rect(xs[0]! + 30, ys[2]! + 125, 78, 42);
  pb.line(xs[0]! + 30, ys[2]! + 125, xs[0]! + 108, ys[2]! + 167);
  pb.line(xs[0]! + 108, ys[2]! + 125, xs[0]! + 30, ys[2]! + 167);
  pb.text(xs[0]! + 46, ys[2]! + 120, 'AHU-01', 8);

  pb.rect(xs[2]! + 125, ys[2]! + 125, 58, 36);
  pb.hatchRect(xs[2]! + 125, ys[2]! + 125, 58, 36, 8);
  pb.text(xs[2]! + 132, ys[2]! + 120, 'DB-01', 8);

  if (!opts.omitRtu2) {
    pb.rect(xs[1]! + 120, ys[1]! + 35, 68, 40);
    pb.line(xs[1]! + 120, ys[1]! + 35, xs[1]! + 188, ys[1]! + 75);
    pb.text(xs[1]! + 132, ys[1]! + 30, 'RTU-02', 8);
  }

  // East annex wing (D..E, 1..3) — optionally demolished/deleted.
  if (!opts.omitAnnex) {
    pb.wall(xs[3]!, ys[0]!, xs[4]!, ys[0]!, 8);
    pb.wall(xs[4]!, ys[0]!, xs[4]!, ys[2]!, 8);
    pb.wall(xs[3]!, ys[2]!, xs[4]!, ys[2]!, 8);
    pb.wall(xs[3]!, ys[1]!, xs[4]!, ys[1]!, 5);
    pb.door(xs[3]!, ys[0]! + 75, 34, 90, 'D-08');
    pb.door(xs[3]!, ys[1]! + 75, 34, 90, 'D-09');
    pb.text(xs[3]! + 42, ys[0]! + 95, 'ANNEX NORTH 108', 9.5);
    pb.text(xs[3]! + 42, ys[1]! + 95, 'ANNEX SOUTH 109', 9.5);
    pb.rect(xs[3]! + 100, ys[1]! + 125, 64, 40);
    pb.text(xs[3]! + 108, ys[1]! + 120, 'CHILLER-1', 7.5);
  }

  // Exterior dimensions and detail callouts.
  pb.dimension(xs[0]!, oy + 722, xs[1]!, oy + 722, '6000');
  pb.dimension(xs[1]!, oy + 722, xs[2]!, oy + 722, '6300');
  pb.dimension(xs[2]!, oy + 722, xs[3]!, oy + 722, '6300');
  pb.calloutBubble(xs[1]! + 25, ys[0]! + 20, '1', 'D-301', 15);
  pb.calloutBubble(xs[2]! + 150, ys[2]! + 35, '2', 'D-301', 15);

  // Subtle deterministic furniture/fixture details for realistic ink density.
  pb.lineWidth(0.45);
  for (let k = 0; k < 6; k++) {
    const fx = xs[1]! + 30 + (k % 3) * 52 + rnd() * 2;
    const fy = ys[0]! + 120 + Math.floor(k / 3) * 32;
    pb.rect(fx, fy, 36, 18);
  }

  if (opts.extraNote) {
    pb.lineWidth(0.7);
    pb.rect(xs[0]! + 15, ys[1]! + 140, 145, 30);
    pb.text(xs[0]! + 22, ys[1]! + 158, 'REV B: VERIFY FIRE SEAL', 7.5);
  }
}

/** Framed construction detail inside a 320 × 260 pt box at `(x, y)`. */
function drawDetailBox(
  pb: PageBuilder,
  x: number,
  y: number,
  kind:
    | 'footing-strip'
    | 'footing-piled'
    | 'parapet-v1'
    | 'parapet-v2'
    | 'slab-edge'
    | 'window-head-v1'
    | 'window-head-v2'
    | 'canopy',
  label: string,
  lintelShift = -28,
) {
  const W = 320;
  const H = 260;
  pb.lineWidth(0.9);
  pb.rect(x, y, W, H);
  pb.line(x, y + H - 28, x + W, y + H - 28);
  pb.text(x + 12, y + H - 10, label, 9.5);

  if (kind === 'footing-strip') {
    // Classic concrete strip footing with masonry wall stem and keyway.
    pb.lineWidth(1.2);
    pb.rect(x + 130, y + 35, 60, 110); // wall stem
    pb.hatchRect(x + 130, y + 35, 60, 110, 10);
    pb.rect(x + 65, y + 145, 190, 55); // footing pad
    pb.hatchRect(x + 65, y + 145, 190, 55, 12);
    pb.rect(x + 148, y + 145, 24, 14); // keyway
    pb.text(x + 18, y + 72, '190 BLOCK WALL', 7.5);
    pb.text(x + 18, y + 172, '600x250 STRIP FTG', 7.5);
    pb.text(x + 210, y + 128, 'KEYWAY 50x40', 7.5);
    pb.dimension(x + 65, y + 214, x + 255, y + 214, '600');
  } else if (kind === 'footing-piled') {
    // Redesigned deep pile cap + twin bored piles (completely different geometry).
    pb.lineWidth(1.2);
    pb.rect(x + 142, y + 22, 36, 75); // steel column stub
    pb.rect(x + 48, y + 97, 224, 48); // wide pile cap
    pb.rect(x + 76, y + 145, 42, 74); // left pile
    pb.rect(x + 202, y + 145, 42, 74); // right pile
    for (let i = 0; i < 6; i++) {
      pb.circle(x + 66 + i * 36, y + 128, 4, true);
    }
    pb.text(x + 18, y + 52, '250UC73 COLUMN', 7.5);
    pb.text(x + 18, y + 88, 'PILE CAP 1400x450', 7.5);
    pb.text(x + 126, y + 186, '450 DIA BORED PILES', 7.5);
  } else if (kind === 'parapet-v1' || kind === 'parapet-v2') {
    // Parapet coping detail: v2 keeps same shape with minor insulation text update & 2pt cap tweak.
    const capShift = kind === 'parapet-v2' ? 2 : 0;
    pb.lineWidth(1.2);
    pb.rect(x + 115, y + 55 + capShift, 90, 18); // metal coping cap
    pb.rect(x + 125, y + 73, 70, 130); // parapet wall
    pb.hatchRect(x + 125, y + 73, 70, 130, 10);
    pb.rect(x + 40, y + 150, 85, 32); // roof slab
    pb.rect(x + 40, y + 132, 85, 18); // insulation layer
    pb.line(x + 40, y + 128, x + 125, y + 128); // membrane
    pb.text(x + 215, y + 66, 'ALUM COPING', 7.5);
    pb.text(x + 20, y + 118, kind === 'parapet-v1' ? '75MM PIR INSUL' : '100MM PIR INSUL', 7.5);
    pb.text(x + 208, y + 145, 'TPO MEMBRANE', 7.5);
  } else if (kind === 'slab-edge') {
    pb.lineWidth(1.2);
    pb.polyline(
      [
        [x + 40, y + 80],
        [x + 230, y + 80],
        [x + 230, y + 175],
        [x + 175, y + 175],
        [x + 175, y + 130],
        [x + 40, y + 130],
        [x + 40, y + 80],
      ],
      true,
    );
    pb.hatchRect(x + 45, y + 85, 180, 42, 11);
    pb.line(x + 50, y + 100, x + 218, y + 100);
    pb.line(x + 218, y + 100, x + 218, y + 165);
    pb.text(x + 52, y + 66, '150 RC SLAB EDGE', 8);
    pb.text(x + 185, y + 195, 'EDGE BEAM 300x450', 7.5);
  } else if (kind === 'window-head-v1' || kind === 'window-head-v2') {
    // Window head: v2 raises lintel & flashing by `lintelShift` pt and changes mullion profile.
    const dy = kind === 'window-head-v2' ? lintelShift : 0;
    pb.lineWidth(1.2);
    pb.rect(x + 120, y + 25, 70, 82 + dy); // upper masonry
    pb.hatchRect(x + 120, y + 25, 70, 82 + dy, 10);
    pb.rect(x + 112, y + 107 + dy, 86, 16); // steel lintel
    pb.line(x + 105, y + 123 + dy, x + 210, y + 123 + dy); // head flashing
    pb.rect(x + 132, y + 123 + dy, 46, 26); // window head frame
    pb.line(x + 155, y + 149 + dy, x + 155, y + 215); // glazing line
    if (kind === 'window-head-v2') {
      pb.rect(x + 148, y + 149 + dy, 14, 66); // double-glazed deep mullion
    }
    pb.text(x + 204, y + 118 + dy, '150x90 LINTEL', 7.5);
    pb.text(x + 20, y + 132 + dy, 'HEAD FLASHING', 7.5);
    pb.text(x + 20, y + 182, kind === 'window-head-v1' ? 'SINGLE GLAZED' : 'DOUBLE GLAZED', 7.5);
  } else if (kind === 'canopy') {
    pb.lineWidth(1.2);
    pb.rect(x + 55, y + 40, 32, 165); // wall
    pb.hatchRect(x + 55, y + 40, 32, 165, 10);
    pb.polyline([
      [x + 87, y + 95],
      [x + 270, y + 122],
      [x + 270, y + 134],
      [x + 87, y + 112],
    ]);
    pb.line(x + 87, y + 58, x + 235, y + 118); // tie rod
    pb.text(x + 125, y + 78, 'M20 TIE ROD', 7.5);
    pb.text(x + 140, y + 150, 'ENTRY CANOPY 1800 PROJ', 7.5);
  }
}

/** Draws a concise static legend/notes box at `(x, y)` (300 × 220 pt). */
function drawNotesBlock(pb: PageBuilder, x: number, y: number) {
  pb.lineWidth(0.9);
  pb.rect(x, y, 300, 210);
  pb.text(x + 12, y + 22, 'GENERAL NOTES', 10);
  pb.line(x + 10, y + 28, x + 290, y + 28);
  const lines = [
    '1. DO NOT SCALE DRAWINGS.',
    '2. ALL DIMENSIONS IN MILLIMETRES.',
    '3. VERIFY EXISTING LEVELS ON SITE.',
    '4. FIRE RATED WALLS TO FRL 60/60/60.',
    '5. ACOUSTIC SEAL ALL PARTITIONS.',
    '6. REFER TO STRUCTURAL FOR FOOTINGS.',
  ];
  lines.forEach((t, i) => pb.text(x + 12, y + 52 + i * 24, t, 8));
}

/** Case 1: Unchanged control (minor title-block rev bump + small plot margin shift). */
function makeUnchangedCase(seed: number): RevisionPairFixture {
  const rnd = mulberry32(seed);
  const W = ARCH_C.width;
  const H = ARCH_C.height;

  // Sheet 0 (A-101): identical geometry, rev bump + small unrelated note, plan origin jittered by seed.
  const ox0 = 90 + randInt(rnd, -16, 16);
  const oy0 = 120 + randInt(rnd, -16, 16);
  const plan0Shift = translate(ox0 - 90, oy0 - 120);
  const old0 = new PageBuilder(W, H);
  old0.titleBlock('A-101', 'LEVEL 1 FLOOR PLAN', 'A', '1:100');
  drawFloorPlan(old0, ox0, oy0, { seed: seed + 1 });
  drawDetailBox(old0, 1140, 140, 'slab-edge', 'DETAIL 1 - SLAB EDGE');
  drawNotesBlock(old0, 1140, 460);

  const new0 = new PageBuilder(W, H);
  new0.titleBlock('A-101', 'LEVEL 1 FLOOR PLAN', 'B', '1:100');
  drawFloorPlan(new0, ox0, oy0, { seed: seed + 1, extraNote: true });
  drawDetailBox(new0, 1140, 140, 'slab-edge', 'DETAIL 1 - SLAB EDGE');
  drawNotesBlock(new0, 1140, 460);

  // Sheet 1 (A-102): re-plotted with a seed-driven plotter shift within maxShift.
  const shift = translate(randSign(rnd) * randInt(rnd, 10, 32), randSign(rnd) * randInt(rnd, 8, 24));
  const old1 = new PageBuilder(W, H);
  old1.titleBlock('A-102', 'LEVEL 2 FLOOR PLAN', 'A', '1:100');
  drawFloorPlan(old1, 90, 120, { seed: seed + 2 });
  drawDetailBox(old1, 1140, 140, 'parapet-v1', 'DETAIL 2 - PARAPET');

  const new1 = new PageBuilder(W, H);
  new1.withTransform(shift, () => {
    new1.titleBlock('A-102', 'LEVEL 2 FLOOR PLAN', 'B', '1:100');
    drawFloorPlan(new1, 90, 120, { seed: seed + 2 });
    drawDetailBox(new1, 1140, 140, 'parapet-v1', 'DETAIL 2 - PARAPET');
  });

  const s0Geoms: [string, CommentGeometry][] = [
    ['Lobby door D-01 swing', mapGeometry(plan0Shift, boxComment(225, 385, 65, 55))],
    ['Office 102 label & desks', mapGeometry(plan0Shift, boxComment(395, 295, 115, 75))],
    ['AHU-01 unit callout', mapGeometry(plan0Shift, calloutComment(225, 745, 290, 770))],
    ['DB-01 panel box', mapGeometry(plan0Shift, boxComment(690, 725, 85, 60))],
    ['Slab edge detail callout', boxComment(1180, 215, 185, 80)],
    ['General note 4', boxComment(1150, 570, 220, 32)],
  ];
  const s1Geoms: [string, CommentGeometry][] = [
    ['Door D-02 clearance', boxComment(430, 385, 65, 55)],
    ['Meeting 103 partition', boxComment(575, 230, 130, 75)],
    ['Corridor RTU-02 unit', boxComment(475, 435, 95, 60)],
    ['Annex North door D-08', calloutComment(795, 295, 845, 260)],
    ['Grid D-3 intersection', boxComment(765, 585, 50, 50)],
    ['Parapet detail coping', boxComment(1245, 185, 120, 45)],
  ];

  const comments: GroundTruthComment[] = [
    ...s0Geoms.map(([description, oldGeometry], i) => ({
      id: `unchanged-${i + 1}`,
      subcase: 'rev-bump',
      description,
      oldPage: 0,
      oldGeometry,
      expected: { newPage: 0, geometry: oldGeometry },
    })),
    ...s1Geoms.map(([description, oldGeometry], i) => ({
      id: `unchanged-${i + 7}`,
      subcase: 'plot-shift',
      description,
      oldPage: 1,
      oldGeometry,
      expected: { newPage: 1, geometry: mapGeometry(shift, oldGeometry) },
    })),
  ];

  return {
    id: 'unchanged',
    label: 'Unchanged control',
    pairBySheet: true,
    oldPdf: buildPdf([old0, old1]),
    newPdf: buildPdf([new0, new1]),
    oldSheets: ['A-101', 'A-102'],
    newSheets: ['A-101', 'A-102'],
    sheetPairs: [
      { oldPage: 0, newPage: 0 },
      { oldPage: 1, newPage: 1 },
    ],
    comments,
  };
}

/** Case 2: Moved views (one detail moved across sheet; whole plan shifted inside fixed border). */
function makeMovedViewsCase(seed: number): RevisionPairFixture {
  const rnd = mulberry32(seed);
  const W = ARCH_C.width;
  const H = ARCH_C.height;

  // Sheet 0 (A-103): Plan & Detail 1 stationary; Detail 2 moves into lower-mid slot by a seed-driven offset.
  const detailMove = translate(-360 + randInt(rnd, -40, 40), 330 + randInt(rnd, -30, 30));
  const old0 = new PageBuilder(W, H);
  old0.titleBlock('A-103', 'PLAN AND DETAILS', 'A', '1:100');
  drawFloorPlan(old0, 80, 100, { seed: seed + 10, omitAnnex: true });
  drawDetailBox(old0, 1180, 110, 'footing-strip', 'DETAIL 1 - FOOTING');
  drawDetailBox(old0, 1180, 410, 'parapet-v1', 'DETAIL 2 - PARAPET');

  const new0 = new PageBuilder(W, H);
  new0.titleBlock('A-103', 'PLAN AND DETAILS', 'B', '1:100');
  drawFloorPlan(new0, 80, 100, { seed: seed + 10, omitAnnex: true });
  drawDetailBox(new0, 1180, 110, 'footing-strip', 'DETAIL 1 - FOOTING');
  new0.withTransform(detailMove, () => {
    drawDetailBox(new0, 1180, 410, 'parapet-v1', 'DETAIL 2 - PARAPET');
  });

  // Sheet 1 (A-104): Main floor plan shifted inside fixed border/title block (> maxShift 72pt).
  const bigPlanMove = translate(randInt(rnd, 95, 150), randInt(rnd, 60, 105));
  const old1 = new PageBuilder(W, H);
  old1.titleBlock('A-104', 'WEST WING PLAN', 'A', '1:100');
  drawFloorPlan(old1, 90, 90, { seed: seed + 11 });

  const new1 = new PageBuilder(W, H);
  new1.titleBlock('A-104', 'WEST WING PLAN', 'B', '1:100');
  new1.withTransform(bigPlanMove, () => {
    drawFloorPlan(new1, 90, 90, { seed: seed + 11 });
  });

  // Sheet 2 (A-105): Plan shifted moderately inside fixed border/title block (within maxShift 72pt),
  // while the notes block stays stationary.
  const modPlanMove = translate(randSign(rnd) * randInt(rnd, 24, 54), randSign(rnd) * randInt(rnd, 18, 42));
  const old2 = new PageBuilder(W, H);
  old2.titleBlock('A-105', 'EAST WING PLAN', 'A', '1:100');
  drawFloorPlan(old2, 90, 140, { seed: seed + 12 });
  drawNotesBlock(old2, 1200, 140);

  const new2 = new PageBuilder(W, H);
  new2.titleBlock('A-105', 'EAST WING PLAN', 'B', '1:100');
  new2.withTransform(modPlanMove, () => {
    drawFloorPlan(new2, 90, 140, { seed: seed + 12 });
  });
  drawNotesBlock(new2, 1200, 140);

  const comments: GroundTruthComment[] = [];
  // Sheet 0: 3 stationary + 3 on moved Detail 2.
  const s0Fixed: [string, CommentGeometry][] = [
    ['Stationary plan Lobby 101', boxComment(200, 265, 110, 65)],
    ['Stationary plan AHU-01', boxComment(185, 705, 90, 55)],
    ['Stationary Detail 1 footing', boxComment(1245, 250, 190, 60)],
  ];
  s0Fixed.forEach(([description, oldGeometry], i) =>
    comments.push({ id: `moved-${i + 1}`, subcase: 'stationary-view', description, oldPage: 0, oldGeometry, expected: { newPage: 0, geometry: oldGeometry } }),
  );
  const s0Moved: [string, CommentGeometry][] = [
    ['Moved Detail 2 coping', boxComment(1290, 460, 100, 32)],
    ['Moved Detail 2 insulation', calloutComment(1260, 545, 1195, 515)],
    ['Moved Detail 2 parapet wall', boxComment(1300, 485, 80, 125)],
  ];
  s0Moved.forEach(([description, oldGeometry], i) =>
    comments.push({
      id: `moved-${i + 4}`,
      subcase: 'moved-detail',
      description,
      oldPage: 0,
      oldGeometry,
      expected: { newPage: 0, geometry: mapGeometry(detailMove, oldGeometry) },
    }),
  );

  // Sheet 1: 6 on far-shifted plan.
  const s1Moved: [string, CommentGeometry][] = [
    ['Far-shifted Lobby door D-01', boxComment(225, 355, 65, 55)],
    ['Far-shifted Office 102', boxComment(395, 265, 110, 70)],
    ['Far-shifted Meeting 103', boxComment(600, 265, 110, 70)],
    ['Far-shifted RTU-02', boxComment(475, 405, 95, 60)],
    ['Far-shifted AHU-01', boxComment(195, 695, 90, 55)],
    ['Far-shifted Annex North', boxComment(820, 265, 120, 65)],
  ];
  s1Moved.forEach(([description, oldGeometry], i) =>
    comments.push({
      id: `moved-${i + 7}`,
      subcase: 'plan-shift-large',
      description,
      oldPage: 1,
      oldGeometry,
      expected: { newPage: 1, geometry: mapGeometry(bigPlanMove, oldGeometry) },
    }),
  );

  // Sheet 2: 4 on moderately-shifted plan + 2 on stationary notes block.
  const s2Moved: [string, CommentGeometry][] = [
    ['Mod-shifted Lobby 101', boxComment(205, 305, 110, 65)],
    ['Mod-shifted Door D-03', boxComment(640, 405, 65, 55)],
    ['Mod-shifted DB-01', boxComment(690, 745, 85, 60)],
    ['Mod-shifted Annex Chiller', boxComment(885, 540, 80, 55)],
  ];
  s2Moved.forEach(([description, oldGeometry], i) =>
    comments.push({
      id: `moved-${i + 13}`,
      subcase: 'plan-shift-moderate',
      description,
      oldPage: 2,
      oldGeometry,
      expected: { newPage: 2, geometry: mapGeometry(modPlanMove, oldGeometry) },
    }),
  );
  const s2Fixed: [string, CommentGeometry][] = [
    ['Stationary General Note 2', boxComment(1210, 205, 220, 26)],
    ['Stationary General Note 5', boxComment(1210, 278, 220, 26)],
  ];
  s2Fixed.forEach(([description, oldGeometry], i) =>
    comments.push({ id: `moved-${i + 17}`, subcase: 'stationary-notes', description, oldPage: 2, oldGeometry, expected: { newPage: 2, geometry: oldGeometry } }),
  );

  return {
    id: 'moved-views',
    label: 'Moved views',
    pairBySheet: true,
    oldPdf: buildPdf([old0, old1, old2]),
    newPdf: buildPdf([new0, new1, new2]),
    oldSheets: ['A-103', 'A-104', 'A-105'],
    newSheets: ['A-103', 'A-104', 'A-105'],
    sheetPairs: [
      { oldPage: 0, newPage: 0 },
      { oldPage: 1, newPage: 1 },
      { oldPage: 2, newPage: 2 },
    ],
    comments,
  };
}

/** Case 3: Changed scale (paper-size rescale + in-sheet viewport rescale + single detail enlarge). */
function makeChangedScaleCase(seed: number): RevisionPairFixture {
  const rnd = mulberry32(seed);
  const W = ARCH_C.width;
  const H = ARCH_C.height;
  const kPaper = REDUCED_SHEET.width / ARCH_C.width; // 2/3
  const paperTransform: Affine = [
    kPaper,
    0,
    0,
    kPaper,
    randSign(rnd) * randInt(rnd, 4, 18),
    randSign(rnd) * randInt(rnd, 4, 14),
  ];

  // Sheet 0 (A-106): Whole sheet rescaled from ARCH C (1728×1296) to reduced (1152×864) + plot shift.
  const old0 = new PageBuilder(W, H);
  old0.titleBlock('A-106', 'GROUND FLOOR PLAN', 'A', '1:100');
  drawFloorPlan(old0, 90, 120, { seed: seed + 20 });
  drawDetailBox(old0, 1140, 140, 'slab-edge', 'DETAIL 1 - SLAB EDGE');

  const new0 = new PageBuilder(REDUCED_SHEET.width, REDUCED_SHEET.height);
  new0.withTransform(paperTransform, () => {
    new0.titleBlock('A-106', 'GROUND FLOOR PLAN', 'B', '1:150');
    drawFloorPlan(new0, 90, 120, { seed: seed + 20 });
    drawDetailBox(new0, 1140, 140, 'slab-edge', 'DETAIL 1 - SLAB EDGE');
  });

  // Sheet 1 (A-107): Same ARCH C paper & title block, plan viewport rescaled about its centre.
  const kPlan = Number(randRange(rnd, 1.15, 1.32).toFixed(2));
  const planScale = scaleAbout(570, 500, kPlan);
  const old1 = new PageBuilder(W, H);
  old1.titleBlock('A-107', 'ENLARGED FLOOR PLAN', 'A', '1:100');
  drawFloorPlan(old1, 90, 120, { seed: seed + 21 });

  const new1 = new PageBuilder(W, H);
  new1.titleBlock('A-107', 'ENLARGED FLOOR PLAN', 'B', '1:80');
  new1.withTransform(planScale, () => {
    drawFloorPlan(new1, 90, 120, { seed: seed + 21 });
  });

  // Sheet 2 (A-108): Same ARCH C paper, plan unchanged, Detail 1 enlarged inside its zone.
  const kDetail = Number(randRange(rnd, 1.25, 1.55).toFixed(2));
  const detailScale = scaleAbout(1300, 270, kDetail);
  const old2 = new PageBuilder(W, H);
  old2.titleBlock('A-108', 'PLAN AND ENLARGED DETAIL', 'A', '1:100 / 1:20');
  drawFloorPlan(old2, 90, 120, { seed: seed + 22, omitAnnex: true });
  drawDetailBox(old2, 1140, 140, 'footing-strip', 'DETAIL 1 - FOOTING');

  const new2 = new PageBuilder(W, H);
  new2.titleBlock('A-108', 'PLAN AND ENLARGED DETAIL', 'B', '1:100 / 1:15');
  drawFloorPlan(new2, 90, 120, { seed: seed + 22, omitAnnex: true });
  new2.withTransform(detailScale, () => {
    drawDetailBox(new2, 1140, 140, 'footing-strip', 'DETAIL 1 - FOOTING');
  });

  const comments: GroundTruthComment[] = [];
  const s0Geoms: [string, CommentGeometry][] = [
    ['Rescaled Lobby 101', boxComment(205, 290, 110, 65)],
    ['Rescaled Door D-02', boxComment(430, 385, 65, 55)],
    ['Rescaled Meeting 103', boxComment(610, 290, 115, 65)],
    ['Rescaled AHU-01', boxComment(195, 725, 90, 55)],
    ['Rescaled DB-01', boxComment(690, 725, 85, 60)],
    ['Rescaled Slab Edge detail', boxComment(1180, 215, 185, 80)],
  ];
  s0Geoms.forEach(([description, oldGeometry], i) =>
    comments.push({
      id: `scale-${i + 1}`,
      subcase: 'paper-rescale',
      description,
      oldPage: 0,
      oldGeometry,
      expected: { newPage: 0, geometry: mapGeometry(paperTransform, oldGeometry) },
    }),
  );

  const s1Geoms: [string, CommentGeometry][] = [
    ['Viewport-scaled Lobby 101', boxComment(205, 290, 110, 65)],
    ['Viewport-scaled Office 102', boxComment(405, 290, 110, 65)],
    ['Viewport-scaled Corridor', boxComment(480, 480, 130, 55)],
    ['Viewport-scaled AHU-01', boxComment(195, 725, 90, 55)],
    ['Viewport-scaled DB-01', boxComment(690, 725, 85, 60)],
    ['Viewport-scaled Annex North', boxComment(820, 290, 120, 65)],
  ];
  s1Geoms.forEach(([description, oldGeometry], i) =>
    comments.push({
      id: `scale-${i + 7}`,
      subcase: 'viewport-rescale',
      description,
      oldPage: 1,
      oldGeometry,
      expected: { newPage: 1, geometry: mapGeometry(planScale, oldGeometry) },
    }),
  );

  const s2Fixed: [string, CommentGeometry][] = [
    ['Unscaled plan Lobby', boxComment(205, 290, 110, 65)],
    ['Unscaled plan Door D-04', boxComment(630, 560, 60, 55)],
    ['Unscaled plan AHU-01', boxComment(195, 725, 90, 55)],
  ];
  s2Fixed.forEach(([description, oldGeometry], i) =>
    comments.push({ id: `scale-${i + 13}`, subcase: 'unchanged-view', description, oldPage: 2, oldGeometry, expected: { newPage: 2, geometry: oldGeometry } }),
  );
  const s2Enlarged: [string, CommentGeometry][] = [
    ['Enlarged footing wall stem', boxComment(1265, 175, 70, 110)],
    ['Enlarged footing pad', boxComment(1205, 285, 190, 55)],
    ['Enlarged footing keyway', calloutComment(1300, 292, 1365, 255)],
  ];
  s2Enlarged.forEach(([description, oldGeometry], i) =>
    comments.push({
      id: `scale-${i + 16}`,
      subcase: 'detail-rescale',
      description,
      oldPage: 2,
      oldGeometry,
      expected: { newPage: 2, geometry: mapGeometry(detailScale, oldGeometry) },
    }),
  );

  return {
    id: 'changed-scale',
    label: 'Changed scale',
    pairBySheet: true,
    oldPdf: buildPdf([old0, old1, old2]),
    newPdf: buildPdf([new0, new1, new2]),
    oldSheets: ['A-106', 'A-107', 'A-108'],
    newSheets: ['A-106', 'A-107', 'A-108'],
    sheetPairs: [
      { oldPage: 0, newPage: 0 },
      { oldPage: 1, newPage: 1 },
      { oldPage: 2, newPage: 2 },
    ],
    comments,
  };
}

/**
 * Case 4: Renumbered sheets.
 * Old set: S-101 (arch plan), S-102 (framing), S-103 (roof), S-104 (sections).
 * New set: S-101 (arch plan, kept), S-102 (NEW demolition plan!), S-103 (old framing),
 *          S-104 (old roof), S-201 (old sections, renamed).
 */
function makeRenumberedSheetsCase(seed: number): RevisionPairFixture {
  const rnd = mulberry32(seed);
  const W = ARCH_C.width;
  const H = ARCH_C.height;

  const makeSheet = (
    sheetNo: string,
    title: string,
    rev: string,
    variant: 'architectural' | 'framing' | 'roof' | 'demolition' | 'sections',
    s: number,
    shift: Affine = IDENTITY,
  ) => {
    const pb = new PageBuilder(W, H);
    pb.withTransform(shift, () => {
      pb.titleBlock(sheetNo, title, rev, '1:100');
      drawFloorPlan(pb, 90, 120, { seed: s, variant });
    });
    return pb;
  };

  const s0Shift = translate(randSign(rnd) * randInt(rnd, 4, 16), randSign(rnd) * randInt(rnd, 4, 14));
  const s1Shift = translate(randSign(rnd) * randInt(rnd, 4, 16), randSign(rnd) * randInt(rnd, 4, 14));
  const s2Shift = translate(randSign(rnd) * randInt(rnd, 4, 16), randSign(rnd) * randInt(rnd, 4, 14));
  const s3Shift = translate(randSign(rnd) * randInt(rnd, 4, 16), randSign(rnd) * randInt(rnd, 4, 14));

  const oldPages = [
    makeSheet('S-101', 'GROUND FLOOR LAYOUT', 'A', 'architectural', seed + 30),
    makeSheet('S-102', 'STEEL FRAMING PLAN', 'A', 'framing', seed + 31),
    makeSheet('S-103', 'ROOF PLAN', 'A', 'roof', seed + 32),
    makeSheet('S-104', 'BUILDING SECTIONS', 'A', 'sections', seed + 33),
  ];

  const newPages = [
    makeSheet('S-101', 'GROUND FLOOR LAYOUT', 'B', 'architectural', seed + 30, s0Shift),
    makeSheet('S-102', 'DEMOLITION PLAN', 'B', 'demolition', seed + 34),
    makeSheet('S-103', 'STEEL FRAMING PLAN', 'B', 'framing', seed + 31, s1Shift),
    makeSheet('S-104', 'ROOF PLAN', 'B', 'roof', seed + 32, s2Shift),
    makeSheet('S-201', 'BUILDING SECTIONS', 'B', 'sections', seed + 33, s3Shift),
  ];

  const comments: GroundTruthComment[] = [
    // Old 0 (S-101) -> New 0 (S-101): sheet number unchanged.
    ...[
      ['S-101 Lobby 101', boxComment(205, 290, 110, 65)],
      ['S-101 Office 102', boxComment(405, 290, 110, 65)],
      ['S-101 AHU-01', boxComment(195, 725, 90, 55)],
      ['S-101 DB-01', boxComment(690, 725, 85, 60)],
    ].map(([description, oldGeometry], i) => ({
      id: `renum-${i + 1}`,
      subcase: 'same-number',
      description: description as string,
      oldPage: 0,
      oldGeometry: oldGeometry as CommentGeometry,
      expected: { newPage: 0, geometry: mapGeometry(s0Shift, oldGeometry as CommentGeometry) },
    })),
    // Old 1 (S-102 framing) -> New 2 (now S-103 framing): number collided with new Demolition S-102.
    ...[
      ['S-102 Primary girder', boxComment(185, 210, 175, 45)],
      ['S-102 Bracing bay B2', boxComment(370, 410, 210, 200)],
      ['S-102 Secondary beam', boxComment(420, 320, 95, 60)],
      ['S-102 Slab depression', boxComment(790, 675, 165, 55)],
    ].map(([description, oldGeometry], i) => ({
      id: `renum-${i + 5}`,
      subcase: 'number-collision',
      description: description as string,
      oldPage: 1,
      oldGeometry: oldGeometry as CommentGeometry,
      expected: { newPage: 2, geometry: mapGeometry(s1Shift, oldGeometry as CommentGeometry) },
    })),
    // Old 2 (S-103 roof) -> New 3 (now S-104 roof): number collided with shifted Framing S-103.
    ...[
      ['S-103 Skylight SK-01', boxComment(365, 275, 100, 75)],
      ['S-103 Skylight SK-02', boxComment(555, 275, 100, 75)],
      ['S-103 Ridge RL note', boxComment(475, 470, 195, 42)],
      ['S-103 Solar array zone', boxComment(605, 645, 150, 105)],
    ].map(([description, oldGeometry], i) => ({
      id: `renum-${i + 9}`,
      subcase: 'number-collision',
      description: description as string,
      oldPage: 2,
      oldGeometry: oldGeometry as CommentGeometry,
      expected: { newPage: 3, geometry: mapGeometry(s2Shift, oldGeometry as CommentGeometry) },
    })),
    // Old 3 (S-104 sections) -> New 4 (renamed S-201): no S-104 partner for sections.
    ...[
      ['S-104 Section AA roof truss', boxComment(410, 155, 240, 85)],
      ['S-104 Section AA Level 1', boxComment(230, 285, 160, 50)],
      ['S-104 Section BB eaves', boxComment(640, 535, 140, 55)],
      ['S-104 Section BB ground', boxComment(230, 710, 180, 45)],
    ].map(([description, oldGeometry], i) => ({
      id: `renum-${i + 13}`,
      subcase: 'number-renamed',
      description: description as string,
      oldPage: 3,
      oldGeometry: oldGeometry as CommentGeometry,
      expected: { newPage: 4, geometry: mapGeometry(s3Shift, oldGeometry as CommentGeometry) },
    })),
  ];

  return {
    id: 'renumbered-sheets',
    label: 'Renumbered sheets',
    pairBySheet: true,
    oldPdf: buildPdf(oldPages),
    newPdf: buildPdf(newPages),
    oldSheets: ['S-101', 'S-102', 'S-103', 'S-104'],
    newSheets: ['S-101', 'S-102', 'S-103', 'S-104', 'S-201'],
    sheetPairs: [
      { oldPage: 0, newPage: 0 },
      { oldPage: 1, newPage: 2 },
      { oldPage: 2, newPage: 3 },
      { oldPage: 3, newPage: 4 },
    ],
    comments,
  };
}

/** Case 5: Redrawn details (unchanged, lightly edited, reworked-shifted, and redesigned-away). */
function makeRedrawnDetailsCase(seed: number): RevisionPairFixture {
  const rnd = mulberry32(seed);
  const W = ARCH_C.width;
  const H = ARCH_C.height;

  // Seed-driven detail slot jitter, lintel raise amount, and Sheet 1 plotter shift.
  const jx = randInt(rnd, -24, 24);
  const jy = randInt(rnd, -20, 20);
  const lintelDy = -randInt(rnd, 20, 36);
  const s1dx = randSign(rnd) * randInt(rnd, 6, 24);
  const s1dy = randSign(rnd) * randInt(rnd, 6, 20);
  const s1Shift = translate(s1dx, s1dy);

  const slot = (bx: number, by: number): [number, number] => [bx + jx, by + jy];
  const slotShift = translate(jx, jy);

  // Sheet 0 (D-301): 4 details — Slab Edge (unchanged), Footing (redesigned to piles),
  // Parapet (lightly edited spec), Window Head (reworked, lintel raised by lintelDy).
  const old0 = new PageBuilder(W, H);
  old0.titleBlock('D-301', 'TYPICAL BUILDING DETAILS', 'A', '1:10');
  drawDetailBox(old0, ...slot(120, 120), 'slab-edge', 'DETAIL 1 - SLAB EDGE');
  drawDetailBox(old0, ...slot(520, 120), 'footing-strip', 'DETAIL 2 - WALL FOOTING');
  drawDetailBox(old0, ...slot(120, 460), 'parapet-v1', 'DETAIL 3 - PARAPET COPING');
  drawDetailBox(old0, ...slot(520, 460), 'window-head-v1', 'DETAIL 4 - WINDOW HEAD', lintelDy);
  drawNotesBlock(old0, 960, 120);

  const new0 = new PageBuilder(W, H);
  new0.titleBlock('D-301', 'TYPICAL BUILDING DETAILS', 'B', '1:10');
  drawDetailBox(new0, ...slot(120, 120), 'slab-edge', 'DETAIL 1 - SLAB EDGE');
  drawDetailBox(new0, ...slot(520, 120), 'footing-piled', 'DETAIL 2 - PILED FOOTING');
  drawDetailBox(new0, ...slot(120, 460), 'parapet-v2', 'DETAIL 3 - PARAPET COPING');
  drawDetailBox(new0, ...slot(520, 460), 'window-head-v2', 'DETAIL 4 - WINDOW HEAD', lintelDy);
  drawNotesBlock(new0, 960, 120);

  // Sheet 1 (D-302): Second detail sheet with seed-driven plot shift and another set of edits.
  const old1 = new PageBuilder(W, H);
  old1.titleBlock('D-302', 'ENVELOPE DETAILS', 'A', '1:10');
  drawDetailBox(old1, ...slot(120, 120), 'canopy', 'DETAIL 5 - ENTRY CANOPY');
  drawDetailBox(old1, ...slot(520, 120), 'window-head-v1', 'DETAIL 6 - EAST WINDOW HEAD', lintelDy);
  drawDetailBox(old1, ...slot(120, 460), 'footing-strip', 'DETAIL 7 - NORTH FOOTING');
  drawDetailBox(old1, ...slot(520, 460), 'parapet-v1', 'DETAIL 8 - ROOF PARAPET');

  const new1 = new PageBuilder(W, H);
  new1.withTransform(s1Shift, () => {
    new1.titleBlock('D-302', 'ENVELOPE DETAILS', 'B', '1:10');
    drawDetailBox(new1, ...slot(120, 120), 'canopy', 'DETAIL 5 - ENTRY CANOPY');
    drawDetailBox(new1, ...slot(520, 120), 'window-head-v2', 'DETAIL 6 - EAST WINDOW HEAD', lintelDy);
    drawDetailBox(new1, ...slot(120, 460), 'footing-piled', 'DETAIL 7 - NORTH PILED FOOTING');
    drawDetailBox(new1, ...slot(520, 460), 'parapet-v2', 'DETAIL 8 - ROOF PARAPET');
  });

  const lintelUp = translate(0, lintelDy);
  const lintelUpS1 = translate(s1dx, s1dy + lintelDy);
  const sBox = (x: number, y: number, w: number, h: number) => mapGeometry(slotShift, boxComment(x, y, w, h));

  const comments: GroundTruthComment[] = [
    // Unchanged details (4 comments).
    { id: 'redrawn-1', subcase: 'unchanged-detail', description: 'D-301 Slab edge top bar', oldPage: 0, oldGeometry: sBox(165, 195, 180, 55), expected: { newPage: 0, geometry: sBox(165, 195, 180, 55) } },
    { id: 'redrawn-2', subcase: 'unchanged-detail', description: 'D-301 Slab edge beam', oldPage: 0, oldGeometry: sBox(290, 250, 75, 55), expected: { newPage: 0, geometry: sBox(290, 250, 75, 55) } },
    { id: 'redrawn-3', subcase: 'unchanged-detail', description: 'D-302 Canopy tie rod', oldPage: 1, oldGeometry: sBox(210, 175, 145, 55), expected: { newPage: 1, geometry: mapGeometry(s1Shift, sBox(210, 175, 145, 55)) } },
    { id: 'redrawn-4', subcase: 'unchanged-detail', description: 'D-302 Canopy projection', oldPage: 1, oldGeometry: sBox(210, 215, 180, 55), expected: { newPage: 1, geometry: mapGeometry(s1Shift, sBox(210, 215, 180, 55)) } },
    // Lightly edited details — parapet (4 comments, geometry still valid).
    { id: 'redrawn-5', subcase: 'minor-edit', description: 'D-301 Parapet coping', oldPage: 0, oldGeometry: sBox(230, 510, 105, 30), expected: { newPage: 0, geometry: sBox(230, 510, 105, 30) } },
    { id: 'redrawn-6', subcase: 'minor-edit', description: 'D-301 Parapet membrane', oldPage: 0, oldGeometry: sBox(155, 580, 110, 45), expected: { newPage: 0, geometry: sBox(155, 580, 110, 45) } },
    { id: 'redrawn-7', subcase: 'minor-edit', description: 'D-302 Parapet coping', oldPage: 1, oldGeometry: sBox(630, 510, 105, 30), expected: { newPage: 1, geometry: mapGeometry(s1Shift, sBox(630, 510, 105, 30)) } },
    { id: 'redrawn-8', subcase: 'minor-edit', description: 'D-302 Parapet roof slab', oldPage: 1, oldGeometry: sBox(555, 605, 100, 45), expected: { newPage: 1, geometry: mapGeometry(s1Shift, sBox(555, 605, 100, 45)) } },
    // Moderately reworked details — window head raised by lintelDy (4 comments, target shifted).
    { id: 'redrawn-9', subcase: 'reworked-shifted', description: 'D-301 Window lintel', oldPage: 0, oldGeometry: sBox(628, 562, 100, 28), expected: { newPage: 0, geometry: mapGeometry(lintelUp, sBox(628, 562, 100, 28)) } },
    { id: 'redrawn-10', subcase: 'reworked-shifted', description: 'D-301 Head flashing', oldPage: 0, oldGeometry: sBox(535, 575, 105, 25), expected: { newPage: 0, geometry: mapGeometry(lintelUp, sBox(535, 575, 105, 25)) } },
    { id: 'redrawn-11', subcase: 'reworked-shifted', description: 'D-302 East lintel', oldPage: 1, oldGeometry: sBox(628, 222, 100, 28), expected: { newPage: 1, geometry: mapGeometry(lintelUpS1, sBox(628, 222, 100, 28)) } },
    { id: 'redrawn-12', subcase: 'reworked-shifted', description: 'D-302 East head frame', oldPage: 1, oldGeometry: sBox(645, 240, 62, 34), expected: { newPage: 1, geometry: mapGeometry(lintelUpS1, sBox(645, 240, 62, 34)) } },
    // Heavily redesigned details — strip footing replaced by bored piles (4 comments, no valid position).
    { id: 'redrawn-13', subcase: 'redesigned-gone', description: 'D-301 Strip footing keyway', oldPage: 0, oldGeometry: sBox(662, 260, 42, 28), expected: null },
    { id: 'redrawn-14', subcase: 'redesigned-gone', description: 'D-301 Block wall stem', oldPage: 0, oldGeometry: sBox(645, 155, 72, 105), expected: null },
    { id: 'redrawn-15', subcase: 'redesigned-gone', description: 'D-302 Strip footing pad', oldPage: 1, oldGeometry: sBox(185, 602, 190, 58), expected: null },
    { id: 'redrawn-16', subcase: 'redesigned-gone', description: 'D-302 Footing keyway', oldPage: 1, oldGeometry: sBox(262, 600, 42, 28), expected: null },
  ];

  return {
    id: 'redrawn-details',
    label: 'Redrawn details',
    pairBySheet: true,
    oldPdf: buildPdf([old0, old1]),
    newPdf: buildPdf([new0, new1]),
    oldSheets: ['D-301', 'D-302'],
    newSheets: ['D-301', 'D-302'],
    sheetPairs: [
      { oldPage: 0, newPage: 0 },
      { oldPage: 1, newPage: 1 },
    ],
    comments,
  };
}

/** Case 6: Deleted content (large wing/detail deletions + small local partition/equipment deletions + surviving control comments). */
function makeDeletedContentCase(seed: number): RevisionPairFixture {
  const rnd = mulberry32(seed);
  const W = ARCH_C.width;
  const H = ARCH_C.height;

  // Seed-driven plot shifts and detail slot assignment (top vs bottom deleted detail).
  const s0Shift = translate(randSign(rnd) * randInt(rnd, 4, 18), randSign(rnd) * randInt(rnd, 4, 14));
  const s1Shift = translate(randSign(rnd) * randInt(rnd, 8, 26), randSign(rnd) * randInt(rnd, 8, 22));
  const canopyOnTop = rnd() < 0.5;
  const slabY = canopyOnTop ? 460 : 140;
  const canopyY = canopyOnTop ? 140 : 460;

  // Sheet 0 (A-109): East Annex wing deleted (blank paper) AND interior partition + Door D-14 deleted.
  const old0 = new PageBuilder(W, H);
  old0.titleBlock('A-109', 'REVISED LEVEL 1 PLAN', 'A', '1:100');
  drawFloorPlan(old0, 90, 120, { seed: seed + 50, omitAnnex: false, omitDoor14: false });
  drawNotesBlock(old0, 1200, 140);

  const new0 = new PageBuilder(W, H);
  new0.withTransform(s0Shift, () => {
    new0.titleBlock('A-109', 'REVISED LEVEL 1 PLAN', 'B', '1:100');
    drawFloorPlan(new0, 90, 120, { seed: seed + 50, omitAnnex: true, omitDoor14: true });
    drawNotesBlock(new0, 1200, 140);
  });

  // Sheet 1 (A-110): RTU-02 removed from corridor AND Detail 4 Canopy deleted completely from right column.
  const old1 = new PageBuilder(W, H);
  old1.titleBlock('A-110', 'MECHANICAL AND CANOPY PLAN', 'A', '1:100');
  drawFloorPlan(old1, 90, 120, { seed: seed + 51, omitAnnex: true, omitRtu2: false });
  drawDetailBox(old1, 1140, slabY, 'slab-edge', 'DETAIL 1 - SLAB EDGE');
  drawDetailBox(old1, 1140, canopyY, 'canopy', 'DETAIL 4 - ENTRY CANOPY');

  const new1 = new PageBuilder(W, H);
  new1.withTransform(s1Shift, () => {
    new1.titleBlock('A-110', 'MECHANICAL AND CANOPY PLAN', 'B', '1:100');
    drawFloorPlan(new1, 90, 120, { seed: seed + 51, omitAnnex: true, omitRtu2: true });
    drawDetailBox(new1, 1140, slabY, 'slab-edge', 'DETAIL 1 - SLAB EDGE');
    // Detail 4 Canopy deleted — blank space.
  });

  const slabShift = translate(0, slabY - 140);
  const canopyShift = translate(0, canopyY - 460);

  const comments: GroundTruthComment[] = [
    // Surviving comments on the same sheets (6 comments).
    { id: 'deleted-1', subcase: 'surviving', description: 'A-109 Lobby 101', oldPage: 0, oldGeometry: boxComment(205, 290, 110, 65), expected: { newPage: 0, geometry: mapGeometry(s0Shift, boxComment(205, 290, 110, 65)) } },
    { id: 'deleted-2', subcase: 'surviving', description: 'A-109 Office 102', oldPage: 0, oldGeometry: boxComment(405, 290, 110, 65), expected: { newPage: 0, geometry: mapGeometry(s0Shift, boxComment(405, 290, 110, 65)) } },
    { id: 'deleted-3', subcase: 'surviving', description: 'A-109 AHU-01', oldPage: 0, oldGeometry: boxComment(195, 725, 90, 55), expected: { newPage: 0, geometry: mapGeometry(s0Shift, boxComment(195, 725, 90, 55)) } },
    { id: 'deleted-4', subcase: 'surviving', description: 'A-110 Door D-01', oldPage: 1, oldGeometry: boxComment(225, 385, 65, 55), expected: { newPage: 1, geometry: mapGeometry(s1Shift, boxComment(225, 385, 65, 55)) } },
    { id: 'deleted-5', subcase: 'surviving', description: 'A-110 DB-01', oldPage: 1, oldGeometry: boxComment(690, 725, 85, 60), expected: { newPage: 1, geometry: mapGeometry(s1Shift, boxComment(690, 725, 85, 60)) } },
    { id: 'deleted-6', subcase: 'surviving', description: 'A-110 Slab Edge detail', oldPage: 1, oldGeometry: mapGeometry(slabShift, boxComment(1180, 215, 185, 80)), expected: { newPage: 1, geometry: mapGeometry(s1Shift, mapGeometry(slabShift, boxComment(1180, 215, 185, 80))) } },
    // Large deletions (6 comments, expected: null).
    { id: 'deleted-7', subcase: 'deleted-wing', description: 'A-109 Annex North 108', oldPage: 0, oldGeometry: boxComment(825, 290, 120, 65), expected: null },
    { id: 'deleted-8', subcase: 'deleted-wing', description: 'A-109 Annex South 109', oldPage: 0, oldGeometry: boxComment(825, 490, 120, 65), expected: null },
    { id: 'deleted-9', subcase: 'deleted-wing', description: 'A-109 Annex Chiller-1', oldPage: 0, oldGeometry: boxComment(885, 520, 80, 55), expected: null },
    { id: 'deleted-10', subcase: 'deleted-detail', description: 'A-110 Canopy tie rod', oldPage: 1, oldGeometry: mapGeometry(canopyShift, boxComment(1225, 515, 145, 55)), expected: null },
    { id: 'deleted-11', subcase: 'deleted-detail', description: 'A-110 Canopy deck', oldPage: 1, oldGeometry: mapGeometry(canopyShift, boxComment(1225, 555, 180, 55)), expected: null },
    { id: 'deleted-12', subcase: 'deleted-detail', description: 'A-110 Canopy wall anchor', oldPage: 1, oldGeometry: mapGeometry(canopyShift, boxComment(1190, 505, 45, 115)), expected: null },
    // Small local deletions surrounded by surviving walls/corridor (4 comments, expected: null).
    { id: 'deleted-13', subcase: 'deleted-local', description: 'A-109 Removed Door D-14', oldPage: 0, oldGeometry: boxComment(362, 650, 48, 48), expected: null },
    { id: 'deleted-14', subcase: 'deleted-local', description: 'A-109 Removed partition wall', oldPage: 0, oldGeometry: boxComment(358, 715, 26, 75), expected: null },
    { id: 'deleted-15', subcase: 'deleted-local', description: 'A-110 Removed RTU-02 box', oldPage: 1, oldGeometry: boxComment(485, 440, 78, 46), expected: null },
    { id: 'deleted-16', subcase: 'deleted-local', description: 'A-110 Removed RTU-02 callout', oldPage: 1, oldGeometry: calloutComment(515, 462, 575, 425, 70, 24), expected: null },
  ];

  return {
    id: 'deleted-content',
    label: 'Deleted content',
    pairBySheet: true,
    oldPdf: buildPdf([old0, old1]),
    newPdf: buildPdf([new0, new1]),
    oldSheets: ['A-109', 'A-110'],
    newSheets: ['A-109', 'A-110'],
    sheetPairs: [
      { oldPage: 0, newPage: 0 },
      { oldPage: 1, newPage: 1 },
    ],
    comments,
  };
}

/** Generates all six deterministic fictional revision-pair fixtures for the given seed. */
export function generatePlacementFixtures(seed = 20261127): RevisionPairFixture[] {
  return [
    makeUnchangedCase(seed),
    makeMovedViewsCase(seed + 100),
    makeChangedScaleCase(seed + 200),
    makeRenumberedSheetsCase(seed + 300),
    makeRedrawnDetailsCase(seed + 400),
    makeDeletedContentCase(seed + 500),
  ];
}
