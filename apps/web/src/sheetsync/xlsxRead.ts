import type { SheetState } from './xlsx';

/**
 * A small .xlsx reader: the cell values of every sheet, hidden ones included. It reads what Excel,
 * LibreOffice and `xlsx.ts` write: stored and deflated zips, shared and inline strings, numbers,
 * booleans and dates.
 *
 * A workbook that arrives by email is outside data. Sizes are capped before and while unpacking,
 * formulas are never evaluated (a formula cell gives the value Excel saved with it), and nothing
 * outside the file is fetched: links to other workbooks are not read.
 */

/** A cell's value. Blank cells are null. A date is its serial number, listed in the sheet's `dates`. */
export type CellValue = string | number | boolean | null;

export interface ReadSheet {
  name: string;
  state: SheetState;
  /** Rows from the top of the sheet, each from column A. Rows and cells that are blank may be missing. */
  rows: CellValue[][];
  /** Number cells that are formatted as a date, as `row,col` (0-based). Convert with `fromExcelSerial`. */
  dates: ReadonlySet<string>;
}

export interface ReadWorkbook {
  sheets: ReadSheet[];
  /** Serial dates count from 1904 instead of 1900 (old Mac workbooks). */
  date1904: boolean;
  /** Who last saved the workbook, when it says. */
  lastModifiedBy?: string;
}

export interface ReadLimits {
  /** The .xlsx file itself. */
  maxBytes: number;
  /** One unpacked part. */
  maxPartBytes: number;
  /** All the parts read, unpacked. */
  maxTotalBytes: number;
  maxSheets: number;
  maxRows: number;
  maxCols: number;
  /** Cells with a value, over the whole workbook. */
  maxCells: number;
}

export const READ_LIMITS: ReadLimits = {
  maxBytes: 50 * 1024 * 1024,
  maxPartBytes: 100 * 1024 * 1024,
  maxTotalBytes: 200 * 1024 * 1024,
  maxSheets: 64,
  maxRows: 100_000,
  maxCols: 512,
  maxCells: 2_000_000,
};

/** A workbook that cannot be read, with a message fit to show. */
export class XlsxReadError extends Error {}

const TOO_BIG = 'That workbook is too large to import.';
const NOT_XLSX = 'That file is not an Excel workbook (.xlsx).';

interface ZipEntry {
  method: number;
  packed: number;
  size: number;
  local: number;
}

/** The zip's entries by name, from its central directory. */
function zipEntries(zip: Uint8Array): Map<string, ZipEntry> {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  // An encrypted workbook, or an old .xls, is an OLE file rather than a zip.
  if (zip.length >= 8 && view.getUint32(0, false) === 0xd0cf11e0) throw new XlsxReadError('That workbook is password-protected or in the old .xls format. Save it as an unprotected .xlsx.');
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new XlsxReadError(NOT_XLSX);
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  // Zip64 is for archives past 4 GB or 65,535 entries: far beyond the size cap.
  if (count === 0xffff || p === 0xffffffff) throw new XlsxReadError(TOO_BIG);
  const out = new Map<string, ZipEntry>();
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (p + 46 > zip.length || view.getUint32(p, true) !== 0x02014b50) throw new XlsxReadError(NOT_XLSX);
    const nameLen = view.getUint16(p + 28, true);
    const name = dec.decode(zip.subarray(p + 46, p + 46 + nameLen));
    if (view.getUint16(p + 8, true) & 1) throw new XlsxReadError('That workbook is password-protected. Save it without a password to open.');
    out.set(name, { method: view.getUint16(p + 10, true), packed: view.getUint32(p + 20, true), size: view.getUint32(p + 24, true), local: view.getUint32(p + 42, true) });
    p += 46 + nameLen + view.getUint16(p + 30, true) + view.getUint16(p + 32, true);
  }
  return out;
}

/** Inflates raw deflate data, stopping once it passes `limit` bytes: the size a zip declares is not to be trusted. */
async function inflateRaw(data: Uint8Array, limit: number): Promise<Uint8Array> {
  const reader = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > limit) {
        void reader.cancel().catch(() => undefined);
        throw new XlsxReadError(TOO_BIG);
      }
      chunks.push(value);
    }
  } catch (err) {
    if (err instanceof XlsxReadError) throw err;
    throw new XlsxReadError(NOT_XLSX);
  }
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of chunks) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

/** Unpacks parts on request, keeping count of the bytes unpacked so far. */
class Parts {
  private entries: Map<string, ZipEntry>;
  private total = 0;
  private zip: Uint8Array;
  private limits: ReadLimits;

  constructor(zip: Uint8Array, limits: ReadLimits) {
    this.zip = zip;
    this.limits = limits;
    this.entries = zipEntries(zip);
  }

  /** The part as text, or null when the workbook has no such part. */
  async text(name: string): Promise<string | null> {
    const e = this.entries.get(name);
    if (!e) return null;
    const limit = Math.min(this.limits.maxPartBytes, this.limits.maxTotalBytes - this.total);
    if (e.size > limit) throw new XlsxReadError(TOO_BIG);
    if (e.local + 30 > this.zip.length) throw new XlsxReadError(NOT_XLSX);
    const view = new DataView(this.zip.buffer, this.zip.byteOffset, this.zip.byteLength);
    const start = e.local + 30 + view.getUint16(e.local + 26, true) + view.getUint16(e.local + 28, true);
    if (start + e.packed > this.zip.length) throw new XlsxReadError(NOT_XLSX);
    const raw = this.zip.subarray(start, start + e.packed);
    let data: Uint8Array;
    if (e.method === 0) {
      if (raw.length > limit) throw new XlsxReadError(TOO_BIG);
      data = raw;
    } else if (e.method === 8) data = await inflateRaw(raw, limit);
    else throw new XlsxReadError(NOT_XLSX);
    this.total += data.length;
    return new TextDecoder().decode(data);
  }
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** XML text with its character references resolved. Only the five built-in entities exist: a DOCTYPE is refused. */
function decode(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (whole, ref: string) => {
    if (ref[0] !== '#') return ENTITIES[ref] ?? whole;
    const code = ref[1] === 'x' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
  });
}

interface XmlHandler {
  /** Names come without their namespace prefix; attribute names keep theirs. */
  open?: (name: string, attrs: Record<string, string>) => void;
  close?: (name: string) => void;
  text?: (text: string) => void;
}

const local = (name: string) => name.slice(name.indexOf(':') + 1);
const ATTR = /([^\s=/]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/** Walks the elements of an XML document in order. Enough for the parts of a workbook; not a general parser. */
export function scanXml(src: string, h: XmlHandler): void {
  const n = src.length;
  let i = 0;
  while (i < n) {
    const lt = src.indexOf('<', i);
    if (lt < 0) break;
    if (lt > i) h.text?.(decode(src.slice(i, lt)));
    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt + 4);
      i = end < 0 ? n : end + 3;
    } else if (src.startsWith('<![CDATA[', lt)) {
      const end = src.indexOf(']]>', lt + 9);
      h.text?.(src.slice(lt + 9, end < 0 ? n : end));
      i = end < 0 ? n : end + 3;
    } else if (src.startsWith('<?', lt)) {
      const end = src.indexOf('?>', lt + 2);
      i = end < 0 ? n : end + 2;
    } else if (src[lt + 1] === '!') {
      // A DOCTYPE can declare entities that expand without end. No spreadsheet program writes one.
      throw new XlsxReadError(NOT_XLSX);
    } else if (src[lt + 1] === '/') {
      const gt = src.indexOf('>', lt);
      if (gt < 0) break;
      h.close?.(local(src.slice(lt + 2, gt).trim()));
      i = gt + 1;
    } else {
      // The tag ends at the first > outside a quoted attribute value.
      let j = lt + 1;
      let quote = '';
      for (; j < n; j++) {
        const ch = src[j]!;
        if (quote) {
          if (ch === quote) quote = '';
        } else if (ch === '"' || ch === "'") quote = ch;
        else if (ch === '>') break;
      }
      if (j >= n) break;
      const empty = src[j - 1] === '/';
      const body = src.slice(lt + 1, empty ? j - 1 : j);
      const space = body.search(/\s/);
      const name = local(space < 0 ? body : body.slice(0, space));
      const attrs: Record<string, string> = {};
      if (space >= 0) {
        ATTR.lastIndex = space;
        for (let m = ATTR.exec(body); m; m = ATTR.exec(body)) attrs[m[1]!] = decode(m[2] ?? m[3] ?? '');
      }
      h.open?.(name, attrs);
      if (empty) h.close?.(name);
      i = j + 1;
    }
  }
}

/**
 * A string as the app holds it. Excel writes characters XML cannot hold as _xHHHH_, and saves a line
 * break in a cell as _x000D_ and a line feed; line breaks come back as a plain line feed, so text
 * that went out and came back unchanged compares equal.
 */
function unescapeExcel(text: string): string {
  const plain = text.includes('_x') ? text.replace(/_x([0-9a-fA-F]{4})_/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16))) : text;
  return plain.includes('\r') ? plain.replace(/\r\n?/g, '\n') : plain;
}

function sharedStrings(src: string, limits: ReadLimits): string[] {
  const out: string[] = [];
  let text = '';
  let inT = false;
  let phonetic = 0;
  scanXml(src, {
    open(name) {
      if (name === 'si') text = '';
      else if (name === 'rPh') phonetic++;
      else if (name === 't') inT = phonetic === 0;
    },
    close(name) {
      if (name === 't') inT = false;
      else if (name === 'rPh') phonetic--;
      else if (name === 'si') {
        if (out.length >= limits.maxCells) throw new XlsxReadError(TOO_BIG);
        out.push(unescapeExcel(text));
      }
    },
    text(t) {
      if (inT) text += t;
    },
  });
  return out;
}

/** Built-in number formats that show a date or a time. */
function builtinDate(id: number): boolean {
  return (id >= 14 && id <= 22) || (id >= 27 && id <= 36) || (id >= 45 && id <= 47) || (id >= 50 && id <= 58);
}

/** Whether a custom format code shows a date or a time: it has a day, month, year, hour or second outside quotes and brackets. */
export function isDateFormat(code: string): boolean {
  const bare = code.replace(/"[^"]*"/g, '').replace(/\\./g, '').replace(/\[[^\]]*\]/g, '');
  return /[dmyhs]/i.test(bare);
}

/** Per cell style (the `s` of a cell): whether it formats a number as a date. */
function dateStyles(src: string): boolean[] {
  const custom = new Map<number, boolean>();
  const out: boolean[] = [];
  let inXfs = false;
  scanXml(src, {
    open(name, a) {
      if (name === 'numFmt') custom.set(Number(a.numFmtId), isDateFormat(a.formatCode ?? ''));
      else if (name === 'cellXfs') inXfs = true;
      else if (name === 'xf' && inXfs) {
        const id = Number(a.numFmtId ?? 0);
        out.push(custom.get(id) ?? builtinDate(id));
      }
    },
    close(name) {
      if (name === 'cellXfs') inXfs = false;
    },
  });
  return out;
}

/** 0-based column of a cell reference: B7 → 1. */
function columnIndex(ref: string): number {
  let n = 0;
  for (let i = 0; i < ref.length; i++) {
    const c = ref.charCodeAt(i) & ~32;
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n - 1;
}

function readSheet(src: string, strings: readonly string[], dateStyle: readonly boolean[], limits: ReadLimits, budget: { cells: number }): { rows: CellValue[][]; dates: Set<string> } {
  const rows: CellValue[][] = [];
  const dates = new Set<string>();
  let r = -1;
  let c = -1;
  let type = '';
  let style = 0;
  let value = '';
  let inline = '';
  let take: 'v' | 't' | '' = '';
  let phonetic = 0;
  let inCell = false;
  const set = (v: CellValue, date: boolean) => {
    if (v === null || v === '') return;
    if (r >= limits.maxRows || c >= limits.maxCols || r < 0 || c < 0) throw new XlsxReadError(TOO_BIG);
    if (++budget.cells > limits.maxCells) throw new XlsxReadError(TOO_BIG);
    while (rows.length <= r) rows.push([]);
    const row = rows[r]!;
    while (row.length < c) row.push(null);
    row[c] = v;
    if (date) dates.add(`${r},${c}`);
  };
  scanXml(src, {
    open(name, a) {
      if (name === 'row') {
        const at = Number(a.r);
        r = Number.isInteger(at) && at > 0 ? at - 1 : r + 1;
        c = -1;
      } else if (name === 'c') {
        c = a.r ? columnIndex(a.r) : c + 1;
        type = a.t ?? 'n';
        style = Number(a.s ?? 0);
        value = '';
        inline = '';
        inCell = true;
      } else if (!inCell) return;
      else if (name === 'v') take = 'v';
      else if (name === 'rPh') phonetic++;
      else if (name === 't') take = phonetic === 0 ? 't' : '';
    },
    close(name) {
      if (name === 'v' || name === 't') take = '';
      else if (name === 'rPh') phonetic = Math.max(0, phonetic - 1);
      else if (name === 'c' && inCell) {
        inCell = false;
        if (type === 's') set(strings[Number(value)] ?? null, false);
        else if (type === 'inlineStr') set(unescapeExcel(inline), false);
        else if (type === 'str' || type === 'e' || type === 'd') set(unescapeExcel(value), false);
        else if (type === 'b') set(value.trim() === '' ? null : value.trim() === '1', false);
        else if (value.trim() !== '') {
          const num = Number(value);
          if (Number.isFinite(num)) set(num, !!dateStyle[style]);
        }
      }
    },
    text(t) {
      if (take === 'v') value += t;
      else if (take === 't') inline += t;
    },
  });
  return { rows, dates };
}

/** A relationship target as a part name: `worksheets/sheet1.xml` beside xl/workbook.xml → `xl/worksheets/sheet1.xml`. */
function partName(target: string): string {
  const out: string[] = [];
  for (const seg of (target.startsWith('/') ? target.slice(1) : `xl/${target}`).split('/')) {
    if (seg === '..') out.pop();
    else if (seg && seg !== '.') out.push(seg);
  }
  return out.join('/');
}

/** Reads an .xlsx. Throws `XlsxReadError` when the bytes are not a workbook, or are larger than the limits. */
export async function readWorkbook(bytes: Uint8Array, limits: ReadLimits = READ_LIMITS): Promise<ReadWorkbook> {
  if (bytes.length > limits.maxBytes) throw new XlsxReadError(TOO_BIG);
  const parts = new Parts(bytes, limits);
  const workbook = await parts.text('xl/workbook.xml');
  if (workbook === null) throw new XlsxReadError(NOT_XLSX);
  const listed: { name: string; state: SheetState; rel: string }[] = [];
  let date1904 = false;
  scanXml(workbook, {
    open(name, a) {
      if (name === 'workbookPr') date1904 = a.date1904 === '1' || a.date1904 === 'true';
      else if (name === 'sheet') {
        const rel = Object.entries(a).find(([k]) => k === 'r:id' || k.endsWith(':id'))?.[1] ?? '';
        listed.push({ name: a.name ?? '', state: a.state === 'hidden' || a.state === 'veryHidden' ? a.state : 'visible', rel });
      }
    },
  });
  if (listed.length > limits.maxSheets) throw new XlsxReadError(TOO_BIG);
  const targets = new Map<string, string>();
  scanXml((await parts.text('xl/_rels/workbook.xml.rels')) ?? '', {
    open(name, a) {
      // A sheet kept in another file is not followed.
      if (name === 'Relationship' && a.Id && a.Target && a.TargetMode !== 'External') targets.set(a.Id, partName(a.Target));
    },
  });
  const shared = await parts.text('xl/sharedStrings.xml');
  const strings = shared === null ? [] : sharedStrings(shared, limits);
  const styles = await parts.text('xl/styles.xml');
  const dateStyle = styles === null ? [] : dateStyles(styles);
  const budget = { cells: 0 };
  const sheets: ReadSheet[] = [];
  for (const s of listed) {
    const target = targets.get(s.rel);
    const src = target ? await parts.text(target) : null;
    // A chart sheet or a macro sheet has no cells.
    const body = src === null ? { rows: [], dates: new Set<string>() } : readSheet(src, strings, dateStyle, limits, budget);
    sheets.push({ name: s.name, state: s.state, ...body });
  }
  let lastModifiedBy: string | undefined;
  const core = await parts.text('docProps/core.xml');
  if (core !== null) {
    let inside = false;
    let who = '';
    scanXml(core, {
      open: (name) => void (inside = name === 'lastModifiedBy'),
      close: () => void (inside = false),
      text: (t) => void (inside && (who += t)),
    });
    lastModifiedBy = who.trim().slice(0, 200) || undefined;
  }
  return { sheets, date1904, ...(lastModifiedBy ? { lastModifiedBy } : {}) };
}

/** The sheet of that name (Excel ignores case), if the workbook has one. */
export function findSheet(book: ReadWorkbook, name: string): ReadSheet | undefined {
  const want = name.toLowerCase();
  return book.sheets.find((s) => s.name.toLowerCase() === want);
}
