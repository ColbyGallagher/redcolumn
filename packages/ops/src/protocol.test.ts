import { test } from 'node:test';
import assert from 'node:assert/strict';
import { negotiateProtocol, PROTOCOL_VERSION, readsVersion, SUPPORTED_PROTOCOL } from './protocol.ts';

test('a client speaking the current version gets it', () => {
  assert.deepEqual(negotiateProtocol({ min: 1, max: PROTOCOL_VERSION }), { ok: true, version: PROTOCOL_VERSION });
});

test('the highest version both sides speak is chosen', () => {
  assert.deepEqual(negotiateProtocol({ min: 2, max: 5 }, { min: 1, max: 3 }), { ok: true, version: 3 });
  assert.deepEqual(negotiateProtocol({ min: 1, max: 2 }, { min: 1, max: 4 }), { ok: true, version: 2 });
  assert.deepEqual(negotiateProtocol({ min: 4, max: 4 }, { min: 4, max: 4 }), { ok: true, version: 4 });
});

test('a client older than the server reads is told to update', () => {
  assert.deepEqual(negotiateProtocol({ min: 1, max: 2 }, { min: 3, max: 4 }), { ok: false, reason: 'client_too_old', server: { min: 3, max: 4 } });
});

test('a client newer than the server is refused', () => {
  assert.deepEqual(negotiateProtocol({ min: 5, max: 6 }, { min: 3, max: 4 }), { ok: false, reason: 'client_too_new', server: { min: 3, max: 4 } });
});

test('an offer that is not a range is refused', () => {
  for (const offer of [{ min: 2, max: 1 }, { min: 0, max: 1 }, { min: 1.5, max: 2 }, { min: Number.NaN, max: 1 }, null, {}]) {
    assert.equal(negotiateProtocol(offer as never).ok, false, JSON.stringify(offer));
    assert.equal((negotiateProtocol(offer as never) as { reason: string }).reason, 'invalid');
  }
});

test('a broken server range is a programming error', () => {
  assert.throws(() => negotiateProtocol({ min: 1, max: 1 }, { min: 2, max: 1 }), RangeError);
});

test('operations are read only at supported versions', () => {
  assert.equal(readsVersion(PROTOCOL_VERSION), true);
  assert.equal(readsVersion(SUPPORTED_PROTOCOL.max + 1), false);
  assert.equal(readsVersion(0), false);
  assert.equal(readsVersion(1.5), false);
});
