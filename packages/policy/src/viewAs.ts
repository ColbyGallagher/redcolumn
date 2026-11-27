import {
  statusDef,
  type Actor,
  type Issue,
  type MarkupRecord,
  type Placement,
  type Response,
  type StatusEvent,
} from '@nb/ops';
import { findActiveMember } from './grants.ts';
import { canMemberAccessDocumentSet, memberLaneIds, metaOf, visibleVersionForMember } from './visibility.ts';
import {
  itemKey,
  own,
  type CheckingState,
  type ItemHistoryEntry,
  type ItemMeta,
  type PolicyState,
  type ProcessConfig,
  type ProjectConfig,
  type ProjectMember,
} from './types.ts';

// "View as" projection: computes the exact, leak-free view of a review or session for a given user
// or synthetic lane/party perspective. Used for client previews, audience-scoped exports and tests.

export interface ProjectedIssue {
  id: string;
  rev: number;
  number: number | null;
  title: string;
  checked: boolean;
  owner: Actor;
  markupIds: readonly string[];
  deleted: boolean;
  visibility: 'draft' | 'internal' | 'released';
  viaLaneId: string;
  amended: boolean;
  withdrawn: boolean;
  /** Current status in the viewer's lane. */
  status: string | null;
  /** The revision recorded on the status event that set `status`, if any. */
  statusRevisionSeenId: string | null;
  /** Last status shared across a wall (lets the UI show which state is shared vs internal). */
  sharedStatus: string | null;
  /** Checking workflow state — omitted for downstream lanes outside the check. */
  checkingState?: CheckingState;
  /** Return note — visible only to the originating and checking lanes. */
  returnNote?: string | null;
  /** Override marker — visible only to the originating and checking lanes. */
  overrideLabel?: string | null;
  /** History entries visible to this viewer (draft edits and hidden editor names are stripped). */
  history: readonly ItemHistoryEntry[];
}

export interface ProjectedMarkup {
  id: string;
  rev: number;
  type: MarkupRecord['type'];
  content: MarkupRecord['content'];
  owner: Actor;
  deleted: boolean;
  visibility: 'draft' | 'internal' | 'released';
  amended: boolean;
  withdrawn: boolean;
}

export interface ProjectedPlacement {
  id: string;
  rev: number;
  markupId: string;
  revisionId: string;
  pageId: string;
  geometry: Placement['geometry'];
  method: Placement['method'];
  confidence: Placement['confidence'];
  state: Placement['state'];
  deleted: boolean;
  visibility: 'draft' | 'internal' | 'released';
}

export interface ProjectedResponse {
  id: string;
  rev: number;
  parent: Response['parent'];
  inReplyTo: string | null;
  answersRev: number | null;
  kind: Response['kind'];
  body: string;
  owner: Actor;
  deleted: boolean;
  visibility: 'draft' | 'internal' | 'released';
  amended: boolean;
  withdrawn: boolean;
}

export interface ProjectedStatusEvent {
  id: string;
  issueId: string;
  laneId: string;
  from: string | null;
  to: string;
  note: string | null;
  revisionSeenId: string | null;
  actor: Actor;
  at: number;
}

export interface ViewCounts {
  totalIssues: number;
  openIssues: number;
  closedIssues: number;
  voidIssues: number;
  totalMarkups: number;
  totalResponses: number;
}

export interface ProjectedView {
  viewerId: string;
  laneIds: readonly string[];
  issues: Readonly<Record<string, ProjectedIssue>>;
  markups: Readonly<Record<string, ProjectedMarkup>>;
  placements: Readonly<Record<string, ProjectedPlacement>>;
  responses: Readonly<Record<string, ProjectedResponse>>;
  statusEvents: readonly ProjectedStatusEvent[];
  counts: ViewCounts;
  /** Online user ids visible in the viewer's own lane(s). Users in other lanes never appear. */
  presenceUserIds: readonly string[];
}

export interface ViewPerspective {
  /** Synthetic label for this preview perspective. */
  id?: string;
  laneId: string;
  partyId?: string | null;
  groupIds?: readonly string[];
}

function emptyView(viewerId: string, laneIds: readonly string[] = []): ProjectedView {
  return {
    viewerId,
    laneIds,
    issues: {},
    markups: {},
    placements: {},
    responses: {},
    statusEvents: [],
    counts: { totalIssues: 0, openIssues: 0, closedIssues: 0, voidIssues: 0, totalMarkups: 0, totalResponses: 0 },
    presenceUserIds: [],
  };
}

/**
 * The stored snapshot of an item at `rev`. There is no fallback to the live record, which may be a
 * newer, hidden revision: an item whose visible revision has no snapshot is left out of the view.
 */
function snapshotAt<T>(state: PolicyState, kind: ItemMeta['kind'], id: string, rev: number): T | undefined {
  const byRev = own(state.versions, itemKey(kind, id));
  if (byRev && Object.hasOwn(byRev, rev)) return byRev[rev] as T;
  return undefined;
}

function filterHistory(
  member: ProjectMember,
  lanes: readonly string[],
  meta: ItemMeta,
): ItemHistoryEntry[] {
  const isAuthorOrChecker =
    member.userId === meta.owner.userId ||
    meta.assignedCheckers.some((c) => (c.kind === 'user' ? member.userId === c.id : member.groupIds.includes(c.id)));
  return meta.history.filter((entry) => {
    if (entry.privateDraftOnly && !isAuthorOrChecker) return false;
    return entry.visibleToLaneIds.some((l) => lanes.includes(l));
  });
}

function resolveSharedStatus(
  issueId: string,
  meta: ItemMeta,
  viewerLaneId: string,
  state: PolicyState,
): string | null {
  // Check if any statusEvent for this issue has been released across a wall (to or from viewerLaneId).
  const releasedStatusEvents: { at: number; status: string }[] = [];
  for (const event of Object.values(state.ops.statusEvents)) {
    if (event.issueId !== issueId) continue;
    const eventMeta = metaOf(state, 'statusEvent', event.id);
    if (!eventMeta) continue;
    // Was this status event released TO viewerLaneId, or FROM viewerLaneId to another lane?
    const toViewer = own(eventMeta.releasesByLane, viewerLaneId) ?? [];
    for (const rel of toViewer) {
      releasedStatusEvents.push({ at: rel.at, status: event.to });
    }
    if (event.laneId === viewerLaneId) {
      for (const [targetLane, rels] of Object.entries(eventMeta.releasesByLane)) {
        if (targetLane === viewerLaneId) continue;
        for (const rel of rels) releasedStatusEvents.push({ at: rel.at, status: event.to });
      }
    }
  }
  if (releasedStatusEvents.length > 0) {
    releasedStatusEvents.sort((a, b) => a.at - b.at);
    return releasedStatusEvents[releasedStatusEvents.length - 1]!.status;
  }
  // If the issue itself was released across a wall, its initial status is the shared baseline.
  const crossedWall = Object.entries(meta.releasesByLane).some(
    ([laneId, rels]) => laneId !== meta.originLaneId && rels.length > 0,
  );
  if (crossedWall) return meta.initialStatus ?? null;
  // Single-lane auto-released item: shared status equals the lane status.
  const ownReleased = (own(meta.releasesByLane, viewerLaneId)?.length ?? 0) > 0;
  if (ownReleased) {
    return own(own(state.ops.laneStatus, issueId), viewerLaneId)?.status ?? meta.initialStatus ?? null;
  }
  return null;
}

function projectForMember(
  member: ProjectMember,
  lanes: readonly string[],
  project: ProjectConfig,
  process: ProcessConfig,
  state: PolicyState,
): ProjectedView {
  if (lanes.length === 0 || !canMemberAccessDocumentSet(member, project, process, lanes)) {
    return emptyView(member.userId, []);
  }

  const markups: Record<string, ProjectedMarkup> = {};
  for (const [id, current] of Object.entries(state.ops.markups)) {
    const meta = metaOf(state, 'markup', id);
    if (!meta) continue;
    const vis = visibleVersionForMember(member, meta, project, process);
    if (!vis) continue;
    const snap = snapshotAt<MarkupRecord>(state, 'markup', id, vis.rev);
    if (!snap) continue;
    markups[id] = {
      id: snap.id,
      rev: vis.rev,
      type: snap.type,
      content: snap.content,
      owner: meta.owner,
      deleted: snap.deleted,
      visibility: vis.visibility,
      amended: vis.amended,
      withdrawn: vis.withdrawn,
    };
  }

  const placements: Record<string, ProjectedPlacement> = {};
  for (const [id, current] of Object.entries(state.ops.placements)) {
    const meta = metaOf(state, 'placement', id);
    if (!meta) continue;
    // A placement is never visible if its parent markup is hidden.
    if (!Object.hasOwn(markups, current.markupId)) continue;
    const vis = visibleVersionForMember(member, meta, project, process);
    if (!vis) continue;
    const snap = snapshotAt<Placement>(state, 'placement', id, vis.rev);
    if (!snap) continue;
    placements[id] = {
      id: snap.id,
      rev: vis.rev,
      markupId: snap.markupId,
      revisionId: snap.revisionId,
      pageId: snap.pageId,
      geometry: snap.geometry,
      method: snap.method,
      confidence: snap.confidence,
      state: snap.state,
      deleted: snap.deleted,
      visibility: vis.visibility,
    };
  }

  const issues: Record<string, ProjectedIssue> = {};
  let openIssues = 0;
  let closedIssues = 0;
  let voidIssues = 0;

  for (const [id, current] of Object.entries(state.ops.issues)) {
    const meta = metaOf(state, 'issue', id);
    if (!meta) continue;
    const vis = visibleVersionForMember(member, meta, project, process);
    if (!vis) continue;
    const snap = snapshotAt<Issue>(state, 'issue', id, vis.rev);
    if (!snap) continue;

    const laneEntry = own(own(state.ops.laneStatus, id), vis.viaLaneId);
    const status = laneEntry?.status ?? meta.initialStatus ?? null;
    const statusEvent = laneEntry?.eventId ? own(state.ops.statusEvents, laneEntry.eventId) : undefined;
    const statusRevisionSeenId = statusEvent?.revisionSeenId ?? null;
    const sharedStatus = resolveSharedStatus(id, meta, vis.viaLaneId, state);

    // Checking state, return notes and overrides are visible only to the originating lane and the
    // checking lane — never leaked to downstream lanes.
    const seesCheckingDetails =
      lanes.includes(meta.originLaneId) ||
      (meta.checkingLaneId !== undefined && meta.checkingLaneId !== null && lanes.includes(meta.checkingLaneId));

    const projected: ProjectedIssue = {
      id: snap.id,
      rev: vis.rev,
      // Issue number is project-wide once assigned (live `current.number` even if snapshot pre-dated numbering).
      number: current.number,
      title: snap.title,
      checked: snap.checked,
      owner: meta.owner,
      markupIds: snap.markupIds.filter((mid) => Object.hasOwn(markups, mid)),
      deleted: snap.deleted,
      visibility: vis.visibility,
      viaLaneId: vis.viaLaneId,
      amended: vis.amended,
      withdrawn: vis.withdrawn,
      status,
      statusRevisionSeenId,
      sharedStatus,
      history: filterHistory(member, lanes, meta),
    };
    if (seesCheckingDetails) {
      projected.checkingState = meta.checkingState;
      if (meta.returnNote !== undefined) projected.returnNote = meta.returnNote;
      if (meta.overridden) projected.overrideLabel = meta.overridden.label;
    }

    issues[id] = projected;
    if (!snap.deleted && !vis.withdrawn) {
      const def = status ? statusDef(project.statuses, status) : undefined;
      if (def?.category === 'closed') closedIssues++;
      else if (def?.category === 'void') voidIssues++;
      else openIssues++;
    }
  }

  const responses: Record<string, ProjectedResponse> = {};
  for (const [id, current] of Object.entries(state.ops.responses)) {
    const meta = metaOf(state, 'response', id);
    if (!meta) continue;
    // Parent must be visible to the viewer.
    const parentVisible =
      current.parent.kind === 'issue'
        ? Object.hasOwn(issues, current.parent.id)
        : Object.hasOwn(markups, current.parent.id);
    if (!parentVisible) continue;
    const vis = visibleVersionForMember(member, meta, project, process);
    if (!vis) continue;
    const snap = snapshotAt<Response>(state, 'response', id, vis.rev);
    if (!snap) continue;
    responses[id] = {
      id: snap.id,
      rev: vis.rev,
      parent: snap.parent,
      inReplyTo: snap.inReplyTo,
      answersRev: snap.answersRev,
      kind: snap.kind,
      body: snap.body,
      owner: meta.owner,
      deleted: snap.deleted,
      visibility: vis.visibility,
      amended: vis.amended,
      withdrawn: vis.withdrawn,
    };
  }

  const statusEvents: ProjectedStatusEvent[] = [];
  for (const event of Object.values(state.ops.statusEvents)) {
    if (!Object.hasOwn(issues, event.issueId)) continue;
    const meta = metaOf(state, 'statusEvent', event.id);
    if (!meta) continue;
    const vis = visibleVersionForMember(member, meta, project, process);
    if (!vis) continue;
    statusEvents.push({
      id: event.id,
      issueId: event.issueId,
      laneId: event.laneId,
      from: event.from,
      to: event.to,
      note: event.note,
      revisionSeenId: event.revisionSeenId,
      actor: event.actor,
      at: event.at,
    });
  }
  statusEvents.sort((a, b) => a.at - b.at);

  // Presence isolation: people in different lanes never see each other in a shared session.
  const presenceUserIds = (state.presentUserIds ?? []).filter((uid) => {
    const other = findActiveMember(project, uid);
    if (!other) return false;
    const otherLanes = memberLaneIds(other, process);
    return otherLanes.some((l) => lanes.includes(l));
  });

  return {
    viewerId: member.userId,
    laneIds: [...lanes],
    issues,
    markups,
    placements,
    responses,
    statusEvents,
    counts: {
      totalIssues: Object.values(issues).filter((i) => !i.deleted && !i.withdrawn).length,
      openIssues,
      closedIssues,
      voidIssues,
      totalMarkups: Object.values(markups).filter((m) => !m.deleted && !m.withdrawn).length,
      totalResponses: Object.values(responses).filter((r) => !r.deleted && !r.withdrawn).length,
    },
    presenceUserIds,
  };
}

/** Projects the exact view that active user `userId` sees in `process`. */
export function viewAs(
  userId: string,
  project: ProjectConfig,
  process: ProcessConfig,
  state: PolicyState,
): ProjectedView {
  const member = findActiveMember(project, userId);
  if (!member) return emptyView(userId);
  const lanes = memberLaneIds(member, process);
  return projectForMember(member, lanes, project, process, state);
}

/**
 * Projects a "view as" preview for a chosen lane (and optional party/groups) — useful in a
 * settings editor or when previewing an audience-scoped register export.
 */
export function viewAsPerspective(
  perspective: ViewPerspective,
  project: ProjectConfig,
  process: ProcessConfig,
  state: PolicyState,
): ProjectedView {
  const laneExists = process.lanes.some((l) => l.id === perspective.laneId);
  if (!laneExists) return emptyView(perspective.id ?? `lane:${perspective.laneId}`);
  const syntheticMember: ProjectMember = {
    userId: perspective.id ?? `perspective:${perspective.laneId}`,
    partyId: perspective.partyId ?? null,
    groupIds: perspective.groupIds ?? [],
    state: 'active',
  };
  return projectForMember(syntheticMember, [perspective.laneId], project, process, state);
}

/**
 * Scans a serialized `ProjectedView` for any forbidden canary strings (hidden text, hidden draft
 * wording, hidden editor names, hidden return notes, hidden IDs). Returns every canary that leaked.
 */
export function scanViewForCanaries(view: ProjectedView, canaries: readonly string[]): string[] {
  const serialized = JSON.stringify(view);
  return canaries.filter((canary) => canary.length > 0 && serialized.includes(canary));
}
