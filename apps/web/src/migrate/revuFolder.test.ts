import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { classifyRevuPath, REVU_KINDS, revuItems, splitPickedFolder } from './revuFolder.ts';

test('files are sorted into the kinds the wizard imports', () => {
  assert.equal(classifyRevuPath('My Tools.btx'), 'toolSet');
  assert.equal(classifyRevuPath('Advanced.blx'), 'lineStyles');
  assert.equal(classifyRevuPath('Standard.bhx'), 'hatches');
  assert.equal(classifyRevuPath('Revu.bpx'), 'profile');
  assert.equal(classifyRevuPath('Stamps/Approved.pdf'), 'stamp');
  assert.equal(classifyRevuPath('Stamps/en-GB/Approved.pdf'), 'stamp');
  assert.equal(classifyRevuPath('Construction.xml'), 'bookmarks');
  assert.equal(classifyRevuPath('Categories/Construction.xml'), 'categories');
  assert.equal(classifyRevuPath('KeyboardShortcuts.xml'), 'shortcuts');
  for (const no of ['DigitalIDs.xml', 'UserPreferences.xml', 'ApplicationSettings.xml', 'Templates/rfi.pdf', 'Workflows/a/workflow.json', 'RevuUsers/u/Revu.xml', 'RdbRecentFiles.dat', 'Stamps/readme.txt', 'Categories/x/y.xml'])
    assert.equal(classifyRevuPath(no), null, no);
});

test('a stamp is offered once, from the main folder before a language folder', () => {
  const items = revuItems([
    { path: 'Stamps/en-GB/Approved.pdf', size: 1 },
    { path: 'Stamps/Approved.pdf', size: 2 },
    { path: 'Stamps/en-GB/Seal.pdf', size: 3 },
    { path: 'Stamps/fr-FR/Seal.pdf', size: 4 },
    { path: 'Zed.btx', size: 5 },
    { path: 'Alpha.btx', size: 6 },
    { path: 'Revu.bpx', size: 7 },
    { path: 'DigitalIDs.xml', size: 8 },
  ]);
  assert.deepEqual(
    items.map((i) => [i.kind, i.name, i.entry.path]),
    [
      ['toolSet', 'Alpha', 'Alpha.btx'],
      ['toolSet', 'Zed', 'Zed.btx'],
      ['stamp', 'Approved', 'Stamps/Approved.pdf'],
      ['stamp', 'Seal', 'Stamps/en-GB/Seal.pdf'],
      ['profile', 'Revu', 'Revu.bpx'],
    ],
  );
  assert.equal(REVU_KINDS[REVU_KINDS.length - 1], 'profile', 'profiles import last, so their copies hold the rest');
});

test('a picked Revu folder splits by version, newest first; a picked version folder stands alone', () => {
  const revu = splitPickedFolder([
    { relativePath: 'Revu/2019/Old.btx', size: 1 },
    { relativePath: 'Revu/21/My Tools.btx', size: 2 },
    { relativePath: 'Revu/21/Stamps/Approved.pdf', size: 3 },
    { relativePath: 'Revu/20/Standard.bhx', size: 4 },
  ]);
  assert.deepEqual(revu.map((v) => v.version), ['21', '20', '2019']);
  assert.deepEqual(revu[0]!.entries.map((e) => e.path), ['My Tools.btx', 'Stamps/Approved.pdf']);

  const one = splitPickedFolder([
    { relativePath: '21/My Tools.btx', size: 2 },
    { relativePath: '21/Stamps/en-GB/Approved.pdf', size: 3 },
  ]);
  assert.deepEqual(one.map((v) => v.version), ['21']);
  assert.deepEqual(one[0]!.entries.map((e) => e.path), ['My Tools.btx', 'Stamps/en-GB/Approved.pdf']);

  const copy = splitPickedFolder([{ relativePath: 'Revu settings copy/Advanced.blx', size: 1 }]);
  assert.deepEqual(copy.map((v) => [v.version, v.entries[0]!.path]), [['Revu settings copy', 'Advanced.blx']]);
  assert.deepEqual(splitPickedFolder([]), []);
});

// A real Revu settings folder, when one is at hand (not in the repository): REVU_SETTINGS_DIR=…/Revu/21
const dir = process.env.REVU_SETTINGS_DIR;
test('a real Revu 21 folder lists every library kind', { skip: !dir || !existsSync(dir) }, () => {
  const entries: { path: string; size: number }[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const full = join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else entries.push({ path: relative(dir!, full).split('\\').join('/'), size: statSync(full).size });
    }
  };
  walk(dir!);
  const kinds = new Set(revuItems(entries).map((i) => i.kind));
  for (const k of REVU_KINDS) assert.ok(kinds.has(k), k);
  assert.ok(!revuItems(entries).some((i) => /digitalids|userpreferences/i.test(i.entry.path)));
});
