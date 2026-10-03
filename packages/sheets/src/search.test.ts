import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchText } from './search.ts';
import type { PageText, Word } from './types.ts';

function words(text: string, y: number): Word[] {
  let x = 100;
  return text.split(' ').map((t) => {
    const w: Word = { text: t, x0: x, y0: y - 10, x1: x + t.length * 6, y1: y, size: 10, angle: 0 };
    x = w.x1 + 6;
    return w;
  });
}

const pages: PageText[] = [
  { width: 1000, height: 800, words: [...words('GENERAL NOTES - SHEET A', 100), ...words('Noise wall panels to be precast', 200)] },
  { width: 1000, height: 800, words: [...words('NOISE WALL DETAILS', 100), ...words('see noise-wall schedule', 300)] },
  { width: 1000, height: 800, words: [] },
];

test('case-insensitive phrase search across word boundaries', () => {
  const hits = searchText(pages, 'noise wall');
  assert.deepEqual(
    hits.map((h) => h.pageIndex),
    [0, 1],
  );
  // The phrase covers two words, so two highlight boxes.
  assert.equal(hits[0]!.rects.length, 2);
  assert.equal(hits[0]!.snippet.slice(hits[0]!.matchStart, hits[0]!.matchEnd), 'Noise wall');
});

test('partial words match unless whole-word is on', () => {
  assert.equal(searchText(pages, 'wal').length, 3);
  assert.equal(searchText(pages, 'wal', { wholeWord: true }).length, 0);
  assert.equal(searchText(pages, 'noise-wall').length, 1);
});

test('blank queries and limits', () => {
  assert.deepEqual(searchText(pages, '   '), []);
  assert.equal(searchText(pages, 'e', { limit: 2 }).length, 2);
});
