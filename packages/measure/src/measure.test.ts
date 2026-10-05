import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calibratedScale, formatArea, formatFeetInches, formatLength, parseLength, parseScaleText, parseTypedScale, SCALE_PRESETS } from './scale.ts';
import { angleAt, arcPoints, arcSegment, bulgeThrough, expandArcs, labelAnchor, measureLabel, measureValue, pathLengthArcs, polygonArea, polygonAreaArcs, toDisplayQuantity } from './measure.ts';
import { SnapIndex } from './snap.ts';

const preset = (label: string) => SCALE_PRESETS.find((p) => p.label === label)!.scale;

test('architectural 1/4" = 1\'-0": one paper inch (72pt) is 4 feet', () => {
  const s = preset('1/4" = 1\'-0"');
  assert.equal(formatLength(72 * s.metersPerPoint, s), `4'-0"`);
});

test('engineering 1" = 20\': 3.5 paper inches is 70 feet', () => {
  const s = preset('1" = 20\'');
  assert.equal(measureLabel('length', [[0, 0], [252, 0]], s), '70.00 ft');
});

test('metric 1:100: 10 mm of paper is 1 m', () => {
  const s = preset('1:100');
  const tenMmInPoints = (10 / 25.4) * 72;
  assert.equal(measureLabel('length', [[0, 0], [0, tenMmInPoints]], s), '1.00 m');
});

test('feet-inches rounds to 1/16 and reduces fractions', () => {
  assert.equal(formatFeetInches(12.5), `12'-6"`);
  assert.equal(formatFeetInches(12 + 6.5 / 12), `12'-6 1/2"`);
  assert.equal(formatFeetInches(1 / 12 / 16), `0'-0 1/16"`);
  // 11.99999 ft rounds up to a whole foot rather than showing 11'-12".
  assert.equal(formatFeetInches(11.99999), `12'-0"`);
});

test('calibration: a 200pt line that is 25 ft', () => {
  const s = calibratedScale(200, 25, 'ft');
  assert.equal(measureLabel('length', [[0, 0], [400, 0]], s), `50'-0"`);
  assert.equal(measureLabel('area', [[0, 0], [200, 0], [200, 200], [0, 200]], s), '625.00 sf');
});

test('calibration rejects zero-length input', () => {
  assert.throws(() => calibratedScale(0, 10, 'ft'));
  assert.throws(() => calibratedScale(10, 0, 'ft'));
});

test('area is unsigned regardless of winding', () => {
  const cw: [number, number][] = [[0, 0], [10, 0], [10, 5], [0, 5]];
  assert.equal(polygonArea(cw), 50);
  assert.equal(polygonArea([...cw].reverse()), 50);
});

test('perimeter closes the polygon; polylength does not', () => {
  const pts: [number, number][] = [[0, 0], [3, 0], [3, 4]];
  assert.equal(measureValue('polylength', pts, 1), 7);
  assert.equal(measureValue('perimeter', pts, 1), 12);
});

test('count and angle', () => {
  assert.equal(measureValue('count', [[0, 0], [1, 1], [2, 2]], 1), 3);
  assert.equal(angleAt([10, 0], [0, 0], [0, 10]), 90);
  assert.equal(angleAt([10, 0], [0, 0], [-10, 0.0000001]).toFixed(3), '180.000');
});

test('area labels use square units', () => {
  const m = SCALE_PRESETS.find((p) => p.label === '1:100')!.scale;
  assert.equal(formatArea(12.345, m), '12.35 m²');
});

test('label anchor for a polyline sits at its halfway point', () => {
  assert.deepEqual(labelAnchor('polylength', [[0, 0], [10, 0], [10, 10]]), [10, 0]);
});

test('snap prefers endpoints, then intersections, then midpoints, then nearest', () => {
  // A plus sign: horizontal 0..100 at y=50, vertical 0..100 at x=50.
  const idx = new SnapIndex(new Float32Array([0, 50, 100, 50, 50, 0, 50, 100]), 16);
  assert.deepEqual(idx.snap([52, 49], 5), { point: [50, 50], kind: 'intersection' });
  assert.deepEqual(idx.snap([98, 51], 5), { point: [100, 50], kind: 'endpoint' });
  assert.deepEqual(idx.snap([25, 52], 5)?.kind, 'nearest');
  assert.equal(idx.snap([80, 80], 5), null);
  // Extra points (existing markup vertices) snap as endpoints.
  assert.deepEqual(idx.snap([80, 80], 5, [[81, 79]]), { point: [81, 79], kind: 'endpoint' });
});

test('snap finds long segments far from their endpoints', () => {
  const idx = new SnapIndex(new Float32Array([0, 0, 5000, 5000]), 24);
  const s = idx.snap([2501, 2499], 3);
  assert.equal(s?.kind, 'midpoint');
  assert.deepEqual(s?.point, [2500, 2500]);
});

test('parseLength accepts decimals and feet-inches', () => {
  assert.equal(parseLength('25', 'ft'), 25);
  assert.equal(parseLength('12.5', 'm'), 12.5);
  assert.equal(parseLength(`25'-6"`, 'ft'), 25.5);
  assert.equal(parseLength(`25' 6 1/2"`, 'ft'), 25 + 6.5 / 12);
  assert.equal(parseLength(`6"`, 'ft'), 0.5);
  assert.equal(parseLength(`3/4"`, 'in'), 0.75);
  assert.equal(parseLength(`10'`, 'in'), 120);
  assert.equal(parseLength('abc', 'ft'), null);
  assert.equal(parseLength('0', 'ft'), null);
  assert.equal(parseLength(`5'`, 'm'), null);
});

test('display quantities for spreadsheets', () => {
  const s = calibratedScale(100, 10, 'ft');
  assert.deepEqual(toDisplayQuantity('length', measureValue('length', [[0, 0], [100, 0]], s.metersPerPoint), s), { value: 10, unit: 'ft' });
  const area = toDisplayQuantity('area', measureValue('area', [[0, 0], [100, 0], [100, 100], [0, 100]], s.metersPerPoint), s);
  assert.equal(area.unit, 'sf');
  assert.ok(Math.abs(area.value - 100) < 1e-9);
});

test('parseScaleText reads title-block scales and returns presets', () => {
  assert.equal(parseScaleText(`SCALE: 1/4" = 1'-0"`), preset('1/4" = 1\'-0"'));
  assert.equal(parseScaleText(`1" = 20'`), preset('1" = 20\''));
  assert.equal(parseScaleText(`SCALE 1"=40'-0"`), preset('1" = 40\''));
  assert.equal(parseScaleText('SCALE 1:100'), preset('1:100'));
  assert.equal(parseScaleText(`1-1/2" = 1'-0"`), preset('1-1/2" = 1\'-0"'));
  const odd = parseScaleText(`1" = 25'`)!;
  assert.equal(odd.label, `1" = 25'`);
  assert.equal(formatLength(72 * odd.metersPerPoint, odd), '25.00 ft');
  assert.equal(parseScaleText('SCALE: NTS'), null);
  assert.equal(parseScaleText('AS NOTED'), null);
  assert.equal(parseScaleText('SITE PLAN'), null);
});

test('circles, arcs and volumes measure; cutouts come off areas and volumes', async () => {
  const { arcLength3, formatSlope, measureDetails, slopeFactor } = await import('./measure.ts');
  const { formatFractionalInches } = await import('./scale.ts');
  const s = calibratedScale(1, 1, 'm');
  assert.equal(measureValue('diameter', [[0, 0], [10, 0]], 1), 10);
  assert.equal(measureValue('radius', [[0, 0], [0, 4]], 1), 4);
  // A half circle of radius 10 from (−10,0) over (0,−10) to (10,0).
  assert.ok(Math.abs(arcLength3([-10, 0], [0, -10], [10, 0]) - Math.PI * 10) < 1e-9);
  // The same ends through the lower point: the other half.
  assert.ok(Math.abs(arcLength3([-10, 0], [0, 10], [10, 0]) - Math.PI * 10) < 1e-9);
  // A quarter arc.
  assert.ok(Math.abs(arcLength3([10, 0], [Math.SQRT1_2 * 10, Math.SQRT1_2 * 10], [0, 10]) - (Math.PI * 10) / 2) < 1e-9);
  const square: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]];
  const hole: [number, number][] = [[2, 2], [4, 2], [4, 4], [2, 4]];
  assert.equal(measureValue('area', square, 1, { holes: [hole] }), 96);
  assert.equal(measureValue('volume', square, 1, { holes: [hole], depth: 2 }), 192);
  assert.equal(measureLabel('volume', square, s, { depth: 0.5 }), '50.00 m³');
  // A 45° slope makes plan lengths √2 longer; 12:12 pitch is the same slope.
  assert.ok(Math.abs(slopeFactor({ kind: 'degrees', value: 45 }) - Math.SQRT2) < 1e-9);
  assert.ok(Math.abs(slopeFactor({ kind: 'pitch', value: 12 }) - Math.SQRT2) < 1e-9);
  assert.ok(Math.abs(slopeFactor({ kind: 'percent', value: 100 }) - Math.SQRT2) < 1e-9);
  assert.equal(formatSlope({ kind: 'pitch', value: 6 }), '6:12');
  // A wall: 10 long, 3 high.
  assert.deepEqual(measureDetails('polylength', [[0, 0], [10, 0]], 1, { depth: 3 }), { length: 10, wallArea: 30 });
  const d = measureDetails('area', square, 1, { depth: 2 });
  assert.deepEqual([d.length, d.area, d.volume], [40, 100, 200]);
  assert.equal(formatFractionalInches(6.5), '6 1/2"');
  assert.equal(formatFractionalInches(0.25), '1/4"');
  assert.equal(formatFractionalInches(3), '3"');
  const inches = { ...calibratedScale(72, 1, 'in'), feetInches: true, precision: 8 };
  assert.equal(formatLength((72 * 2.375 * 0.0254) / 72, inches), '2 3/8"');
});

test('arc segments: lengths and areas are exact, both ways round', () => {
  const half = arcSegment([0, 0], [2, 0], 1);
  assert.ok(Math.abs(half.length - Math.PI) < 1e-9);
  assert.ok(Math.abs(half.area - Math.PI / 2) < 1e-9);
  // A 2×2 square whose bottom edge bulges out into a half circle.
  const ccw: [number, number][] = [
    [0, 0],
    [2, 0],
    [2, 2],
    [0, 2],
  ];
  const out = [1, 0, 0, 0];
  assert.ok(Math.abs(polygonAreaArcs(ccw, out) - (4 + Math.PI / 2)) < 1e-9);
  assert.ok(Math.abs(pathLengthArcs(ccw, out, true) - (6 + Math.PI)) < 1e-9);
  // The same shape drawn the other way round: the bulge flips sign to stay outside.
  const cw = [...ccw].reverse();
  assert.ok(Math.abs(polygonAreaArcs(cw, [0, 0, 0, -1]) - (4 + Math.PI / 2)) < 1e-9);
  // Bulging inwards cuts into it.
  assert.ok(Math.abs(polygonAreaArcs(ccw, [-1, 0, 0, 0]) - (4 - Math.PI / 2)) < 1e-9);
  // Measurements use the arcs.
  assert.ok(Math.abs(measureValue('area', ccw, 1, { bulges: out }) - (4 + Math.PI / 2)) < 1e-9);
  assert.ok(Math.abs(measureValue('polylength', [[0, 0], [2, 0]], 1, { bulges: [1] }) - Math.PI) < 1e-9);
});

test('a bulge from a point on the arc; the arc drawn through it', () => {
  const b = bulgeThrough([0, 0], [2, 0], [1, -1]);
  assert.ok(Math.abs(b - 1) < 1e-9);
  const pts = arcPoints([0, 0], [2, 0], b, 24);
  // Every point is on the unit circle about (1, 0), below the chord, ending at q.
  for (const [x, y] of pts) assert.ok(Math.abs(Math.hypot(x - 1, y) - 1) < 1e-9 && y <= 1e-9);
  assert.deepEqual(pts.at(-1), [2, 0]);
  // Densified shapes agree with the exact area.
  const square: [number, number][] = [
    [0, 0],
    [2, 0],
    [2, 2],
    [0, 2],
  ];
  const dense = expandArcs(square, [0.4, 0, -0.3, 0], true);
  assert.ok(Math.abs(polygonArea(dense) - polygonAreaArcs(square, [0.4, 0, -0.3, 0])) < 0.01);
});

test('parseTypedScale accepts loosely typed scales', () => {
  assert.equal(parseTypedScale(`1/4 = 1'`), preset('1/4" = 1\'-0"'));
  assert.equal(parseTypedScale('1/4 in = 1 ft'), preset('1/4" = 1\'-0"'));
  assert.equal(parseTypedScale(`1/8"=1'-0"`), preset('1/8" = 1\'-0"'));
  assert.equal(parseTypedScale('1" = 20'), preset('1" = 20\''));
  assert.equal(parseTypedScale('1:100'), preset('1:100'));
  assert.equal(parseTypedScale('1:75')?.label, '1:75');
  assert.equal(parseTypedScale('NTS'), null);
  assert.equal(parseTypedScale('hello'), null);
});
