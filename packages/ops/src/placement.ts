import type { Placement } from './entities.ts';
import { GEOMETRY_KEYS } from './fieldGroups.ts';
import type { OperationOf } from './operations.ts';
import { bumped, created, invalid, own, patched, reject, setDeleted, staleGroups, withEntry, type ApplyContext, type ApplyResult, type OpsState } from './state.ts';

type PlacementOp = OperationOf<'placement.create' | 'placement.patch' | 'placement.delete' | 'placement.restore'>;

const GEOMETRY = new Set<string>(GEOMETRY_KEYS);
const notGeometry = (geometry: object): string | undefined => Object.keys(geometry).find((k) => !GEOMETRY.has(k));

/**
 * Applies a placement operation. A placement's shape (`geometry`) and how it was placed (`state`:
 * method, confidence and state) are versioned apart, so confirming a suggestion and nudging it do
 * not conflict. Its markup must exist and not be deleted, except to delete the placement.
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
    return done({ ...created(op, ctx), ...rest, geometry });
  }
  const record = current!;
  if (op.type === 'placement.restore') return done(setDeleted(record, false, op, ctx.now));
  if (record.deleted) return reject({ code: 'deleted', kind: 'placement', id: record.id });

  const { geometry, placed } = op.payload;
  const groups: string[] = [];
  if (geometry) {
    let hasGeometry = false;
    for (const [key, value] of Object.entries(geometry)) {
      if (value === undefined) continue;
      if (!GEOMETRY.has(key)) return invalid(`"${key}" is not part of a placement's shape`);
      hasGeometry = true;
    }
    if (geometry.points !== undefined && !Array.isArray(geometry.points)) return invalid('A placement needs points');
    if (hasGeometry) groups.push('geometry');
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
