import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { isBlockedAddress, nodeTransport, pkiRequest, safeLookup, type Answer, type Transport } from './pki.ts';

async function* chunks(...parts: (string | Uint8Array)[]) {
  for (const p of parts) yield typeof p === 'string' ? new TextEncoder().encode(p) : p;
}

/** A fake transport answering from `answer`; records what was asked. */
function fake(answer: (url: URL, init: Parameters<Transport>[1]) => Partial<Answer> = () => ({})) {
  const calls: { url: string; method: string; body?: Uint8Array; type?: string }[] = [];
  const cancelled: string[] = [];
  const transport: Transport = async (url, init) => {
    calls.push({ url: url.href, method: init.method, body: init.body, type: init.type });
    const a = answer(url, init);
    return { status: 200, location: null, length: null, body: chunks('\x01\x02\x03'), cancel: () => cancelled.push(url.href), ...a };
  };
  return { transport, calls, cancelled };
}

test('posts a time stamp request and returns the answer', async () => {
  const { transport, calls } = fake();
  const bytes = await pkiRequest('http://timestamp.digicert.com', new Uint8Array([9]), 'application/timestamp-query', transport);
  assert.deepEqual([...bytes], [1, 2, 3]);
  assert.equal(calls[0]!.method, 'POST');
  assert.equal(calls[0]!.type, 'application/timestamp-query');
});

test('gets a revocation list without a body', async () => {
  const { transport, calls } = fake();
  await pkiRequest('https://crl.example.com/ca.crl', undefined, undefined, transport);
  assert.equal(calls[0]!.method, 'GET');
  assert.equal(calls[0]!.body, undefined);
});

test('refuses other schemes, literal local addresses, and other kinds of POST', async () => {
  const { transport, calls } = fake();
  for (const url of ['file:///etc/passwd', 'ftp://ca.example.com/x', 'http://127.1/', 'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'http://0.0.0.0/', 'http://169.254.169.254/latest', 'http://192.168.1.1/admin', 'http://10.0.0.5/', 'http://[fe80::1]/', 'http://[fd00::1]/', 'https://user:pw@ca.example.com/']) {
    await assert.rejects(pkiRequest(url, undefined, undefined, transport), undefined, url);
  }
  await assert.rejects(pkiRequest('https://ca.example.com/', new Uint8Array([1]), 'application/json', transport));
  await assert.rejects(pkiRequest('https://ca.example.com/', 'text', 'application/ocsp-request', transport));
  await assert.rejects(pkiRequest(42, undefined, undefined, transport));
  assert.equal(calls.length, 0);
});

test('the blocked ranges: loopback, private, link-local, shared, multicast; public addresses pass', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.0.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:a00:1', 'not an ip']) {
    assert.equal(isBlockedAddress(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '172.32.0.1', '100.128.0.1', '192.169.0.1', '2606:4700::1111', '::ffff:808:808']) {
    assert.equal(isBlockedAddress(ip), false, ip);
  }
});

test('a name is refused when any address it resolves to is local, as in DNS rebinding', async () => {
  const resolveTo = (addresses: string[]) => safeLookup(async () => addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })));
  const ask = (lookup: ReturnType<typeof safeLookup>, all = false) =>
    new Promise<unknown>((resolve, reject) => lookup('ca.example.com', { all }, (err, address) => (err ? reject(err) : resolve(address))));
  assert.equal(await ask(resolveTo(['93.184.216.34'])), '93.184.216.34');
  assert.deepEqual(await ask(resolveTo(['93.184.216.34', '2606:2800::1']), true), [
    { address: '93.184.216.34', family: 4 },
    { address: '2606:2800::1', family: 6 },
  ]);
  await assert.rejects(ask(resolveTo(['127.0.0.1'])), /local network/);
  await assert.rejects(ask(resolveTo(['93.184.216.34', '10.0.0.1'])), /local network/);
  await assert.rejects(ask(resolveTo([])), /no address/);
});

test('the real transport will not connect to this computer, by name or by address', async () => {
  let reached = false;
  const server = http.createServer((_req, res) => {
    reached = true;
    res.end('secret');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  try {
    await assert.rejects(pkiRequest(`http://localhost:${port}/`, undefined, undefined, nodeTransport()), /local network/);
    await assert.rejects(pkiRequest(`http://127.0.0.1:${port}/`, undefined, undefined, nodeTransport()), /local network/);
    assert.equal(reached, false);
  } finally {
    server.close();
  }
});

test('an answer without a length is stopped once it passes the cap, not read to the end', async () => {
  let produced = 0;
  async function* endless() {
    for (;;) {
      produced++;
      yield new Uint8Array(1024 * 1024);
    }
  }
  const { transport, cancelled } = fake(() => ({ body: endless() }));
  await assert.rejects(pkiRequest('https://crl.example.com/huge.crl', undefined, undefined, transport), /sent too much/);
  assert.ok(produced <= 17, `read ${produced} MB`);
  assert.equal(cancelled.length, 1);
  // A stated length over the cap is refused before reading.
  const stated = fake(() => ({ length: 100 * 1024 * 1024 }));
  await assert.rejects(pkiRequest('https://crl.example.com/', undefined, undefined, stated.transport), /sent too much/);
});

test('redirects: 301, 302 and 303 continue as a GET without the body, 307 keeps the POST', async () => {
  for (const status of [301, 302, 303, 307]) {
    const { transport, calls } = fake((url) => (url.pathname === '/old' ? { status, location: '/new' } : {}));
    await pkiRequest('https://tsa.example.com/old', new Uint8Array([7]), 'application/timestamp-query', transport);
    assert.equal(calls[1]!.url, 'https://tsa.example.com/new');
    assert.equal(calls[1]!.method, status === 307 ? 'POST' : 'GET', String(status));
    assert.equal(calls[1]!.body?.length, status === 307 ? 1 : undefined);
  }
});

test('redirects never go to the local network, from https to http, or round in circles', async () => {
  const local = fake(() => ({ status: 302, location: 'http://127.0.0.1:9000/' }));
  await assert.rejects(pkiRequest('https://ca.example.com/', undefined, undefined, local.transport), /local network/);
  assert.equal(local.calls.length, 1);
  const downgrade = fake(() => ({ status: 301, location: 'http://ca.example.com/' }));
  await assert.rejects(pkiRequest('https://ca.example.com/', undefined, undefined, downgrade.transport), /https to http/);
  // http to https is fine.
  const upgrade = fake((url) => (url.protocol === 'http:' ? { status: 301, location: 'https://ca.example.com/' } : {}));
  assert.equal((await pkiRequest('http://ca.example.com/', undefined, undefined, upgrade.transport)).length, 3);
  const loop = fake(() => ({ status: 302, location: '/again' }));
  await assert.rejects(pkiRequest('https://ca.example.com/', undefined, undefined, loop.transport), /too many/);
});

test('a failed answer is reported by its status; a slow body as a time-out with its host', async () => {
  const { transport } = fake(() => ({ status: 503 }));
  await assert.rejects(pkiRequest('https://tsa.example.com/', new Uint8Array([1]), 'application/timestamp-query', transport), /tsa\.example\.com answered 503/);
  const slow: Transport = async (_url, _init, signal) => ({
    status: 200,
    location: null,
    length: null,
    cancel() {},
    body: (async function* () {
      // Stands in for the deadline passing while the body arrives.
      Object.defineProperty(signal, 'aborted', { value: true });
      throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
    })(),
  });
  await assert.rejects(pkiRequest('https://crl.example.com/', undefined, undefined, slow), /^Error: crl\.example\.com did not answer in time$/);
});

test('the real transport posts, follows a redirect as GET and reads the answer (lookup pinned to a test server)', async () => {
  const seen: { method: string; url: string; type?: string; body: string }[] = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.push({ method: req.method!, url: req.url!, type: req.headers['content-type'], body });
      if (req.url === '/tsa') return res.writeHead(303, { location: '/token' }).end();
      res.end('token bytes');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  // Stands in for public DNS: the test name resolves to the test server. Only this test skips the check.
  const lookup = ((_host: string, options: { all?: boolean }, cb: (...a: unknown[]) => void) =>
    options.all ? cb(null, [{ address: '127.0.0.1', family: 4 }]) : cb(null, '127.0.0.1', 4)) as unknown as Parameters<typeof nodeTransport>[0];
  try {
    const bytes = await pkiRequest(`http://tsa.test:${port}/tsa`, new Uint8Array([1, 2, 3]), 'application/timestamp-query', nodeTransport(lookup));
    assert.equal(new TextDecoder().decode(bytes), 'token bytes');
    assert.deepEqual(seen, [
      { method: 'POST', url: '/tsa', type: 'application/timestamp-query', body: '\x01\x02\x03' },
      { method: 'GET', url: '/token', type: undefined, body: '' },
    ]);
  } finally {
    server.close();
  }
});
