// Two real clients (`SyncDocument` over `WsSyncTransport`) against the real server and Postgres.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import { PROTOCOL_VERSION, type Operation } from '@nb/ops';
import { MemorySyncPersistence, SyncDocument, WsSyncTransport, type PresenceUser, type SyncPersistence, type WebSocketLike } from '@nb/sync';
import WebSocket from 'ws';
import { buildServer, type ServerInstance } from './app.ts';
import { createLocalUser, type UserProfile } from './auth.ts';
import { loadConfig, type ServerConfig } from './config.ts';
import { createDb, type DbHandle, type ProjectRole } from './db.ts';
import { runMigrations } from './migrate.ts';
import type { OpPipelineHooks } from './pipeline.ts';
import { CursorSealer, ensureReaderRole, READER_ROLE } from './syncFeed.ts';
import { addMember, blankPdf, createDocumentFixture, FrameInbox, type DocumentFixture } from './testSupport.ts';

const DATABASE_URL = process.env.DATABASE_URL?.trim();
if (!DATABASE_URL && process.env.REQUIRE_POSTGRES_TESTS === '1') {
  throw new Error('REQUIRE_POSTGRES_TESTS=1 is set but DATABASE_URL is not configured');
}

type Markup = Parameters<SyncDocument['add']>[0];

const PASSWORD = 'fictional-pass-246810';

interface Person {
  user: UserProfile;
  cookie: string;
}

interface Client {
  doc: SyncDocument;
  transport: WsSyncTransport;
  /** The sockets made so far, newest last. */
  sockets: WebSocket[];
  presence: () => PresenceUser[];
}

async function waitFor(condition: () => boolean, what: string, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) assert.fail(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const settled = (client: Client) => client.doc.sync.connection === 'connected' && client.doc.sync.pendingCount === 0;

function rectangle(author: string, patch: Partial<Markup> = {}): Markup {
  const now = Date.now();
  return {
    id: randomUUID(),
    type: 'rect',
    pageIndex: 0,
    points: [[40, 40], [160, 120]],
    style: { stroke: '#d00000', fill: null, width: 2, opacity: 1 },
    comment: 'Check the beam depth',
    status: 'none',
    author,
    createdAt: now,
    modifiedAt: now,
    ...patch,
  };
}

describe('server documents over WebSocket (Postgres 17)', { skip: !DATABASE_URL ? 'DATABASE_URL is not set' : false }, () => {
  let dbHandle: DbHandle;
  let blobDir: string;
  let config: ServerConfig;
  let server: ServerInstance;
  let baseUrl: string;
  const clients: Client[] = [];
  let hooks: OpPipelineHooks = {};

  before(async () => {
    dbHandle = createDb(DATABASE_URL!);
    await runMigrations(dbHandle.pool);
    await ensureReaderRole(dbHandle.pool);
    blobDir = await mkdtemp(join(tmpdir(), 'rc-sync-blobs-'));
  });

  after(async () => {
    await dbHandle.close();
    await rm(blobDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await dbHandle.pool.query(
      'TRUNCATE invites, scopes, project_members, projects, workspaces, events, placements, markups, op_results, streams, sessions, users, item_access, item_draft_access, item_versions CASCADE',
    );
    config = {
      ...loadConfig({
        DATABASE_URL: DATABASE_URL!,
        HOST: '127.0.0.1',
        PORT: '0',
        LOG_LEVEL: 'silent',
        COOKIE_SECURE: 'false',
        AUTO_MIGRATE: 'false',
        BLOB_DIR: blobDir,
      }),
    };
    hooks = {};
    server = buildServer({
      config,
      db: dbHandle.db,
      pool: dbHandle.pool,
      pipelineHooks: { onAfterCommitBeforeAck: (ctx) => hooks.onAfterCommitBeforeAck?.(ctx) },
    });
    baseUrl = await server.app.listen({ host: config.host, port: 0 });
  });

  afterEach(async () => {
    for (const client of clients.splice(0)) {
      await client.doc.disconnect();
      await client.doc.destroy();
    }
    await server.app.close();
  });

  async function person(name: string): Promise<Person> {
    const email = `${name.toLowerCase().replace(/\W+/g, '.')}@example.test`;
    const user = await createLocalUser(dbHandle.db, { email, name, password: PASSWORD });
    const res = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: baseUrl },
      body: JSON.stringify({ email, password: PASSWORD }),
    });
    assert.equal(res.status, 200);
    return { user, cookie: (res.headers.get('set-cookie') ?? '').split(';')[0]! };
  }

  async function api(who: Person, path: string, init: RequestInit = {}): Promise<Response> {
    return fetch(`${baseUrl}${path}`, { ...init, headers: { cookie: who.cookie, origin: baseUrl, ...(init.headers ?? {}) } });
  }

  /** Opens a document as the viewer does: a `SyncDocument` over a `WsSyncTransport` with this person's cookie. */
  async function openClient(
    who: Person,
    fixture: DocumentFixture,
    options: { persistence?: SyncPersistence; connect?: boolean } = {},
  ): Promise<Client> {
    const sockets: WebSocket[] = [];
    const transport = new WsSyncTransport({
      url: `${baseUrl.replace(/^http/, 'ws')}/ws`,
      createSocket: (url) => {
        const socket = new WebSocket(url, { headers: { cookie: who.cookie, origin: baseUrl } });
        sockets.push(socket);
        return socket as unknown as WebSocketLike;
      },
      backoff: { minMs: 20, maxMs: 100 },
    });
    let present: PresenceUser[] = [];
    transport.onPresence((users) => {
      present = users;
    });
    const doc = await SyncDocument.open({
      streamId: fixture.documentId,
      scopeId: fixture.scopeId,
      revisionId: fixture.revisionId,
      pages: fixture.pageIds,
      actor: { userId: who.user.id, partyId: null, groupId: null },
      laneId: fixture.laneId,
      context: { actor: { id: who.user.id, name: who.user.name } },
      resolveAuthor: (actor) => actor.userId,
      transport,
      persistence: options.persistence ?? false,
    });
    transport.onReconnectDue(() => void doc.connect());
    const client: Client = { doc, transport, sockets, presence: () => present };
    clients.push(client);
    if (options.connect !== false) {
      await doc.connect();
      await waitFor(() => doc.sync.connection === 'connected', `${who.user.name} to connect`);
    }
    return client;
  }

  async function team(roles: { ben?: ProjectRole } = {}) {
    const ada = await person('Ada Admin');
    const ben = await person('Ben Reviewer');
    const fixture = await createDocumentFixture(dbHandle.db, ada.user, [{ userId: ben.user.id, role: roles.ben ?? 'reviewer' }]);
    return { ada, ben, fixture };
  }

  const storedMarkup = async (id: string) =>
    (await dbHandle.db.selectFrom('markups').select('record_json').where('id', '=', id).executeTakeFirstOrThrow())
      .record_json as { content: { comment?: string }; owner: { userId: string }; deleted: boolean };
  const storedPoints = async (markupId: string) =>
    (
      (await dbHandle.db.selectFrom('placements').select('record_json').where('markup_id', '=', markupId).executeTakeFirstOrThrow())
        .record_json as { geometry: { points: unknown } }
    ).geometry.points;

  it('keeps both edits when two people change different parts of one markup at the same time', async () => {
    const { ada, ben, fixture } = await team();
    const a = await openClient(ada, fixture);
    const b = await openClient(ben, fixture);

    const markup = rectangle(ben.user.name);
    b.doc.add(markup);
    await waitFor(() => !!a.doc.get(markup.id), 'Ada to see the new markup');
    await waitFor(() => settled(b), 'Ben to be synced');

    // Both edit before either has heard of the other's change: both leave in the same tick.
    b.doc.update(markup.id, { points: [[200, 200], [320, 280]] });
    a.doc.update(markup.id, { comment: 'Bolt grade is missing' });
    assert.equal(a.doc.sync.pendingCount, 1);
    assert.equal(b.doc.sync.pendingCount, 1);

    await waitFor(() => settled(a) && settled(b), 'both to be synced');
    await waitFor(
      () => a.doc.get(markup.id)!.points[0]![0] === 200 && b.doc.get(markup.id)!.comment === 'Bolt grade is missing',
      'each to see the other edit',
    );
    for (const client of [a, b]) {
      assert.equal(client.doc.sync.inbox.length, 0);
      assert.deepEqual(client.doc.get(markup.id)!.points, [[200, 200], [320, 280]]);
      assert.equal(client.doc.get(markup.id)!.comment, 'Bolt grade is missing');
    }
    assert.equal((await storedMarkup(markup.id)).content.comment, 'Bolt grade is missing');
    assert.deepEqual(await storedPoints(markup.id), [[200, 200], [320, 280]]);
    // Editing another person's markup does not change whose it is.
    assert.equal((await storedMarkup(markup.id)).owner.userId, ben.user.id);
  });

  it('keeps both edits when they were made offline and sent later', async () => {
    const { ada, ben, fixture } = await team();
    const a = await openClient(ada, fixture);
    const b = await openClient(ben, fixture);
    const markup = rectangle(ben.user.name);
    b.doc.add(markup);
    await waitFor(() => !!a.doc.get(markup.id) && settled(b), 'both to have the markup');

    await a.doc.disconnect();
    await b.doc.disconnect();
    b.doc.update(markup.id, { points: [[10, 300], [90, 360]] });
    a.doc.update(markup.id, { comment: 'Revise the splice' });
    assert.equal(a.doc.sync.connection, 'disconnected');
    assert.equal(a.doc.sync.pendingCount, 1);

    await a.doc.connect();
    await waitFor(() => settled(a), 'Ada to send her edit');
    await b.doc.connect();
    await waitFor(() => settled(b), 'Ben to send his edit');
    await waitFor(() => a.doc.get(markup.id)!.points[0]![1] === 300, 'Ada to receive the move');

    for (const client of [a, b]) {
      assert.equal(client.doc.sync.inbox.length, 0);
      assert.equal(client.doc.get(markup.id)!.comment, 'Revise the splice');
      assert.deepEqual(client.doc.get(markup.id)!.points, [[10, 300], [90, 360]]);
    }
  });

  it('rejects the later of two edits to the same part and keeps it in the inbox', async () => {
    const { ada, ben, fixture } = await team();
    const a = await openClient(ada, fixture);
    const b = await openClient(ben, fixture);
    const markup = rectangle(ben.user.name);
    b.doc.add(markup);
    await waitFor(() => !!a.doc.get(markup.id) && settled(b), 'both to have the markup');

    a.doc.update(markup.id, { comment: 'Ada wording' });
    b.doc.update(markup.id, { comment: 'Ben wording' });
    await waitFor(() => settled(a) && settled(b), 'both to be answered');
    await waitFor(() => a.doc.sync.inbox.length + b.doc.sync.inbox.length === 1, 'one edit to be rejected');

    const [winner, loser] = a.doc.sync.inbox.length ? [b, a] : [a, b];
    const winning = winner === a ? 'Ada wording' : 'Ben wording';
    await waitFor(() => loser.doc.get(markup.id)!.comment === winning, 'the loser to show the winning text');
    assert.equal(winner.doc.get(markup.id)!.comment, winning);
    assert.equal(loser.doc.sync.inbox[0]!.reason.code, 'conflict');
    assert.equal((await storedMarkup(markup.id)).content.comment, winning);
  });

  it('applies each operation once when the connection drops between commit and answer', async () => {
    const { ben, fixture } = await team();
    const b = await openClient(ben, fixture);
    let failures = 1;
    hooks.onAfterCommitBeforeAck = () => {
      if (failures-- > 0) throw new Error('simulated crash between commit and answer');
    };
    const markup = rectangle(ben.user.name);
    b.doc.add(markup);

    await waitFor(() => settled(b) && b.sockets.length > 1, 'the client to reconnect and be synced');
    assert.equal(b.doc.sync.inbox.length, 0);
    assert.ok(b.doc.get(markup.id));
    const events = await dbHandle.db.selectFrom('events').select('op_id').where('stream_id', '=', fixture.documentId).execute();
    assert.equal(events.length, 2, 'the markup and its placement, once each');
  });

  it('reconnects by itself, catches up and sends what was waiting', async () => {
    const { ada, ben, fixture } = await team();
    const a = await openClient(ada, fixture);
    const b = await openClient(ben, fixture);
    const first = rectangle(ben.user.name);
    b.doc.add(first);
    await waitFor(() => !!a.doc.get(first.id), 'Ada to see the first markup');

    b.sockets.at(-1)!.terminate();
    await waitFor(() => b.doc.sync.connection !== 'connected', 'Ben to notice the drop');
    const second = rectangle(ben.user.name, { comment: 'Drawn while offline' });
    b.doc.add(second);
    const third = rectangle(ada.user.name, { comment: 'Drawn meanwhile' });
    a.doc.add(third);

    await waitFor(() => !!b.doc.get(third.id) && !!a.doc.get(second.id), 'both to have everything');
    await waitFor(() => settled(a) && settled(b), 'both to be synced');
    assert.equal(a.doc.all().length, 3);
    assert.equal(b.doc.all().length, 3);
  });

  it('shows who else has the document open and on which page, without storing it', async () => {
    const { ada, ben, fixture } = await team();
    const a = await openClient(ada, fixture);
    const b = await openClient(ben, fixture);
    b.transport.setPage(1);
    const others = () => a.presence().filter((u) => u.connectionId !== a.transport.connectionId);
    await waitFor(() => others()[0]?.pageIndex === 1, "Ada to see Ben's page");
    assert.deepEqual(
      others().map((u) => [u.userId, u.name, u.pageIndex]),
      [[ben.user.id, ben.user.name, 1]],
    );
    await b.doc.disconnect();
    await waitFor(() => others().length === 0, 'Ben to disappear');
    const events = await dbHandle.db.selectFrom('events').select('op_id').execute();
    assert.equal(events.length, 0);
  });

  it('lets reviewers change only their own markups, and viewers change nothing', async () => {
    const { ada, ben, fixture } = await team();
    const vic = await person('Vic Viewer');
    await addMember(dbHandle.db, fixture, vic.user.id, 'viewer');
    const a = await openClient(ada, fixture);
    const b = await openClient(ben, fixture);
    const v = await openClient(vic, fixture);

    const adas = rectangle(ada.user.name);
    a.doc.add(adas);
    await waitFor(() => !!b.doc.get(adas.id) && !!v.doc.get(adas.id), 'everyone to see the markup');

    // The client has no edit rule here, so the server is what refuses.
    b.doc.update(adas.id, { comment: 'Not mine to change' });
    await waitFor(() => b.doc.sync.inbox.length === 1 && settled(b), 'the reviewer to be refused');
    assert.equal(b.doc.sync.inbox[0]!.reason.code, 'forbidden');
    assert.equal(b.doc.get(adas.id)!.comment, 'Check the beam depth');

    const drawn = rectangle(vic.user.name);
    v.doc.add(drawn);
    await waitFor(() => v.doc.sync.inbox.length === 1 && settled(v), 'the viewer to be refused');
    assert.equal(v.doc.sync.inbox[0]!.reason.code, 'forbidden');
    assert.equal(v.doc.get(drawn.id), undefined);
    assert.equal((await dbHandle.db.selectFrom('markups').select('id').execute()).length, 1);

    // An admin may delete anyone's.
    const bens = rectangle(ben.user.name);
    b.doc.add(bens);
    await waitFor(() => !!a.doc.get(bens.id), "Ada to see Ben's markup");
    a.doc.remove([bens.id]);
    await waitFor(() => !b.doc.get(bens.id) && settled(a), 'the delete to reach Ben');
    assert.equal((await storedMarkup(bens.id)).deleted, true);
  });

  it('stops sending to a removed member at once and gives outsiders nothing', async () => {
    const { ada, ben, fixture } = await team();
    const outsider = await person('Olive Outsider');
    const a = await openClient(ada, fixture);
    const b = await openClient(ben, fixture);
    const markup = rectangle(ada.user.name);
    a.doc.add(markup);
    await waitFor(() => !!b.doc.get(markup.id), 'Ben to see the markup');

    const o = await openClient(outsider, fixture, { connect: false });
    await o.doc.connect();
    await waitFor(() => o.doc.sync.connection === 'revoked', 'the outsider to be refused');
    assert.equal(o.doc.all().length, 0);

    const res = await api(ada, `/api/projects/${fixture.projectId}/members/${ben.user.id}`, { method: 'DELETE' });
    assert.equal(res.status, 200);
    await waitFor(() => b.doc.sync.connection === 'revoked', 'Ben to be cut off');
    assert.equal(b.doc.all().length, 0);
    a.doc.add(rectangle(ada.user.name));
    await waitFor(() => settled(a), 'Ada to carry on');
    assert.equal(b.doc.all().length, 0);

    // Nothing he sends is taken any more, even straight into the pipeline.
    const refused = await server.pipeline.submitOperation(
      {
        opId: randomUUID(),
        schemaVersion: PROTOCOL_VERSION,
        streamId: fixture.documentId,
        type: 'markup.delete',
        entityId: markup.id,
        payload: {},
      } satisfies Operation,
      { userId: ben.user.id, partyId: null, groupId: null },
    );
    assert.equal(refused.ok, false);
    assert.equal(!refused.ok && refused.rejection.code, 'forbidden');
  });

  it('writes access rows that row-level security checks on every read', async () => {
    const { ada, ben, fixture } = await team();
    const outsider = await person('Olive Outsider');
    const a = await openClient(ada, fixture);
    const markup = rectangle(ada.user.name);
    a.doc.add(markup);
    a.doc.update(markup.id, { comment: 'Second version' });
    await waitFor(() => settled(a), 'Ada to be synced');

    const access = await dbHandle.db.selectFrom('item_access').select(['item_kind', 'version_rev', 'lane_id']).where('item_id', '=', markup.id).execute();
    assert.deepEqual([...new Set(access.map((r) => r.version_rev))].sort(), [1, 2]);
    assert.ok(access.every((r) => r.lane_id === fixture.laneId));

    const visibleTo = async (userId: string) => {
      const client = await dbHandle.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
        await client.query(`SET LOCAL ROLE ${READER_ROLE}`);
        const counts = await client.query<{ m: number; p: number; e: number }>(
          'SELECT (SELECT count(*)::int FROM markups) AS m, (SELECT count(*)::int FROM placements) AS p, (SELECT count(*)::int FROM events) AS e',
        );
        return counts.rows[0]!;
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
    };
    assert.deepEqual(await visibleTo(ben.user.id), { m: 1, p: 1, e: 3 });
    assert.deepEqual(await visibleTo(outsider.user.id), { m: 0, p: 0, e: 0 });

    // An item without its access row is not sent, whatever the stream holds.
    await dbHandle.pool.query('DELETE FROM item_access WHERE item_id = $1', [markup.id]);
    const b = await openClient(ben, fixture);
    assert.equal(b.doc.all().length, 0);
  });

  it('refuses writes outside the document: another scope, another revision, or an unknown stream', async () => {
    const { ada, fixture } = await team();
    const other = await createDocumentFixture(dbHandle.db, ada.user);
    const ws = new WebSocket(`${baseUrl.replace(/^http/, 'ws')}/ws`, { headers: { cookie: ada.cookie, origin: baseUrl } });
    const inbox = new FrameInbox(ws);
    await new Promise((resolve) => ws.once('open', resolve));
    try {
      const send = (frame: unknown) => ws.send(JSON.stringify(frame));
      send({ type: 'hello', protocol: { min: 1, max: PROTOCOL_VERSION } });
      await inbox.next((f) => f.type === 'welcome', 'welcome');
      send({ type: 'send', streamId: fixture.documentId, ops: [] });
      assert.equal((await inbox.next((f) => f.type === 'error', 'an error')).code, 'stream_not_open');
      send({ type: 'open', streamId: 'not-a-document', cursor: null, pendingOpIds: [] });
      assert.equal(((await inbox.sync('revoked')) as { reason: string }).reason, 'No access');
      send({ type: 'open', streamId: fixture.documentId, cursor: 'made-up', pendingOpIds: [] });
      assert.ok((await inbox.sync('welcome')).snapshot, 'a cursor it did not seal gets a snapshot');

      const create = (scopeId: string): Operation => ({
        opId: randomUUID(),
        schemaVersion: PROTOCOL_VERSION,
        streamId: fixture.documentId,
        type: 'markup.create',
        entityId: randomUUID(),
        payload: { scopeId, type: 'rect', content: { style: { stroke: '#000000', fill: null, width: 1, opacity: 1 } } },
      });
      send({ type: 'send', streamId: fixture.documentId, ops: [create(other.scopeId)] });
      assert.equal(((await inbox.sync('reject')) as { reason: { code: string } }).reason.code, 'invalid');

      const good = create(fixture.scopeId);
      send({ type: 'send', streamId: fixture.documentId, ops: [good] });
      await inbox.sync('ack');
      const place = (revisionId: string, pageId: string): Operation => ({
        opId: randomUUID(),
        schemaVersion: PROTOCOL_VERSION,
        streamId: fixture.documentId,
        type: 'placement.create',
        entityId: randomUUID(),
        payload: { markupId: good.entityId, revisionId, pageId, geometry: { points: [[1, 1], [2, 2]] }, method: 'original', confidence: null, state: 'confirmed' },
      });
      send({ type: 'send', streamId: fixture.documentId, ops: [place(other.revisionId, other.pageIds[0]!)] });
      assert.match(((await inbox.sync('reject')) as { reason: { message: string } }).reason.message, /revision or page/);
      send({ type: 'send', streamId: fixture.documentId, ops: [place(fixture.revisionId, fixture.pageIds[0]!)] });
      await inbox.sync('ack');
      send({ type: 'send', streamId: fixture.documentId, ops: [place(fixture.revisionId, fixture.pageIds[1]!)] });
      assert.match(((await inbox.sync('reject')) as { reason: { message: string } }).reason.message, /already placed/);
    } finally {
      ws.close();
    }
  });

  it('uploads a PDF, opens it, adds a markup, and still has it after a reload', async () => {
    const ada = await person('Ada Admin');
    const created = await api(ada, '/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Wharf Pavilion' }),
    });
    assert.equal(created.status, 201);
    const projectId = ((await created.json()) as { project: { id: string } }).project.id;

    const pdf = blankPdf([{ width: 842, height: 595 }, { width: 595, height: 842 }]);
    const start = await api(ada, `/api/projects/${projectId}/uploads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        filename: 'S-101.pdf',
        totalBytes: pdf.byteLength,
        expectedSha256: createHash('sha256').update(pdf).digest('hex'),
      }),
    });
    assert.equal(start.status, 201);
    const { uploadId } = (await start.json()) as { uploadId: string };
    const chunk = await api(ada, `/api/projects/${projectId}/uploads/${uploadId}/chunks`, {
      method: 'PUT',
      headers: { 'content-type': 'application/octet-stream', 'x-upload-offset': '0' },
      body: new Uint8Array(pdf),
    });
    assert.equal(chunk.status, 200);
    const done = await api(ada, `/api/projects/${projectId}/uploads/${uploadId}/complete`, { method: 'POST' });
    assert.equal(done.status, 201);
    const { documentId, revisionId } = (await done.json()) as { documentId: string; revisionId: string };
    await server.jobRunner.drain();

    const listed = await api(ada, `/api/projects/${projectId}/documents`);
    const list = (await listed.json()) as { documents: { id: string; number: string; revisions: { id: string; label: string; processingStatus: string; pageCount: number }[] }[] };
    assert.deepEqual(
      list.documents.map((d) => [d.id, d.number, d.revisions.map((r) => [r.id, r.label, r.processingStatus, r.pageCount])]),
      [[documentId, 'S-101', [[revisionId, '1', 'ready', 2]]]],
    );

    const base = `/api/projects/${projectId}/documents/${documentId}/revisions/${revisionId}`;
    const opened = await api(ada, `${base}/open`);
    assert.equal(opened.status, 200);
    const info = (await opened.json()) as { streamId: string; scopeId: string; laneId: string; pages: string[]; role: string };
    assert.equal(info.role, 'project_admin');
    assert.equal(info.streamId, documentId);
    assert.equal(info.pages.length, 2);

    const file = await api(ada, `${base}/file`);
    assert.equal(file.status, 200);
    assert.equal(file.headers.get('content-type'), 'application/pdf');
    assert.equal(file.headers.get('cache-control'), 'no-store');
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), pdf);

    const outsider = await person('Olive Outsider');
    for (const path of [`${base}/open`, `${base}/file`, `/api/projects/${projectId}/documents`]) {
      assert.equal((await api(outsider, path)).status, 404, path);
    }

    const fixture: DocumentFixture = {
      projectId,
      documentId,
      revisionId,
      scopeId: info.scopeId,
      laneId: info.laneId,
      pageIds: info.pages,
    };
    const first = await openClient(ada, fixture);
    const markup = rectangle(ada.user.name, { pageIndex: 1, comment: 'Kept after reload' });
    first.doc.add(markup);
    await waitFor(() => settled(first), 'the markup to be synced');
    await first.doc.disconnect();

    // A reload keeps nothing in memory: everything comes from the server again.
    const reloaded = await openClient(ada, fixture);
    await waitFor(() => !!reloaded.doc.get(markup.id), 'the markup after reload');
    const again = reloaded.doc.get(markup.id)!;
    assert.equal(again.pageIndex, 1);
    assert.equal(again.comment, 'Kept after reload');
    assert.deepEqual(again.points, markup.points);
  });

  it('restores a persisted client, with its unsent work, from the cursor it saved', async () => {
    const { ada, ben, fixture } = await team();
    const persistence = new MemorySyncPersistence();
    const first = await openClient(ben, fixture, { persistence });
    const sent = rectangle(ben.user.name);
    first.doc.add(sent);
    await waitFor(() => settled(first), 'the first markup to be synced');
    await first.doc.disconnect();
    const unsent = rectangle(ben.user.name, { comment: 'Made offline' });
    first.doc.add(unsent);
    await first.doc.whenPersisted();

    const a = await openClient(ada, fixture);
    const meanwhile = rectangle(ada.user.name);
    a.doc.add(meanwhile);
    await waitFor(() => settled(a), 'Ada to be synced');

    const second = await openClient(ben, fixture, { persistence });
    await waitFor(() => settled(second) && !!a.doc.get(unsent.id), 'the unsent markup to arrive');
    assert.equal(second.doc.all().length, 3);
    assert.equal(second.doc.sync.inbox.length, 0);
  });

  it('seals a cursor for one user and stream', () => {
    const sealer = new CursorSealer();
    const cursor = sealer.seal('doc-1', 'user-1', 42);
    assert.equal(sealer.open(cursor, 'doc-1', 'user-1'), 42);
    assert.equal(sealer.open(cursor, 'doc-2', 'user-1'), null);
    assert.equal(sealer.open(cursor, 'doc-1', 'user-2'), null);
    assert.equal(new CursorSealer().open(cursor, 'doc-1', 'user-1'), null);
    assert.notEqual(sealer.seal('doc-1', 'user-1', 42), cursor);
  });
});
