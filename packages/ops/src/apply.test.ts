import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyBatch, applyOp, dependencies, MAX_BATCH_SIZE } from './apply.ts';
import { ctx, op, STYLE } from './fixtures.ts';
import { emptyState } from './state.ts';

const batch = (n: number, id = 'b1') => ({ batchId: id, batchSize: n });

test('a batch applies all of its operations in order', () => {
  const ops = [
    op('markup.create', 'm1', { scopeId: 's', type: 'rect', content: { style: STYLE } }, batch(3)),
    op('placement.create', 'p1', { markupId: 'm1', revisionId: 'r', pageId: 'pg', geometry: { points: [[0, 0]] }, method: 'original', confidence: null, state: 'confirmed' }, batch(3)),
    op('markup.patch', 'm1', { set: { text: 'pasted' } }, { ...batch(3), basedOn: { text: 0 } }),
  ];
  const r = applyBatch(emptyState(), ops, ctx());
  assert.ok(r.ok);
  assert.equal(r.state.markups.m1!.content.text, 'pasted');
  assert.deepEqual(r.changes, [
    { kind: 'markup', id: 'm1' },
    { kind: 'placement', id: 'p1' },
  ]);
});

test('a batch with one rejected operation applies nothing, and says which', () => {
  const state = emptyState();
  const ops = [
    op('markup.create', 'm1', { scopeId: 's', type: 'rect', content: { style: STYLE } }, batch(2)),
    op('placement.create', 'p1', { markupId: 'missing', revisionId: 'r', pageId: 'pg', geometry: { points: [] }, method: 'original', confidence: null, state: 'confirmed' }, batch(2)),
  ];
  const r = applyBatch(state, ops, ctx());
  assert.equal(r.ok, false);
  assert.deepEqual(r.ok ? null : [r.index, r.rejection.code], [1, 'not_found']);
  assert.deepEqual(state, emptyState());
});

test('a batch is in one stream, with one batch id and its size', () => {
  const a = op('markup.delete', 'm1', {}, batch(2));
  for (const second of [op('markup.delete', 'm2', {}, batch(2, 'other')), op('markup.delete', 'm2', {}, batch(3)), op('markup.delete', 'm2', {}, { ...batch(2), streamId: 'doc2' })]) {
    const r = applyBatch(emptyState(), [a, second], ctx());
    assert.equal(r.ok, false);
    assert.equal(r.ok ? '' : r.rejection.code, 'invalid');
  }
  assert.equal(applyBatch(emptyState(), [], ctx()).ok, false);
  const big = Array.from({ length: MAX_BATCH_SIZE + 1 }, (_, i) => op('markup.delete', `m${i}`, {}, batch(MAX_BATCH_SIZE + 1)));
  assert.equal(applyBatch(emptyState(), big, ctx()).ok, false);
});

test('an unknown operation type is invalid', () => {
  const r = applyOp(emptyState(), { ...op('markup.delete', 'm1', {}), type: 'markup.explode' } as never, ctx());
  assert.deepEqual(r, { ok: false, rejection: { code: 'invalid', message: 'Unknown operation "markup.explode"' } });
});

test('dependencies name the record itself first, then what the operation reads', () => {
  assert.deepEqual(dependencies(op('markup.create', 'm1', { scopeId: 's', type: 'rect', content: { style: STYLE } })), [{ kind: 'markup', id: 'm1' }]);
  assert.deepEqual(dependencies(op('placement.create', 'p1', { markupId: 'm1', revisionId: 'r', pageId: 'pg', geometry: { points: [] }, method: 'original', confidence: null, state: 'confirmed' })), [
    { kind: 'placement', id: 'p1' },
    { kind: 'markup', id: 'm1' },
  ]);
  assert.deepEqual(dependencies(op('response.create', 'r2', { parent: { kind: 'issue', id: 'i1' }, inReplyTo: 'r1', kind: 'reply', body: '' })), [
    { kind: 'response', id: 'r2' },
    { kind: 'issue', id: 'i1' },
    { kind: 'response', id: 'r1' },
  ]);
  assert.deepEqual(dependencies(op('status.transition', 'e1', { issueId: 'i1', from: null, to: 'open' })), [
    { kind: 'statusEvent', id: 'e1' },
    { kind: 'issue', id: 'i1' },
    { kind: 'laneStatus', id: 'i1' },
  ]);
  assert.deepEqual(dependencies(op('release.create', 'x', { gateId: null, toLaneIds: ['l'], items: [{ kind: 'markup', id: 'm1', rev: 2 }] })), [
    { kind: 'release', id: 'x' },
    { kind: 'markup', id: 'm1' },
  ]);
});
