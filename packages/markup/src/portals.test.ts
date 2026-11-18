import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MarkupStore } from './store.ts';
import { DEFAULT_STYLES, type Markup, type Point } from './model.ts';
import { PDFDocument, PDFHexString, PDFName } from 'pdf-lib';
import { planPageOps } from './pages.ts';
import { exportWithAnnotations } from './export.ts';
import { readPdfExtras } from './pdfExtras.ts';
import { canMirror, markupInside, planPortalSync, relinkPlan, remapPortals, sameItem, sanitizePortals, scaleMismatches, sharedPatch, type Portal } from './portals.ts';

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

// ---- Review follow-ups ---------------------------------------------------------------------

test('store: a page unlinked from the portal keeps its copy as a local markup', async () => {
  const store = await portalStore();
  store.add(rect('a', 0, 150, 150));
  store.checkpoint();
  store.setPortal({ ...PORTAL, pages: [0, 1] });
  const onThree = store.all().find((m) => m.pageIndex === 2)!;
  assert.equal(onThree.portalLink, undefined);
  store.checkpoint();
  store.remove(['a']);
  assert.deepEqual(store.all().map((m) => m.id), [onThree.id]);
  await store.destroy();
});

test('the planner leaves alone a copy on a page the portal no longer links', () => {
  const all = linkedSet();
  const narrowed: Portal = { ...PORTAL, pages: [0, 1] };
  const plan = planPortalSync({ changes: [{ was: all[0]! }], markups: [all[1]!, all[2]!], portals: [narrowed], newId: ids });
  assert.deepEqual(plan.remove, ['m1']);
  const now: Markup = { ...all[0]!, comment: 'x' };
  const edit = planPortalSync({ changes: [{ was: all[0]!, now }], markups: [now, all[1]!, all[2]!], portals: [narrowed], newId: ids });
  assert.deepEqual(edit.set.map((m) => m.id), ['m1']);
});

test('store: pasting all three copies of a mirrored item gives one new item on each page, not nine', async () => {
  const store = await portalStore();
  store.add(rect('a', 0, 150, 150));
  store.checkpoint();
  const copies = store.all().map((m) => ({ ...structuredClone(m), id: `paste-${m.pageIndex}` }));
  store.batch(() => {
    for (const c of copies) store.add(c);
  });
  assert.equal(store.all().length, 6);
  const pasted = store.all().filter((m) => m.id.startsWith('paste-'));
  assert.equal(new Set(pasted.map((m) => m.portalLink?.linkId)).size, 1);
  assert.notEqual(pasted[0]!.portalLink!.linkId, store.get('a')!.portalLink!.linkId);
  // Pasting one copy alone makes a new mirrored item: three more.
  store.checkpoint();
  store.add({ ...structuredClone(store.get('a')!), id: 'single' });
  assert.equal(store.all().length, 9);
  await store.destroy();
});

test('a hand-edited /NBPortals is bounded: pages past the end and duplicates go, oversized portals are dropped', async () => {
  const doc = await PDFDocument.create();
  for (let i = 0; i < 3; i++) doc.addPage([400, 400]);
  const huge = Array.from({ length: 5000 }, (_, i) => [i, i]);
  const bad = [
    { ...PORTAL, pages: [0, 999999, 1, 1, 2.5, -3] },
    { id: 'big', name: 'Big', points: huge, pages: [0, 1], sourcePage: 0 },
    { id: 'lonely', name: 'One page', points: SQUARE, pages: [0, 50], sourcePage: 0 },
    { id: 'many', name: 'Many', points: SQUARE, pages: Array.from({ length: 10000 }, (_, i) => i), sourcePage: 0 },
  ];
  doc.catalog.set(PDFName.of('NBPortals'), PDFHexString.fromText(JSON.stringify(bad)));
  const extras = (await readPdfExtras(await doc.save()))!;
  assert.deepEqual(extras.portals, [{ ...PORTAL, pages: [0, 1] }]);
});

test('store: links to a portal the file does not have are dropped on import', async () => {
  const store = await MarkupStore.open('portal-orphans', { persist: false });
  const stray: Markup = { ...rect('s', 0, 150, 150), portalLink: { portalId: 'gone', linkId: 'L' } };
  const kept: Markup = { ...rect('k', 1, 150, 150), portalLink: { portalId: 'p1', linkId: 'M' } };
  store.importAnnotations([stray, kept], [], {}, { portals: [PORTAL] });
  assert.equal(store.get('s')!.portalLink, undefined);
  assert.deepEqual(store.get('k')!.portalLink, { portalId: 'p1', linkId: 'M' });
  await store.destroy();
});

test('store: a page operation that leaves a portal one page drops it and unlinks its copies', async () => {
  const store = await MarkupStore.open('portal-pages', { persist: false });
  store.setPortal({ ...PORTAL, pages: [0, 1] });
  store.add(rect('a', 0, 150, 150));
  assert.equal(store.all().length, 2);
  store.remapPages(planPageOps(2, [{ type: 'delete', pages: [1] }]), [{ width: 400, height: 400 }, { width: 400, height: 400 }]);
  assert.equal(store.portals().length, 0);
  assert.equal(store.all().length, 1);
  assert.equal(store.all()[0]!.portalLink, undefined);
  await store.destroy();
});

test('store: linking another page copies the mirrored items onto it, in one undo step', async () => {
  const store = await MarkupStore.open('portal-backfill', { persist: false });
  store.setPortal({ ...PORTAL, pages: [0, 1] });
  store.checkpoint();
  store.add(rect('a', 0, 150, 150));
  store.checkpoint();
  store.setPortal({ ...PORTAL, pages: [0, 1, 2] });
  assert.deepEqual(byPage(store), [0, 1, 2]);
  assert.equal(new Set(store.all().map((m) => m.portalLink?.linkId)).size, 1);
  // The new copy follows edits like the others.
  store.checkpoint();
  store.update('a', { comment: 'all' });
  assert.equal(store.all().filter((m) => m.comment === 'all').length, 3);
  store.checkpoint();
  store.undo();
  store.undo();
  assert.deepEqual(byPage(store), [0, 1]);
  assert.deepEqual(store.portals()[0]!.pages, [0, 1]);
  await store.destroy();
});

test('store: a copy moved out of the portal unlinks and moves alone', async () => {
  const store = await portalStore();
  store.add(rect('a', 0, 150, 150));
  store.checkpoint();
  store.update('a', { points: [[290, 150], [310, 170]] });
  assert.equal(store.get('a')!.portalLink, undefined);
  const others = store.all().filter((m) => m.id !== 'a');
  assert.ok(others.every((m) => m.points[0]![0] === 150 && !!m.portalLink));
  await store.destroy();
});

test('store: linking a page that already has the item drawn by hand adopts it instead of doubling it', async () => {
  const store = await MarkupStore.open('portal-adopt', { persist: false });
  store.setPortal({ ...PORTAL, pages: [0, 1] });
  store.checkpoint();
  store.add(rect('a', 0, 150, 150));
  // Drawn by hand on page 3, a fraction of a point off.
  store.add({ ...rect('hand', 2, 150.2, 149.9), points: [[150.2, 149.9], [170.1, 170.2]] });
  // Something else on page 3 is left alone.
  store.add(rect('other', 2, 400, 400));
  store.checkpoint();
  const result = store.setPortal({ ...PORTAL, pages: [0, 1, 2] });
  assert.deepEqual(result, { copied: 0, adopted: 1, unlinked: 0 });
  assert.equal(store.all().length, 4);
  assert.equal(store.all().filter((m) => m.pageIndex === 2).length, 2);
  assert.equal(store.get('hand')!.portalLink?.linkId, store.get('a')!.portalLink?.linkId);
  assert.equal(store.get('other')!.portalLink, undefined);
  // The adopted one now follows the item.
  store.checkpoint();
  store.update('a', { comment: 'typical' });
  assert.equal(store.get('hand')!.comment, 'typical');
  await store.destroy();
});

test('relinking leaves alone copies, and hand-drawn matches, that this person may not edit', () => {
  const link = { portalId: 'p1', linkId: 'L' };
  const mine = { ...rect('m0', 0, 150, 150), portalLink: link };
  const theirs: Markup = { ...rect('t2', 2, 150, 150), portalLink: link, author: 'Someone else' };
  const narrowed = relinkPlan(PORTAL, { ...PORTAL, pages: [0, 1] }, [mine, { ...mine, id: 'm1', pageIndex: 1 }, theirs], ids, 1, (m) => m.author !== 'Someone else');
  assert.deepEqual(narrowed.set, []);
  assert.equal(narrowed.unlinked, 0);
  const hand: Markup = { ...rect('h', 2, 150, 150), author: 'Someone else' };
  const widened = relinkPlan({ ...PORTAL, pages: [0, 1] }, PORTAL, [mine, { ...mine, id: 'm1', pageIndex: 1 }, hand], ids, 1, (m) => m.author !== 'Someone else');
  assert.deepEqual([widened.adopted, widened.copied], [0, 1]);
  assert.ok(sameItem(mine, { ...mine, points: [[150.4, 150], [170, 169.6]] }));
  assert.ok(!sameItem(mine, { ...mine, subject: 'Other' }));
});

test('store: linked pages past the document end are ignored once the page count is known', async () => {
  const store = await MarkupStore.open('portal-count', { persist: false });
  store.importAnnotations([], [], {}, { pageCount: 2, portals: [{ ...PORTAL, pages: [0, 1, 7] }] });
  assert.deepEqual(store.portals()[0]!.pages, [0, 1]);
  store.setPageCount(1);
  assert.deepEqual(store.portals(), []);
  await store.destroy();
});

test('adoption needs every shared field to match, skips markups that cannot mirror, and takes the nearest match', () => {
  const link = { portalId: 'p1', linkId: 'L' };
  const item: Markup = { ...rect('m0', 0, 150, 150), assemblyId: 'slab', portalLink: link };
  const two: Markup = { ...item, id: 'm1', pageIndex: 1 };
  const widen = (local: Markup[]) => relinkPlan({ ...PORTAL, pages: [0, 1] }, PORTAL, [item, two, ...local], ids, 1);
  // Same spot, another assembly: copied, not adopted.
  const otherAssembly: Markup = { ...rect('h', 2, 150, 150), assemblyId: 'wall' };
  assert.deepEqual([widen([otherAssembly]).adopted, widen([otherAssembly]).copied], [0, 1]);
  const otherStyle: Markup = { ...rect('h', 2, 150, 150), assemblyId: 'slab', style: { ...DEFAULT_STYLES.rect, stroke: '#00ff00' } };
  assert.equal(widen([otherStyle]).adopted, 0);
  // A grouped markup is never adopted.
  assert.equal(widen([{ ...rect('g', 2, 150, 150), assemblyId: 'slab', groupId: 'G' }]).adopted, 0);
  // Two matches: the nearer one is adopted.
  const far: Markup = { ...rect('far', 2, 150.4, 150.4), assemblyId: 'slab', points: [[150.4, 150.4], [170.4, 170.4]] };
  const near: Markup = { ...rect('near', 2, 150.1, 150), assemblyId: 'slab', points: [[150.1, 150], [170.1, 170]] };
  const plan = widen([far, near]);
  assert.equal(plan.adopted, 1);
  assert.deepEqual(plan.set.map((m) => m.id), ['near']);
});
