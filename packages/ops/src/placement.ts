import type { Placement } from './entities.ts';
import { GEOMETRY_KEYS } from './fieldGroups.ts';
import type { OperationOf } from './operations.ts';
import { bumped, created, invalid, own, patched, reject, setDeleted, staleGroups, withEntry, type ApplyContext, type ApplyResult, type OpsState } from './state.ts';

type PlacementOp = OperationOf<'placement.create' | 'placement.patch' | 'placement.delete' | 'placement.restore'>;

const GEOMETRY = new Set<string>(GEOMETRY_KEYS);
const notGeometry = (geometry: object): string | undefined => Object.keys(geometry).find((k) => !GEOMETRY.has(k));

/** The markup's live placement on `revisionId`, other than `self`, if `state` holds one. */
function livePlacement(state: OpsState, markupId: string, revisionId: string, self: string): Placement | undefined {
  for (const p of Object.values(state.placements)) {
    if (p.id !== self && !p.deleted && p.markupId === markupId && p.revisionId === revisionId) return p;
  }
  return undefined;
}

/**
 * Applies a placement operation. A placement's shape (`geometry`) and how it was placed (`state`:
 * method, confidence and state) are versioned apart, so confirming a suggestion and nudging it do
 * not conflict. Its markup must exist and not be deleted, except to delete the placement.
 *
 * A markup sits at most once on each revision. Making or restoring a placement where the markup
 * already has a live one on that revision is a conflict: someone else moved it meanwhile. (Moving
 * deletes the old placement and makes a new one, and deleting never conflicts, so without this two
 * people moving one markup at the same time would leave it in two places.) The check sees the
 * placements in `state`, so a server passing only some records must include the markup's other
 * placements on the revision.
 */
export function reducePlacement(state: OpsState, op: PlacementOp, ctx: ApplyContext): ApplyResult {
  const current = own(state.placements, op.entityId);
  const done = (record: Placement): ApplyResult => ({
    ok: true,
    state: record === current ? state : { ...state, placements: withEntry(state.placements, record.id, record) },
    changes: record === current ? [] : [{ kind: 'placement', id: record.id }],
  });

  if (op.type !== 'placement.create' && !current) return reject({ code: 'not_found', kind: 'placement', id: op.entityId });
  if (op.type === 'placement.create' && current) return reject({ code: 'exists', kind: 'placement', id: op.entityId });
  if (op.type === 'placement.delete') return done(setDeleted(current!, true, op, ctx.now));

  const markupId = op.type === 'placement.create' ? op.payload.markupId : current!.markupId;
  const markup = own(state.markups, markupId);
  if (!markup) return reject({ code: 'not_found', kind: 'markup', id: markupId });
  if (markup.deleted) return reject({ code: 'deleted', kind: 'markup', id: markup.id });

  if (op.type === 'placement.create') {
    const { geometry, ...rest } = op.payload;
    const bad = notGeometry(geometry);
    if (bad) return invalid(`"${bad}" is not part of a placement's shape`);
    if (!Array.isArray(geometry.points)) return invalid('A placement needs points');
    const other = livePlacement(state, markupId, rest.revisionId, op.entityId);
    if (other) return reject({ code: 'conflict', conflicts: [{ kind: 'placement', id: other.id, groups: ['deleted'] }] });
    return done({ ...created(op, ctx), ...rest, geometry });
  }
  const record = current!;
  if (op.type === 'placement.restore') {
    const other = record.deleted ? livePlacement(state, markupId, record.revisionId, record.id) : undefined;
    if (other) return reject({ code: 'conflict', conflicts: [{ kind: 'placement', id: other.id, groups: ['deleted'] }] });
    return done(setDeleted(record, false, op, ctx.now));
  }
  if (record.deleted) return reject({ code: 'deleted', kind: 'placement', id: record.id });

  const { geometry, placed } = op.payload;
  const groups: string[] = [];
  if (geometry && Object.keys(geometry).length) {
    const bad = notGeometry(geometry);
    if (bad) return invalid(`"${bad}" is not part of a placement's shape`);
    if ('points' in geometry && !Array.isArray(geometry.points)) return invalid('A placement needs points');
    groups.push('geometry');
  }
  if (placed && Object.values(placed).some((v) => v !== undefined)) groups.push('state');
  if (!groups.length) return invalid('The patch changes nothing');

  const stale = staleGroups(record, groups, op.basedOn);
  if (stale.length) return reject({ code: 'conflict', conflicts: [{ kind: 'placement', id: record.id, groups: stale }] });
  return done({
    ...record,
    geometry: geometry ? patched(record.geometry, geometry) : record.geometry,
    method: placed?.method ?? record.method,
    confidence: placed?.confidence === undefined ? record.confidence : placed.confidence,
    state: placed?.state ?? record.state,
    ...bumped(record, groups, op, ctx.now),
  });
}
