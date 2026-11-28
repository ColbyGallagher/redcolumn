import {
  effectiveGrantsForMember,
  effectiveRolesForMember,
  hasAtLeastOneActiveAdmin,
  matchesSubject,
  transitionMatches,
} from './grants.ts';
import { compilePartyVisibility, memberLaneIds, partiesInLane } from './visibility.ts';
import type {
  CloserRef,
  GateConfig,
  LaneConfig,
  ProcessConfig,
  ProjectConfig,
  ProjectMember,
} from './types.ts';

// Settings validator: catches bad configurations before saving.
// Checks for:
// - routes nobody can use
// - items that can get stuck (private drafts with no checker, submitted items with no reviewer,
//   open statuses with no reachable close/void path, lanes with creators and no outgoing release path)
// - sessions/reviews nobody can close (empty closer list, no active member matching, closerNotResponder deadlock)
// - attempts to widen a review from a session (extra lane members, extra routes, bypassed checks,
//   widened draft visibility, widened party matrix, weakened checker privacy)

export type ValidationCode =
  | 'no_lanes'
  | 'duplicate_lane'
  | 'empty_lane'
  | 'duplicate_gate'
  | 'missing_lane'
  | 'self_gate'
  | 'empty_gate_targets'
  | 'empty_gate_item_kinds'
  | 'unusable_route'
  | 'no_checker_for_gate'
  | 'stuck_private_draft'
  | 'stuck_submitted_item'
  | 'stuck_item_no_route'
  | 'stuck_returned_item'
  | 'stuck_status'
  | 'no_closed_status'
  | 'no_closer'
  | 'closer_deadlock'
  | 'invalid_party_matrix'
  | 'session_widens_members'
  | 'session_widens_routes'
  | 'session_weakens_check'
  | 'session_widens_drafts'
  | 'session_widens_party_matrix'
  | 'session_widens_checker_visibility'
  | 'session_widens_checker_powers'
  | 'session_widens_checkers'
  | 'session_widens_document_set'
  | 'missing_parent_review'
  | 'missing_scope_id'
  | 'no_admin';

export interface ValidationIssue {
  severity: 'error' | 'warning';
  code: ValidationCode;
  message: string;
  /** Optional target id (laneId, gateId, statusId, etc.). */
  targetId?: string;
}

export interface ValidationReport {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  issues: ValidationIssue[];
}

export interface ValidateOptions {
  /** When validating a session that belongs to a review, pass the parent review config. */
  parentReview?: ProcessConfig;
  /** Also check project-level invariants such as keeping at least one active admin. */
  checkProjectAdmin?: boolean;
}

function activeMembersInLane(project: ProjectConfig, process: ProcessConfig, laneId: string): ProjectMember[] {
  const lane = process.lanes.find((l) => l.id === laneId);
  if (!lane) return [];
  return project.members.filter(
    (m) => m.state === 'active' && lane.members.some((ref) => matchesSubject(m, ref)),
  );
}

function canMemberUseGate(member: ProjectMember, project: ProjectConfig, process: ProcessConfig, gate: GateConfig): boolean {
  const lanes = memberLaneIds(member, process);
  if (!lanes.includes(gate.fromLaneId)) return false;
  const grants = effectiveGrantsForMember(member, project, process, lanes);
  return grants.some((g) => g.action === 'release' && (g.gateIds === '*' || (g.gateIds ?? []).includes(gate.id)));
}

function canMemberCheckGate(member: ProjectMember, project: ProjectConfig, process: ProcessConfig, gate: GateConfig): boolean {
  const lanes = memberLaneIds(member, process);
  if (!lanes.includes(gate.fromLaneId)) return false;
  if ((gate.checkers ?? []).some((c) => (c.kind === 'user' ? member.userId === c.id : member.groupIds.includes(c.id)))) {
    return true;
  }
  const grants = effectiveGrantsForMember(member, project, process, lanes);
  return grants.some((g) => g.action === 'check.review');
}

function closerRefMatchesMember(
  ref: CloserRef,
  member: ProjectMember,
  lanes: readonly string[],
  project: ProjectConfig,
  process: ProcessConfig,
): boolean {
  switch (ref.kind) {
    case 'author': {
      const grants = effectiveGrantsForMember(member, project, process, lanes);
      return grants.some((g) => g.action === 'comment.create');
    }
    case 'assignee':
      // Any active member in a lane can be assigned, provided someone can assign.
      return lanes.length > 0;
    case 'designer': {
      const designers = project.documentDesigners
        ? Object.values(project.documentDesigners).flat()
        : [];
      return designers.includes(member.userId);
    }
    case 'role':
      return effectiveRolesForMember(member, project, process, lanes).has(ref.role);
    case 'user':
      return member.userId === ref.id;
    case 'group':
      return member.groupIds.includes(ref.id);
    case 'party':
      return member.partyId !== null && member.partyId === ref.id;
    case 'lane':
      return lanes.includes(ref.id);
  }
}

/**
 * Validates a process configuration (review or session) against `project` and optionally its
 * parent review. Returns all detected errors and warnings so a settings editor can display them
 * before saving.
 */
export function validateProcess(
  project: ProjectConfig,
  process: ProcessConfig,
  options: ValidateOptions = {},
): ValidationReport {
  const issues: ValidationIssue[] = [];
  const error = (code: ValidationCode, message: string, targetId?: string): void => {
    issues.push(targetId ? { severity: 'error', code, message, targetId } : { severity: 'error', code, message });
  };

  if (options.checkProjectAdmin && !hasAtLeastOneActiveAdmin(project)) {
    error('no_admin', 'The project must keep at least one active administrator');
  }

  // 1. Lanes structure and party visibility matrices.
  if (process.lanes.length === 0) {
    error('no_lanes', 'A review or session needs at least one lane');
  }
  const laneById = new Map<string, LaneConfig>();
  for (const lane of process.lanes) {
    if (laneById.has(lane.id)) {
      error('duplicate_lane', `Lane "${lane.id}" is defined more than once`, lane.id);
    } else {
      laneById.set(lane.id, lane);
    }
    const members = activeMembersInLane(project, process, lane.id);
    if (members.length === 0) {
      error('empty_lane', `Lane "${lane.name}" has no active members`, lane.id);
    }
    const pv = lane.partyVisibility;
    if (pv) {
      const laneParties = partiesInLane(lane, project);
      if (pv.mode === 'separated') {
        if (!pv.leadPartyId) {
          error('invalid_party_matrix', `Lane "${lane.name}" uses separated visibility without a lead party`, lane.id);
        } else if (laneParties.length > 0 && !laneParties.includes(pv.leadPartyId)) {
          error(
            'invalid_party_matrix',
            `Lead party "${pv.leadPartyId}" is not a member of lane "${lane.name}"`,
            lane.id,
          );
        }
      } else if (pv.mode === 'custom') {
        for (const pair of pv.pairs ?? []) {
          for (const [role, partyId] of [['viewer', pair.viewerPartyId], ['owner', pair.ownerPartyId]] as const) {
            if (!project.parties.some((p) => p.id === partyId)) {
              error('invalid_party_matrix', `Unknown ${role} party "${partyId}" in lane "${lane.name}"`, lane.id);
            } else if (!laneParties.includes(partyId)) {
              error('invalid_party_matrix', `${role === 'viewer' ? 'Viewer' : 'Owner'} party "${partyId}" is not in lane "${lane.name}"`, lane.id);
            }
          }
        }
      }
    }
  }

  // 1b. Review- and session-level grants and roles must name the review or session they belong to.
  const scoped = [
    ...project.grants.map((g) => ({ level: g.level, scopeId: g.scopeId, what: `grant "${g.action}"` })),
    ...(project.roles ?? []).map((r) => ({ level: r.level, scopeId: r.scopeId, what: `role "${r.role}"` })),
    ...(process.grants ?? []).map((g) => ({ level: g.level, scopeId: g.scopeId, what: `grant "${g.action}"` })),
    ...(process.roles ?? []).map((r) => ({ level: r.level, scopeId: r.scopeId, what: `role "${r.role}"` })),
  ];
  for (const s of scoped) {
    if (s.level !== 'project' && !s.scopeId) {
      error('missing_scope_id', `A ${s.level}-level ${s.what} must name the ${s.level} it applies to`);
    }
  }

  // 2. Gates: valid lanes, usable routes, checkers for checked gates, returnability.
  const gateById = new Map<string, GateConfig>();
  for (const gate of process.gates) {
    if (gateById.has(gate.id)) {
      error('duplicate_gate', `Gate "${gate.id}" is defined more than once`, gate.id);
    } else {
      gateById.set(gate.id, gate);
    }
    if (!laneById.has(gate.fromLaneId)) {
      error('missing_lane', `Gate "${gate.name}" starts from unknown lane "${gate.fromLaneId}"`, gate.id);
    }
    if (gate.toLaneIds.length === 0) {
      error('empty_gate_targets', `Gate "${gate.name}" has no target lanes`, gate.id);
    }
    if (gate.itemKinds.length === 0) {
      error('empty_gate_item_kinds', `Gate "${gate.name}" allows no item kinds`, gate.id);
    }
    for (const target of gate.toLaneIds) {
      if (!laneById.has(target)) {
        error('missing_lane', `Gate "${gate.name}" points to unknown lane "${target}"`, gate.id);
      }
      if (target === gate.fromLaneId) {
        error('self_gate', `Gate "${gate.name}" routes lane "${target}" to itself`, gate.id);
      }
    }

    // Route nobody can use: no active member in `fromLaneId` holds a release grant for this gate.
    const fromMembers = activeMembersInLane(project, process, gate.fromLaneId);
    const releasers = fromMembers.filter((m) => canMemberUseGate(m, project, process, gate));
    if (releasers.length === 0) {
      error('unusable_route', `Nobody in lane "${gate.fromLaneId}" can release through gate "${gate.name}"`, gate.id);
    }

    // Gate requires check, but nobody in `fromLaneId` can check items for it.
    if (gate.requiresCheck) {
      const checkers = fromMembers.filter((m) => canMemberCheckGate(m, project, process, gate));
      if (checkers.length === 0) {
        error(
          'no_checker_for_gate',
          `Gate "${gate.name}" requires checking, but nobody in lane "${gate.fromLaneId}" can check items`,
          gate.id,
        );
      }
    }

    // If a receiving-lane checker may return items, ensure someone in the originating lane can edit,
    // resubmit or override them so returned items cannot get permanently stuck.
    if (gate.checkerPowers?.return) {
      const canHandleReturn = fromMembers.some((m) => {
        const lanes = memberLaneIds(m, process);
        const grants = effectiveGrantsForMember(m, project, process, lanes);
        return (
          grants.some((g) => g.action === 'comment.edit' || g.action === 'check.submit') ||
          (gate.checkerPowers?.originatorMayOverride.return && canMemberUseGate(m, project, process, gate))
        );
      });
      if (!canHandleReturn) {
        error(
          'stuck_returned_item',
          `Gate "${gate.name}" allows returns, but nobody in lane "${gate.fromLaneId}" can rework or resubmit returned items`,
          gate.id,
        );
      }
    }
  }

  // 3. Items that can get stuck inside a lane.
  for (const lane of process.lanes) {
    const members = activeMembersInLane(project, process, lane.id);
    const laneDraftVis = lane.defaultDraftVisibility ?? process.defaultDraftVisibility;

    const creators = members.filter((m) => {
      const lanes = memberLaneIds(m, process);
      return effectiveGrantsForMember(m, project, process, lanes).some((g) => g.action === 'comment.create');
    });
    const submitters = members.filter((m) => {
      const lanes = memberLaneIds(m, process);
      return effectiveGrantsForMember(m, project, process, lanes).some((g) => g.action === 'check.submit');
    });
    const checkers = members.filter((m) => {
      const lanes = memberLaneIds(m, process);
      return effectiveGrantsForMember(m, project, process, lanes).some((g) => g.action === 'check.review');
    });

    const outgoingGates = process.gates.filter((g) => g.fromLaneId === lane.id);
    const outgoingCommentGates = outgoingGates.filter((g) => g.itemKinds.includes('comment'));
    const gateCheckers = outgoingCommentGates.flatMap((g) => g.checkers ?? []);

    // Multi-lane process where creators in this lane make comments that can never leave the lane.
    if (process.lanes.length > 1 && !process.autoReleaseOnCreate && creators.length > 0 && outgoingCommentGates.length === 0) {
      error(
        'stuck_item_no_route',
        `Members in lane "${lane.name}" can create comments, but no outgoing gate releases comments from this lane`,
        lane.id,
      );
    }

    // Private drafts when creators cannot self-release and no checker can see their private drafts.
    if (laneDraftVis === 'private' && creators.length > 0 && outgoingCommentGates.length > 0) {
      const hasAnyReleaserWhoIsAlsoCreator = creators.every((c) =>
        outgoingCommentGates.some((g) => canMemberUseGate(c, project, process, g) && !g.requiresCheck),
      );
      const hasAssignedActiveChecker = members.some((m) =>
        gateCheckers.some((ref) => (ref.kind === 'user' ? m.userId === ref.id : m.groupIds.includes(ref.id))),
      );
      if (!hasAnyReleaserWhoIsAlsoCreator && !hasAssignedActiveChecker && checkers.length === 0) {
        error(
          'stuck_private_draft',
          `Lane "${lane.name}" creates private drafts, but creators cannot self-release and no checker is assigned`,
          lane.id,
        );
      }
    }

    // Submitters can move items to `submitted`, yet nobody in the lane can check or release them.
    if (submitters.length > 0) {
      const anyoneCanRelease = outgoingGates.some((g) =>
        members.some((m) => canMemberUseGate(m, project, process, g)),
      );
      if (checkers.length === 0 && !anyoneCanRelease && !process.autoReleaseOnCreate) {
        error(
          'stuck_submitted_item',
          `Members in lane "${lane.name}" can submit items for check, but nobody can check or release them`,
          lane.id,
        );
      }
    }
  }

  // 4. Status reachability and closing rules (sessions/reviews nobody can close).
  const closedStatuses = project.statuses.filter((s) => s.category === 'closed');
  const terminalStatuses = project.statuses.filter((s) => s.category === 'closed' || s.category === 'void');
  if (closedStatuses.length === 0) {
    error('no_closed_status', 'The project status set has no closed status');
  }

  const activeScopeMembers = project.members.filter(
    (m) => m.state === 'active' && memberLaneIds(m, process).length > 0,
  );

  // Check closer list has at least one qualifying active member.
  const closing = process.closing ?? project.defaultClosing;
  const qualifyingClosers = activeScopeMembers.filter((m) => {
    const lanes = memberLaneIds(m, process);
    return closing.allowedClosers.some((ref) => closerRefMatchesMember(ref, m, lanes, project, process));
  });
  if (closing.allowedClosers.length === 0 || qualifyingClosers.length === 0) {
    error('no_closer', 'Nobody in this review or session is allowed to close issues', process.id);
  } else if (closing.closerNotResponder) {
    // Deadlock check: if the ONLY qualifying closer(s) are also the ONLY responder(s) (single user who must respond),
    // flag a deadlock when there is no closer who isn't forced to be the sole responder.
    const responders = activeScopeMembers.filter((m) => {
      const lanes = memberLaneIds(m, process);
      return effectiveGrantsForMember(m, project, process, lanes).some((g) => g.action === 'response.create');
    });
    if (
      qualifyingClosers.length === 1 &&
      responders.length === 1 &&
      qualifyingClosers[0]!.userId === responders[0]!.userId
    ) {
      error(
        'closer_deadlock',
        'The only closer is also the only responder, while "closer must not be responder" is enabled',
        process.id,
      );
    }
  }

  // Check that every `open` status has a path to a `closed` or `void` status under `project.statusTransitions`.
  if (project.statusTransitions && terminalStatuses.length > 0) {
    const terminalIds = new Set(terminalStatuses.map((s) => s.id));
    const allIds = project.statuses.map((s) => s.id);
    // Reverse BFS from terminal statuses.
    const canReachTerminal = new Set<string>(terminalIds);
    let changed = true;
    while (changed) {
      changed = false;
      for (const fromId of allIds) {
        if (canReachTerminal.has(fromId)) continue;
        for (const toId of canReachTerminal) {
          if (transitionMatches(project.statusTransitions, fromId, toId)) {
            canReachTerminal.add(fromId);
            changed = true;
            break;
          }
        }
      }
    }
    for (const s of project.statuses) {
      if (s.category === 'open' && !canReachTerminal.has(s.id)) {
        error('stuck_status', `Open status "${s.name}" has no transition path to a closed or void status`, s.id);
      }
    }
  }

  // 5. Session cannot widen its parent review's walls.
  if (options.parentReview) {
    validateSessionDoesNotWidenReview(project, options.parentReview, process, error);
  }

  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  return { valid: errors.length === 0, errors, warnings, issues };
}

function validateSessionDoesNotWidenReview(
  project: ProjectConfig,
  review: ProcessConfig,
  session: ProcessConfig,
  error: (code: ValidationCode, message: string, targetId?: string) => void,
): void {
  const reviewLaneById = new Map(review.lanes.map((l) => [l.id, l]));

  // 5a. Session cannot add new lanes or add users to a lane who are not in that lane in the parent review.
  for (const sLane of session.lanes) {
    const rLane = reviewLaneById.get(sLane.id);
    if (!rLane) {
      error(
        'session_widens_members',
        `Session lane "${sLane.name}" does not exist in parent review "${review.id}"`,
        sLane.id,
      );
      continue;
    }

    const reviewMembers = new Set(activeMembersInLane(project, review, rLane.id).map((m) => m.userId));
    const sessionMembers = activeMembersInLane(project, session, sLane.id);
    for (const m of sessionMembers) {
      if (!reviewMembers.has(m.userId)) {
        error(
          'session_widens_members',
          `Session adds user "${m.userId}" to lane "${sLane.name}", widening parent review "${review.id}"`,
          sLane.id,
        );
      }
    }

    // 5b. Session cannot widen draft visibility from private -> lane, or enable autoReleaseOnCreate.
    const rDraft = rLane.defaultDraftVisibility ?? review.defaultDraftVisibility;
    const sDraft = sLane.defaultDraftVisibility ?? session.defaultDraftVisibility;
    if (rDraft === 'private' && sDraft === 'lane') {
      error(
        'session_widens_drafts',
        `Session widens lane "${sLane.name}" drafts from private to lane-shared`,
        sLane.id,
      );
    }
  }

  if (!review.autoReleaseOnCreate && session.autoReleaseOnCreate) {
    error('session_widens_drafts', 'Session cannot enable automatic release when parent review does not');
  }

  // 5c. Session cannot widen the party visibility matrix of any lane (neither by switching to 'open'
  // nor by adding visibility pairs not allowed in the parent review).
  const flaggedMatrixLanes = new Set<string>();
  for (const sLane of session.lanes) {
    const rLane = reviewLaneById.get(sLane.id);
    if (!rLane) continue;
    const rMode = rLane.partyVisibility?.mode ?? 'open';
    const sMode = sLane.partyVisibility?.mode ?? 'open';
    if (rMode !== 'open' && sMode === 'open') {
      flaggedMatrixLanes.add(sLane.id);
      error(
        'session_widens_party_matrix',
        `Session widens lane "${sLane.name}" party visibility from "${rMode}" to "open"`,
        sLane.id,
      );
    }
  }
  const reviewPartyRows = new Set(
    compilePartyVisibility(review, project).map((r) => `${r.laneId}\0${r.viewerPartyId}\0${r.ownerPartyId}`),
  );
  for (const row of compilePartyVisibility(session, project)) {
    if (!reviewLaneById.has(row.laneId) || flaggedMatrixLanes.has(row.laneId)) continue;
    const key = `${row.laneId}\0${row.viewerPartyId}\0${row.ownerPartyId}`;
    if (!reviewPartyRows.has(key)) {
      error(
        'session_widens_party_matrix',
        `Session widens party visibility in lane "${row.laneId}" (${row.viewerPartyId} -> ${row.ownerPartyId})`,
        row.laneId,
      );
    }
  }

  // 5d. Session cannot add routes not permitted by the parent review, nor bypass required checks,
  // nor expose checker edits that the parent review hid.
  for (const sGate of session.gates) {
    for (const targetLane of sGate.toLaneIds) {
      for (const kind of sGate.itemKinds) {
        const matchingReviewGate = review.gates.find(
          (rGate) =>
            rGate.fromLaneId === sGate.fromLaneId &&
            rGate.toLaneIds.includes(targetLane) &&
            rGate.itemKinds.includes(kind),
        );
        if (!matchingReviewGate) {
          error(
            'session_widens_routes',
            `Session gate "${sGate.name}" adds route ${sGate.fromLaneId} -> ${targetLane} (${kind}) not allowed by parent review`,
            sGate.id,
          );
          continue;
        }
        if (matchingReviewGate.requiresCheck && !sGate.requiresCheck) {
          error(
            'session_weakens_check',
            `Session gate "${sGate.name}" disables checking required by parent review gate "${matchingReviewGate.name}"`,
            sGate.id,
          );
        }
        const rPowers = matchingReviewGate.checkerPowers;
        const sPowers = sGate.checkerPowers;
        if (sPowers?.originatorSeesEdits && !rPowers?.originatorSeesEdits) {
          error(
            'session_widens_checker_visibility',
            `Session gate "${sGate.name}" exposes checker edits hidden by parent review gate "${matchingReviewGate.name}"`,
            sGate.id,
          );
        }
        // A session may only narrow the receiving lane's checker powers, never add or turn one on.
        if (sPowers) {
          const widened = [
            ...CHECKER_POWER_FLAGS.filter((f) => sPowers[f] && !rPowers?.[f]),
            ...OVERRIDE_FLAGS.filter((f) => sPowers.originatorMayOverride[f] && !rPowers?.originatorMayOverride[f]).map(
              (f) => `originatorMayOverride.${f}`,
            ),
          ];
          if (widened.length > 0) {
            error(
              'session_widens_checker_powers',
              `Session gate "${sGate.name}" grants checker powers [${widened.join(', ')}] that parent review gate "${matchingReviewGate.name}" does not`,
              sGate.id,
            );
          }
        }
        // Assigned checkers get draft access, so a session may not add any.
        const reviewCheckers = new Set((matchingReviewGate.checkers ?? []).map((c) => `${c.kind}:${c.id}`));
        const extra = (sGate.checkers ?? []).filter((c) => !reviewCheckers.has(`${c.kind}:${c.id}`));
        if (extra.length > 0) {
          error(
            'session_widens_checkers',
            `Session gate "${sGate.name}" adds checkers [${extra.map((c) => `${c.kind}:${c.id}`).join(', ')}] not on parent review gate "${matchingReviewGate.name}"`,
            sGate.id,
          );
        }
      }
    }
  }

  // 5e. A session cannot drop or swap its review's document set (that would let others in).
  if (review.documentSetId && session.documentSetId !== review.documentSetId) {
    error(
      'session_widens_document_set',
      `Session must keep parent review document set "${review.documentSetId}"`,
      session.id,
    );
  }
}

const CHECKER_POWER_FLAGS = ['approve', 'addNotes', 'return', 'editWording', 'delete'] as const;
const OVERRIDE_FLAGS = ['return', 'edit', 'delete'] as const;
