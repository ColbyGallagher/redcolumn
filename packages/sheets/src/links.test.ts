import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectLinks, SheetLookup } from './links.ts';
import type { PageText, Word } from './types.ts';

const W = 2592;
const H = 1728;

function word(text: string, x: number, y: number, size: number): Word {
  return { text, x0: x, y0: y - size, x1: x + text.length * size * 0.6, y1: y, size, angle: 0 };
}

/** A detail bubble: identifier on top, sheet number below. */
function bubble(id: string, sheet: string, x: number, y: number, size = 8): Word[] {
  return [word(id, x + 6, y, size), word(sheet, x, y + size * 1.3, size)];
}

function titleBlock(number: string): Word[] {
  return [word('SHEET', 2450, 1650, 7), word(number, 2450, 1700, 28)];
}

function page(words: Word[]): PageText {
  // Body text so the median font size is realistic.
  const notes = Array.from({ length: 30 }, (_, i) => word('NOTE', 200 + (i % 10) * 60, 300 + Math.floor(i / 10) * 20, 8));
  return { width: W, height: H, words: [...notes, ...words] };
}

const numbers = ['C-101', 'C-102', 'C-501'];

test('lookup matches exact numbers and unambiguous separator variants', () => {
  const lookup = new SheetLookup(['C-101', 'A1.01', 'A-101']);
  assert.equal(lookup.find('C-101'), 0);
  assert.equal(lookup.find('c101'), 0);
  assert.equal(lookup.find('C-101,'), 0);
  assert.equal(lookup.find('A1.01'), 1);
  // A101 could be A1.01 or A-101: ambiguous, so no loose match.
  assert.equal(lookup.find('A101'), null);
  assert.equal(lookup.find('S-201'), null);
});

test('detail bubble links to the detail title on the target sheet', () => {
  const pages = [
    page([...bubble('3', 'C-501', 900, 800), ...titleBlock('C-101')]),
    page(titleBlock('C-102')),
    // On C-501: detail 3's title bubble (larger, own sheet number below) with its name alongside.
    page([...bubble('3', 'C-501', 600, 900, 14), word('CURB DETAIL', 660, 900, 12), ...bubble('4', 'C-501', 1200, 900, 14), ...titleBlock('C-501')]),
  ];
  const links = detectLinks(pages, numbers).filter((l) => l.pageIndex === 0);
  assert.equal(links.length, 1);
  const [l] = links;
  assert.equal(l!.label, '3/C-501');
  assert.equal(l!.kind, 'detail');
  assert.equal(l!.targetPage, 2);
  assert.ok(l!.targetRect, 'detail located');
  // The located rect frames detail 3's title bubble, not detail 4's.
  assert.ok(l!.targetRect!.x < 606 && l!.targetRect!.x + l!.targetRect!.w > 606 && l!.targetRect!.x + l!.targetRect!.w < 1200);
  assert.equal(l!.confidence, 0.9);
});

test('slash references and plain sheet references', () => {
  const pages = [
    page([word('SEE', 400, 1000, 8), word('3/C-501', 430, 1000, 8), word('MATCH', 400, 1200, 8), word('SHEET', 450, 1200, 8), word('C-102.', 490, 1200, 8), ...titleBlock('C-101')]),
    page(titleBlock('C-102')),
    page(titleBlock('C-501')),
  ];
  const links = detectLinks(pages, numbers).filter((l) => l.pageIndex === 0);
  assert.deepEqual(
    links.map((l) => [l.label, l.kind, l.targetPage]),
    [
      ['3/C-501', 'detail', 2],
      ['C-102', 'sheet', 1],
    ],
  );
  // Detail 3 does not exist on C-501 here, so the link falls back to the sheet with lower confidence.
  assert.equal(links[0]!.targetRect, null);
  assert.equal(links[0]!.confidence, 0.65);
});

test("a sheet's own title-block number is not a link; unknown sheets are ignored", () => {
  const pages = [page([word('S-201', 500, 500, 8), ...titleBlock('C-101')]), page(titleBlock('C-102')), page(titleBlock('C-501'))];
  assert.deepEqual(detectLinks(pages, numbers), []);
});

test('link ids are stable across runs', () => {
  const pages = [page([word('C-102', 400, 400, 8), ...titleBlock('C-101')]), page(titleBlock('C-102')), page(titleBlock('C-501'))];
  assert.deepEqual(
    detectLinks(pages, numbers).map((l) => l.id),
    detectLinks(pages, numbers).map((l) => l.id),
  );
});

test("detail title bubbles are targets, not links; small same-sheet callouts are links", () => {
  const pages = [
    page(titleBlock('C-101')),
    page(titleBlock('C-102')),
    page([...bubble('3', 'C-501', 600, 900, 14), word('CURB DETAIL', 660, 900, 12), ...bubble('3', 'C-501', 1500, 400, 8), ...titleBlock('C-501')]),
  ];
  const links = detectLinks(pages, numbers);
  assert.equal(links.length, 1);
  assert.equal(links[0]!.pageIndex, 2);
  assert.equal(links[0]!.targetPage, 2);
  assert.ok(links[0]!.targetRect);
});

test('same-sheet callouts link even when the body text is small', () => {
  // Mostly 6 pt labels, so a 10 pt callout is "large" relative to the median.
  const labels = Array.from({ length: 40 }, (_, i) => word('STA', 100 + (i % 10) * 80, 1200 + Math.floor(i / 10) * 20, 6));
  const pages = [
    page(titleBlock('C-101')),
    page(titleBlock('C-102')),
    { width: W, height: H, words: [...labels, ...bubble('3', 'C-501', 600, 900, 16), word('CURB', 660, 900, 14), ...bubble('3', 'C-501', 1500, 400, 10), ...titleBlock('C-501')] },
  ];
  const links = detectLinks(pages, numbers);
  assert.equal(links.length, 1);
  assert.equal(links[0]!.label, '3/C-501');
  assert.ok(links[0]!.rect.x > 1400, 'the small callout, not the title bubble');
  assert.ok(links[0]!.targetRect);
});

test('a stray label inside the title bubble does not hide the sheet number below it', () => {
  const pages = [
    page([...bubble('A', 'C-501', 900, 800), ...titleBlock('C-101')]),
    page(titleBlock('C-102')),
    page([
      // Small same-sheet callout to A, then A's real title bubble with a 6 pt label overlapping it.
      ...bubble('A', 'C-501', 1300, 700, 10),
      word('A', 1806, 900, 16),
      word('STA', 1795, 910, 6),
      word('C-501', 1790, 921, 12.8),
      word('STORM INLET', 1850, 900, 14),
      ...titleBlock('C-501'),
    ]),
  ];
  const link = detectLinks(pages, numbers).find((l) => l.pageIndex === 0)!;
  assert.ok(link.targetRect && link.targetRect.x > 1700, `framed the title at x=${link.targetRect?.x}`);
});

test('section titles abbreviated to the last segment of long document numbers link to the cut', () => {
  const nums = ['HLD1BDD-WSPAU-0508-BR-DRG-300082', 'HLD1BDD-WSPAU-0508-BR-DRG-300086'];
  const pages = [
    // 300082 carries the cut marker for section 1, pointing at 300086.
    page([...bubble('1', '300086', 1500, 700), ...titleBlock(nums[0]!)]),
    // 300086 draws section 1 and titles it with the sheet it is cut on.
    page([word('SECTION', 540, 900, 12), ...bubble('1', '300082', 640, 900, 12), word('750', 700, 600, 8), ...titleBlock(nums[1]!)]),
  ];
  const links = detectLinks(pages, nums).filter((l) => l.pageIndex === 1);
  assert.deepEqual(
    links.map((l) => [l.label, l.targetPage]),
    [['1/300082', 0]],
  );
  const r = links[0]!.targetRect!;
  assert.ok(r.x < 1506 && r.x + r.w > 1506 && r.y < 700 && r.y + r.h > 700, 'framed on the cut marker');
  // Short numbers only count inside bubbles: a lone 300082 in text is not a reference.
  const lookup = new SheetLookup(nums);
  assert.equal(lookup.find('300082'), null);
  assert.equal(lookup.find('300082', true), 0);
});
