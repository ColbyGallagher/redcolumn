import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCALE_PRESETS } from './scale.ts';
import { effectiveKind, effectiveSlopeFactor, formatMeasure, labelAnchor, measureDetails, measureLabel, measureValue, planValue, quantityOf, slopeApplies, toDisplayQuantity } from './measure.ts';

const manual = (kind: 'length' | 'area' | 'volume' | 'count', value: number) => ({ manual: { kind, value } });

test('a manual quantity is its typed value, with no scale, slope or points involved', () => {
  assert.equal(measureValue('manual', [[10, 10]], 0.5, manual('area', 24), 2), 24);
  assert.equal(measureValue('manual', [[10, 10]], 0.5, { ...manual('length', 7), slope: { kind: 'percent', value: 50 } }), 7);
  assert.equal(measureValue('manual', [[10, 10]], 1), 0, 'with no quantity it is nothing');
  assert.equal(quantityOf('manual', manual('volume', 1)), 'volume');
  assert.equal(effectiveKind('manual', manual('count', 3)), 'count');
  assert.equal(effectiveKind('area', manual('count', 3)), 'area', 'other kinds are themselves');
});

test('a manual quantity reads in the page’s units and details by its kind', () => {
  const metric = { ...SCALE_PRESETS.find((p) => p.group === 'Metric')!.scale, unit: 'm' as const, precision: 2 };
  assert.equal(measureLabel('manual', [[0, 0]], metric, manual('area', 24)), '24.00 m²');
  assert.equal(formatMeasure('manual', 5, metric, manual('count', 5)), '5 ea');
  assert.deepEqual(toDisplayQuantity('manual', 24, metric, manual('area', 24)), { value: 24, unit: 'm²' });
  assert.deepEqual(measureDetails('manual', [[0, 0]], 1, manual('area', 24)), { area: 24 });
  assert.deepEqual(measureDetails('manual', [[0, 0]], 1, manual('length', 3)), { length: 3 });
  assert.deepEqual(measureDetails('manual', [[0, 0]], 1, manual('count', 3)), {});
  assert.deepEqual(labelAnchor('manual', [[4, 5]]), [4, 5]);
});

test('a slope never applies to a manual quantity: its plan value is the typed value, factor 1', () => {
  const pitch = { kind: 'pitch', value: 12 } as const;
  const props = { ...manual('area', 24), slope: pitch };
  assert.equal(slopeApplies('manual', pitch), false);
  assert.equal(slopeApplies('manual', { kind: 'hip', a: pitch }), false);
  assert.equal(measureValue('manual', [[0, 0]], 1, props), 24);
  assert.equal(planValue('manual', [[0, 0]], 1, props), 24);
  assert.equal(effectiveSlopeFactor('manual', 24, pitch), 1);
});
