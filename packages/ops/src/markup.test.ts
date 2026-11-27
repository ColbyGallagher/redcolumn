import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOp } from './apply.ts';
import { applyAll, ctx, op, rejected, STYLE, withMarkup } from './fixtures.ts';
import { emptyState } from './state.ts';

test('a new markup is owned by the actor, not by anything the client sent', () => {
  const { state, createOp } = withMarkup();
  const m = state.markups.m1!;
  assert.deepEqual(m.owner, { userId: 'ann', partyId: 'partyA', groupId: null });
  assert.equal(m.rev, 1);
  assert.equal(m.createdBy, createOp);
  assert.equal(m.createdAt, 1000);
  assert.deepEqual(m.content, { style: STYLE, text: 'hello' });
  assert.equal(m.deleted, false);
});

test('making a markup with an id already used is rejected', () => {
  const { state } = withMarkup();
  const r = rejected(applyOp(state, op('markup.create', 'm1', { scopeId: 'review1', type: 'line', content: { style: STYLE } }), ctx()));
  assert.deepEqual(r, { code: 'exists', kind: 'markup', id: 'm1' });
});

test('content must be content: geometry and fixed fields are refused', () => {
  for (const content of [{ style: STYLE, points: [] }, { style: STYLE, author: 'mallory' }, { style: STYLE, status: 'closed' }, { text: 'no style' }]) {
    const r = rejected(applyOp(emptyState(), op('markup.create', 'm2', { scopeId: 's', type: 'rect', content } as never), ctx()));
    assert.equal(r.code, 'invalid', JSON.stringify(content));
  }
});

test('concurrent edits to different field groups both apply', () => {
  const { state, createOp } = withMarkup();
  // Two people start from the same confirmed version.
  const text = op('markup.patch', 'm1', { set: { text: 'changed' } }, { basedOn: { text: 0 } });
  const style = op('markup.patch', 'm1', { set: { style: { ...STYLE, stroke: '#00ff00' } } }, { basedOn: { style: createOp } });
  const comment = op('markup.patch', 'm1', { set: { comment: 'see detail 4' } }, { basedOn: { comment: 0 } });
  const after = applyAll(state, [text, style, comment]);
  const m = after.markups.m1!;
  assert.equal(m.content.text, 'changed');
  assert.equal(m.content.style.stroke, '#00ff00');
  assert.equal(m.content.comment, 'see detail 4');
  assert.equal(m.rev, 4);
  assert.deepEqual(m.versions, { text: { v: 1, op: text.opId }, style: { v: 1, op: style.opId }, comment: { v: 1, op: comment.opId } });
});

test('concurrent edits to the same group: the later one conflicts', () => {
  const { state } = withMarkup();
  const first = op('markup.patch', 'm1', { set: { text: 'mine' } }, { basedOn: { text: 0 } });
  // `spans` is in the text group too, so this is the same group.
  const second = op('markup.patch', 'm1', { set: { spans: [] } }, { basedOn: { text: 0 } });
  const after = applyAll(state, [first]);
  const r = rejected(applyOp(after, second, ctx('bob')));
  assert.deepEqual(r, { code: 'conflict', conflicts: [{ kind: 'markup', id: 'm1', groups: ['text'] }] });
  assert.equal(after.markups.m1!.content.text, 'mine');
});

test("one's own pending changes in a row, each based on the one before, do not conflict", () => {
  const { state, createOp } = withMarkup();
  const a = op('markup.patch', 'm1', { set: { text: 'a' } }, { basedOn: { text: createOp } });
  const b = op('markup.patch', 'm1', { set: { text: 'ab' } }, { basedOn: { text: a.opId } });
  const c = op('markup.patch', 'm1', { set: { text: 'abc' } }, { basedOn: { text: b.opId } });
  const after = applyAll(state, [a, b, c]);
  assert.equal(after.markups.m1!.content.text, 'abc');
  assert.deepEqual(after.markups.m1!.versions.text, { v: 3, op: c.opId });
});

test('an operation based on one that never applied is rejected with it', () => {
  const { state } = withMarkup();
  const r = rejected(applyOp(state, op('markup.patch', 'm1', { set: { text: 'x' } }, { basedOn: { text: 'op-that-was-rejected' } }), ctx()));
  assert.equal(r.code, 'conflict');
});

test('a patch without a base for a group it changes is a conflict', () => {
  const { state } = withMarkup();
  const r = rejected(applyOp(state, op('markup.patch', 'm1', { set: { text: 'x', subject: 'Door' } }, { basedOn: { text: 0 } }), ctx()));
  assert.deepEqual(r, { code: 'conflict', conflicts: [{ kind: 'markup', id: 'm1', groups: ['subject'] }] });
});

test('custom columns are versioned one by one', () => {
  const { state } = withMarkup();
  const a = op('markup.patch', 'm1', { fields: { cost: '10' } }, { basedOn: { 'fields.cost': 0 } });
  const b = op('markup.patch', 'm1', { fields: { trade: 'Joinery' } }, { basedOn: { 'fields.trade': 0 } });
  let after = applyAll(state, [a, b]);
  assert.deepEqual(after.markups.m1!.content.fields, { cost: '10', trade: 'Joinery' });
  assert.equal(rejected(applyOp(after, op('markup.patch', 'm1', { fields: { cost: '12' } }, { basedOn: { 'fields.cost': 0 } }), ctx())).code, 'conflict');
  // null clears a column; clearing the last one removes the field.
  after = applyAll(after, [
    op('markup.patch', 'm1', { fields: { cost: null } }, { basedOn: { 'fields.cost': 1 } }),
    op('markup.patch', 'm1', { fields: { trade: null } }, { basedOn: { 'fields.trade': 1 } }),
  ]);
  assert.equal('fields' in after.markups.m1!.content, false);
});

test('null clears a field; style cannot be cleared', () => {
  const { state } = withMarkup();
  const after = applyAll(state, [op('markup.patch', 'm1', { set: { text: null } }, { basedOn: { text: 0 } })]);
  assert.equal('text' in after.markups.m1!.content, false);
  const r = rejected(applyOp(state, op('markup.patch', 'm1', { set: { style: null } } as never, { basedOn: { style: 0 } }), ctx()));
  assert.equal(r.code, 'invalid');
});

test('fields outside content cannot be patched', () => {
  const { state } = withMarkup();
  for (const set of [{ points: [] }, { replies: [] }, { status: 'closed' }, { id: 'm9' }, { author: 'x' }, { fields: {} }, { pdfAnnot: {} }]) {
    assert.equal(rejected(applyOp(state, op('markup.patch', 'm1', { set } as never, { basedOn: {} }), ctx())).code, 'invalid', JSON.stringify(set));
  }
  assert.equal(rejected(applyOp(state, op('markup.patch', 'm1', {}), ctx())).code, 'invalid');
});

test('editing a missing markup is not_found; editing a deleted one is rejected and restore brings it back', () => {
  const { state } = withMarkup();
  assert.deepEqual(rejected(applyOp(state, op('markup.patch', 'nope', { set: { text: 'x' } }, { basedOn: { text: 0 } }), ctx())), {
    code: 'not_found',
    kind: 'markup',
    id: 'nope',
  });
  const deleted = applyAll(state, [op('markup.delete', 'm1', {})]);
  assert.equal(deleted.markups.m1!.deleted, true);
  assert.equal(deleted.markups.m1!.rev, 2);
  assert.deepEqual(rejected(applyOp(deleted, op('markup.patch', 'm1', { set: { text: 'x' } }, { basedOn: { text: 0 } }), ctx())), {
    code: 'deleted',
    kind: 'markup',
    id: 'm1',
  });
  const restored = applyAll(deleted, [op('markup.restore', 'm1', {})]);
  assert.equal(restored.markups.m1!.deleted, false);
  assert.equal(restored.markups.m1!.content.text, 'hello');
});

test('delete wins over edits made since, and deleting twice changes nothing', () => {
  const { state } = withMarkup();
  const edited = applyAll(state, [op('markup.patch', 'm1', { set: { text: 'newer' } }, { basedOn: { text: 0 } })]);
  // Based on nothing at all: delete is not version-checked.
  const deleted = applyAll(edited, [op('markup.delete', 'm1', {})]);
  const again = applyOp(deleted, op('markup.delete', 'm1', {}), ctx('bob'));
  assert.ok(again.ok);
  assert.equal(again.state, deleted);
  assert.deepEqual(again.changes, []);
});

test('reducers never change their inputs', () => {
  const { state } = withMarkup();
  const frozen = structuredClone(state);
  applyOp(state, op('markup.patch', 'm1', { set: { text: 'x' }, fields: { a: '1' } }, { basedOn: { text: 0, 'fields.a': 0 } }), ctx());
  applyOp(state, op('markup.delete', 'm1', {}), ctx());
  assert.deepEqual(state, frozen);
});

test('the same state, operation and context give the same result', () => {
  const { state } = withMarkup();
  const o = op('markup.patch', 'm1', { set: { text: 'x' } }, { basedOn: { text: 0 } });
  assert.deepEqual(applyOp(state, o, ctx()), applyOp(state, o, ctx()));
});

test('ids are looked up as own entries only', () => {
  const r = rejected(applyOp(emptyState(), op('markup.patch', 'constructor', { set: { text: 'x' } }, { basedOn: { text: 0 } }), ctx()));
  assert.equal(r.code, 'not_found');
});
