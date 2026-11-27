import { findActiveMember, matchesSubject } from './grants.ts';
import {
  itemKey,
  own,
  type AccessKind,
  type DraftAccessRef,
  type ItemAccessRow,
  type ItemAudiences,
  type ItemDraftAccessRow,
  type ItemMeta,
  type LaneConfig,
  type LaneMemberRow,
  type PartyVisibilityRow,
  type PolicyState,
  type ProcessConfig,
  type ProjectConfig,
  type ProjectMember,
} from './types.ts';

// Audience-based visibility: computes explicit access rows (per lane, per draft audience,
// and per party visibility matrix) and evaluates what each actor can see from those rows.
// No grant or role crosses a wall — only a release does.

/** Extracts `lane_members` rows for a process. */
export function compileLaneMembers(process: ProcessConfig): LaneMemberRow[] {
  const rows: LaneMemberRow[] = [];
  for (const lane of process.lanes) {
    for (const member of lane.members) {
      rows.push({ laneId: lane.id, member });
    }
  }
  return rows;
}

/** Returns the party ids that belong to `lane` (directly via party members or via member users/groups). */
export function partiesInLane(lane: LaneConfig, project: ProjectConfig): string[] {
  const partyIds = new Set<string>();
  for (const m of lane.members) {
    if (m.kind === 'party') {
      partyIds.add(m.id);
    } else if (m.kind === 'user') {
      const member = project.members.find((u) => u.userId === m.id);
      if (member?.partyId) partyIds.add(member.partyId);
    } else if (m.kind === 'group') {
      const group = project.groups.find((g) => g.id === m.id);
      if (group?.partyId) partyIds.add(group.partyId);
      for (const member of project.members) {
        if (member.groupIds.includes(m.id) && member.partyId) partyIds.add(member.partyId);
      }
    }
  }
  return [...partyIds];
}

/**
 * Compiles `party_visibility(lane_id, viewer_party, owner_party)` rows for all lanes in `process`.
 * Within a lane:
 * - `'open'` (default): every party in the lane sees every other party in the lane.
 * - `'separated'`: each party sees itself and `leadPartyId`; `leadPartyId` sees all parties in the lane.
 * - `'custom'`: explicit pairs plus self-visibility for every party in the lane.
 */
export function compilePartyVisibility(process: ProcessConfig, project: ProjectConfig): PartyVisibilityRow[] {
  const rows: PartyVisibilityRow[] = [];
  const seen = new Set<string>();
  const add = (laneId: string, viewerPartyId: string, ownerPartyId: string): void => {
    const key = `${laneId}\0${viewerPartyId}\0${ownerPartyId}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({ laneId, viewerPartyId, ownerPartyId });
  };

  for (const lane of process.lanes) {
    const laneParties = partiesInLane(lane, project);
    const config = lane.partyVisibility ?? { mode: 'open' as const };
    // Every party in the lane always sees its own firm's items.
    for (const p of laneParties) add(lane.id, p, p);

    if (config.mode === 'open') {
      for (const viewer of laneParties) {
        for (const owner of laneParties) add(lane.id, viewer, owner);
      }
    } else if (config.mode === 'separated') {
      const lead = config.leadPartyId ?? null;
      if (lead) {
        add(lane.id, lead, lead);
        for (const p of laneParties) {
          add(lane.id, lead, p);
          add(lane.id, p, lead);
        }
      }
    } else if (config.mode === 'custom') {
      for (const pair of config.pairs ?? []) {
        add(lane.id, pair.viewerPartyId, pair.ownerPartyId);
      }
    }
  }
  return rows;
}

/** Checks whether `viewerPartyId` may see an internal item owned by `ownerPartyId` inside `lane`. */
export function partyCanSeeInLane(
  lane: LaneConfig,
  project: ProjectConfig,
  viewerPartyId: string | null,
  ownerPartyId: string | null,
): boolean {
  if (!ownerPartyId || !viewerPartyId) return true;
  if (viewerPartyId === ownerPartyId) return true;
  const laneParties = partiesInLane(lane, project);
  // Items owned by a party outside this lane (e.g. a client item being checked inside a certifier lane)
  // are not hidden by this lane's internal subconsultant matrix.
  if (!laneParties.includes(ownerPartyId)) return true;

  const config = lane.partyVisibility ?? { mode: 'open' as const };
  if (config.mode === 'open') return true;
  if (config.mode === 'separated') {
    const lead = config.leadPartyId ?? null;
    if (!lead) return false;
    return viewerPartyId === lead || ownerPartyId === lead;
  }
  return (config.pairs ?? []).some((p) => p.viewerPartyId === viewerPartyId && p.ownerPartyId === ownerPartyId);
}

/** Returns the lane ids that `member` belongs to in `process`. */
export function memberLaneIds(member: ProjectMember, process: ProcessConfig): string[] {
  const lanes: string[] = [];
  for (const lane of process.lanes) {
    if (lane.members.some((ref) => matchesSubject(member, ref))) lanes.push(lane.id);
  }
  return lanes;
}

/** Returns the lane ids that `userId` belongs to in `process` (empty if not an active project member). */
export function actorLaneIds(userId: string, project: ProjectConfig, process: ProcessConfig): string[] {
  const member = findActiveMember(project, userId);
  if (!member) return [];
  return memberLaneIds(member, process);
}

/** Whether `member` has access to the document set that `process` belongs to (if any). */
export function canMemberAccessDocumentSet(
  member: ProjectMember,
  project: ProjectConfig,
  process: ProcessConfig,
  lanes: readonly string[],
): boolean {
  if (!process.documentSetId) return true;
  const docSet = (project.documentSets ?? []).find((ds) => ds.id === process.documentSetId);
  if (!docSet || !docSet.members) return true;
  return docSet.members.some((ref) => matchesSubject(member, ref, lanes));
}

/** Whether `userId` can access `process` at all (active member + document set + member of at least one lane). */
export function canSeeScope(userId: string, project: ProjectConfig, process: ProcessConfig): boolean {
  const member = findActiveMember(project, userId);
  if (!member) return false;
  const lanes = memberLaneIds(member, process);
  if (lanes.length === 0) return false;
  return canMemberAccessDocumentSet(member, project, process, lanes);
}

/**
 * Computes the explicit audience rows (`item_access` and `item_draft_access`) for an item across all
 * its versions. A server writes these rows at mutation time so queries and RLS filter directly on them.
 */
export function computeItemAudiences(meta: ItemMeta): ItemAudiences {
  const access: ItemAccessRow[] = [];
  const draftAccess: ItemDraftAccessRow[] = [];
  const seenAccess = new Set<string>();
  const seenDraft = new Set<string>();

  const pushAccess = (versionRev: number, laneId: string, kind: AccessKind, ownerPartyId: string | null): void => {
    const key = `${versionRev}\0${laneId}\0${kind}`;
    if (seenAccess.has(key)) return;
    seenAccess.add(key);
    access.push({
      itemKind: meta.kind,
      itemId: meta.id,
      versionRev,
      laneId,
      kind,
      ownerPartyId,
    });
  };

  const pushDraft = (versionRev: number, subject: DraftAccessRef): void => {
    const key = `${versionRev}\0${subject.kind}\0${subject.id}`;
    if (seenDraft.has(key)) return;
    seenDraft.add(key);
    draftAccess.push({
      itemKind: meta.kind,
      itemId: meta.id,
      versionRev,
      subject,
    });
  };

  const checkerEdits = meta.checkerEditedRevs ?? {};

  // 1. Origin lane & checker-lane versions (draft / internal).
  for (let rev = 1; rev <= meta.latestRev; rev++) {
    const checkerEdit = checkerEdits[rev];
    if (checkerEdit) {
      // Edited by a checker in another lane (e.g. certifier): internal to the checking lane.
      pushAccess(rev, checkerEdit.laneId, 'internal', null);
      if (checkerEdit.visibleToOriginator) {
        // Gate allows the originating lane to see the checker's edit.
        pushAccess(rev, meta.originLaneId, 'released', meta.owner.partyId);
      }
      continue;
    }

    if (meta.draftVisibility === 'lane') {
      pushAccess(rev, meta.originLaneId, 'internal', meta.owner.partyId);
    } else {
      // Private draft: visible only to author and assigned checkers until released (or made lane-shared).
      pushDraft(rev, { kind: 'user', id: meta.owner.userId });
      for (const checker of meta.assignedCheckers) {
        pushDraft(rev, checker);
      }
      // Once released from the origin lane, or auto-released to the origin lane, the released version is
      // visible to the origin lane too (still keeping unreleased later drafts private to author+checkers).
      const originReleases = own(meta.releasesByLane, meta.originLaneId) ?? [];
      if (originReleases.some((r) => r.rev === rev)) {
        pushAccess(rev, meta.originLaneId, 'released', meta.owner.partyId);
      }
    }
  }

  // 2. Released versions to target lanes (and same-lane releases).
  for (const [laneId, records] of Object.entries(meta.releasesByLane)) {
    for (const rel of records) {
      pushAccess(rel.rev, laneId, 'released', meta.owner.partyId);
    }
  }

  return { access, draftAccess };
}

export interface VisibleVersion {
  /** Highest record revision visible to this actor. */
  rev: number;
  /** How the actor sees this version. */
  visibility: 'draft' | 'internal' | 'released';
  /** The lane through which the actor sees this version. */
  viaLaneId: string;
  /** True when the actor received a newer release after an earlier released version. */
  amended: boolean;
  /** True when the item was withdrawn in the actor's lane. */
  withdrawn: boolean;
}

/**
 * Determines which version (if any) of `meta` is visible to `member` in `process`.
 * Evaluated strictly from the compiled audience rows + lane membership + party visibility matrix.
 */
export function visibleVersionForMember(
  member: ProjectMember,
  meta: ItemMeta,
  project: ProjectConfig,
  process: ProcessConfig,
): VisibleVersion | null {
  if (member.state !== 'active') return null;
  if (meta.scopeId !== process.id) return null;

  const lanes = memberLaneIds(member, process);
  if (lanes.length === 0) return null;
  if (!canMemberAccessDocumentSet(member, project, process, lanes)) return null;

  const { access, draftAccess } = computeItemAudiences(meta);
  const laneById = new Map<string, LaneConfig>(process.lanes.map((l) => [l.id, l]));

  let bestRev = 0;
  let bestVisibility: 'draft' | 'internal' | 'released' | null = null;
  let bestLaneId: string | null = null;

  const consider = (rev: number, visibility: 'draft' | 'internal' | 'released', laneId: string): void => {
    if (rev > bestRev) {
      bestRev = rev;
      bestVisibility = visibility;
      bestLaneId = laneId;
    } else if (rev === bestRev && bestVisibility !== null) {
      // Prefer released > internal > draft when the same rev is reachable in multiple ways.
      const rank = { draft: 1, internal: 2, released: 3 } as const;
      if (rank[visibility] > rank[bestVisibility]) {
        bestVisibility = visibility;
        bestLaneId = laneId;
      }
    }
  };

  // Check draft access rows (author + assigned checkers in the originating lane).
  if (lanes.includes(meta.originLaneId)) {
    for (const row of draftAccess) {
      const matched =
        row.subject.kind === 'user'
          ? member.userId === row.subject.id
          : member.groupIds.includes(row.subject.id);
      if (matched) consider(row.versionRev, 'draft', meta.originLaneId);
    }
  }

  // Check lane access rows (internal subject to party matrix; released open to receiving lane).
  for (const row of access) {
    if (!lanes.includes(row.laneId)) continue;
    const lane = laneById.get(row.laneId);
    if (!lane) continue;
    if (row.kind === 'internal') {
      if (!partyCanSeeInLane(lane, project, member.partyId, row.ownerPartyId)) continue;
      consider(row.versionRev, 'internal', row.laneId);
    } else {
      consider(row.versionRev, 'released', row.laneId);
    }
  }

  if (bestRev === 0 || bestVisibility === null || bestLaneId === null) return null;

  const laneReleases = own(meta.releasesByLane, bestLaneId) ?? [];
  const distinctReleasedRevs = new Set(laneReleases.filter((r) => !r.withdrawn).map((r) => r.rev));
  const amended = bestVisibility === 'released' && distinctReleasedRevs.size > 1;
  const withdrawn = (meta.withdrawnInLanes ?? []).includes(bestLaneId) ||
    (laneReleases.length > 0 && laneReleases[laneReleases.length - 1]?.withdrawn === true);

  return { rev: bestRev, visibility: bestVisibility, viaLaneId: bestLaneId, amended, withdrawn };
}

/** Determines which version (if any) of `meta` is visible to `userId` in `process`. */
export function visibleVersionForActor(
  userId: string,
  meta: ItemMeta,
  project: ProjectConfig,
  process: ProcessConfig,
): VisibleVersion | null {
  const member = findActiveMember(project, userId);
  if (!member) return null;
  return visibleVersionForMember(member, meta, project, process);
}

/** Convenience boolean: can `userId` see `meta` at all? */
export function canActorSeeItem(
  userId: string,
  meta: ItemMeta,
  project: ProjectConfig,
  process: ProcessConfig,
): boolean {
  return visibleVersionForActor(userId, meta, project, process) !== null;
}

/**
 * Checks whether a specific version `rev` of `meta` is visible to `userId`.
 * A recipient lane never sees draft revisions that were not released to it.
 */
export function canActorSeeVersion(
  userId: string,
  meta: ItemMeta,
  rev: number,
  project: ProjectConfig,
  process: ProcessConfig,
): boolean {
  const member = findActiveMember(project, userId);
  if (!member || meta.scopeId !== process.id) return false;
  const lanes = memberLaneIds(member, process);
  if (lanes.length === 0) return false;
  if (!canMemberAccessDocumentSet(member, project, process, lanes)) return false;

  const { access, draftAccess } = computeItemAudiences(meta);
  if (lanes.includes(meta.originLaneId)) {
    for (const row of draftAccess) {
      if (row.versionRev !== rev) continue;
      if (row.subject.kind === 'user' ? member.userId === row.subject.id : member.groupIds.includes(row.subject.id)) {
        return true;
      }
    }
  }
  const laneById = new Map<string, LaneConfig>(process.lanes.map((l) => [l.id, l]));
  for (const row of access) {
    if (row.versionRev !== rev || !lanes.includes(row.laneId)) continue;
    const lane = laneById.get(row.laneId);
    if (!lane) continue;
    if (row.kind === 'internal' && !partyCanSeeInLane(lane, project, member.partyId, row.ownerPartyId)) continue;
    return true;
  }
  return false;
}

/**
 * Computes which users gain or lose visibility to existing items when changing process settings,
 * lane membership, or draft visibility — used to show a confirmation preview before applying.
 */
export interface AccessChangeDiff {
  gained: { userId: string; itemKind: ItemMeta['kind']; itemId: string }[];
  lost: { userId: string; itemKind: ItemMeta['kind']; itemId: string }[];
}

export function previewAccessChange(
  before: { project: ProjectConfig; process: ProcessConfig },
  after: { project: ProjectConfig; process: ProcessConfig },
  state: PolicyState,
): AccessChangeDiff {
  const userIds = new Set<string>([
    ...before.project.members.map((m) => m.userId),
    ...after.project.members.map((m) => m.userId),
  ]);
  const gained: AccessChangeDiff['gained'] = [];
  const lost: AccessChangeDiff['lost'] = [];

  for (const meta of Object.values(state.meta)) {
    if (meta.scopeId !== before.process.id && meta.scopeId !== after.process.id) continue;
    for (const userId of userIds) {
      const was = canActorSeeItem(userId, meta, before.project, before.process);
      const now = canActorSeeItem(userId, meta, after.project, after.process);
      if (!was && now) gained.push({ userId, itemKind: meta.kind, itemId: meta.id });
      if (was && !now) lost.push({ userId, itemKind: meta.kind, itemId: meta.id });
    }
  }
  return { gained, lost };
}

/** Convenience lookup of an item's metadata in `PolicyState`. */
export const metaOf = (state: PolicyState, kind: ItemMeta['kind'], id: string): ItemMeta | undefined =>
  own(state.meta, itemKey(kind, id));
