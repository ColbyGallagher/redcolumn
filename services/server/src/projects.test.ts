import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
// Imported by path: @nb/policy is not a dependency of the server, so this guards the server's copy.
import { DEFAULT_STATUSES } from '../../../packages/policy/src/presets.ts';
import { buildServer, type ServerInstance } from './app.ts';
import { createLocalUser } from './auth.ts';
import { loadConfig, type ServerConfig } from './config.ts';
import { createDb, type DbHandle, type ProjectRole } from './db.ts';
import { createInvite } from './invites.ts';
import { createLogger } from './logger.ts';
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
    LOGIN_RATE_LIMIT_MAX: '1000',
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
    assert.equal(revInvite.inviteUrl, `/#/invite/${revInvite.token}`);

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
    assert.equal(viewInvite.inviteUrl, `/#/invite/${viewInvite.token}`);

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

  const PASSWORD = 'fictional-password-1';

  interface Person {
    id: string;
    email: string;
    cookie: string;
  }

  async function person(handle: string): Promise<Person> {
    const email = `${handle}@northbridge.example`;
    const user = await createLocalUser(dbHandle.db, { email, name: `${handle} Example`, password: PASSWORD });
    return { id: user.id, email, cookie: await login(baseUrl, email, PASSWORD) };
  }

  async function api(
    method: string,
    path: string,
    cookie?: string,
    body?: unknown,
  ): Promise<{ status: number; body: any; cookie: string }> {
    const headers: Record<string, string> = { origin: baseUrl };
    if (cookie) headers.cookie = cookie;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return {
      status: res.status,
      body: await res.json(),
      cookie: (res.headers.get('set-cookie') ?? '').split(';')[0]!,
    };
  }

  async function newProject(owner: Person, name = 'Quay Wall'): Promise<{ id: string; laneId: string; scopeId: string }> {
    const res = await api('POST', '/api/projects', owner.cookie, { name });
    assert.equal(res.status, 201);
    return { id: res.body.project.id, laneId: res.body.lane.id, scopeId: res.body.scope.id };
  }

  async function invite(
    projectId: string,
    by: Person,
    input: { role: ProjectRole; email?: string },
  ): Promise<{ id: string; token: string }> {
    const res = await api('POST', `/api/projects/${projectId}/invites`, by.cookie, input);
    assert.equal(res.status, 201);
    return { id: res.body.invite.id, token: res.body.token };
  }

  const accept = (token: string, cookie?: string, body: unknown = {}) =>
    api('POST', `/api/invites/${token}/accept`, cookie, body);

  async function join(projectId: string, admin: Person, who: Person, role: ProjectRole): Promise<void> {
    const { token } = await invite(projectId, admin, { role });
    assert.equal((await accept(token, who.cookie)).status, 200);
  }

  const setRole = (projectId: string, by: Person, target: Person, role: ProjectRole) =>
    api('PATCH', `/api/projects/${projectId}/members/${target.id}`, by.cookie, { role });

  const removeMember = (projectId: string, by: Person, target: Person) =>
    api('DELETE', `/api/projects/${projectId}/members/${target.id}`, by.cookie);

  const revoke = (projectId: string, by: Person, inviteId: string) =>
    api('DELETE', `/api/projects/${projectId}/invites/${inviteId}`, by.cookie);

  async function membership(projectId: string, who: Person) {
    return dbHandle.db
      .selectFrom('project_members')
      .select(['role', 'state'])
      .where('project_id', '=', projectId)
      .where('user_id', '=', who.id)
      .executeTakeFirst();
  }

  async function inviteRow(inviteId: string) {
    return dbHandle.db
      .selectFrom('invites')
      .select(['accepted_at', 'revoked_at'])
      .where('id', '=', inviteId)
      .executeTakeFirstOrThrow();
  }

  async function activeAdminCount(projectId: string): Promise<number> {
    const rows = await dbHandle.db
      .selectFrom('project_members')
      .select('user_id')
      .where('project_id', '=', projectId)
      .where('role', '=', 'project_admin')
      .where('state', '=', 'active')
      .execute();
    return rows.length;
  }

  async function userCount(): Promise<number> {
    return (await dbHandle.db.selectFrom('users').select('id').execute()).length;
  }

  async function lanesOf(who: Person): Promise<string[]> {
    const rows = await dbHandle.db
      .selectFrom('lane_members')
      .select('lane_id')
      .where('subject_kind', '=', 'user')
      .where('subject_id', '=', who.id)
      .execute();
    return rows.map((r) => r.lane_id).sort();
  }

  it('never lets the sole admin demote themself by accepting an invite', async () => {
    const ada = await person('ada');
    const project = await newProject(ada);
    const link = await invite(project.id, ada, { role: 'viewer' });

    const res = await accept(link.token, ada.cookie);
    assert.equal(res.status, 409);
    assert.deepEqual(res.body, { error: 'already_member' });
    assert.deepEqual(await membership(project.id, ada), { role: 'project_admin', state: 'active' });
    assert.equal((await api('GET', `/api/projects/${project.id}/members`, ada.cookie)).body.role, 'project_admin');

    // The refused invite stays unused, for the person it was meant for.
    assert.equal((await inviteRow(link.id)).accepted_at, null);
    const ben = await person('ben');
    assert.equal((await accept(link.token, ben.cookie)).status, 200);
    assert.deepEqual(await membership(project.id, ben), { role: 'viewer', state: 'active' });
  });

  it('keeps an active member’s role when they accept a stale or higher-role invite', async () => {
    const ada = await person('ada');
    const ben = await person('ben');
    const project = await newProject(ada);
    const stale = await invite(project.id, ada, { role: 'viewer', email: ben.email });
    await join(project.id, ada, ben, 'reviewer');
    assert.equal((await setRole(project.id, ada, ben, 'project_admin')).status, 200);

    assert.deepEqual((await accept(stale.token, ben.cookie)).body, { error: 'already_member' });
    assert.deepEqual(await membership(project.id, ben), { role: 'project_admin', state: 'active' });

    assert.equal((await setRole(project.id, ada, ben, 'viewer')).status, 200);
    const upgrade = await invite(project.id, ada, { role: 'project_admin' });
    assert.equal((await accept(upgrade.token, ben.cookie)).status, 409);
    assert.deepEqual(await membership(project.id, ben), { role: 'viewer', state: 'active' });
  });

  it('withdraws earlier invites made by or sent to a removed member', async () => {
    const ada = await person('ada');
    const eve = await person('eve');
    const project = await newProject(ada);
    // Sent to Eve before they joined, so it is still unused when they are removed.
    const toEve = await invite(project.id, ada, { role: 'project_admin', email: 'EVE@northbridge.example' });
    await join(project.id, ada, eve, 'project_admin');
    const keptBack = await invite(project.id, eve, { role: 'project_admin' });
    const byEveByEmail = await invite(project.id, eve, { role: 'project_admin', email: 'mallory@northbridge.example' });
    const unrelated = await invite(project.id, ada, { role: 'reviewer' });

    assert.equal((await removeMember(project.id, ada, eve)).status, 200);

    for (const withdrawn of [keptBack, toEve]) {
      const res = await accept(withdrawn.token, eve.cookie);
      assert.equal(res.status, 410);
      assert.deepEqual(res.body, { error: 'invite_revoked' });
    }
    const usersBefore = await userCount();
    const anonymous = await accept(byEveByEmail.token, undefined, { name: 'Mallory', password: PASSWORD });
    assert.deepEqual(anonymous.body, { error: 'invite_revoked' });
    assert.equal(await userCount(), usersBefore);
    const preview = await api('GET', `/api/invites/${keptBack.token}`);
    assert.equal(preview.status, 410);
    assert.deepEqual(preview.body, { error: 'invite_revoked' });

    assert.equal((await membership(project.id, eve))!.state, 'removed');
    assert.equal((await api('GET', `/api/projects/${project.id}`, eve.cookie)).status, 404);
    assert.deepEqual(await lanesOf(eve), []);
    const pending = (await api('GET', `/api/projects/${project.id}/members`, ada.cookie)).body.invites;
    assert.deepEqual(pending.map((i: { id: string }) => i.id), [unrelated.id]);

    // An admin can invite a removed user again.
    await join(project.id, ada, eve, 'viewer');
    assert.deepEqual(await membership(project.id, eve), { role: 'viewer', state: 'active' });
    assert.deepEqual(await lanesOf(eve), [project.laneId]);
  });

  it('withdraws the invites a demoted admin made, even after they are promoted again', async () => {
    const ada = await person('ada');
    const eve = await person('eve');
    const project = await newProject(ada);
    await join(project.id, ada, eve, 'project_admin');
    const keptBack = await invite(project.id, eve, { role: 'project_admin' });

    assert.equal((await setRole(project.id, ada, eve, 'reviewer')).status, 200);
    assert.notEqual((await inviteRow(keptBack.id)).revoked_at, null);

    // Removed afterwards, Eve cannot use it to come back as an admin.
    assert.equal((await removeMember(project.id, ada, eve)).status, 200);
    assert.deepEqual((await accept(keptBack.token, eve.cookie)).body, { error: 'invite_revoked' });
    assert.equal((await membership(project.id, eve))!.state, 'removed');

    await join(project.id, ada, eve, 'project_admin');
    const gus = await person('gus');
    assert.deepEqual((await accept(keptBack.token, gus.cookie)).body, { error: 'invite_revoked' });
  });

  it('refuses an invite whose creator has lost authority, even if it was never revoked', async () => {
    const ada = await person('ada');
    const eve = await person('eve');
    const gus = await person('gus');
    const project = await newProject(ada);
    await join(project.id, ada, eve, 'project_admin');
    const link = await invite(project.id, eve, { role: 'project_admin' });

    for (const change of [{ role: 'reviewer' as const }, { state: 'removed' as const }]) {
      await dbHandle.db
        .updateTable('project_members')
        .set({ role: 'project_admin', state: 'active', ...change })
        .where('project_id', '=', project.id)
        .where('user_id', '=', eve.id)
        .execute();
      assert.deepEqual((await accept(link.token, gus.cookie)).body, { error: 'invite_revoked' });
    }

    await dbHandle.db
      .updateTable('project_members')
      .set({ role: 'project_admin', state: 'active' })
      .where('user_id', '=', eve.id)
      .execute();
    await dbHandle.db.updateTable('users').set({ disabled_at: new Date() }).where('id', '=', eve.id).execute();
    assert.deepEqual((await accept(link.token, gus.cookie)).body, { error: 'invite_revoked' });
    assert.equal(await membership(project.id, gus), undefined);
    assert.equal((await inviteRow(link.id)).accepted_at, null);
  });

  it('lets only project admins revoke a pending invite', async () => {
    const ada = await person('ada');
    const vic = await person('vic');
    const dan = await person('dan');
    const project = await newProject(ada);
    await join(project.id, ada, vic, 'viewer');
    const other = await newProject(dan, 'Pump House');
    const link = await invite(project.id, ada, { role: 'reviewer' });

    assert.equal((await revoke(project.id, vic, link.id)).status, 403);
    assert.deepEqual((await revoke(project.id, dan, link.id)).body, { error: 'not_found' });
    // Another project's admin cannot reach it through their own project.
    assert.deepEqual((await revoke(other.id, dan, link.id)).body, { error: 'invite_not_found' });
    assert.equal((await inviteRow(link.id)).revoked_at, null);

    const ok = await revoke(project.id, ada, link.id);
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.body, { ok: true, inviteId: link.id });
    assert.equal((await revoke(project.id, ada, link.id)).status, 200);
    assert.deepEqual((await accept(link.token, dan.cookie)).body, { error: 'invite_revoked' });
    assert.deepEqual((await api('GET', `/api/projects/${project.id}/members`, ada.cookie)).body.invites, []);

    const used = await invite(project.id, ada, { role: 'reviewer' });
    assert.equal((await accept(used.token, dan.cookie)).status, 200);
    const tooLate = await revoke(project.id, ada, used.id);
    assert.equal(tooLate.status, 409);
    assert.deepEqual(tooLate.body, { error: 'invite_already_accepted' });
  });

  it('shows pending invitees to project admins only', async () => {
    const ada = await person('ada');
    const rae = await person('rae');
    const vic = await person('vic');
    const pat = await person('pat');
    const project = await newProject(ada);
    await join(project.id, ada, rae, 'reviewer');
    await join(project.id, ada, vic, 'viewer');
    await invite(project.id, ada, { role: 'project_admin', email: 'secret.hire@northbridge.example' });
    await dbHandle.db
      .insertInto('project_members')
      .values({ project_id: project.id, user_id: pat.id, party_id: null, role: 'project_admin', state: 'invited' })
      .execute();

    const asAdmin = (await api('GET', `/api/projects/${project.id}/members`, ada.cookie)).body;
    assert.equal(asAdmin.invites.length, 1);
    assert.equal(asAdmin.members.length, 4);

    for (const who of [rae, vic]) {
      const body = (await api('GET', `/api/projects/${project.id}/members`, who.cookie)).body;
      assert.deepEqual(body.invites, []);
      assert.equal(body.members.length, 3);
      assert.doesNotMatch(JSON.stringify(body), /secret\.hire|pat@|pat Example/);
    }
  });

  it('uses a link-only invite once, including under concurrent accepts', async () => {
    const ada = await person('ada');
    const project = await newProject(ada);
    const link = await invite(project.id, ada, { role: 'reviewer' });
    const body = { email: 'cleo@northbridge.example', name: 'Cleo Example', password: PASSWORD };
    const first = await accept(link.token, undefined, body);
    assert.equal(first.status, 200);

    const usersBefore = await userCount();
    const dan = await person('dan');
    for (const replay of [
      await accept(link.token, undefined, { ...body, email: 'mallory@northbridge.example' }),
      await accept(link.token, dan.cookie),
      await accept(link.token, first.cookie),
    ]) {
      assert.equal(replay.status, 409);
      assert.deepEqual(replay.body, { error: 'invite_already_accepted' });
    }
    assert.equal(await userCount(), usersBefore + 1);
    assert.equal(await membership(project.id, dan), undefined);

    const raced = await invite(project.id, ada, { role: 'viewer' });
    const before = await userCount();
    const results = await Promise.all(
      ['r1', 'r2', 'r3', 'r4'].map((handle) =>
        accept(raced.token, undefined, { email: `${handle}@northbridge.example`, name: handle, password: PASSWORD }),
      ),
    );
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409, 409, 409]);
    assert.equal(await userCount(), before + 1);
  });

  it('enforces expiry and the invited email on project invites', async () => {
    const ada = await person('ada');
    const ben = await person('ben');
    const dan = await person('dan');
    const project = await newProject(ada);
    const forBen = await invite(project.id, ada, { role: 'reviewer', email: ben.email });

    const wrong = await accept(forBen.token, dan.cookie);
    assert.equal(wrong.status, 403);
    assert.deepEqual(wrong.body, { error: 'email_mismatch' });
    assert.equal(await membership(project.id, dan), undefined);
    assert.equal((await inviteRow(forBen.id)).accepted_at, null);
    // Signed out, an email in the body does not replace the invited one.
    const spoof = await accept(forBen.token, undefined, {
      email: 'mallory@northbridge.example',
      name: 'Mallory',
      password: PASSWORD,
    });
    assert.deepEqual(spoof.body, { error: 'account_exists' });

    await dbHandle.db
      .updateTable('invites')
      .set({ expires_at: new Date(Date.now() - 1000) })
      .where('id', '=', forBen.id)
      .execute();
    const expired = await accept(forBen.token, ben.cookie);
    assert.equal(expired.status, 410);
    assert.deepEqual(expired.body, { error: 'invite_expired' });
    assert.equal((await api('GET', `/api/invites/${forBen.token}`)).status, 410);
    assert.equal(await membership(project.id, ben), undefined);
  });

  it('answers a link accept without a usable password the same way whether or not the account exists', async () => {
    const ada = await person('ada');
    const project = await newProject(ada);
    const link = await invite(project.id, ada, { role: 'viewer' });
    for (const email of [ada.email, 'nobody@northbridge.example']) {
      const res = await accept(link.token, undefined, { email, name: 'Probe', password: 'short' });
      assert.equal(res.status, 400);
      assert.deepEqual(res.body, { error: 'invalid_password' });
    }
  });

  it('keeps an active admin through concurrent demotions and removals', async () => {
    const ada = await person('ada');
    const ben = await person('ben');
    const project = await newProject(ada);
    await join(project.id, ada, ben, 'project_admin');
    const reset = () =>
      dbHandle.db
        .updateTable('project_members')
        .set({ role: 'project_admin', state: 'active' })
        .where('project_id', '=', project.id)
        .execute();

    const races = [
      () => [setRole(project.id, ada, ben, 'reviewer'), setRole(project.id, ben, ada, 'reviewer')],
      () => [setRole(project.id, ada, ada, 'reviewer'), setRole(project.id, ben, ben, 'reviewer')],
      () => [removeMember(project.id, ada, ben), removeMember(project.id, ben, ada)],
      () => [removeMember(project.id, ada, ada), setRole(project.id, ben, ben, 'viewer')],
    ];
    for (let round = 0; round < 8; round += 1) {
      for (const [index, race] of races.entries()) {
        await reset();
        const results = await Promise.all(race());
        assert.equal(results.filter((r) => r.status === 200).length, 1, `race ${index}, round ${round}`);
        for (const r of results) assert.ok([200, 403, 404, 409].includes(r.status), `unexpected ${r.status}`);
        assert.equal(await activeAdminCount(project.id), 1, `race ${index}, round ${round}`);
      }
    }
  });

  it('keeps an active admin when invite accepts race with admin changes', async () => {
    const ada = await person('ada');
    const ben = await person('ben');
    const project = await newProject(ada);
    await join(project.id, ada, ben, 'project_admin');

    for (let round = 0; round < 8; round += 1) {
      await dbHandle.db
        .updateTable('project_members')
        .set({ role: 'project_admin', state: 'active' })
        .where('project_id', '=', project.id)
        .execute();
      const forAda = await invite(project.id, ben, { role: 'viewer' });
      const forBen = await invite(project.id, ada, { role: 'viewer' });

      const [adaStepsDown, benStepsDown, adaAccepts, benAccepts] = await Promise.all([
        setRole(project.id, ada, ada, 'reviewer'),
        setRole(project.id, ben, ben, 'reviewer'),
        accept(forAda.token, ada.cookie),
        accept(forBen.token, ben.cookie),
      ]);
      assert.deepEqual([adaStepsDown.status, benStepsDown.status].sort(), [200, 409], `round ${round}`);
      // Refused because they are active, or because the creator had already stepped down.
      for (const r of [adaAccepts, benAccepts]) {
        assert.ok(['already_member', 'invite_revoked'].includes(r.body.error), JSON.stringify(r.body));
      }
      assert.equal(await activeAdminCount(project.id), 1, `round ${round}`);
    }

    // Removal racing the removed admin's own kept-back link: they never get back in.
    for (let round = 0; round < 8; round += 1) {
      await dbHandle.db
        .updateTable('project_members')
        .set({ role: 'project_admin', state: 'active' })
        .where('project_id', '=', project.id)
        .execute();
      const keptBack = await invite(project.id, ben, { role: 'project_admin' });
      const [removal, comeback] = await Promise.all([
        removeMember(project.id, ada, ben),
        accept(keptBack.token, ben.cookie),
      ]);
      assert.equal(removal.status, 200);
      assert.notEqual(comeback.status, 200);
      assert.equal((await membership(project.id, ben))!.state, 'removed', `round ${round}`);
      assert.equal(await activeAdminCount(project.id), 1);
    }
  });

  it('leaves no live invite behind when an admin creates one while being demoted', async () => {
    const ada = await person('ada');
    const eve = await person('eve');
    const project = await newProject(ada);
    await join(project.id, ada, eve, 'project_admin');
    for (let round = 0; round < 8; round += 1) {
      await dbHandle.db
        .updateTable('project_members')
        .set({ role: 'project_admin', state: 'active' })
        .where('project_id', '=', project.id)
        .execute();
      const [created, demoted] = await Promise.all([
        api('POST', `/api/projects/${project.id}/invites`, eve.cookie, { role: 'project_admin' }),
        setRole(project.id, ada, eve, 'reviewer'),
      ]);
      assert.equal(demoted.status, 200);
      assert.ok([201, 403].includes(created.status));
      const live = await dbHandle.db
        .selectFrom('invites')
        .select('id')
        .where('created_by', '=', eve.id)
        .where('accepted_at', 'is', null)
        .where('revoked_at', 'is', null)
        .execute();
      assert.deepEqual(live, [], `round ${round}`);
    }
  });

  it('never adds a project creator to a workspace someone else set up', async () => {
    const ada = await person('ada');
    const vic = await person('vic');
    const first = await newProject(ada);
    await join(first.id, ada, vic, 'viewer');
    const vicProject = await newProject(vic, 'Vic Project');
    const vicSecond = await newProject(vic, 'Vic Project 2');

    const workspaceOf = async (projectId: string) =>
      (await dbHandle.db.selectFrom('projects').select('workspace_id').where('id', '=', projectId).executeTakeFirstOrThrow())
        .workspace_id;
    assert.notEqual(await workspaceOf(vicProject.id), await workspaceOf(first.id));
    assert.equal(await workspaceOf(vicSecond.id), await workspaceOf(vicProject.id));
    const vicWorkspaces = await dbHandle.db
      .selectFrom('workspace_members')
      .select(['workspace_id', 'role'])
      .where('user_id', '=', vic.id)
      .execute();
    assert.deepEqual(vicWorkspaces, [{ workspace_id: await workspaceOf(vicProject.id), role: 'admin' }]);

    const cal = await person('cal');
    await Promise.all([newProject(cal, 'One'), newProject(cal, 'Two')]);
    const calWorkspaces = await dbHandle.db
      .selectFrom('workspace_members')
      .select('workspace_id')
      .where('user_id', '=', cal.id)
      .execute();
    assert.equal(calWorkspaces.length, 1);
  });

  it('gives a new project the policy default statuses and lets project admins close issues', async () => {
    const ada = await person('ada');
    const project = await newProject(ada);
    const statuses = await dbHandle.db
      .selectFrom('statuses')
      .select(['id', 'name', 'category'])
      .where('project_id', '=', project.id)
      .orderBy('position', 'asc')
      .execute();
    assert.deepEqual(statuses, [...DEFAULT_STATUSES]);
    const scope = await dbHandle.db
      .selectFrom('scopes')
      .select('closing_json')
      .where('id', '=', project.scopeId)
      .executeTakeFirstOrThrow();
    assert.deepEqual(scope.closing_json, { allowedClosers: [{ kind: 'role', role: 'project_admin' }] });
  });

  it('adds an invitee to one lane only, and refuses a scope with several lanes', async () => {
    const ada = await person('ada');
    const ben = await person('ben');
    const dan = await person('dan');
    const project = await newProject(ada);
    // A later session with its own lane is not joined.
    await dbHandle.db
      .insertInto('scopes')
      .values({ id: 'sc-later', project_id: project.id, kind: 'session', name: 'Later session', session_state: 'open' })
      .execute();
    await dbHandle.db
      .insertInto('lanes')
      .values({ id: 'ln-later', project_id: project.id, scope_id: 'sc-later', name: 'Later', lead_party_id: null })
      .execute();
    const unscoped = await createInvite(dbHandle.db, { projectId: project.id, createdBy: ada.id });
    assert.equal((await accept(unscoped.token, ben.cookie)).status, 200);
    assert.deepEqual(await lanesOf(ben), [project.laneId]);

    // A second lane in the default scope is a wall: nobody is put on a side by guesswork.
    await dbHandle.db
      .insertInto('lanes')
      .values({ id: 'ln-wall', project_id: project.id, scope_id: project.scopeId, name: 'Other side', lead_party_id: null })
      .execute();
    const walled = await invite(project.id, ada, { role: 'viewer' });
    const usersBefore = await userCount();
    for (const res of [
      await accept(walled.token, dan.cookie),
      await accept(walled.token, undefined, { email: 'new@northbridge.example', name: 'New', password: PASSWORD }),
    ]) {
      assert.equal(res.status, 409);
      assert.deepEqual(res.body, { error: 'lane_unresolved' });
    }
    assert.equal(await userCount(), usersBefore);
    assert.equal(await membership(project.id, dan), undefined);
    assert.deepEqual(await lanesOf(dan), []);
    assert.equal((await inviteRow(walled.id)).accepted_at, null);
  });

  it('only allows a link-only invite to add an ordinary user to a project', async () => {
    const ada = await person('ada');
    const project = await newProject(ada);
    await assert.rejects(() => createInvite(dbHandle.db, { createdBy: ada.id }), /without an email/);
    await assert.rejects(() => createInvite(dbHandle.db, { role: 'admin', createdBy: ada.id }), /without an email/);
    await assert.rejects(
      () => createInvite(dbHandle.db, { role: 'admin', projectId: project.id, createdBy: ada.id }),
      /without an email/,
    );

    // The database refuses the same rows from any other writer.
    const insert = (email: string | null, emailLower: string | null, projectId: string | null, role: string) =>
      dbHandle.pool.query(
        `INSERT INTO invites (id, token_hash, email, email_lower, project_id, role, expires_at)
         VALUES (gen_random_uuid()::text, gen_random_uuid()::text, $1, $2, $3, $4, NOW() + INTERVAL '1 day')`,
        [email, emailLower, projectId, role],
      );
    await assert.rejects(() => insert(null, null, null, 'user'), /invites_link_only_check/);
    await assert.rejects(() => insert(null, null, project.id, 'admin'), /invites_link_only_check/);
    await assert.rejects(() => insert('x@northbridge.example', null, project.id, 'user'), /invites_email_pair_check/);
    await assert.rejects(() => insert(null, 'x@northbridge.example', null, 'user'), /invites_email_pair_check/);
    await insert('ops@northbridge.example', 'ops@northbridge.example', null, 'admin');
  });

  it('keeps invite tokens out of the request log', async () => {
    const lines: string[] = [];
    const logged = buildServer({
      config: makeConfig(),
      db: dbHandle.db,
      pool: dbHandle.pool,
      logger: createLogger('info', { write: (line: string) => void lines.push(line) }),
    });
    try {
      await logged.app.listen({ host: '127.0.0.1', port: 0 });
      const addr = logged.app.server.address();
      assert.ok(addr && typeof addr === 'object');
      const origin = `http://127.0.0.1:${addr.port}`;
      const token = 'fictional-invite-token-0123456789';
      await fetch(`${origin}/api/invites/${token}`);
      await fetch(`${origin}/api/invites/${token}/accept`, { method: 'POST', headers: { origin } });
      // No web app is mounted, so these reach Fastify's 404 handler, whose message quotes the URL.
      await fetch(`${origin}/invite/${token}`);
      await fetch(`${origin}/?invite=${token}`);
    } finally {
      await logged.app.close();
    }
    const output = lines.join('');
    assert.doesNotMatch(output, /fictional-invite-token/);
    assert.match(output, /"url":"\/api\/invites\/\[REDACTED\]\/accept"/);
    assert.match(output, /"url":"\/invite\/\[REDACTED\]"/);
    assert.match(output, /"url":"\/\?invite=\[REDACTED\]"/);
    assert.match(output, /Route GET:\/invite\/\[REDACTED\] not found/);
  });
});
