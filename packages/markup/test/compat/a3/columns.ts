// Custom columns (one or more of every type), statuses (built in and a custom status set), and the
// markup metadata Bluebeam shows in its Markups List: replies, history, layers, groups, locks.
import { DEFAULT_STATUSES, type CustomColumn, type MarkupStatusDef } from '../../../src/columns.ts';
import type { Markup, Point, Reply, StatusChange } from '../../../src/model.ts';
import { mk, PageBuilder, T0, type PageSpec } from './lib.ts';
import { ngon } from './shapes.ts';

const DISCIPLINES = ['Architectural', 'Structural', 'Mechanical', 'Electrical', 'Civil / Landscape'];
const PRIORITIES = ['Low', 'Medium', 'High', 'Critical'];

/** Eleven columns covering every type: choice x2, text x2, multiline, number x2, formula x2, date, checkmark. */
export const COLUMNS: CustomColumn[] = [
  { id: 'col-discipline', name: 'Discipline', type: 'choice', options: DISCIPLINES },
  { id: 'col-priority', name: 'Priority', type: 'choice', options: PRIORITIES, required: true, defaultValue: 'Medium' },
  { id: 'col-ref', name: 'Ref No.', type: 'text' },
  { id: 'col-notes', name: 'Review Notes', type: 'multiline' },
  { id: 'col-qty', name: 'Qty', type: 'number', decimals: 0 },
  { id: 'col-cost', name: 'Unit Cost', type: 'number', decimals: 2 },
  { id: 'col-total', name: 'Total Cost', type: 'formula', formula: '[Qty] * [Unit Cost]', decimals: 2 },
  { id: 'col-due', name: 'Due Date', type: 'date' },
  { id: 'col-verified', name: 'Verified', type: 'checkmark', defaultValue: 'false' },
  { id: 'col-vqty', name: 'Verified Qty', type: 'formula', formula: '[Qty] * [Verified]', decimals: 0 },
  { id: 'col-zone', name: 'Zone <A&B> "L2"', type: 'text' },
];

export const CUSTOM_MODEL = 'BSI_A3TESTSET0001';
export const STATUSES: MarkupStatusDef[] = [
  ...DEFAULT_STATUSES,
  { id: 'a3-open', name: 'Open', color: '#f59e0b', model: CUSTOM_MODEL },
  { id: 'a3-progress', name: 'In Progress', color: '#3b82f6', model: CUSTOM_MODEL },
  { id: 'a3-closed', name: 'Closed - No Action', color: '#10b981', model: CUSTOM_MODEL },
];

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** Values for a markup's custom columns, varied by position so the markups list has a mix and gaps. */
export function autoFields(i: number): Record<string, string> | undefined {
  const k = i % 6;
  if (k === 5) return undefined;
  const f: Record<string, string> = { 'col-discipline': DISCIPLINES[i % DISCIPLINES.length]! };
  if (k !== 1) f['col-priority'] = PRIORITIES[i % PRIORITIES.length]!;
  if (k % 2 === 0) f['col-ref'] = `A3-${pad(i, 4)}`;
  if (k === 0 || k === 3) f['col-notes'] = `Review note ${i}\nsecond line, with "quotes" & <angle> brackets`;
  if (k !== 4) {
    f['col-qty'] = String((i % 9) + 1);
    f['col-cost'] = (12.5 + i).toFixed(2);
  }
  if (k === 2 || k === 3) f['col-due'] = `2026-${pad(10 + (i % 3))}-${pad(1 + (i % 28))}`;
  f['col-verified'] = i % 2 ? 'true' : 'false';
  if (k === 0) f['col-zone'] = `Z${i}`;
  return f;
}

/** Gives every markup without explicit values some, so each file exercises every column type. */
export function applyAutoFields(markups: Markup[]): void {
  markups.forEach((m, i) => {
    if (m.fields) return;
    const f = autoFields(i + 1);
    if (f) m.fields = f;
  });
}

const rc = (r: { x: number; y: number; w: number; h: number }, w = r.w, h = Math.min(r.h, 46)): Point[] => [[r.x, r.y], [r.x + w, r.y + h]];

export function columnsPage(p0: number): PageSpec {
  const P = new PageBuilder(p0, { title: 'Custom columns: every type, edge values', sheet: 'Z-101' });
  const R = (label: string, fields: Record<string, string> | null, extra: Partial<Markup> = {}) =>
    P.cell(label, null, (r) => [mk('rect', 0, rc(r), { subject: label, ...(fields ? { fields } : {}), ...extra }, { fill: '#e0f2fe' })]);
  R('CC01 no column values at all', null);
  R('CC02 every column filled', {
    'col-discipline': 'Structural', 'col-priority': 'High', 'col-ref': 'REF-0001', 'col-notes': 'Line 1\nLine 2\nLine 3',
    'col-qty': '4', 'col-cost': '19.99', 'col-due': '2026-12-25', 'col-verified': 'true', 'col-zone': 'North wing',
  });
  R('CC03 text: 255 chars', { 'col-ref': 'R'.repeat(255) });
  R('CC04 text: unicode / symbols', { 'col-ref': 'Réf № ① ≥ ± °', 'col-zone': 'テスト 中文' });
  R('CC05 text: XML + PDF specials', { 'col-ref': `& < > " ' \\ ( ) % # / ;`, 'col-zone': '<b>bold</b> &amp;' });
  R('CC06 multiline: 5 lines, blank line, tabs', { 'col-notes': 'one\n\nthree\tTAB\n\nfive' });
  R('CC07 multiline: 2000 chars', { 'col-notes': 'long multiline text '.repeat(100) });
  R('CC08 choice: every discipline in order (first)', { 'col-discipline': 'Architectural', 'col-priority': 'Low' });
  R('CC09 choice: last option, with slash', { 'col-discipline': 'Civil / Landscape', 'col-priority': 'Critical' });
  R('CC10 choice: value not in the list', { 'col-discipline': 'Orphan value', 'col-priority': 'Urgent!!' });
  R('CC11 choice: empty; required Priority missing', { 'col-ref': 'priority missing' });
  R('CC12 number: 0', { 'col-qty': '0', 'col-cost': '0' });
  R('CC13 number: negative, decimals', { 'col-qty': '-12', 'col-cost': '-12.5' });
  R('CC14 number: large 1234567.891 / small 0.005', { 'col-qty': '1234567.891', 'col-cost': '0.005' });
  R('CC15 number: not a number ("abc")', { 'col-qty': 'abc', 'col-cost': '1,5' });
  R('CC16 date: leap day 2028-02-29', { 'col-due': '2028-02-29' });
  R('CC17 date: 1999-12-31 and 2099-01-01 pair', { 'col-due': '1999-12-31', 'col-ref': 'pair 1' });
  R('CC18 date: invalid text ("tomorrow")', { 'col-due': 'tomorrow' });
  R('CC19 checkmark: true', { 'col-verified': 'true' });
  R('CC20 checkmark: false', { 'col-verified': 'false' });
  R('CC21 checkmark: unset; invalid "yes"', { 'col-ref': 'unset checkmark' });
  R('CC22 formula inputs: Qty 3 x Unit 9.99 (Total 29.97)', { 'col-qty': '3', 'col-cost': '9.99', 'col-verified': 'true' });
  R('CC23 formula inputs: Verified false (Verified Qty 0)', { 'col-qty': '5', 'col-cost': '2', 'col-verified': 'false' });
  R('CC24 formula inputs: missing Qty', { 'col-cost': '9.99' });

  // Column values on other markup types.
  const TYPES: [string, (r: { x: number; y: number; w: number; h: number }) => Markup][] = [
    ['line', (r) => mk('line', 0, [[r.x, r.y], [r.x + r.w, r.y + 30]])],
    ['polygon', (r) => mk('polygon', 0, ngon(r.x + 40, r.y + 30, 30, 30, 5))],
    ['text', (r) => mk('text', 0, [[r.x, r.y], [r.x + 100, r.y + 30]], { text: 'Text box with columns' })],
    ['count', (r) => mk('count', 0, [[r.x + 10, r.y + 10], [r.x + 40, r.y + 30], [r.x + 70, r.y + 10]])],
    ['length', (r) => mk('length', 0, [[r.x, r.y + 20], [r.x + 100, r.y + 20]])],
    ['note', (r) => mk('note', 0, [[r.x + 10, r.y + 5], [r.x + 34, r.y + 29]], { comment: 'note with columns' })],
    ['cloud', (r) => mk('cloud', 0, [[r.x, r.y], [r.x + 90, r.y + 50]])],
    ['stamp', (r) => mk('stamp', 0, [[r.x, r.y], [r.x + 110, r.y + 36]], { stamp: { lines: ['CHECKED'], frame: 'rounded' } }, { stroke: '#15803d' })],
  ];
  TYPES.forEach(([name, make], i) => {
    P.cell(`CT${pad(i + 1)} columns on a ${name}`, null, (r) => {
      const m = make(r);
      m.fields = { 'col-discipline': DISCIPLINES[i % 5]!, 'col-priority': PRIORITIES[i % 4]!, 'col-ref': `CT-${name}`, 'col-qty': String(i + 1), 'col-cost': '10.00', 'col-verified': 'true' };
      return [m];
    });
  });
  return P.spec;
}

const REPLY_TEXT = 'This is a long reply that goes on for a while. '.repeat(10);
const thread = (base: number): Reply[] => {
  const out: Reply[] = [{ id: `t${base}-0`, author: 'Priya Raman', text: 'Root comment on this markup.', createdAt: base }];
  for (let i = 1; i <= 8; i++) {
    out.push({ id: `t${base}-${i}`, author: ['A3 Tester', "Zoë O'Brien", 'Hiroshi Tanaka', 'Priya Raman'][i % 4]!, text: i === 5 ? REPLY_TEXT : `Reply number ${i} at depth ${Math.ceil(i / 2)}`, createdAt: base + i * 90_000, parentId: `t${base}-${i - 1}` });
  }
  out.push({ id: `t${base}-9`, author: 'A3 Tester', text: 'A sibling answering the root.', createdAt: base + 900_000, parentId: `t${base}-0` });
  out.push({ id: `t${base}-10`, author: 'A3 Tester', text: 'Unicode: café ± 5mm № 7', createdAt: base + 950_000 });
  return out;
};

const change = (state: string, model: string, author: string, mins: number): StatusChange => ({ state, model, author, at: T0 + mins * 60_000 });

export function metadataPage(p0: number): PageSpec {
  const P = new PageBuilder(p0, { title: 'Statuses, threads, layers, groups and flags', sheet: 'Z-102' });
  const sq = (r: { x: number; y: number; w: number; h: number }, w = 60): Point[] => [[r.x, r.y], [r.x + w, r.y + 40]];
  for (const s of STATUSES.filter((x) => x.id !== 'none')) {
    P.cell(`SS status ${s.name}${s.model ? ' (custom set)' : ''}`, null, (r) => [mk('rect', 0, sq(r), { status: s.id, subject: `SS ${s.name}` }, { fill: s.color, fillOpacity: 0.4 })]);
  }
  P.cell('SS history: None > Accepted > Rejected > Completed', null, (r) => [
    mk('rect', 0, sq(r), {
      status: 'completed',
      statusHistory: [change('Accepted', 'Review', 'Priya Raman', 1), change('Rejected', 'Review', 'A3 Tester', 5), change('Completed', 'Review', "Zoë O'Brien", 30)],
      subject: 'SS review history',
    }),
  ]);
  P.cell('SS history across models: Review + custom set', null, (r) => [
    mk('rect', 0, sq(r), {
      status: 'a3-progress',
      statusHistory: [change('Accepted', 'Review', 'Priya Raman', 1), change('Open', CUSTOM_MODEL, 'A3 Tester', 7), change('In Progress', CUSTOM_MODEL, 'A3 Tester', 40)],
      subject: 'SS mixed-model history',
    }),
  ]);
  P.cell('SS status on a line / cloud / count / area', [2, 1], (r) => [
    mk('line', 0, [[r.x, r.y + 10], [r.x + 70, r.y + 10]], { status: 'accepted', subject: 'SS line accepted' }),
    mk('cloud', 0, [[r.x + 90, r.y], [r.x + 160, r.y + 50]], { status: 'rejected', subject: 'SS cloud rejected' }),
    mk('count', 0, [[r.x + 190, r.y + 10], [r.x + 210, r.y + 30], [r.x + 230, r.y + 10]], { status: 'completed', subject: 'SS count completed' }),
    mk('area', 0, ngon(r.x + 290, r.y + 30, 28, 28, 5), { status: 'a3-open', subject: 'SS area open' }),
  ]);
  P.cell('RP reply thread: 11 replies, 5 deep, long + unicode', [2, 2], (r) => [mk('note', 0, [[r.x + 10, r.y + 10], [r.x + 34, r.y + 34]], { comment: 'Thread root', replies: thread(T0 + 7_000_000), subject: 'RP big thread' })]);
  P.cell('RP reply with empty text; reply by empty author', null, (r) => [
    mk('note', 0, [[r.x + 10, r.y + 10], [r.x + 34, r.y + 34]], { comment: 'edge replies', replies: [{ id: 'e1', author: 'A3 Tester', text: '', createdAt: T0 }, { id: 'e2', author: '', text: 'no author', createdAt: T0 + 1000 }], subject: 'RP edge replies' }),
  ]);
  P.cell('CK checkmarked (ticked) markups', null, (r) => [
    mk('rect', 0, sq(r, 50), { checked: true, subject: 'CK checked rect' }),
    mk('ellipse', 0, [[r.x + 70, r.y], [r.x + 120, r.y + 40]], { checked: true, status: 'accepted', subject: 'CK checked ellipse' }),
  ]);
  P.cell('LK locked markup; legend-hidden markup', null, (r) => [
    mk('rect', 0, sq(r, 55), { locked: true, subject: 'LK locked' }, { fill: '#fecaca' }),
    mk('rect', 0, [[r.x + 70, r.y], [r.x + 125, r.y + 40]], { legendHidden: true, subject: 'LK legend hidden' }),
  ]);
  P.cell('HD hidden markup (should not draw; in list)', null, (r) => [mk('rect', 0, sq(r, 80), { hidden: true, subject: 'HD hidden rect' }, { fill: '#000000' })], 'HIDDEN: you should see nothing here');
  P.cell('LY layers: "A3 Layer One" and "A3 Layer Two"', null, (r) => [
    mk('rect', 0, sq(r, 50), { layer: 'A3 Layer One', subject: 'LY layer one' }, { stroke: '#2563eb' }),
    mk('ellipse', 0, [[r.x + 60, r.y], [r.x + 110, r.y + 40]], { layer: 'A3 Layer Two', subject: 'LY layer two' }, { stroke: '#dc2626' }),
  ]);
  P.cell('GR grouped markups: rect + text + line (group)', [2, 1], (r) => [
    mk('rect', 0, [[r.x, r.y], [r.x + 80, r.y + 50]], { groupId: 'grp-a3-1', subject: 'GR rect' }),
    mk('text', 0, [[r.x + 100, r.y], [r.x + 220, r.y + 30]], { groupId: 'grp-a3-1', text: 'grouped text', subject: 'GR text' }),
    mk('line', 0, [[r.x + 80, r.y + 25], [r.x + 100, r.y + 15]], { groupId: 'grp-a3-1', subject: 'GR line' }),
    mk('ellipse', 0, [[r.x + 240, r.y], [r.x + 300, r.y + 50]], { groupId: 'grp-a3-2', subject: 'GR second group A' }),
    mk('ellipse', 0, [[r.x + 270, r.y + 10], [r.x + 330, r.y + 60]], { groupId: 'grp-a3-2', subject: 'GR second group B' }),
  ]);
  P.cell('AU authors: unicode, long, empty', null, (r) => [
    mk('rect', 0, sq(r, 40), { author: "Zoë O'Brien-Nakamura", subject: 'AU unicode author' }),
    mk('rect', 0, [[r.x + 50, r.y], [r.x + 90, r.y + 40]], { author: 'A very long author name '.repeat(8).trim(), subject: 'AU long author' }),
    mk('rect', 0, [[r.x + 100, r.y], [r.x + 140, r.y + 40]], { author: '', subject: 'AU empty author' }),
  ]);
  P.cell('CM long comment (3000 chars, newlines, specials)', null, (r) => [
    mk('rect', 0, sq(r), { comment: 'Comment line with specials: ( ) \\ < > & " \'\n'.repeat(60), subject: 'CM long comment' }),
  ]);
  P.cell('SB subject only; subject with unicode / 200 chars', null, (r) => [
    mk('rect', 0, sq(r, 40), { subject: 'Subject – café ± № 5' }),
    mk('rect', 0, [[r.x + 50, r.y], [r.x + 90, r.y + 40]], { subject: 'S'.repeat(200) }),
  ]);
  return P.spec;
}
