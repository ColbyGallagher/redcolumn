import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MarkupStore, type Assembly, type Markup } from '@nb/markup';
import { approveProposals, stateOf, takeoffProposals, type TakeoffProposal } from './proposals.ts';

const wall: Assembly = { id: 'wall', name: 'Wall', variables: [{ name: 'Spacing', value: 2 }], items: [{ id: 'studs', name: 'Studs', unit: 'ea', formula: '[Length] / [Spacing] + 1' }] };
const slab: Assembly = { id: 'slab', name: 'Slab', variables: [], items: [{ id: 'conc', name: 'Concrete', unit: 'm³', formula: '[Area] * 0.1' }] };

const length = (id: string, extra: Partial<Markup> = {}): Markup => ({ id, type: 'length', pageIndex: 0, points: [[0, 0], [20, 0]], style: { stroke: '#f00', fill: null, width: 1, opacity: 1 }, status: 'none', author: 'me', createdAt: 0, modifiedAt: 0, ...extra });
const proposal = (id: string, markupId: string, assemblyId = 'wall'): TakeoffProposal => ({ id, markupId, assemblyId, reasoning: 'A wall run on the plan', source: 'Claude', createdAt: 1 });

async function setup() {
  const store = await MarkupStore.open(`proposals-${Math.random()}`, { persist: false });
  store.setAssemblies([wall, slab]);
  store.add(length('a'));
  store.add(length('b'));
  store.add(length('c', { locked: true }));
  return store;
}

test('nothing is in the takeoff until approved; approval writes the assembly and its record, in one undo step', async () => {
  const store = await setup();
  const ps = [proposal('p1', 'a'), proposal('p2', 'b'), proposal('p3', 'c')];
  takeoffProposals.add(store.fileHash, ps);
  assert.equal(store.get('a')!.assemblyId, undefined, 'a proposal changes nothing');
  assert.deepEqual(ps.map((p) => stateOf(p, store.get(p.markupId))), ['pending', 'pending', 'pending']);
  // b is approved with another assembly and a stud count set by hand.
  const { approved, skipped } = approveProposals(store, ps, 'Hana', { p2: { assemblyId: 'slab', overrides: { conc: 3 } } });
  assert.deepEqual(approved, ['p1', 'p2']);
  assert.deepEqual(skipped, ['p3'], 'a locked measurement is left alone');
  assert.equal(store.get('a')!.assemblyId, 'wall');
  assert.deepEqual({ ...store.get('a')!.takeoffApproval, at: 0 }, { by: 'Hana', at: 0, proposalId: 'p1', source: 'Claude', reasoning: 'A wall run on the plan' });
  assert.equal(store.get('b')!.assemblyId, 'slab');
  assert.deepEqual(store.get('b')!.assemblyOverrides, { conc: 3 });
  assert.equal(store.get('b')!.takeoffApproval!.edited, true);
  assert.equal(stateOf(ps[0]!, store.get('a')), 'approved');
  // One undo takes both back, and they are waiting for review again.
  store.undo();
  assert.equal(store.get('a')!.assemblyId, undefined);
  assert.equal(store.get('b')!.takeoffApproval, undefined);
  assert.deepEqual(ps.map((p) => stateOf(p, store.get(p.markupId))), ['pending', 'pending', 'pending']);
});

test('rejections stay on this device and can be reviewed again; a new proposal replaces a pending one', async () => {
  const store = await setup();
  takeoffProposals.add(store.fileHash, [proposal('p1', 'a'), proposal('p2', 'b')]);
  takeoffProposals.reject(store.fileHash, ['p1'], 'Hana');
  const [p1] = takeoffProposals.list(store.fileHash);
  assert.equal(stateOf(p1!, store.get('a')), 'rejected');
  assert.equal(p1!.rejected!.by, 'Hana');
  assert.equal(store.get('a')!.assemblyId, undefined);
  takeoffProposals.reopen(store.fileHash, ['p1']);
  assert.equal(stateOf(takeoffProposals.list(store.fileHash)[0]!, store.get('a')), 'pending');
  takeoffProposals.add(store.fileHash, [proposal('p9', 'b', 'slab')]);
  assert.deepEqual(takeoffProposals.list(store.fileHash).map((p) => p.id), ['p1', 'p9']);
});
