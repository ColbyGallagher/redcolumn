import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crsById } from '@nb/measure';
import { geoRegionFor, pageToGrid, type ModelPlacement } from '../geospatial/align';
import { planForSheet, samePlan, sheetForPlan } from './viewSync';

// 0.55 points a metre (about 1:650 on paper), turned 0.2 rad from north.
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

const near = (a: readonly number[], b: readonly number[], tol: number) => a.every((v, i) => Math.abs(v - b[i]!) <= tol);

test("a sheet's view gives the plan at its centre, scale and heading", () => {
  const plan = planForSheet([region], { pageIndex: 2, centre: [300, 400], zoom: 2, rotation: 0 });
  assert.ok(plan);
  assert.ok(near(plan.centre, [318700, 6247200], 0.1), `${plan.centre}`);
  // 2 px a point and 0.55 points a metre: 1 / 1.1 metres a pixel.
  assert.ok(Math.abs(plan.metresPerPixel - 1 / 1.1) < 1e-3, `${plan.metresPerPixel}`);
  // Up the page is north turned by the sheet's rotation.
  const up = pageToGrid(PLACE, [300, 399]);
  const len = Math.hypot(up[0] - 318700, up[1] - 6247200);
  assert.ok(near(plan.up, [(up[0] - 318700) / len, (up[1] - 6247200) / len], 1e-3), `${plan.up}`);
  // Off the region, on another page: no plan.
  assert.equal(planForSheet([region], { pageIndex: 2, centre: [700, 400], zoom: 2, rotation: 0 }), null);
  assert.equal(planForSheet([region], { pageIndex: 1, centre: [300, 400], zoom: 2, rotation: 0 }), null);
});

test('a turned view turns the plan with it', () => {
  const plain = planForSheet([region], { pageIndex: 2, centre: [300, 400], zoom: 1, rotation: 0 })!;
  const turned = planForSheet([region], { pageIndex: 2, centre: [300, 400], zoom: 1, rotation: 1 })!;
  // A quarter turn clockwise: what was left on the page is now up.
  assert.ok(near(turned.up, [-plain.up[1], plain.up[0]], 1e-3), `${turned.up} ${plain.up}`);
});

test('a plan gives back the sheet view it came from, and samePlan ignores tiny drift', () => {
  const view = { pageIndex: 2, centre: [250, 500] as [number, number], zoom: 1.6, rotation: 0 };
  const plan = planForSheet([region], view)!;
  const back = sheetForPlan([region], plan, { pageIndex: 0, centre: [0, 0], zoom: 1, rotation: 0 });
  assert.ok(back);
  assert.equal(back.pageIndex, 2);
  assert.ok(near(back.centre, view.centre, 0.05), `${back.centre}`);
  assert.ok(Math.abs(back.zoom - 1.6) < 1e-3, `${back.zoom}`);
  assert.ok(samePlan(plan, { ...plan, centre: [plan.centre[0] + plan.metresPerPixel / 2, plan.centre[1]] }));
  assert.ok(!samePlan(plan, { ...plan, centre: [plan.centre[0] + plan.metresPerPixel * 3, plan.centre[1]] }));
  assert.ok(!samePlan(plan, { ...plan, metresPerPixel: plan.metresPerPixel * 1.1 }));
  assert.ok(!samePlan(plan, { ...plan, up: [-plan.up[0], -plan.up[1]] }));
  // A plan off every sheet: no view.
  assert.equal(sheetForPlan([region], { ...plan, centre: [0, 0] }, view), null);
});
