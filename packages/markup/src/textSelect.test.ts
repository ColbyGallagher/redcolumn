import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lineRects, markupLines, selectWords, wordAt, type WordBox } from './textSelect.ts';

const w = (text: string, x0: number, y0: number, x1: number, y1: number): WordBox => ({ text, x0, y0, x1, y1 });
// Two lines of text, in reading order.
const words = [w('Provide', 10, 10, 50, 20), w('fire', 55, 10, 75, 20), w('stopping', 80, 11, 120, 21), w('at', 10, 25, 20, 35), w('slab', 25, 25, 45, 35)];

test('dragging across text selects the words between the two ends in reading order', () => {
  assert.equal(wordAt(words, [60, 15], 2), 1);
  assert.equal(wordAt(words, [300, 300], 2), -1);
  assert.deepEqual(selectWords(words, [60, 15], [30, 30], 2).map((x) => x.text), ['fire', 'stopping', 'at', 'slab']);
  // Backwards drags select the same words.
  assert.deepEqual(selectWords(words, [30, 30], [60, 15], 2).map((x) => x.text), ['fire', 'stopping', 'at', 'slab']);
  assert.deepEqual(selectWords(words, [60, 15], [500, 500], 2), []);
});

test('selected words merge into one rectangle per line', () => {
  const { points, text } = lineRects(words.slice(1));
  assert.equal(text, 'fire stopping\nat slab');
  assert.deepEqual(markupLines(points), [
    { x: 55, y: 10, w: 65, h: 11 },
    { x: 10, y: 25, w: 35, h: 10 },
  ]);
});

test('selectRange cuts the end words at the characters under the pointer', async () => {
  const { selectRange } = await import('./textSelect.ts');
  const words = [w('abcdefgh', 0, 0, 80, 10), w('qsuqsuqs', 90, 0, 170, 10)];
  const got = selectRange(words, [40, 5], [130, 5], 0);
  assert.equal(got[0]!.text, 'efgh');
  assert.ok(got[0]!.x0 > 30 && got[0]!.x0 < 50 && Math.abs(got[0]!.x1 - 80) < 1e-6);
  assert.equal(got[1]!.text, 'qsuq');
  const one = selectRange(words, [30, 5], [50, 5], 0);
  assert.deepEqual(one.map((x) => x.text), ['de']);
});
