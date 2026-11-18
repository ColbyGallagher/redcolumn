import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ExcelRead } from '../desktop/host.ts';
import { NEW_REPLY, replyColumn, type SyncColumn, type SyncRow, type SyncTable } from './keyed.ts';
import { bookFromRead, changeId, issueId, liveOptions, planCycle, type CycleOptions, type CyclePlan } from './liveSync.ts';
import type { TableCell } from './table.ts';
import { HIDDEN_SHEET, buildWorkbook, excelSerial, type SheetSpec } from './xlsx.ts';

const COLUMNS: SyncColumn[] = [
  { key: 'seq', label: 'ID', edit: 'locked', kind: 'text' },
  { key: 'comment', label: 'Comments', edit: 'editable', kind: 'text' },
  { key: 'status', label: 'Status', edit: 'editable', kind: 'choice', options: ['Accepted', 'Rejected'] },
  { key: 'custom:due', label: 'Due', edit: 'editable', kind: 'date' },
  replyColumn(NEW_REPLY, 'New reply'),
];
const AT = { key: 0, seq: 1, comment: 2, status: 3, due: 4, reply: 5 };
const row = (n: number, comment: string, status = '', due = '', replies: string[] = []): SyncRow => ({ key: `m${n}`, cells: [n, comment, status, due, ''], match: { itemNo: n, sheet: '', comment }, replies });
const doc = (): SyncTable => ({ columns: COLUMNS, rows: [row(1, 'Kerb line'), row(2, '1/2 way along', 'Accepted', '2026-11-20'), row(3, 'Culvert label')] });

const opts = (o: Partial<CycleOptions> = {}): CycleOptions => ({ sheet: 'Markups', docId: 'doc-1', exportedAt: 't0', attempted: new Set(), forced: new Set(), ...o });

/** What Excel holds after a write: the sheets' cells, read back live (the desktop app reads Value2, so no formats). */
const live = (sheets: readonly SheetSpec[], edit?: (visible: TableCell[][]) => void): ExcelRead => {
  const copy = sheets.map((s) => ({ name: s.name, rows: s.table.map((r) => r.map((v): string | number | null => (v === '' ? null : v))) }));
  edit?.(copy[0]!.rows as TableCell[][]);
  return { kind: 'live', stamp: 'ABC', sheets: copy };
};
const cycle = async (read: ExcelRead, table: SyncTable, o?: Partial<CycleOptions>): Promise<CyclePlan> => planCycle(await bookFromRead(read), table, opts(o));
const brief = (p: CyclePlan) => p.apply.map((c) => `${c.rowKey} ${c.column.key}: ${c.to}`);

test('no workbook yet: everything is written, nothing applied', async () => {
  const plan = await cycle({ kind: 'none' }, doc());
  assert.deepEqual([plan.apply, plan.issues, plan.upToDate], [[], [], false]);
  assert.deepEqual(plan.sheets.map((s) => s.name), ['Markups', HIDDEN_SHEET]);
  assert.equal(plan.sheets[0]!.table[2]![AT.due], excelSerial(Date.UTC(2026, 10, 20)));
});

test('what was written reads back as up to date, from the open workbook and from the file', async () => {
  const first = await cycle({ kind: 'none' }, doc());
  const again = await cycle(live(first.sheets), doc());
  assert.deepEqual([again.apply, again.issues, again.upToDate], [[], [], true]);
  const file = await cycle({ kind: 'file', bytes: buildWorkbook(first.sheets) }, doc());
  assert.deepEqual([file.apply, file.issues, file.upToDate], [[], [], true]);
});

test('edits typed in Excel are applied; once the document has them the sheet is written with a new base', async () => {
  const first = await cycle({ kind: 'none' }, doc());
  const typed = live(first.sheets, (v) => {
    v[1]![AT.status] = 'Rejected';
    v[1]![AT.reply] = 'Moved the pit';
    v[3]![AT.due] = 46357;
  });
  const plan = await cycle(typed, doc());
  assert.deepEqual(brief(plan), ['m1 status: Rejected', 'm1 newReply: Moved the pit', 'm3 custom:due: 2026-12-01']);
  // The document after the changes were applied.
  const after = doc();
  after.rows[0]!.cells[AT.status - 1] = 'Rejected';
  after.rows[0]!.replies = ['Moved the pit'];
  after.rows[2]!.cells[AT.due - 1] = '2026-12-01';
  const next = await cycle(typed, after, { attempted: new Set(plan.apply.map(changeId)) });
  assert.deepEqual([next.apply, next.issues], [[], []]);
  assert.equal(next.upToDate, false, 'the base and the answered reply cell are still to write');
  assert.equal(next.sheets[0]!.table[1]![AT.reply], '', 'the New reply cell is cleared once it is a reply');
  const settled = await cycle(live(next.sheets), after);
  assert.deepEqual([settled.apply, settled.upToDate], [[], true]);
});

test('a change the document did not take is not tried again: it is held as an issue', async () => {
  const first = await cycle({ kind: 'none' }, doc());
  const typed = live(first.sheets, (v) => void (v[1]![AT.comment] = 'Kerb line, east side'));
  const plan = await cycle(typed, doc());
  assert.equal(plan.apply.length, 1);
  const stuck = await cycle(typed, doc(), { attempted: new Set(plan.apply.map(changeId)) });
  assert.deepEqual(stuck.apply, []);
  assert.deepEqual(stuck.issues.map((i) => `${i.kind} ${i.rowKey} ${i.mine} / ${i.theirs} ${i.change ? 'takeable' : 'held'}`), ['blocked m1 Kerb line / Kerb line, east side held']);
  assert.equal(stuck.sheets[0]!.table[1]![AT.comment], 'Kerb line, east side', 'Excel keeps what was typed');
  // A different edit to the same cell is a new change.
  const retyped = await cycle(live(first.sheets, (v) => void (v[1]![AT.comment] = 'Kerb line, west side')), doc(), { attempted: new Set(plan.apply.map(changeId)) });
  assert.equal(retyped.apply.length, 1);
});

test('a conflict pauses that cell only, until a side is picked', async () => {
  const first = await cycle({ kind: 'none' }, doc());
  const typed = live(first.sheets, (v) => {
    v[2]![AT.status] = 'Rejected';
    v[3]![AT.status] = 'Accepted';
  });
  const changed = doc();
  changed.rows[1]!.cells[AT.status - 1] = '';
  changed.rows[0]!.cells[AT.comment - 1] = 'Kerb line moved';
  const plan = await cycle(typed, changed);
  assert.deepEqual(brief(plan), ['m3 status: Accepted'], 'the other edit still goes through');
  assert.deepEqual(plan.issues.map((i) => `${i.kind} ${i.rowKey} ${i.column.key} ${i.mine || '(blank)'} / ${i.theirs}`), ['conflict m2 status (blank) / Rejected']);
  assert.equal(plan.sheets[0]!.table[2]![AT.status], 'Rejected', 'left as it is in Excel');
  assert.equal(plan.sheets[0]!.table[1]![AT.comment], 'Kerb line moved', 'the rest of the sheet is still written');
  assert.equal(plan.sheets[1]!.table[4]![2 + AT.status - 1], 'Accepted', 'the exported value is kept, so the conflict is still one next time');
  // Written like that, the conflict is found again.
  const held = await cycle(live(plan.sheets), changed, { attempted: new Set(plan.apply.map(changeId)) });
  assert.equal(held.issues.filter((i) => i.kind === 'conflict').length, 1);
  // "Use this document's": the document's value is written over Excel's.
  const mine = await cycle(live(plan.sheets), changed, { forced: new Set([issueId('m2', 'status')]), attempted: new Set(plan.apply.map(changeId)) });
  assert.equal(mine.issues.filter((i) => i.kind === 'conflict').length, 0);
  assert.equal(mine.sheets[0]!.table[2]![AT.status], '');
  // "Use Excel's" is the conflict's change, applied by the hook.
  assert.equal(plan.issues[0]!.change!.to, 'Rejected');
});

test('a value the column does not take is held, not applied', async () => {
  const first = await cycle({ kind: 'none' }, doc());
  const plan = await cycle(live(first.sheets, (v) => void (v[1]![AT.status] = 'Closed out')), doc());
  assert.deepEqual(plan.apply, []);
  assert.deepEqual(plan.issues.map((i) => `${i.kind} ${i.theirs} ${i.change ? 'takeable' : 'held'}`), ['unknown Closed out held']);
  assert.equal(plan.sheets[0]!.table[1]![AT.status], 'Closed out');
});

test('rows keep the order Excel has; a deleted row comes back, a new markup goes at the end', async () => {
  const first = await cycle({ kind: 'none' }, doc());
  const sorted = live(first.sheets, (v) => {
    const [head, a, b, c] = v;
    v.splice(0, v.length, head!, c!, a!);
    void b;
  });
  const table = doc();
  table.rows.push(row(4, 'New since'));
  const plan = await cycle(sorted, table);
  assert.deepEqual(plan.sheets[0]!.table.slice(1).map((r) => r[AT.key]), ['m3', 'm1', 'm2', 'm4']);
  assert.deepEqual(plan.apply, []);
});

test('a sheet from before two-way sync, or from another document, is written over without reading edits from it', async () => {
  const legacy: ExcelRead = { kind: 'live', stamp: 'X', sheets: [{ name: 'Markups', rows: [['ID', 'Comments', 'Status'], [1, 'Kerb line', 'Rejected']] }] };
  const plan = await cycle(legacy, doc());
  assert.deepEqual([plan.apply, plan.issues, plan.upToDate], [[], [], false]);
  const other = await planCycle(await bookFromRead({ kind: 'none' }), doc(), opts({ docId: 'doc-2' }));
  const foreign = await cycle(live(other.sheets, (v) => void (v[1]![AT.status] = 'Rejected')), doc());
  assert.deepEqual([foreign.apply, foreign.issues, foreign.upToDate], [[], [], false]);
});

test('liveOptions carries the stamp and the dropdowns for the open workbook', async () => {
  const plan = await cycle({ kind: 'none' }, doc());
  const o = liveOptions(plan.sheets[0]!, 'ABC');
  assert.equal(o.stamp, 'ABC');
  assert.equal(o.hideKey, true);
  assert.equal(o.text, true);
  assert.deepEqual(o.hidden, [HIDDEN_SHEET]);
  assert.deepEqual(o.validations, [{ col: AT.status + 1, type: 'list', formula: "='_redcolumn'!$I$4:$I$5" }, { col: AT.due + 1, type: 'date' }]);
  assert.equal(liveOptions(plan.sheets[0]!, undefined).stamp, undefined);
});
