import { randomUUID } from 'node:crypto';
import { kindOf, type ItemKind, type MarkupRecord, type Operation, type OpsState, type Placement } from '@nb/ops';
import {
  authorizeOp,
  computeItemAudiences,
  DEFAULT_STATUSES,
  itemKey,
  type DraftVisibility,
  type Grant,
  type ItemMeta,
  type PolicyDenyReason,
  type PolicyState,
  type ProcessConfig,
  type ProjectConfig,
  type RoleAssignment,
} from '@nb/policy';
import { sql, type Kysely, type Transaction } from 'kysely';
import type { Database, ProjectRole } from './db.ts';

/*
 * Who may use a document's stream, and what each accepted change makes visible.
 *
 * A document's stream has the document's id. Its markups belong to the project's first review
 * scope, and everyone on the project works in that scope's first lane. Permission is decided by
 * `@nb/policy` from the rows in force at the time, and every accepted version of an item is given
 * explicit audience rows, which the row-level security policies check when the item is read back.
 */

export interface DocumentAccess {
  userId: string;
  projectId: string;
  documentId: string;
  role: ProjectRole;
  scopeId: string;
  scopeKind: 'review' | 'session';
  scopeName: string;
  laneId: string;
  laneName: string;
  draftVisibility: DraftVisibility;
  autoRelease: boolean;
  numberingMode: 'on_create' | 'on_first_crossing';
  tickClosesIssue: boolean;
  allowAmendmentWhileOpen: boolean;
  sessionState: 'open' | 'locked' | 'closed' | null;
}

type Db = Kysely<Database> | Transaction<Database>;

/** The document a stream belongs to, or null for a stream that is not a document's. */
export async function documentOfStream(db: Db, streamId: string): Promise<{ documentId: string; projectId: string } | null> {
  const row = await db.selectFrom('documents').select(['id', 'project_id']).where('id', '=', streamId).executeTakeFirst();
  return row ? { documentId: row.id, projectId: row.project_id } : null;
}

/**
 * The access `userId` has to a document stream right now, or null when they have none: the stream
 * is not a document, the project is archived, or they are not an active member of it and its lane.
 * A missing document and a hidden one give the same answer.
 */
export async function resolveDocumentAccess(db: Db, userId: string, streamId: string): Promise<DocumentAccess | null> {
  const member = await db
    .selectFrom('documents')
    .innerJoin('projects', 'projects.id', 'documents.project_id')
    .innerJoin('project_members', 'project_members.project_id', 'projects.id')
    .innerJoin('users', 'users.id', 'project_members.user_id')
    .select(['documents.id as document_id', 'projects.id as project_id', 'project_members.role as role'])
    .where('documents.id', '=', streamId)
    .where('projects.archived_at', 'is', null)
    .where('project_members.user_id', '=', userId)
    .where('project_members.state', '=', 'active')
    .where('users.disabled_at', 'is', null)
    .executeTakeFirst();
  if (!member) return null;

  const lane = await db
    .selectFrom('scopes')
    .innerJoin('lanes', 'lanes.scope_id', 'scopes.id')
    .innerJoin('lane_members', 'lane_members.lane_id', 'lanes.id')
    .select([
      'scopes.id as scope_id',
      'scopes.kind as scope_kind',
      'scopes.name as scope_name',
      'scopes.default_draft_visibility as scope_draft_visibility',
      'scopes.auto_release_on_create as auto_release_on_create',
      'scopes.numbering_mode as numbering_mode',
      'scopes.tick_closes_issue as tick_closes_issue',
      'scopes.allow_amendment_while_open as allow_amendment_while_open',
      'scopes.session_state as session_state',
      'lanes.id as lane_id',
      'lanes.name as lane_name',
      'lanes.default_draft_visibility as lane_draft_visibility',
    ])
    .where('scopes.project_id', '=', member.project_id)
    .where('lane_members.subject_kind', '=', 'user')
    .where('lane_members.subject_id', '=', userId)
    .orderBy('scopes.created_at', 'asc')
    .orderBy('scopes.id', 'asc')
    .orderBy('lanes.position', 'asc')
    .executeTakeFirst();
  if (!lane) return null;

  return {
    userId,
    projectId: member.project_id,
    documentId: member.document_id,
    role: member.role,
    scopeId: lane.scope_id,
    scopeKind: lane.scope_kind,
    scopeName: lane.scope_name,
    laneId: lane.lane_id,
    laneName: lane.lane_name,
    draftVisibility: lane.lane_draft_visibility ?? lane.scope_draft_visibility,
    autoRelease: lane.auto_release_on_create,
    numberingMode: lane.numbering_mode,
    tickClosesIssue: lane.tick_closes_issue,
    allowAmendmentWhileOpen: lane.allow_amendment_while_open,
    sessionState: lane.session_state,
  };
}

/**
 * The project and review rules, as `@nb/policy` reads them, for one member. Reviewers change their
 * own markups; project admins also change and delete anyone's; viewers change nothing.
 */
function policyConfig(access: DocumentAccess): { project: ProjectConfig; process: ProcessConfig } {
  const subject = { kind: 'user', id: access.userId } as const;
  const assign = (role: RoleAssignment['role']): RoleAssignment => ({ subject, role, level: 'project' });
  const roles: RoleAssignment[] =
    access.role === 'project_admin'
      ? [assign('project_admin'), assign('reviewer')]
      : [assign(access.role === 'reviewer' ? 'reviewer' : 'viewer')];
  const grants: Grant[] =
    access.role === 'project_admin'
      ? [
          { subject, level: 'project', action: 'comment.edit', scope: 'any' },
          { subject, level: 'project', action: 'comment.delete', scope: 'any' },
        ]
      : [];

  const project: ProjectConfig = {
    id: access.projectId,
    parties: [],
    groups: [],
    members: [{ userId: access.userId, partyId: null, groupIds: [], state: 'active' }],
    statuses: DEFAULT_STATUSES,
    defaultClosing: { allowedClosers: [] },
    grants,
    roles,
  };
  const process: ProcessConfig = {
    id: access.scopeId,
    kind: access.scopeKind,
    lanes: [{ id: access.laneId, name: access.laneName, members: [subject], defaultDraftVisibility: access.draftVisibility }],
    gates: [],
    defaultDraftVisibility: access.draftVisibility,
    autoReleaseOnCreate: access.autoRelease,
    numberingMode: access.numberingMode,
    tickClosesIssue: access.tickClosesIssue,
    allowAmendmentWhileOpen: access.allowAmendmentWhileOpen,
    closing: { allowedClosers: [] },
    ...(access.sessionState ? { sessionState: access.sessionState } : {}),
  };
  return { project, process };
}

/** Where a stored item started and how it is shared, read with its record. */
export interface StoredItemRow {
  originLaneId: string;
  draftVisibility: DraftVisibility;
  released: boolean;
}

/** The stored sharing state of the markups loaded for an operation, by markup id. */
export async function loadItemRows(db: Db, streamId: string, markupIds: readonly string[]): Promise<Map<string, StoredItemRow>> {
  const out = new Map<string, StoredItemRow>();
  if (!markupIds.length) return out;
  const rows = await db
    .selectFrom('markups')
    .select(['id', 'origin_lane_id', 'draft_visibility', 'checking_state'])
    .where('stream_id', '=', streamId)
    .where('id', 'in', [...markupIds])
    .execute();
  for (const row of rows) {
    // A markup with no origin lane has no audience: it stays out of the policy state, so it reads as not found.
    if (!row.origin_lane_id) continue;
    out.set(row.id, {
      originLaneId: row.origin_lane_id,
      draftVisibility: row.draft_visibility ?? 'private',
      released: row.checking_state === 'released',
    });
  }
  return out;
}

function metaFor(
  access: DocumentAccess,
  kind: 'markup' | 'placement',
  record: MarkupRecord | Placement,
  markup: MarkupRecord,
  row: StoredItemRow,
): ItemMeta {
  return {
    kind,
    id: record.id,
    scopeId: markup.scopeId,
    originLaneId: row.originLaneId,
    owner: markup.owner,
    draftVisibility: row.draftVisibility,
    checkingState: row.released ? 'released' : 'draft',
    assignedCheckers: [],
    releasesByLane: row.released
      ? {
          [row.originLaneId]: [
            { releaseId: 'current', rev: record.rev, fromLaneId: row.originLaneId, gateId: null, at: record.modifiedAt, by: markup.owner },
          ],
        }
      : {},
    latestRev: record.rev,
    documentId: access.documentId,
    history: [],
  };
}

function policyState(access: DocumentAccess, state: OpsState, rows: ReadonlyMap<string, StoredItemRow>): PolicyState {
  const meta: Record<string, ItemMeta> = {};
  for (const markup of Object.values(state.markups)) {
    const row = rows.get(markup.id);
    if (row) meta[itemKey('markup', markup.id)] = metaFor(access, 'markup', markup, markup, row);
  }
  for (const placement of Object.values(state.placements)) {
    const markup = Object.hasOwn(state.markups, placement.markupId) ? state.markups[placement.markupId] : undefined;
    const row = rows.get(placement.markupId);
    if (markup && row) meta[itemKey('placement', placement.id)] = metaFor(access, 'placement', placement, markup, row);
  }
  return { ops: state, meta, versions: {}, nextIssueNumber: 1 };
}

/** Whether `op` is allowed against `state` under the rules in force now; the reason when it is not. */
export function authorizeDocumentOp(
  access: DocumentAccess,
  op: Operation,
  state: OpsState,
  rows: ReadonlyMap<string, StoredItemRow>,
): { ok: true } | { ok: false; reason: PolicyDenyReason } {
  const { project, process } = policyConfig(access);
  return authorizeOp(op, {
    actorUserId: access.userId,
    actorLaneId: access.laneId,
    project,
    process,
    state: policyState(access, state, rows),
  });
}

/** The sharing state a markup made now by this member starts with. */
export const newItemRow = (access: DocumentAccess): StoredItemRow => ({
  originLaneId: access.laneId,
  draftVisibility: access.draftVisibility,
  released: access.autoRelease,
});

/** One accepted version of an item, made or changed by one operation. */
export interface ItemVersion {
  kind: 'markup' | 'placement';
  record: MarkupRecord | Placement;
  markup: MarkupRecord;
  row: StoredItemRow;
}

/** The version `op` produced or left in place, read from the state right after it. */
export function versionAfter(
  access: DocumentAccess,
  op: Operation,
  state: OpsState,
  rows: ReadonlyMap<string, StoredItemRow>,
): ItemVersion | null {
  const kind: ItemKind | 'release' = kindOf(op);
  if (kind !== 'markup' && kind !== 'placement') return null;
  const record = kind === 'markup' ? state.markups[op.entityId] : state.placements[op.entityId];
  if (!record) return null;
  const markupId = kind === 'markup' ? record.id : (record as Placement).markupId;
  const markup = state.markups[markupId];
  if (!markup) return null;
  return { kind, record, markup, row: rows.get(markupId) ?? newItemRow(access) };
}

/**
 * Stores one item version with the rows that say who may see it. A version already stored (an
 * operation that changed nothing) is left as it is.
 */
export async function writeItemVersion(
  trx: Transaction<Database>,
  access: DocumentAccess,
  op: Operation,
  version: ItemVersion,
  receivedAt: Date,
): Promise<void> {
  const { kind, record, markup, row } = version;
  const inserted = await trx
    .insertInto('item_versions')
    .values({
      item_kind: kind,
      item_id: record.id,
      version_rev: record.rev,
      project_id: access.projectId,
      scope_id: markup.scopeId,
      origin_lane_id: row.originLaneId,
      edited_in_lane_id: null,
      author_user_id: access.userId,
      author_party_id: null,
      record_json: sql`${JSON.stringify(record)}::jsonb`,
      op_id: op.opId,
      client_time: op.clientTime === undefined ? null : new Date(op.clientTime),
      received_at: receivedAt,
    })
    .onConflict((oc) => oc.doNothing())
    .executeTakeFirst();
  if (!inserted.numInsertedOrUpdatedRows) return;

  const audiences = computeItemAudiences(metaFor(access, kind, record, markup, row));
  for (const rowAccess of audiences.access) {
    if (rowAccess.versionRev !== record.rev) continue;
    await trx
      .insertInto('item_access')
      .values({
        item_kind: kind,
        item_id: record.id,
        version_rev: record.rev,
        lane_id: rowAccess.laneId,
        kind: rowAccess.kind,
        owner_party_id: rowAccess.ownerPartyId,
      })
      .onConflict((oc) => oc.doNothing())
      .execute();
  }
  for (const draft of audiences.draftAccess) {
    if (draft.versionRev !== record.rev) continue;
    await trx
      .insertInto('item_draft_access')
      .values({
        item_kind: kind,
        item_id: record.id,
        version_rev: record.rev,
        subject_kind: draft.subject.kind,
        subject_id: draft.subject.id,
      })
      .onConflict((oc) => oc.doNothing())
      .execute();
  }
  if (row.released) {
    // One lane: each version is released to it as soon as it is made.
    await trx
      .insertInto('releases')
      .values({
        id: randomUUID(),
        project_id: access.projectId,
        scope_id: markup.scopeId,
        batch_id: op.batchId ?? null,
        gate_id: null,
        from_lane_id: row.originLaneId,
        to_lane_id: row.originLaneId,
        item_kind: kind,
        item_id: record.id,
        version_rev: record.rev,
        released_by: access.userId,
        released_at: receivedAt,
      })
      .execute();
  }
}

/** The first operation whose revision or page is not part of this document, if any. */
export async function findForeignPage(
  db: Db,
  documentId: string,
  ops: readonly Operation[],
): Promise<number | null> {
  const creates = ops.flatMap((op, index) => (op.type === 'placement.create' ? [{ index, ...op.payload }] : []));
  if (!creates.length) return null;
  const rows = await db
    .selectFrom('pages')
    .innerJoin('revisions', 'revisions.id', 'pages.revision_id')
    .select(['pages.id as page_id', 'revisions.id as revision_id'])
    .where('revisions.document_id', '=', documentId)
    .where('pages.id', 'in', [...new Set(creates.map((c) => c.pageId))])
    .execute();
  const known = new Set(rows.map((r) => `${r.revision_id}:${r.page_id}`));
  return creates.find((c) => !known.has(`${c.revisionId}:${c.pageId}`))?.index ?? null;
}

/** Whether `op` would give a markup a second live placement on one revision. */
export function addsSecondPlacement(op: Operation, state: OpsState): boolean {
  let markupId: string;
  let revisionId: string;
  if (op.type === 'placement.create') {
    ({ markupId, revisionId } = op.payload);
  } else if (op.type === 'placement.restore') {
    const current = Object.hasOwn(state.placements, op.entityId) ? state.placements[op.entityId] : undefined;
    if (!current || !current.deleted) return false;
    ({ markupId, revisionId } = current);
  } else {
    return false;
  }
  return Object.values(state.placements).some(
    (p) => !p.deleted && p.id !== op.entityId && p.markupId === markupId && p.revisionId === revisionId,
  );
}
