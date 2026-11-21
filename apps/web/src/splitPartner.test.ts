import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickSplitPartner, touchRecent } from './splitPartner.ts';

test('no partner when only the active document is open', () => {
  assert.equal(pickSplitPartner(['a'], 'a', ['a']), null);
  assert.equal(pickSplitPartner([], null), null);
});

test('picks the most recently used other document', () => {
  assert.equal(pickSplitPartner(['a', 'b', 'c'], 'a', ['a', 'c', 'b']), 'c');
  assert.equal(pickSplitPartner(['a', 'b', 'c'], 'c', ['c', 'a']), 'a');
});

test('never picks the active document', () => {
  assert.equal(pickSplitPartner(['a', 'b'], 'b', ['b', 'b', 'a']), 'a');
});

test('ignores recent ids that are no longer open', () => {
  assert.equal(pickSplitPartner(['a', 'b'], 'a', ['gone', 'a', 'b']), 'b');
});

test('falls back to the tab beside the active one, then the first other', () => {
  assert.equal(pickSplitPartner(['a', 'b', 'c'], 'b', []), 'c');
  assert.equal(pickSplitPartner(['a', 'b', 'c'], 'c', []), 'a');
  assert.equal(pickSplitPartner(['a', 'b'], null, []), 'a');
});

test('touchRecent moves an id to the front without duplicating it, and caps the list', () => {
  assert.deepEqual(touchRecent(['a', 'b', 'c'], 'c'), ['c', 'a', 'b']);
  assert.deepEqual(touchRecent([], 'a'), ['a']);
  assert.deepEqual(touchRecent(['a', 'b', 'c'], 'd', 3), ['d', 'a', 'b']);
});
