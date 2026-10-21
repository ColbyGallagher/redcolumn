import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crsWkt, findCrs, GDA2020_MGA, gridToLatLon, latLonToGrid } from './crs.ts';

const near = (a: number, b: number, tol: number) => assert.ok(Math.abs(a - b) <= tol, `${a} ≠ ${b} (±${tol})`);

test('GDA2020 MGA zones 46–59', () => {
  assert.equal(GDA2020_MGA.length, 14);
  assert.equal(GDA2020_MGA[0]!.epsg, 7846);
  assert.equal(GDA2020_MGA.at(-1)!.epsg, 7859);
  assert.equal(GDA2020_MGA.find((c) => c.epsg === 7856)!.lon0, 153);
});

test('grid coordinates match the ICSM worked example (Flinders Peak, zone 55)', () => {
  const zone55 = findCrs('EPSG:7855')!;
  const [e, n] = latLonToGrid(zone55, -(37 + 57 / 60 + 3.7203 / 3600), 144 + 25 / 60 + 29.52440 / 3600);
  near(e, 273741.297, 0.05);
  near(n, 5796489.777, 0.05);
  const back = gridToLatLon(zone55, e, n);
  near(back.lat, -(37 + 57 / 60 + 3.7203 / 3600), 1e-8);
  near(back.lon, 144 + 25 / 60 + 29.5244 / 3600, 1e-8);
});

test('finds the CRS a file names', () => {
  assert.equal(findCrs('EPSG:7856')?.epsg, 7856);
  assert.equal(findCrs(7855)?.epsg, 7855);
  assert.equal(findCrs('GDA2020 / MGA zone 56')?.epsg, 7856);
  assert.equal(findCrs('MGA2020 Zone 55')?.epsg, 7855);
  assert.equal(findCrs('GDA2020 MGA Zone 50')?.epsg, 7850);
  assert.equal(findCrs('GDA94 / MGA zone 56'), null);
  assert.equal(findCrs('EPSG:28356'), null);
  assert.equal(findCrs(''), null);
});

test('WKT names the zone and its parameters', () => {
  const wkt = crsWkt(findCrs(7856)!);
  assert.match(wkt, /^PROJCS\["GDA2020 \/ MGA zone 56"/);
  assert.match(wkt, /central_meridian",153/);
  assert.match(wkt, /AUTHORITY\["EPSG","7856"\]\]$/);
});
