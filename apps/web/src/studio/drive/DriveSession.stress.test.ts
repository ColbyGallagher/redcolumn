import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as Y from 'yjs';
import type { EditRule, MarkupStore } from '@nb/markup';
import { DriveForbiddenError, type DriveApi, type DriveFile, type DriveProps } from './DriveApi';
import { DriveSession } from './DriveSession';

/**
 * Many simulated attendees on one in-memory "OneDrive". Set `STRESS_ATTENDEES` / `STRESS_ROUNDS` /
 * `STRESS_MARKUPS` to push past the defaults, e.g.
 *   STRESS_ATTENDEES=20 pnpm --filter ./apps/web test
 * Prints how the folder and the API traffic grow, and checks every attendee converges.
 */
const ATTENDEES = Number(process.env.STRESS_ATTENDEES ?? 5);
const ROUNDS = Number(process.env.STRESS_ROUNDS ?? 5);
const MARKUPS = Number(process.env.STRESS_MARKUPS ?? 4);

Object.defineProperty(globalThis, 'navigator', { value: undefined, configurable: true, writable: true });

interface Counts {
  list: number;
  download: number;
  downloadBytes: number;
  create: number;
  update: number;
  uploadBytes: number;
}

class Store {
  files = new Map<string, DriveFile & { parent: string; owner: string; body: Uint8Array }>();
  counts: Counts = { list: 0, download: 0, downloadBytes: 0, create: 0, update: 0, uploadBytes: 0 };
  private n = 0;
  nextId = () => `f${++this.n}`;
}

class Drive implements DriveApi {
  constructor(private store: Store, private user: string) {}

  async list(folderId: string): Promise<DriveFile[]> {
    this.store.counts.list++;
    return [...this.store.files.values()].filter((f) => f.parent === folderId).map((f) => ({ ...f, properties: { ...f.properties } }));
  }

  async download(fileId: string): Promise<ArrayBuffer> {
    const f = this.store.files.get(fileId);
    if (!f) throw new Error('404');
    this.store.counts.download++;
    this.store.counts.downloadBytes += f.body.byteLength;
    return f.body.slice().buffer;
  }

  async createFolder(name: string, properties: DriveProps): Promise<string> {
    const id = this.store.nextId();
    this.store.files.set(id, { id, name, mimeType: 'folder', version: '1', size: 0, createdTime: new Date().toISOString(), properties, parent: 'root', owner: this.user, body: new Uint8Array() });
    return id;
  }

  async createFile(folderId: string, name: string, mimeType: string, body: Blob, properties: DriveProps): Promise<DriveFile> {
    const id = this.store.nextId();
    const bytes = new Uint8Array(await body.arrayBuffer());
    const f = { id, name, mimeType, version: '1', size: bytes.byteLength, createdTime: new Date().toISOString(), properties, parent: folderId, owner: this.user, body: bytes };
    this.store.files.set(id, f);
    this.store.counts.create++;
    this.store.counts.uploadBytes += bytes.byteLength;
    return { ...f };
  }

  private own(fileId: string) {
    const f = this.store.files.get(fileId);
    if (!f) throw new Error('404');
    if (f.owner !== this.user) throw new DriveForbiddenError('not yours');
    return f;
  }

  async updateContent(fileId: string, body: Blob): Promise<string> {
    const f = this.own(fileId);
    f.body = new Uint8Array(await body.arrayBuffer());
    f.size = f.body.byteLength;
    this.store.counts.update++;
    this.store.counts.uploadBytes += f.body.byteLength;
    return (f.version = String(Number(f.version) + 1));
  }

  async updateProperties(fileId: string, properties: DriveProps): Promise<string> {
    const f = this.own(fileId);
    f.properties = { ...f.properties, ...properties };
    this.store.counts.update++;
    return (f.version = String(Number(f.version) + 1));
  }

  async shareWithLink(): Promise<void> {}
  async shareWithUser(): Promise<void> {}
  async ownedByMe(fileId: string): Promise<boolean> {
    return this.store.files.get(fileId)?.owner === this.user;
  }
}

type M = { id: string; type: string; pageIndex: number; status: string };

function markupStore() {
  const doc = new Y.Doc();
  return {
    store: { doc, setReadOnly: () => {}, setEditRule: (_r: EditRule | null) => {} } as unknown as MarkupStore,
    markups: doc.getMap<M>('markups'),
  };
}

const opts = { pollMs: 0, authorize: async () => {}, onRemoved: () => {} };
const PDF = new TextEncoder().encode('%PDF-1.7').buffer as ArrayBuffer;

test(`stress: ${ATTENDEES} attendees edit and chat concurrently and converge`, { timeout: 300_000 }, async () => {
  const drive = new Store();
  const names = Array.from({ length: ATTENDEES }, (_, i) => `User${i + 1}`);
  const host = await DriveSession.create(new Drive(drive, names[0]), 'Stress', names[0], { markup: true, addDocuments: true }, { ...opts, linkCanEdit: true });
  const sessions: DriveSession[] = [host];
  for (const name of names.slice(1)) sessions.push(await DriveSession.join(new Drive(drive, name), host.id, name, { ...opts, interactive: true }));

  const doc = await host.addDocument('A-101.pdf', PDF);
  await Promise.all(sessions.map((s) => s.poll()));
  const stores = sessions.map(() => markupStore());
  await Promise.all(sessions.map((s, i) => s.attach(doc.id, stores[i].store)));
  const setup = { ...drive.counts };

  const started = performance.now();
  let pollMs = 0;
  let chats = 0;
  for (let round = 0; round < ROUNDS; round++) {
    sessions.forEach((s, i) => {
      for (let k = 0; k < MARKUPS; k++) {
        const id = `m-${i}-${round}-${k}`;
        stores[i].markups.set(id, { id, type: 'cloud', pageIndex: k, status: 'none' });
      }
      s.sendChat(`${names[i]} round ${round}`);
      chats++;
    });
    await Promise.all(sessions.map((s) => s.flush()));
    const t = performance.now();
    await Promise.all(sessions.map((s) => s.poll()));
    pollMs += performance.now() - t;
  }
  // One more settle pass so late deltas reach everyone.
  await Promise.all(sessions.map((s) => s.flush()));
  await Promise.all(sessions.map((s) => s.poll()));
  await Promise.all(sessions.map((s) => s.poll()));
  const elapsed = performance.now() - started;

  const expected = ATTENDEES * ROUNDS * MARKUPS;
  const files = [...drive.files.values()].filter((f) => f.parent === host.id);
  const kinds = (ext: string) => files.filter((f) => f.name.endsWith(ext)).length;
  const delta = (k: keyof Counts) => drive.counts[k] - setup[k];
  console.log(
    `\n  attendees=${ATTENDEES} rounds=${ROUNDS} markups/round=${MARKUPS} (${expected} markups, ${chats} chats)\n` +
      `  folder: ${files.length} files (${kinds('.nbseat')} seats, ${kinds('.nbsnap')} snapshots, ${kinds('.nbdelta')} deltas), ${(files.reduce((a, f) => a + f.size, 0) / 1024).toFixed(1)} KiB\n` +
      `  traffic after setup: ${delta('list')} lists, ${delta('download')} downloads (${(delta('downloadBytes') / 1024).toFixed(0)} KiB), ${delta('create')} creates, ${delta('update')} updates (${(delta('uploadBytes') / 1024).toFixed(0)} KiB up)\n` +
      `  wall: ${elapsed.toFixed(0)} ms total, ${(pollMs / ROUNDS).toFixed(0)} ms per all-attendee poll round\n`,
  );

  stores.forEach((s, i) => assert.equal(s.markups.size, expected, `${names[i]} sees every markup`));
  const reference = JSON.stringify([...stores[0].markups.entries()].sort());
  stores.forEach((s, i) => assert.equal(JSON.stringify([...s.markups.entries()].sort()), reference, `${names[i]} matches ${names[0]}`));
  sessions.forEach((s, i) => {
    const texts = new Set(s.getSnapshot().record.map((e) => e.text));
    for (let r = 0; r < ROUNDS; r++) for (const n of names) assert.ok(texts.has(`${n} round ${r}`), `${names[i]} has "${n} round ${r}"`);
  });
  assert.equal(host.meta.attendees.length, ATTENDEES);
});
