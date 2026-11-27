import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import pg from 'pg';
import { runCli } from './cli.ts';
import { checkMigrations, runMigrations } from './migrate.ts';
import { RLS_TABLES } from './schema.ts';

// Schema v1 checks against a real Postgres 17. Each run creates its own empty database and a
// reader role without BYPASSRLS, so it does not touch the database the other integration tests use.

const DATABASE_URL = process.env.DATABASE_URL?.trim();
const REQUIRE_POSTGRES = process.env.REQUIRE_POSTGRES_TESTS === '1';

if (!DATABASE_URL && REQUIRE_POSTGRES) {
  throw new Error('REQUIRE_POSTGRES_TESTS=1 is set but DATABASE_URL is not configured');
}

type Row = Record<string, unknown>;

const suffix = randomBytes(4).toString('hex');
const DB_NAME = `rc_schema_${suffix}`;
const READER_ROLE = `rc_reader_${suffix}`;

/** Every user in the fixture, so each visibility check covers people who must not see a row. */
const USERS = ['u-ann', 'u-ben', 'u-cal', 'u-dee', 'u-eve', 'u-fay', 'u-gus', 'u-out', 'u-rem'] as const;
type UserId = (typeof USERS)[number];

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const FILE_HASH = 'c'.repeat(64);

describe('schema v1 (Postgres 17)', { skip: !DATABASE_URL ? 'DATABASE_URL is not set' : false }, () => {
  let admin: pg.Pool;
  let pool: pg.Pool;
  let dbUrl: string;

  async function insert(table: string, rows: Row[]): Promise<void> {
    for (const row of rows) {
      const cols = Object.keys(row);
      const values = cols.map((c) => {
        const v = row[c];
        return v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) ? JSON.stringify(v) : v;
      });
      await pool.query(
        `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`,
        values,
      );
    }
  }

  /** Runs `sql` as the reader role with app.user_id set (or unset when `userId` is null). */
  async function asUser<T extends pg.QueryResultRow>(userId: string | null, sql: string): Promise<T[]> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL ROLE ${READER_ROLE}`);
      if (userId !== null) {
        await client.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
      }
      const res = await client.query<T>(sql);
      return res.rows;
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  }

  /** Sorted keys of the rows `userId` can see in `table`. */
  async function visible(userId: string | null, table: string, key: string): Promise<string[]> {
    const rows = await asUser<{ k: string }>(userId, `SELECT (${key})::text AS k FROM ${table}`);
    return rows.map((r) => r.k).sort();
  }

  /** Asserts which users see which keys; users not listed must see nothing. */
  async function expectVisibility(table: string, key: string, expected: Partial<Record<UserId, string[]>>): Promise<void> {
    for (const user of USERS) {
      const want = [...(expected[user] ?? [])].sort();
      assert.deepEqual(await visible(user, table, key), want, `${table} as ${user}`);
    }
    assert.deepEqual(await visible(null, table, key), [], `${table} with no app.user_id`);
  }

  before(async () => {
    admin = new pg.Pool({ connectionString: DATABASE_URL });
    await admin.query(`CREATE DATABASE ${DB_NAME}`);
    await admin.query(`CREATE ROLE ${READER_ROLE} NOLOGIN NOSUPERUSER NOBYPASSRLS`);
    const url = new URL(DATABASE_URL!);
    url.pathname = `/${DB_NAME}`;
    dbUrl = url.toString();
    pool = new pg.Pool({ connectionString: dbUrl });
  });

  after(async () => {
    await pool?.end();
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
      await admin.query(`DROP ROLE IF EXISTS ${READER_ROLE}`);
      await admin.end();
    }
  });

  it('migrates an empty database and reports it up to date', async () => {
    const tablesBefore = await pool.query(`SELECT 1 FROM pg_tables WHERE schemaname = 'public'`);
    assert.equal(tablesBefore.rowCount, 0);

    const first = await runMigrations(pool);
    assert.deepEqual(first.appliedNow, ['0001_skeleton.sql', '0002_schema_v1.sql']);
    const second = await runMigrations(pool);
    assert.deepEqual(second.appliedNow, []);

    const status = await checkMigrations(pool);
    assert.deepEqual(status, { applied: ['0001_skeleton.sql', '0002_schema_v1.sql'], pending: [], mismatched: [] });

    const stdout: string[] = [];
    const stderr: string[] = [];
    const code = await runCli(['migrate', '--check'], {
      stdout: (line) => stdout.push(line),
      stderr: (line) => stderr.push(line),
      readStdin: async () => '',
      env: { DATABASE_URL: dbUrl },
    });
    assert.equal(code, 0, stderr.join('\n'));
    assert.deepEqual(stderr, []);
  });

  it('enables and forces row-level security on exactly the content tables', async () => {
    const res = await pool.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(`
      SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
    `);
    const byName = new Map(res.rows.map((r) => [r.relname, r]));
    for (const table of RLS_TABLES) {
      const row = byName.get(table);
      assert.ok(row, `${table} exists`);
      assert.equal(row.relrowsecurity, true, `${table} has RLS enabled`);
      assert.equal(row.relforcerowsecurity, true, `${table} has RLS forced`);
    }
    const withRls = res.rows.filter((r) => r.relrowsecurity).map((r) => r.relname).sort();
    assert.deepEqual(withRls, [...RLS_TABLES].sort());

    const policies = await pool.query<{ tablename: string; cmd: string }>(
      `SELECT tablename, cmd FROM pg_policies WHERE schemaname = 'public'`,
    );
    for (const table of RLS_TABLES) {
      const cmds = policies.rows.filter((p) => p.tablename === table).map((p) => p.cmd);
      assert.deepEqual(cmds, ['SELECT'], `${table} has one SELECT policy and no write policies`);
    }

    const role = await pool.query<{ rolbypassrls: boolean; rolsuper: boolean }>(
      `SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = $1`,
      [READER_ROLE],
    );
    assert.deepEqual(role.rows[0], { rolbypassrls: false, rolsuper: false });
  });

  it('keeps versions and status events immutable', async () => {
    // Uses its own throwaway rows inside a transaction.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`INSERT INTO workspaces (id, name) VALUES ('ws-tmp', 'Tmp')`);
      await client.query(`INSERT INTO projects (id, workspace_id, name) VALUES ('prj-tmp', 'ws-tmp', 'Tmp')`);
      await client.query(`INSERT INTO scopes (id, project_id, kind, name) VALUES ('sc-tmp', 'prj-tmp', 'review', 'Tmp')`);
      await client.query(`INSERT INTO lanes (id, project_id, scope_id, name) VALUES ('ln-tmp', 'prj-tmp', 'sc-tmp', 'Tmp')`);
      await client.query(`
        INSERT INTO item_versions (item_kind, item_id, version_rev, project_id, origin_lane_id, author_user_id, record_json)
        VALUES ('markup', 'mk-tmp', 1, 'prj-tmp', 'ln-tmp', 'u-tmp', '{}')`);
      await client.query('SAVEPOINT s');
      await assert.rejects(
        client.query(`UPDATE item_versions SET record_json = '{"x":1}' WHERE item_id = 'mk-tmp'`),
        /immutable/,
      );
      await client.query('ROLLBACK TO SAVEPOINT s');
      await assert.rejects(client.query(`DELETE FROM item_versions WHERE item_id = 'mk-tmp'`), /immutable/);
      await client.query('ROLLBACK TO SAVEPOINT s');
      // Removing the project still cascades through the immutable rows.
      await client.query(`DELETE FROM projects WHERE id = 'prj-tmp'`);
      const left = await client.query(`SELECT 1 FROM item_versions WHERE item_id = 'mk-tmp'`);
      assert.equal(left.rowCount, 0);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  describe('row-level security for a three-lane certified review', () => {
    before(async () => {
      await pool.query(`GRANT USAGE ON SCHEMA public TO ${READER_ROLE}`);
      await pool.query(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${READER_ROLE}`);
      await seedStructureAndContent();
    });

    // Fictional fixture: a bridge project reviewed by its owner (client lane), an independent
    // certifier (certifier lane) and a builder with two subconsultants (delivery lane, separated).
    async function seedStructureAndContent(): Promise<void> {
      await insert('users', USERS.map((id) => ({
        id, email: `${id}@example.test`, email_lower: `${id}@example.test`, name: id, password_hash: 'x',
      })));
      await insert('workspaces', [{ id: 'ws-demo', name: 'Demo Workspace' }]);
      await insert('projects', [{ id: 'prj-bridge', workspace_id: 'ws-demo', name: 'Example Footbridge' }]);
      await insert('parties', [
        { id: 'pty-owner', project_id: 'prj-bridge', name: 'Owner Co', contract_role: 'principal' },
        { id: 'pty-cert', project_id: 'prj-bridge', name: 'Certifier Co', contract_role: 'independent certifier' },
        { id: 'pty-builder', project_id: 'prj-bridge', name: 'Builder Co', contract_role: 'delivery lead' },
        { id: 'pty-sub-a', project_id: 'prj-bridge', name: 'Sub A Co', contract_role: 'subconsultant' },
        { id: 'pty-sub-b', project_id: 'prj-bridge', name: 'Sub B Co', contract_role: 'subconsultant' },
      ]);
      const memberParty: Record<UserId, string | null> = {
        'u-ann': 'pty-owner', 'u-ben': 'pty-owner', 'u-cal': 'pty-owner', 'u-dee': 'pty-cert',
        'u-eve': 'pty-builder', 'u-fay': 'pty-sub-a', 'u-gus': 'pty-sub-b', 'u-out': null, 'u-rem': 'pty-owner',
      };
      await insert('project_members', USERS.map((u) => ({
        project_id: 'prj-bridge', user_id: u, party_id: memberParty[u], state: u === 'u-rem' ? 'removed' : 'active',
      })));
      await insert('groups', [{ id: 'grp-checkers', project_id: 'prj-bridge', party_id: 'pty-owner', name: 'Owner checkers' }]);
      await insert('group_members', [{ group_id: 'grp-checkers', user_id: 'u-ben' }]);

      await insert('documents', [{ id: 'doc-1', project_id: 'prj-bridge', number: 'S-101', title: 'General arrangement' }]);
      await insert('revisions', [{ id: 'rev-a', document_id: 'doc-1', label: 'A', file_sha256: FILE_HASH, file_size: 1000, page_count: 1 }]);
      await insert('sheets', [{ id: 'sh-1', document_id: 'doc-1', sheet_number: 'S-101' }]);
      await insert('pages', [{ id: 'pg-1', revision_id: 'rev-a', sheet_id: 'sh-1', position: 0, width: 1190, height: 842 }]);

      await insert('scopes', [{ id: 'rv-1', project_id: 'prj-bridge', kind: 'review', name: 'Design review 1' }]);
      await insert('scope_revisions', [{ scope_id: 'rv-1', revision_id: 'rev-a' }]);
      await insert('lanes', [
        { id: 'ln-client', project_id: 'prj-bridge', scope_id: 'rv-1', name: 'Owner', position: 0 },
        { id: 'ln-cert', project_id: 'prj-bridge', scope_id: 'rv-1', name: 'Certifier', position: 1 },
        {
          id: 'ln-dp', project_id: 'prj-bridge', scope_id: 'rv-1', name: 'Builder', position: 2,
          party_visibility_mode: 'separated', lead_party_id: 'pty-builder',
        },
      ]);
      await pool.query(`
        INSERT INTO gates (id, scope_id, from_lane_id, name, requires_check, checker_can_approve,
          checker_can_return, checker_can_edit_wording, originator_sees_edits)
        VALUES ('g-client-cert', 'rv-1', 'ln-client', 'Owner to certifier', TRUE, TRUE, TRUE, TRUE, TRUE),
               ('g-cert-dp', 'rv-1', 'ln-cert', 'Certifier to builder', FALSE, FALSE, FALSE, FALSE, TRUE)`);
      await insert('gate_targets', [
        { gate_id: 'g-client-cert', to_lane_id: 'ln-cert' },
        { gate_id: 'g-cert-dp', to_lane_id: 'ln-dp' },
      ]);
      await insert('gate_checkers', [{ gate_id: 'g-client-cert', subject_kind: 'group', subject_id: 'grp-checkers' }]);
      await insert('statuses', [
        { project_id: 'prj-bridge', id: 'open', name: 'Open', category: 'open' },
        { project_id: 'prj-bridge', id: 'closed', name: 'Closed', category: 'closed' },
      ]);

      // --- content ---
      await insert('streams', [{ id: 'st-doc-1', kind: 'document', project_id: 'prj-bridge' }]);
      const markup = (id: string, rev: number, owner: string, party: string) => ({
        id, stream_id: 'st-doc-1', scope_id: 'rv-1', type: 'cloud', rev, owner_user_id: owner, owner_party_id: party,
        record_json: { id, rev }, project_id: 'prj-bridge', origin_lane_id: 'ln-client',
      });
      await insert('markups', [
        markup('mk-draft', 1, 'u-ann', 'pty-owner'), // private draft, checker group assigned
        markup('mk-released', 2, 'u-ann', 'pty-owner'), // v1 released onwards; v2 is a new private draft
        markup('mk-checked', 2, 'u-ann', 'pty-owner'), // v1 released to certifier; v2 is the certifier's wording edit
      ]);
      await insert('placements', [{
        id: 'pl-released', stream_id: 'st-doc-1', markup_id: 'mk-released', revision_id: 'rev-a', page_id: 'pg-1',
        rev: 1, record_json: {}, scope_id: 'rv-1', origin_lane_id: 'ln-client', owner_party_id: 'pty-owner',
      }]);
      const version = (kind: string, id: string, rev: number, lane: string, author: string, edited: string | null = null) => ({
        item_kind: kind, item_id: id, version_rev: rev, project_id: 'prj-bridge', scope_id: 'rv-1',
        origin_lane_id: lane, edited_in_lane_id: edited, author_user_id: author, record_json: { id, rev },
      });
      await insert('item_versions', [
        version('markup', 'mk-draft', 1, 'ln-client', 'u-ann'),
        version('markup', 'mk-released', 1, 'ln-client', 'u-ann'),
        version('markup', 'mk-released', 2, 'ln-client', 'u-ann'),
        version('markup', 'mk-checked', 1, 'ln-client', 'u-ann'),
        version('markup', 'mk-checked', 2, 'ln-client', 'u-dee', 'ln-cert'),
        version('assembly', 'asm-1', 1, 'ln-dp', 'u-eve'),
        version('assembly', 'asm-1', 2, 'ln-dp', 'u-eve'),
      ]);
      const release = (id: string, gate: string, from: string, to: string, itemId: string, rev: number) => ({
        id, project_id: 'prj-bridge', scope_id: 'rv-1', gate_id: gate, from_lane_id: from, to_lane_id: to,
        item_kind: 'markup', item_id: itemId, version_rev: rev, released_by: from === 'ln-client' ? 'u-ben' : 'u-dee',
      });
      await insert('releases', [
        release('rel-1', 'g-client-cert', 'ln-client', 'ln-cert', 'mk-released', 1),
        release('rel-2', 'g-cert-dp', 'ln-cert', 'ln-dp', 'mk-released', 1),
        release('rel-3', 'g-client-cert', 'ln-client', 'ln-cert', 'mk-checked', 1),
      ]);

      await insert('issues', [{
        id: 'iss-1', project_id: 'prj-bridge', scope_id: 'rv-1', origin_lane_id: 'ln-client', number: 1,
        title: 'Handrail height', owner_user_id: 'u-ann', owner_party_id: 'pty-owner', rev: 1, record_json: {},
      }]);
      await insert('issue_links', [{ issue_id: 'iss-1', markup_id: 'mk-released' }]);
      const response = (id: string, owner: string, party: string) => ({
        id, project_id: 'prj-bridge', scope_id: 'rv-1', origin_lane_id: 'ln-dp', issue_id: 'iss-1',
        owner_user_id: owner, owner_party_id: party, rev: 1, record_json: {},
      });
      await insert('responses', [
        response('rsp-lead', 'u-eve', 'pty-builder'),
        response('rsp-sub-a', 'u-fay', 'pty-sub-a'),
        response('rsp-sub-b', 'u-gus', 'pty-sub-b'),
      ]);
      await insert('status_events', [
        {
          id: 'se-open', project_id: 'prj-bridge', scope_id: 'rv-1', origin_lane_id: 'ln-client', issue_id: 'iss-1',
          from_status: null, to_status: 'open', actor_user_id: 'u-ann', actor_party_id: 'pty-owner',
        },
        {
          id: 'se-cert-close', project_id: 'prj-bridge', scope_id: 'rv-1', origin_lane_id: 'ln-cert', issue_id: 'iss-1',
          from_status: 'open', to_status: 'closed', actor_user_id: 'u-dee', actor_party_id: 'pty-cert',
        },
      ]);
      await insert('issue_lane_state', [
        { issue_id: 'iss-1', lane_id: 'ln-client', status: 'open', status_event_id: 'se-open' },
        { issue_id: 'iss-1', lane_id: 'ln-cert', status: 'closed', status_event_id: 'se-cert-close' },
        { issue_id: 'iss-1', lane_id: 'ln-dp', status: 'open', status_event_id: 'se-open' },
      ]);

      await insert('assets', [
        { project_id: 'prj-bridge', sha256: HASH_A, size_bytes: 10, media_type: 'image/png', storage_key: 'a' },
        { project_id: 'prj-bridge', sha256: HASH_B, size_bytes: 10, media_type: 'image/png', storage_key: 'b' },
      ]);
      await insert('asset_refs', [
        { project_id: 'prj-bridge', sha256: HASH_A, item_kind: 'markup', item_id: 'mk-released', version_rev: 2, origin_lane_id: 'ln-client' },
        { project_id: 'prj-bridge', sha256: HASH_B, item_kind: 'markup', item_id: 'mk-released', version_rev: 1, origin_lane_id: 'ln-client' },
      ]);

      const event = (seq: number, rev: number | null) => ({
        stream_id: 'st-doc-1', seq, op_id: `op-${seq}`, actor_id: 'u-ann', op_type: 'markup.patch',
        entity_id: 'mk-released', payload_json: {}, item_kind: rev === null ? null : 'markup', version_rev: rev,
        lane_id: rev === null ? null : 'ln-client',
      });
      await insert('events', [event(1, 1), event(2, 2), event(3, null)]);

      const takeoff = (table: string, id: string, rev: number, extra: Row) =>
        insert(table, [{ id, project_id: 'prj-bridge', lane_id: 'ln-dp', rev, record_json: {}, created_by: 'u-eve', ...extra }]);
      await takeoff('scales', 'sc-1', 1, { page_id: 'pg-1' });
      await takeoff('viewports', 'vp-1', 1, { page_id: 'pg-1', scale_id: 'sc-1' });
      await takeoff('assemblies', 'asm-1', 2, { name: 'Deck slab' }); // v1 shared with the certifier
      await takeoff('assemblies', 'asm-2', 1, { name: 'Handrail' }); // v1 shared with the certifier
      await takeoff('catalog_items', 'cat-1', 1, { name: 'Concrete 40 MPa' });
      await takeoff('product_lists', 'pl-1', 1, { name: 'Structural' });
      await takeoff('takeoff_templates', 'tpl-1', 1, { name: 'Bridge deck' });
    }

    async function seedAccessRows(): Promise<void> {
      await insert('lane_members', [
        { lane_id: 'ln-client', subject_kind: 'party', subject_id: 'pty-owner' },
        { lane_id: 'ln-cert', subject_kind: 'user', subject_id: 'u-dee' },
        { lane_id: 'ln-dp', subject_kind: 'party', subject_id: 'pty-builder' },
        { lane_id: 'ln-dp', subject_kind: 'party', subject_id: 'pty-sub-a' },
        { lane_id: 'ln-dp', subject_kind: 'party', subject_id: 'pty-sub-b' },
      ]);
      // u-out is an active project member with no party and no lane; u-rem was removed.
      // Separated matrix for the builder lane, as compiled by @nb/policy (lead sees all; each
      // subconsultant sees itself and the lead).
      const pv = (viewer: string, owner: string) => ({ lane_id: 'ln-dp', viewer_party_id: viewer, owner_party_id: owner });
      await insert('party_visibility', [
        pv('pty-builder', 'pty-builder'), pv('pty-builder', 'pty-sub-a'), pv('pty-builder', 'pty-sub-b'),
        pv('pty-sub-a', 'pty-sub-a'), pv('pty-sub-a', 'pty-builder'),
        pv('pty-sub-b', 'pty-sub-b'), pv('pty-sub-b', 'pty-builder'),
      ]);

      const access = (kind: string, id: string, rev: number, lane: string, k: string, owner: string | null) => ({
        item_kind: kind, item_id: id, version_rev: rev, lane_id: lane, kind: k, owner_party_id: owner,
      });
      await insert('item_access', [
        // mk-released v1: released inside the owner lane, to the certifier, and on to the builder.
        access('markup', 'mk-released', 1, 'ln-client', 'released', 'pty-owner'),
        access('markup', 'mk-released', 1, 'ln-cert', 'released', 'pty-owner'),
        access('markup', 'mk-released', 1, 'ln-dp', 'released', 'pty-owner'),
        // mk-checked v1 went to the certifier only; v2 is the certifier's edit, internal to the
        // certifier lane and shown back to the owner lane because the gate allows it.
        access('markup', 'mk-checked', 1, 'ln-cert', 'released', 'pty-owner'),
        access('markup', 'mk-checked', 2, 'ln-cert', 'internal', null),
        access('markup', 'mk-checked', 2, 'ln-client', 'released', 'pty-owner'),
        access('placement', 'pl-released', 1, 'ln-client', 'released', 'pty-owner'),
        access('placement', 'pl-released', 1, 'ln-cert', 'released', 'pty-owner'),
        access('issue', 'iss-1', 1, 'ln-client', 'internal', 'pty-owner'),
        access('issue', 'iss-1', 1, 'ln-cert', 'released', 'pty-owner'),
        access('issue', 'iss-1', 1, 'ln-dp', 'released', 'pty-owner'),
        access('response', 'rsp-lead', 1, 'ln-dp', 'internal', 'pty-builder'),
        access('response', 'rsp-sub-a', 1, 'ln-dp', 'internal', 'pty-sub-a'),
        access('response', 'rsp-sub-b', 1, 'ln-dp', 'internal', 'pty-sub-b'),
        access('statusEvent', 'se-open', 1, 'ln-client', 'internal', 'pty-owner'),
        access('statusEvent', 'se-open', 1, 'ln-cert', 'released', 'pty-owner'),
        access('statusEvent', 'se-cert-close', 1, 'ln-cert', 'internal', 'pty-cert'),
        access('assembly', 'asm-1', 1, 'ln-cert', 'released', 'pty-builder'),
        access('assembly', 'asm-2', 1, 'ln-cert', 'released', 'pty-builder'),
      ]);

      const draft = (id: string, rev: number, kind: string, subject: string) => ({
        item_kind: 'markup', item_id: id, version_rev: rev, subject_kind: kind, subject_id: subject,
      });
      await insert('item_draft_access', [
        draft('mk-draft', 1, 'user', 'u-ann'),
        draft('mk-draft', 1, 'group', 'grp-checkers'),
        draft('mk-draft', 1, 'user', 'u-rem'), // removed member: must still see nothing
        draft('mk-released', 1, 'user', 'u-ann'),
        draft('mk-released', 2, 'user', 'u-ann'),
        draft('mk-released', 2, 'group', 'grp-checkers'),
        draft('mk-checked', 1, 'user', 'u-ann'),
      ]);

      await insert('op_results', [{
        op_id: 'op-ann-1', stream_id: 'st-doc-1', actor_id: 'u-ann', payload_hash: 'h', accepted: true, result_json: {},
      }]);
    }

    it('returns no rows from any content table when no access rows exist', async () => {
      for (const table of RLS_TABLES) {
        const total = await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${table}`);
        if (table !== 'op_results') assert.ok(Number(total.rows[0]!.n) > 0, `${table} is seeded`);
        for (const user of [...USERS, null]) {
          const rows = await asUser<{ n: string }>(user, `SELECT count(*)::text AS n FROM ${table}`);
          assert.equal(rows[0]!.n, '0', `${table} as ${user ?? 'no user'}`);
        }
      }
    });

    describe('with lane membership and access rows', () => {
      before(seedAccessRows);

      it('shows current markups only to those who may see that exact version', async () => {
        await expectVisibility('markups', 'id', {
          'u-ann': ['mk-checked', 'mk-draft', 'mk-released'],
          'u-ben': ['mk-checked', 'mk-draft', 'mk-released'], // assigned checker through the group
          'u-cal': ['mk-checked'], // lane colleague: private drafts stay hidden
          'u-dee': ['mk-checked'], // certifier sees its own edit; mk-released v2 is unreleased
        });
      });

      it('filters item versions per version, across lanes', async () => {
        const key = `item_kind || ':' || item_id || ':' || version_rev`;
        await expectVisibility('item_versions', key, {
          'u-ann': ['markup:mk-checked:1', 'markup:mk-checked:2', 'markup:mk-draft:1', 'markup:mk-released:1', 'markup:mk-released:2'],
          'u-ben': ['markup:mk-checked:2', 'markup:mk-draft:1', 'markup:mk-released:1', 'markup:mk-released:2'],
          'u-cal': ['markup:mk-checked:2', 'markup:mk-released:1'],
          'u-dee': ['assembly:asm-1:1', 'markup:mk-checked:1', 'markup:mk-checked:2', 'markup:mk-released:1'],
          'u-eve': ['assembly:asm-1:1', 'assembly:asm-1:2', 'markup:mk-released:1'],
          'u-fay': ['assembly:asm-1:1', 'assembly:asm-1:2', 'markup:mk-released:1'],
          'u-gus': ['assembly:asm-1:1', 'assembly:asm-1:2', 'markup:mk-released:1'],
        });
      });

      it('shows a release only to its two lanes', async () => {
        await expectVisibility('releases', 'id', {
          'u-ann': ['rel-1', 'rel-3'],
          'u-ben': ['rel-1'],
          'u-cal': ['rel-1'],
          'u-dee': ['rel-1', 'rel-2', 'rel-3'],
          'u-eve': ['rel-2'],
          'u-fay': ['rel-2'],
          'u-gus': ['rel-2'],
        });
      });

      it('applies the party matrix inside a separated lane', async () => {
        await expectVisibility('responses', 'id', {
          'u-eve': ['rsp-lead', 'rsp-sub-a', 'rsp-sub-b'],
          'u-fay': ['rsp-lead', 'rsp-sub-a'],
          'u-gus': ['rsp-lead', 'rsp-sub-b'],
        });
      });

      it('keeps issue status per lane', async () => {
        const all = ['u-ann', 'u-ben', 'u-cal', 'u-dee', 'u-eve', 'u-fay', 'u-gus'] as const;
        await expectVisibility('issues', 'id', Object.fromEntries(all.map((u) => [u, ['iss-1']])));
        await expectVisibility('issue_lane_state', `lane_id || ':' || status`, {
          'u-ann': ['ln-client:open'], 'u-ben': ['ln-client:open'], 'u-cal': ['ln-client:open'],
          'u-dee': ['ln-cert:closed'],
          'u-eve': ['ln-dp:open'], 'u-fay': ['ln-dp:open'], 'u-gus': ['ln-dp:open'],
        });
        await expectVisibility('status_events', 'id', {
          'u-ann': ['se-open'], 'u-ben': ['se-open'], 'u-cal': ['se-open'],
          'u-dee': ['se-cert-close', 'se-open'],
        });
        await expectVisibility('issue_links', 'markup_id', Object.fromEntries(all.map((u) => [u, ['mk-released']])));
      });

      it('filters placements, assets, events and operation results', async () => {
        await expectVisibility('placements', 'id', {
          'u-ann': ['pl-released'], 'u-ben': ['pl-released'], 'u-cal': ['pl-released'], 'u-dee': ['pl-released'],
        });
        const both = [HASH_A, HASH_B];
        await expectVisibility('assets', 'sha256', {
          'u-ann': both, 'u-ben': both, 'u-cal': [HASH_B], 'u-dee': [HASH_B], 'u-eve': [HASH_B], 'u-fay': [HASH_B], 'u-gus': [HASH_B],
        });
        await expectVisibility('events', 'seq', {
          'u-ann': ['1', '2'], 'u-ben': ['1', '2'], 'u-cal': ['1'], 'u-dee': ['1'], 'u-eve': ['1'], 'u-fay': ['1'], 'u-gus': ['1'],
        });
        await expectVisibility('op_results', 'op_id', { 'u-ann': ['op-ann-1'] });
      });

      it('keeps takeoff private to its lane except for shared versions', async () => {
        const dp = (ids: string[]) => ({ 'u-eve': ids, 'u-fay': ids, 'u-gus': ids });
        await expectVisibility('scales', 'id', dp(['sc-1']));
        await expectVisibility('viewports', 'id', dp(['vp-1']));
        await expectVisibility('catalog_items', 'id', dp(['cat-1']));
        await expectVisibility('product_lists', 'id', dp(['pl-1']));
        await expectVisibility('takeoff_templates', 'id', dp(['tpl-1']));
        // asm-1's current version (2) was never shared; asm-2's current version (1) was.
        await expectVisibility('assemblies', 'id', { ...dp(['asm-1', 'asm-2']), 'u-dee': ['asm-2'] });
      });

      it('removes everything when the scope document set excludes the user', async () => {
        await pool.query(`INSERT INTO document_sets (id, project_id, name, members_restricted)
          VALUES ('ds-owner', 'prj-bridge', 'Owner only', TRUE)`);
        await insert('document_set_members', [{ document_set_id: 'ds-owner', subject_kind: 'lane', subject_id: 'ln-client' }]);
        await pool.query(`UPDATE scopes SET document_set_id = 'ds-owner' WHERE id = 'rv-1'`);
        try {
          assert.deepEqual(await visible('u-dee', 'markups', 'id'), []);
          assert.deepEqual(await visible('u-eve', 'item_versions', 'item_id'), []);
          assert.deepEqual(await visible('u-cal', 'markups', 'id'), ['mk-checked']);
        } finally {
          await pool.query(`UPDATE scopes SET document_set_id = NULL WHERE id = 'rv-1'`);
        }
      });
    });
  });
});
