import { randomUUID } from 'node:crypto';
import {
  kindOf,
  type Actor,
  type AnyOperation,
  type Issue,
  type ItemKind,
  type MarkupRecord,
  type Operation,
  type OpsState,
  type Placement,
  type Rejection,
  type StatusDef,
  type StatusEvent,
} from '@nb/ops';
import {
  authorizeOp,
  canMemberCloseIssue,
  computeItemAudiences,
  DEFAULT_STATUSES,
  itemKey,
  type ClosingConfig,
  type DraftVisibility,
  type Grant,
  type ItemMeta,
  type PolicyDenyReason,
  type PolicyState,
  type ProcessConfig,
  type ProjectConfig,
  type RoleAssignment,
} from '@nb/policy';
import type { StatusRules } from '@nb/sync';
import { sql, type Kysely, type Transaction } from 'kysely';
import type { Database, ProjectRole } from './db.ts';

/*
 * Who may use a document's stream, and what each accepted change makes visible.
 *
 * A document's stream has the document's id. Its markups, and the issues raised for them with their
 * status changes, belong to the project's first review scope, and everyone on the project works in
 * that scope's first lane. Permission is decided by
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
  /** Who may move an issue into a closed status. */
  closing: ClosingConfig;
}

/** Who may close an issue in a project that has not said: its admins. */
export const DEFAULT_CLOSING: ClosingConfig = { allowedClosers: [{ kind: 'role', role: 'project_admin' }] };

/** A scope's stored closing rules. An empty list would leave nobody able to close, so it is the default. */
function closingOf(stored: unknown): ClosingConfig {
  const closing = stored as Partial<ClosingConfig> | null;
  if (!Array.isArray(closing?.allowedClosers) || !closing.allowedClosers.length) return DEFAULT_CLOSING;
  return { allowedClosers: closing.allowedClosers, closerNotResponder: closing.closerNotResponder === true };
}

type Db = Kysely<Database> | Transaction<Database>;

/** The project's statuses, in their order. */
export async function loadProjectStatuses(db: Db, projectId: string): Promise<readonly StatusDef[]> {
  const rows = await db
    .selectFrom('statuses')
    .select(['id', 'name', 'category'])
    .where('project_id', '=', projectId)
    .orderBy('position', 'asc')
    .orderBy('id', 'asc')
    .execute();
  return rows.length ? rows : DEFAULT_STATUSES;
}

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
      'scopes.closing_json as closing_json',
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
    closing: closingOf(lane.closing_json),
  };
}

/**
 * The project and review rules, as `@nb/policy` reads them, for one member. Reviewers change their
 * own markups, and set statuses and ticks on anyone's; project admins also change and delete
 * anyone's; viewers change nothing. Moving an issue into a closed status is for the closing list.
 */
function policyConfig(access: DocumentAccess, statuses: readonly StatusDef[]): { project: ProjectConfig; process: ProcessConfig } {
  const subject = { kind: 'user', id: access.userId } as const;
  const assign = (role: RoleAssignment['role']): RoleAssignment => ({
    subject,
    role,
    level: 'project',
    ...(role === 'reviewer' ? { transitions: '*' as const } : {}),
  });
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
    statuses,
    defaultClosing: access.closing,
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
    closing: access.closing,
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

/** The sharing state of the items an operation touches, by id. */
export interface ItemRows {
  markups: Map<string, StoredItemRow>;
  issues: Map<string, StoredItemRow>;
}

export const emptyItemRows = (): ItemRows => ({ markups: new Map(), issues: new Map() });

/** The stored sharing state of the markups loaded for an operation, by markup id. */
export async function loadMarkupRows(db: Db, streamId: string, markupIds: readonly string[]): Promise<Map<string, StoredItemRow>> {
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

/** The same for issues, which keep no sharing state of their own: they follow the scope's rules. */
export async function loadIssueRows(db: Db, access: DocumentAccess, issueIds: readonly string[]): Promise<Map<string, StoredItemRow>> {
  const out = new Map<string, StoredItemRow>();
  if (!issueIds.length) return out;
  const rows = await db.selectFrom('issues').select(['id', 'origin_lane_id']).where('id', 'in', [...issueIds]).execute();
  for (const row of rows) {
    out.set(row.id, { originLaneId: row.origin_lane_id, draftVisibility: access.draftVisibility, released: access.autoRelease });
  }
  return out;
}

/** What of a record the policy needs to say who may see and change it. */
interface ItemSource {
  kind: ItemKind;
  id: string;
  rev: number;
  scopeId: string;
  owner: Actor;
  modifiedAt: number;
}

function metaFor(access: DocumentAccess, item: ItemSource, row: StoredItemRow): ItemMeta {
  return {
    kind: item.kind,
    id: item.id,
    scopeId: item.scopeId,
    originLaneId: row.originLaneId,
    owner: item.owner,
    draftVisibility: row.draftVisibility,
    checkingState: row.released ? 'released' : 'draft',
    assignedCheckers: [],
    releasesByLane: row.released
      ? {
          [row.originLaneId]: [
            { releaseId: 'current', rev: item.rev, fromLaneId: row.originLaneId, gateId: null, at: item.modifiedAt, by: item.owner },
          ],
        }
      : {},
    latestRev: item.rev,
    documentId: access.documentId,
    history: [],
  };
}

const markupSource = (markup: MarkupRecord): ItemSource => ({ ...markup, kind: 'markup' });
/** A placement is shared as the markup it places. */
const placementSource = (placement: Placement, markup: MarkupRecord): ItemSource => ({
  kind: 'placement',
  id: placement.id,
  rev: placement.rev,
  modifiedAt: placement.modifiedAt,
  scopeId: markup.scopeId,
  owner: markup.owner,
});
const issueSource = (issue: Issue): ItemSource => ({ ...issue, kind: 'issue' });
const statusEventSource = (event: StatusEvent, issue: Issue): ItemSource => ({
  kind: 'statusEvent',
  id: event.id,
  rev: event.rev,
  modifiedAt: event.at,
  scopeId: issue.scopeId,
  owner: event.actor,
});

function policyState(access: DocumentAccess, state: OpsState, rows: ItemRows): PolicyState {
  const meta: Record<string, ItemMeta> = {};
  for (const markup of Object.values(state.markups)) {
    const row = rows.markups.get(markup.id);
    if (row) meta[itemKey('markup', markup.id)] = metaFor(access, markupSource(markup), row);
  }
  for (const placement of Object.values(state.placements)) {
    const markup = Object.hasOwn(state.markups, placement.markupId) ? state.markups[placement.markupId] : undefined;
    const row = rows.markups.get(placement.markupId);
    if (markup && row) meta[itemKey('placement', placement.id)] = metaFor(access, placementSource(placement, markup), row);
  }
  for (const issue of Object.values(state.issues)) {
    const row = rows.issues.get(issue.id);
    if (!row) continue;
    meta[itemKey('issue', issue.id)] = {
      ...metaFor(access, issueSource(issue), row),
      initialStatus: state.laneStatus[issue.id]?.[access.laneId]?.status ?? null,
    };
  }
  return { ops: state, meta, versions: {}, nextIssueNumber: 1 };
}

/** Whether `op` is allowed against `state` under the rules in force now; the reason when it is not. */
export function authorizeDocumentOp(
  access: DocumentAccess,
  statuses: readonly StatusDef[],
  op: Operation,
  state: OpsState,
  rows: ItemRows,
): { ok: true } | { ok: false; reason: PolicyDenyReason } {
  const { project, process } = policyConfig(access, statuses);
  const decision = authorizeOp(op, {
    actorUserId: access.userId,
    actorLaneId: access.laneId,
    project,
    process,
    state: policyState(access, state, rows),
  });
  // A closing list can name someone through what they raised. A viewer still changes nothing; they
  // are told so only for what they may see, so a hidden record stays "not found".
  if (decision.ok && access.role === 'viewer') return { ok: false, reason: { code: 'forbidden', action: op.type } };
  return decision;
}

/** What this member may do with statuses and ticks, for the interface to show. */
export function statusRules(access: DocumentAccess): StatusRules {
  const writes = access.role !== 'viewer' && access.sessionState !== 'locked' && access.sessionState !== 'closed';
  if (!writes) return { changeStatus: false, tick: false, close: 'none' };
  const { project, process } = policyConfig(access, DEFAULT_STATUSES);
  const member = project.members[0]!;
  const mayCloseIssueOf = (userId: string) =>
    canMemberCloseIssue(
      member,
      [access.laneId],
      project,
      process,
      metaFor(
        access,
        { kind: 'issue', id: '', rev: 1, scopeId: access.scopeId, owner: { userId, partyId: null, groupId: null }, modifiedAt: 0 },
        newItemRow(access),
      ),
    ).allowed;
  // No user has an empty id, so this asks about an issue someone else raised.
  const close = mayCloseIssueOf('') ? 'any' : mayCloseIssueOf(access.userId) ? 'own' : 'none';
  return { changeStatus: true, tick: true, close };
}

/** The sharing state an item made now by this member starts with. */
export const newItemRow = (access: DocumentAccess): StoredItemRow => ({
  originLaneId: access.laneId,
  draftVisibility: access.draftVisibility,
  released: access.autoRelease,
});

/** The records a document stream keeps versions of. */
export type VersionedKind = 'markup' | 'placement' | 'issue' | 'statusEvent';

/** One accepted version of an item, made or changed by one operation. */
export interface ItemVersion {
  kind: VersionedKind;
  record: MarkupRecord | Placement | Issue | StatusEvent;
  source: ItemSource;
  row: StoredItemRow;
}

/** The version `op` produced or left in place, read from the state right after it. */
export function versionAfter(access: DocumentAccess, op: AnyOperation, state: OpsState, rows: ItemRows): ItemVersion | null {
  const own = <T>(map: Readonly<Record<string, T>>, id: string): T | undefined => (Object.hasOwn(map, id) ? map[id] : undefined);
  const version = (record: ItemVersion['record'], source: ItemSource, row: StoredItemRow | undefined): ItemVersion => ({
    kind: source.kind as VersionedKind,
    record,
    source,
    row: row ?? newItemRow(access),
  });
  switch (kindOf(op)) {
    case 'markup': {
      const markup = own(state.markups, op.entityId);
      return markup ? version(markup, markupSource(markup), rows.markups.get(markup.id)) : null;
    }
    case 'placement': {
      const placement = own(state.placements, op.entityId);
      const markup = placement && own(state.markups, placement.markupId);
      return placement && markup ? version(placement, placementSource(placement, markup), rows.markups.get(markup.id)) : null;
    }
    case 'issue': {
      const issue = own(state.issues, op.entityId);
      return issue ? version(issue, issueSource(issue), rows.issues.get(issue.id)) : null;
    }
    case 'statusEvent': {
      const event = own(state.statusEvents, op.entityId);
      const issue = event && own(state.issues, event.issueId);
      return event && issue ? version(event, statusEventSource(event, issue), rows.issues.get(issue.id)) : null;
    }
    default:
      return null;
  }
}

/**
 * Stores one item version with the rows that say who may see it. A version already stored (an
 * operation that changed nothing) is left as it is.
 */
export async function writeItemVersion(
  trx: Transaction<Database>,
  access: DocumentAccess,
  op: AnyOperation,
  version: ItemVersion,
  receivedAt: Date,
): Promise<void> {
  const { kind, record, source, row } = version;
  const inserted = await trx
    .insertInto('item_versions')
    .values({
      item_kind: kind,
      item_id: record.id,
      version_rev: record.rev,
      project_id: access.projectId,
      scope_id: source.scopeId,
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

  const audiences = computeItemAudiences(metaFor(access, source, row));
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
        scope_id: source.scopeId,
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

/**
 * The first operation naming a revision or page that is not part of this document, if any: where a
 * placement goes, or the revision a status change says was checked.
 */
export async function findForeignPage(
  db: Db,
  documentId: string,
  ops: readonly Operation[],
): Promise<number | null> {
  const named = ops.flatMap((op, index): { index: number; revisionId: string; pageId: string | null }[] => {
    if (op.type === 'placement.create') return [{ index, revisionId: op.payload.revisionId, pageId: op.payload.pageId }];
    if (op.type === 'status.transition' && op.payload.revisionSeenId != null) {
      return [{ index, revisionId: op.payload.revisionSeenId, pageId: null }];
    }
    return [];
  });
  if (!named.length) return null;
  const rows = await db
    .selectFrom('revisions')
    .leftJoin('pages', 'pages.revision_id', 'revisions.id')
    .select(['pages.id as page_id', 'revisions.id as revision_id'])
    .where('revisions.document_id', '=', documentId)
    .where('revisions.id', 'in', [...new Set(named.map((n) => n.revisionId))])
    .execute();
  const revisions = new Set(rows.map((r) => r.revision_id));
  const pages = new Set(rows.map((r) => `${r.revision_id}:${r.page_id}`));
  return (
    named.find((n) => (n.pageId === null ? !revisions.has(n.revisionId) : !pages.has(`${n.revisionId}:${n.pageId}`)))
      ?.index ?? null
  );
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

/**
 * Why an operation may not link its issue to its markups, or null when it may. On a document an
 * issue is raised for at least one of its markups, and a markup has one live issue: whoever raises
 * it second is told the status moved, to look again and decide.
 */
export function issueLinkProblem(op: Operation, state: OpsState): Rejection | null {
  if (op.type !== 'issue.create' && op.type !== 'issue.link') return null;
  const markupIds = op.type === 'issue.link' ? [op.payload.markupId] : (op.payload.markupIds ?? []);
  if (!markupIds.length) return { code: 'invalid', message: 'An issue on a document is raised for one of its markups' };
  for (const markupId of markupIds) {
    if (Object.hasOwn(state.markups, markupId) && state.markups[markupId]!.deleted) {
      return { code: 'deleted', kind: 'markup', id: markupId };
    }
    const other = Object.values(state.issues).find(
      (issue) => !issue.deleted && issue.id !== op.entityId && issue.markupIds.includes(markupId),
    );
    if (other) return { code: 'conflict', conflicts: [{ kind: 'issue', id: other.id, groups: ['status'] }] };
  }
  return null;
}
