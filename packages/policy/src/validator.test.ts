import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  authorizeAction,
  createPolicyState,
  DEFAULT_STATUS_TRANSITIONS,
  DEFAULT_STATUSES,
  presets,
  validateProcess,
  type ProcessConfig,
  type ProjectConfig,
  type ValidationCode,
} from './index.ts';

function validThreeSidedSetup(): { project: ProjectConfig; process: ProcessConfig } {
  const project: ProjectConfig = {
    id: 'proj_val',
    parties: [
      { id: 'client', name: 'Civic Works', contractRole: 'client' },
      { id: 'cert', name: 'Northgate Certifiers', contractRole: 'certifier' },
      { id: 'partner', name: 'Crestline Builders', contractRole: 'contractor' },
      { id: 'sub', name: 'Pine HVAC', contractRole: 'subconsultant' },
      { id: 'sub2', name: 'Birch Hydraulics', contractRole: 'subconsultant' },
    ],
    groups: [{ id: 'client_leads', name: 'Client Leads', partyId: 'client' }],
    members: [
      { userId: 'admin', partyId: 'cert', groupIds: [], state: 'active' },
      { userId: 'c_rev', partyId: 'client', groupIds: [], state: 'active' },
      { userId: 'c_lead', partyId: 'client', groupIds: ['client_leads'], state: 'active' },
      { userId: 'cert_lead', partyId: 'cert', groupIds: [], state: 'active' },
      { userId: 'p_resp', partyId: 'partner', groupIds: [], state: 'active' },
      { userId: 'sub_u', partyId: 'sub', groupIds: [], state: 'active' },
      { userId: 'sub2_u', partyId: 'sub2', groupIds: [], state: 'active' },
    ],
    statuses: DEFAULT_STATUSES,
    statusTransitions: DEFAULT_STATUS_TRANSITIONS,
    defaultClosing: { allowedClosers: [{ kind: 'lane', id: 'certifier' }] },
    grants: [],
    roles: [
      { subject: { kind: 'user', id: 'admin' }, role: 'project_admin', level: 'project' },
      { subject: { kind: 'user', id: 'c_rev' }, role: 'reviewer', level: 'project' },
      { subject: { kind: 'user', id: 'c_lead' }, role: 'lead_reviewer', level: 'project', gateIds: ['client-to-certifier'], transitions: '*' },
      { subject: { kind: 'user', id: 'cert_lead' }, role: 'review_coordinator', level: 'project', gateIds: ['certifier-to-partner', 'certifier-to-client', 'certifier-to-both'], transitions: '*' },
      { subject: { kind: 'user', id: 'p_resp' }, role: 'responder', level: 'project', gateIds: ['partner-to-certifier'], transitions: [{ from: 'open', to: 'actioned' }] },
      { subject: { kind: 'user', id: 'sub_u' }, role: 'responder', level: 'project', gateIds: ['partner-to-certifier'] },
    ],
  };

  const process = presets.threeSided({
    id: 'rev_main',
    clientMembers: [{ kind: 'party', id: 'client' }],
    certifierMembers: [{ kind: 'party', id: 'cert' }],
    partnerMembers: [{ kind: 'party', id: 'partner' }, { kind: 'party', id: 'sub' }, { kind: 'party', id: 'sub2' }],
    clientDraftVisibility: 'private',
    clientCheckers: [{ kind: 'group', id: 'client_leads' }],
    partnerPartyVisibility: { mode: 'separated', leadPartyId: 'partner' },
  });

  return { project, process };
}

function expectCode(codes: readonly ValidationCode[], expected: ValidationCode): void {
  assert.ok(codes.includes(expected), `expected validation code "${expected}", got [${codes.join(', ')}]`);
}

test('all three healthy presets pass validation with zero errors', () => {
  const { project, process: p3 } = validThreeSidedSetup();
  assert.equal(validateProcess(project, p3, { checkProjectAdmin: true }).valid, true);

  const p1 = presets.singleTeam({
    id: 'rev_1',
    members: [{ kind: 'party', id: 'cert' }],
    allowedClosers: [{ kind: 'user', id: 'cert_lead' }],
  });
  assert.equal(validateProcess(project, p1).valid, true);

  const p2 = presets.twoSided({
    id: 'rev_2',
    clientMembers: [{ kind: 'party', id: 'client' }],
    firmMembers: [{ kind: 'party', id: 'partner' }],
    clientCheckers: [{ kind: 'group', id: 'client_leads' }],
    roles: [
      { subject: { kind: 'user', id: 'c_lead' }, role: 'lead_reviewer', level: 'review', scopeId: 'rev_2', gateIds: ['client-to-firm'] },
      { subject: { kind: 'user', id: 'p_resp' }, role: 'responder', level: 'review', scopeId: 'rev_2', gateIds: ['firm-to-client'] },
    ],
  });
  assert.equal(validateProcess(project, p2).valid, true);
});

test('validator catches structural errors and routes nobody can use', () => {
  const { project, process } = validThreeSidedSetup();

  // No lanes.
  const noLanes = validateProcess(project, { ...process, lanes: [], gates: [] });
  expectCode(noLanes.errors.map((e) => e.code), 'no_lanes');

  // Missing lane & self-loop gate & empty targets.
  const badGates = validateProcess(project, {
    ...process,
    gates: [
      ...process.gates,
      { id: 'g_missing', name: 'Bad Target', fromLaneId: 'client', toLaneIds: ['ghost'], itemKinds: ['comment'], requiresCheck: false },
      { id: 'g_self', name: 'Loop', fromLaneId: 'client', toLaneIds: ['client'], itemKinds: ['comment'], requiresCheck: false },
      { id: 'g_empty', name: 'Nowhere', fromLaneId: 'client', toLaneIds: [], itemKinds: [], requiresCheck: false },
    ],
  });
  const codes = badGates.errors.map((e) => e.code);
  expectCode(codes, 'missing_lane');
  expectCode(codes, 'self_gate');
  expectCode(codes, 'empty_gate_targets');
  expectCode(codes, 'empty_gate_item_kinds');

  // Unusable route: nobody in client lane has release grant for `g_unusable`.
  const noReleaserProject: ProjectConfig = {
    ...project,
    roles: (project.roles ?? []).map((r) => (r.subject.kind === 'user' && r.subject.id === 'c_lead' ? { ...r, gateIds: [] } : r)),
  };
  const unusable = validateProcess(noReleaserProject, process);
  expectCode(unusable.errors.map((e) => e.code), 'unusable_route');

  // Gate requires check, but nobody in fromLane can check.
  const noCheckerProject: ProjectConfig = {
    ...project,
    roles: (project.roles ?? []).map((r) =>
      r.subject.kind === 'user' && r.subject.id === 'c_lead'
        ? { ...r, role: 'responder' as const, gateIds: ['client-to-certifier'] }
        : r,
    ),
  };
  const checkedGateProcess: ProcessConfig = {
    ...process,
    gates: process.gates.map((g) => (g.id === 'client-to-certifier' ? { ...g, requiresCheck: true, checkers: [] } : g)),
  };
  const noChecker = validateProcess(noCheckerProject, checkedGateProcess);
  expectCode(noChecker.errors.map((e) => e.code), 'no_checker_for_gate');
});

test('validator catches items that can get stuck (private drafts, submitted, no route, returned, stuck status)', () => {
  const { project, process } = validThreeSidedSetup();

  // 1. Multi-lane creator with no outgoing comment gate.
  const noCommentGate: ProcessConfig = {
    ...process,
    gates: process.gates.filter((g) => g.fromLaneId !== 'client'),
  };
  expectCode(validateProcess(project, noCommentGate).errors.map((e) => e.code), 'stuck_item_no_route');

  // 2. Private drafts where creator cannot self-release and no checker is assigned.
  const noCheckerOrLead: ProjectConfig = {
    ...project,
    roles: [
      { subject: { kind: 'user', id: 'admin' }, role: 'project_admin', level: 'project' },
      { subject: { kind: 'user', id: 'c_rev' }, role: 'reviewer', level: 'project' },
      { subject: { kind: 'user', id: 'c_lead' }, role: 'responder', level: 'project', gateIds: ['client-to-certifier'] },
      { subject: { kind: 'user', id: 'cert_lead' }, role: 'review_coordinator', level: 'project', gateIds: '*', transitions: '*' },
      { subject: { kind: 'user', id: 'p_resp' }, role: 'responder', level: 'project', gateIds: ['partner-to-certifier'] },
    ],
  };
  const privateNoChecker: ProcessConfig = {
    ...process,
    gates: process.gates.map((g) => (g.id === 'client-to-certifier' ? { ...g, checkers: [] } : g)),
  };
  expectCode(validateProcess(noCheckerOrLead, privateNoChecker).errors.map((e) => e.code), 'stuck_private_draft');

  // 3. Submitted items with no checker or releaser in lane.
  const submitOnly: ProjectConfig = {
    ...project,
    roles: [
      { subject: { kind: 'user', id: 'admin' }, role: 'project_admin', level: 'project' },
      { subject: { kind: 'user', id: 'c_rev' }, role: 'reviewer', level: 'project' },
      { subject: { kind: 'user', id: 'cert_lead' }, role: 'review_coordinator', level: 'project', gateIds: '*', transitions: '*' },
      { subject: { kind: 'user', id: 'p_resp' }, role: 'responder', level: 'project', gateIds: ['partner-to-certifier'] },
    ],
  };
  expectCode(validateProcess(submitOnly, process).errors.map((e) => e.code), 'stuck_submitted_item');

  // 4. Returned item where originating lane has nobody who can edit, submit or override.
  const viewerOnlyOrigin: ProjectConfig = {
    ...project,
    roles: [
      { subject: { kind: 'user', id: 'admin' }, role: 'project_admin', level: 'project' },
      { subject: { kind: 'user', id: 'c_rev' }, role: 'viewer', level: 'project' },
      { subject: { kind: 'user', id: 'c_lead' }, role: 'viewer', level: 'project' },
      { subject: { kind: 'user', id: 'cert_lead' }, role: 'review_coordinator', level: 'project', gateIds: '*', transitions: '*' },
      { subject: { kind: 'user', id: 'p_resp' }, role: 'responder', level: 'project', gateIds: ['partner-to-certifier'] },
    ],
  };
  expectCode(validateProcess(viewerOnlyOrigin, process).errors.map((e) => e.code), 'stuck_returned_item');

  // 5. Open status with no transition path to closed/void.
  const stuckStatusProject: ProjectConfig = {
    ...project,
    statuses: [
      ...project.statuses,
      { id: 'limbo', name: 'Limbo', category: 'open' },
    ],
    statusTransitions: DEFAULT_STATUS_TRANSITIONS,
  };
  expectCode(validateProcess(stuckStatusProject, process).errors.map((e) => e.code), 'stuck_status');
});

test('validator catches sessions nobody can close, closer deadlock, and invalid party matrices', () => {
  const { project, process } = validThreeSidedSetup();

  // Empty closer list.
  expectCode(
    validateProcess(project, { ...process, closing: { allowedClosers: [] } }).errors.map((e) => e.code),
    'no_closer',
  );

  // Closer list names a removed/nonexistent user.
  expectCode(
    validateProcess(project, { ...process, closing: { allowedClosers: [{ kind: 'user', id: 'nobody' }] } }).errors.map((e) => e.code),
    'no_closer',
  );

  // No closed status in project status set.
  const noClosedStatus: ProjectConfig = {
    ...project,
    statuses: project.statuses.filter((s) => s.category !== 'closed'),
  };
  expectCode(validateProcess(noClosedStatus, process).errors.map((e) => e.code), 'no_closed_status');

  // Closer deadlock: single active user who is both sole closer and sole responder with closerNotResponder=true.
  const soloProject: ProjectConfig = {
    ...project,
    members: [{ userId: 'solo', partyId: 'client', groupIds: [], state: 'active' }],
    roles: [{ subject: { kind: 'user', id: 'solo' }, role: 'review_coordinator', level: 'project', gateIds: '*', transitions: '*' }],
  };
  const soloProcess = presets.singleTeam({
    id: 'solo_sess',
    members: [{ kind: 'user', id: 'solo' }],
    allowedClosers: [{ kind: 'user', id: 'solo' }],
    closerNotResponder: true,
  });
  expectCode(validateProcess(soloProject, soloProcess).errors.map((e) => e.code), 'closer_deadlock');

  // Invalid party matrix: separated without leadPartyId, and separated with lead not in lane.
  const badMatrix1: ProcessConfig = {
    ...process,
    lanes: process.lanes.map((l) => (l.id === 'partner' ? { ...l, partyVisibility: { mode: 'separated' } } : l)),
  };
  expectCode(validateProcess(project, badMatrix1).errors.map((e) => e.code), 'invalid_party_matrix');

  const badMatrix2: ProcessConfig = {
    ...process,
    lanes: process.lanes.map((l) =>
      l.id === 'partner' ? { ...l, partyVisibility: { mode: 'separated', leadPartyId: 'client' } } : l,
    ),
  };
  expectCode(validateProcess(project, badMatrix2).errors.map((e) => e.code), 'invalid_party_matrix');
});

test('validator catches every attempt to widen a parent review from a session', () => {
  const { project, process: review } = validThreeSidedSetup();
  const baseSession: ProcessConfig = { ...review, id: 'sess_1', kind: 'session', parentReviewId: review.id };
  assert.equal(validateProcess(project, baseSession, { parentReview: review }).valid, true);

  // 1. Adding a partner member into client lane.
  const widensMembers: ProcessConfig = {
    ...baseSession,
    lanes: baseSession.lanes.map((l) =>
      l.id === 'client' ? { ...l, members: [...l.members, { kind: 'user', id: 'p_resp' }] } : l,
    ),
  };
  expectCode(validateProcess(project, widensMembers, { parentReview: review }).errors.map((e) => e.code), 'session_widens_members');

  // 2. Adding a direct client -> partner gate bypassing certifier.
  const widensRoutes: ProcessConfig = {
    ...baseSession,
    gates: [
      ...baseSession.gates,
      { id: 'shortcut', name: 'Shortcut', fromLaneId: 'client', toLaneIds: ['partner'], itemKinds: ['comment'], requiresCheck: false },
    ],
  };
  expectCode(validateProcess(project, widensRoutes, { parentReview: review }).errors.map((e) => e.code), 'session_widens_routes');

  // 3. Disabling requiresCheck that parent review requires.
  const checkedReview: ProcessConfig = {
    ...review,
    gates: review.gates.map((g) => (g.id === 'client-to-certifier' ? { ...g, requiresCheck: true } : g)),
  };
  const weakensCheck: ProcessConfig = {
    ...baseSession,
    gates: baseSession.gates.map((g) => (g.id === 'client-to-certifier' ? { ...g, requiresCheck: false } : g)),
  };
  expectCode(validateProcess(project, weakensCheck, { parentReview: checkedReview }).errors.map((e) => e.code), 'session_weakens_check');

  // 4. Widening private drafts to lane-shared.
  const widensDrafts: ProcessConfig = {
    ...baseSession,
    lanes: baseSession.lanes.map((l) => (l.id === 'client' ? { ...l, defaultDraftVisibility: 'lane' } : l)),
  };
  expectCode(validateProcess(project, widensDrafts, { parentReview: review }).errors.map((e) => e.code), 'session_widens_drafts');

  // 5. Widening partner lane party matrix from separated to open.
  const widensMatrix: ProcessConfig = {
    ...baseSession,
    lanes: baseSession.lanes.map((l) => (l.id === 'partner' ? { ...l, partyVisibility: { mode: 'open' } } : l)),
  };
  expectCode(validateProcess(project, widensMatrix, { parentReview: review }).errors.map((e) => e.code), 'session_widens_party_matrix');

  // 6. Exposing checker edits that parent review keeps hidden.
  const widensCheckerVis: ProcessConfig = {
    ...baseSession,
    gates: baseSession.gates.map((g) =>
      g.id === 'client-to-certifier' && g.checkerPowers
        ? { ...g, checkerPowers: { ...g.checkerPowers, originatorSeesEdits: true } }
        : g,
    ),
  };
  expectCode(
    validateProcess(project, widensCheckerVis, { parentReview: review }).errors.map((e) => e.code),
    'session_widens_checker_visibility',
  );

  // authorizeAction('process.update') blocks saving a widening session config.
  const updateDecision = authorizeAction(
    { type: 'process.update', level: 'session', nextProcess: widensRoutes },
    { actorUserId: 'cert_lead', project, process: baseSession, parentReview: review, state: createPolicyState() },
  );
  assert.equal(updateDecision.ok, false);
  assert.equal(updateDecision.reason.code, 'invalid_config');
});
