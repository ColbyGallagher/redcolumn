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
};

async function plan() {
  const doc = await PDFDocument.create();
  doc.setTitle('E2E plan');
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

writeFileSync(join(here, 'plan.pdf'), await plan());
writeFileSync(join(here, 'expected.json'), JSON.stringify(expected, null, 2) + '\n');
console.log('wrote plan.pdf, expected.json');
