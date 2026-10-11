import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GraphBroker, type GraphRequest } from './graph.ts';

const G = 'https://graph.microsoft.com/v1.0';

/** A fake Graph: the app folder is 'root' in drive 'd1'; 'lock' and 'doc' are files, 'sess' a session folder, 'other' a folder elsewhere. */
function fakeGraph() {
  const calls: { url: string; method: string; auth: string | null }[] = [];
  const items: Record<string, unknown> = {
    lock: { id: 'lock', name: 'lock-f1-abc.json', file: {}, parentReference: { driveId: 'd1', id: 'proj' } },
    doc: { id: 'doc', name: 'project.json', file: {}, parentReference: { driveId: 'd1', id: 'proj' } },
    sess: { id: 'sess', name: 'L2', folder: {}, parentReference: { driveId: 'd1', id: 'root' } },
    other: { id: 'other', name: 'Documents', folder: {}, parentReference: { driveId: 'd1', id: 'top' } },
  };
  const fetchFn = async (url: string, init: RequestInit) => {
    const auth = new Headers(init.headers).get('authorization');
    const method = init.method ?? 'GET';
    calls.push({ url, method, auth });
    const path = decodeURIComponent(new URL(url).pathname.replace(/^\/v1\.0/, ''));
    if (path === '/me/drive/special/approot') return Response.json({ id: 'root', parentReference: { driveId: 'd1' } });
    if (path === '/drives/d1/items/sess:/session.json') return Response.json({ id: 'm' });
    if (path.endsWith(':/session.json')) return Response.json({ error: {} }, { status: 404 });
    const m = /^\/drives\/d1\/items\/([^/]+)$/.exec(path);
    if (m && method === 'GET') return items[m[1]!] ? Response.json(items[m[1]!]) : Response.json({ error: {} }, { status: 404 });
    if (m && method === 'DELETE') return new Response(null, { status: 204 });
    if (path === '/drives/d1/items/doc/content') return new Response(null, { status: 302, headers: { location: 'https://public.dm.files.1drv.com/abc' } });
    if (url.startsWith('https://public.dm.files.1drv.com/')) return new Response('pdf bytes');
    return Response.json({ ok: true, path });
  };
  const token = async (scopes: string[]) => (scopes[0] === 'Files.ReadWrite.All' ? null : `T:${scopes[0]}`);
  return { broker: new GraphBroker(token, fetchFn), calls };
}

const req = (url: string, more: Partial<GraphRequest> = {}): GraphRequest => ({ url, method: 'GET', headers: {}, level: 0, ...more });
const text = (b: Uint8Array) => new TextDecoder().decode(b);

test('only Graph is ever sent the token, and page headers cannot replace it', async () => {
  const { broker, calls } = fakeGraph();
  for (const url of ['https://evil.example/v1.0/me', 'https://graph.microsoft.com.evil.example/v1.0/x', 'http://graph.microsoft.com/v1.0/x', 'https://user@graph.microsoft.com/v1.0/x']) {
    const r = await broker.request(req(url));
    assert.equal(r.status, 400, url);
  }
  assert.equal(calls.length, 0);
  await broker.request(req(`${G}/me/drive/special/approot`, { headers: { Authorization: 'Bearer stolen', 'content-type': 'application/json' } }));
  assert.equal(calls.at(-1)!.auth, 'Bearer T:Files.ReadWrite.AppFolder');
});

test('wider access only for sharing calls and other drives', async () => {
  const { broker, calls } = fakeGraph();
  assert.equal((await broker.request(req(`${G}/drives/d1/items/doc/children`, { level: 1 }))).status, 403, 'own folder: app folder only');
  assert.equal((await broker.request(req(`${G}/drives/d1/items/doc/createLink`, { method: 'POST', level: 1 }))).status, 200);
  assert.equal(calls.at(-1)!.auth, 'Bearer T:Files.ReadWrite');
  assert.equal((await broker.request(req(`${G}/drives/d1/items/doc/createLink`, { method: 'POST', level: 2 }))).status, 403, 'sharing never needs files shared with you');
  const shared = await broker.request(req(`${G}/shares/u!abc/driveItem`, { level: 2 }));
  assert.equal(shared.authNeeded, true, 'no token for that level without a sign-in');
  assert.equal((await broker.request(req(`${G}/drives/d2/items/x/children`, { level: 1 }))).status, 200, "someone else's drive may step up");
});

test('deletes only lock files and session folders in the app folder', async () => {
  const { broker } = fakeGraph();
  const del = (id: string) => broker.request(req(`${G}/drives/d1/items/${id}`, { method: 'DELETE' }));
  assert.equal((await del('lock')).status, 204);
  assert.equal((await del('sess')).status, 204);
  const doc = await del('doc');
  assert.equal(doc.status, 403);
  assert.match(text(doc.body), /only deletes its own lock files/);
  assert.equal((await del('other')).status, 403);
  assert.equal((await broker.request(req(`${G}/drives/d1/items/doc/permissions/p1`, { method: 'DELETE', level: 1 }))).status, 200, 'stop sharing');
  assert.equal((await broker.request(req(`${G}/drives/d1/root`, { method: 'DELETE' }))).status, 403);
});

test('file content follows the download redirect without the token', async () => {
  const { broker, calls } = fakeGraph();
  const r = await broker.request(req(`${G}/drives/d1/items/doc/content`));
  assert.equal(text(r.body), 'pdf bytes');
  assert.equal(calls.at(-1)!.auth, null);
});
