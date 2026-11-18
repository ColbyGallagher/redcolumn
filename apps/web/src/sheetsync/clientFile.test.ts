import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_STATUSES, type Markup } from '@nb/markup';
import { DEFAULT_SCALE } from '@nb/measure';
import { buildRows, listColumns, withThreads, type CellContext } from '../columns/listColumns.ts';
import { checkClientFile, planFill } from './clientFile.ts';
import { planImport } from './importExcel.ts';
import { blankKey, exportTemplate, parseTemplateFile, registerSheets, starterTemplate, type RegisterTemplate } from './register.ts';
import { KEY_LABEL, readSnapshot } from './syncWorkbook.ts';
import type { TableCell } from './table.ts';
import { HIDDEN_SHEET, buildWorkbook, type LooseCell, type SheetSpec } from './xlsx.ts';
import { readWorkbook, type ReadWorkbook } from './xlsxRead.ts';

// Filling the client's own register file: where the rows go, and that the filled file imports. The
// client here is the fictional Kestrel Road set. What Excel does with the plan is checked against a
// real Excel by scripts/sheetsync-fill-check.mjs.

function markup(n: number, patch: Partial<Markup> = {}): Markup {
  return { id: `m${n}`, seq: n, type: 'cloud', pageIndex: 0, points: [[10, 10], [50, 40]], style: { stroke: '#ff0000', strokeWidth: 1 }, author: 'Rae Reviewer', createdAt: Date.UTC(2026, 10, n), modifiedAt: n, status: 'none', ...patch } as Markup;
}
const ctx = (): CellContext => ({ scaleOf: () => DEFAULT_SCALE, sheets: { 0: { number: 'KR-C-101', title: 'General arrangement' } as never }, statuses: DEFAULT_STATUSES, columns: [] });
const all = listColumns([]);
const rowsOf = (markups: Markup[]) => withThreads(buildRows(markups, ctx(), {}, null), ctx());
const markups = () => [markup(1, { comment: 'Kerb line clashes with pit lid' }), markup(2, { comment: 'Show the batter extent', status: 'completed' }), markup(3, { comment: 'Label the culvert' })];

const HEADS = ['No.', 'Drawing', 'Comment', 'Raised by', 'Date raised', 'Status', 'Response', 'By', 'Close-out'];
/** The client's register: the table's header on row 7 (index 6) from column B, with a title block above. */
const template = (): RegisterTemplate => {
  const t = starterTemplate('tpl-1', DEFAULT_STATUSES, 1);
  return {
    ...t,
    name: 'Kestrel Road register',
    sheet: 'Review Comments',
    headerRow: 6,
    firstCol: 1,
    columns: t.columns.map((c, i) => ({ ...c, header: HEADS[i]! })),
    statuses: t.statuses.map((s) => (s.id === 'completed' ? { ...s, word: 'Closed' } : s)),
    cells: [
      { row: 0, col: 1, text: 'A title the client’s file has already', bold: true },
      { row: 2, col: 2, value: 'document' },
      { row: 3, col: 2, value: 'reviewer' },
    ],
  };
};
const exportOf = (list: Markup[], t = template()) => ({ rows: rowsOf(list), columns: all, statuses: DEFAULT_STATUSES, template: t, docId: 'doc-1', exportedAt: '2026-11-16T03:00:00.000Z', values: { document: 'KR-C-101 General arrangement', reviewer: '' } });

/** The client's blank file. `extra` are cells beyond the title block and header: rows under the table, say. */
async function clientFile(extra: LooseCell[] = [], header: (TableCell | null)[] = HEADS, sheets: SheetSpec[] = []): Promise<ReadWorkbook> {
  const cells: LooseCell[] = [{ row: 0, col: 1, value: 'KESTREL ROAD UPGRADE' }, { row: 2, col: 1, value: 'Document' }, ...header.flatMap((h, i) => (h === null ? [] : [{ row: 6, col: 1 + i, value: h }])), ...extra];
  return readWorkbook(buildWorkbook([{ name: 'Review Comments', filter: false, table: [], cells }, ...sheets]));
}

test('the client’s file is checked against the template: its sheet, its headings, and that it is blank', async () => {
  assert.deepEqual(checkClientFile(await clientFile(), template()).problems, []);
  // Case, line breaks and spacing in a heading do not count.
  assert.deepEqual(checkClientFile(await clientFile([], ['NO.', 'Drawing', 'Comment', 'Raised  by', 'Date\nraised', 'Status', 'Response', 'By', 'Close-out']), template()).problems, []);

  const moved = checkClientFile(await clientFile(), { ...template(), headerRow: 5 });
  assert.match(moved.problems[0]!, /headings on row 6 of “Review Comments” do not match the template: B6 is blank where the template has “No\.”; C6 is blank .*, and 6 more/);
  const renamed = checkClientFile(await clientFile([], ['No.', 'Drawing', 'Remarks', ...HEADS.slice(3)]), template());
  assert.match(renamed.problems[0]!, /D7 reads “Remarks” where the template has “Comment”\. Check/);

  // The sheet is found by name; a file with one visible sheet needs no name.
  assert.equal(checkClientFile(await clientFile(), { ...template(), sheet: 'Register' }).sheet?.name, 'Review Comments');
  const two = await clientFile([], HEADS, [{ name: 'Notes', filter: false, table: [['Notes']] }]);
  assert.equal(checkClientFile(two, template()).sheet?.name, 'Review Comments');
  assert.match(checkClientFile(two, { ...template(), sheet: 'Register' }).problems[0]!, /no sheet named “Register”\. Its sheets are “Review Comments”, “Notes”/);

  // A register that was already filled in is not the client's blank file.
  const filled = await readWorkbook(buildWorkbook(registerSheets(exportOf(markups()))));
  assert.match(checkClientFile(filled, template()).problems[0]!, /already been filled in/);
  assert.deepEqual(planFill(filled, exportOf(markups())), { ok: false, problem: checkClientFile(filled, template()).problems[0] });
});

test('a heading merged down over a second header row is read from the row above', async () => {
  // "No." and "Comment" sit on row 6 and are merged down to row 7, where the other headings are.
  const header = HEADS.map((h, i) => (i === 0 || i === 2 ? null : h));
  const book = await clientFile([{ row: 5, col: 1, value: 'No.' }, { row: 5, col: 3, value: 'Comment' }, { row: 5, col: 7, value: 'Designer' }], header);
  assert.deepEqual(checkClientFile(book, template()).problems, []);
});

test('the rows go under the header, the keys beside the table, and the details above it', async () => {
  const plan = planFill(await clientFile(), exportOf(markups()));
  assert.ok(plan.ok);
  const f = plan.fill;
  // Rows and columns count from 1 for Excel: the header is row 7, the table starts at B.
  assert.deepEqual([f.sheet, f.headerRow, f.firstRow, f.count, f.firstCol, f.below], ['Review Comments', 7, 8, 3, 2, 0]);
  assert.deepEqual(f.columns.map((c) => c.col), [2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(f.columns[0]!.cells, [1, 2, 3]);
  assert.deepEqual(f.columns[2]!.cells, ['Kerb line clashes with pit lid', 'Show the batter extent', 'Label the culvert']);
  // Statuses in the client's words.
  assert.deepEqual(f.columns[5]!.cells, ['Open', 'Closed', 'Open']);
  assert.deepEqual(f.key, { col: 11, label: KEY_LABEL, cells: ['m1', 'm2', 'm3'] });
  // Only details are written above the table, and only those that have a value: the file has its own title.
  assert.deepEqual(f.cells, [{ row: 3, col: 3, value: 'KR-C-101 General arrangement' }]);
  assert.deepEqual(f.validations.map((v) => [v.col, v.type]), [[7, 'list']]);
  assert.match(f.validations[0]!.formula!, /^='_redcolumn'!\$[A-Z]+\$4:\$[A-Z]+\$\d+$/);
  assert.equal(f.hidden.name, HIDDEN_SHEET);
});

test('what the file has under the table is moved down, not written over, and is not rows added on import', async () => {
  // Two blank rows, then a sign-off block and a total.
  const under: LooseCell[] = [
    { row: 9, col: 1, value: 'Reviewed by' },
    { row: 9, col: 3, value: 'Signature' },
    { row: 10, col: 1, value: 'Total comments' },
    { row: 10, col: 2, value: 0 },
  ];
  const plan = planFill(await clientFile(under), exportOf(markups()));
  assert.ok(plan.ok);
  assert.equal(plan.fill.below, 10);

  // The hidden sheet names those rows, so the import passes over them even after the total has counted.
  const hidden: SheetSpec = { name: HIDDEN_SHEET, state: 'veryHidden', filter: false, table: plan.fill.hidden.table };
  const snap = readSnapshot(await readWorkbook(buildWorkbook([{ name: 'x', table: [['x']] }, hidden])));
  assert.deepEqual(snap?.ignore, ['reviewed by', 'total comments']);
  assert.deepEqual([snap?.sheet, snap?.headerRow, snap?.firstCol], ['Review Comments', 6, 1]);

  // The file as Excel leaves it: the rows written, one row inserted, the block moved down a row, the total counting.
  const f = plan.fill;
  const cells: LooseCell[] = [
    { row: 0, col: 1, value: 'KESTREL ROAD UPGRADE' },
    ...HEADS.map((h, i) => ({ row: 6, col: 1 + i, value: h })),
    { row: 6, col: f.key.col - 1, value: f.key.label },
    ...f.columns.flatMap((c) => c.cells.map((value, r) => ({ row: f.firstRow - 1 + r, col: c.col - 1, value }))),
    ...f.key.cells.map((value, r) => ({ row: f.firstRow - 1 + r, col: f.key.col - 1, value })),
    { row: 10, col: 1, value: 'Reviewed by' },
    { row: 10, col: 3, value: 'R. Viewer' },
    { row: 11, col: 1, value: 'Total comments' },
    { row: 11, col: 2, value: 3 },
    // The designer answers the first comment.
    { row: 7, col: 7, value: 'Pit moved 300 east' },
    // And adds a row of their own, which is reported.
    { row: 12, col: 3, value: 'A comment typed in Excel' },
  ];
  const book = await readWorkbook(buildWorkbook([{ name: 'Review Comments', filter: false, table: [], cells: cells.filter((c) => c.value !== '') }, hidden]));
  const result = planImport(book, { rows: rowsOf(markups()), columns: all, statuses: DEFAULT_STATUSES }, { docId: 'doc-1' });
  assert.equal(result.matched.length, 3);
  assert.ok(result.matched.every((m) => m.via === 'key'));
  assert.deepEqual(result.changes.map((c) => [c.rowKey, c.column.key, c.kind, c.to]), [['m1', 'reply:1', 'replyAdd', 'Pit moved 300 east']]);
  assert.deepEqual(result.skipped.map((s) => [s.reason, s.text]), [['added', 'A comment typed in Excel']]);
});

test('the keys go past everything the file has when the column beside the table is taken', async () => {
  const plan = planFill(await clientFile([{ row: 1, col: 10, value: 'Rev' }, { row: 1, col: 13, value: 'Page 1' }]), exportOf(markups()));
  assert.ok(plan.ok);
  assert.equal(plan.fill.key.col, 15);
});

test('a column the register has nothing for is left as the client’s file has it', async () => {
  const t = template();
  // The client's file has a Discipline column between Drawing and Comment that the reviewer fills in by hand.
  const columns = [...t.columns.slice(0, 2), { header: 'Discipline', field: { kind: 'column' as const, key: blankKey(1) } }, ...t.columns.slice(2)];
  const heads = [...HEADS.slice(0, 2), 'Discipline', ...HEADS.slice(2)];
  const plan = planFill(await clientFile([], heads), exportOf(markups(), { ...t, columns }));
  assert.ok(plan.ok);
  assert.deepEqual(plan.fill.columns.map((c) => c.col), [2, 3, 5, 6, 7, 8, 9, 10, 11]);
  assert.equal(plan.fill.key.col, 12);
});

test('the client’s file is this computer’s: it is not shared with the template', () => {
  const shared = parseTemplateFile(exportTemplate({ ...template(), clientFile: { id: 'xl-0123456789abcdef', name: 'KR register.xlsx' } }));
  assert.equal(shared.clientFile, undefined);
  assert.equal(shared.name, 'Kestrel Road register');
});
