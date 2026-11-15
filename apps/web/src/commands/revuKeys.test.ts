import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_KEYS } from './keys.ts';
import { importRevuShortcuts, readRevuShortcuts, REVU_21_KEYS, REVU_FEATURES, revu21Preset, revuCombo, revuOverrides } from './revuKeys.ts';

const SHIFT = 0x10000;
const CTRL = 0x20000;
const ALT = 0x40000;

const file = (rows: [number, string][]) =>
  `﻿<?xml version="1.0" encoding="utf-8"?>\n<KeyboardShortcuts Version="1">\n${rows.map(([k, f]) => `  <Shortcut>\n    <Keys>${k}</Keys>\n    <Feature>${f}</Feature>\n  </Shortcut>`).join('\n')}\n</KeyboardShortcuts>`;

test('Revu key values become combos in our modifier order', () => {
  assert.equal(revuCombo(86), 'V');
  assert.equal(revuCombo(SHIFT | 86), 'Shift+V');
  assert.equal(revuCombo(SHIFT | ALT | 76), 'Alt+Shift+L');
  assert.equal(revuCombo(CTRL | SHIFT | ALT | 71), 'Ctrl+Alt+Shift+G');
  assert.equal(revuCombo(CTRL | 104), 'Ctrl+8', 'keypad digits share the main key');
  assert.equal(revuCombo(CTRL | SHIFT | 187), 'Ctrl+Shift+Plus');
  assert.equal(revuCombo(109), 'Minus');
  assert.equal(revuCombo(SHIFT | 120), 'Shift+F9');
  assert.equal(revuCombo(CTRL | 221), 'Ctrl+]');
  assert.equal(revuCombo(ALT | 37), 'Alt+Left');
  assert.equal(revuCombo(0), null);
  assert.equal(revuCombo(250), null);
});

test('every feature maps to a command with defaults, and redcolumn defaults include Revu 21 keys', () => {
  for (const [feature, keys] of Object.entries(REVU_21_KEYS)) {
    const id = REVU_FEATURES[feature];
    assert.ok(id, `${feature} has a command`);
    for (const k of keys) {
      const owner = Object.entries(DEFAULT_KEYS).find(([, ks]) => ks.includes(k))?.[0];
      assert.ok(owner, `${k} (${feature}) is a default somewhere`);
    }
  }
  for (const feature of Object.keys(REVU_FEATURES)) assert.ok(REVU_21_KEYS[feature], `${feature} has Revu 21 keys`);
});

test('Revu 21 keys read as they are change nothing', () => {
  const r = revuOverrides(REVU_21_KEYS);
  assert.deepEqual(r.overrides, {});
  assert.equal(r.changed, 0);
});

test('the strict Revu 21 preset only clears redcolumn-only shortcuts', () => {
  const preset = revu21Preset();
  assert.deepEqual(preset['edit.offset'], []);
  assert.deepEqual(preset['help.commands'], []);
  assert.deepEqual(preset['draw.arc'], []);
  assert.equal(preset['tool.cloud'], undefined, 'Revu commands stay on their defaults');
  for (const keys of Object.values(preset)) assert.deepEqual(keys, []);
});

test("a person's changed Revu keys move onto redcolumn's commands", () => {
  const xml = file([
    [79, 'Markup.Cloud'], // O for cloud, taking it from Offset
    [76, 'Markup.Line'],
    [SHIFT | 37, 'Arrow.Left'],
    [37, 'Arrow.Left'],
    [CTRL | 0x51, 'Some.FutureFeature'],
  ]);
  const r = importRevuShortcuts(xml);
  assert.deepEqual(r.overrides['tool.cloud'], ['O']);
  assert.deepEqual(r.overrides['edit.offset'], [], 'O no longer offsets');
  assert.equal(r.overrides['tool.line'], undefined, 'unchanged commands are not written');
  assert.equal(r.overrides['edit.nudgeLeft'], undefined);
  assert.equal(r.overrides['edit.nudgeLeftLarge'], undefined, 'Shift+Left still nudges further');
  assert.deepEqual(r.unmapped, ['Some.FutureFeature']);
  assert.equal(r.overrides['tool.rect'], undefined, 'features missing from the file are left alone');
});

test('a feature listed with an unusable key is cleared, and junk is refused', () => {
  const r = importRevuShortcuts(file([[86, 'Select'], [250, 'Markup.Cloud']]));
  assert.equal(r.overrides['tool.cloud'], undefined, 'a key we cannot name is skipped, not read as cleared');
  assert.throws(() => readRevuShortcuts('<root/>'), /not a Revu keyboard shortcuts file/);
  assert.throws(() => readRevuShortcuts('<KeyboardShortcuts Version="1"></KeyboardShortcuts>'), /no shortcuts/);
});

// A real Revu settings folder, when one is at hand (not in the repository): REVU_SETTINGS_DIR=…/Revu/21
const dir = process.env.REVU_SETTINGS_DIR;
test('the shipped Revu 21 KeyboardShortcuts.xml matches REVU_21_KEYS', { skip: !dir || !existsSync(join(dir, 'KeyboardShortcuts.xml')) }, () => {
  const read = readRevuShortcuts(readFileSync(join(dir!, 'KeyboardShortcuts.xml'), 'utf8'));
  for (const [feature, keys] of Object.entries(REVU_21_KEYS)) assert.deepEqual([...(read.get(feature) ?? [])].sort(), [...keys].sort(), feature);
  assert.equal(importRevuShortcuts(readFileSync(join(dir!, 'KeyboardShortcuts.xml'), 'utf8')).changed, 0);
});
