import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deflateRawSync } from 'node:zlib';
import { asText, checkTable, ExcelLinks, LIVE_SCRIPT, sheetNames, writeWorkbook } from './excel.ts';

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
const missing = async (): Promise<Uint8Array> => {
  throw Object.assign(new Error('missing'), { code: 'ENOENT' });
};

/** A zip holding only xl/workbook.xml, stored or deflated: all sheetNames reads. */
function workbookZip(sheets: string[], deflate = false): Uint8Array {
  const name = Buffer.from('xl/workbook.xml');
  const xml = Buffer.from(`<workbook xmlns="x"><sheets>${sheets.map((s, i) => `<sheet name="${s.replace(/&/g, '&amp;')}" sheetId="${i + 1}"/>`).join('')}</sheets></workbook>`);
  const data = deflate ? deflateRawSync(xml) : xml;
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(deflate ? 8 : 0, 8);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(xml.length, 22);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(deflate ? 8 : 0, 10);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(xml.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(0, 42);
  const centralAt = local.length + name.length + data.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12);
  end.writeUInt32LE(centralAt, 16);
  return new Uint8Array(Buffer.concat([local, name, data, central, name, end]));
}

test('sheetNames reads the sheets of an .xlsx', () => {
  assert.deepEqual(sheetNames(workbookZip(['Markups'])), ['Markups']);
  assert.deepEqual(sheetNames(workbookZip(['Markups', 'Totals & notes'], true)), ['Markups', 'Totals & notes']);
  assert.equal(sheetNames(new Uint8Array([1, 2, 3])), null);
});

const never = async () => assert.fail('not expected');

test('writeWorkbook replaces a new workbook, or one holding only its sheet', async () => {
  for (const read of [missing, async () => workbookZip(['Markups'])]) {
    const wrote: string[] = [];
    const how = await writeWorkbook('C:/x/Plan.xlsx', new Uint8Array([1]), [['A']], 'Markups', { read, write: async (p) => void wrote.push(p), run: never });
    assert.equal(how, 'file');
    assert.deepEqual(wrote, ['C:/x/Plan.xlsx']);
  }
});

test('writeWorkbook writes into the open workbook when the file is locked', async () => {
  let input: Record<string, unknown> | null = null;
  const how = await writeWorkbook('C:/x/Plan.xlsx', new Uint8Array([1]), [['Subject', 'Length'], ['=1+1', 2]], 'Markups', {
    read: async () => workbookZip(['Markups']),
    write: locked,
    run: async (script, json) => {
      assert.equal(script, LIVE_SCRIPT);
      input = JSON.parse(json);
      return 'ok';
    },
  });
  assert.equal(how, 'live');
  assert.deepEqual(input, { path: 'C:/x/Plan.xlsx', name: 'Plan.xlsx', sheet: 'Markups', cols: 2, openIfClosed: false, rows: [['Subject', 'Length'], ["'=1+1", 2]] });
});

test('writeWorkbook never replaces a workbook the person added sheets to', async () => {
  for (const read of [async () => workbookZip(['Markups', 'Totals']), async () => new Uint8Array([9, 9]), locked]) {
    let input: Record<string, unknown> | null = null;
    const how = await writeWorkbook('C:/x/Plan.xlsx', new Uint8Array([1]), [['A']], 'Markups', {
      read,
      write: async () => assert.fail('the file must not be replaced'),
      run: async (_script, json) => {
        input = JSON.parse(json);
        return 'ok';
      },
    });
    assert.equal(how, 'live');
    assert.equal(input!.openIfClosed, true);
  }
});

test('writeWorkbook explains why the workbook could not be updated', async () => {
  const fail = (answer: string) => writeWorkbook('C:/x/Plan.xlsx', new Uint8Array(), [['A']], 'Markups', { read: missing, write: locked, run: async () => answer });
  await assert.rejects(fail('busy'), /Excel is busy/);
  await assert.rejects(fail('read-only'), /read-only/);
  await assert.rejects(fail('not-open'), /another program/);
  await assert.rejects(fail('error: boom'), /boom/);
});

test('writeWorkbook passes on failures other than a lock', async () => {
  await assert.rejects(
    writeWorkbook('C:/x/Plan.xlsx', new Uint8Array(), [['A']], 'Markups', {
      read: missing,
      write: async () => {
        throw Object.assign(new Error('gone'), { code: 'ENOENT' });
      },
      run: never,
    }),
    /could not be saved: gone/,
  );
});

test('the script only matches a workbook by name when it is a OneDrive one', () => {
  assert.match(LIVE_SCRIPT, /FullName -match '\^https\?:\/\/' -and/);
  assert.doesNotMatch(LIVE_SCRIPT, /\| ConvertFrom-Json/);
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
