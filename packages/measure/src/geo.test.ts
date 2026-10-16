import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatLatLon, geoAt, geoProject, geoUnproject, WGS84, type GeoProjection, type GeoRegion } from './geo.ts';

const near = (a: number, b: number, tol: number) => assert.ok(Math.abs(a - b) <= tol, `${a} ≠ ${b} (±${tol})`);

test('transverse Mercator matches Snyder’s worked example', () => {
  // Snyder (1987) p. 269: Clarke 1866, λ0 = 75°W, k0 = 0.9996; 40.5°N 73.5°W → x 127,106.5 m, y 4,484,124.4 m.
  const [x, y] = geoProject({ kind: 'transverseMercator', lon0: -75, ellipsoid: { a: 6378206.4, f: 1 / 294.978698214 } }, 40.5, -73.5);
  near(x * 0.9996, 127106.5, 0.2);
  near(y * 0.9996, 4484124.4, 0.2);
});

test('projections invert', () => {
  const cases: GeoProjection[] = [
    { kind: 'transverseMercator', lon0: 153, ellipsoid: WGS84 },
    { kind: 'mercator', lon0: 0, ellipsoid: WGS84 },
    { kind: 'mercator', lon0: 0, ellipsoid: { a: 6378137, f: 0 } },
    { kind: 'lambertConic', lon0: 134, lat0: 0, lat1: -18, lat2: -36, ellipsoid: WGS84 },
    { kind: 'geographic' },
  ];
  for (const p of cases) {
    const [x, y] = geoProject(p, -33.8568, 151.2153);
    const [lat, lon] = geoUnproject(p, x, y);
    near(lat, -33.8568, 1e-8);
    near(lon, 151.2153, 1e-8);
  }
});

/**
 * A map drawn in `projection`, laid on a page at a scale, offset and slight rotation, with its
 * corners as control points.
 */
function map(projection: GeoProjection, corners: [number, number][]) {
  const proj = corners.map(([lat, lon]) => geoProject(projection, lat, lon));
  const k = 0.01;
  const r = 0.02;
  const ox = Math.min(...proj.map((p) => p[0]));
  const oy = Math.max(...proj.map((p) => p[1]));
  const toPage = ([x, y]: [number, number]): [number, number] => {
    const u = (x - ox) * k;
    const v = (oy - y) * k;
    return [100 + u * Math.cos(r) - v * Math.sin(r), 50 + u * Math.sin(r) + v * Math.cos(r)];
  };
  const region: GeoRegion = { id: 'g', pageIndex: 0, name: 'Map', bounds: proj.map(toPage), points: corners.map(([lat, lon], i) => ({ at: toPage(proj[i]!), lat, lon })), projection };
  return { region, at: (lat: number, lon: number) => toPage(geoProject(projection, lat, lon)) };
}

test('a point on a projected map reads back its latitude and longitude', () => {
  // An MGA zone 56 map sheet around Sydney.
  const mga56: GeoProjection = { kind: 'transverseMercator', lon0: 153, ellipsoid: WGS84 };
  const { region, at } = map(mga56, [[-33.8, 151.1], [-33.95, 151.1], [-33.95, 151.3], [-33.8, 151.3]]);
  const got = geoAt([region], 0, at(-33.8568, 151.2153));
  assert.ok(got);
  near(got.lat, -33.8568, 1e-7);
  near(got.lon, 151.2153, 1e-7);
  // Off the map, and on another page, there is nothing to read.
  assert.equal(geoAt([region], 0, [0, 0]), null);
  assert.equal(geoAt([region], 1, at(-33.8568, 151.2153)), null);
});

test('an unknown projection is approximated closely over a map sheet', () => {
  const lcc: GeoProjection = { kind: 'lambertConic', lon0: -100, lat0: 40, lat1: 33, lat2: 45, ellipsoid: WGS84 };
  const { region, at } = map(lcc, [[39.9, -105.1], [40.1, -105.1], [40.1, -104.9], [39.9, -104.9]]);
  const got = geoAt([{ ...region, projection: { kind: 'local' } }], 0, at(40.0, -105.0));
  assert.ok(got);
  // Within about a metre.
  near(got.lat, 40.0, 1e-5);
  near(got.lon, -105.0, 1e-5);
});

test('too few control points read nothing', () => {
  const { region, at } = map({ kind: 'geographic' }, [[0, 0], [1, 1]]);
  assert.equal(geoAt([region], 0, at(0.5, 0.5)), null);
});

test('latitudes and longitudes are shown as decimals or degrees, minutes and seconds', () => {
  assert.equal(formatLatLon(-33.86882, 151.20929), '-33.868820, 151.209290');
  assert.equal(formatLatLon(-33.86882, 151.20929, 'dms'), '33°52′07.8″S 151°12′33.4″E');
  // 59.96″ carries into the next minute.
  assert.equal(formatLatLon(10.999989, -0.5, 'dms'), '11°00′00.0″N 0°30′00.0″W');
});
