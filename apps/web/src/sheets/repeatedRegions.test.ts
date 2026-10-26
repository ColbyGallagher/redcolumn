import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PageText, Word } from '@nb/sheets';
import { commonPageSize, findRepeatedRegions, pagesWithText, regionOnPage } from './repeatedRegions.ts';

const word = (text: string, x0: number, y0: number, w = 40, h = 10, angle = 0): Word => ({ text, x0, y0, x1: x0 + w, y1: y0 + h, size: h, angle });
const letter = (words: Word[]): PageText => ({ width: 612, height: 792, words });

/** A page with a header, a page-number footer, sideways text at the left, and body text that moves. */
const page = (n: number): PageText =>
  letter([
    word('ACME', 250, 30),
    word('Confidential', 295, 30, 80),
    word(`Page ${n + 1}`, 280, 760),
    word('DRAFT', 20, 380, 10, 40, -Math.PI / 2),
    word(`Body${n}`, 100, 150 + n * 37),
    word('note', 300, 400 + (n % 3) * 50),
  ]);

test('headers, footers and side notes repeated on most pages are found', () => {
  const texts = Array.from({ length: 10 }, (_, i) => page(i));
  const found = findRepeatedRegions(texts, texts.map((_, i) => i));
  assert.deepEqual(
    found.map((f) => [f.name, f.pages.length, f.sample]),
    [
      ['Header', 10, 'ACME Confidential'],
      ['Footer', 10, 'Page 1'],
      ['Left side', 10, 'DRAFT'],
    ],
  );
  const header = found[0]!.rect;
  // Padded around the words, and nothing from the body.
  assert.deepEqual(header, { x: 248, y: 28, w: 129, h: 14 });
});

test('text on too few pages is not repeated', () => {
  const texts = [letter([word('Cover', 250, 30)]), letter([]), letter([]), letter([word('Cover', 250, 30)]), letter([])];
  assert.deepEqual(findRepeatedRegions(texts, [0, 1, 2, 3, 4]), []);
  // ...but it is when only those pages are chosen.
  assert.equal(findRepeatedRegions(texts, [0, 3]).length, 1);
});

test('a single page has nothing repeated', () => {
  assert.deepEqual(findRepeatedRegions([page(0)], [0]), []);
});

test('two header lines close together make one box', () => {
  const texts = Array.from({ length: 4 }, () => letter([word('Project', 250, 20), word('Rev A', 250, 33)]));
  const found = findRepeatedRegions(texts, [0, 1, 2, 3]);
  assert.equal(found.length, 1);
  assert.equal(found[0]!.sample, 'Project Rev A');
});

test('boxes keep their distance from the nearest edges on other page sizes', () => {
  const letterSize = { width: 612, height: 792 };
  const tabloid = { width: 792, height: 1224 };
  // A footer at the bottom right stays at the bottom right.
  assert.deepEqual(regionOnPage({ x: 500, y: 760, w: 80, h: 20 }, letterSize, tabloid), { x: 680, y: 1192, w: 80, h: 20 });
  // A centred page number stays centred.
  assert.deepEqual(regionOnPage({ x: 286, y: 760, w: 40, h: 20 }, letterSize, tabloid), { x: 376, y: 1192, w: 40, h: 20 });
  // A full-width header stretches across, keeping its margins.
  assert.deepEqual(regionOnPage({ x: 20, y: 10, w: 572, h: 30 }, letterSize, tabloid), { x: 20, y: 10, w: 752, h: 30 });
  // Same size: unchanged.
  const r = { x: 1, y: 2, w: 3, h: 4 };
  assert.equal(regionOnPage(r, letterSize, letterSize), r);
});

test('mixed sizes are found against the most common one', () => {
  const big = (n: number): PageText => ({ width: 792, height: 1224, words: [word('ACME', 250, 30), word(`Page ${n}`, 370, 1192)] });
  const texts = [page(0), page(1), page(2), big(4)];
  assert.deepEqual(commonPageSize(texts, [0, 1, 2, 3]), { width: 612, height: 792 });
  const found = findRepeatedRegions(texts, [0, 1, 2, 3]);
  const footer = found.find((f) => f.name === 'Footer')!;
  assert.deepEqual(footer.pages, [0, 1, 2, 3]);
  assert.deepEqual(pagesWithText(texts, [0, 1, 2, 3], footer.rect, { width: 612, height: 792 }), [0, 1, 2, 3]);
});
