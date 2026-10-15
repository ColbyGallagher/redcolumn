import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
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

/**
 * Text Excel would read as a formula (or a DDE call) gets a leading apostrophe, which Excel keeps
 * as "this is text" and does not show. Markup subjects and comments are other people's words.
 */
export function asText(cell: Cell): Cell {
  return typeof cell === 'string' && /^[=+\-@\t\r]/.test(cell) ? `'${cell}` : cell;
}

/** Writes the table into the workbook open in Excel, then saves it. Input is UTF-8 JSON, base64 on stdin. */
export const LIVE_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
try {
  $in = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())) | ConvertFrom-Json
  try { $xl = [Runtime.InteropServices.Marshal]::GetActiveObject('Excel.Application') } catch { Write-Output 'not-open'; exit 0 }
  $book = $null
  foreach ($b in $xl.Workbooks) { if ([string]::Equals($b.FullName, $in.path, [StringComparison]::OrdinalIgnoreCase)) { $book = $b; break } }
  if (-not $book) {
    # A workbook in a OneDrive folder reports a web address as its FullName; fall back to the file name when only one matches.
    $named = @($xl.Workbooks | Where-Object { [string]::Equals($_.Name, $in.name, [StringComparison]::OrdinalIgnoreCase) })
    if ($named.Count -eq 1) { $book = $named[0] }
  }
  if (-not $book) { Write-Output 'not-open'; exit 0 }
  if ($book.ReadOnly) { Write-Output 'read-only'; exit 0 }
  $ws = $null
  foreach ($s in $book.Worksheets) { if ($s.Name -eq $in.sheet) { $ws = $s; break } }
  if (-not $ws) { $ws = $book.Worksheets.Add(); $ws.Name = $in.sheet }
  $rows = @($in.rows)
  $used = $ws.UsedRange
  $r = [Math]::Max([Math]::Max($rows.Count, $used.Row + $used.Rows.Count - 1), 1)
  $c = [Math]::Max([Math]::Max([int]$in.cols, $used.Column + $used.Columns.Count - 1), 1)
  $grid = New-Object 'object[,]' $r, $c
  for ($i = 0; $i -lt $rows.Count; $i++) {
    $row = @($rows[$i])
    for ($j = 0; $j -lt $row.Count; $j++) { $grid[$i, $j] = $row[$j] }
  }
  $ws.Range($ws.Cells(1, 1), $ws.Cells($r, $c)).Value2 = $grid
  $book.Save()
  Write-Output 'ok'
} catch {
  $m = $_.Exception.Message
  if ($m -match '0x8001010A|0x80010001') { Write-Output 'busy' } else { Write-Output ('error: ' + $m) }
}
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
 * Replaces the workbook, or, while Excel has it open (and so locked), writes the cells into it.
 * `live` reports which happened.
 */
export async function writeWorkbook(filePath: string, xlsx: Uint8Array, table: Table, sheet = 'Markups', deps = { write: writeAtomic, run: runPowerShell }): Promise<'file' | 'live'> {
  try {
    await deps.write(filePath, xlsx);
    return 'file';
  } catch (err) {
    if (!LOCKED.has((err as NodeJS.ErrnoException).code ?? '')) throw new Error(`${path.basename(filePath)} could not be saved${err instanceof Error ? `: ${err.message}` : '.'}`);
  }
  const cols = table.reduce((n, row) => Math.max(n, row.length), 0);
  const input = JSON.stringify({ path: filePath, name: path.basename(filePath), sheet, cols, rows: table.map((row) => row.map(asText)) });
  const answer = await deps.run(LIVE_SCRIPT, input);
  const name = path.basename(filePath);
  if (answer === 'ok') return 'live';
  if (answer === 'busy') throw new Error(`Excel is busy (a cell in ${name} may be being edited). It is tried again shortly.`);
  if (answer === 'read-only') throw new Error(`${name} is open read-only in Excel, so it cannot be updated. Close it there.`);
  if (answer === 'not-open') throw new Error(`${name} is open in another program, so it cannot be updated. Close it there.`);
  throw new Error(`Excel could not update ${name}${answer.startsWith('error: ') ? `: ${answer.slice(7)}` : '.'}`);
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
