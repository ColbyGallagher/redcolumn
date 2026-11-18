import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NEW_REPLY, canon, replyColumn, replyKey, syncColumn, toSyncTable, type SyncColumn, type SyncRow, type SyncTable } from './keyed.ts';
import { mergeWorkbook, onByDefault, type MergeResult } from './merge.ts';
import { KEY_LABEL, buildSyncSheets, readSnapshot } from './syncWorkbook.ts';
import type { TableCell } from './table.ts';
import { HIDDEN_SHEET, buildWorkbook, excelSerial, type SheetSpec } from './xlsx.ts';
import { readWorkbook } from './xlsxRead.ts';

const COLUMNS: SyncColumn[] = [
  { key: 'seq', label: 'Item No', edit: 'locked', kind: 'text' },
  { key: 'sheet', label: 'Sheet', edit: 'locked', kind: 'text' },
  { key: 'comment', label: 'Comment', edit: 'editable', kind: 'text' },
  { key: 'status', label: 'Status', edit: 'editable', kind: 'choice', options: ['Open', 'Closed', 'Agreed'] },
  { key: 'checked', label: 'Checked', edit: 'editable', kind: 'check' },
  { key: 'custom:due', label: 'Due', edit: 'editable', kind: 'date' },
  { key: 'custom:cost', label: 'Cost', edit: 'editable', kind: 'number' },
  replyColumn(replyKey(1), 'Designer Response'),
  replyColumn(replyKey(2), 'Reviewer Close-out'),
];
// Column positions on the visible sheet (the hidden key column is first).
const AT = { key: 0, seq: 1, sheet: 2, comment: 3, status: 4, checked: 5, due: 6, cost: 7, r1: 8, r2: 9 };

function row(n: number, sheet: string, comment: string, rest: Partial<{ status: string; checked: string; due: string; cost: TableCell; replies: string[] }> = {}): SyncRow {
  const replies = rest.replies ?? [];
  return {
    key: `m${n}`,
    cells: [n, sheet, comment, rest.status ?? 'Open', rest.checked ?? 'No', rest.due ?? '', rest.cost ?? '', replies[0] ?? '', replies[1] ?? ''],
    match: { itemNo: n, sheet, comment },
    replies,
  };
}

const doc = (): SyncTable => ({
  columns: COLUMNS,
  rows: [
    row(1, 'KR-C-101', 'Kerb line clashes with pit lid'),
    row(2, 'KR-C-101', 'Show the batter extent', { due: '2026-11-20', cost: 1200.5 }),
    row(3, 'KR-C-102', 'Label the culvert', { replies: ['Label added'] }),
    row(4, 'KR-C-103', 'Missing chainage'),
  ],
});

const OPTS = { sheet: 'Register', docId: 'doc-1', exportedAt: '2026-11-16T00:00:00.000Z' };

/** Exports `exported`, lets `edit` change the sheets the way someone would in Excel, and merges the result into `current`. */
async function roundTrip(edit: (visible: TableCell[][], sheets: SheetSpec[]) => SheetSpec[] | void, current: SyncTable = doc(), exported: SyncTable = doc(), sheetOpts: Partial<Parameters<typeof buildSyncSheets>[1]> = {}): Promise<MergeResult> {
  let sheets = buildSyncSheets(exported, { ...OPTS, ...sheetOpts });
  const visible = sheets[0]!.table.map((r) => [...r]);
  sheets[0] = { ...sheets[0]!, table: visible };
  sheets = edit(visible, sheets) ?? sheets;
  return mergeWorkbook(await readWorkbook(buildWorkbook(sheets)), current, { docId: 'doc-1' });
}

const brief = (r: MergeResult) => r.changes.map((c) => `${c.rowKey} ${c.column.key} ${c.kind}: ${c.from} -> ${c.to}`);

test('an untouched export changes nothing', async () => {
  const r = await roundTrip(() => undefined);
  assert.equal(r.noTable, false);
  assert.equal(r.hasSnapshot, true);
  assert.equal(r.wrongDocument, false);
  assert.equal(r.exportedAt, OPTS.exportedAt);
  assert.deepEqual(r.matched.map((m) => `${m.key} ${m.via}`), ['m1 key', 'm2 key', 'm3 key', 'm4 key']);
  assert.deepEqual([r.changes, r.unknown, r.skipped, r.removed], [[], [], [], []]);
});

test('edits in Excel become changes, each kind read the way Excel stores it', async () => {
  const r = await roundTrip((v) => {
    v[1]![AT.status] = 'closed';
    v[1]![AT.checked] = 'Yes';
    v[1]![AT.due] = excelSerial(Date.UTC(2026, 11, 1));
    v[1]![AT.cost] = 250;
    v[2]![AT.comment] = 'Show the batter extent\nand the toe';
    v[2]![AT.due] = '';
    v[2]![AT.cost] = '1,300';
  });
  assert.deepEqual(brief(r), [
    'm1 status edit: Open -> Closed',
    'm1 checked edit: false -> true',
    'm1 custom:due edit:  -> 2026-12-01',
    'm1 custom:cost edit:  -> 250',
    'm2 comment edit: Show the batter extent -> Show the batter extent\nand the toe',
    'm2 custom:due edit: 2026-11-20 -> ',
    'm2 custom:cost edit: 1200.5 -> 1300',
  ]);
  assert.ok(r.changes.every(onByDefault));
});

test('locked columns are ignored', async () => {
  const r = await roundTrip((v) => {
    v[1]![AT.sheet] = 'KR-C-999';
    v[1]![AT.seq] = 1;
  });
  assert.deepEqual(r.changes, []);
});

test('both sides changed: the same value is nothing, different values are a conflict', async () => {
  const current = doc();
  current.rows[0]!.cells[AT.status - 1] = 'Closed';
  current.rows[1]!.cells[AT.status - 1] = 'Agreed';
  current.rows[2]!.cells[AT.comment - 1] = 'Label the culvert and headwall';
  const r = await roundTrip((v) => {
    v[1]![AT.status] = 'Closed';
    v[2]![AT.status] = 'Closed';
  }, current);
  assert.deepEqual(brief(r), ['m2 status conflict: Agreed -> Closed']);
  assert.equal(r.changes[0]!.base, 'Open');
  assert.equal(onByDefault(r.changes[0]!), false);
});

test('importing the same file twice: the second import is a no-op', async () => {
  const edit = (v: TableCell[][]) => {
    v[1]![AT.status] = 'Closed';
    v[1]![AT.r1] = 'Pit moved 300 east';
    v[4]![AT.cost] = 40;
  };
  const first = await roundTrip(edit);
  assert.equal(first.changes.length, 3);
  // The document after the first import.
  const after = doc();
  after.rows[0]!.cells[AT.status - 1] = 'Closed';
  after.rows[0]!.cells[AT.r1 - 1] = 'Pit moved 300 east';
  after.rows[0]!.replies = ['Pit moved 300 east'];
  after.rows[3]!.cells[AT.cost - 1] = 40;
  assert.deepEqual((await roundTrip(edit, after)).changes, []);
});

test('sorted and filtered-out rows still match by key', async () => {
  const r = await roundTrip((v) => {
    const [head, a, b, c, d] = v;
    v.splice(0, v.length, head!, d!, b!, a!);
    void c;
    v[3]![AT.status] = 'Agreed';
  });
  assert.deepEqual(brief(r), ['m1 status edit: Open -> Agreed']);
  assert.deepEqual(r.matched.map((m) => m.key), ['m4', 'm2', 'm1']);
  assert.deepEqual(r.removed, ['m3'], 'a removed row is reported and its markup left alone');
});

test('a deleted key column falls back to the Item No on the hidden sheet', async () => {
  const r = await roundTrip((v) => {
    for (const line of v) line.shift();
    v[2]![AT.status - 1] = 'Closed';
  });
  assert.deepEqual(r.matched.map((m) => m.via), ['hidden', 'hidden', 'hidden', 'hidden']);
  assert.deepEqual(brief(r), ['m2 status edit: Open -> Closed']);
  assert.equal(r.changes[0]!.base, 'Open');
});

test('rows copied into a new workbook match by Item No, then by sheet and comment', async () => {
  const current = doc();
  current.rows[1]!.cells[AT.status - 1] = 'Agreed';
  const r = await roundTrip((v, sheets) => {
    for (const line of v) line.shift();
    v[1]![AT.status - 1] = 'Closed';
    v[2]![AT.status - 1] = 'Closed';
    v[3]![AT.seq - 1] = '';
    v[3]![AT.r2 - 1] = 'Closed out on site';
    v[4]![AT.seq - 1] = '';
    v[4]![AT.comment - 1] = 'Missing chainage at the bridge';
    // A plain copy: no hidden sheet, no protection, a different sheet name.
    return [{ name: 'Sheet1', table: v }];
  }, current);
  assert.equal(r.hasSnapshot, false);
  assert.equal(r.sheet, 'Sheet1');
  assert.deepEqual(r.matched.map((m) => `${m.key} ${m.via}`), ['m1 itemNo', 'm2 itemNo', 'm3 text']);
  // Without the exported values the document's value is the base: a difference is an edit.
  assert.deepEqual(brief(r), ['m1 status edit: Open -> Closed', 'm2 status edit: Agreed -> Closed', 'm3 reply:2 replyAdd:  -> Closed out on site']);
  assert.deepEqual(r.changes.map(onByDefault), [true, true, false], 'a row matched by its text needs confirming');
  assert.deepEqual(r.skipped.map((s) => s.reason), ['added']);
  assert.match(r.skipped[0]!.text, /Missing chainage at the bridge/);
});

test('a comment that matches two markups is not guessed at', async () => {
  const current = doc();
  current.rows.push(row(5, 'KR-C-103', 'Missing chainage'));
  const r = await roundTrip((v) => {
    for (const line of v) line.shift();
    v[4]![AT.seq - 1] = '';
    return [{ name: 'Sheet1', table: v }];
  }, current);
  assert.deepEqual(r.skipped.map((s) => s.reason), ['ambiguous']);
});

test('rows added in Excel are skipped and reported, as are repeats and markups since deleted', async () => {
  const current = doc();
  current.rows.splice(3, 1);
  const r = await roundTrip((v) => {
    v.push(['', '', 'KR-C-104', 'A new comment typed in Excel', 'Open']);
    v.push([...v[1]!]);
    v.push(['', '', '', '', '', '', '', '', '', '', 'Signed: P. Designer']);
  }, current);
  assert.deepEqual(r.skipped.map((s) => s.reason), ['gone', 'added', 'duplicate', 'added']);
  assert.deepEqual(r.changes, []);
});

test('values that do not fit are collected, not applied', async () => {
  const r = await roundTrip((v) => {
    v[1]![AT.status] = 'Closed out';
    v[2]![AT.status] = 'closed OUT ';
    v[3]![AT.cost] = 'tbc';
    v[4]![AT.due] = 'next week';
    v[4]![AT.checked] = 'maybe';
  });
  assert.deepEqual(r.changes, []);
  assert.deepEqual(r.unknown.map((u) => `${u.column.key}: ${u.value} x${u.rows.length}`), ['status: Closed out x2', 'custom:cost: tbc x1', 'checked: maybe x1', 'custom:due: next week x1']);
});

test('aliases map a client word to a status', async () => {
  let sheets = buildSyncSheets(doc(), OPTS);
  const v = sheets[0]!.table.map((r) => [...r]);
  v[1]![AT.status] = 'Closed out';
  sheets = [{ ...sheets[0]!, table: v }, sheets[1]!];
  const r = mergeWorkbook(await readWorkbook(buildWorkbook(sheets)), doc(), { docId: 'doc-1', aliases: { status: { 'closed out': 'Closed' } } });
  assert.deepEqual(brief(r), ['m1 status edit: Open -> Closed']);
});

test('thread columns: a blank that gains text is a new reply; a rewrite is an edit, off by default; a cleared cell is left', async () => {
  const r = await roundTrip((v) => {
    v[1]![AT.r1] = 'Pit moved 300 east';
    v[3]![AT.r1] = 'Label added, see rev C';
    v[3]![AT.r2] = 'Accepted';
  });
  assert.deepEqual(brief(r), ['m1 reply:1 replyAdd:  -> Pit moved 300 east', 'm3 reply:1 replyEdit: Label added -> Label added, see rev C', 'm3 reply:2 replyAdd:  -> Accepted']);
  assert.deepEqual(r.changes.map(onByDefault), [true, false, true]);
  const cleared = await roundTrip((v) => void (v[3]![AT.r1] = ''));
  assert.deepEqual(cleared.changes, []);
});

test('a response someone already added by hand is not added again', async () => {
  const current = doc();
  current.rows[0]!.replies = ['Pit moved 300 east'];
  current.rows[0]!.cells[AT.r1 - 1] = 'Pit moved 300 east';
  assert.deepEqual((await roundTrip((v) => void (v[1]![AT.r1] = 'Pit moved 300 east'), current)).changes, []);
});

test('a workbook from another document is flagged', async () => {
  const book = await readWorkbook(buildWorkbook(buildSyncSheets(doc(), { ...OPTS, docId: 'doc-2' })));
  assert.equal(mergeWorkbook(book, doc(), { docId: 'doc-1' }).wrongDocument, true);
});

test('a workbook with no table says so', async () => {
  const book = await readWorkbook(buildWorkbook([{ name: 'Notes', table: [['Hello'], ['there']] }]));
  const r = mergeWorkbook(book, doc(), { docId: 'doc-1' });
  assert.equal(r.noTable, true);
  assert.deepEqual(r.matched, []);
});

test('a table below a title block is found, also after rows are inserted above it', async () => {
  const cells = [{ row: 0, col: 1, value: 'Kestrel Road upgrade', bold: true }, { row: 1, col: 1, value: 'Item No' }];
  const edit = (v: TableCell[][]) => void (v[2]![AT.status] = 'Closed');
  const placed = await roundTrip(edit, doc(), doc(), { origin: { row: 4, col: 1 }, cells });
  assert.deepEqual(brief(placed), ['m2 status edit: Open -> Closed']);
  assert.equal(placed.matched[0]!.sheetRow, 5);
  const moved = await roundTrip(
    (v, sheets) => {
      edit(v);
      return [{ ...sheets[0]!, origin: { row: 7, col: 1 } }, sheets[1]!];
    },
    doc(),
    doc(),
    { origin: { row: 4, col: 1 }, cells },
  );
  assert.deepEqual(brief(moved), ['m2 status edit: Open -> Closed']);
  assert.equal(moved.matched[0]!.sheetRow, 8);
  assert.deepEqual(moved.skipped, []);
});

test('a column deleted or moved in Excel does not shift the others', async () => {
  const r = await roundTrip((v) => {
    v[1]![AT.cost] = 99;
    for (const line of v) {
      line.splice(AT.status, 1);
      line.splice(AT.seq, 0, line.pop()!);
    }
  });
  assert.deepEqual(brief(r), ['m1 custom:cost edit:  -> 99']);
});

test('reply rows are exported for reading and never changed', async () => {
  const table = doc();
  table.rows.splice(3, 0, { key: 'm3/r1', cells: [3, 'KR-C-102', 'Label added', '', 'No', '', '', '', ''], locked: true });
  const r = await roundTrip((v) => void (v[4]![AT.comment] = 'rewritten'), table, table);
  assert.deepEqual(r.changes, []);
  assert.equal(r.matched.length, 5);
});

test('the sheets carry keys, validation, protection and the exported values', async () => {
  const sheets = buildSyncSheets(doc(), { ...OPTS, protect: { password: 'kestrel' } });
  const [visible, hidden] = sheets;
  assert.equal(visible!.table[0]![0], KEY_LABEL);
  assert.deepEqual([...visible!.hiddenColumns!], [0]);
  assert.deepEqual([...visible!.protection!.unlocked], [AT.comment, AT.status, AT.checked, AT.due, AT.cost, AT.r1, AT.r2]);
  assert.equal(visible!.protection!.password, 'kestrel');
  assert.deepEqual(visible!.validations!.map((v) => `${v.column} ${v.kind}`), [`${AT.status} list`, `${AT.checked} list`, `${AT.due} date`, `${AT.cost} number`]);
  assert.equal(visible!.table[2]![AT.due], excelSerial(Date.UTC(2026, 10, 20)), 'a date goes as a real date');
  assert.equal(hidden!.name, HIDDEN_SHEET);
  assert.equal(hidden!.state, 'veryHidden');
  const snap = readSnapshot(await readWorkbook(buildWorkbook(sheets)))!;
  assert.equal(snap.docId, 'doc-1');
  assert.equal(snap.sheet, 'Register');
  assert.deepEqual(snap.columns.map((c) => c.key), COLUMNS.map((c) => c.key));
  assert.equal(snap.rows.get('m2')!.itemNo, 2);
  assert.deepEqual([...snap.rows.get('m2')!.values].filter(([, v]) => v), [['comment', 'Show the batter extent'], ['status', 'Open'], ['checked', 'false'], ['custom:due', '2026-11-20'], ['custom:cost', '1200.5']]);
  // The lists validation offers sit to the right of the exported rows.
  const status = visible!.validations!.find((v) => v.column === AT.status)!;
  assert.equal(status.kind === 'list' && status.source, "'_redcolumn'!$M$4:$M$6");
  assert.deepEqual(hidden!.table.slice(3, 6).map((r) => r[12]), ['Open', 'Closed', 'Agreed']);
});

test('canon gives each kind one form', () => {
  const kind = (k: SyncColumn['kind'], options?: string[]) => ({ kind: k, options });
  assert.equal(canon(kind('text'), 'a\r\nb  '), 'a\nb');
  assert.equal(canon(kind('text'), 12), '12');
  assert.equal(canon(kind('number'), ' 1,200.50 '), '1200.5');
  assert.equal(canon(kind('number'), ''), '');
  assert.equal(canon(kind('number'), 'abc'), null);
  assert.equal(canon(kind('date'), '2026-11-20T10:00:00Z'), '2026-11-20');
  assert.equal(canon(kind('date'), 'soon'), null);
  assert.equal(canon(kind('check'), '✓'), 'true');
  assert.equal(canon(kind('check'), null), 'false');
  assert.equal(canon(kind('check'), true), 'true');
  assert.equal(canon(kind('choice', ['Open']), ' open '), 'Open');
  assert.equal(canon(kind('choice', ['Open']), 'Done'), null);
  assert.equal(canon(kind('choice', ['Open']), 'Done', { done: 'Open' }), 'Open');
  assert.equal(canon(kind('choice', ['Open']), 'Done', { done: 'Missing' }), null);
});

test('toSyncTable keys the rows and types the editable cells', () => {
  const statuses = [
    { id: 'none', name: 'None', color: '' },
    { id: 'accepted', name: 'Accepted', color: '' },
  ];
  const custom = [
    { id: 'due', name: 'Due', type: 'date' as const },
    { id: 'zone', name: 'Zone', type: 'choice' as const, options: ['North', 'South'] },
    { id: 'total', name: 'Total', type: 'formula' as const },
  ];
  const columns = [
    { key: 'seq', label: 'ID', defaultWidth: 1 },
    { key: 'subject', label: 'Subject', defaultWidth: 1 },
    { key: 'status', label: 'Status', defaultWidth: 1 },
    { key: 'checked', label: 'Checkmark', defaultWidth: 1 },
    { key: 'length', label: 'Length', defaultWidth: 1 },
    ...custom.map((c) => ({ key: `custom:${c.id}`, label: c.name, custom: c, defaultWidth: 1 })),
  ];
  assert.deepEqual(columns.map((c) => syncColumn(c, statuses)).map((c) => `${c.key} ${c.edit} ${c.kind}${c.options ? ` [${c.options}]` : ''}`), [
    'seq locked text',
    'subject editable text',
    'status editable choice [Accepted]',
    'checked editable check',
    'length locked text',
    'custom:due editable date',
    'custom:zone editable choice [North,South]',
    'custom:total locked text',
  ]);
  const replies = [
    { id: 'r1', author: 'P', text: 'First answer', createdAt: 1 },
    { id: 'r2', author: 'Q', text: 'Second answer', createdAt: 2 },
  ];
  const markup = { id: 'm1', seq: 7, modifiedAt: 0, replies } as never;
  const cells = {
    seq: { text: '7', num: 7 },
    subject: { text: 'Cloud', num: null },
    status: { text: 'Accepted', num: null },
    checked: { text: '✓', num: 1 },
    length: { text: '12.5 m', num: 12.5 },
    sheet: { text: 'KR-C-101', num: null },
    comment: { text: 'Kerb line', num: null },
    'custom:due': { text: '20/11/2026', num: Date.UTC(2026, 10, 20) },
    'custom:zone': { text: 'North', num: null },
    'custom:total': { text: '', num: null, error: 'Circular reference' },
  };
  const table = toSyncTable([{ markup, cells }, { markup, cells: { ...cells, subject: { text: 'Reply', num: null } }, reply: { id: 'r1', parentId: 'm1', depth: 1, at: 1 } }], columns, {
    statuses,
    replyColumns: [replyColumn(replyKey(2), 'Close-out'), replyColumn(NEW_REPLY, 'New reply')],
  });
  assert.deepEqual(table.rows[0], {
    key: 'm1',
    cells: [7, 'Cloud', 'Accepted', 'Yes', 12.5, '2026-11-20', 'North', '#Circular reference', 'Second answer', ''],
    match: { itemNo: 7, sheet: 'KR-C-101', comment: 'Kerb line' },
    replies: ['First answer', 'Second answer'],
  });
  assert.equal(table.rows[1]!.key, 'm1/r1');
  assert.equal(table.rows[1]!.locked, true);
  assert.equal(table.rows[1]!.cells[1], '> Reply');
});
