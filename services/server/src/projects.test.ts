import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { buildServer, type ServerInstance } from './app.ts';
import { createLocalUser } from './auth.ts';
import { loadConfig, type ServerConfig } from './config.ts';
import { createDb, type DbHandle } from './db.ts';
import { runMigrations } from './migrate.ts';

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
    LOGIN_RATE_LIMIT_MAX: '50',
  });
  return { ...base, ...overrides };
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

describe('project & member management (Postgres 17)', { skip: !DATABASE_URL ? 'DATABASE_URL is not set' : false }, () => {
  let dbHandle: DbHandle;
  let server: ServerInstance;
  let baseUrl: string;

  before(async () => {
    dbHandle = createDb(DATABASE_URL!);
    await runMigrations(dbHandle.pool);
    server = buildServer({ config: makeConfig(), db: dbHandle.db, pool: dbHandle.pool });
    await server.app.listen({ host: '127.0.0.1', port: 0 });
    const addr = server.app.server.address();
    assert.ok(addr && typeof addr === 'object');
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(async () => {
    await server?.app.close();
    await dbHandle?.close();
  });

  beforeEach(async () => {
    await dbHandle.pool.query(
      'TRUNCATE invites, lane_members, lanes, scopes, statuses, project_members, projects, workspace_members, workspaces, sessions, users CASCADE',
    );
  });

  it('requires authentication and rejects disallowed origins on project endpoints', async () => {
    const unauthRes = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: baseUrl },
      body: JSON.stringify({ name: 'Harbour Bridge' }),
    });
    assert.equal(unauthRes.status, 401);

    await createLocalUser(dbHandle.db, {
      email: 'ada@northbridge.example',
      name: 'Ada Admin',
      password: 'fictional-password-1',
    });
    const cookie = await login(baseUrl, 'ada@northbridge.example', 'fictional-password-1');

    const badOrigin = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie,
        origin: 'https://evil.example',
      },
      body: JSON.stringify({ name: 'Harbour Bridge' }),
    });
    assert.equal(badOrigin.status, 403);
    assert.deepEqual(await badOrigin.json(), { error: 'origin_not_allowed' });
  });

  it('creates a project with single-team defaults and shows it in GET /api/sessions', async () => {
    const ada = await createLocalUser(dbHandle.db, {
      email: 'ada@northbridge.example',
      name: 'Ada Admin',
      password: 'fictional-password-1',
    });
    const adaCookie = await login(baseUrl, 'ada@northbridge.example', 'fictional-password-1');

    const createRes = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adaCookie, origin: baseUrl },
      body: JSON.stringify({
        name: 'Harbour Bridge',
        number: 'NB-101',
        description: 'Structural drawing review',
      }),
    });
    assert.equal(createRes.status, 201);
    const created = (await createRes.json()) as {
      project: { id: string; name: string; number: string | null; description: string | null; role: string };
      scope: { id: string; projectId: string; kind: string; name: string; state: string };
      lane: { id: string; name: string };
      role: string;
    };
    assert.equal(created.project.name, 'Harbour Bridge');
    assert.equal(created.project.number, 'NB-101');
    assert.equal(created.project.description, 'Structural drawing review');
    assert.equal(created.role, 'project_admin');
    assert.equal(created.scope.projectId, created.project.id);
    assert.equal(created.lane.name, 'Team');

    // Creator is in lane_members
    const laneMember = await dbHandle.db
      .selectFrom('lane_members')
      .selectAll()
      .where('lane_id', '=', created.lane.id)
      .where('subject_kind', '=', 'user')
      .where('subject_id', '=', ada.id)
      .executeTakeFirst();
    assert.ok(laneMember);

    // Creator sees project via GET /api/projects/:id
    const getRes = await fetch(`${baseUrl}/api/projects/${created.project.id}`, {
      headers: { cookie: adaCookie },
    });
    assert.equal(getRes.status, 200);
    const getBody = (await getRes.json()) as { project: { id: string; name: string; role: string }; role: string };
    assert.equal(getBody.project.id, created.project.id);
    assert.equal(getBody.role, 'project_admin');

    // Creator sees project and default scope in GET /api/sessions
    const sessionsRes = await fetch(`${baseUrl}/api/sessions`, {
      headers: { cookie: adaCookie },
    });
    assert.equal(sessionsRes.status, 200);
    const sessionsBody = (await sessionsRes.json()) as {
      projects: { id: string; name: string; role: string }[];
      sessions: { id: string; projectId: string }[];
    };
    assert.equal(sessionsBody.projects.length, 1);
    assert.equal(sessionsBody.projects[0]!.id, created.project.id);
    assert.equal(sessionsBody.projects[0]!.role, 'project_admin');
    assert.equal(sessionsBody.sessions.length, 1);
    assert.equal(sessionsBody.sessions[0]!.id, created.scope.id);
  });

  it('supports email and link-only invites, assigns exact roles, and enforces 403/404 permissions', async () => {
    await createLocalUser(dbHandle.db, {
      email: 'ada@northbridge.example',
      name: 'Ada Admin',
      password: 'fictional-password-1',
    });
    await createLocalUser(dbHandle.db, {
      email: 'dan@northbridge.example',
      name: 'Dan Outsider',
      password: 'fictional-password-4',
    });

    const adaCookie = await login(baseUrl, 'ada@northbridge.example', 'fictional-password-1');
    const danCookie = await login(baseUrl, 'dan@northbridge.example', 'fictional-password-4');

    const createRes = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adaCookie, origin: baseUrl },
      body: JSON.stringify({ name: 'River Tunnel' }),
    });
    assert.equal(createRes.status, 201);
    const { project, lane } = (await createRes.json()) as {
      project: { id: string };
      lane: { id: string };
    };

    // Admin invites a Reviewer by email
    const revInviteRes = await fetch(`${baseUrl}/api/projects/${project.id}/invites`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adaCookie, origin: baseUrl },
      body: JSON.stringify({ email: 'ben@northbridge.example', role: 'reviewer' }),
    });
    assert.equal(revInviteRes.status, 201);
    const revInvite = (await revInviteRes.json()) as {
      invite: { id: string; email: string | null; role: string };
      token: string;
      inviteUrl: string;
    };
    assert.equal(revInvite.invite.email, 'ben@northbridge.example');
    assert.equal(revInvite.invite.role, 'reviewer');
    assert.equal(revInvite.inviteUrl, `/invite/${revInvite.token}`);

    // Admin creates a link-only Viewer invite (no email)
    const viewInviteRes = await fetch(`${baseUrl}/api/projects/${project.id}/invites`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adaCookie, origin: baseUrl },
      body: JSON.stringify({ role: 'viewer' }),
    });
    assert.equal(viewInviteRes.status, 201);
    const viewInvite = (await viewInviteRes.json()) as {
      invite: { id: string; email: string | null; role: string };
      token: string;
      inviteUrl: string;
    };
    assert.equal(viewInvite.invite.email, null);
    assert.equal(viewInvite.invite.role, 'viewer');
    assert.equal(viewInvite.inviteUrl, `/invite/${viewInvite.token}`);

    // Pending invites appear in GET /members
    const beforeAcceptMembersRes = await fetch(`${baseUrl}/api/projects/${project.id}/members`, {
      headers: { cookie: adaCookie },
    });
    assert.equal(beforeAcceptMembersRes.status, 200);
    const beforeAcceptMembers = (await beforeAcceptMembersRes.json()) as {
      members: unknown[];
      invites: { id: string; role: string }[];
    };
    assert.equal(beforeAcceptMembers.members.length, 1);
    assert.equal(beforeAcceptMembers.invites.length, 2);

    // Ben accepts email invite and creates account
    const benAcceptRes = await fetch(`${baseUrl}/api/invites/${encodeURIComponent(revInvite.token)}/accept`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: baseUrl },
      body: JSON.stringify({ name: 'Ben Reviewer', password: 'fictional-password-2' }),
    });
    assert.equal(benAcceptRes.status, 200);
    const benCookie = (benAcceptRes.headers.get('set-cookie') ?? '').split(';')[0]!;
    const benBody = (await benAcceptRes.json()) as { user: { id: string } };

    // Cleo accepts link-only invite by providing email + name + password
    const cleoAcceptRes = await fetch(`${baseUrl}/api/invites/${encodeURIComponent(viewInvite.token)}/accept`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: baseUrl },
      body: JSON.stringify({
        email: 'cleo@northbridge.example',
        name: 'Cleo Viewer',
        password: 'fictional-password-3',
      }),
    });
    assert.equal(cleoAcceptRes.status, 200);
    const cleoCookie = (cleoAcceptRes.headers.get('set-cookie') ?? '').split(';')[0]!;
    const cleoBody = (await cleoAcceptRes.json()) as { user: { id: string } };

    // Both appear in project_members with exact roles and in lane_members
    const membersRes = await fetch(`${baseUrl}/api/projects/${project.id}/members`, {
      headers: { cookie: adaCookie },
    });
    assert.equal(membersRes.status, 200);
    const membersBody = (await membersRes.json()) as {
      role: string;
      members: { userId: string; role: string }[];
      invites: unknown[];
    };
    assert.equal(membersBody.role, 'project_admin');
    assert.equal(membersBody.invites.length, 0);
    const roleByUser = new Map(membersBody.members.map((m) => [m.userId, m.role]));
    assert.equal(roleByUser.get(benBody.user.id), 'reviewer');
    assert.equal(roleByUser.get(cleoBody.user.id), 'viewer');

    const laneMembers = await dbHandle.db
      .selectFrom('lane_members')
      .select('subject_id')
      .where('lane_id', '=', lane.id)
      .where('subject_kind', '=', 'user')
      .execute();
    const laneUserIds = new Set(laneMembers.map((r) => r.subject_id));
    assert.ok(laneUserIds.has(benBody.user.id));
    assert.ok(laneUserIds.has(cleoBody.user.id));

    // Ben and Cleo both see the project in GET /api/sessions and GET /api/projects/:id
    for (const [cookie, expectedRole] of [
      [benCookie, 'reviewer'],
      [cleoCookie, 'viewer'],
    ] as const) {
      const projRes = await fetch(`${baseUrl}/api/projects/${project.id}`, { headers: { cookie } });
      assert.equal(projRes.status, 200);
      assert.equal(((await projRes.json()) as { role: string }).role, expectedRole);

      const sessRes = await fetch(`${baseUrl}/api/sessions`, { headers: { cookie } });
      assert.equal(sessRes.status, 200);
      const sessBody = (await sessRes.json()) as { projects: { id: string }[] };
      assert.deepEqual(
        sessBody.projects.map((p) => p.id),
        [project.id],
      );

      // Reviewer / Viewer cannot invite, change roles, or remove members (403)
      const invAttempt = await fetch(`${baseUrl}/api/projects/${project.id}/invites`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie, origin: baseUrl },
        body: JSON.stringify({ email: 'other@northbridge.example', role: 'viewer' }),
      });
      assert.equal(invAttempt.status, 403);

      const roleAttempt = await fetch(`${baseUrl}/api/projects/${project.id}/members/${cleoBody.user.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', cookie, origin: baseUrl },
        body: JSON.stringify({ role: 'project_admin' }),
      });
      assert.equal(roleAttempt.status, 403);

      const delAttempt = await fetch(`${baseUrl}/api/projects/${project.id}/members/${cleoBody.user.id}`, {
        method: 'DELETE',
        headers: { cookie, origin: baseUrl },
      });
      assert.equal(delAttempt.status, 403);
    }

    // Non-member (Dan) gets 404 on every project endpoint
    assert.equal((await fetch(`${baseUrl}/api/projects/${project.id}`, { headers: { cookie: danCookie } })).status, 404);
    assert.equal(
      (await fetch(`${baseUrl}/api/projects/${project.id}/members`, { headers: { cookie: danCookie } })).status,
      404,
    );
    assert.equal(
      (
        await fetch(`${baseUrl}/api/projects/${project.id}/invites`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie: danCookie, origin: baseUrl },
          body: JSON.stringify({ role: 'viewer' }),
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await fetch(`${baseUrl}/api/projects/${project.id}/members/${benBody.user.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', cookie: danCookie, origin: baseUrl },
          body: JSON.stringify({ role: 'viewer' }),
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await fetch(`${baseUrl}/api/projects/${project.id}/members/${benBody.user.id}`, {
          method: 'DELETE',
          headers: { cookie: danCookie, origin: baseUrl },
        })
      ).status,
      404,
    );
  });

  it('enforces the last active admin guard on role demotion and member removal', async () => {
    const ada = await createLocalUser(dbHandle.db, {
      email: 'ada@northbridge.example',
      name: 'Ada Admin',
      password: 'fictional-password-1',
    });
    const adaCookie = await login(baseUrl, 'ada@northbridge.example', 'fictional-password-1');

    const createRes = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adaCookie, origin: baseUrl },
      body: JSON.stringify({ name: 'West Station' }),
    });
    assert.equal(createRes.status, 201);
    const { project, lane } = (await createRes.json()) as { project: { id: string }; lane: { id: string } };

    // Demoting the sole admin fails with 409 last_admin
    const demoteSelf = await fetch(`${baseUrl}/api/projects/${project.id}/members/${ada.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: adaCookie, origin: baseUrl },
      body: JSON.stringify({ role: 'reviewer' }),
    });
    assert.equal(demoteSelf.status, 409);
    assert.deepEqual(await demoteSelf.json(), { error: 'last_admin' });

    // Removing the sole admin fails with 409 last_admin
    const removeSelf = await fetch(`${baseUrl}/api/projects/${project.id}/members/${ada.id}`, {
      method: 'DELETE',
      headers: { cookie: adaCookie, origin: baseUrl },
    });
    assert.equal(removeSelf.status, 409);
    assert.deepEqual(await removeSelf.json(), { error: 'last_admin' });

    // Invite Ben as reviewer and accept
    const invRes = await fetch(`${baseUrl}/api/projects/${project.id}/invites`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adaCookie, origin: baseUrl },
      body: JSON.stringify({ email: 'ben@northbridge.example', role: 'reviewer' }),
    });
    const { token } = (await invRes.json()) as { token: string };
    const benAccept = await fetch(`${baseUrl}/api/invites/${encodeURIComponent(token)}/accept`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: baseUrl },
      body: JSON.stringify({ name: 'Ben Reviewer', password: 'fictional-password-2' }),
    });
    const benCookie = (benAccept.headers.get('set-cookie') ?? '').split(';')[0]!;
    const { user: ben } = (await benAccept.json()) as { user: { id: string } };

    // Promote Ben to project_admin
    const promoteRes = await fetch(`${baseUrl}/api/projects/${project.id}/members/${ben.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: adaCookie, origin: baseUrl },
      body: JSON.stringify({ role: 'project_admin' }),
    });
    assert.equal(promoteRes.status, 200);
    assert.equal(((await promoteRes.json()) as { member: { role: string } }).member.role, 'project_admin');

    // Now Ada can demote herself to reviewer
    const demoteAdaOk = await fetch(`${baseUrl}/api/projects/${project.id}/members/${ada.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: adaCookie, origin: baseUrl },
      body: JSON.stringify({ role: 'reviewer' }),
    });
    assert.equal(demoteAdaOk.status, 200);
    assert.equal(((await demoteAdaOk.json()) as { member: { role: string } }).member.role, 'reviewer');

    // Ben (now the sole admin) cannot remove himself, but can remove Ada
    const removeBenFail = await fetch(`${baseUrl}/api/projects/${project.id}/members/${ben.id}`, {
      method: 'DELETE',
      headers: { cookie: benCookie, origin: baseUrl },
    });
    assert.equal(removeBenFail.status, 409);
    assert.deepEqual(await removeBenFail.json(), { error: 'last_admin' });

    const removeAdaOk = await fetch(`${baseUrl}/api/projects/${project.id}/members/${ada.id}`, {
      method: 'DELETE',
      headers: { cookie: benCookie, origin: baseUrl },
    });
    assert.equal(removeAdaOk.status, 200);

    // Ada's access is revoked: 404 on project, excluded from sessions, removed from lane_members
    assert.equal((await fetch(`${baseUrl}/api/projects/${project.id}`, { headers: { cookie: adaCookie } })).status, 404);
    const adaSessions = (await (await fetch(`${baseUrl}/api/sessions`, { headers: { cookie: adaCookie } })).json()) as {
      projects: unknown[];
    };
    assert.equal(adaSessions.projects.length, 0);

    const adaLaneRow = await dbHandle.db
      .selectFrom('lane_members')
      .selectAll()
      .where('lane_id', '=', lane.id)
      .where('subject_kind', '=', 'user')
      .where('subject_id', '=', ada.id)
      .executeTakeFirst();
    assert.equal(adaLaneRow, undefined);
  });
});
