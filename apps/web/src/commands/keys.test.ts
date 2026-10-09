import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assignKey, comboOf, DEFAULT_KEYS, formatCombo, keyMap, keysFor, removeKey, resetKeys } from './keys.ts';

const ev = (key: string, mods: { ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean; code?: string } = {}) => ({
  key,
  code: mods.code,
  ctrlKey: !!mods.ctrl,
  metaKey: !!mods.meta,
  shiftKey: !!mods.shift,
  altKey: !!mods.alt,
});

test('key presses become combos with modifiers in a fixed order', () => {
  assert.equal(comboOf(ev('v', { ctrl: true, shift: true })), 'Ctrl+Shift+V');
  assert.equal(comboOf(ev('V', { shift: true })), 'Shift+V');
  assert.equal(comboOf(ev('l')), 'L');
  assert.equal(comboOf(ev('z', { meta: true })), 'Ctrl+Z');
  assert.equal(comboOf(ev('F9', { shift: true })), 'Shift+F9');
  assert.equal(comboOf(ev('ArrowLeft', { alt: true })), 'Alt+Left');
  assert.equal(comboOf(ev('}', { ctrl: true, shift: true, code: 'BracketRight' })), 'Ctrl+Shift+]');
  assert.equal(comboOf(ev('O', { alt: true, shift: true })), 'Alt+Shift+O');
  assert.equal(comboOf(ev('Shift', { shift: true })), null);
});

test('plus, minus and digits are named by key, whatever Shift does to the character', () => {
  assert.equal(comboOf(ev('+', { shift: true, code: 'Equal' })), 'Shift+Plus');
  assert.equal(comboOf(ev('=', { code: 'Equal' })), 'Plus');
  assert.equal(comboOf(ev('+', { code: 'NumpadAdd' })), 'Plus');
  assert.equal(comboOf(ev('_', { ctrl: true, shift: true, code: 'Minus' })), 'Ctrl+Shift+Minus');
  assert.equal(comboOf(ev('!', { shift: true, code: 'Digit1' })), 'Shift+1');
  assert.equal(formatCombo('Ctrl+Shift+Plus'), 'Ctrl+Shift++');
  assert.equal(formatCombo('Minus'), '−');
});

test('default shortcuts never give one combo to two commands', () => {
  const seen = new Map<string, string>();
  for (const [id, keys] of Object.entries(DEFAULT_KEYS)) {
    for (const k of keys) {
      assert.equal(seen.get(k), undefined, `${k} is both ${seen.get(k)} and ${id}`);
      seen.set(k, id);
    }
  }
});

test('assigning a shortcut takes it from the command that had it', () => {
  const ids = ['tool.line', 'tool.arrow'];
  const next = assignKey(ids, {}, 'tool.arrow', 'L');
  assert.deepEqual(keysFor('tool.line', next), []);
  assert.deepEqual(keysFor('tool.arrow', next), ['A', 'L']);
  assert.equal(keyMap(ids, next).get('L'), 'tool.arrow');
  const removed = removeKey(next, 'tool.arrow', 'A');
  assert.deepEqual(keysFor('tool.arrow', removed), ['L']);
  assert.deepEqual(keysFor('tool.arrow', resetKeys(removed, 'tool.arrow')), ['A']);
});
