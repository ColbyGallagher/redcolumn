import assert from 'node:assert/strict';
import test from 'node:test';
import { MarkupStore, type Markup } from '@nb/markup';
import { approveCountProposal, countStateOf, countProposals } from '../assemblies/countProposals.ts';
import { assistantCall, type AssistantDocument } from './assistant.ts';

/** A little triangle with a tick, as line segments, moved to (ox, oy). Not symmetric, so it has one way round. */
function symbol(ox: number, oy: number): number[] {
  return [
    ox, oy, ox + 20, oy,
    ox + 20, oy, ox + 20, oy + 12,
    ox + 20, oy + 12, ox, oy,
    ox + 5, oy, ox + 5, oy - 6,
  ];
}

function markup(partial: Partial<Markup> & Pick<Markup, 'id' | 'type'>): Markup {
  return { pageIndex: 0, points: [[0, 0]], style: { stroke: '#000', fill: null, width: 1, opacity: 1 }, status: 'none', author: 'Ada', createdAt: 1, modifiedAt: 1, ...partial };
}

async function drawing(): Promise<AssistantDocument> {
  const store = await MarkupStore.open(`symbols-${Math.random()}`, { persist: false });
  // The example is boxed by a rectangle markup.
  store.add(markup({ id: 'box', type: 'rect', points: [[95, 88], [125, 120]] }));
  const pages = [
    [...symbol(100, 100), ...symbol(300, 200), ...symbol(400, 400), 10, 10, 90, 10],
    [...symbol(50, 60)],
  ];
  return {
    id: 'a',
    name: 'A-101.pdf',
    pageCount: 2,
    pageIndex: 0,
    active: true,
    store,
    pageSize: () => ({ width: 612, height: 792 }),
    geometry: async (p) => ({ segments: pages[p]! }),
  };
}

type Found = { engine: string; total: number; matches: { matchId: string; page: number; bbox: { x: number; y: number; w: number; h: number }; score: number }[] };

test('find_symbol_matches finds each copy of the example on the vector line work', async () => {
  const d = await drawing();
  const r = (await assistantCall([d], 'find_symbol_matches', { example: { markupId: 'box' } })) as Found;
  assert.equal(r.engine, 'vector');
  assert.deepEqual(r.matches.map((m) => [m.page, Math.round(m.bbox.x), Math.round(m.bbox.y)]).sort(), [[1, 100, 94], [1, 300, 194], [1, 400, 394]]);
  assert.ok(r.matches.every((m) => m.matchId && m.score >= 0.9));

  const both = (await assistantCall([d], 'find_symbol_matches', { pages: [1, 2], example: { rect: { page: 1, x: 95, y: 88, w: 30, h: 32 } } })) as Found;
  assert.equal(both.total, 4);
  assert.equal(both.matches.filter((m) => m.page === 2).length, 1);

  const limited = (await assistantCall([d], 'find_symbol_matches', { pages: [1, 2], example: { markupId: 'box' }, limit: 2 })) as Found & { truncated?: boolean };
  assert.equal(limited.matches.length, 2);
  assert.equal(limited.truncated, true);

  await assert.rejects(() => assistantCall([d], 'find_symbol_matches', { example: { markupId: 'nope' } }), /No markup nope/);
  await assert.rejects(() => assistantCall([d], 'find_symbol_matches', {}), /Give an example/);
  await assert.rejects(() => assistantCall([d], 'find_symbol_matches', { page: 9, example: { markupId: 'box' } }), /Page 9 is not in/);
});

test('propose_counts stages a proposal; the drawing is unchanged until a person approves, as one undo step', async () => {
  const d = await drawing();
  const found = (await assistantCall([d], 'find_symbol_matches', { pages: [1, 2], example: { markupId: 'box' } })) as Found;
  const before = d.store.all().length;
  await assert.rejects(() => assistantCall([d], 'propose_counts', { matches: ['m-unknown'], subject: 'Detector', reasoning: 'x' }), /not a match from find_symbol_matches/);
  await assert.rejects(() => assistantCall([d], 'propose_counts', { matches: [found.matches[0]!.matchId], subject: 'Detector' }), /say why/);
  await assert.rejects(() => assistantCall([d], 'propose_counts', { matches: [found.matches[0]!.matchId], reasoning: 'x' }), /subject/);

  const ids = found.matches.map((m) => m.matchId);
  const made = (await assistantCall([d], 'propose_counts', { source: 'Claude', subject: 'Detector', reasoning: 'Same triangle symbol.', matches: [...ids, { page: 1, bbox: { x: 500, y: 500, w: 20, h: 18 } }] })) as { proposalId: string; proposed: number; note: string };
  assert.equal(made.proposed, 5);
  assert.match(made.note, /Nothing is placed until they approve/);
  assert.equal(d.store.all().length, before, 'nothing is placed');

  const listed = (await assistantCall([d], 'list_count_proposals', {})) as { proposals: { state: string; matches: number; pages: number[]; subject: string }[] };
  assert.deepEqual(listed.proposals.map((p) => [p.state, p.matches, p.pages, p.subject]), [['pending', 5, [1, 2], 'Detector']]);

  const proposal = countProposals.list(d.store.fileHash).find((p) => p.id === made.proposalId)!;
  // The person turns the last match off, then approves.
  assert.equal(approveCountProposal(d.store, proposal, 'Bea', new Set([4])), 4);
  const counts = d.store.all().filter((m) => m.type === 'count');
  assert.deepEqual(counts.map((c) => [c.pageIndex, c.points.length, c.subject]).sort(), [[0, 3, 'Detector'], [1, 1, 'Detector']]);
  const updated = countProposals.list(d.store.fileHash).find((p) => p.id === made.proposalId)!;
  assert.equal(countStateOf(updated, d.store), 'approved');
  const after = (await assistantCall([d], 'list_count_proposals', {})) as { proposals: { state: string; approvedBy: string; counted: number }[] };
  assert.deepEqual([after.proposals[0]!.state, after.proposals[0]!.approvedBy, after.proposals[0]!.counted], ['approved', 'Bea', 4]);

  d.store.undo();
  assert.equal(d.store.all().filter((m) => m.type === 'count').length, 0, 'one undo takes both counts back');
  assert.equal(countStateOf(countProposals.list(d.store.fileHash).find((p) => p.id === made.proposalId)!, d.store), 'pending');
});
