import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_STYLES, type Markup } from '@nb/markup';
import { METERS_PER_UNIT, pageLengthFor, parseLength, SCALE_PRESETS, type Scale } from '@nb/measure';
import { settings } from '../settings/settings';
import { cadClick, stretching, type CadContext } from './cadTools';

const mm = (n: number) => (n / 25.4) * 72;
const preset = (label: string) => SCALE_PRESETS.find((p) => p.label === label)!.scale;
/** X 1:100, Y 1:50: a metre typed along the page is 10 mm across it, but 20 mm up it. */
const xy: Scale = { ...preset('1:100'), yMetersPerPoint: preset('1:50').metersPerPoint };
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} vs ${b}`);

const line = (points: [number, number][]): Markup => ({
  id: 'a', type: 'line', pageIndex: 0, points, style: { ...DEFAULT_STYLES.line }, status: 'none', author: '', createdAt: 0, modifiedAt: 0,
});

function context(selected: Markup[], scale: Scale): CadContext {
  return {
    page: selected,
    selected,
    hit: () => selected[0],
    frozen: () => false,
    group: (m) => [m.id],
    length: (text, _m, dir) => {
      const v = parseLength(text, scale.unit);
      return v === null ? null : pageLengthFor(scale, v * METERS_PER_UNIT[scale.unit], dir?.[0] ?? 1, dir?.[1] ?? 0);
    },
    yStretch: () => (scale.yMetersPerPoint ?? scale.metersPerPoint) / scale.metersPerPoint,
    create: (type, points) => ({ ...line(points), id: 'new', type }),
    clone: (m, patch) => ({ ...m, ...patch, id: 'copy' }),
    shift: false,
  };
}

test('stretching maps in and out of the Y-stretched page', () => {
  const [to, back] = stretching({ yStretch: () => 0.5 }, null);
  assert.deepEqual(to([10, 10]), [10, 5]);
  assert.deepEqual(back(to([10, 10])), [10, 10]);
  const [same] = stretching({}, null);
  assert.deepEqual(same([3, 4]), [3, 4]);
});

test('a typed Move distance goes the way the pointer points, in real length that way', () => {
  settings.set({ moveDistance: '1' });
  const m = line([[0, 0], [10, 0]]);
  // 1 m across the page is 10 mm of paper; up it, at 1:50, it is 20 mm.
  const across = cadClick('move', [{ at: [0, 0] }], [50, 0], context([m], xy));
  assert.ok('done' in across);
  near(across.done.update[0]![1].points![0]![0], mm(10));
  const up = cadClick('move', [{ at: [0, 0] }], [0, 50], context([m], xy));
  assert.ok('done' in up);
  near(up.done.update[0]![1].points![0]![1], mm(20));
  settings.set({ moveDistance: '' });
});

test('Lengthen to a typed total is worked out in real length, up the page as well as across', () => {
  settings.set({ lengthenMode: 'total', lengthenValue: '1' });
  // A vertical line of 5 mm of paper is 0.25 m at 1:50; lengthened to 1 m it is 20 mm of paper.
  const m = line([[0, 0], [0, mm(5)]]);
  const r = cadClick('lengthen', [], [0, mm(5)], context([m], xy));
  assert.ok('done' in r);
  const end = r.done.update[0]![1].points!.at(-1)!;
  near(end[0], 0);
  near(end[1], mm(20));
  settings.set({ lengthenValue: '' });
});

test('Divide by a typed spacing marks the path at real spacings', () => {
  settings.set({ divideMode: 'spacing', divideSpacing: '0.5' });
  // 20 mm up the page is 1 m at 1:50: marks every 0.5 m are every 10 mm.
  const m = line([[0, 0], [0, mm(20)]]);
  const r = cadClick('divide', [], [0, mm(5)], context([m], xy));
  assert.ok('done' in r);
  const ys = r.done.add[0]!.points.map((p) => p[1]);
  assert.ok(ys.some((y) => Math.abs(y - mm(10)) < 1e-6), JSON.stringify(ys));
  settings.set({ divideSpacing: '' });
});
