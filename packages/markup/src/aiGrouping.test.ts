import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_STYLES, type Markup } from './model.ts';
import { checkAction, checkFilter, describeRuleAction, describeRuleFilter, runTool, sanitizeGrouping, sanitizeTool, toolRuns, type RuleContext } from './aiGrouping.ts';

function m(id: string, page: number, extra: Partial<Markup> = {}): Markup {
  return { id, type: 'count', pageIndex: page, points: [[100, 100]], style: { ...DEFAULT_STYLES.count }, status: 'none', author: '', createdAt: 1, modifiedAt: 1, ...extra };
}

const ctx: RuleContext = {
  columns: [{ id: 'fr', name: 'Fire rating', type: 'text' }],
  sheets: { 0: { number: 'A-101', title: 'LEVEL 1 FLOOR PLAN' }, 1: { number: 'A-102', title: 'LEVEL 2 FLOOR PLAN' } },
};

const markups = [
  m('d1', 0, { subject: 'Door', fields: { fr: 'FRL 60' } }),
  m('d2', 1, { subject: 'Door type B', fields: { fr: 'FRL 120' } }),
  m('w1', 0, { subject: 'Window', points: [[500, 500]] }),
  m('d3', 1, { subject: 'door', type: 'rect', points: [[0, 0], [10, 10]] }),
];

test('rules: doors by fire rating, by level from the sheet title, and inside a zone', () => {
  const doors = runTool({ name: 'Doors by fire rating', filter: { subject: 'door', types: ['count'] }, action: { kind: 'copy', from: { column: 'Fire rating' } } }, markups, ctx);
  assert.deepEqual(doors.map((a) => [a.markupId, a.value]), [['d1', 'FRL 60'], ['d2', 'FRL 120']]);
  assert.match(doors[0]!.reasoning!, /Doors by fire rating/);
  const levels = runTool({ name: 'By level', filter: {}, action: { kind: 'sheet', map: [{ contains: 'level 1', value: 'L1' }, { contains: 'LEVEL 2', value: 'L2' }] } }, markups, ctx);
  assert.deepEqual(levels.map((a) => a.value), ['L1', 'L2', 'L1', 'L2']);
  const zone = runTool({ name: 'Zone', filter: { pages: [0] }, action: { kind: 'zone', zones: [{ name: 'North', pageIndex: 0, polygon: [[0, 0], [200, 0], [200, 200], [0, 200]] }], otherwise: 'Outside' } }, markups, ctx);
  assert.deepEqual(zone.map((a) => [a.markupId, a.value]), [['d1', 'North'], ['w1', 'Outside']]);
  // Nothing to copy: the markup is left out rather than given an empty group.
  assert.deepEqual(runTool({ name: 'L', filter: {}, action: { kind: 'copy', from: 'label' } }, markups, ctx), []);
});

test('rules are checked: no code, only the filters and actions there are', () => {
  assert.throws(() => checkFilter({ types: ['nonsense'] }), /markup types/);
  assert.throws(() => checkAction({ kind: 'script', code: 'alert(1)' }), /set, copy, zone or sheet/);
  assert.throws(() => checkAction({ kind: 'zone', zones: [{ name: 'Z', pageIndex: 0, polygon: [[0, 0], [1, 1]] }] }), /3 or more points/);
  assert.equal(describeRuleFilter({ subject: 'Door', pages: [0, 1] }), 'subject contains “Door”, on pages 1, 2');
  assert.equal(describeRuleAction({ kind: 'copy', from: 'sheet' }), 'copied from its sheet');
});

test('tools and grouping columns read from storage, files or peers are checked', () => {
  const tool = { id: 't', name: 'Doors', column: 'Rating', status: 'accepted', filter: {}, action: { kind: 'set', value: 'x' }, createdAt: 1 };
  assert.ok(sanitizeTool(tool));
  assert.equal(sanitizeTool({ ...tool, action: { kind: 'eval' } }), null);
  assert.equal(toolRuns(sanitizeTool(tool)!), true);
  assert.equal(toolRuns(sanitizeTool({ ...tool, disabled: true })!), false);
  assert.equal(toolRuns(sanitizeTool({ ...tool, status: 'proposed' })!), false);
  const g = sanitizeGrouping({ id: 'g', name: 'Level', type: 'number', status: 'weird', assignments: [{ markupId: 'a', value: 'L1', confidence: 3 }, { value: 'x' }] });
  assert.deepEqual([g!.type, g!.status, g!.assignments.length, g!.assignments[0]!.confidence], ['text', 'proposed', 1, undefined]);
});
