import {
  applyOp,
  emptyState,
  itemOf,
  PROTOCOL_VERSION,
  statusDef,
  type Actor,
  type AnyOperation,
  type ApplyContext,
  type ItemKind,
  type ItemRef,
  type Operation,
  type Rejection,
} from '@nb/ops';
import {
  authorizeAction,
  authorizeOp,
  checkerGateFor,
  gateCategoryOf,
  releaseBundle,
  type PolicyContext,
  type PolicyDecision,
  type PolicyDenyReason,
} from './authorize.ts';
import { findActiveMember } from './grants.ts';
import {
  itemKey,
  own,
  type CheckingState,
  type DraftAccessRef,
  type DraftVisibility,
  type ItemHistoryEntry,
  type ItemMeta,
  type PolicyState,
  type ProcessConfig,
  type ProjectConfig,
  type ReleasedVersionRecord,
  type VersionSnapshots,
} from './types.ts';
import { activeReleases, memberLaneIds, metaOf, visibleVersionForMember } from './visibility.ts';
import { scanViewForCanaries, viewAs, viewAsPerspective, type ProjectedView } from './viewAs.ts';

// Pure stateful execution engine + scenario script runner.
// Drives `@nb/ops` reducers behind `@nb/policy` authorization, maintains immutable version snapshots
// and audience metadata, and runs declarative step-by-step scenario scripts.

export function createPolicyState(presentUserIds: readonly string[] = []): PolicyState {
  return {
    ops: emptyState(),
    meta: {},
    versions: {},
    nextIssueNumber: 1,
    presentUserIds,
  };
}

export interface BulkReleaseItemResult {
  item: ItemRef;
  ok: boolean;
  reason?: PolicyDenyReason | Rejection;
}

export interface ExecutionResult {
  ok: boolean;
  state: PolicyState;
  error?: PolicyDenyReason | Rejection;
  batchId?: string;
  itemResults?: readonly BulkReleaseItemResult[];
}

export type ScenarioAction =
  | {
      type: 'createIssue';
      id: string;
      title: string;
      status?: string;
      revisionId?: string;
      pageId?: string;
      markupId?: string;
      placementId?: string;
      draftVisibility?: DraftVisibility;
      assignedCheckers?: readonly DraftAccessRef[];
      documentId?: string;
    }
  | {
      type: 'createMarkup';
      id: string;
      text: string;
      revisionId?: string;
      pageId?: string;
      placementId?: string;
      draftVisibility?: DraftVisibility;
      assignedCheckers?: readonly DraftAccessRef[];
    }
  | { type: 'editIssue'; id: string; title: string }
  | { type: 'tickIssue'; id: string; checked: boolean; revisionSeenId?: string }
  | { type: 'deleteItem'; kind: ItemKind; id: string }
  | { type: 'restoreItem'; kind: ItemKind; id: string }
  | { type: 'submit'; kind: ItemKind; id: string }
  | { type: 'approve'; kind: ItemKind; id: string }
  | { type: 'returnItem'; kind: ItemKind; id: string; note?: string; gateId?: string }
  | { type: 'overrideChecker'; kind: ItemKind; id: string; overrideKind: 'return' | 'edit' | 'delete'; label?: string }
  | {
      type: 'release';
      gateId: string | null;
      toLaneIds: readonly string[];
      items: readonly { kind: ItemKind; id: string; rev?: number }[];
      bulk?: boolean;
    }
  | { type: 'withdraw'; kind: ItemKind; id: string; laneIds: readonly string[] }
  | { type: 'respond'; id: string; parent: { kind: 'issue' | 'markup'; id: string }; body: string; kind?: 'reply' | 'formal' }
  | { type: 'transitionStatus'; id?: string; issueId: string; from?: string | null; to: string; note?: string; revisionSeenId?: string | null }
  | { type: 'carryOpenToRevision'; revisionId: string; pageId?: string }
  | { type: 'lockItem'; kind: ItemKind; id: string; locked: boolean }
  | { type: 'rawOp'; op: Operation };

const DEFAULT_STYLE = { stroke: '#d62828', fill: null, width: 2, opacity: 1 };

function withSnapshot(versions: VersionSnapshots, kind: ItemKind, id: string, rev: number, record: unknown): VersionSnapshots {
  const key = itemKey(kind, id);
  const existing = own(versions, key) ?? {};
  return { ...versions, [key]: { ...existing, [rev]: structuredClone(record) } };
}

function withMeta(state: PolicyState, meta: ItemMeta): PolicyState {
  return { ...state, meta: { ...state.meta, [itemKey(meta.kind, meta.id)]: meta } };
}

function appendHistory(meta: ItemMeta, entry: ItemHistoryEntry): ItemMeta {
  return { ...meta, history: [...meta.history, entry] };
}

function actorOfMember(project: ProjectConfig, userId: string): Actor | null {
  const m = findActiveMember(project, userId);
  if (!m) return null;
  return { userId: m.userId, partyId: m.partyId, groupId: m.groupIds[0] ?? null };
}

function defaultLaneOf(project: ProjectConfig, process: ProcessConfig, userId: string): string | null {
  const m = findActiveMember(project, userId);
  if (!m) return null;
  return memberLaneIds(m, process)[0] ?? null;
}

function checkDecision(decision: PolicyDecision, state: PolicyState): ExecutionResult | null {
  return decision.ok ? null : { ok: false, state, error: decision.reason };
}

export interface ExecuteContext {
  project: ProjectConfig;
  process: ProcessConfig;
  now: number;
  opSeq: number;
}

/**
 * Executes one high-level `ScenarioAction` (or raw `@nb/ops` operation) through `@nb/policy` and `@nb/ops`.
 * Pure: never mutates inputs.
 */
export function executeAction(
  state: PolicyState,
  actorUserId: string,
  action: ScenarioAction,
  exec: ExecuteContext,
): ExecutionResult {
  const { project, process, now } = exec;
  let seq = exec.opSeq;
  const nextOpId = (): string => `op_${++seq}`;

  const policyCtx = (s: PolicyState): PolicyContext => ({
    actorUserId,
    project,
    process,
    state: s,
  });

  const actor = actorOfMember(project, actorUserId);
  const ownerGroupIds = [...(findActiveMember(project, actorUserId)?.groupIds ?? [])];
  const laneId = defaultLaneOf(project, process, actorUserId);

  const applyCtx = (): ApplyContext => ({
    actor: actor ?? { userId: actorUserId, partyId: null, groupId: null },
    laneId: laneId ?? '',
    now,
    statuses: project.statuses,
  });

  const makeOp = <T extends AnyOperation['type']>(
    type: T,
    entityId: string,
    payload: Extract<AnyOperation, { type: T }>['payload'],
    basedOn?: Record<string, number | string>,
  ): Extract<AnyOperation, { type: T }> =>
    ({
      opId: nextOpId(),
      schemaVersion: PROTOCOL_VERSION,
      streamId: process.id,
      type,
      entityId,
      payload,
      ...(basedOn ? { basedOn } : {}),
    }) as Extract<AnyOperation, { type: T }>;

  const assignNumberIfNeeded = (s: PolicyState, issueId: string): PolicyState => {
    const issue = own(s.ops.issues, issueId);
    if (!issue || issue.number !== null) return s;
    const numOp = makeOp('issue.number', issueId, { number: s.nextIssueNumber });
    const res = applyOp(s.ops, numOp, applyCtx());
    if (!res.ok) return s;
    const numbered = own(res.state.issues, issueId)!;
    const meta = metaOf(s, 'issue', issueId);
    let next: PolicyState = {
      ...s,
      ops: res.state,
      nextIssueNumber: s.nextIssueNumber + 1,
      versions: withSnapshot(s.versions, 'issue', issueId, numbered.rev, numbered),
    };
    if (meta) {
      // Keep the latestRev synchronized only if we bumped rev; note numbering doesn't overwrite earlier content snapshots.
      next = withMeta(next, { ...meta, latestRev: Math.max(meta.latestRev, numbered.rev) });
    }
    return next;
  };

  switch (action.type) {
    case 'createMarkup': {
      const op = makeOp('markup.create', action.id, {
        scopeId: process.id,
        type: 'rect',
        content: { style: DEFAULT_STYLE, text: action.text },
      });
      const denied = checkDecision(authorizeOp(op, policyCtx(state)), state);
      if (denied) return denied;
      const applied = applyOp(state.ops, op, applyCtx());
      if (!applied.ok) return { ok: false, state, error: applied.rejection };

      const laneCfg = process.lanes.find((l) => l.id === laneId!);
      const draftVis = action.draftVisibility ?? laneCfg?.defaultDraftVisibility ?? process.defaultDraftVisibility;
      const gateCheckers = process.gates
        .filter((g) => g.fromLaneId === laneId! && g.itemKinds.includes('comment'))
        .flatMap((g) => g.checkers ?? []);
      const record = own(applied.state.markups, action.id)!;
      const releasesByLane: Record<string, ReleasedVersionRecord[]> = process.autoReleaseOnCreate
        ? { [laneId!]: [{ releaseId: `auto_${action.id}`, rev: record.rev, fromLaneId: laneId!, gateId: null, at: now, by: actor! }] }
        : {};
      const meta: ItemMeta = {
        kind: 'markup',
        id: action.id,
        scopeId: process.id,
        originLaneId: laneId!,
        owner: actor!,
        ownerGroupIds,
        draftVisibility: draftVis,
        checkingState: process.autoReleaseOnCreate ? 'released' : 'draft',
        assignedCheckers: action.assignedCheckers ?? gateCheckers,
        releasesByLane,
        latestRev: record.rev,
        history: [
          {
            at: now,
            actor: actor!,
            laneId: laneId!,
            action: 'create',
            rev: record.rev,
            visibleToLaneIds: [laneId!],
            privateDraftOnly: draftVis === 'private' && !process.autoReleaseOnCreate,
          },
        ],
      };
      let next: PolicyState = withMeta(
        { ...state, ops: applied.state, versions: withSnapshot(state.versions, 'markup', action.id, record.rev, record) },
        meta,
      );

      if (action.revisionId) {
        const placementId = action.placementId ?? `${action.id}_p_${action.revisionId}`;
        const pOp = makeOp('placement.create', placementId, {
          markupId: action.id,
          revisionId: action.revisionId,
          pageId: action.pageId ?? `${action.revisionId}_p1`,
          geometry: { points: [[10, 10], [40, 40]] },
          method: 'original',
          confidence: null,
          state: 'confirmed',
        });
        const pApplied = applyOp(next.ops, pOp, applyCtx());
        if (pApplied.ok) {
          const pRec = own(pApplied.state.placements, placementId)!;
          const pMeta: ItemMeta = {
            ...meta,
            kind: 'placement',
            id: placementId,
            releasesByLane: process.autoReleaseOnCreate
              ? { [laneId!]: [{ releaseId: `auto_${placementId}`, rev: pRec.rev, fromLaneId: laneId!, gateId: null, at: now, by: actor! }] }
              : {},
            latestRev: pRec.rev,
          };
          next = withMeta(
            { ...next, ops: pApplied.state, versions: withSnapshot(next.versions, 'placement', placementId, pRec.rev, pRec) },
            pMeta,
          );
        }
      }
      return { ok: true, state: next };
    }

    case 'createIssue': {
      let current = state;
      const markupIds: string[] = [];
      if (action.revisionId) {
        const markupId = action.markupId ?? `${action.id}_m`;
        const mRes = executeAction(
          current,
          actorUserId,
          {
            type: 'createMarkup',
            id: markupId,
            text: action.title,
            revisionId: action.revisionId,
            pageId: action.pageId,
            placementId: action.placementId,
            draftVisibility: action.draftVisibility,
            assignedCheckers: action.assignedCheckers,
          },
          { ...exec, opSeq: seq },
        );
        if (!mRes.ok) return mRes;
        current = mRes.state;
        seq += 4;
        markupIds.push(markupId);
      }

      const initialStatus = action.status ?? project.statuses.find((s) => s.category === 'open')?.id ?? 'open';
      const op = makeOp('issue.create', action.id, {
        scopeId: process.id,
        title: action.title,
        status: initialStatus,
        markupIds,
        originatingReviewId: process.kind === 'review' ? process.id : process.parentReviewId ?? null,
      });
      const denied = checkDecision(authorizeOp(op, policyCtx(current)), state);
      if (denied) return denied;

      const applied = applyOp(current.ops, op, applyCtx());
      if (!applied.ok) return { ok: false, state, error: applied.rejection };

      const laneCfg = process.lanes.find((l) => l.id === laneId!);
      const draftVis = action.draftVisibility ?? laneCfg?.defaultDraftVisibility ?? process.defaultDraftVisibility;
      const gateCheckers = process.gates
        .filter((g) => g.fromLaneId === laneId! && g.itemKinds.includes('comment'))
        .flatMap((g) => g.checkers ?? []);
      const record = own(applied.state.issues, action.id)!;
      const releasesByLane: Record<string, ReleasedVersionRecord[]> = process.autoReleaseOnCreate
        ? { [laneId!]: [{ releaseId: `auto_${action.id}`, rev: record.rev, fromLaneId: laneId!, gateId: null, at: now, by: actor! }] }
        : {};
      const meta: ItemMeta = {
        kind: 'issue',
        id: action.id,
        scopeId: process.id,
        originLaneId: laneId!,
        owner: actor!,
        ownerGroupIds,
        draftVisibility: draftVis,
        checkingState: process.autoReleaseOnCreate ? 'released' : 'draft',
        assignedCheckers: action.assignedCheckers ?? gateCheckers,
        releasesByLane,
        documentId: action.documentId ?? null,
        initialStatus,
        latestRev: record.rev,
        history: [
          {
            at: now,
            actor: actor!,
            laneId: laneId!,
            action: 'create',
            rev: record.rev,
            visibleToLaneIds: [laneId!],
            privateDraftOnly: draftVis === 'private' && !process.autoReleaseOnCreate,
          },
        ],
      };

      let next: PolicyState = withMeta(
        { ...current, ops: applied.state, versions: withSnapshot(current.versions, 'issue', action.id, record.rev, record) },
        meta,
      );
      if (process.numberingMode === 'on_create') {
        next = assignNumberIfNeeded(next, action.id);
        if (process.autoReleaseOnCreate) {
          const numberedRec = own(next.ops.issues, action.id)!;
          const curMeta = metaOf(next, 'issue', action.id)!;
          next = withMeta(next, {
            ...curMeta,
            releasesByLane: {
              [laneId!]: [{ releaseId: `auto_${action.id}`, rev: numberedRec.rev, fromLaneId: laneId!, gateId: null, at: now, by: actor! }],
            },
          });
        }
      }
      return { ok: true, state: next };
    }

    case 'editIssue': {
      const existing = own(state.ops.issues, action.id);
      const titleVer = existing?.versions.title?.v ?? 0;
      const op = makeOp('issue.patch', action.id, { title: action.title }, { title: titleVer });
      const denied = checkDecision(authorizeOp(op, policyCtx(state)), state);
      if (denied) return denied;

      const applied = applyOp(state.ops, op, applyCtx());
      if (!applied.ok) return { ok: false, state, error: applied.rejection };

      const updated = own(applied.state.issues, action.id)!;
      let meta = metaOf(state, 'issue', action.id)!;
      const isCrossLaneChecker = laneId !== meta.originLaneId;
      // The gate is the one the item actually arrived through (authorization required its powers).
      const checkerGate = isCrossLaneChecker ? checkerGateFor(policyCtx(state), 'issue', action.id, 'editWording') : undefined;
      const checkerGateId = checkerGate?.id ?? '';
      const visibleToOriginator = checkerGate?.checkerPowers?.originatorSeesEdits ?? false;

      if (isCrossLaneChecker) {
        const gateId = checkerGateId;
        const checkerEditedRevs = {
          ...(meta.checkerEditedRevs ?? {}),
          [updated.rev]: { laneId: laneId!, gateId, by: actor!, visibleToOriginator },
        };
        meta = appendHistory(
          { ...meta, latestRev: updated.rev, checkerEditedRevs, checkedByGateId: gateId || meta.checkedByGateId },
          {
            at: now,
            actor: actor!,
            laneId: laneId!,
            action: 'check_edit',
            rev: updated.rev,
            visibleToLaneIds: visibleToOriginator ? [laneId!, meta.originLaneId] : [laneId!],
          },
        );
      } else {
        const wasReleased = Object.entries(meta.releasesByLane).some(
          ([l, rels]) => l !== meta.originLaneId && rels.length > 0,
        );
        meta = appendHistory(
          { ...meta, latestRev: updated.rev },
          {
            at: now,
            actor: actor!,
            laneId: laneId!,
            action: wasReleased ? 'amend' : 'edit',
            rev: updated.rev,
            visibleToLaneIds: [laneId!],
            privateDraftOnly: meta.draftVisibility === 'private' && !wasReleased,
          },
        );
      }

      let next: PolicyState = withMeta(
        { ...state, ops: applied.state, versions: withSnapshot(state.versions, 'issue', action.id, updated.rev, updated) },
        meta,
      );
      // Keep any companion markup created alongside this issue in sync so draft wording never leaks on release.
      const companionId = `${action.id}_m`;
      const companion = own(next.ops.markups, companionId);
      if (companion && updated.markupIds.includes(companionId)) {
        const textVer = companion.versions.text?.v ?? 0;
        const mOp = makeOp('markup.patch', companionId, { set: { text: action.title } }, { text: textVer });
        const mApplied = applyOp(next.ops, mOp, applyCtx());
        if (mApplied.ok) {
          const mUpdated = own(mApplied.state.markups, companionId)!;
          const mMeta = metaOf(next, 'markup', companionId);
          next = {
            ...next,
            ops: mApplied.state,
            versions: withSnapshot(next.versions, 'markup', companionId, mUpdated.rev, mUpdated),
          };
          if (mMeta) {
            next = withMeta(next, {
              ...mMeta,
              latestRev: mUpdated.rev,
              ...(isCrossLaneChecker
                ? {
                    checkerEditedRevs: {
                      ...(mMeta.checkerEditedRevs ?? {}),
                      [mUpdated.rev]: { laneId: laneId!, gateId: checkerGateId, by: actor!, visibleToOriginator },
                    },
                  }
                : {}),
            });
          }
        }
      }
      return { ok: true, state: next };
    }

    case 'tickIssue': {
      const existing = own(state.ops.issues, action.id);
      const checkedVer = existing?.versions.checked?.v ?? 0;
      const op = makeOp('issue.patch', action.id, { checked: action.checked }, { checked: checkedVer });
      const denied = checkDecision(authorizeOp(op, policyCtx(state)), state);
      if (denied) return denied;

      const applied = applyOp(state.ops, op, applyCtx());
      if (!applied.ok) return { ok: false, state, error: applied.rejection };

      const updated = own(applied.state.issues, action.id)!;
      let meta = metaOf(state, 'issue', action.id)!;
      // If the issue is already auto-released in this single lane, keep the lane's release pointing at the updated rev.
      const releasesByLane = { ...meta.releasesByLane };
      if (process.autoReleaseOnCreate && laneId) {
        const existingRels = own(releasesByLane, laneId) ?? [];
        releasesByLane[laneId] = [
          ...existingRels,
          { releaseId: `auto_tick_${updated.rev}`, rev: updated.rev, fromLaneId: laneId, gateId: null, at: now, by: actor! },
        ];
      }
      meta = { ...meta, latestRev: updated.rev, releasesByLane };

      let next: PolicyState = withMeta(
        { ...state, ops: applied.state, versions: withSnapshot(state.versions, 'issue', action.id, updated.rev, updated) },
        meta,
      );

      // If project setting `tickClosesIssue` is enabled, ticking also transitions into the closed status.
      if (process.tickClosesIssue && action.checked) {
        const closed = project.statuses.find((s) => s.category === 'closed');
        if (closed) {
          const tRes = executeAction(
            next,
            actorUserId,
            { type: 'transitionStatus', issueId: action.id, to: closed.id, revisionSeenId: action.revisionSeenId ?? 'revA' },
            { ...exec, opSeq: seq },
          );
          if (!tRes.ok) return tRes;
          next = tRes.state;
        }
      }
      return { ok: true, state: next };
    }

    case 'deleteItem':
    case 'restoreItem': {
      const opType = `${action.kind}.${action.type === 'deleteItem' ? 'delete' : 'restore'}` as Operation['type'];
      const op = makeOp(opType, action.id, {} as never);
      const denied = checkDecision(authorizeOp(op, policyCtx(state)), state);
      if (denied) return denied;

      const applied = applyOp(state.ops, op, applyCtx());
      if (!applied.ok) return { ok: false, state, error: applied.rejection };

      const record = itemOf(applied.state, action.kind, action.id)!;
      let meta = metaOf(state, action.kind, action.id)!;
      const isCrossLaneStop = action.type === 'deleteItem' && laneId !== meta.originLaneId;
      const nextChecking: CheckingState = isCrossLaneStop ? 'stopped' : meta.checkingState;
      meta = appendHistory(
        { ...meta, latestRev: record.rev, checkingState: nextChecking },
        {
          at: now,
          actor: actor!,
          laneId: laneId!,
          action: isCrossLaneStop ? 'check_delete' : action.type === 'deleteItem' ? 'delete' : 'restore',
          rev: record.rev,
          visibleToLaneIds: [laneId!],
        },
      );
      return {
        ok: true,
        state: withMeta(
          { ...state, ops: applied.state, versions: withSnapshot(state.versions, action.kind, action.id, record.rev, record) },
          meta,
        ),
      };
    }

    case 'submit': {
      const denied = checkDecision(
        authorizeAction({ type: 'check.submit', itemKind: action.kind, itemId: action.id }, policyCtx(state)),
        state,
      );
      if (denied) return denied;
      let meta = metaOf(state, action.kind, action.id)!;
      meta = appendHistory(
        { ...meta, checkingState: 'submitted', approvedRev: null },
        { at: now, actor: actor!, laneId: laneId!, action: 'submit', rev: meta.latestRev, visibleToLaneIds: [laneId!] },
      );
      return { ok: true, state: withMeta(state, meta) };
    }

    case 'approve': {
      const denied = checkDecision(
        authorizeAction({ type: 'check.approve', itemKind: action.kind, itemId: action.id }, policyCtx(state)),
        state,
      );
      if (denied) return denied;
      const meta = metaOf(state, action.kind, action.id)!;
      let next = withMeta(
        state,
        appendHistory(
          { ...meta, checkingState: 'approved', approvedRev: meta.latestRev },
          { at: now, actor: actor!, laneId: laneId!, action: 'approve', rev: meta.latestRev, visibleToLaneIds: [laneId!] },
        ),
      );
      // The check covers the linked markups and placements that would travel with this item.
      for (const linked of releaseBundle([{ kind: action.kind, id: action.id, rev: meta.latestRev }], policyCtx(state))) {
        const lMeta = metaOf(next, linked.kind, linked.id)!;
        next = withMeta(next, { ...lMeta, checkingState: 'approved', approvedRev: linked.rev });
      }
      return { ok: true, state: next };
    }

    case 'returnItem': {
      const denied = checkDecision(
        authorizeAction(
          { type: 'check.return', itemKind: action.kind, itemId: action.id, gateId: action.gateId },
          policyCtx(state),
        ),
        state,
      );
      if (denied) return denied;
      let meta = metaOf(state, action.kind, action.id)!;
      // A cross-lane return records the gate the item actually came through; an internal one has none.
      const gateId = checkerGateFor(policyCtx(state), action.kind, action.id, 'return')?.id ?? null;
      const visibleTo = [...new Set([meta.originLaneId, laneId!])];
      meta = appendHistory(
        {
          ...meta,
          checkingState: 'returned',
          approvedRev: null,
          checkedByGateId: gateId,
          checkingLaneId: laneId!,
          returnNote: action.note ?? null,
        },
        {
          at: now,
          actor: actor!,
          laneId: laneId!,
          action: 'return',
          rev: meta.latestRev,
          note: action.note ?? null,
          visibleToLaneIds: visibleTo,
        },
      );
      return { ok: true, state: withMeta(state, meta) };
    }

    case 'overrideChecker': {
      const denied = checkDecision(
        authorizeAction(
          { type: 'check.override', itemKind: action.kind, itemId: action.id, overrideKind: action.overrideKind },
          policyCtx(state),
        ),
        state,
      );
      if (denied) return denied;
      let meta = metaOf(state, action.kind, action.id)!;
      const label = action.label ?? `${action.overrideKind === 'return' ? 'returned' : action.overrideKind}, overridden by ${meta.originLaneId}`;
      const visibleTo = [...new Set([meta.originLaneId, ...(meta.checkingLaneId ? [meta.checkingLaneId] : [])])];
      meta = appendHistory(
        {
          ...meta,
          checkingState: 'submitted',
          approvedRev: null,
          overridden: { kind: action.overrideKind, by: actor!, at: now, label },
        },
        {
          at: now,
          actor: actor!,
          laneId: laneId!,
          action: 'override',
          rev: meta.latestRev,
          note: label,
          visibleToLaneIds: visibleTo,
        },
      );
      return { ok: true, state: withMeta(state, meta) };
    }

    case 'release': {
      const batchId = `batch_${nextOpId()}`;
      const resolveItemRef = (s: PolicyState, entry: { kind: ItemKind; id: string; rev?: number }): ItemRef => {
        const rec = itemOf(s.ops, entry.kind, entry.id);
        return { kind: entry.kind, id: entry.id, rev: entry.rev ?? rec?.rev ?? 1 };
      };

      const releaseOne = (
        s: PolicyState,
        itemsToRelease: readonly ItemRef[],
      ): { ok: true; state: PolicyState } | { ok: false; error: PolicyDenyReason | Rejection } => {
        // Order issue numbering by creation time inside a release.
        const sortedRefs = [...itemsToRelease].sort((a, b) => {
          const ra = itemOf(s.ops, a.kind, a.id) as { createdAt?: number } | undefined;
          const rb = itemOf(s.ops, b.kind, b.id) as { createdAt?: number } | undefined;
          return (ra?.createdAt ?? 0) - (rb?.createdAt ?? 0);
        });

        const relId = `rel_${nextOpId()}`;
        const relOp = makeOp('release.create', relId, {
          gateId: action.gateId,
          toLaneIds: [...action.toLaneIds],
          items: sortedRefs,
        });
        const decision = authorizeOp(relOp, policyCtx(s));
        if (!decision.ok) return { ok: false, error: decision.reason };

        const applied = applyOp(s.ops, relOp, applyCtx());
        if (!applied.ok) return { ok: false, error: applied.rejection };

        let next: PolicyState = { ...s, ops: applied.state };
        // The linked markups and placements authorization approved to travel with the issues.
        const bundle = releaseBundle(sortedRefs, policyCtx(s));
        const gateFor = (kind: ItemKind) =>
          action.gateId !== null
            ? process.gates.find((g) => g.id === action.gateId)
            : process.gates.find(
                (g) =>
                  g.fromLaneId === laneId! &&
                  g.itemKinds.includes(gateCategoryOf(kind)) &&
                  action.toLaneIds.every((t) => g.toLaneIds.includes(t)),
              );

        const recordRelease = (st: PolicyState, ref: ItemRef): PolicyState => {
          let meta = metaOf(st, ref.kind, ref.id)!;
          const gate = gateFor(ref.kind);
          const releasesByLane: Record<string, ReleasedVersionRecord[]> = {};
          for (const [l, list] of Object.entries(meta.releasesByLane)) releasesByLane[l] = [...list];
          for (const targetLane of action.toLaneIds) {
            const list = releasesByLane[targetLane] ?? [];
            list.push({ releaseId: relId, rev: ref.rev, fromLaneId: laneId!, gateId: gate?.id ?? action.gateId, at: now, by: actor! });
            releasesByLane[targetLane] = list;
          }
          // Checker powers come only from a gate leaving the item's own origin lane.
          const checkerGate = gate?.checkerPowers && gate.fromLaneId === meta.originLaneId ? gate : undefined;
          meta = appendHistory(
            {
              ...meta,
              checkingState: 'released',
              releasesByLane,
              withdrawnInLanes: (meta.withdrawnInLanes ?? []).filter((l) => !action.toLaneIds.includes(l)),
              arrivedViaGateId: checkerGate ? checkerGate.id : meta.arrivedViaGateId,
              checkingLaneId: checkerGate ? action.toLaneIds[0] ?? meta.checkingLaneId : meta.checkingLaneId,
            },
            { at: now, actor: actor!, laneId: laneId!, action: 'release', rev: ref.rev, visibleToLaneIds: [laneId!] },
          );
          return withMeta(st, meta);
        };

        for (const item of sortedRefs) {
          next = recordRelease(next, item);
          if (item.kind === 'issue') {
            const crossedWall = action.toLaneIds.some((t) => t !== metaOf(next, 'issue', item.id)!.originLaneId);
            if (crossedWall && process.numberingMode === 'on_first_crossing') {
              const before = own(next.ops.issues, item.id)!.rev;
              next = assignNumberIfNeeded(next, item.id);
              const numberedRev = own(next.ops.issues, item.id)!.rev;
              if (numberedRev !== before) {
                // Numbering adds a revision with the released content plus its number: that revision
                // is what this release shows, and an approval of the released revision carries over.
                const nMeta = metaOf(next, 'issue', item.id)!;
                const releasesByLane: Record<string, ReleasedVersionRecord[]> = {};
                for (const [l, list] of Object.entries(nMeta.releasesByLane)) {
                  releasesByLane[l] = list.map((r) => (r.releaseId === relId && r.rev === before ? { ...r, rev: numberedRev } : r));
                }
                next = withMeta(next, {
                  ...nMeta,
                  releasesByLane,
                  approvedRev: nMeta.approvedRev === before ? numberedRev : nMeta.approvedRev,
                });
              }
            }
          }
        }
        for (const linked of bundle) next = recordRelease(next, linked);
        return { ok: true, state: next };
      };

      if (action.bulk) {
        // Bulk release: each item succeeds or fails independently, reporting per-item results with one batchId.
        let current = state;
        const itemResults: BulkReleaseItemResult[] = [];
        for (const entry of action.items) {
          const ref = resolveItemRef(current, entry);
          const res = releaseOne(current, [ref]);
          if (res.ok) {
            current = res.state;
            itemResults.push({ item: ref, ok: true });
          } else {
            itemResults.push({ item: ref, ok: false, reason: res.error });
          }
        }
        return {
          ok: itemResults.some((r) => r.ok),
          state: current,
          batchId,
          itemResults,
          error: itemResults.every((r) => !r.ok) ? itemResults[0]?.reason : undefined,
        };
      }

      const refs = action.items.map((e) => resolveItemRef(state, e));
      const res = releaseOne(state, refs);
      return res.ok ? { ok: true, state: res.state, batchId } : { ok: false, state, error: res.error };
    }

    case 'withdraw': {
      const denied = checkDecision(
        authorizeAction(
          { type: 'release.withdraw', itemKind: action.kind, itemId: action.id, laneIds: action.laneIds },
          policyCtx(state),
        ),
        state,
      );
      if (denied) return denied;
      let meta = metaOf(state, action.kind, action.id)!;
      const withdrawnInLanes = [...new Set([...(meta.withdrawnInLanes ?? []), ...action.laneIds])];
      const releasesByLane: Record<string, ReleasedVersionRecord[]> = {};
      for (const [l, list] of Object.entries(meta.releasesByLane)) releasesByLane[l] = [...list];
      for (const targetLane of action.laneIds) {
        // The withdrawal names the revision the lane last received (authorization requires one), so it
        // can never point a lane at a revision it was not given.
        const lastReleased = activeReleases(meta, targetLane).at(-1)!.rev;
        const list = releasesByLane[targetLane] ?? [];
        list.push({
          releaseId: `withdraw_${nextOpId()}`,
          rev: lastReleased,
          fromLaneId: laneId!,
          gateId: null,
          at: now,
          by: actor!,
          withdrawn: true,
        });
        releasesByLane[targetLane] = list;
      }
      // One history entry per lane, naming the revision that lane had, so no lane learns of another's.
      const history: ItemHistoryEntry[] = [...meta.history];
      for (const targetLane of new Set(action.laneIds)) {
        history.push({
          at: now,
          actor: actor!,
          laneId: laneId!,
          action: 'withdraw',
          rev: activeReleases(meta, targetLane).at(-1)!.rev,
          visibleToLaneIds: [...new Set([laneId!, targetLane])],
        });
      }
      meta = { ...meta, checkingState: 'withdrawn', withdrawnInLanes, releasesByLane, history };
      return { ok: true, state: withMeta(state, meta) };
    }

    case 'respond': {
      const op = makeOp('response.create', action.id, {
        parent: action.parent,
        kind: action.kind ?? 'formal',
        body: action.body,
      });
      const denied = checkDecision(authorizeOp(op, policyCtx(state)), state);
      if (denied) return denied;

      const applied = applyOp(state.ops, op, applyCtx());
      if (!applied.ok) return { ok: false, state, error: applied.rejection };

      const record = own(applied.state.responses, action.id)!;
      const laneCfg = process.lanes.find((l) => l.id === laneId!);
      const draftVis = laneCfg?.defaultDraftVisibility ?? process.defaultDraftVisibility;
      const releasesByLane: Record<string, ReleasedVersionRecord[]> = process.autoReleaseOnCreate
        ? { [laneId!]: [{ releaseId: `auto_${action.id}`, rev: record.rev, fromLaneId: laneId!, gateId: null, at: now, by: actor! }] }
        : {};
      const meta: ItemMeta = {
        kind: 'response',
        id: action.id,
        scopeId: process.id,
        originLaneId: laneId!,
        owner: actor!,
        ownerGroupIds,
        draftVisibility: draftVis,
        checkingState: process.autoReleaseOnCreate ? 'released' : 'draft',
        assignedCheckers: [],
        releasesByLane,
        latestRev: record.rev,
        history: [
          {
            at: now,
            actor: actor!,
            laneId: laneId!,
            action: 'create',
            rev: record.rev,
            visibleToLaneIds: [laneId!],
          },
        ],
      };

      let next: PolicyState = withMeta(
        { ...state, ops: applied.state, versions: withSnapshot(state.versions, 'response', action.id, record.rev, record) },
        meta,
      );

      // Track responder on parent issue so `closerNotResponder` can enforce it.
      if (action.parent.kind === 'issue') {
        const parentMeta = metaOf(next, 'issue', action.parent.id);
        if (parentMeta) {
          const responders = [...new Set([...(parentMeta.responderUserIds ?? []), actor!.userId])];
          next = withMeta(next, { ...parentMeta, responderUserIds: responders });
        }
      }
      return { ok: true, state: next };
    }

    case 'transitionStatus': {
      const currentLaneStatus = laneId ? own(own(state.ops.laneStatus, action.issueId), laneId)?.status ?? null : null;
      const from = action.from !== undefined ? action.from : currentLaneStatus;
      const eventId = action.id ?? `se_${nextOpId()}`;
      const op = makeOp('status.transition', eventId, {
        issueId: action.issueId,
        from,
        to: action.to,
        note: action.note ?? null,
        revisionSeenId: action.revisionSeenId ?? null,
      });
      const denied = checkDecision(authorizeOp(op, policyCtx(state)), state);
      if (denied) return denied;

      const applied = applyOp(state.ops, op, applyCtx());
      if (!applied.ok) return { ok: false, state, error: applied.rejection };

      const event = own(applied.state.statusEvents, eventId)!;
      const laneCfg = process.lanes.find((l) => l.id === laneId!);
      const draftVis = laneCfg?.defaultDraftVisibility ?? process.defaultDraftVisibility;
      const releasesByLane: Record<string, ReleasedVersionRecord[]> = process.autoReleaseOnCreate
        ? { [laneId!]: [{ releaseId: `auto_${eventId}`, rev: 1, fromLaneId: laneId!, gateId: null, at: now, by: actor! }] }
        : {};
      const eventMeta: ItemMeta = {
        kind: 'statusEvent',
        id: eventId,
        scopeId: process.id,
        originLaneId: laneId!,
        owner: actor!,
        ownerGroupIds,
        draftVisibility: draftVis,
        checkingState: process.autoReleaseOnCreate ? 'released' : 'draft',
        assignedCheckers: [],
        releasesByLane,
        latestRev: 1,
        history: [
          {
            at: now,
            actor: actor!,
            laneId: laneId!,
            action: 'status',
            rev: 1,
            visibleToLaneIds: [laneId!],
          },
        ],
      };

      let next: PolicyState = withMeta(
        { ...state, ops: applied.state, versions: withSnapshot(state.versions, 'statusEvent', eventId, 1, event) },
        eventMeta,
      );
      const issueMeta = metaOf(next, 'issue', action.issueId);
      if (issueMeta) {
        next = withMeta(
          next,
          appendHistory(issueMeta, {
            at: now,
            actor: actor!,
            laneId: laneId!,
            action: 'status',
            rev: issueMeta.latestRev,
            note: `${from ?? 'none'} -> ${action.to}`,
            visibleToLaneIds: [laneId!],
          }),
        );
      }
      return { ok: true, state: next };
    }

    case 'carryOpenToRevision': {
      const denied = checkDecision(authorizeAction({ type: 'revisions.manage' }, policyCtx(state)), state);
      if (denied) return denied;

      const member = findActiveMember(project, actorUserId)!;
      let next = state;
      for (const issue of Object.values(state.ops.issues)) {
        if (issue.deleted) continue;
        const issueMeta = metaOf(next, 'issue', issue.id);
        if (!issueMeta || issueMeta.scopeId !== process.id) continue;
        // Only issues the actor can see are carried, judged by the status in the lane they see it through.
        const issueVis = visibleVersionForMember(member, issueMeta, project, process);
        if (!issueVis) continue;
        const laneStatus = own(own(next.ops.laneStatus, issue.id), issueVis.viaLaneId)?.status ?? issueMeta.initialStatus;
        const def = laneStatus ? statusDef(project.statuses, laneStatus) : undefined;
        if (def && def.category !== 'open') continue;

        for (const markupId of issue.markupIds) {
          const mMeta = metaOf(next, 'markup', markupId);
          if (!mMeta || !visibleVersionForMember(member, mMeta, project, process)) continue;
          const origPlacement = Object.values(next.ops.placements).find((p) => {
            if (p.markupId !== markupId) return false;
            const m = metaOf(next, 'placement', p.id);
            return m !== undefined && visibleVersionForMember(member, m, project, process) !== null;
          });
          if (!origPlacement) continue;
          const newPlacementId = `${markupId}_p_${action.revisionId}`;
          const pOp = makeOp('placement.create', newPlacementId, {
            markupId,
            revisionId: action.revisionId,
            pageId: action.pageId ?? `${action.revisionId}_p1`,
            geometry: origPlacement.geometry,
            method: 'aligned',
            confidence: 0.95,
            state: 'suggested',
          });
          const pApplied = applyOp(next.ops, pOp, applyCtx());
          if (!pApplied.ok) continue;
          const pRec = own(pApplied.state.placements, newPlacementId)!;
          // Fresh metadata on the placement's own revisions: each lane the markup is currently released
          // to gets the new placement's revision, and nothing else carries over.
          const releasesByLane: Record<string, ReleasedVersionRecord[]> = {};
          for (const l of Object.keys(mMeta.releasesByLane)) {
            if (activeReleases(mMeta, l).length === 0) continue;
            releasesByLane[l] = [
              { releaseId: `carry_${newPlacementId}`, rev: pRec.rev, fromLaneId: laneId!, gateId: null, at: now, by: actor! },
            ];
          }
          const pMeta: ItemMeta = {
            kind: 'placement',
            id: newPlacementId,
            scopeId: process.id,
            originLaneId: mMeta.originLaneId,
            owner: mMeta.owner,
            ...(mMeta.ownerGroupIds ? { ownerGroupIds: mMeta.ownerGroupIds } : {}),
            draftVisibility: mMeta.draftVisibility,
            checkingState: mMeta.checkingState,
            assignedCheckers: mMeta.assignedCheckers,
            releasesByLane,
            latestRev: pRec.rev,
            history: [
              { at: now, actor: actor!, laneId: laneId!, action: 'create', rev: pRec.rev, visibleToLaneIds: [laneId!] },
            ],
          };
          next = withMeta(
            { ...next, ops: pApplied.state, versions: withSnapshot(next.versions, 'placement', newPlacementId, pRec.rev, pRec) },
            pMeta,
          );
        }
      }
      return { ok: true, state: next };
    }

    case 'lockItem': {
      const denied = checkDecision(
        authorizeAction({ type: 'record.lock', itemKind: action.kind, itemId: action.id, locked: action.locked }, policyCtx(state)),
        state,
      );
      if (denied) return denied;
      const meta = metaOf(state, action.kind, action.id)!;
      return { ok: true, state: withMeta(state, { ...meta, locked: action.locked }) };
    }

    case 'rawOp': {
      const denied = checkDecision(authorizeOp(action.op, policyCtx(state)), state);
      if (denied) return denied;
      const applied = applyOp(state.ops, action.op, applyCtx());
      if (!applied.ok) return { ok: false, state, error: applied.rejection };
      return { ok: true, state: { ...state, ops: applied.state } };
    }
  }
}

// --- Declarative Scenario Script Format & Runner ---

export interface ExpectedIssueState {
  rev?: number;
  number?: number | null;
  title?: string;
  checked?: boolean;
  status?: string | null;
  statusRevisionSeenId?: string | null;
  sharedStatus?: string | null;
  visibility?: 'draft' | 'internal' | 'released';
  amended?: boolean;
  withdrawn?: boolean;
  ownerUserId?: string;
  checkingState?: CheckingState;
  returnNote?: string | null;
  overrideLabel?: string | null;
  /** Assert which revisions have a placement for this issue's linked markups. */
  placedOnRevisions?: readonly string[];
  /** Assert substrings present/absent in the visible history of this issue. */
  historyContains?: readonly string[];
  historyExcludes?: readonly string[];
}

export interface ExpectedResponseState {
  body?: string;
  ownerUserId?: string;
  visibility?: 'draft' | 'internal' | 'released';
}

export interface ExpectedView {
  issues?: Readonly<Record<string, 'hidden' | ExpectedIssueState>>;
  responses?: Readonly<Record<string, 'hidden' | ExpectedResponseState>>;
  counts?: Partial<ProjectedView['counts']>;
  /** Assert presence user ids visible to this viewer. */
  presence?: readonly string[];
  /** Assert that none of these strings appear anywhere in the serialized view. */
  canaryAbsent?: readonly string[];
}

export interface ScenarioStep {
  name?: string;
  actor: string;
  do: ScenarioAction;
  /** Expected views keyed by userId (or `lane:<laneId>` for a lane perspective). */
  expect?: Readonly<Record<string, ExpectedView>>;
  /** When the step must be refused, the expected error code (`'not_found'`, `'forbidden'`, etc.). */
  rejects?: string;
  /**
   * When testing error uniformity on a hidden entity, pass a raw action targeting a random nonexistent
   * entity id and assert the two rejections are byte-identical (after normalizing the probed id).
   */
  uniformityProbe?: ScenarioAction;
}

export interface ScenarioScript {
  id: string;
  name: string;
  project: ProjectConfig;
  process: ProcessConfig;
  presentUserIds?: readonly string[];
  steps: readonly ScenarioStep[];
}

export interface ScenarioFailure {
  stepIndex: number;
  stepName: string;
  message: string;
}

export interface ScenarioRunResult {
  ok: boolean;
  scenarioId: string;
  stepsRun: number;
  failures: ScenarioFailure[];
  finalState: PolicyState;
}

function getViewForTarget(
  target: string,
  project: ProjectConfig,
  process: ProcessConfig,
  state: PolicyState,
): ProjectedView {
  if (target.startsWith('lane:')) {
    return viewAsPerspective({ laneId: target.slice('lane:'.length) }, project, process, state);
  }
  return viewAs(target, project, process, state);
}

function checkExpectedView(
  target: string,
  view: ProjectedView,
  expected: ExpectedView,
  stepIndex: number,
  stepName: string,
  failures: ScenarioFailure[],
): void {
  const fail = (msg: string): void => {
    failures.push({ stepIndex, stepName, message: `[${target}] ${msg}` });
  };

  if (expected.issues) {
    for (const [id, spec] of Object.entries(expected.issues)) {
      const actual = own(view.issues, id);
      if (spec === 'hidden') {
        if (actual !== undefined) fail(`expected issue "${id}" to be hidden, but saw rev ${actual.rev}`);
        continue;
      }
      if (!actual) {
        fail(`expected issue "${id}" to be visible, but it was hidden`);
        continue;
      }
      if (spec.rev !== undefined && actual.rev !== spec.rev) fail(`issue "${id}" rev: expected ${spec.rev}, got ${actual.rev}`);
      if (spec.number !== undefined && actual.number !== spec.number) fail(`issue "${id}" number: expected ${spec.number}, got ${actual.number}`);
      if (spec.title !== undefined && actual.title !== spec.title) fail(`issue "${id}" title: expected "${spec.title}", got "${actual.title}"`);
      if (spec.checked !== undefined && actual.checked !== spec.checked) fail(`issue "${id}" checked: expected ${spec.checked}, got ${actual.checked}`);
      if (spec.status !== undefined && actual.status !== spec.status) fail(`issue "${id}" status: expected "${spec.status}", got "${actual.status}"`);
      if (spec.statusRevisionSeenId !== undefined && actual.statusRevisionSeenId !== spec.statusRevisionSeenId) {
        fail(`issue "${id}" revisionSeenId: expected "${spec.statusRevisionSeenId}", got "${actual.statusRevisionSeenId}"`);
      }
      if (spec.sharedStatus !== undefined && actual.sharedStatus !== spec.sharedStatus) {
        fail(`issue "${id}" sharedStatus: expected "${spec.sharedStatus}", got "${actual.sharedStatus}"`);
      }
      if (spec.visibility !== undefined && actual.visibility !== spec.visibility) {
        fail(`issue "${id}" visibility: expected "${spec.visibility}", got "${actual.visibility}"`);
      }
      if (spec.amended !== undefined && actual.amended !== spec.amended) {
        fail(`issue "${id}" amended: expected ${spec.amended}, got ${actual.amended}`);
      }
      if (spec.withdrawn !== undefined && actual.withdrawn !== spec.withdrawn) {
        fail(`issue "${id}" withdrawn: expected ${spec.withdrawn}, got ${actual.withdrawn}`);
      }
      if (spec.ownerUserId !== undefined && actual.owner.userId !== spec.ownerUserId) {
        fail(`issue "${id}" owner: expected "${spec.ownerUserId}", got "${actual.owner.userId}"`);
      }
      if (spec.checkingState !== undefined && actual.checkingState !== spec.checkingState) {
        fail(`issue "${id}" checkingState: expected "${spec.checkingState}", got "${actual.checkingState}"`);
      }
      if (spec.returnNote !== undefined && actual.returnNote !== spec.returnNote) {
        fail(`issue "${id}" returnNote: expected "${spec.returnNote}", got "${actual.returnNote}"`);
      }
      if (spec.overrideLabel !== undefined && actual.overrideLabel !== spec.overrideLabel) {
        fail(`issue "${id}" overrideLabel: expected "${spec.overrideLabel}", got "${actual.overrideLabel}"`);
      }
      if (spec.placedOnRevisions) {
        const actualRevs = [
          ...new Set(
            Object.values(view.placements)
              .filter((p) => actual.markupIds.includes(p.markupId))
              .map((p) => p.revisionId),
          ),
        ].sort();
        const wantRevs = [...spec.placedOnRevisions].sort();
        if (JSON.stringify(actualRevs) !== JSON.stringify(wantRevs)) {
          fail(`issue "${id}" placements: expected revisions ${JSON.stringify(wantRevs)}, got ${JSON.stringify(actualRevs)}`);
        }
      }
      if (spec.historyContains || spec.historyExcludes) {
        const histJson = JSON.stringify(actual.history);
        for (const sub of spec.historyContains ?? []) {
          if (!histJson.includes(sub)) fail(`issue "${id}" history missing "${sub}"`);
        }
        for (const sub of spec.historyExcludes ?? []) {
          if (histJson.includes(sub)) fail(`issue "${id}" history leaked "${sub}"`);
        }
      }
    }
  }

  if (expected.responses) {
    for (const [id, spec] of Object.entries(expected.responses)) {
      const actual = own(view.responses, id);
      if (spec === 'hidden') {
        if (actual !== undefined) fail(`expected response "${id}" to be hidden, but it was visible`);
        continue;
      }
      if (!actual) {
        fail(`expected response "${id}" to be visible, but it was hidden`);
        continue;
      }
      if (spec.body !== undefined && actual.body !== spec.body) fail(`response "${id}" body mismatch`);
      if (spec.ownerUserId !== undefined && actual.owner.userId !== spec.ownerUserId) fail(`response "${id}" owner mismatch`);
      if (spec.visibility !== undefined && actual.visibility !== spec.visibility) fail(`response "${id}" visibility mismatch`);
    }
  }

  if (expected.counts) {
    for (const [key, val] of Object.entries(expected.counts)) {
      const actualVal = view.counts[key as keyof ProjectedView['counts']];
      if (actualVal !== val) fail(`counts.${key}: expected ${val}, got ${actualVal}`);
    }
  }

  if (expected.presence) {
    const got = [...view.presenceUserIds].sort();
    const want = [...expected.presence].sort();
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      fail(`presence: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
    }
  }

  if (expected.canaryAbsent) {
    const leaked = scanViewForCanaries(view, expected.canaryAbsent);
    if (leaked.length > 0) {
      fail(`canary leak detected: ${leaked.join(', ')}`);
    }
  }
}

/** Runs a declarative scenario script step by step and checks every expectation and canary scan. */
export function runScenario(script: ScenarioScript): ScenarioRunResult {
  let state = createPolicyState(script.presentUserIds ?? []);
  const failures: ScenarioFailure[] = [];

  for (let i = 0; i < script.steps.length; i++) {
    const step = script.steps[i]!;
    const stepName = step.name ?? `step ${i + 1}`;
    const exec: ExecuteContext = {
      project: script.project,
      process: script.process,
      now: 1000 * (i + 1),
      opSeq: i * 100,
    };

    const result = executeAction(state, step.actor, step.do, exec);

    if (step.rejects !== undefined) {
      if (result.ok) {
        failures.push({ stepIndex: i, stepName, message: `expected rejection "${step.rejects}", but step succeeded` });
      } else {
        const code = result.error && 'code' in result.error ? result.error.code : 'unknown';
        if (code !== step.rejects) {
          failures.push({ stepIndex: i, stepName, message: `expected rejection "${step.rejects}", got "${code}" (${JSON.stringify(result.error)})` });
        }
        if (step.uniformityProbe) {
          const probe = executeAction(state, step.actor, step.uniformityProbe, { ...exec, opSeq: exec.opSeq + 50 });
          if (probe.ok) {
            failures.push({ stepIndex: i, stepName, message: 'uniformity probe unexpectedly succeeded' });
          } else {
            const norm = (err: unknown): string =>
              JSON.stringify(err, (k, v) => (k === 'id' ? '<id>' : v));
            if (norm(result.error) !== norm(probe.error)) {
              failures.push({
                stepIndex: i,
                stepName,
                message: `error uniformity mismatch: hidden=${JSON.stringify(result.error)} vs missing=${JSON.stringify(probe.error)}`,
              });
            }
          }
        }
      }
    } else if (!result.ok) {
      failures.push({ stepIndex: i, stepName, message: `unexpected rejection: ${JSON.stringify(result.error)}` });
    } else {
      state = result.state;
    }

    if (step.expect) {
      for (const [target, expectedView] of Object.entries(step.expect)) {
        const view = getViewForTarget(target, script.project, script.process, state);
        checkExpectedView(target, view, expectedView, i, stepName, failures);
      }
    }
  }

  return {
    ok: failures.length === 0,
    scenarioId: script.id,
    stepsRun: script.steps.length,
    failures,
    finalState: state,
  };
}
