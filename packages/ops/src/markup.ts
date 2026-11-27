import type { MarkupRecord } from './entities.ts';
import { columnGroupKey, CONTENT_KEYS, contentGroupKey, type ContentKey, type MarkupContent } from './fieldGroups.ts';
import type { OperationOf } from './operations.ts';
import { bumped, created, invalid, own, patched, reject, setDeleted, staleGroups, withEntry, type ApplyContext, type ApplyResult, type OpsState } from './state.ts';

type MarkupOp = OperationOf<'markup.create' | 'markup.patch' | 'markup.delete' | 'markup.restore'>;

const CONTENT = new Set<string>(CONTENT_KEYS);

/** Applies a markup operation: make one, change its content, delete or restore it. */
export function reduceMarkup(state: OpsState, op: MarkupOp, ctx: ApplyContext): ApplyResult {
  const current = own(state.markups, op.entityId);
  const done = (record: MarkupRecord): ApplyResult => ({
    ok: true,
    state: record === current ? state : { ...state, markups: withEntry(state.markups, record.id, record) },
    changes: record === current ? [] : [{ kind: 'markup', id: record.id }],
  });

  if (op.type === 'markup.create') {
    if (current) return reject({ code: 'exists', kind: 'markup', id: op.entityId });
    const { scopeId, type, content } = op.payload;
    const bad = Object.keys(content).find((k) => !CONTENT.has(k));
    if (bad) return invalid(`"${bad}" is not markup content`);
    if (!content.style) return invalid('A markup needs a style');
    return done({ ...created(op, ctx), scopeId, type, content, owner: ctx.actor });
  }

  if (!current) return reject({ code: 'not_found', kind: 'markup', id: op.entityId });
  if (op.type === 'markup.delete') return done(setDeleted(current, true, op, ctx.now));
  if (op.type === 'markup.restore') return done(setDeleted(current, false, op, ctx.now));

  if (current.deleted) return reject({ code: 'deleted', kind: 'markup', id: current.id });
  const set = op.payload.set ?? {};
  const fields = op.payload.fields ?? {};
  const groups = new Set<string>();
  for (const key of Object.keys(set)) {
    if (!CONTENT.has(key) || key === 'fields') return invalid(`"${key}" cannot be set on a markup`);
    groups.add(contentGroupKey(key as Exclude<ContentKey, 'fields'>));
  }
  if ('style' in set && !set.style) return invalid('A markup needs a style');
  for (const column of Object.keys(fields)) groups.add(columnGroupKey(column));
  if (!groups.size) return invalid('The patch changes nothing');

  const stale = staleGroups(current, groups, op.basedOn);
  if (stale.length) return reject({ code: 'conflict', conflicts: [{ kind: 'markup', id: current.id, groups: stale }] });

  let content: MarkupContent = patched(current.content, set);
  if (Object.keys(fields).length) {
    const columns = patched(current.content.fields ?? {}, fields);
    content = patched(content, { fields: Object.keys(columns).length ? columns : null });
  }
  return done({ ...current, content, ...bumped(current, groups, op, ctx.now) });
}
