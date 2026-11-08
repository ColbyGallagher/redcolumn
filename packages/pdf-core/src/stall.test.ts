import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LONG_STALL_MS, RENDER_STALL_MS, StallTracker, stallLimit } from './stall.ts';

test('nothing waiting is never stalled', () => {
  assert.equal(new StallTracker().stalledFor(10 * LONG_STALL_MS), null);
});

test('a render with no answer past its limit is stalled', () => {
  const t = new StallTracker();
  t.begin(1, RENDER_STALL_MS, 0);
  assert.equal(t.stalledFor(RENDER_STALL_MS), null);
  assert.equal(t.stalledFor(RENDER_STALL_MS + 1), RENDER_STALL_MS + 1);
});

test('any message from the worker counts as progress', () => {
  const t = new StallTracker();
  t.begin(1, RENDER_STALL_MS, 0);
  t.activity(RENDER_STALL_MS - 1);
  assert.equal(t.stalledFor(RENDER_STALL_MS + 1000), null);
  assert.notEqual(t.stalledFor(2 * RENDER_STALL_MS), null);
});

test('the longest limit among waiting calls applies, so a long open is not cut short by a queued render', () => {
  const t = new StallTracker();
  t.begin(1, LONG_STALL_MS, 0);
  t.begin(2, RENDER_STALL_MS, 0);
  assert.equal(t.stalledFor(RENDER_STALL_MS * 2), null);
  assert.notEqual(t.stalledFor(LONG_STALL_MS + 1), null);
  t.end(1);
  assert.notEqual(t.stalledFor(RENDER_STALL_MS * 2), null);
});

test('the clock starts when the first call starts waiting, not at construction', () => {
  const t = new StallTracker();
  t.begin(1, RENDER_STALL_MS, 5 * LONG_STALL_MS);
  assert.equal(t.stalledFor(5 * LONG_STALL_MS + 1000), null);
});

test('whole-file requests get the long limit', () => {
  assert.equal(stallLimit('open'), LONG_STALL_MS);
  assert.equal(stallLimit('redact'), LONG_STALL_MS);
  assert.equal(stallLimit('render'), RENDER_STALL_MS);
});
