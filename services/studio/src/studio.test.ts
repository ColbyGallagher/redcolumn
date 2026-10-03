import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import { WebSocket } from 'ws';
import { accessFor, CLOSE_DENIED, CLOSE_SIGN_IN, MSG_META, MSG_SYNC, parseSessionId, type AccessPolicy, type RecordEntry, type SessionMeta } from './protocol.ts';
import { coalesces, describeChanges } from './record.ts';
import { start } from './server.ts';

let dir: string;
let base: string;
let running: Awaited<ReturnType<typeof start>>;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'nb-studio-'));
  running = await start({ port: 0, hostname: '127.0.0.1', dataDir: dir });
  base = `http://127.0.0.1:${running.port}`;
});

after(async () => {
  await running.close();
  await rm(dir, { recursive: true, force: true });
});

/** A minimal y-protocols client, as the web app's provider behaves. */
function connect(sessionId: string, room: string, name: string, key?: string) {
  const doc = new Y.Doc();
  let meta: SessionMeta | null = null;
  const url = `${base.replace('http', 'ws')}/v1/sessions/${sessionId}/ws?room=${room}&name=${encodeURIComponent(name)}${key ? `&key=${key}` : ''}`;
  const ws = new WebSocket(url);
  ws.binaryType = 'arraybuffer';
  const synced = new Promise<void>((resolve) => {
    ws.on('message', (data: ArrayBuffer) => {
      const decoder = decoding.createDecoder(new Uint8Array(data));
      const type = decoding.readVarUint(decoder);
      if (type === MSG_SYNC) {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MSG_SYNC);
        const step = syncProtocol.readSyncMessage(decoder, encoder, doc, 'remote');
        if (encoding.length(encoder) > 1) ws.send(encoding.toUint8Array(encoder));
        if (step === syncProtocol.messageYjsSyncStep2 || step === syncProtocol.messageYjsSyncStep1) resolve();
      } else if (type === MSG_META) {
        meta = JSON.parse(decoding.readVarString(decoder)) as SessionMeta;
      }
    });
  });
  ws.on('open', () => {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG_SYNC);
    syncProtocol.writeSyncStep1(encoder, doc);
    ws.send(encoding.toUint8Array(encoder));
  });
  doc.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin === 'remote') return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    ws.send(encoding.toUint8Array(encoder));
  });
  return { doc, ws, synced, meta: () => meta, close: () => ws.close() };
}

const until = async (cond: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
};

const PDF = new TextEncoder().encode('%PDF-1.7\n% test\n');

async function createSession(permissions = { markup: true, addDocuments: true }, access?: AccessPolicy) {
  const res = await fetch(`${base}/v1/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Level 2 review', host: 'Hana', permissions, access }) });
  assert.equal(res.status, 201);
  return (await res.json()) as { session: SessionMeta; hostKey: string };
}

async function addDoc(id: string, headers: Record<string, string>) {
  return fetch(`${base}/v1/sessions/${id}/documents?name=A-101.pdf`, { method: 'POST', headers: { 'content-type': 'application/pdf', ...headers }, body: PDF });
}

test('session ids are parsed in any spacing', () => {
  assert.equal(parseSessionId('123456789'), '123-456-789');
  assert.equal(parseSessionId(' 123 456-789 '), '123-456-789');
  assert.equal(parseSessionId('12345'), null);
});

test('markups sync between attendees and are written to the Record', async () => {
  const { session, hostKey } = await createSession();
  assert.match(session.id, /^\d{3}-\d{3}-\d{3}$/);
  const added = await addDoc(session.id, { 'x-studio-host-key': hostKey, 'x-studio-attendee': 'Hana' });
  assert.equal(added.status, 201);
  const { document } = (await added.json()) as { document: { id: string } };

  const hana = connect(session.id, document.id, 'Hana', hostKey);
  const sam = connect(session.id, document.id, 'Sam');
  const hanaSession = connect(session.id, 'session', 'Hana', hostKey);
  await Promise.all([hana.synced, sam.synced, hanaSession.synced]);

  hana.doc.getMap('markups').set('m1', { id: 'm1', type: 'cloud', pageIndex: 2, status: 'none' });
  await until(() => sam.doc.getMap('markups').has('m1'));
  sam.doc.getMap('markups').set('m1', { id: 'm1', type: 'cloud', pageIndex: 2, status: 'accepted' });
  await until(() => (hana.doc.getMap('markups').get('m1') as { status: string }).status === 'accepted');

  const record = hanaSession.doc.getArray<RecordEntry>('record');
  await until(() => record.toArray().some((e) => e.author === 'Sam' && e.text.startsWith('accepted Cloud on page 3')));
  assert.ok(record.toArray().some((e) => e.author === 'Hana' && e.text === 'added Cloud on page 3 of A-101.pdf'));
  assert.equal(hanaSession.meta()?.documents.length, 1);

  // The document is downloadable by attendees.
  const pdf = await fetch(`${base}/v1/sessions/${session.id}/documents/${document.id}`);
  assert.deepEqual(new Uint8Array(await pdf.arrayBuffer()), PDF);

  for (const c of [hana, sam, hanaSession]) c.close();
});

test('only the host may lock, finish, and edit a locked session', async () => {
  const { session, hostKey } = await createSession({ markup: false, addDocuments: false });
  assert.equal((await addDoc(session.id, {})).status, 403);
  const { document } = (await (await addDoc(session.id, { 'x-studio-host-key': hostKey })).json()) as { document: { id: string } };

  const patch = (body: object, key?: string) =>
    fetch(`${base}/v1/sessions/${session.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json', ...(key ? { 'x-studio-host-key': key } : {}) }, body: JSON.stringify(body) });
  assert.equal((await patch({ status: 'finished' })).status, 403);

  const host = connect(session.id, document.id, 'Hana', hostKey);
  const guest = connect(session.id, document.id, 'Sam');
  await Promise.all([host.synced, guest.synced]);
  guest.doc.getMap('markups').set('g', { id: 'g', type: 'rect', pageIndex: 0 });
  host.doc.getMap('markups').set('h', { id: 'h', type: 'rect', pageIndex: 0 });
  await until(() => guest.doc.getMap('markups').has('h'));
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(host.doc.getMap('markups').has('g'), false, 'guest edits are dropped while markup is locked');

  const finished = (await (await patch({ status: 'finished' }, hostKey)).json()) as { session: SessionMeta };
  assert.equal(finished.session.status, 'finished');
  host.doc.getMap('markups').set('late', { id: 'late', type: 'rect', pageIndex: 0 });
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(guest.doc.getMap('markups').has('late'), false, 'finished sessions are read-only');
  host.close();
  guest.close();
});

test('access levels: people and groups get none, view or markup', async () => {
  const policy: AccessPolicy = {
    default: 'none',
    people: [{ name: 'Sam', access: 'markup' }, { name: 'Vic', access: null }],
    groups: [{ id: 'g1', name: 'Reviewers', access: 'view', members: ['vic', 'Wen'] }],
  };
  const meta = { access: policy, permissions: { markup: true, addDocuments: true } };
  assert.equal(accessFor(meta, 'sam', false), 'markup');
  assert.equal(accessFor(meta, 'Vic', false), 'view', 'unset access comes from groups');
  assert.equal(accessFor(meta, 'Wen', false), 'view');
  assert.equal(accessFor(meta, 'Stranger', false), 'none');
  assert.equal(accessFor(meta, 'Stranger', true), 'markup', 'the host always has full access');

  const { session, hostKey } = await createSession({ markup: true, addDocuments: true }, policy);
  assert.deepEqual(session.access?.groups[0]?.members, ['vic', 'Wen']);
  const get = (who: string) => fetch(`${base}/v1/sessions/${session.id}`, { headers: { 'x-studio-attendee': who } });
  assert.equal((await get('Stranger')).status, 403);
  assert.equal((await get('Wen')).status, 200);
  assert.equal((await addDoc(session.id, { 'x-studio-attendee': 'Wen' })).status, 403, 'viewers cannot add documents');
  const { document } = (await (await addDoc(session.id, { 'x-studio-attendee': 'Sam' })).json()) as { document: { id: string } };

  const sam = connect(session.id, document.id, 'Sam');
  const wen = connect(session.id, document.id, 'Wen');
  await Promise.all([sam.synced, wen.synced]);
  wen.doc.getMap('markups').set('w', { id: 'w', type: 'rect', pageIndex: 0 });
  sam.doc.getMap('markups').set('s', { id: 's', type: 'rect', pageIndex: 0 });
  await until(() => wen.doc.getMap('markups').has('s'));
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(sam.doc.getMap('markups').has('w'), false, 'viewer edits are dropped');

  // Taking Sam's access away disconnects him.
  const closed = new Promise<number>((resolve) => sam.ws.on('close', (code) => resolve(code)));
  const res = await fetch(`${base}/v1/sessions/${session.id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', 'x-studio-host-key': hostKey },
    body: JSON.stringify({ access: { ...policy, people: [{ name: 'Sam', access: 'none' }] } }),
  });
  assert.equal(res.status, 200);
  assert.equal(await closed, CLOSE_DENIED);
  const stranger = connect(session.id, 'session', 'Stranger');
  assert.equal(await new Promise<number>((resolve) => stranger.ws.on('close', (code) => resolve(code))), CLOSE_DENIED);
  wen.close();
});

test('unknown sessions are 404', async () => {
  assert.equal((await fetch(`${base}/v1/sessions/000-000-000`)).status, 404);
});

test('record lines describe changes and collapse repeated moves', () => {
  let n = 0;
  const id = () => String(n++);
  const [line] = describeChanges([{ action: 'update', id: 'a', value: { type: 'rect', pageIndex: 0, comment: 'check' }, old: { type: 'rect', pageIndex: 0 } }], 'Sam', 'd', 'A.pdf', 0, id);
  assert.equal(line!.text, 'commented on Rectangle on page 1 of A.pdf: “check”');
  const [bulk] = describeChanges(Array.from({ length: 12 }, (_, i) => ({ action: 'add' as const, id: String(i), value: { type: 'rect', pageIndex: 0 } })), 'Sam', 'd', 'A.pdf', 0, id);
  assert.equal(bulk!.text, 'added 12 markups in A.pdf');
  const moved = (at: number) => describeChanges([{ action: 'update', id: 'a', value: { type: 'rect', pageIndex: 0 }, old: { type: 'rect', pageIndex: 0 } }], 'Sam', 'd', 'A.pdf', at, id)[0]!;
  assert.ok(coalesces(moved(0), moved(1000)));
  assert.ok(!coalesces(moved(0), moved(120_000)));
});

test('Google sessions: only verified emails get in, matched against people and groups', async () => {
  const tokens: Record<string, string> = { 'tok-hana': 'hana@firm.com', 'tok-sam': 'sam@firm.com', 'tok-eve': 'eve@other.com' };
  const gdir = await mkdtemp(join(tmpdir(), 'nb-studio-google-'));
  const g = await start({ port: 0, hostname: '127.0.0.1', dataDir: gdir, auth: { enabled: true, verify: async (t) => (tokens[t] ? { email: tokens[t]! } : null) } });
  const gbase = `http://127.0.0.1:${g.port}`;
  try {
    assert.deepEqual(await (await fetch(`${gbase}/v1/config`)).json(), { google: true });
    const auth = (t?: string): Record<string, string> => (t ? { authorization: `Bearer ${t}` } : {});
    const body = JSON.stringify({ name: 'Private', host: 'Hana', requireGoogle: true, access: { default: 'none', people: [{ name: 'sam@firm.com', access: 'view' }, { name: 'Eve', access: 'markup' }], groups: [] } });
    assert.equal((await fetch(`${gbase}/v1/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body })).status, 401, 'the host must be signed in');
    const created = await fetch(`${gbase}/v1/sessions`, { method: 'POST', headers: { 'content-type': 'application/json', ...auth('tok-hana') }, body });
    const { session } = (await created.json()) as { session: SessionMeta };
    assert.equal(session.requireGoogle, true);
    assert.equal(session.hostEmail, 'hana@firm.com');

    const get = (t?: string, name = 'Someone') => fetch(`${gbase}/v1/sessions/${session.id}`, { headers: { 'x-studio-attendee': name, ...auth(t) } });
    assert.equal((await get()).status, 401, 'signed out: asked to sign in');
    assert.equal((await get(undefined, 'Eve')).status, 401, 'a typed name that is on the list is not enough');
    assert.equal((await get('tok-eve', 'Eve')).status, 403, 'Eve signed in, but her email is not listed');
    const sam = (await (await get('tok-sam')).json()) as { isHost: boolean; email: string };
    assert.equal(sam.email, 'sam@firm.com');
    assert.equal(sam.isHost, false);
    const hana = (await (await get('tok-hana')).json()) as { isHost: boolean };
    assert.equal(hana.isHost, true, 'the host is recognised by Google account, without the host key');

    // Sockets carry the token as a subprotocol.
    const socket = (t?: string) =>
      new Promise<number | 'open'>((resolve) => {
        const ws = new WebSocket(`${gbase.replace('http', 'ws')}/v1/sessions/${session.id}/ws?room=session&name=x`, t ? ['nb-studio', `nb-auth.${t}`] : undefined);
        ws.on('close', (code) => resolve(code));
        ws.on('message', () => {
          resolve('open');
          ws.close();
        });
      });
    assert.equal(await socket(), CLOSE_SIGN_IN);
    assert.equal(await socket('tok-eve'), CLOSE_DENIED);
    assert.equal(await socket('tok-sam'), 'open');
  } finally {
    await g.close();
    await rm(gdir, { recursive: true, force: true });
  }
});

test('a session with an end date finishes by itself, and the end date can change', async () => {
  const soon = Date.now() + 400;
  let res = await fetch(`${base}/v1/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Quick review', host: 'Hana', expiresAt: soon }) });
  assert.equal(res.status, 201);
  const { session, hostKey } = (await res.json()) as { session: SessionMeta; hostKey: string };
  assert.equal(session.expiresAt, soon);
  // A past end date is refused.
  res = await fetch(`${base}/v1/sessions/${session.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json', 'x-studio-host-key': hostKey }, body: JSON.stringify({ expiresAt: Date.now() - 1000 }) });
  assert.equal(res.status, 400);
  await new Promise((r) => setTimeout(r, 600));
  res = await fetch(`${base}/v1/sessions/${session.id}`);
  const after = ((await res.json()) as { session: SessionMeta }).session;
  assert.equal(after.status, 'finished');
  // Finished: no new documents.
  res = await fetch(`${base}/v1/sessions/${session.id}/documents?name=a.pdf`, { method: 'POST', headers: { 'content-type': 'application/pdf', 'x-studio-host-key': hostKey }, body: PDF });
  assert.equal(res.status, 409);
});

test('the host updates a document to a new revision; its id and markups stay', async () => {
  const { session, hostKey } = await createSession();
  let res = await fetch(`${base}/v1/sessions/${session.id}/documents?name=Plan.pdf`, { method: 'POST', headers: { 'content-type': 'application/pdf', 'x-studio-host-key': hostKey }, body: PDF });
  const { document } = (await res.json()) as { document: { id: string; version?: number } };
  const rev2 = new TextEncoder().encode('%PDF-1.7\n% revision 2\n');
  // Attendees cannot.
  res = await fetch(`${base}/v1/sessions/${session.id}/documents/${document.id}`, { method: 'PUT', headers: { 'content-type': 'application/pdf', 'x-studio-attendee': 'Ari' }, body: rev2 });
  assert.equal(res.status, 403);
  res = await fetch(`${base}/v1/sessions/${session.id}/documents/${document.id}?name=Plan%20rev%202.pdf`, { method: 'PUT', headers: { 'content-type': 'application/pdf', 'x-studio-host-key': hostKey }, body: rev2 });
  assert.equal(res.status, 200);
  const updated = ((await res.json()) as { document: { id: string; version: number; name: string } }).document;
  assert.equal(updated.id, document.id);
  assert.equal(updated.version, 2);
  assert.equal(updated.name, 'Plan rev 2.pdf');
  const bytes = new Uint8Array(await (await fetch(`${base}/v1/sessions/${session.id}/documents/${document.id}`)).arrayBuffer());
  assert.equal(new TextDecoder().decode(bytes), '%PDF-1.7\n% revision 2\n');
});

test('save-copy and invite permissions are kept and changed', async () => {
  const { session, hostKey } = await createSession({ markup: true, addDocuments: true, saveCopy: false, invite: false } as never);
  assert.equal(session.permissions.saveCopy, false);
  assert.equal(session.permissions.invite, false);
  const res = await fetch(`${base}/v1/sessions/${session.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json', 'x-studio-host-key': hostKey }, body: JSON.stringify({ permissions: { saveCopy: true, bogus: 1 } }) });
  const meta = ((await res.json()) as { session: SessionMeta }).session;
  assert.equal(meta.permissions.saveCopy, true);
  assert.equal(meta.permissions.invite, false);
  assert.ok(!('bogus' in meta.permissions));
});
