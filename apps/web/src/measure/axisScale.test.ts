import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calibratedScale, SCALE_PRESETS, type Scale } from '@nb/measure';
import { calibrateAxes, calibrateFromLine, calibrationLength, hasSeparateY, spaceArea } from './axisScale.ts';

const preset = (label: string) => SCALE_PRESETS.find((p) => p.label === label)!.scale;
const x100 = preset('1:100');
const xy: Scale = { ...x100, yMetersPerPoint: preset('1:50').metersPerPoint };
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);

test('a separate Y scale means the dialog offers X and Y; otherwise one axis for both', () => {
  assert.deepEqual(calibrateAxes(xy), ['x', 'y']);
  assert.deepEqual(calibrateAxes(x100), ['both']);
  assert.deepEqual(calibrateAxes(null), ['both']);
  // A Y equal to X is not a separate scale.
  assert.equal(hasSeparateY({ ...x100, yMetersPerPoint: x100.metersPerPoint }), false);
});

test('an axis takes the matching part of the line; a line that runs the other way is refused', () => {
  assert.deepEqual(calibrationLength([100, 5], 'x'), { points: 100 });
  assert.deepEqual(calibrationLength([-5, -100], 'y'), { points: 100 });
  assert.deepEqual(calibrationLength([30, 40], 'both'), { points: 50 });
  assert.deepEqual(calibrationLength([100, 100], 'x'), { points: 100 });
  // 5% of its length is too little of it.
  assert.match((calibrationLength([100, 5], 'y') as { error: string }).error, /more vertical/);
  assert.match((calibrationLength([5, 100], 'x') as { error: string }).error, /more horizontal/);
  assert.ok('error' in calibrationLength([0, 0], 'both'));
});

test('calibrating X with a horizontal line leaves Y, and the reverse', () => {
  const x = calibrateFromLine(xy, 'x', [100, 3], 5, 'm');
  assert.ok('scale' in x);
  near(x.scale.metersPerPoint, 0.05);
  assert.equal(x.scale.yMetersPerPoint, xy.yMetersPerPoint);
  const y = calibrateFromLine(xy, 'y', [3, 200], 5, 'm');
  assert.ok('scale' in y);
  near(y.scale.yMetersPerPoint!, 0.025);
  assert.equal(y.scale.metersPerPoint, xy.metersPerPoint);
  // A slanted line cannot calibrate Y.
  assert.ok('error' in calibrateFromLine(xy, 'y', [200, 10], 5, 'm'));
});

test('without a separate Y one line sets the whole scale from its full length', () => {
  const r = calibrateFromLine(x100, 'both', [30, 40], 5, 'm');
  assert.ok('scale' in r);
  assert.deepEqual(r.scale, calibratedScale(50, 5, 'm'));
  assert.ok('scale' in calibrateFromLine(null, 'both', [30, 40], 5, 'm'));
});

test('a Space\'s area uses both scales', () => {
  const mm = (n: number) => (n / 25.4) * 72;
  const room: [number, number][] = [[0, 0], [mm(20), 0], [mm(20), mm(10)], [0, mm(10)]];
  near(spaceArea(room, xy), 2 * 0.5);
  near(spaceArea(room, x100), 2 * 1);
});
