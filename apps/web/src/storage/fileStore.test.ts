import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contentHash, listFiles, replaceFileContent, saveFile } from './fileStore.ts';

/** An in-memory stand-in for the Origin Private File System the library keeps its files in. */
function opfs() {
  const files = new Map<string, Uint8Array>();
  const file = (name: string) => ({
    getFile: async () => ({ arrayBuffer: async () => files.get(name)!.slice().buffer }),
    createWritable: async () => {
      let written = new Uint8Array();
      return {
        write: async (data: Uint8Array) => void (written = data.slice()),
        close: async () => void files.set(name, written),
      };
    },
  });
  const dir = {
    getFileHandle: async (name: string, opts?: { create?: boolean }) => {
      if (!files.has(name) && !opts?.create) throw new Error('NotFoundError');
      return file(name);
    },
    removeEntry: async (name: string) => void files.delete(name),
  };
  Object.defineProperty(navigator, 'storage', { configurable: true, value: { getDirectory: async () => ({ getFileHandle: dir.getFileHandle, getDirectoryHandle: async () => dir }) } });
  return { files };
}

const sha256 = async (bytes: ArrayBuffer) => {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
};

const a = new TextEncoder().encode('drawing a').slice().buffer as ArrayBuffer;
const b = new TextEncoder().encode('drawing b, revised').slice().buffer as ArrayBuffer;

test('a file saved with no id is keyed by the hash of its bytes', async () => {
  opfs();
  const stored = await saveFile('A-101.pdf', a);
  assert.equal(stored.id, stored.hash);
  assert.equal(stored.hash, await sha256(a));
  assert.equal(stored.name, 'A-101.pdf');
  const again = await saveFile('A-101 (2).pdf', a);
  assert.equal(again.id, stored.id);
  assert.equal(again.name, 'A-101 (2).pdf');
  assert.equal((await listFiles()).length, 1);
});

test('a file saved with no id keeps its entry when different bytes are saved', async () => {
  opfs();
  await saveFile('A-101.pdf', a);
  const second = await saveFile('B-201.pdf', b);
  assert.notEqual(second.id, (await listFiles()).find((e) => e.name === 'A-101.pdf')!.id);
  assert.equal((await listFiles()).length, 2);
});

test('a host-supplied id keeps its entry, and its contents, when other bytes come under it', async () => {
  const { files } = opfs();
  const first = await saveFile('A-101.pdf', a, 'host-record-7');
  assert.equal(first.id, 'host-record-7');
  assert.equal(first.hash, await sha256(a));
  // Its markups and any open tab go with the contents it has: the caller brings new ones in as a change.
  const second = await saveFile('A-101 rev B.pdf', b, 'host-record-7');
  assert.equal(second.id, 'host-record-7');
  assert.equal(second.hash, await contentHash(a));
  assert.notEqual(second.hash, await contentHash(b));
  assert.equal(second.size, a.byteLength);
  assert.equal(second.name, 'A-101 rev B.pdf');
  assert.equal(second.addedAt, first.addedAt);
  assert.equal((await listFiles()).length, 1);
  // The contents in use are kept; the ones nothing uses yet are not left behind.
  assert.equal(files.has(`${await sha256(a)}.pdf`), true);
  assert.equal(files.has(`${await sha256(b)}.pdf`), false);
});

test('new contents for a host-supplied id come in through replaceFileContent, keeping the id', async () => {
  const { files } = opfs();
  await saveFile('A-101.pdf', a, 'host-record-7');
  const replaced = await replaceFileContent('host-record-7', b);
  assert.equal(replaced.id, 'host-record-7');
  assert.equal(replaced.hash, await sha256(b));
  assert.equal(files.has(`${await sha256(a)}.pdf`), false);
  const again = await saveFile('A-101.pdf', b, 'host-record-7');
  assert.equal(again.hash, replaced.hash);
  assert.equal((await listFiles()).length, 1);
});

test('the same bytes under a host id and under their hash are separate entries', async () => {
  opfs();
  const plain = await saveFile('A-101.pdf', a);
  const hosted = await saveFile('A-101.pdf', a, 'host-record-7');
  assert.notEqual(plain.id, hosted.id);
  assert.equal(plain.hash, hosted.hash);
  assert.equal((await listFiles()).length, 2);
  // Neither drops the contents the other still uses.
  await replaceFileContent('host-record-7', b);
  assert.equal((await listFiles()).find((e) => e.id === plain.id)!.hash, await sha256(a));
});

test('a host-supplied id nobody has yet opens a new entry under it', async () => {
  opfs();
  const stored = await saveFile('A-101.pdf', a, 'host-record-9');
  assert.equal(stored.id, 'host-record-9');
  assert.equal(stored.hash, await sha256(a));
  assert.equal((await listFiles()).length, 1);
});
