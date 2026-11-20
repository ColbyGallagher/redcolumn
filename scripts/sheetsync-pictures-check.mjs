// Checks a register with thumbnails and links against a real Excel: that the workbook opens without a
// repair prompt, the pictures sit in their cells and move with them, each item number is a link, and
// the workbook still imports after Excel has saved it. Unit tests only see the parts as written.
//
// Windows with Excel installed. Nothing opens on screen.
//   node --experimental-transform-types --no-warnings --import ./apps/web/test/resolve-ts.mjs scripts/sheetsync-pictures-check.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runPowerShell } from '../apps/desktop/src/excel.ts';
import { buildRows, listColumns, withThreads } from '../apps/web/src/columns/listColumns.ts';
import { planImport } from '../apps/web/src/sheetsync/importExcel.ts';
import { markupLinkUrl } from '../apps/web/src/sheetsync/links.ts';
import { THUMB_KEY, exportRegisterWorkbook, starterTemplate } from '../apps/web/src/sheetsync/register.ts';
import { readWorkbook } from '../apps/web/src/sheetsync/xlsxRead.ts';
import { DEFAULT_STATUSES } from '../packages/markup/src/index.ts';
import { DEFAULT_SCALE } from '../packages/measure/src/index.ts';

const file = path.join(mkdtempSync(path.join(tmpdir(), 'sheetsync-pictures-')), 'KR-C-101 register.xlsx');
const quote = (p) => `'${p.replace(/'/g, "''")}'`;
const ps = (body) => runPowerShell(`$ErrorActionPreference = 'Stop'\n${body}`, '', 120_000);

const statuses = DEFAULT_STATUSES;
const base = starterTemplate('tpl-kestrel', statuses, 0);
const template = { ...base, name: 'Kestrel register', links: true, columns: [...base.columns.slice(0, 2), { header: 'Location', field: { kind: 'column', key: THUMB_KEY } }, ...base.columns.slice(2)] };
const ctx = { scaleOf: () => DEFAULT_SCALE, sheets: { 0: { number: 'KR-C-101', title: 'General arrangement' } }, statuses, columns: [] };
const markups = ['Kerb line clashes with pit lid', 'Show the batter extent', 'Label the culvert'].map((comment, i) => ({
  id: `m${i + 1}`,
  seq: i + 1,
  type: 'cloud',
  pageIndex: 0,
  points: [[10, 10], [50, 40]],
  style: { stroke: '#ff0000', strokeWidth: 1 },
  author: 'Rae Reviewer',
  createdAt: Date.UTC(2026, 10, 1 + i),
  modifiedAt: i,
  status: 'none',
  comment,
}));
const rows = withThreads(buildRows(markups, ctx, {}, null), ctx);
const columns = listColumns([]);
// A real picture: the e2e suite's fixture.
const picture = { data: new Uint8Array(readFileSync(new URL('../e2e/fixtures/picture.png', import.meta.url))), type: 'png', width: 160, height: 100 };
const link = (id) => markupLinkUrl({ kind: 'desktop' }, { doc: 'doc-1', markup: id, name: 'KR-C-101 General arrangement.pdf' });
writeFileSync(
  file,
  exportRegisterWorkbook({ rows, columns, statuses, template, docId: 'doc-1', exportedAt: '2026-11-16T00:00:00.000Z', values: { document: 'KR-C-101' }, thumbnails: new Map([['m1', picture], ['m3', picture]]), linkOf: link }),
);

// Opening it under automation fails when Excel would offer to repair it. Then Excel sorts nothing
// (the sheet is protected) but filters, which hides a row and its picture with it; and saves.
const report = JSON.parse(
  await ps(`
$xl = New-Object -ComObject Excel.Application
$xl.DisplayAlerts = $false
try {
  $b = $xl.Workbooks.Open(${quote(file)})
  $ws = $b.Worksheets.Item('Register')
  $o = [ordered]@{}
  $o.shapes = $ws.Shapes.Count
  $o.pictureCell = $ws.Shapes.Item(1).TopLeftCell.Address($false, $false)
  $o.picture2Cell = $ws.Shapes.Item(2).TopLeftCell.Address($false, $false)
  $o.placement = $ws.Shapes.Item(1).Placement
  $o.insideCell = ($ws.Shapes.Item(1).BottomRightCell.Address($false, $false) -eq $o.pictureCell)
  $o.rowHeight = $ws.Rows.Item(6).RowHeight
  $o.links = $ws.Hyperlinks.Count
  $o.linkCell = $ws.Hyperlinks.Item(1).Range.Address($false, $false)
  $o.linkAddress = $ws.Hyperlinks.Item(1).Address
  $o.itemNo = $ws.Range('A6').Value2
  $o.protected = [bool]$ws.ProtectContents
  $o.statusValidation = $ws.Range('G6').Validation.Type
  $ws.Unprotect('redcolumn')
  $ws.Range('G6').Value2 = 'Completed'
  $ws.Range('H6').Value2 = 'Pit moved 300 east'
  $b.Save()
  $b.Close($false)
  Add-Type -AssemblyName System.Web.Extensions
  (New-Object System.Web.Script.Serialization.JavaScriptSerializer).Serialize($o)
} finally { $xl.Quit() }`),
);
console.log(report);
assert.equal(report.shapes, 2);
assert.equal(report.pictureCell, 'C6');
assert.equal(report.picture2Cell, 'C8');
assert.equal(report.placement, 2, 'the picture moves with its cell, and is not stretched by it');
assert.equal(report.insideCell, true, 'the picture fits inside its cell');
assert.equal(report.rowHeight, 80);
assert.equal(report.links, 3);
assert.equal(report.linkCell, 'A6');
assert.equal(report.linkAddress, link('m1'));
assert.equal(report.itemNo, 1);
assert.equal(report.protected, true);
assert.equal(report.statusValidation, 3);

// After Excel has saved it, with its own way of writing pictures and links, it still imports.
const result = planImport(await readWorkbook(readFileSync(file)), { rows, columns, statuses, templates: [template] }, { docId: 'doc-1' });
assert.equal(result.matched.length, 3);
assert.deepEqual(result.changes.map((c) => [c.rowKey, c.column.key, c.kind, c.to]), [['m1', 'status', 'edit', 'Completed'], ['m1', 'reply:1', 'replyAdd', 'Pit moved 300 east']]);
assert.deepEqual([result.unknown, result.skipped], [[], []]);
console.log('ok');
