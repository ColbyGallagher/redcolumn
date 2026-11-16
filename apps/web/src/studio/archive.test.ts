import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saveConfirmedArchiveFile } from './archive';

test('closeout waits for the save receipt; cancelled, failed and unsupported saves reject', async () => {
  const blob = new Blob(['record'], { type: 'text/csv' });
  let finish!: (value: FileSystemFileHandle) => void;
  let saved = false;
  const pending = saveConfirmedArchiveFile('record.csv', blob, async () => new Promise((resolve) => { finish = resolve; })).then(() => { saved = true; });
  await Promise.resolve();
  assert.equal(saved, false);
  finish({} as FileSystemFileHandle);
  await pending;
  assert.equal(saved, true);
  await assert.rejects(saveConfirmedArchiveFile('record.csv', blob, async () => null), /cancelled/);
  await assert.rejects(saveConfirmedArchiveFile('record.csv', blob, async () => 'unsupported'), /not been removed/);
  await assert.rejects(saveConfirmedArchiveFile('record.csv', blob, async () => { throw new Error('disk full'); }), /disk full/);
});
