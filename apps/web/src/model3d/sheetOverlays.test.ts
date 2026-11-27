import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crsById } from '@nb/measure';
import type { Markup, MarkupStore } from '@nb/markup';
import type { PdfDocument } from '@nb/pdf-core';
import { geoRegionFor, gridToPage, pageToGrid, type ModelPlacement } from '../geospatial/align';
import { hashText, sheetOverlay, type SheetSource } from './sheetOverlays';

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

const markup = (id: string, type: Markup['type'], points: [number, number][], stroke = '#2563eb'): Markup =>
  ({ id, type, pageIndex: 2, points, style: { stroke, fill: null, width: 1, opacity: 1 } }) as unknown as Markup;

const source = (markups: Markup[]): SheetSource => ({
  key: 'f:2:geo',
  label: 'Plan',
  region,
  doc: {} as PdfDocument,
  store: { forPage: (p: number) => markups.filter((m) => m.pageIndex === p) } as unknown as MarkupStore,
});

test("a draped sheet's markups become map lines; closed shapes close and markups off the region stay off", async () => {
  const overlay = await sheetOverlay(
    source([
      markup('a', 'polyline', [
        [100, 100],
        [200, 150],
      ]),
      markup('b', 'rect', [
        [300, 300],
        [350, 340],
      ], '#e03131'),
      markup('c', 'line', [
        [900, 900],
        [950, 950],
      ]),
    ]),
    { show: true, mode: 'drape', height: 16, opacity: 1 },
  );
  assert.ok(overlay);
  assert.equal(overlay.image, null);
  assert.equal(overlay.lines.length, 2);
  const [line, rect] = overlay.lines;
  assert.equal(line!.points.length, 2);
  const back = gridToPage(PLACE, line!.points[0]!);
  assert.ok(Math.hypot(back[0] - 100, back[1] - 100) < 0.01);
  assert.equal(rect!.points.length, 5, 'a rectangle is its four corners, closed');
  assert.deepEqual(rect!.points[0], rect!.points[4]);
  assert.equal(rect!.colour, '#e03131');
});

test("an overlay's version changes with the page's markups and how it shows, and only then", async () => {
  const m = markup('a', 'polyline', [
    [100, 100],
    [200, 150],
  ]);
  const setting = { show: true, mode: 'drape' as const, height: 16, opacity: 1 };
  const v1 = (await sheetOverlay(source([m]), setting))!.version;
  assert.equal((await sheetOverlay(source([m]), setting))!.version, v1);
  assert.notEqual((await sheetOverlay(source([{ ...m, points: [[100, 100], [210, 150]] }]), setting))!.version, v1);
  assert.notEqual((await sheetOverlay(source([m]), { ...setting, opacity: 0.5 }))!.version, v1);
  assert.notEqual(hashText('a'), hashText('b'));
});
