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
    return this.store.bump(f);
  }

  async updateProperties(fileId: string, properties: DriveProps): Promise<string> {
    const f = this.own(fileId);
    f.properties = { ...f.properties, ...properties };
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

test('markups, chat and documents sync through seat files', async () => {
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
