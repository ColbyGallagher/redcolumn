import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
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

const seqs = (store: MarkupStore) => Object.fromEntries(store.all().map((m) => [m.id, m.seq]));
const settle = () => new Promise((r) => setTimeout(r, 0));

test('markups are numbered 1, 2, 3... and a number is never reused', async () => {
  const store = await storeWith(3);
  assert.deepEqual(seqs(store), { m0: 1, m1: 2, m2: 3 });
  // Deleting the newest and adding another does not hand its number out again; nor does undo.
  store.remove(['m2']);
  store.add(rect('m3', 0));
  assert.equal(store.get('m3')!.seq, 4);
  store.undo();
  store.add(rect('m4', 0));
  assert.equal(store.get('m4')!.seq, 5);
  // A copy (a pasted markup, new id) gets its own number; replacing a markup keeps its number.
  store.add({ ...store.get('m0')!, id: 'copy' });
  assert.equal(store.get('copy')!.seq, 6);
  store.add({ ...store.get('m1')!, comment: 'replaced' });
  assert.equal(store.get('m1')!.seq, 2);
  await store.destroy();
});

test('markups stored before IDs are numbered in the order they were made', async () => {
  const store = await MarkupStore.open('legacy', { persist: false });
  // As loaded from an older copy of the document: no IDs.
  store.resetMarkups([{ ...rect('b', 0), createdAt: 20 }, { ...rect('a', 0), createdAt: 10 }]);
  await settle();
  assert.deepEqual(seqs(store), { a: 1, b: 2 });
  store.add(rect('c', 0));
  assert.equal(store.get('c')!.seq, 3);
  await store.destroy();
});

test('two people adding a markup at once settle on different IDs', async () => {
  const [one, two] = await Promise.all([MarkupStore.open('s1', { persist: false }), MarkupStore.open('s2', { persist: false })]);
  const sync = () => {
    Y.applyUpdate(two.doc, Y.encodeStateAsUpdate(one.doc), 'remote');
    Y.applyUpdate(one.doc, Y.encodeStateAsUpdate(two.doc), 'remote');
  };
  one.add(rect('shared', 0));
  sync();
  // Both offline: each takes ID 2.
  one.add({ ...rect('mine', 0), createdAt: 5 });
  two.add({ ...rect('theirs', 0), createdAt: 6 });
  assert.equal(one.get('mine')!.seq, 2);
  assert.equal(two.get('theirs')!.seq, 2);
  sync();
  await settle();
  sync();
  await settle();
  // The one made first keeps 2, the other moves to 3, in both copies.
  assert.deepEqual(seqs(one), { shared: 1, mine: 2, theirs: 3 });
  assert.deepEqual(seqs(two), seqs(one));
  two.add(rect('next', 0));
  assert.equal(two.get('next')!.seq, 4);
  await Promise.all([one.destroy(), two.destroy()]);
});
