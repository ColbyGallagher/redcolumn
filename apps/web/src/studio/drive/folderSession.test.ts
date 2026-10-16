import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as Y from 'yjs';
import type { MarkupStore } from '@nb/markup';
import type { DesktopFolderFile, DesktopFolders } from '../../desktop/host';
import { DriveSession } from './DriveSession';
import { SessionFolderDrive, sharedFileId } from './folder';

// Seat locks (Web Locks) would carry over between tests that reuse paths; these sessions need none.
Object.defineProperty(globalThis, 'navigator', { value: undefined, configurable: true, writable: true });

/** One shared folder (a OneDrive or network folder), as every computer's sync client sees it. */
class SharedDisk {
  dirs = new Set<string>(['shared']);
  files = new Map<string, { bytes: Uint8Array; props: Record<string, string>; owner: string; version: number; created: string }>();
}

/**
 * One computer's desktop app over the shared disk. Like the real one (apps/desktop/src/folderDrive.ts),
 * its IDs are its own: the same file has a different ID on each computer.
 */
class Computer implements DesktopFolders {
  constructor(
    private disk: SharedDisk,
    private tag: string,
  ) {}

  id = (p: string) => `lf:${this.tag}:${Buffer.from(p).toString('base64url')}`;
  private path(id: string) {
    const prefix = `lf:${this.tag}:`;
    if (!id.startsWith(prefix)) throw new Error('That folder is no longer chosen.');
    return Buffer.from(id.slice(prefix.length), 'base64url').toString('utf8');
  }
  private file(id: string) {
    const f = this.disk.files.get(this.path(id));
    if (!f) throw new Error('ENOENT: no such file');
    return f;
  }
  private describe(p: string): DesktopFolderFile {
    const f = this.disk.files.get(p)!;
    const name = p.slice(p.lastIndexOf('/') + 1);
    return { id: this.id(p), name, mimeType: 'application/octet-stream', version: String(f.version), size: f.bytes.byteLength, createdTime: f.created, properties: { ...f.props } };
  }

  async pick() {
    return { id: this.id('shared'), name: 'shared' };
  }
  async list(id: string) {
    const dir = this.path(id);
    if (!this.disk.dirs.has(dir)) throw new Error("Error invoking remote method 'folder:list': Error: ENOENT: no such file or directory");
    return [...this.disk.files.keys()].filter((p) => p.slice(0, p.lastIndexOf('/')) === dir).map((p) => this.describe(p));
  }
  async download(id: string) {
    return this.file(id).bytes.slice();
  }
  async createFolder(parent: string, name: string) {
    const p = `${this.path(parent)}/${name}`;
    this.disk.dirs.add(p);
    return this.id(p);
  }
  async createFile(folder: string, name: string, body: Uint8Array, props: Record<string, string>) {
    const dir = this.path(folder);
    const dot = name.lastIndexOf('.');
    let p = `${dir}/${name}`;
    for (let n = 1; this.disk.files.has(p); n++) p = `${dir}/${name.slice(0, dot)}-${n}${name.slice(dot)}`;
    // As on disk: JSON keeps its properties, a PDF is a document, room files keep none.
    const kept: Record<string, string> = /\.(json|nbseat)$/.test(name) ? { ...props, nbOwner: this.tag } : /\.pdf$/.test(name) ? { nbRole: 'document' } : {};
    this.disk.files.set(p, { bytes: body.slice(), props: kept, owner: this.tag, version: 1, created: new Date().toISOString() });
    return this.describe(p);
  }
  async updateContent(id: string, body: Uint8Array) {
    const f = this.file(id);
    f.bytes = body.slice();
    return String(++f.version);
  }
  async updateProperties(id: string, props: Record<string, string>) {
    const f = this.file(id);
    f.props = { ...f.props, ...props };
    return String(++f.version);
  }
  async remove() {}
  async ownedByMe(id: string) {
    return this.file(id).props.nbOwner === this.tag;
  }
  async show() {}
  async removeSession(id: string) {
    const dir = this.path(id);
    if (this.disk.files.get(`${dir}/session.json`)?.props.nbOwner !== this.tag) throw new Error('not mine');
    this.disk.dirs.delete(dir);
    for (const p of [...this.disk.files.keys()]) if (p.startsWith(`${dir}/`)) this.disk.files.delete(p);
  }
}

function markupStore() {
  const doc = new Y.Doc();
  return {
    store: { doc, setReadOnly: () => {}, setEditRule: () => {} } as unknown as MarkupStore,
    markups: doc.getMap<{ id: string; type: string; status: string }>('markups'),
  };
}

const opts = { pollMs: 0, authorize: async () => {}, onRemoved: () => {} };
const PDF = new TextEncoder().encode('%PDF-1.7').buffer as ArrayBuffer;

/** Hana starts a session in the shared folder on her computer; Sam opens it on his. */
async function twoComputers() {
  const disk = new SharedDisk();
  const hanaPc = new Computer(disk, 'hana-pc');
  const samPc = new Computer(disk, 'sam-pc');
  const hana = await DriveSession.create(new SessionFolderDrive(hanaPc.id('shared'), hanaPc), 'Level 2', 'Hana', { markup: true, addDocuments: true }, { ...opts, linkCanEdit: false });
  const folder = [...disk.dirs].find((d) => d !== 'shared')!;
  const sam = await DriveSession.join(new SessionFolderDrive(null, samPc), samPc.id(folder), 'Sam', { ...opts, interactive: true });
  return { disk, folder, hana, sam };
}

test('a session in a shared folder syncs markups, chat and documents between computers', async () => {
  const { folder, hana, sam } = await twoComputers();
  assert.equal(folder, 'shared/Level 2 (redcolumn session)');
  assert.equal(hana.backend, 'folder');
  assert.equal(hana.getSnapshot().isHost, true);
  assert.equal(sam.getSnapshot().isHost, false);
  assert.notEqual(hana.id, sam.id, 'each computer knows the folder by its own ID');
  assert.equal(hana.getSnapshot().inviteLink, '', 'there is no link to send');

  const doc = await hana.addDocument('Level 2 – Plan (rev B).pdf', PDF);
  await sam.poll();
  assert.deepEqual(sam.meta.documents.map((d) => [d.id, d.name]), [[doc.id, 'Level 2 – Plan (rev B).pdf']], 'the document has the same ID on both computers');

  const a = markupStore();
  const b = markupStore();
  await hana.attach(doc.id, a.store);
  await sam.attach(doc.id, b.store);
  a.markups.set('m1', { id: 'm1', type: 'cloud', status: 'none' });
  sam.sendChat('On it');
  await Promise.all([hana.flush(), sam.flush()]);
  await Promise.all([hana.poll(), sam.poll()]);
  assert.equal(b.markups.get('m1')?.type, 'cloud', 'Sam sees the cloud Hana drew');

  b.markups.set('m1', { ...b.markups.get('m1')!, status: 'accepted' });
  await sam.flush();
  await hana.poll();
  assert.equal(a.markups.get('m1')?.status, 'accepted', 'Hana sees Sam accept it');
  assert.ok(hana.getSnapshot().record.some((e) => e.author === 'Sam' && e.text === 'On it'));
  assert.deepEqual(new Set(hana.meta.attendees.map((x) => x.name)), new Set(['Hana', 'Sam']));
});

test('a document the host removes goes for everyone, though each computer has its own file IDs', async () => {
  const { hana, sam } = await twoComputers();
  const doc = await sam.addDocument('B.pdf', PDF);
  await hana.poll();
  await hana.removeDocument(doc.id);
  await sam.poll();
  assert.equal(sam.meta.documents.length, 0);
});

test('only the host ends a folder session; its folder goes and attendees see it ended', async () => {
  const { disk, folder, hana, sam } = await twoComputers();
  const seats = () => [...disk.files.keys()].filter((p) => p.endsWith('.nbseat')).length;
  assert.equal(seats(), 2);
  await assert.rejects(sam.end(), /host/);
  await hana.end();
  assert.equal(disk.dirs.has(folder), false);
  assert.equal([...disk.files.keys()].some((p) => p.startsWith(folder)), false);
  await sam.poll();
  assert.equal(sam.getSnapshot().removed, true, 'Sam sees the session gone');
});

test('a file ID inside a session folder is the same everywhere and safe in a file name', async () => {
  const id = await sharedFileId('Hana (x1y2).nbseat');
  assert.equal(id, await sharedFileId('Hana (x1y2).nbseat'));
  assert.notEqual(id, await sharedFileId('Sam (x1y2).nbseat'));
  assert.match(id, /^f[0-9a-f]{24}$/);
});
