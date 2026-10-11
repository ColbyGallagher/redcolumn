import assert from 'node:assert/strict';
import { test } from 'node:test';
import { noteCloudActivity, startIdleSignOut } from './idle';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('signs out once after a quiet spell, and again only after new cloud work goes quiet', async () => {
  let signedOut = 0;
  noteCloudActivity(Date.now());
  const stop = startIdleSignOut(() => void signedOut++, { every: 5, after: 60_000 });
  await wait(30);
  assert.equal(signedOut, 0, 'recent cloud work keeps the sign-in');
  noteCloudActivity(Date.now() - 120_000);
  await wait(30);
  assert.equal(signedOut, 1);
  await wait(30);
  assert.equal(signedOut, 1, 'not repeated while still quiet');
  noteCloudActivity(Date.now() - 90_000);
  await wait(30);
  assert.equal(signedOut, 2);
  stop();
});
