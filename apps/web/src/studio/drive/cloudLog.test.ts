import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

const store = new Map<string, string>();
globalThis.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: () => null,
  length: 0,
} as Storage;

const { clearCloudLog, cloudLog, logCloudAction } = await import('./cloudLog');
const { firstUse, setFirstUseConfirm } = await import('./notices');

beforeEach(() => clearCloudLog());

test('actions are kept in this browser, oldest first, with repeats counted on one line', () => {
  logCloudAction('onedrive', 'create folder', 'L2 (redcolumn session)', 1);
  logCloudAction('onedrive', 'replace', 'Hana.nbseat', 2);
  logCloudAction('onedrive', 'replace', 'session.json', 3);
  logCloudAction('onedrive', 'replace', 'Hana.nbseat', 4);
  logCloudAction('onedrive', 'invite', 'sam@x.com to L2', 5);
  assert.deepEqual(
    cloudLog().map((e) => [e.action, e.name, e.count]),
    [
      ['create folder', 'L2 (redcolumn session)', 1],
      ['replace', 'session.json', 1],
      ['replace', 'Hana.nbseat', 2],
      ['invite', 'sam@x.com to L2', 1],
    ],
  );
  assert.equal(cloudLog()[2]!.first, 2);
  assert.ok(store.get('nb.cloud.activity')!.includes('sam@x.com'), 'saved in local storage only');
});

test('the list keeps the most recent 300 lines', () => {
  for (let i = 0; i < 350; i++) logCloudAction('onedrive', 'upload', `f${i}.pdf`, i);
  assert.equal(cloudLog().length, 300);
  assert.equal(cloudLog()[0]!.name, 'f50.pdf');
});

test('the first-use summary shows once, and cancelling stops the sign-in', async () => {
  const asked: string[] = [];
  let answer = false;
  setFirstUseConfirm(async (p) => (asked.push(p), answer));
  await assert.rejects(firstUse('microsoft'), /cancelled/);
  answer = true;
  await firstUse('microsoft');
  assert.deepEqual(asked, ['microsoft', 'microsoft']);
  setFirstUseConfirm(null);
});
