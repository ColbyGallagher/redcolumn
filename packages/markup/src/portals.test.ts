import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MarkupStore } from './store.ts';
import { DEFAULT_STYLES, type Markup, type Point } from './model.ts';
import { PDFDocument } from 'pdf-lib';
import { exportWithAnnotations } from './export.ts';
import { readPdfExtras } from './pdfExtras.ts';
import { canMirror, markupInside, planPortalSync, remapPortals, sanitizePortals, scaleMismatches, sharedPatch, type Portal } from './portals.ts';

const SQUARE: Point[] = [[100, 100], [300, 100], [300, 300], [100, 300]];
const PORTAL: Portal = { id: 'p1', name: 'Typical floor', points: SQUARE, pages: [0, 1, 2], sourcePage: 0 };

function rect(id: string, page: number, x: number, y: number, w = 20, h = 20): Markup {
  return { id, type: 'rect', pageIndex: page, points: [[x, y], [x + w, y + h]], style: { ...DEFAULT_STYLES.rect }, status: 'none', author: '', createdAt: 1, modifiedAt: 1 };
}

function area(id: string, page: number, pts: Point[]): Markup {
  return { id, type: 'area', pageIndex: page, points: pts, style: { ...DEFAULT_STYLES.area }, status: 'none', author: '', createdAt: 1, modifiedAt: 1 };
}

let n = 0;
const ids = () => `n${++n}`;

// ---- Geometry -----------------------------------------------------------------------------

test('a markup wholly inside the outline is inside; one crossing its edge is not', () => {
  assert.equal(markupInside(rect('a', 0, 150, 150), SQUARE), true);
  assert.equal(markupInside(rect('a', 0, 290, 150), SQUARE), false);
  assert.equal(markupInside(rect('a', 0, 400, 400), SQUARE), false);
});

test('a path whose corners are inside a concave outline but whose edge leaves it is not inside', () => {
  // An L-shaped outline: the notch at the top right is outside.
  const ell: Point[] = [[0, 0], [100, 0], [100, 100], [200, 100], [200, 200], [0, 200]];
  assert.equal(markupInside(area('a', 0, [[50, 50], [150, 150], [50, 150]]), ell), true);
  // Both ends inside, but the line runs through the notch.
  const line: Markup = { ...area('b', 0, [[50, 50], [190, 150]]), type: 'line' };
  assert.equal(markupInside({ ...line, points: [[90, 10], [190, 110]] }, ell), false);
});

test('connectors, grouped markups and signatures are never mirrored', () => {
  assert.equal(canMirror(rect('a', 0, 150, 150)), true);
  assert.equal(canMirror({ ...rect('a', 0, 150, 150), type: 'connector' }), false);
  assert.equal(canMirror({ ...rect('a', 0, 150, 150), groupId: 'g' }), false);
});

// ---- Planning -----------------------------------------------------------------------------

test('a markup added inside a portal is copied to every other linked page with a shared link', () => {
  const m = rect('a', 1, 150, 150);
  const plan = planPortalSync({ changes: [{ now: m }], markups: [m], portals: [PORTAL], newId: ids, at: 5 });
  assert.equal(plan.remove.length, 0);
  const pages = plan.set.map((x) => x.pageIndex).sort();
  assert.deepEqual(pages, [0, 1, 2]);
  const links = new Set(plan.set.map((x) => x.portalLink?.linkId));
  assert.equal(links.size, 1);
  assert.ok(plan.set.every((x) => x.portalLink?.portalId === 'p1'));
  assert.ok(plan.set.every((x) => JSON.stringify(x.points) === JSON.stringify(m.points)));
  assert.equal(plan.set.find((x) => x.pageIndex === 1)!.id, 'a');
});

test('a markup crossing the edge, or on a page the portal does not link, stays local', () => {
  const crossing = rect('a', 0, 290, 150);
  assert.deepEqual(planPortalSync({ changes: [{ now: crossing }], markups: [crossing], portals: [PORTAL], newId: ids }).set, []);
  const elsewhere = rect('b', 5, 150, 150);
  assert.deepEqual(planPortalSync({ changes: [{ now: elsewhere }], markups: [elsewhere], portals: [PORTAL], newId: ids }).set, []);
});

test('a pasted copy of a linked markup starts a link of its own', () => {
  const pasted: Markup = { ...rect('c', 0, 150, 150), portalLink: { portalId: 'p1', linkId: 'old' } };
  const plan = planPortalSync({ changes: [{ now: pasted }], markups: [pasted], portals: [PORTAL], newId: ids });
  assert.equal(plan.set.length, 3);
  assert.ok(plan.set.every((x) => x.portalLink!.linkId !== 'old'));
  // Pasted outside the portal: an ordinary markup.
  const outside: Markup = { ...rect('d', 0, 500, 500), portalLink: { portalId: 'p1', linkId: 'old' } };
  const [only] = planPortalSync({ changes: [{ now: outside }], markups: [outside], portals: [PORTAL], newId: ids }).set;
  assert.equal(only!.portalLink, undefined);
});

function linkedSet(): Markup[] {
  const link = { portalId: 'p1', linkId: 'L' };
  return [0, 1, 2].map((p) => ({ ...rect(`m${p}`, p, 150, 150), portalLink: link, status: p === 2 ? 'accepted' : 'none' }) as Markup);
}

test('moving, restyling or changing the assembly of one copy changes the others; their own status stays', () => {
  const all = linkedSet();
  const was = all[1]!;
  const now: Markup = { ...was, points: [[160, 160], [180, 180]], style: { ...was.style, stroke: '#ff0000' }, assemblyId: 'slab', layer: 'Takeoff', status: 'rejected' };
  const plan = planPortalSync({ changes: [{ was, now }], markups: [all[0]!, now, all[2]!], portals: [PORTAL], newId: ids, at: 9 });
  assert.deepEqual(plan.set.map((m) => m.id).sort(), ['m0', 'm2']);
  for (const m of plan.set) {
    assert.deepEqual(m.points, [[160, 160], [180, 180]]);
    assert.equal(m.style.stroke, '#ff0000');
    assert.equal(m.assemblyId, 'slab');
    assert.equal(m.layer, 'Takeoff');
    assert.equal(m.modifiedAt, 9);
  }
  assert.equal(plan.set.find((m) => m.id === 'm2')!.status, 'accepted');
  assert.equal(plan.set.find((m) => m.id === 'm0')!.status, 'none');
});

test('a field removed from one copy is removed from the others', () => {
  const all = linkedSet().map((m) => ({ ...m, subject: 'Slab' }));
  const was = all[0]!;
  const { subject: _s, ...now } = was;
  const plan = planPortalSync({ changes: [{ was, now: now as Markup }], markups: [now as Markup, all[1]!, all[2]!], portals: [PORTAL], newId: ids });
  assert.equal(plan.set.length, 2);
  assert.ok(plan.set.every((m) => !('subject' in m)));
});

test('a review-only edit (status, replies) changes nothing elsewhere', () => {
  const all = linkedSet();
  const was = all[0]!;
  const now: Markup = { ...was, status: 'accepted', replies: [{ id: 'r', text: 'ok', author: 'A', createdAt: 1 } as never] };
  assert.equal(sharedPatch(was, now), null);
  assert.deepEqual(planPortalSync({ changes: [{ was, now }], markups: [now, all[1]!, all[2]!], portals: [PORTAL], newId: ids }).set, []);
});

test('deleting one copy deletes the others; deleting a broken-off one does not', () => {
  const all = linkedSet();
  const plan = planPortalSync({ changes: [{ was: all[0]! }], markups: [all[1]!, all[2]!], portals: [PORTAL], newId: ids });
  assert.deepEqual(plan.remove.sort(), ['m1', 'm2']);
  const local = rect('x', 0, 150, 150);
  assert.deepEqual(planPortalSync({ changes: [{ was: local }], markups: all, portals: [PORTAL], newId: ids }).remove, []);
});

test('breaking a link, or moving a copy to another page, leaves the others alone', () => {
  const all = linkedSet();
  const was = all[0]!;
  const { portalLink: _l, ...broken } = was;
  assert.deepEqual(planPortalSync({ changes: [{ was, now: broken as Markup }], markups: [broken as Markup, all[1]!, all[2]!], portals: [PORTAL], newId: ids }), { set: [], remove: [] });
  const moved: Markup = { ...was, pageIndex: 7 };
  const plan = planPortalSync({ changes: [{ was, now: moved }], markups: [moved, all[1]!, all[2]!], portals: [PORTAL], newId: ids });
  assert.equal(plan.set.length, 1);
  assert.equal(plan.set[0]!.portalLink, undefined);
});

test('when several copies change in one edit, none is overwritten by another', () => {
  const all = linkedSet();
  const a: Markup = { ...all[0]!, comment: 'one' };
  const b: Markup = { ...all[1]!, comment: 'two' };
  const plan = planPortalSync({ changes: [{ was: all[0]!, now: a }, { was: all[1]!, now: b }], markups: [a, b, all[2]!], portals: [PORTAL], newId: ids });
  assert.deepEqual(plan.set.map((m) => m.id), ['m2']);
});

// ---- Portals ------------------------------------------------------------------------------

test('scale mismatches name the linked pages whose scale differs from the portal page', () => {
  const scale = (p: number) => (p === 2 ? '1:50' : '1:100');
  assert.deepEqual(scaleMismatches(PORTAL, scale), [2]);
});

test('page operations move linked pages and drop a portal left with one page', () => {
  assert.deepEqual(remapPortals([PORTAL], (p) => (p === 0 ? null : p + 3)), [{ ...PORTAL, pages: [4, 5], sourcePage: 4 }]);
  assert.deepEqual(remapPortals([PORTAL], (p) => (p === 1 ? 0 : null)), []);
});

test('portals read from a file drop malformed entries', () => {
  const out = sanitizePortals([PORTAL, { id: 'p1' }, { id: 'bad', points: [[0, 0]], pages: [0, 1] }, null, { id: 'p2', points: SQUARE, pages: [3, 1, 1, -1], sourcePage: 9 }]);
  assert.deepEqual(out.map((p) => p.id), ['p1', 'p2']);
  assert.deepEqual(out[1]!.pages, [1, 3]);
  assert.equal(out[1]!.sourcePage, 1);
  assert.equal(out[1]!.name, 'Portal');
  assert.deepEqual(sanitizePortals('nope'), []);
});

// ---- In the store -------------------------------------------------------------------------

async function portalStore() {
  const store = await MarkupStore.open('portal-test', { persist: false });
  store.setPortal(PORTAL);
  store.checkpoint();
  return store;
}

const byPage = (store: MarkupStore) => store.all().map((m) => m.pageIndex).sort();

test('store: drawing inside a portal mirrors it, numbered, and undo takes every copy back in one step', async () => {
  const store = await portalStore();
  store.add(rect('a', 0, 150, 150));
  assert.deepEqual(byPage(store), [0, 1, 2]);
  assert.equal(new Set(store.all().map((m) => m.seq)).size, 3);
  assert.equal(new Set(store.all().map((m) => m.portalLink?.linkId)).size, 1);
  store.undo();
  assert.equal(store.all().length, 0);
  store.redo();
  assert.deepEqual(byPage(store), [0, 1, 2]);
  // The portal itself is still there: the markup's step did not take it.
  assert.equal(store.portals().length, 1);
  await store.destroy();
});

test('store: moving a copy moves them all, and one undo puts them all back', async () => {
  const store = await portalStore();
  store.add(rect('a', 0, 150, 150));
  store.checkpoint();
  const copy = store.all().find((m) => m.pageIndex === 2)!;
  store.update(copy.id, { points: [[200, 200], [220, 220]] });
  assert.ok(store.all().every((m) => m.points[0]![0] === 200));
  store.checkpoint();
  store.undo();
  assert.ok(store.all().every((m) => m.points[0]![0] === 150));
  await store.destroy();
});

test('store: deleting one copy deletes the rest, undone together', async () => {
  const store = await portalStore();
  store.add(rect('a', 0, 150, 150));
  store.checkpoint();
  store.remove([store.all().find((m) => m.pageIndex === 1)!.id]);
  assert.equal(store.all().length, 0);
  store.undo();
  assert.equal(store.all().length, 3);
  await store.destroy();
});

test('store: Break Link makes one copy local; the others still follow each other', async () => {
  const store = await portalStore();
  store.add(rect('a', 0, 150, 150));
  store.checkpoint();
  const mine = store.all().find((m) => m.pageIndex === 1)!;
  store.breakPortalLinks([mine.id]);
  assert.equal(store.get(mine.id)!.portalLink, undefined);
  store.checkpoint();
  store.update(mine.id, { comment: 'only here' });
  assert.equal(store.all().filter((m) => m.comment === 'only here').length, 1);
  store.checkpoint();
  store.update('a', { comment: 'typical' });
  assert.deepEqual(store.all().filter((m) => m.comment === 'typical').map((m) => m.pageIndex).sort(), [0, 2]);
  await store.destroy();
});

test('store: removing a portal leaves its copies as ordinary markups', async () => {
  const store = await portalStore();
  store.add(rect('a', 0, 150, 150));
  store.checkpoint();
  store.removePortal('p1');
  assert.equal(store.portals().length, 0);
  assert.equal(store.all().length, 3);
  assert.ok(store.all().every((m) => !m.portalLink));
  store.update('a', { comment: 'x' });
  assert.equal(store.all().filter((m) => m.comment === 'x').length, 1);
  await store.destroy();
});

test('store: a markup drawn across the portal edge stays on its own page', async () => {
  const store = await portalStore();
  store.add(rect('a', 0, 290, 150));
  assert.equal(store.all().length, 1);
  assert.equal(store.get('a')!.portalLink, undefined);
  await store.destroy();
});

test('store: a remote change to a copy is not synced again here (its sender did that)', async () => {
  const store = await portalStore();
  store.add(rect('a', 0, 150, 150));
  const copy = store.all().find((m) => m.pageIndex === 1)!;
  store.doc.transact(() => store.map.set(copy.id, { ...copy, comment: 'from a peer' }), 'remote');
  assert.equal(store.all().filter((m) => m.comment === 'from a peer').length, 1);
  await store.destroy();
});

// ---- Saved in the PDF ---------------------------------------------------------------------

test('portals are saved in the catalog, and each copy is an ordinary annotation on its page', async () => {
  const doc = await PDFDocument.create();
  for (let i = 0; i < 3; i++) doc.addPage([400, 400]);
  const bytes = (await doc.save()).slice().buffer as ArrayBuffer;
  const saved = await exportWithAnnotations(bytes, linkedSet(), { portals: [PORTAL] });
  const extras = (await readPdfExtras(saved))!;
  assert.deepEqual(extras.portals, [PORTAL]);
  for (const page of extras.pages) {
    const ours = page.annots.filter((a) => typeof a?.NBData === 'string');
    assert.equal(ours.length, 1);
    const data = JSON.parse(String(ours[0]!.NBData)) as Markup;
    assert.deepEqual(data.portalLink, { portalId: 'p1', linkId: 'L' });
  }
  const cleared = await exportWithAnnotations(saved.slice().buffer as ArrayBuffer, [], { portals: [] });
  assert.equal((await readPdfExtras(cleared))!.portals, undefined);
  // Opening the file brings the portals back into a document that has none.
  const store = await MarkupStore.open('portal-import', { persist: false });
  store.importAnnotations([], [], {}, { portals: extras.portals });
  assert.deepEqual(store.portals(), [PORTAL]);
  await store.destroy();
});
