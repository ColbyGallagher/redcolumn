import { test } from 'node:test';
import assert from 'node:assert/strict';
import { measureLabel, measureValue, pageLengthFor, realLengthAlong } from './measure.ts';
import { calibrateAxis, SCALE_PRESETS, type Scale } from './scale.ts';

const preset = (label: string) => SCALE_PRESETS.find((p) => p.label === label)!.scale;
const mm = (n: number) => (n / 25.4) * 72;

/** X = 1:100, Y = 1:50: a vertical paper millimetre is half as long in reality as a horizontal one. */
const x100 = preset('1:100');
const xy: Scale = { ...x100, yMetersPerPoint: preset('1:50').metersPerPoint };
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);

test('X 1:100, Y 1:50: 10 mm across reads 1.00 m, 10 mm up reads 0.50 m', () => {
  assert.equal(measureLabel('length', [[0, 0], [mm(10), 0]], xy), '1.00 m');
  assert.equal(measureLabel('length', [[0, 0], [0, mm(10)]], xy), '0.50 m');
});

test('a 45 degree line and a rectangle are right for the two scales', () => {
  const d = mm(10);
  near(measureValue('length', [[0, 0], [d, d]], xy.metersPerPoint, {}, xy.yMetersPerPoint), Math.hypot(1, 0.5));
  const rect = [[0, 0], [mm(20), 0], [mm(20), mm(10)], [0, mm(10)]] as [number, number][];
  near(measureValue('area', rect, xy.metersPerPoint, {}, xy.yMetersPerPoint), 2 * 0.5);
  near(measureValue('perimeter', rect, xy.metersPerPoint, {}, xy.yMetersPerPoint), 2 * 2 + 2 * 0.5);
});

test('without a separate Y both axes use X', () => {
  assert.equal(measureLabel('length', [[0, 0], [0, mm(10)]], x100), '1.00 m');
  assert.equal(measureLabel('length', [[0, 0], [0, mm(10)]], { ...x100, yMetersPerPoint: x100.metersPerPoint }), '1.00 m');
});

test('realLengthAlong converts a page-point offset using each axis', () => {
  near(realLengthAlong(xy, mm(10), 0), 1);
  near(realLengthAlong(xy, 0, -mm(10)), 0.5);
  near(realLengthAlong(xy, mm(10), mm(10)), Math.hypot(1, 0.5));
  near(realLengthAlong(x100, 0, mm(10)), 1);
});

test('pageLengthFor turns a real length into page points along a direction', () => {
  // 1 m typed along X is 10 mm of paper; 0.5 m typed along Y is also 10 mm of paper.
  near(pageLengthFor(xy, 1, 1, 0), mm(10));
  near(pageLengthFor(xy, 0.5, 0, 1), mm(10));
  near(pageLengthFor(xy, 0.5, 0, -1), mm(10));
  // Round trip along a diagonal.
  const p = pageLengthFor(xy, 3, 3, 4);
  near(realLengthAlong(xy, (p * 3) / 5, (p * 4) / 5), 3);
  // No direction given: the X scale, as before.
  near(pageLengthFor(xy, 1), mm(10));
});

test('calibrating one axis never changes the other', () => {
  // A 100 pt line that is 5 m long on the page.
  const y = calibrateAxis(xy, 'y', 100, 5, 'm');
  assert.equal(y.metersPerPoint, xy.metersPerPoint);
  near(y.yMetersPerPoint!, 0.05);
  const x = calibrateAxis(xy, 'x', 100, 5, 'm');
  assert.equal(x.yMetersPerPoint, xy.yMetersPerPoint);
  near(x.metersPerPoint, 0.05);
  // No separate Y yet: calibrating X leaves Y following X; calibrating Y makes it separate.
  assert.equal(calibrateAxis(x100, 'x', 100, 5, 'm').yMetersPerPoint, undefined);
  assert.equal(calibrateAxis(x100, 'y', 100, 5, 'm').metersPerPoint, x100.metersPerPoint);
  // No scale at all: one line sets the page.
  near(calibrateAxis(null, 'x', 100, 5, 'm').metersPerPoint, 0.05);
});

test('dropping the separate Y makes new measurements use X for both axes', () => {
  const { yMetersPerPoint: _y, ...plain } = xy;
  assert.equal(measureLabel('length', [[0, 0], [0, mm(10)]], plain), '1.00 m');
  // The scale it was copied from is untouched.
  assert.equal(measureLabel('length', [[0, 0], [0, mm(10)]], xy), '0.50 m');
});
