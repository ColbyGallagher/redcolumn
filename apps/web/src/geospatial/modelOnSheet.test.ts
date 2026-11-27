import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crsById } from '@nb/measure';
import { geoRegionFor, gridToPage, pageToGrid, placementFromGeoRegion, type ModelPlacement } from './align';
import { modelLayers, sameCrs } from './modelOnSheet';
import type { GeoModel } from './model';

const MGA56 = crsById('EPSG:7856')!;
const MGA55 = crsById('EPSG:7855')!;
// A sheet at 1:500 (about 5.67 points per metre), grid north turned 12° on the page.
const TRUE: ModelPlacement = { e0: 318700, n0: 6247200, x: 600, y: 400, scale: 72 / 0.0254 / 500, rotation: (12 * Math.PI) / 180 };
const BOUNDS: [number, number][] = [
  [100, 80],
  [1100, 80],
  [1100, 720],
  [100, 720],
];
const region = (crs = MGA56, pageIndex = 0) => geoRegionFor({ toGrid: (p) => pageToGrid(TRUE, p), crs, pageIndex, bounds: BOUNDS, name: 'Plan' });

const model = (paths: [number, number][][], crs: typeof MGA56 | null = MGA56): GeoModel => ({
  name: 'm.ifc',
  format: 'IFC',
  crsName: crs?.name ?? null,
  crs,
  paths,
  points: [],
  warnings: [],
});

test("a sheet's map registration gives back its placement, within a hundredth of a point", () => {
  const fit = placementFromGeoRegion(region());
  assert.ok(fit);
  assert.ok(fit.error < 0.01, `error ${fit.error}`);
  assert.ok(Math.abs(fit.placement.scale / TRUE.scale - 1) < 1e-6);
  assert.ok(Math.abs(fit.placement.rotation - TRUE.rotation) < 1e-6);
  for (const g of [
    [318650, 6247180],
    [318800, 6247260],
  ] as [number, number][]) {
    const [x, y] = gridToPage(fit.placement, g);
    const [tx, ty] = gridToPage(TRUE, g);
    assert.ok(Math.hypot(x - tx, y - ty) < 0.01);
  }
});

test('a registration with too few points, or no coordinate system, places nothing', () => {
  const r = region();
  assert.equal(placementFromGeoRegion({ ...r, points: r.points.slice(0, 1) }), null);
  assert.equal(placementFromGeoRegion({ ...r, crs: 'Nowhere', epsg: undefined }), null);
});

test("the model's lines land on the region they cross, in the region's coordinate system only", () => {
  const near: [number, number][] = [
    [318690, 6247190],
    [318710, 6247210],
  ];
  const far: [number, number][] = [
    [330000, 6260000],
    [330010, 6260010],
  ];
  const layers = modelLayers([model([near, far])], [region()], 0);
  assert.equal(layers.length, 1);
  assert.equal(layers[0]!.paths.length, 1, 'the far line is left out');
  const [a] = layers[0]!.paths[0]!;
  const [ex, ey] = gridToPage(TRUE, near[0]!);
  assert.ok(Math.hypot(a![0] - ex, a![1] - ey) < 0.01);
  assert.deepEqual(layers[0]!.bounds, BOUNDS);

  assert.equal(modelLayers([model([near])], [region()], 1).length, 0, 'another page');
  assert.equal(modelLayers([model([near], MGA55)], [region()], 0).length, 0, 'another zone');
});

test('a model naming no coordinate system is taken to be in the sheet’s; one naming an unknown one is not', () => {
  assert.ok(sameCrs(model([], null), region()));
  assert.ok(!sameCrs({ crs: null, crsName: 'Local grid' }, region()));
  assert.ok(sameCrs(model([]), region()));
  assert.ok(!sameCrs(model([], MGA55), region()));
});
