import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clickSelect, edgeScroll, moveSelected, placeBlock, revealScroll, type ListSelection } from './listSelection';

const order = [10, 11, 12, 13, 14];
const one: ListSelection = { ids: new Set([11]), anchor: 11 };
const plain = { range: false, toggle: false };
const shift = { range: true, toggle: false };
const ctrl = { range: false, toggle: true };
const ids = (s: ListSelection) => [...s.ids].sort();

test('a plain click selects one row', () => {
  assert.deepEqual(ids(clickSelect(order, one, 13, plain)), [13]);
});

test('Ctrl+click adds and removes a row', () => {
  const two = clickSelect(order, one, 13, ctrl);
  assert.deepEqual(ids(two), [11, 13]);
  assert.deepEqual(ids(clickSelect(order, two, 11, ctrl)), [13]);
});

test('Shift+click selects the range from the anchor, in either direction', () => {
  const down = clickSelect(order, one, 13, shift);
  assert.deepEqual(ids(down), [11, 12, 13]);
  assert.deepEqual(ids(clickSelect(order, down, 10, shift)), [10, 11]);
});

test('Ctrl+Shift+click adds a range to the selection', () => {
  const two = clickSelect(order, one, 13, ctrl);
  assert.deepEqual(ids(clickSelect(order, two, 14, { range: true, toggle: true })), [11, 13, 14]);
});

test('Shift+click with no anchor selects the clicked row', () => {
  assert.deepEqual(ids(clickSelect(order, { ids: new Set(), anchor: null }, 12, shift)), [12]);
});

const move = (list: string, picked: string, by: -1 | 1) => moveSelected([...list], (c) => picked.includes(c), by).join('');

test('selected rows move together', () => {
  assert.equal(move('abcde', 'cd', -1), 'acdbe');
  assert.equal(move('abcde', 'bc', 1), 'adbce');
  assert.equal(move('abcde', 'bd', -1), 'badce');
  assert.equal(move('abcde', 'bd', 1), 'acbed');
});

test('rows against the end stay put while the others close up', () => {
  assert.equal(move('abcde', 'ad', -1), 'abdce');
  assert.equal(move('abcde', 'ab', -1), 'abcde');
  assert.equal(move('abcde', 'be', 1), 'acbde');
});

const drop = (list: string, picked: string, start: number) => placeBlock([...list], (c) => picked.includes(c), start).join('');

test('a dragged row goes where it is dropped, and stays inside the list', () => {
  assert.equal(drop('abcde', 'b', 3), 'acdbe');
  assert.equal(drop('abcde', 'd', 0), 'dabce');
  assert.equal(drop('abcde', 'b', -4), 'bacde');
  assert.equal(drop('abcde', 'b', 99), 'acdeb');
});

test('rows dragged from apart land together, in their own order', () => {
  assert.equal(drop('abcde', 'ad', 1), 'badce');
  assert.equal(drop('abcde', 'ad', 99), 'bcead');
});

test('a drag scrolls only near or past the edges, faster further out', () => {
  assert.equal(edgeScroll(200, 100, 300), 0);
  assert.equal(edgeScroll(128, 100, 300), 0);
  assert.equal(edgeScroll(114, 100, 300), -7);
  assert.equal(edgeScroll(286, 100, 300), 7);
  assert.equal(edgeScroll(20, 100, 300), -14);
  assert.equal(edgeScroll(500, 100, 300), 14);
});

test('scrolls only as far as needed to show the moved rows', () => {
  assert.equal(revealScroll(100, 200, 150, 180, 1), 100);
  assert.equal(revealScroll(100, 200, 60, 90, -1), 60);
  assert.equal(revealScroll(100, 200, 300, 330, 1), 130);
});

test('a selection taller than the list shows its leading edge', () => {
  assert.equal(revealScroll(100, 200, 50, 400, -1), 50);
  assert.equal(revealScroll(100, 200, 50, 400, 1), 200);
});
