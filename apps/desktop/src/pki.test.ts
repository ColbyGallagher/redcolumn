import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pkiRequest } from './pki.ts';

function fake(answer: (url: string, init: RequestInit) => Response = () => new Response(new Uint8Array([1, 2, 3]))) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchFn = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return answer(url, init);
  };
  return { fetchFn, calls };
}

test('posts a time stamp request and returns the answer', async () => {
  const { fetchFn, calls } = fake();
  const bytes = await pkiRequest('http://timestamp.digicert.com', new Uint8Array([9]), 'application/timestamp-query', fetchFn);
  assert.deepEqual([...bytes], [1, 2, 3]);
  assert.equal(calls[0]!.init.method, 'POST');
  assert.equal(new Headers(calls[0]!.init.headers).get('content-type'), 'application/timestamp-query');
  assert.equal(calls[0]!.init.credentials, 'omit');
});

test('gets a revocation list without a body', async () => {
  const { fetchFn, calls } = fake();
  await pkiRequest('https://crl.example.com/ca.crl', undefined, undefined, fetchFn);
  assert.equal(calls[0]!.init.method, 'GET');
  assert.equal(calls[0]!.init.body, undefined);
});

test('refuses other schemes, this computer, and other kinds of POST', async () => {
  const { fetchFn, calls } = fake();
  for (const url of ['file:///etc/passwd', 'ftp://ca.example.com/x', 'http://localhost:4000/', 'http://127.1/', 'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'http://0.0.0.0/', 'http://a.localhost/', 'https://user:pw@ca.example.com/']) {
    await assert.rejects(pkiRequest(url, undefined, undefined, fetchFn), undefined, url);
  }
  await assert.rejects(pkiRequest('https://ca.example.com/', new Uint8Array([1]), 'application/json', fetchFn));
  await assert.rejects(pkiRequest('https://ca.example.com/', 'text', 'application/ocsp-request', fetchFn));
  await assert.rejects(pkiRequest(42, undefined, undefined, fetchFn));
  assert.equal(calls.length, 0);
});

test('follows redirects, but not to this computer', async () => {
  const ok = fake((url) => (url.includes('old') ? new Response(null, { status: 301, headers: { location: 'https://new.example.com/ca.crl' } }) : new Response('crl')));
  assert.equal(new TextDecoder().decode(await pkiRequest('http://old.example.com/ca.crl', undefined, undefined, ok.fetchFn)), 'crl');
  assert.equal(ok.calls[1]!.url, 'https://new.example.com/ca.crl');
  const bad = fake(() => new Response(null, { status: 302, headers: { location: 'http://127.0.0.1:9000/' } }));
  await assert.rejects(pkiRequest('https://ca.example.com/', undefined, undefined, bad.fetchFn), /this computer/);
  assert.equal(bad.calls.length, 1);
  const loop = fake(() => new Response(null, { status: 302, headers: { location: '/again' } }));
  await assert.rejects(pkiRequest('https://ca.example.com/', undefined, undefined, loop.fetchFn), /too many/);
});

test('reports a failed answer by its status', async () => {
  const { fetchFn } = fake(() => new Response('no', { status: 503 }));
  await assert.rejects(pkiRequest('https://tsa.example.com/', new Uint8Array([1]), 'application/timestamp-query', fetchFn), /tsa\.example\.com answered 503/);
});
