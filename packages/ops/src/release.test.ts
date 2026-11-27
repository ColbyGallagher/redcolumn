import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOp } from './apply.ts';
import { applyAll, ctx, op, rejected, withIssue, withMarkup } from './fixtures.ts';
import type { OpsState } from './state.ts';

/** A markup, its placement and an issue on it, with one status change in lane A. */
function seeded(): OpsState {
  const { state } = withMarkup();
  return applyAll(withIssue(state), [op('status.transition', 'e1', { issueId: 'i1', from: 'open', to: 'answered' })]);
}

test('a release records the exact versions shared, by whom, through which gate', () => {
  const s = seeded();
  const items = [
    { kind: 'markup', id: 'm1', rev: 1 },
    { kind: 'placement', id: 'p1', rev: 1 },
    { kind: 'issue', id: 'i1', rev: 1 },
  ] as const;
  const after = applyAll(s, [op('release.create', 'rel1', { gateId: 'gate1', toLaneIds: ['laneB', 'laneB'], items: [...items] })], ctx('eve', 'laneA', 2000));
  assert.deepEqual(after.releases.rel1, {
    id: 'rel1',
    rev: 1,
    gateId: 'gate1',
    toLaneIds: ['laneB'],
    items,
    by: { userId: 'eve', partyId: 'partyA', groupId: null },
    at: 2000,
  });
});

test('if anything changed after the preview, the whole release is rejected, naming every change', () => {
  const s = applyAll(seeded(), [
    op('markup.patch', 'm1', { set: { text: 'edited after preview' } }, { basedOn: { text: 0 } }),
    op('issue.patch', 'i1', { title: 'renamed' }, { basedOn: { title: 0 } }),
  ]);
  const release = op('release.create', 'rel1', {
    gateId: null,
    toLaneIds: ['laneB'],
    items: [
      { kind: 'markup', id: 'm1', rev: 1 },
      { kind: 'placement', id: 'p1', rev: 1 },
      { kind: 'issue', id: 'i1', rev: 1 },
    ],
  });
  assert.deepEqual(rejected(applyOp(s, release, ctx())), {
    code: 'conflict',
    conflicts: [
      { kind: 'markup', id: 'm1', groups: ['rev'] },
      { kind: 'issue', id: 'i1', groups: ['rev'] },
    ],
  });
});

test('a released status change becomes the receiving lanes’ status; other lanes are untouched', () => {
  const s = seeded();
  const after = applyAll(s, [op('release.create', 'rel1', { gateId: 'g', toLaneIds: ['laneB'], items: [{ kind: 'statusEvent', id: 'e1', rev: 1 }] })]);
  assert.deepEqual(after.laneStatus.i1, { laneA: { status: 'answered', eventId: 'e1' }, laneB: { status: 'answered', eventId: 'e1' } });
  assert.equal(Object.hasOwn(after.laneStatus.i1!, 'laneC'), false);
  // Lane B can now move on from the status it was shown.
  const moved = applyAll(after, [op('status.transition', 'e2', { issueId: 'i1', from: 'answered', to: 'closed', revisionSeenId: 'revB' })], ctx('dan', 'laneB'));
  assert.equal(moved.laneStatus.i1!.laneB!.status, 'closed');
  assert.equal(moved.laneStatus.i1!.laneA!.status, 'answered');
});

test('unknown items and reused release ids are rejected', () => {
  const s = applyAll(seeded(), [op('release.create', 'rel1', { gateId: null, toLaneIds: ['laneB'], items: [{ kind: 'markup', id: 'm1', rev: 1 }] })]);
  assert.deepEqual(rejected(applyOp(s, op('release.create', 'rel2', { gateId: null, toLaneIds: ['laneB'], items: [{ kind: 'response', id: 'r9', rev: 1 }] }), ctx())), {
    code: 'not_found',
    kind: 'response',
    id: 'r9',
  });
  assert.deepEqual(rejected(applyOp(s, op('release.create', 'rel1', { gateId: null, toLaneIds: ['laneB'], items: [{ kind: 'markup', id: 'm1', rev: 1 }] }), ctx())), {
    code: 'exists',
    kind: 'release',
    id: 'rel1',
  });
});
