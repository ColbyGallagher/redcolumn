import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { deflateRawSync } from 'node:zlib';
import { HIDDEN_SHEET, buildWorkbook, excelSerial, fromExcelSerial, listRange, protectionHash, zipStore } from './xlsx.ts';
import { READ_LIMITS, XlsxReadError, findSheet, isDateFormat, readWorkbook, scanXml } from './xlsxRead.ts';

const enc = new TextEncoder();
const dec = new TextDecoder();

/** The parts of a stored zip, by name. */
function parts(zip: Uint8Array): Map<string, string> {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const out = new Map<string, string>();
  const eocd = zip.length - 22;
  let p = view.getUint32(eocd + 16, true);
  for (let i = 0; i < view.getUint16(eocd + 10, true); i++) {
    const size = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const local = view.getUint32(p + 42, true);
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    out.set(dec.decode(zip.subarray(p + 46, p + 46 + nameLen)), dec.decode(zip.subarray(start, start + size)));
    p += 46 + nameLen;
  }
  return out;
}

/** A zip whose entries are deflated, with sizes left to a data descriptor the way Excel writes them. */
function zipDeflate(files: readonly { name: string; text: string }[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const raw = enc.encode(f.text);
    const packed = deflateRawSync(raw);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(6, 0x0808, true);
    lv.setUint16(8, 8, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    const c = new Uint8Array(46 + name.length);
    const cv = new DataView(c.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, 8, true);
    cv.setUint32(20, packed.length, true);
    cv.setUint32(24, raw.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    c.set(name, 46);
    chunks.push(local, packed, new Uint8Array(16));
    central.push(c);
    offset += local.length + packed.length + 16;
  }
  const size = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, size, true);
  ev.setUint32(16, offset, true);
  return Buffer.concat([...chunks, ...central, end]);
}

const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
/** A workbook the way Excel lays one out: shared strings, absolute targets, cells without inline text. */
function excelLike(sheet: string, extra: { shared?: string; styles?: string; workbookPr?: string; core?: string } = {}): Uint8Array {
  return zipDeflate([
    { name: 'xl/workbook.xml', text: `<?xml version="1.0"?><workbook ${NS}>${extra.workbookPr ?? ''}<sheets><sheet name="Register" sheetId="1" r:id="rId3"/></sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', text: '<Relationships><Relationship Id="rId3" Type="x/worksheet" Target="/xl/worksheets/sheet1.xml"/><Relationship Id="rId9" Type="x/externalLink" Target="file:///c:/other.xlsx" TargetMode="External"/></Relationships>' },
    { name: 'xl/worksheets/sheet1.xml', text: `<?xml version="1.0"?><worksheet ${NS}><sheetData>${sheet}</sheetData></worksheet>` },
    ...(extra.shared ? [{ name: 'xl/sharedStrings.xml', text: `<sst ${NS}>${extra.shared}</sst>` }] : []),
    ...(extra.styles ? [{ name: 'xl/styles.xml', text: `<styleSheet ${NS}>${extra.styles}</styleSheet>` }] : []),
    ...(extra.core ? [{ name: 'docProps/core.xml', text: extra.core }] : []),
  ]);
}

test('a built workbook reads back with the same values', async () => {
  const table = [
    ['Item No', 'Comment', 'Length', 'Raised'],
    ['KR-001', 'Kerb line <clashes> & "pit" lid\nsee detail', 12.5, excelSerial(Date.UTC(2026, 10, 3))],
    ['KR-002', '=SUM(A1)', 0, ''],
    ['', '', '', ''],
    ['KR-004', ' padded ', -3, excelSerial(Date.UTC(2026, 10, 4, 6))],
  ];
  const book = await readWorkbook(buildWorkbook([{ name: 'Markups', table, formats: [undefined, undefined, 'qty', 'date'] }]));
  assert.equal(book.sheets.length, 1);
  const sheet = book.sheets[0]!;
  assert.equal(sheet.name, 'Markups');
  assert.equal(sheet.state, 'visible');
  assert.deepEqual(sheet.rows, [table[0], table[1], ['KR-002', '=SUM(A1)', 0], [], ['KR-004', ' padded ', -3, table[4]![3]]]);
  assert.deepEqual([...sheet.dates].sort(), ['1,3', '4,3']);
  assert.equal(fromExcelSerial(sheet.rows[1]![3] as number), Date.UTC(2026, 10, 3));
  assert.equal(book.date1904, false);
});

test('a table that starts below the first row keeps the block above it', async () => {
  const bytes = buildWorkbook([
    {
      name: 'Register',
      origin: { row: 4, col: 1 },
      table: [['Item No', 'Status'], ['KR-001', 'Open'], ['KR-002', '']],
      cells: [
        { row: 0, col: 1, value: 'Kestrel Road upgrade', bold: true },
        { row: 1, col: 3, value: 'Rev C' },
        { row: 5, col: 1, value: 'inside the table: dropped' },
        { row: 8, col: 1, value: 'Signed' },
      ],
    },
  ]);
  const xml = parts(bytes).get('xl/worksheets/sheet1.xml')!;
  assert.match(xml, /<pane ySplit="5" topLeftCell="A6"/);
  assert.match(xml, /<autoFilter ref="B5:C7"\/>/);
  assert.match(xml, /<col min="2" max="2"/);
  const rows = (await readWorkbook(bytes)).sheets[0]!.rows;
  assert.deepEqual(rows[0], [null, 'Kestrel Road upgrade']);
  assert.deepEqual(rows[1], [null, null, null, 'Rev C']);
  assert.deepEqual(rows[4], [null, 'Item No', 'Status']);
  assert.deepEqual(rows[5], [null, 'KR-001', 'Open']);
  assert.deepEqual(rows[8], [null, 'Signed']);
});

test('protection locks everything but the data cells of the unlocked columns', () => {
  const bytes = buildWorkbook([
    {
      name: 'Register',
      table: [['Key', 'Comment', 'Response', 'Closed on'], ['m1', 'Kerb', '', ''], ['m2', 'Pit', 'Moved', '']],
      formats: [undefined, undefined, undefined, 'date'],
      hiddenColumns: new Set([0]),
      wrap: new Set([1, 2]),
      protection: { password: 'kestrel', unlocked: new Set([2, 3]) },
    },
  ]);
  const p = parts(bytes);
  const sheet = p.get('xl/worksheets/sheet1.xml')!;
  const styles = p.get('xl/styles.xml')!;
  const xfs = [...styles.match(/<cellXfs[^>]*>(.*)<\/cellXfs>/)![1]!.matchAll(/<xf [^>]*?(?:\/>|>.*?<\/xf>)/g)].map((m) => m[0]);
  const styleOf = (ref: string) => xfs[Number(sheet.match(new RegExp(`<c r="${ref}"(?: s="(\\d+)")?`))![1] ?? 0)]!;
  assert.match(sheet, new RegExp(`<sheetProtection password="${protectionHash('kestrel')}" sheet="1"[^>]* autoFilter="0"/>`));
  assert.match(sheet, /<col min="1" max="1" width="\d+" hidden="1"/);
  assert.ok(!styleOf('B2').includes('locked="0"'), 'the comment stays locked');
  assert.match(styleOf('B2'), /wrapText="1"/);
  assert.match(styleOf('C2'), /locked="0"/, 'a blank response cell is still written, unlocked');
  assert.match(styleOf('C3'), /locked="0"/);
  assert.match(styleOf('D2'), /numFmtId="165".*locked="0"/, 'a blank date cell carries the date format');
  assert.ok(!styleOf('C1').includes('locked="0"'), 'the header stays locked');
  assert.ok(sheet.indexOf('<sheetProtection') > sheet.indexOf('</sheetData>') && sheet.indexOf('<sheetProtection') < sheet.indexOf('<autoFilter'));
  assert.equal(Number(styles.match(/<cellXfs count="(\d+)"/)![1]), xfs.length);
});

test('the legacy protection hash matches Excel', () => {
  // Values Excel writes for these passwords.
  assert.equal(protectionHash('test'), 'CBEB');
  assert.equal(protectionHash('password'), '83AF');
});

test('validation points at lists on the very hidden sheet', async () => {
  const bytes = buildWorkbook([
    {
      name: 'Register',
      origin: { row: 2, col: 0 },
      table: [['Item No', 'Status', 'Due', 'Cost'], ['KR-001', 'Open', '', ''], ['KR-002', '', '', '']],
      validations: [
        { column: 1, kind: 'list', source: listRange(HIDDEN_SHEET, 0, 1, 3), message: 'Choose Open, Closed or "Agreed"' },
        { column: 2, kind: 'date' },
        { column: 3, kind: 'number' },
        { column: 9, kind: 'number' },
      ],
    },
    { name: HIDDEN_SHEET, state: 'veryHidden', filter: false, table: [['status'], ['Open'], ['Closed'], ['Agreed']] },
  ]);
  const p = parts(bytes);
  const sheet = p.get('xl/worksheets/sheet1.xml')!;
  assert.match(sheet, /<dataValidations count="3">/);
  assert.match(sheet, /<dataValidation type="list" allowBlank="1" showErrorMessage="1" errorTitle="[^"]+" error="Choose Open, Closed or &quot;Agreed&quot;" sqref="B4:B5"><formula1>'_redcolumn'!\$A\$2:\$A\$4<\/formula1>/);
  assert.match(sheet, /<dataValidation type="date"[^>]* sqref="C4:C5">/);
  assert.match(sheet, /<dataValidation type="decimal"[^>]* sqref="D4:D5">/);
  assert.ok(sheet.indexOf('<dataValidations') > sheet.indexOf('<autoFilter'));
  assert.match(p.get('xl/workbook.xml')!, /<sheet name="_redcolumn" sheetId="2" state="veryHidden" r:id="rId2"\/>/);
  const book = await readWorkbook(bytes);
  assert.equal(findSheet(book, '_REDCOLUMN')!.state, 'veryHidden');
  assert.deepEqual(findSheet(book, HIDDEN_SHEET)!.rows.flat(), ['status', 'Open', 'Closed', 'Agreed']);
});

test('validation is left out of a table with no rows', () => {
  const sheet = parts(buildWorkbook([{ name: 'R', table: [['Status']], validations: [{ column: 0, kind: 'number' }] }])).get('xl/worksheets/sheet1.xml')!;
  assert.ok(!sheet.includes('dataValidation'));
});

test('reads deflated parts, shared strings, rich text and typed cells', async () => {
  const bytes = excelLike(
    '<row r="2"><c r="B2" t="s"><v>0</v></c><c r="C2" t="s"><v>1</v></c><c r="D2" s="1"><v>46329</v></c><c r="E2"><v>1.5E2</v></c></row>' +
      '<row r="3"><c r="A3" t="b"><v>1</v></c><c r="B3" t="str"><f>A1&amp;"x"</f><v>joined</v></c><c r="C3" t="e"><v>#N/A</v></c><c r="D3" s="1"/><c r="E3" t="inlineStr"><is><r><t>in</t></r><r><t xml:space="preserve"> line</t></r></is></c></row>' +
      '<row><c><v>7</v></c><c t="s"><v>2</v></c></row>',
    {
      shared: '<si><t>Kerb &amp; channel</t></si><si><r><rPr><b/></rPr><t>Bold</t></r><r><t xml:space="preserve"> then plain</t></r><rPh><t>ignored</t></rPh></si><si><t>line one_x000D_\nline two</t></si>',
      styles: '<numFmts count="1"><numFmt numFmtId="170" formatCode="dd/mm/yyyy"/></numFmts><cellStyleXfs><xf numFmtId="170"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="170"/></cellXfs>',
      core: '<cp:coreProperties xmlns:cp="x" xmlns:dc="y"><dc:creator>A</dc:creator><cp:lastModifiedBy>Priya Designer</cp:lastModifiedBy></cp:coreProperties>',
    },
  );
  const book = await readWorkbook(bytes);
  const sheet = book.sheets[0]!;
  assert.deepEqual(sheet.rows, [
    [],
    [null, 'Kerb & channel', 'Bold then plain', 46329, 150],
    [true, 'joined', '#N/A', null, 'in line'],
    [7, 'line one\nline two'],
  ]);
  assert.deepEqual([...sheet.dates], ['1,3']);
  assert.equal(book.lastModifiedBy, 'Priya Designer');
});

test('reads the 1904 date system flag', async () => {
  const book = await readWorkbook(excelLike('<row r="1"><c r="A1"><v>1</v></c></row>', { workbookPr: '<workbookPr date1904="1"/>' }));
  assert.equal(book.date1904, true);
  assert.equal(fromExcelSerial(0, true), Date.UTC(1904, 0, 1));
});

test('isDateFormat tells dates from numbers', () => {
  for (const code of ['yyyy\\-mm\\-dd', 'd/m/yy h:mm', '[$-409]mmm\\ yy', 'hh:mm:ss', '[h]:mm']) assert.ok(isDateFormat(code), code);
  for (const code of ['0.00', '#,##0', '0.0"%"', 'General', '0.00E+00', '"days" 0', '[Red]0', '0\\d']) assert.ok(!isDateFormat(code), code);
});

test('scanXml copes with quoted > and prefixes', () => {
  const seen: string[] = [];
  scanXml('<?xml version="1.0"?><!-- c --><x:a k="1 > 0" r:id=\'q\'><b/>t&#65;&#x42;&amp;<![CDATA[<raw>]]></x:a>', {
    open: (n, a) => seen.push(`+${n}${JSON.stringify(a)}`),
    close: (n) => seen.push(`-${n}`),
    text: (t) => seen.push(t),
  });
  assert.deepEqual(seen, ['+a{"k":"1 > 0","r:id":"q"}', '+b{}', '-b', 'tAB&', '<raw>', '-a']);
});

test('refuses what is not a workbook', async () => {
  const fails = (bytes: Uint8Array, message: RegExp) => assert.rejects(readWorkbook(bytes), (err: Error) => err instanceof XlsxReadError && message.test(err.message));
  await fails(enc.encode('Item No,Status\nKR-001,Open'), /not an Excel workbook/);
  await fails(new Uint8Array(0), /not an Excel workbook/);
  await fails(zipStore([{ name: 'word/document.xml', data: enc.encode('<w/>') }]), /not an Excel workbook/);
  await fails(Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]), /password-protected or in the old/);
  await fails(excelLike('<!DOCTYPE x [<!ENTITY a "aaaa">]><row r="1"><c r="A1"><v>1</v></c></row>'), /not an Excel workbook/);
});

test('size limits stop a workbook that is too large', async () => {
  const tooBig = (bytes: Uint8Array, limits: Partial<typeof READ_LIMITS>) => assert.rejects(readWorkbook(bytes, { ...READ_LIMITS, ...limits }), (err: Error) => err instanceof XlsxReadError && /too large/.test(err.message));
  const small = buildWorkbook([{ name: 'A', table: [['x', 'y'], [1, 2], [3, 4]] }, { name: 'B', table: [['z']] }]);
  await tooBig(small, { maxBytes: 100 });
  await tooBig(small, { maxSheets: 1 });
  await tooBig(small, { maxRows: 2 });
  await tooBig(small, { maxCols: 1 });
  await tooBig(small, { maxCells: 6 });
  await tooBig(small, { maxPartBytes: 50 });
  await tooBig(small, { maxTotalBytes: 600 });
  assert.equal((await readWorkbook(small, { ...READ_LIMITS, maxRows: 3, maxCols: 2, maxCells: 7, maxSheets: 2 })).sheets.length, 2);
  // A formatted but empty cell far down the sheet is not a row of data.
  const stray = excelLike('<row r="1"><c r="A1"><v>1</v></c></row><row r="1048576"><c r="XFD1048576" s="1"/></row>');
  assert.equal((await readWorkbook(stray)).sheets[0]!.rows.length, 1);
});

test('a deflated part that unpacks past the limit is stopped, whatever size it declares', async () => {
  const bomb = excelLike(`<row r="1"><c r="A1" t="inlineStr"><is><t>${'a'.repeat(4_000_000)}</t></is></c></row>`);
  assert.ok(bomb.length < 20_000, 'packs small');
  // Declare a small size in the central directory, as a crafted file would.
  const view = new DataView(bomb.buffer, bomb.byteOffset, bomb.byteLength);
  let p = view.getUint32(bomb.length - 22 + 16, true);
  for (let i = 0; i < 3; i++) {
    view.setUint32(p + 24, 10, true);
    p += 46 + view.getUint16(p + 28, true);
  }
  await assert.rejects(readWorkbook(bomb, { ...READ_LIMITS, maxPartBytes: 1_000_000 }), /too large/);
});

for (const [file, app] of [
  ['excel.xlsx', 'Excel'],
  ['libreoffice.xlsx', 'LibreOffice'],
] as const) {
  test(`reads a register saved by ${app}`, async (t) => {
    let bytes: Uint8Array;
    try {
      bytes = readFileSync(new URL(`./fixtures/${file}`, import.meta.url));
    } catch {
      return t.skip(`fixtures/${file} has not been made yet`);
    }
    const book = await readWorkbook(bytes);
    const register = findSheet(book, 'Register')!;
    const hidden = findSheet(book, HIDDEN_SHEET)!;
    assert.equal(hidden.state, 'veryHidden');
    assert.deepEqual(hidden.rows.slice(0, 4).map((r) => r[0]), ['status', 'Open', 'Closed', 'Agreed']);
    assert.deepEqual(register.rows[0], [null, 'Kestrel Road upgrade']);
    assert.deepEqual(register.rows[2], ['Key', 'Item No', 'Comment', 'Status', 'Response', 'Due']);
    assert.deepEqual(register.rows[3]!.slice(0, 5), ['m-001', 'KR-001', 'Kerb line clashes with pit lid\nsee detail 4', 'Closed', 'Pit moved 300 east']);
    assert.deepEqual(register.rows[4]!.slice(0, 4), ['m-002', 'KR-002', '=not a formula', 'Open']);
    assert.ok(register.dates.has('3,5'), 'the due date typed in the app is a date');
    assert.equal(fromExcelSerial(register.rows[3]![5] as number, book.date1904), Date.UTC(2026, 10, 20));
  });
}
