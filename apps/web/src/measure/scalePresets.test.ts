import { test } from 'node:test';
import assert from 'node:assert/strict';
import { committedFormat, pagesOf, precisionValue, rangeText } from './scalePresets.ts';
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

test('precisionValue offers fractions only in ft or in, and the default decimals of the unit for a scale kept in fractions', () => {
  const base: Scale = { metersPerPoint: 0.01, unit: 'ft', feetInches: true, precision: 16, label: 'x' };
  assert.equal(precisionValue(base, 'd2'), 'f16');
  assert.equal(precisionValue({ ...base, unit: 'm' }, 'd2'), 'd2');
  assert.equal(precisionValue({ ...base, unit: 'mm' }, 'd2'), 'd0');
  assert.equal(precisionValue({ ...base, unit: 'km' }, 'd2'), 'd3');
  assert.equal(precisionValue({ ...base, unit: 'm', feetInches: false, precision: 3 }, 'd2'), 'd3');
  assert.equal(precisionValue(null, 'd2'), 'd2');
});

test('committedFormat carries kept inch fractions through a form unless a precision is chosen', () => {
  const dormant: Scale = { metersPerPoint: 0.01, unit: 'mm', feetInches: true, precision: 16, label: 'x' };
  const shown = precisionValue(dormant, 'd2');
  assert.equal(shown, 'd0');
  // Apply with nothing touched, or the unit switched back to ft or in: the fractions come back.
  assert.deepEqual(committedFormat(shown, 'mm', dormant), { feetInches: true, precision: 16 });
  assert.deepEqual(committedFormat(shown, 'ft', dormant), { feetInches: true, precision: 16 });
  assert.deepEqual(committedFormat(shown, 'in', dormant), { feetInches: true, precision: 16 });
  // A precision the user picked wins.
  assert.deepEqual(committedFormat('d3', 'mm', dormant), { feetInches: false, precision: 3 });
  assert.deepEqual(committedFormat('d3', 'ft', dormant), { feetInches: false, precision: 3 });
  assert.deepEqual(committedFormat('f8', 'ft', dormant), { feetInches: true, precision: 8 });
  // Ordinary scales are unchanged by it.
  const plain: Scale = { ...dormant, feetInches: false, precision: 2 };
  assert.deepEqual(committedFormat('d2', 'mm', plain), { feetInches: false, precision: 2 });
  assert.deepEqual(committedFormat('f16', 'mm', plain), { feetInches: false, precision: 2 });
  assert.deepEqual(committedFormat('f16', 'ft', null), { feetInches: true, precision: 16 });
});
