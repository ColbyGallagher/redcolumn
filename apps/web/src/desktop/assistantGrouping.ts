import { checkAction, checkFilter, describeRuleAction, describeRuleFilter, MARKUP_LABELS, toolRuns, type GroupingAssignment, type GroupingProposal, type GroupingTool } from '@nb/markup';
import { evidenceOf, sourceName } from './assistantEvidence';
import { batchItems, errorText, findDocument, findMarkup, record, type AssistantDocument } from './assistant';
import { runToolOn, toolLibrary } from '../takeoff/toolLibrary';

/**
 * Grouping over MCP. An AI client proposes custom columns that group the takeoff the way the person
 * needs (by level, zone, system, trade...), with its reasoning per markup, and reusable grouping
 * tools (declarative rules) for the library. Everything waits in Review AI Takeoff: a column only
 * reaches the document when a person accepts it, a tool only runs once a person accepts it, and
 * neither ever changes a quantity.
 */
export const GROUPING_METHODS = ['propose_grouping_column', 'list_grouping_columns', 'propose_grouping_tool', 'list_grouping_tools', 'run_grouping_tool'] as const;
export type GroupingMethod = (typeof GROUPING_METHODS)[number];

const MAX_ASSIGNMENTS = 5000;

function text(raw: unknown, what: string, max = 200): string {
  if (typeof raw !== 'string' || !raw.trim()) throw new Error(`Give ${what}.`);
  return raw.trim().slice(0, max);
}

function proposeGroupingColumn(docs: readonly AssistantDocument[], params: unknown) {
  const args = record(params);
  const doc = findDocument(docs, args.document);
  if (doc.store.readOnly) throw new Error(`${doc.name} is read-only.`);
  const name = text(args.name, 'the column a name, such as "Level" or "Trade"');
  const type = args.type === undefined || args.type === 'choice' ? 'choice' : args.type === 'text' ? 'text' : null;
  if (!type) throw new Error('type has to be choice (a drop-down) or text. Grouping columns are never numbers: they group, and never change a quantity.');
  const { reasoning, confidence } = evidenceOf(args, doc.pageCount);
  if (!reasoning) throw new Error('say how you grouped them (reasoning), so the person can check it');
  const items = batchItems(args.assignments, 'Give assignments: a list of { id or seq, value, reasoning }.', MAX_ASSIGNMENTS);
  const seen = new Set<string>();
  const assignments: GroupingAssignment[] = items.map((item, n) => {
    try {
      const m = findMarkup(doc, item);
      if (seen.has(m.id)) throw new Error(`markup ${m.seq ?? m.id} is in the list twice`);
      seen.add(m.id);
      if (typeof item.value !== 'string') throw new Error('value has to be text');
      const ev = evidenceOf(item, doc.pageCount);
      return { markupId: m.id, value: item.value.trim().slice(0, 200), ...(ev.reasoning ? { reasoning: ev.reasoning.slice(0, 500) } : {}), ...(ev.confidence !== undefined ? { confidence: ev.confidence } : {}) };
    } catch (err) {
      throw new Error(`Assignment ${n + 1}: ${errorText(err)}`);
    }
  });
  const options = Array.isArray(args.options) ? args.options.filter((o): o is string => typeof o === 'string' && !!o.trim()).map((o) => o.trim().slice(0, 200)) : undefined;
  const proposal: GroupingProposal = {
    id: crypto.randomUUID(),
    name,
    type,
    ...(options?.length ? { options } : {}),
    reasoning,
    ...(confidence !== undefined ? { confidence } : {}),
    source: sourceName(args.source),
    createdAt: Date.now(),
    status: 'proposed',
    assignments,
  };
  doc.store.changeAiReview({ columns: [proposal] }, true);
  return { document: doc.name, id: proposal.id, assigned: assignments.length, note: 'Waiting for review in Review AI Takeoff › Columns: the person can rename it, regroup markups, accept or reject it. Nothing is written to the document until they accept it.' };
}

function publicGrouping(g: GroupingProposal) {
  const groups: Record<string, number> = {};
  for (const a of g.assignments) groups[a.value] = (groups[a.value] ?? 0) + 1;
  return {
    id: g.id,
    name: g.name,
    type: g.type,
    status: g.status,
    groups,
    regroupedByPerson: g.assignments.filter((a) => a.edited).length,
    ...(g.toolUse ? { madeByTool: g.toolUse.toolName } : {}),
    ...(g.accepted ? { acceptedBy: g.accepted.by } : {}),
    ...(g.rejected ? { rejectedBy: g.rejected.by } : {}),
  };
}

function listGroupingColumns(docs: readonly AssistantDocument[], params: unknown) {
  const doc = findDocument(docs, record(params).document);
  return { document: doc.name, columns: doc.store.aiReview().columns.map(publicGrouping) };
}

function publicTool(t: GroupingTool) {
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    status: t.status,
    ...(t.disabled ? { disabled: true } : {}),
    runs: toolRuns(t),
    column: t.column,
    rule: `${describeRuleFilter(t.filter)} → ${t.column}: ${describeRuleAction(t.action)}`,
    filter: t.filter,
    action: t.action,
    uses: t.uses?.length ?? 0,
  };
}

function proposeGroupingTool(docs: readonly AssistantDocument[], params: unknown) {
  const args = record(params);
  const name = text(args.name, 'the tool a name, such as "Doors by fire rating"');
  const description = text(args.description, 'a description: what the tool does, in a sentence', 500);
  const reasoning = text(args.reasoning, 'your reasoning: why this tool is worth keeping', 2000);
  const column = text(args.column, 'the column it fills, such as "Fire rating"');
  let filter;
  let action;
  try {
    filter = checkFilter(args.filter);
    action = checkAction(args.action);
  } catch (err) {
    throw new Error(`${errorText(err)}.`);
  }
  // Zones are page-space polygons on a document's pages: their pages are checked against it.
  if (action.kind === 'zone') {
    const doc = findDocument(docs, args.document);
    const bad = action.zones.find((z) => z.pageIndex >= doc.pageCount);
    if (bad) throw new Error(`Zone ${bad.name} is on page ${bad.pageIndex + 1}, past the end of ${doc.name}.`);
    // They are that document's page coordinates: the tool runs on it only.
    action = { ...action, document: doc.name };
  }
  const tool: GroupingTool = { id: crypto.randomUUID(), name, description, reasoning, source: sourceName(args.source), createdAt: Date.now(), status: 'proposed', column, filter, action };
  toolLibrary.propose(tool);
  return { id: tool.id, rule: publicTool(tool).rule, note: 'Saved to the tool library as proposed. The person accepts, edits or rejects it in Review AI Takeoff › Tools; only then can it run (run_grouping_tool).' };
}

function listGroupingTools() {
  return { tools: toolLibrary.list().map(publicTool) };
}

function runGroupingTool(docs: readonly AssistantDocument[], params: unknown) {
  const args = record(params);
  const doc = findDocument(docs, args.document);
  const tool = toolLibrary.get(text(args.tool, 'the tool: its id or name from list_grouping_tools'));
  if (!tool) throw new Error(`No tool "${String(args.tool)}". list_grouping_tools lists them.`);
  const proposal = runToolOn(doc.store, tool, sourceName(args.source), doc.name, sourceName(args.source));
  const groups: Record<string, number> = {};
  for (const a of proposal.assignments) groups[a.value] = (groups[a.value] ?? 0) + 1;
  const first = doc.store.get(proposal.assignments[0]!.markupId);
  return {
    document: doc.name,
    id: proposal.id,
    assigned: proposal.assignments.length,
    groups,
    ...(first ? { example: `${first.subject ?? MARKUP_LABELS[first.type]} → ${proposal.assignments[0]!.value}` } : {}),
    note: 'Proposed as a grouping column, recorded against the tool. It waits in Review AI Takeoff › Columns for the person to accept.',
  };
}

export function groupingCall(docs: readonly AssistantDocument[], method: GroupingMethod, params: unknown): unknown {
  if (method === 'propose_grouping_column') return proposeGroupingColumn(docs, params);
  if (method === 'list_grouping_columns') return listGroupingColumns(docs, params);
  if (method === 'propose_grouping_tool') return proposeGroupingTool(docs, params);
  if (method === 'list_grouping_tools') return listGroupingTools();
  return runGroupingTool(docs, params);
}
