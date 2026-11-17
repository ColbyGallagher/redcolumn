// Checks filling a client's own register file against a real Excel: the page's planner
// (apps/web/src/sheetsync/clientFile.ts) and the desktop app's fill script (apps/desktop/src/excel.ts),
// on a made-up client file (the fictional Kestrel Road set) that Excel itself builds, with a merged
// title block, a two-row merged header, a picture, styled rows and a sign-off block under the table.
// Unit tests cannot say what Excel does to such a file.
//
// Windows with Excel installed. Nothing opens on screen.
//   node --experimental-transform-types --no-warnings --import ./apps/web/test/resolve-ts.mjs scripts/sheetsync-fill-check.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checkFill, fillWorkbook, runPowerShell } from '../apps/desktop/src/excel.ts';
import { checkClientFile, planFill } from '../apps/web/src/sheetsync/clientFile.ts';
import { planImport } from '../apps/web/src/sheetsync/importExcel.ts';
import { starterTemplate } from '../apps/web/src/sheetsync/register.ts';
import { readWorkbook } from '../apps/web/src/sheetsync/xlsxRead.ts';
import { buildRows, listColumns, withThreads } from '../apps/web/src/columns/listColumns.ts';
import { DEFAULT_STATUSES } from '../packages/markup/src/index.ts';
import { DEFAULT_SCALE } from '../packages/measure/src/index.ts';

const dir = mkdtempSync(path.join(tmpdir(), 'sheetsync-fill-'));
const blank = path.join(dir, 'KR client register.xlsx');
const out = path.join(dir, 'KR-C-101 register.xlsx');

const ps = (body, input = '') => runPowerShell(`$ErrorActionPreference = 'Stop'\n${body}`, input, 120_000);
const quote = (p) => `'${p.replace(/'/g, "''")}'`;

// The client's blank file: title block in rows 1-4, a two-row header in rows 6-7 (headings merged down,
// the two response columns under one merged "Designer" heading), three bordered blank rows, and a
// sign-off block straight under them.
await ps(`
$xl = New-Object -ComObject Excel.Application
$xl.DisplayAlerts = $false
try {
  $b = $xl.Workbooks.Add()
  $ws = $b.Worksheets.Item(1)
  $ws.Name = 'Review Comments'
  $ws.Range('A1:I1').Merge(); $ws.Range('A1').Value2 = 'KESTREL ROAD UPGRADE'; $ws.Range('A1').Font.Size = 16; $ws.Range('A1').Font.Bold = $true
  $ws.Range('A2:I2').Merge(); $ws.Range('A2').Value2 = 'Design review comment register'
  $ws.Range('A3').Value2 = 'Document'; $ws.Range('B3:E3').Merge()
  $ws.Range('A4').Value2 = 'Issued'; $ws.Range('B4:E4').Merge()
  [void]$ws.Shapes.AddShape(1, 520, 4, 60, 40)
  $heads = @('No.', 'Drawing', 'Comment', 'Raised by', 'Date raised', 'Status')
  for ($i = 0; $i -lt $heads.Count; $i++) { $ws.Cells(6, $i + 1).Value2 = $heads[$i]; $ws.Range($ws.Cells(6, $i + 1), $ws.Cells(7, $i + 1)).Merge() }
  $ws.Range('G6:H6').Merge(); $ws.Range('G6').Value2 = 'Designer'
  $ws.Range('G7').Value2 = 'Response'; $ws.Range('H7').Value2 = 'By'
  $ws.Range('I6').Value2 = 'Close-out'; $ws.Range('I6:I7').Merge()
  $ws.Range('A6:I7').Font.Bold = $true; $ws.Range('A6:I7').Interior.Color = 14277081
  $ws.Range('A6:I10').Borders.LineStyle = 1
  $ws.Range('C8:C10').WrapText = $true; $ws.Range('G8:G10').WrapText = $true
  $ws.Columns.Item(3).ColumnWidth = 40; $ws.Columns.Item(7).ColumnWidth = 40
  $ws.Range('A12').Value2 = 'Reviewed by'; $ws.Range('C12').Value2 = 'Signature'
  $ws.Range('A13').Value2 = 'Total comments'; $ws.Range('B13').Formula = '=COUNTA(C8:C10)'
  [void]$b.Worksheets.Add([Type]::Missing, $ws)
  $b.Worksheets.Item(2).Name = 'Notes'
  $b.Worksheets.Item(2).Range('A1').Value2 = 'Notes for the designer'
  $ws.Activate()
  $b.SaveAs(${quote(blank)}, 51)
  $b.Close($false)
} finally { $xl.Quit() }
'made'`);

const statuses = DEFAULT_STATUSES;
const template = {
  ...starterTemplate('tpl-kestrel', statuses, 0),
  name: 'Kestrel register',
  sheet: 'Review Comments',
  headerRow: 6,
  firstCol: 0,
  cells: [
    { row: 2, col: 1, value: 'document' },
    { row: 3, col: 1, value: 'exportDate' },
  ],
};
template.columns = template.columns.map((c, i) => ({ ...c, header: ['No.', 'Drawing', 'Comment', 'Raised by', 'Date raised', 'Status', 'Response', 'By', 'Close-out'][i] }));
template.statuses = template.statuses.map((s) => (s.id === 'completed' ? { ...s, word: 'Closed' } : s));

const ctx = { scaleOf: () => DEFAULT_SCALE, sheets: { 0: { number: 'KR-C-101', title: 'General arrangement' } }, statuses, columns: [] };
const listCols = listColumns([]);
// Text Excel would turn into something else if it were typed, and more rows than the file has room for.
const comments = ['Kerb line clashes with pit lid', '1/2 way along the kerb', '=SUM(A1) is not a formula', '0012', 'Show the batter extent\nand the toe'];
const markups = comments.map((comment, i) => ({
  id: `m${i + 1}`,
  seq: i + 1,
  type: 'cloud',
  pageIndex: 0,
  points: [[10, 10], [50, 40]],
  style: { stroke: '#ff0000', strokeWidth: 1 },
  author: 'Rae Reviewer',
  createdAt: Date.UTC(2026, 10, 1 + i),
  modifiedAt: i,
  status: i === 1 ? 'accepted' : 'none',
  comment,
  ...(i === 4 ? { replies: [{ id: 'r1', author: 'Priya', text: 'Toe added', createdAt: 1 }] } : {}),
}));
const rows = withThreads(buildRows(markups, ctx, {}, null), ctx);
const exported = { rows, columns: listCols, statuses, template, docId: 'doc-1', exportedAt: '2026-11-16T00:00:00.000Z', values: { document: 'KR-C-101 General arrangement', exportDate: '2026-11-16' } };

const before = await readWorkbook(readFileSync(blank));
assert.deepEqual(checkClientFile(before, template).problems, []);
assert.match(checkClientFile(before, { ...template, headerRow: 5 }).problems[0], /do not match/);
const plan = planFill(before, exported);
assert.equal(plan.ok, true, plan.problem);
assert.equal(plan.fill.below, 12);
const blankSize = statSync(blank).size;
await fillWorkbook(blank, out, checkFill(JSON.parse(JSON.stringify(plan.fill))));
assert.equal(statSync(blank).size, blankSize, 'the client’s file is not written');

// What Excel says about the filled copy. Opening it without a repair prompt is the first check.
const report = JSON.parse(
  await ps(`
$xl = New-Object -ComObject Excel.Application
$xl.DisplayAlerts = $false
try {
  $b = $xl.Workbooks.Open(${quote(out)})
  $ws = $b.Worksheets.Item('Review Comments')
  $o = [ordered]@{}
  $o.sheets = (($b.Worksheets | ForEach-Object { $_.Name + ':' + $_.Visible }) -join ',')
  $o.active = $b.ActiveSheet.Name
  $o.title = [string]$ws.Range('A1').Value2
  $o.titleMerged = [bool]$ws.Range('A1').MergeCells
  $o.document = [string]$ws.Range('B3').Value2
  $o.issued = [string]$ws.Range('B4').Text
  $o.shapes = $ws.Shapes.Count
  $o.headMerged = [bool]$ws.Range('A6').MergeCells
  $o.comment2 = [string]$ws.Range('C9').Value2
  $o.comment3 = [string]$ws.Range('C10').Value2
  $o.comment3Formula = [bool]$ws.Range('C10').HasFormula
  $o.comment4 = [string]$ws.Range('C11').Value2
  $o.no5 = $ws.Range('A12').Value2
  $o.response5 = [string]$ws.Range('G12').Value2
  $o.by5 = [string]$ws.Range('H12').Value2
  $o.status2 = [string]$ws.Range('F9').Value2
  $o.border12 = $ws.Range('C12').Borders.Item(9).LineStyle
  $o.wrap12 = [bool]$ws.Range('C12').WrapText
  $o.signOff = [string]$ws.Range('A14').Value2
  $o.total = [string]$ws.Range('B15').Formula
  $o.totalValue = $ws.Range('B15').Value2
  $o.keyHead = [string]$ws.Range('J7').Value2
  $o.keyHidden = [bool]$ws.Columns.Item(10).Hidden
  $o.key1 = [string]$ws.Range('J8').Value2
  $o.statusValidation = $ws.Range('F8').Validation.Type
  $o.statusFormula = [string]$ws.Range('F8').Validation.Formula1
  $o.protected = [bool]$ws.ProtectContents
  $b.Close($false)
  Add-Type -AssemblyName System.Web.Extensions
  (New-Object System.Web.Script.Serialization.JavaScriptSerializer).Serialize($o)
} finally { $xl.Quit() }`),
);
console.log(report);
assert.equal(report.sheets, 'Review Comments:-1,Notes:-1,_redcolumn:2');
assert.equal(report.active, 'Review Comments');
assert.equal(report.title, 'KESTREL ROAD UPGRADE');
assert.equal(report.titleMerged, true);
assert.equal(report.document, 'KR-C-101 General arrangement');
assert.equal(report.issued, '2026-11-16');
assert.equal(report.shapes, 1);
assert.equal(report.headMerged, true);
assert.equal(report.comment2, '1/2 way along the kerb');
assert.equal(report.comment3, '=SUM(A1) is not a formula');
assert.equal(report.comment3Formula, false);
assert.equal(report.comment4, '0012');
assert.equal(report.no5, 5);
assert.equal(report.response5, 'Toe added');
assert.equal(report.by5, 'Priya');
assert.equal(report.status2, 'Accepted');
assert.equal(report.border12, 1, 'an inserted row looks like the rows above it');
assert.equal(report.wrap12, true);
assert.equal(report.signOff, 'Reviewed by');
assert.equal(report.total, '=COUNTA(C8:C12)', 'the client’s formula grows with the rows');
assert.equal(report.totalValue, 5);
assert.equal(report.keyHead, 'redcolumn key');
assert.equal(report.keyHidden, true);
assert.equal(report.key1, 'm1');
assert.equal(report.statusValidation, 3);
assert.equal(report.protected, false);

// The filled copy imports: every row by its key, nothing to change, and the sign-off block is not rows added.
const book = await readWorkbook(readFileSync(out));
const source = { rows, columns: listCols, statuses, templates: [template] };
const same = planImport(book, source, { docId: 'doc-1' });
assert.equal(same.noTable, false);
assert.equal(same.matched.length, 5);
assert.ok(same.matched.every((m) => m.via === 'key'));
assert.deepEqual([same.changes, same.unknown, same.skipped, same.removed], [[], [], [], []]);

// The designer answers in Excel and closes one out in the client's word; that comes back.
await ps(`
$xl = New-Object -ComObject Excel.Application
$xl.DisplayAlerts = $false
try {
  $b = $xl.Workbooks.Open(${quote(out)})
  $ws = $b.Worksheets.Item('Review Comments')
  $ws.Range('F8').Value2 = 'Closed'
  $ws.Range('G8').Value2 = 'Pit moved 300 east'
  $ws.Range('H8').Value2 = 'Priya Designer'
  $ws.Range('C14').Value2 = 'R. Viewer'
  $b.Save()
  $b.Close($false)
} finally { $xl.Quit() }
'typed'`);
const edited = planImport(await readWorkbook(readFileSync(out)), source, { docId: 'doc-1' });
assert.deepEqual(
  edited.changes.map((c) => [c.rowKey, c.column.key, c.kind, c.to, c.author]),
  [
    ['m1', 'status', 'edit', 'Closed', undefined],
    ['m1', 'reply:1', 'replyAdd', 'Pit moved 300 east', 'Priya Designer'],
  ],
);
// The sign-off row someone signed is not a row added to the table.
assert.deepEqual(edited.skipped, []);
console.log('ok');
