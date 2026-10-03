import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spreadRows } from './layout.ts';

test('pages group into rows for single, side-by-side and cover-page layouts', () => {
  assert.deepEqual(spreadRows(3, 1, false), [[0], [1], [2]]);
  assert.deepEqual(spreadRows(5, 2, false), [[0, 1], [2, 3], [4]]);
  assert.deepEqual(spreadRows(5, 2, true), [[0], [1, 2], [3, 4]]);
  assert.deepEqual(spreadRows(4, 2, true), [[0], [1, 2], [3]]);
  assert.deepEqual(spreadRows(0, 2, true), []);
});
