import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_LAYOUT, parseLayout, serializeLayout } from './layoutState.ts';

test('a saved layout round trips', () => {
  const l = { leftWidth: 300, rightWidth: 250, showBottom: false, dockOpen: false, bottomTab: 'links' as const, dockHeight: 220 };
  assert.deepEqual(parseLayout(serializeLayout(l)), l);
});

test('nothing saved, or junk, gives the defaults', () => {
  assert.deepEqual(parseLayout(null), DEFAULT_LAYOUT);
  assert.deepEqual(parseLayout('not json'), DEFAULT_LAYOUT);
  assert.deepEqual(parseLayout('[1,2]'), DEFAULT_LAYOUT);
  assert.deepEqual(parseLayout('"x"'), DEFAULT_LAYOUT);
});

test('sizes are clamped and wrong types fall back field by field', () => {
  const l = parseLayout(JSON.stringify({ leftWidth: 99999, rightWidth: -5, dockHeight: 5000, showBottom: 'yes', bottomTab: 'bogus', dockOpen: false }), 800);
  assert.equal(l.leftWidth, 480);
  assert.equal(l.rightWidth, 180);
  assert.equal(l.dockHeight, 400);
  assert.equal(l.showBottom, true);
  assert.equal(l.bottomTab, 'markups');
  assert.equal(l.dockOpen, false);
});

test('non-numbers do not get through', () => {
  const l = parseLayout('{"leftWidth":"wide","dockHeight":null}');
  assert.equal(l.leftWidth, DEFAULT_LAYOUT.leftWidth);
  assert.equal(l.dockHeight, DEFAULT_LAYOUT.dockHeight);
});

test('a small window keeps the list at least its minimum height', () => {
  assert.equal(parseLayout('{"dockHeight":200}', 100).dockHeight, 80);
});
