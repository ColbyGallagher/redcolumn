import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { PROTOCOL_VERSION, type Operation } from '@nb/ops';
import WebSocket from 'ws';
import { buildServer, type ServerInstance } from './app.ts';
import type { StreamEvent } from './broadcaster.ts';
import { runCli } from './cli.ts';
import { loadConfig, type ServerConfig } from './config.ts';
import { createDb, type DbHandle } from './db.ts';
import { checkMigrations, runMigrations } from './migrate.ts';
import type { OpAck } from './pipeline.ts';

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
    await dbHandle.pool.query('TRUNCATE events, placements, markups, op_results, streams, sessions, users CASCADE');
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
});
