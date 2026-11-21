import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { StoredFile } from './fileStore.ts';
import { recentFiles } from './recents.ts';

const DAY = 86_400_000;
const now = 100 * DAY;
const file = (id: string, daysAgo: number, extra: Partial<StoredFile> = {}): StoredFile => ({ id, hash: id, name: `${id}.pdf`, size: 1, addedAt: 0, lastOpenedAt: now - daysAgo * DAY, ...extra });

test('the list is the most recently opened first, cut to the preferred count', () => {
  const files = Array.from({ length: 30 }, (_, i) => file(`f${i}`, 30 - i));
  const list = recentFiles(files, { count: 20, days: 0, now });
  assert.equal(list.length, 20);
  assert.equal(list[0]!.id, 'f29');
  assert.equal(list[19]!.id, 'f10');
});

test('files opened before the preferred number of days are left out', () => {
  const list = recentFiles([file('new', 1), file('old', 10)], { count: 10, days: 7, now });
  assert.deepEqual(list.map((f) => f.id), ['new']);
});

test('a file taken off the list is not in it and does not use up a place', () => {
  const list = recentFiles([file('a', 1), file('b', 2, { recentHidden: true }), file('c', 3)], { count: 2, days: 0, now });
  assert.deepEqual(list.map((f) => f.id), ['a', 'c']);
});

test('one file on disk opened as more than one document is listed once, as the latest', () => {
  const location: Record<string, string> = { v2: 'disk-1', v1: 'disk-1', other: 'disk-2' };
  const list = recentFiles([file('v1', 5), file('v2', 1), file('other', 3), file('web', 4)], { count: 10, days: 0, now, locationOf: (id) => location[id] ?? null });
  assert.deepEqual(list.map((f) => f.id), ['v2', 'other', 'web']);
});

test('templates can be left out', () => {
  const files = [file('doc', 1), file('tpl', 2, { template: true })];
  assert.deepEqual(recentFiles(files, { count: 10, days: 0, now, templates: false }).map((f) => f.id), ['doc']);
  assert.deepEqual(recentFiles(files, { count: 10, days: 0, now }).map((f) => f.id), ['doc', 'tpl']);
});
