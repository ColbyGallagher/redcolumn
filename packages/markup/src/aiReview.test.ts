import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { MarkupStore } from './store.ts';
import { DEFAULT_STYLES, type AiOrigin, type Markup } from './model.ts';
import { planPageOps } from './pages.ts';
import { exportWithAnnotations } from './export.ts';
import { readPdfExtras } from './pdfExtras.ts';
import { aiEdits, isAiDraft, reviewedOnly, sanitizeAiOrigin, sanitizeAiReview, type AiReviewData, type CountProposal, type TakeoffProposal } from './aiReview.ts';

const ai = (extra: Partial<AiOrigin> = {}): AiOrigin => ({ source: 'Claude', at: 1, status: 'pending', original: { points: [[10, 10], [110, 10]], subject: 'Kerb' }, confidence: 0.4, sources: [{ pageIndex: 0, rect: { x: 0, y: 0, w: 50, h: 20 }, text: 'KERB TYPE 1', kind: 'legend' }], ...extra });

function length(id: string, page = 0, extra: Partial<Markup> = {}): Markup {
  return { id, type: 'length', pageIndex: page, points: [[10, 10], [110, 10]], subject: 'Kerb', style: { ...DEFAULT_STYLES.length }, status: 'none', author: 'me', createdAt: 1, modifiedAt: 1, ...extra };
}

const takeoff = (id: string, extra: Partial<TakeoffProposal> = {}): TakeoffProposal => ({ id, markupId: 'm', assemblyId: 'a', reasoning: 'why', source: 'Claude', createdAt: 1, ...extra });
const count = (id: string, page = 0): CountProposal => ({ id, subject: 'Pit', reasoning: 'the legend symbol', source: 'Claude', createdAt: 2, matches: [{ pageIndex: page, rect: { x: 10, y: 20, w: 5, h: 5 }, score: 0.9 }] });

test('sanitize: keeps good entries and drops malformed ones, confidences outside 0–1 and pages past the end', () => {
  const raw = {
    takeoff: [takeoff('t1', { confidence: 0.7 }), takeoff('t2', { confidence: 2 }), { id: 3 }],
    counts: [count('c1'), count('c2', 9), { id: 'c3', matches: 'no' }],
    rejected: [{ markup: length('r1'), by: 'Hana', at: 5 }, { markup: { id: 'x' }, by: 'Hana', at: 5 }],
  };
  const out = sanitizeAiReview(raw, 2);
  assert.deepEqual(out.takeoff.map((p) => [p.id, p.confidence]), [['t1', 0.7], ['t2', undefined]]);
  assert.deepEqual(out.counts.map((c) => [c.id, c.matches.length]), [['c1', 1], ['c2', 0]]);
  assert.deepEqual(out.rejected.map((r) => r.markup.id), ['r1']);
  assert.deepEqual(sanitizeAiReview('nonsense'), { takeoff: [], counts: [], rejected: [], columns: [], findings: [] });
});

test('a draft is left out of quantities until approved; a person’s edits show against what the AI made', () => {
  const draft = length('d', 0, { ai: ai() });
  const done = length('e', 0, { ai: ai({ status: 'approved', review: { by: 'Hana', at: 2 } }) });
  const mine = length('f');
  assert.equal(isAiDraft(draft), true);
  assert.deepEqual(reviewedOnly([draft, done, mine]).map((m) => m.id), ['e', 'f']);
  assert.deepEqual(aiEdits(draft), []);
  assert.deepEqual(aiEdits({ ...draft, points: [[10, 10], [120, 10]], subject: 'Kerb type 2', assemblyId: 'k' }), ['geometry', 'subject', 'assembly']);
  assert.equal(sanitizeAiOrigin({ status: 'maybe', original: { points: [] } }), undefined);
  assert.equal(sanitizeAiOrigin(ai())!.confidence, 0.4);
});

test('store: an AI client’s additions are not undone by the person, a person’s decisions are', async () => {
  const store = await MarkupStore.open(`ai-review-${Math.random()}`, { persist: false });
  const before = store.editCount;
  store.changeAiReview({ takeoff: [takeoff('t1')] }, true);
  assert.equal(store.aiReview().takeoff.length, 1);
  assert.ok(store.editCount > before, 'unsaved: the proposal is saved with the document');
  store.undo();
  assert.equal(store.aiReview().takeoff.length, 1, 'the AI’s proposal stays');
  store.changeAiReview({ takeoff: [{ ...takeoff('t1'), rejected: { by: 'Hana', at: 3 } }] });
  assert.ok(store.aiReview().takeoff[0]!.rejected);
  assert.equal(store.undoHistory()[0]!.label, 'Review AI takeoff');
  store.undo();
  assert.equal(store.aiReview().takeoff[0]!.rejected, undefined);
  // Each entry is its own key: two people deciding at once do not overwrite each other.
  store.changeAiReview({ counts: [count('c1')] }, true);
  store.changeAiReview({ remove: { takeoff: ['t1'] } });
  assert.deepEqual([store.aiReview().takeoff.length, store.aiReview().counts.length], [0, 1]);
  await store.destroy();
});

test('store: proposals and drafts follow pages that are deleted and turned', async () => {
  const store = await MarkupStore.open(`ai-remap-${Math.random()}`, { persist: false });
  store.add(length('d', 2, { ai: ai({ sources: [{ pageIndex: 2, rect: { x: 0, y: 0, w: 10, h: 10 } }, { pageIndex: 0 }] }) }));
  store.changeAiReview({ counts: [count('c0', 0), count('c2', 2)], rejected: [{ markup: length('r', 0, { ai: ai() }), by: 'Hana', at: 1 }] }, true);
  const sizes = [0, 1, 2].map(() => ({ width: 200, height: 100 }));
  store.remapPages(planPageOps(3, [{ type: 'delete', pages: [0] }, { type: 'rotate', pages: [1], quarterTurns: 1 }]), sizes);
  const d = store.get('d')!;
  assert.equal(d.pageIndex, 1);
  assert.deepEqual(d.ai!.sources!.map((s) => s.pageIndex), [1], 'a source on a deleted page goes');
  assert.deepEqual(d.ai!.original.points, d.points, 'what the AI drew turns with the page, so it is not taken for an edit');
  assert.deepEqual(store.aiReview().counts.map((c) => [c.id, c.matches[0]!.pageIndex]), [['c2', 1]]);
  assert.equal(store.aiReview().rejected.length, 0);
  await store.destroy();
});

test('store: inserting pages keeps proposals on the pages after them, and only changed entries are rewritten', async () => {
  const store = await MarkupStore.open(`ai-insert-${Math.random()}`, { persist: false });
  store.setPageCount(3);
  store.changeAiReview({ counts: [count('c0', 0), count('c2', 2)], rejected: [{ markup: length('r', 2, { ai: ai({ sources: [{ pageIndex: 2 }] }) }), by: 'Hana', at: 1 }] }, true);
  const writes: string[] = [];
  store.aiReviewMap.observe((e) => writes.push(...e.keysChanged));
  // Two pages go in at the start: everything moves on by two, past the old page count.
  store.remapPages(planPageOps(3, [{ type: 'insert', source: 0, at: 0 }], [2]), [0, 1, 2].map(() => ({ width: 200, height: 100 })));
  store.setPageCount(5);
  assert.deepEqual(store.aiReview().counts.map((c) => [c.id, c.matches[0]!.pageIndex]), [['c0', 2], ['c2', 4]]);
  assert.deepEqual(store.aiReview().rejected.map((r) => r.markup.pageIndex), [4]);
  // A second operation must not lose them either.
  writes.length = 0;
  store.remapPages(planPageOps(5, [{ type: 'rotate', pages: [0], quarterTurns: 1 }]), [0, 1, 2, 3, 4].map(() => ({ width: 200, height: 100 })));
  assert.equal(store.aiReview().counts.length, 2);
  assert.deepEqual(writes, [], 'nothing on the turned page, so nothing rewritten');
  await store.destroy();
});

test('sanitize: a rejected draft from a peer is checked like a markup from a file before Review Again can restore it', () => {
  const out = sanitizeAiReview({
    rejected: [
      { markup: { id: 'a', type: 'length', pageIndex: 0, points: [[0, 0], [1, 1]] }, by: 'Hana', at: 1 },
      { markup: { ...length('b'), type: 'bogus' }, by: 'Hana', at: 1 },
      { markup: { ...length('c'), points: [[0, 'x']] }, by: 'Hana', at: 1 },
      { markup: { ...length('d'), ai: { status: 'weird' } }, by: 'Hana', at: 1 },
    ],
  });
  assert.deepEqual(out.rejected.map((r) => [r.markup.id, r.markup.ai]), [['d', undefined]], 'no style, unknown type and bad points dropped; a bad ai record is removed');
});

test('PDF: drafts are saved hidden and the review list in the catalog; both come back on opening', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([400, 400]);
  const bytes = (await doc.save()).slice().buffer as ArrayBuffer;
  const review: AiReviewData = { takeoff: [takeoff('t1', { confidence: 0.8 })], counts: [count('c1')], rejected: [], columns: [], findings: [] };
  const saved = await exportWithAnnotations(bytes, [length('d', 0, { ai: ai() }), length('e', 0, { ai: ai({ status: 'approved' }) })], { aiReview: review });
  const extras = (await readPdfExtras(saved))!;
  assert.deepEqual(extras.aiReview, review);
  const flags = extras.pages[0]!.annots.map((a) => [JSON.parse(String(a!.NBData)).id, Number(a!.F) & 2]);
  assert.deepEqual(flags, [['d', 2], ['e', 0]], 'other viewers do not show a draft no one has approved');
  const store = await MarkupStore.open('ai-import', { persist: false });
  store.importAnnotations([], [], {}, { aiReview: extras.aiReview });
  assert.deepEqual(store.aiReview(), review);
  await store.destroy();
  const cleared = await exportWithAnnotations(saved.slice().buffer as ArrayBuffer, [], { aiReview: { takeoff: [], counts: [], rejected: [], columns: [], findings: [] } });
  assert.equal((await readPdfExtras(cleared))!.aiReview, undefined);
});
