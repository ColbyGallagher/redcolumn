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
    if (g.level === 'review') {
      return g.scopeId === process.id || (process.parentReviewId !== undefined && g.scopeId === process.parentReviewId);
    }
    if (g.level === 'session') {
      return process.kind === 'session' && g.scopeId === process.id;
    }
    return false;
  });
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
    } else if (process && r.level === 'review' && (r.scopeId === process.id || r.scopeId === process.parentReviewId)) {
      roles.add(r.role);
    } else if (process && r.level === 'session' && process.kind === 'session' && r.scopeId === process.id) {
      roles.add(r.role);
    }
  }
  for (const g of effectiveGrantsForMember(member, project, process, memberLaneIds)) {
    if (g.fromRole) roles.add(g.fromRole);
  }
  return roles;
}

/** Whether `grantScope` covers a target with `owner` and `originLaneId` for `member`. */
export function scopeCoversTarget(
  grantScope: GrantScope | undefined,
  member: ProjectMember,
  memberLaneIds: readonly string[],
  target: { owner: Actor; originLaneId: string },
): boolean {
  if (!grantScope) return false;
  switch (grantScope) {
    case 'any':
      return true;
    case 'lane':
      return memberLaneIds.includes(target.originLaneId);
    case 'party':
      return member.partyId !== null && target.owner.partyId !== null && member.partyId === target.owner.partyId;
    case 'group':
      return target.owner.groupId !== null && member.groupIds.includes(target.owner.groupId);
    case 'own':
      return member.userId === target.owner.userId;
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

const SCOPE_RANK: Readonly<Record<GrantScope, number>> = {
  own: 1,
  group: 2,
  party: 3,
  lane: 4,
  any: 5,
};

/**
 * Checks whether an actor with `actorGrants` may delegate `targetGrant`:
 * nobody can grant more than they are allowed to delegate (project admins with `members.manage: any`
 * can delegate any grant; others can only delegate grants they themselves hold at equal or wider scope).
 */
export function canDelegateGrant(actorGrants: readonly Grant[], targetGrant: Grant): boolean {
  const canManageAll = actorGrants.some((g) => g.action === 'members.manage' && g.memberScope === 'any');
  if (canManageAll) return true;
  const canManage = actorGrants.some((g) => g.action === 'members.manage');
  if (!canManage) return false;

  return actorGrants.some((g) => {
    if (g.action !== targetGrant.action) return false;
    if (targetGrant.scope !== undefined) {
      if (!g.scope || SCOPE_RANK[g.scope] < SCOPE_RANK[targetGrant.scope]) return false;
    }
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
