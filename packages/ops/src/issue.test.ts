import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOp } from './apply.ts';
import { applyAll, ctx, op, rejected, withIssue } from './fixtures.ts';
import { emptyState } from './state.ts';

test('a new issue has no number yet and starts with its status in the creator’s lane only', () => {
  const s = withIssue();
  const issue = s.issues.i1!;
  assert.equal(issue.number, null);
  assert.equal(issue.title, 'Door width');
  assert.deepEqual(issue.markupIds, ['m1']);
  assert.deepEqual(s.laneStatus.i1, { laneA: { status: 'open', eventId: null } });
});

test('an issue must start with one of the project’s statuses', () => {
  const r = rejected(applyOp(emptyState(), op('issue.create', 'i2', { scopeId: 's', title: 't', status: 'made-up' }), ctx()));
  assert.equal(r.code, 'invalid');
});

test('title and tick are separate groups', () => {
  const s = withIssue();
  const after = applyAll(s, [
    op('issue.patch', 'i1', { title: 'Door width at grid C' }, { basedOn: { title: 0 } }),
    op('issue.patch', 'i1', { checked: true }, { basedOn: { checked: 0 } }),
  ]);
  assert.equal(after.issues.i1!.title, 'Door width at grid C');
  assert.equal(after.issues.i1!.checked, true);
  assert.equal(rejected(applyOp(after, op('issue.patch', 'i1', { title: 'x' }, { basedOn: { title: 0 } }), ctx())).code, 'conflict');
});

test('links are a set and never conflict', () => {
  const s = withIssue();
  const after = applyAll(s, [op('issue.link', 'i1', { markupId: 'm2' }), op('issue.link', 'i1', { markupId: 'm2' }), op('issue.unlink', 'i1', { markupId: 'm1' })]);
  assert.deepEqual(after.issues.i1!.markupIds, ['m2']);
  const same = applyOp(after, op('issue.unlink', 'i1', { markupId: 'm1' }), ctx());
  assert.ok(same.ok);
  assert.deepEqual(same.changes, []);
});

test('the server numbers an issue once', () => {
  const s = withIssue();
  const numbered = applyAll(s, [op('issue.number', 'i1', { number: 7 })]);
  assert.equal(numbered.issues.i1!.number, 7);
  assert.equal(rejected(applyOp(numbered, op('issue.number', 'i1', { number: 8 }), ctx())).code, 'invalid');
});

test('a deleted issue takes no edits, links or status changes', () => {
  const s = applyAll(withIssue(), [op('issue.delete', 'i1', {})]);
  assert.equal(rejected(applyOp(s, op('issue.patch', 'i1', { title: 'x' }, { basedOn: { title: 0 } }), ctx())).code, 'deleted');
  assert.equal(rejected(applyOp(s, op('issue.link', 'i1', { markupId: 'm9' }), ctx())).code, 'deleted');
  assert.equal(rejected(applyOp(s, op('status.transition', 'e1', { issueId: 'i1', from: 'open', to: 'answered' }), ctx())).code, 'deleted');
  assert.equal(applyAll(s, [op('issue.restore', 'i1', {})]).issues.i1!.deleted, false);
});
