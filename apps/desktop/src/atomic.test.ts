import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { saveError, writeAtomic } from './atomic.ts';

test('an atomic write replaces the file and leaves no temp file', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'redcolumn-atomic-'));
  const file = path.join(dir, 'A-101.pdf');
  await fs.writeFile(file, 'old');
  await writeAtomic(file, new TextEncoder().encode('new'));
  assert.equal(await fs.readFile(file, 'utf8'), 'new');
  assert.deepEqual(await fs.readdir(dir), ['A-101.pdf']);
  await fs.rm(dir, { recursive: true });
});

test('a failed write leaves the original alone', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'redcolumn-atomic-'));
  const file = path.join(dir, 'missing-folder', 'A-101.pdf');
  await assert.rejects(writeAtomic(file, 'x'));
  assert.deepEqual(await fs.readdir(dir), []);
  await fs.rm(dir, { recursive: true });
});

test('a locked file gets a message a person can act on', () => {
  const err = Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' });
  assert.match(saveError(err, 'C:\\jobs\\A-101.pdf').message, /A-101\.pdf could not be saved\. It may be open in another program/);
});
