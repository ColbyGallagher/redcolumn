import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOp } from './apply.ts';
import { applyAll, ctx, op, rejected, withMarkup } from './fixtures.ts';

const place = (id: string, markupId = 'm1') =>
  op('placement.create', id, { markupId, revisionId: 'revB', pageId: 'page7', geometry: { points: [[5, 5], [15, 15]], rotation: 90 }, method: 'aligned', confidence: 0.8, state: 'suggested' });

test('a markup has a placement on each revision; moving one does not move the others', () => {
  const { state, placeOp } = withMarkup();
  const after = applyAll(state, [place('p2'), op('placement.patch', 'p2', { geometry: { points: [[6, 6], [16, 16]] } }, { basedOn: { geometry: 0 } })]);
  assert.deepEqual(after.placements.p1!.geometry.points, [[0, 0], [10, 10]]);
  assert.equal(after.placements.p1!.createdBy, placeOp);
  assert.deepEqual(after.placements.p2!.geometry, { points: [[6, 6], [16, 16]], rotation: 90 });
  assert.equal(after.placements.p2!.revisionId, 'revB');
});

test('confirming a suggestion and nudging it are different groups', () => {
  const { state } = withMarkup();
  const s = applyAll(state, [place('p2')]);
  const confirm = op('placement.patch', 'p2', { placed: { state: 'confirmed', method: 'manual', confidence: null } }, { basedOn: { state: 0 } });
  const nudge = op('placement.patch', 'p2', { geometry: { rotation: null } }, { basedOn: { geometry: 0 } });
  const after = applyAll(s, [confirm, nudge]);
  const p = after.placements.p2!;
  assert.equal(p.state, 'confirmed');
  assert.equal(p.method, 'manual');
  assert.equal(p.confidence, null);
  assert.deepEqual(p.geometry, { points: [[5, 5], [15, 15]] });
  // A second move from the old base conflicts.
  const r = rejected(applyOp(after, op('placement.patch', 'p2', { geometry: { points: [[0, 0]] } }, { basedOn: { geometry: 0 } }), ctx('bob')));
  assert.deepEqual(r, { code: 'conflict', conflicts: [{ kind: 'placement', id: 'p2', groups: ['geometry'] }] });
});

test("a placement needs its markup, alive; deleting it doesn't", () => {
  const { state } = withMarkup();
  assert.deepEqual(rejected(applyOp(state, place('p2', 'ghost'), ctx())), { code: 'not_found', kind: 'markup', id: 'ghost' });
  const deleted = applyAll(state, [op('markup.delete', 'm1', {})]);
  assert.deepEqual(rejected(applyOp(deleted, place('p2'), ctx())), { code: 'deleted', kind: 'markup', id: 'm1' });
  assert.equal(rejected(applyOp(deleted, op('placement.patch', 'p1', { geometry: { depth: 3 } }, { basedOn: { geometry: 0 } }), ctx())).code, 'deleted');
  const gone = applyAll(deleted, [op('placement.delete', 'p1', {})]);
  assert.equal(gone.placements.p1!.deleted, true);
});

test("a placement's shape holds geometry only", () => {
  const { state } = withMarkup();
  const bad = op('placement.create', 'p2', { markupId: 'm1', revisionId: 'r', pageId: 'p', geometry: { points: [], text: 'no' }, method: 'manual', confidence: null, state: 'confirmed' } as never);
  assert.equal(rejected(applyOp(state, bad, ctx())).code, 'invalid');
  assert.equal(rejected(applyOp(state, op('placement.patch', 'p1', { geometry: { style: {} } } as never, { basedOn: { geometry: 0 } }), ctx())).code, 'invalid');
  assert.equal(rejected(applyOp(state, op('placement.patch', 'p1', {}), ctx())).code, 'invalid');
  assert.equal(rejected(applyOp(state, place('p1'), ctx())).code, 'exists');
});
