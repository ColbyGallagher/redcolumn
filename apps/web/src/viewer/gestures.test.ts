import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyPinch, PenGuard, pinchStep } from './gestures.ts';

const toPage = (v: { zoom: number; panX: number; panY: number }, x: number, y: number) => [(x - v.panX) / v.zoom, (y - v.panY) / v.zoom];

test('spreading two fingers zooms about their midpoint, keeping that page point under them', () => {
  const view = { zoom: 1, panX: 0, panY: 0 };
  const step = pinchStep([{ x: 100, y: 100 }, { x: 200, y: 100 }], [{ x: 50, y: 100 }, { x: 250, y: 100 }]);
  assert.equal(step.scale, 2);
  assert.deepEqual([step.cx, step.cy, step.dx, step.dy], [150, 100, 0, 0]);
  const next = applyPinch(view, step);
  assert.equal(next.zoom, 2);
  assert.deepEqual(toPage(next, 150, 100), toPage(view, 150, 100));
});

test('moving two fingers together pans, and a pinch while moving follows the fingers', () => {
  let view = { zoom: 1.5, panX: 10, panY: -20 };
  const under = toPage(view, 300, 300);
  const from: [{ x: number; y: number }, { x: number; y: number }] = [{ x: 250, y: 300 }, { x: 350, y: 300 }];
  const pan = pinchStep(from, [{ x: 270, y: 340 }, { x: 370, y: 340 }]);
  assert.equal(pan.scale, 1);
  view = applyPinch(view, pan);
  assert.deepEqual(toPage(view, 320, 340), under);
  const both = pinchStep([{ x: 270, y: 340 }, { x: 370, y: 340 }], [{ x: 245, y: 360 }, { x: 395, y: 360 }]);
  view = applyPinch(view, both);
  const [ux, uy] = toPage(view, 320, 360);
  assert.ok(Math.abs(ux! - under[0]!) < 1e-9 && Math.abs(uy! - under[1]!) < 1e-9);
  assert.equal(view.zoom, 1.5 * 1.5);
});

test('fingers almost touching do not zoom wildly', () => {
  assert.equal(pinchStep([{ x: 0, y: 0 }, { x: 2, y: 0 }], [{ x: 0, y: 0 }, { x: 60, y: 0 }]).scale, 1);
});

test('palm rejection ignores touches while the pen is down and just after', () => {
  const g = new PenGuard();
  assert.equal(g.rejects(0), false);
  assert.equal(g.penUsed, false);
  g.pen('down', 1000);
  assert.equal(g.rejects(1100), true);
  g.pen('move', 1500);
  g.pen('up', 1600);
  assert.equal(g.rejects(1700), true, 'just lifted');
  assert.equal(g.rejects(2000), false);
  assert.equal(g.penUsed, true);
});
