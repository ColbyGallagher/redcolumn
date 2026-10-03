import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Hono } from 'hono';
import { isPrivateAddress, pkiRelay, publicUrl } from './pki.ts';

test('private and loopback addresses are refused', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '0.0.0.0']) assert.equal(isPrivateAddress(ip), true, ip);
  for (const ip of ['8.8.8.8', '172.32.0.1', '2606:4700::1111']) assert.equal(isPrivateAddress(ip), false, ip);
});

test('only public http(s) URLs pass', async () => {
  const resolve = async (h: string) => (h === 'tsa.example' ? ['93.184.216.34'] : h === 'inside.example' ? ['10.0.0.5'] : []);
  assert.ok(await publicUrl('http://tsa.example/tsr', resolve));
  assert.equal(await publicUrl('http://inside.example/', resolve), null);
  assert.equal(await publicUrl('file:///etc/passwd', resolve), null);
  assert.equal(await publicUrl('http://127.0.0.1:8787/', resolve), null);
  assert.equal(await publicUrl('http://user:pw@tsa.example/', resolve), null);
});

test('time stamp requests are relayed; other kinds are not', async () => {
  const seen: { url: string; type: string | null; size: number }[] = [];
  const fetcher = (async (url: URL, init: RequestInit) => {
    seen.push({ url: String(url), type: new Headers(init.headers).get('content-type'), size: (init.body as Uint8Array).length });
    return new Response(new Uint8Array([0x30, 0x03, 0x02, 0x01, 0x00]), { headers: { 'content-type': 'application/timestamp-reply' } });
  }) as typeof fetch;
  const app = new Hono();
  app.post('/pki', (c) => pkiRelay(c, fetcher, async () => ['93.184.216.34']));
  const ok = await app.request('/pki?url=' + encodeURIComponent('http://tsa.example/'), { method: 'POST', body: new Uint8Array(40), headers: { 'content-type': 'application/timestamp-query' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('content-type'), 'application/timestamp-reply');
  assert.deepEqual([...new Uint8Array(await ok.arrayBuffer())], [0x30, 0x03, 0x02, 0x01, 0x00]);
  assert.deepEqual(seen, [{ url: 'http://tsa.example/', type: 'application/timestamp-query', size: 40 }]);
  const bad = await app.request('/pki?url=' + encodeURIComponent('http://tsa.example/'), { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } });
  assert.equal(bad.status, 415);
});
