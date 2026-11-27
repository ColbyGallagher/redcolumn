import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { PROTOCOL_VERSION, type Operation } from '@nb/ops';
import { DEFAULT_STATUSES, DEFAULT_STATUS_TRANSITIONS, presets } from '@nb/policy';
import pg from 'pg';
import WebSocket from 'ws';
import { buildServer, type ServerInstance } from './app.ts';
import { createLocalUser } from './auth.ts';
import { loadConfig, type ServerConfig } from './config.ts';
import { deriveCursorKey, openCursor, sealCursor } from './cursor.ts';
import { createDb, type DbHandle } from './db.ts';
import { createLogger } from './logger.ts';
import { runMigrations } from './migrate.ts';
import { InMemoryNotificationSink } from './notifications.ts';
import type { SeedProjectFixture } from './reviewStore.ts';
import { RLS_TABLES } from './schema.ts';

// Architecture checks (no database required) + hostile-client wall proof against Postgres 17.

const DATABASE_URL = process.env.DATABASE_URL?.trim();
const REQUIRE_POSTGRES = process.env.REQUIRE_POSTGRES_TESTS === '1';

if (!DATABASE_URL && REQUIRE_POSTGRES) {
  throw new Error('REQUIRE_POSTGRES_TESTS=1 is set but DATABASE_URL is not configured');
}

const MIGRATION_V1_PATH = fileURLToPath(new URL('../migrations/0002_schema_v1.sql', import.meta.url));

describe('wall architecture and cursor primitives', () => {
  it('enables and forces RLS with a SELECT policy on every content table in 0002_schema_v1.sql', () => {
    const sqlText = readFileSync(MIGRATION_V1_PATH, 'utf8');
    for (const table of RLS_TABLES) {
      assert.match(
        sqlText,
        new RegExp(`ALTER\\s+TABLE\\s+${table}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY;`, 'i'),
        `${table} must enable RLS`,
      );
      assert.match(
        sqlText,
        new RegExp(`ALTER\\s+TABLE\\s+${table}\\s+FORCE\\s+ROW\\s+LEVEL\\s+SECURITY;`, 'i'),
        `${table} must force RLS`,
      );
      assert.match(
        sqlText,
        new RegExp(`CREATE\\s+POLICY\\s+\\w+\\s+ON\\s+${table}\\s+FOR\\s+SELECT`, 'i'),
        `${table} must define a SELECT RLS policy`,
      );
    }
  });

  it('seals and opens AEAD cursors bound to user and stream and rejects tampering or moves', () => {
    const key = deriveCursorKey('fictional-test-cursor-key');
    const c1 = sealCursor(key, { userId: 'u-1', streamId: 'stream-a' }, 42);
    const c2 = sealCursor(key, { userId: 'u-1', streamId: 'stream-a' }, 42);
    assert.notEqual(c1, c2, 'random IV produces distinct opaque tokens');
    assert.equal(openCursor(key, c1, { userId: 'u-1', streamId: 'stream-a' }), 42);

    // Moved across users or streams
    assert.equal(openCursor(key, c1, { userId: 'u-2', streamId: 'stream-a' }), null);
    assert.equal(openCursor(key, c1, { userId: 'u-1', streamId: 'stream-b' }), null);

    // Tampered token or forged token
    const tampered = `${c1.slice(0, -2)}${c1.endsWith('AA') ? 'BB' : 'AA'}`;
    assert.equal(openCursor(key, tampered, { userId: 'u-1', streamId: 'stream-a' }), null);
    assert.equal(openCursor(key, 'not-a-valid-cursor', { userId: 'u-1', streamId: 'stream-a' }), null);
    assert.equal(openCursor(deriveCursorKey('other-key'), c1, { userId: 'u-1', streamId: 'stream-a' }), null);
  });
});

// --- Helpers for Postgres wall proof ---------------------------------------------------------

function makeConfig(dbUrl: string, overrides: Partial<ServerConfig> = {}): ServerConfig {
  const base = loadConfig({
    DATABASE_URL: dbUrl,
    HOST: '127.0.0.1',
    PORT: '0',
    LOG_LEVEL: 'info',
    COOKIE_SECURE: 'false',
    AUTO_MIGRATE: 'false',
  });
  return { ...base, ...overrides };
}

async function login(baseUrl: string, email: string, password: string): Promise<string> {
  const res = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: baseUrl },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(res.status, 200, `login failed for ${email}`);
  return (res.headers.get('set-cookie') ?? '').split(';')[0]!;
}

async function rawHttp(
  baseUrl: string,
  cookie: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; text: string; json: unknown }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      cookie,
      origin: baseUrl,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, text, json };
}

function openWs(url: string, headers: Record<string, string>): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers });
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function nextJsonMessage(ws: WebSocket, timeoutMs = 5000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', onMessage);
      ws.off('error', onError);
      reject(new Error('Timed out waiting for WS message'));
    }, timeoutMs);
    const onMessage = (data: WebSocket.RawData) => {
      clearTimeout(timer);
      ws.off('error', onError);
      resolve(JSON.parse(data.toString()) as Record<string, unknown>);
    };
    const onError = (err: Error) => {
      clearTimeout(timer);
      ws.off('message', onMessage);
      reject(err);
    };
    ws.once('message', onMessage);
    ws.once('error', onError);
  });
}

async function openHandshakenWs(wsUrl: string, baseUrl: string, cookie: string): Promise<WebSocket> {
  const ws = await openWs(wsUrl, { cookie, origin: baseUrl });
  ws.send(JSON.stringify({ type: 'hello', protocol: { min: 1, max: PROTOCOL_VERSION } }));
  const welcome = await nextJsonMessage(ws);
  assert.equal(welcome.type, 'welcome');
  return ws;
}

describe('three-lane wall proof with hostile client and canary scan (Postgres 17)', {
  skip: !DATABASE_URL ? 'DATABASE_URL is not set' : false,
}, () => {
  const suffix = randomBytes(4).toString('hex');
  const DB_NAME = `rc_wall_${suffix}`;
  const READER_ROLE = `rc_wall_reader_${suffix}`;

  let adminPool: pg.Pool;
  let dbHandle: DbHandle;
  let server: ServerInstance;
  let baseUrl: string;
  let wsUrl: string;
  let notifications: InMemoryNotificationSink;
  const infoLogChunks: string[] = [];

  // Fictional users
  let adminUser: { id: string; email: string };
  let clientAuthor: { id: string; email: string };
  let clientChecker: { id: string; email: string };
  let certifierChecker: { id: string; email: string };
  let partnerLead: { id: string; email: string };
  let subA: { id: string; email: string };
  let subB: { id: string; email: string };

  let adminCookie: string;
  let clientAuthorCookie: string;
  let clientCheckerCookie: string;
  let certifierCookie: string;
  let partnerLeadCookie: string;
  let subACookie: string;
  let subBCookie: string;

  // Unique canaries that must NEVER reach unauthorized lanes or info logs
  const CANARY_CLIENT_DRAFT = 'CANARY_CLIENT_DRAFT_X9Q2';
  const CANARY_DRAFT_MARKUP = 'CANARY_DRAFT_MARKUP_M4K8';
  const CANARY_UNRELEASED_AMEND = 'CANARY_UNRELEASED_AMEND_Z7P3';
  const CANARY_ASSET_FILENAME = 'CANARY_SECRET_SKETCH_F5W1.pdf';
  const CANARY_ASSET_BODY = 'CANARY_SECRET_ASSET_BYTES_B2V6';
  const CANARY_CERTIFIER_EDITOR_NAME = 'CANARY_CERTIFIER_EDITOR_N8R4';
  const CANARY_CLIENT_CHECKER_NAME = 'CANARY_CLIENT_CHECKER_C3L9';
  const CANARY_INTERNAL_RESP = 'CANARY_INTERNAL_NOTE_R6T5';
  const CANARY_HELD_AT_CERTIFIER = 'CANARY_HELD_ISSUE_H1J7';
  const CANARY_SUBA_PRIVATE = 'CANARY_SUBA_PRIVATE_S4D2';

  const PROJECT_ID = 'prj-wall-1';
  const SCOPE_ID = 'rev-wall-1';
  const DOC_STREAM = 'doc-wall-1';
  const PRJ_STREAM = 'prj-wall-stream-1';

  const HIDDEN_DRAFT_ISSUE_ID = 'iss-canary-draft-1';
  const HIDDEN_DRAFT_MARKUP_ID = 'mk-canary-draft-1';
  const HIDDEN_DRAFT_PLACEMENT_ID = 'pl-canary-draft-1';
  const HIDDEN_INTERNAL_RESP_ID = 'resp-canary-internal-1';
  const HELD_ISSUE_ID = 'iss-held-2';
  const SHARED_ISSUE_1_ID = 'iss-shared-1';
  const CERTIFIER_ISSUE_3_ID = 'iss-cert-3';
  const SUBA_RESP_ID = 'resp-suba-private-1';

  let hiddenAssetSha256 = '';
  let sharedAssetSha256 = '';

  const partnerCapturedBytes: string[] = [];
  const subBCapturedBytes: string[] = [];

  before(async () => {
    adminPool = new pg.Pool({ connectionString: DATABASE_URL });
    await adminPool.query(`CREATE DATABASE ${DB_NAME}`);
    await adminPool.query(`CREATE ROLE ${READER_ROLE} NOLOGIN NOSUPERUSER NOBYPASSRLS`);

    const url = new URL(DATABASE_URL!);
    url.pathname = `/${DB_NAME}`;
    const dbUrl = url.toString();

    dbHandle = createDb(dbUrl);
    await runMigrations(dbHandle.pool);
    await dbHandle.pool.query(`SELECT app_grant_reader($1)`, [READER_ROLE]);

    // Create fictional accounts with canary names for hidden editors
    adminUser = await createLocalUser(dbHandle.db, {
      email: 'admin@wall.test',
      name: 'Alex Admin',
      password: 'fictional-password-1',
      role: 'admin',
    });
    clientAuthor = await createLocalUser(dbHandle.db, {
      email: 'client-author@wall.test',
      name: 'Pat Client',
      password: 'fictional-password-2',
    });
    clientChecker = await createLocalUser(dbHandle.db, {
      email: 'client-checker@wall.test',
      name: CANARY_CLIENT_CHECKER_NAME,
      password: 'fictional-password-3',
    });
    certifierChecker = await createLocalUser(dbHandle.db, {
      email: 'certifier@wall.test',
      name: CANARY_CERTIFIER_EDITOR_NAME,
      password: 'fictional-password-4',
    });
    partnerLead = await createLocalUser(dbHandle.db, {
      email: 'partner-lead@wall.test',
      name: 'Sam Partner',
      password: 'fictional-password-5',
    });
    subA = await createLocalUser(dbHandle.db, {
      email: 'suba@wall.test',
      name: 'Riley SubA',
      password: 'fictional-password-6',
    });
    subB = await createLocalUser(dbHandle.db, {
      email: 'subb@wall.test',
      name: 'Jordan SubB',
      password: 'fictional-password-7',
    });

    notifications = new InMemoryNotificationSink();
    const logger = createLogger('info', {
      write: (chunk: string) => {
        infoLogChunks.push(chunk);
      },
    });
    const config = makeConfig(dbUrl);
    server = buildServer({
      config,
      db: dbHandle.db,
      pool: dbHandle.pool,
      logger,
      readerRole: READER_ROLE,
      cursorSecret: 'fictional-wall-proof-secret',
      notifications,
    });
    baseUrl = await server.app.listen({ host: config.host, port: 0 });
    wsUrl = `${baseUrl.replace(/^http/, 'ws')}/ws`;

    adminCookie = await login(baseUrl, adminUser.email, 'fictional-password-1');
    clientAuthorCookie = await login(baseUrl, clientAuthor.email, 'fictional-password-2');
    clientCheckerCookie = await login(baseUrl, clientChecker.email, 'fictional-password-3');
    certifierCookie = await login(baseUrl, certifierChecker.email, 'fictional-password-4');
    partnerLeadCookie = await login(baseUrl, partnerLead.email, 'fictional-password-5');
    subACookie = await login(baseUrl, subA.email, 'fictional-password-6');
    subBCookie = await login(baseUrl, subB.email, 'fictional-password-7');

    // Seed three-lane certified review with separated subconsultants in the partner lane
    const proc = presets.threeSided({
      id: SCOPE_ID,
      clientMembers: [{ kind: 'party', id: 'party-client' }],
      certifierMembers: [{ kind: 'party', id: 'party-certifier' }],
      partnerMembers: [
        { kind: 'party', id: 'party-partner-lead' },
        { kind: 'party', id: 'party-sub-a' },
        { kind: 'party', id: 'party-sub-b' },
      ],
      clientDraftVisibility: 'private',
      certifierDraftVisibility: 'private',
      partnerDraftVisibility: 'lane',
      clientCheckers: [{ kind: 'user', id: clientChecker.id }],
      partnerPartyVisibility: {
        mode: 'separated',
        leadPartyId: 'party-partner-lead',
      },
      roles: [
        {
          subject: { kind: 'user', id: clientAuthor.id },
          role: 'reviewer',
          level: 'review',
          scopeId: SCOPE_ID,
        },
        {
          subject: { kind: 'user', id: clientChecker.id },
          role: 'lead_reviewer',
          level: 'review',
          scopeId: SCOPE_ID,
          gateIds: ['client-to-certifier'],
        },
        {
          subject: { kind: 'user', id: certifierChecker.id },
          role: 'review_coordinator',
          level: 'review',
          scopeId: SCOPE_ID,
          gateIds: ['certifier-to-partner', 'certifier-to-client', 'certifier-to-both'],
          transitions: '*',
        },
        {
          subject: { kind: 'user', id: partnerLead.id },
          role: 'responder',
          level: 'review',
          scopeId: SCOPE_ID,
          gateIds: ['partner-to-certifier'],
        },
        {
          subject: { kind: 'user', id: subA.id },
          role: 'responder',
          level: 'review',
          scopeId: SCOPE_ID,
          gateIds: ['partner-to-certifier'],
        },
        {
          subject: { kind: 'user', id: subB.id },
          role: 'responder',
          level: 'review',
          scopeId: SCOPE_ID,
          gateIds: ['partner-to-certifier'],
        },
      ],
    });

    // Require internal check on client-to-certifier so we can prove premature release is refused.
    const gatedProc = {
      ...proc,
      name: 'Certified Three-Lane Review',
      gates: proc.gates.map((g) => (g.id === 'client-to-certifier' ? { ...g, requiresCheck: true } : g)),
      grants: [
        // Give clientAuthor release grant on client-to-certifier (not a checker) so premature release
        // before checker approval is blocked by requiresCheck rather than missing release grant.
        {
          subject: { kind: 'user' as const, id: clientAuthor.id },
          level: 'review' as const,
          scopeId: SCOPE_ID,
          action: 'release' as const,
          gateIds: ['client-to-certifier'],
        },
        // Give certifier lane-scoped check.review to exercise cross-lane checker powers.
        {
          subject: { kind: 'user' as const, id: certifierChecker.id },
          level: 'review' as const,
          scopeId: SCOPE_ID,
          action: 'check.review' as const,
          scope: 'lane' as const,
        },
      ],
    };

    const fixture: SeedProjectFixture = {
      workspace: { id: 'ws-wall-1', name: 'Fictional Workspace' },
      project: {
        id: PROJECT_ID,
        name: 'Fictional Bridge Package',
        number: 'FB-01',
        parties: [
          { id: 'party-client', name: 'Northwind Client', contractRole: 'client' },
          { id: 'party-certifier', name: 'Veritas Certifier', contractRole: 'certifier' },
          { id: 'party-partner-lead', name: 'Apex Delivery', contractRole: 'lead_consultant' },
          { id: 'party-sub-a', name: 'Boreal Geotech', contractRole: 'subconsultant' },
          { id: 'party-sub-b', name: 'Cedar Hydraulics', contractRole: 'subconsultant' },
        ],
        groups: [],
        members: [
          { userId: clientAuthor.id, name: 'Pat Client', partyId: 'party-client', groupIds: [], state: 'active' },
          { userId: clientChecker.id, name: CANARY_CLIENT_CHECKER_NAME, partyId: 'party-client', groupIds: [], state: 'active' },
          { userId: certifierChecker.id, name: CANARY_CERTIFIER_EDITOR_NAME, partyId: 'party-certifier', groupIds: [], state: 'active' },
          { userId: partnerLead.id, name: 'Sam Partner', partyId: 'party-partner-lead', groupIds: [], state: 'active' },
          { userId: subA.id, name: 'Riley SubA', partyId: 'party-sub-a', groupIds: [], state: 'active' },
          { userId: subB.id, name: 'Jordan SubB', partyId: 'party-sub-b', groupIds: [], state: 'active' },
        ],
        statuses: DEFAULT_STATUSES,
        statusTransitions: DEFAULT_STATUS_TRANSITIONS,
        defaultClosing: { allowedClosers: [{ kind: 'lane', id: 'certifier' }] },
        grants: [],
      },
      process: gatedProc,
      documents: [
        {
          id: 'doc-1',
          number: 'A-101',
          title: 'General Arrangement',
          discipline: 'Structural',
          revisions: [
            {
              id: 'rev-a',
              label: 'A',
              fileSha256: 'a'.repeat(64),
              fileSize: 1024,
              pageCount: 1,
              pages: [{ id: 'page-1', position: 0, width: 842, height: 595 }],
            },
          ],
        },
      ],
      documentStreamId: DOC_STREAM,
      projectStreamId: PRJ_STREAM,
    };

    const seedRes = await rawHttp(baseUrl, adminCookie, 'POST', '/api/projects/seed', fixture);
    assert.equal(seedRes.status, 201, seedRes.text);
  });

  after(async () => {
    await server?.app.close();
    await dbHandle?.close();
    if (adminPool) {
      await adminPool.query(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
      await adminPool.query(`DROP ROLE IF EXISTS ${READER_ROLE}`);
      await adminPool.end();
    }
  });

  it('seeds workflow items, enforces premature release & gate checks, and keeps issue numbers consistent with safe gaps', async () => {
    // Open partner WS subscribers BEFORE client creates drafts, to record every WS frame partner receives.
    const partnerWs = await openHandshakenWs(wsUrl, baseUrl, partnerLeadCookie);
    const partnerWsFrames: string[] = [];
    partnerWs.on('message', (data) => {
      const str = data.toString();
      partnerWsFrames.push(str);
      partnerCapturedBytes.push(str);
    });
    partnerWs.send(JSON.stringify({ type: 'subscribe', streamId: DOC_STREAM }));
    partnerWs.send(JSON.stringify({ type: 'subscribe', streamId: PRJ_STREAM }));
    await new Promise((r) => setTimeout(r, 80));

    try {
      // 1. Client author creates a private draft issue, markup, placement, internal response, and hidden asset.
      const mkDraftOp: Operation = {
        opId: 'op-mk-draft-1',
        schemaVersion: PROTOCOL_VERSION,
        streamId: DOC_STREAM,
        type: 'markup.create',
        entityId: HIDDEN_DRAFT_MARKUP_ID,
        payload: {
          scopeId: SCOPE_ID,
          type: 'rect',
          content: { style: { stroke: '#d00000', fill: null, width: 2, opacity: 1 }, text: CANARY_DRAFT_MARKUP },
        },
      };
      assert.equal((await rawHttp(baseUrl, clientAuthorCookie, 'POST', `/api/scopes/${SCOPE_ID}/ops`, mkDraftOp)).status, 200);

      const plDraftOp: Operation = {
        opId: 'op-pl-draft-1',
        schemaVersion: PROTOCOL_VERSION,
        streamId: DOC_STREAM,
        type: 'placement.create',
        entityId: HIDDEN_DRAFT_PLACEMENT_ID,
        payload: {
          markupId: HIDDEN_DRAFT_MARKUP_ID,
          revisionId: 'rev-a',
          pageId: 'page-1',
          geometry: { points: [[10, 10], [20, 20]] },
          method: 'original',
          confidence: null,
          state: 'confirmed',
        },
      };
      assert.equal((await rawHttp(baseUrl, clientAuthorCookie, 'POST', `/api/scopes/${SCOPE_ID}/ops`, plDraftOp)).status, 200);

      const issDraftOp: Operation = {
        opId: 'op-iss-draft-1',
        schemaVersion: PROTOCOL_VERSION,
        streamId: PRJ_STREAM,
        type: 'issue.create',
        entityId: HIDDEN_DRAFT_ISSUE_ID,
        payload: {
          scopeId: SCOPE_ID,
          title: CANARY_CLIENT_DRAFT,
          status: 'open',
          markupIds: [HIDDEN_DRAFT_MARKUP_ID],
        },
      };
      assert.equal((await rawHttp(baseUrl, clientAuthorCookie, 'POST', `/api/scopes/${SCOPE_ID}/ops`, issDraftOp)).status, 200);

      const internalRespOp: Operation = {
        opId: 'op-resp-internal-1',
        schemaVersion: PROTOCOL_VERSION,
        streamId: PRJ_STREAM,
        type: 'response.create',
        entityId: HIDDEN_INTERNAL_RESP_ID,
        payload: {
          parent: { kind: 'issue', id: HIDDEN_DRAFT_ISSUE_ID },
          kind: 'reply',
          body: CANARY_INTERNAL_RESP,
        },
      };
      assert.equal((await rawHttp(baseUrl, clientAuthorCookie, 'POST', `/api/scopes/${SCOPE_ID}/ops`, internalRespOp)).status, 200);

      const hiddenAssetRes = await rawHttp(baseUrl, clientAuthorCookie, 'POST', `/api/scopes/${SCOPE_ID}/assets`, {
        itemKind: 'issue',
        itemId: HIDDEN_DRAFT_ISSUE_ID,
        filename: CANARY_ASSET_FILENAME,
        mediaType: 'application/pdf',
        contentBase64: Buffer.from(CANARY_ASSET_BODY, 'utf8').toString('base64'),
      });
      assert.equal(hiddenAssetRes.status, 201);
      hiddenAssetSha256 = (hiddenAssetRes.json as { sha256: string }).sha256;
      assert.equal(hiddenAssetSha256, createHash('sha256').update(CANARY_ASSET_BODY).digest('hex'));

      // 2. Client creates iss-shared-1 and iss-held-2.
      const iss1Op: Operation = {
        opId: 'op-iss-1',
        schemaVersion: PROTOCOL_VERSION,
        streamId: PRJ_STREAM,
        type: 'issue.create',
        entityId: SHARED_ISSUE_1_ID,
        payload: { scopeId: SCOPE_ID, title: 'Client original wording for bearing pad', status: 'open' },
      };
      assert.equal((await rawHttp(baseUrl, clientAuthorCookie, 'POST', `/api/scopes/${SCOPE_ID}/ops`, iss1Op)).status, 200);

      const iss2Op: Operation = {
        opId: 'op-iss-2',
        schemaVersion: PROTOCOL_VERSION,
        streamId: PRJ_STREAM,
        type: 'issue.create',
        entityId: HELD_ISSUE_ID,
        payload: { scopeId: SCOPE_ID, title: CANARY_HELD_AT_CERTIFIER, status: 'open' },
      };
      assert.equal((await rawHttp(baseUrl, clientAuthorCookie, 'POST', `/api/scopes/${SCOPE_ID}/ops`, iss2Op)).status, 200);

      // Premature release attempt by non-checker author BEFORE check.approve on a requiresCheck gate must be refused!
      const prematureRel: Operation = {
        opId: 'op-rel-premature',
        schemaVersion: PROTOCOL_VERSION,
        streamId: PRJ_STREAM,
        type: 'release.create',
        entityId: 'rel-premature',
        payload: {
          gateId: 'client-to-certifier',
          toLaneIds: ['certifier'],
          items: [{ kind: 'issue', id: SHARED_ISSUE_1_ID, rev: 1 }],
        },
      };
      const premRes = await rawHttp(baseUrl, clientAuthorCookie, 'POST', `/api/scopes/${SCOPE_ID}/ops`, prematureRel);
      assert.equal(premRes.status, 400, 'premature release before approval must be refused');

      // Client checker approves iss-shared-1 and iss-held-2, then releases both to certifier (taking #1 and #2).
      assert.equal(
        (await rawHttp(baseUrl, clientCheckerCookie, 'POST', `/api/scopes/${SCOPE_ID}/actions`, {
          type: 'check.approve',
          itemKind: 'issue',
          itemId: SHARED_ISSUE_1_ID,
        })).status,
        200,
      );
      assert.equal(
        (await rawHttp(baseUrl, clientCheckerCookie, 'POST', `/api/scopes/${SCOPE_ID}/actions`, {
          type: 'check.approve',
          itemKind: 'issue',
          itemId: HELD_ISSUE_ID,
        })).status,
        200,
      );

      const relToCert: Operation = {
        opId: 'op-rel-client-cert',
        schemaVersion: PROTOCOL_VERSION,
        streamId: PRJ_STREAM,
        type: 'release.create',
        entityId: 'rel-client-cert',
        payload: {
          gateId: 'client-to-certifier',
          toLaneIds: ['certifier'],
          items: [
            { kind: 'issue', id: SHARED_ISSUE_1_ID, rev: 1 },
            { kind: 'issue', id: HELD_ISSUE_ID, rev: 1 },
          ],
        },
      };
      assert.equal((await rawHttp(baseUrl, clientCheckerCookie, 'POST', `/api/scopes/${SCOPE_ID}/ops`, relToCert)).status, 200);

      // Client now makes an unreleased amendment to iss-shared-1 (rev 3) containing CANARY_UNRELEASED_AMEND!
      const amendOp: Operation = {
        opId: 'op-iss-1-amend',
        schemaVersion: PROTOCOL_VERSION,
        streamId: PRJ_STREAM,
        type: 'issue.patch',
        entityId: SHARED_ISSUE_1_ID,
        basedOn: { title: 0 },
        payload: { title: CANARY_UNRELEASED_AMEND },
      };
      assert.equal((await rawHttp(baseUrl, clientAuthorCookie, 'POST', `/api/scopes/${SCOPE_ID}/ops`, amendOp)).status, 200);

      // 3. Certifier edits iss-shared-1 wording (rev 4), returns iss-held-2 (never releasing it to partner),
      //    and releases iss-shared-1 (rev 4) to partner!
      const certEditOp: Operation = {
        opId: 'op-cert-edit-1',
        schemaVersion: PROTOCOL_VERSION,
        streamId: PRJ_STREAM,
        type: 'issue.patch',
        entityId: SHARED_ISSUE_1_ID,
        basedOn: { title: 1 },
        payload: { title: 'Certifier approved wording for bearing pad' },
      };
      assert.equal((await rawHttp(baseUrl, certifierCookie, 'POST', `/api/scopes/${SCOPE_ID}/ops`, certEditOp)).status, 200);

      // Caller-supplied gateId abuse: certifier passing a bogus gateId to check.return must be rejected.
      const badGateReturn = await rawHttp(baseUrl, certifierCookie, 'POST', `/api/scopes/${SCOPE_ID}/actions`, {
        type: 'check.return',
        itemKind: 'issue',
        itemId: HELD_ISSUE_ID,
        gateId: 'certifier-to-partner',
        note: 'Wrong gate',
      });
      assert.equal(badGateReturn.status, 403);

      // Legitimate return of iss-held-2 by certifier (stays held from partner).
      assert.equal(
        (await rawHttp(baseUrl, certifierCookie, 'POST', `/api/scopes/${SCOPE_ID}/actions`, {
          type: 'check.return',
          itemKind: 'issue',
          itemId: HELD_ISSUE_ID,
          note: 'Clarify scope before release',
        })).status,
        200,
      );

      // Release iss-shared-1 (certifier rev 4) to partner.
      const relToPartner: Operation = {
        opId: 'op-rel-cert-partner',
        schemaVersion: PROTOCOL_VERSION,
        streamId: PRJ_STREAM,
        type: 'release.create',
        entityId: 'rel-cert-partner',
        payload: {
          gateId: 'certifier-to-partner',
          toLaneIds: ['partner'],
          items: [{ kind: 'issue', id: SHARED_ISSUE_1_ID, rev: 4 }],
        },
      };
      assert.equal((await rawHttp(baseUrl, certifierCookie, 'POST', `/api/scopes/${SCOPE_ID}/ops`, relToPartner)).status, 200);

      // Certifier creates iss-cert-3, attaches a shared asset, and releases to both client and partner (gets #3).
      const iss3Op: Operation = {
        opId: 'op-iss-3',
        schemaVersion: PROTOCOL_VERSION,
        streamId: PRJ_STREAM,
        type: 'issue.create',
        entityId: CERTIFIER_ISSUE_3_ID,
        payload: { scopeId: SCOPE_ID, title: 'Certifier joint observation on drainage', status: 'open' },
      };
      assert.equal((await rawHttp(baseUrl, certifierCookie, 'POST', `/api/scopes/${SCOPE_ID}/ops`, iss3Op)).status, 200);

      const rel3Both: Operation = {
        opId: 'op-rel-3-both',
        schemaVersion: PROTOCOL_VERSION,
        streamId: PRJ_STREAM,
        type: 'release.create',
        entityId: 'rel-3-both',
        payload: {
          gateId: 'certifier-to-both',
          toLaneIds: ['client', 'partner'],
          items: [{ kind: 'issue', id: CERTIFIER_ISSUE_3_ID, rev: 1 }],
        },
      };
      assert.equal((await rawHttp(baseUrl, certifierCookie, 'POST', `/api/scopes/${SCOPE_ID}/ops`, rel3Both)).status, 200);

      // Attach a shared asset to iss-cert-3 at its released rev (rev 2) so partner can read it.
      const sharedAssetRes = await rawHttp(baseUrl, certifierCookie, 'POST', `/api/scopes/${SCOPE_ID}/assets`, {
        itemKind: 'issue',
        itemId: CERTIFIER_ISSUE_3_ID,
        filename: 'drainage-detail.pdf',
        mediaType: 'application/pdf',
        contentBase64: Buffer.from('shared-drainage-pdf-bytes', 'utf8').toString('base64'),
      });
      assert.equal(sharedAssetRes.status, 201);
      sharedAssetSha256 = (sharedAssetRes.json as { sha256: string }).sha256;

      // 4. Subconsultant A creates an internal response on iss-shared-1; subconsultant B must NOT see it.
      const subARespOp: Operation = {
        opId: 'op-suba-resp-1',
        schemaVersion: PROTOCOL_VERSION,
        streamId: PRJ_STREAM,
        type: 'response.create',
        entityId: SUBA_RESP_ID,
        payload: {
          parent: { kind: 'issue', id: SHARED_ISSUE_1_ID },
          kind: 'reply',
          body: CANARY_SUBA_PRIVATE,
        },
      };
      assert.equal((await rawHttp(baseUrl, subACookie, 'POST', `/api/scopes/${SCOPE_ID}/ops`, subARespOp)).status, 200);

      await new Promise((r) => setTimeout(r, 120));

      // Verify issue numbering across all three lanes:
      // - Client sees #1 and #3 (plus #2 held)
      // - Certifier sees #1, #2, #3
      // - Partner sees ONLY #1 and #3 (gap at #2, matching numbers, zero metadata about #2)
      const clientItems = await rawHttp(baseUrl, clientAuthorCookie, 'GET', `/api/scopes/${SCOPE_ID}/items`);
      const certItems = await rawHttp(baseUrl, certifierCookie, 'GET', `/api/scopes/${SCOPE_ID}/items`);
      const partnerItems = await rawHttp(baseUrl, partnerLeadCookie, 'GET', `/api/scopes/${SCOPE_ID}/items`);
      partnerCapturedBytes.push(partnerItems.text);

      const numbersOf = (body: unknown) =>
        ((body as { items: { kind: string; record: { number: number | null } }[] }).items)
          .filter((i) => i.kind === 'issue' && i.record.number !== null)
          .map((i) => i.record.number!)
          .sort((a, b) => a - b);

      assert.deepEqual(numbersOf(clientItems.json), [1, 2, 3]);
      assert.deepEqual(numbersOf(certItems.json), [1, 2, 3]);
      assert.deepEqual(numbersOf(partnerItems.json), [1, 3]);

      // Partner sees iss-shared-1 with certifier's wording, original client owner, and NO draft/editor leak
      const partnerIss1 = (partnerItems.json as { items: { id: string; record: { title: string; owner: { userId: string } } }[] }).items.find(
        (i) => i.id === SHARED_ISSUE_1_ID,
      );
      assert.ok(partnerIss1);
      assert.equal(partnerIss1.record.title, 'Certifier approved wording for bearing pad');
      assert.equal(partnerIss1.record.owner.userId, clientAuthor.id);

      // Partner can read the shared asset on iss-cert-3
      const sharedAssetGet = await rawHttp(baseUrl, partnerLeadCookie, 'GET', `/api/projects/${PROJECT_ID}/assets/${sharedAssetSha256}`);
      assert.equal(sharedAssetGet.status, 200);
      partnerCapturedBytes.push(sharedAssetGet.text);

      // Partner WS received ONLY released events (no draft events, no raw seq)
      for (const rawFrame of partnerWsFrames) {
        const parsed = JSON.parse(rawFrame) as Record<string, unknown>;
        if (parsed.type === 'event') {
          assert.equal('seq' in (parsed.event as Record<string, unknown>), false, 'WS event must never expose raw seq');
          assert.equal(typeof parsed.cursor, 'string', 'WS event must carry sealed cursor');
        }
      }
    } finally {
      partnerWs.close();
    }
  });

  it('blocks a raw hostile HTTP and WS client across forged owners, cross-lane entity probes, moved cursors, asset hashes, search, and counts', async () => {
    // 1. Forged owner/actor fields in payload: server MUST ignore/strip them and stamp authenticated user.
    const forgedRespOp = {
      opId: 'op-forged-owner-1',
      schemaVersion: PROTOCOL_VERSION,
      streamId: PRJ_STREAM,
      type: 'response.create',
      entityId: 'resp-forged-1',
      owner: { userId: clientAuthor.id, partyId: 'party-client', groupId: null },
      actor: { userId: certifierChecker.id, partyId: 'party-certifier', groupId: null },
      payload: {
        parent: { kind: 'issue', id: SHARED_ISSUE_1_ID },
        kind: 'reply',
        body: 'Partner response with forged owner fields',
        owner: { userId: clientAuthor.id, partyId: 'party-client', groupId: null },
      },
    };
    const forgedRes = await rawHttp(baseUrl, partnerLeadCookie, 'POST', `/api/scopes/${SCOPE_ID}/ops`, forgedRespOp);
    partnerCapturedBytes.push(forgedRes.text);
    assert.equal(forgedRes.status, 200);
    const fetchedForged = await rawHttp(baseUrl, partnerLeadCookie, 'GET', `/api/scopes/${SCOPE_ID}/items/response/resp-forged-1`);
    partnerCapturedBytes.push(fetchedForged.text);
    assert.equal(fetchedForged.status, 200);
    const forgedOwner = (fetchedForged.json as { item: { record: { owner: { userId: string; partyId: string } } } }).item.record.owner;
    assert.equal(forgedOwner.userId, partnerLead.id, 'server must assign authenticated user as owner');
    assert.equal(forgedOwner.partyId, 'party-partner-lead', 'server must assign authenticated party as owner');

    // 2. Error uniformity (HTTP): hidden entity vs nonexistent entity MUST be byte-identical!
    const NONEXISTENT_ID = 'iss-does-not-exist-0000';
    const NONEXISTENT_MARKUP_ID = 'mk-does-not-exist-0000';

    const getHidden = await rawHttp(baseUrl, partnerLeadCookie, 'GET', `/api/scopes/${SCOPE_ID}/items/issue/${HELD_ISSUE_ID}`);
    const getMissing = await rawHttp(baseUrl, partnerLeadCookie, 'GET', `/api/scopes/${SCOPE_ID}/items/issue/${NONEXISTENT_ID}`);
    partnerCapturedBytes.push(getHidden.text, getMissing.text);
    assert.equal(getHidden.status, 404);
    assert.equal(getMissing.status, 404);
    assert.equal(getHidden.text, getMissing.text, 'GET hidden vs missing issue must be byte-identical');

    // Patch hidden vs missing issue
    const patchHidden = await rawHttp(baseUrl, partnerLeadCookie, 'POST', `/api/scopes/${SCOPE_ID}/ops`, {
      opId: 'op-hostile-patch-hidden',
      schemaVersion: PROTOCOL_VERSION,
      streamId: PRJ_STREAM,
      type: 'issue.patch',
      entityId: HELD_ISSUE_ID,
      basedOn: { title: 0 },
      payload: { title: 'hijacked' },
    });
    const patchMissing = await rawHttp(baseUrl, partnerLeadCookie, 'POST', `/api/scopes/${SCOPE_ID}/ops`, {
      opId: 'op-hostile-patch-missing',
      schemaVersion: PROTOCOL_VERSION,
      streamId: PRJ_STREAM,
      type: 'issue.patch',
      entityId: NONEXISTENT_ID,
      basedOn: { title: 0 },
      payload: { title: 'hijacked' },
    });
    partnerCapturedBytes.push(patchHidden.text, patchMissing.text);
    assert.equal(patchHidden.status, 404);
    assert.equal(patchMissing.status, 404);
    assert.equal(patchHidden.text, patchMissing.text, 'PATCH hidden vs missing issue must be byte-identical');

    // Delete hidden vs missing markup
    const delHidden = await rawHttp(baseUrl, partnerLeadCookie, 'POST', `/api/scopes/${SCOPE_ID}/ops`, {
      opId: 'op-hostile-del-hidden',
      schemaVersion: PROTOCOL_VERSION,
      streamId: DOC_STREAM,
      type: 'markup.delete',
      entityId: HIDDEN_DRAFT_MARKUP_ID,
      payload: {},
    });
    const delMissing = await rawHttp(baseUrl, partnerLeadCookie, 'POST', `/api/scopes/${SCOPE_ID}/ops`, {
      opId: 'op-hostile-del-missing',
      schemaVersion: PROTOCOL_VERSION,
      streamId: DOC_STREAM,
      type: 'markup.delete',
      entityId: NONEXISTENT_MARKUP_ID,
      payload: {},
    });
    partnerCapturedBytes.push(delHidden.text, delMissing.text);
    assert.equal(delHidden.status, 404);
    assert.equal(delMissing.status, 404);
    assert.equal(delHidden.text, delMissing.text, 'DELETE hidden vs missing markup must be byte-identical');

    // Link hidden vs missing markup onto visible issue
    const linkHidden = await rawHttp(baseUrl, partnerLeadCookie, 'POST', `/api/scopes/${SCOPE_ID}/ops`, {
      opId: 'op-hostile-link-hidden',
      schemaVersion: PROTOCOL_VERSION,
      streamId: PRJ_STREAM,
      type: 'issue.link',
      entityId: SHARED_ISSUE_1_ID,
      payload: { markupId: HIDDEN_DRAFT_MARKUP_ID },
    });
    const linkMissing = await rawHttp(baseUrl, partnerLeadCookie, 'POST', `/api/scopes/${SCOPE_ID}/ops`, {
      opId: 'op-hostile-link-missing',
      schemaVersion: PROTOCOL_VERSION,
      streamId: PRJ_STREAM,
      type: 'issue.link',
      entityId: SHARED_ISSUE_1_ID,
      payload: { markupId: NONEXISTENT_MARKUP_ID },
    });
    partnerCapturedBytes.push(linkHidden.text, linkMissing.text);
    assert.equal(linkHidden.status, 404);
    assert.equal(linkMissing.status, 404);
    assert.equal(linkHidden.text, linkMissing.text, 'LINK hidden vs missing markup must be byte-identical');

    // Status transition on hidden vs missing issue
    const trHidden = await rawHttp(baseUrl, partnerLeadCookie, 'POST', `/api/scopes/${SCOPE_ID}/ops`, {
      opId: 'op-hostile-tr-hidden',
      schemaVersion: PROTOCOL_VERSION,
      streamId: PRJ_STREAM,
      type: 'status.transition',
      entityId: 'se-hostile-1',
      payload: { issueId: HELD_ISSUE_ID, from: 'open', to: 'closed', revisionSeenId: 'rev-a' },
    });
    const trMissing = await rawHttp(baseUrl, partnerLeadCookie, 'POST', `/api/scopes/${SCOPE_ID}/ops`, {
      opId: 'op-hostile-tr-missing',
      schemaVersion: PROTOCOL_VERSION,
      streamId: PRJ_STREAM,
      type: 'status.transition',
      entityId: 'se-hostile-2',
      payload: { issueId: NONEXISTENT_ID, from: 'open', to: 'closed', revisionSeenId: 'rev-a' },
    });
    partnerCapturedBytes.push(trHidden.text, trMissing.text);
    assert.equal(trHidden.status, 404);
    assert.equal(trMissing.status, 404);
    assert.equal(trHidden.text, trMissing.text, 'status.transition hidden vs missing must be byte-identical');

    // Release attempt on hidden vs missing issue (and with another lane's gateId)
    const relHidden = await rawHttp(baseUrl, partnerLeadCookie, 'POST', `/api/scopes/${SCOPE_ID}/ops`, {
      opId: 'op-hostile-rel-hidden',
      schemaVersion: PROTOCOL_VERSION,
      streamId: PRJ_STREAM,
      type: 'release.create',
      entityId: 'rel-hostile-1',
      payload: { gateId: 'client-to-certifier', toLaneIds: ['certifier'], items: [{ kind: 'issue', id: HIDDEN_DRAFT_ISSUE_ID, rev: 1 }] },
    });
    const relMissing = await rawHttp(baseUrl, partnerLeadCookie, 'POST', `/api/scopes/${SCOPE_ID}/ops`, {
      opId: 'op-hostile-rel-missing',
      schemaVersion: PROTOCOL_VERSION,
      streamId: PRJ_STREAM,
      type: 'release.create',
      entityId: 'rel-hostile-2',
      payload: { gateId: 'client-to-certifier', toLaneIds: ['certifier'], items: [{ kind: 'issue', id: NONEXISTENT_ID, rev: 1 }] },
    });
    partnerCapturedBytes.push(relHidden.text, relMissing.text);
    assert.equal(relHidden.status, 404);
    assert.equal(relMissing.status, 404);
    assert.equal(relHidden.text, relMissing.text, 'release hidden vs missing must be byte-identical');

    // 3. Asset hash probe: hidden asset hash vs nonexistent hash must be byte-identical 404!
    const missingHash = 'f'.repeat(64);
    const assetHidden = await rawHttp(baseUrl, partnerLeadCookie, 'GET', `/api/projects/${PROJECT_ID}/assets/${hiddenAssetSha256}`);
    const assetMissing = await rawHttp(baseUrl, partnerLeadCookie, 'GET', `/api/projects/${PROJECT_ID}/assets/${missingHash}`);
    partnerCapturedBytes.push(assetHidden.text, assetMissing.text);
    assert.equal(assetHidden.status, 404);
    assert.equal(assetMissing.status, 404);
    assert.equal(assetHidden.text, assetMissing.text, 'asset hidden vs missing must be byte-identical');

    // 4. Cursor attacks (forged, tampered, cross-user moved, cross-stream moved) over HTTP and WS.
    const clientFeed = await rawHttp(baseUrl, clientAuthorCookie, 'GET', `/api/streams/${PRJ_STREAM}/feed`);
    assert.equal(clientFeed.status, 200);
    const clientCursor = (clientFeed.json as { cursor: string }).cursor;
    assert.ok(clientCursor.length > 10);

    const partnerDocFeed = await rawHttp(baseUrl, partnerLeadCookie, 'GET', `/api/streams/${DOC_STREAM}/feed`);
    assert.equal(partnerDocFeed.status, 200);
    partnerCapturedBytes.push(partnerDocFeed.text);
    const partnerDocCursor = (partnerDocFeed.json as { cursor: string }).cursor;

    // Replaying client's cursor as partner -> 400 invalid_cursor
    const crossUserFeed = await rawHttp(baseUrl, partnerLeadCookie, 'GET', `/api/streams/${PRJ_STREAM}/feed?cursor=${encodeURIComponent(clientCursor)}`);
    partnerCapturedBytes.push(crossUserFeed.text);
    assert.equal(crossUserFeed.status, 400);
    assert.deepEqual(crossUserFeed.json, { error: 'invalid_cursor' });

    // Moving partner's doc cursor onto project stream -> 400 invalid_cursor
    const crossStreamFeed = await rawHttp(baseUrl, partnerLeadCookie, 'GET', `/api/streams/${PRJ_STREAM}/feed?cursor=${encodeURIComponent(partnerDocCursor)}`);
    partnerCapturedBytes.push(crossStreamFeed.text);
    assert.equal(crossStreamFeed.status, 400);
    assert.deepEqual(crossStreamFeed.json, { error: 'invalid_cursor' });

    // Forged cursor -> 400 invalid_cursor
    const forgedFeed = await rawHttp(baseUrl, partnerLeadCookie, 'GET', `/api/streams/${PRJ_STREAM}/feed?cursor=Zm9yZ2VkLWN1cnNvcg`);
    partnerCapturedBytes.push(forgedFeed.text);
    assert.equal(forgedFeed.status, 400);
    assert.deepEqual(forgedFeed.json, { error: 'invalid_cursor' });

    // Valid partner feed returns only released events (zero drafts, zero raw seq)
    const partnerPrjFeed = await rawHttp(baseUrl, partnerLeadCookie, 'GET', `/api/streams/${PRJ_STREAM}/feed`);
    partnerCapturedBytes.push(partnerPrjFeed.text);
    assert.equal(partnerPrjFeed.status, 200);

    // 5. Raw WS hostile client: uniform error frames on hidden vs missing + cursor abuse over WS
    const hostileWs = await openHandshakenWs(wsUrl, baseUrl, partnerLeadCookie);
    try {
      hostileWs.send(
        JSON.stringify({
          type: 'op',
          op: {
            opId: 'ws-probe-hidden',
            schemaVersion: PROTOCOL_VERSION,
            streamId: PRJ_STREAM,
            type: 'status.transition',
            entityId: 'se-ws-1',
            payload: { issueId: HELD_ISSUE_ID, from: 'open', to: 'closed', revisionSeenId: 'rev-a' },
          },
        }),
      );
      const wsHiddenAck = await nextJsonMessage(hostileWs);
      partnerCapturedBytes.push(JSON.stringify(wsHiddenAck));

      hostileWs.send(
        JSON.stringify({
          type: 'op',
          op: {
            opId: 'ws-probe-missing',
            schemaVersion: PROTOCOL_VERSION,
            streamId: PRJ_STREAM,
            type: 'status.transition',
            entityId: 'se-ws-2',
            payload: { issueId: NONEXISTENT_ID, from: 'open', to: 'closed', revisionSeenId: 'rev-a' },
          },
        }),
      );
      const wsMissingAck = await nextJsonMessage(hostileWs);
      partnerCapturedBytes.push(JSON.stringify(wsMissingAck));

      assert.deepEqual(
        (wsHiddenAck.result as { rejection: unknown }).rejection,
        (wsMissingAck.result as { rejection: unknown }).rejection,
        'WS hidden vs missing rejection must be byte-identical',
      );
      assert.equal(
        JSON.stringify((wsHiddenAck.result as { rejection: unknown }).rejection),
        JSON.stringify((wsMissingAck.result as { rejection: unknown }).rejection),
      );

      // WS moved cursor rejection
      hostileWs.send(JSON.stringify({ type: 'sync', streamId: PRJ_STREAM, cursor: clientCursor }));
      const wsCursorErr = await nextJsonMessage(hostileWs);
      partnerCapturedBytes.push(JSON.stringify(wsCursorErr));
      assert.equal(wsCursorErr.type, 'error');
      assert.equal(wsCursorErr.code, 'invalid_cursor');
    } finally {
      hostileWs.close();
    }

    // 6. Search queries (POST body so query terms don't touch URL) & count queries targeting canaries
    for (const canary of [
      CANARY_CLIENT_DRAFT,
      CANARY_DRAFT_MARKUP,
      CANARY_UNRELEASED_AMEND,
      CANARY_ASSET_FILENAME,
      CANARY_CERTIFIER_EDITOR_NAME,
      CANARY_CLIENT_CHECKER_NAME,
      CANARY_INTERNAL_RESP,
      CANARY_HELD_AT_CERTIFIER,
    ]) {
      const searchRes = await rawHttp(baseUrl, partnerLeadCookie, 'POST', `/api/scopes/${SCOPE_ID}/search`, { q: canary });
      partnerCapturedBytes.push(searchRes.text);
      assert.equal(searchRes.status, 200);
      assert.deepEqual(searchRes.json, { results: [] }, `search for ${canary} must return empty`);
    }

    // Search for a released word DOES match for partner
    const validSearch = await rawHttp(baseUrl, partnerLeadCookie, 'POST', `/api/scopes/${SCOPE_ID}/search`, { q: 'drainage' });
    partnerCapturedBytes.push(validSearch.text);
    assert.equal(validSearch.status, 200);
    assert.equal((validSearch.json as { results: unknown[] }).results.length, 1);

    // Counts reflect ONLY visible items (2 issues: iss-shared-1 and iss-cert-3; 2 responses: subA + partnerLead)
    const partnerCounts = await rawHttp(baseUrl, partnerLeadCookie, 'GET', `/api/scopes/${SCOPE_ID}/counts`);
    partnerCapturedBytes.push(partnerCounts.text);
    assert.equal(partnerCounts.status, 200);
    assert.equal((partnerCounts.json as { byKind: Record<string, number> }).byKind.issue, 2);
    assert.equal((partnerCounts.json as { byKind: Record<string, number> }).byKind.markup ?? 0, 0);

    // Subconsultant separation: subB sees neither client canaries nor subA's private response
    const subBItems = await rawHttp(baseUrl, subBCookie, 'GET', `/api/scopes/${SCOPE_ID}/items`);
    const subBCounts = await rawHttp(baseUrl, subBCookie, 'GET', `/api/scopes/${SCOPE_ID}/counts`);
    const subBSearch = await rawHttp(baseUrl, subBCookie, 'POST', `/api/scopes/${SCOPE_ID}/search`, { q: CANARY_SUBA_PRIVATE });
    const subBRegJson = await rawHttp(baseUrl, subBCookie, 'GET', `/api/scopes/${SCOPE_ID}/register?format=json`);
    const subBRegCsv = await rawHttp(baseUrl, subBCookie, 'GET', `/api/scopes/${SCOPE_ID}/register?format=csv`);
    const subBRegText = await rawHttp(baseUrl, subBCookie, 'GET', `/api/scopes/${SCOPE_ID}/register?format=text`);
    subBCapturedBytes.push(subBItems.text, subBCounts.text, subBSearch.text, subBRegJson.text, subBRegCsv.text, subBRegText.text);
    assert.deepEqual(subBSearch.json, { results: [] });

    // 7. Register exports for partner in JSON, CSV, and text formats
    const regJson = await rawHttp(baseUrl, partnerLeadCookie, 'GET', `/api/scopes/${SCOPE_ID}/register?format=json`);
    const regCsv = await rawHttp(baseUrl, partnerLeadCookie, 'GET', `/api/scopes/${SCOPE_ID}/register?format=csv`);
    const regText = await rawHttp(baseUrl, partnerLeadCookie, 'GET', `/api/scopes/${SCOPE_ID}/register?format=text`);
    assert.equal(regJson.status, 200);
    assert.equal(regCsv.status, 200);
    assert.equal(regText.status, 200);
    partnerCapturedBytes.push(regJson.text, regCsv.text, regText.text);

    // 8. Canary scan across EVERY byte received by partner, subB, captured notifications/emails, and info-level server logs!
    const partnerNotifications = [
      ...notifications.forUser(partnerLead.id),
      ...notifications.forUser(subA.id),
      ...notifications.forUser(subB.id),
    ];
    assert.ok(partnerNotifications.length > 0, 'partner must have received release notifications');

    const partnerCorpus = [
      ...partnerCapturedBytes,
      JSON.stringify(partnerNotifications),
    ].join('\n');

    const hiddenFromPartnerCanaries = [
      CANARY_CLIENT_DRAFT,
      CANARY_DRAFT_MARKUP,
      CANARY_UNRELEASED_AMEND,
      CANARY_ASSET_FILENAME,
      CANARY_ASSET_BODY,
      CANARY_CERTIFIER_EDITOR_NAME,
      CANARY_CLIENT_CHECKER_NAME,
      CANARY_INTERNAL_RESP,
      CANARY_HELD_AT_CERTIFIER,
      HIDDEN_DRAFT_ISSUE_ID,
      HIDDEN_DRAFT_MARKUP_ID,
      HIDDEN_DRAFT_PLACEMENT_ID,
      HIDDEN_INTERNAL_RESP_ID,
      HELD_ISSUE_ID,
      hiddenAssetSha256,
    ];

    for (const canary of hiddenFromPartnerCanaries) {
      assert.equal(partnerCorpus.includes(canary), false, `canary "${canary}" leaked to partner lane`);
    }

    // Subconsultant B must also see zero trace of Subconsultant A's internal response
    const subBCorpus = [...subBCapturedBytes, JSON.stringify(notifications.forUser(subB.id))].join('\n');
    for (const canary of [...hiddenFromPartnerCanaries, CANARY_SUBA_PRIVATE, SUBA_RESP_ID]) {
      assert.equal(subBCorpus.includes(canary), false, `canary "${canary}" leaked to subconsultant B`);
    }

    // Info-level server logs must contain zero canary hits
    const logCorpus = infoLogChunks.join('\n');
    for (const canary of [
      CANARY_CLIENT_DRAFT,
      CANARY_DRAFT_MARKUP,
      CANARY_UNRELEASED_AMEND,
      CANARY_ASSET_FILENAME,
      CANARY_ASSET_BODY,
      CANARY_CERTIFIER_EDITOR_NAME,
      CANARY_CLIENT_CHECKER_NAME,
      CANARY_INTERNAL_RESP,
      CANARY_HELD_AT_CERTIFIER,
      CANARY_SUBA_PRIVATE,
    ]) {
      assert.equal(logCorpus.includes(canary), false, `canary "${canary}" leaked to info-level server logs`);
    }
  });
});
