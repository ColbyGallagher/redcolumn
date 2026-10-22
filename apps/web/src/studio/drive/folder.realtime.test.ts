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
 * Attendees on a real folder with the session's own timers running: it checks the folder every
 * POLL_MS and saves FLUSH_MS after an edit. Each draws a markup about every EDIT_GAP_MS for SECONDS,
 * and the test times how long each markup takes to reach everyone else. Not committed: run by hand.
 */
const ATTENDEES = Number(process.env.STRESS_ATTENDEES ?? 8);
const POLL_MS = Number(process.env.POLL_MS ?? 3000);
const FLUSH_MS = Number(process.env.FLUSH_MS ?? 1200);
const SECONDS = Number(process.env.SECONDS ?? 60);
const EDIT_GAP_MS = Number(process.env.EDIT_GAP_MS ?? 4000);

// The session listens for the window being shown or hidden.
(globalThis as { document?: unknown }).document = { hidden: false, addEventListener: () => {}, removeEventListener: () => {} };
Object.defineProperty(globalThis, 'navigator', { value: undefined, configurable: true, writable: true });

const traffic = { list: 0, download: 0, downloadBytes: 0, create: 0, update: 0 };
const disk = { reads: 0, bytes: 0 };
const realReadFile = fs.readFile;
(fs as { readFile: unknown }).readFile = async (...args: Parameters<typeof realReadFile>) => {
  const data = await realReadFile(...args);
  disk.reads++;
  disk.bytes += data.length;
  return data;
};

function computer(store: FolderStore): DesktopFolders {
  return {
    pick: async () => null,
    list: (id) => (traffic.list++, store.list(id)),
    download: async (id) => {
      const bytes = new Uint8Array(await store.download(id));
      traffic.download++;
      traffic.downloadBytes += bytes.byteLength;
      return bytes;
    },
    createFolder: (parent, name) => store.createFolder(parent, name),
    createFile: (folder, name, body, props) => (traffic.create++, store.createFile(folder, name, body, props)),
    updateContent: (id, body) => (traffic.update++, store.updateContent(id, body)),
    updateProperties: (id, props) => (traffic.update++, store.updateProperties(id, props)),
    remove: (id) => store.remove(id),
    ownedByMe: (id) => store.ownedByMe(id),
    show: async () => {},
    removeSession: async () => {},
  };
}

type M = { id: string; type: string; pageIndex: number; status: string; by: number; madeAt: number };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pct = (xs: number[], p: number) => xs.slice().sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))] ?? 0;
const PDF = new TextEncoder().encode('%PDF-1.7').buffer as ArrayBuffer;

test(`real timers: ${ATTENDEES} attendees, check every ${POLL_MS} ms, save ${FLUSH_MS} ms after an edit`, { timeout: 600_000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nb-realtime-'));
  const sessions: DriveSession[] = [];
  try {
    const opts = { pollMs: POLL_MS, flushMs: FLUSH_MS, authorize: async () => {}, onRemoved: () => {} };
    const hostStore = new FolderStore();
    const host = await DriveSession.create(new SessionFolderDrive(await hostStore.addRoot(root), computer(hostStore)), 'Realtime', 'User1', { markup: true, addDocuments: true }, { ...opts, linkCanEdit: false });
    sessions.push(host);
    const folder = path.join(root, (await fs.readdir(root))[0]!);
    for (let i = 2; i <= ATTENDEES; i++) {
      const store = new FolderStore();
      sessions.push(await DriveSession.join(new SessionFolderDrive(null, computer(store)), await store.addRoot(folder), `User${i}`, { ...opts, interactive: true }));
    }
    const doc = await host.addDocument('A-101.pdf', PDF);
    await Promise.all(sessions.map((s) => s.poll()));

    const lags: number[] = [];
    const heard = new Set<string>();
    const maps = sessions.map((s, i) => {
      const ydoc = new Y.Doc();
      const markups = ydoc.getMap<M>('markups');
      markups.observe((ev) => {
        for (const key of ev.keysChanged) {
          const m = markups.get(key);
          if (!m || m.by === i || heard.has(`${i}:${key}`)) continue;
          heard.add(`${i}:${key}`);
          lags.push(Date.now() - m.madeAt);
        }
      });
      return { s, markups, store: { doc: ydoc, setReadOnly: () => {}, setEditRule: () => {} } as unknown as MarkupStore };
    });
    await Promise.all(maps.map((m) => m.s.attach(doc.id, m.store)));
    await sleep(1000);

    const before = { ...traffic };
    const diskBefore = { ...disk };
    const started = Date.now();
    let made = 0;
    await Promise.all(
      maps.map(async (m, i) => {
        await sleep(Math.random() * EDIT_GAP_MS);
        while (Date.now() - started < SECONDS * 1000) {
          const id = `m-${i}-${made++}`;
          m.markups.set(id, { id, type: 'cloud', pageIndex: made % 20, status: 'none', by: i, madeAt: Date.now() });
          await sleep(EDIT_GAP_MS * (0.5 + Math.random()));
        }
      }),
    );
    // Let the last edits go out and be seen.
    await sleep(POLL_MS + FLUSH_MS + 3000);
    const minutes = (Date.now() - started) / 60000;

    const expected = made * (ATTENDEES - 1);
    const d = (k: keyof typeof traffic) => traffic[k] - before[k];
    const perMin = (n: number) => (n / minutes).toFixed(0);
    console.log(
      `\n  REALTIME attendees=${ATTENDEES} check every ${POLL_MS} ms, save ${FLUSH_MS} ms after an edit, ${SECONDS}s of drawing (${made} markups, one per ~${EDIT_GAP_MS / 1000}s each)\n` +
        `  delay until others see a markup: median ${(pct(lags, 0.5) / 1000).toFixed(1)}s, 90th ${(pct(lags, 0.9) / 1000).toFixed(1)}s, worst ${(Math.max(...lags) / 1000).toFixed(1)}s (${lags.length}/${expected} seen)\n` +
        `  load per minute, whole group: ${perMin(d('list'))} folder checks, ${perMin(d('download'))} downloads (${perMin(d('downloadBytes') / 1024)} KiB), ${perMin(d('create'))} new files, ${perMin(d('update'))} file rewrites, ${perMin(disk.reads - diskBefore.reads)} disk reads\n`,
    );
    assert.equal(lags.length, expected, 'every markup reached every other attendee');
  } finally {
    for (const s of sessions) s.destroy();
    await fs.rm(root, { recursive: true, force: true });
  }
});
