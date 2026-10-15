import assert from 'node:assert/strict';
import { test } from 'node:test';
import { asText, checkTable, ExcelLinks, LIVE_SCRIPT, writeWorkbook } from './excel.ts';

test('checkTable keeps strings and finite numbers only', () => {
  assert.deepEqual(checkTable([['A', 1], ['b', 2.5]]), [['A', 1], ['b', 2.5]]);
  assert.throws(() => checkTable([['A', null]]));
  assert.throws(() => checkTable([['A', Number.NaN]]));
  assert.throws(() => checkTable('A'));
  assert.throws(() => checkTable([{ 0: 'A' }]));
});

test('asText stops text being read as a formula', () => {
  assert.equal(asText('=HYPERLINK("x")'), `'=HYPERLINK("x")`);
  assert.equal(asText('+1'), `'+1`);
  assert.equal(asText('-cmd'), `'-cmd`);
  assert.equal(asText('@SUM(A1)'), `'@SUM(A1)`);
  assert.equal(asText('Wall'), 'Wall');
  assert.equal(asText(-3), -3);
});

const locked = async () => {
  throw Object.assign(new Error('busy'), { code: 'EBUSY' });
};

test('writeWorkbook replaces the file when it can', async () => {
  const wrote: string[] = [];
  const how = await writeWorkbook('C:/x/Plan.xlsx', new Uint8Array([1]), [['A']], 'Markups', {
    write: async (p: string) => void wrote.push(p),
    run: async () => assert.fail('the file was not locked'),
  });
  assert.equal(how, 'file');
  assert.deepEqual(wrote, ['C:/x/Plan.xlsx']);
});

test('writeWorkbook writes into the open workbook when the file is locked', async () => {
  let input: { path: string; name: string; sheet: string; cols: number; rows: unknown[][] } | null = null;
  const how = await writeWorkbook('C:/x/Plan.xlsx', new Uint8Array([1]), [['Subject', 'Length'], ['=1+1', 2]], 'Markups', {
    write: locked,
    run: async (script: string, json: string) => {
      assert.equal(script, LIVE_SCRIPT);
      input = JSON.parse(json);
      return 'ok';
    },
  });
  assert.equal(how, 'live');
  assert.deepEqual(input, { path: 'C:/x/Plan.xlsx', name: 'Plan.xlsx', sheet: 'Markups', cols: 2, rows: [['Subject', 'Length'], ["'=1+1", 2]] });
});

test('writeWorkbook explains why an open workbook could not be updated', async () => {
  const fail = (answer: string) => writeWorkbook('C:/x/Plan.xlsx', new Uint8Array(), [['A']], 'Markups', { write: locked, run: async () => answer });
  await assert.rejects(fail('busy'), /Excel is busy/);
  await assert.rejects(fail('read-only'), /read-only/);
  await assert.rejects(fail('not-open'), /another program/);
  await assert.rejects(fail('error: boom'), /boom/);
});

test('writeWorkbook passes on failures other than a lock', async () => {
  await assert.rejects(
    writeWorkbook('C:/x/Plan.xlsx', new Uint8Array(), [['A']], 'Markups', {
      write: async () => {
        throw Object.assign(new Error('gone'), { code: 'ENOENT' });
      },
      run: async () => assert.fail('only a lock goes to Excel'),
    }),
    /could not be saved: gone/,
  );
});

test('ExcelLinks hands out IDs, never paths, and drops anything odd it is given', () => {
  const links = new ExcelLinks({ 'xl-0123456789abcdef': 'C:/a.xlsx', bad: 'C:/b.xlsx', 'xl-fedcba9876543210': 'C:/c.exe' });
  assert.equal(links.path('xl-0123456789abcdef'), 'C:/a.xlsx');
  assert.throws(() => links.path('bad'));
  assert.throws(() => links.path('xl-fedcba9876543210'));
  const id = links.add('C:/d.xlsx');
  assert.match(id, /^xl-[0-9a-f]{16}$/);
  assert.equal(links.add('C:/d.xlsx'), id);
  assert.equal(links.path(id), 'C:/d.xlsx');
});
