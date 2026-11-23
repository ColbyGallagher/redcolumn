import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crsById } from '@nb/measure';
import type { MarkupStore } from '@nb/markup';
import type { PdfDocument } from '@nb/pdf-core';
import { geoRegionFor, pageToGrid, type ModelPlacement } from '../geospatial/align';
import { gridAtPage, ringAround, sheetsAt } from './links';
import type { SheetSource } from './sheetOverlays';

const PLACE: ModelPlacement = { e0: 318700, n0: 6247200, x: 300, y: 400, scale: 0.55, rotation: 0.2 };
const region = geoRegionFor({
  toGrid: (p) => pageToGrid(PLACE, p),
  crs: crsById('EPSG:7856')!,
  pageIndex: 2,
  bounds: [
    [40, 60],
    [560, 60],
    [560, 740],
    [40, 740],
  ],
  name: 'Plan',
});
const source: SheetSource = { key: 'f:2:geo', label: 'Plan', region, doc: {} as PdfDocument, store: {} as MarkupStore };

const near = (a: readonly number[], b: readonly number[], tol: number) => a.every((v, i) => Math.abs(v - b[i]!) <= tol);

test('a page point on a registered region gives its map position; off the region or page, none', () => {
  const grid = gridAtPage([region], 2, [200, 300]);
  assert.ok(grid);
  assert.ok(near(grid, pageToGrid(PLACE, [200, 300]), 0.05), `${grid}`);
  assert.equal(gridAtPage([region], 2, [700, 300]), null);
  assert.equal(gridAtPage([region], 1, [200, 300]), null);
});

test('a map position finds the sheets that show it, at the page point there', () => {
  const [e, n] = pageToGrid(PLACE, [420, 610]);
  const hits = sheetsAt([source], e, n);
  assert.equal(hits.length, 1);
  assert.ok(near(hits[0]!.point, [420, 610], 0.05), `${hits[0]!.point}`);
  const [fe, fn] = pageToGrid(PLACE, [900, 900]);
  assert.deepEqual(sheetsAt([source], fe, fn), []);
});

test('the highlight ring is centred on the point', () => {
  assert.deepEqual(ringAround([100, 50], 20), { x: 90, y: 40, w: 20, h: 20 });
});
