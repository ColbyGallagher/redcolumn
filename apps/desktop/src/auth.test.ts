import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { pkcePair } from './pkce.ts';

test('pkce challenge is the sha256 of the verifier', () => {
  const { verifier, challenge } = pkcePair();
  assert.equal(challenge, createHash('sha256').update(verifier).digest('base64url'));
  assert.ok(verifier.length >= 43);
});
