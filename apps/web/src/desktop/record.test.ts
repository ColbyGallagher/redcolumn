import assert from 'node:assert/strict';
import test from 'node:test';
import { isTokenRecord } from './record.ts';

test('token records are the only disk handles the desktop app stores', () => {
  assert.equal(isTokenRecord({ v: 1, token: 'abc', name: 'A-101.pdf' }), true);
  assert.equal(isTokenRecord({ v: 2, token: 'abc', name: 'A-101.pdf' }), false);
  assert.equal(isTokenRecord({ v: 1, token: '', name: 'A-101.pdf' }), false);
  assert.equal(isTokenRecord(null), false);
});
