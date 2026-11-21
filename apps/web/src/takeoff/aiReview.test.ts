import assert from 'node:assert/strict';
import test from 'node:test';
import { MarkupStore, type Assembly } from '@nb/markup';
import { parseScaleText } from '@nb/measure';
import { assistantCall, type AssistantDocument } from '../desktop/assistant.ts';
import { rollup } from '../assemblies/quantities.ts';
import { approveDrafts, clearDecided, rejectDrafts, reopenDrafts, reviewItems, waitingCount } from './aiReview.ts';

const kerb: Assembly = { id: 'kerb', name: 'Kerb', variables: [], items: [{ id: 'k', name: 'Kerb', unit: 'm', formula: '[Length]' }] };

async function drawing(): Promise<AssistantDocument> {
  const store = await MarkupStore.open(`ai-review-${Math.random()}`, { persist: false });
  store.setAssemblies([kerb]);
  store.setScale([0, 1], parseScaleText('1:100')!);
  return { id: 'd', name: 'C-101.pdf', pageCount: 2, pageIndex: 0, active: true, store, pageSize: () => ({ width: 842, height: 595 }) };
}

const ctx = { scaleOf: () => parseScaleText('1:100')!, sheets: {}, statuses: [], columns: [], assemblies: [kerb] };

test('measurements the assistant draws are drafts with their evidence; clouds are not', async () => {
  const d = await drawing();
  const out = (await assistantCall([d], 'place_markups', {
    source: 'Claude',
    page: 1,
    markups: [
      { type: 'length', points: [[0, 0], [100, 0]], subject: 'Kerb', assembly: 'Kerb', confidence: 0.9, reasoning: 'KERB line type in the legend', sources: [{ page: 1, bbox: { x: 700, y: 500, w: 100, h: 20 }, text: 'KERB TYPE 1', kind: 'legend' }], expected: [{ item: 'Kerb', quantity: 3.5, unit: 'm' }] },
      { type: 'length', points: [[0, 50], [50, 50]], subject: 'Kerb', confidence: 0.3 },
      { type: 'cloud', points: [[0, 0], [10, 10]] },
    ],
  })) as { placed: { id: string; draft?: boolean }[]; note?: string };
  assert.deepEqual(out.placed.map((p) => !!p.draft), [true, true, false]);
  assert.match(out.note!, /drafts/);
  const first = d.store.get(out.placed[0]!.id)!;
  assert.equal(first.ai!.status, 'pending');
  assert.equal(first.assemblyId, 'kerb');
  assert.deepEqual(first.ai!.sources, [{ pageIndex: 0, rect: { x: 700, y: 500, w: 100, h: 20 }, text: 'KERB TYPE 1', kind: 'legend' }]);
  assert.equal(d.store.get(out.placed[2]!.id)!.ai, undefined);
  // Out of the takeoff until approved.
  assert.equal(rollup(d.store.all(), [kerb], ctx, 'item').length, 0);
  // Waiting, the least sure first.
  assert.equal(waitingCount(d.store), 2);
  const items = reviewItems(d.store);
  assert.deepEqual(items.map((i) => [i.kind, i.confidence, i.low]), [['draft', 0.3, true], ['draft', 0.9, false]]);
  // Bad evidence is refused before anything is drawn.
  await assert.rejects(() => assistantCall([d], 'place_markups', { page: 1, markups: [{ type: 'length', points: [[0, 0], [1, 0]], confidence: 7 }] }), /confidence/);
  await assert.rejects(() => assistantCall([d], 'place_markups', { page: 1, markups: [{ type: 'length', points: [[0, 0], [1, 0]], sources: [{ page: 9 }] }] }), /page has to be/);
  assert.equal(d.store.all().length, 3);
});

test('approving keeps the AI’s version beside a person’s edits; rejecting takes a draft off the drawing until reviewed again', async () => {
  const d = await drawing();
  const out = (await assistantCall([d], 'place_markups', { page: 1, markups: [{ type: 'length', points: [[0, 0], [100, 0]], subject: 'Kerb', assembly: 'kerb' }, { type: 'length', points: [[0, 9], [9, 9]], subject: 'Kerb' }] })) as { placed: { id: string }[] };
  const [a, b] = out.placed.map((p) => p.id) as [string, string];
  d.store.update(a, { subject: 'Kerb type 2' });
  assert.deepEqual(approveDrafts(d.store, [a], 'Hana'), { approved: [a], skipped: [] });
  const approved = d.store.get(a)!;
  assert.equal(approved.ai!.status, 'approved');
  assert.equal(approved.ai!.review!.by, 'Hana');
  assert.equal(approved.ai!.original.subject, 'Kerb');
  assert.deepEqual(reviewItems(d.store).find((i) => i.id === a)!.edits, ['subject']);
  assert.equal(rollup(d.store.all(), [kerb], ctx, 'item').length, 1, 'approved: it counts now');
  // Undo takes the approval back.
  d.store.undo();
  assert.equal(d.store.get(a)!.ai!.status, 'pending');

  assert.deepEqual(rejectDrafts(d.store, [b], 'Hana'), [b]);
  assert.equal(d.store.get(b), undefined);
  assert.deepEqual(reviewItems(d.store).filter((i) => i.state === 'rejected').map((i) => i.id), [b]);
  reopenDrafts(d.store, [b]);
  assert.equal(d.store.get(b)!.ai!.status, 'pending');
  assert.equal(d.store.aiReview().rejected.length, 0);
  rejectDrafts(d.store, [b], 'Hana');
  clearDecided(d.store);
  assert.equal(d.store.aiReview().rejected.length, 0);
});

test('propose_takeoff and propose_counts carry confidence and sources into the review list', async () => {
  const d = await drawing();
  const placed = (await assistantCall([d], 'place_markups', { page: 1, markups: [{ type: 'length', points: [[0, 0], [100, 0]] }] })) as { placed: { id: string }[] };
  approveDrafts(d.store, [placed.placed[0]!.id], 'Hana');
  await assistantCall([d], 'propose_takeoff', { source: 'Claude', proposals: [{ id: placed.placed[0]!.id, assembly: 'Kerb', reasoning: 'a kerb', confidence: 0.55, sources: [{ page: 2, text: 'Typical section' }] }] });
  await assistantCall([d], 'propose_counts', { source: 'Claude', subject: 'Pit', reasoning: 'legend symbol', confidence: 0.8, matches: [{ page: 1, bbox: { x: 1, y: 1, w: 4, h: 4 } }] });
  const items = reviewItems(d.store).filter((i) => i.state === 'pending');
  assert.deepEqual(items.map((i) => [i.kind, i.confidence, i.sources.map((s) => s.pageIndex)]), [['assembly', 0.55, [1]], ['count', 0.8, []]]);
  const listed = (await assistantCall([d], 'list_takeoff_proposals', {})) as { drafts: { state: string }[] };
  assert.deepEqual(listed.drafts.map((x) => x.state), ['approved']);
});
