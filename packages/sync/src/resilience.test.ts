import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Markup } from '@nb/markup';
import { PROTOCOL_VERSION, type Actor as OpsActor, type Operation } from '@nb/ops';
import { SyncDocument, type SyncDocumentOptions } from './document.ts';
import { FakeSyncServer, type InProcessTransport } from './inProcess.ts';
import { MemorySyncPersistence } from './persistence.ts';
import type { PersistedSyncState, ServerMessage, SyncHandshake, SyncTransport, TransportState } from './types.ts';

const STYLE = { stroke: '#d92d20', fill: null, width: 2, opacity: 1 };
const PAGES = ['page-a101', 'page-a102'] as const;
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

/** Wraps an in-process transport so a test can hold back (and later release or drop) acks and rejects. */
class HoldingTransport implements SyncTransport {
  holding = false;
  private held: ServerMessage[] = [];
  private readonly listeners = new Set<(message: ServerMessage) => void>();
  readonly inner: InProcessTransport;

  constructor(inner: InProcessTransport) {
    this.inner = inner;
    inner.onMessage((m) => {
      if (this.holding && (m.type === 'ack' || m.type === 'reject')) this.held.push(m);
      else this.emit(m);
    });
  }

  get state(): TransportState {
    return this.inner.state;
  }
  get heldCount(): number {
    return this.held.length;
  }
  connect(h: SyncHandshake): void {
    this.inner.connect(h);
  }
  disconnect(): void {
    this.inner.disconnect();
  }
  send(ops: readonly Operation[]): void {
    this.inner.send(ops);
  }
  onMessage(l: (m: ServerMessage) => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  onStateChange(l: (s: TransportState) => void): () => void {
    return this.inner.onStateChange(l);
  }
  /** Delivers the oldest held message. */
  releaseOne(): void {
    const m = this.held.shift();
    if (m) this.emit(m);
  }
  dropHeld(): void {
    this.held = [];
  }
  private emit(m: ServerMessage): void {
    for (const l of [...this.listeners]) l(m);
  }
}

/** A transport that connects but never answers. */
function silentTransport(): SyncTransport {
  return {
    state: 'disconnected',
    connect: () => undefined,
    disconnect: () => undefined,
    send: () => undefined,
    onMessage: () => () => undefined,
    onStateChange: () => () => undefined,
  };
}

const tick = () => new Promise<void>((r) => setImmediate(r));

/** Releases held messages one at a time until `done()` is true. */
async function releaseUntil(t: HoldingTransport, done: () => boolean, limit = 50): Promise<void> {
  for (let i = 0; i < limit && !done(); i++) {
    t.releaseOne();
    await tick();
  }
}

function track<T>(p: Promise<T>): { promise: Promise<T>; settled: () => boolean } {
  let settled = false;
  void p.then(() => (settled = true));
  return { promise: p, settled: () => settled };
}

async function openClient(
  server: FakeSyncServer,
  actor: OpsActor,
  options: Partial<SyncDocumentOptions> & { autoConnect?: boolean; hold?: boolean } = {},
) {
  let idSeq = 0;
  let now = 5000;
  const transport = new HoldingTransport(server.createTransport(actor, 'lane-1'));
  const doc = await SyncDocument.open({
    streamId: 'doc-1',
    scopeId: 'review-1',
    revisionId: 'rev-1',
    pages: PAGES,
    actor,
    context: { actor: { id: actor.userId, name: actor.userId } },
    transport,
    persistence: false,
    clock: () => ++now,
    newId: () => `${actor.userId}-${options.key ?? 'doc'}-${++idSeq}`,
    ...options,
  });
  if (options.autoConnect !== false) await doc.connect();
  return { doc, transport };
}

function liveMarkups(server: FakeSyncServer): string[] {
  return Object.values(server.state.markups)
    .filter((m) => !m.deleted)
    .map((m) => m.id)
    .sort();
}

class FlakyPersistence extends MemorySyncPersistence {
  failures = 0;
  override async save(key: string, state: PersistedSyncState): Promise<void> {
    if (this.failures > 0) {
      this.failures -= 1;
      throw new Error('quota exceeded');
    }
    return super.save(key, state);
  }
}

// ---- Local persistence ---------------------------------------------------------------------

test('a failed local save does not stop later saves, and whenPersisted recovers', async () => {
  const server = new FakeSyncServer();
  const persistence = new FlakyPersistence();
  persistence.failures = 1;
  const { doc } = await openClient(server, ANN, { persistence, key: 'flaky', autoConnect: false });

  doc.add(makeMarkup('m1', { text: 'first' }));
  await assert.rejects(doc.whenPersisted(), /quota exceeded/);
  assert.match(doc.sync.lastError ?? '', /quota exceeded/);

  doc.add(makeMarkup('m2', { text: 'second' }));
  await doc.whenPersisted();
  assert.equal(doc.sync.lastError, null, 'a later successful save clears the save error');

  const saved = await persistence.load('flaky');
  assert.equal(saved?.pending.length, 4, 'both offline adds are on disk');
  await doc.destroy();
});

// ---- Undo/redo beyond the batch size limit -------------------------------------------------

test('undo and redo of a step with more than 1,000 ops runs in chunks and completes after every chunk', async () => {
  const server = new FakeSyncServer();
  const { doc, transport } = await openClient(server, ANN);
  const ids = Array.from({ length: 501 }, (_, i) => `m${i + 1}`);

  doc.batch(() => {
    for (const id of ids) doc.add(makeMarkup(id));
  });
  assert.equal(liveMarkups(server).length, 501);
  doc.remove(ids); // 1,002 ops
  await tick();
  assert.equal(liveMarkups(server).length, 0);

  transport.holding = true;
  const undo = track(doc.undo());
  await tick();
  assert.equal(transport.heldCount, 1, 'only the first chunk is sent before it is confirmed');
  transport.releaseOne();
  await tick();
  assert.equal(undo.settled(), false, 'the step is not complete after the first chunk');
  await releaseUntil(transport, undo.settled);
  assert.deepEqual(await undo.promise, { ok: true });
  assert.equal(doc.all().length, 501);
  assert.equal(liveMarkups(server).length, 501);
  transport.holding = false;

  assert.deepEqual(await doc.redo(), { ok: true });
  assert.equal(liveMarkups(server).length, 0);
  assert.deepEqual(await doc.undo(), { ok: true });
  assert.equal(liveMarkups(server).length, 501);
  await doc.destroy();
});

test('a refused later chunk of a large undo takes back the chunks already committed', async () => {
  const server = new FakeSyncServer();
  const { doc } = await openClient(server, ANN);
  const ids = Array.from({ length: 501 }, (_, i) => `m${i + 1}`);
  doc.batch(() => {
    for (const id of ids) doc.add(makeMarkup(id));
  });
  doc.remove(ids);

  // The restore of m1 lands in the second chunk; the server refuses it.
  server.setAuthorize((_actor, op) => !(op.type === 'markup.restore' && op.entityId === 'm1'));
  assert.deepEqual(await doc.undo(), { ok: false, reason: 'forbidden' });
  await tick();
  assert.deepEqual(liveMarkups(server), [], 'committed chunks were compensated');
  assert.equal(doc.all().length, 0);
  assert.equal(doc.sync.pendingCount, 0);
  assert.equal(doc.sync.inbox.length, 0);
  await doc.destroy();
});

test('submitOps and retryInboxAsNew chunk more than 1,000 ops', async () => {
  const server = new FakeSyncServer();
  const { doc } = await openClient(server, ANN);
  const ops: Operation[] = [];
  for (let i = 0; i < 501; i++) {
    ops.push(
      {
        opId: `create-${i}`,
        schemaVersion: PROTOCOL_VERSION,
        streamId: 'doc-1',
        type: 'markup.create',
        entityId: `s${i}`,
        payload: { scopeId: 'review-1', type: 'rect', content: { style: STYLE } },
      } as Operation,
      {
        opId: `place-${i}`,
        schemaVersion: PROTOCOL_VERSION,
        streamId: 'doc-1',
        type: 'placement.create',
        entityId: `p${i}`,
        payload: {
          markupId: `s${i}`,
          revisionId: 'rev-1',
          pageId: 'page-a101',
          geometry: { points: [[0, 0], [10, 10]] },
          method: 'original',
          confidence: null,
          state: 'confirmed',
        },
      } as Operation,
    );
  }
  assert.equal(doc.submitOps(ops), true, JSON.stringify(doc.sync.inbox[0]?.reason));
  await tick();
  assert.equal(liveMarkups(server).length, 501);
  assert.equal(doc.sync.pendingCount, 0);

  // A large rejected entry retried as new is re-chunked too.
  const deletes: Operation[] = ops
    .filter((o) => o.type === 'markup.create')
    .flatMap((o, i) => [
      { opId: `pdel-${i}`, schemaVersion: PROTOCOL_VERSION, streamId: 'doc-1', type: 'placement.delete', entityId: `p${i}`, payload: {} } as Operation,
      { opId: `mdel-${i}`, schemaVersion: PROTOCOL_VERSION, streamId: 'doc-1', type: 'markup.delete', entityId: o.entityId, payload: {} } as Operation,
    ]);
  server.setAuthorize(() => false);
  assert.equal(doc.submitOps(deletes), true);
  assert.ok(doc.sync.inbox.length >= 1);
  server.setAuthorize(undefined);
  for (const entry of [...doc.sync.inbox]) assert.equal(doc.sync.retryInboxAsNew(entry.id), true);
  assert.equal(liveMarkups(server).length, 0);
  assert.equal(doc.sync.inbox.length, 0);
  await doc.destroy();
});

// ---- Concurrent and interrupted undo -------------------------------------------------------

test('two undos while the first is in flight both apply, in order', async () => {
  const server = new FakeSyncServer();
  const { doc, transport } = await openClient(server, ANN);
  doc.add(makeMarkup('m1', { text: 'v0' }));
  doc.update('m1', { text: 'v1' });
  doc.update('m1', { text: 'v2' });

  transport.holding = true;
  const p1 = track(doc.undo());
  const p2 = track(doc.undo());
  await releaseUntil(transport, () => p1.settled() && p2.settled());
  assert.deepEqual(await p1.promise, { ok: true });
  assert.deepEqual(await p2.promise, { ok: true });
  assert.equal(doc.get('m1')?.text, 'v0');
  assert.equal(server.state.markups.m1?.content.text, 'v0');
  await doc.destroy();
});

test('disconnecting after an undo was sent keeps it, and the reconnect completes the step', async () => {
  const server = new FakeSyncServer();
  const { doc, transport } = await openClient(server, ANN);
  doc.add(makeMarkup('m1', { text: 'v0' }));
  doc.update('m1', { text: 'v1' });

  transport.holding = true;
  const undo = track(doc.undo());
  await tick();
  assert.equal(server.state.markups.m1?.content.text, 'v0', 'the server committed the undo');
  transport.dropHeld(); // the ack is lost
  await doc.disconnect();
  await tick();
  assert.equal(undo.settled(), false, 'a sent undo is not reported offline');
  transport.holding = false;

  await doc.connect();
  assert.deepEqual(await undo.promise, { ok: true });
  assert.equal(doc.get('m1')?.text, 'v0');
  assert.deepEqual(await doc.redo(), { ok: true });
  assert.equal(server.state.markups.m1?.content.text, 'v1');
  await doc.destroy();
});

test('an undo sent before a restart completes after reopening', async () => {
  const server = new FakeSyncServer();
  const persistence = new MemorySyncPersistence();
  const first = await openClient(server, ANN, { persistence, key: 'restart' });
  first.doc.add(makeMarkup('m1', { text: 'v0' }));
  first.doc.update('m1', { text: 'v1' });

  first.transport.holding = true;
  void first.doc.undo();
  await tick();
  first.transport.dropHeld();
  await first.doc.disconnect();
  await first.doc.destroy();

  const second = await openClient(server, ANN, { persistence, key: 'restart' });
  await tick();
  assert.equal(second.doc.get('m1')?.text, 'v0');
  assert.equal(second.doc.undoHistory().length, 1, 'only the add is left to undo');
  assert.deepEqual(await second.doc.redo(), { ok: true });
  assert.equal(server.state.markups.m1?.content.text, 'v1');
  await second.doc.destroy();
});

test('undo of a re-done add still refuses when someone else edited the markup', async () => {
  const server = new FakeSyncServer();
  const { doc: a } = await openClient(server, ANN);
  const { doc: b } = await openClient(server, BEN);

  a.add(makeMarkup('m1', { text: 'Ann note' }));
  assert.deepEqual(await a.undo(), { ok: true });
  assert.deepEqual(await a.redo(), { ok: true });
  assert.deepEqual(await a.undo(), { ok: true }, 'nobody else edited it: undo is allowed');
  assert.deepEqual(await a.redo(), { ok: true });

  b.update('m1', { text: 'Ben edit' });
  assert.deepEqual(await a.undo(), { ok: false, reason: 'changed' });
  assert.equal(server.state.markups.m1?.deleted, false);
  assert.equal(a.get('m1')?.text, 'Ben edit');
  await Promise.all([a.destroy(), b.destroy()]);
});

test('undo of a batch that edits and then removes a markup restores it', async () => {
  const server = new FakeSyncServer();
  const { doc } = await openClient(server, ANN);
  doc.add(makeMarkup('m1', { text: 'before' }));
  doc.batch(() => {
    doc.update('m1', { text: 'after' });
    doc.remove(['m1']);
  });
  assert.equal(doc.get('m1'), undefined);
  assert.deepEqual(await doc.undo(), { ok: true });
  assert.equal(doc.get('m1')?.text, 'before');

  doc.batch(() => {
    doc.add(makeMarkup('m2'));
    doc.remove(['m2']);
  });
  assert.deepEqual(await doc.undo(), { ok: true });
  await doc.destroy();
});

test('a new edit made while an undo is in flight discards redo', async () => {
  const server = new FakeSyncServer();
  const { doc, transport } = await openClient(server, ANN);
  doc.add(makeMarkup('m1', { text: 'v0' }));
  doc.update('m1', { text: 'v1' });

  transport.holding = true;
  const undo = track(doc.undo());
  doc.update('m1', { comment: 'newer' });
  await releaseUntil(transport, undo.settled);
  assert.deepEqual(await undo.promise, { ok: true });
  transport.holding = false;
  assert.deepEqual(await doc.redo(), { ok: false, reason: 'nothing' });
  await doc.destroy();
});

// ---- Revocation ----------------------------------------------------------------------------

test('revocation clears setup from disk and survives a restart', async () => {
  const server = new FakeSyncServer();
  const persistence = new MemorySyncPersistence();
  const { doc } = await openClient(server, ANN, { persistence, key: 'revoked' });
  doc.setDetectedSheets([
    [0, { number: 'A-101', title: 'Level 1 Plan', discipline: null, scaleText: null, revision: null, source: 'manual', confidence: 1 }],
  ]);
  doc.setColumnSet({ columns: [{ id: 'trade', name: 'Trade', type: 'text' }], statuses: [] } as never);
  doc.add(makeMarkup('m1'));

  server.revokeAccess(ANN.userId);
  assert.equal(doc.sync.connection, 'revoked');
  assert.deepEqual(doc.allSheets(), {});
  await doc.whenPersisted();
  const saved = await persistence.load('revoked');
  assert.equal(saved?.revoked, true);
  assert.equal(saved?.setup, undefined);
  assert.equal(new TextDecoder().decode(persistence.rawBytes('revoked')).includes('Level 1 Plan'), false);
  await doc.destroy();

  const reopened = await openClient(server, ANN, { persistence, key: 'revoked', autoConnect: false });
  assert.equal(reopened.doc.sync.connection, 'revoked');
  assert.equal(reopened.doc.readOnly, true);
  reopened.doc.add(makeMarkup('m2'));
  assert.equal(reopened.doc.sync.pendingCount, 0, 'no edits queue on a revoked document');
  await reopened.doc.destroy();
});

test('connect() after revocation keeps the document read-only until the server welcomes it', async () => {
  const server = new FakeSyncServer();
  const { doc } = await openClient(server, ANN);
  server.revokeAccess(ANN.userId);
  assert.equal(doc.readOnly, true);

  void doc.connect(silentTransport());
  assert.equal(doc.readOnly, true);
  assert.equal(doc.sync.connection, 'revoked');
  doc.add(makeMarkup('m1'));
  assert.equal(doc.sync.pendingCount, 0);
  assert.equal(doc.submitOps([{ opId: 'x', schemaVersion: PROTOCOL_VERSION, streamId: 'doc-1', type: 'markup.delete', entityId: 'm0', payload: {} } as Operation]), false);

  server.restoreAccess(ANN.userId);
  await doc.connect(server.createTransport(ANN, 'lane-1'));
  assert.equal(doc.sync.connection, 'connected');
  assert.equal(doc.readOnly, false);
  await doc.destroy();
});
