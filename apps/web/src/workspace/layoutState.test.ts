import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clearLayout, DEFAULT_LAYOUT, fitWidths, loadLayout, parseLayout, saveLayout, serializeLayout } from './layoutState.ts';

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

test('two wide panels are shrunk together to leave room for the drawing', () => {
  const l = parseLayout('{"leftWidth":480,"rightWidth":480}', 900);
  assert.deepEqual([l.leftWidth, l.rightWidth], [480, 480]);
  const [a, b] = fitWidths(480, 480, 1100);
  assert.ok(a + b <= 700 && a >= 180 && b >= 180);
  assert.deepEqual(fitWidths(300, 300, 1920), [300, 300]);
  assert.deepEqual(fitWidths(480, 480, 500), [180, 180]);
});

function stubStorage(mode: 'ok' | 'off') {
  const store = new Map<string, string>();
  const refuse = () => {
    throw new Error('storage is off limits');
  };
  (globalThis as Record<string, unknown>).window = { innerHeight: 1000, innerWidth: 1920 };
  (globalThis as Record<string, unknown>).localStorage =
    mode === 'off'
      ? { getItem: refuse, setItem: refuse, removeItem: refuse }
      : { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
}

test('saveLayout, loadLayout and clearLayout round trip through storage', () => {
  stubStorage('ok');
  assert.equal(loadLayout(), null);
  const l = { ...DEFAULT_LAYOUT, dockOpen: false, leftWidth: 300 };
  saveLayout(l);
  assert.deepEqual(loadLayout(), l);
  clearLayout();
  assert.equal(loadLayout(), null);
});

test('storage that refuses reads and writes never throws', () => {
  stubStorage('off');
  assert.equal(loadLayout(), null);
  assert.doesNotThrow(() => saveLayout(DEFAULT_LAYOUT));
  assert.doesNotThrow(() => clearLayout());
});
