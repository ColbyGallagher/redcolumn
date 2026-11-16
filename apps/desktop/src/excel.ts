import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { writeAtomic } from './atomic';

/**
 * Sync to Excel on this computer (Windows only). The page sends the Markups table and the .xlsx it
 * builds from it. While the workbook is closed the file is replaced; while it is open in Excel the
 * file is locked, so the cells are written into the open workbook through Excel's COM interface
 * (a PowerShell script) and Excel saves it. The page sees opaque IDs, never paths.
 */

export type Cell = string | number;
export type Table = Cell[][];

const MAX_ROWS = 100_000;
const MAX_COLS = 256;
const MAX_CELL = 32_767;
const ID = /^xl-[0-9a-f]{16}$/;

/** The table as the page sent it, or an error: only rows of strings and finite numbers, within Excel's limits. */
export function checkTable(value: unknown): Table {
  if (!Array.isArray(value) || value.length > MAX_ROWS) throw new Error('That table cannot be written to Excel.');
  return value.map((row) => {
    if (!Array.isArray(row) || row.length > MAX_COLS) throw new Error('That table cannot be written to Excel.');
    return row.map((cell) => {
      if (typeof cell === 'number' && Number.isFinite(cell)) return cell;
      if (typeof cell === 'string') return cell.slice(0, MAX_CELL);
      throw new Error('That table cannot be written to Excel.');
    });
  });
}

/** A further sheet of the workbook: the page sends its name and cells beside the main table. */
export interface ExtraSheet {
  name: string;
  table: Table;
}

const MAX_SHEETS = 8;

/** The extra sheets as the page sent them, or an error: a few sheets, each with a name Excel accepts and a valid table. */
export function checkSheets(value: unknown): ExtraSheet[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_SHEETS) throw new Error('That table cannot be written to Excel.');
  return value.map((s) => {
    const name = (s as { name?: unknown } | null)?.name;
    if (typeof name !== 'string' || !name.trim() || name.length > 31 || /[:\\/?*[\]]/.test(name)) throw new Error('That table cannot be written to Excel.');
    return { name, table: checkTable((s as { table?: unknown }).table) };
  });
}

/**
 * Text Excel would read as a formula (or a DDE call) gets a leading apostrophe, which Excel keeps
 * as "this is text" and does not show. Markup subjects and comments are other people's words.
 */
export function asText(cell: Cell): Cell {
  return typeof cell === 'string' && /^[=+\-@\t\r]/.test(cell) ? `'${cell}` : cell;
}

/**
 * Every text cell marked as text. Typed into Excel, "1/2" becomes a date and "12" a number; a
 * two-way sync would then read its own text back changed, and take that for an edit made in Excel.
 */
export function forceText(cell: Cell): Cell {
  return typeof cell === 'string' && cell !== '' ? `'${cell}` : cell;
}

/**
 * Writes the table into the workbook's sheet through Excel, then saves it. Uses the workbook when it
 * is open in Excel; otherwise, with `openIfClosed`, opens it in a hidden Excel and closes it again,
 * so the person's other sheets are kept. Input is UTF-8 JSON, base64 on stdin. Prints one word:
 * ok, not-open, read-only, busy or changed, or "error: <message>".
 *
 * With a `stamp` (two-way sync) nothing is written when the sheet no longer matches what was read:
 * someone typed in Excel since, so the page reads and merges again rather than write over it.
 */
const GRID_FUNCTIONS = String.raw`
# A sheet's cells from A1 to the end of its used range, as the JSON of its rows. Written out by hand:
# the serializer cannot take the values PowerShell hands back from Excel. An error cell (Excel gives
# its error code, an integer) reads as text.
function Read-Grid($ser, $ws) {
  $u = $ws.UsedRange
  $r = $u.Row + $u.Rows.Count - 1
  $c = $u.Column + $u.Columns.Count - 1
  $v = $ws.Range($ws.Cells(1, 1), $ws.Cells($r, $c)).Value2
  $single = ($r -eq 1 -and $c -eq 1)
  $inv = [Globalization.CultureInfo]::InvariantCulture
  $sb = New-Object Text.StringBuilder
  [void]$sb.Append('[')
  for ($i = 1; $i -le $r; $i++) {
    if ($i -gt 1) { [void]$sb.Append(',') }
    [void]$sb.Append('[')
    for ($j = 1; $j -le $c; $j++) {
      if ($j -gt 1) { [void]$sb.Append(',') }
      if ($single) { $x = $v } else { $x = $v.GetValue($i, $j) }
      if ($null -eq $x) { [void]$sb.Append('null') }
      elseif ($x -is [double]) { [void]$sb.Append($x.ToString('R', $inv)) }
      elseif ($x -is [bool]) { if ($x) { [void]$sb.Append('true') } else { [void]$sb.Append('false') } }
      elseif ($x -is [string]) { [void]$sb.Append($ser.Serialize($x)) }
      else { [void]$sb.Append('"#ERROR"') }
    }
    [void]$sb.Append(']')
  }
  [void]$sb.Append(']')
  return $sb.ToString()
}
# A fingerprint of a sheet's cells: the write is refused when it no longer matches what was read.
function Get-Stamp($json) {
  $sha = [Security.Cryptography.SHA1]::Create()
  return [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($json))).Replace('-', '')
}
`;

/**
 * Reads the workbook's sheet (and the hidden sheet that records what was written) out of the open
 * workbook. Prints not-open, "error: <message>", or base64 of UTF-8 JSON: { stamp, sheets: [{ name, rows }] }.
 */
export const READ_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$book = $null
$result = 'not-open'
${GRID_FUNCTIONS}
try {
  Add-Type -AssemblyName System.Web.Extensions
  $ser = New-Object System.Web.Script.Serialization.JavaScriptSerializer
  $ser.MaxJsonLength = [int]::MaxValue
  $in = $ser.DeserializeObject([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())))
  $xl = $null
  try { $xl = [Runtime.InteropServices.Marshal]::GetActiveObject('Excel.Application') } catch { }
  if ($xl) {
    foreach ($b in $xl.Workbooks) { if ([string]::Equals($b.FullName, $in['path'], [StringComparison]::OrdinalIgnoreCase)) { $book = $b; break } }
    if (-not $book) {
      # A workbook in a OneDrive folder reports a web address as its FullName. Only those are matched by
      # file name, and only when one matches: a local workbook of the same name elsewhere is never touched.
      $named = @($xl.Workbooks | Where-Object { $_.FullName -match '^https?://' -and [string]::Equals($_.Name, $in['name'], [StringComparison]::OrdinalIgnoreCase) })
      if ($named.Count -eq 1) { $book = $named[0] }
    }
  }
  if ($book) {
    $parts = @()
    $stamp = ''
    foreach ($name in @($in['sheets'])) {
      $ws = $null
      foreach ($s in $book.Worksheets) { if ($s.Name -eq $name) { $ws = $s; break } }
      if (-not $ws) { continue }
      $rows = Read-Grid $ser $ws
      if ($name -eq $in['sheet']) { $stamp = Get-Stamp $rows }
      $parts += ('{"name":' + $ser.Serialize([string]$name) + ',"rows":' + $rows + '}')
    }
    $result = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes('{"stamp":"' + $stamp + '","sheets":[' + ($parts -join ',') + ']}'))
  }
} catch {
  $m = $_.Exception.Message
  if ($m -match '0x8001010A|0x80010001') { $result = 'busy' } else { $result = 'error: ' + $m }
}
Write-Output $result
`;

export const LIVE_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
${GRID_FUNCTIONS}
$hidden = $null
$book = $null
$result = 'ok'
try {
  # ConvertFrom-Json in Windows PowerShell 5.1 stops at about 2 MB; this serializer can be told otherwise.
  Add-Type -AssemblyName System.Web.Extensions
  $ser = New-Object System.Web.Script.Serialization.JavaScriptSerializer
  $ser.MaxJsonLength = [int]::MaxValue
  $in = $ser.DeserializeObject([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())))
  $xl = $null
  try { $xl = [Runtime.InteropServices.Marshal]::GetActiveObject('Excel.Application') } catch { }
  if ($xl) {
    foreach ($b in $xl.Workbooks) { if ([string]::Equals($b.FullName, $in['path'], [StringComparison]::OrdinalIgnoreCase)) { $book = $b; break } }
    if (-not $book) {
      # A workbook in a OneDrive folder reports a web address as its FullName. Only those are matched by
      # file name, and only when one matches: a local workbook of the same name elsewhere is never touched.
      $named = @($xl.Workbooks | Where-Object { $_.FullName -match '^https?://' -and [string]::Equals($_.Name, $in['name'], [StringComparison]::OrdinalIgnoreCase) })
      if ($named.Count -eq 1) { $book = $named[0] }
    }
  }
  if (-not $book -and $in['openIfClosed']) {
    $hidden = New-Object -ComObject Excel.Application
    $hidden.Visible = $false
    $hidden.DisplayAlerts = $false
    $book = $hidden.Workbooks.Open($in['path'], 0, $false)
  }
  if (-not $book) { $result = 'not-open' }
  elseif ($book.ReadOnly) { $result = 'read-only' }
  else {
    $stale = $false
    if ($in.ContainsKey('stamp') -and $in['stamp']) {
      foreach ($s in $book.Worksheets) { if ($s.Name -eq $in['sheet']) { $stale = ((Get-Stamp (Read-Grid $ser $s)) -ne $in['stamp']); break } }
    }
    # Hidden sheets first (validation on the main sheet points at them), then the main sheet, then any
    # further ones (such as the quantities), each replaced as a whole.
    $targets = @()
    if ($in.ContainsKey('extra')) { foreach ($e in @($in['extra'])) { if ($e['hidden']) { $targets += ,@{ sheet = $e['sheet']; cols = $e['cols']; rows = $e['rows']; hidden = $true } } } }
    $targets += ,@{ sheet = $in['sheet']; cols = $in['cols']; rows = $in['rows']; hideKey = $in['hideKey']; validations = $in['validations'] }
    if ($in.ContainsKey('extra')) { foreach ($e in @($in['extra'])) { if (-not $e['hidden']) { $targets += ,@{ sheet = $e['sheet']; cols = $e['cols']; rows = $e['rows'] } } } }
    if ($stale) { $targets = @(); $result = 'changed' }
    foreach ($t in $targets) {
      $ws = $null
      foreach ($s in $book.Worksheets) { if ($s.Name -eq $t['sheet']) { $ws = $s; break } }
      if (-not $ws) { $ws = $book.Worksheets.Add([Type]::Missing, $book.Worksheets.Item($book.Worksheets.Count)); $ws.Name = $t['sheet'] }
      $rows = @($t['rows'])
      $used = $ws.UsedRange
      $r = [Math]::Max([Math]::Max($rows.Count, $used.Row + $used.Rows.Count - 1), 1)
      $c = [Math]::Max([Math]::Max([int]$t['cols'], $used.Column + $used.Columns.Count - 1), 1)
      $grid = New-Object 'object[,]' $r, $c
      for ($i = 0; $i -lt $rows.Count; $i++) {
        $row = @($rows[$i])
        for ($j = 0; $j -lt $row.Count; $j++) { $grid[$i, $j] = $row[$j] }
      }
      $ws.Range($ws.Cells(1, 1), $ws.Cells($r, $c)).Value2 = $grid
      if ($t['hidden']) { $ws.Visible = 2 }
      if ($t['hideKey']) { $ws.Columns.Item(1).Hidden = $true }
      # Dropdowns and date and number checks on the data rows, as a file written while closed has them.
      foreach ($v in @($t['validations'])) {
        if (-not $v) { continue }
        $col = [int]$v['col']
        $ws.Columns.Item($col).Validation.Delete()
        if ($rows.Count -lt 2) { continue }
        $rng = $ws.Range($ws.Cells(2, $col), $ws.Cells($rows.Count, $col))
        if ($v['type'] -eq 'list') { [void]$rng.Validation.Add(3, 1, 1, $v['formula']) }
        elseif ($v['type'] -eq 'date') { $rng.NumberFormat = 'yyyy-mm-dd'; [void]$rng.Validation.Add(4, 1, 7, '1') }
        elseif ($v['type'] -eq 'number') { [void]$rng.Validation.Add(2, 1, 1, '-1E+300', '1E+300') }
      }
    }
    if (-not $stale) { $book.Save() }
  }
} catch {
  $m = $_.Exception.Message
  if ($m -match '0x8001010A|0x80010001') { $result = 'busy' } else { $result = 'error: ' + $m }
} finally {
  if ($hidden) {
    if ($book) { try { $book.Close($false) } catch { } }
    $hidden.Quit()
    [void][Runtime.InteropServices.Marshal]::ReleaseComObject($hidden)
  }
}
Write-Output $result
`;

/**
 * Runs a PowerShell script with `input` (base64 of its UTF-8) on stdin and returns what it printed.
 * The script goes on the command line encoded; the table never does.
 */
export function runPowerShell(script: string, input: string, timeoutMs = 30_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { windowsHide: true });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Excel did not answer in time.'));
    }, timeoutMs);
    child.stdout.setEncoding('utf8').on('data', (d: string) => (out += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (err += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out.trim());
      else reject(new Error(err.trim() || 'PowerShell could not run.'));
    });
    child.stdin.end(Buffer.from(input, 'utf8').toString('base64'));
  });
}

const LOCKED = new Set(['EBUSY', 'EPERM', 'EACCES']);

/**
 * The sheet names in an .xlsx (from xl/workbook.xml), or null when the bytes are not a zip this can
 * read. Enough to tell a workbook the app wrote from one the person has added sheets to.
 */
export function sheetNames(zip: Uint8Array): string[] | null {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  for (let n = 0; n < count && p + 46 <= zip.length; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) return null;
    const method = view.getUint16(p + 10, true);
    const size = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const name = Buffer.from(zip.subarray(p + 46, p + 46 + nameLen)).toString('utf8');
    if (name === 'xl/workbook.xml') {
      const local = view.getUint32(p + 42, true);
      if (local + 30 > zip.length) return null;
      const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
      const raw = zip.subarray(start, start + size);
      let xml = '';
      try {
        if (method === 0) xml = Buffer.from(raw).toString('utf8');
        else if (method === 8) xml = inflateRawSync(raw).toString('utf8');
      } catch {
        return null;
      }
      if (!xml) return null;
      const unescape = (t: string) => t.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
      return [...xml.matchAll(/<(?:\w+:)?sheet\b[^>]*?\bname="([^"]*)"/g)].map((m) => unescape(m[1]!));
    }
    p += 46 + nameLen + view.getUint16(p + 30, true) + view.getUint16(p + 32, true);
  }
  return null;
}

export interface WorkbookDeps {
  read: (filePath: string) => Promise<Uint8Array>;
  write: (filePath: string, data: Uint8Array) => Promise<void>;
  run: (script: string, input: string) => Promise<string>;
  /** Whether another program (Excel) holds the file open for writing. */
  locked?: (filePath: string) => Promise<boolean>;
}

/** Excel holds a workbook it has open so nobody else can write it: opening it for writing fails. */
async function isLocked(filePath: string): Promise<boolean> {
  try {
    await (await fs.open(filePath, 'r+')).close();
    return false;
  } catch (err) {
    return LOCKED.has((err as NodeJS.ErrnoException).code ?? '');
  }
}

const defaultDeps: WorkbookDeps = { read: (p) => fs.readFile(p), write: (p, d) => writeAtomic(p, d), run: (s, i) => runPowerShell(s, i, 60_000), locked: isLocked };

/** What a column of the sheet accepts: set on the open workbook, as a file written while closed has it. */
export interface LiveValidation {
  /** 1-based column. */
  col: number;
  type: 'list' | 'date' | 'number';
  /** For a list: the range holding its values, `='_redcolumn'!$N$4:$N$7`. */
  formula?: string;
}

/** Two-way sync's extras for a write into the open workbook. */
export interface LiveOptions {
  /** The fingerprint the read gave. The write is refused (`changed`) when the sheet no longer matches it. */
  stamp?: string;
  /** Hide the first column (the row keys). */
  hideKey?: boolean;
  /** Write every text cell as text, never as the number or date Excel would read it as. */
  text?: boolean;
  validations?: LiveValidation[];
  /** Extra sheets to make very hidden. */
  hidden?: string[];
}

/** The options as the page sent them, or an error. A list's formula is a plain range on one of the workbook's own sheets, nothing else. */
export function checkLive(value: unknown): LiveOptions {
  if (value === undefined || value === null) return {};
  const bad = () => new Error('That table cannot be written to Excel.');
  if (typeof value !== 'object') throw bad();
  const v = value as { stamp?: unknown; hideKey?: unknown; text?: unknown; validations?: unknown; hidden?: unknown };
  const out: LiveOptions = {};
  if (v.stamp !== undefined) {
    if (typeof v.stamp !== 'string' || !/^[0-9A-F]{0,40}$/.test(v.stamp)) throw bad();
    out.stamp = v.stamp;
  }
  if (v.hideKey === true) out.hideKey = true;
  if (v.text === true) out.text = true;
  if (v.validations !== undefined) {
    if (!Array.isArray(v.validations) || v.validations.length > MAX_COLS) throw bad();
    out.validations = v.validations.map((x) => {
      const { col, type, formula } = (x ?? {}) as { col?: unknown; type?: unknown; formula?: unknown };
      if (typeof col !== 'number' || !Number.isInteger(col) || col < 1 || col > MAX_COLS) throw bad();
      if (type === 'date' || type === 'number') return { col, type };
      if (type !== 'list' || typeof formula !== 'string' || !/^='[^'!\[\]:\\/?*]{1,31}'!\$[A-Z]{1,3}\$\d{1,7}:\$[A-Z]{1,3}\$\d{1,7}$/.test(formula)) throw bad();
      return { col, type, formula };
    });
  }
  if (v.hidden !== undefined) {
    if (!Array.isArray(v.hidden) || v.hidden.length > MAX_SHEETS || v.hidden.some((n) => typeof n !== 'string')) throw bad();
    out.hidden = v.hidden as string[];
  }
  return out;
}

/** What Excel has now: nothing yet, the saved file, or the cells of the workbook open in Excel (with edits not saved yet). */
export type WorkbookRead = { kind: 'none' } | { kind: 'file'; bytes: Uint8Array } | { kind: 'live'; stamp: string; sheets: { name: string; rows: (string | number | boolean | null)[][] }[] };

/**
 * Reads the workbook for a two-way sync. While Excel has it open, the cells come from Excel itself,
 * so what is typed there is seen before it is saved; otherwise the file is read.
 */
export async function readWorkbookNow(filePath: string, sheets: readonly string[], deps: WorkbookDeps = defaultDeps): Promise<WorkbookRead> {
  const name = path.basename(filePath);
  let bytes: Uint8Array | null = null;
  try {
    bytes = await deps.read(filePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'none' };
  }
  if (bytes && !(await (deps.locked ?? isLocked)(filePath))) return { kind: 'file', bytes };
  const answer = await deps.run(READ_SCRIPT, JSON.stringify({ path: filePath, name, sheet: sheets[0] ?? 'Markups', sheets }));
  if (answer === 'not-open') {
    if (bytes) return { kind: 'file', bytes };
    throw new Error(`${name} is open in another program, so it cannot be read. Close it there.`);
  }
  if (answer === 'busy') throw new Error(`Excel is busy (a cell in ${name} may be being edited). It is tried again shortly.`);
  if (answer.startsWith('error: ') || !answer) throw new Error(`Excel could not read ${name}${answer ? `: ${answer.slice(7)}` : '.'}`);
  const parsed = JSON.parse(Buffer.from(answer, 'base64').toString('utf8')) as { stamp?: unknown; sheets?: unknown };
  const list = Array.isArray(parsed.sheets) ? parsed.sheets : [];
  return {
    kind: 'live',
    stamp: typeof parsed.stamp === 'string' ? parsed.stamp : '',
    sheets: list.map((s: { name?: unknown; rows?: unknown }) => ({
      name: String(s.name ?? ''),
      rows: (Array.isArray(s.rows) ? s.rows : []).map((row: unknown) => (Array.isArray(row) ? row.map((c) => (typeof c === 'string' || typeof c === 'number' || typeof c === 'boolean' ? c : null)) : [])),
    })),
  };
}

/**
 * Keeps the workbook's sheet up to date without losing anything else in the file. A new workbook,
 * or one holding only that sheet, is replaced while closed; while Excel has it open (and so locked)
 * the cells are written into it. A workbook the person has added sheets to is always updated
 * through Excel, opened hidden when it is closed, so their sheets are kept.
 */
export async function writeWorkbook(filePath: string, xlsx: Uint8Array, table: Table, sheet = 'Markups', deps: WorkbookDeps = defaultDeps, extra: readonly ExtraSheet[] = [], live: LiveOptions = {}): Promise<'file' | 'live' | 'changed'> {
  const name = path.basename(filePath);
  let existing: Uint8Array | null | undefined;
  try {
    existing = await deps.read(filePath);
  } catch (err) {
    // Missing: a new workbook. Unreadable (locked even for reading): let Excel sort it out.
    existing = (err as NodeJS.ErrnoException).code === 'ENOENT' ? null : undefined;
  }
  const names = existing ? sheetNames(existing) : null;
  // Ours: new, or holding only the sheets this app writes (the main one and any extras).
  const mine = new Set([sheet, ...extra.map((e) => e.name)]);
  const ours = existing === null || (names !== null && names.length > 0 && names.every((n) => mine.has(n)) && names.includes(sheet));
  if (ours) {
    try {
      await deps.write(filePath, xlsx);
      return 'file';
    } catch (err) {
      if (!LOCKED.has((err as NodeJS.ErrnoException).code ?? '')) throw new Error(`${name} could not be saved${err instanceof Error ? `: ${err.message}` : '.'}`);
    }
  }
  const cols = table.reduce((n, row) => Math.max(n, row.length), 0);
  const sized = (t: Table) => t.reduce((n, row) => Math.max(n, row.length), 0);
  const input = JSON.stringify({
    path: filePath,
    name,
    sheet,
    cols,
    openIfClosed: !ours,
    rows: table.map((row) => row.map(live.text ? forceText : asText)),
    ...(extra.length ? { extra: extra.map((e) => ({ sheet: e.name, cols: sized(e.table), rows: e.table.map((row) => row.map(live.text && live.hidden?.includes(e.name) ? forceText : asText)), ...(live.hidden?.includes(e.name) ? { hidden: true } : {}) })) } : {}),
    ...(live.stamp ? { stamp: live.stamp } : {}),
    ...(live.hideKey ? { hideKey: true } : {}),
    ...(live.validations?.length ? { validations: live.validations } : {}),
  });
  const answer = await deps.run(LIVE_SCRIPT, input);
  if (answer === 'ok') return 'live';
  if (answer === 'changed') return 'changed';
  if (answer === 'busy') throw new Error(`Excel is busy (a cell in ${name} may be being edited). It is tried again shortly.`);
  if (answer === 'read-only') throw new Error(`${name} is read-only, or open in another program, so it cannot be updated. Close it there.`);
  if (answer === 'not-open') throw new Error(`${name} is open in another program, so it cannot be updated. Close it there.`);
  throw new Error(`Excel could not update ${name}${answer.startsWith('error: ') ? `: ${answer.slice(7)}` : '.'}`);
}

// A comment register in the client's own file.

/** Where a register's rows go in the client's file and what is written with them (apps/web/src/sheetsync/clientFile.ts). Rows and columns count from 1. */
export interface FillRequest {
  sheet: string;
  headerRow: number;
  firstRow: number;
  count: number;
  columns: { col: number; cells: Cell[] }[];
  key: { col: number; label: string; cells: string[] };
  firstCol: number;
  /** The first row under the header that already holds something; 0 when there is none. */
  below: number;
  cells: { row: number; col: number; value: string }[];
  hidden: { name: string; table: Table };
  validations: LiveValidation[];
  dates: number[];
}

const EXCEL_ROWS = 1_048_576;
const EXCEL_COLS = 16_384;
const SHEET_NAME = /^[^:\\/?*[\]]{1,31}$/;
const LIST_FORMULA = /^='[^'!\[\]:\\/?*]{1,31}'!\$[A-Z]{1,3}\$\d{1,7}:\$[A-Z]{1,3}\$\d{1,7}$/;

/** The request as the page sent it, or an error: positions on the sheet, plain values, and nothing Excel would run or fetch. */
export function checkFill(value: unknown): FillRequest {
  const bad = () => new Error('That register cannot be written to Excel.');
  const obj = (v: unknown): Record<string, unknown> => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw bad();
    return v as Record<string, unknown>;
  };
  const int = (v: unknown, min: number, max: number): number => {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw bad();
    return v;
  };
  const list = (v: unknown, max: number): unknown[] => {
    if (!Array.isArray(v) || v.length > max) throw bad();
    return v;
  };
  const text = (v: unknown): string => {
    if (typeof v !== 'string') throw bad();
    return v.slice(0, MAX_CELL);
  };
  const name = (v: unknown): string => {
    if (typeof v !== 'string' || !SHEET_NAME.test(v) || !v.trim()) throw bad();
    return v;
  };
  const cell = (v: unknown): Cell => {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    return text(v);
  };
  const v = obj(value);
  const headerRow = int(v.headerRow, 1, EXCEL_ROWS - 1);
  const firstRow = int(v.firstRow, headerRow + 1, EXCEL_ROWS);
  const count = int(v.count, 0, Math.min(MAX_ROWS, EXCEL_ROWS - firstRow + 1));
  const col = (x: unknown) => int(x, 1, EXCEL_COLS);
  const key = obj(v.key);
  const hidden = obj(v.hidden);
  const out: FillRequest = {
    sheet: name(v.sheet),
    headerRow,
    firstRow,
    count,
    columns: list(v.columns, MAX_COLS).map((c) => {
      const cells = list(obj(c).cells, MAX_ROWS).map(cell);
      if (cells.length !== count) throw bad();
      return { col: col(obj(c).col), cells };
    }),
    key: { col: col(key.col), label: text(key.label), cells: list(key.cells, MAX_ROWS).map(text) },
    firstCol: col(v.firstCol),
    below: v.below === 0 ? 0 : int(v.below, firstRow, EXCEL_ROWS),
    cells: list(v.cells, 500).map((c) => ({ row: int(obj(c).row, 1, headerRow - 1), col: col(obj(c).col), value: text(obj(c).value) })),
    hidden: { name: name(hidden.name), table: checkTable(hidden.table) },
    validations: list(v.validations ?? [], MAX_COLS).map((x) => {
      const { type, formula } = obj(x);
      if (type === 'date' || type === 'number') return { col: col(obj(x).col), type };
      if (type !== 'list' || typeof formula !== 'string' || !LIST_FORMULA.test(formula)) throw bad();
      return { col: col(obj(x).col), type, formula };
    }),
    dates: list(v.dates ?? [], MAX_COLS).map(col),
  };
  if (out.key.cells.length !== count || out.hidden.name === out.sheet) throw bad();
  return out;
}

/**
 * Fills a copy of the client's register file in, in an Excel of its own that nobody sees, and saves
 * it. The file is somebody else's: macros and events are off, links to other files are not followed,
 * and only values, a hidden column, a hidden sheet and (where the file has none) dropdowns are set.
 * Prints ok, no-excel, no-sheet, protected or "error: <message>".
 */
export const FILL_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$xl = $null
$book = $null
$result = 'ok'
function Put($ws, $row, $col, $cells) {
  $list = @($cells)
  if ($list.Count -eq 0) { return }
  $grid = New-Object 'object[,]' $list.Count, 1
  for ($i = 0; $i -lt $list.Count; $i++) { $grid[$i, 0] = $list[$i] }
  $ws.Range($ws.Cells($row, $col), $ws.Cells($row + $list.Count - 1, $col)).Value2 = $grid
}
try {
  Add-Type -AssemblyName System.Web.Extensions
  $ser = New-Object System.Web.Script.Serialization.JavaScriptSerializer
  $ser.MaxJsonLength = [int]::MaxValue
  $in = $ser.DeserializeObject([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())))
  try { $xl = New-Object -ComObject Excel.Application } catch { $xl = $null }
  if (-not $xl) { $result = 'no-excel' }
  else {
    $xl.Visible = $false
    $xl.DisplayAlerts = $false
    $xl.EnableEvents = $false
    $xl.AskToUpdateLinks = $false
    # msoAutomationSecurityForceDisable: no macro in the file runs.
    try { $xl.AutomationSecurity = 3 } catch { }
    # UpdateLinks 0: links to other workbooks are left as they are.
    $book = $xl.Workbooks.Open($in['path'], 0, $false)
    $ws = $null
    foreach ($s in $book.Worksheets) { if ($s.Name -eq $in['sheet']) { $ws = $s; break } }
    if (-not $ws) { $result = 'no-sheet' }
    elseif ($ws.ProtectContents -or $book.ProtectStructure) { $result = 'protected' }
    else {
      $shown = $book.ActiveSheet
      $first = [int]$in['firstRow']
      $count = [int]$in['count']
      # Room for the comments above whatever the file has under its table (a sign-off block). The table's
      # blank rows are those that look like its first one: a spacer row above the block is not one of them.
      $below = [int]$in['below']
      if ($below -gt 0) {
        $room = $below - $first
        if ($room -gt 1) {
          $c1 = [int]$in['firstCol']
          $line = $ws.Cells($first, $c1).Borders.Item(9).LineStyle
          $shade = $ws.Cells($first, $c1).Interior.ColorIndex
          while ($room -gt 1) {
            $c = $ws.Cells($first + $room - 1, $c1)
            if ($c.Borders.Item(9).LineStyle -eq $line -and $c.Interior.ColorIndex -eq $shade) { break }
            $room--
          }
        }
        $need = $count - $room
        if ($need -gt 0) {
          # Inserted before the table's last blank row, so that ranges over the table (a total under it)
          # grow with it. xlShiftDown; the look comes from the row above (0), or from the row below (1)
          # when the row above is the header.
          $at = $first + [Math]::Max($room - 1, 0)
          $origin = 0
          if ($room -lt 2) { $origin = 1 }
          [void]$ws.Range("$($at):$($at + $need - 1)").Insert(-4121, $origin)
        }
      }
      foreach ($c in @($in['columns'])) { Put $ws $first ([int]$c['col']) $c['cells'] }
      $k = [int]$in['key']['col']
      $ws.Cells([int]$in['headerRow'], $k).Value2 = $in['key']['label']
      Put $ws $first $k $in['key']['cells']
      $ws.Columns.Item($k).Hidden = $true
      # A merged cell holds its value in its first cell.
      foreach ($c in @($in['cells'])) { $ws.Cells([int]$c['row'], [int]$c['col']).MergeArea.Cells.Item(1, 1).Value2 = $c['value'] }
      $h = $null
      foreach ($s in $book.Worksheets) { if ($s.Name -eq $in['hidden']['name']) { $h = $s; break } }
      if ($h) { $h.Visible = -1; [void]$h.Cells.Clear() }
      else { $h = $book.Worksheets.Add([Type]::Missing, $book.Worksheets.Item($book.Worksheets.Count)); $h.Name = $in['hidden']['name'] }
      $rows = @($in['hidden']['rows'])
      $cols = [Math]::Max([int]$in['hidden']['cols'], 1)
      if ($rows.Count -gt 0) {
        $grid = New-Object 'object[,]' $rows.Count, $cols
        for ($i = 0; $i -lt $rows.Count; $i++) {
          $row = @($rows[$i])
          for ($j = 0; $j -lt $row.Count; $j++) { $grid[$i, $j] = $row[$j] }
        }
        $h.Range($h.Cells(1, 1), $h.Cells($rows.Count, $cols)).Value2 = $grid
      }
      $h.Visible = 2
      try { $shown.Activate() } catch { }
      if ($count -gt 0) {
        foreach ($v in @($in['validations'])) {
          $col = [int]$v['col']
          # The client's own dropdown on a column stays.
          $has = $false
          try { $has = ($ws.Cells($first, $col).Validation.Type -ge 0) } catch { $has = $false }
          if ($has) { continue }
          $rng = $ws.Range($ws.Cells($first, $col), $ws.Cells($first + $count - 1, $col))
          $rng.Validation.Delete()
          if ($v['type'] -eq 'list') { [void]$rng.Validation.Add(3, 1, 1, $v['formula']) }
          elseif ($v['type'] -eq 'date') { [void]$rng.Validation.Add(4, 1, 7, '1') }
          elseif ($v['type'] -eq 'number') { [void]$rng.Validation.Add(2, 1, 1, '-1E+300', '1E+300') }
        }
        foreach ($d in @($in['dates'])) {
          $col = [int]$d
          if ($ws.Cells($first, $col).NumberFormat -eq 'General') { $ws.Range($ws.Cells($first, $col), $ws.Cells($first + $count - 1, $col)).NumberFormat = 'yyyy-mm-dd' }
        }
      }
      $book.Save()
    }
  }
} catch {
  $result = 'error: ' + $_.Exception.Message
} finally {
  if ($book) { try { $book.Close($false) } catch { } }
  if ($xl) {
    try { $xl.Quit() } catch { }
    [void][Runtime.InteropServices.Marshal]::ReleaseComObject($xl)
  }
}
Write-Output $result
`;

/** The client's file may be large (logos), but not without end: the page reads it too. */
const MAX_SOURCE = 50 * 1024 * 1024;

/** The client's register file, for the page to find the table in. */
export async function readSource(filePath: string): Promise<Uint8Array> {
  const name = path.basename(filePath);
  // One handle for the check and the read, so the file checked is the file read.
  const handle = await fs.open(filePath, 'r').catch(() => null);
  if (!handle) throw new Error(`${name} is no longer where it was. Choose the client’s file again in the template.`);
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error(`${name} is no longer where it was. Choose the client’s file again in the template.`);
    if (stat.size > MAX_SOURCE) throw new Error(`${name} is too large to use as a register file.`);
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

export interface FillDeps {
  copy: (from: string, to: string) => Promise<void>;
  remove: (filePath: string) => Promise<void>;
  run: (script: string, input: string) => Promise<string>;
}

const fillDeps: FillDeps = {
  copy: async (from, to) => writeAtomic(to, await readSource(from)),
  remove: (p) => fs.rm(p, { force: true }),
  run: (s, i) => runPowerShell(s, i, 180_000),
};

/**
 * Makes `dest` a copy of the client's file with the register's rows in it. The client's file is
 * never written, and a copy Excel could not fill is not left behind.
 */
export async function fillWorkbook(source: string, dest: string, fill: FillRequest, deps: FillDeps = fillDeps): Promise<void> {
  // Windows paths, wherever this runs (the tests run on other systems too).
  const name = path.win32.basename(dest);
  if (path.win32.resolve(source).toLowerCase() === path.win32.resolve(dest).toLowerCase()) throw new Error('Save the register under another name: the client’s blank file is kept as it is.');
  try {
    await deps.copy(source, dest);
  } catch (err) {
    throw new Error(`${name} could not be saved${err instanceof Error ? `: ${err.message}` : '.'}`);
  }
  const cols = fill.hidden.table.reduce((n, row) => Math.max(n, row.length), 0);
  const input = JSON.stringify({
    path: dest,
    sheet: fill.sheet,
    headerRow: fill.headerRow,
    firstRow: fill.firstRow,
    count: fill.count,
    columns: fill.columns.map((c) => ({ col: c.col, cells: c.cells.map(forceText) })),
    key: { col: fill.key.col, label: fill.key.label, cells: fill.key.cells.map(forceText) },
    firstCol: fill.firstCol,
    below: fill.below,
    cells: fill.cells.map((c) => ({ ...c, value: forceText(c.value) })),
    hidden: { name: fill.hidden.name, cols, rows: fill.hidden.table.map((row) => row.map(forceText)) },
    validations: fill.validations,
    dates: fill.dates,
  });
  let answer: string;
  try {
    answer = await deps.run(FILL_SCRIPT, input);
  } catch (err) {
    await deps.remove(dest).catch(() => undefined);
    throw err;
  }
  if (answer === 'ok') return;
  await deps.remove(dest).catch(() => undefined);
  const from = path.win32.basename(source);
  if (answer === 'no-excel') throw new Error('Filling in the client’s file needs Excel, and Excel was not found on this computer. Export a new workbook instead.');
  if (answer === 'protected') throw new Error(`${from} is protected, so rows cannot be written into it. Unprotect the sheet and the workbook in Excel, save it, and export again.`);
  if (answer === 'no-sheet') throw new Error(`${from} no longer has a sheet named “${fill.sheet}”.`);
  throw new Error(`Excel could not fill in ${from}${answer.startsWith('error: ') ? `: ${answer.slice(7)}` : '.'}`);
}

/** Workbooks the person chose in a Save dialog, by ID. Persisted by the caller. */
export class ExcelLinks {
  private paths: Map<string, string>;

  constructor(saved: Record<string, string> = {}) {
    this.paths = new Map(Object.entries(saved).filter(([id, p]) => ID.test(id) && typeof p === 'string' && /\.xlsx$/i.test(p)));
  }

  add(filePath: string): string {
    for (const [id, p] of this.paths) if (p === filePath) return id;
    const id = `xl-${randomBytes(8).toString('hex')}`;
    this.paths.set(id, filePath);
    return id;
  }

  path(id: unknown): string {
    const p = typeof id === 'string' ? this.paths.get(id) : undefined;
    if (!p) throw new Error('That workbook is no longer linked. Choose it again.');
    return p;
  }

  saved(): Record<string, string> {
    return Object.fromEntries(this.paths);
  }
}

/** Reads the saved links, or none. */
export async function loadExcelLinks(file: string): Promise<ExcelLinks> {
  const saved = await fs
    .readFile(file, 'utf8')
    .then((t) => JSON.parse(t) as Record<string, string>)
    .catch(() => ({}));
  return new ExcelLinks(saved);
}
