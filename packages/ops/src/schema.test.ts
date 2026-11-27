import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { op, STYLE } from './fixtures.ts';
import { parseOperation, withinDepth } from './schema.ts';

const wire = (value: unknown): unknown => JSON.parse(JSON.stringify(value));
const good = {
  create: op('markup.create', 'm1', { scopeId: 'review1', type: 'cloud', content: { style: { ...STYLE, dash: 'dashed' }, text: 'Check', fields: { cost: '10' } } }, { clientTime: 5 }),
  patch: op('markup.patch', 'm1', { set: { text: null, comment: 'x' }, fields: { cost: null } }, { basedOn: { text: 3, comment: 'op-pending-1' } }),
  place: op('placement.create', 'p1', { markupId: 'm1', revisionId: 'r1', pageId: 'pg1', geometry: { points: [[1, 2], [3, 4]], holes: [[[0, 0], [1, 1], [0, 1]]], holeBulges: [null] }, method: 'ai', confidence: 0.4, state: 'suggested' }),
  move: op('placement.patch', 'p1', { geometry: { rotation: null }, placed: { confidence: null } }, { basedOn: { geometry: 1, state: 0 } }),
  issue: op('issue.create', 'i1', { scopeId: 'review1', title: 'Door', status: 'open', markupIds: ['m1'] }),
  response: op('response.create', 'r1', { parent: { kind: 'issue', id: 'i1' }, kind: 'formal', body: 'Agreed', answersRev: 2 }),
  status: op('status.transition', 'e1', { issueId: 'i1', from: 'open', to: 'closed', revisionSeenId: 'revC' }),
  release: op('release.create', 'rel1', { gateId: 'g1', toLaneIds: ['laneB'], items: [{ kind: 'statusEvent', id: 'e1', rev: 1 }] }),
  batch: op('markup.delete', 'm1', {}, { batchId: 'b1', batchSize: 2 }),
};

test('well-formed operations are read', () => {
  for (const [name, o] of Object.entries(good)) {
    const r = parseOperation(wire(o));
    assert.ok(r.ok, `${name}: ${JSON.stringify(!r.ok && r.rejection)}`);
    assert.deepEqual(r.op, o);
  }
});

const refused = (input: unknown): string => {
  const r = parseOperation(input);
  assert.equal(r.ok, false);
  return r.ok ? '' : r.rejection.message;
};

test('an operation never carries who made it or the server’s time', () => {
  refused({ ...wire(good.create) as object, author: 'mallory' });
  refused({ ...wire(good.create) as object, actor: { userId: 'u' } });
  const payload = { ...good.issue.payload, owner: { userId: 'u' } };
  refused({ ...good.issue, payload });
  refused({ ...good.status, payload: { ...good.status.payload, actor: 'x', at: 1 } });
  refused({ ...good.create, payload: { ...good.create.payload, content: { ...good.create.payload.content, author: 'x' } } });
});

test('content and geometry stay apart on the wire too', () => {
  refused({ ...good.create, payload: { ...good.create.payload, content: { style: STYLE, points: [[0, 0]] } } });
  refused({ ...good.create, payload: { ...good.create.payload, content: { style: STYLE, replies: [] } } });
  refused({ ...good.create, payload: { ...good.create.payload, content: { text: 'no style' } } });
  refused({ ...good.place, payload: { ...good.place.payload, geometry: { points: [[0, 0]], text: 'x' } } });
  refused({ ...good.place, payload: { ...good.place.payload, geometry: { points: [[0, Number.NaN]] } } });
  refused({ ...good.place, payload: { ...good.place.payload, geometry: { points: [[0, 1, 2]] } } });
  refused({ ...good.patch, payload: { set: { fields: {} } } });
  refused({ ...good.patch, payload: { set: { style: null } } });
});

test('ids, versions, types and the protocol version are checked', () => {
  refused({ ...good.create, opId: '' });
  refused({ ...good.create, entityId: 'has space' });
  refused({ ...good.create, entityId: '__proto__' });
  refused({ ...good.create, entityId: 'x'.repeat(129) });
  refused({ ...good.create, schemaVersion: 999 });
  refused({ ...good.create, type: 'markup.explode' });
  refused({ ...good.create, payload: { ...good.create.payload, type: 'hologram' } });
  refused({ ...good.patch, basedOn: { text: -1 } });
  refused({ ...good.patch, basedOn: { text: 1.5 } });
  refused({ ...good.batch, batchSize: 0 });
  refused({ ...good.release, payload: { ...good.release.payload, items: [] } });
  refused({ ...good.release, payload: { ...good.release.payload, toLaneIds: [] } });
  refused({ ...good.place, payload: { ...good.place.payload, confidence: 2 } });
  refused(null);
  refused('markup.create');
});

test('operations only the server makes are refused from a client', () => {
  assert.match(refused(op('issue.number', 'i1', { number: 1 })), /type/);
});

test('deep nesting is refused before it is walked', () => {
  let deep: unknown = 'x';
  for (let i = 0; i < 100_000; i++) deep = [deep];
  assert.equal(withinDepth(deep, 64), false);
  assert.match(refused({ ...good.create, payload: { ...good.create.payload, content: { style: STYLE, table: deep } } }), /deeply/);
  assert.equal(withinDepth({ a: [{ b: 1 }] }, 3), true);
  assert.equal(withinDepth({ a: [{ b: {} }] }, 3), false);
});

test('a refusal says where', () => {
  assert.match(refused({ ...good.issue, payload: { ...good.issue.payload, title: 5 } }), /^payload\.title: /);
});

test('reserved keys anywhere in parsed input are refused, not silently dropped', () => {
  const withProto = JSON.parse(
    '{"opId":"op1","schemaVersion":1,"streamId":"s1","type":"markup.patch","entityId":"m1","basedOn":{"__proto__":0},"payload":{"set":{"text":"a"}}}',
  );
  assert.match(refused(withProto), /reserved/);
  assert.match(refused({ ...good.create, payload: { ...good.create.payload, content: { style: { ...STYLE, constructor: 1 } } } }), /reserved/);
  assert.match(refused({ ...good.create, payload: { ...good.create.payload, content: { style: { ...STYLE, ['a'.repeat(201)]: 1 } } } }), /style key/);
});

test('batchId and batchSize must be set together', () => {
  assert.match(refused({ opId: 'op1', schemaVersion: 1, streamId: 's1', type: 'markup.delete', entityId: 'm1', batchId: 'b1', payload: {} }), /batchId and batchSize/);
  assert.match(refused({ opId: 'op1', schemaVersion: 1, streamId: 's1', type: 'markup.delete', entityId: 'm1', batchSize: 1, payload: {} }), /batchId and batchSize/);
});

test('the package builds no code at run time and loads nothing Node- or DOM-only', () => {
  const dir = new URL('.', import.meta.url);
  const sources = ['apply', 'entities', 'fieldGroups', 'issue', 'markup', 'operations', 'placement', 'protocol', 'release', 'response', 'schema', 'state', 'status', 'index'];
  for (const name of sources) {
    const text = readFileSync(new URL(`${name}.ts`, dir), 'utf8');
    assert.doesNotMatch(text, /new Function|\beval\(/, name);
    assert.doesNotMatch(text, /from 'node:|\b(window|document|localStorage|indexedDB)\./, name);
    // @nb/markup is for types only: loading it would bring in Yjs and pdf-lib.
    for (const line of text.split('\n').filter((l) => l.includes("from '@nb/markup'"))) assert.match(line, /^import type /, `${name}: ${line}`);
  }
});
