import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { negotiateProtocol, PROTOCOL_VERSION, SUPPORTED_PROTOCOL, type Operation } from '@nb/ops';
import {
  extractSessionToken,
  formatClearSessionCookie,
  formatSessionCookie,
  hashPassword,
  parseCookies,
  verifyPassword,
} from './auth.ts';
import { InProcessBroadcaster, type StreamEvent } from './broadcaster.ts';
import { ConfigError, isOriginAllowed, loadConfig, normalizeOrigin } from './config.ts';
import { canonicalizeJson, hashOperationPayload } from './pipeline.ts';
import { runCli } from './cli.ts';
import { createLogger } from './logger.ts';
import { contentTypeForPath, isReservedServerPath, resolveStaticPath } from './static.ts';
import { authorizeStream } from './ws.ts';

describe('admin CLI', () => {
  const io = (lines: { stdout: string[]; stderr: string[] }, stdin = '') => ({
    stdout: (line: string) => lines.stdout.push(line),
    stderr: (line: string) => lines.stderr.push(line),
    readStdin: async () => stdin,
    // Never connected to: the command is refused before any query runs.
    env: { DATABASE_URL: 'postgres://nobody:fictional@127.0.0.1:1/none' } as NodeJS.ProcessEnv,
  });

  it('refuses a password passed on the command line', async () => {
    const lines = { stdout: [] as string[], stderr: [] as string[] };
    const code = await runCli(
      ['create-admin', '--email', 'ada@example.test', '--name', 'Ada', '--password', 'fictional-argv-pass'],
      io(lines),
    );
    assert.equal(code, 1);
    assert.match(lines.stderr.join('\n'), /--password is not supported; use --password-stdin or REDCOLUMN_ADMIN_PASSWORD/);
    assert.doesNotMatch(lines.stderr.join('\n'), /fictional-argv-pass/);
  });

  it('does not offer --password in its usage text', async () => {
    const lines = { stdout: [] as string[], stderr: [] as string[] };
    assert.equal(await runCli(['--help'], io(lines)), 0);
    const usage = lines.stdout.join('\n');
    assert.match(usage, /--password-stdin/);
    assert.doesNotMatch(usage, /--password </);
  });
});

describe('stream access', () => {
  it('allows every signed-in user on every stream until stream permissions exist', () => {
    const actor = { userId: 'user-1', partyId: null, groupId: null };
    assert.equal(authorizeStream(actor, 'doc-1', 'read'), true);
    assert.equal(authorizeStream(actor, 'doc-1', 'write'), true);
  });
});

describe('logger', () => {
  it('redacts secrets nested one level deep', () => {
    const chunks: string[] = [];
    const logger = createLogger('info', { write: (s: string) => chunks.push(s) });
    logger.info({ body: { password: 'fictional-secret' }, user: { passwordHash: 'fictional-hash', token: 'fictional-token' } }, 'login');
    const line = chunks.join('');
    assert.doesNotMatch(line, /fictional-(secret|hash|token)/);
    assert.match(line, /\[REDACTED\]/);
  });
});

function sampleMarkupCreate(overrides: Partial<Operation> = {}): Operation {
  return {
    opId: 'op-1',
    schemaVersion: PROTOCOL_VERSION,
    streamId: 'doc-1',
    type: 'markup.create',
    entityId: 'm-1',
    payload: {
      scopeId: 'scope-1',
      type: 'rect',
      content: {
        style: { stroke: '#cc0000', fill: null, width: 2, opacity: 1 },
        text: 'Check clearance',
      },
    },
    ...overrides,
  } as Operation;
}

describe('config', () => {
  it('loads defaults when only DATABASE_URL is provided', () => {
    const cfg = loadConfig({ DATABASE_URL: 'postgres://user:pass@localhost:5432/redcolumn' });
    assert.equal(cfg.databaseUrl, 'postgres://user:pass@localhost:5432/redcolumn');
    assert.equal(cfg.host, '127.0.0.1');
    assert.equal(cfg.port, 3000);
    assert.equal(cfg.logLevel, 'info');
    assert.deepEqual(cfg.allowedOrigins, []);
    assert.equal(cfg.cookieSecure, true);
    assert.equal(cfg.autoMigrate, true);
  });

  it('parses explicit overrides and deduplicates origins', () => {
    const cfg = loadConfig({
      DATABASE_URL: 'postgresql://localhost:5432/testdb',
      HOST: '0.0.0.0',
      PORT: '8080',
      LOG_LEVEL: 'debug',
      ALLOWED_ORIGINS: 'https://review.example.com, https://review.example.com/, http://localhost:5173',
      COOKIE_SECURE: 'false',
      AUTO_MIGRATE: '0',
    });
    assert.equal(cfg.host, '0.0.0.0');
    assert.equal(cfg.port, 8080);
    assert.equal(cfg.logLevel, 'debug');
    assert.deepEqual(cfg.allowedOrigins, ['https://review.example.com', 'http://localhost:5173']);
    assert.equal(cfg.cookieSecure, false);
    assert.equal(cfg.autoMigrate, false);
  });

  it('rejects invalid config values with ConfigError', () => {
    assert.throws(() => loadConfig({}), ConfigError);
    assert.throws(() => loadConfig({ DATABASE_URL: 'http://example.com' }), ConfigError);
    assert.throws(() => loadConfig({ DATABASE_URL: 'postgres://localhost/db', PORT: '99999' }), ConfigError);
    assert.throws(() => loadConfig({ DATABASE_URL: 'postgres://localhost/db', LOG_LEVEL: 'verbose' }), ConfigError);
    assert.throws(() => loadConfig({ DATABASE_URL: 'postgres://localhost/db', ALLOWED_ORIGINS: 'https://a.test/path' }), ConfigError);
    assert.throws(() => loadConfig({ DATABASE_URL: 'postgres://localhost/db', COOKIE_SECURE: 'maybe' }), ConfigError);
    assert.throws(() => loadConfig({ DATABASE_URL: 'postgres://localhost/db', LOGIN_RATE_LIMIT_MAX: '0' }), ConfigError);
    assert.throws(() => loadConfig({ DATABASE_URL: 'postgres://localhost/db', LOGIN_RATE_LIMIT_WINDOW_MS: '10' }), ConfigError);
  });

  it('limits logins to 10 per minute by default and accepts overrides', () => {
    const defaults = loadConfig({ DATABASE_URL: 'postgres://localhost/db' });
    assert.equal(defaults.loginRateLimitMax, 10);
    assert.equal(defaults.loginRateLimitWindowMs, 60_000);
    const custom = loadConfig({
      DATABASE_URL: 'postgres://localhost/db',
      LOGIN_RATE_LIMIT_MAX: '3',
      LOGIN_RATE_LIMIT_WINDOW_MS: '5000',
    });
    assert.equal(custom.loginRateLimitMax, 3);
    assert.equal(custom.loginRateLimitWindowMs, 5000);
  });

  it('normalizes and validates origins', () => {
    assert.equal(normalizeOrigin('https://App.Example.com:443'), 'https://app.example.com');
    assert.equal(isOriginAllowed('https://app.example.com', ['https://app.example.com'], 'other.host'), true);
    assert.equal(isOriginAllowed('https://evil.example.com', ['https://app.example.com'], 'app.example.com'), false);
    assert.equal(isOriginAllowed('http://localhost:3000', [], 'localhost:3000'), true);
    assert.equal(isOriginAllowed('http://evil.example', [], 'localhost:3000'), false);
    assert.equal(isOriginAllowed(undefined, [], 'localhost:3000', { allowMissingOrigin: true }), true);
    assert.equal(isOriginAllowed(undefined, [], 'localhost:3000', { allowMissingOrigin: false }), false);
  });
});

describe('canonical payload hashing', () => {
  it('produces identical hashes regardless of object key order', () => {
    const a = sampleMarkupCreate();
    const b: Operation = {
      type: 'markup.create',
      entityId: 'm-1',
      streamId: 'doc-1',
      schemaVersion: PROTOCOL_VERSION,
      opId: 'op-1',
      payload: {
        content: {
          text: 'Check clearance',
          style: { opacity: 1, width: 2, fill: null, stroke: '#cc0000' },
        },
        type: 'rect',
        scopeId: 'scope-1',
      },
    };
    assert.equal(canonicalizeJson(a), canonicalizeJson(b));
    assert.equal(hashOperationPayload(a), hashOperationPayload(b));
  });

  it('produces different hashes when payload content changes', () => {
    const a = sampleMarkupCreate();
    const b = sampleMarkupCreate({
      payload: {
        scopeId: 'scope-1',
        type: 'rect',
        content: {
          style: { stroke: '#0000ff', fill: null, width: 2, opacity: 1 },
          text: 'Check clearance',
        },
      },
    } as Partial<Operation>);
    assert.notEqual(hashOperationPayload(a), hashOperationPayload(b));
  });
});

describe('protocol negotiation', () => {
  it('accepts compatible ranges and rejects incompatible ones', () => {
    assert.deepEqual(negotiateProtocol({ min: 1, max: PROTOCOL_VERSION }), { ok: true, version: PROTOCOL_VERSION });
    assert.deepEqual(negotiateProtocol({ min: 99, max: 100 }), {
      ok: false,
      reason: 'client_too_new',
      server: SUPPORTED_PROTOCOL,
    });
    assert.deepEqual(negotiateProtocol({ min: 0, max: 0 }), {
      ok: false,
      reason: 'invalid',
      server: SUPPORTED_PROTOCOL,
    });
  });
});

describe('InProcessBroadcaster', () => {
  it('delivers events only to matching stream subscribers and isolates errors', () => {
    const errors: unknown[] = [];
    const broadcaster = new InProcessBroadcaster({ onError: (err) => errors.push(err) });
    const receivedA: StreamEvent[] = [];
    const receivedB: StreamEvent[] = [];

    const unsubBad = broadcaster.subscribe('doc-1', () => {
      throw new Error('listener boom');
    });
    const unsubA = broadcaster.subscribe('doc-1', (event) => receivedA.push(event));
    const unsubB = broadcaster.subscribe('doc-2', (event) => receivedB.push(event));

    const event: StreamEvent = {
      streamId: 'doc-1',
      seq: 1,
      opId: 'op-1',
      actorId: 'user-1',
      opType: 'markup.create',
      entityId: 'm-1',
      op: sampleMarkupCreate(),
      receivedAt: new Date().toISOString(),
    };

    broadcaster.publish(event);
    assert.equal(receivedA.length, 1);
    assert.equal(receivedB.length, 0);
    assert.equal(errors.length, 1);

    unsubBad();
    unsubA();
    unsubB();
    assert.equal(broadcaster.subscriberCount('doc-1'), 0);
  });
});

describe('auth helpers', () => {
  it('hashes and verifies passwords with argon2id', async () => {
    const hashed = await hashPassword('fictional-passphrase-42');
    assert.ok(hashed.startsWith('$argon2id$'));
    assert.equal(await verifyPassword(hashed, 'fictional-passphrase-42'), true);
    assert.equal(await verifyPassword(hashed, 'wrong-passphrase'), false);
  });

  it('formats and parses session cookies and bearer tokens', () => {
    const cookie = formatSessionCookie('rc_session', 'tok_abc', { secure: true, maxAgeSeconds: 3600 });
    assert.match(cookie, /rc_session=tok_abc/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    assert.match(cookie, /Secure/);

    const cleared = formatClearSessionCookie('rc_session', { secure: false });
    assert.match(cleared, /Max-Age=0/);
    assert.doesNotMatch(cleared, /Secure/);

    assert.deepEqual(parseCookies('a=1; rc_session=tok_abc'), { a: '1', rc_session: 'tok_abc' });
    assert.equal(extractSessionToken({ cookie: 'rc_session=tok_abc' }, 'rc_session'), 'tok_abc');
    assert.equal(extractSessionToken({ authorization: 'Bearer tok_xyz' }, 'rc_session'), 'tok_xyz');
    assert.equal(extractSessionToken({}, 'rc_session'), null);
  });
});

describe('static web serving helpers', () => {
  it('loads WEB_DIST_DIR and PUBLIC_ORIGIN from config', () => {
    const defaults = loadConfig({ DATABASE_URL: 'postgres://localhost/db' });
    assert.equal(defaults.webDistDir, null);
    assert.equal(defaults.publicOrigin, null);

    const custom = loadConfig({
      DATABASE_URL: 'postgres://localhost/db',
      WEB_DIST_DIR: '/app/web',
      PUBLIC_ORIGIN: 'https://Review.Northbridge.Example:443',
    });
    assert.equal(custom.webDistDir, '/app/web');
    assert.equal(custom.publicOrigin, 'https://review.northbridge.example');

    assert.throws(
      () => loadConfig({ DATABASE_URL: 'postgres://localhost/db', PUBLIC_ORIGIN: 'https://a.test/bad-path' }),
      ConfigError,
    );
  });

  it('resolves safe static paths and rejects path traversal attempts', () => {
    const root = '/tmp/fictional-web-dist';
    const ok = resolveStaticPath(root, '/assets/app-1234.js?v=1');
    assert.equal(ok.ok, true);
    if (ok.ok) {
      assert.equal(ok.relativePath, 'assets/app-1234.js');
    }

    for (const bad of ['/../etc/passwd', '/assets/../../secret.txt', '/%2e%2e/secret.txt', '/a\\b', '/bad%00.txt']) {
      const res = resolveStaticPath(root, bad);
      assert.equal(res.ok, false, `expected ${bad} to be rejected`);
    }
  });

  it('identifies reserved server paths and maps MIME types', () => {
    assert.equal(isReservedServerPath('/api/sessions'), true);
    assert.equal(isReservedServerPath('/auth/login'), true);
    assert.equal(isReservedServerPath('/ws'), true);
    assert.equal(isReservedServerPath('/config.json'), true);
    assert.equal(isReservedServerPath('/healthz'), true);
    assert.equal(isReservedServerPath('/assets/index.js'), false);
    assert.equal(isReservedServerPath('/invite/tok12345'), false);

    assert.equal(contentTypeForPath('index.html'), 'text/html; charset=utf-8');
    assert.equal(contentTypeForPath('app.js'), 'text/javascript; charset=utf-8');
    assert.equal(contentTypeForPath('pdfium.wasm'), 'application/wasm');
    assert.equal(contentTypeForPath('unknown.bin'), 'application/octet-stream');
  });
});
