import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import { PROTOCOL_VERSION, type Operation } from '@nb/ops';
import WebSocket from 'ws';
import { buildServer, type ServerInstance } from './app.ts';
import { createLocalUser } from './auth.ts';
import type { StreamEvent } from './broadcaster.ts';
import { runCli } from './cli.ts';
import { loadConfig, type ServerConfig } from './config.ts';
import { createDb, type DbHandle } from './db.ts';
import { createInvite } from './invites.ts';
import { checkMigrations, runMigrations } from './migrate.ts';
import type { BatchAck, OpAck } from './pipeline.ts';
import { WS_CLOSE_SESSION_ENDED } from './ws.ts';

function makeMarkupPatch(opId: string, entityId: string, text: string, basedOn: string, streamId = 'doc-alpha'): Operation {
  return {
    opId,
    schemaVersion: PROTOCOL_VERSION,
    streamId,
    type: 'markup.patch',
    entityId,
    basedOn: { text: basedOn },
    payload: { set: { text } },
  } as Operation;
}

function makePlacementCreate(opId: string, entityId: string, markupId: string, streamId: string): Operation {
  return {
    opId,
    schemaVersion: PROTOCOL_VERSION,
    streamId,
    type: 'placement.create',
    entityId,
    payload: {
      markupId,
      revisionId: 'rev-a',
      pageId: 'page-1',
      geometry: { points: [[0, 0], [10, 10]] },
      method: 'original',
      confidence: null,
      state: 'confirmed',
    },
  } as Operation;
}

/** Marks ops as one batch, as a client does for a paste or group move. */
function batched(batchId: string, ops: Operation[]): Operation[] {
  return ops.map((op) => ({ ...op, batchId, batchSize: ops.length }));
}

function rejectionOf(ack: OpAck): { code: string } {
  if (ack.ok) throw new Error(`expected a rejection, got ${JSON.stringify(ack)}`);
  return ack.rejection;
}

/** A promise plus its resolver, used to hold a transaction open just before COMMIT. */
function gate(): { wait: Promise<void>; open: () => void } {
  let open!: () => void;
  const wait = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { wait, open };
}

async function waitForLockWaiter(pool: DbHandle['pool']): Promise<void> {
  for (let i = 0; i < 200; i++) {
    const res = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`,
    );
    if ((res.rows[0]?.n ?? 0) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('No transaction ever waited on a lock');
}

function waitForClose(ws: WebSocket): Promise<number> {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) resolve(-1);
    ws.once('close', (code) => resolve(code));
  });
}

async function login(baseUrl: string, email: string, password: string): Promise<string> {
  const res = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: baseUrl },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(res.status, 200);
  return (res.headers.get('set-cookie') ?? '').split(';')[0]!;
}

async function openHandshakenWs(wsUrl: string, baseUrl: string, cookie: string): Promise<WebSocket> {
  const ws = await openWs(wsUrl, { cookie, origin: baseUrl });
  ws.send(JSON.stringify({ type: 'hello', protocol: { min: 1, max: PROTOCOL_VERSION } }));
  const welcome = await nextJsonMessage(ws);
  assert.equal(welcome.type, 'welcome');
  return ws;
}

const DATABASE_URL = process.env.DATABASE_URL?.trim();
const REQUIRE_POSTGRES = process.env.REQUIRE_POSTGRES_TESTS === '1';

if (!DATABASE_URL && REQUIRE_POSTGRES) {
  throw new Error('REQUIRE_POSTGRES_TESTS=1 is set but DATABASE_URL is not configured');
}

function makeConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  const base = loadConfig({
    DATABASE_URL: DATABASE_URL!,
    HOST: '127.0.0.1',
    PORT: '0',
    LOG_LEVEL: 'silent',
    COOKIE_SECURE: 'false',
    AUTO_MIGRATE: 'false',
  });
  return { ...base, ...overrides };
}

function makeMarkupCreate(opId: string, entityId: string, text: string, streamId = 'doc-alpha'): Operation {
  return {
    opId,
    schemaVersion: PROTOCOL_VERSION,
    streamId,
    type: 'markup.create',
    entityId,
    payload: {
      scopeId: 'scope-alpha',
      type: 'rect',
      content: {
        style: { stroke: '#d00000', fill: null, width: 2, opacity: 1 },
        text,
      },
    },
  };
}

function openWs(url: string, headers: Record<string, string>): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers });
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function expectWsRejected(url: string, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers });
    ws.once('open', () => {
      ws.close();
      reject(new Error('Expected WebSocket upgrade to be rejected'));
    });
    ws.once('unexpected-response', (_req, res) => {
      resolve(res.statusCode ?? 0);
    });
    ws.once('error', () => {
      // unexpected-response fires before error; ignore secondary error event.
    });
  });
}

function nextJsonMessage(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const onMessage = (data: WebSocket.RawData) => {
      ws.off('error', onError);
      resolve(JSON.parse(data.toString()) as Record<string, unknown>);
    };
    const onError = (err: Error) => {
      ws.off('message', onMessage);
      reject(err);
    };
    ws.once('message', onMessage);
    ws.once('error', onError);
  });
}

describe('server integration (Postgres 17)', { skip: !DATABASE_URL ? 'DATABASE_URL is not set' : false }, () => {
  let dbHandle: DbHandle;

  before(async () => {
    dbHandle = createDb(DATABASE_URL!);
    await runMigrations(dbHandle.pool);
  });

  after(async () => {
    await dbHandle.close();
  });

  beforeEach(async () => {
    await dbHandle.pool.query(
      'TRUNCATE invites, scopes, project_members, projects, workspaces, events, placements, markups, op_results, streams, sessions, users CASCADE',
    );
  });

  it('reports migrations up to date via checkMigrations and CLI', async () => {
    const status = await checkMigrations(dbHandle.pool);
    assert.deepEqual(status.pending, []);
    assert.deepEqual(status.mismatched, []);
    assert.ok(status.applied.includes('0001_skeleton.sql'));

    const stdout: string[] = [];
    const stderr: string[] = [];
    const code = await runCli(['migrate', '--check'], {
      stdout: (line) => stdout.push(line),
      stderr: (line) => stderr.push(line),
      readStdin: async () => '',
      env: { DATABASE_URL: DATABASE_URL! },
    });
    assert.equal(code, 0);
    assert.deepEqual(stderr, []);
    assert.match(stdout.join('\n'), /Migrations up to date/);
  });

  it('creates an admin via CLI, signs in over HTTP, enforces Origin checks, and opens an authenticated WS', async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const exitCode = await runCli(
      ['create-admin', '--email', 'ada@example.test', '--name', 'Ada Reviewer', '--password-stdin'],
      {
        stdout: (line) => stdout.push(line),
        stderr: (line) => stderr.push(line),
        readStdin: async () => 'fictional-admin-pass-123\n',
        env: { DATABASE_URL: DATABASE_URL! },
      },
    );
    assert.equal(exitCode, 0, stderr.join('\n'));
    assert.match(stdout.join('\n'), /Created admin user ada@example\.test/);

    const config = makeConfig();
    const server: ServerInstance = buildServer({ config, db: dbHandle.db, pool: dbHandle.pool });
    const address = await server.app.listen({ host: config.host, port: 0 });
    const baseUrl = address;
    const wsUrl = `${baseUrl.replace(/^http/, 'ws')}/ws`;

    try {
      // Health & readiness
      const healthRes = await fetch(`${baseUrl}/healthz`);
      assert.equal(healthRes.status, 200);
      assert.deepEqual(await healthRes.json(), { ok: true });

      const readyRes = await fetch(`${baseUrl}/readyz`);
      assert.equal(readyRes.status, 200);
      assert.deepEqual(await readyRes.json(), { ok: true });

      // Disallowed Origin on state-changing HTTP request is rejected (CSRF protection)
      const csrfRes = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://evil.example.test' },
        body: JSON.stringify({ email: 'ada@example.test', password: 'fictional-admin-pass-123' }),
      });
      assert.equal(csrfRes.status, 403);

      // Login with same-origin
      const loginRes = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: baseUrl },
        body: JSON.stringify({ email: 'ada@example.test', password: 'fictional-admin-pass-123' }),
      });
      assert.equal(loginRes.status, 200);
      const setCookie = loginRes.headers.get('set-cookie') ?? '';
      assert.match(setCookie, /rc_session=/);
      assert.match(setCookie, /HttpOnly/);
      assert.match(setCookie, /SameSite=Lax/);
      const cookiePair = setCookie.split(';')[0]!;
      const loginBody = (await loginRes.json()) as { user: { id: string; email: string; isAdmin: boolean } };
      assert.equal(loginBody.user.email, 'ada@example.test');
      assert.equal(loginBody.user.isAdmin, true);

      // GET /auth/me with session cookie
      const meRes = await fetch(`${baseUrl}/auth/me`, { headers: { cookie: cookiePair } });
      assert.equal(meRes.status, 200);
      const meBody = (await meRes.json()) as { user: { id: string } };
      assert.equal(meBody.user.id, loginBody.user.id);

      // Unauthenticated WS upgrade is rejected with 401
      const unauthStatus = await expectWsRejected(wsUrl, { origin: baseUrl });
      assert.equal(unauthStatus, 401);

      // Disallowed Origin WS upgrade is rejected with 403
      const badOriginStatus = await expectWsRejected(wsUrl, { cookie: cookiePair, origin: 'https://evil.example.test' });
      assert.equal(badOriginStatus, 403);

      // Authenticated WS connection + handshake + subscribe + op submit + broadcast
      const ws1 = await openWs(wsUrl, { cookie: cookiePair, origin: baseUrl });
      const ws2 = await openWs(wsUrl, { cookie: cookiePair, origin: baseUrl });

      try {
        ws1.send(JSON.stringify({ type: 'hello', protocol: { min: 1, max: PROTOCOL_VERSION } }));
        const welcome1 = await nextJsonMessage(ws1);
        assert.equal(welcome1.type, 'welcome');
        assert.equal(welcome1.protocolVersion, PROTOCOL_VERSION);

        ws2.send(JSON.stringify({ type: 'hello', protocol: { min: 1, max: PROTOCOL_VERSION } }));
        const welcome2 = await nextJsonMessage(ws2);
        assert.equal(welcome2.type, 'welcome');

        ws2.send(JSON.stringify({ type: 'subscribe', streamId: 'doc-ws-1' }));
        const subMsg = await nextJsonMessage(ws2);
        assert.equal(subMsg.type, 'subscribed');

        const eventPromise = nextJsonMessage(ws2);
        const ackPromise = nextJsonMessage(ws1);

        const op = makeMarkupCreate('op-ws-1', 'markup-ws-1', 'Verify beam depth', 'doc-ws-1');
        ws1.send(JSON.stringify({ type: 'op', op }));

        const [ackMsg, eventMsg] = await Promise.all([ackPromise, eventPromise]);
        assert.equal(ackMsg.type, 'ack');
        const ackResult = ackMsg.result as OpAck;
        assert.equal(ackResult.ok, true);
        if (ackResult.ok) {
          assert.equal(ackResult.seq, 1);
          assert.equal(ackResult.opId, 'op-ws-1');
        }

        assert.equal(eventMsg.type, 'event');
        const evt = eventMsg.event as StreamEvent;
        assert.equal(evt.seq, 1);
        assert.equal(evt.opId, 'op-ws-1');
        assert.equal(evt.actorId, loginBody.user.id);
      } finally {
        ws1.close();
        ws2.close();
      }

      // Logout revokes session
      const logoutRes = await fetch(`${baseUrl}/auth/logout`, {
        method: 'POST',
        headers: { cookie: cookiePair, origin: baseUrl },
      });
      assert.equal(logoutRes.status, 200);

      const afterLogoutMe = await fetch(`${baseUrl}/auth/me`, { headers: { cookie: cookiePair } });
      assert.equal(afterLogoutMe.status, 401);
    } finally {
      await server.app.close();
    }
  });

  it('persists accepted ops, replays identical opId retries, and refuses reused opId with different content', async () => {
    const config = makeConfig();
    const server = buildServer({ config, db: dbHandle.db, pool: dbHandle.pool });
    const broadcasts: StreamEvent[] = [];
    const unsubscribe = server.broadcaster.subscribe('doc-alpha', (event) => broadcasts.push(event));

    try {
      const actor = { userId: 'user-fictional-1', partyId: null, groupId: null };
      const op1 = makeMarkupCreate('op-idem-1', 'm-idem-1', 'Initial note');

      const first = await server.pipeline.submitOperation(op1, actor);
      assert.equal(first.ok, true);
      if (!first.ok) throw new Error('expected ok');
      assert.equal(first.seq, 1);
      assert.equal(first.replayed, undefined);
      assert.equal(broadcasts.length, 1);

      // Verify state + events + op_results in Postgres
      const markupRow = await dbHandle.db.selectFrom('markups').selectAll().where('id', '=', 'm-idem-1').executeTakeFirst();
      assert.ok(markupRow);
      assert.equal(markupRow.owner_user_id, actor.userId);
      assert.equal(markupRow.rev, 1);

      const eventRows = await dbHandle.db.selectFrom('events').selectAll().where('stream_id', '=', 'doc-alpha').execute();
      assert.equal(eventRows.length, 1);
      assert.equal(Number(eventRows[0]!.seq), 1);

      // Retry with same opId and identical content (different key order)
      const op1Reordered: Operation = {
        payload: {
          content: {
            text: 'Initial note',
            style: { opacity: 1, width: 2, fill: null, stroke: '#d00000' },
          },
          type: 'rect',
          scopeId: 'scope-alpha',
        },
        entityId: 'm-idem-1',
        type: 'markup.create',
        streamId: 'doc-alpha',
        schemaVersion: PROTOCOL_VERSION,
        opId: 'op-idem-1',
      };
      const retry = await server.pipeline.submitOperation(op1Reordered, actor);
      assert.equal(retry.ok, true);
      if (!retry.ok) throw new Error('expected ok');
      assert.equal(retry.seq, 1);
      assert.equal(retry.replayed, true);
      assert.equal(retry.receivedAt, first.receivedAt);
      // No duplicate broadcast or event
      assert.equal(broadcasts.length, 1);
      const eventsAfterRetry = await dbHandle.db.selectFrom('events').selectAll().where('stream_id', '=', 'doc-alpha').execute();
      assert.equal(eventsAfterRetry.length, 1);

      // Reuse same opId with different content -> refused
      const op1Mutated = makeMarkupCreate('op-idem-1', 'm-idem-1', 'Tampered note');
      const conflict = await server.pipeline.submitOperation(op1Mutated, actor);
      assert.equal(conflict.ok, false);
      if (conflict.ok) throw new Error('expected rejection');
      assert.equal(conflict.rejection.code, 'op_id_conflict');
      assert.equal(broadcasts.length, 1);
    } finally {
      unsubscribe();
      await server.app.close();
    }
  });

  it('never broadcasts before commit, emits zero broadcasts on rollback, and replays committed result after post-commit fault', async () => {
    const config = makeConfig();
    const actor = { userId: 'user-fault-1', partyId: null, groupId: null };

    // 1. Pre-commit error rolls back transaction and emits zero broadcasts
    let failBeforeCommit = true;
    const broadcastsPre: StreamEvent[] = [];
    const serverPre = buildServer({
      config,
      db: dbHandle.db,
      pool: dbHandle.pool,
      pipelineHooks: {
        onBeforeCommit: () => {
          if (failBeforeCommit) {
            throw new Error('simulated pre-commit failure');
          }
        },
      },
    });
    const unsubPre = serverPre.broadcaster.subscribe('doc-fault', (e) => broadcastsPre.push(e));

    try {
      const opRollback = makeMarkupCreate('op-rollback-1', 'm-rollback-1', 'Should roll back', 'doc-fault');
      await assert.rejects(() => serverPre.pipeline.submitOperation(opRollback, actor), /simulated pre-commit failure/);
      assert.equal(broadcastsPre.length, 0);

      const persisted = await dbHandle.db.selectFrom('markups').selectAll().where('id', '=', 'm-rollback-1').executeTakeFirst();
      assert.equal(persisted, undefined);
      const events = await dbHandle.db.selectFrom('events').selectAll().where('stream_id', '=', 'doc-fault').execute();
      assert.equal(events.length, 0);
    } finally {
      failBeforeCommit = false;
      unsubPre();
      await serverPre.app.close();
    }

    // 2. Post-commit / pre-ack fault: no broadcast occurred before commit; DB has committed row; retry returns committed result
    let failAfterCommit = true;
    let broadcastsAtHookTime = -1;
    const broadcastsPost: StreamEvent[] = [];
    const serverPost = buildServer({
      config,
      db: dbHandle.db,
      pool: dbHandle.pool,
      pipelineHooks: {
        onAfterCommitBeforeAck: () => {
          broadcastsAtHookTime = broadcastsPost.length;
          if (failAfterCommit) {
            throw new Error('simulated crash between commit and ack');
          }
        },
      },
    });
    const unsubPost = serverPost.broadcaster.subscribe('doc-fault', (e) => broadcastsPost.push(e));

    try {
      const opCommit = makeMarkupCreate('op-postcommit-1', 'm-postcommit-1', 'Committed before crash', 'doc-fault');
      await assert.rejects(
        () => serverPost.pipeline.submitOperation(opCommit, actor),
        /simulated crash between commit and ack/,
      );

      // Zero broadcasts had been sent before or during commit
      assert.equal(broadcastsAtHookTime, 0);
      assert.equal(broadcastsPost.length, 0);

      // The row IS durably committed in Postgres
      const committedMarkup = await dbHandle.db.selectFrom('markups').selectAll().where('id', '=', 'm-postcommit-1').executeTakeFirst();
      assert.ok(committedMarkup);
      const committedEvents = await dbHandle.db.selectFrom('events').selectAll().where('stream_id', '=', 'doc-fault').execute();
      assert.equal(committedEvents.length, 1);

      // Client retries the same opId after recovering -> returns original committed result without duplicating
      failAfterCommit = false;
      const retry = await serverPost.pipeline.submitOperation(opCommit, actor);
      assert.equal(retry.ok, true);
      if (!retry.ok) throw new Error('expected ok');
      assert.equal(retry.seq, 1);
      assert.equal(retry.replayed, true);

      const eventsAfterRetry = await dbHandle.db.selectFrom('events').selectAll().where('stream_id', '=', 'doc-fault').execute();
      assert.equal(eventsAfterRetry.length, 1);
    } finally {
      unsubPost();
      await serverPost.app.close();
    }
  });

  it('rate limits /auth/login per client: the 11th attempt in a window gets 429', async () => {
    await createLocalUser(dbHandle.db, { email: 'lin@example.test', name: 'Lin Checker', password: 'fictional-pass-456' });
    const config = makeConfig();
    assert.equal(config.loginRateLimitMax, 10);
    const server = buildServer({ config, db: dbHandle.db, pool: dbHandle.pool });
    const baseUrl = await server.app.listen({ host: config.host, port: 0 });
    try {
      const attempt = () =>
        fetch(`${baseUrl}/auth/login`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: baseUrl },
          body: JSON.stringify({ email: 'lin@example.test', password: 'wrong-guess-000' }),
        });
      for (let i = 0; i < 10; i++) {
        const res = await attempt();
        assert.equal(res.status, 401, `attempt ${i + 1}`);
      }
      const limited = await attempt();
      assert.equal(limited.status, 429);
      // The correct password is refused too while the client is limited.
      const correct = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: baseUrl },
        body: JSON.stringify({ email: 'lin@example.test', password: 'fictional-pass-456' }),
      });
      assert.equal(correct.status, 429);
      // Other routes are not limited.
      assert.equal((await fetch(`${baseUrl}/healthz`)).status, 200);
    } finally {
      await server.app.close();
    }
  });

  it('refuses a markup or placement create whose id belongs to another stream', async () => {
    const server = buildServer({ config: makeConfig(), db: dbHandle.db, pool: dbHandle.pool });
    const seenOnA: StreamEvent[] = [];
    const unsubscribe = server.broadcaster.subscribe('stream-a', (e) => seenOnA.push(e));
    const alice = { userId: 'user-alice', partyId: null, groupId: null };
    const bob = { userId: 'user-bob', partyId: null, groupId: null };
    try {
      const aliceCreate = await server.pipeline.submitOperation(makeMarkupCreate('op-a1', 'm-shared', 'Alice note', 'stream-a'), alice);
      assert.equal(aliceCreate.ok, true);
      const alicePlace = await server.pipeline.submitOperation(makePlacementCreate('op-a2', 'p-shared', 'm-shared', 'stream-a'), alice);
      assert.equal(alicePlace.ok, true);

      // Same markup id on another stream.
      const bobCreate = await server.pipeline.submitOperation(makeMarkupCreate('op-b1', 'm-shared', 'Bob note', 'stream-b'), bob);
      assert.deepEqual(rejectionOf(bobCreate), { code: 'exists', kind: 'markup', id: 'm-shared' });

      // Same placement id on another stream (on a markup that stream does own).
      assert.equal((await server.pipeline.submitOperation(makeMarkupCreate('op-b2', 'm-bob', 'Bob own', 'stream-b'), bob)).ok, true);
      const bobPlace = await server.pipeline.submitOperation(makePlacementCreate('op-b3', 'p-shared', 'm-bob', 'stream-b'), bob);
      assert.deepEqual(rejectionOf(bobPlace), { code: 'exists', kind: 'placement', id: 'p-shared' });

      // A placement on another stream's markup reads that markup as not found.
      const crossPlace = await server.pipeline.submitOperation(makePlacementCreate('op-b4', 'p-cross', 'm-shared', 'stream-b'), bob);
      assert.deepEqual(rejectionOf(crossPlace), { code: 'not_found', kind: 'markup', id: 'm-shared' });

      // The batch path refuses too, at the offending index.
      const batch = await server.pipeline.submitBatch(
        batched('batch-b', [
          makeMarkupCreate('op-b5', 'm-bob-2', 'Fine', 'stream-b'),
          makeMarkupCreate('op-b6', 'm-shared', 'Bob again', 'stream-b'),
        ]),
        bob,
      );
      assert.deepEqual(batch, {
        ok: false,
        index: 1,
        opId: 'op-b6',
        rejection: { code: 'exists', kind: 'markup', id: 'm-shared' },
      } satisfies BatchAck);

      const markup = await dbHandle.db.selectFrom('markups').selectAll().where('id', '=', 'm-shared').executeTakeFirstOrThrow();
      assert.equal(markup.stream_id, 'stream-a');
      assert.equal(markup.owner_user_id, 'user-alice');
      const record = markup.record_json as { content: { text: string }; owner: { userId: string } };
      assert.equal(record.content.text, 'Alice note');
      assert.equal(record.owner.userId, 'user-alice');
      const placement = await dbHandle.db.selectFrom('placements').selectAll().where('id', '=', 'p-shared').executeTakeFirstOrThrow();
      assert.equal(placement.stream_id, 'stream-a');
      assert.equal(placement.markup_id, 'm-shared');
      assert.equal(seenOnA.length, 2);
      assert.equal(await dbHandle.db.selectFrom('markups').select('id').where('id', '=', 'm-bob-2').executeTakeFirst(), undefined);
    } finally {
      unsubscribe();
      await server.app.close();
    }
  });

  it('refuses the loser when two streams create the same markup id at the same time', async () => {
    const hold = gate();
    const server = buildServer({
      config: makeConfig(),
      db: dbHandle.db,
      pool: dbHandle.pool,
      pipelineHooks: {
        onBeforeCommit: async ({ streamId }) => {
          if (streamId === 'stream-race-a') await hold.wait;
        },
      },
    });
    const actor = { userId: 'user-race', partyId: null, groupId: null };
    try {
      const first = server.pipeline.submitOperation(makeMarkupCreate('op-ra', 'm-race', 'First', 'stream-race-a'), actor);
      await new Promise((resolve) => setTimeout(resolve, 100));
      // The second insert passes the ownership pre-check (the first is uncommitted) and then
      // blocks on the primary key until the first commits.
      const second = server.pipeline.submitOperation(makeMarkupCreate('op-rb', 'm-race', 'Second', 'stream-race-b'), actor);
      await waitForLockWaiter(dbHandle.pool);
      hold.open();
      const [a, b] = await Promise.all([first, second]);
      assert.equal(a.ok, true);
      assert.deepEqual(rejectionOf(b), { code: 'exists', kind: 'markup', id: 'm-race' });
      const row = await dbHandle.db.selectFrom('markups').selectAll().where('id', '=', 'm-race').executeTakeFirstOrThrow();
      assert.equal(row.stream_id, 'stream-race-a');
      assert.equal((row.record_json as { content: { text: string } }).content.text, 'First');
      const eventsB = await dbHandle.db.selectFrom('events').select('seq').where('stream_id', '=', 'stream-race-b').execute();
      assert.equal(eventsB.length, 0);
    } finally {
      hold.open();
      await server.app.close();
    }
  });

  it('answers op_id_conflict, not an internal error, when one opId races on two streams', async () => {
    for (const mode of ['op', 'batch'] as const) {
      await dbHandle.pool.query('TRUNCATE events, placements, markups, op_results, streams CASCADE');
      const hold = gate();
      const server = buildServer({
        config: makeConfig(),
        db: dbHandle.db,
        pool: dbHandle.pool,
        pipelineHooks: {
          onBeforeCommit: async ({ streamId }) => {
            if (streamId === 'stream-c') await hold.wait;
          },
        },
      });
      const actor = { userId: 'user-race', partyId: null, groupId: null };
      try {
        const opC = makeMarkupCreate('op-x', 'm-c', 'On C', 'stream-c');
        const opD = makeMarkupCreate('op-x', 'm-d', 'On D', 'stream-d');
        const submit = (op: Operation) =>
          mode === 'op' ? server.pipeline.submitOperation(op, actor) : server.pipeline.submitBatch(batched(`batch-${op.streamId}`, [op]), actor);
        const first = submit(opC);
        await new Promise((resolve) => setTimeout(resolve, 100));
        const second = submit(opD);
        await waitForLockWaiter(dbHandle.pool);
        hold.open();
        const [c, d] = await Promise.allSettled([first, second]);
        assert.equal(c.status, 'fulfilled', mode);
        assert.equal(d.status, 'fulfilled', `${mode}: ${d.status === 'rejected' ? String(d.reason) : ''}`);
        if (c.status !== 'fulfilled' || d.status !== 'fulfilled') return;
        assert.equal(c.value.ok, true, mode);
        assert.equal(d.value.ok, false, mode);
        if (!d.value.ok) assert.equal(d.value.rejection.code, 'op_id_conflict', mode);
        const markupD = await dbHandle.db.selectFrom('markups').select('id').where('id', '=', 'm-d').executeTakeFirst();
        assert.equal(markupD, undefined, mode);
      } finally {
        hold.open();
        await server.app.close();
      }
    }
  });

  it("does not replay one actor's stored result to another actor", async () => {
    const server = buildServer({ config: makeConfig(), db: dbHandle.db, pool: dbHandle.pool });
    const alice = { userId: 'user-alice', partyId: null, groupId: null };
    const bob = { userId: 'user-bob', partyId: null, groupId: null };
    try {
      const op = makeMarkupCreate('op-own-1', 'm-own-1', 'Alice only');
      const first = await server.pipeline.submitOperation(op, alice);
      assert.equal(first.ok, true);

      const bobReplay = await server.pipeline.submitOperation(op, bob);
      assert.equal(rejectionOf(bobReplay).code, 'op_id_conflict');
      assert.equal(bobReplay.replayed, undefined);

      const aliceReplay = await server.pipeline.submitOperation(op, alice);
      assert.equal(aliceReplay.ok, true);
      assert.equal(aliceReplay.replayed, true);

      const batchOps = batched('batch-own', [makeMarkupCreate('op-own-2', 'm-own-2', 'Alice batch')]);
      assert.equal((await server.pipeline.submitBatch(batchOps, alice)).ok, true);
      const bobBatch = await server.pipeline.submitBatch(batchOps, bob);
      assert.equal(bobBatch.ok, false);
      if (!bobBatch.ok) assert.equal(bobBatch.rejection.code, 'op_id_conflict');
      const aliceBatch = await server.pipeline.submitBatch(batchOps, alice);
      assert.equal(aliceBatch.ok, true);
      if (aliceBatch.ok) assert.equal(aliceBatch.results[0]!.replayed, true);
    } finally {
      await server.app.close();
    }
  });

  it('handles frames on one WS connection in order: a patch sent right after its create applies', async () => {
    await createLocalUser(dbHandle.db, { email: 'ord@example.test', name: 'Ord Tester', password: 'fictional-pass-789' });
    const config = makeConfig();
    const server = buildServer({ config, db: dbHandle.db, pool: dbHandle.pool });
    const baseUrl = await server.app.listen({ host: config.host, port: 0 });
    const wsUrl = `${baseUrl.replace(/^http/, 'ws')}/ws`;
    try {
      const cookie = await login(baseUrl, 'ord@example.test', 'fictional-pass-789');
      const ws = await openHandshakenWs(wsUrl, baseUrl, cookie);
      try {
        const pairs = 20;
        const acks: OpAck[] = [];
        const done = new Promise<void>((resolve) => {
          ws.on('message', (data) => {
            const msg = JSON.parse(data.toString()) as { type: string; result: OpAck };
            if (msg.type === 'ack') acks.push(msg.result);
            if (acks.length === pairs * 2) resolve();
          });
        });
        // Send every create and patch back to back without waiting for any ack.
        for (let i = 0; i < pairs; i++) {
          ws.send(JSON.stringify({ type: 'op', op: makeMarkupCreate(`op-c-${i}`, `m-ord-${i}`, 'Draft', 'doc-order') }));
          ws.send(JSON.stringify({ type: 'op', op: makeMarkupPatch(`op-p-${i}`, `m-ord-${i}`, 'Final', `op-c-${i}`, 'doc-order') }));
        }
        await done;
        assert.deepEqual(
          acks.map((a) => a.opId),
          Array.from({ length: pairs }, (_, i) => [`op-c-${i}`, `op-p-${i}`]).flat(),
        );
        for (const ack of acks) assert.equal(ack.ok, true, JSON.stringify(ack));
        const rows = await dbHandle.db.selectFrom('markups').select(['id', 'record_json']).where('stream_id', '=', 'doc-order').execute();
        assert.equal(rows.length, pairs);
        for (const row of rows) assert.equal((row.record_json as { content: { text: string } }).content.text, 'Final');
      } finally {
        ws.close();
      }
    } finally {
      await server.app.close();
    }
  });

  it('closes open WS connections when their session is logged out, disabled, or expires', async () => {
    const user = await createLocalUser(dbHandle.db, { email: 'ses@example.test', name: 'Ses Tester', password: 'fictional-pass-321' });
    const config = makeConfig();
    const server = buildServer({ config, db: dbHandle.db, pool: dbHandle.pool });
    const baseUrl = await server.app.listen({ host: config.host, port: 0 });
    const wsUrl = `${baseUrl.replace(/^http/, 'ws')}/ws`;
    try {
      // Logout closes every socket of that session at once, and only those.
      const cookieA = await login(baseUrl, 'ses@example.test', 'fictional-pass-321');
      const cookieB = await login(baseUrl, 'ses@example.test', 'fictional-pass-321');
      const wsA1 = await openHandshakenWs(wsUrl, baseUrl, cookieA);
      const wsA2 = await openHandshakenWs(wsUrl, baseUrl, cookieA);
      const wsB = await openHandshakenWs(wsUrl, baseUrl, cookieB);
      const closedA1 = waitForClose(wsA1);
      const closedA2 = waitForClose(wsA2);
      const logout = await fetch(`${baseUrl}/auth/logout`, { method: 'POST', headers: { cookie: cookieA, origin: baseUrl } });
      assert.equal(logout.status, 200);
      assert.equal(await closedA1, WS_CLOSE_SESSION_ENDED);
      assert.equal(await closedA2, WS_CLOSE_SESSION_ENDED);
      assert.equal(wsB.readyState, WebSocket.OPEN);

      // Disabling the user is picked up by the periodic session re-check.
      const closedB = waitForClose(wsB);
      await dbHandle.db.updateTable('users').set({ disabled_at: new Date() }).where('id', '=', user.id).execute();
      await server.ws.revalidateSessions();
      assert.equal(await closedB, WS_CLOSE_SESSION_ENDED);

      // A session that expires while connected is closed on its next frame.
      await dbHandle.db.updateTable('users').set({ disabled_at: null }).where('id', '=', user.id).execute();
      const cookieC = await login(baseUrl, 'ses@example.test', 'fictional-pass-321');
      const wsC = await openHandshakenWs(wsUrl, baseUrl, cookieC);
      const closedC = waitForClose(wsC);
      await dbHandle.db.updateTable('sessions').set({ expires_at: new Date(Date.now() - 1000) }).where('user_id', '=', user.id).execute();
      await server.ws.revalidateSessions();
      assert.equal(await closedC, WS_CLOSE_SESSION_ENDED);
    } finally {
      await server.app.close();
    }
  });

  it('refuses to migrate, and reports, a database migrated by a newer build', async () => {
    await dbHandle.pool.query(`INSERT INTO schema_migrations (version, name, checksum) VALUES ('9999', 'from_the_future', 'x')`);
    try {
      const status = await checkMigrations(dbHandle.pool);
      assert.deepEqual(status.unknown, ['9999']);
      await assert.rejects(() => runMigrations(dbHandle.pool), /newer version/);
      const stderr: string[] = [];
      const code = await runCli(['migrate', '--check'], {
        stdout: () => {},
        stderr: (line) => stderr.push(line),
        readStdin: async () => '',
        env: { DATABASE_URL: DATABASE_URL! },
      });
      assert.equal(code, 1);
      assert.match(stderr.join('\n'), /Unknown migrations in database.*9999/);
    } finally {
      await dbHandle.pool.query(`DELETE FROM schema_migrations WHERE version = '9999'`);
    }
  });

  it('serves /config.json, static web assets, SPA fallback, and refuses path traversal', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'rc-web-static-'));
    const webDir = join(tempRoot, 'dist');
    const assetsDir = join(webDir, 'assets');
    await mkdir(assetsDir, { recursive: true });
    await writeFile(join(tempRoot, 'secret.txt'), 'top-secret-outside-root', 'utf8');
    await writeFile(join(webDir, 'index.html'), '<!doctype html><html><body>redcolumn-app</body></html>', 'utf8');
    await writeFile(join(assetsDir, 'main-abc123.js'), 'console.log("ok");', 'utf8');

    const config = makeConfig({ webDistDir: webDir });
    const server = buildServer({ config, db: dbHandle.db, pool: dbHandle.pool });
    const baseUrl = await server.app.listen({ host: config.host, port: 0 });

    try {
      // /config.json
      const cfgRes = await fetch(`${baseUrl}/config.json`);
      assert.equal(cfgRes.status, 200);
      assert.equal(cfgRes.headers.get('cache-control'), 'no-store');
      const cfgBody = (await cfgRes.json()) as { mode: string; origin: string; version: string; auth: { local: boolean } };
      assert.equal(cfgBody.mode, 'server');
      assert.equal(cfgBody.origin, baseUrl);
      assert.equal(typeof cfgBody.version, 'string');
      assert.deepEqual(cfgBody.auth, { local: true });

      // Root index.html with no-cache
      const indexRes = await fetch(`${baseUrl}/`);
      assert.equal(indexRes.status, 200);
      assert.equal(indexRes.headers.get('cache-control'), 'no-cache');
      assert.match(indexRes.headers.get('content-type') ?? '', /text\/html/);
      assert.match(await indexRes.text(), /redcolumn-app/);

      // Hashed asset with immutable cache header
      const assetRes = await fetch(`${baseUrl}/assets/main-abc123.js`);
      assert.equal(assetRes.status, 200);
      assert.equal(assetRes.headers.get('cache-control'), 'public, max-age=31536000, immutable');
      assert.match(assetRes.headers.get('content-type') ?? '', /text\/javascript/);
      assert.equal(await assetRes.text(), 'console.log("ok");');

      // SPA fallback on client route
      const spaRes = await fetch(`${baseUrl}/invite/some-token-12345`);
      assert.equal(spaRes.status, 200);
      assert.equal(spaRes.headers.get('cache-control'), 'no-cache');
      assert.match(await spaRes.text(), /redcolumn-app/);

      // Missing asset file returns 404 (not index.html)
      const missingAsset = await fetch(`${baseUrl}/assets/does-not-exist.js`);
      assert.equal(missingAsset.status, 404);

      // Unknown API route returns 404 (not index.html)
      const missingApi = await fetch(`${baseUrl}/api/does-not-exist`);
      assert.equal(missingApi.status, 404);

      // Raw and percent-encoded path traversal are refused and never leak files outside WEB_DIST_DIR
      const rawGet = (rawPath: string) =>
        new Promise<{ status: number; body: string }>((resolve, reject) => {
          const parsed = new URL(baseUrl);
          const req = http.request(
            { hostname: parsed.hostname, port: Number(parsed.port), path: rawPath, method: 'GET' },
            (res) => {
              let body = '';
              res.setEncoding('utf8');
              res.on('data', (chunk) => (body += chunk));
              res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
            },
          );
          req.on('error', reject);
          req.end();
        });

      for (const badPath of ['/../secret.txt', '/%2e%2e/secret.txt', '/assets/../../secret.txt']) {
        const traversalRes = await rawGet(badPath);
        assert.equal(traversalRes.status, 403, `expected 403 for ${badPath}`);
        assert.doesNotMatch(traversalRes.body, /top-secret-outside-root/);
      }
    } finally {
      await server.app.close();
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('previews and accepts single-use invites and lists only accessible sessions', async () => {
    const admin = await createLocalUser(dbHandle.db, {
      email: 'admin@northbridge.example',
      name: 'Admin User',
      password: 'fictional-admin-pass',
      role: 'admin',
    });
    const otherUser = await createLocalUser(dbHandle.db, {
      email: 'other@northbridge.example',
      name: 'Other Reviewer',
      password: 'fictional-other-pass',
    });

    await dbHandle.db.insertInto('workspaces').values({ id: 'ws-1', name: 'Northbridge' }).execute();
    await dbHandle.db
      .insertInto('projects')
      .values([
        { id: 'prj-1', workspace_id: 'ws-1', name: 'Harbour Bridge', number: 'NB-101' },
        { id: 'prj-2', workspace_id: 'ws-1', name: 'South Tunnel', number: 'NB-202' },
      ])
      .execute();
    await dbHandle.db
      .insertInto('scopes')
      .values([
        { id: 'sc-1', project_id: 'prj-1', kind: 'session', name: 'IFC Structural Check', session_state: 'open' },
        { id: 'sc-2', project_id: 'prj-2', kind: 'review', name: 'Tunnel Review', session_state: null },
      ])
      .execute();

    const invite = await createInvite(dbHandle.db, {
      email: 'guest@northbridge.example',
      name: 'Guest Reviewer',
      projectId: 'prj-1',
      scopeId: 'sc-1',
      createdBy: admin.id,
    });

    const config = makeConfig();
    const server = buildServer({ config, db: dbHandle.db, pool: dbHandle.pool });
    const baseUrl = await server.app.listen({ host: config.host, port: 0 });

    try {
      // Unauthenticated /api/sessions is rejected
      const unauthSessions = await fetch(`${baseUrl}/api/sessions`);
      assert.equal(unauthSessions.status, 401);

      // Preview valid invite without leaking sensitive fields
      const previewRes = await fetch(`${baseUrl}/api/invites/${encodeURIComponent(invite.token)}`);
      assert.equal(previewRes.status, 200);
      const previewBody = (await previewRes.json()) as {
        invite: { email: string; projectName: string | null; scopeName: string | null; hasAccount: boolean };
      };
      assert.equal(previewBody.invite.email, 'guest@northbridge.example');
      assert.equal(previewBody.invite.projectName, 'Harbour Bridge');
      assert.equal(previewBody.invite.scopeName, 'IFC Structural Check');
      assert.equal(previewBody.invite.hasAccount, false);

      // Unknown invite returns 404
      const unknownPreview = await fetch(`${baseUrl}/api/invites/not-a-real-token`);
      assert.equal(unknownPreview.status, 404);

      // Accept invite as new user -> creates account, sets session cookie, adds project membership
      const acceptRes = await fetch(`${baseUrl}/api/invites/${encodeURIComponent(invite.token)}/accept`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: baseUrl },
        body: JSON.stringify({ name: 'Guest Reviewer', password: 'fictional-guest-pass' }),
      });
      assert.equal(acceptRes.status, 200);
      const guestCookie = (acceptRes.headers.get('set-cookie') ?? '').split(';')[0]!;
      assert.ok(guestCookie.startsWith(`${config.sessionCookieName}=`));

      // Replaying the single-use invite is rejected
      const replayRes = await fetch(`${baseUrl}/api/invites/${encodeURIComponent(invite.token)}/accept`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: baseUrl },
        body: JSON.stringify({ name: 'Guest Reviewer', password: 'fictional-guest-pass' }),
      });
      assert.equal(replayRes.status, 409);

      // Guest sees only prj-1 / sc-1, never prj-2 / sc-2
      const guestSessionsRes = await fetch(`${baseUrl}/api/sessions`, {
        headers: { cookie: guestCookie },
      });
      assert.equal(guestSessionsRes.status, 200);
      const guestSessions = (await guestSessionsRes.json()) as {
        projects: { id: string }[];
        sessions: { id: string }[];
      };
      assert.deepEqual(
        guestSessions.projects.map((p) => p.id),
        ['prj-1'],
      );
      assert.deepEqual(
        guestSessions.sessions.map((s) => s.id),
        ['sc-1'],
      );

      // Other user with no project memberships gets empty lists
      const otherCookie = await login(baseUrl, otherUser.email, 'fictional-other-pass');
      const otherSessionsRes = await fetch(`${baseUrl}/api/sessions`, {
        headers: { cookie: otherCookie },
      });
      assert.equal(otherSessionsRes.status, 200);
      assert.deepEqual(await otherSessionsRes.json(), { projects: [], sessions: [] });
    } finally {
      await server.app.close();
    }
  });
});
