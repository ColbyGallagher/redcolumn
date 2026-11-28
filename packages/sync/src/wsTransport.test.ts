// The WebSocket transport's own rules, with a scripted socket. The real server is covered by the
// server's tests.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_BATCH_BYTES, MAX_BATCH_SIZE, type Operation } from '@nb/ops';
import { SyncDocument } from './document.ts';
import type { ClientFrame, ServerFrame } from './wsProtocol.ts';
import { WsSyncTransport, type WebSocketLike, type WsSyncTransportOptions } from './wsTransport.ts';

class ScriptedSocket implements WebSocketLike {
  readonly sent: ClientFrame[] = [];
  closedWith: number | null = null;
  onopen: WebSocketLike['onopen'] = null;
  onmessage: WebSocketLike['onmessage'] = null;
  onclose: WebSocketLike['onclose'] = null;
  onerror: WebSocketLike['onerror'] = null;

  send(data: string): void {
    this.sent.push(JSON.parse(data) as ClientFrame);
  }

  close(code = 1000): void {
    this.closedWith = code;
  }

  receive(frame: ServerFrame): void {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }

  /** Accepts the hello, then answers the open with an empty snapshot. */
  accept(maxOpBytes = 64 * 1024, maxBatchBytes = maxOpBytes): void {
    this.onopen?.({});
    this.receive({ type: 'welcome', protocolVersion: 1, user: { id: 'ben', name: 'Ben' }, connectionId: 'c1', maxOpBytes, maxBatchBytes });
    this.receive({
      type: 'sync',
      streamId: 'doc-1',
      message: {
        type: 'welcome',
        protocol: { ok: true, version: 1 },
        snapshot: {
          state: { markups: {}, placements: {}, issues: {}, responses: {}, statusEvents: {}, laneStatus: {}, releases: {} },
          cursor: 'sealed-1',
        },
      },
    });
  }
}

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

async function open(options: Partial<WsSyncTransportOptions> = {}) {
  const sockets: ScriptedSocket[] = [];
  const transport = new WsSyncTransport({
    url: 'ws://server.example/ws',
    createSocket: () => {
      const socket = new ScriptedSocket();
      sockets.push(socket);
      return socket;
    },
    backoff: { minMs: 5, maxMs: 20 },
    random: () => 1,
    ...options,
  });
  const doc = await SyncDocument.open({
    streamId: 'doc-1',
    scopeId: 'scope-1',
    revisionId: 'revision-1',
    pages: ['page-1'],
    actor: { userId: 'ben', partyId: null, groupId: null },
    transport,
    persistence: false,
  });
  transport.onReconnectDue(() => void doc.connect());
  await doc.connect();
  return { doc, transport, sockets };
}

const markup = (comment = '') => ({
  id: 'm1',
  type: 'rect' as const,
  pageIndex: 0,
  points: [[1, 1], [2, 2]] as [number, number][],
  style: { stroke: '#000000', fill: null, width: 1, opacity: 1 },
  comment,
  status: 'none',
  author: 'Ben',
  createdAt: 1,
  modifiedAt: 1,
});

test('says hello before it opens, and reconnects with the newest cursor and pending operations', async () => {
  const { doc, sockets } = await open();
  const first = sockets[0]!;
  first.accept();
  assert.deepEqual(
    first.sent.map((f) => f.type),
    ['hello', 'open'],
  );
  assert.equal(doc.sync.connection, 'connected');

  doc.add(markup());
  await tick();
  const sentOps = first.sent.find((f) => f.type === 'send');
  assert.ok(sentOps && sentOps.type === 'send' && sentOps.ops.length === 2);

  first.onclose?.({ code: 1006 });
  assert.equal(doc.sync.connection, 'disconnected');
  await tick(30);
  const second = sockets[1]!;
  second.accept();
  await tick();
  const reopen = second.sent.find((f) => f.type === 'open');
  assert.ok(reopen && reopen.type === 'open');
  assert.equal(reopen.cursor, 'sealed-1');
  assert.deepEqual(reopen.pendingOpIds, sentOps.ops.map((o) => o.opId));
  // The unanswered operations go again with the same ids.
  const resent = second.sent.find((f) => f.type === 'send');
  assert.ok(resent && resent.type === 'send');
  assert.deepEqual(resent.ops.map((o) => o.opId), sentOps.ops.map((o) => o.opId));
  await doc.disconnect();
  await doc.destroy();
});

test('stops when the server cannot read this protocol version', async () => {
  const { doc, sockets } = await open();
  sockets[0]!.onopen?.({});
  sockets[0]!.receive({ type: 'error', code: 'client_too_old', server: { min: 9, max: 9 } });
  assert.equal(doc.sync.connection, 'update_required');
  await tick(30);
  assert.equal(sockets.length, 1);
  await doc.destroy();
});

test('stops when the session ends and says so', async () => {
  const { doc, transport, sockets } = await open();
  let ended = 0;
  transport.onSessionEnded(() => ended++);
  sockets[0]!.accept();
  sockets[0]!.onclose?.({ code: 4401 });
  await tick(30);
  assert.equal(ended, 1);
  assert.equal(sockets.length, 1);
  await doc.destroy();
});

test('stops when access is removed', async () => {
  const { doc, sockets } = await open();
  sockets[0]!.accept();
  sockets[0]!.receive({ type: 'sync', streamId: 'doc-1', message: { type: 'revoked' } });
  await tick(30);
  assert.equal(doc.sync.connection, 'revoked');
  assert.equal(sockets.length, 1);
  assert.equal(sockets[0]!.closedWith, 1000);
  await doc.destroy();
});

test('puts an operation larger than the server takes in the inbox instead of sending it', async () => {
  const { doc, sockets } = await open();
  sockets[0]!.accept(2048);
  doc.add(markup('x'.repeat(4000)));
  await tick();
  assert.equal(sockets[0]!.sent.some((f) => f.type === 'send'), false);
  assert.equal(doc.sync.pendingCount, 0);
  assert.deepEqual(doc.sync.inbox.map((e) => e.reason), [{ code: 'invalid', message: 'Too large to send' }]);
  await doc.disconnect();
  await doc.destroy();
});

/** Adds `count` markups in one edit, each with a comment of `bytes` characters. */
function addMany(doc: SyncDocument, count: number, bytes: number): void {
  doc.batch(() => {
    for (let i = 0; i < count; i++) doc.add({ ...markup('x'.repeat(bytes)), id: `bulk-${i}` });
  });
}

const sends = (socket: ScriptedSocket) => socket.sent.flatMap((f) => (f.type === 'send' ? [f.ops] : []));

test('sends a batch larger than one operation may be, up to the batch limit', async () => {
  const { doc, sockets } = await open();
  sockets[0]!.accept(2048, 64 * 1024);
  addMany(doc, 8, 1000);
  await tick();
  assert.equal(doc.sync.inbox.length, 0);
  assert.equal(sends(sockets[0]!).length, 1);
  assert.equal(sends(sockets[0]!)[0]!.length, 16);
  await doc.disconnect();
  await doc.destroy();
});

test('still refuses a batch over the batch limit, or holding one operation over the operation limit', async () => {
  for (const [maxOp, maxBatch, bytes] of [[2048, 8 * 1024, 1000], [2048, 1024 * 1024, 4000]] as const) {
    const { doc, sockets } = await open();
    sockets[0]!.accept(maxOp, maxBatch);
    addMany(doc, 8, bytes);
    await tick();
    assert.equal(sends(sockets[0]!).length, 0);
    assert.deepEqual(doc.sync.inbox.map((e) => e.reason), [{ code: 'invalid', message: 'Too large to send' }]);
    await doc.disconnect();
    await doc.destroy();
  }
});

test('splits an edit too large for one batch, keeping each markup with its placement', async () => {
  // Over the byte limit with few operations, then over the operation limit with few bytes.
  for (const [count, bytes] of [[60, 100_000], [MAX_BATCH_SIZE / 2 + 3, 10]] as const) {
    const { doc, sockets } = await open();
    sockets[0]!.accept(256 * 1024, MAX_BATCH_BYTES);
    addMany(doc, count, bytes);
    await tick(20);
    assert.equal(doc.sync.inbox.length, 0);
    const batches = sends(sockets[0]!);
    assert.ok(batches.length > 1, `${batches.length} batches`);
    assert.equal(batches.flat().length, count * 2);
    for (const batch of batches) {
      assert.ok(batch.length <= MAX_BATCH_SIZE);
      assert.ok(new TextEncoder().encode(JSON.stringify(batch)).byteLength <= MAX_BATCH_BYTES);
      assert.ok(batch.every((op) => op.batchId === batch[0]!.batchId && op.batchSize === batch.length));
      const created = batch.flatMap((op: Operation) => (op.type === 'markup.create' ? [op.entityId] : []));
      const placed = batch.flatMap((op: Operation) => (op.type === 'placement.create' ? [op.payload.markupId] : []));
      assert.deepEqual(placed, created);
    }
    await doc.disconnect();
    await doc.destroy();
  }
});

test('says the session ended when it ended while there was no connection', async () => {
  let ended = false;
  let asked = 0;
  const { doc, transport, sockets } = await open({
    checkSessionEnded: async () => {
      asked++;
      return ended;
    },
  });
  let told = 0;
  transport.onSessionEnded(() => told++);
  sockets[0]!.accept();
  // A drop after the server's welcome asks nothing yet.
  sockets[0]!.onclose?.({ code: 1006 });
  assert.equal(asked, 0);
  await tick(30);
  // The next attempt is refused while the session is still good: carry on trying.
  sockets[1]!.onclose?.({ code: 1006 });
  await tick(40);
  assert.equal(asked, 1);
  assert.equal(told, 0);
  assert.equal(sockets.length, 3);
  // It ends: the refused upgrade looks the same, and the check says why.
  ended = true;
  sockets[2]!.onclose?.({ code: 1006 });
  await tick(60);
  assert.equal(told, 1);
  const made = sockets.length;
  transport.retryNow();
  await tick(60);
  assert.equal(sockets.length, made, 'no more attempts');
  assert.equal(doc.sync.connection, 'disconnected');
  await doc.destroy();
});

test('carries on reconnecting when the session check gets no answer', async () => {
  const { doc, transport, sockets } = await open({
    checkSessionEnded: () => Promise.reject(new TypeError('network error')),
  });
  let told = 0;
  transport.onSessionEnded(() => told++);
  sockets[0]!.onclose?.({ code: 1006 });
  await tick(40);
  assert.ok(sockets.length > 1);
  assert.equal(told, 0);
  await doc.disconnect();
  await doc.destroy();
});

test('backs off when opening keeps working but the connection keeps failing', async () => {
  const { doc, sockets } = await open({ backoff: { minMs: 10, maxMs: 5000 } });
  const dropAndWait = async () => {
    const current = sockets.length;
    sockets.at(-1)!.accept();
    sockets.at(-1)!.onclose?.({ code: 1011 });
    const started = Date.now();
    while (sockets.length === current) await tick(2);
    return Date.now() - started;
  };
  const waits: number[] = [];
  for (let i = 0; i < 5; i++) waits.push(await dropAndWait());
  // 10, 20, 40, 80, 160 ms, allowing for the timer's coarseness.
  assert.ok(waits[4]! >= 120, `waits: ${waits.join(', ')}`);
  // An answered operation is progress, so the next wait starts again from the shortest.
  sockets.at(-1)!.accept();
  sockets.at(-1)!.receive({
    type: 'sync',
    streamId: 'doc-1',
    message: { type: 'ack', opIds: [], seq: 1, cursor: 'sealed-2', serverTime: 1, actor: { userId: 'ben', partyId: null, groupId: null }, laneId: 'lane-1' },
  });
  const current = sockets.length;
  sockets.at(-1)!.onclose?.({ code: 1011 });
  await tick(80);
  assert.equal(sockets.length, current + 1);
  await doc.disconnect();
  await doc.destroy();
});

test('starts the backoff again once a connection has stayed up', async () => {
  const { doc, sockets } = await open({ backoff: { minMs: 10, maxMs: 5000, stableMs: 15 } });
  for (let i = 0; i < 5; i++) {
    const current = sockets.length;
    sockets.at(-1)!.accept();
    sockets.at(-1)!.onclose?.({ code: 1011 });
    while (sockets.length === current) await tick(2);
  }
  sockets.at(-1)!.accept();
  await tick(40);
  const current = sockets.length;
  sockets.at(-1)!.onclose?.({ code: 1006 });
  await tick(80);
  assert.equal(sockets.length, current + 1);
  await doc.disconnect();
  await doc.destroy();
});

test('shares the page in view again after reconnecting', async () => {
  const { doc, transport, sockets } = await open();
  sockets[0]!.accept();
  transport.setPage(3);
  sockets[0]!.onclose?.({ code: 1006 });
  await tick(30);
  sockets[1]!.accept();
  assert.deepEqual(
    sockets[1]!.sent.filter((f) => f.type === 'presence'),
    [{ type: 'presence', streamId: 'doc-1', pageIndex: 3 }],
  );
  await doc.disconnect();
  await doc.destroy();
});
