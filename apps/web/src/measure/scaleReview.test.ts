import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseScaleText, type Scale } from '@nb/measure';
import type { SheetInfo } from '@nb/sheets';
import { canApply, defaultPicks, needsReview, scaleReviewRows } from './scaleReview.ts';
import type { ScaleReading } from './scaleCheck.ts';

const mm = (w: number, h: number) => ({ width: (w * 72) / 25.4, height: (h * 72) / 25.4 });
const A1 = mm(841, 594);
const A3 = mm(420, 297);
const sheet = (scaleText: string | null, paperText: string | null = null): SheetInfo => ({ number: 'C-101', title: 'ROAD PLAN', discipline: 'Civil', scaleText, paperText, revision: null, source: 'text', confidence: 0.9 });

test('rows propose the title-block scale corrected for the size each page was saved at', () => {
  const rows = scaleReviewRows([A1, A3, A3, mm(841, 400)], { 0: sheet('1:500 @ A1'), 1: sheet('1:500 @ A1'), 2: sheet('1:250', 'A1'), 3: sheet('1:500 @ A1') }, {});
  assert.deepEqual(rows.map((r) => r.status), ['ready', 'resized', 'resized', 'check']);
  assert.equal(rows[0]!.actual?.paper.name, 'A1');
  assert.equal(rows[1]!.actual?.paper.name, 'A3');
  assert.equal(rows[1]!.stated, 'A1');
  assert.ok(Math.abs(rows[1]!.proposed!.metersPerPoint / rows[0]!.proposed!.metersPerPoint - 2) < 0.02);
  assert.deepEqual([...defaultPicks(rows)], [0, 1, 2], 'cropped pages are not picked for you');
});

test('pages already scaled are compared against the title block, and NTS or missing scales say so', () => {
  const set: Record<number, Scale> = { 0: parseScaleText('1:500')!, 1: parseScaleText('1:500')! };
  const rows = scaleReviewRows([A1, A3, A1, A1], { 0: sheet('1:500 @ A1'), 1: sheet('1:500 @ A1'), 2: sheet('NTS') }, set);
  assert.deepEqual(rows.map((r) => r.status), ['matches', 'differs', 'nts', 'none']);
  assert.deepEqual([...defaultPicks(rows)], []);
  assert.deepEqual(rows.filter(needsReview).map((r) => r.page), [1, 2, 3]);
});

test('padded pages and implausibly large scales are left for checking', () => {
  const rows = scaleReviewRows([mm(901, 654), A1], { 0: sheet('1:500 @ A1'), 1: sheet('1:1') }, {});
  assert.deepEqual(rows.map((r) => r.status), ['check', 'check']);
  assert.deepEqual([...defaultPicks(rows)], []);
});

test('a proposal the page’s own scale bar disagrees with is left for checking', () => {
  const bar = (mpp: number): ScaleReading => ({ kind: 'bar', metersPerPoint: mpp, rect: { x: 0, y: 0, w: 1, h: 1 }, text: '0 10 20m' });
  const at500 = parseScaleText('1:500')!.metersPerPoint;
  const rows = scaleReviewRows([A1, A1, A1], { 0: sheet('1:500 @ A1'), 1: sheet('1:500 @ A1'), 2: sheet('1:500 @ A1') }, {}, { 0: { readings: [bar(at500)], views: [] }, 1: { readings: [bar(at500 * 2)], views: [] }, 2: { readings: [], views: [] } });
  assert.deepEqual(rows.map((r) => [r.status, r.check?.result]), [['ready', 'agrees'], ['check', 'disagrees'], ['ready', 'none']]);
  assert.deepEqual([...defaultPicks(rows)], [0, 2]);
});

test('AS SHOWN sheets propose viewports from their view titles, corrected for the sheet size', () => {
  const view = { name: 'SCALE 1:100', rect: { x: 10, y: 10, w: 100, h: 100 }, scale: parseScaleText('1:100')! };
  const rows = scaleReviewRows([A3, A1], { 0: sheet('AS SHOWN @ A1'), 1: sheet('1:500 @ A1') }, {}, { 0: { readings: [], views: [view] }, 1: { readings: [], views: [view] } });
  assert.deepEqual(rows.map((r) => r.status), ['views', 'ready']);
  assert.ok(Math.abs(rows[0]!.views[0]!.scale.metersPerPoint / view.scale.metersPerPoint - 2) < 0.02, 'A1 view titles on an A3 page');
  assert.equal(rows[0]!.views[0]!.scale.label, '1:100 @ A1 (on A3)');
  assert.equal(rows[1]!.views[0]!.scale.metersPerPoint, view.scale.metersPerPoint);
  assert.deepEqual([...defaultPicks(rows)], [], 'viewports are checked before they are applied');
  assert.ok(rows.every(canApply));
});
