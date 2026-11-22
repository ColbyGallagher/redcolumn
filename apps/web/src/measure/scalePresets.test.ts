import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pagesOf, precisionValue, rangeText } from './scalePresets.ts';
import type { Scale } from '@nb/measure';

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

test('precisionValue offers fractions only in ft or in, and two decimals for a scale kept in fractions', () => {
  const base: Scale = { metersPerPoint: 0.01, unit: 'ft', feetInches: true, precision: 16, label: 'x' };
  assert.equal(precisionValue(base, 'd2'), 'f16');
  assert.equal(precisionValue({ ...base, unit: 'm' }, 'd2'), 'd2');
  assert.equal(precisionValue({ ...base, unit: 'mm' }, 'd2'), 'd0');
  assert.equal(precisionValue({ ...base, unit: 'km' }, 'd2'), 'd3');
  assert.equal(precisionValue({ ...base, unit: 'm', feetInches: false, precision: 3 }, 'd2'), 'd3');
  assert.equal(precisionValue(null, 'd2'), 'd2');
});
