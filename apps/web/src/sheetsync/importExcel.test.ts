import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_STATUSES, type CustomColumn, type Markup } from '@nb/markup';
import { DEFAULT_SCALE } from '@nb/measure';
import { buildRows, listColumns, withThreads, type CellContext } from '../columns/listColumns.ts';
import { isOpenChange, patchesFor } from './apply.ts';
import { exportListWorkbook, planImport } from './importExcel.ts';
import { onByDefault } from './merge.ts';
import { buildWorkbook, type SheetSpec } from './xlsx.ts';
import { readWorkbook, type ReadWorkbook } from './xlsxRead.ts';
import { zipStore } from './xlsx.ts';

const COLUMNS: CustomColumn[] = [
  { id: 'zone', name: 'Zone', type: 'choice', options: ['North', 'South'] },
  { id: 'due', name: 'Due', type: 'date' },
  { id: 'done', name: 'Done', type: 'checkmark' },
  { id: 'cost', name: 'Cost', type: 'number' },
];

function markup(n: number, patch: Partial<Markup> = {}): Markup {
  return {
    id: `m${n}`,
    seq: n,
    type: 'cloud',
    pageIndex: 0,
    points: [[10, 10], [50, 40]],
    style: { stroke: '#ff0000', strokeWidth: 1 },
    author: 'Reviewer',
    createdAt: n,
    modifiedAt: n,
    status: 'none',
    ...patch,
  } as Markup;
}

const ctx = (): CellContext => ({ scaleOf: () => DEFAULT_SCALE, sheets: { 0: { number: 'KR-C-101', title: 'General arrangement' } as never }, statuses: DEFAULT_STATUSES, columns: COLUMNS });
const all = listColumns(COLUMNS);
const visible = all.filter((c) => ['seq', 'subject', 'status', 'comment', 'checked'].includes(c.key) || c.custom);
const rowsOf = (markups: Markup[]) => withThreads(buildRows(markups, ctx(), {}, null), ctx());

/** The parts of a stored zip. */
function unzip(zip: Uint8Array): { name: string; data: Uint8Array }[] {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const out: { name: string; data: Uint8Array }[] = [];
  const eocd = zip.length - 22;
  let p = view.getUint32(eocd + 16, true);
  for (let i = 0; i < view.getUint16(eocd + 10, true); i++) {
    const size = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const local = view.getUint32(p + 42, true);
    const start = local + 30 + view.getUint16(local + 26, true);
    out.push({ name: new TextDecoder().decode(zip.subarray(p + 46, p + 46 + nameLen)), data: zip.subarray(start, start + size) });
    p += 46 + nameLen;
  }
  return out;
}

/** The exported workbook with cells of its first sheet replaced, the way typing in Excel would: ref → new cell XML. */
async function edited(bytes: Uint8Array, cells: Record<string, string>): Promise<ReadWorkbook> {
  const parts = unzip(bytes).map((part) => {
    if (part.name !== 'xl/worksheets/sheet1.xml') return part;
    let xml = new TextDecoder().decode(part.data);
    for (const [ref, cell] of Object.entries(cells)) {
      const before = xml;
      xml = xml.replace(new RegExp(`<c r="${ref}"[^>]*?(/>|>.*?</c>)`), cell);
      // A blank cell is not in the file: typing in it adds one to its row.
      if (xml === before) xml = xml.replace(new RegExp(`(<row r="${ref.replace(/\D/g, '')}">.*?)</row>`), `$1${cell}</row>`);
      assert.notEqual(xml, before, `row of ${ref} is in the sheet`);
    }
    return { name: part.name, data: new TextEncoder().encode(xml) };
  });
  return readWorkbook(zipStore(parts));
}
const text = (ref: string, value: string) => `<c r="${ref}" t="inlineStr"><is><t>${value}</t></is></c>`;

test('export, edit in Excel, import: statuses, values and a reply come back as patches', async () => {
  const markups = [markup(1, { comment: 'Kerb line clashes with pit lid' }), markup(2, { comment: 'Show the batter extent', fields: { zone: 'North', cost: '1200.5' } }), markup(3, { type: 'text', text: 'Label the culvert' })];
  const bytes = exportListWorkbook({ rows: rowsOf(markups), columns: visible, statuses: DEFAULT_STATUSES, docId: 'doc-1', exportedAt: '2026-11-16T00:00:00.000Z' });
  const src = { rows: rowsOf(markups), columns: all, statuses: DEFAULT_STATUSES };

  // Untouched: nothing to do.
  assert.deepEqual(planImport(await readWorkbook(bytes), src, { docId: 'doc-1' }).changes, []);

  // Columns: A key, B ID, C Subject, D Status, E Checkmark, F Comments, G Zone, H Due, I Done, J Cost, K New reply.
  const book = await edited(bytes, {
    D2: text('D2', 'Completed'),
    E2: text('E2', 'Yes'),
    K2: text('K2', 'Pit moved 300 east'),
    G3: text('G3', 'south'),
    H3: '<c r="H3"><v>46346</v></c>',
    I3: text('I3', 'Yes'),
    J3: '<c r="J3"><v>1300</v></c>',
    F4: text('F4', 'Label the culvert and headwall'),
    C4: text('C4', 'Note'),
  });
  const plan = planImport(book, src, { docId: 'doc-1' });
  assert.deepEqual(plan.unknown, []);
  assert.deepEqual(plan.skipped, []);
  assert.deepEqual(
    plan.changes.map((c) => `${c.rowKey} ${c.column.label} ${c.kind}: ${c.to}`),
    ['m1 Status edit: Completed', 'm1 Checkmark edit: true', 'm1 New reply replyAdd: Pit moved 300 east', 'm2 Zone edit: South', 'm2 Due edit: 2026-11-20', 'm2 Done edit: true', 'm2 Cost edit: 1300', 'm3 Subject edit: Note', 'm3 Comments edit: Label the culvert and headwall'],
  );
  assert.ok(plan.changes.every(onByDefault));
  assert.deepEqual(plan.changes.filter(isOpenChange).map((c) => c.column.key), ['status', 'checked', 'newReply']);

  const byId = new Map(markups.map((m) => [m.id, m]));
  const patches = patchesFor(plan.changes, (id) => byId.get(id), { statuses: DEFAULT_STATUSES, columns: COLUMNS, replyAuthor: 'Priya Designer', now: 1000, newId: () => 'new-reply' });
  assert.deepEqual(Object.fromEntries(patches), {
    m1: { status: 'completed', checked: true, replies: [{ id: 'new-reply', author: 'Priya Designer', text: 'Pit moved 300 east', createdAt: 1000 }] },
    m2: { fields: { zone: 'South', cost: '1300', due: '2026-11-20', done: 'true' } },
    m3: { subject: 'Note', text: 'Label the culvert and headwall' },
  });

  // The document after the import: the same workbook has nothing more to add.
  const after = markups.map((m) => ({ ...m, ...patches.get(m.id) }) as Markup);
  assert.deepEqual(planImport(book, { ...src, rows: rowsOf(after) }, { docId: 'doc-1' }).changes, []);
});

test('clearing a value, unticking and a status set back to none', async () => {
  const markups = [markup(1, { status: 'accepted', checked: true, comment: 'Kerb', fields: { zone: 'North', done: 'true' }, layer: 'Civil' })];
  const bytes = exportListWorkbook({ rows: rowsOf(markups), columns: [...visible, all.find((c) => c.key === 'layer')!], statuses: DEFAULT_STATUSES, docId: 'doc-1', exportedAt: '' });
  const book = await edited(bytes, { D2: '<c r="D2"/>', E2: text('E2', 'No'), G2: '<c r="G2"/>', I2: text('I2', 'No'), K2: '<c r="K2"/>' });
  const plan = planImport(book, { rows: rowsOf(markups), columns: all, statuses: DEFAULT_STATUSES }, { docId: 'doc-1' });
  const patches = patchesFor(plan.changes, () => markups[0], { statuses: DEFAULT_STATUSES, columns: COLUMNS, replyAuthor: '', now: 0, newId: () => 'x' });
  assert.deepEqual(patches.get('m1'), { status: 'none', checked: false, fields: {}, layer: undefined });
});

test('a rewritten reply in a thread column edits that reply', () => {
  const m = markup(1, { replies: [{ id: 'r1', author: 'P', text: 'First', createdAt: 1 }, { id: 'r2', author: 'Q', text: 'Second', createdAt: 2 }] });
  const column = { key: 'reply:2', label: 'Close-out', edit: 'editable' as const, kind: 'text' as const };
  const patches = patchesFor([{ rowKey: 'm1', column, sheetRow: 1, via: 'key', kind: 'replyEdit', from: 'Second', to: 'Second, agreed', base: 'Second' }], () => m, { statuses: [], columns: [], replyAuthor: 'X', now: 0, newId: () => 'x' });
  assert.deepEqual(patches.get('m1')!.replies!.map((r) => `${r.id} ${r.author} ${r.text}`), ['r1 P First', 'r2 Q Second, agreed']);
});

test('a plain workbook with the list headers imports by ID', async () => {
  const markups = [markup(1, { comment: 'Kerb' }), markup(2, { comment: 'Pit' })];
  const sheet: SheetSpec = { name: 'Sheet1', table: [['ID', 'Comments', 'Status'], [2, 'Pit', 'Rejected'], [1, 'Kerb', '']] };
  const plan = planImport(await readWorkbook(buildWorkbook([sheet])), { rows: rowsOf(markups), columns: all, statuses: DEFAULT_STATUSES }, { docId: 'doc-1' });
  assert.equal(plan.hasSnapshot, false);
  assert.deepEqual(plan.changes.map((c) => `${c.rowKey} ${c.via} ${c.column.key}: ${c.to}`), ['m2 itemNo status: Rejected']);
});
