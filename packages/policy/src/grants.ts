import type { Actor } from '@nb/ops';
import {
  own,
  type ActionKind,
  type CloserRef,
  type ClosingConfig,
  type Grant,
  type GrantLevel,
  type GrantScope,
  type ItemMeta,
  type ProcessConfig,
  type ProjectConfig,
  type ProjectMember,
  type RoleAssignment,
  type RolePresetId,
  type StatusTransitionRule,
  type SubjectRef,
} from './types.ts';

// Additive grants, starting role presets, scope matching, closing lists and delegation checks.
// There are no deny rules: to restrict someone, omit the grant.

interface RoleTemplateEntry {
  action: ActionKind;
  scope?: GrantScope;
  usesGateIds?: boolean;
  usesTransitions?: boolean;
  processLevels?: readonly GrantLevel[];
  memberScope?: 'party' | 'review' | 'any';
}

/** Built-in role presets mapped onto the same underlying grants. */
export const ROLE_PRESET_GRANTS: Readonly<Record<RolePresetId, readonly RoleTemplateEntry[]>> = {
  project_admin: [
    { action: 'process.change', processLevels: ['project', 'review', 'session'] },
    { action: 'review.manage' },
    { action: 'members.manage', memberScope: 'any' },
  ],
  document_controller: [
    { action: 'revisions.manage' },
    { action: 'register.issue' },
    { action: 'scale.edit' },
  ],
  review_coordinator: [
    { action: 'comment.create' },
    { action: 'check.submit', scope: 'group' },
    { action: 'release', usesGateIds: true },
    { action: 'process.change', processLevels: ['review', 'session'] },
    { action: 'response.create', scope: 'any' },
    { action: 'status.change', usesTransitions: true },
    { action: 'issue.tick' },
    { action: 'issue.assign', scope: 'any' },
    { action: 'review.manage' },
    { action: 'members.manage', memberScope: 'review' },
    { action: 'register.issue' },
    { action: 'record.lock', scope: 'any' },
  ],
  lead_reviewer: [
    { action: 'comment.create' },
    { action: 'comment.edit', scope: 'group' },
    { action: 'comment.delete', scope: 'group' },
    { action: 'comment.withdraw', scope: 'group' },
    { action: 'check.submit', scope: 'group' },
    { action: 'check.review', scope: 'group' },
    { action: 'release', usesGateIds: true },
    { action: 'response.create', scope: 'any' },
    { action: 'status.change', usesTransitions: true },
    { action: 'issue.tick' },
    { action: 'issue.assign', scope: 'group' },
    { action: 'scale.edit' },
  ],
  reviewer: [
    { action: 'comment.create' },
    { action: 'comment.edit', scope: 'own' },
    { action: 'comment.delete', scope: 'own' },
    { action: 'comment.withdraw', scope: 'own' },
    { action: 'check.submit', scope: 'own' },
    { action: 'response.create', scope: 'any' },
    { action: 'status.change', usesTransitions: true },
    { action: 'issue.tick' },
  ],
  responder: [
    { action: 'check.submit', scope: 'own' },
    { action: 'release', usesGateIds: true },
    { action: 'response.create', scope: 'any' },
    { action: 'status.change', usesTransitions: true },
    { action: 'issue.tick' },
    { action: 'issue.assign', scope: 'party' },
  ],
  viewer: [],
};

/** Expands one role assignment into concrete additive grants. */
export function expandRoleAssignment(assignment: RoleAssignment): Grant[] {
  const entries = ROLE_PRESET_GRANTS[assignment.role];
  const grants: Grant[] = [];
  for (const entry of entries) {
    if (entry.usesGateIds && assignment.gateIds === undefined) continue;
    if (entry.usesTransitions && assignment.transitions === undefined) continue;
    grants.push({
      subject: assignment.subject,
      level: assignment.level,
      scopeId: assignment.scopeId,
      action: entry.action,
      scope: entry.scope,
      gateIds: entry.usesGateIds ? assignment.gateIds : undefined,
      transitions: entry.usesTransitions ? assignment.transitions : undefined,
      processLevels: entry.processLevels,
      memberScope: entry.memberScope,
      fromRole: assignment.role,
    });
  }
  return grants;
}

/** Finds an active project member by user id. Returns undefined if missing, invited or removed. */
export function findActiveMember(project: ProjectConfig, userId: string): ProjectMember | undefined {
  const member = project.members.find((m) => m.userId === userId);
  return member && member.state === 'active' ? member : undefined;
}

/** Whether a member matches a subject reference, given the lanes they belong to in this scope. */
export function matchesSubject(
  member: ProjectMember,
  subject: SubjectRef,
  memberLaneIds: readonly string[] = [],
): boolean {
  switch (subject.kind) {
    case 'user':
      return member.userId === subject.id;
    case 'group':
      return member.groupIds.includes(subject.id);
    case 'party':
      return member.partyId !== null && member.partyId === subject.id;
    case 'lane':
      return memberLaneIds.includes(subject.id);
  }
}

/**
 * Collects all effective additive grants for `member` in `process`.
 * Project grants apply across the project; review grants apply to that review and any session
 * inside it; session grants apply only to that session.
 */
export function effectiveGrantsForMember(
  member: ProjectMember,
  project: ProjectConfig,
  process: ProcessConfig | null,
  memberLaneIds: readonly string[],
): Grant[] {
  const allGrants: Grant[] = [
    ...project.grants,
    ...(project.roles ?? []).flatMap(expandRoleAssignment),
    ...(process?.grants ?? []),
    ...(process?.roles ?? []).flatMap(expandRoleAssignment),
  ];

  return allGrants.filter((g) => {
    if (!matchesSubject(member, g.subject, memberLaneIds)) return false;
    if (g.level === 'project') return true;
    if (!process) return false;
    if (g.level === 'review') return appliesAtReviewLevel(g.scopeId, process);
    if (g.level === 'session') return appliesAtSessionLevel(g.scopeId, process);
    return false;
  });
}

/** Whether a review-level grant or role with `scopeId` applies in `process`. A missing scope id applies nowhere. */
function appliesAtReviewLevel(scopeId: string | undefined, process: ProcessConfig): boolean {
  if (scopeId === undefined) return false;
  if (scopeId === process.id) return true;
  return process.parentReviewId != null && scopeId === process.parentReviewId;
}

/** Whether a session-level grant or role with `scopeId` applies in `process`. A missing scope id applies nowhere. */
function appliesAtSessionLevel(scopeId: string | undefined, process: ProcessConfig): boolean {
  return scopeId !== undefined && process.kind === 'session' && scopeId === process.id;
}

/** Returns the set of role preset ids held by `member` in `project` / `process`. */
export function effectiveRolesForMember(
  member: ProjectMember,
  project: ProjectConfig,
  process: ProcessConfig | null,
  memberLaneIds: readonly string[],
): Set<RolePresetId> {
  const roles = new Set<RolePresetId>();
  const assignments: RoleAssignment[] = [...(project.roles ?? []), ...(process?.roles ?? [])];
  for (const r of assignments) {
    if (!matchesSubject(member, r.subject, memberLaneIds)) continue;
    if (r.level === 'project') {
      roles.add(r.role);
    } else if (process && r.level === 'review' && appliesAtReviewLevel(r.scopeId, process)) {
      roles.add(r.role);
    } else if (process && r.level === 'session' && appliesAtSessionLevel(r.scopeId, process)) {
      roles.add(r.role);
    }
  }
  for (const g of effectiveGrantsForMember(member, project, process, memberLaneIds)) {
    if (g.fromRole) roles.add(g.fromRole);
  }
  return roles;
}

/**
 * Whether `grantScope` covers a target with `owner` and `originLaneId` for `member`.
 * Every scope covers the member's own items; `group` matches any of the owner's groups.
 */
export function scopeCoversTarget(
  grantScope: GrantScope | undefined,
  member: ProjectMember,
  memberLaneIds: readonly string[],
  target: { owner: Actor; originLaneId: string; ownerGroupIds?: readonly string[] },
): boolean {
  if (!grantScope) return false;
  if (member.userId === target.owner.userId) return true;
  switch (grantScope) {
    case 'any':
      return true;
    case 'lane':
      return memberLaneIds.includes(target.originLaneId);
    case 'party':
      return member.partyId !== null && target.owner.partyId !== null && member.partyId === target.owner.partyId;
    case 'group': {
      const ownerGroups = target.ownerGroupIds ?? (target.owner.groupId !== null ? [target.owner.groupId] : []);
      return ownerGroups.some((g) => member.groupIds.includes(g));
    }
    case 'own':
      return false;
  }
}

/** Whether a status transition `(from -> to)` matches a transition rule list. */
export function transitionMatches(
  rules: readonly StatusTransitionRule[] | '*' | undefined,
  from: string | null,
  to: string,
): boolean {
  if (!rules) return false;
  if (rules === '*') return true;
  return rules.some((r) => (r.from === null || r.from === '*' || r.from === from) && r.to === to);
}

/** Whether `member` satisfies one entry of a closer list for `issueMeta`. */
export function matchesCloserRef(
  ref: CloserRef,
  member: ProjectMember,
  memberLaneIds: readonly string[],
  memberRoles: ReadonlySet<RolePresetId>,
  issueMeta: ItemMeta,
  project: ProjectConfig,
): boolean {
  switch (ref.kind) {
    case 'author':
      return member.userId === issueMeta.owner.userId;
    case 'assignee':
      return issueMeta.assigneeUserId !== undefined && issueMeta.assigneeUserId !== null && member.userId === issueMeta.assigneeUserId;
    case 'designer': {
      const key = issueMeta.documentId ?? issueMeta.scopeId;
      const designers = own(project.documentDesigners, key) ?? own(project.documentDesigners, issueMeta.scopeId) ?? [];
      return designers.includes(member.userId);
    }
    case 'role':
      return memberRoles.has(ref.role);
    case 'user':
      return member.userId === ref.id;
    case 'group':
      return member.groupIds.includes(ref.id);
    case 'party':
      return member.partyId !== null && member.partyId === ref.id;
    case 'lane':
      return memberLaneIds.includes(ref.id);
  }
}

/** Resolves the effective closing configuration for an issue (issue override -> process -> project default). */
export function resolveClosingConfig(project: ProjectConfig, process: ProcessConfig, issueId?: string): ClosingConfig {
  if (issueId) {
    const override = own(process.issueClosingOverrides, issueId);
    if (override) return override;
  }
  return process.closing ?? project.defaultClosing;
}

/**
 * Checks whether `member` is allowed to close an issue under the active closing rules,
 * including optional extra conditions such as `closerNotResponder`.
 */
export function canMemberCloseIssue(
  member: ProjectMember,
  memberLaneIds: readonly string[],
  project: ProjectConfig,
  process: ProcessConfig,
  issueMeta: ItemMeta,
): { allowed: true } | { allowed: false; reason: string } {
  const closing = resolveClosingConfig(project, process, issueMeta.id);
  if (closing.allowedClosers.length === 0) {
    return { allowed: false, reason: 'No allowed closers are configured' };
  }
  const roles = effectiveRolesForMember(member, project, process, memberLaneIds);
  const matched = closing.allowedClosers.some((ref) =>
    matchesCloserRef(ref, member, memberLaneIds, roles, issueMeta, project),
  );
  if (!matched) {
    return { allowed: false, reason: 'Actor is not in the closer list' };
  }
  if (closing.closerNotResponder && (issueMeta.responderUserIds ?? []).includes(member.userId)) {
    return { allowed: false, reason: 'Closer must not be a responder on this issue' };
  }
  return { allowed: true };
}

/**
 * Whether item scope `held` includes every item `wanted` covers. Scopes other than `any` are not
 * nested (a `party` grant can reach outside the holder's lane, a `lane` grant can reach other
 * parties), so only `any`, the same scope, and `own` (covered by every scope) are included.
 */
function itemScopeIncludes(held: GrantScope | undefined, wanted: GrantScope): boolean {
  if (held === undefined) return false;
  return held === 'any' || held === wanted || wanted === 'own';
}

const MEMBER_SCOPE_RANK = { party: 1, review: 2, any: 3 } as const;

/** Where a grant's level and scope id sit, for checking that a delegated grant stays inside its source. */
export interface DelegationScopes {
  /** The parent review of a session id, when known. */
  parentReviewOf?: (sessionId: string) => string | null | undefined;
}

/** Whether a grant at (`held.level`, `held.scopeId`) covers everything at (`wanted.level`, `wanted.scopeId`). */
function levelIncludes(held: Grant, wanted: Grant, scopes: DelegationScopes): boolean {
  if (held.level === 'project') return true;
  if (wanted.level === 'project') return false;
  if (held.scopeId === undefined || wanted.scopeId === undefined) return false;
  if (held.level === 'review') {
    if (wanted.level === 'review') return wanted.scopeId === held.scopeId;
    return scopes.parentReviewOf?.(wanted.scopeId) === held.scopeId;
  }
  return wanted.level === 'session' && wanted.scopeId === held.scopeId;
}

/** Whether `held` is at least as wide as `wanted` on every dimension a grant can widen. */
function grantIncludes(held: Grant, wanted: Grant, scopes: DelegationScopes): boolean {
  if (held.action !== wanted.action) return false;
  if (!levelIncludes(held, wanted, scopes)) return false;
  if (wanted.scope !== undefined && !itemScopeIncludes(held.scope, wanted.scope)) return false;
  if (wanted.memberScope !== undefined) {
    if (held.memberScope === undefined || MEMBER_SCOPE_RANK[held.memberScope] < MEMBER_SCOPE_RANK[wanted.memberScope]) {
      return false;
    }
  }
  if (wanted.processLevels !== undefined) {
    const heldLevels = held.processLevels ?? [];
    if (!wanted.processLevels.every((l) => heldLevels.includes(l))) return false;
  }
  return true;
}

/**
 * Checks whether an actor with `actorGrants` may delegate `targetGrant`. Nobody can grant more than
 * they hold: a `members.manage: any` holder may delegate any grant inside its own level and scope id;
 * other managers may delegate only grants they hold themselves, with no wider item scope, member
 * scope, process levels, gates, transitions, level or scope id.
 */
export function canDelegateGrant(
  actorGrants: readonly Grant[],
  targetGrant: Grant,
  scopes: DelegationScopes = {},
): boolean {
  const manageAll = actorGrants.some(
    (g) => g.action === 'members.manage' && g.memberScope === 'any' && levelIncludes(g, targetGrant, scopes),
  );
  if (manageAll) return true;
  const canManage = actorGrants.some((g) => g.action === 'members.manage');
  if (!canManage) return false;

  return actorGrants.some((g) => {
    if (!grantIncludes(g, targetGrant, scopes)) return false;
    if (targetGrant.gateIds !== undefined) {
      if (g.gateIds !== '*') {
        if (!g.gateIds || targetGrant.gateIds === '*') return false;
        if (!targetGrant.gateIds.every((id) => g.gateIds!.includes(id))) return false;
      }
    }
    if (targetGrant.transitions !== undefined) {
      if (g.transitions !== '*') {
        if (!g.transitions || targetGrant.transitions === '*') return false;
        if (!targetGrant.transitions.every((t) => transitionMatches(g.transitions, t.from, t.to))) return false;
      }
    }
    return true;
  });
}

/** Whether removing or changing roles would leave the project with at least one active project admin. */
export function hasAtLeastOneActiveAdmin(project: ProjectConfig): boolean {
  for (const member of project.members) {
    if (member.state !== 'active') continue;
    const grants = effectiveGrantsForMember(member, project, null, []);
    const isAdmin =
      grants.some((g) => g.fromRole === 'project_admin') ||
      (grants.some((g) => g.action === 'members.manage' && g.memberScope === 'any') &&
        grants.some((g) => g.action === 'process.change' && (g.processLevels ?? []).includes('project')));
    if (isAdmin) return true;
  }
  return false;
}
