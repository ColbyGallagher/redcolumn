import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Markup, MarkupDocument, MarkupType, Point } from '@nb/markup';
import { PROTOCOL_VERSION, type Actor as OpsActor, type Operation } from '@nb/ops';
import { SyncDocument, type SyncDocumentOptions } from './document.ts';
import { FakeSyncServer } from './inProcess.ts';
import { MemorySyncPersistence } from './persistence.ts';
import type { SyncFacet } from './types.ts';

const STYLE = { stroke: '#d92d20', fill: null, width: 2, opacity: 1 };
const PAGES = ['page-a101', 'page-a102', 'page-a103'] as const;

const ANN: OpsActor = { userId: 'ann', partyId: 'party-north', groupId: null };
const BEN: OpsActor = { userId: 'ben', partyId: 'party-north', groupId: null };

function makeMarkup(id: string, overrides: Partial<Markup> = {}): Markup {
  return {
    id,
    type: 'rect',
    pageIndex: 0,
    points: [[10, 20], [110, 80]],
    style: { ...STYLE },
    status: 'none',
    author: 'Ann',
    createdAt: 100,
    modifiedAt: 100,
    ...overrides,
  };
}

function makeShape(id: string, type: MarkupType, points: Point[], extra: Partial<Markup> = {}): Markup {
  return makeMarkup(id, { type, points, ...extra });
}

async function openClient(
  server: FakeSyncServer,
  actor: OpsActor,
  options: Partial<SyncDocumentOptions> & { autoConnect?: boolean; name?: string } = {},
) {
  let idSeq = 0;
  let now = 5000;
  const transport = server.createTransport(actor, options.laneId ?? 'lane-1');
  const doc = await SyncDocument.open({
    streamId: 'doc-1',
    scopeId: 'review-1',
    revisionId: 'rev-1',
    pages: PAGES,
    actor,
    context: { actor: { id: actor.userId, name: options.name ?? actor.userId } },
    transport: options.transport ?? transport,
    persistence: options.persistence ?? false,
    clock: () => ++now,
    newId: () => `${actor.userId}-id-${++idSeq}`,
    ...options,
  });
  if (options.autoConnect !== false) await doc.connect();
  return { doc, transport };
}

test('SyncDocument satisfies MarkupDocument and SyncFacet', async () => {
  const server = new FakeSyncServer();
  const { doc } = await openClient(server, ANN);
  const asMarkupDoc: MarkupDocument = doc;
  const asSyncFacet: SyncFacet = doc;
  assert.equal(asMarkupDoc.key, 'doc-1:rev-1');
  assert.equal(asSyncFacet.sync.connection, 'connected');
  assert.equal(asSyncFacet.sync.pendingCount, 0);
  assert.deepEqual(asSyncFacet.sync.inbox, []);
  await doc.destroy();
});

test('two SyncDocuments on one fake server converge across add, update, setField, batch and remove', async () => {
  const server = new FakeSyncServer();
  const { doc: a } = await openClient(server, ANN, { name: 'Ann' });
  const { doc: b } = await openClient(server, BEN, { name: 'Ben' });

  a.add(makeMarkup('m1', { text: 'Initial note', pageIndex: 1 }));
  assert.equal(a.sync.pendingCount, 0);
  assert.equal(b.get('m1')?.text, 'Initial note');
  assert.equal(b.get('m1')?.pageIndex, 1);
  assert.equal(b.forPage(1).length, 1);
  assert.equal(b.forPage(0).length, 0);
  // Boundary mapping stored the page ID rather than pageIndex on the server.
  const placement = Object.values(server.state.placements)[0]!;
  assert.equal(placement.pageId, 'page-a102');

  b.setField(['m1'], 'trade', 'Electrical');
  assert.equal(a.get('m1')?.fields?.trade, 'Electrical');

  a.batch(() => {
    a.add(makeMarkup('m2', { text: 'Box two' }));
    a.update('m1', { points: [[20, 30], [120, 90]] });
  });
  assert.deepEqual(b.get('m1')?.points, [[20, 30], [120, 90]]);
  assert.equal(b.get('m2')?.text, 'Box two');

  b.remove(['m2']);
  assert.equal(a.get('m2'), undefined);
  assert.deepEqual(
    a.all().map((m) => m.id),
    b.all().map((m) => m.id),
  );
  assert.deepEqual(a.confirmedState(), b.confirmedState());

  await Promise.all([a.destroy(), b.destroy()]);
});

test('concurrent edits to different field groups of one markup both survive', async () => {
  const server = new FakeSyncServer();
  const { doc: a } = await openClient(server, ANN);
  const { doc: b } = await openClient(server, BEN);

  a.add(makeMarkup('m1', { text: 'Original', comment: 'First' }));
  assert.equal(b.get('m1')?.text, 'Original');

  // Disconnect both so their edits are strictly concurrent from the same base version.
  await a.disconnect();
  await b.disconnect();

  a.update('m1', { text: 'Updated text' });
  a.setField(['m1'], 'discipline', 'Structural');
  b.update('m1', { style: { ...STYLE, stroke: '#0055ff' }, points: [[50, 50], [150, 150]] });
  b.setField(['m1'], 'priority', 'High');

  assert.equal(a.sync.pendingCount, 2);
  assert.equal(b.sync.pendingCount, 3); // style patch + geometry patch + field patch

  await a.connect();
  await b.connect();

  assert.equal(a.sync.pendingCount, 0);
  assert.equal(b.sync.pendingCount, 0);
  assert.equal(a.sync.inbox.length, 0);
  assert.equal(b.sync.inbox.length, 0);

  for (const doc of [a, b]) {
    const m = doc.get('m1')!;
    assert.equal(m.text, 'Updated text');
    assert.equal(m.style.stroke, '#0055ff');
    assert.deepEqual(m.points, [[50, 50], [150, 150]]);
    assert.deepEqual(m.fields, { discipline: 'Structural', priority: 'High' });
  }

  await Promise.all([a.destroy(), b.destroy()]);
});

test('concurrent edits to the same field group reject the later one to the inbox, supporting copy, retry and discard', async () => {
  const server = new FakeSyncServer();
  const { doc: a } = await openClient(server, ANN);
  const { doc: b } = await openClient(server, BEN);

  a.add(makeMarkup('m1', { text: 'Shared' }));

  await a.disconnect();
  await b.disconnect();

  a.update('m1', { text: 'Ann version' });
  b.update('m1', { text: 'Ben version' });

  // Ann reconnects first: her edit wins.
  await a.connect();
  assert.equal(a.sync.inbox.length, 0);
  assert.equal(server.state.markups.m1!.content.text, 'Ann version');

  // Ben reconnects second: his edit conflicts on group `text` and moves to his inbox.
  await b.connect();
  assert.equal(b.sync.pendingCount, 0);
  assert.equal(b.sync.inbox.length, 1);
  const entry = b.sync.inbox[0]!;
  assert.equal(entry.reason.code, 'conflict');
  assert.equal(b.get('m1')?.text, 'Ann version');

  // Copy returns an isolated clone of the rejected op.
  const copied = b.sync.copyInbox(entry.id);
  assert.ok(copied);
  assert.equal(copied.length, 1);
  assert.equal(copied[0]!.type, 'markup.patch');

  // Retry as new rebases onto Ann's version and succeeds.
  assert.equal(b.sync.retryInboxAsNew(entry.id), true);
  assert.equal(b.sync.inbox.length, 0);
  assert.equal(b.get('m1')?.text, 'Ben version');
  assert.equal(a.get('m1')?.text, 'Ben version');

  // Test discard on a second conflict.
  await b.disconnect();
  a.update('m1', { text: 'Ann final' });
  b.update('m1', { text: 'Ben discarded' });
  await b.connect();
  assert.equal(b.sync.inbox.length, 1);
  b.sync.discardInbox(b.sync.inbox[0]!.id);
  assert.equal(b.sync.inbox.length, 0);

  await Promise.all([a.destroy(), b.destroy()]);
});

test('a rejected op cascades dependent pending ops to the inbox', async () => {
  const server = new FakeSyncServer();
  const { doc: a } = await openClient(server, ANN);
  const { doc: b } = await openClient(server, BEN);

  a.add(makeMarkup('m1', { text: 'v0' }));
  await b.disconnect();

  // Ben makes two sequential offline edits to `text`: op2 chains on op1's opId.
  b.update('m1', { text: 'ben-1' });
  b.update('m1', { text: 'ben-2' });
  assert.equal(b.sync.pendingCount, 2);

  // Meanwhile Ann edits `text` on the server.
  a.update('m1', { text: 'ann-1' });

  // When Ben reconnects, op1 conflicts and op2 is rejected as a dependent.
  await b.connect();
  assert.equal(b.sync.pendingCount, 0);
  assert.equal(b.sync.inbox.length, 2);
  assert.equal(b.sync.inbox[0]!.reason.code, 'conflict');
  assert.equal(b.sync.inbox[1]!.reason.code, 'dependency_rejected');
  assert.equal(b.get('m1')?.text, 'ann-1');

  await Promise.all([a.destroy(), b.destroy()]);
});

test('offline edits queue, survive restart from persistence, and flush on reconnect', async () => {
  const server = new FakeSyncServer();
  const persistence = new MemorySyncPersistence();

  const { doc: peer } = await openClient(server, BEN);
  const { doc: a1 } = await openClient(server, ANN, { persistence, key: 'ann-doc' });

  a1.add(makeMarkup('m1', { text: 'Synced' }));
  await a1.whenPersisted();
  await a1.disconnect();

  // Make offline edits and shut down the client (simulating app restart).
  a1.update('m1', { text: 'Edited offline' });
  a1.add(makeMarkup('m2', { text: 'Created offline' }));
  assert.equal(a1.sync.pendingCount, 3); // 1 patch + 2 ops for add (markup.create + placement.create)
  await a1.whenPersisted();
  await a1.destroy();

  // Peer does not have the offline edits yet.
  assert.equal(peer.get('m1')?.text, 'Synced');
  assert.equal(peer.get('m2'), undefined);

  // Reopen Ann's document from persisted storage without connecting yet: optimistic view is restored.
  const { doc: a2 } = await openClient(server, ANN, { persistence, key: 'ann-doc', autoConnect: false });
  assert.equal(a2.sync.pendingCount, 3);
  assert.equal(a2.get('m1')?.text, 'Edited offline');
  assert.equal(a2.get('m2')?.text, 'Created offline');

  // Reconnect: pending ops flush in order and peer converges.
  await a2.connect();
  assert.equal(a2.sync.pendingCount, 0);
  assert.equal(peer.get('m1')?.text, 'Edited offline');
  assert.equal(peer.get('m2')?.text, 'Created offline');

  await Promise.all([a2.destroy(), peer.destroy()]);
});

test('lost ack + reconnect resend and duplicate delivery never double-apply', async () => {
  const server = new FakeSyncServer({ echoToSender: true });
  const { doc: a, transport: ta } = await openClient(server, ANN);
  const { doc: b, transport: tb } = await openClient(server, BEN);

  a.add(makeMarkup('m1', { text: 'Start' }));
  const revAfterAdd = server.state.markups.m1!.rev;

  // Drop the ack for Ann's next edit (and disable echo for a pure lost-ack test on a second server).
  const server2 = new FakeSyncServer({ echoToSender: false });
  const { doc: c, transport: tc } = await openClient(server2, ANN);
  c.add(makeMarkup('m1', { text: 'Start' }));
  const baseRev = server2.state.markups.m1!.rev;

  tc.dropNextAck(1);
  c.update('m1', { text: 'Once' });
  // Server already applied it, but client did not get the ack so it stays pending.
  assert.equal(server2.state.markups.m1!.content.text, 'Once');
  assert.equal(server2.state.markups.m1!.rev, baseRev + 1);
  assert.equal(c.sync.pendingCount, 1);

  // Reconnect: catch-up / idempotent resend clears pending without bumping rev again.
  await c.disconnect();
  await c.connect();
  assert.equal(c.sync.pendingCount, 0);
  assert.equal(server2.state.markups.m1!.rev, baseRev + 1);
  assert.equal(c.confirmedState().markups.m1!.rev, baseRev + 1);

  // Duplicate delivery on peer + echoToSender on server1 never double-applies.
  tb.duplicateNextMessage(2);
  ta.duplicateNextMessage(2);
  a.update('m1', { text: 'Twice delivered' });
  assert.equal(server.state.markups.m1!.rev, revAfterAdd + 1);
  assert.equal(a.confirmedState().markups.m1!.rev, revAfterAdd + 1);
  assert.equal(b.confirmedState().markups.m1!.rev, revAfterAdd + 1);
  assert.equal(b.get('m1')?.text, 'Twice delivered');

  await Promise.all([a.destroy(), b.destroy(), c.destroy()]);
});

test('reusing an opId with altered payload is refused by the server', async () => {
  const server = new FakeSyncServer();
  const { doc: a, transport: ta } = await openClient(server, ANN);

  const op1: Operation = {
    opId: 'fixed-op-1',
    schemaVersion: PROTOCOL_VERSION,
    streamId: 'doc-1',
    type: 'markup.create',
    entityId: 'm-fixed',
    payload: { scopeId: 'review-1', type: 'rect', content: { style: STYLE, text: 'first' } },
  };
  assert.equal(a.submitOps([op1]), true);
  assert.equal(server.state.markups['m-fixed']?.content.text, 'first');

  const messages: unknown[] = [];
  ta.onMessage((m) => messages.push(m));
  ta.send([
    {
      ...op1,
      payload: { scopeId: 'review-1', type: 'rect', content: { style: STYLE, text: 'tampered' } },
    },
  ]);
  const last = messages[messages.length - 1] as { type: string; reason?: { code: string } };
  assert.equal(last.type, 'reject');
  assert.equal(last.reason?.code, 'op_id_reused');

  await a.destroy();
});

test('undo succeeds after another user edits a different group, and returns changed when the same group changed', async () => {
  const server = new FakeSyncServer();
  const { doc: a } = await openClient(server, ANN);
  const { doc: b } = await openClient(server, BEN);

  a.add(makeMarkup('m1', { text: 'v0' }));
  a.update('m1', { text: 'v1' });

  // Ben edits a DIFFERENT group (`style`): Ann's undo of `text` still succeeds.
  b.update('m1', { style: { ...STYLE, stroke: '#16a34a' } });
  const r1 = await a.undo();
  assert.deepEqual(r1, { ok: true });
  assert.equal(a.get('m1')?.text, 'v0');
  assert.equal(a.get('m1')?.style.stroke, '#16a34a');
  assert.equal(b.get('m1')?.text, 'v0');

  // Redo restores v1, then Ben edits `text` (SAME group): Ann's undo must return `{ ok: false, reason: 'changed' }`.
  assert.deepEqual(await a.redo(), { ok: true });
  assert.equal(a.get('m1')?.text, 'v1');

  b.update('m1', { text: 'ben-took-over' });
  const r2 = await a.undo();
  assert.deepEqual(r2, { ok: false, reason: 'changed' });
  assert.equal(a.get('m1')?.text, 'ben-took-over');
  assert.equal(a.sync.inbox.length, 0);

  await Promise.all([a.destroy(), b.destroy()]);
});

test('undo of a batch is all or nothing', async () => {
  const server = new FakeSyncServer();
  const { doc: a } = await openClient(server, ANN);
  const { doc: b } = await openClient(server, BEN);

  a.add(makeMarkup('m1', { text: 'a0' }));
  a.add(makeMarkup('m2', { text: 'b0' }));

  a.batch(() => {
    a.update('m1', { text: 'a1' });
    a.update('m2', { text: 'b1' });
  });

  // Ben edits only m2's text: undoing Ann's batch must fail completely and leave m1 untouched.
  b.update('m2', { text: 'b-conflict' });
  const res = await a.undo();
  assert.deepEqual(res, { ok: false, reason: 'changed' });
  assert.equal(a.get('m1')?.text, 'a1');
  assert.equal(a.get('m2')?.text, 'b-conflict');

  await Promise.all([a.destroy(), b.destroy()]);
});

test('undo of remove restores the markup; undo of add deletes it; chained undos and offline/forbidden work', async () => {
  const server = new FakeSyncServer();
  const { doc: a } = await openClient(server, ANN);
  const { doc: b } = await openClient(server, BEN);

  assert.deepEqual(await a.undo(), { ok: false, reason: 'nothing' });

  a.add(makeMarkup('m1', { text: 'start' }));
  a.update('m1', { text: 'step1' });
  a.update('m1', { text: 'step2' });
  assert.equal(a.undoHistory().length, 3);

  // Offline undo returns offline and preserves the undo stack.
  await a.disconnect();
  assert.deepEqual(await a.undo(), { ok: false, reason: 'offline' });
  assert.equal(a.undoHistory().length, 3);
  await a.connect();

  // Consecutive undos chain all the way back through step2 -> step1 -> start -> deleted.
  assert.deepEqual(await a.undo(), { ok: true });
  assert.equal(a.get('m1')?.text, 'step1');
  assert.deepEqual(await a.undo(), { ok: true });
  assert.equal(a.get('m1')?.text, 'start');
  assert.deepEqual(await a.undo(), { ok: true });
  assert.equal(a.get('m1'), undefined);
  assert.equal(b.get('m1'), undefined);

  // Redo restores the markup.
  assert.deepEqual(await a.redo(), { ok: true });
  assert.equal(a.get('m1')?.text, 'start');

  // Remove and undo (sends markup.restore + placement.restore).
  a.remove(['m1']);
  assert.equal(a.get('m1'), undefined);
  assert.equal(b.get('m1'), undefined);
  assert.deepEqual(await a.undo(), { ok: true });
  assert.equal(a.get('m1')?.text, 'start');
  assert.equal(b.get('m1')?.text, 'start');

  // Forbidden undo when server denies permission.
  a.update('m1', { text: 'locked-later' });
  server.setAuthorize(() => false);
  assert.deepEqual(await a.undo(), { ok: false, reason: 'forbidden' });
  assert.equal(a.get('m1')?.text, 'locked-later');

  // Forbidden undo when readOnly.
  server.setAuthorize(undefined);
  a.setReadOnly(true);
  assert.deepEqual(await a.undo(), { ok: false, reason: 'forbidden' });

  await Promise.all([a.destroy(), b.destroy()]);
});

test('pure planners run inside SyncDocument: connector following, span shifting and cross-page moves', async () => {
  const server = new FakeSyncServer();
  const { doc: a } = await openClient(server, ANN);
  const { doc: b } = await openClient(server, BEN);

  a.add(makeShape('s1', 'flowShape', [[0, 0], [100, 50]], { flowShape: 'process' }));
  a.add(makeShape('s2', 'flowShape', [[0, 150], [100, 200]], { flowShape: 'process' }));
  a.add(makeShape('c1', 'connector', [[0, 0], [1, 1]], { connect: { from: { id: 's1' }, to: { id: 's2' } } }));

  // Connector was routed on add.
  assert.deepEqual(b.get('c1')?.points, [[50, 50], [50, 150]]);

  // Moving s2 re-routes c1 atomically in the same edit and replicates to Ben.
  a.update('s2', { points: [[0, 260], [100, 310]] });
  assert.deepEqual(b.get('c1')?.points, [[50, 50], [50, 260]]);

  // Styled spans shift when text changes without an explicit spans patch.
  a.add(makeMarkup('t1', { text: 'Hello world', spans: [{ start: 6, end: 11, style: { bold: true } }] }));
  a.update('t1', { text: 'Hi world' });
  assert.deepEqual(b.get('t1')?.spans, [{ start: 3, end: 8, style: { bold: true } }]);

  // Moving a markup to another page replaces its placement cleanly.
  a.update('t1', { pageIndex: 2 });
  assert.equal(b.get('t1')?.pageIndex, 2);
  assert.equal(b.forPage(2).some((m) => m.id === 't1'), true);

  await Promise.all([a.destroy(), b.destroy()]);
});

test('access revocation clears cached state and preserves pending work in the inbox', async () => {
  const server = new FakeSyncServer();
  const persistence = new MemorySyncPersistence();
  const { doc: a } = await openClient(server, ANN, { persistence, key: 'ann-revoked' });

  a.add(makeMarkup('m1', { text: 'Confirmed' }));
  await a.disconnect();

  // Unsynced work made offline before access is removed.
  a.update('m1', { text: 'Unsynced draft' });
  assert.equal(a.sync.pendingCount, 1);

  server.revokeAccess(ANN.userId, 'Removed from project');
  await a.connect();

  assert.equal(a.sync.connection, 'revoked');
  assert.equal(a.readOnly, true);
  assert.equal(a.all().length, 0, 'cached markups must be cleared on revocation');
  assert.equal(a.sync.pendingCount, 0);
  assert.equal(a.sync.inbox.length, 1, 'unsynced work stays in the inbox to export');
  assert.equal(a.sync.inbox[0]!.reason.code, 'forbidden');

  await a.whenPersisted();
  const saved = await persistence.load('ann-revoked');
  assert.equal(Object.keys(saved?.confirmed.markups ?? {}).length, 0);
  assert.equal(saved?.inbox.length, 1);

  await a.destroy();
});

test('old client protocol keeps pending queue intact and reports update_required', async () => {
  const server = new FakeSyncServer({ protocol: { min: 2, max: 3 } });
  const { doc: a } = await openClient(server, ANN, { protocol: { min: 1, max: 1 }, autoConnect: false });

  a.add(makeMarkup('m1', { text: 'Queued before upgrade' }));
  assert.equal(a.sync.pendingCount, 2);

  await a.connect();
  assert.equal(a.sync.connection, 'update_required');
  assert.equal(a.sync.pendingCount, 2, 'pending ops stay queued until client updates');
  assert.equal(Object.keys(server.state.markups).length, 0);

  await a.destroy();
});

test('DocumentSetup methods maintain stable snapshots and persist across restarts', async () => {
  const server = new FakeSyncServer();
  const persistence = new MemorySyncPersistence();
  const { doc } = await openClient(server, ANN, { persistence, key: 'setup-doc' });

  const initialScales = doc.allScales();
  const initialSheets = doc.allSheets();
  const initialCols = doc.columnSet();

  // Markup edits keep setup snapshot references stable.
  doc.add(makeMarkup('m1'));
  assert.equal(doc.allScales(), initialScales);
  assert.equal(doc.allSheets(), initialSheets);
  assert.equal(doc.columnSet(), initialCols);

  doc.setScale([0], { metersPerPoint: 0.01, unit: 'm', precision: 2, feetInches: false, label: '1:100' });
  assert.equal(doc.hasScale(0), true);
  assert.equal(doc.scaleFor(0).metersPerPoint, 0.01);
  assert.equal(doc.isScaledAt(0, [5, 5]), true);

  doc.setViewport({
    id: 'vp-1',
    pageIndex: 0,
    name: 'Detail A',
    rect: { x: 0, y: 0, w: 50, h: 50 },
    scale: { metersPerPoint: 0.002, unit: 'mm', precision: 0, feetInches: false, label: '1:20' },
  });
  assert.equal(doc.scaleAt(0, [10, 10]).metersPerPoint, 0.002);
  assert.equal(doc.scaleAt(0, [80, 80]).metersPerPoint, 0.01);

  doc.setDetectedSheets([
    [0, { number: 'A101', title: 'Floor Plan', discipline: 'A', scaleText: '1:100', revision: 'A', source: 'text', confidence: 0.9 }],
  ]);
  doc.editSheet(0, { title: 'Ground Floor Plan' });
  assert.equal(doc.allSheets()[0]?.title, 'Ground Floor Plan');
  assert.equal(doc.allSheets()[0]?.source, 'manual');

  doc.setColumnSet({ columns: [{ id: 'trade', name: 'Trade', type: 'text' }], statuses: doc.columnSet().statuses });
  assert.equal(doc.hasColumnSet(), true);

  await doc.whenPersisted();
  await doc.destroy();

  const { doc: reopened } = await openClient(server, ANN, { persistence, key: 'setup-doc', autoConnect: false });
  assert.equal(reopened.scaleFor(0).metersPerPoint, 0.01);
  assert.equal(reopened.allViewports().length, 1);
  assert.equal(reopened.allSheets()[0]?.title, 'Ground Floor Plan');
  assert.equal(reopened.hasColumnSet(), true);
  assert.equal(reopened.columnSet().columns[0]?.id, 'trade');

  await reopened.destroy();
});

test('editing a remotely deleted markup goes to the inbox and cannot be retried as a patch', async () => {
  const server = new FakeSyncServer();
  const { doc: a } = await openClient(server, ANN);
  const { doc: b } = await openClient(server, BEN);

  a.add(makeMarkup('m1', { text: 'Live' }));
  await b.disconnect();

  // Ann deletes m1 while Ben edits it offline.
  a.remove(['m1']);
  b.update('m1', { text: 'Edit on deleted' });
  await b.connect();

  assert.equal(b.get('m1'), undefined);
  assert.equal(b.sync.pendingCount, 0);
  assert.equal(b.sync.inbox.length, 1);
  assert.equal(b.sync.inbox[0]!.reason.code, 'deleted');
  assert.equal(b.sync.retryInboxAsNew(b.sync.inbox[0]!.id), false);

  await Promise.all([a.destroy(), b.destroy()]);
});

test('undo race condition rejected on the server returns changed without polluting inbox', async () => {
  const server = new FakeSyncServer();
  const { doc: a } = await openClient(server, ANN);
  const { doc: b } = await openClient(server, BEN);

  a.add(makeMarkup('m1', { text: 'v0' }));
  a.update('m1', { text: 'v1' });

  // Simulate Ben's edit committing on the server without Ann having received the broadcast yet.
  const silentPeer = server.createTransport(BEN, 'lane-1');
  // Detach Ann from receiving broadcasts temporarily by disconnecting, committing Ben's edit on server,
  // then manually sending an undo op through a transport that skipped the broadcast.
  // Simpler: mutate server state directly via a separate connected peer while Ann's message listener is paused.
  const bRec = server.state.markups.m1!;
  const raceTransport = {
    state: 'connected' as const,
    connect: () => undefined,
    disconnect: () => undefined,
    send: (ops: readonly Operation[]) => {
      // Commit Ben's conflicting edit first so Ann's undo op hits the server stale.
      silentPeer.connect({ streamId: 'doc-1', cursor: server.cursor, protocol: { min: 1, max: 1 } });
      silentPeer.send([
        {
          opId: 'ben-race-op',
          schemaVersion: PROTOCOL_VERSION,
          streamId: 'doc-1',
          type: 'markup.patch',
          entityId: 'm1',
          basedOn: { text: bRec.versions.text!.v },
          payload: { set: { text: 'ben-won-race' } },
        },
      ]);
      // Now forward Ann's undo op to the server; server rejects it with conflict.
      const fwd = server.createTransport(ANN, 'lane-1');
      fwd.onMessage((msg) => {
        for (const l of listeners) l(msg);
      });
      fwd.connect({ streamId: 'doc-1', cursor: server.cursor, protocol: { min: 1, max: 1 } });
      fwd.send(ops);
    },
    onMessage: (l: (m: import('./types.ts').ServerMessage) => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    onStateChange: () => () => undefined,
  };
  const listeners = new Set<(m: import('./types.ts').ServerMessage) => void>();

  await a.disconnect();
  await a.connect(raceTransport);
  // Mark connected via welcome so undo sends.
  for (const l of listeners) l({ type: 'welcome', protocol: { ok: true, version: 1 } });

  const result = await a.undo();
  assert.deepEqual(result, { ok: false, reason: 'changed' });
  assert.equal(a.sync.inbox.length, 0);

  await Promise.all([a.destroy(), b.destroy()]);
});

test('snapshot catch-up, sync.subscribe, editCount, onAdded and undoSteps behave as specified', async () => {
  const server = new FakeSyncServer({ maxLogLength: 1 });
  const addedLocally: string[] = [];
  const { doc: a } = await openClient(server, ANN, {
    context: {
      actor: { id: 'ann', name: 'Ann' },
      onAdded: (_doc, m) => addedLocally.push(m.id),
    },
  });
  const { doc: b } = await openClient(server, BEN);

  let syncEvents = 0;
  const unsub = a.sync.subscribe(() => {
    syncEvents += 1;
  });

  a.add(makeMarkup('m1', { text: 'one' }));
  assert.deepEqual(addedLocally, ['m1']);
  assert.equal(a.editCount, 1);
  assert.equal(b.editCount, 0); // remote event does not bump editCount
  assert.ok(syncEvents > 0);

  // Disconnect b and let a advance past server.maxLogLength so b must catch up via snapshot.
  await b.disconnect();
  a.update('m1', { text: 'two' });
  a.update('m1', { text: 'three' });
  a.update('m1', { text: 'four' });

  await b.connect();
  assert.equal(b.get('m1')?.text, 'four');
  assert.equal(b.sync.cursor, server.cursor);

  // undoSteps undoes two steps in a row.
  await a.undoSteps(2);
  assert.equal(a.get('m1')?.text, 'two');
  assert.equal(b.get('m1')?.text, 'two');

  unsub();
  await Promise.all([a.destroy(), b.destroy()]);
});

