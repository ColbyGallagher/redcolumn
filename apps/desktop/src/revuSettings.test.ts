import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { isBookmarkXml, revuCandidate, RevuSettings, revuSettingsRoot } from './revuSettings.ts';

async function folder(files: Record<string, string>) {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'rc-revu-')));
  for (const [name, text] of Object.entries(files)) {
    const target = path.join(dir, name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, text);
  }
  return dir;
}

test('Revu keeps its settings under APPDATA on Windows only', () => {
  assert.equal(revuSettingsRoot('win32', { APPDATA: 'C:\\Users\\a\\AppData\\Roaming' }), 'C:\\Users\\a\\AppData\\Roaming\\Bluebeam Software\\Revu');
  assert.equal(revuSettingsRoot('darwin', { APPDATA: '/x' }), null);
  assert.equal(revuSettingsRoot('win32', {}), null);
});

test('only library files are candidates', () => {
  assert.equal(revuCandidate('My Tools.btx'), 'yes');
  assert.equal(revuCandidate('Advanced.blx'), 'yes');
  assert.equal(revuCandidate('Standard.bhx'), 'yes');
  assert.equal(revuCandidate('Revu.bpx'), 'yes');
  assert.equal(revuCandidate('KeyboardShortcuts.xml'), 'yes');
  assert.equal(revuCandidate('Construction.xml'), 'peek');
  assert.equal(revuCandidate('Categories/Construction.xml'), 'yes');
  assert.equal(revuCandidate('Stamps/Approved.pdf'), 'yes');
  assert.equal(revuCandidate('Stamps/en-GB/Approved.pdf'), 'yes');
  for (const no of ['DigitalIDs.xml', 'UserPreferences.xml', 'ApplicationSettings.xml', 'UserPreferences.backup', 'RdbRecentFiles.dat', 'Templates/rfi.pdf', 'Workflows/x/workflow.json', 'RevuUsers/u/Revu.xml', 'Stamps/notes.txt', 'Categories/a/b.xml', 'a/b/c/d.btx'])
    assert.equal(revuCandidate(no), 'no', no);
});

test('a bookmark template is told by its first element', () => {
  assert.ok(isBookmarkXml('\uFEFF<?xml version="1.0" encoding="utf-8"?>\n<root>\n  <bookmark dname="Cover" manual="1" />'));
  assert.ok(!isBookmarkXml('<?xml version="1.0"?><DigitalIDs><ID thumbprint="ab"/></DigitalIDs>'));
  assert.ok(!isBookmarkXml('<root><setting/></root>'));
});

test('versions are scanned newest first, with ids and relative paths only', async () => {
  const base = await folder({
    '21/My Tools.btx': '<x/>',
    '21/DigitalIDs.xml': '<DigitalIDs/>',
    '21/Construction.xml': '<?xml version="1.0"?>\n<root>\n<bookmark dname="A" manual="1"/></root>',
    '21/Other.xml': '<Settings/>',
    '21/Stamps/Approved.pdf': '%PDF-1.7',
    '21/Templates/rfi.pdf': '%PDF-1.7',
    '21/empty.blx': '',
    '2019/Old.btx': '<x/>',
    '20/KeyboardShortcuts.xml': '<KeyboardShortcuts/>',
    'notaversion/Thing.btx': '<x/>',
  });
  const revu = new RevuSettings(base);
  const versions = await revu.scan();
  assert.deepEqual(versions.map((v) => v.version), ['21', '20', '2019']);
  assert.deepEqual(versions[0]!.files.map((f) => f.path), ['Construction.xml', 'My Tools.btx', 'Stamps/Approved.pdf']);
  const tools = versions[0]!.files.find((f) => f.path === 'My Tools.btx')!;
  assert.match(tools.id, /^[0-9a-f]{32}$/);
  assert.equal(tools.size, 4);
  assert.equal(new TextDecoder().decode(await revu.read(tools.id)), '<x/>');
  for (const v of versions) for (const f of v.files) assert.ok(!path.isAbsolute(f.path) && !f.path.includes('\\'));
  const again = await revu.scan();
  assert.equal(again[0]!.files.find((f) => f.path === 'My Tools.btx')!.id, tools.id, 'a second scan keeps the ids');
  assert.equal(new TextDecoder().decode(await revu.read(tools.id)), '<x/>');
});

test('unknown ids, and files moved outside the folder, are refused', async () => {
  const base = await folder({ '21/A.btx': '<x/>' });
  const revu = new RevuSettings(base);
  const [v] = await revu.scan();
  await assert.rejects(revu.read('0'.repeat(32)), /not available/);
  await assert.rejects(revu.read(42), /not available/);
  const id = v!.files[0]!.id;
  const outside = await folder({ 'secret.btx': 'secret' });
  await fs.rm(path.join(base, '21', 'A.btx'));
  try {
    await fs.symlink(path.join(outside, 'secret.btx'), path.join(base, '21', 'A.btx'));
  } catch {
    return; // No symlinks without Developer Mode on Windows: the removal alone is checked.
  }
  await assert.rejects(revu.read(id), /not available/);
});

test('a version folder that is a junction or link to elsewhere is still listed', async () => {
  const real = await folder({ 'My Tools.btx': '<x/>' });
  const base = await folder({});
  try {
    await fs.symlink(real, path.join(base, '21'), 'junction');
  } catch {
    return; // No links here.
  }
  const revu = new RevuSettings(base);
  const [v] = await revu.scan();
  assert.equal(v?.version, '21');
  assert.deepEqual(v!.files.map((f) => f.path), ['My Tools.btx']);
  assert.equal(new TextDecoder().decode(await revu.read(v!.files[0]!.id)), '<x/>');
});

test('no root folder, or one that is missing, lists nothing', async () => {
  assert.deepEqual(await new RevuSettings(null).scan(), []);
  assert.deepEqual(await new RevuSettings(path.join(os.tmpdir(), 'rc-revu-missing-' + Date.now())).scan(), []);
});
