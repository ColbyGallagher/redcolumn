// Checks two-way Sync to Excel against a real Excel: the desktop app's read and write scripts
// (apps/desktop/src/excel.ts) and the page's cycle planner (apps/web/src/sheetsync/liveSync.ts),
// on a temporary workbook that Excel has open. Unit tests cannot say what Excel does with the cells.
//
// Windows with Excel installed. Excel opens on screen for a few seconds.
//   node --experimental-transform-types --no-warnings --import ./apps/web/test/resolve-ts.mjs scripts/sheetsync-live-check.mjs
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readWorkbookNow, runPowerShell, writeWorkbook } from '../apps/desktop/src/excel.ts';
import { NEW_REPLY, replyColumn } from '../apps/web/src/sheetsync/keyed.ts';
import { bookFromRead, liveOptions, planCycle } from '../apps/web/src/sheetsync/liveSync.ts';
import { HIDDEN_SHEET, buildWorkbook } from '../apps/web/src/sheetsync/xlsx.ts';

const file = path.join(mkdtempSync(path.join(tmpdir(), 'sheetsync-live-')), 'live.xlsx');
const SHEETS = ['Markups', HIDDEN_SHEET];
const columns = [
  { key: 'seq', label: 'ID', edit: 'locked', kind: 'text' },
  { key: 'comment', label: 'Comments', edit: 'editable', kind: 'text' },
  { key: 'status', label: 'Status', edit: 'editable', kind: 'choice', options: ['Accepted', 'Rejected'] },
  { key: 'custom:due', label: 'Due', edit: 'editable', kind: 'date' },
  { key: 'custom:cost', label: 'Cost', edit: 'editable', kind: 'number' },
  replyColumn(NEW_REPLY, 'New reply'),
];
// Text Excel would turn into something else if it were typed: a date, a number, a formula, a boolean.
const row = (n, comment, status = '', due = '', cost = '') => ({ key: `m${n}`, cells: [n, comment, status, due, cost, ''], match: { itemNo: n, sheet: '', comment }, replies: [] });
const table = () => ({ columns, rows: [row(1, '1/2 way along the kerb'), row(2, '0012', 'Accepted', '2026-11-20', 1200.5), row(3, '=SUM(A1)\nsecond line'), row(4, 'TRUE')] });
const opts = (extra = {}) => ({ sheet: 'Markups', docId: 'doc-1', exportedAt: '2026-11-16T00:00:00.000Z', attempted: new Set(), forced: new Set(), ...extra });

const plan = async (doc, extra) => {
  const read = await readWorkbookNow(file, SHEETS);
  return { read, plan: planCycle(await bookFromRead(read), doc, opts(extra)) };
};
const write = (p, stamp) => {
  const [visible, hidden] = p.sheets;
  return writeWorkbook(file, buildWorkbook(p.sheets), visible.table.map((r) => [...r]), 'Markups', undefined, [{ name: hidden.name, table: hidden.table.map((r) => [...r]) }], liveOptions(visible, stamp));
};
/** Runs PowerShell against the open workbook ($book, $ws = the Markups sheet) and returns what it prints. */
const inExcel = (body) =>
  runPowerShell(
    `$ErrorActionPreference = 'Stop'
$xl = [Runtime.InteropServices.Marshal]::GetActiveObject('Excel.Application')
$book = $null
foreach ($b in $xl.Workbooks) { if ($b.FullName -eq '${file}') { $book = $b } }
if (-not $book) { throw 'the workbook is not open' }
$ws = $book.Worksheets.Item('Markups')
${body}`,
    '',
    60_000,
  );

const hadExcel = (await runPowerShell("if (Get-Process excel -ErrorAction SilentlyContinue) { 'yes' } else { 'no' }", '')) === 'yes';
let opened = false;
try {
  // Closed: the file is written, and reads back as exactly what was written.
  let p = (await plan(table())).plan;
  assert.equal(await write(p), 'file');
  let r = await plan(table());
  assert.equal(r.read.kind, 'file');
  assert.equal(r.plan.upToDate, true, 'the written file reads back up to date');

  // Open in Excel.
  await runPowerShell(`Start-Process '${file}'`, '');
  opened = true;
  for (let i = 0; i < 60; i++) {
    r = await plan(table()).catch(() => null);
    if (r?.read.kind === 'live') break;
    await new Promise((done) => setTimeout(done, 1000));
  }
  assert.equal(r?.read.kind, 'live', 'the open workbook is read through Excel');
  assert.match(r.read.stamp, /^[0-9A-F]{40}$/);
  assert.deepEqual([r.plan.apply, r.plan.issues, r.plan.upToDate], [[], [], true], 'the open workbook reads back up to date');

  // Someone types in Excel (not saved): the next cycle sees it.
  await inExcel("$ws.Range('D2').Value2 = 'Rejected'; $ws.Range('G3').Value2 = 'Moved the pit'; $ws.Range('E4').Value2 = 46357");
  r = await plan(table());
  assert.deepEqual(r.plan.apply.map((c) => `${c.rowKey} ${c.column.key}: ${c.to}`), ['m1 status: Rejected', 'm2 newReply: Moved the pit', 'm3 custom:due: 2026-12-01']);

  // Typed between the read and the write: the write is refused and what was typed is still there.
  const stale = r.read.stamp;
  await inExcel("$ws.Range('F2').Value2 = 55");
  const after = table();
  after.rows[0].cells[2] = 'Rejected';
  after.rows[1].replies = ['Moved the pit'];
  after.rows[2].cells[3] = '2026-12-01';
  p = planCycle(await bookFromRead(r.read), after, opts());
  assert.equal(await write(p, stale), 'changed');
  assert.equal(await inExcel("Write-Output $ws.Range('F2').Value2"), '55');

  // Read again, apply, write: the workbook takes it and is up to date, with text still text.
  r = await plan(after);
  assert.deepEqual(r.plan.apply.map((c) => `${c.rowKey} ${c.column.key}: ${c.to}`), ['m1 custom:cost: 55']);
  after.rows[0].cells[4] = 55;
  after.rows.push(row(5, 'Added while open', 'Accepted'));
  r = await plan(after);
  assert.deepEqual(r.plan.apply, []);
  assert.equal(await write(r.plan, r.read.stamp), 'live');
  r = await plan(after);
  assert.deepEqual([r.plan.apply, r.plan.issues, r.plan.upToDate], [[], [], true], 'after a live write the workbook is up to date');
  const state = await inExcel(
    "Write-Output ($ws.Range('C2').Text + '|' + $ws.Range('C3').Text + '|' + $ws.Range('C5').Text + '|' + $ws.Range('C4').HasFormula + '|' + $ws.Range('G3').Text + '|' + $ws.Range('E4').Text + '|' + $ws.Range('D6').Validation.Type + '|' + $ws.Range('E6').Validation.Type + '|' + $ws.Range('F6').Validation.Type + '|' + $ws.Columns.Item(1).Hidden + '|' + $book.Worksheets.Item('_redcolumn').Visible + '|' + $book.Saved)",
  );
  assert.equal(state, '1/2 way along the kerb|0012|TRUE|False||2026-12-01|3|4|2|True|2|True');

  // A conflict: left as typed in Excel, the rest written.
  await inExcel("$ws.Range('D3').Value2 = 'Rejected'");
  const both = structuredClone(after);
  both.columns = columns;
  both.rows[1].cells[2] = '';
  both.rows[2].cells[1] = 'Comment changed here';
  r = await plan(both);
  assert.deepEqual(r.plan.issues.map((i) => `${i.kind} ${i.rowKey} ${i.column.key}`), ['conflict m2 status']);
  assert.equal(await write(r.plan, r.read.stamp), 'live');
  assert.equal(await inExcel("Write-Output ($ws.Range('D3').Text + '|' + $ws.Range('C4').Text)"), 'Rejected|Comment changed here');
  r = await plan(both);
  assert.deepEqual(r.plan.issues.map((i) => i.kind), ['conflict'], 'the conflict is still one after the write');
  console.log('ok');
} finally {
  if (opened) await inExcel(`$book.Close($false); if (${hadExcel ? '$false' : '$true'} -and $xl.Workbooks.Count -eq 0) { $xl.Quit() }`).catch((err) => console.warn(`Excel was left open: ${err.message}`));
}
