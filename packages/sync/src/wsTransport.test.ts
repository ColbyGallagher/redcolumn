// The WebSocket transport's own rules, with a scripted socket. The real server is covered by the
// server's tests.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SyncDocument } from './document.ts';
import type { ClientFrame, ServerFrame } from './wsProtocol.ts';
import { WsSyncTransport, type WebSocketLike } from './wsTransport.ts';

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
  accept(maxOpBytes = 64 * 1024): void {
    this.onopen?.({});
    this.receive({ type: 'welcome', protocolVersion: 1, user: { id: 'ben', name: 'Ben' }, connectionId: 'c1', maxOpBytes });
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

async function open() {
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
