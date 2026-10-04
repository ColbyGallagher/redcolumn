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
