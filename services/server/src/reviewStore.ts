import { createHash, randomUUID } from 'node:crypto';
import {
  applyOp,
  emptyState,
  itemOf,
  parseOperation,
  PROTOCOL_VERSION,
  statusDef,
  type Actor,
  type AnyOperation,
  type ApplyContext,
  type Issue,
  type ItemKind,
  type ItemRef,
  type MarkupRecord,
  type Operation,
  type Placement,
  type Response as OpsResponse,
  type StatusEvent,
} from '@nb/ops';
import {
  authorizeAction,
  authorizeOp,
  checkerGateFor,
  compileLaneMembers,
  compilePartyVisibility,
  computeItemAudiences,
  findActiveMember,
  memberLaneIds,
  metaOf,
  own,
  releaseBundle,
  visibleVersionForMember,
  type CheckingState,
  type ItemMeta,
  type PolicyAction,
  type PolicyContext,
  type PolicyDenyReason,
  type PolicyState,
  type ProcessConfig,
  type ProjectConfig,
  type ReleasedVersionRecord,
} from '@nb/policy';
import type pg from 'pg';
import { openCursor, sealCursor } from './cursor.ts';
import { createNotification, type NotificationSink } from './notifications.ts';

const VALID_ROLE_RE = /^[a-z_][a-z0-9_]{0,62}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;

export interface SeedDocumentPage {
  id: string;
  position: number;
  width: number;
  height: number;
}

export interface SeedDocumentRevision {
  id: string;
  label: string;
  fileSha256: string;
  fileSize: number;
  pageCount: number;
  pages: readonly SeedDocumentPage[];
}

export interface SeedDocument {
  id: string;
  number: string;
  title: string;
  discipline?: string | null;
  revisions: readonly SeedDocumentRevision[];
}

export interface SeedProjectFixture {
  workspace: { id: string; name: string };
  project: ProjectConfig & { name: string; number?: string | null };
  process: ProcessConfig & { name: string };
  documents: readonly SeedDocument[];
  documentStreamId: string;
  projectStreamId: string;
}

interface StoredProjectSettings {
  projectConfig: ProjectConfig;
  scopes: Record<
    string,
    {
      processConfig: ProcessConfig;
      documentStreamId: string;
      projectStreamId: string;
      state: PolicyState;
    }
  >;
}

export interface StoredAssetBlob {
  bytes: Buffer;
  filename: string;
  mediaType: string;
}

export interface ReviewStoreOptions {
  pool: pg.Pool;
  readerRole: string;
  cursorKey: Buffer;
  notifications?: NotificationSink;
  now?: () => number;
}

export interface ReviewEvent {
  streamId: string;
  seq: number;
  opId: string;
  opType: string;
  itemKind: ItemKind;
  entityId: string;
  versionRev: number;
  laneId: string;
  payload: unknown;
  receivedAt: string;
}

export type ReviewWriteResult =
  | { ok: true; status: number; data: Record<string, unknown>; events: ReviewEvent[] }
  | { ok: false; status: number; error: string; code: string };

export interface VisibleItemView {
  kind: ItemKind;
  id: string;
  rev: number;
  record: Record<string, unknown>;
  status?: string | null;
}

export interface RegisterRow {
  issueId: string;
  number: number | null;
  title: string;
  status: string;
  ownerUserId: string;
  ownerPartyId: string | null;
  checked: boolean;
  rev: number;
  responses: { id: string; body: string; ownerUserId: string; kind: string; rev: number }[];
  assets: { sha256: string; filename: string; mediaType: string }[];
}

function quoteIdent(ident: string): string {
  if (!VALID_ROLE_RE.test(ident)) {
    throw new Error(`Invalid Postgres identifier: ${ident}`);
  }
  return `"${ident}"`;
}

function sanitizeRecordForRead(kind: ItemKind, raw: unknown): Record<string, unknown> {
  const rec = structuredClone(raw) as Record<string, unknown>;
  // Never expose internal operational metadata that could reveal draft/edit counts or internal op ids.
  delete rec.versions;
  delete rec.createdBy;
  if (kind === 'issue' || kind === 'markup' || kind === 'response') {
    const owner = rec.owner as Actor | undefined;
    if (owner) {
      rec.owner = { userId: owner.userId, partyId: owner.partyId, groupId: owner.groupId };
    }
  }
  return rec;
}

function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function withSnapshot(
  versions: PolicyState['versions'],
  kind: ItemKind,
  id: string,
  rev: number,
  record: unknown,
): PolicyState['versions'] {
  const key = `${kind}:${id}`;
  const existing = own(versions, key) ?? {};
  return { ...versions, [key]: { ...existing, [rev]: structuredClone(record) } };
}

function stripForgedActorFields(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const copy: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
  delete copy.owner;
  delete copy.actor;
  delete copy.author;
  delete copy.userId;
  delete copy.ownerUserId;
  delete copy.ownerPartyId;
  delete copy.ownerGroupId;
  delete copy.releasedBy;
  if (copy.payload && typeof copy.payload === 'object' && !Array.isArray(copy.payload)) {
    const payloadCopy: Record<string, unknown> = { ...(copy.payload as Record<string, unknown>) };
    delete payloadCopy.owner;
    delete payloadCopy.actor;
    delete payloadCopy.author;
    delete payloadCopy.userId;
    delete payloadCopy.ownerUserId;
    delete payloadCopy.ownerPartyId;
    delete payloadCopy.ownerGroupId;
    delete payloadCopy.releasedBy;
    copy.payload = payloadCopy;
  }
  return copy;
}

function mapPolicyDeny(reason: PolicyDenyReason): { status: number; error: string; code: string } {
  if (reason.code === 'not_found') {
    return { status: 404, error: 'not_found', code: 'not_found' };
  }
  if (reason.code === 'not_member' || reason.code === 'forbidden') {
    return { status: 403, error: 'forbidden', code: reason.code };
  }
  if (reason.code === 'locked') {
    return { status: 409, error: 'locked', code: reason.code };
  }
  return { status: 400, error: reason.code, code: reason.code };
}

function toDbCheckingState(state: CheckingState): 'draft' | 'submitted' | 'returned' | 'released' | 'withdrawn' | 'stopped' {
  if (state === 'approved') return 'submitted';
  return state;
}

function toDbPlacementMethod(method: Placement['method']): 'original' | 'aligned' | 'manual' | 'suggested' {
  return method === 'ai' ? 'suggested' : method;
}

/**
 * Postgres-backed review store combining `@nb/policy` authorization, audience materialization,
 * AEAD-sealed sync cursors, and RLS-enforced reads through a non-BYPASSRLS reader role.
 */
export class ReviewStore {
  private readonly pool: pg.Pool;
  private readonly readerRole: string;
  private readonly cursorKey: Buffer;
  private readonly notifications?: NotificationSink;
  private readonly now: () => number;
  private readonly blobs = new Map<string, StoredAssetBlob>();
  private readonly streamToScope = new Map<string, { projectId: string; scopeId: string }>();

  constructor(options: ReviewStoreOptions) {
    if (!VALID_ROLE_RE.test(options.readerRole)) {
      throw new Error(`Invalid reader role name: ${options.readerRole}`);
    }
    this.pool = options.pool;
    this.readerRole = options.readerRole;
    this.cursorKey = options.cursorKey;
    this.notifications = options.notifications;
    this.now = options.now ?? (() => Date.now());
  }

  /**
   * Executes a read-only transaction as the non-BYPASSRLS reader role with `app.user_id` bound
   * to `userId`. Every read path for review content runs through this helper.
   */
  async withReader<T>(userId: string, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN READ ONLY');
      await client.query(`SET LOCAL ROLE ${quoteIdent(this.readerRole)}`);
      await client.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  resolveStreamScope(streamId: string): { projectId: string; scopeId: string } | null {
    return this.streamToScope.get(streamId) ?? null;
  }

  /** Checks whether `userId` can see a specific event via Postgres RLS. */
  async canUserSeeEvent(userId: string, streamId: string, seq: number): Promise<boolean> {
    return this.withReader(userId, async (client) => {
      const res = await client.query<{ ok: number }>(
        `SELECT 1 AS ok FROM events WHERE stream_id = $1 AND seq = $2 LIMIT 1`,
        [streamId, String(seq)],
      );
      return (res.rowCount ?? 0) > 0;
    });
  }

  sealStreamCursor(userId: string, streamId: string, seq: number): string {
    return sealCursor(this.cursorKey, { userId, streamId }, seq);
  }

  /** Seeds a project, scope, lanes, gates, parties, members, documents, and streams into Postgres. */
  async seedFixture(fixture: SeedProjectFixture): Promise<{ projectId: string; scopeId: string }> {
    const { workspace, project, process: proc, documents, documentStreamId, projectStreamId } = fixture;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        `INSERT INTO workspaces (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
        [workspace.id, workspace.name],
      );

      const initialState: PolicyState = {
        ops: emptyState(),
        meta: {},
        versions: {},
        nextIssueNumber: 1,
        presentUserIds: [],
      };
      const settings: StoredProjectSettings = {
        projectConfig: {
          id: project.id,
          parties: project.parties,
          groups: project.groups,
          members: project.members,
          documentSets: project.documentSets,
          statuses: project.statuses,
          statusTransitions: project.statusTransitions,
          defaultClosing: project.defaultClosing,
          grants: project.grants,
          roles: project.roles,
          documentDesigners: project.documentDesigners,
        },
        scopes: {
          [proc.id]: {
            processConfig: {
              id: proc.id,
              kind: proc.kind,
              parentReviewId: proc.parentReviewId,
              documentSetId: proc.documentSetId,
              lanes: proc.lanes,
              gates: proc.gates,
              defaultDraftVisibility: proc.defaultDraftVisibility,
              autoReleaseOnCreate: proc.autoReleaseOnCreate,
              numberingMode: proc.numberingMode,
              tickClosesIssue: proc.tickClosesIssue,
              allowAmendmentWhileOpen: proc.allowAmendmentWhileOpen,
              closing: proc.closing,
              issueClosingOverrides: proc.issueClosingOverrides,
              sessionState: proc.sessionState,
              activeStage: proc.activeStage,
              grants: proc.grants,
              roles: proc.roles,
            },
            documentStreamId,
            projectStreamId,
            state: initialState,
          },
        },
      };

      await client.query(
        `INSERT INTO projects (id, workspace_id, name, number, settings_json)
         VALUES ($1, $2, $3, $4, $5::jsonb)
         ON CONFLICT (id) DO UPDATE SET settings_json = EXCLUDED.settings_json`,
        [project.id, workspace.id, project.name, project.number ?? null, JSON.stringify(settings)],
      );

      for (const party of project.parties) {
        await client.query(
          `INSERT INTO parties (id, project_id, name, contract_role)
           VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING`,
          [party.id, project.id, party.name, party.contractRole],
        );
      }

      for (const group of project.groups) {
        await client.query(
          `INSERT INTO groups (id, project_id, party_id, name)
           VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING`,
          [group.id, project.id, group.partyId ?? null, group.name],
        );
      }

      for (const member of project.members) {
        await client.query(
          `INSERT INTO project_members (project_id, user_id, party_id, state)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (project_id, user_id) DO UPDATE SET party_id = EXCLUDED.party_id, state = EXCLUDED.state`,
          [project.id, member.userId, member.partyId, member.state],
        );
        for (const groupId of member.groupIds) {
          await client.query(
            `INSERT INTO group_members (group_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            [groupId, member.userId],
          );
        }
      }

      for (const docSet of project.documentSets ?? []) {
        await client.query(
          `INSERT INTO document_sets (id, project_id, name, members_restricted)
           VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING`,
          [docSet.id, project.id, docSet.name, docSet.members !== undefined],
        );
        for (const ref of docSet.members ?? []) {
          await client.query(
            `INSERT INTO document_set_members (document_set_id, subject_kind, subject_id)
             VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
            [docSet.id, ref.kind, ref.id],
          );
        }
      }

      await client.query(
        `INSERT INTO scopes (
           id, project_id, kind, parent_review_id, document_set_id, name,
           default_draft_visibility, auto_release_on_create, numbering_mode,
           tick_closes_issue, allow_amendment_while_open, closing_json, session_state
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13)
         ON CONFLICT (id) DO NOTHING`,
        [
          proc.id,
          project.id,
          proc.kind,
          proc.parentReviewId ?? null,
          proc.documentSetId ?? null,
          proc.name,
          proc.defaultDraftVisibility,
          proc.autoReleaseOnCreate,
          proc.numberingMode,
          proc.tickClosesIssue,
          proc.allowAmendmentWhileOpen,
          JSON.stringify(proc.closing),
          proc.sessionState ?? null,
        ],
      );

      for (let i = 0; i < proc.lanes.length; i++) {
        const lane = proc.lanes[i]!;
        await client.query(
          `INSERT INTO lanes (id, project_id, scope_id, name, position, default_draft_visibility, party_visibility_mode, lead_party_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING`,
          [
            lane.id,
            project.id,
            proc.id,
            lane.name,
            i,
            lane.defaultDraftVisibility ?? null,
            lane.partyVisibility?.mode ?? 'open',
            lane.partyVisibility?.leadPartyId ?? null,
          ],
        );
      }

      for (const lm of compileLaneMembers(proc)) {
        await client.query(
          `INSERT INTO lane_members (lane_id, subject_kind, subject_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [lm.laneId, lm.member.kind, lm.member.id],
        );
      }

      for (const pv of compilePartyVisibility(proc, project)) {
        await client.query(
          `INSERT INTO party_visibility (lane_id, viewer_party_id, owner_party_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [pv.laneId, pv.viewerPartyId, pv.ownerPartyId],
        );
      }

      for (const gate of proc.gates) {
        const cp = gate.checkerPowers;
        await client.query(
          `INSERT INTO gates (
             id, scope_id, from_lane_id, name, item_kinds, requires_check,
             checker_can_approve, checker_can_add_notes, checker_can_return,
             checker_can_edit_wording, checker_can_delete, originator_sees_edits,
             originator_may_override_return, originator_may_override_edit, originator_may_override_delete
           ) VALUES ($1, $2, $3, $4, $5::text[], $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
           ON CONFLICT (id) DO NOTHING`,
          [
            gate.id,
            proc.id,
            gate.fromLaneId,
            gate.name,
            gate.itemKinds,
            gate.requiresCheck,
            cp?.approve ?? false,
            cp?.addNotes ?? false,
            cp?.return ?? false,
            cp?.editWording ?? false,
            cp?.delete ?? false,
            cp?.originatorSeesEdits ?? true,
            cp?.originatorMayOverride.return ?? false,
            cp?.originatorMayOverride.edit ?? false,
            cp?.originatorMayOverride.delete ?? false,
          ],
        );
        for (const toLaneId of gate.toLaneIds) {
          await client.query(
            `INSERT INTO gate_targets (gate_id, to_lane_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            [gate.id, toLaneId],
          );
        }
        for (const checker of gate.checkers ?? []) {
          await client.query(
            `INSERT INTO gate_checkers (gate_id, subject_kind, subject_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
            [gate.id, checker.kind, checker.id],
          );
        }
      }

      for (let i = 0; i < project.statuses.length; i++) {
        const st = project.statuses[i]!;
        await client.query(
          `INSERT INTO statuses (project_id, id, name, category, position) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
          [project.id, st.id, st.name, st.category, i],
        );
      }

      for (const doc of documents) {
        await client.query(
          `INSERT INTO documents (id, project_id, number, title, discipline) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
          [doc.id, project.id, doc.number, doc.title, doc.discipline ?? null],
        );
        for (const rev of doc.revisions) {
          await client.query(
            `INSERT INTO revisions (id, document_id, label, file_sha256, file_size, page_count)
             VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING`,
            [rev.id, doc.id, rev.label, rev.fileSha256, String(rev.fileSize), rev.pageCount],
          );
          await client.query(
            `INSERT INTO scope_revisions (scope_id, revision_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            [proc.id, rev.id],
          );
          for (const page of rev.pages) {
            await client.query(
              `INSERT INTO pages (id, revision_id, position, width, height) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
              [page.id, rev.id, page.position, page.width, page.height],
            );
          }
        }
      }

      await client.query(
        `INSERT INTO streams (id, kind, seq, project_id) VALUES ($1, 'document', 0, $3), ($2, 'project', 0, $3)
         ON CONFLICT (id) DO UPDATE SET project_id = EXCLUDED.project_id`,
        [documentStreamId, projectStreamId, project.id],
      );

      await client.query('COMMIT');
      this.streamToScope.set(documentStreamId, { projectId: project.id, scopeId: proc.id });
      this.streamToScope.set(projectStreamId, { projectId: project.id, scopeId: proc.id });
      return { projectId: project.id, scopeId: proc.id };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  private async loadScopeForUpdate(
    client: pg.PoolClient,
    scopeId: string,
  ): Promise<{
    projectId: string;
    settings: StoredProjectSettings;
    scopeEntry: StoredProjectSettings['scopes'][string];
  } | null> {
    const scopeRow = await client.query<{ project_id: string }>(`SELECT project_id FROM scopes WHERE id = $1`, [scopeId]);
    const projectId = scopeRow.rows[0]?.project_id;
    if (!projectId) return null;

    const projRow = await client.query<{ settings_json: StoredProjectSettings }>(
      `SELECT settings_json FROM projects WHERE id = $1 FOR UPDATE`,
      [projectId],
    );
    const settings = projRow.rows[0]?.settings_json;
    const scopeEntry = settings?.scopes?.[scopeId];
    if (!settings || !scopeEntry) return null;
    return { projectId, settings, scopeEntry };
  }

  private async syncItemAudiences(client: pg.PoolClient, meta: ItemMeta): Promise<void> {
    const { access, draftAccess } = computeItemAudiences(meta);
    await client.query(`DELETE FROM item_access WHERE item_kind = $1 AND item_id = $2`, [meta.kind, meta.id]);
    await client.query(`DELETE FROM item_draft_access WHERE item_kind = $1 AND item_id = $2`, [meta.kind, meta.id]);

    for (const row of access) {
      await client.query(
        `INSERT INTO item_access (item_kind, item_id, version_rev, lane_id, kind, owner_party_id)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
        [row.itemKind, row.itemId, row.versionRev, row.laneId, row.kind, row.ownerPartyId],
      );
    }
    for (const row of draftAccess) {
      await client.query(
        `INSERT INTO item_draft_access (item_kind, item_id, version_rev, subject_kind, subject_id)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
        [row.itemKind, row.itemId, row.versionRev, row.subject.kind, row.subject.id],
      );
    }
  }

  private async upsertContentRow(
    client: pg.PoolClient,
    projectId: string,
    scopeId: string,
    streamId: string,
    meta: ItemMeta,
    record: unknown,
    editedInLaneId: string | null,
    authorActor: Actor,
    opId: string,
  ): Promise<void> {
    const rec = record as Record<string, unknown>;
    const rev = Number(rec.rev ?? 1);
    const nowDate = new Date(this.now());

    // Immutable version snapshot (append-only; ignore if already recorded).
    await client.query(
      `INSERT INTO item_versions (
         item_kind, item_id, version_rev, project_id, scope_id, origin_lane_id,
         edited_in_lane_id, author_user_id, author_party_id, record_json, op_id, received_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12)
       ON CONFLICT (item_kind, item_id, version_rev) DO NOTHING`,
      [
        meta.kind,
        meta.id,
        rev,
        projectId,
        scopeId,
        meta.originLaneId,
        editedInLaneId,
        authorActor.userId,
        authorActor.partyId,
        JSON.stringify(record),
        opId,
        nowDate,
      ],
    );

    if (meta.kind === 'markup') {
      const m = record as MarkupRecord;
      await client.query(
        `INSERT INTO markups (
           id, stream_id, scope_id, type, rev, deleted, owner_user_id, owner_party_id, owner_group_id,
           record_json, project_id, origin_lane_id, draft_visibility, checking_state, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13, $14, $15)
         ON CONFLICT (id) DO UPDATE SET
           rev = EXCLUDED.rev, deleted = EXCLUDED.deleted, record_json = EXCLUDED.record_json,
           checking_state = EXCLUDED.checking_state, updated_at = EXCLUDED.updated_at`,
        [
          m.id,
          streamId,
          scopeId,
          m.type,
          m.rev,
          m.deleted,
          m.owner.userId,
          m.owner.partyId,
          m.owner.groupId,
          JSON.stringify(m),
          projectId,
          meta.originLaneId,
          meta.draftVisibility,
          toDbCheckingState(meta.checkingState),
          nowDate,
        ],
      );
    } else if (meta.kind === 'placement') {
      const p = record as Placement;
      await client.query(
        `INSERT INTO placements (
           id, stream_id, markup_id, revision_id, page_id, rev, deleted, record_json,
           scope_id, origin_lane_id, owner_party_id, method, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $13)
         ON CONFLICT (id) DO UPDATE SET
           rev = EXCLUDED.rev, deleted = EXCLUDED.deleted, record_json = EXCLUDED.record_json,
           method = EXCLUDED.method, updated_at = EXCLUDED.updated_at`,
        [
          p.id,
          streamId,
          p.markupId,
          p.revisionId,
          p.pageId,
          p.rev,
          p.deleted,
          JSON.stringify(p),
          scopeId,
          meta.originLaneId,
          meta.owner.partyId,
          toDbPlacementMethod(p.method),
          nowDate,
        ],
      );
    } else if (meta.kind === 'issue') {
      const iss = record as Issue;
      await client.query(
        `INSERT INTO issues (
           id, project_id, scope_id, origin_lane_id, number, title,
           owner_user_id, owner_party_id, owner_group_id, rev, deleted, ticked, record_json, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14)
         ON CONFLICT (id) DO UPDATE SET
           number = EXCLUDED.number, title = EXCLUDED.title, rev = EXCLUDED.rev,
           deleted = EXCLUDED.deleted, ticked = EXCLUDED.ticked, record_json = EXCLUDED.record_json,
           updated_at = EXCLUDED.updated_at`,
        [
          iss.id,
          projectId,
          scopeId,
          meta.originLaneId,
          iss.number,
          iss.title,
          iss.owner.userId,
          iss.owner.partyId,
          iss.owner.groupId,
          iss.rev,
          iss.deleted,
          iss.checked,
          JSON.stringify(iss),
          nowDate,
        ],
      );
      await client.query(`DELETE FROM issue_links WHERE issue_id = $1`, [iss.id]);
      for (const markupId of iss.markupIds) {
        await client.query(
          `INSERT INTO issue_links (issue_id, markup_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [iss.id, markupId],
        );
      }
    } else if (meta.kind === 'response') {
      const resp = record as OpsResponse;
      await client.query(
        `INSERT INTO responses (
           id, project_id, scope_id, origin_lane_id, issue_id, markup_id, parent_response_id,
           kind, owner_user_id, owner_party_id, owner_group_id, rev, deleted, record_json, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15)
         ON CONFLICT (id) DO UPDATE SET
           rev = EXCLUDED.rev, deleted = EXCLUDED.deleted, record_json = EXCLUDED.record_json,
           updated_at = EXCLUDED.updated_at`,
        [
          resp.id,
          projectId,
          scopeId,
          meta.originLaneId,
          resp.parent.kind === 'issue' ? resp.parent.id : null,
          resp.parent.kind === 'markup' ? resp.parent.id : null,
          resp.inReplyTo,
          resp.kind,
          resp.owner.userId,
          resp.owner.partyId,
          resp.owner.groupId,
          resp.rev,
          resp.deleted,
          JSON.stringify(resp),
          nowDate,
        ],
      );
    } else if (meta.kind === 'statusEvent') {
      const se = record as StatusEvent;
      await client.query(
        `INSERT INTO status_events (
           id, project_id, scope_id, origin_lane_id, issue_id, from_status, to_status,
           actor_user_id, actor_party_id, note, revision_seen_id, rev, received_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         ON CONFLICT (id) DO NOTHING`,
        [
          se.id,
          projectId,
          scopeId,
          meta.originLaneId,
          se.issueId,
          se.from,
          se.to,
          se.actor.userId,
          se.actor.partyId,
          se.note,
          se.revisionSeenId,
          se.rev,
          nowDate,
        ],
      );
      await client.query(
        `INSERT INTO issue_lane_state (issue_id, lane_id, status, status_event_id, version, updated_at)
         VALUES ($1, $2, $3, $4, 1, $5)
         ON CONFLICT (issue_id, lane_id) DO UPDATE SET
           status = EXCLUDED.status, status_event_id = EXCLUDED.status_event_id,
           version = issue_lane_state.version + 1, updated_at = EXCLUDED.updated_at`,
        [se.issueId, se.laneId, se.to, se.id, nowDate],
      );
    }

    await this.syncItemAudiences(client, meta);
  }

  private async appendStreamEvent(
    client: pg.PoolClient,
    streamId: string,
    actorId: string,
    opId: string,
    opType: string,
    itemKind: ItemKind,
    entityId: string,
    versionRev: number,
    laneId: string,
    payload: unknown,
  ): Promise<ReviewEvent> {
    const seqRow = await client.query<{ seq: string }>(
      `UPDATE streams SET seq = seq + 1, updated_at = NOW() WHERE id = $1 RETURNING seq`,
      [streamId],
    );
    const seq = Number(seqRow.rows[0]!.seq);
    const receivedAtDate = new Date(this.now());
    const receivedAt = receivedAtDate.toISOString();

    await client.query(
      `INSERT INTO events (
         stream_id, seq, op_id, actor_id, op_type, entity_id, payload_json,
         received_at, item_kind, version_rev, lane_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11)`,
      [
        streamId,
        String(seq),
        opId,
        actorId,
        opType,
        entityId,
        JSON.stringify(payload),
        receivedAtDate,
        itemKind,
        versionRev,
        laneId,
      ],
    );

    return {
      streamId,
      seq,
      opId,
      opType,
      itemKind,
      entityId,
      versionRev,
      laneId,
      payload,
      receivedAt,
    };
  }

  /** Submits an `@nb/ops` operation against a review scope, authorized by `@nb/policy`. */
  async submitOperation(scopeId: string, userId: string, rawInput: unknown): Promise<ReviewWriteResult> {
    const sanitized = stripForgedActorFields(rawInput);
    const parsed = parseOperation(sanitized);
    if (!parsed.ok) {
      return { ok: false, status: 400, error: parsed.rejection.code, code: parsed.rejection.code };
    }
    const op = parsed.op;

    const client = await this.pool.connect();
    const pendingNotifications: {
      kind: 'release' | 'return';
      projectId: string;
      scopeId: string;
      recipientUserIds: string[];
      subject: string;
      body: string;
    }[] = [];

    try {
      await client.query('BEGIN');
      const loaded = await this.loadScopeForUpdate(client, scopeId);
      if (!loaded) {
        await client.query('ROLLBACK');
        return { ok: false, status: 404, error: 'not_found', code: 'not_found' };
      }

      const { projectId, settings, scopeEntry } = loaded;
      const project = settings.projectConfig;
      const proc = scopeEntry.processConfig;
      let state = scopeEntry.state;

      const member = findActiveMember(project, userId);
      if (!member) {
        await client.query('ROLLBACK');
        return { ok: false, status: 403, error: 'forbidden', code: 'not_member' };
      }
      const lanes = memberLaneIds(member, proc);
      const actorLaneId = lanes[0];
      if (!actorLaneId) {
        await client.query('ROLLBACK');
        return { ok: false, status: 404, error: 'not_found', code: 'not_found' };
      }
      const actor: Actor = { userId: member.userId, partyId: member.partyId, groupId: member.groupIds[0] ?? null };

      const policyCtx: PolicyContext = {
        actorUserId: userId,
        actorLaneId,
        project,
        process: proc,
        state,
      };

      const decision = authorizeOp(op, policyCtx);
      if (!decision.ok) {
        await client.query('ROLLBACK');
        return { ok: false, ...mapPolicyDeny(decision.reason) };
      }

      const nowMs = this.now();
      const applyCtx: ApplyContext = { actor, laneId: actorLaneId, now: nowMs, statuses: project.statuses };
      const events: ReviewEvent[] = [];

      // Lock streams in sorted id order to prevent deadlocks on cross-stream releases.
      const streamIds = [...new Set([scopeEntry.documentStreamId, scopeEntry.projectStreamId])].sort();
      await client.query(`SELECT id FROM streams WHERE id = ANY($1::text[]) ORDER BY id ASC FOR UPDATE`, [streamIds]);

      if (op.type === 'release.create') {
        const bundle = [...op.payload.items, ...releaseBundle(op.payload.items, policyCtx)];
        // Assign numbers on first wall crossing before recording the release.
        const releasedRefs: ItemRef[] = [];
        for (const ref of bundle) {
          let effectiveRev = ref.rev;
          if (ref.kind === 'issue') {
            const iss = own(state.ops.issues, ref.id);
            const meta = metaOf(state, 'issue', ref.id);
            const crossesWall = meta !== undefined && op.payload.toLaneIds.some((l) => l !== meta.originLaneId);
            if (iss && iss.number === null && crossesWall && proc.numberingMode === 'on_first_crossing') {
              const numOp: AnyOperation = {
                opId: `${op.opId}:num:${ref.id}`,
                schemaVersion: PROTOCOL_VERSION,
                streamId: scopeEntry.projectStreamId,
                type: 'issue.number',
                entityId: ref.id,
                payload: { number: state.nextIssueNumber },
              };
              const numApplied = applyOp(state.ops, numOp, applyCtx);
              if (numApplied.ok) {
                const numbered = own(numApplied.state.issues, ref.id)!;
                const nextMeta: ItemMeta = { ...meta!, latestRev: Math.max(meta!.latestRev, numbered.rev) };
                state = {
                  ...state,
                  ops: numApplied.state,
                  nextIssueNumber: state.nextIssueNumber + 1,
                  versions: withSnapshot(state.versions, 'issue', ref.id, numbered.rev, numbered),
                  meta: { ...state.meta, [`issue:${ref.id}`]: nextMeta },
                };
                effectiveRev = numbered.rev;
                await this.upsertContentRow(
                  client,
                  projectId,
                  scopeId,
                  scopeEntry.projectStreamId,
                  nextMeta,
                  numbered,
                  null,
                  actor,
                  numOp.opId,
                );
              }
            }
          }
          releasedRefs.push({ kind: ref.kind, id: ref.id, rev: effectiveRev });
        }

        const effectiveOp: Operation = {
          ...op,
          payload: { ...op.payload, items: releasedRefs },
        };
        const applied = applyOp(state.ops, effectiveOp, applyCtx);
        if (!applied.ok) {
          await client.query('ROLLBACK');
          return { ok: false, status: 409, error: applied.rejection.code, code: applied.rejection.code };
        }
        state = { ...state, ops: applied.state };

        const releaseSummaries: string[] = [];
        for (const ref of releasedRefs) {
          const curMeta = metaOf(state, ref.kind, ref.id);
          if (!curMeta) continue;
          const nextReleasesByLane: Record<string, ReleasedVersionRecord[]> = {};
          for (const [k, v] of Object.entries(curMeta.releasesByLane)) {
            nextReleasesByLane[k] = [...v];
          }
          for (const toLaneId of op.payload.toLaneIds) {
            const list = nextReleasesByLane[toLaneId] ?? [];
            list.push({
              releaseId: op.entityId,
              rev: ref.rev,
              fromLaneId: actorLaneId,
              gateId: op.payload.gateId,
              at: nowMs,
              by: actor,
            });
            nextReleasesByLane[toLaneId] = list;

            await client.query(
              `INSERT INTO releases (
                 id, project_id, scope_id, gate_id, from_lane_id, to_lane_id,
                 item_kind, item_id, version_rev, released_by, released_at
               ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
              [
                `${op.entityId}:${ref.kind}:${ref.id}:${toLaneId}`,
                projectId,
                scopeId,
                op.payload.gateId,
                actorLaneId,
                toLaneId,
                ref.kind,
                ref.id,
                ref.rev,
                actor.userId,
                new Date(nowMs),
              ],
            );

            // Propagate initial or transitioned issue status to the receiving lane.
            if (ref.kind === 'issue') {
              const initStatus = curMeta.initialStatus ?? project.statuses.find((s) => s.category === 'open')?.id ?? 'open';
              await client.query(
                `INSERT INTO issue_lane_state (issue_id, lane_id, status, version, updated_at)
                 VALUES ($1, $2, $3, 1, $4)
                 ON CONFLICT (issue_id, lane_id) DO NOTHING`,
                [ref.id, toLaneId, initStatus, new Date(nowMs)],
              );
            } else if (ref.kind === 'statusEvent') {
              const se = own(state.ops.statusEvents, ref.id);
              if (se) {
                await client.query(
                  `INSERT INTO issue_lane_state (issue_id, lane_id, status, status_event_id, version, updated_at)
                   VALUES ($1, $2, $3, $4, 1, $5)
                   ON CONFLICT (issue_id, lane_id) DO UPDATE SET
                     status = EXCLUDED.status, status_event_id = EXCLUDED.status_event_id,
                     version = issue_lane_state.version + 1, updated_at = EXCLUDED.updated_at`,
                  [se.issueId, toLaneId, se.to, se.id, new Date(nowMs)],
                );
              }
            }
          }

          const updatedMeta: ItemMeta = {
            ...curMeta,
            checkingState: 'released',
            releasesByLane: nextReleasesByLane,
          };
          state = { ...state, meta: { ...state.meta, [`${ref.kind}:${ref.id}`]: updatedMeta } };
          await this.syncItemAudiences(client, updatedMeta);

          const verMap = own(state.versions, `${ref.kind}:${ref.id}`);
          const snap = (verMap ? verMap[ref.rev] : undefined) ?? itemOf(state.ops, ref.kind, ref.id);
          const cleanSnap = sanitizeRecordForRead(ref.kind, snap);
          if (ref.kind === 'issue') {
            const num = typeof cleanSnap.number === 'number' ? `#${cleanSnap.number}` : ref.id;
            releaseSummaries.push(`${num}: ${String(cleanSnap.title ?? '')}`);
          }
          const targetStream = ref.kind === 'markup' || ref.kind === 'placement'
            ? scopeEntry.documentStreamId
            : scopeEntry.projectStreamId;
          const ev = await this.appendStreamEvent(
            client,
            targetStream,
            actor.userId,
            `${op.opId}:rel:${ref.kind}:${ref.id}`,
            'release.create',
            ref.kind,
            ref.id,
            ref.rev,
            curMeta.originLaneId,
            { kind: ref.kind, id: ref.id, rev: ref.rev, record: cleanSnap },
          );
          events.push(ev);
        }

        // Queue notifications strictly for members of the receiving lane(s).
        const recipientIds = project.members
          .filter((m) => m.state === 'active' && memberLaneIds(m, proc).some((l) => op.payload.toLaneIds.includes(l)))
          .map((m) => m.userId);
        if (recipientIds.length > 0) {
          pendingNotifications.push({
            kind: 'release',
            projectId,
            scopeId,
            recipientUserIds: recipientIds,
            subject: `Items released (${releasedRefs.length})`,
            body: releaseSummaries.length > 0 ? releaseSummaries.join('\n') : `Released ${releasedRefs.length} item(s).`,
          });
        }
      } else {
        const applied = applyOp(state.ops, op, applyCtx);
        if (!applied.ok) {
          await client.query('ROLLBACK');
          return { ok: false, status: 409, error: applied.rejection.code, code: applied.rejection.code };
        }
        state = { ...state, ops: applied.state };

        const kind = op.type.startsWith('markup.')
          ? 'markup'
          : op.type.startsWith('placement.')
            ? 'placement'
            : op.type.startsWith('issue.')
              ? 'issue'
              : op.type.startsWith('response.')
                ? 'response'
                : 'statusEvent';
        const record = itemOf(state.ops, kind, op.entityId)!;
        const laneCfg = proc.lanes.find((l) => l.id === actorLaneId);
        const existingMeta = metaOf(state, kind, op.entityId);

        let nextMeta: ItemMeta;
        let editedInLaneId: string | null = null;
        if (!existingMeta) {
          const draftVis = laneCfg?.defaultDraftVisibility ?? proc.defaultDraftVisibility;
          const gateCheckers = proc.gates
            .filter((g) => g.fromLaneId === actorLaneId)
            .flatMap((g) => g.checkers ?? []);
          const autoRel: Record<string, ReleasedVersionRecord[]> = proc.autoReleaseOnCreate
            ? { [actorLaneId]: [{ releaseId: `auto_${op.entityId}`, rev: record.rev, fromLaneId: actorLaneId, gateId: null, at: nowMs, by: actor }] }
            : {};
          nextMeta = {
            kind,
            id: op.entityId,
            scopeId,
            originLaneId: actorLaneId,
            owner: actor,
            ownerGroupIds: [...member.groupIds],
            draftVisibility: draftVis,
            checkingState: proc.autoReleaseOnCreate ? 'released' : 'draft',
            assignedCheckers: gateCheckers,
            releasesByLane: autoRel,
            initialStatus: op.type === 'issue.create' ? op.payload.status : null,
            latestRev: record.rev,
            history: [],
          };
          if (op.type === 'response.create' && op.payload.parent.kind === 'issue') {
            const parentMeta = metaOf(state, 'issue', op.payload.parent.id);
            if (parentMeta) {
              const responders = new Set(parentMeta.responderUserIds ?? []);
              responders.add(actor.userId);
              state = {
                ...state,
                meta: {
                  ...state.meta,
                  [`issue:${parentMeta.id}`]: { ...parentMeta, responderUserIds: [...responders] },
                },
              };
            }
          }
        } else {
          const isCrossLaneChecker = actorLaneId !== existingMeta.originLaneId;
          if (isCrossLaneChecker && (op.type === 'issue.patch' || op.type === 'markup.patch')) {
            editedInLaneId = actorLaneId;
            const cGate = checkerGateFor(policyCtx, kind, op.entityId, 'editWording');
            const visibleToOriginator = cGate?.checkerPowers?.originatorSeesEdits ?? false;
            nextMeta = {
              ...existingMeta,
              latestRev: record.rev,
              checkedByGateId: cGate?.id ?? existingMeta.checkedByGateId,
              checkerEditedRevs: {
                ...(existingMeta.checkerEditedRevs ?? {}),
                [record.rev]: {
                  laneId: actorLaneId,
                  gateId: cGate?.id ?? '',
                  by: actor,
                  visibleToOriginator,
                },
              },
            };
          } else if (isCrossLaneChecker && op.type.endsWith('.delete')) {
            editedInLaneId = actorLaneId;
            nextMeta = { ...existingMeta, latestRev: record.rev, checkingState: 'stopped' };
          } else {
            nextMeta = { ...existingMeta, latestRev: record.rev };
          }
        }

        state = {
          ...state,
          versions: withSnapshot(state.versions, kind, op.entityId, record.rev, record),
          meta: { ...state.meta, [`${kind}:${op.entityId}`]: nextMeta },
        };

        const targetStream = kind === 'markup' || kind === 'placement'
          ? scopeEntry.documentStreamId
          : scopeEntry.projectStreamId;

        await this.upsertContentRow(
          client,
          projectId,
          scopeId,
          targetStream,
          nextMeta,
          record,
          editedInLaneId,
          actor,
          op.opId,
        );

        if (op.type === 'issue.create') {
          await client.query(
            `INSERT INTO issue_lane_state (issue_id, lane_id, status, version, updated_at)
             VALUES ($1, $2, $3, 1, $4) ON CONFLICT (issue_id, lane_id) DO NOTHING`,
            [op.entityId, actorLaneId, op.payload.status, new Date(nowMs)],
          );
        }

        const ev = await this.appendStreamEvent(
          client,
          targetStream,
          actor.userId,
          op.opId,
          op.type,
          kind,
          op.entityId,
          record.rev,
          nextMeta.originLaneId,
          { kind, id: op.entityId, rev: record.rev, record: sanitizeRecordForRead(kind, record) },
        );
        events.push(ev);
      }

      scopeEntry.state = state;
      await client.query(`UPDATE projects SET settings_json = $2::jsonb WHERE id = $1`, [
        projectId,
        JSON.stringify(settings),
      ]);

      await client.query('COMMIT');

      // Deliver captured notifications after commit.
      if (this.notifications && pendingNotifications.length > 0) {
        for (const n of pendingNotifications) {
          const usersRes = await this.pool.query<{ id: string; email: string }>(
            `SELECT id, email FROM users WHERE id = ANY($1::text[])`,
            [n.recipientUserIds],
          );
          for (const u of usersRes.rows) {
            await this.notifications.send(
              createNotification(
                {
                  kind: n.kind,
                  projectId: n.projectId,
                  scopeId: n.scopeId,
                  recipientUserId: u.id,
                  recipientEmail: u.email,
                  subject: n.subject,
                  body: n.body,
                },
                this.now,
              ),
            );
          }
        }
      }

      return {
        ok: true,
        status: 200,
        data: { ok: true, opId: op.opId, entityId: op.entityId },
        events,
      };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  /** Submits a workflow action (`check.submit`, `check.approve`, `check.return`, `release.withdraw`, etc.). */
  async submitAction(
    scopeId: string,
    userId: string,
    action: PolicyAction & { note?: string },
  ): Promise<ReviewWriteResult> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const loaded = await this.loadScopeForUpdate(client, scopeId);
      if (!loaded) {
        await client.query('ROLLBACK');
        return { ok: false, status: 404, error: 'not_found', code: 'not_found' };
      }
      const { projectId, settings, scopeEntry } = loaded;
      const project = settings.projectConfig;
      const proc = scopeEntry.processConfig;
      let state = scopeEntry.state;

      const member = findActiveMember(project, userId);
      if (!member) {
        await client.query('ROLLBACK');
        return { ok: false, status: 403, error: 'forbidden', code: 'not_member' };
      }
      const actorLaneId = memberLaneIds(member, proc)[0];
      if (!actorLaneId) {
        await client.query('ROLLBACK');
        return { ok: false, status: 404, error: 'not_found', code: 'not_found' };
      }

      const policyCtx: PolicyContext = {
        actorUserId: userId,
        actorLaneId,
        project,
        process: proc,
        state,
      };
      const decision = authorizeAction(action, policyCtx);
      if (!decision.ok) {
        await client.query('ROLLBACK');
        return { ok: false, ...mapPolicyDeny(decision.reason) };
      }

      if (action.type === 'check.submit') {
        const meta = metaOf(state, action.itemKind, action.itemId)!;
        const nextMeta: ItemMeta = { ...meta, checkingState: 'submitted', approvedRev: null };
        state = { ...state, meta: { ...state.meta, [`${meta.kind}:${meta.id}`]: nextMeta } };
        await this.syncItemAudiences(client, nextMeta);
      } else if (action.type === 'check.approve') {
        const meta = metaOf(state, action.itemKind, action.itemId)!;
        const nextMeta: ItemMeta = { ...meta, checkingState: 'approved', approvedRev: meta.latestRev };
        state = { ...state, meta: { ...state.meta, [`${meta.kind}:${meta.id}`]: nextMeta } };
        for (const linked of releaseBundle([{ kind: action.itemKind, id: action.itemId, rev: meta.latestRev }], policyCtx)) {
          const lMeta = metaOf(state, linked.kind, linked.id);
          if (lMeta) {
            state = {
              ...state,
              meta: {
                ...state.meta,
                [`${linked.kind}:${linked.id}`]: { ...lMeta, checkingState: 'approved', approvedRev: linked.rev },
              },
            };
          }
        }
      } else if (action.type === 'check.return') {
        const meta = metaOf(state, action.itemKind, action.itemId)!;
        const gateId = checkerGateFor(policyCtx, action.itemKind, action.itemId, 'return')?.id ?? null;
        const nextMeta: ItemMeta = {
          ...meta,
          checkingState: 'returned',
          approvedRev: null,
          checkedByGateId: gateId,
          checkingLaneId: actorLaneId,
          returnNote: action.note ?? null,
        };
        state = { ...state, meta: { ...state.meta, [`${meta.kind}:${meta.id}`]: nextMeta } };
      } else if (action.type === 'record.lock') {
        const meta = metaOf(state, action.itemKind, action.itemId)!;
        const nextMeta: ItemMeta = { ...meta, locked: action.locked };
        state = { ...state, meta: { ...state.meta, [`${meta.kind}:${meta.id}`]: nextMeta } };
      }

      scopeEntry.state = state;
      await client.query(`UPDATE projects SET settings_json = $2::jsonb WHERE id = $1`, [
        projectId,
        JSON.stringify(settings),
      ]);
      await client.query('COMMIT');
      return { ok: true, status: 200, data: { ok: true }, events: [] };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  /** Uploads an asset bound to a specific visible item version. */
  async uploadAsset(
    scopeId: string,
    userId: string,
    input: { itemKind: ItemKind; itemId: string; filename: string; mediaType: string; contentBase64: string },
  ): Promise<ReviewWriteResult> {
    const bytes = Buffer.from(input.contentBase64, 'base64');
    const sha256 = createHash('sha256').update(bytes).digest('hex');

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const loaded = await this.loadScopeForUpdate(client, scopeId);
      if (!loaded) {
        await client.query('ROLLBACK');
        return { ok: false, status: 404, error: 'not_found', code: 'not_found' };
      }
      const { projectId, settings, scopeEntry } = loaded;
      const member = findActiveMember(settings.projectConfig, userId);
      if (!member) {
        await client.query('ROLLBACK');
        return { ok: false, status: 403, error: 'forbidden', code: 'not_member' };
      }
      const meta = metaOf(scopeEntry.state, input.itemKind, input.itemId);
      if (!meta || !visibleVersionForMember(member, meta, settings.projectConfig, scopeEntry.processConfig)) {
        await client.query('ROLLBACK');
        return { ok: false, status: 404, error: 'not_found', code: 'not_found' };
      }
      if (!memberLaneIds(member, scopeEntry.processConfig).includes(meta.originLaneId)) {
        await client.query('ROLLBACK');
        return { ok: false, status: 403, error: 'forbidden', code: 'forbidden' };
      }

      const storageKey = `projects/${projectId}/${sha256}`;
      await client.query(
        `INSERT INTO assets (project_id, sha256, size_bytes, media_type, storage_key)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT (project_id, sha256) DO NOTHING`,
        [projectId, sha256, String(bytes.byteLength), input.mediaType, storageKey],
      );
      await client.query(
        `INSERT INTO asset_refs (project_id, sha256, item_kind, item_id, version_rev, origin_lane_id)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
        [projectId, sha256, input.itemKind, input.itemId, meta.latestRev, meta.originLaneId],
      );

      await client.query('COMMIT');
      this.blobs.set(storageKey, { bytes, filename: input.filename, mediaType: input.mediaType });
      return {
        ok: true,
        status: 201,
        data: { sha256, sizeBytes: bytes.byteLength, mediaType: input.mediaType, versionRev: meta.latestRev },
        events: [],
      };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  // --- RLS-enforced read paths -----------------------------------------------------------------

  /** Lists all visible items in `scopeId` using the highest visible `version_rev` from `item_versions`. */
  async listItems(scopeId: string, userId: string): Promise<VisibleItemView[]> {
    return this.withReader(userId, async (client) => {
      const res = await client.query<{
        item_kind: ItemKind;
        item_id: string;
        version_rev: number;
        record_json: unknown;
      }>(
        `SELECT DISTINCT ON (item_kind, item_id)
           item_kind, item_id, version_rev, record_json
         FROM item_versions
         WHERE scope_id = $1
         ORDER BY item_kind, item_id, version_rev DESC`,
        [scopeId],
      );

      const laneStates = await client.query<{ issue_id: string; status: string }>(
        `SELECT issue_id, status FROM issue_lane_state ORDER BY issue_id, lane_id`,
      );
      const statusByIssue = new Map<string, string>();
      for (const row of laneStates.rows) {
        if (!statusByIssue.has(row.issue_id)) statusByIssue.set(row.issue_id, row.status);
      }

      return res.rows.map((row) => ({
        kind: row.item_kind,
        id: row.item_id,
        rev: row.version_rev,
        record: sanitizeRecordForRead(row.item_kind, row.record_json),
        ...(row.item_kind === 'issue' ? { status: statusByIssue.get(row.item_id) ?? null } : {}),
      }));
    });
  }

  /** Gets a single visible item by kind and id; returns null if hidden or nonexistent. */
  async getItem(scopeId: string, userId: string, kind: ItemKind, id: string): Promise<VisibleItemView | null> {
    return this.withReader(userId, async (client) => {
      const res = await client.query<{ version_rev: number; record_json: unknown }>(
        `SELECT version_rev, record_json
         FROM item_versions
         WHERE scope_id = $1 AND item_kind = $2 AND item_id = $3
         ORDER BY version_rev DESC
         LIMIT 1`,
        [scopeId, kind, id],
      );
      const row = res.rows[0];
      if (!row) return null;

      let status: string | null | undefined;
      if (kind === 'issue') {
        const stRes = await client.query<{ status: string }>(
          `SELECT status FROM issue_lane_state WHERE issue_id = $1 LIMIT 1`,
          [id],
        );
        status = stRes.rows[0]?.status ?? null;
      }
      return {
        kind,
        id,
        rev: row.version_rev,
        record: sanitizeRecordForRead(kind, row.record_json),
        ...(kind === 'issue' ? { status } : {}),
      };
    });
  }

  /** Counts visible items by kind and visible issues by status, strictly through RLS. */
  async getCounts(
    scopeId: string,
    userId: string,
  ): Promise<{ total: number; byKind: Record<string, number>; byStatus: Record<string, number> }> {
    return this.withReader(userId, async (client) => {
      const kindRes = await client.query<{ item_kind: string; cnt: number }>(
        `WITH latest AS (
           SELECT DISTINCT ON (item_kind, item_id) item_kind, item_id
           FROM item_versions
           WHERE scope_id = $1
           ORDER BY item_kind, item_id, version_rev DESC
         )
         SELECT item_kind, count(*)::int AS cnt FROM latest GROUP BY item_kind`,
        [scopeId],
      );

      const byKind: Record<string, number> = {};
      let total = 0;
      for (const row of kindRes.rows) {
        byKind[row.item_kind] = row.cnt;
        total += row.cnt;
      }

      const statusRes = await client.query<{ status: string; cnt: number }>(
        `WITH visible_issues AS (
           SELECT DISTINCT item_id FROM item_versions WHERE scope_id = $1 AND item_kind = 'issue'
         )
         SELECT ils.status, count(DISTINCT ils.issue_id)::int AS cnt
         FROM issue_lane_state ils
         JOIN visible_issues vi ON vi.item_id = ils.issue_id
         GROUP BY ils.status`,
        [scopeId],
      );
      const byStatus: Record<string, number> = {};
      for (const row of statusRes.rows) {
        byStatus[row.status] = row.cnt;
      }

      return { total, byKind, byStatus };
    });
  }

  /** Postgres full-text search joined to RLS-filtered `item_versions`. */
  async searchItems(scopeId: string, userId: string, query: string): Promise<VisibleItemView[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];
    return this.withReader(userId, async (client) => {
      const res = await client.query<{
        item_kind: ItemKind;
        item_id: string;
        version_rev: number;
        record_json: unknown;
      }>(
        `WITH latest_visible AS (
           SELECT DISTINCT ON (item_kind, item_id)
             item_kind, item_id, version_rev, record_json
           FROM item_versions
           WHERE scope_id = $1
           ORDER BY item_kind, item_id, version_rev DESC
         )
         SELECT item_kind, item_id, version_rev, record_json
         FROM latest_visible
         WHERE to_tsvector('english',
           coalesce(record_json->>'title', '') || ' ' ||
           coalesce(record_json->>'body', '') || ' ' ||
           coalesce(record_json->'content'->>'text', '')
         ) @@ plainto_tsquery('english', $2)
         ORDER BY item_kind, item_id`,
        [scopeId, trimmed],
      );
      return res.rows.map((row) => ({
        kind: row.item_kind,
        id: row.item_id,
        rev: row.version_rev,
        record: sanitizeRecordForRead(row.item_kind, row.record_json),
      }));
    });
  }

  /** Reads an asset only if Postgres RLS permits the caller to see a referencing item version. */
  async getAsset(
    projectId: string,
    sha256: string,
    userId: string,
  ): Promise<{ sha256: string; sizeBytes: number; mediaType: string; filename: string; contentBase64: string } | null> {
    if (!SHA256_RE.test(sha256)) return null;
    const row = await this.withReader(userId, async (client) => {
      const res = await client.query<{ storage_key: string; media_type: string; size_bytes: string }>(
        `SELECT storage_key, media_type, size_bytes FROM assets WHERE project_id = $1 AND sha256 = $2 LIMIT 1`,
        [projectId, sha256],
      );
      return res.rows[0] ?? null;
    });
    if (!row) return null;
    const blob = this.blobs.get(row.storage_key);
    if (!blob) return null;
    return {
      sha256,
      sizeBytes: Number(row.size_bytes),
      mediaType: row.media_type,
      filename: blob.filename,
      contentBase64: blob.bytes.toString('base64'),
    };
  }

  /** Reads the sync feed for `streamId` after an AEAD-sealed cursor, filtered through RLS. */
  async readSyncFeed(
    streamId: string,
    userId: string,
    cursorToken: string | null,
  ): Promise<{ ok: true; events: Record<string, unknown>[]; cursor: string } | { ok: false; error: 'invalid_cursor' }> {
    let afterSeq = 0;
    if (cursorToken !== null && cursorToken !== '') {
      const opened = openCursor(this.cursorKey, cursorToken, { userId, streamId });
      if (opened === null) return { ok: false, error: 'invalid_cursor' };
      afterSeq = opened;
    }

    const rows = await this.withReader(userId, async (client) => {
      const res = await client.query<{
        seq: string;
        op_id: string;
        op_type: string;
        item_kind: ItemKind;
        entity_id: string;
        version_rev: number;
        payload_json: unknown;
        received_at: Date;
      }>(
        `SELECT seq, op_id, op_type, item_kind, entity_id, version_rev, payload_json, received_at
         FROM events
         WHERE stream_id = $1 AND seq > $2
         ORDER BY seq ASC`,
        [streamId, String(afterSeq)],
      );
      return res.rows;
    });

    // Advance the sealed cursor only to the highest seq visible to this user, so hidden events
    // cannot be inferred from cursor changes.
    let nextSeq = afterSeq;
    const projected = rows.map((row) => {
      const seqNum = Number(row.seq);
      if (seqNum > nextSeq) nextSeq = seqNum;
      return {
        opId: row.op_id,
        opType: row.op_type,
        itemKind: row.item_kind,
        entityId: row.entity_id,
        versionRev: row.version_rev,
        payload: row.payload_json,
        receivedAt: row.received_at.toISOString(),
      };
    });

    const cursor = sealCursor(this.cursorKey, { userId, streamId }, nextSeq);
    return { ok: true, events: projected, cursor };
  }

  /** Exports the visible issue register for `scopeId` in JSON, CSV, or plain text, strictly under RLS. */
  async exportRegister(
    scopeId: string,
    userId: string,
    format: 'json' | 'csv' | 'text',
  ): Promise<{ contentType: string; body: string; rows: RegisterRow[] }> {
    const rows = await this.withReader(userId, async (client) => {
      const issueRes = await client.query<{ item_id: string; version_rev: number; record_json: Issue }>(
        `SELECT DISTINCT ON (item_id) item_id, version_rev, record_json
         FROM item_versions
         WHERE scope_id = $1 AND item_kind = 'issue'
         ORDER BY item_id, version_rev DESC`,
        [scopeId],
      );

      const respRes = await client.query<{ item_id: string; version_rev: number; record_json: OpsResponse }>(
        `SELECT DISTINCT ON (item_id) item_id, version_rev, record_json
         FROM item_versions
         WHERE scope_id = $1 AND item_kind = 'response'
         ORDER BY item_id, version_rev DESC`,
        [scopeId],
      );

      const stateRes = await client.query<{ issue_id: string; status: string }>(
        `SELECT issue_id, status FROM issue_lane_state ORDER BY issue_id, lane_id`,
      );
      const statusByIssue = new Map<string, string>();
      for (const s of stateRes.rows) {
        if (!statusByIssue.has(s.issue_id)) statusByIssue.set(s.issue_id, s.status);
      }

      const assetRes = await client.query<{
        item_kind: string;
        item_id: string;
        version_rev: number;
        sha256: string;
        storage_key: string;
        media_type: string;
      }>(
        `SELECT r.item_kind, r.item_id, r.version_rev, a.sha256, a.storage_key, a.media_type
         FROM asset_refs r
         JOIN assets a ON a.project_id = r.project_id AND a.sha256 = r.sha256`,
      );

      const responsesByIssue = new Map<string, RegisterRow['responses']>();
      for (const r of respRes.rows) {
        const rec = r.record_json;
        if (rec.parent.kind !== 'issue') continue;
        const list = responsesByIssue.get(rec.parent.id) ?? [];
        list.push({
          id: rec.id,
          body: rec.body,
          ownerUserId: rec.owner.userId,
          kind: rec.kind,
          rev: r.version_rev,
        });
        responsesByIssue.set(rec.parent.id, list);
      }

      const result: RegisterRow[] = [];
      for (const row of issueRes.rows) {
        const iss = row.record_json;
        const matchingAssets = assetRes.rows
          .filter((a) => a.item_kind === 'issue' && a.item_id === row.item_id && a.version_rev === row.version_rev)
          .map((a) => {
            const blob = this.blobs.get(a.storage_key);
            return {
              sha256: a.sha256,
              filename: blob?.filename ?? a.sha256,
              mediaType: a.media_type,
            };
          });
        result.push({
          issueId: row.item_id,
          number: iss.number ?? null,
          title: iss.title,
          status: statusByIssue.get(row.item_id) ?? 'open',
          ownerUserId: iss.owner.userId,
          ownerPartyId: iss.owner.partyId,
          checked: Boolean(iss.checked),
          rev: row.version_rev,
          responses: responsesByIssue.get(row.item_id) ?? [],
          assets: matchingAssets,
        });
      }

      result.sort((a, b) => {
        if (a.number !== null && b.number !== null) return a.number - b.number;
        if (a.number !== null) return -1;
        if (b.number !== null) return 1;
        return a.issueId.localeCompare(b.issueId);
      });
      return result;
    });

    if (format === 'csv') {
      const header = 'number,issueId,title,status,ownerUserId,checked,responses,assets';
      const lines = rows.map((r) =>
        [
          r.number === null ? '' : String(r.number),
          r.issueId,
          r.title,
          r.status,
          r.ownerUserId,
          String(r.checked),
          r.responses.map((resp) => resp.body).join(' | '),
          r.assets.map((a) => a.filename).join(';'),
        ]
          .map(csvEscape)
          .join(','),
      );
      return { contentType: 'text/csv; charset=utf-8', body: [header, ...lines].join('\n'), rows };
    }

    if (format === 'text') {
      const lines = rows.map((r) => {
        const num = r.number === null ? 'DRAFT' : `#${r.number}`;
        const respText = r.responses.map((x) => `  - ${x.body}`).join('\n');
        const assetText = r.assets.map((a) => `  [asset: ${a.filename}]`).join('\n');
        return [`${num} [${r.status}] ${r.title}`, respText, assetText].filter(Boolean).join('\n');
      });
      return { contentType: 'text/plain; charset=utf-8', body: lines.join('\n'), rows };
    }

    return { contentType: 'application/json; charset=utf-8', body: JSON.stringify({ rows }), rows };
  }
}

export { statusDef };
