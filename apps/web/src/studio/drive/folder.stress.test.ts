import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import * as Y from 'yjs';
import type { MarkupStore } from '@nb/markup';
import { FolderStore } from '../../../../desktop/src/folderDrive';
import type { DesktopFolders } from '../../desktop/host';
import { DriveSession } from './DriveSession';
import { SessionFolderDrive } from './folder';

/**
 * Many simulated attendees on one real folder on disk, each through their own copy of the desktop
 * app's FolderStore (the code behind "a folder on this computer"). Set STRESS_ATTENDEES / ROUNDS /
 * MARKUPS to scale. Not committed: run it by hand.
 */
const ATTENDEES = Number(process.env.STRESS_ATTENDEES ?? 5);
const ROUNDS = Number(process.env.STRESS_ROUNDS ?? 10);
const MARKUPS = Number(process.env.STRESS_MARKUPS ?? 10);

/** Every file the store reads from disk (listings, downloads, property updates), counted by patching readFile. */
const disk = { reads: 0, bytes: 0 };
const realReadFile = fs.readFile;
(fs as { readFile: unknown }).readFile = async (...args: Parameters<typeof realReadFile>) => {
  const data = await realReadFile(...args);
  disk.reads++;
  disk.bytes += data.length;
  return data;
};

Object.defineProperty(globalThis, 'navigator', { value: undefined, configurable: true, writable: true });

interface Counts {
  list: number;
  listedBytes: number;
  download: number;
  downloadBytes: number;
  create: number;
  update: number;
  uploadBytes: number;
}

/** One computer's desktop app: the real FolderStore, with the traffic through it counted. */
function computer(store: FolderStore, counts: Counts): DesktopFolders {
  return {
    pick: async () => null,
    list: async (id) => {
      const files = await store.list(id);
      counts.list++;
      // The real store reads and hashes every file in the folder on every listing.
      counts.listedBytes += files.reduce((a, f) => a + f.size, 0);
      return files;
    },
    download: async (id) => {
      // Across the real IPC the page receives a plain Uint8Array, not a pooled Node Buffer.
      const bytes = new Uint8Array(await store.download(id));
      counts.download++;
      counts.downloadBytes += bytes.byteLength;
      return bytes;
    },
    createFolder: (parent, name) => store.createFolder(parent, name),
    createFile: async (folder, name, body, props) => {
      counts.create++;
      counts.uploadBytes += body.byteLength;
      return store.createFile(folder, name, body, props);
    },
    updateContent: async (id, body) => {
      counts.update++;
      counts.uploadBytes += body.byteLength;
      return store.updateContent(id, body);
    },
    updateProperties: async (id, props) => {
      counts.update++;
      return store.updateProperties(id, props);
    },
    remove: (id) => store.remove(id),
    ownedByMe: (id) => store.ownedByMe(id),
    show: async () => {},
    removeSession: async () => {},
  };
}

type M = { id: string; type: string; pageIndex: number; status: string };

function markupStore() {
  const doc = new Y.Doc();
  return {
    store: { doc, setReadOnly: () => {}, setEditRule: () => {} } as unknown as MarkupStore,
    markups: doc.getMap<M>('markups'),
  };
}

const opts = { pollMs: 0, authorize: async () => {}, onRemoved: () => {} };
const PDF = new TextEncoder().encode('%PDF-1.7').buffer as ArrayBuffer;

test(`folder stress: ${ATTENDEES} attendees on a real folder converge`, { timeout: 900_000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nb-folder-stress-'));
  try {
    const counts: Counts = { list: 0, listedBytes: 0, download: 0, downloadBytes: 0, create: 0, update: 0, uploadBytes: 0 };
    const names = Array.from({ length: ATTENDEES }, (_, i) => `User${i + 1}`);

    const hostStore = new FolderStore();
    const hostRoot = await hostStore.addRoot(root);
    const host = await DriveSession.create(new SessionFolderDrive(hostRoot, computer(hostStore, counts)), 'Stress', names[0]!, { markup: true, addDocuments: true }, { ...opts, linkCanEdit: false });
    const sessionDir = (await fs.readdir(root))[0]!;
    const folder = path.join(root, sessionDir);

    const sessions: DriveSession[] = [host];
    for (const name of names.slice(1)) {
      // Each computer chooses the same shared folder in its own dialog and gets its own IDs for it.
      const store = new FolderStore();
      const id = await store.addRoot(folder);
      sessions.push(await DriveSession.join(new SessionFolderDrive(null, computer(store, counts)), id, name, { ...opts, interactive: true }));
    }

    const doc = await host.addDocument('A-101.pdf', PDF);
    await Promise.all(sessions.map((s) => s.poll()));
    const stores = sessions.map(() => markupStore());
    await Promise.all(sessions.map((s, i) => s.attach(doc.id, stores[i]!.store)));
    const setup = { ...counts };
    const diskSetup = { ...disk };

    const started = performance.now();
    let pollMs = 0;
    let chats = 0;
    for (let round = 0; round < ROUNDS; round++) {
      sessions.forEach((s, i) => {
        for (let k = 0; k < MARKUPS; k++) {
          const id = `m-${i}-${round}-${k}`;
          stores[i]!.markups.set(id, { id, type: 'cloud', pageIndex: k, status: 'none' });
        }
        s.sendChat(`${names[i]} round ${round}`);
        chats++;
      });
      await Promise.all(sessions.map((s) => s.flush()));
      const t = performance.now();
      await Promise.all(sessions.map((s) => s.poll()));
      pollMs += performance.now() - t;
    }
    await Promise.all(sessions.map((s) => s.flush()));
    await Promise.all(sessions.map((s) => s.poll()));
    await Promise.all(sessions.map((s) => s.poll()));
    const elapsed = performance.now() - started;

    const expected = ATTENDEES * ROUNDS * MARKUPS;
    const entries = await fs.readdir(folder);
    const sizes = await Promise.all(entries.map(async (e) => (await fs.stat(path.join(folder, e))).size));
    const kind = (ext: string) => entries.filter((e) => e.endsWith(ext)).length;
    const d = (k: keyof Counts) => counts[k] - setup[k];
    const kib = (n: number) => (n / 1024).toFixed(0);
    console.log(
      `\n  FOLDER attendees=${ATTENDEES} rounds=${ROUNDS} markups/round=${MARKUPS} (${expected} markups, ${chats} chats)\n` +
        `  folder: ${entries.length} files (${kind('.nbseat')} seats, ${kind('.nbsnap')} snapshots, ${kind('.nbdelta')} deltas), ${kib(sizes.reduce((a, b) => a + b, 0))} KiB\n` +
        `  traffic after setup: ${d('list')} lists, ${d('download')} downloads (${kib(d('downloadBytes'))} KiB), ${d('create')} creates, ${d('update')} updates (${kib(d('uploadBytes'))} KiB up)\n` +
        `  disk reads after setup: ${disk.reads - diskSetup.reads} files, ${kib(disk.bytes - diskSetup.bytes)} KiB (listings hash every file they list)\n` +
        `  wall: ${elapsed.toFixed(0)} ms total, ${(pollMs / ROUNDS).toFixed(0)} ms per all-attendee poll round\n`,
    );

    stores.forEach((s, i) => assert.equal(s.markups.size, expected, `${names[i]} sees every markup`));
    const reference = JSON.stringify([...stores[0]!.markups.entries()].sort());
    stores.forEach((s, i) => assert.equal(JSON.stringify([...s.markups.entries()].sort()), reference, `${names[i]} matches ${names[0]}`));
    sessions.forEach((s, i) => {
      const texts = new Set(s.getSnapshot().record.map((e) => e.text));
      for (let r = 0; r < ROUNDS; r++) for (const n of names) assert.ok(texts.has(`${n} round ${r}`), `${names[i]} has "${n} round ${r}"`);
    });
    assert.equal(host.meta.attendees.length, ATTENDEES);

    // Someone who arrives after all of it reads the snapshots and chunks from scratch.
    const lateDisk = new FolderStore();
    const late = await DriveSession.join(new SessionFolderDrive(null, computer(lateDisk, counts)), await lateDisk.addRoot(folder), 'Late', { ...opts, interactive: true });
    await late.poll();
    const lateStore = markupStore();
    await late.attach(doc.id, lateStore.store);
    assert.equal(JSON.stringify([...lateStore.markups.entries()].sort()), reference, 'a late joiner has exactly what everyone has');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
