import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectSheets } from './detect.ts';
import { boxFromRegion, deriveTemplate, disciplineOf, numberParts, readSheet, regionOfBox, standardCoverage, templateRegex, type SheetHints } from './standard.ts';
import type { PageText, Word } from './types.ts';

const W = 2384; // A1 landscape, points
const H = 1684;

function word(text: string, x: number, y: number, size: number): Word {
  return { text, x0: x, y0: y - size, x1: x + text.length * size * 0.55, y1: y, size, angle: 0 };
}

function phrase(text: string, x: number, y: number, size: number): Word[] {
  const out: Word[] = [];
  let cx = x;
  for (const t of text.split(' ')) {
    out.push(word(t, cx, y, size));
    cx += (t.length + 1) * size * 0.55;
  }
  return out;
}

/** A WSP-style title block: title, drawing number, contract number and revision, each under its label. */
function sheet(number: string, title: string, rev: string, scale = 1): PageText {
  const s = (v: number) => v * scale;
  return {
    width: W * scale,
    height: H * scale,
    words: [
      ...phrase('SEE DRAWING HLD1BDD-WSPAU-0508-BR-DRG-300090', s(300), s(400), s(8)),
      ...phrase('DRAWING TITLE', s(1900), s(1540), s(6)),
      ...phrase(title, s(1900), s(1565), s(12)),
      ...phrase('DRAWING NO.', s(1900), s(1610), s(6)),
      word(number, s(1900), s(1640), s(14)),
      ...phrase('CONTRACT NO.', s(2150), s(1610), s(6)),
      word('C-2041', s(2150), s(1640), s(14)),
      ...phrase('REV', s(2300), s(1610), s(6)),
      ...phrase(`A B ${rev}`, s(2300), s(1640), s(14)),
    ].map((w) => ({ ...w, size: w.size })),
  };
}

const page = { width: W, height: H };
const hints: SheetHints = {
  boxes: [
    boxFromRegion({ x: 1890, y: 1530, w: 240, h: 45 }, page, 'title'),
    boxFromRegion({ x: 1890, y: 1600, w: 240, h: 50 }, page, 'number'),
    boxFromRegion({ x: 2140, y: 1600, w: 140, h: 50 }, page, 'ignore'),
    boxFromRegion({ x: 2290, y: 1600, w: 90, h: 50 }, page, 'revision'),
  ],
  template: 'HLD1BDD-WSPAU-0508-@@-DRG-######',
  disciplinePart: 3,
  disciplines: { BR: 'Bridges', RD: 'Roads' },
};

test('templates: # digits, @ letters, ? either, * a run, \\ for the character itself', () => {
  assert.ok(templateRegex('HLD1BDD-WSPAU-####-@@-DRG-######').test('HLD1BDD-WSPAU-0508-BR-DRG-300082'));
  assert.ok(!templateRegex('HLD1BDD-WSPAU-####-@@-DRG-######').test('HLD1BDD-WSPAU-0508-BR-DRG-30008'));
  assert.ok(templateRegex('@-*').test('C-1001') && templateRegex('@-*').test('C-1'));
  assert.ok(templateRegex('A?.##').test('A1.01') && !templateRegex('A?.##').test('A1-01'));
  assert.ok(templateRegex('\\#-###').test('#-101'));
  assert.ok(templateRegex('c-###').test('C-101'), 'case does not matter');
});

test('a template is worked out from the numbers a set uses', () => {
  assert.equal(deriveTemplate(['HLD1BDD-WSPAU-0508-BR-DRG-300082', 'HLD1BDD-WSPAU-0508-RD-DRG-100011', 'HLD1BDD-WSPAU-0508-BR-DRG-300090']), 'HLD1BDD-WSPAU-0508-@@-DRG-######');
  assert.equal(deriveTemplate(['C-101', 'C-1001', 'S-201']), '@-*');
  assert.equal(deriveTemplate(['A1.01', 'A2.01']), 'A#.01');
  // Built differently (another separator, another part count): no single template.
  assert.equal(deriveTemplate(['C-101', 'C.101']), null);
  assert.equal(deriveTemplate(['C-101', 'C-101-A']), null);
  assert.equal(deriveTemplate([]), null);
  // Template characters in the numbers themselves are kept as written.
  const odd = deriveTemplate(['#1-A', '#2-A'])!;
  assert.equal(odd, '\\##-A');
  assert.ok(templateRegex(odd).test('#7-A') && !templateRegex(odd).test('17-A'));
  assert.deepEqual(numberParts('HLD1BDD-WSPAU-0508-BR-DRG-300082'), ['HLD1BDD', 'WSPAU', '0508', 'BR', 'DRG', '300082']);
});

test('disciplines come from the part the standard names, with names for its codes', () => {
  assert.equal(disciplineOf('HLD1BDD-WSPAU-0508-BR-DRG-300082', hints), 'Bridges');
  assert.equal(disciplineOf('HLD1BDD-WSPAU-0508-GE-DRG-300082', hints), 'GE');
  // Another consultant's sheet in the set: not the client's scheme, so the CAD standard prefix.
  assert.equal(disciplineOf('S-201', hints), 'Structural');
  assert.equal(disciplineOf('C-101', { ...hints, disciplinePart: null }), 'Civil');
});

test('a sheet is read from its boxes: number by template, title and the current revision without their labels', () => {
  const info = readSheet(sheet('HLD1BDD-WSPAU-0508-BR-DRG-300082', 'Bridge 4 General Arrangement', 'C'), hints);
  assert.deepEqual(info, {
    number: 'HLD1BDD-WSPAU-0508-BR-DRG-300082',
    title: 'Bridge 4 General Arrangement',
    discipline: 'Bridges',
    scaleText: null,
    revision: 'C',
    source: 'standard',
    confidence: 0.95,
  });
  // Printed at half size (A1 as A3), the boxes are in the same place on the page.
  assert.equal(readSheet(sheet('HLD1BDD-WSPAU-0508-RD-DRG-100011', 'Road plan', 'A', 0.5), hints)?.number, 'HLD1BDD-WSPAU-0508-RD-DRG-100011');
  const r = regionOfBox(hints.boxes[1]!, page);
  assert.deepEqual([r.x, r.y, r.w, r.h].map(Math.round), [1890, 1600, 240, 50]);
});

test('a number split by spaces in the box is read run together', () => {
  const p = sheet('X', 'Plan and profile', 'A');
  p.words = p.words.filter((w) => w.text !== 'X').concat(phrase('C - 101', 1900, 1640, 14));
  assert.equal(readSheet(p, { ...hints, template: '@-###', disciplinePart: null })?.number, 'C-101');
  assert.equal(readSheet(p, { ...hints, template: '@-###', disciplinePart: null })?.title, 'Plan and profile', 'PLAN is not a label in front of a title');
});

test('pages the standard does not fit are left to the heuristics, which skip ignore boxes and prefer the template', () => {
  const fits = sheet('HLD1BDD-WSPAU-0508-BR-DRG-300082', 'Bridge 4', 'C');
  // Another consultant's sheet: its number is somewhere else and does not fit the template.
  const other: PageText = { width: W, height: H, words: [...phrase('SHEET NO.', 2200, 1500, 7), word('S-201', 2200, 1530, 20)] };
  // Nothing in the number box fits; the template-shaped number sits elsewhere in the title block.
  // Its contract number, unlabelled and larger, sits in the ignore box.
  const moved: PageText = { width: W, height: H, words: [word('HLD1BDD-WSPAU-0508-RD-DRG-100020', 2000, 1500, 14), word('C-2041', 2150, 1640, 18)] };
  const found = detectSheets([fits, other, moved], hints);
  assert.deepEqual(
    found.map((s) => [s.number, s.source, s.discipline]),
    [
      ['HLD1BDD-WSPAU-0508-BR-DRG-300082', 'standard', 'Bridges'],
      ['S-201', 'text', 'Structural'],
      ['HLD1BDD-WSPAU-0508-RD-DRG-100020', 'text', 'Roads'],
    ],
  );
  assert.deepEqual(standardCoverage([fits, other, moved], hints), { read: [0], missed: [1, 2] });
  // Without the standard, the contract number in the corner wins on the last page.
  assert.equal(detectSheets([moved])[0]!.number, 'C-2041');
});
