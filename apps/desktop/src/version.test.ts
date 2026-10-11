import assert from 'node:assert/strict';
import test from 'node:test';
import { isNewer, parseVersion } from './version.ts';

test('release tags parse with or without the v', () => {
  assert.deepEqual(parseVersion('v1.2.3'), [1, 2, 3]);
  assert.deepEqual(parseVersion('0.10.0'), [0, 10, 0]);
  assert.equal(parseVersion('1.2'), null);
  assert.equal(parseVersion('v1.2.3-beta.1'), null);
});

test('newer compares each part as a number', () => {
  assert.equal(isNewer('v0.10.0', '0.9.0'), true);
  assert.equal(isNewer('v1.0.0', '0.9.9'), true);
  assert.equal(isNewer('v1.2.3', '1.2.3'), false);
  assert.equal(isNewer('v1.2.2', '1.2.3'), false);
  assert.equal(isNewer('nightly', '1.2.3'), false);
});
