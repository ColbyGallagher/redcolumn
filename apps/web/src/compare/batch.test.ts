import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pairAcross, type SheetRef } from './batch.ts';

const sheets = (fileId: string, labels: (string | null)[]): SheetRef[] => labels.map((label, page) => ({ fileId, page, label }));

test('sheets pair across files by sheet number, grouped by file pair', () => {
  const old = [...sheets('oldA', ['A-101', 'A-102']), ...sheets('oldS', ['S-201'])];
  const cur = [...sheets('newAll', ['S201', 'A-102', 'A-103', 'A101'])];
  assert.deepEqual(pairAcross(old, cur, true), [
    { oldId: 'oldS', newId: 'newAll', pairs: [{ oldPage: 0, newPage: 0 }] },
    {
      oldId: 'oldA',
      newId: 'newAll',
      pairs: [
        { oldPage: 1, newPage: 1 },
        { oldPage: 0, newPage: 3 },
      ],
    },
  ]);
});

test('in order when asked; a file on both sides is skipped', () => {
  const old = sheets('a', [null, null]);
  const cur = [...sheets('a', [null]), ...sheets('b', [null])];
  assert.deepEqual(pairAcross(old, cur, false), [{ oldId: 'a', newId: 'b', pairs: [{ oldPage: 1, newPage: 0 }] }]);
});
