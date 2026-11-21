import { test } from 'node:test';
import assert from 'node:assert/strict';
import { corrections, editDistance, matchExpression, quote } from './terms';

test('quote escapes FTS5 syntax', () => {
  assert.equal(quote('c'), '"c"');
  assert.equal(quote('a"b'), '"a""b"');
});

test('matchExpression: first term may be inside a word, last may be a prefix', () => {
  const mid = (t: string) => (t === 'orque' ? ['torque'] : []);
  assert.equal(matchExpression('orque m1', ['orque', 'm1'], false, mid), '("orque" OR "torque") AND "m1"*');
  assert.equal(matchExpression('section a-a', ['section', 'a', 'a'], false, () => []), '"section" AND "a" AND "a"*');
});

test('matchExpression: separators at either end anchor the terms', () => {
  assert.equal(matchExpression('-101', ['101'], false, () => ['x101']), '"101"*');
  assert.equal(matchExpression('-101-', ['101'], false, () => ['x101']), '"101"');
  assert.equal(matchExpression('m12-', ['m12'], false, () => []), '"m12"');
});

test('matchExpression: whole words only', () => {
  assert.equal(matchExpression('torque m12', ['torque', 'm12'], true, () => ['x']), '"torque" AND "m12"');
});

test('matchExpression: a first term in too many words does not narrow', () => {
  assert.equal(matchExpression('e m1', ['e', 'm1'], false, () => null), '"m1"*');
  assert.equal(matchExpression('e', ['e'], false, () => null), null);
  assert.equal(matchExpression('--', [], false, () => []), null);
});

test('editDistance counts swaps as one edit and stops past the limit', () => {
  assert.equal(editDistance('torque', 'torque', 2), 0);
  assert.equal(editDistance('torqe', 'torque', 2), 1);
  assert.equal(editDistance('tourqe', 'torque', 2), 2);
  assert.equal(editDistance('flnage', 'flange', 2), 1);
  assert.equal(editDistance('abc', 'xyzabc', 2), 3);
  assert.equal(editDistance('kitten', 'sitting', 1), 2);
});

test('corrections: closest, then most common; no numbers or short words', () => {
  const vocab = new Map([
    ['torque', 9],
    ['torques', 2],
    ['toque', 1],
    ['m12', 4],
  ]);
  assert.deepEqual(corrections('torqe', vocab), ['torque', 'torques', 'toque']);
  assert.deepEqual(corrections('m13', vocab), []);
  assert.deepEqual(corrections('to', vocab), []);
});
