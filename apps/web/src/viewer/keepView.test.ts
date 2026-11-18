import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keepView, keptCentre } from './keepView.ts';

const A3 = { width: 1191, height: 842 };
const A1 = { width: 2384, height: 1684 };

test('keptCentre keeps the same point on a page of the same size', () => {
  assert.deepEqual(keptCentre([300, 200], { width: 1224, height: 792 }), [300, 200]);
});

test('keptCentre clamps to the bounds of a smaller page', () => {
  assert.deepEqual(keptCentre([1000, 700], { width: 600, height: 400 }), [600, 400]);
  assert.deepEqual(keptCentre([-50, -10], { width: 600, height: 400 }), [0, 0]);
});

test('keptCentre falls back to the middle when a value is not finite', () => {
  assert.deepEqual(keptCentre([Number.NaN, 5], { width: 600, height: 400 }), [300, 5]);
  assert.deepEqual(keptCentre([Number.POSITIVE_INFINITY, 5], { width: 600, height: 400 }), [300, 5]);
});

test('same size: the same zoom and point, fit or not', () => {
  for (const atFit of [true, false]) {
    assert.deepEqual(keepView({ centre: [300, 200], zoom: 2, from: A3, to: { ...A3, width: A3.width + 0.5 }, atFit, turns: 0 }), {
      refit: false,
      zoom: 2,
      centre: [300, 200],
    });
  }
});

test('different sizes at fit: refit the new page', () => {
  assert.deepEqual(keepView({ centre: [595, 421], zoom: 0.8, from: A3, to: A1, atFit: true, turns: 0 }), { refit: true });
  assert.deepEqual(keepView({ centre: [1190, 842], zoom: 0.8, from: A1, to: A3, atFit: true, turns: 0 }), { refit: true });
});

test('different sizes, zoomed in: the same fractional position, zoom scaled by the width ratio', () => {
  const plan = keepView({ centre: [297.75, 210.5], zoom: 4, from: A3, to: A1, atFit: false, turns: 0 });
  assert.equal(plan.refit, false);
  if (plan.refit) return;
  assert.ok(Math.abs(plan.centre[0] - 596) < 1e-9);
  assert.ok(Math.abs(plan.centre[1] - 421) < 1e-9);
  // A1 is twice the A3 width: the same drawing area needs half the zoom.
  assert.ok(Math.abs(plan.zoom - (4 * A3.width) / A1.width) < 1e-9);
  // And back again.
  const back = keepView({ centre: plan.centre, zoom: plan.zoom, from: A1, to: A3, atFit: false, turns: 0 });
  assert.equal(back.refit, false);
  if (back.refit) return;
  assert.ok(Math.abs(back.zoom - 4) < 1e-9);
  assert.ok(Math.abs(back.centre[0] - 297.75) < 1e-9);
});

test('portrait to landscape pair (different rotation): scaled by the shown widths', () => {
  const portrait = { width: 842, height: 1191 };
  const plan = keepView({ centre: [421, 595], zoom: 2, from: portrait, to: A3, atFit: false, turns: 0 });
  assert.equal(plan.refit, false);
  if (plan.refit) return;
  assert.ok(Math.abs(plan.centre[0] - 595.5) < 1e-9 && Math.abs(plan.centre[1] - (595 * 842) / 1191) < 1e-9);
  assert.ok(Math.abs(plan.zoom - (2 * 842) / 1191) < 1e-9);
});

test('view turned a quarter: the shown width is the page height', () => {
  const plan = keepView({ centre: [0, 0], zoom: 2, from: A3, to: A1, atFit: false, turns: 1 });
  assert.equal(plan.refit, false);
  if (plan.refit) return;
  assert.ok(Math.abs(plan.zoom - (2 * A3.height) / A1.height) < 1e-9);
  assert.deepEqual(plan.centre, [0, 0]);
});
