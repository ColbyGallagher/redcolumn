import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pageNumberLabel } from './pageImages.ts';

test('page names follow the Page Number pattern', () => {
  assert.equal(pageNumberLabel('Page 001', 7), 'Page 007');
  assert.equal(pageNumberLabel('Page 001', 1234), 'Page 1234');
  assert.equal(pageNumberLabel('Sheet-2024-01', 3), 'Sheet-2024-03');
  assert.equal(pageNumberLabel('p', 5), 'p 5');
  assert.equal(pageNumberLabel('', 5), 'Page 5');
});
