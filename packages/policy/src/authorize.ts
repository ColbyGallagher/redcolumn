import { statusDef, type AnyOperation, type ItemKind, type ItemRef } from '@nb/ops';
import {
  canDelegateGrant,
  canMemberCloseIssue,
  effectiveGrantsForMember,
  findActiveMember,
  hasAtLeastOneActiveAdmin,
  matchesSubject,
  scopeCoversTarget,
  transitionMatches,
} from './grants.ts';
import { validateProcess, type ValidationIssue } from './validator.ts';
import { canMemberAccessDocumentSet, memberLaneIds, metaOf, visibleVersionForMember } from './visibility.ts';
import {
  own,
  type GateConfig,
  type GateItemKind,
  type Grant,
  type GrantLevel,
  type ItemMeta,
  type PolicyState,
  type ProcessConfig,
  type ProjectConfig,
  type ProjectMember,
} from './types.ts';

// Authoritative permission decision engine.
// Every decision enforces the four rules in order:
//   1. Active project member
//   2. Can see the target (hidden targets return the same `not_found` as missing targets)
//   3. Has an additive grant (or gate/closer rule) covering the action and scope
//   4. Review stage, session state, record lock and checking state allow it

export type PolicyDenyReason =
  | { code: 'not_member' }
  | { code: 'not_found'; kind: string; id: string }
  | { code: 'forbidden'; action: string; detail?: string }
  | { code: 'locked'; reason: 'record_locked' | 'stage_closed' | 'stage_upcoming' | 'session_closed' | 'session_locked' }
  | { code: 'invalid_state'; detail: string }
  | { code: 'invalid_config'; issues: readonly ValidationIssue[] };

export type PolicyDecision = { ok: true } | { ok: false; reason: PolicyDenyReason };

const allow = (): PolicyDecision => ({ ok: true });
const deny = (reason: PolicyDenyReason): PolicyDecision => ({ ok: false, reason });
const notFound = (kind: string, id: string): PolicyDecision => deny({ code: 'not_found', kind, id });
const forbidden = (action: string, detail?: string): PolicyDecision =>
  deny(detail ? { code: 'forbidden', action, detail } : { code: 'forbidden', action });

/** Context required to evaluate an operation or workflow action. */
export interface PolicyContext {
  actorUserId: string;
  /** Optional explicit lane when a user belongs to multiple lanes; defaults to their first lane in the process. */
  actorLaneId?: string;
  project: ProjectConfig;
  process: ProcessConfig;
  /** Parent review config, required when validating session-level process updates. */
  parentReview?: ProcessConfig | null;
  state: PolicyState;
}

/** Workflow and administrative actions beyond `@nb/ops` reducers. */
export type PolicyAction =
  | { type: 'check.submit'; itemKind: ItemKind; itemId: string }
  | { type: 'check.return'; itemKind: ItemKind; itemId: string; gateId?: string }
  | { type: 'check.edit'; itemKind: ItemKind; itemId: string; gateId?: string }
  | { type: 'check.delete'; itemKind: ItemKind; itemId: string; gateId?: string }
  | { type: 'check.addNote'; itemKind: ItemKind; itemId: string; gateId?: string }
  | { type: 'check.override'; itemKind: ItemKind; itemId: string; overrideKind: 'return' | 'edit' | 'delete' }
  | { type: 'release.withdraw'; itemKind: ItemKind; itemId: string; laneIds: readonly string[] }
  | { type: 'issue.assign'; issueId: string; assigneeUserId: string | null }
  | { type: 'record.lock'; itemKind: ItemKind; itemId: string; locked: boolean }
  | { type: 'process.update'; level: GrantLevel; nextProcess: ProcessConfig }
  | { type: 'members.manage'; targetPartyId?: string | null; grantToDelegate?: Grant; nextProject?: ProjectConfig }
  | { type: 'revisions.manage' }
  | { type: 'register.issue'; audienceLaneIds?: readonly string[] }
  | { type: 'stage.accept_late' }
  | { type: 'scale.edit' }
  | { type: 'takeoff.share'; toLaneIds: readonly string[] };

/** Maps an `@nb/ops` `ItemKind` to its gate routing category. */
export function gateCategoryOf(kind: ItemKind): GateItemKind {
  if (kind === 'response') return 'response';
  if (kind === 'statusEvent') return 'status';
  return 'comment';
}

/** Checks step 1 (active member + scope/docset access) and returns resolved member, lanes and grants. */
function resolveActor(ctx: PolicyContext):
  | { ok: true; member: ProjectMember; lanes: string[]; activeLaneId: string; grants: Grant[] }
  | { ok: false; decision: PolicyDecision } {
  const member = findActiveMember(ctx.project, ctx.actorUserId);
  if (!member) return { ok: false, decision: deny({ code: 'not_member' }) };
  const lanes = memberLaneIds(member, ctx.process);
  if (lanes.length === 0 || !canMemberAccessDocumentSet(member, ctx.project, ctx.process, lanes)) {
    return { ok: false, decision: notFound('scope', ctx.process.id) };
  }
  const activeLaneId = ctx.actorLaneId && lanes.includes(ctx.actorLaneId) ? ctx.actorLaneId : lanes[0]!;
  const grants = effectiveGrantsForMember(member, ctx.project, ctx.process, lanes);
  return { ok: true, member, lanes, activeLaneId, grants };
}

/** Step 4: checks session state and active stage rules (only restricts; never grants). */
function checkStageAndSession(
  member: ProjectMember,
  lanes: readonly string[],
  process: ProcessConfig,
  opts: { allowWhenLocked?: boolean; isLateAcceptance?: boolean } = {},
): PolicyDecision | null {
  if (process.sessionState === 'closed') {
    return deny({ code: 'locked', reason: 'session_closed' });
  }
  if (process.sessionState === 'locked' && !opts.allowWhenLocked) {
    return deny({ code: 'locked', reason: 'session_locked' });
  }
  const stage = process.activeStage;
  if (stage) {
    if (stage.state === 'upcoming') {
      return deny({ code: 'locked', reason: 'stage_upcoming' });
    }
    if (stage.state === 'closed' && !opts.isLateAcceptance) {
      return deny({ code: 'locked', reason: 'stage_closed' });
    }
    if (stage.participants && !stage.participants.some((s) => matchesSubject(member, s, lanes))) {
      return forbidden('stage', 'Actor is not a participant in the active stage');
    }
  }
  return null;
}

/** Finds an item's metadata only if it exists AND is visible to `member`; otherwise uniform `not_found`. */
function requireVisibleMeta(
  member: ProjectMember,
  kind: ItemKind,
  id: string,
  ctx: PolicyContext,
): { ok: true; meta: ItemMeta } | { ok: false; decision: PolicyDecision } {
  const meta = metaOf(ctx.state, kind, id);
  if (!meta) return { ok: false, decision: notFound(kind, id) };
  const visible = visibleVersionForMember(member, meta, ctx.project, ctx.process);
  if (!visible) return { ok: false, decision: notFound(kind, id) };
  return { ok: true, meta };
}

/** Whether `meta` has been released to any lane outside its origin lane. */
function isReleasedAcrossWall(meta: ItemMeta): boolean {
  for (const [laneId, releases] of Object.entries(meta.releasesByLane)) {
    if (laneId !== meta.originLaneId && releases.length > 0) return true;
  }
  return false;
}

/** Finds the gate connecting `fromLaneId` to all `toLaneIds` for `category` (or verifies an explicit `gateId`). */
function findMatchingGate(
  process: ProcessConfig,
  gateId: string | null,
  fromLaneId: string,
  toLaneIds: readonly string[],
  category: GateItemKind,
): GateConfig | undefined {
  if (gateId !== null) {
    const gate = process.gates.find((g) => g.id === gateId);
    if (!gate) return undefined;
    if (gate.fromLaneId !== fromLaneId) return undefined;
    if (!gate.itemKinds.includes(category)) return undefined;
    if (!toLaneIds.every((t) => gate.toLaneIds.includes(t))) return undefined;
    return gate;
  }
  return process.gates.find(
    (g) => g.fromLaneId === fromLaneId && g.itemKinds.includes(category) && toLaneIds.every((t) => g.toLaneIds.includes(t)),
  );
}

/** Checks whether a member has a grant matching `action` whose scope covers `target`. */
function hasScopedGrant(
  grants: readonly Grant[],
  action: Grant['action'],
  member: ProjectMember,
  lanes: readonly string[],
  target: { owner: ItemMeta['owner']; originLaneId: string },
): boolean {
  return grants.some((g) => g.action === action && scopeCoversTarget(g.scope, member, lanes, target));
}

/** Checks whether a member has an unreleased-check grant in the origin lane, or checker power across a gate. */
function canCheckItem(
  member: ProjectMember,
  lanes: readonly string[],
  grants: readonly Grant[],
  meta: ItemMeta,
  process: ProcessConfig,
  power: 'editWording' | 'delete' | 'return' | 'addNotes',
  explicitGateId?: string,
): boolean {
  // Case 1: internal check within the item's originating lane (unreleased across walls only).
  if (lanes.includes(meta.originLaneId) && !isReleasedAcrossWall(meta)) {
    const hasCheckGrant = grants.some(
      (g) => g.action === 'check.review' && scopeCoversTarget(g.scope, member, lanes, meta),
    );
    const isAssignedChecker = meta.assignedCheckers.some((c) =>
      c.kind === 'user' ? member.userId === c.id : member.groupIds.includes(c.id),
    );
    if (hasCheckGrant || isAssignedChecker) return true;
  }

  // Case 2: cross-lane checker (e.g. independent certifier) acting on an item received through a gate.
  const gateId = explicitGateId ?? meta.arrivedViaGateId ?? meta.checkedByGateId ?? null;
  if (!gateId) return false;
  const gate = process.gates.find((g) => g.id === gateId);
  if (!gate || !gate.checkerPowers || !gate.checkerPowers[power]) return false;
  // Actor must be in one of the gate's receiving lanes and have received this item in that lane.
  const inReceivingLane = gate.toLaneIds.some(
    (l) => lanes.includes(l) && (own(meta.releasesByLane, l)?.length ?? 0) > 0,
  );
  if (!inReceivingLane) return false;
  // Require a check.review grant or review/coordinator/release role in that receiving lane.
  return grants.some(
    (g) =>
      g.action === 'check.review' ||
      g.action === 'release' ||
      g.fromRole === 'lead_reviewer' ||
      g.fromRole === 'review_coordinator',
  );
}

/**
 * Authorizes a `@nb/ops` operation against the current policy and state.
 * Hidden items return the exact same `not_found` error as missing items.
 */
export function authorizeOp(op: AnyOperation, ctx: PolicyContext): PolicyDecision {
  // Server-only operations cannot be invoked by a client.
  if (op.type === 'issue.number') {
    return forbidden('issue.number', 'Only the server assigns issue numbers');
  }

  const resolved = resolveActor(ctx);
  if (!resolved.ok) return resolved.decision;
  const { member, lanes, activeLaneId, grants } = resolved;

  const stageLock = checkStageAndSession(member, lanes, ctx.process);
  if (stageLock) return stageLock;

  switch (op.type) {
    case 'markup.create':
    case 'issue.create': {
      if (op.payload.scopeId !== ctx.process.id) {
        return notFound('scope', op.payload.scopeId);
      }
      if (!grants.some((g) => g.action === 'comment.create')) {
        return forbidden('comment.create');
      }
      if (op.type === 'issue.create' && op.payload.markupIds) {
        for (const markupId of op.payload.markupIds) {
          const seen = requireVisibleMeta(member, 'markup', markupId, ctx);
          if (!seen.ok) return seen.decision;
        }
      }
      return allow();
    }

    case 'placement.create': {
      const parent = requireVisibleMeta(member, 'markup', op.payload.markupId, ctx);
      if (!parent.ok) return parent.decision;
      if (parent.meta.locked) return deny({ code: 'locked', reason: 'record_locked' });
      const canCreate =
        grants.some((g) => g.action === 'comment.create') ||
        grants.some((g) => g.action === 'revisions.manage') ||
        hasScopedGrant(grants, 'comment.edit', member, lanes, parent.meta);
      return canCreate ? allow() : forbidden('comment.edit');
    }

    case 'markup.patch':
    case 'placement.patch':
    case 'issue.patch':
    case 'issue.link':
    case 'issue.unlink': {
      const kind: ItemKind =
        op.type === 'markup.patch' ? 'markup' : op.type === 'placement.patch' ? 'placement' : 'issue';
      const target = requireVisibleMeta(member, kind, op.entityId, ctx);
      if (!target.ok) return target.decision;
      if (target.meta.locked) return deny({ code: 'locked', reason: 'record_locked' });

      // Special case: ticking an issue (`issue.patch` touching only `checked`) uses `issue.tick` (separate from edit/close).
      if (op.type === 'issue.patch' && op.payload.checked !== undefined && op.payload.title === undefined) {
        if (grants.some((g) => g.action === 'issue.tick')) {
          if (ctx.process.tickClosesIssue && op.payload.checked === true) {
            const closeCheck = canMemberCloseIssue(member, lanes, ctx.project, ctx.process, target.meta);
            if (!closeCheck.allowed) return forbidden('status.change', closeCheck.reason);
          }
          return allow();
        }
        return forbidden('issue.tick');
      }

      if (op.type === 'issue.link' || op.type === 'issue.unlink') {
        const linked = requireVisibleMeta(member, 'markup', op.payload.markupId, ctx);
        if (!linked.ok) return linked.decision;
      }

      // Amending an already-released item requires `allowAmendmentWhileOpen` (or cross-lane checker edit power).
      const releasedAcross = isReleasedAcrossWall(target.meta);
      if (releasedAcross && !lanes.includes(target.meta.originLaneId)) {
        // Actor is in another lane (e.g. certifier editing wording).
        if (canCheckItem(member, lanes, grants, target.meta, ctx.process, 'editWording')) {
          return allow();
        }
        return forbidden('comment.edit', 'Cannot edit another lane’s released item without checker power');
      }
      if (releasedAcross && !ctx.process.allowAmendmentWhileOpen) {
        return forbidden('comment.edit', 'Amendments after release are not allowed in this stage');
      }

      if (hasScopedGrant(grants, 'comment.edit', member, lanes, target.meta)) return allow();
      if (canCheckItem(member, lanes, grants, target.meta, ctx.process, 'editWording')) return allow();
      return forbidden('comment.edit');
    }

    case 'markup.delete':
    case 'placement.delete':
    case 'issue.delete':
    case 'response.delete': {
      const kind = op.type.slice(0, op.type.indexOf('.')) as ItemKind;
      const target = requireVisibleMeta(member, kind, op.entityId, ctx);
      if (!target.ok) return target.decision;
      if (target.meta.locked) return deny({ code: 'locked', reason: 'record_locked' });
      if (isReleasedAcrossWall(target.meta)) {
        // Released items are withdrawn (a new release), not deleted — unless a cross-lane checker stops them.
        if (!lanes.includes(target.meta.originLaneId) && canCheckItem(member, lanes, grants, target.meta, ctx.process, 'delete')) {
          return allow();
        }
        return deny({ code: 'invalid_state', detail: 'Released items must be withdrawn rather than deleted' });
      }
      if (hasScopedGrant(grants, 'comment.delete', member, lanes, target.meta)) return allow();
      if (canCheckItem(member, lanes, grants, target.meta, ctx.process, 'delete')) return allow();
      return forbidden('comment.delete');
    }

    case 'markup.restore':
    case 'placement.restore':
    case 'issue.restore':
    case 'response.restore': {
      const kind = op.type.slice(0, op.type.indexOf('.')) as ItemKind;
      const target = requireVisibleMeta(member, kind, op.entityId, ctx);
      if (!target.ok) return target.decision;
      if (target.meta.locked) return deny({ code: 'locked', reason: 'record_locked' });
      if (hasScopedGrant(grants, 'comment.delete', member, lanes, target.meta)) return allow();
      if (canCheckItem(member, lanes, grants, target.meta, ctx.process, 'delete')) return allow();
      return forbidden('comment.delete');
    }

    case 'response.create': {
      const parent = requireVisibleMeta(member, op.payload.parent.kind, op.payload.parent.id, ctx);
      if (!parent.ok) return parent.decision;
      if (op.payload.inReplyTo) {
        const reply = requireVisibleMeta(member, 'response', op.payload.inReplyTo, ctx);
        if (!reply.ok) return reply.decision;
      }
      const canRespond = grants.some(
        (g) => g.action === 'response.create' && scopeCoversTarget(g.scope, member, lanes, parent.meta),
      );
      return canRespond ? allow() : forbidden('response.create');
    }

    case 'response.patch': {
      const target = requireVisibleMeta(member, 'response', op.entityId, ctx);
      if (!target.ok) return target.decision;
      if (target.meta.locked) return deny({ code: 'locked', reason: 'record_locked' });
      if (isReleasedAcrossWall(target.meta) && !ctx.process.allowAmendmentWhileOpen) {
        return forbidden('comment.edit', 'Amendments after release are not allowed');
      }
      if (hasScopedGrant(grants, 'comment.edit', member, lanes, target.meta)) return allow();
      if (canCheckItem(member, lanes, grants, target.meta, ctx.process, 'editWording')) return allow();
      return forbidden('comment.edit');
    }

    case 'status.transition': {
      const issue = requireVisibleMeta(member, 'issue', op.payload.issueId, ctx);
      if (!issue.ok) return issue.decision;
      if (issue.meta.locked) return deny({ code: 'locked', reason: 'record_locked' });

      const targetStatus = statusDef(ctx.project.statuses, op.payload.to);
      if (!targetStatus) return deny({ code: 'invalid_state', detail: `Unknown status "${op.payload.to}"` });

      // When a receiving lane makes its first status change (`from: null`), evaluate transition rules
      // against the issue's initial baseline status if known.
      const effectiveFrom = op.payload.from ?? issue.meta.initialStatus ?? null;

      if (
        ctx.project.statusTransitions &&
        !transitionMatches(ctx.project.statusTransitions, effectiveFrom, op.payload.to)
      ) {
        return forbidden('status.change', 'Transition is not allowed by the project status set');
      }

      // Closing transitions are governed by the closer list (and optional `closerNotResponder`).
      if (targetStatus.category === 'closed') {
        const closeCheck = canMemberCloseIssue(member, lanes, ctx.project, ctx.process, issue.meta);
        if (!closeCheck.allowed) return forbidden('status.change', closeCheck.reason);
        // Also require a status.change grant covering this transition if any status.change grants exist,
        // or allow closers explicitly named in the closing list.
        return allow();
      }

      const hasTransitionGrant = grants.some(
        (g) => g.action === 'status.change' && transitionMatches(g.transitions, effectiveFrom, op.payload.to),
      );
      return hasTransitionGrant ? allow() : forbidden('status.change');
    }

    case 'release.create': {
      return authorizeRelease(op.payload.gateId, op.payload.toLaneIds, op.payload.items, member, activeLaneId, lanes, grants, ctx);
    }
  }
}

function authorizeRelease(
  gateId: string | null,
  toLaneIds: readonly string[],
  items: readonly ItemRef[],
  member: ProjectMember,
  activeLaneId: string,
  lanes: readonly string[],
  grants: readonly Grant[],
  ctx: PolicyContext,
): PolicyDecision {
  if (toLaneIds.length === 0 || items.length === 0) {
    return deny({ code: 'invalid_state', detail: 'A release needs at least one target lane and one item' });
  }

  // Every referenced item must exist and be visible to the actor (uniform not_found for hidden items).
  const metas: ItemMeta[] = [];
  for (const item of items) {
    const seen = requireVisibleMeta(member, item.kind, item.id, ctx);
    if (!seen.ok) return seen.decision;
    if (seen.meta.checkingState === 'stopped') {
      return deny({ code: 'invalid_state', detail: `Item ${item.id} was stopped and cannot be released` });
    }
    metas.push(seen.meta);
  }

  // Single-lane automatic/internal release: releasing to the actor's own lane needs no cross-lane gate.
  const allSelfLane = toLaneIds.every((l) => l === activeLaneId);
  if (allSelfLane && gateId === null) {
    if (ctx.process.autoReleaseOnCreate) return allow();
    const canSelfRelease = grants.some((g) => g.action === 'release' || g.action === 'check.review');
    return canSelfRelease ? allow() : forbidden('release');
  }

  // Cross-lane release: every item category must be allowed through the gate leaving the actor's lane.
  for (const meta of metas) {
    const category = gateCategoryOf(meta.kind);
    const gate = findMatchingGate(ctx.process, gateId, activeLaneId, toLaneIds, category);
    if (!gate) {
      return forbidden('release', `No gate from lane "${activeLaneId}" allows releasing ${category} to [${toLaneIds.join(', ')}]`);
    }

    // Actor must hold a release grant for this gate.
    const hasGateGrant = grants.some(
      (g) => g.action === 'release' && (g.gateIds === '*' || (g.gateIds ?? []).includes(gate.id)),
    );
    if (!hasGateGrant) {
      return forbidden('release', `Actor may not release through gate "${gate.id}"`);
    }

    // If the gate requires an internal check first, the item must not be an unchecked draft (unless the
    // actor themselves is an authorized checker for this gate / lane).
    if (gate.requiresCheck && meta.originLaneId === activeLaneId && meta.checkingState === 'draft') {
      const isChecker = canCheckItem(member, lanes, grants, meta, ctx.process, 'editWording', gate.id) ||
        (gate.checkers ?? []).some((c) => (c.kind === 'user' ? member.userId === c.id : member.groupIds.includes(c.id)));
      if (!isChecker) {
        return deny({ code: 'invalid_state', detail: `Gate "${gate.id}" requires checking before release` });
      }
    }

    // If this item arrived in `activeLaneId` from another lane via a gate, check that the receiving
    // gate grants `approve` (forwarding) power.
    if (meta.originLaneId !== activeLaneId && meta.arrivedViaGateId) {
      const arrivalGate = ctx.process.gates.find((g) => g.id === meta.arrivedViaGateId);
      if (arrivalGate?.checkerPowers && !arrivalGate.checkerPowers.approve) {
        return forbidden('release', `Gate "${arrivalGate.id}" does not permit forwarding items onward`);
      }
    }
  }

  return allow();
}

/**
 * Authorizes workflow and administrative actions outside `@nb/ops` reducers (checking, returns,
 * overrides, withdrawals, locking, process updates, member management, register exports).
 */
export function authorizeAction(action: PolicyAction, ctx: PolicyContext): PolicyDecision {
  const resolved = resolveActor(ctx);
  if (!resolved.ok) return resolved.decision;
  const { member, lanes, grants } = resolved;

  const allowWhenLocked = action.type === 'record.lock' || action.type === 'process.update';
  const isLateAcceptance = action.type === 'stage.accept_late';
  const stageLock = checkStageAndSession(member, lanes, ctx.process, { allowWhenLocked, isLateAcceptance });
  if (stageLock) return stageLock;

  switch (action.type) {
    case 'check.submit': {
      const target = requireVisibleMeta(member, action.itemKind, action.itemId, ctx);
      if (!target.ok) return target.decision;
      if (target.meta.locked) return deny({ code: 'locked', reason: 'record_locked' });
      if (!lanes.includes(target.meta.originLaneId)) {
        return forbidden('check.submit', 'Only the originating lane may submit for check');
      }
      if (target.meta.checkingState !== 'draft' && target.meta.checkingState !== 'returned') {
        return deny({ code: 'invalid_state', detail: `Cannot submit an item in state "${target.meta.checkingState}"` });
      }
      return hasScopedGrant(grants, 'check.submit', member, lanes, target.meta)
        ? allow()
        : forbidden('check.submit');
    }

    case 'check.return':
    case 'check.edit':
    case 'check.delete':
    case 'check.addNote': {
      const target = requireVisibleMeta(member, action.itemKind, action.itemId, ctx);
      if (!target.ok) return target.decision;
      if (target.meta.locked) return deny({ code: 'locked', reason: 'record_locked' });
      const powerMap = {
        'check.return': 'return',
        'check.edit': 'editWording',
        'check.delete': 'delete',
        'check.addNote': 'addNotes',
      } as const;
      const ok = canCheckItem(member, lanes, grants, target.meta, ctx.process, powerMap[action.type], action.gateId);
      return ok ? allow() : forbidden('check.review');
    }

    case 'check.override': {
      const target = requireVisibleMeta(member, action.itemKind, action.itemId, ctx);
      if (!target.ok) return target.decision;
      if (!lanes.includes(target.meta.originLaneId)) {
        return forbidden('check.override', 'Only the originating lane may override a checker decision');
      }
      const gateId = target.meta.checkedByGateId ?? target.meta.arrivedViaGateId;
      const gate = gateId ? ctx.process.gates.find((g) => g.id === gateId) : undefined;
      if (!gate?.checkerPowers) {
        return forbidden('check.override', 'No gate checking decision to override');
      }
      if (!gate.checkerPowers.originatorMayOverride[action.overrideKind]) {
        return forbidden('check.override', `Gate "${gate.id}" does not allow overriding "${action.overrideKind}"`);
      }
      const hasReleaseOrLead =
        grants.some((g) => g.action === 'release' && (g.gateIds === '*' || (g.gateIds ?? []).includes(gate.id))) ||
        grants.some((g) => g.fromRole === 'lead_reviewer' || g.fromRole === 'review_coordinator');
      return hasReleaseOrLead ? allow() : forbidden('check.override');
    }

    case 'release.withdraw': {
      const target = requireVisibleMeta(member, action.itemKind, action.itemId, ctx);
      if (!target.ok) return target.decision;
      if (target.meta.locked) return deny({ code: 'locked', reason: 'record_locked' });
      const hasWithdraw = hasScopedGrant(grants, 'comment.withdraw', member, lanes, target.meta);
      if (!hasWithdraw) return forbidden('comment.withdraw');
      // Actor must also be able to release to those lanes (withdrawing is a release).
      const canReleaseToAll = action.laneIds.every((toLaneId) => {
        if (toLaneId === target.meta.originLaneId) return true;
        const gate = findMatchingGate(ctx.process, null, target.meta.originLaneId, [toLaneId], gateCategoryOf(target.meta.kind));
        if (!gate) return false;
        return grants.some((g) => g.action === 'release' && (g.gateIds === '*' || (g.gateIds ?? []).includes(gate.id)));
      });
      return canReleaseToAll ? allow() : forbidden('release', 'Withdrawing requires release permission to the target lanes');
    }

    case 'issue.assign': {
      const target = requireVisibleMeta(member, 'issue', action.issueId, ctx);
      if (!target.ok) return target.decision;
      if (target.meta.locked) return deny({ code: 'locked', reason: 'record_locked' });
      return hasScopedGrant(grants, 'issue.assign', member, lanes, target.meta)
        ? allow()
        : forbidden('issue.assign');
    }

    case 'record.lock': {
      const target = requireVisibleMeta(member, action.itemKind, action.itemId, ctx);
      if (!target.ok) return target.decision;
      return hasScopedGrant(grants, 'record.lock', member, lanes, target.meta)
        ? allow()
        : forbidden('record.lock');
    }

    case 'process.update': {
      const canChange = grants.some(
        (g) => g.action === 'process.change' && (g.processLevels ?? []).includes(action.level),
      );
      if (!canChange) return forbidden('process.change');
      const report = validateProcess(ctx.project, action.nextProcess, {
        parentReview: action.level === 'session' ? ctx.parentReview ?? undefined : undefined,
      });
      if (!report.valid) {
        return deny({ code: 'invalid_config', issues: report.errors });
      }
      return allow();
    }

    case 'members.manage': {
      const manageGrants = grants.filter((g) => g.action === 'members.manage');
      if (manageGrants.length === 0) return forbidden('members.manage');
      const hasAny = manageGrants.some((g) => g.memberScope === 'any');
      const hasReview = manageGrants.some((g) => g.memberScope === 'review');
      const hasOwnParty = manageGrants.some((g) => g.memberScope === 'party');
      if (!hasAny) {
        if (action.targetPartyId !== undefined && action.targetPartyId !== member.partyId && !hasReview) {
          return forbidden('members.manage', 'Actor may only manage members of their own party');
        }
        if (!hasOwnParty && !hasReview) return forbidden('members.manage');
      }
      if (action.grantToDelegate && !canDelegateGrant(grants, action.grantToDelegate)) {
        return forbidden('members.manage', 'Cannot delegate a grant wider than actor’s own authority');
      }
      if (action.nextProject && !hasAtLeastOneActiveAdmin(action.nextProject)) {
        return deny({ code: 'invalid_state', detail: 'A project must always keep at least one active admin' });
      }
      return allow();
    }

    case 'revisions.manage':
      return grants.some((g) => g.action === 'revisions.manage') ? allow() : forbidden('revisions.manage');

    case 'register.issue': {
      if (!grants.some((g) => g.action === 'register.issue')) return forbidden('register.issue');
      // An export limited to an audience can never include lanes the issuer cannot see.
      if (action.audienceLaneIds) {
        const invalidLane = action.audienceLaneIds.find((l) => !lanes.includes(l));
        if (invalidLane) {
          return forbidden('register.issue', 'An export audience cannot exceed what its creator may see');
        }
      }
      return allow();
    }

    case 'stage.accept_late': {
      if (!ctx.process.activeStage?.allowLateSubmissions) {
        return forbidden('stage.accept_late', 'Stage does not allow late submissions');
      }
      return grants.some((g) => g.action === 'review.manage') ? allow() : forbidden('review.manage');
    }

    case 'scale.edit':
      return grants.some((g) => g.action === 'scale.edit') ? allow() : forbidden('scale.edit');

    case 'takeoff.share': {
      if (!grants.some((g) => g.action === 'takeoff.share')) return forbidden('takeoff.share');
      if (action.toLaneIds.length === 0) return deny({ code: 'invalid_state', detail: 'Must choose at least one target lane' });
      for (const l of action.toLaneIds) {
        if (!ctx.process.lanes.some((lane) => lane.id === l)) return notFound('lane', l);
      }
      return allow();
    }
  }
}

/** UI helper: summarizes which high-level actions an actor may perform on a visible item. */
export interface AllowedItemActions {
  canEdit: boolean;
  canDelete: boolean;
  canWithdraw: boolean;
  canSubmit: boolean;
  canCheckEdit: boolean;
  canCheckReturn: boolean;
  canCheckDelete: boolean;
  canRespond: boolean;
  canTick: boolean;
  canClose: boolean;
  canLock: boolean;
  releasableGateIds: string[];
}

export function allowedItemActions(
  itemKind: ItemKind,
  itemId: string,
  ctx: PolicyContext,
): AllowedItemActions | null {
  const resolved = resolveActor(ctx);
  if (!resolved.ok) return null;
  const { member, lanes, activeLaneId, grants } = resolved;
  const seen = requireVisibleMeta(member, itemKind, itemId, ctx);
  if (!seen.ok) return null;
  const meta = seen.meta;

  const releasableGateIds: string[] = [];
  const category = gateCategoryOf(itemKind);
  for (const gate of ctx.process.gates) {
    if (gate.fromLaneId !== activeLaneId || !gate.itemKinds.includes(category)) continue;
    const dec = authorizeRelease(
      gate.id,
      gate.toLaneIds,
      [{ kind: itemKind, id: itemId, rev: meta.latestRev }],
      member,
      activeLaneId,
      lanes,
      grants,
      ctx,
    );
    if (dec.ok) releasableGateIds.push(gate.id);
  }

  const closedStatus = ctx.project.statuses.find((s) => s.category === 'closed');
  const canClose =
    itemKind === 'issue' &&
    closedStatus !== undefined &&
    canMemberCloseIssue(member, lanes, ctx.project, ctx.process, meta).allowed;

  const unlocked = !meta.locked && checkStageAndSession(member, lanes, ctx.process) === null;

  return {
    canEdit:
      unlocked &&
      ((!isReleasedAcrossWall(meta) || ctx.process.allowAmendmentWhileOpen) &&
        (hasScopedGrant(grants, 'comment.edit', member, lanes, meta) ||
          canCheckItem(member, lanes, grants, meta, ctx.process, 'editWording'))),
    canDelete:
      unlocked &&
      !isReleasedAcrossWall(meta) &&
      (hasScopedGrant(grants, 'comment.delete', member, lanes, meta) ||
        canCheckItem(member, lanes, grants, meta, ctx.process, 'delete')),
    canWithdraw:
      unlocked &&
      isReleasedAcrossWall(meta) &&
      hasScopedGrant(grants, 'comment.withdraw', member, lanes, meta),
    canSubmit:
      unlocked &&
      lanes.includes(meta.originLaneId) &&
      (meta.checkingState === 'draft' || meta.checkingState === 'returned') &&
      hasScopedGrant(grants, 'check.submit', member, lanes, meta),
    canCheckEdit: unlocked && canCheckItem(member, lanes, grants, meta, ctx.process, 'editWording'),
    canCheckReturn: unlocked && canCheckItem(member, lanes, grants, meta, ctx.process, 'return'),
    canCheckDelete: unlocked && canCheckItem(member, lanes, grants, meta, ctx.process, 'delete'),
    canRespond:
      unlocked &&
      (itemKind === 'issue' || itemKind === 'markup') &&
      grants.some((g) => g.action === 'response.create' && scopeCoversTarget(g.scope, member, lanes, meta)),
    canTick: unlocked && itemKind === 'issue' && grants.some((g) => g.action === 'issue.tick'),
    canClose: unlocked && canClose,
    canLock: hasScopedGrant(grants, 'record.lock', member, lanes, meta),
    releasableGateIds,
  };
}
