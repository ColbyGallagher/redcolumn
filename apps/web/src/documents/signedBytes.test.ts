import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasSignature } from './signedBytes.ts';

test('hasSignature finds a signature dictionary', () => {
  const enc = (s: string) => new TextEncoder().encode(s);
  assert.equal(hasSignature(enc('%PDF-1.7 << /Type /Sig /ByteRange [0 1 2 3] >>')), true);
  assert.equal(hasSignature(enc('%PDF-1.7 << /Type /Page /Byte /Range >>')), false);
  assert.equal(hasSignature(enc('/ByteRang')), false);
});
