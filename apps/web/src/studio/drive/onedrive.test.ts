import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { OneDrive } from './onedrive';

interface Item {
  id: string;
  name: string;
  eTag: string;
  size: number;
  parent: string;
  folder?: boolean;
  body: Uint8Array;
}

/**
 * The few Graph calls the adapter makes, over one in-memory drive ('d1'). Uploads to a path follow
 * Graph: they replace a file of that name unless `@microsoft.graph.conflictBehavior=rename` is given.
 */
class FakeGraph {
  items = new Map<string, Item>();
  permissions: Record<string, unknown>[] & { id?: string; roles?: string[] }[] = [
    { id: 'o', roles: ['owner'], grantedToV2: { user: { displayName: 'Hana', email: 'hana@x.com' } } },
    { id: 'u', roles: ['write'], grantedToV2: { user: { displayName: 'Sam', email: 'sam@x.com' } } },
    { id: 'i', roles: ['read'], invitation: { email: 'lee@x.com' } },
    { id: 'l', roles: ['read'], link: { type: 'edit', scope: 'anonymous' } },
  ];
  calls: { method: string; path: string; search: URLSearchParams; body?: Uint8Array }[] = [];
  private n = 0;

  private json(item: Item) {
    const { body: _body, parent: _parent, folder, ...rest } = item;
    return Response.json({ ...rest, parentReference: { driveId: 'd1' }, ...(folder ? { folder: {} } : { file: { mimeType: 'application/octet-stream' } }) });
  }

  private put(item: Item, body: Uint8Array) {
    item.body = body;
    item.size = body.byteLength;
    item.eTag = `"${item.id},${++this.n}"`;
  }

  private add(parent: string, name: string): Item {
    const item: Item = { id: `i${++this.n}`, name, eTag: '', size: 0, parent, body: new Uint8Array() };
    this.items.set(item.id, item);
    return item;
  }

  fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(String(input));
    const method = init.method ?? 'GET';
    const body = init.body instanceof Blob ? new Uint8Array(await init.body.arrayBuffer()) : undefined;
    const path = decodeURIComponent(url.pathname.replace(/^\/v1\.0/, ''));
    this.calls.push({ method, path, search: url.searchParams, body });

    if (method === 'GET' && path === '/me/drive/special/approot') return Response.json({ id: 'approot', parentReference: { driveId: 'd1' } });
    if (method === 'POST' && path === '/drives/d1/items/approot/children') {
      const { name } = JSON.parse(String(init.body)) as { name: string };
      const item = this.add('approot', name);
      item.folder = true;
      return this.json(item);
    }
    let m = /^\/drives\/d1\/items\/([^/:]+):\/(.+):\/content$/.exec(path);
    if (m && method === 'PUT') {
      const [, parent, name] = m as unknown as [string, string, string];
      const taken = (n: string) => [...this.items.values()].find((i) => i.parent === parent && i.name.toLowerCase() === n.toLowerCase());
      let item = taken(name);
      if (item && url.searchParams.get('@microsoft.graph.conflictBehavior') === 'rename') {
        const dot = name.lastIndexOf('.');
        const free = (k: number) => `${name.slice(0, dot)} ${k}${name.slice(dot)}`;
        let k = 1;
        while (taken(free(k))) k++;
        item = this.add(parent, free(k));
      }
      item ??= this.add(parent, name);
      this.put(item, body!);
      return this.json(item);
    }
    m = /^\/drives\/d1\/items\/([^/:]+)\/permissions(?:\/(.+))?$/.exec(path);
    if (m) {
      if (method === 'GET') return Response.json({ value: this.permissions });
      const at = this.permissions.findIndex((p) => p.id === m![2]);
      if (at < 0) return Response.json({ error: { message: 'not found' } }, { status: 404 });
      if (method === 'DELETE') this.permissions.splice(at, 1);
      else this.permissions[at]!.roles = (JSON.parse(String(init.body)) as { roles: string[] }).roles;
      return new Response(null, { status: 204 });
    }
    m = /^\/drives\/d1\/items\/([^/:]+)\/content$/.exec(path);
    if (m) {
      const item = this.items.get(m[1]!);
      if (!item) return Response.json({ error: { message: 'not found' } }, { status: 404 });
      if (method === 'GET') return new Response(item.body.slice());
      this.put(item, body!);
      return this.json(item);
    }
    return Response.json({ error: { message: `unexpected ${method} ${path}` } }, { status: 400 });
  };
}

let graph: FakeGraph;
const realFetch = globalThis.fetch;
beforeEach(() => {
  graph = new FakeGraph();
  globalThis.fetch = graph.fetch as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const token = async () => 'token';
const pdf = (text: string) => new Blob([`%PDF-1.7 ${text}`], { type: 'application/pdf' });
const json = (value: unknown) => new Blob([JSON.stringify(value)], { type: 'application/json' });
const text = (item: Item | undefined) => new TextDecoder().decode(item?.body);

test('a document never replaces another of the same name', async () => {
  const od = new OneDrive(token);
  const folder = await od.createFolder('L2 (redcolumn session)');
  const first = await od.createFile(folder, 'A-101.pdf', 'application/pdf', pdf('rev A'), {});
  const second = await od.createFile(folder, 'a-101.PDF', 'application/pdf', pdf('rev B'), {});
  assert.notEqual(second.id, first.id);
  assert.equal(second.name, 'a-101 1.PDF');
  assert.equal(text(graph.items.get(first.id)), '%PDF-1.7 rev A', 'the first document is untouched');
  const creates = graph.calls.filter((c) => c.method === 'PUT' && c.path.includes(':/'));
  assert.ok(creates.every((c) => c.search.get('@microsoft.graph.conflictBehavior') === 'rename'));
});

test('a document is always named .pdf, so others recognise it', async () => {
  const od = new OneDrive(token);
  const folder = await od.createFolder('L2 (redcolumn session)');
  const file = await od.createFile(folder, 'Level 2 plan', 'application/pdf', pdf(''), {});
  assert.equal(file.name, 'Level 2 plan.pdf');
  assert.equal(file.properties.nbRole, 'document');
});

test('a new revision of a PDF goes up as it is', async () => {
  const od = new OneDrive(token);
  const folder = await od.createFolder('L2 (redcolumn session)');
  const file = await od.createFile(folder, 'A-101.pdf', 'application/pdf', pdf('rev A'), {});
  const version = await od.updateContent(file.id, pdf('rev B'));
  assert.notEqual(version, file.version);
  assert.equal(text(graph.items.get(file.id)), '%PDF-1.7 rev B');
  const update = graph.calls.at(-1)!;
  assert.equal(update.path, `/drives/d1/items/${file.id}/content`);
  assert.equal(update.search.get('@microsoft.graph.conflictBehavior'), null, 'an update replaces the file it names');
});

test('binary files round-trip unchanged', async () => {
  const od = new OneDrive(token);
  const folder = await od.createFolder('L2 (redcolumn session)');
  const bytes = new Uint8Array([0, 1, 2, 250, 255]);
  const file = await od.createFile(folder, 'seat.room.nbdelta', 'application/octet-stream', new Blob([bytes]), {});
  await od.updateContent(file.id, new Blob([new Uint8Array([9, 8, 7])], { type: 'application/octet-stream' }));
  assert.deepEqual(new Uint8Array(await od.download(file.id)), new Uint8Array([9, 8, 7]));
});

test('JSON files keep the properties stored inside them, and are not written unread', async () => {
  const od = new OneDrive(token);
  const folder = await od.createFolder('L2 (redcolumn session)');
  const file = await od.createFile(folder, 'session.json', 'application/json', json({ name: 'L2' }), { nbRole: 'manifest' });
  await od.updateContent(file.id, json({ name: 'Level 2' }));
  assert.deepEqual(JSON.parse(text(graph.items.get(file.id))), { name: 'Level 2', _nb: { nbRole: 'manifest' } });

  const elsewhere = new OneDrive(token);
  await assert.rejects(elsewhere.updateContent(file.id, json({ name: 'oops' })), /not read/);
  assert.deepEqual(JSON.parse(text(graph.items.get(file.id))), { name: 'Level 2', _nb: { nbRole: 'manifest' } }, 'its role is not lost');
});

test('who the folder is shared with is listed, changed and removed', async () => {
  const od = new OneDrive(token);
  const folder = await od.createFolder('Tower (redcolumn project)');
  const people = await od.listPermissions(folder);
  assert.deepEqual(
    people.map((p) => [p.kind, p.name, p.email ?? null, p.role]),
    [
      ['owner', 'Hana', 'hana@x.com', 'owner'],
      ['user', 'Sam', 'sam@x.com', 'writer'],
      ['user', 'lee@x.com', 'lee@x.com', 'reader'],
      ['link', 'Anyone with the link', null, 'writer'],
    ],
  );
  await od.setPermissionRole(folder, 'u', 'reader');
  assert.deepEqual(graph.permissions.find((p) => p.id === 'u')!.roles, ['read']);
  await od.removePermission(folder, 'i');
  assert.deepEqual((await od.listPermissions(folder)).map((p) => p.name), ['Hana', 'Sam', 'Anyone with the link']);
});
