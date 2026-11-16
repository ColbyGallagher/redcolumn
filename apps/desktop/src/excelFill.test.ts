import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { FILL_SCRIPT, checkFill, fillWorkbook, type FillDeps, type FillRequest } from './excel.ts';

// Filling a copy of a client's register file. Excel itself is not run here: scripts/sheetsync-fill-check.mjs
// checks the script against a real Excel.

const request = (): FillRequest => ({
  sheet: 'Review Comments',
  headerRow: 7,
  firstRow: 8,
  count: 2,
  columns: [
    { col: 2, cells: [1, 2] },
    { col: 4, cells: ['1/2 way along the kerb', '=SUM(A1)'] },
  ],
  key: { col: 11, label: 'redcolumn key', cells: ['m1', 'm2'] },
  firstCol: 2,
  below: 10,
  cells: [{ row: 3, col: 3, value: 'KR-C-101' }],
  hidden: { name: '_redcolumn', table: [['redcolumn-sync', 1, 'doc-1'], ['m1', 1, 'Open']] },
  validations: [{ col: 7, type: 'list', formula: "='_redcolumn'!$M$4:$M$8" }, { col: 8, type: 'date' }],
  dates: [8],
});

test('checkFill keeps a fill request and refuses anything that is not positions and plain values', () => {
  assert.deepEqual(checkFill(JSON.parse(JSON.stringify(request()))), request());
  assert.equal(checkFill({ ...request(), below: 0 }).below, 0);
  const bad = (patch: object, why: string) => assert.throws(() => checkFill({ ...request(), ...patch }), /cannot be written/, why);
  bad({ sheet: 'a/b' }, 'a sheet name Excel would not take');
  bad({ firstRow: 7 }, 'rows on the header');
  bad({ count: 3 }, 'columns shorter than the row count');
  bad({ key: { col: 11, label: 'k', cells: ['m1'] } }, 'keys shorter than the row count');
  bad({ columns: [{ col: 0, cells: [1, 2] }] }, 'no such column');
  bad({ columns: [{ col: 2, cells: [1, { formula: '=A1' }] }] }, 'a cell that is not text or a number');
  bad({ cells: [{ row: 7, col: 1, value: 'x' }] }, 'a detail on or below the header');
  bad({ below: 5 }, 'rows under the table that are above it');
  bad({ hidden: { name: 'Review Comments', table: [] } }, 'the hidden sheet in place of the register');
  // A list's formula is a range on a sheet of the workbook, never anything Excel would run or fetch.
  for (const formula of ["=cmd|'/c calc'!A1", "='[other.xlsx]Sheet1'!$A$1:$A$2", '=HYPERLINK("http://x")']) bad({ validations: [{ col: 7, type: 'list', formula }] }, formula);
  assert.throws(() => checkFill(null), /cannot be written/);
});

test('fillWorkbook copies the client’s file, has Excel fill the copy, and marks every text cell as text', async () => {
  const calls: string[] = [];
  let input: Record<string, unknown> = {};
  const deps: FillDeps = {
    copy: async (from, to) => void calls.push(`copy ${path.basename(from)} > ${path.basename(to)}`),
    remove: async (p) => void calls.push(`remove ${path.basename(p)}`),
    run: async (script, text) => {
      assert.equal(script, FILL_SCRIPT);
      input = JSON.parse(text) as Record<string, unknown>;
      return 'ok';
    },
  };
  await fillWorkbook('C:\\client\\blank.xlsx', 'C:\\out\\filled.xlsx', request(), deps);
  assert.deepEqual(calls, ['copy blank.xlsx > filled.xlsx']);
  assert.equal(input.path, 'C:\\out\\filled.xlsx');
  assert.deepEqual(input.columns, [
    { col: 2, cells: [1, 2] },
    { col: 4, cells: ["'1/2 way along the kerb", "'=SUM(A1)"] },
  ]);
  assert.deepEqual(input.key, { col: 11, label: 'redcolumn key', cells: ["'m1", "'m2"] });
  assert.deepEqual(input.cells, [{ row: 3, col: 3, value: "'KR-C-101" }]);
  assert.deepEqual(input.hidden, { name: '_redcolumn', cols: 3, rows: [["'redcolumn-sync", 1, "'doc-1"], ["'m1", 1, "'Open"]] });
  assert.deepEqual([input.firstCol, input.below], [2, 10]);
});

test('fillWorkbook never writes the client’s file, and leaves no copy that Excel could not fill', async () => {
  const removed: string[] = [];
  const deps = (answer: string | Error): FillDeps => ({
    copy: async () => undefined,
    remove: async (p) => void removed.push(path.basename(p)),
    run: async () => {
      if (answer instanceof Error) throw answer;
      return answer;
    },
  });
  const never: FillDeps = { copy: async () => assert.fail('not expected'), remove: async () => assert.fail('not expected'), run: async () => assert.fail('not expected') };
  await assert.rejects(fillWorkbook('C:\\client\\Blank.xlsx', 'c:\\client\\blank.xlsx', request(), never), /under another name/);

  await assert.rejects(fillWorkbook('C:\\client\\blank.xlsx', 'C:\\out\\a.xlsx', request(), deps('no-excel')), /needs Excel/);
  await assert.rejects(fillWorkbook('C:\\client\\blank.xlsx', 'C:\\out\\b.xlsx', request(), deps('protected')), /blank\.xlsx is protected/);
  await assert.rejects(fillWorkbook('C:\\client\\blank.xlsx', 'C:\\out\\c.xlsx', request(), deps('error: Insert method of Range class failed')), /could not fill in blank\.xlsx: Insert method/);
  await assert.rejects(fillWorkbook('C:\\client\\blank.xlsx', 'C:\\out\\d.xlsx', request(), deps(new Error('Excel did not answer in time.'))), /did not answer/);
  assert.deepEqual(removed, ['a.xlsx', 'b.xlsx', 'c.xlsx', 'd.xlsx']);
});

test('the fill script opens the file with macros, events and link updates off', () => {
  assert.match(FILL_SCRIPT, /\$xl\.AutomationSecurity = 3/);
  assert.match(FILL_SCRIPT, /\$xl\.EnableEvents = \$false/);
  assert.match(FILL_SCRIPT, /Workbooks\.Open\(\$in\['path'\], 0, \$false\)/);
});
