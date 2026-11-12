import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markupLayersOfHiddenPdf } from './layerMarkups.ts';

test('markups on a PDF layer are hidden with it; a repeated name only once all its layers are off', () => {
  const layer = (id: string, name: string, depth = 0) => ({ id, name, on: true, locked: false, depth });
  const layers = [layer('1 0', 'Markups LR'), layer('2 0', 'Beams', 1), layer('3 0', 'Cols', 1), layer('4 0', '0'), layer('5 0', '0')];
  assert.deepEqual(markupLayersOfHiddenPdf(layers, []), []);
  assert.deepEqual(markupLayersOfHiddenPdf(layers, ['2 0']), ['Beams']);
  assert.deepEqual(markupLayersOfHiddenPdf(layers, ['1 0', '2 0', '3 0']).sort(), ['Beams', 'Cols', 'Markups LR']);
  assert.deepEqual(markupLayersOfHiddenPdf(layers, ['4 0']), [], 'the other "0" is still on');
  assert.deepEqual(markupLayersOfHiddenPdf(layers, ['4 0', '5 0']), ['0']);
});
