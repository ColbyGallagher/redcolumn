import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crsById, crsProjection, gridToLatLon } from './crs.ts';
import { gridToLocal, gridToPage, localToGrid, pageToGrid, worldFrame } from './frame.ts';
import type { GeoProjection, GeoRegion } from './geo.ts';

const near = (a: number, b: number, tol: number) => assert.ok(Math.abs(a - b) <= tol, `${a} ≠ ${b} (±${tol})`);
const MGA56 = crsById('EPSG:7856')!;

/**
 * A 1:500 plan sheet of the Kestrel Road demo set: a 325.5 × 287 m window of MGA zone 56 drawn on
 * an A1 page (points), turned slightly, with its corners as control points.
 */
function sheet(projection: GeoProjection, crsName?: string): GeoRegion {
  const [e0, n0] = [318282.5, 6247187];
  const k = 72 / 25.4 / 0.5; // points per metre at 1:500
  const r = 0.01;
  const toPage = (e: number, n: number): [number, number] => {
    const [u, v] = [(e - e0) * k, (n - n0) * k];
    return [40 + u * Math.cos(r) - v * Math.sin(r), 30 + u * Math.sin(r) + v * Math.cos(r)];
  };
  const corners: [number, number][] = [
    [e0, n0],
    [e0 + 325.5, n0],
    [e0 + 325.5, n0 + 287],
    [e0, n0 + 287],
  ];
  const points = corners.map(([e, n]) => ({ at: toPage(e, n), ...gridToLatLon(MGA56, e, n) }));
  return { id: 'g', pageIndex: 0, name: 'Plan', bounds: points.map((q) => q.at), points, projection, crs: crsName, epsg: crsName ? undefined : 7856 };
}

test('grid → page → grid round-trips within a millimetre', () => {
  for (const region of [sheet(crsProjection(MGA56)), sheet({ kind: 'local' }, 'GDA2020 / MGA zone 56')]) {
    for (const [e, n] of [
      [318300, 6247200],
      [318450.123, 6247333.456],
      [318600, 6247470],
    ] as const) {
      const p = gridToPage(region, e, n);
      assert.ok(p);
      const g = pageToGrid(region, p);
      assert.ok(g);
      near(g[0], e, 0.001);
      near(g[1], n, 0.001);
    }
  }
});

test('a page point reads the grid coordinate drawn there', () => {
  const region = sheet(crsProjection(MGA56));
  // The window's lower-left corner is drawn at (40, 30).
  const g = pageToGrid(region, [40, 30]);
  assert.ok(g);
  near(g[0], 318282.5, 0.001);
  near(g[1], 6247187, 0.001);
});

test('a region with no CRS, or too few points, maps nothing', () => {
  const region = sheet(crsProjection(MGA56));
  assert.equal(pageToGrid({ ...region, epsg: undefined, crs: undefined }, [40, 30]), null);
  assert.ok(pageToGrid({ ...region, epsg: undefined, crs: undefined }, [40, 30], MGA56));
  assert.equal(gridToPage({ ...region, points: region.points.slice(0, 2) }, 318300, 6247200), null);
});

test('the world frame keeps a whole-kilometre origin', () => {
  const f = worldFrame(318282.5, 6247187.25, MGA56);
  assert.deepEqual(f.origin, [318000, 6247000, 0]);
  assert.deepEqual(gridToLocal(f, 318282.5, 6247187.25, 12.5), [282.5, 187.25, 12.5]);
  assert.deepEqual(localToGrid(f, 282.5, 187.25, 12.5), [318282.5, 6247187.25, 12.5]);
});
