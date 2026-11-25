import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PathAllowlist } from './allowlist.ts';
import { revealFileByToken } from './reveal.ts';

test('revealFileByToken resolves a registered token for an existing file and reveals it', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'redcolumn-reveal-'));
  const file = path.join(dir, 'A-101.pdf');
  try {
    await fs.writeFile(file, '%PDF-1.4\n');
    const allowlist = new PathAllowlist();
    const token = allowlist.add(file);
    const revealed: string[] = [];
    const ok = await revealFileByToken(allowlist, token, (p) => revealed.push(p));
    assert.equal(ok, true);
    assert.deepEqual(revealed, [path.resolve(file)]);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('revealFileByToken refuses unknown tokens, raw paths, and non-strings', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'redcolumn-reveal-'));
  const file = path.join(dir, 'secret.pdf');
  try {
    await fs.writeFile(file, '%PDF-1.4\n');
    const allowlist = new PathAllowlist();
    const revealed: string[] = [];
    const show = (p: string) => revealed.push(p);

    // Unknown token
    assert.equal(await revealFileByToken(allowlist, '0'.repeat(64), show), false);
    // Raw file path (even though the file exists on disk)
    assert.equal(await revealFileByToken(allowlist, file, show), false);
    // Empty or non-string inputs
    assert.equal(await revealFileByToken(allowlist, '', show), false);
    assert.equal(await revealFileByToken(allowlist, null, show), false);
    assert.equal(await revealFileByToken(allowlist, undefined, show), false);
    assert.equal(await revealFileByToken(allowlist, 123, show), false);
    assert.deepEqual(revealed, []);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('revealFileByToken returns false when the allowlisted file no longer exists', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'redcolumn-reveal-'));
  const file = path.join(dir, 'gone.pdf');
  try {
    const allowlist = new PathAllowlist();
    const token = allowlist.add(file);
    const revealed: string[] = [];
    const ok = await revealFileByToken(allowlist, token, (p) => revealed.push(p));
    assert.equal(ok, false);
    assert.deepEqual(revealed, []);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
