import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOp } from './apply.ts';
import { applyAll, ctx, op, rejected, withIssue } from './fixtures.ts';

test('a status change names the status it saw, and is recorded for the actor’s lane', () => {
  const s = applyAll(withIssue(), [op('status.transition', 'e1', { issueId: 'i1', from: 'open', to: 'answered', note: 'Revised on rev B' }, { clientTime: 900 })]);
  assert.deepEqual(s.statusEvents.e1, {
    id: 'e1',
    rev: 1,
    issueId: 'i1',
    laneId: 'laneA',
    from: 'open',
    to: 'answered',
    note: 'Revised on rev B',
    revisionSeenId: null,
    actor: { userId: 'ann', partyId: 'partyA', groupId: null },
    at: 1000,
    clientTime: 900,
  });
  assert.deepEqual(s.laneStatus.i1, { laneA: { status: 'answered', eventId: 'e1' } });
});

test('if the status has moved since, the change is rejected to decide again; the accepted one stays', () => {
  const s = applyAll(withIssue(), [op('status.transition', 'e1', { issueId: 'i1', from: 'open', to: 'answered' })]);
  const r = rejected(applyOp(s, op('status.transition', 'e2', { issueId: 'i1', from: 'open', to: 'void' }), ctx('bob')));
  assert.deepEqual(r, { code: 'conflict', conflicts: [{ kind: 'issue', id: 'i1', groups: ['status'] }] });
  assert.equal(s.laneStatus.i1!.laneA!.status, 'answered');
});

test('each lane has its own status', () => {
  // Lane B has seen nothing yet, so its first change is from null.
  const s = applyAll(withIssue(), [op('status.transition', 'e1', { issueId: 'i1', from: null, to: 'answered' })], ctx('cat', 'laneB'));
  assert.deepEqual(s.laneStatus.i1, { laneA: { status: 'open', eventId: null }, laneB: { status: 'answered', eventId: 'e1' } });
  assert.equal(rejected(applyOp(s, op('status.transition', 'e2', { issueId: 'i1', from: null, to: 'void' }), ctx('cat', 'laneB'))).code, 'conflict');
});

test('closing needs the revision that was checked; statuses must exist; no change is no change', () => {
  const s = withIssue();
  assert.equal(rejected(applyOp(s, op('status.transition', 'e1', { issueId: 'i1', from: 'open', to: 'closed' }), ctx())).code, 'invalid');
  const closed = applyAll(s, [op('status.transition', 'e1', { issueId: 'i1', from: 'open', to: 'closed', revisionSeenId: 'revC' })]);
  assert.equal(closed.statusEvents.e1!.revisionSeenId, 'revC');
  // A void status is not a closing one.
  applyAll(s, [op('status.transition', 'e2', { issueId: 'i1', from: 'open', to: 'void' })]);
  assert.equal(rejected(applyOp(s, op('status.transition', 'e3', { issueId: 'i1', from: 'open', to: 'nope' }), ctx())).code, 'invalid');
  assert.equal(rejected(applyOp(s, op('status.transition', 'e4', { issueId: 'i1', from: 'open', to: 'open' }), ctx())).code, 'invalid');
});

test('without the project’s statuses, any status id is taken', () => {
  const s = withIssue();
  const { statuses: _, ...noStatuses } = ctx();
  const r = applyOp(s, op('status.transition', 'e1', { issueId: 'i1', from: 'open', to: 'custom-7' }), noStatuses);
  assert.ok(r.ok);
});

test('events are append-only: an id cannot be reused, and an unknown issue is not_found', () => {
  const s = applyAll(withIssue(), [op('status.transition', 'e1', { issueId: 'i1', from: 'open', to: 'answered' })]);
  assert.equal(rejected(applyOp(s, op('status.transition', 'e1', { issueId: 'i1', from: 'answered', to: 'open' }), ctx())).code, 'exists');
  assert.deepEqual(rejected(applyOp(s, op('status.transition', 'e2', { issueId: 'i9', from: 'open', to: 'answered' }), ctx())), {
    code: 'not_found',
    kind: 'issue',
    id: 'i9',
  });
});
