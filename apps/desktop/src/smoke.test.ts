import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { isSmokeRun, lockHeldMessage, smokeUserData } from './smoke.ts';

test('only RECOLUMN_SMOKE=1 is a smoke run', () => {
  assert.equal(isSmokeRun({ RECOLUMN_SMOKE: '1' }), true);
  assert.equal(isSmokeRun({}), false);
  assert.equal(isSmokeRun({ RECOLUMN_SMOKE: '0' }), false);
  assert.equal(isSmokeRun({ RECOLUMN_SMOKE: 'true' }), false);
});

test('each smoke run gets its own empty user-data folder', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-test-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const a = smokeUserData(tmp);
  const b = smokeUserData(tmp);
  assert.notEqual(a, b);
  for (const dir of [a, b]) {
    assert.equal(path.dirname(dir), tmp);
    assert.match(path.basename(dir), /^redcolumn-smoke-/);
    assert.deepEqual(fs.readdirSync(dir), []);
  }
});

test('the held-lock message names the folder', () => {
  assert.match(lockHeldMessage('C:\\tmp\\ud'), /single-instance lock for C:\\tmp\\ud/);
});
