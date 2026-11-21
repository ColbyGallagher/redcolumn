import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_STYLES, MarkupStore, type Markup } from '@nb/markup';
import { assistantCall, type AssistantDocument } from '../desktop/assistant.ts';
import { acceptGrouping, deleteGrouping, regroup, rejectGrouping } from './groupingColumns.ts';
import { toolLibrary } from './toolLibrary.ts';
import { waitingCount } from './aiReview.ts';

const count = (id: string, page: number, subject: string): Markup => ({ id, type: 'count', pageIndex: page, points: [[100, 100]], subject, style: { ...DEFAULT_STYLES.count }, status: 'none', author: 'me', createdAt: 1, modifiedAt: 1 });

async function drawing(): Promise<AssistantDocument> {
  const store = await MarkupStore.open(`grouping-${Math.random()}`, { persist: false });
  store.add(count('a', 0, 'Pit'));
  store.add(count('b', 1, 'Pit'));
  store.add(count('c', 1, 'Sign'));
  store.setDetectedSheets([
    [0, { number: 'C-101', title: 'STAGE 1 ROADWORKS', discipline: null, scaleText: null, revision: null, source: 'manual', confidence: 1 }],
    [1, { number: 'C-102', title: 'STAGE 2 ROADWORKS', discipline: null, scaleText: null, revision: null, source: 'manual', confidence: 1 }],
  ]);
  return { id: 'd', name: 'C-101.pdf', pageCount: 2, pageIndex: 0, active: true, store, pageSize: () => ({ width: 842, height: 595 }) };
}

test('a grouping column waits for a person; accepting writes the column and values as one undo step, with regrouping kept', async () => {
  const d = await drawing();
  const out = (await assistantCall([d], 'propose_grouping_column', { source: 'Claude', name: 'Stage', reasoning: 'From the sheet titles', confidence: 0.8, assignments: [{ id: 'a', value: 'Stage 1', reasoning: 'C-101 is stage 1' }, { id: 'b', value: 'Stage 1' }, { id: 'c', value: 'Stage 2' }] })) as { id: string };
  await assert.rejects(() => assistantCall([d], 'propose_grouping_column', { name: 'Qty', type: 'number', reasoning: 'x', assignments: [{ id: 'a', value: '1' }] }), /never numbers/);
  assert.equal(d.store.columnSet().columns.length, 0, 'nothing is written until accepted');
  assert.equal(waitingCount(d.store), 1);
  // A person moves b to stage 2: in review, and the AI's value is kept.
  regroup(d.store, out.id, 'b', 'Stage 2');
  const g = d.store.aiReview().columns[0]!;
  assert.equal(g.status, 'review');
  assert.deepEqual(g.assignments.find((a) => a.markupId === 'b')!.edited, { from: 'Stage 1' });
  const r = acceptGrouping(d.store, out.id, 'Hana')!;
  assert.equal(r.written, 3);
  const col = d.store.columnSet().columns.find((c) => c.id === r.columnId)!;
  assert.deepEqual([col.name, col.type, col.options], ['Stage', 'choice', ['Stage 1', 'Stage 2']]);
  assert.deepEqual(['a', 'b', 'c'].map((id) => d.store.get(id)!.fields?.[col.id]), ['Stage 1', 'Stage 2', 'Stage 2']);
  assert.equal(d.store.aiReview().columns[0]!.status, 'accepted');
  // One undo takes the column, the values and the acceptance back.
  d.store.undo();
  assert.equal(d.store.columnSet().columns.length, 0);
  assert.equal(d.store.get('a')!.fields, undefined);
  assert.equal(d.store.aiReview().columns[0]!.status, 'review');
  rejectGrouping(d.store, out.id, 'Hana');
  assert.equal(waitingCount(d.store), 0);
  deleteGrouping(d.store, out.id, false);
  assert.equal(d.store.aiReview().columns.length, 0);
  const listed = (await assistantCall([d], 'list_grouping_columns', {})) as { columns: unknown[] };
  assert.equal(listed.columns.length, 0);
});

test('a grouping tool runs only once accepted and on; a run proposes a column recorded against the tool', async () => {
  const d = await drawing();
  const made = (await assistantCall([d], 'propose_grouping_tool', {
    source: 'Claude',
    name: 'Stage from sheet title',
    description: 'Groups markups by the stage named in the sheet title.',
    reasoning: 'Every sheet title names its stage.',
    column: 'Stage',
    filter: { types: ['count'] },
    action: { kind: 'sheet', map: [{ contains: 'STAGE 1', value: 'Stage 1' }, { contains: 'STAGE 2', value: 'Stage 2' }] },
  })) as { id: string; rule: string };
  assert.match(made.rule, /Count → Stage: by sheet/);
  await assert.rejects(() => assistantCall([d], 'propose_grouping_tool', { name: 'x', description: 'x', reasoning: 'x', column: 'x', action: { kind: 'code', source: 'x' } }), /set, copy, zone or sheet/);
  await assert.rejects(() => assistantCall([d], 'run_grouping_tool', { tool: 'Stage from sheet title' }), /not accepted/);
  toolLibrary.accept(made.id, 'Hana');
  toolLibrary.setDisabled(made.id, true);
  await assert.rejects(() => assistantCall([d], 'run_grouping_tool', { tool: made.id }), /turned off/);
  toolLibrary.setDisabled(made.id, false);
  const ran = (await assistantCall([d], 'run_grouping_tool', { source: 'Claude', tool: made.id })) as { id: string; groups: Record<string, number> };
  assert.deepEqual(ran.groups, { 'Stage 1': 1, 'Stage 2': 2 });
  const g = d.store.aiReview().columns.find((x) => x.id === ran.id)!;
  assert.equal(g.toolUse!.toolId, made.id);
  assert.equal(g.status, 'proposed', 'a run is a proposal, like any other');
  assert.equal(d.store.columnSet().columns.length, 0);
  assert.deepEqual(toolLibrary.get(made.id)!.uses!.map((u) => [u.proposalId, u.markups]), [[ran.id, 3]]);
  // Deleting the tool leaves its grouping as it is.
  toolLibrary.delete(made.id);
  assert.ok(d.store.aiReview().columns.find((x) => x.id === ran.id));
  const tools = (await assistantCall([d], 'list_grouping_tools', {})) as { tools: unknown[] };
  assert.equal(tools.tools.length, 0);
});
