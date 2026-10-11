import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { FolderStore } from './folderDrive.ts';

const json = (v: unknown) => Buffer.from(JSON.stringify(v));
const text = (b: Uint8Array) => Buffer.from(b).toString('utf8');

async function setup() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rc-folder-'));
  const store = new FolderStore({}, 'me');
  const root = await store.addRoot(dir);
  return { dir, store, root };
}

test('files round-trip with their properties, and a new file never replaces another', async () => {
  const { dir, store, root } = await setup();
  const project = await store.createFolder(root, 'Tower (redcolumn project)');
  const a = await store.createFile(project, 'project.json', json({ name: 'Tower' }), { nbRole: 'manifest' });
  const b = await store.createFile(project, 'project.json', json({ name: 'Other' }), { nbRole: 'manifest' });
  assert.notEqual(a.id, b.id);
  assert.equal(b.name, 'project-1.json');
  assert.deepEqual(JSON.parse(text(await store.download(a.id))), { name: 'Tower' });
  const listed = await store.list(project);
  assert.equal(listed.find((f) => f.id === a.id)?.properties.nbRole, 'manifest');
  assert.equal(await store.ownedByMe(a.id), true);
  assert.equal(await new FolderStore(store.saved(), 'someone-else').ownedByMe(a.id), false);
  // The page never sees a path.
  assert.ok(!a.id.includes(dir) && !a.id.includes('Tower'));
});

test('replacing keeps properties and changes the version; properties update on their own', async () => {
  const { store, root } = await setup();
  const f = await store.createFile(root, 'presence-x.json', json({ v: 1 }), { nbRole: 'presence' });
  const v2 = await store.updateContent(f.id, json({ v: 2 }));
  assert.notEqual(v2, f.version);
  const v3 = await store.updateProperties(f.id, { nbPage: '3' });
  const listed = (await store.list(root)).find((x) => x.id === f.id)!;
  assert.equal(listed.version, v3);
  assert.deepEqual(listed.properties, { nbRole: 'presence', nbOwner: 'me', nbPage: '3' });
  assert.deepEqual(JSON.parse(text(await store.download(f.id))), { v: 2 });
});

test('paths cannot leave the chosen folder, and only lock files are deleted', async () => {
  const { dir, store, root } = await setup();
  const escape = `${root}${Buffer.from('../outside.json').toString('base64url')}`;
  await assert.rejects(store.download(escape), /not allowed/);
  await assert.rejects(store.download('lf:unknown:'), /no longer chosen/);
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'rc-outside-'));
  await fs.writeFile(path.join(outside, 'secret.json'), '{}');
  await fs.symlink(outside, path.join(dir, 'link'), 'junction');
  await assert.rejects(store.list(`${root}${Buffer.from('link').toString('base64url')}`), /outside the chosen folder/);
  const doc = await store.createFile(root, 'project.json', json({}), {});
  await assert.rejects(store.remove(doc.id), /only deletes its own lock files/);
  const lock = await store.createFile(root, 'lock-f1-abc.json', json({ by: 'Hana' }), {});
  await store.remove(lock.id);
  await store.remove(lock.id);
  await assert.rejects(store.createFile(root, 'notes.exe', Buffer.from('x'), {}), /Only the files Projects use/);
});

test("sync clients' conflict copies and half-written files are not listed", async () => {
  const { dir, store, root } = await setup();
  await store.createFile(root, 'rec-hana.json', json({ entries: [] }), { nbRole: 'record' });
  await fs.writeFile(path.join(dir, "rec-hana (Sam's conflicted copy).json"), json({ _nb: { nbRole: 'record' } }));
  await fs.writeFile(path.join(dir, 'rec-sam.json'), '{"entr');
  await fs.writeFile(path.join(dir, '.rec-hana.json.abc.tmp'), '{}');
  assert.deepEqual((await store.list(root)).map((f) => f.name), ['rec-hana.json']);
});
