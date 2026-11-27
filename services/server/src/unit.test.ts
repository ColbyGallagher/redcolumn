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
