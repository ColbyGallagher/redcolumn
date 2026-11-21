import { TYPE_INFO } from './types';
import type { Markup, MarkupType, Point } from './model';
import type { CustomColumn } from './columns';
import { pointInPolygon } from './geometry';

/**
 * Grouping an AI client proposes for a takeoff, and the reusable rules ("tools") it groups with.
 *
 * A grouping column is a custom column (text or a drop-down, never a number, so it cannot feed a
 * formula or change a quantity) with a value per markup, each with the AI's reasoning. It waits in
 * Review AI Takeoff with a status: proposed, in review once a person starts changing it, then
 * accepted (written to the document's columns and markups as one undo step) or rejected.
 *
 * A grouping tool is a declarative rule: which markups (a filter), and what value they get in a
 * column (an action). Never code. Only accepted, enabled tools run, and running one only proposes a
 * grouping column for review: it records which tool made it, and never touches a quantity.
 */

export type GroupingStatus = 'proposed' | 'review' | 'accepted' | 'rejected';

export interface GroupingAssignment {
  markupId: string;
  value: string;
  reasoning?: string;
  confidence?: number;
  /** A person changed the value from what the AI (or tool) gave. */
  edited?: { from: string };
}

/** Which tool made a grouping, and when. */
export interface ToolUse {
  toolId: string;
  toolName: string;
  at: number;
  by: string;
}

export interface GroupingProposal {
  id: string;
  /** The column's name (a person may rename it before accepting). */
  name: string;
  /** Free text, or a drop-down of `options`. */
  type: 'text' | 'choice';
  options?: string[];
  reasoning: string;
  confidence?: number;
  source: string;
  createdAt: number;
  status: GroupingStatus;
  assignments: GroupingAssignment[];
  /** The tool that made it, when a tool did. */
  toolUse?: ToolUse;
  /** Set on accepting: the document column it became, and who accepted it. */
  accepted?: { by: string; at: number; columnId: string };
  rejected?: { by: string; at: number };
}

// ---- Tools: declarative grouping rules --------------------------------------------------------------

/** Which markups a rule applies to. Every condition given must hold. */
export interface RuleFilter {
  types?: MarkupType[];
  /** The subject contains this (case does not matter). */
  subject?: string;
  /** The label contains this. */
  label?: string;
  /** On this markup layer. */
  layer?: string;
  /** 0-based pages. */
  pages?: number[];
  /** A custom column (by name) has this value (case does not matter). */
  column?: { name: string; equals: string };
}

export interface Zone {
  name: string;
  pageIndex: number;
  polygon: Point[];
}

/** What value each markup the filter picks gets in the rule's column. */
export type RuleAction =
  | { kind: 'set'; value: string }
  /** The markup's own subject, label, layer, page number or sheet number, or another column's value. */
  | { kind: 'copy'; from: 'subject' | 'label' | 'layer' | 'page' | 'sheet' | { column: string } }
  /** The name of the zone the markup's centre is in. */
  | { kind: 'zone'; zones: Zone[]; otherwise?: string }
  /** Sheet titles or numbers mapped to values ("LEVEL 1" → "L1"): the first pattern the sheet's title or number contains. */
  | { kind: 'sheet'; map: { contains: string; value: string }[]; otherwise?: string };

export interface GroupingTool {
  id: string;
  name: string;
  /** What it does, in a sentence, for the person deciding whether it is appropriate. */
  description: string;
  /** Why the AI made it. */
  reasoning: string;
  source: string;
  createdAt: number;
  status: 'proposed' | 'accepted' | 'rejected';
  /** Turned off by a person: it stays in the library but does not run. */
  disabled?: boolean;
  /** The column it fills. */
  column: string;
  filter: RuleFilter;
  action: RuleAction;
  decided?: { by: string; at: number };
  /** Where it has been used: each grouping column it made. */
  uses?: { documentName: string; proposalId: string; at: number; markups: number }[];
}

/** What a rule reads about the document besides the markups. */
export interface RuleContext {
  columns: readonly CustomColumn[];
  /** Sheet number and title per page. */
  sheets: Readonly<Record<number, { number?: string | null; title?: string | null }>>;
}

const MAX_TEXT = 2000;
const MAX_ZONES = 200;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '');
const lower = (s: string | undefined | null) => (s ?? '').trim().toLowerCase();

/** Checks a rule filter; throws with what is wrong. */
export function checkFilter(raw: unknown): RuleFilter {
  if (raw === undefined) return {};
  if (!isObj(raw)) throw new Error('filter has to be an object');
  const out: RuleFilter = {};
  if (raw.types !== undefined) {
    if (!Array.isArray(raw.types) || raw.types.some((t) => typeof t !== 'string' || !(t in TYPE_INFO))) throw new Error('filter.types has to be a list of markup types');
    out.types = raw.types as MarkupType[];
  }
  for (const k of ['subject', 'label', 'layer'] as const) {
    if (raw[k] === undefined) continue;
    if (typeof raw[k] !== 'string' || !(raw[k] as string).trim()) throw new Error(`filter.${k} has to be some text`);
    out[k] = (raw[k] as string).trim().slice(0, 200);
  }
  if (raw.pages !== undefined) {
    if (!Array.isArray(raw.pages) || raw.pages.some((p) => !Number.isInteger(p) || (p as number) < 0)) throw new Error('filter.pages has to be a list of page numbers');
    out.pages = raw.pages as number[];
  }
  if (raw.column !== undefined) {
    const c = raw.column;
    if (!isObj(c) || typeof c.name !== 'string' || typeof c.equals !== 'string') throw new Error('filter.column has to be { name, equals }');
    out.column = { name: c.name.slice(0, 200), equals: c.equals.slice(0, 200) };
  }
  return out;
}

/** Checks a rule action; throws with what is wrong. */
export function checkAction(raw: unknown): RuleAction {
  if (!isObj(raw)) throw new Error('action has to be an object with a kind');
  if (raw.kind === 'set') {
    if (typeof raw.value !== 'string') throw new Error('a set action needs a value');
    return { kind: 'set', value: raw.value.slice(0, 200) };
  }
  if (raw.kind === 'copy') {
    const f = raw.from;
    if (f === 'subject' || f === 'label' || f === 'layer' || f === 'page' || f === 'sheet') return { kind: 'copy', from: f };
    if (isObj(f) && typeof f.column === 'string' && f.column.trim()) return { kind: 'copy', from: { column: f.column.slice(0, 200) } };
    throw new Error('a copy action takes from: subject, label, layer, page, sheet, or { column }');
  }
  if (raw.kind === 'zone') {
    if (!Array.isArray(raw.zones) || !raw.zones.length || raw.zones.length > MAX_ZONES) throw new Error(`a zone action needs 1 to ${MAX_ZONES} zones`);
    const zones = raw.zones.map((z, i): Zone => {
      if (!isObj(z) || typeof z.name !== 'string' || !Number.isInteger(z.pageIndex) || (z.pageIndex as number) < 0 || !Array.isArray(z.polygon) || z.polygon.length < 3) throw new Error(`zone ${i + 1} has to be { name, pageIndex, polygon (3 or more points) }`);
      const polygon = z.polygon.map((p) => {
        if (!Array.isArray(p) || !finite(p[0]) || !finite(p[1])) throw new Error(`zone ${i + 1}: each point is an x and a y`);
        return [p[0], p[1]] as Point;
      });
      return { name: z.name.slice(0, 200), pageIndex: z.pageIndex as number, polygon };
    });
    return { kind: 'zone', zones, ...(typeof raw.otherwise === 'string' ? { otherwise: raw.otherwise.slice(0, 200) } : {}) };
  }
  if (raw.kind === 'sheet') {
    if (!Array.isArray(raw.map) || !raw.map.length) throw new Error('a sheet action needs map: [{ contains, value }]');
    const map = raw.map.map((e, i) => {
      if (!isObj(e) || typeof e.contains !== 'string' || !e.contains.trim() || typeof e.value !== 'string') throw new Error(`map entry ${i + 1} has to be { contains, value }`);
      return { contains: e.contains.slice(0, 200), value: e.value.slice(0, 200) };
    });
    return { kind: 'sheet', map, ...(typeof raw.otherwise === 'string' ? { otherwise: raw.otherwise.slice(0, 200) } : {}) };
  }
  throw new Error('action.kind has to be set, copy, zone or sheet');
}

function centre(m: Markup): Point {
  const xs = m.points.map((p) => p[0]);
  const ys = m.points.map((p) => p[1]);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
}

const columnValue = (m: Markup, name: string, ctx: RuleContext) => {
  const col = ctx.columns.find((c) => lower(c.name) === lower(name));
  return col ? (m.fields?.[col.id] ?? '') : '';
};

/** Whether a markup passes a filter. */
export function matchesFilter(m: Markup, f: RuleFilter, ctx: RuleContext): boolean {
  if (f.types && !f.types.includes(m.type)) return false;
  if (f.subject && !lower(m.subject).includes(lower(f.subject))) return false;
  if (f.label && !lower(m.label).includes(lower(f.label))) return false;
  if (f.layer && lower(m.layer) !== lower(f.layer)) return false;
  if (f.pages && !f.pages.includes(m.pageIndex)) return false;
  if (f.column && lower(columnValue(m, f.column.name, ctx)) !== lower(f.column.equals)) return false;
  return true;
}

/** The value a rule gives a markup, or null when it gives none. */
export function actionValue(m: Markup, a: RuleAction, ctx: RuleContext): string | null {
  switch (a.kind) {
    case 'set':
      return a.value;
    case 'copy': {
      const f = a.from;
      const v = typeof f === 'object' ? columnValue(m, f.column, ctx) : f === 'page' ? String(m.pageIndex + 1) : f === 'sheet' ? (ctx.sheets[m.pageIndex]?.number ?? '') : (m[f] ?? '');
      return v ? v : null;
    }
    case 'zone': {
      const c = centre(m);
      const z = a.zones.find((zone) => zone.pageIndex === m.pageIndex && pointInPolygon(c, zone.polygon));
      return z?.name ?? a.otherwise ?? null;
    }
    case 'sheet': {
      const s = ctx.sheets[m.pageIndex];
      const text = `${lower(s?.number)} ${lower(s?.title)}`;
      const hit = a.map.find((e) => text.includes(lower(e.contains)));
      return hit?.value ?? a.otherwise ?? null;
    }
  }
}

/** Runs a tool over markups: the grouping it proposes, with a reason per markup. AI drafts are grouped too. */
export function runTool(tool: Pick<GroupingTool, 'name' | 'filter' | 'action'>, markups: readonly Markup[], ctx: RuleContext): GroupingAssignment[] {
  const out: GroupingAssignment[] = [];
  for (const m of markups) {
    if (!matchesFilter(m, tool.filter, ctx)) continue;
    const value = actionValue(m, tool.action, ctx);
    if (value === null) continue;
    out.push({ markupId: m.id, value, reasoning: `${tool.name}: ${describeRuleAction(tool.action)}` });
  }
  return out;
}

/** The rule in words, for a person deciding whether it is appropriate. */
export function describeRuleFilter(f: RuleFilter): string {
  const parts: string[] = [];
  if (f.types?.length) parts.push(f.types.map((t) => TYPE_INFO[t]?.label ?? t).join(' or '));
  if (f.subject) parts.push(`subject contains “${f.subject}”`);
  if (f.label) parts.push(`label contains “${f.label}”`);
  if (f.layer) parts.push(`on layer “${f.layer}”`);
  if (f.pages?.length) parts.push(`on page${f.pages.length === 1 ? '' : 's'} ${f.pages.map((p) => p + 1).join(', ')}`);
  if (f.column) parts.push(`${f.column.name} is “${f.column.equals}”`);
  return parts.length ? parts.join(', ') : 'every markup';
}

export function describeRuleAction(a: RuleAction): string {
  switch (a.kind) {
    case 'set':
      return `set to “${a.value}”`;
    case 'copy':
      return `copied from ${typeof a.from === 'object' ? `the ${a.from.column} column` : `its ${a.from}`}`;
    case 'zone':
      return `the zone it is in (${a.zones.map((z) => z.name).join(', ')})${a.otherwise !== undefined ? `, else “${a.otherwise}”` : ''}`;
    case 'sheet':
      return `by sheet: ${a.map.map((e) => `“${e.contains}” → ${e.value}`).join(', ')}${a.otherwise !== undefined ? `, else “${a.otherwise}”` : ''}`;
  }
}

// ---- Checking what files, peers and storage hold ------------------------------------------------------

const STATUSES: readonly GroupingStatus[] = ['proposed', 'review', 'accepted', 'rejected'];
const decision = (v: unknown) => (isObj(v) && typeof v.by === 'string' && finite(v.at) ? { by: v.by.slice(0, 200), at: v.at } : undefined);
const conf = (v: unknown) => (finite(v) && v >= 0 && v <= 1 ? v : undefined);

export function sanitizeGrouping(v: unknown): GroupingProposal | null {
  if (!isObj(v) || typeof v.id !== 'string' || typeof v.name !== 'string' || !Array.isArray(v.assignments)) return null;
  const assignments = v.assignments.flatMap((a): GroupingAssignment[] => {
    if (!isObj(a) || typeof a.markupId !== 'string' || typeof a.value !== 'string') return [];
    const c = conf(a.confidence);
    const edited = isObj(a.edited) && typeof a.edited.from === 'string' ? { from: a.edited.from.slice(0, 200) } : undefined;
    return [{ markupId: a.markupId, value: a.value.slice(0, 200), ...(typeof a.reasoning === 'string' && a.reasoning ? { reasoning: a.reasoning.slice(0, 500) } : {}), ...(c !== undefined ? { confidence: c } : {}), ...(edited ? { edited } : {}) }];
  });
  const t = v.toolUse;
  const toolUse = isObj(t) && typeof t.toolId === 'string' && typeof t.toolName === 'string' && finite(t.at) && typeof t.by === 'string' ? { toolId: t.toolId, toolName: t.toolName.slice(0, 200), at: t.at, by: t.by.slice(0, 200) } : undefined;
  const acc = v.accepted;
  const accepted = isObj(acc) && typeof acc.by === 'string' && finite(acc.at) && typeof acc.columnId === 'string' ? { by: acc.by, at: acc.at, columnId: acc.columnId } : undefined;
  const rejected = decision(v.rejected);
  const c = conf(v.confidence);
  const options = Array.isArray(v.options) ? v.options.filter((o): o is string => typeof o === 'string').map((o) => o.slice(0, 200)) : undefined;
  return {
    id: v.id,
    name: v.name.slice(0, 200),
    type: v.type === 'choice' ? 'choice' : 'text',
    ...(options?.length ? { options } : {}),
    reasoning: str(v.reasoning, MAX_TEXT),
    ...(c !== undefined ? { confidence: c } : {}),
    source: str(v.source, 80) || 'AI assistant',
    createdAt: finite(v.createdAt) ? v.createdAt : 0,
    status: (STATUSES as readonly unknown[]).includes(v.status) ? (v.status as GroupingStatus) : 'proposed',
    assignments,
    ...(toolUse ? { toolUse } : {}),
    ...(accepted ? { accepted } : {}),
    ...(rejected ? { rejected } : {}),
  };
}

export function sanitizeTool(v: unknown): GroupingTool | null {
  if (!isObj(v) || typeof v.id !== 'string' || typeof v.name !== 'string' || typeof v.column !== 'string') return null;
  let filter: RuleFilter;
  let action: RuleAction;
  try {
    filter = checkFilter(v.filter);
    action = checkAction(v.action);
  } catch {
    return null;
  }
  const uses = Array.isArray(v.uses) ? v.uses.filter((u): u is NonNullable<GroupingTool['uses']>[number] => isObj(u) && typeof u.documentName === 'string' && typeof u.proposalId === 'string' && finite(u.at) && finite(u.markups)) : undefined;
  const decided = decision(v.decided);
  return {
    id: v.id,
    name: v.name.slice(0, 200),
    description: str(v.description, MAX_TEXT),
    reasoning: str(v.reasoning, MAX_TEXT),
    source: str(v.source, 80) || 'AI assistant',
    createdAt: finite(v.createdAt) ? v.createdAt : 0,
    status: v.status === 'accepted' || v.status === 'rejected' ? v.status : 'proposed',
    ...(v.disabled === true ? { disabled: true } : {}),
    column: v.column.slice(0, 200),
    filter,
    action,
    ...(decided ? { decided } : {}),
    ...(uses?.length ? { uses: uses.slice(-200) } : {}),
  };
}

/** A tool may group markups only when a person has accepted it and not turned it off. */
export function toolRuns(t: Pick<GroupingTool, 'status' | 'disabled'>): boolean {
  return t.status === 'accepted' && !t.disabled;
}
