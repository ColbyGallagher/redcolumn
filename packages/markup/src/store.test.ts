import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MarkupStore } from './store.ts';
import { DEFAULT_STYLES, type Markup } from './model.ts';

function rect(id: string, x: number): Markup {
  return { id, type: 'rect', pageIndex: 0, points: [[x, 0], [x + 10, 10]], style: { ...DEFAULT_STYLES.rect }, status: 'none', author: '', createdAt: 1, modifiedAt: 1 };
}

async function storeWith(n: number) {
  const store = await MarkupStore.open('test', { persist: false });
  store.batch(() => {
    for (let i = 0; i < n; i++) store.add(rect(`m${i}`, i * 20));
  });
  store.checkpoint();
  return store;
}

test('a batch of edits notifies once and undoes as one step', async () => {
  const store = await storeWith(5);
  let heard = 0;
  store.subscribe(() => heard++);
  store.batch(() => {
    for (const m of store.all()) store.update(m.id, { points: m.points.map(([x, y]) => [x + 5, y + 5]) });
  });
  assert.equal(heard, 1);
  assert.equal(store.undoHistory()[0]?.label, 'Move 5 markups');
  store.undo();
  assert.deepEqual(
    store.all().map((m) => m.points[0]),
    [0, 20, 40, 60, 80].map((x) => [x, 0]),
  );
  await store.destroy();
});

test('a markup edit keeps the other snapshots as they were', async () => {
  const store = await storeWith(2);
  const before = { scales: store.allScales(), sheets: store.allSheets(), links: store.allLinks(), viewports: store.allViewports(), stitch: store.stitchGroups(), bookmarks: store.bookmarks(), places: store.places(), columns: store.columnSet() };
  const markups = store.all();
  store.update('m0', { status: 'accepted' });
  assert.notEqual(store.all(), markups);
  assert.equal(store.allScales(), before.scales);
  assert.equal(store.allSheets(), before.sheets);
  assert.equal(store.allLinks(), before.links);
  assert.equal(store.allViewports(), before.viewports);
  assert.equal(store.stitchGroups(), before.stitch);
  assert.equal(store.bookmarks(), before.bookmarks);
  assert.equal(store.places(), before.places);
  assert.equal(store.columnSet(), before.columns);
  await store.destroy();
});

test('a read-only store ignores a batch', async () => {
  const store = await storeWith(1);
  store.setReadOnly(true);
  store.batch(() => store.update('m0', { status: 'accepted' }));
  assert.equal(store.get('m0')?.status, 'none');
  await store.destroy();
});
