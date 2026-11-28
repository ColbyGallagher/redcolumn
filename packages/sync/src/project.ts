import type { Markup, Reply, StatusChange } from '@nb/markup';
import {
  columnGroupKey,
  CONTENT_KEYS,
  contentGroupKey,
  GEOMETRY_KEYS,
  type Actor as OpsActor,
  type ContentKey,
  type GeometryKey,
  type Issue,
  type MarkupContent,
  type MarkupContentPatch,
  type MarkupGeometry,
  type MarkupGeometryPatch,
  type OpsState,
  type Placement,
  type Response as OpsResponse,
  type StatusDef,
  type StatusEvent,
} from '@nb/ops';

export interface ProjectOptions {
  revisionId: string;
  pages: readonly string[];
  laneId: string;
  resolveAuthor: (actor: OpsActor) => string;
  /** The project's statuses, so the history names them as they read. Without them it shows ids. */
  statuses?: readonly StatusDef[];
}

export interface ProjectedView {
  markups: Markup[];
  byId: Map<string, Markup>;
  placementByMarkupId: Map<string, Placement>;
}

/** Deep value equality for plain JSON markup fields. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  if (Array.isArray(b)) return false;
  const keysA = Object.keys(a as Record<string, unknown>);
  const keysB = Object.keys(b as Record<string, unknown>);
  if (keysA.length !== keysB.length) return false;
  for (const k of keysA) {
    if (!Object.hasOwn(b, k)) return false;
    if (!deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  }
  return true;
}

/** The issue each linked markup shows: the first live one linking it, by markup id. */
export function issuesByMarkup(state: OpsState): Map<string, Issue> {
  const out = new Map<string, Issue>();
  for (const issue of Object.values(state.issues)) {
    if (issue.deleted) continue;
    for (const markupId of issue.markupIds) {
      if (!out.has(markupId)) out.set(markupId, issue);
    }
  }
  return out;
}

/** Projects `OpsState` for one immutable revision into the flat `Markup[]` shape the viewer expects. */
export function projectMarkups(state: OpsState, options: ProjectOptions): ProjectedView {
  const { revisionId, pages, laneId, resolveAuthor, statuses } = options;
  const statusName = (id: string) => statuses?.find((s) => s.id === id)?.name ?? id;
  const pageIndexById = new Map<string, number>();
  for (let i = 0; i < pages.length; i++) pageIndexById.set(pages[i]!, i);

  const issueByMarkup = issuesByMarkup(state);

  // Index non-deleted responses by markupId (direct or via linked issue).
  const responsesByMarkup = new Map<string, OpsResponse[]>();
  const responsesByIssue = new Map<string, OpsResponse[]>();
  for (const resp of Object.values(state.responses)) {
    if (resp.deleted) continue;
    const bucket = resp.parent.kind === 'markup' ? responsesByMarkup : responsesByIssue;
    const list = bucket.get(resp.parent.id) ?? [];
    list.push(resp);
    bucket.set(resp.parent.id, list);
  }

  // Index status events by issueId for the active lane.
  const eventsByIssue = new Map<string, StatusEvent[]>();
  for (const ev of Object.values(state.statusEvents)) {
    if (ev.laneId !== laneId) continue;
    const list = eventsByIssue.get(ev.issueId) ?? [];
    list.push(ev);
    eventsByIssue.set(ev.issueId, list);
  }

  const markups: Markup[] = [];
  const byId = new Map<string, Markup>();
  const placementByMarkupId = new Map<string, Placement>();

  for (const placement of Object.values(state.placements)) {
    if (placement.deleted || placement.revisionId !== revisionId || placement.state === 'not_found') continue;
    const pageIndex = pageIndexById.get(placement.pageId);
    if (pageIndex === undefined) continue;
    if (placementByMarkupId.has(placement.markupId)) continue;
    const record = Object.hasOwn(state.markups, placement.markupId) ? state.markups[placement.markupId] : undefined;
    if (!record || record.deleted) continue;

    const issue = issueByMarkup.get(record.id);
    const laneStatus = issue && Object.hasOwn(state.laneStatus, issue.id)
      ? state.laneStatus[issue.id]?.[laneId]
      : undefined;

    const projected: Record<string, unknown> = {
      id: record.id,
      type: record.type,
      pageIndex,
      ...structuredClone(record.content),
      ...structuredClone(placement.geometry),
      status: laneStatus?.status ?? 'none',
      author: resolveAuthor(record.owner),
      createdAt: record.createdAt,
      modifiedAt: Math.max(record.modifiedAt, placement.modifiedAt),
    };

    if (issue?.checked) projected.checked = true;
    if (issue?.number !== null && issue?.number !== undefined) projected.seq = issue.number;

    const rawReplies = [
      ...(responsesByMarkup.get(record.id) ?? []),
      ...(issue ? responsesByIssue.get(issue.id) ?? [] : []),
    ];
    if (rawReplies.length) {
      rawReplies.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
      projected.replies = rawReplies.map(
        (r): Reply => ({
          id: r.id,
          author: resolveAuthor(r.owner),
          text: r.body,
          createdAt: r.createdAt,
          ...(r.inReplyTo ? { parentId: r.inReplyTo } : {}),
        }),
      );
    }

    if (issue) {
      const evs = eventsByIssue.get(issue.id) ?? [];
      evs.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
      const history = evs.map(
        (e): StatusChange => ({
          state: statusName(e.to),
          model: 'Review',
          author: resolveAuthor(e.actor),
          at: e.at,
        }),
      );
      // The status an issue is raised with has no event. It is history too, unless the issue was
      // raised only to make a change in the same batch, which has the same time.
      const first = evs[0];
      const initial = first ? first.from : laneStatus?.status;
      if (initial && first?.at !== issue.createdAt) {
        history.unshift({ state: statusName(initial), model: 'Review', author: resolveAuthor(issue.owner), at: issue.createdAt });
      }
      if (history.length) projected.statusHistory = history;
    }

    const markup = projected as unknown as Markup;
    markups.push(markup);
    byId.set(record.id, markup);
    placementByMarkupId.set(record.id, placement);
  }

  return { markups, byId, placementByMarkupId };
}

/** Splits a `Markup` into its `@nb/ops` content record payload and placement geometry payload. */
export function splitMarkup(markup: Markup): { content: MarkupContent; geometry: MarkupGeometry } {
  const content: Record<string, unknown> = {};
  for (const key of CONTENT_KEYS) {
    const value = markup[key];
    if (value !== undefined) content[key] = structuredClone(value);
  }
  const geometry: Record<string, unknown> = {};
  for (const key of GEOMETRY_KEYS) {
    const value = markup[key];
    if (value !== undefined) geometry[key] = structuredClone(value);
  }
  return {
    content: content as unknown as MarkupContent,
    geometry: geometry as unknown as MarkupGeometry,
  };
}

export interface MarkupDiff {
  contentSet: MarkupContentPatch;
  fieldsPatch: Record<string, string | null>;
  contentGroups: string[];
  inverseContentSet: MarkupContentPatch;
  inverseFieldsPatch: Record<string, string | null>;
  geometryPatch: MarkupGeometryPatch;
  inverseGeometryPatch: MarkupGeometryPatch;
  geometryChanged: boolean;
  pageChanged: boolean;
}

/**
 * Computes both the forward `@nb/ops` patch and its exact inverse between `before` and `after`.
 * Only changed fields (by deep JSON equality) are included, keeping field groups minimal so
 * concurrent edits to other groups never conflict.
 */
export function diffMarkup(before: Markup, after: Markup): MarkupDiff {
  const contentSet: Record<string, unknown> = {};
  const inverseContentSet: Record<string, unknown> = {};
  const contentGroups = new Set<string>();

  for (const key of CONTENT_KEYS) {
    if (key === 'fields') continue;
    const prev = before[key];
    const next = after[key];
    if (deepEqual(prev, next)) continue;
    contentSet[key] = next === undefined ? null : structuredClone(next);
    inverseContentSet[key] = prev === undefined ? null : structuredClone(prev);
    contentGroups.add(contentGroupKey(key as Exclude<ContentKey, 'fields'>));
  }

  const fieldsPatch: Record<string, string | null> = {};
  const inverseFieldsPatch: Record<string, string | null> = {};
  const prevFields = before.fields ?? {};
  const nextFields = after.fields ?? {};
  const allColumns = new Set([...Object.keys(prevFields), ...Object.keys(nextFields)]);
  for (const col of allColumns) {
    const prev = Object.hasOwn(prevFields, col) ? prevFields[col] : undefined;
    const next = Object.hasOwn(nextFields, col) ? nextFields[col] : undefined;
    if (prev === next) continue;
    fieldsPatch[col] = next === undefined ? null : next;
    inverseFieldsPatch[col] = prev === undefined ? null : prev;
    contentGroups.add(columnGroupKey(col));
  }

  const geometryPatch: Record<string, unknown> = {};
  const inverseGeometryPatch: Record<string, unknown> = {};
  let geometryChanged = false;
  for (const key of GEOMETRY_KEYS) {
    const prev = before[key as GeometryKey];
    const next = after[key as GeometryKey];
    if (deepEqual(prev, next)) continue;
    geometryPatch[key] = next === undefined ? null : structuredClone(next);
    inverseGeometryPatch[key] = prev === undefined ? null : structuredClone(prev);
    geometryChanged = true;
  }

  return {
    contentSet: contentSet as MarkupContentPatch,
    fieldsPatch,
    contentGroups: [...contentGroups],
    inverseContentSet: inverseContentSet as MarkupContentPatch,
    inverseFieldsPatch,
    geometryPatch: geometryPatch as MarkupGeometryPatch,
    inverseGeometryPatch: inverseGeometryPatch as MarkupGeometryPatch,
    geometryChanged,
    pageChanged: before.pageIndex !== after.pageIndex,
  };
}
