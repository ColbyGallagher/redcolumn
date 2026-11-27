import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOp } from './apply.ts';
import { applyAll, ctx, op, rejected, withIssue, withMarkup } from './fixtures.ts';

test('a response is its own record: editing the markup meanwhile does not conflict', () => {
  const { state } = withMarkup();
  const edited = applyAll(state, [op('markup.patch', 'm1', { set: { text: 'edited' } }, { basedOn: { text: 0 } })]);
  const s = applyAll(edited, [op('response.create', 'r1', { parent: { kind: 'markup', id: 'm1' }, kind: 'reply', body: 'Agreed' })], ctx('bob'));
  const r = s.responses.r1!;
  assert.equal(r.body, 'Agreed');
  assert.deepEqual(r.owner, { userId: 'bob', partyId: 'partyA', groupId: null });
  assert.equal(r.inReplyTo, null);
  assert.equal(s.markups.m1!.rev, 2);
});

test('a response to an earlier version records which one it answers', () => {
  const { state } = withMarkup();
  const edited = applyAll(state, [op('markup.patch', 'm1', { set: { text: 'edited' } }, { basedOn: { text: 0 } })]);
  const s = applyAll(edited, [op('response.create', 'r1', { parent: { kind: 'markup', id: 'm1' }, kind: 'formal', body: 'Noted', answersRev: 1 })]);
  assert.equal(s.responses.r1!.answersRev, 1);
  assert.equal(rejected(applyOp(edited, op('response.create', 'r2', { parent: { kind: 'markup', id: 'm1' }, kind: 'reply', body: 'x', answersRev: 5 }), ctx())).code, 'invalid');
});

test('replies to replies stay on the same parent', () => {
  const s = applyAll(withIssue(), [op('response.create', 'r1', { parent: { kind: 'issue', id: 'i1' }, kind: 'reply', body: 'Why?' })]);
  const s2 = applyAll(s, [op('response.create', 'r2', { parent: { kind: 'issue', id: 'i1' }, inReplyTo: 'r1', kind: 'reply', body: 'Because' })]);
  assert.equal(s2.responses.r2!.inReplyTo, 'r1');
  const { state: doc } = withMarkup();
  const both = { ...s, markups: doc.markups };
  assert.equal(rejected(applyOp(both, op('response.create', 'r3', { parent: { kind: 'markup', id: 'm1' }, inReplyTo: 'r1', kind: 'reply', body: 'x' }), ctx())).code, 'invalid');
  assert.equal(rejected(applyOp(s, op('response.create', 'r4', { parent: { kind: 'issue', id: 'i1' }, inReplyTo: 'r9', kind: 'reply', body: 'x' }), ctx())).code, 'not_found');
});

test('the parent must exist and be alive', () => {
  const { state } = withMarkup();
  assert.deepEqual(rejected(applyOp(state, op('response.create', 'r1', { parent: { kind: 'issue', id: 'i1' }, kind: 'reply', body: 'x' }), ctx())), {
    code: 'not_found',
    kind: 'issue',
    id: 'i1',
  });
  const deleted = applyAll(state, [op('markup.delete', 'm1', {})]);
  assert.equal(rejected(applyOp(deleted, op('response.create', 'r1', { parent: { kind: 'markup', id: 'm1' }, kind: 'reply', body: 'x' }), ctx())).code, 'deleted');
});

test('editing a response body is versioned; delete and restore', () => {
  const s = applyAll(withIssue(), [op('response.create', 'r1', { parent: { kind: 'issue', id: 'i1' }, kind: 'reply', body: 'first' })]);
  const e = applyAll(s, [op('response.patch', 'r1', { body: 'second' }, { basedOn: { body: 0 } })]);
  assert.equal(e.responses.r1!.body, 'second');
  assert.equal(rejected(applyOp(e, op('response.patch', 'r1', { body: 'third' }, { basedOn: { body: 0 } }), ctx())).code, 'conflict');
  const d = applyAll(e, [op('response.delete', 'r1', {})]);
  assert.equal(rejected(applyOp(d, op('response.patch', 'r1', { body: 'x' }, { basedOn: { body: 1 } }), ctx())).code, 'deleted');
  assert.equal(applyAll(d, [op('response.restore', 'r1', {})]).responses.r1!.deleted, false);
});
