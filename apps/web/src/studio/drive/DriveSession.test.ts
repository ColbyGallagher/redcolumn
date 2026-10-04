import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as Y from 'yjs';
import type { MarkupStore } from '@nb/markup';
import type { RecordEntry } from '../protocol';
import { DriveAuthError, DriveForbiddenError, type DriveApi, type DriveFile, type DriveProps } from './DriveApi';
import { DriveSession } from './DriveSession';

/** One shared in-memory "Drive", seen by each user through their own `FakeDrive`. */
class FakeStore {
  files = new Map<string, DriveFile & { parent: string; owner: string; body: Uint8Array }>();
  /** Users who may only view (the folder was shared read-only with them). */
  viewers = new Set<string>();
  /** Every write, in order: which file and how many bytes of content went up (0 for properties). */
  writes: { name: string; bytes: number }[] = [];
  /** Room files cannot be downloaded (the connection drops mid-read). */
  roomReadsFail = false;
  private n = 0;
  nextId = () => `f${++this.n}`;
  bump = (f: DriveFile) => (f.version = String(Number(f.version) + 1));
}

class FakeDrive implements DriveApi {
  signedIn = true;
  readonly store: FakeStore;
  readonly user: string;
  constructor(store: FakeStore, user: string) {
    this.store = store;
    this.user = user;
  }

  private auth() {
    if (!this.signedIn) throw new DriveAuthError('signed out');
  }

  async list(folderId: string): Promise<DriveFile[]> {
    return [...this.store.files.values()].filter((f) => f.parent === folderId).map((f) => ({ ...f, properties: { ...f.properties } }));
  }

  async download(fileId: string): Promise<ArrayBuffer> {
    const f = this.store.files.get(fileId);
    if (!f) throw new Error('404');
    if (this.store.roomReadsFail && /\.nb(snap|delta)$/.test(f.name)) throw new TypeError('offline');
    return f.body.slice().buffer;
  }

  async createFolder(name: string, properties: DriveProps): Promise<string> {
    this.auth();
    const id = this.store.nextId();
    this.store.files.set(id, { id, name, mimeType: 'folder', version: '1', size: 0, createdTime: new Date().toISOString(), properties, parent: 'root', owner: this.user, body: new Uint8Array() });
    return id;
  }

  async createFile(folderId: string, name: string, mimeType: string, body: Blob, properties: DriveProps): Promise<DriveFile> {
    this.auth();
    if (this.store.viewers.has(this.user)) throw new DriveForbiddenError('view only');
    const id = this.store.nextId();
    const bytes = new Uint8Array(await body.arrayBuffer());
    const f = { id, name, mimeType, version: '1', size: bytes.byteLength, createdTime: new Date().toISOString(), properties, parent: folderId, owner: this.user, body: bytes };
    this.store.files.set(id, f);
    this.store.writes.push({ name, bytes: bytes.byteLength });
    return { ...f };
  }

  private own(fileId: string) {
    this.auth();
    const f = this.store.files.get(fileId);
    if (!f) throw new Error('404');
    if (f.owner !== this.user) throw new DriveForbiddenError('not yours');
    return f;
  }

  async updateContent(fileId: string, body: Blob): Promise<string> {
    const f = this.own(fileId);
    f.body = new Uint8Array(await body.arrayBuffer());
    this.store.writes.push({ name: f.name, bytes: f.body.byteLength });
    return this.store.bump(f);
  }

  async updateProperties(fileId: string, properties: DriveProps): Promise<string> {
    const f = this.own(fileId);
    f.properties = { ...f.properties, ...properties };
    this.store.writes.push({ name: f.name, bytes: 0 });
    return this.store.bump(f);
  }

  async shareWithLink(): Promise<void> {
    this.auth();
  }

  async shareWithUser(): Promise<void> {
    this.auth();
  }

  async ownedByMe(fileId: string): Promise<boolean> {
    this.auth();
    return this.store.files.get(fileId)?.owner === this.user;
  }
}

/** Just the parts of a MarkupStore a session uses. */
function fakeStore() {
  const doc = new Y.Doc();
  let readOnly = false;
  return {
    store: { doc, setReadOnly: (v: boolean) => (readOnly = v) } as unknown as MarkupStore,
    doc,
    readOnly: () => readOnly,
    markups: doc.getMap<{ id: string; type: string; pageIndex: number; status: string }>('markups'),
  };
}

const opts = { pollMs: 0, authorize: async () => {}, onRemoved: () => {} };
const PDF = new TextEncoder().encode('%PDF-1.7').buffer as ArrayBuffer;

async function twoAttendees() {
  const drive = new FakeStore();
  const hana = await DriveSession.create(new FakeDrive(drive, 'hana'), 'Level 2', 'Hana', { markup: true, addDocuments: true }, { ...opts, linkCanEdit: true });
  const sam = await DriveSession.join(new FakeDrive(drive, 'sam'), hana.id, 'Sam', { ...opts, interactive: true });
  return { drive, hana, sam };
}

test('markups, chat and documents sync between attendees', async () => {
  const { hana, sam } = await twoAttendees();
  assert.equal(hana.getSnapshot().isHost, true);
  assert.equal(sam.getSnapshot().isHost, false);

  const doc = await hana.addDocument('A-101.pdf', PDF);
  await sam.poll();
  assert.deepEqual(sam.meta.documents.map((d) => d.name), ['A-101.pdf']);

  const a = fakeStore();
  const b = fakeStore();
  await hana.attach(doc.id, a.store);
  await sam.attach(doc.id, b.store);
  a.markups.set('m1', { id: 'm1', type: 'cloud', pageIndex: 2, status: 'none' });
  sam.sendChat('On it');
  await Promise.all([hana.flush(), sam.flush()]);
  await Promise.all([hana.poll(), sam.poll()]);

  assert.equal(b.markups.get('m1')?.type, 'cloud', 'Sam sees the cloud Hana drew');
  b.markups.set('m1', { ...b.markups.get('m1')!, status: 'accepted' });
  await sam.flush();
  await hana.poll();
  assert.equal(a.markups.get('m1')?.status, 'accepted', 'Hana sees Sam accept it');

  const lines = (s: DriveSession) => s.getSnapshot().record.map((e: RecordEntry) => `${e.author}: ${e.text}`);
  assert.ok(lines(hana).includes('Sam: On it'));
  assert.ok(lines(hana).includes('Hana: added Cloud on page 3 of A-101.pdf'));
  assert.ok(lines(hana).includes('Sam: accepted Cloud on page 3 of A-101.pdf'));
  assert.deepEqual(new Set(hana.meta.attendees.map((x) => x.name)), new Set(['Hana', 'Sam']));
});

test('invited emails are listed for everyone until they join', async () => {
  const { hana, sam } = await twoAttendees();
  await hana.invite(['kai@example.com', 'KAI@example.com', 'lee@example.com']);
  await sam.poll();
  assert.deepEqual(sam.meta.invited, ['kai@example.com', 'lee@example.com']);
});

test('the host can lock markups and finish; attendees become read-only', async () => {
  const { hana, sam } = await twoAttendees();
  const doc = await hana.addDocument('A-101.pdf', PDF);
  await sam.poll();
  const b = fakeStore();
  await sam.attach(doc.id, b.store);
  assert.equal(b.readOnly(), false);

  await assert.rejects(sam.update({ status: 'finished' }), /host/);
  await hana.update({ permissions: { markup: false } });
  await sam.poll();
  assert.equal(sam.canMarkup, false);
  assert.equal(b.readOnly(), true);
  assert.equal(hana.canMarkup, true, 'the host still can');

  await hana.update({ status: 'finished' });
  await sam.poll();
  assert.equal(sam.meta.status, 'finished');
  assert.equal(hana.canMarkup, false);
  assert.ok(sam.getSnapshot().record.some((e) => e.text === 'finished the session'));
});

test('removed documents disappear for everyone', async () => {
  const { hana, sam } = await twoAttendees();
  const removed: string[] = [];
  const doc = await sam.addDocument('B.pdf', PDF);
  const watcher = await DriveSession.join(new FakeDrive((sam as unknown as { api: FakeDrive }).api.store, 'kai'), hana.id, 'Kai', { ...opts, interactive: true, onRemoved: (id) => removed.push(id) });
  assert.equal(watcher.meta.documents.length, 1);
  await hana.poll();
  await hana.removeDocument(doc.id);
  await watcher.poll();
  assert.equal(watcher.meta.documents.length, 0);
  assert.deepEqual(removed, [doc.id]);
});

test('view-only attendees read but do not write; lapsed sign-in keeps edits until reconnect', async () => {
  const drive = new FakeStore();
  const hana = await DriveSession.create(new FakeDrive(drive, 'hana'), 'L2', 'Hana', { markup: true, addDocuments: true }, { ...opts, linkCanEdit: false });
  drive.viewers.add('vic');
  const vic = await DriveSession.join(new FakeDrive(drive, 'vic'), hana.id, 'Vic', { ...opts, interactive: true });
  assert.equal(vic.getSnapshot().viewOnly, true);
  assert.equal(vic.canMarkup, false);

  const hanaApi = (hana as unknown as { api: FakeDrive }).api;
  hanaApi.signedIn = false;
  hana.sendChat('while signed out');
  await hana.flush();
  assert.equal(hana.getSnapshot().needsAuth, true);
  await vic.poll();
  assert.ok(!vic.getSnapshot().record.some((e) => e.text === 'while signed out'));

  hanaApi.signedIn = true;
  await hana.reconnect();
  await vic.poll();
  assert.ok(vic.getSnapshot().record.some((e) => e.text === 'while signed out'), 'saved after reconnecting');
});

test('access levels: listed people and groups view, comment or stay out', async () => {
  const drive = new FakeStore();
  const access = {
    default: 'none' as const,
    people: [
      { name: 'Sam', access: 'markup' as const },
      { name: 'Vic', access: null },
    ],
    groups: [{ id: 'g', name: 'Reviewers', access: 'view' as const, members: ['Vic'] }],
  };
  const hana = await DriveSession.create(new FakeDrive(drive, 'hana'), 'L2', 'Hana', { markup: true, addDocuments: true }, { ...opts, linkCanEdit: true, access });
  const sam = await DriveSession.join(new FakeDrive(drive, 'sam'), hana.id, 'Sam', { ...opts, interactive: true });
  const vic = await DriveSession.join(new FakeDrive(drive, 'vic'), hana.id, 'Vic', { ...opts, interactive: true });
  await assert.rejects(DriveSession.join(new FakeDrive(drive, 'eve'), hana.id, 'Eve', { ...opts, interactive: true }), /do not have access/);
  assert.equal(sam.canMarkup, true);
  assert.equal(vic.canMarkup, false, 'Reviewers only view');
  assert.equal(vic.canAddDocuments, false);

  await hana.update({ access: { ...access, groups: [{ ...access.groups[0]!, access: 'markup' }] } });
  await vic.poll();
  assert.equal(vic.canMarkup, true, 'the group was given comment access');
});

type Markup = { id: string; type: string; pageIndex: number; status: string; comment?: string };
const seatOf = (s: DriveSession) => (s as unknown as { seatId: string }).seatId;
const fileNamed = (drive: FakeStore, name: string) => [...drive.files.values()].find((f) => f.name === name);
const roomFile = (s: DriveSession, room: string, kind: 'nbsnap' | 'nbdelta') => `${seatOf(s)}.${room}.${kind}`;

/** Makes this browser remember `seatId` for `folderId` while `fn` runs (as after a page reload). */
async function remembering<T>(folderId: string, seatId: string, fn: () => Promise<T>): Promise<T> {
  const g = globalThis as { localStorage?: unknown };
  g.localStorage = { getItem: (k: string) => (k === 'nb.drive.seats' ? JSON.stringify({ [folderId]: seatId }) : null), setItem() {}, removeItem() {} };
  try {
    return await fn();
  } finally {
    delete g.localStorage;
  }
}

test('an edit uploads only the delta of the room it touched; seats stay small', async () => {
  const { drive, hana, sam } = await twoAttendees();
  const d1 = await hana.addDocument('A-101.pdf', PDF);
  const d2 = await hana.addDocument('A-102.pdf', PDF);
  const a1 = fakeStore();
  const a2 = fakeStore();
  await hana.attach(d1.id, a1.store);
  await hana.attach(d2.id, a2.store);
  a1.markups.set('m1', { id: 'm1', type: 'cloud', pageIndex: 0, status: 'none' });
  a2.markups.set('m2', { id: 'm2', type: 'arrow', pageIndex: 0, status: 'none' });
  await hana.flush();

  drive.writes.length = 0;
  a1.markups.set('m1', { ...a1.markups.get('m1')!, status: 'accepted' });
  await hana.flush();
  const names = drive.writes.map((w) => w.name);
  assert.ok(names.includes(roomFile(hana, d1.id, 'nbdelta')), 'the edited document’s delta');
  assert.ok(!names.some((n) => n.includes(d2.id)), 'not the other document');
  assert.ok(!names.some((n) => n.endsWith('.nbseat')), 'not the seat');
  assert.ok(fileNamed(drive, roomFile(hana, d1.id, 'nbdelta'))!.body.byteLength < 1000);

  const seat = drive.files.get(seatOf(hana))!;
  assert.deepEqual(JSON.parse(new TextDecoder().decode(seat.body)), { v: 2 }, 'the seat holds no markups');
  assert.equal(seat.properties.nbV, '2');

  await sam.poll();
  const b = fakeStore();
  await sam.attach(d1.id, b.store);
  assert.equal(b.markups.get('m1')?.status, 'accepted');
});

test('a delta past its limit is folded into a snapshot, which late joiners read', async () => {
  const { drive, hana } = await twoAttendees();
  const doc = await hana.addDocument('A-101.pdf', PDF);
  const a = fakeStore();
  await hana.attach(doc.id, a.store);
  a.markups.set('first', { id: 'first', type: 'cloud', pageIndex: 0, status: 'none' });
  await hana.flush();
  assert.ok(fileNamed(drive, roomFile(hana, doc.id, 'nbdelta')));
  assert.equal(fileNamed(drive, roomFile(hana, doc.id, 'nbsnap')), undefined, 'no snapshot for a small change');

  const note = 'x'.repeat(1000);
  for (let i = 0; i < 80; i++) a.markups.set(`m${i}`, { id: `m${i}`, type: 'text', pageIndex: 0, status: 'none', comment: note });
  await hana.flush();
  const snapshot = fileNamed(drive, roomFile(hana, doc.id, 'nbsnap'));
  assert.ok(snapshot && snapshot.body.byteLength > 64 * 1024, 'a snapshot was written');
  assert.ok(fileNamed(drive, roomFile(hana, doc.id, 'nbdelta'))!.body.byteLength < 16, 'and the delta emptied');

  a.markups.set('after', { id: 'after', type: 'cloud', pageIndex: 1, status: 'none' });
  drive.writes.length = 0;
  await hana.flush();
  assert.ok(!drive.writes.some((w) => w.name.endsWith('.nbsnap')), 'small edits go back to the delta');

  const kai = await DriveSession.join(new FakeDrive(drive, 'kai'), hana.id, 'Kai', { ...opts, interactive: true });
  const k = fakeStore();
  await kai.attach(doc.id, k.store);
  assert.equal(k.markups.size, 82, 'the snapshot and the delta together');
});

test('rejoining on the same seat keeps edits that were only in its delta', async () => {
  const { drive, hana } = await twoAttendees();
  const doc = await hana.addDocument('A-101.pdf', PDF);
  const a = fakeStore();
  await hana.attach(doc.id, a.store);
  a.markups.set('m1', { id: 'm1', type: 'cloud', pageIndex: 0, status: 'none' });
  await hana.flush();
  const seatId = seatOf(hana);
  hana.destroy();

  const again = await remembering(hana.id, seatId, () => DriveSession.join(new FakeDrive(drive, 'hana'), hana.id, 'Hana', { ...opts, interactive: true }));
  assert.equal(seatOf(again), seatId, 'back on the same seat');
  const b = fakeStore();
  await again.attach(doc.id, b.store);
  b.markups.set('m2', { id: 'm2', type: 'arrow', pageIndex: 0, status: 'none' });
  await again.flush();

  const kai = await DriveSession.join(new FakeDrive(drive, 'kai'), hana.id, 'Kai', { ...opts, interactive: true });
  const k = fakeStore();
  await kai.attach(doc.id, k.store);
  assert.deepEqual([...k.markups.keys()].sort(), ['m1', 'm2'], 'the edit from before the rejoin survives');
});

test('seats from before room files are read, and moved to room files by their owner', async () => {
  const { drive, hana, sam } = await twoAttendees();
  const old = new Y.Doc();
  old.getArray<RecordEntry>('record').push([{ id: 'r-old', at: 1, author: 'Olga', kind: 'chat', text: 'from an older version' }]);
  const rooms = { session: Buffer.from(Y.encodeStateAsUpdate(old)).toString('base64') };
  const id = drive.nextId();
  const body = new TextEncoder().encode(JSON.stringify({ v: 1, rooms }));
  drive.files.set(id, { id, name: 'Olga (wxyz).nbseat', mimeType: 'application/json', version: '1', size: body.byteLength, createdTime: new Date().toISOString(), properties: { nbRole: 'seat', nbName: 'Olga', nbSeen: '0' }, parent: hana.id, owner: 'olga', body });

  await sam.poll();
  assert.ok(sam.getSnapshot().record.some((e) => e.text === 'from an older version'), 'a v1 seat is still read');

  const olga = await remembering(hana.id, id, () => DriveSession.join(new FakeDrive(drive, 'olga'), hana.id, 'Olga', { ...opts, interactive: true }));
  assert.equal(seatOf(olga), id);
  await olga.flush();
  const seat = drive.files.get(id)!;
  assert.deepEqual(JSON.parse(new TextDecoder().decode(seat.body)), { v: 2 }, 'the seat was emptied');
  assert.equal(seat.properties.nbV, '2');
  assert.ok(fileNamed(drive, `${id}.session.nbsnap`), 'into a snapshot');

  const kai = await DriveSession.join(new FakeDrive(drive, 'kai'), hana.id, 'Kai', { ...opts, interactive: true });
  assert.ok(kai.getSnapshot().record.some((e) => e.text === 'from an older version'), 'nothing was lost on the way');
});

test('a damaged file is skipped rather than stopping the session', async () => {
  const { drive, hana, sam } = await twoAttendees();
  const junk = (name: string, properties: DriveProps) => {
    const id = drive.nextId();
    const body = new TextEncoder().encode('not what it should be');
    drive.files.set(id, { id, name, mimeType: 'application/octet-stream', version: '1', size: body.byteLength, createdTime: new Date().toISOString(), properties, parent: hana.id, owner: 'eve', body });
  };
  junk('zzzz.session.nbdelta', {});
  junk('Bad (0000).nbseat', { nbRole: 'seat', nbName: 'Bad', nbSeen: '0' });
  hana.sendChat('still working');
  await hana.flush();
  await sam.poll();
  assert.equal(sam.getSnapshot().status, 'online');
  assert.ok(sam.getSnapshot().record.some((e) => e.text === 'still working'));
});

test('a revised document reaches attendees as a new revision', async () => {
  const { hana, sam } = await twoAttendees();
  const doc = await hana.addDocument('A-101.pdf', PDF);
  await sam.poll();
  assert.equal(sam.meta.documents[0]?.version, 1);
  await hana.updateDocument(doc.id, new TextEncoder().encode('%PDF-1.7 rev B').buffer as ArrayBuffer);
  await sam.poll();
  assert.equal(sam.meta.documents[0]?.version, 2);
});

test('edits made before the folder could be read do not overwrite our unread delta', async () => {
  const { drive, hana } = await twoAttendees();
  const doc = await hana.addDocument('A-101.pdf', PDF);
  const a = fakeStore();
  await hana.attach(doc.id, a.store);
  a.markups.set('m1', { id: 'm1', type: 'cloud', pageIndex: 0, status: 'none' });
  await hana.flush();
  const seatId = seatOf(hana);
  hana.destroy();

  drive.roomReadsFail = true;
  const again = await remembering(hana.id, seatId, () => DriveSession.join(new FakeDrive(drive, 'hana'), hana.id, 'Hana', { ...opts, interactive: true }));
  assert.equal(again.getSnapshot().status, 'offline');
  const b = fakeStore();
  await again.attach(doc.id, b.store);
  b.markups.set('m2', { id: 'm2', type: 'arrow', pageIndex: 0, status: 'none' });
  await again.flush();

  drive.roomReadsFail = false;
  await again.poll();
  await again.flush();
  const kai = await DriveSession.join(new FakeDrive(drive, 'kai'), hana.id, 'Kai', { ...opts, interactive: true });
  const k = fakeStore();
  await kai.attach(doc.id, k.store);
  assert.deepEqual([...k.markups.keys()].sort(), ['m1', 'm2']);
});

/** Stands in for the browser's Web Locks while `fn` runs: `refuse` makes every request reject. */
async function withLocks<T>(fn: () => Promise<T>, refuse = false): Promise<T> {
  const held = new Set<string>();
  const locks = {
    request: async (name: string, _opts: unknown, cb: (lock: unknown) => unknown) => {
      if (refuse) throw new DOMException('locks are not allowed here', 'SecurityError');
      if (held.has(name)) return cb(null);
      held.add(name);
      try {
        return await cb({ name });
      } finally {
        held.delete(name);
      }
    },
  };
  const before = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: { locks }, configurable: true });
  try {
    return await fn();
  } finally {
    if (before) Object.defineProperty(globalThis, 'navigator', before);
    else delete (globalThis as { navigator?: unknown }).navigator;
  }
}

test('joining still works where locks are refused', async () => {
  await withLocks(async () => {
    const { hana, sam } = await twoAttendees();
    assert.ok(seatOf(hana) && seatOf(sam));
  }, true);
});

test('a failed join frees its seat, so trying again rejoins it', async () => {
  await withLocks(async () => {
    const { drive, hana } = await twoAttendees();
    const first = await DriveSession.join(new FakeDrive(drive, 'sam'), hana.id, 'Sam', { ...opts, interactive: true });
    const seatId = seatOf(first);
    first.destroy();

    const flaky = new FakeDrive(drive, 'sam');
    flaky.ownedByMe = async () => {
      throw new Error('Google Drive could not check the session host (500).');
    };
    await assert.rejects(remembering(hana.id, seatId, () => DriveSession.join(flaky, hana.id, 'Sam', { ...opts, interactive: true })), /500/);

    const again = await remembering(hana.id, seatId, () => DriveSession.join(new FakeDrive(drive, 'sam'), hana.id, 'Sam', { ...opts, interactive: true }));
    assert.equal(seatOf(again), seatId, 'the same seat, not a new one');
  });
});
