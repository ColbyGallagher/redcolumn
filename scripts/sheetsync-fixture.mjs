// Makes apps/web/src/sheetsync/fixtures/excel.xlsx: a register built by the app's .xlsx writer, opened
// in Excel, filled in the way a designer would, and saved by Excel. Excel rewrites the whole file
// (shared strings, compression, its own part order), so the reader's tests run against what Excel
// really produces. On the way it checks what only Excel can say: the file opens without a repair,
// locked cells refuse typing, the dropdown is there and the password unprotects the sheet.
//
// Windows with Excel installed:
//   node --experimental-transform-types --no-warnings --import ./apps/web/test/resolve-ts.mjs scripts/sheetsync-fixture.mjs
//
// The LibreOffice fixture (fixtures/libreoffice.xlsx) is made by hand: open the source this prints,
// make the same three edits, and save as .xlsx.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HIDDEN_SHEET, buildWorkbook, excelSerial, listRange } from '../apps/web/src/sheetsync/xlsx.ts';

const PASSWORD = 'kestrel';
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '../apps/web/src/sheetsync/fixtures');
const dir = mkdtempSync(path.join(tmpdir(), 'sheetsync-'));
const source = path.join(dir, 'source.xlsx');
const broken = path.join(dir, 'broken.xlsx');

const register = {
  name: 'Register',
  origin: { row: 2, col: 0 },
  cells: [{ row: 0, col: 1, value: 'Kestrel Road upgrade', bold: true }],
  table: [
    ['Key', 'Item No', 'Comment', 'Status', 'Response', 'Due'],
    ['m-001', 'KR-001', 'Kerb line clashes with pit lid\nsee detail 4', 'Open', '', ''],
    ['m-002', 'KR-002', '=not a formula', 'Open', '', ''],
  ],
  formats: [undefined, undefined, undefined, undefined, undefined, 'date'],
  hiddenColumns: new Set([0]),
  wrap: new Set([2, 4]),
  protection: { password: PASSWORD, unlocked: new Set([3, 4, 5]) },
  validations: [
    { column: 3, kind: 'list', source: listRange(HIDDEN_SHEET, 0, 1, 3), message: 'Choose Open, Closed or Agreed.' },
    { column: 5, kind: 'date', message: 'Enter a date.' },
  ],
};
const hidden = { name: HIDDEN_SHEET, state: 'veryHidden', filter: false, table: [['status'], ['Open'], ['Closed'], ['Agreed']] };
writeFileSync(source, buildWorkbook([register, hidden]));
// A file Excel has to repair (a sheet with no closing tag), to prove the repair check below can fail.
const bad = Buffer.from(buildWorkbook([register, hidden]));
const at = bad.indexOf('</sheetData>');
bad.write('</sheetDatx>', at, 'latin1');
writeFileSync(broken, bad);

mkdirSync(out, { recursive: true });
const target = path.join(out, 'excel.xlsx');
const ps = String.raw`
$ErrorActionPreference = 'Stop'
$xl = New-Object -ComObject Excel.Application
$xl.Visible = $false
$xl.DisplayAlerts = $false
$fail = @()
try {
  $book = $xl.Workbooks.Open('${source}')
  if ($xl.ActiveWindow.Caption -match 'Repaired') { $fail += 'Excel repaired the workbook' }
  $ws = $book.Worksheets.Item('Register')
  if ($book.Worksheets.Item('${HIDDEN_SHEET}').Visible -ne 2) { $fail += 'the hidden sheet is not very hidden' }
  if (-not $ws.ProtectContents) { $fail += 'the sheet is not protected' }
  if (-not $ws.Columns.Item(1).Hidden) { $fail += 'the key column is not hidden' }
  if (-not $ws.AutoFilterMode) { $fail += 'no AutoFilter' }
  if ($ws.Range('C5').HasFormula) { $fail += 'formula-like text became a formula' }
  $v = $ws.Range('D4').Validation
  if ($v.Type -ne 3) { $fail += 'no list validation on Status' }
  $locked = $false
  try { $ws.Range('C4').Value2 = 'overtyped' } catch { $locked = $true }
  if (-not $locked) { $fail += 'a locked cell accepted typing' }
  $ws.Range('D4').Value2 = 'Closed'
  $ws.Range('E4').Value2 = 'Pit moved 300 east'
  $ws.Range('F4').Value2 = ${excelSerial(Date.UTC(2026, 10, 20))}
  if ($ws.Range('F4').Text -ne '2026-11-20') { $fail += 'the date cell shows ' + $ws.Range('F4').Text }
  $book.SaveAs('${target}', 51)
  $wrong = $false
  try { $ws.Unprotect('not the password') } catch { $wrong = $true }
  if (-not $wrong) { $fail += 'a wrong password unprotected the sheet' }
  $ws.Unprotect('${PASSWORD}')
  if ($ws.ProtectContents) { $fail += 'the password did not unprotect the sheet' }
  $book.Close($false)
  # Opened from a script, a file that needs repair fails to open. Checked last: it proves the open above would have failed too.
  $refused = $false
  try { $b = $xl.Workbooks.Open('${broken}'); $b.Close($false) } catch { $refused = $true }
  if (-not $refused) { $fail += 'the repair check did not notice a broken file' }
} finally {
  $xl.Quit()
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($xl)
}
if ($fail.Count) { Write-Output ('FAILED: ' + ($fail -join '; ')); exit 1 }
Write-Output 'ok'
`;
const script = path.join(dir, 'make.ps1');
writeFileSync(script, ps);
console.log(`source: ${source}`);
console.log(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], { encoding: 'utf8' }).trim());
console.log(`wrote ${target}`);
