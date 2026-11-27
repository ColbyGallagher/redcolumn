import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROTOCOL_VERSION } from '@nb/ops';
import {
  allowedItemActions,
  authorizeAction,
  authorizeOp,
  canDelegateGrant,
  createPolicyState,
  DEFAULT_STATUS_TRANSITIONS,
  DEFAULT_STATUSES,
  executeAction,
  hasAtLeastOneActiveAdmin,
  presets,
  type Grant,
  type ProjectConfig,
} from './index.ts';

function sampleProject(): ProjectConfig {
  return {
    id: 'p1',
    parties: [
      { id: 'firmA', name: 'Harbor Structural', contractRole: 'lead_consultant' },
      { id: 'firmB', name: 'Cedar MEP', contractRole: 'subconsultant' },
    ],
    groups: [
      { id: 'g_struct', name: 'Structural', partyId: 'firmA' },
      { id: 'g_mep', name: 'MEP', partyId: 'firmB' },
    ],
    members: [
      { userId: 'admin', partyId: 'firmA', groupIds: ['g_struct'], state: 'active' },
      { userId: 'lead', partyId: 'firmA', groupIds: ['g_struct'], state: 'active' },
      { userId: 'rev1', partyId: 'firmA', groupIds: ['g_struct'], state: 'active' },
      { userId: 'rev2', partyId: 'firmB', groupIds: ['g_mep'], state: 'active' },
      { userId: 'viewer', partyId: 'firmA', groupIds: ['g_struct'], state: 'active' },
      { userId: 'removed', partyId: 'firmA', groupIds: ['g_struct'], state: 'removed' },
      { userId: 'invited', partyId: 'firmA', groupIds: ['g_struct'], state: 'invited' },
    ],
    statuses: DEFAULT_STATUSES,
    statusTransitions: DEFAULT_STATUS_TRANSITIONS,
    defaultClosing: { allowedClosers: [{ kind: 'role', role: 'lead_reviewer' }] },
    documentDesigners: { doc_1: ['rev2'] },
    grants: [],
    roles: [
      { subject: { kind: 'user', id: 'admin' }, role: 'project_admin', level: 'project' },
      { subject: { kind: 'user', id: 'lead' }, role: 'lead_reviewer', level: 'project', gateIds: '*', transitions: '*' },
      { subject: { kind: 'user', id: 'rev1' }, role: 'reviewer', level: 'project', transitions: [{ from: 'open', to: 'actioned' }] },
      { subject: { kind: 'user', id: 'rev2' }, role: 'responder', level: 'project', gateIds: '*', transitions: [{ from: 'open', to: 'actioned' }] },
      { subject: { kind: 'user', id: 'viewer' }, role: 'viewer', level: 'project' },
    ],
  };
}

test('inactive members (removed or invited) are denied all operations', () => {
  const project = sampleProject();
  const process = presets.singleTeam({
    id: 'r1',
    members: [{ kind: 'party', id: 'firmA' }, { kind: 'party', id: 'firmB' }],
  });
  const state = createPolicyState();
  const createOp = {
    opId: 'o1',
    schemaVersion: PROTOCOL_VERSION,
    streamId: 'r1',
    type: 'issue.create' as const,
    entityId: 'i1',
    payload: { scopeId: 'r1', title: 'Test', status: 'open' },
  };
  for (const userId of ['removed', 'invited', 'unknown']) {
    const res = authorizeOp(createOp, { actorUserId: userId, project, process, state });
    assert.deepEqual(res, { ok: false, reason: { code: 'not_member' } });
  }
});

test('scopes (own, group, party, any) control editing accurately', () => {
  const project = sampleProject();
  const process = presets.singleTeam({
    id: 'r1',
    members: [{ kind: 'party', id: 'firmA' }, { kind: 'party', id: 'firmB' }],
  });
  const created = executeAction(
    createPolicyState(),
    'rev1',
    { type: 'createIssue', id: 'i1', title: 'Original' },
    { project, process, now: 1000, opSeq: 1 },
  );
  assert.ok(created.ok);

  // rev1 (own) can edit i1.
  const ownEdit = executeAction(created.state, 'rev1', { type: 'editIssue', id: 'i1', title: 'Own edit' }, { project, process, now: 2000, opSeq: 10 });
  assert.ok(ownEdit.ok);

  // lead (group scope in g_struct) can edit rev1's i1.
  const groupEdit = executeAction(ownEdit.state, 'lead', { type: 'editIssue', id: 'i1', title: 'Lead edit' }, { project, process, now: 3000, opSeq: 20 });
  assert.ok(groupEdit.ok);

  // viewer and rev2 (different group/no edit grant) cannot edit i1.
  const viewerEdit = executeAction(groupEdit.state, 'viewer', { type: 'editIssue', id: 'i1', title: 'Bad' }, { project, process, now: 4000, opSeq: 30 });
  assert.equal(viewerEdit.ok, false);
  assert.deepEqual(viewerEdit.error, { code: 'forbidden', action: 'comment.edit' });

  const rev2Edit = executeAction(groupEdit.state, 'rev2', { type: 'editIssue', id: 'i1', title: 'Bad' }, { project, process, now: 4000, opSeq: 40 });
  assert.equal(rev2Edit.ok, false);
  assert.deepEqual(rev2Edit.error, { code: 'forbidden', action: 'comment.edit' });
});

test('closer lists support designer, per-issue overrides, and closerNotResponder', () => {
  const project = sampleProject();
  const process = presets.singleTeam({
    id: 'r1',
    members: [{ kind: 'party', id: 'firmA' }, { kind: 'party', id: 'firmB' }],
    allowedClosers: [{ kind: 'role', role: 'lead_reviewer' }, { kind: 'designer' }],
    closerNotResponder: true,
  });
  let state = executeAction(
    createPolicyState(),
    'rev1',
    { type: 'createIssue', id: 'i1', title: 'Beam depth', documentId: 'doc_1' },
    { project, process, now: 1000, opSeq: 1 },
  ).state;

  // rev2 is the document designer, so rev2 can close before responding.
  const preRespond = authorizeOp(
    {
      opId: 'o_close',
      schemaVersion: PROTOCOL_VERSION,
      streamId: 'r1',
      type: 'status.transition',
      entityId: 'se1',
      payload: { issueId: 'i1', from: 'open', to: 'closed', revisionSeenId: 'revA' },
    },
    { actorUserId: 'rev2', project, process, state },
  );
  assert.deepEqual(preRespond, { ok: true });

  // Once rev2 responds, closerNotResponder blocks rev2 from closing, while lead can still close.
  const responded = executeAction(
    state,
    'rev2',
    { type: 'respond', id: 'resp1', parent: { kind: 'issue', id: 'i1' }, body: 'Updated depth' },
    { project, process, now: 2000, opSeq: 10 },
  );
  assert.ok(responded.ok);
  state = responded.state;

  const blocked = executeAction(
    state,
    'rev2',
    { type: 'transitionStatus', issueId: 'i1', to: 'closed', revisionSeenId: 'revA' },
    { project, process, now: 3000, opSeq: 20 },
  );
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error && 'code' in blocked.error && blocked.error.code, 'forbidden');

  // Per-issue closing override can restrict i1 to author only.
  const overrideProcess = {
    ...process,
    issueClosingOverrides: { i1: { allowedClosers: [{ kind: 'author' as const }] } },
  };
  const leadBlocked = executeAction(
    state,
    'lead',
    { type: 'transitionStatus', issueId: 'i1', to: 'closed', revisionSeenId: 'revA' },
    { project, process: overrideProcess, now: 3500, opSeq: 30 },
  );
  assert.equal(leadBlocked.ok, false);
  const authorAllowed = executeAction(
    state,
    'rev1',
    { type: 'transitionStatus', issueId: 'i1', to: 'closed', revisionSeenId: 'revA' },
    { project, process: overrideProcess, now: 4000, opSeq: 40 },
  );
  assert.ok(authorAllowed.ok);
});

test('stage state, session state, and record locks only take permissions away', () => {
  const project = sampleProject();
  const base = presets.singleTeam({
    id: 'r1',
    members: [{ kind: 'party', id: 'firmA' }],
  });
  let state = executeAction(
    createPolicyState(),
    'lead',
    { type: 'createIssue', id: 'i1', title: 'Locked test' },
    { project, process: base, now: 1000, opSeq: 1 },
  ).state;

  // Closed stage rejects edits.
  const closedStage = { ...base, activeStage: { id: 'st1', name: 'Stage 1', state: 'closed' as const, allowLateSubmissions: true } };
  const editClosed = executeAction(state, 'lead', { type: 'editIssue', id: 'i1', title: 'Late' }, { project, process: closedStage, now: 2000, opSeq: 10 });
  assert.deepEqual(editClosed.error, { code: 'locked', reason: 'stage_closed' });

  // Admin with review.manage can record acceptance of late submission when stage allows it.
  const lateAccept = authorizeAction({ type: 'stage.accept_late' }, { actorUserId: 'admin', project, process: closedStage, state });
  assert.deepEqual(lateAccept, { ok: true });

  // Closed session rejects everything.
  const closedSession = { ...base, sessionState: 'closed' as const };
  const editSessionClosed = executeAction(state, 'lead', { type: 'editIssue', id: 'i1', title: 'Nope' }, { project, process: closedSession, now: 2000, opSeq: 20 });
  assert.deepEqual(editSessionClosed.error, { code: 'locked', reason: 'session_closed' });

  // Record lock blocks edits on that issue while allowing UI helper to reflect it.
  const withLockGrant: ProjectConfig = {
    ...project,
    grants: [{ subject: { kind: 'user', id: 'lead' }, level: 'project', action: 'record.lock', scope: 'any' }],
  };
  const locked = executeAction(state, 'lead', { type: 'lockItem', kind: 'issue', id: 'i1', locked: true }, { project: withLockGrant, process: base, now: 3000, opSeq: 30 });
  assert.ok(locked.ok);
  state = locked.state;
  const editLocked = executeAction(state, 'lead', { type: 'editIssue', id: 'i1', title: 'Blocked' }, { project: withLockGrant, process: base, now: 4000, opSeq: 40 });
  assert.deepEqual(editLocked.error, { code: 'locked', reason: 'record_locked' });

  const uiActions = allowedItemActions('issue', 'i1', { actorUserId: 'lead', project: withLockGrant, process: base, state });
  assert.ok(uiActions);
  assert.equal(uiActions.canEdit, false);
  assert.equal(uiActions.canLock, true);
});

test('delegation limits and at-least-one-admin rule are enforced', () => {
  const project = sampleProject();
  const process = presets.singleTeam({
    id: 'r1',
    members: [{ kind: 'party', id: 'firmA' }],
  });
  const state = createPolicyState();

  const partyMgrGrants: Grant[] = [
    { subject: { kind: 'user', id: 'lead' }, level: 'project', action: 'members.manage', memberScope: 'party' },
    { subject: { kind: 'user', id: 'lead' }, level: 'project', action: 'comment.edit', scope: 'group' },
  ];
  // Can delegate narrower scope (`own`), cannot delegate wider (`any`) or unheld action (`revisions.manage`).
  assert.equal(
    canDelegateGrant(partyMgrGrants, { subject: { kind: 'user', id: 'rev1' }, level: 'project', action: 'comment.edit', scope: 'own' }),
    true,
  );
  assert.equal(
    canDelegateGrant(partyMgrGrants, { subject: { kind: 'user', id: 'rev1' }, level: 'project', action: 'comment.edit', scope: 'any' }),
    false,
  );
  assert.equal(
    canDelegateGrant(partyMgrGrants, { subject: { kind: 'user', id: 'rev1' }, level: 'project', action: 'revisions.manage' }),
    false,
  );

  // Removing the last admin is refused.
  assert.equal(hasAtLeastOneActiveAdmin(project), true);
  const noAdminProject: ProjectConfig = {
    ...project,
    members: project.members.map((m) => (m.userId === 'admin' ? { ...m, state: 'removed' } : m)),
  };
  assert.equal(hasAtLeastOneActiveAdmin(noAdminProject), false);
  const removeLastAdmin = authorizeAction(
    { type: 'members.manage', targetUserId: 'admin', nextProject: noAdminProject },
    { actorUserId: 'admin', project, process, state },
  );
  assert.equal(removeLastAdmin.ok, false);
  assert.equal(removeLastAdmin.reason.code, 'invalid_state');
});
