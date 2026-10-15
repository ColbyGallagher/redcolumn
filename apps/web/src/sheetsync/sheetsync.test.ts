import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildXlsx, columnName, sheetName, zipStore } from './xlsx.ts';
import { toTable } from './table.ts';

test('columnName counts like a spreadsheet', () => {
  assert.equal(columnName(0), 'A');
  assert.equal(columnName(25), 'Z');
  assert.equal(columnName(26), 'AA');
  assert.equal(columnName(701), 'ZZ');
  assert.equal(columnName(702), 'AAA');
});

test('sheetName drops characters Excel forbids and caps the length', () => {
  assert.equal(sheetName('A/B:C?'), 'A B C');
  assert.equal(sheetName('x'.repeat(40)).length, 31);
  assert.equal(sheetName('///'), 'Markups');
});

/** Reads the stored entries back out of a zip, checking the CRCs on the way. */
function unzip(zip: Uint8Array): Map<string, string> {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const out = new Map<string, string>();
  let eocd = zip.length - 22;
  assert.equal(view.getUint32(eocd, true), 0x06054b50);
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  for (let i = 0; i < count; i++) {
    assert.equal(view.getUint32(p, true), 0x02014b50);
    const size = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const local = view.getUint32(p + 42, true);
    const name = new TextDecoder().decode(zip.subarray(p + 46, p + 46 + nameLen));
    const dataStart = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    out.set(name, new TextDecoder().decode(zip.subarray(dataStart, dataStart + size)));
    p += 46 + nameLen;
  }
  return out;
}

test('zipStore round-trips files', () => {
  const enc = new TextEncoder();
  const parts = unzip(zipStore([{ name: 'a.txt', data: enc.encode('hello') }, { name: 'dir/b.txt', data: enc.encode('') }]));
  assert.equal(parts.get('a.txt'), 'hello');
  assert.equal(parts.get('dir/b.txt'), '');
});

test('buildXlsx writes numbers as numbers and escapes text', () => {
  const parts = unzip(buildXlsx([['Subject', 'Length'], ['a <b> & "c"\u0001', 12.5], ['', 3]], 'Plan: 1'));
  const sheet = parts.get('xl/worksheets/sheet1.xml')!;
  assert.match(sheet, /<c r="B2"><v>12.5<\/v><\/c>/);
  assert.match(sheet, /a &lt;b&gt; &amp; &quot;c&quot;</);
  assert.ok(!sheet.includes('\u0001'));
  assert.ok(!sheet.includes('r="A3"'), 'blank cells are omitted');
  assert.match(sheet, /<autoFilter ref="A1:B3"\/>/);
  assert.match(parts.get('xl/workbook.xml')!, /name="Plan  1"/);
  for (const name of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/styles.xml', 'xl/_rels/workbook.xml.rels']) assert.ok(parts.has(name), name);
});

test('toTable puts numbers in as numbers and keeps measurement text', () => {
  const cols = [
    { key: 'subject', label: 'Subject', defaultWidth: 1 },
    { key: 'length', label: 'Length', defaultWidth: 1 },
    { key: 'measurement', label: 'Measurement', defaultWidth: 1 },
    { key: 'date', label: 'Date', defaultWidth: 1 },
  ];
  const rows = [
    {
      markup: { modifiedAt: Date.UTC(2026, 0, 2, 3, 4, 5) } as never,
      cells: { subject: { text: 'Wall', num: null }, length: { text: '12.5 m', num: 12.5 }, measurement: { text: '12.5 m', num: 12.5 } },
    },
  ];
  assert.deepEqual(toTable(rows, cols), [['Subject', 'Length', 'Measurement', 'Date'], ['Wall', 12.5, '12.5 m', '2026-01-02 03:04:05']]);
});

import { DriveLockedError } from '../studio/drive/DriveApi.ts';
import { OneDriveWorkbookTarget } from './targets.ts';

test('OneDriveWorkbookTarget saves an .xlsx over the same file each time', async () => {
  const saved: { name: string; size: number; type: string }[] = [];
  const drive = {
    writeAppBinary: async (name: string, body: Blob, type: string) => {
      saved.push({ name, size: body.size, type });
      return { id: 'I1', url: 'https://1drv.ms/x/abc' };
    },
    writeAppWorksheet: async () => assert.fail('the file was not locked'),
  };
  const { link, target } = await OneDriveWorkbookTarget.create('Plan: markups', [['A'], ['x']], drive);
  assert.deepEqual(link, { provider: 'onedrive', id: 'Plan  markups.xlsx', url: 'https://1drv.ms/x/abc', title: 'Plan: markups' });
  await target.push([['A'], ['x'], ['y']]);
  assert.equal(saved.length, 2);
  assert.ok(saved.every((s) => s.name === 'Plan  markups.xlsx' && s.type.includes('spreadsheetml')));
  assert.ok(saved[1]!.size > saved[0]!.size);
});

test('OneDriveWorkbookTarget writes the cells through Excel while the file is locked', async () => {
  const cells: { name: string; sheet: string; table: unknown; address: string }[] = [];
  const drive = {
    writeAppBinary: async () => {
      throw new DriveLockedError('locked');
    },
    writeAppWorksheet: async (name: string, sheet: string, table: readonly (readonly (string | number)[])[], address: (rows: number, cols: number) => string) => {
      cells.push({ name, sheet, table, address: address(30, 28) });
    },
  };
  const target = new OneDriveWorkbookTarget('Plan.xlsx', drive);
  await target.push([['A', 'B'], ['x', 1]]);
  assert.deepEqual(cells, [{ name: 'Plan.xlsx', sheet: 'Markups', table: [['A', 'B'], ['x', 1]], address: 'A1:AB30' }]);
});

test('OneDriveWorkbookTarget passes on failures other than a lock', async () => {
  const drive = {
    writeAppBinary: async () => {
      throw new Error('offline');
    },
    writeAppWorksheet: async () => assert.fail('only a lock falls back'),
  };
  await assert.rejects(new OneDriveWorkbookTarget('Plan.xlsx', drive).push([['A']]), /offline/);
});

test('OneDriveWorkbookTarget says the workbook is open when Excel will not take the cells either', async () => {
  const drive = {
    writeAppBinary: async () => {
      throw new DriveLockedError('locked');
    },
    writeAppWorksheet: async () => {
      throw new Error('not allowed');
    },
  };
  await assert.rejects(new OneDriveWorkbookTarget('Plan.xlsx', drive).push([['A']]), (err: Error) => err instanceof DriveLockedError && /open in Excel/.test(err.message));
});

import { LocalExcelTarget } from './targets.ts';
import { asText } from './table.ts';

test('asText keeps text that looks like a formula as text', () => {
  assert.equal(asText('=SUM(A1)'), "'=SUM(A1)");
  assert.equal(asText('@x'), "'@x");
  assert.equal(asText('Wall'), 'Wall');
  assert.equal(asText(-2), -2);
});

test('LocalExcelTarget sends the .xlsx and the table to the desktop app', async () => {
  const sent: { id: string; size: number; table: unknown }[] = [];
  const excel = {
    pick: async (name: string) => ({ id: 'xl-1', name: `${name}.xlsx` }),
    write: async (id: string, xlsx: Uint8Array, table: (string | number)[][]) => {
      sent.push({ id, size: xlsx.byteLength, table });
      return 'live' as const;
    },
    open: async () => undefined,
    show: async () => undefined,
  };
  const made = await LocalExcelTarget.create('Plan markups', [['A'], ['x']], excel);
  assert.deepEqual(made?.link, { provider: 'excel-local', id: 'xl-1', url: '', title: 'Plan markups.xlsx' });
  await made!.target.push([['A'], ['=1']]);
  assert.equal(sent.length, 2);
  assert.ok(sent.every((s) => s.id === 'xl-1' && s.size > 0));
  assert.deepEqual(sent[1]!.table, [['A'], ['=1']], 'the desktop app makes formula-like text safe itself');
});

test('LocalExcelTarget.create is null when the Save dialog is cancelled', async () => {
  const excel = { pick: async () => null, write: async () => assert.fail('nothing to write'), open: async () => undefined, show: async () => undefined };
  assert.equal(await LocalExcelTarget.create('x', [['A']], excel), null);
});
