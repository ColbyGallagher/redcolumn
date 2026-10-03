import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareSheetNumbers, detectSheets, disciplineFor, normalizeSheetNumber } from './detect.ts';
import type { PageText, Word } from './types.ts';

const W = 2592; // 36" x 24"
const H = 1728;

function word(text: string, x: number, y: number, size: number, angle = 0): Word {
  return { text, x0: x, y0: y - size, x1: x + text.length * size * 0.55, y1: y, size, angle };
}

/** Words for a phrase laid out left to right, as the PDF worker would split them. */
function phrase(text: string, x: number, y: number, size: number): Word[] {
  const out: Word[] = [];
  let cx = x;
  for (const t of text.split(' ')) {
    out.push(word(t, cx, y, size));
    cx += (t.length + 1) * size * 0.55;
  }
  return out;
}

function sheet(number: string, title: string[], extras: Word[] = []): PageText {
  const words: Word[] = [
    // Body: notes and callouts that also look like sheet numbers.
    ...phrase('SEE DETAIL 3 ON SHEET', 300, 400, 8),
    word('C-501', 420, 400, 8),
    word('A-101', 900, 700, 10),
    ...phrase('Contractor shall verify all dimensions in field', 300, 420, 8),
    // Title block, bottom right.
    ...phrase('SHEET TITLE', 2250, 1560, 7),
    ...title.flatMap((line, i) => phrase(line, 2250, 1590 + i * 18, 14)),
    ...phrase('SCALE: 1" = 20\'', 2250, 1640, 8),
    ...phrase('SHEET NO.', 2450, 1660, 7),
    word(number, 2450, 1700, 28),
    ...extras,
  ];
  return { width: W, height: H, words };
}

test('sheet number pattern and disciplines', () => {
  assert.equal(normalizeSheetNumber('c-101'), 'C-101');
  assert.equal(normalizeSheetNumber('A1.01'), 'A1.01');
  assert.equal(normalizeSheetNumber('FP-101'), 'FP-101');
  assert.equal(normalizeSheetNumber('STA'), null);
  assert.equal(normalizeSheetNumber('12+00'), null);
  assert.equal(disciplineFor('C-101'), 'Civil');
  assert.equal(disciplineFor('FP-201'), 'Fire Protection');
  assert.equal(disciplineFor('AD-101'), 'Architectural Demolition');
  assert.equal(disciplineFor('A2.01'), 'Architectural');
});

test('sheet ordering follows the NCS discipline order, then numbers', () => {
  const sorted = ['A-10', 'C-101', 'A-2', 'G-001', 'S-201', 'E-1'].sort(compareSheetNumbers);
  assert.deepEqual(sorted, ['G-001', 'C-101', 'S-201', 'A-2', 'A-10', 'E-1']);
});

test('finds number, title and scale in the title block, ignoring callouts', () => {
  const pages = [
    sheet('C-101', ['EXISTING CONDITIONS']),
    sheet('C-102', ['GRADING AND', 'DRAINAGE PLAN']),
    sheet('C-103', ['UTILITY PLAN']),
  ];
  const result = detectSheets(pages);
  assert.deepEqual(
    result.map((r) => [r.number, r.title, r.discipline, r.scaleText]),
    [
      ['C-101', 'EXISTING CONDITIONS', 'Civil', '1" = 20\''],
      ['C-102', 'GRADING AND DRAINAGE PLAN', 'Civil', '1" = 20\''],
      ['C-103', 'UTILITY PLAN', 'Civil', '1" = 20\''],
    ],
  );
  for (const r of result) assert.ok(r.confidence >= 0.5, `confidence ${r.confidence}`);
});

test('cross-page consensus beats a larger callout outside the title block', () => {
  // A big "A-201" room tag in the plan area on one sheet must not win over the title block.
  const pages = [sheet('A-101', ['FLOOR PLAN'], [word('A-201', 1200, 900, 30)]), sheet('A-102', ['ROOF PLAN']), sheet('A-103', ['ELEVATIONS'])];
  assert.equal(detectSheets(pages)[0]!.number, 'A-101');
});

test('pages without a text layer come back empty for the AI pass to fill', () => {
  const [scanned] = detectSheets([{ width: W, height: H, words: [] }]);
  assert.equal(scanned!.number, null);
  assert.equal(scanned!.confidence, 0);
});

test('words on one line are joined even when their glyph bottoms differ slightly', () => {
  // Real glyph boxes put "=" and punctuation a little above the baseline; later words can sort
  // ahead of earlier ones on y alone.
  const jitter = (ws: Word[]) => ws.map((w, i) => ({ ...w, y1: w.y1 + (ws.length - i) * 0.3 }));
  const page: PageText = {
    width: W,
    height: H,
    words: [...jitter(phrase('DEMOLITION PLAN', 2250, 1590, 14)), ...jitter(phrase('SCALE: 1" = 20\'', 2250, 1640, 8)), word('C-102', 2450, 1700, 28)],
  };
  const [r] = detectSheets([page]);
  assert.equal(r!.title, 'DEMOLITION PLAN');
  assert.equal(r!.scaleText, '1" = 20\'');
});

test('small labels on the same row do not split a title', () => {
  const page: PageText = {
    width: W,
    height: H,
    words: [...phrase('DEMOLITION PLAN', 2213, 1558, 14), word('STA', 2277, 1556.3, 6), word('73+28', 2291, 1556.3, 6), word('C-102', 2450, 1700, 28)],
  };
  // "PLAN" starts right of the small label, so a naive left-to-right join would break the title.
  page.words.find((w) => w.text === 'PLAN')!.x0 = 2304;
  assert.equal(detectSheets([page])[0]!.title, 'DEMOLITION PLAN');
});

test('a small label just above a line does not capture its words', () => {
  // A 6 pt label sits between "=" (whose glyph bottom is above the baseline) and the rest of the line.
  const eq: Word = { ...word('=', 2272, 1640, 8), y1: 1637.8 };
  const page: PageText = { width: W, height: H, words: [word('STA', 2200, 1635, 6), ...phrase('SCALE: 1"', 2230, 1640, 8), eq, word("20'", 2282, 1640, 8), word('C-102', 2450, 1700, 28)] };
  assert.equal(detectSheets([page])[0]!.scaleText, '1" = 20\'');
});

test('document-numbered title blocks: labelled field that changes per sheet, repeated text ignored', () => {
  // Modelled on a TfNSW sheet: title strip along the bottom, project lines and set/status fields
  // repeated on every sheet, a long drawing number under a "DRG No." label, border zone numbers.
  const sheetPage = (n: number, title: string): PageText => ({
    width: 2384,
    height: 1684,
    words: [
      ...phrase('MR508 HENRY LAWSON DRIVE - STAGE 1B', 1852, 1461, 20),
      ...phrase('MISCELLANEOUS STRUCTURES', 1852, 1506, 20),
      ...phrase(title, 1851, 1544, 14),
      ...phrase('DRAWING SET No: DS2025/000595 PART', 1852, 1565, 14),
      ...phrase(`SHEET: ${n} OF 22 A1`, 2170, 1565, 14),
      ...phrase('STATUS: M381 BRIDGE No: C', 1851, 1583, 14),
      ...phrase('DRG No. REV VER EDMS No. AMD No.', 1852, 1600, 10),
      word(`HLD1BDD-WSPAU-0508-MS-DRG-1000${String(n).padStart(2, '0')}`, 1852, 1620, 14),
      word('D', 2300, 1620, 14),
      ...['7', '8', '9', '10', '11', '12'].map((z, i) => word(z, 1282 + i * 190, 1670, 18)),
      ...phrase('SEE HLD1BDD-WSPAU-0508-MS-DRG-100081 FOR DETAILS', 300, 700, 8),
    ],
  });
  const result = detectSheets([sheetPage(1, 'COVER SHEET'), sheetPage(6, 'OVERVIEW PLAN - SHEET A'), sheetPage(22, 'NOISE WALL DETAILS - SHEET D')]);
  assert.deepEqual(
    result.map((r) => [r.number, r.title]),
    [
      ['HLD1BDD-WSPAU-0508-MS-DRG-100001', 'COVER SHEET'],
      ['HLD1BDD-WSPAU-0508-MS-DRG-100006', 'OVERVIEW PLAN - SHEET A'],
      ['HLD1BDD-WSPAU-0508-MS-DRG-100022', 'NOISE WALL DETAILS - SHEET D'],
    ],
  );
});

test("a sheet's number referenced in other sheets' notes is still its number", () => {
  const sheetPage = (n: number): PageText => ({
    width: 2384,
    height: 1684,
    words: [
      ...phrase('PROJECT ALPHA', 1852, 1506, 20),
      ...phrase('DRG No.', 1852, 1600, 10),
      word(`X-DRG-10000${n}`, 1852, 1620, 14),
      // Most sheets' notes point at sheet 5's general notes, set close to the title block.
      ...(n % 3 ? phrase('SEE DRAWING No X-DRG-100005 FOR NOTES', 1852, 1420, 12) : []),
      word('1500', 2160, 785, 15.5),
    ],
  });
  assert.deepEqual(
    detectSheets([1, 2, 3, 4, 5, 6].map(sheetPage)).map((r) => r.number),
    [1, 2, 3, 4, 5, 6].map((n) => `X-DRG-10000${n}`),
  );
});
