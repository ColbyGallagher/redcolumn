import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crsById } from '@nb/measure';
import { MarkupStore } from '@nb/markup';
import { geoRegionFor, gridToPage, pageToGrid, type ModelPlacement } from '../geospatial/align';
import { newTopic, type BcfTopic } from './bcf';
import { BCF_SUBJECT, removeTopicMarkups, syncTopic, type SyncSheet } from './bcfSync';

const PLACE: ModelPlacement = { e0: 318700, n0: 6247200, x: 300, y: 400, scale: 0.55, rotation: 0.2 };
const regionOn = (id: string) =>
  geoRegionFor({
    toGrid: (p) => pageToGrid(PLACE, p),
    crs: crsById('EPSG:7856')!,
    pageIndex: 0,
    bounds: [
      [40, 60],
      [560, 60],
      [560, 740],
      [40, 740],
    ],
    name: id,
  });

async function sheets(): Promise<SyncSheet[]> {
  // Two documents (two Y.Docs) showing the same part of the map.
  const a = await MarkupStore.open(`bcf-a-${Math.random()}`, { persist: false });
  const b = await MarkupStore.open(`bcf-b-${Math.random()}`, { persist: false });
  return [
    { key: 'a:0:r', region: regionOn('A'), store: a },
    { key: 'b:0:r', region: regionOn('B'), store: b },
  ];
}

const onPage = (t: BcfTopic) => gridToPage(PLACE, [t.point![0], t.point![1]]);
const issueAt = (p: [number, number]): BcfTopic => {
  const [e, n] = pageToGrid(PLACE, p);
  return newTopic({ title: 'Pit clashes with kerb', author: 'Ana', point: [e, n, 14], camera: null, snapshot: null });
};
const markupsOf = (s: SyncSheet, t: BcfTopic) => s.store.all().filter((m) => m.bcf?.guid === t.guid);
const callout = (s: SyncSheet, t: BcfTopic) => markupsOf(s, t).find((m) => m.type === 'callout')!;

test('an issue shows as a cloud and callout on every sheet that holds its place, once', async () => {
  const [a, b] = await sheets();
  let t = syncTopic(issueAt([200, 300]), [a!, b!], 'Ana');
  for (const s of [a!, b!]) {
    const ms = markupsOf(s, t);
    assert.deepEqual(ms.map((m) => m.type).sort(), ['callout', 'cloud']);
    assert.ok(ms.every((m) => m.subject === BCF_SUBJECT && m.status === 'none'));
    assert.equal(callout(s, t).text, 'Pit clashes with kerb');
  }
  assert.equal(t.links.length, 2);
  // Syncing again changes nothing on either side.
  const again = syncTopic(t, [a!, b!], 'Ana');
  assert.equal(again, t);
  assert.equal(a!.store.all().length, 2);
  // Off the sheets: nothing drawn.
  t = syncTopic(issueAt([900, 900]), [a!, b!], 'Ana');
  assert.equal(t.links.length, 0);
});

test('a status, title or reply set on one sheet goes to the issue and on to the other sheet', async () => {
  const [a, b] = await sheets();
  let t = syncTopic(issueAt([200, 300]), [a!, b!], 'Ana');
  const c = callout(a!, t);
  a!.store.update(c.id, { status: 'completed', text: 'Pit lid too high', replies: [{ id: 'r1', author: 'Bo', text: 'Lowered 50 mm', createdAt: Date.parse('2026-11-23T03:00:00Z') }] });
  t = syncTopic(t, [a!, b!], 'Ana');
  assert.equal(t.status, 'Resolved');
  assert.equal(t.title, 'Pit lid too high');
  assert.deepEqual(t.comments.map((x) => [x.guid, x.text]), [['r1', 'Lowered 50 mm']]);
  const other = callout(b!, t);
  assert.equal(other.status, 'completed');
  assert.equal(other.text, 'Pit lid too high');
  assert.deepEqual(other.replies?.map((r) => r.text), ['Lowered 50 mm']);
  assert.ok(markupsOf(b!, t).every((m) => m.status === 'completed'));
  assert.equal(syncTopic(t, [a!, b!], 'Ana'), t);
});

test('the issue’s changes reach its markups, and a sheet’s own status for it is kept', async () => {
  const [a, b] = await sheets();
  let t = syncTopic(issueAt([200, 300]), [a!, b!], 'Ana');
  t = syncTopic({ ...t, status: 'Closed', title: 'Done' }, [a!, b!], 'Ana');
  assert.ok([a!, b!].every((s) => callout(s, t).status === 'accepted' && callout(s, t).text === 'Done'));
  a!.store.update(callout(a!, t).id, { status: 'rejected' });
  t = syncTopic(t, [a!, b!], 'Ana');
  assert.equal(t.status, 'Closed');
  assert.equal(callout(a!, t).status, 'rejected');
  assert.equal(syncTopic(t, [a!, b!], 'Ana'), t);
});

test('moving the markups on a sheet moves the issue, and its markups on the other sheet follow', async () => {
  const [a, b] = await sheets();
  let t = syncTopic(issueAt([200, 300]), [a!, b!], 'Ana');
  a!.store.batch(() => {
    for (const m of markupsOf(a!, t)) a!.store.update(m.id, { points: m.points.map(([x, y]) => [x + 40, y + 10]) });
  });
  t = syncTopic(t, [a!, b!], 'Ana');
  const [x, y] = onPage(t);
  assert.ok(Math.abs(x - 240) < 0.01 && Math.abs(y - 310) < 0.01, `${x},${y}`);
  assert.equal(t.point![2], 14);
  const cloud = markupsOf(b!, t).find((m) => m.type === 'cloud')!;
  assert.ok(Math.abs((cloud.points[0]![0] + cloud.points[1]![0]) / 2 - 240) < 0.01);
});

test('markups deleted on a sheet leave the issue, which is not drawn there again; deleting the issue takes its markups', async () => {
  const [a, b] = await sheets();
  let t = syncTopic(issueAt([200, 300]), [a!, b!], 'Ana');
  a!.store.remove(markupsOf(a!, t).map((m) => m.id));
  t = syncTopic(t, [a!, b!], 'Ana');
  assert.deepEqual(t.dismissed, ['a:0:r']);
  assert.deepEqual(t.links.map((l) => l.sheet), ['b:0:r']);
  t = syncTopic(t, [a!, b!], 'Ana');
  assert.equal(markupsOf(a!, t).length, 0);
  removeTopicMarkups(t, [a!.store, b!.store]);
  assert.equal(markupsOf(b!, t).length, 0);
});

test('markups the sync makes are not undone by Undo', async () => {
  const [a] = await sheets();
  syncTopic(issueAt([200, 300]), [a!], 'Ana');
  a!.store.undo();
  assert.equal(a!.store.all().length, 2);
});
