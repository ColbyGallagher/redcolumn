import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_STATUSES, type Markup } from '@nb/markup';
import { DEFAULT_SCALE } from '@nb/measure';
import { buildRows, listColumns, withThreads, type CellContext } from '../columns/listColumns.ts';
import { patchesFor } from './apply.ts';
import { planImport } from './importExcel.ts';
import { DEFAULT_PASSWORD, README_SHEET, cellRef, exportTemplate, parseCellRef, parseTemplateFile, registerSheets, starterTemplate, templateFor, withStatuses, wording, type RegisterTemplate } from './register.ts';
import { KEY_LABEL } from './syncWorkbook.ts';
import type { TableCell } from './table.ts';
import { HIDDEN_SHEET, buildWorkbook, type SheetSpec } from './xlsx.ts';
import { readWorkbook } from './xlsxRead.ts';

function markup(n: number, patch: Partial<Markup> = {}): Markup {
  return { id: `m${n}`, seq: n, type: 'cloud', pageIndex: 0, points: [[10, 10], [50, 40]], style: { stroke: '#ff0000', strokeWidth: 1 }, author: 'Rae Reviewer', createdAt: Date.UTC(2026, 10, n), modifiedAt: n, status: 'none', ...patch } as Markup;
}
const ctx = (): CellContext => ({ scaleOf: () => DEFAULT_SCALE, sheets: { 0: { number: 'KR-C-101', title: 'General arrangement' } as never }, statuses: DEFAULT_STATUSES, columns: [] });
const all = listColumns([]);
const rowsOf = (markups: Markup[]) => withThreads(buildRows(markups, ctx(), {}, null), ctx());

const template = (): RegisterTemplate => {
  const t = starterTemplate('tpl-1', DEFAULT_STATUSES, 1);
  // The client says Closed for Completed, and their document controller also types "Closed out".
  const statuses = t.statuses.map((s) => (s.id === 'completed' ? { ...s, word: 'Closed', also: ['Closed out'] } : s));
  return { ...t, name: 'Kestrel Road register', statuses, firstCol: 1, cells: [...t.cells, { row: 2, col: 4, value: 'reviewer' as const }, { row: 9, col: 0, text: 'below the header: dropped' }] };
};
// Columns on the sheet (the table starts at B): Item No, Sheet, Comment, Raised by, Date raised, Status, Designer Response, Response by, Reviewer Close-out, key.
const AT = { item: 0, sheet: 1, comment: 2, by: 3, date: 4, status: 5, r1: 6, who1: 7, r2: 8, key: 9 };

const markups = () => [
  markup(1, { comment: 'Kerb line clashes with pit lid' }),
  markup(2, { comment: 'Show the batter extent', status: 'completed', replies: [{ id: 'r1', author: 'Priya Designer', text: 'Batter added', createdAt: 5 }] }),
  markup(3, { comment: 'Label the culvert', status: 'rejected' }),
];
const exportOf = (list: Markup[], t = template()) => ({ rows: rowsOf(list), columns: all, statuses: DEFAULT_STATUSES, template: t, docId: 'doc-1', exportedAt: '2026-11-16T03:00:00.000Z', values: { document: 'KR-C-101 General arrangement.pdf', exportDate: '2026-11-16', reviewer: 'Rae Reviewer' } });
const src = (list: Markup[], templates?: RegisterTemplate[]) => ({ rows: rowsOf(list), columns: all, statuses: DEFAULT_STATUSES, ...(templates ? { templates } : {}) });

/** The register with its visible sheet's body rows changed, read back. */
async function edited(sheets: SheetSpec[], edit: (body: TableCell[][]) => void) {
  const table = sheets[0]!.table.map((r) => [...r]);
  edit(table.slice(1));
  return readWorkbook(buildWorkbook([{ ...sheets[0]!, table }, ...sheets.slice(1)]));
}

test('a register is the template laid out: title block, client headings, their status words, a Read me, protection', async () => {
  const sheets = registerSheets(exportOf(markups()));
  const [visible, readme, hidden] = sheets;
  assert.deepEqual(sheets.map((s) => s.name), ['Register', README_SHEET, HIDDEN_SHEET]);
  assert.deepEqual(visible!.origin, { row: 4, col: 1 });
  assert.deepEqual(visible!.table[0], ['Item No', 'Sheet', 'Comment', 'Raised by', 'Date raised', 'Status', 'Designer Response', 'Response by', 'Reviewer Close-out', KEY_LABEL]);
  assert.deepEqual(visible!.table[1], [1, 'KR-C-101', 'Kerb line clashes with pit lid', 'Rae Reviewer', '2026-11-01 00:00:00', 'Open', '', '', '', 'm1']);
  assert.deepEqual(visible!.table[2]!.slice(AT.status), ['Closed', 'Batter added', 'Priya Designer', '', 'm2']);
  assert.equal(visible!.table[3]![AT.status], 'Rejected');
  assert.deepEqual([...visible!.hiddenColumns!], [AT.key]);
  assert.deepEqual([...visible!.protection!.unlocked], [AT.comment, AT.status, AT.r1, AT.who1, AT.r2]);
  assert.equal(visible!.protection!.password, DEFAULT_PASSWORD);
  assert.deepEqual(visible!.widths, [9, 16, 50, 16, 20, 14, 50, 16, 40, undefined]);
  assert.deepEqual(visible!.cells, [
    { row: 0, col: 0, value: 'Comment register', bold: true },
    { row: 1, col: 0, value: 'Document' },
    { row: 1, col: 2, value: 'KR-C-101 General arrangement.pdf' },
    { row: 2, col: 0, value: 'Exported' },
    { row: 2, col: 2, value: '2026-11-16' },
    { row: 2, col: 4, value: 'Rae Reviewer' },
  ]);
  const status = visible!.validations!.find((v) => v.column === AT.status)!;
  assert.equal(status.kind, 'list');
  assert.match(status.message!, /Status is one of: Open, Accepted, Rejected, Closed, Cancelled/);
  const lines = readme!.table.map((r) => String(r[0]));
  assert.ok(lines.some((l) => l.includes('Columns to fill in on the "Register" sheet: Comment, Status, Designer Response, Response by, Reviewer Close-out.')));
  assert.ok(lines.some((l) => l.includes(`Review > Unprotect Sheet, password: ${DEFAULT_PASSWORD}`)));
  assert.equal(hidden!.state, 'veryHidden');
  // The written workbook reads back with the table where the template puts it.
  const book = await readWorkbook(buildWorkbook(sheets));
  assert.deepEqual(book.sheets[0]!.rows[4]!.slice(0, 4), [null, 'Item No', 'Sheet', 'Comment']);
  assert.deepEqual(book.sheets[0]!.rows[0], ['Comment register']);
});

test('an open template is not protected and says nothing about a password', () => {
  const sheets = registerSheets(exportOf(markups(), { ...template(), protection: 'open' }));
  assert.equal(sheets[0]!.protection, undefined);
  assert.ok(!sheets[1]!.table.some((r) => String(r[0]).includes('password')));
});

test('a filled-in register comes back: status words to statuses, responses to replies from the responder', async () => {
  const list = markups();
  const sheets = registerSheets(exportOf(list));
  assert.deepEqual(planImport(await readWorkbook(buildWorkbook(sheets)), src(list), { docId: 'doc-1' }).changes, [], 'untouched: nothing to do');
  const book = await edited(sheets, (body) => {
    body[0]![AT.r1] = 'Pit moved 300 east';
    body[0]![AT.who1] = 'Priya Designer';
    body[0]![AT.status] = 'closed out';
    body[1]![AT.r2] = 'Agreed, closed';
    body[2]![AT.status] = 'Open';
    body[2]![AT.r1] = 'Will label at next issue';
  });
  const plan = planImport(book, src(list), { docId: 'doc-1' });
  assert.equal(plan.register?.templateId, 'tpl-1');
  assert.deepEqual(plan.unknown, []);
  assert.deepEqual(
    plan.changes.map((c) => `${c.rowKey} ${c.column.label} ${c.kind}: ${c.to}${c.author ? ` (${c.author})` : ''}`),
    ['m1 Status edit: Closed', 'm1 Designer Response replyAdd: Pit moved 300 east (Priya Designer)', 'm2 Reviewer Close-out replyAdd: Agreed, closed', 'm3 Status edit: Open', 'm3 Designer Response replyAdd: Will label at next issue'],
  );
  const byId = new Map(list.map((m) => [m.id, m]));
  let n = 0;
  const patches = patchesFor(plan.changes, (id) => byId.get(id), { statuses: DEFAULT_STATUSES, columns: [], replyAuthor: 'Someone at the designer', now: 100, newId: () => `new-${++n}`, statusId: wording(plan.register!, DEFAULT_STATUSES).statusId });
  assert.equal(patches.get('m1')!.status, 'completed');
  assert.deepEqual(patches.get('m1')!.replies!.map((r) => `${r.author}: ${r.text}`), ['Priya Designer: Pit moved 300 east']);
  assert.deepEqual(patches.get('m2')!.replies!.map((r) => `${r.author}: ${r.text}`), ['Priya Designer: Batter added', 'Someone at the designer: Agreed, closed']);
  assert.equal(patches.get('m3')!.status, 'none');
  // Imported, the same workbook has nothing left.
  const after = list.map((m) => ({ ...m, ...patches.get(m.id) }) as Markup);
  assert.deepEqual(planImport(book, src(after), { docId: 'doc-1' }).changes, []);
});

test('a status word nobody mapped is unknown until it is mapped', async () => {
  const list = markups();
  const book = await edited(registerSheets(exportOf(list)), (body) => void (body[0]![AT.status] = 'Agreed'));
  const plan = planImport(book, src(list), { docId: 'doc-1' });
  assert.deepEqual(plan.unknown.map((u) => `${u.column.label}: ${u.value} [${u.column.options}]`), ['Status: Agreed [Open,Accepted,Rejected,Closed,Cancelled]']);
  const mapped = planImport(book, src(list), { docId: 'doc-1', aliases: { status: { agreed: 'Accepted' } } });
  assert.deepEqual(mapped.changes.map((c) => c.to), ['Accepted']);
});

test('a register copied into a plain workbook is recognised by its headings, through the template', async () => {
  const list = markups();
  const t = template();
  const visible = registerSheets(exportOf(list, t))[0]!;
  const table = visible.table.map((r) => r.slice(0, AT.key));
  table[1]![AT.status] = 'Closed';
  table[3]![AT.item] = '';
  table[3]![AT.r1] = 'Label added';
  const book = await readWorkbook(buildWorkbook([{ name: 'Sheet1', origin: { row: 2, col: 0 }, table }]));
  assert.equal(planImport(book, src(list), { docId: 'doc-1' }).noTable, true, 'without the template the headings mean nothing');
  const plan = planImport(book, src(list, [{ ...t, id: 'other', columns: [{ header: 'Ref', field: { kind: 'column', key: 'seq' } }] }, t]), { docId: 'doc-1' });
  assert.equal(plan.register?.templateId, 'tpl-1');
  assert.deepEqual(plan.matched.map((m) => `${m.key} ${m.via}`), ['m1 itemNo', 'm2 itemNo', 'm3 text']);
  assert.deepEqual(plan.changes.map((c) => `${c.rowKey} ${c.column.label}: ${c.to}`), ['m1 Status: Closed', 'm3 Designer Response: Label added']);
});

test('a template file round-trips, without which client it is kept beside, and odd files are refused', () => {
  const t = { ...template(), standardId: 'std-1', password: 'kestrel' };
  const back = parseTemplateFile(exportTemplate(t));
  const { standardId: _s, ...shared } = t;
  assert.deepEqual(back, shared);
  const broken = (change: (file: { template: Record<string, unknown> }) => void, why: RegExp) => {
    const file = JSON.parse(exportTemplate(t)) as { template: Record<string, unknown> };
    change(file);
    assert.throws(() => parseTemplateFile(JSON.stringify(file)), why);
  };
  assert.throws(() => parseTemplateFile('not json'), /not JSON/);
  assert.throws(() => parseTemplateFile('{"format":"redcolumn.drawing-standard"}'), /another kind of file/);
  broken((f) => void (f.template.columns = []), /columns are missing/);
  broken((f) => void (f.template.columns = [{ header: 'x', field: { kind: 'script', run: 'x' } }]), /field this version does not know/);
  broken((f) => void (f.template.headerRow = -1), /header row/);
  broken((f) => void (f.template.name = 'x'.repeat(500)), /name is missing or too long/);
  const extra = JSON.parse(exportTemplate(t)) as { template: Record<string, unknown> };
  extra.template.surprise = { nested: true };
  assert.equal('surprise' in parseTemplateFile(JSON.stringify(extra)), false, 'only known fields are kept');
});

test('withStatuses gives every status of the document a word, and keeps wording for statuses it does not have', () => {
  const t = withStatuses({ ...template(), statuses: [{ id: 'completed', word: 'Closed', closed: true, also: [] }, { id: 'BSI_X', word: 'Hold', closed: false, also: [] }] }, DEFAULT_STATUSES);
  assert.deepEqual(t.statuses.map((s) => `${s.id}=${s.word}${s.closed ? '*' : ''}`), ['none=Open', 'accepted=Accepted*', 'rejected=Rejected', 'completed=Closed*', 'cancelled=Cancelled*', 'BSI_X=Hold']);
});

test('cell references and the template a document starts on', () => {
  assert.equal(cellRef(2, 27), 'AB3');
  assert.deepEqual(parseCellRef(' ab3 '), { row: 2, col: 27 });
  assert.equal(parseCellRef('3B'), null);
  assert.equal(parseCellRef('A0'), null);
  const a = { ...template(), id: 'a' };
  const b = { ...template(), id: 'b', standardId: 'std-9' };
  assert.equal(templateFor([a, b], 'std-9')!.id, 'b');
  assert.equal(templateFor([a, b], 'std-1')!.id, 'a');
  assert.equal(templateFor([], undefined), undefined);
});
