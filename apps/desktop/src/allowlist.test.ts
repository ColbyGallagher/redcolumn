import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { isOpenable, PathAllowlist } from './allowlist.ts';

test('the same path keeps its token', () => {
  const list = new PathAllowlist();
  const file = path.resolve('drawings', 'A-101.pdf');
  assert.equal(list.add(file), list.add(file));
  assert.equal(list.get(list.add(file)), file);
});

test('Windows paths that differ only in case share a token', () => {
  const win = new PathAllowlist('win32');
  assert.equal(win.add(path.resolve('Drawings', 'A-101.pdf')), win.add(path.resolve('drawings', 'a-101.PDF')));
  const posix = new PathAllowlist('linux');
  assert.notEqual(posix.add(path.resolve('Drawings', 'A-101.pdf')), posix.add(path.resolve('drawings', 'a-101.PDF')));
});

test('a removed token stops working and reports the change', () => {
  const list = new PathAllowlist();
  let changes = 0;
  list.onChange = () => changes++;
  const token = list.add(path.resolve('A-101.pdf'));
  assert.equal(list.remove(token), true);
  assert.equal(list.get(token), null);
  assert.equal(list.remove(token), false);
  assert.equal(changes, 2);
});

test('restored entries keep absolute paths and well-formed tokens', () => {
  const list = new PathAllowlist();
  const file = path.resolve('drawings', 'A-101.pdf');
  const token = 'a'.repeat(64);
  list.load({ [token]: file, short: file, ['b'.repeat(64)]: 'relative.pdf' });
  assert.equal(list.get(token), file);
  assert.equal(list.get('b'.repeat(64)), null);
  assert.equal(list.get('short'), null);
});

test('only files the app opens can be registered from a drop', () => {
  assert.equal(isOpenable('C:\\drawings\\A-101.PDF'), true);
  assert.equal(isOpenable('/tmp/photo.jpeg'), true);
  assert.equal(isOpenable('C:\\Windows\\System32\\cmd.exe'), false);
  assert.equal(isOpenable('C:\\Users\\me\\.ssh\\id_rsa'), false);
});
