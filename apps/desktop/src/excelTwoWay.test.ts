import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LIVE_SCRIPT, READ_SCRIPT, checkLive, forceText, readWorkbookNow, writeWorkbook, type WorkbookDeps } from './excel.ts';

const never = async () => assert.fail('not expected');
const locked = async (): Promise<never> => {
  throw Object.assign(new Error('busy'), { code: 'EBUSY' });
};
const answer = (value: unknown) => Buffer.from(JSON.stringify(value), 'utf8').toString('base64');

test('forceText marks every text cell as text', () => {
  assert.equal(forceText('1/2'), "'1/2");
  assert.equal(forceText('=SUM(A1)'), "'=SUM(A1)");
  assert.equal(forceText(''), '');
  assert.equal(forceText(12), 12);
});

test('checkLive keeps what a two-way write may set and refuses the rest', () => {
  assert.deepEqual(checkLive(undefined), {});
  assert.deepEqual(checkLive({ stamp: 'AB12', hideKey: true, text: true, hidden: ['_redcolumn'], validations: [{ col: 4, type: 'list', formula: "='_redcolumn'!$N$4:$N$7" }, { col: 5, type: 'date' }, { col: 6, type: 'number', formula: 'ignored' }] }), {
    stamp: 'AB12',
    hideKey: true,
    text: true,
    hidden: ['_redcolumn'],
    validations: [{ col: 4, type: 'list', formula: "='_redcolumn'!$N$4:$N$7" }, { col: 5, type: 'date' }, { col: 6, type: 'number' }],
  });
  // A list's formula is a range on a sheet of the workbook, never anything Excel would run or fetch.
  for (const formula of ['=cmd|\'/c calc\'!A1', "='[other.xlsx]Sheet1'!$A$1:$A$2", '=HYPERLINK("http://x")', "='_redcolumn'!$A$1:$A$2+1", 'Open,Closed']) {
    assert.throws(() => checkLive({ validations: [{ col: 1, type: 'list', formula }] }), /cannot be written/, formula);
  }
  assert.throws(() => checkLive({ stamp: 'not hex' }), /cannot be written/);
  assert.throws(() => checkLive({ validations: [{ col: 0, type: 'date' }] }), /cannot be written/);
  assert.throws(() => checkLive({ validations: [{ col: 1, type: 'custom' }] }), /cannot be written/);
  assert.throws(() => checkLive('x'), /cannot be written/);
});

test('readWorkbookNow gives nothing for a workbook that is not there yet', async () => {
  const missing = async (): Promise<never> => {
    throw Object.assign(new Error('gone'), { code: 'ENOENT' });
  };
  assert.deepEqual(await readWorkbookNow('C:/x/Plan.xlsx', ['Markups'], { read: missing, write: never, run: never, locked: never }), { kind: 'none' });
});

test('readWorkbookNow reads the file while the workbook is closed, without starting PowerShell', async () => {
  const bytes = new Uint8Array([1, 2, 3]);
  assert.deepEqual(await readWorkbookNow('C:/x/Plan.xlsx', ['Markups'], { read: async () => bytes, write: never, run: never, locked: async () => false }), { kind: 'file', bytes });
});

test('readWorkbookNow reads the cells from Excel while the workbook is open there', async () => {
  const ran: { script: string; input: { path: string; name: string; sheet: string; sheets: string[] } }[] = [];
  const deps: WorkbookDeps = {
    read: async () => new Uint8Array([1]),
    write: never,
    locked: async () => true,
    run: async (script, input) => {
      ran.push({ script, input: JSON.parse(input) });
      return answer({ stamp: 'ABCDEF', sheets: [{ name: 'Markups', rows: [['ID', 'Status'], [1, 'Open', true, null, { odd: 1 }]] }] });
    },
  };
  const read = await readWorkbookNow('C:/x/Plan.xlsx', ['Markups', '_redcolumn'], deps);
  assert.deepEqual(read, { kind: 'live', stamp: 'ABCDEF', sheets: [{ name: 'Markups', rows: [['ID', 'Status'], [1, 'Open', true, null, null]] }] });
  assert.equal(ran[0]!.script, READ_SCRIPT);
  assert.deepEqual(ran[0]!.input, { path: 'C:/x/Plan.xlsx', name: 'Plan.xlsx', sheet: 'Markups', sheets: ['Markups', '_redcolumn'] });
});

test('readWorkbookNow falls back to the file when another program has it, and explains what Excel says', async () => {
  const bytes = new Uint8Array([7]);
  const base = { write: never, locked: async () => true };
  assert.deepEqual(await readWorkbookNow('C:/x/Plan.xlsx', ['Markups'], { ...base, read: async () => bytes, run: async () => 'not-open' }), { kind: 'file', bytes });
  await assert.rejects(readWorkbookNow('C:/x/Plan.xlsx', ['Markups'], { ...base, read: locked, run: async () => 'not-open' }), /open in another program/);
  await assert.rejects(readWorkbookNow('C:/x/Plan.xlsx', ['Markups'], { ...base, read: async () => bytes, run: async () => 'busy' }), /Excel is busy/);
  await assert.rejects(readWorkbookNow('C:/x/Plan.xlsx', ['Markups'], { ...base, read: async () => bytes, run: async () => 'error: boom' }), /could not read Plan.xlsx: boom/);
});

test('a two-way write sends the stamp, the checks and text cells, and reports a sheet that changed', async () => {
  const inputs: Record<string, unknown>[] = [];
  const deps: WorkbookDeps = {
    read: locked,
    write: never,
    run: async (script, input) => {
      assert.equal(script, LIVE_SCRIPT);
      inputs.push(JSON.parse(input));
      return inputs.length === 1 ? 'changed' : 'ok';
    },
  };
  const live = { stamp: 'AB', hideKey: true, text: true, hidden: ['_redcolumn'], validations: [{ col: 2, type: 'date' as const }] };
  const table = [['redcolumn key', 'Comments'], ['m1', '1/2 way']];
  const extra = [{ name: '_redcolumn', table: [['redcolumn-sync', 1, '12']] }, { name: 'Quantities', table: [['Item'], ['=A1']] }];
  assert.equal(await writeWorkbook('C:/x/Plan.xlsx', new Uint8Array([1]), table, 'Markups', deps, extra, live), 'changed');
  assert.equal(await writeWorkbook('C:/x/Plan.xlsx', new Uint8Array([1]), table, 'Markups', deps, extra, live), 'live');
  const sent = inputs[0]!;
  assert.equal(sent.stamp, 'AB');
  assert.equal(sent.hideKey, true);
  assert.deepEqual(sent.validations, [{ col: 2, type: 'date' }]);
  assert.deepEqual(sent.rows, [["'redcolumn key", "'Comments"], ["'m1", "'1/2 way"]]);
  assert.deepEqual(sent.extra, [
    { sheet: '_redcolumn', cols: 3, rows: [["'redcolumn-sync", 1, "'12"]], hidden: true },
    { sheet: 'Quantities', cols: 1, rows: [['Item'], ["'=A1"]] },
  ]);
});

test('the write script checks the stamp before it writes, and saves nothing when it is stale', () => {
  assert.match(LIVE_SCRIPT, /\$stale = \(\(Get-Stamp \(Read-Grid \$ser \$s\)\) -ne \$in\['stamp'\]\)/);
  assert.match(LIVE_SCRIPT, /if \(\$stale\) \{ \$targets = @\(\); \$result = 'changed' \}/);
  assert.match(LIVE_SCRIPT, /if \(-not \$stale\) \{ \$book\.Save\(\) \}/);
  // Both scripts read the grid the same way, so their stamps agree.
  assert.ok(READ_SCRIPT.includes('function Read-Grid($ser, $ws)') && LIVE_SCRIPT.includes('function Read-Grid($ser, $ws)'));
});
