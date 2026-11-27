import type { Actor, GroupVersion, Issue, ItemKind, LaneStatus, MarkupRecord, Placement, Release, Response, StatusDef, StatusEvent, VersionedRecord } from './entities.ts';
import type { AnyOperation } from './operations.ts';

/**
 * The records operations act on, keyed by id. A client holds a whole document's and project's;
 * the server can pass just the records an operation needs (see `dependencies`).
 */
export interface OpsState {
  markups: Readonly<Record<string, MarkupRecord>>;
  placements: Readonly<Record<string, Placement>>;
  issues: Readonly<Record<string, Issue>>;
  responses: Readonly<Record<string, Response>>;
  statusEvents: Readonly<Record<string, StatusEvent>>;
  /** Per issue id, per lane id, the status that lane sees. */
  laneStatus: Readonly<Record<string, Readonly<Record<string, LaneStatus>>>>;
  releases: Readonly<Record<string, Release>>;
}

export const emptyState = (): OpsState => ({ markups: {}, placements: {}, issues: {}, responses: {}, statusEvents: {}, laneStatus: {}, releases: {} });

/**
 * What applying an operation needs besides the operation: who is acting and when, worked out by
 * the server (or, for an optimistic apply, by the client for itself), and the rules in force now.
 */
export interface ApplyContext {
  actor: Actor;
  /** The lane the actor works in; status changes are recorded for it. */
  laneId: string;
  /** Server time, ms since the epoch (the client's own clock for an optimistic apply). */
  now: number;
  /** The project's statuses. When given, a status change must name one, and closing needs `revisionSeenId`. */
  statuses?: readonly StatusDef[];
}

/** The kinds of record a rejection can name. */
export type RecordKind = ItemKind | 'release';

/** A group that was out of date, on one record. */
export interface Conflict {
  kind: ItemKind;
  id: string;
  /** Group keys; `status` for a status that has moved, `rev` for a released item that changed. */
  groups: string[];
}

/**
 * Why an operation was not applied.
 * - `invalid`: it cannot apply whatever the state (bad shape, impossible change).
 * - `not_found`: a record it names does not exist. The server gives the same answer for a record
 *   the actor cannot see.
 * - `exists`: a new record's id is already used.
 * - `deleted`: it edits a deleted record. The client keeps the work.
 * - `conflict`: a group it changes moved on since the version it was based on.
 */
export type Rejection =
  | { code: 'invalid'; message: string }
  | { code: 'not_found'; kind: RecordKind; id: string }
  | { code: 'exists'; kind: RecordKind; id: string }
  | { code: 'deleted'; kind: RecordKind; id: string }
  | { code: 'conflict'; conflicts: Conflict[] };

/** What one record kind changed. */
export interface Change {
  kind: RecordKind | 'laneStatus';
  id: string;
}

export type ApplyResult =
  | { ok: true; state: OpsState; changes: Change[] }
  | { ok: false; rejection: Rejection };

export const reject = (rejection: Rejection): ApplyResult => ({ ok: false, rejection });
export const invalid = (message: string): ApplyResult => reject({ code: 'invalid', message });

/** An own entry of a record map: ids are never looked up through the prototype. */
export const own = <T>(map: Readonly<Record<string, T>>, id: string): T | undefined => (Object.hasOwn(map, id) ? map[id] : undefined);

/** A copy of a map with one entry set. */
export const withEntry = <T>(map: Readonly<Record<string, T>>, id: string, value: T): Record<string, T> => ({ ...map, [id]: value });

export const versionOf = (record: VersionedRecord, group: string): GroupVersion => own(record.versions, group) ?? { v: 0, op: record.createdBy };

/**
 * The groups among `groups` whose version is not what the operation was based on. A group is
 * current when `basedOn` names its version number or the operation that last changed it. A group
 * missing from `basedOn` counts as out of date.
 */
export function staleGroups(record: VersionedRecord, groups: Iterable<string>, basedOn: Record<string, number | string> | undefined): string[] {
  const stale: string[] = [];
  for (const group of groups) {
    const base = basedOn && Object.hasOwn(basedOn, group) ? basedOn[group] : undefined;
    const current = versionOf(record, group);
    if (base === undefined || (base !== current.v && base !== current.op)) stale.push(group);
  }
  return stale;
}

/** The record's `rev`, versions and time after an accepted change to `groups` by `op`. */
export function bumped<R extends VersionedRecord>(record: R, groups: Iterable<string>, op: AnyOperation, now: number): Pick<R, 'rev' | 'versions' | 'modifiedAt'> {
  const versions: Record<string, GroupVersion> = { ...record.versions };
  for (const group of groups) versions[group] = { v: versionOf(record, group).v + 1, op: op.opId };
  return { rev: record.rev + 1, versions, modifiedAt: now };
}

/** Fields every new record starts with. */
export const created = (op: AnyOperation, ctx: ApplyContext): VersionedRecord => ({
  id: op.entityId,
  rev: 1,
  versions: {},
  createdBy: op.opId,
  createdAt: ctx.now,
  modifiedAt: ctx.now,
  clientTime: op.clientTime ?? null,
  deleted: false,
});

/**
 * A plain copy of an object with `patch` applied: a null value clears the field. Keys that are
 * not the object's own data (`__proto__` and the like) are never written.
 */
export function patched<T extends object>(base: T, patch: Readonly<Record<string, unknown>>): T {
  const out = { ...base } as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    if (value === null) delete out[key];
    else if (value !== undefined) out[key] = value;
  }
  return out as T;
}

/**
 * Delete or restore a record. Delete is not checked against versions: deleting a draft wins over
 * edits made since (released items are governed by the withdraw rules, outside these reducers).
 * Deleting a deleted record, or restoring a live one, changes nothing.
 */
export function setDeleted<R extends VersionedRecord>(record: R, deleted: boolean, op: AnyOperation, now: number): R {
  if (record.deleted === deleted) return record;
  return { ...record, deleted, ...bumped(record, ['deleted'], op, now) };
}
