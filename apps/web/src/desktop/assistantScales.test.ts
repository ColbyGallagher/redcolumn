import assert from 'node:assert/strict';
import test from 'node:test';
import { MarkupStore } from '@nb/markup';
import { parseScaleText } from '@nb/measure';
import type { SheetInfo } from '@nb/sheets';
import { assistantCall, type AssistantDocument } from './assistant.ts';

const mm = (w: number, h: number) => ({ width: (w * 72) / 25.4, height: (h * 72) / 25.4 });
const sheet = (number: string, scaleText: string | null, source: SheetInfo['source'] = 'text'): SheetInfo => ({ number, title: null, discipline: null, scaleText, revision: null, source, confidence: 0.9 });

/** Four sheets: A1 at 1:500 @ A1, the same saved at A3, a locality plan NTS, and one without a scale read. */
async function drawing(): Promise<AssistantDocument> {
  const store = await MarkupStore.open(`scales-${Math.random()}`, { persist: false });
  store.setDetectedSheets([
    [0, sheet('C-101', '1:500 @ A1')],
    [1, sheet('C-102', '1:500 @ A1')],
    [2, sheet('C-103', 'NTS')],
    [3, sheet('C-104', null)],
  ]);
  const sizes = [mm(841, 594), mm(420, 297), mm(841, 594), mm(841, 594)];
  return { id: 'set', name: 'Set.pdf', pageCount: 4, pageIndex: 0, active: true, store, pageSize: (i) => sizes[i] ?? null };
}

type Info = { page: number; number: string; status: string; proposedScale: string | null; sheetSize: { stated: string | null; actual: string | null }; measurable: boolean; source: string };

test('get_sheet_info gives each sheet’s title-block scale, corrected for the size the page was saved at', async () => {
  const d = await drawing();
  const { pages } = (await assistantCall([d], 'get_sheet_info', {})) as { pages: Info[] };
  assert.deepEqual(pages.map((p) => [p.number, p.status, p.sheetSize.actual, p.measurable]), [['C-101', 'ready', 'A1', false], ['C-102', 'resized', 'A3', false], ['C-103', 'nts', 'A1', false], ['C-104', 'none', 'A1', false]]);
  assert.match(pages[1]!.proposedScale!, /^1:500 @ A1 \(on A3\)/);
  const one = (await assistantCall([d], 'get_sheet_info', { page: 2 })) as Info;
  assert.equal(one.page, 2);
});

test('propose_page_scale waits for review, and never replaces a person’s or the standard’s sheet info', async () => {
  const d = await drawing();
  const proposed = (await assistantCall([d], 'propose_page_scale', { page: 4, scale: '1:250', sheetSize: 'A1', reasoning: 'SCALE box, bottom right of the title block' })) as Info & { review: string };
  assert.equal(proposed.source, 'ai');
  assert.equal(proposed.status, 'ready');
  assert.match(proposed.review, /Review Sheet Scales/);
  assert.equal(d.store.allSheets()[3]!.scaleReason, 'SCALE box, bottom right of the title block');
  assert.equal(d.store.allSheets()[3]!.number, 'C-104', 'the sheet number is kept');
  assert.equal(d.store.hasScale(3), false, 'nothing is set until a person applies it');

  await assert.rejects(() => assistantCall([d], 'propose_page_scale', { page: 4, scale: 'half size', reasoning: 'x' }), /not a scale/);
  await assert.rejects(() => assistantCall([d], 'propose_page_scale', { page: 4, scale: '1:100' }), /Say where/);
  d.store.setDetectedSheets([[0, sheet('C-101', '1:500', 'standard')]]);
  await assert.rejects(() => assistantCall([d], 'propose_page_scale', { page: 1, scale: '1:100', reasoning: 'x' }), /drawing standard/);
});

test('measurements are refused on pages without a scale, and on NOT TO SCALE sheets', async () => {
  const d = await drawing();
  const length = (page: number) => assistantCall([d], 'place_markup', { page, type: 'length', points: [[100, 100], [200, 100]] });
  await assert.rejects(() => length(1), /Page 1 has no scale yet.*propose_page_scale/);
  await assert.rejects(() => length(3), /Page 3 is marked NOT TO SCALE/);
  await assert.rejects(() => assistantCall([d], 'place_markups', { page: 1, markups: [{ type: 'rect', points: [[0, 0], [9, 9]] }, { type: 'area', points: [[0, 0], [50, 0], [50, 50]] }] }), /Markup 2: Page 1 has no scale/);
  // Counts and plain markups need no scale; a page with a scale takes measurements.
  await assistantCall([d], 'place_markup', { page: 1, type: 'count', points: [[10, 10]] });
  d.store.setScale([0], parseScaleText('1:500')!);
  await length(1);
  assert.equal(d.store.all().filter((m) => m.type === 'length').length, 1);
});
