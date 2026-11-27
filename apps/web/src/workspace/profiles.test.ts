import assert from 'node:assert/strict';
import test from 'node:test';

// profiles.ts reads localStorage when it loads.
const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

const { profiles } = await import('./profiles.ts');

test('a cloud backup restores onto a fresh browser, keeping its active profile', () => {
  const a = profiles.create('Drafting', 'default');
  const backup = profiles.exportAll();
  profiles.remove(a.id);
  assert.ok(!profiles.get().profiles.some((p) => p.id === a.id));
  profiles.importAll(backup);
  assert.ok(profiles.get().profiles.some((p) => p.id === a.id && p.name === 'Drafting'));
  assert.equal(profiles.get().activeId, a.id);
});

test('restoring replaces same-ID profiles and keeps others', () => {
  const mine = profiles.create('Mine', 'default');
  const backup = JSON.parse(profiles.exportAll()) as { profiles: { id: string; name: string }[] };
  backup.profiles.find((p) => p.id === mine.id)!.name = 'From the cloud';
  const before = profiles.get().profiles.length;
  profiles.importAll(JSON.stringify(backup));
  assert.equal(profiles.get().profiles.length, before);
  assert.equal(profiles.get().profiles.find((p) => p.id === mine.id)!.name, 'From the cloud');
});

test('a file that is not a backup is refused', () => {
  assert.throws(() => profiles.importAll('{"format":"other"}'), /not a profile backup/);
});

test('the panels docked on the right are saved with the profile, and older profiles dock everything left', () => {
  const p = profiles.create('Docked', 'default');
  // 3D Properties and Display & Scene start on the right; everything else on the left.
  assert.deepEqual(p.state.rightPanels, ['model3dProps', 'model3dDisplay']);
  profiles.update((s) => ({ ...s, rightPanels: ['files', 'properties'] }));
  const copy = profiles.importJson(profiles.exportJson(p.id));
  assert.deepEqual(copy.state.rightPanels, ['files', 'properties']);
  const { rightPanels: _, placedPanels: __, ...old } = copy.state;
  const upgraded = profiles.importJson(JSON.stringify({ format: 'nb-profile', version: 1, name: 'Old', state: old }));
  assert.deepEqual(upgraded.state.rightPanels, ['model3dProps', 'model3dDisplay']);
});

test('a panel added on the right joins older profiles there once, and stays where it is moved', () => {
  const p = profiles.create('Placed', 'default');
  const { placedPanels: _, ...old } = { ...p.state, rightPanels: ['files'] };
  const upgraded = profiles.importJson(JSON.stringify({ format: 'nb-profile', version: 1, name: 'Old', state: old }));
  assert.deepEqual(upgraded.state.rightPanels, ['files', 'model3dProps', 'model3dDisplay']);
  assert.deepEqual(upgraded.state.placedPanels, ['model3dProps', 'model3dDisplay']);
  // Moved to the left, it stays there when the profile is read again.
  const file = JSON.parse(profiles.exportJson(upgraded.id));
  file.state.rightPanels = ['files'];
  const moved = profiles.importJson(JSON.stringify(file));
  assert.deepEqual(moved.state.rightPanels, ['files']);
});

test('a panel added later joins a profile that already placed the others, without moving those back', () => {
  const p = profiles.create('Earlier', 'default');
  // Saved before Display & Scene: 3D Properties already placed once, then moved to the left by the user.
  const state = { ...p.state, rightPanels: ['files', 'layers'], placedPanels: ['model3dProps'] };
  const upgraded = profiles.importJson(JSON.stringify({ format: 'nb-profile', version: 1, name: 'Old', state }));
  assert.deepEqual(upgraded.state.rightPanels, ['files', 'layers', 'model3dDisplay']);
  assert.deepEqual(upgraded.state.placedPanels, ['model3dProps', 'model3dDisplay']);
});

test('a full-width Markups list is saved with the profile, and older profiles keep it beside the side panels', () => {
  const p = profiles.create('Wide', 'default');
  assert.equal(p.state.dockFullWidth, false);
  profiles.update((s) => ({ ...s, dockFullWidth: true }));
  const copy = profiles.importJson(profiles.exportJson(p.id));
  assert.equal(copy.state.dockFullWidth, true);
  const { dockFullWidth: _, ...old } = copy.state;
  const upgraded = profiles.importJson(JSON.stringify({ format: 'nb-profile', version: 1, name: 'Old', state: old }));
  assert.equal(upgraded.state.dockFullWidth, false);
});

test('a Markups list docked in a side panel is saved with the profile, and older profiles keep it at the bottom', () => {
  const p = profiles.create('Side', 'default');
  assert.equal(p.state.markupsDocked, false);
  profiles.update((s) => ({ ...s, markupsDocked: true, rightPanels: ['markups'] }));
  const copy = profiles.importJson(profiles.exportJson(p.id));
  assert.equal(copy.state.markupsDocked, true);
  const { markupsDocked: _, ...old } = copy.state;
  const upgraded = profiles.importJson(JSON.stringify({ format: 'nb-profile', version: 1, name: 'Old', state: old }));
  assert.equal(upgraded.state.markupsDocked, false);
});

test('a new profile starts with no drawing standards', () => {
  const p = profiles.create('Older', 'default');
  assert.deepEqual(p.state.drawingStandards, []);
});
