import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createServerClient, ServerClientError } from './client.ts';
import { LOCAL_MODE_CONFIG, loadAppConfig, parseInviteToken } from './config.ts';

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

describe('loadAppConfig', () => {
  it('returns server mode config when /config.json is valid', async () => {
    let seenUrl = '';
    let seenCredentials: RequestCredentials | undefined;
    const cfg = await loadAppConfig(async (input, init) => {
      seenUrl = String(input);
      seenCredentials = init?.credentials;
      return jsonResponse({
        mode: 'server',
        origin: 'https://review.northbridge.example',
        version: '0.1.0',
        auth: { local: true },
      });
    });

    assert.equal(seenUrl, '/config.json');
    assert.equal(seenCredentials, 'same-origin');
    assert.deepEqual(cfg, {
      mode: 'server',
      origin: 'https://review.northbridge.example',
      version: '0.1.0',
      auth: { local: true },
    });
  });

  it('falls back to local mode on 404, 500, network error, HTML, or invalid payload', async () => {
    assert.deepEqual(
      await loadAppConfig(async () => new Response('Not Found', { status: 404 })),
      LOCAL_MODE_CONFIG,
    );
    assert.deepEqual(
      await loadAppConfig(async () => new Response('Server Error', { status: 500 })),
      LOCAL_MODE_CONFIG,
    );
    assert.deepEqual(
      await loadAppConfig(async () => {
        throw new TypeError('Failed to fetch');
      }),
      LOCAL_MODE_CONFIG,
    );
    assert.deepEqual(
      await loadAppConfig(
        async () => new Response('<!doctype html><html></html>', { status: 200, headers: { 'content-type': 'text/html' } }),
      ),
      LOCAL_MODE_CONFIG,
    );
    assert.deepEqual(
      await loadAppConfig(async () => jsonResponse({ mode: 'other', origin: 'https://example.test' })),
      LOCAL_MODE_CONFIG,
    );
    assert.deepEqual(
      await loadAppConfig(async () => jsonResponse({ mode: 'server', origin: '', version: '1.0.0', auth: { local: true } })),
      LOCAL_MODE_CONFIG,
    );
  });
});

describe('parseInviteToken', () => {
  it('extracts tokens from hash routes, pathnames, and query strings', () => {
    assert.equal(parseInviteToken({ hash: '#/invite/tok_abc12345', search: '' }), 'tok_abc12345');
    assert.equal(parseInviteToken({ hash: '#invite/tok_abc12345', search: '' }), 'tok_abc12345');
    assert.equal(parseInviteToken({ pathname: '/invite/tok_path1234', hash: '', search: '' }), 'tok_path1234');
    assert.equal(parseInviteToken({ hash: '', search: '?invite=tok_xyz98765' }), 'tok_xyz98765');
    assert.equal(parseInviteToken({ pathname: '/invite/tok_path1234', hash: '#/invite/tok_hash1234', search: '?invite=tok_query1234' }), 'tok_hash1234');
    assert.equal(parseInviteToken({ pathname: '/invite/tok_path1234', hash: '', search: '?invite=tok_query1234' }), 'tok_path1234');
  });

  it('returns null for missing, short, or malformed invite tokens', () => {
    assert.equal(parseInviteToken({ hash: '', search: '' }), null);
    assert.equal(parseInviteToken({ pathname: '/invite/short', hash: '', search: '' }), null);
    assert.equal(parseInviteToken({ pathname: '/invite/bad%20token', hash: '', search: '' }), null);
    assert.equal(parseInviteToken({ pathname: '/other/tok_abc12345', hash: '', search: '' }), null);
    assert.equal(parseInviteToken({ hash: '#/invite/short', search: '' }), null);
    assert.equal(parseInviteToken({ hash: '#/invite/bad%20token%20space', search: '' }), null);
    assert.equal(parseInviteToken({ hash: '#/other/tok_abc12345', search: '' }), null);
    assert.equal(parseInviteToken({ hash: '', search: '?invite=../escape123' }), null);
  });
});

describe('createServerClient', () => {
  it('sends credentials: same-origin on every call and maps responses', async () => {
    const calls: { url: string; method: string; credentials?: RequestCredentials; body?: string }[] = [];
    const user = {
      id: 'u-1',
      email: 'ada@northbridge.example',
      name: 'Ada Reviewer',
      role: 'admin' as const,
      isAdmin: true,
    };

    const client = createServerClient(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      calls.push({
        url,
        method,
        credentials: init?.credentials,
        body: typeof init?.body === 'string' ? init.body : undefined,
      });

      if (url === '/auth/me') return jsonResponse({ user });
      if (url === '/auth/login') return jsonResponse({ user });
      if (url === '/auth/logout') return jsonResponse({ ok: true });
      if (url === '/api/invites/tok_valid123') {
        return jsonResponse({
          invite: {
            email: 'guest@northbridge.example',
            name: 'Guest Reviewer',
            projectName: 'Harbour Bridge',
            scopeName: 'IFC Check',
            hasAccount: false,
            expiresAt: '2026-12-01T00:00:00.000Z',
          },
        });
      }
      if (url === '/api/invites/tok_valid123/accept') {
        return jsonResponse({ ok: true, user });
      }
      if (url === '/api/sessions') {
        return jsonResponse({
          projects: [{ id: 'p-1', name: 'Harbour Bridge', number: 'NB-101', createdAt: '2026-11-01T00:00:00.000Z' }],
          sessions: [
            {
              id: 's-1',
              projectId: 'p-1',
              projectName: 'Harbour Bridge',
              kind: 'session',
              name: 'IFC Check',
              state: 'open',
              createdAt: '2026-11-02T00:00:00.000Z',
            },
          ],
        });
      }
      return jsonResponse({ error: 'not_found' }, 404);
    });

    assert.deepEqual(await client.me(), user);
    assert.deepEqual(await client.login('ada@northbridge.example', 'fictional-pass-123'), user);
    const preview = await client.previewInvite('tok_valid123');
    assert.equal(preview.projectName, 'Harbour Bridge');
    assert.deepEqual(await client.acceptInvite('tok_valid123', { name: 'Guest', password: 'fictional-pass-123' }), user);
    const sessions = await client.listSessions();
    assert.equal(sessions.projects.length, 1);
    assert.equal(sessions.sessions.length, 1);
    await client.logout();

    assert.equal(calls.length, 6);
    for (const call of calls) {
      assert.equal(call.credentials, 'same-origin');
    }
  });

  it('returns null from me() on 401 and throws ServerClientError on API failures', async () => {
    const client = createServerClient(async (input) => {
      if (String(input) === '/auth/me') return jsonResponse({ error: 'unauthenticated' }, 401);
      if (String(input) === '/auth/login') return jsonResponse({ error: 'invalid_credentials' }, 401);
      return jsonResponse({ error: 'invite_expired' }, 410);
    });

    assert.equal(await client.me(), null);

    await assert.rejects(
      () => client.login('ada@northbridge.example', 'wrong'),
      (err: unknown) => err instanceof ServerClientError && err.status === 401 && err.code === 'invalid_credentials',
    );

    await assert.rejects(
      () => client.previewInvite('tok_expired123'),
      (err: unknown) => err instanceof ServerClientError && err.status === 410 && err.code === 'invite_expired',
    );
  });

  it('supports project creation, member listing, invites, role updates, and removal', async () => {
    const calls: { url: string; method: string; credentials?: RequestCredentials; body?: string }[] = [];

    const client = createServerClient(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      calls.push({
        url,
        method,
        credentials: init?.credentials,
        body: typeof init?.body === 'string' ? init.body : undefined,
      });

      if (url === '/api/projects' && method === 'POST') {
        return jsonResponse(
          {
            project: {
              id: 'p-2',
              name: 'River Tunnel',
              number: 'NB-202',
              description: 'Structural review',
              role: 'project_admin',
              createdAt: '2026-11-10T00:00:00.000Z',
            },
            scope: {
              id: 's-2',
              projectId: 'p-2',
              projectName: 'River Tunnel',
              kind: 'session',
              name: 'General review',
              state: 'open',
              createdAt: '2026-11-10T00:00:00.000Z',
            },
            lane: { id: 'l-2', name: 'Team' },
            role: 'project_admin',
          },
          201,
        );
      }
      if (url === '/api/projects/p-2' && method === 'GET') {
        return jsonResponse({
          project: {
            id: 'p-2',
            name: 'River Tunnel',
            number: 'NB-202',
            description: 'Structural review',
            role: 'project_admin',
            createdAt: '2026-11-10T00:00:00.000Z',
          },
          role: 'project_admin',
        });
      }
      if (url === '/api/projects/p-2/members' && method === 'GET') {
        return jsonResponse({
          role: 'project_admin',
          members: [
            {
              userId: 'u-1',
              email: 'ada@northbridge.example',
              name: 'Ada Admin',
              role: 'project_admin',
              state: 'active',
              createdAt: '2026-11-10T00:00:00.000Z',
            },
          ],
          invites: [],
        });
      }
      if (url === '/api/projects/p-2/invites' && method === 'POST') {
        return jsonResponse(
          {
            invite: {
              id: 'inv-1',
              email: 'ben@northbridge.example',
              name: null,
              role: 'reviewer',
              expiresAt: '2026-11-17T00:00:00.000Z',
              createdAt: '2026-11-10T00:00:00.000Z',
            },
            token: 'tok_invite1234',
            inviteUrl: '/#/invite/tok_invite1234',
          },
          201,
        );
      }
      if (url === '/api/projects/p-2/members/u-2' && method === 'PATCH') {
        return jsonResponse({
          member: {
            userId: 'u-2',
            email: 'ben@northbridge.example',
            name: 'Ben Reviewer',
            role: 'viewer',
            state: 'active',
            createdAt: '2026-11-10T00:00:00.000Z',
          },
        });
      }
      if (url === '/api/projects/p-2/members/u-1' && method === 'PATCH') {
        return jsonResponse({ error: 'last_admin' }, 409);
      }
      if (url === '/api/projects/p-2/invites/inv-1' && method === 'DELETE') {
        return jsonResponse({ ok: true, inviteId: 'inv-1' });
      }
      if (url === '/api/projects/p-2/members/u-2' && method === 'DELETE') {
        return jsonResponse({ ok: true, userId: 'u-2' });
      }
      return jsonResponse({ error: 'not_found' }, 404);
    });

    const created = await client.createProject({
      name: 'River Tunnel',
      number: 'NB-202',
      description: 'Structural review',
    });
    assert.equal(created.project.id, 'p-2');
    assert.equal(created.role, 'project_admin');

    const proj = await client.getProject('p-2');
    assert.equal(proj.project.name, 'River Tunnel');

    const members = await client.listProjectMembers('p-2');
    assert.equal(members.members.length, 1);

    const invited = await client.createProjectInvite('p-2', {
      email: 'ben@northbridge.example',
      role: 'reviewer',
    });
    assert.equal(invited.inviteUrl, '/#/invite/tok_invite1234');
    // The path the server returns is one the app reads the token back out of.
    const link = new URL(invited.inviteUrl, 'https://review.northbridge.example');
    assert.equal(parseInviteToken(link), 'tok_invite1234');

    const updated = await client.updateProjectMemberRole('p-2', 'u-2', 'viewer');
    assert.equal(updated.role, 'viewer');

    await assert.rejects(
      () => client.updateProjectMemberRole('p-2', 'u-1', 'reviewer'),
      (err: unknown) => err instanceof ServerClientError && err.status === 409 && err.code === 'last_admin',
    );

    await client.removeProjectMember('p-2', 'u-2');

    await client.revokeProjectInvite('p-2', invited.invite.id);
    assert.deepEqual(
      calls.at(-1),
      { url: '/api/projects/p-2/invites/inv-1', method: 'DELETE', credentials: 'same-origin', body: undefined },
    );

    assert.equal(calls.length, 8);
    for (const call of calls) {
      assert.equal(call.credentials, 'same-origin');
    }
  });
});
