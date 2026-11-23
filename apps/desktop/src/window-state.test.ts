import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  DEFAULT_WINDOW_HEIGHT,
  DEFAULT_WINDOW_WIDTH,
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  WindowStateStore,
  isReachableOnDisplays,
  loadWindowState,
  parseWindowState,
  resolveWindowBounds,
  saveWindowState,
  saveWindowStateSync,
} from './window-state.ts';

const primary = { x: 0, y: 0, width: 1920, height: 1040 };

test('parseWindowState accepts valid bounds and clamps below minimum size', () => {
  assert.deepEqual(parseWindowState({ width: 1600.4, height: 950.6, x: 100.2, y: 40.8, maximized: true }), {
    width: 1600,
    height: 951,
    x: 100,
    y: 41,
    maximized: true,
  });
  assert.deepEqual(parseWindowState({ width: 300, height: 200 }), {
    width: MIN_WINDOW_WIDTH,
    height: MIN_WINDOW_HEIGHT,
    maximized: false,
  });
  assert.equal(parseWindowState(null), null);
  assert.equal(parseWindowState({ width: 0, height: 800 }), null);
  assert.equal(parseWindowState({ width: Number.NaN, height: 800 }), null);
});

test('resolveWindowBounds returns defaults when nothing is saved', () => {
  assert.deepEqual(resolveWindowBounds(null, [primary], primary), {
    width: DEFAULT_WINDOW_WIDTH,
    height: DEFAULT_WINDOW_HEIGHT,
    maximized: false,
  });
});

test('resolveWindowBounds keeps position and size when reachable on a display', () => {
  const saved = { x: 120, y: 60, width: 1680, height: 960, maximized: false };
  assert.deepEqual(resolveWindowBounds(saved, [primary], primary), saved);
});

test('resolveWindowBounds accepts slight negative Windows DWM borders', () => {
  const saved = { x: -8, y: -8, width: 1936, height: 1056, maximized: true };
  assert.equal(isReachableOnDisplays(saved, [primary]), true);
  assert.deepEqual(resolveWindowBounds(saved, [primary], primary), saved);
});

test('resolveWindowBounds drops off-screen position when a monitor is disconnected but keeps fitted size', () => {
  const saved = { x: 2200, y: 100, width: 2560, height: 1400, maximized: false };
  assert.deepEqual(resolveWindowBounds(saved, [primary], primary), {
    width: 1920,
    height: 1040,
    maximized: false,
  });
});

test('resolveWindowBounds resets position when title bar is above the top of the screen', () => {
  const saved = { x: 100, y: -35, width: 1200, height: 800, maximized: false };
  assert.deepEqual(resolveWindowBounds(saved, [primary], primary), {
    width: 1200,
    height: 800,
    maximized: false,
  });
});

test('loadWindowState, saveWindowState and saveWindowStateSync round-trip cleanly', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'redcolumn-winstate-'));
  const file = path.join(dir, 'window-state.json');
  assert.equal(await loadWindowState(file), null);

  const first = { x: 50, y: 40, width: 1500, height: 920, maximized: false };
  await saveWindowState(file, first);
  assert.deepEqual(await loadWindowState(file), first);

  const second = { x: 80, y: 60, width: 1700, height: 980, maximized: true };
  saveWindowStateSync(file, second);
  assert.deepEqual(await loadWindowState(file), second);
  assert.deepEqual(await fs.readdir(dir), ['window-state.json']);

  await fs.rm(dir, { recursive: true });
});

test('WindowStateStore loads, updates and flushes synchronously on close', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'redcolumn-winstate-store-'));
  const file = path.join(dir, 'window-state.json');
  const store = new WindowStateStore(file, 5000);
  await store.load();
  store.flushSync({ x: 20, y: 30, width: 1600, height: 940, maximized: false });

  const reloaded = new WindowStateStore(file, 5000);
  assert.deepEqual(await reloaded.load(), { x: 20, y: 30, width: 1600, height: 940, maximized: false });

  await fs.rm(dir, { recursive: true });
});
