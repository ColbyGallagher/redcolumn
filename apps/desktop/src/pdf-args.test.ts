import assert from 'node:assert/strict';
import test from 'node:test';
import { pdfArguments } from './pdf-args.ts';

test('pdf arguments keep existing pdf paths', () => {
  const found = pdfArguments(['electron', '--spike', 'C:\\Drawings\\A-101.pdf', 'missing.pdf', 'notes.txt'], (p) => p.endsWith('A-101.pdf'));
  assert.deepEqual(found, ['C:\\Drawings\\A-101.pdf']);
});
