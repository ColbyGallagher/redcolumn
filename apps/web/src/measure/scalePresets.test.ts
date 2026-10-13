import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pagesOf, rangeText } from './scalePresets.ts';

test('rangeText collapses runs of pages into 1-based ranges', () => {
  assert.equal(rangeText([0, 1, 2, 4, 6, 7]), '1-3, 5, 7-8');
  assert.equal(rangeText([3]), '4');
  assert.equal(rangeText([2, 0, 1, 1]), '1-3');
  assert.equal(rangeText([]), '');
});

test('pagesOf reads what rangeText writes', () => {
  const pages = [0, 1, 2, 4, 9];
  assert.deepEqual(pagesOf('range', rangeText(pages), 10)?.sort((a, b) => a - b), pages);
  assert.equal(pagesOf('range', '3-12', 10), null);
});
