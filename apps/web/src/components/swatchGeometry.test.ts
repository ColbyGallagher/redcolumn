import assert from 'node:assert/strict';
import test from 'node:test';
import { swatchMarkup, SWATCH_HEIGHT, SWATCH_WIDTH } from './swatchGeometry';

test('a swatch runs a horizontal line across the middle with a margin at each end', () => {
  const m = swatchMarkup({ dash: 'dashed' });
  assert.deepEqual(m.points, [
    [3, SWATCH_HEIGHT / 2],
    [SWATCH_WIDTH - 3, SWATCH_HEIGHT / 2],
  ]);
  assert.equal(m.type, 'polyline');
});

test('a plain dash goes through the markup style', () => {
  const m = swatchMarkup({ dash: 'dotted' });
  assert.equal(m.style.dash, 'dotted');
  assert.equal(m.style.lineStyle, undefined);
});

test('a line style replaces any dash', () => {
  const line = { name: 'Gas', spec: [true, [0, 6, -3, ['G', 'Helvetica', 6, false, false, true]]] } as never;
  const m = swatchMarkup({ line, dash: 'dashed' });
  assert.equal(m.style.lineStyle, line);
  assert.equal(m.style.dash, undefined);
});

test('a swatch draws in the colour it is given', () => {
  assert.equal(swatchMarkup({}, 80, 12, 'rgb(1, 2, 3)').style.stroke, 'rgb(1, 2, 3)');
});
