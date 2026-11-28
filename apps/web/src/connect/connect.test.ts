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
  it('extracts tokens from hash routes and query strings', () => {
    assert.equal(parseInviteToken({ hash: '#/invite/tok_abc12345', search: '' }), 'tok_abc12345');
    assert.equal(parseInviteToken({ hash: '#invite/tok_abc12345', search: '' }), 'tok_abc12345');
    assert.equal(parseInviteToken({ hash: '', search: '?invite=tok_xyz98765' }), 'tok_xyz98765');
    assert.equal(parseInviteToken({ hash: '#/invite/tok_hash1234', search: '?invite=tok_query1234' }), 'tok_hash1234');
  });

  it('returns null for missing, short, or malformed invite tokens', () => {
    assert.equal(parseInviteToken({ hash: '', search: '' }), null);
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
});
