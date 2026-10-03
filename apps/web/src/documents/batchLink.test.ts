import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PageText, Word } from '@nb/sheets';
import { crossFileLinks } from './batchLink.ts';

function word(text: string, x: number, y: number, size: number): Word {
  return { text, x0: x, y0: y - size, x1: x + text.length * size * 0.6, y1: y, size, angle: 0 };
}

function page(words: Word[], number: string): PageText {
  const notes = Array.from({ length: 30 }, (_, i) => word('NOTE', 200 + (i % 10) * 60, 300 + Math.floor(i / 10) * 20, 8));
  return { width: 2592, height: 1728, words: [...notes, ...words, word('SHEET', 2450, 1650, 7), word(number, 2450, 1700, 28)] };
}

test('references to sheets in other files become cross-file links; same-file ones are left out', () => {
  const arch = { fileId: 'arch', name: 'Arch.pdf', pages: [page([word('SEE', 500, 500, 10), word('S-201', 540, 500, 10), word('A-102', 700, 500, 10)], 'A-101'), page([], 'A-102')], numbers: ['A-101', 'A-102'] };
  const struct = { fileId: 'struct', name: 'Struct.pdf', pages: [page([], 'S-101'), page([word('A-101', 400, 400, 10)], 'S-201')], numbers: ['S-101', 'S-201'] };
  const links = crossFileLinks([arch, struct]);
  assert.deepEqual(
    links.map((l) => [l.fileId, l.pageIndex, l.label, l.target.fileId, l.target.pageIndex, l.target.label, l.target.name]),
    [
      ['arch', 0, 'S-201', 'struct', 1, 'S-201', 'Struct.pdf'],
      ['struct', 1, 'A-101', 'arch', 0, 'A-101', 'Arch.pdf'],
    ],
  );
});
