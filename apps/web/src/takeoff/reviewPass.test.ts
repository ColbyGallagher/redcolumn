import assert from 'node:assert/strict';
import test from 'node:test';
import { MarkupStore } from '@nb/markup';
import { parseScaleText } from '@nb/measure';
import { assistantCall, type AssistantDocument } from '../desktop/assistant.ts';
import { waitingCount } from './aiReview.ts';
import { decideFindings, findingsByItem, requestReviewPass, setReviewPassEnabled } from './reviewPass.ts';

async function drawing(): Promise<AssistantDocument> {
  const store = await MarkupStore.open(`review-pass-${Math.random()}`, { persist: false });
  store.setScale([0, 1], parseScaleText('1:100')!);
  return { id: 'd', name: 'C-101.pdf', pageCount: 2, pageIndex: 0, active: true, store, pageSize: () => ({ width: 842, height: 595 }) };
}

test('the review pass is off by default; on, takeoff replies ask for a fresh-context review', async () => {
  const d = await drawing();
  assert.equal(d.store.reviewPass().enabled, false);
  const off = (await assistantCall([d], 'place_markups', { page: 1, markups: [{ type: 'length', points: [[0, 0], [100, 0]] }] })) as { reviewPass?: string };
  assert.equal(off.reviewPass, undefined);
  setReviewPassEnabled(d.store, true);
  const on = (await assistantCall([d], 'place_markups', { page: 1, markups: [{ type: 'length', points: [[0, 9], [100, 9]] }] })) as { reviewPass?: string };
  assert.match(on.reviewPass!, /fresh context/);
  const listed = (await assistantCall([d], 'list_takeoff_proposals', {})) as { reviewPass: { enabled: boolean } };
  assert.equal(listed.reviewPass.enabled, true);
});

test('the reviewer sees the output and its sources, not the first pass’s reasoning; findings wait for a person and change nothing', async () => {
  const d = await drawing();
  const placed = (await assistantCall([d], 'place_markups', {
    source: 'Claude',
    page: 1,
    markups: [{ type: 'length', points: [[0, 0], [100, 0]], subject: 'Kerb', confidence: 0.9, reasoning: 'SECRET FIRST-PASS THINKING', sources: [{ page: 1, text: 'KERB TYPE 1', kind: 'legend' }] }],
  })) as { placed: { id: string }[] };
  const id = placed.placed[0]!.id;
  requestReviewPass(d.store, 'Hana');
  const packet = (await assistantCall([d], 'get_review_packet', {})) as { items: { item: string; measurement: string; sources: { text?: string }[] }[]; requested?: unknown; instructions: string; sheets: unknown[] };
  const text = JSON.stringify(packet);
  assert.ok(!text.includes('SECRET FIRST-PASS THINKING'), 'the reasoning is left out');
  assert.ok(!text.includes('"confidence"'), 'and the confidence');
  assert.equal(packet.items[0]!.item, `draft:${id}`);
  assert.ok(packet.items[0]!.measurement);
  assert.equal(packet.items[0]!.sources[0]!.text, 'KERB TYPE 1');
  assert.ok(packet.requested);
  assert.match(packet.instructions, /fresh context/);
  assert.equal(packet.sheets.length, 2);

  await assert.rejects(() => assistantCall([d], 'report_review_findings', { findings: [{ item: 'draft:nope', message: 'x' }] }), /not an item/);
  await assert.rejects(() => assistantCall([d], 'report_review_findings', { findings: [{ message: 'A pit is missing' }] }), /needs a source/);
  const before = JSON.stringify(d.store.get(id));
  const out = (await assistantCall([d], 'report_review_findings', {
    source: 'Reviewer',
    findings: [
      { item: `draft:${id}`, severity: 'issue', kind: 'quantity', message: 'The kerb runs on past the crossing.', expected: { quantity: 12.5, unit: 'm' }, sources: [{ page: 1, bbox: { x: 0, y: 0, w: 120, h: 10 } }] },
      { message: 'A pit at the corner is not counted.', kind: 'missed', sources: [{ page: 2, bbox: { x: 10, y: 10, w: 5, h: 5 } }] },
      { item: `draft:${id}`, severity: 'ok', message: 'The kerb type is right.' },
    ],
  })) as { reported: number; issues: number };
  assert.deepEqual([out.reported, out.issues], [3, 2], "something missed is an issue unless said otherwise");
  assert.equal(JSON.stringify(d.store.get(id)), before, 'a finding is never applied');
  assert.equal(d.store.reviewPass().requested, undefined, 'the request is answered');
  const { byItem, missed } = findingsByItem(d.store);
  assert.equal(byItem.get(`draft:${id}`)!.length, 2);
  assert.equal(missed.length, 1);
  // The draft, the issue and the missed item wait; the reviewer agreeing does not.
  assert.equal(waitingCount(d.store), 3);
  decideFindings(d.store, [missed[0]!.id], 'dismissed', 'Hana');
  decideFindings(d.store, [byItem.get(`draft:${id}`)![0]!.id], 'accepted', 'Hana');
  assert.equal(waitingCount(d.store), 1);
  assert.equal(d.store.aiReview().findings.find((f) => f.id === missed[0]!.id)!.decided!.by, 'Hana');
});
