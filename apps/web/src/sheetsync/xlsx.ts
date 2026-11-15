import type { TableCell } from './table';

/**
 * A small .xlsx writer: one sheet with a bold, frozen header row, an AutoFilter and sized columns.
 * An .xlsx is a zip of XML parts; this stores them uncompressed, which Excel and
 * LibreOffice both open.
 */

const enc = new TextEncoder();

let crcTable: Uint32Array | null = null;
function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = crcTable[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Stored (uncompressed) zip of the given files. */
export function zipStore(files: readonly { name: string; data: Uint8Array }[]): Uint8Array {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  // 1 January 2024, 00:00: a fixed stamp keeps the output the same for the same sheet.
  const dosTime = 0;
  const dosDate = ((2024 - 1980) << 9) | (1 << 5) | 1;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // UTF-8 names
    lv.setUint16(8, 0, true); // stored
    lv.setUint16(10, dosTime, true);
    lv.setUint16(12, dosDate, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, f.data.length, true);
    lv.setUint32(22, f.data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, dosTime, true);
    cv.setUint16(14, dosDate, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, f.data.length, true);
    cv.setUint32(24, f.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    locals.push(local, f.data);
    centrals.push(central);
    offset += local.length + f.data.length;
  }
  const centralSize = centrals.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + centralSize + end.length);
  let p = 0;
  for (const part of [...locals, ...centrals, end]) {
    out.set(part, p);
    p += part.length;
  }
  return out;
}

/** Text safe for XML 1.0: control characters (other than tab and line breaks) are dropped. */
function xml(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Column letters: 0 → A, 26 → AA. */
export function columnName(index: number): string {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Sheet names: at most 31 characters, without : \ / ? * [ ]. */
export function sheetName(name: string): string {
  return name.replace(/[:\\/?*[\]]/g, ' ').trim().slice(0, 31) || 'Markups';
}

/** How a column's numbers show in Excel (the value stays a number). */
export type XlsxNumberFormat = 'qty' | 'money' | 'pct';

/** One sheet of a workbook. */
export interface SheetSpec {
  name: string;
  table: readonly (readonly TableCell[])[];
  /** Number format per column. */
  formats?: readonly (XlsxNumberFormat | undefined)[];
  /** Rows (0-based, header included) drawn in bold: group headings, subtotals and totals. */
  boldRows?: ReadonlySet<number>;
  /** An AutoFilter over the whole table (on by default). */
  filter?: boolean;
}

// Cell styles (cellXfs): 0 normal, 1 bold, 2 number, 3 percent, 4 bold number, 5 bold percent, 6 text that looks like a formula.
const STYLE = { bold: 1, num: 2, pct: 3, boldNum: 4, boldPct: 5, quote: 6 } as const;
/** Text Excel would read as a formula when typed (see `asText` in the desktop app): kept as text with a quote prefix. */
const FORMULA_LIKE = /^[=+\-@\t\r]/;

function sheetXml(spec: SheetSpec): string {
  const table = spec.table;
  const cols = Math.max(1, ...table.map((r) => r.length));
  const widths = Array.from({ length: cols }, (_, c) => {
    const longest = Math.max(4, ...table.slice(0, 200).map((r) => String(r[c] ?? '').split('\n')[0]!.length));
    return Math.min(60, longest + 2);
  });
  const rows = table.map((row, r) => {
    const bold = r === 0 || !!spec.boldRows?.has(r);
    const cells = row
      .map((v, c) => {
        const ref = `${columnName(c)}${r + 1}`;
        if (typeof v === 'number' && Number.isFinite(v)) {
          const f = spec.formats?.[c];
          const s = f === 'pct' ? (bold ? STYLE.boldPct : STYLE.pct) : f ? (bold ? STYLE.boldNum : STYLE.num) : bold ? STYLE.bold : 0;
          return `<c r="${ref}"${s ? ` s="${s}"` : ''}><v>${v}</v></c>`;
        }
        const text = String(v);
        if (text === '') return '';
        const s = bold ? STYLE.bold : FORMULA_LIKE.test(text) ? STYLE.quote : 0;
        return `<c r="${ref}"${s ? ` s="${s}"` : ''} t="inlineStr"><is><t xml:space="preserve">${xml(text)}</t></is></c>`;
      })
      .join('');
    return `<row r="${r + 1}">${cells}</row>`;
  });
  const last = `${columnName(cols - 1)}${Math.max(1, table.length)}`;
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` +
    `<sheetData>${rows.join('')}</sheetData>` +
    (spec.filter === false ? '' : `<autoFilter ref="A1:${last}"/>`) +
    '</worksheet>'
  );
}

const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/** Sheet names made unique (Excel ignores case) by numbering repeats. */
export function uniqueNames(names: readonly string[]): string[] {
  const seen = new Set<string>();
  return names.map((raw) => {
    const base = sheetName(raw);
    let name = base;
    for (let n = 2; seen.has(name.toLowerCase()); n++) name = `${base.slice(0, 31 - String(n).length - 1)} ${n}`;
    seen.add(name.toLowerCase());
    return name;
  });
}

/** The sheets as an .xlsx workbook, one sheet each, in order. */
export function buildWorkbook(sheets: readonly SheetSpec[]): Uint8Array {
  const list: readonly SheetSpec[] = sheets.length ? sheets : [{ name: 'Markups', table: [[]] }];
  const names = uniqueNames(list.map((s) => s.name));
  const parts: [string, string][] = [
    [
      '[Content_Types].xml',
      `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        list.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
    ],
    ['_rels/.rels', `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    [
      'xl/workbook.xml',
      `${HEAD}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${REL}">` +
        `<sheets>${names.map((n, i) => `<sheet name="${xml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`,
    ],
    [
      'xl/_rels/workbook.xml.rels',
      `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        list.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
        `<Relationship Id="rId${list.length + 1}" Type="${REL}/styles" Target="styles.xml"/></Relationships>`,
    ],
    [
      'xl/styles.xml',
      `${HEAD}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
        '<numFmts count="1"><numFmt numFmtId="164" formatCode="0.0&quot;%&quot;"/></numFmts>' +
        '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
        '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
        '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
        '<cellXfs count="7">' +
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
        '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
        '<xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
        '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
        '<xf numFmtId="4" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>' +
        '<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>' +
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" quotePrefix="1"/>' +
        '</cellXfs>' +
        '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>',
    ],
    ...list.map((s, i): [string, string] => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)]),
  ];
  return zipStore(parts.map(([name, text]) => ({ name, data: enc.encode(text) })));
}

/** The table as an .xlsx file with one sheet. */
export function buildXlsx(table: readonly (readonly TableCell[])[], name = 'Markups'): Uint8Array {
  return buildWorkbook([{ name, table }]);
}
