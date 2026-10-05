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

import { GoogleSheetTarget, OneDriveWorkbookTarget } from './targets.ts';

function fakeFetch(calls: { url: string; method: string; body: unknown; auth: string | null }[], respond: (url: string, method: string) => Response) {
  return (async (url: string, init: RequestInit = {}) => {
    calls.push({ url, method: init.method ?? 'GET', body: init.body ? JSON.parse(String(init.body)) : undefined, auth: new Headers(init.headers).get('authorization') });
    return respond(url, init.method ?? 'GET');
  }) as typeof fetch;
}

test('GoogleSheetTarget creates a spreadsheet, formats it and writes the table', async () => {
  const calls: Parameters<typeof fakeFetch>[0] = [];
  const f = fakeFetch(calls, (url) =>
    url.endsWith('/spreadsheets')
      ? Response.json({ spreadsheetId: 'S1', spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/S1', sheets: [{ properties: { sheetId: 7 } }] })
      : Response.json({}),
  );
  const { link } = await GoogleSheetTarget.create('Plan markups', [['A', 'B'], ['x', 2]], async () => 'tok', f);
  assert.deepEqual(link, { provider: 'google', id: 'S1', url: 'https://docs.google.com/spreadsheets/d/S1', title: 'Plan markups' });
  assert.deepEqual(calls.map((c) => c.method), ['POST', 'POST', 'POST', 'PUT']);
  assert.ok(calls.every((c) => c.auth === 'Bearer tok'));
  assert.match(calls[1]!.url, /S1:batchUpdate$/);
  assert.match(calls[2]!.url, /values\/Markups:clear$/);
  assert.match(calls[3]!.url, /values\/Markups!A1\?valueInputOption=RAW$/);
  assert.deepEqual((calls[3]!.body as { values: unknown }).values, [['A', 'B'], ['x', 2]]);
  assert.equal((calls[3]!.body as { range: string }).range, 'Markups!A1:B2');
});

test('GoogleSheetTarget explains a disabled API, an expired sign-in and a deleted sheet', async () => {
  const run = async (status: number, message: string) => {
    const t = new GoogleSheetTarget('S1', async () => 'tok', fakeFetch([], () => Response.json({ error: { message } }, { status })));
    return t.push([['A']]).then(
      () => null,
      (e: Error) => e,
    );
  };
  assert.match((await run(403, 'Google Sheets API has not been used in project 1'))!.message, /Turn on the Google Sheets API/);
  assert.equal((await run(401, ''))!.constructor.name, 'DriveAuthError');
  assert.equal((await run(404, 'Requested entity was not found.'))!.constructor.name, 'DriveForbiddenError');
});

test('OneDriveWorkbookTarget saves an .xlsx over the same file each time', async () => {
  const saved: { name: string; size: number; type: string }[] = [];
  const drive = {
    writeAppBinary: async (name: string, body: Blob, type: string) => {
      saved.push({ name, size: body.size, type });
      return { id: 'I1', url: 'https://1drv.ms/x/abc' };
    },
  };
  const { link, target } = await OneDriveWorkbookTarget.create('Plan: markups', [['A'], ['x']], drive);
  assert.deepEqual(link, { provider: 'onedrive', id: 'Plan  markups.xlsx', url: 'https://1drv.ms/x/abc', title: 'Plan: markups' });
  await target.push([['A'], ['x'], ['y']]);
  assert.equal(saved.length, 2);
  assert.ok(saved.every((s) => s.name === 'Plan  markups.xlsx' && s.type.includes('spreadsheetml')));
  assert.ok(saved[1]!.size > saved[0]!.size);
});
