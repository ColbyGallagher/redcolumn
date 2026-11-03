import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addCustomColor, HEX_COLOR, MAX_CUSTOM_COLORS, removeCustomColor } from './customColors.ts';

test('a new custom color goes first, lower-cased', () => {
  assert.deepEqual(addCustomColor(['#111111'], '#ABCDEF'), ['#abcdef', '#111111']);
});

test('a repeated custom color moves to the front instead of doubling up', () => {
  assert.deepEqual(addCustomColor(['#111111', '#222222', '#333333'], '#222222'), ['#222222', '#111111', '#333333']);
  assert.deepEqual(addCustomColor(['#aaaaaa', '#bbbbbb'], '#AAAAAA'), ['#aaaaaa', '#bbbbbb']);
});

test('the custom list keeps only the newest ten', () => {
  let list: string[] = [];
  for (let i = 0; i < 12; i++) list = addCustomColor(list, `#0000${i.toString(16).padStart(2, '0')}`);
  assert.equal(list.length, MAX_CUSTOM_COLORS);
  assert.equal(list[0], '#00000b');
  assert.ok(!list.includes('#000000'));
});

test('removing a custom color leaves the rest in order', () => {
  assert.deepEqual(removeCustomColor(['#111111', '#222222', '#333333'], '#222222'), ['#111111', '#333333']);
});

test('the hex field takes only #rrggbb', () => {
  assert.ok(HEX_COLOR.test('#a1B2c3'));
  for (const bad of ['a1b2c3', '#abc', '#12345g', '#1234567', '']) assert.ok(!HEX_COLOR.test(bad), bad);
});
