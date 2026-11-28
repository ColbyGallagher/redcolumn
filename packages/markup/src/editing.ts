import { DEFAULT_STATUSES, type MarkupStatusDef } from './columns.ts';
import { gluedTo, routeConnector } from './flowchart.ts';
import type { Markup, Point } from './model.ts';
import { openPatch, type EditRule } from './ownership.ts';
import { shiftSpans } from './textSpans.ts';

/**
 * Pure editing rules for markups: what adding, updating or removing markups writes to the store.
 * Every planner reads current state through {@link MarkupLookup} without mutating its inputs, takes
 * actor/clock/permissions explicitly, and returns a plan for the store to apply in one transaction.
 */

/** Read-only view of the markups currently in a document (`ReadonlyMap<string, Markup>` satisfies it). */
export interface MarkupLookup {
  get(id: string): Markup | undefined;
  values(): Iterable<Markup>;
}

/** Patch passed to an update: any markup field except `id` (`undefined` removes the field). */
export type MarkupPatch = Partial<Omit<Markup, 'id'>>;

/** Changes a planner decides to apply to the markup store. */
export interface EditPlan {
  /** Markups to insert or replace, in application order. */
  put: Markup[];
  /** Markup IDs to delete. */
  remove: string[];
}

/** Result of planning an `add` operation. */
export interface AddPlan extends EditPlan {
  /** The newly added markup when its id was not already present, or `null` when replacing an existing markup. */
  added: Markup | null;
  /** New high-water sequence number to record when a new markup was numbered. */
  nextSeq?: number;
}

/** Full editing context; individual planners accept the narrow slice they use. */
export interface EditContext {
  /** Name of the person making the edit, recorded in status history. */
  actor: string;
  /** Timestamp (ms since epoch) recorded in `modifiedAt` and status history. */
  now: number;
  /** The document's status definitions, used to resolve status names and state models. Defaults to `DEFAULT_STATUSES`. */
  statuses?: readonly MarkupStatusDef[];
  /** Highest markup sequence number already handed out (`meta.seq`). Defaults to 0. */
  lastSeq?: number;
  /** Whether this editor may change a markup beyond its open fields. Defaults to allowing all. */
  mayEdit?: EditRule;
  /** Optimization hint: pass `false` when the document currently has no connectors. Defaults to `true`. */
  hasConnectors?: boolean;
}

export type AddContext = Pick<EditContext, 'lastSeq' | 'mayEdit' | 'hasConnectors'>;
export type UpdateContext = Pick<EditContext, 'actor' | 'now' | 'statuses' | 'mayEdit' | 'hasConnectors'>;
export type RemoveContext = Pick<EditContext, 'mayEdit'>;
export type FollowConnectorsContext = Pick<EditContext, 'mayEdit' | 'hasConnectors'>;

const ALLOW_ALL: EditRule = () => true;

function stripUndefined(markup: Markup): Markup {
  const clean: Record<string, unknown> = { ...markup };
  for (const k of Object.keys(clean)) if (clean[k] === undefined) delete clean[k];
  return clean as unknown as Markup;
}

function maxSeq(markups: MarkupLookup, recorded: number): number {
  let max = recorded;
  for (const m of markups.values()) if (m.seq && m.seq > max) max = m.seq;
  return max;
}

function pointsChanged(before: readonly Point[], after: readonly Point[]): boolean {
  return after !== before && JSON.stringify(after) !== JSON.stringify(before);
}

function withOverlay(markups: MarkupLookup, overlay: Markup): MarkupLookup {
  return {
    get: (id) => (id === overlay.id ? overlay : markups.get(id)),
    *values() {
      let yielded = false;
      for (const m of markups.values()) {
        if (m.id === overlay.id) {
          yielded = true;
          yield overlay;
        } else {
          yield m;
        }
      }
      if (!yielded) yield overlay;
    },
  };
}

/**
 * Re-routes connectors affected by changes to `changedIds` (a changed markup that is itself a
 * connector, or a connector glued to one of `changedIds`). Returns only connectors whose points
 * changed.
 */
export function planFollowConnectors(
  markups: MarkupLookup,
  changedIds: ReadonlySet<string>,
  ctx: FollowConnectorsContext = {},
): Markup[] {
  if (ctx.hasConnectors === false) return [];
  const mayEdit = ctx.mayEdit ?? ALLOW_ALL;
  const get = (id: string) => markups.get(id);
  const out: Markup[] = [];
  for (const c of markups.values()) {
    if (c.type !== 'connector' || !(changedIds.has(c.id) || gluedTo(c, changedIds)) || !mayEdit(c)) continue;
    const points = routeConnector(c, get);
    if (pointsChanged(c.points, points)) out.push({ ...c, points });
  }
  return out;
}

function rerouteWithPrimary(
  markups: MarkupLookup,
  primary: Markup,
  mayEdit: EditRule,
  hasConnectors: boolean | undefined,
): { primary: Markup; followed: Markup[] } {
  const after = withOverlay(markups, primary);
  if (hasConnectors === false) {
    if (primary.type === 'connector' && mayEdit(primary)) {
      const points = routeConnector(primary, after.get);
      if (pointsChanged(primary.points, points)) primary = { ...primary, points };
    }
    return { primary, followed: [] };
  }
  const followed: Markup[] = [];
  for (const c of planFollowConnectors(after, new Set([primary.id]), { mayEdit })) {
    if (c.id === primary.id) primary = c;
    else followed.push(c);
  }
  return { primary, followed };
}

/**
 * Plans adding a new markup or replacing one with the same id:
 * - strips `undefined` fields;
 * - a new markup takes the next sequence number (never reusing one below `lastSeq` or any existing
 *   markup's `seq`), and starts without carried-over status history when its status is `'none'`;
 * - replacing an existing markup keeps its sequence number;
 * - routes a new connector to its shapes, and re-routes glued connectors when a shape is placed.
 */
export function planAdd(markups: MarkupLookup, markup: Markup, ctx: AddContext = {}): AddPlan {
  const mayEdit = ctx.mayEdit ?? ALLOW_ALL;
  const clean = stripUndefined(markup);
  const existing = markups.get(markup.id);
  let isNew = false;
  let nextSeq: number | undefined;
  if (existing) {
    if (existing.seq) clean.seq = existing.seq;
  } else {
    isNew = true;
    const seq = maxSeq(markups, ctx.lastSeq ?? 0) + 1;
    clean.seq = seq;
    nextSeq = seq;
    // A copy starts without the status it was copied from, so without its history too.
    if (clean.status === 'none') delete clean.statusHistory;
  }
  const { primary, followed } = rerouteWithPrimary(markups, clean, mayEdit, ctx.hasConnectors);
  return {
    put: [primary, ...followed],
    remove: [],
    added: isNew ? primary : null,
    ...(nextSeq !== undefined ? { nextSeq } : {}),
  };
}

/**
 * Plans merging `patch` into an existing markup (`undefined` removes a field):
 * - enforces `mayEdit`: on someone else's markup only open fields apply;
 * - appends status history on a status change unless `statusHistory` is explicitly patched;
 * - clears hand-set assembly overrides, AI takeoff approval, and assembly inputs when changing
 *   assemblies (unless explicitly supplied in the patch);
 * - shifts styled text spans when `text` changes without an explicit `spans` patch;
 * - re-routes glued connectors when geometry, rotation, page or connection links change.
 */
export function planUpdate(markups: MarkupLookup, id: string, patch: MarkupPatch, ctx: UpdateContext): EditPlan {
  const current = markups.get(id);
  if (!current) return { put: [], remove: [] };
  const mayEdit = ctx.mayEdit ?? ALLOW_ALL;
  let effective: MarkupPatch = patch;
  if (!mayEdit(current)) {
    // Someone else's markup: only its status and replies change here.
    const open = openPatch(patch);
    if (!open) return { put: [], remove: [] };
    effective = open;
  }
  // A new status goes into the markup's status history: who set it, and when.
  if (effective.status !== undefined && effective.status !== current.status && !('statusHistory' in effective)) {
    const statuses = ctx.statuses ?? DEFAULT_STATUSES;
    const def = statuses.find((s) => s.id === effective.status);
    const state = def?.name ?? (effective.status === 'none' ? 'None' : effective.status);
    effective = {
      ...effective,
      statusHistory: [...(current.statusHistory ?? []), { state, model: def?.model ?? 'Review', author: ctx.actor, at: ctx.now }],
    };
  }
  // Another assembly: quantities set by hand and an AI approval were for the old one.
  if ('assemblyId' in effective && effective.assemblyId !== current.assemblyId && !('assemblyOverrides' in effective)) {
    effective = { ...effective, assemblyOverrides: undefined, takeoffApproval: undefined };
  }
  // Another assembly's inputs are not this one's.
  if ('assemblyId' in effective && effective.assemblyId !== current.assemblyId && !('assemblyInputs' in effective)) {
    effective = { ...effective, assemblyInputs: undefined };
  }
  // New text without its own styled parts keeps the old ones on the characters that stayed.
  if ('text' in effective && !('spans' in effective) && current.spans?.length) {
    const spans = shiftSpans(current.spans, current.text ?? '', effective.text ?? '');
    effective = { ...effective, spans: spans.length ? spans : undefined };
  }
  const merged = stripUndefined({ ...current, ...effective, modifiedAt: ctx.now } as Markup);
  if ('points' in effective || 'rotation' in effective || 'connect' in effective || 'pageIndex' in effective) {
    const { primary, followed } = rerouteWithPrimary(markups, merged, mayEdit, ctx.hasConnectors);
    return { put: [primary, ...followed], remove: [] };
  }
  return { put: [merged], remove: [] };
}

/**
 * Plans removing `ids`: keeps only markups that exist and that this editor may edit. Glued
 * connectors and group peers are left alone (undoing a deleted shape re-glues its connectors).
 */
export function planRemove(markups: MarkupLookup, ids: Iterable<string>, ctx: RemoveContext = {}): EditPlan {
  const mayEdit = ctx.mayEdit ?? ALLOW_ALL;
  const seen = new Set<string>();
  const remove: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const m = markups.get(id);
    if (m && mayEdit(m)) remove.push(id);
  }
  return { put: [], remove };
}
