import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fitWidthView, FIT_WIDTH_MARGIN, type Camera } from './fitWidthView.ts';

const viewport = { width: 1048, height: 600 };
// A landscape sheet: fitted to the width it is 1000 x 800 CSS px, taller than the view.
const bounds = { x: 0, y: 0, w: 500, h: 400 };
const fit = (camera: Camera, b = bounds) => fitWidthView({ bounds: b, viewport, camera, minZoom: 0.01, maxZoom: 64 });
/** Where the content's edges land on screen. */
const edges = (c: Camera, b = bounds) => ({
  left: c.panX + b.x * c.zoom,
  right: c.panX + (b.x + b.w) * c.zoom,
  top: c.panY + b.y * c.zoom,
  bottom: c.panY + (b.y + b.h) * c.zoom,
});

test('the page spans the width however far the view was panned sideways (#493)', () => {
  for (const camera of [
    { zoom: 1.4, panX: 174, panY: 20 },
    { zoom: 20, panX: -7000, panY: -3000 },
    { zoom: 0.1, panX: 900, panY: 500 },
  ]) {
    const e = edges(fit(camera));
    assert.equal(e.left, FIT_WIDTH_MARGIN);
    assert.equal(e.right, viewport.width - FIT_WIDTH_MARGIN);
  }
});

test('the middle of the view keeps its height when zooming back from a close-up', () => {
  // At zoom 10 the view's middle is 220 pt down the page.
  const next = fit({ zoom: 10, panX: -3000, panY: 300 - 220 * 10 });
  assert.equal((300 - next.panY) / next.zoom, 220);
});

test('a view above or below the page is brought back to its top or bottom edge', () => {
  assert.equal(edges(fit({ zoom: 2, panX: 0, panY: 5000 })).top, FIT_WIDTH_MARGIN);
  assert.equal(edges(fit({ zoom: 2, panX: 0, panY: -5000 })).bottom, viewport.height - FIT_WIDTH_MARGIN);
});

test('a page shorter than the view when fitted is centred in it', () => {
  const wide = { x: 0, y: 0, w: 500, h: 100 };
  const e = edges(fit({ zoom: 8, panX: -999, panY: -999 }, wide), wide);
  assert.deepEqual([e.top, e.bottom], [200, 400]);
});

test('content away from the world origin is centred too', () => {
  const offset = { x: -120, y: 340, w: 500, h: 400 };
  const e = edges(fit({ zoom: 3, panX: 0, panY: 0 }, offset), offset);
  assert.equal(e.left, FIT_WIDTH_MARGIN);
  assert.equal(e.right, viewport.width - FIT_WIDTH_MARGIN);
  assert.equal(e.top, FIT_WIDTH_MARGIN);
});
