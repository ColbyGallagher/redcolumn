import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { planSlipSheet, type IncomingPage } from './slipSheet.ts';
import { appendPages } from './pageTools.ts';

const inc = (source: number, page: number, label: string | null): IncomingPage => ({ source, page, label });

test('slip sheet matches sheet numbers across files and adds new sheets', () => {
  const plan = planSlipSheet(['A-101', 'A-102', 'A-103'], [inc(0, 0, 'A-103'), inc(0, 1, 'a 101'), inc(1, 0, 'A-104'), inc(1, 1, null), inc(1, 2, 'A-101')], 'sheet', true);
  assert.deepEqual(
    plan.replace.map((r) => [r.target, r.incoming.source, r.incoming.page]),
    [
      [0, 0, 1],
      [2, 0, 0],
    ],
  );
  assert.deepEqual(plan.add, [inc(1, 0, 'A-104'), inc(1, 1, null)]);
  // A-101 twice: the second is skipped.
  assert.deepEqual(plan.skipped, [inc(1, 2, 'A-101')]);
});

test('without adding, unmatched sheets are skipped; page order replaces from the start', () => {
  assert.deepEqual(planSlipSheet(['A-101'], [inc(0, 0, 'A-104')], 'sheet', false).skipped, [inc(0, 0, 'A-104')]);
  const plan = planSlipSheet(['x', 'y'], [inc(0, 0, null), inc(0, 1, null), inc(0, 2, null)], 'order', true);
  assert.deepEqual(
    plan.replace.map((r) => r.target),
    [0, 1],
  );
  assert.equal(plan.add.length, 1);
});

test('appendPages adds pages at the end', async () => {
  const a = await PDFDocument.create();
  a.addPage([100, 100]);
  const b = await PDFDocument.create();
  b.addPage([200, 200]);
  b.addPage([300, 300]);
  const out = await PDFDocument.load(await appendPages(await a.save(), await b.save(), [1]));
  assert.deepEqual(
    out.getPages().map((p) => p.getWidth()),
    [100, 300],
  );
});
