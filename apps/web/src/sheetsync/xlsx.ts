import type { TableCell } from './table';

/**
 * A small .xlsx writer: sheets with a bold, frozen header row, an AutoFilter and sized columns, and
 * optionally protection, hidden columns and sheets, data validation and a table that starts below
 * the first row. An .xlsx is a zip of XML parts; this stores them uncompressed, which Excel and
 * LibreOffice both open. `xlsxRead.ts` reads one back.
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

/** How a column's numbers show in Excel (the value stays a number). Dates are Excel serial numbers (see `excelSerial`). */
export type XlsxNumberFormat = 'qty' | 'money' | 'pct' | 'date' | 'datetime';

/** Whether a sheet shows as a tab. A very hidden sheet is not offered by Excel's Unhide either. */
export type SheetState = 'visible' | 'hidden' | 'veryHidden';

/** The sheet that carries row keys, exported values and validation lists. */
export const HIDDEN_SHEET = '_redcolumn';

/** Sheet protection: every cell is locked except the data cells of the unlocked columns. Filtering stays allowed. */
export interface SheetProtection {
  /** Optional, ASCII. Excel's sheet protection guards against accidents; it is not security. */
  password?: string;
  /** Table columns (0-based) people may type in. */
  unlocked: ReadonlySet<number>;
}

/** What Excel accepts in a table column's data cells. */
export type SheetValidation = {
  /** Table column (0-based). */
  column: number;
  /** Shown when another value is typed. */
  message?: string;
} & ({ kind: 'list'; /** A range holding the allowed values, see `listRange`. */ source: string } | { kind: 'date' } | { kind: 'number' });

/** A cell outside the table, such as a project name in the block above a register. */
export interface LooseCell {
  row: number;
  col: number;
  value: TableCell;
  bold?: boolean;
}

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
  /** Where the header row's first cell goes (0-based). The top-left cell when left out. */
  origin?: { row: number; col: number };
  /** Cells outside the table. A cell that lands inside the table is dropped. */
  cells?: readonly LooseCell[];
  /** Visible when left out. The first sheet of a workbook must be visible. */
  state?: SheetState;
  /** Table columns (0-based) that are hidden. */
  hiddenColumns?: ReadonlySet<number>;
  /** Table columns (0-based) whose text wraps. */
  wrap?: ReadonlySet<number>;
  /** Column widths in characters; measured from the cells when left out. */
  widths?: readonly (number | undefined)[];
  protection?: SheetProtection;
  validations?: readonly SheetValidation[];
}

/** An Excel serial date for a time in milliseconds (UTC), in the 1900 date system. */
export function excelSerial(ms: number): number {
  return ms / 86_400_000 + 25_569;
}

/** The time in milliseconds (UTC) of an Excel serial date. */
export function fromExcelSerial(serial: number, date1904 = false): number {
  return Math.round((serial - 25_569 + (date1904 ? 1462 : 0)) * 86_400_000);
}

/** An absolute range down one column of a sheet, for a list validation: `'_redcolumn'!$A$2:$A$5`. */
export function listRange(sheet: string, col: number, firstRow: number, count: number): string {
  const c = columnName(col);
  return `'${sheet.replace(/'/g, "''")}'!$${c}$${firstRow + 1}:$${c}$${firstRow + Math.max(1, count)}`;
}

/** Excel's legacy sheet-protection hash of a password (four hex digits). */
export function protectionHash(password: string): string {
  let hash = 0;
  for (let i = password.length - 1; i >= 0; i--) {
    hash = ((hash >> 14) & 1) | ((hash << 1) & 0x7fff);
    hash ^= password.charCodeAt(i) & 0xff;
  }
  hash = ((hash >> 14) & 1) | ((hash << 1) & 0x7fff);
  hash ^= password.length;
  hash ^= 0xce4b;
  return hash.toString(16).toUpperCase().padStart(4, '0');
}

const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/** Text Excel would read as a formula when typed (see `asText` in the desktop app): kept as text with a quote prefix. */
const FORMULA_LIKE = /^[=+\-@\t\r]/;

type NumFmt = 'general' | 'num' | 'pct' | 'date' | 'datetime';
interface CellStyle {
  fmt?: NumFmt;
  bold?: boolean;
  quote?: boolean;
  wrap?: boolean;
  unlocked?: boolean;
}
const NUM_FMT_ID: Record<NumFmt, number> = { general: 0, num: 4, pct: 164, date: 165, datetime: 166 };

/** The workbook's cell styles (cellXfs). The first seven keep fixed numbers; others are added as sheets use them. */
class Styles {
  private ids = new Map<string, number>();
  private xfs: string[] = [];

  constructor() {
    // 0 normal, 1 bold, 2 number, 3 percent, 4 bold number, 5 bold percent, 6 text that looks like a formula.
    const fixed: CellStyle[] = [{}, { bold: true }, { fmt: 'num' }, { fmt: 'pct' }, { fmt: 'num', bold: true }, { fmt: 'pct', bold: true }, { quote: true }];
    for (const s of fixed) this.id(s);
  }

  id(s: CellStyle): number {
    const fmt = s.fmt ?? 'general';
    const key = `${fmt}|${s.bold ? 1 : 0}|${s.quote ? 1 : 0}|${s.wrap ? 1 : 0}|${s.unlocked ? 1 : 0}`;
    const known = this.ids.get(key);
    if (known !== undefined) return known;
    const inner = (s.wrap ? '<alignment vertical="top" wrapText="1"/>' : '') + (s.unlocked ? '<protection locked="0"/>' : '');
    const attrs =
      `numFmtId="${NUM_FMT_ID[fmt]}" fontId="${s.bold ? 1 : 0}" fillId="0" borderId="0" xfId="0"` +
      (fmt !== 'general' ? ' applyNumberFormat="1"' : '') +
      (s.bold ? ' applyFont="1"' : '') +
      (s.quote ? ' quotePrefix="1"' : '') +
      (s.wrap ? ' applyAlignment="1"' : '') +
      (s.unlocked ? ' applyProtection="1"' : '');
    this.xfs.push(inner ? `<xf ${attrs}>${inner}</xf>` : `<xf ${attrs}/>`);
    this.ids.set(key, this.xfs.length - 1);
    return this.xfs.length - 1;
  }

  xml(): string {
    return (
      `${HEAD}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
      '<numFmts count="3"><numFmt numFmtId="164" formatCode="0.0&quot;%&quot;"/><numFmt numFmtId="165" formatCode="yyyy\\-mm\\-dd"/><numFmt numFmtId="166" formatCode="yyyy\\-mm\\-dd\\ hh:mm"/></numFmts>' +
      '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
      '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
      '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      `<cellXfs count="${this.xfs.length}">${this.xfs.join('')}</cellXfs>` +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'
    );
  }
}

function numFmt(f: XlsxNumberFormat | undefined): NumFmt {
  return f === undefined ? 'general' : f === 'pct' || f === 'date' || f === 'datetime' ? f : 'num';
}

function sheetXml(spec: SheetSpec, styles: Styles): string {
  const table = spec.table;
  const row0 = Math.max(0, spec.origin?.row ?? 0);
  const col0 = Math.max(0, spec.origin?.col ?? 0);
  const cols = Math.max(1, ...table.map((r) => r.length));
  const widths = Array.from({ length: cols }, (_, c) => {
    const set = spec.widths?.[c];
    if (set !== undefined) return Math.max(1, Math.min(255, set));
    // A date is a serial number in the table but shows as yyyy-mm-dd; too narrow a column shows it as #####.
    const f = spec.formats?.[c];
    const least = f === 'date' ? 10 : f === 'datetime' ? 16 : 4;
    const longest = Math.max(least, ...table.slice(0, 200).map((r) => String(r[c] ?? '').split('\n')[0]!.length));
    return Math.min(60, longest + 2);
  });
  const unlocked = spec.protection?.unlocked;
  // Row number → that row's cells as [column, xml].
  const grid = new Map<number, [number, string][]>();
  const put = (r: number, c: number, cell: string) => {
    if (!cell) return;
    const row = grid.get(r);
    if (row) row.push([c, cell]);
    else grid.set(r, [[c, cell]]);
  };
  /** `open`: a cell people may type in. It is written even when blank, since its style is what unlocks it and formats what is typed. */
  const cellXml = (r: number, c: number, v: TableCell | undefined, style: CellStyle, open: boolean): string => {
    const ref = `${columnName(c)}${r + 1}`;
    if (typeof v === 'number' && Number.isFinite(v)) {
      const s = styles.id(style);
      return `<c r="${ref}"${s ? ` s="${s}"` : ''}><v>${v}</v></c>`;
    }
    const text = v === undefined ? '' : String(v);
    const s = styles.id({ ...style, fmt: open ? style.fmt : undefined, quote: !style.bold && FORMULA_LIKE.test(text) });
    if (text === '') return open ? `<c r="${ref}" s="${s}"/>` : '';
    return `<c r="${ref}"${s ? ` s="${s}"` : ''} t="inlineStr"><is><t xml:space="preserve">${xml(text)}</t></is></c>`;
  };
  table.forEach((row, r) => {
    const bold = r === 0 || !!spec.boldRows?.has(r);
    const count = r > 0 && unlocked ? cols : row.length;
    for (let c = 0; c < count; c++) {
      const open = r > 0 && !!unlocked?.has(c);
      const style: CellStyle = { fmt: numFmt(spec.formats?.[c]), bold, wrap: !!spec.wrap?.has(c), unlocked: open };
      put(row0 + r, col0 + c, cellXml(row0 + r, col0 + c, row[c], style, open));
    }
  });
  const inTable = (r: number, c: number) => r >= row0 && r < row0 + table.length && c >= col0 && c < col0 + cols;
  for (const cell of spec.cells ?? []) {
    if (cell.row < 0 || cell.col < 0 || inTable(cell.row, cell.col)) continue;
    put(cell.row, cell.col, cellXml(cell.row, cell.col, cell.value, { bold: !!cell.bold }, false));
  }
  const rows = [...grid.keys()]
    .sort((a, b) => a - b)
    .map((r) => {
      const cells = grid.get(r)!.sort((a, b) => a[0] - b[0]);
      return `<row r="${r + 1}">${cells.map((c) => c[1]).join('')}</row>`;
    });
  const firstCol = columnName(col0);
  const lastCol = columnName(col0 + cols - 1);
  const headerRow = row0 + 1;
  const lastRow = row0 + Math.max(1, table.length);
  const validations =
    table.length > 1
      ? (spec.validations ?? [])
          .filter((v) => v.column >= 0 && v.column < cols)
          .map((v) => {
            const c = columnName(col0 + v.column);
            const error = v.message ? ` errorTitle="Not an allowed value" error="${xml(v.message.slice(0, 255))}"` : '';
            const head = `allowBlank="1" showErrorMessage="1"${error} sqref="${c}${headerRow + 1}:${c}${lastRow}"`;
            if (v.kind === 'list') return `<dataValidation type="list" ${head}><formula1>${xml(v.source)}</formula1></dataValidation>`;
            if (v.kind === 'date') return `<dataValidation type="date" operator="greaterThanOrEqual" ${head}><formula1>1</formula1></dataValidation>`;
            return `<dataValidation type="decimal" operator="between" ${head}><formula1>-1E+300</formula1><formula2>1E+300</formula2></dataValidation>`;
          })
      : [];
  const p = spec.protection;
  // The attributes name what stays locked: 0 lets people filter and resize while the sheet is protected.
  const protection = p ? `<sheetProtection${p.password ? ` password="${protectionHash(p.password)}"` : ''} sheet="1" objects="1" scenarios="1" formatColumns="0" formatRows="0" autoFilter="0"/>` : '';
  // The order of these parts is fixed by the file format; Excel offers to repair a sheet that has them in another order.
  return (
    HEAD +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${headerRow}" topLeftCell="A${headerRow + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<cols>${widths.map((w, i) => `<col min="${col0 + i + 1}" max="${col0 + i + 1}" width="${w}"${spec.hiddenColumns?.has(i) ? ' hidden="1"' : ''} customWidth="1"/>`).join('')}</cols>` +
    `<sheetData>${rows.join('')}</sheetData>` +
    protection +
    (spec.filter === false ? '' : `<autoFilter ref="${firstCol}${headerRow}:${lastCol}${lastRow}"/>`) +
    (validations.length ? `<dataValidations count="${validations.length}">${validations.join('')}</dataValidations>` : '') +
    '</worksheet>'
  );
}

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
  const styles = new Styles();
  const sheetParts = list.map((s, i): [string, string] => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s, styles)]);
  const state = (s: SheetSpec) => (s.state && s.state !== 'visible' ? ` state="${s.state}"` : '');
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
        `<sheets>${names.map((n, i) => `<sheet name="${xml(n)}" sheetId="${i + 1}"${state(list[i]!)} r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`,
    ],
    [
      'xl/_rels/workbook.xml.rels',
      `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        list.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
        `<Relationship Id="rId${list.length + 1}" Type="${REL}/styles" Target="styles.xml"/></Relationships>`,
    ],
    ['xl/styles.xml', styles.xml()],
    ...sheetParts,
  ];
  return zipStore(parts.map(([name, text]) => ({ name, data: enc.encode(text) })));
}

/** The table as an .xlsx file with one sheet. */
export function buildXlsx(table: readonly (readonly TableCell[])[], name = 'Markups'): Uint8Array {
  return buildWorkbook([{ name, table }]);
}
