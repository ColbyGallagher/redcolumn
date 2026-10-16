// Writes the PDFs the end-to-end tests open. Everything is drawn at known positions so the tests
// can assert exact results: a 100 pt calibration bar marked 10'-0", a 200 x 100 pt room, five
// copies of one symbol and known words to search for. Coordinates below are page points from the
// top-left, as the app reports them; pdf-lib's origin is the bottom-left, so `y` is flipped.
//
//   node fixtures/make-fixtures.mjs     (pnpm --filter @nb/e2e fixtures)
//
// The output is committed; rerun after changing this file and commit the PDFs and expected.json.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const here = dirname(fileURLToPath(import.meta.url));
const W = 1224; // 17 x 11 in
const H = 792;
const black = rgb(0, 0, 0);

/** Where things are on plan.pdf, shared with the specs through expected.json. */
const expected = {
  page: { width: W, height: H },
  /** 100 pt is 10 feet. */
  calibration: { from: [100, 700], to: [200, 700], feet: 10 },
  room: { x: 300, y: 200, w: 200, h: 100 },
  symbols: [
    [700, 200],
    [760, 200],
    [820, 200],
    [700, 300],
    [760, 300],
  ],
  symbolRadius: 6,
  search: {
    /** Each phrase, its number of hits and the page (0-based) of the first. */
    'DOOR SCHEDULE': { hits: 1, firstPage: 1 },
    DOOR: { hits: 6, firstPage: 0 },
    'GENERAL NOTES': { hits: 1, firstPage: 2 },
  },
  pageCount: 3,
  /** sheets.pdf: three sheets whose title blocks hold a room name and a scale note. */
  sheets: {
    /** A box around each sheet's room name, and what it reads. */
    labelBox: { x: 980, y: 700, w: 200, h: 30 },
    labels: ['ROOM 101', 'ROOM 102', 'ROOM 103'],
    /** A box around each sheet's scale note, and the scale written there. */
    scaleBox: { x: 980, y: 740, w: 200, h: 30 },
    scales: [`1/4" = 1'-0"`, `1/8" = 1'-0"`, `1" = 20'`],
  },
  /**
   * forms.pdf: a Letter page (612 x 792) with two labelled fill-in lines and a labelled 12 pt square,
   * for Auto-Create Fields. Lines and boxes are page points from the top-left.
   */
  forms: {
    page: { width: 612, height: 792 },
    lines: [
      { label: 'NAME', x0: 120, x1: 320, y: 100 },
      { label: 'DATE', x0: 120, x1: 240, y: 140 },
    ],
    box: { label: 'APPROVED', x: 120, y: 170, size: 12 },
  },
  /** stitch.pdf: a road cut into three 36 x 24 in sheets along match lines (see stitchPdf). */
  stitch: {
    page: { width: 36 * 72, height: 24 * 72 },
    /** World x from and to on each sheet, and the sheet's rotation (radians, counterclockwise on paper). */
    sheets: [
      { number: 'C-101', from: -100, to: 1000, angle: 0.2 },
      { number: 'C-102', from: 1000, to: 2000, angle: -0.45 },
      { number: 'C-103', from: 2000, to: 3100, angle: Math.PI / 2 },
    ],
  },
};

/** `rev` 1 adds a revision note to sheet 1, so it is a different file (for a second document, and compare). */
async function plan(rev = 0) {
  const doc = await PDFDocument.create();
  doc.setTitle(rev ? `E2E plan rev ${rev}` : 'E2E plan');
  doc.setProducer('redcolumn e2e fixtures');
  doc.setCreator('redcolumn e2e fixtures');
  doc.setCreationDate(new Date(0));
  doc.setModificationDate(new Date(0));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const text = (page, s, x, y, size = 12) => page.drawText(s, { x, y: H - y, size, font, color: black });
  const line = (page, [x0, y0], [x1, y1], thickness = 1) => page.drawLine({ start: { x: x0, y: H - y0 }, end: { x: x1, y: H - y1 }, thickness, color: black });

  // Sheet 1: the plan.
  const p1 = doc.addPage([W, H]);
  text(p1, 'LEVEL 1 PLAN', 60, 60, 18);
  if (rev) text(p1, `REVISION ${rev}`, 1000, 60, 12);
  const { from, to } = expected.calibration;
  line(p1, from, to, 1);
  line(p1, [from[0], from[1] - 6], [from[0], from[1] + 6]);
  line(p1, [to[0], to[1] - 6], [to[0], to[1] + 6]);
  text(p1, `10'-0"`, 135, 690, 10);
  const r = expected.room;
  const corners = [
    [r.x, r.y],
    [r.x + r.w, r.y],
    [r.x + r.w, r.y + r.h],
    [r.x, r.y + r.h],
  ];
  corners.forEach((c, i) => line(p1, c, corners[(i + 1) % 4], 2));
  text(p1, 'DOOR 1', 320, 330);
  text(p1, 'DOOR 2', 420, 330);
  for (const [x, y] of expected.symbols) {
    p1.drawCircle({ x, y: H - y, size: expected.symbolRadius, borderColor: black, borderWidth: 1 });
    line(p1, [x - 4, y], [x + 4, y]);
    line(p1, [x, y - 4], [x, y + 4]);
  }

  // Sheet 2: a schedule.
  const p2 = doc.addPage([W, H]);
  text(p2, 'DOOR SCHEDULE', 60, 60, 18);
  text(p2, 'DOOR 1   HOLLOW CORE', 60, 100);
  text(p2, 'DOOR 2   SOLID CORE', 60, 120);
  text(p2, 'DOOR 3   GLASS', 60, 140);

  // Sheet 3: notes.
  const p3 = doc.addPage([W, H]);
  text(p3, 'GENERAL NOTES', 60, 60, 18);
  text(p3, 'ALL DIMENSIONS ARE IN FEET AND INCHES.', 60, 100);

  return doc.save({ useObjectStreams: false });
}

/** Three sheets with title blocks: a room name and a scale note in the same place on each. */
async function sheets() {
  const doc = await PDFDocument.create();
  doc.setTitle('E2E sheets');
  doc.setProducer('redcolumn e2e fixtures');
  doc.setCreator('redcolumn e2e fixtures');
  doc.setCreationDate(new Date(0));
  doc.setModificationDate(new Date(0));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const { labelBox, scaleBox, labels, scales } = expected.sheets;
  labels.forEach((label, i) => {
    const p = doc.addPage([W, H]);
    const text = (s, x, y, size) => p.drawText(s, { x, y: H - y, size, font, color: black });
    text(`SHEET ${i + 1} OF ${labels.length}`, 60, 60, 18);
    // Each line sits in its box: baseline 10 pt above the box's bottom edge.
    text(label, labelBox.x + 10, labelBox.y + labelBox.h - 10, 12);
    text(`SCALE: ${scales[i]}`, scaleBox.x + 10, scaleBox.y + scaleBox.h - 10, 10);
  });
  return doc.save({ useObjectStreams: false });
}

/** A form to fill in by hand: labels beside fill-in lines and a check box. */
async function forms() {
  const { page: size, lines, box } = expected.forms;
  const doc = await PDFDocument.create();
  doc.setTitle('E2E form');
  doc.setProducer('redcolumn e2e fixtures');
  doc.setCreator('redcolumn e2e fixtures');
  doc.setCreationDate(new Date(0));
  doc.setModificationDate(new Date(0));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p = doc.addPage([size.width, size.height]);
  const Y = (y) => size.height - y;
  const line = ([x0, y0], [x1, y1]) => p.drawLine({ start: { x: x0, y: Y(y0) }, end: { x: x1, y: Y(y1) }, thickness: 1, color: black });
  // Each label ends 11 pt or more left of its line, on the line's baseline.
  for (const l of lines) {
    p.drawText(l.label, { x: 72, y: Y(l.y), size: 12, font, color: black });
    line([l.x0, l.y], [l.x1, l.y]);
  }
  p.drawText(box.label, { x: 40, y: Y(box.y + box.size - 2), size: 12, font, color: black });
  const [x0, y0, x1, y1] = [box.x, box.y, box.x + box.size, box.y + box.size];
  line([x0, y0], [x1, y0]);
  line([x1, y0], [x1, y1]);
  line([x1, y1], [x0, y1]);
  line([x0, y1], [x0, y0]);
  return doc.save({ useObjectStreams: false });
}

/**
 * A port of scripts/make_stitch_test_pdf.py: a road corridor (edges, centreline, utilities, cross
 * streets, street names) drawn in world units, cut at stations 10+00 and 20+00 onto three sheets,
 * each rotated differently, with labelled dashed match lines and title blocks. Stitching should put
 * them back together exactly. World y is up, like PDF user space.
 */
function stitchPdf() {
  const { width: SW, height: SH } = expected.stitch.page;
  const titles = ['ROADWAY PLAN STA 0+00 TO 10+00', 'ROADWAY PLAN STA 10+00 TO 20+00', 'ROADWAY PLAN STA 20+00 TO 31+00'];
  const SHEETS = expected.stitch.sheets.map((s, i) => ({ ...s, title: titles[i] }));
  const MATCH = [
    [1000, '10+00'],
    [2000, '20+00'],
  ];
  const f3 = (n) => n.toFixed(3);
  const f5 = (n) => n.toFixed(5);
  function* worldLines() {
    for (const y of [-20, 0, 20, 35, -52, 88, -130]) yield [-100, y, 3100, y];
    for (const x of [230, 610, 980, 1015, 1333, 1720, 1985, 2040, 2480]) yield [x, -300, x, 300];
    for (const x of [400, 995, 1500, 2010]) yield [x - 60, -200, x + 60, 200];
  }
  const clipX = ([ax, ay, bx, by], x0, x1) => {
    if (Math.max(ax, bx) < x0 || Math.min(ax, bx) > x1) return null;
    const at = (x) => (bx === ax ? [x, ay] : [x, ay + ((by - ay) * (x - ax)) / (bx - ax)]);
    const s = ax < x0 ? at(x0) : ax > x1 ? at(x1) : [ax, ay];
    const e = bx < x0 ? at(x0) : bx > x1 ? at(x1) : [bx, by];
    return [...s, ...e];
  };
  const pageOps = ({ number, title, from: x0, to: x1, angle }) => {
    const cx = (x0 + x1) / 2;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    // World -> PDF user space: rotate about the slice centre, centre on the sheet.
    const tf = (x, y) => {
      x -= cx;
      return [SW / 2 + c * x - s * y, SH / 2 + s * x + c * y];
    };
    const ops = ['0.6 w 0 0 0 RG'];
    for (const seg of worldLines()) {
      const k = clipX(seg, x0, x1);
      if (!k) continue;
      const a = tf(k[0], k[1]);
      const b = tf(k[2], k[3]);
      ops.push(`${f3(a[0])} ${f3(a[1])} m ${f3(b[0])} ${f3(b[1])} l S`);
    }
    const text = (t, x, y, size, rot = 0) => {
      const [px, py] = tf(x, y);
      const a = angle + rot;
      return `BT /F1 ${size} Tf ${f5(Math.cos(a))} ${f5(Math.sin(a))} ${f5(-Math.sin(a))} ${f5(Math.cos(a))} ${f3(px)} ${f3(py)} Tm (${t}) Tj ET`;
    };
    // Street names and station ticks along the road, so a misalignment is visible.
    ops.push('0 0 0 rg');
    for (let x = 0; x < 3100; x += 100) if (x0 <= x && x <= x1) ops.push(text(`${Math.floor(x / 100)}+00`, x - 12, -40, 7));
    for (const x of [500, 1300, 2600]) if (x0 <= x - 60 && x + 60 <= x1) ops.push(text('MAIN STREET', x - 50, 5, 9));
    // Match lines: heavy dashed lines, labels running along them on this sheet's side.
    ops.push('1.8 w 0.2 0.2 0.2 RG');
    for (const [mx, station] of MATCH) {
      if (mx !== x0 && mx !== x1) continue;
      for (let y = -320; y < 320; y += 30) {
        const a = tf(mx, y);
        const b = tf(mx, y + 18);
        ops.push(`${f3(a[0])} ${f3(a[1])} m ${f3(b[0])} ${f3(b[1])} l S`);
      }
      const side = mx === x1 ? -1 : 1;
      const target = SHEETS.find((t) => (mx === x1 ? t.from === mx : t.to === mx)).number;
      // Text runs up the match line, set just inside this sheet's side.
      ops.push(text(`MATCH LINE STA ${station} SEE SHEET ${target}`, mx + side * 14 - (side < 0 ? 8 : 0), -250, 10, Math.PI / 2));
    }
    // Title block (unrotated, bottom right) and border.
    ops.push(`1 w 0 0 0 RG 36 36 ${SW - 72} ${SH - 72} re S ${SW - 400} 36 364 170 re S`);
    ops.push(`BT /F1 7 Tf ${SW - 380} 190 Td (SHEET TITLE) Tj /F1 12 Tf 0 -20 Td (${title}) Tj /F1 8 Tf 0 -20 Td (SCALE: 1\\" = 20') Tj ET`);
    ops.push(`BT /F1 28 Tf ${SW - 130} 80 Td (${number}) Tj ET`);
    return Buffer.from(ops.join('\n'), 'latin1');
  };

  const bin = (s) => Buffer.from(s, 'latin1');
  const objs = [bin(''), bin('')];
  const add = (body) => objs.push(typeof body === 'string' ? bin(body) : body);
  const catalog = 1;
  const pagesObj = 2;
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const kids = [];
  for (const sheet of SHEETS) {
    const data = deflateSync(pageOps(sheet));
    const content = add(Buffer.concat([bin(`<< /Length ${data.length} /Filter /FlateDecode >>\nstream\n`), data, bin('\nendstream')]));
    kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${SW} ${SH}] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`));
  }
  objs[catalog - 1] = bin(`<< /Type /Catalog /Pages ${pagesObj} 0 R >>`);
  objs[pagesObj - 1] = bin(`<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`);
  const parts = [bin('%PDF-1.7\n')];
  let size = parts[0].length;
  const offsets = objs.map((body, i) => {
    const at = size;
    const chunk = Buffer.concat([bin(`${i + 1} 0 obj\n`), body, bin('\nendobj\n')]);
    parts.push(chunk);
    size += chunk.length;
    return at;
  });
  const table = offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  parts.push(bin(`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${table}trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${size}\n%%EOF\n`));
  return Buffer.concat(parts);
}

/** A 40 x 20 px PNG (red left half, blue right half), for the image tool. */
function png() {
  const w = 40;
  const h = 20;
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const rows = [];
  for (let y = 0; y < h; y++) {
    const row = [0];
    for (let x = 0; x < w; x++) row.push(...(x < w / 2 ? [255, 0, 0] : [0, 0, 255]));
    rows.push(Buffer.from(row));
  }
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}

writeFileSync(join(here, 'plan.pdf'), await plan());
writeFileSync(join(here, 'plan-rev1.pdf'), await plan(1));
writeFileSync(join(here, 'sheets.pdf'), await sheets());
writeFileSync(join(here, 'forms.pdf'), await forms());
writeFileSync(join(here, 'stitch.pdf'), stitchPdf());
writeFileSync(join(here, 'picture.png'), png());
writeFileSync(join(here, 'notes.txt'), 'Attached notes for the e2e tests.\n');
writeFileSync(join(here, 'expected.json'), JSON.stringify(expected, null, 2) + '\n');
console.log('wrote plan.pdf, plan-rev1.pdf, sheets.pdf, forms.pdf, stitch.pdf, picture.png, notes.txt, expected.json');
