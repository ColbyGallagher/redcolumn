import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROTOCOL_VERSION } from '@nb/ops';
import {
  authorizeAction,
  canDelegateGrant,
  computeItemAudiences,
  createPolicyState,
  DEFAULT_STATUS_TRANSITIONS,
  DEFAULT_STATUSES,
  effectiveRolesForMember,
  executeAction,
  expandRoleAssignment,
  itemKey,
  metaOf,
  partyCanSeeInLane,
  presets,
  releaseBundle,
  scanViewForCanaries,
  validateProcess,
  viewAs,
  type ExecutionResult,
  type Grant,
  type ItemMeta,
  type LaneConfig,
  type PolicyState,
  type ProcessConfig,
  type ProjectConfig,
  type ScenarioAction,
  type ValidationCode,
} from './index.ts';
import { threeSidedScenario } from '../test/scenarios/index.ts';

// Regression tests: each one reproduces a way past a wall, the check gate or the delegation limits,
// and fails on the code before the fix. All firms and people are fictional.

/** Drives `executeAction` step by step, keeping state between steps. */
function harness(project: ProjectConfig, process: ProcessConfig) {
  let state: PolicyState = createPolicyState();
  let n = 0;
  return {
    get state(): PolicyState {
      return state;
    },
    set state(s: PolicyState) {
      state = s;
    },
    try(actor: string, action: ScenarioAction): ExecutionResult {
      n++;
      const res = executeAction(state, actor, action, { project, process, now: n * 1000, opSeq: n * 100 });
      if (res.ok) state = res.state;
      return res;
    },
    do(actor: string, action: ScenarioAction): void {
      const res = this.try(actor, action);
      assert.ok(res.ok, `${actor} ${JSON.stringify(action)} was refused: ${JSON.stringify(res.error)}`);
    },
    refused(actor: string, action: ScenarioAction, code?: string): void {
      const res = this.try(actor, action);
      assert.equal(res.ok, false, `${actor} ${JSON.stringify(action)} should be refused`);
      if (code) assert.equal(res.error && 'code' in res.error ? res.error.code : undefined, code);
    },
    view(userId: string) {
      return viewAs(userId, project, process, state);
    },
  };
}

// --- Two-sided fixture: Larch Council (client) and Fenwick Design (firm) ---

function twoSidedProject(): ProjectConfig {
  return {
    id: 'proj_larch',
    parties: [
      { id: 'larch', name: 'Larch Council', contractRole: 'client' },
      { id: 'fenwick', name: 'Fenwick Design', contractRole: 'lead_consultant' },
      { id: 'elsewhere', name: 'Quarry Surveys', contractRole: 'subconsultant' },
    ],
    groups: [
      { id: 'larch_team', name: 'Client Team', partyId: 'larch' },
      { id: 'larch_coord', name: 'Client Coordination', partyId: 'larch' },
      { id: 'fenwick_team', name: 'Design Team', partyId: 'fenwick' },
    ],
    members: [
      { userId: 'nia', partyId: 'larch', groupIds: ['larch_team'], state: 'active' },
      { userId: 'owen', partyId: 'larch', groupIds: ['larch_team'], state: 'active' },
      { userId: 'cora', partyId: 'larch', groupIds: ['larch_coord', 'larch_team'], state: 'active' },
      { userId: 'rhea', partyId: 'larch', groupIds: ['larch_team'], state: 'active' },
      { userId: 'gil', partyId: 'larch', groupIds: [], state: 'active' },
      { userId: 'priya', partyId: 'fenwick', groupIds: ['fenwick_team'], state: 'active' },
      { userId: 'leo', partyId: 'fenwick', groupIds: ['fenwick_team'], state: 'active' },
      { userId: 'zed', partyId: 'elsewhere', groupIds: [], state: 'active' },
    ],
    statuses: DEFAULT_STATUSES,
    statusTransitions: DEFAULT_STATUS_TRANSITIONS,
    defaultClosing: { allowedClosers: [{ kind: 'user', id: 'owen' }] },
    grants: [],
    roles: [
      { subject: { kind: 'user', id: 'owen' }, role: 'project_admin', level: 'project' },
      { subject: { kind: 'user', id: 'owen' }, role: 'document_controller', level: 'project' },
      { subject: { kind: 'user', id: 'owen' }, role: 'lead_reviewer', level: 'project', gateIds: ['client-to-firm'], transitions: '*' },
      { subject: { kind: 'user', id: 'nia' }, role: 'reviewer', level: 'project' },
      { subject: { kind: 'user', id: 'cora' }, role: 'review_coordinator', level: 'project', gateIds: ['client-to-firm'], transitions: '*' },
      { subject: { kind: 'user', id: 'rhea' }, role: 'reviewer', level: 'project' },
      { subject: { kind: 'user', id: 'rhea' }, role: 'responder', level: 'project', gateIds: ['client-to-firm'] },
      { subject: { kind: 'user', id: 'gil' }, role: 'lead_reviewer', level: 'project', gateIds: ['client-to-firm'] },
      { subject: { kind: 'user', id: 'priya' }, role: 'responder', level: 'project', gateIds: ['firm-to-client'] },
      { subject: { kind: 'user', id: 'priya' }, role: 'reviewer', level: 'project' },
      { subject: { kind: 'user', id: 'leo' }, role: 'reviewer', level: 'project' },
    ],
  };
}

function twoSidedProcess(opts: Partial<Parameters<typeof presets.twoSided>[0]> = {}): ProcessConfig {
  return presets.twoSided({
    id: 'rev_larch',
    clientMembers: [{ kind: 'party', id: 'larch' }],
    firmMembers: [{ kind: 'party', id: 'fenwick' }],
    clientDraftVisibility: 'lane',
    firmDraftVisibility: 'lane',
    ...opts,
  });
}

const release = (gateId: string | null, toLaneIds: string[], id: string, kind: 'issue' | 'response' = 'issue', rev?: number): ScenarioAction => ({
  type: 'release',
  gateId,
  toLaneIds,
  items: [rev === undefined ? { kind, id } : { kind, id, rev }],
});

// --- Withdrawal ---

test('withdrawing an item never publishes the origin lane’s unreleased amendment', () => {
  const h = harness(twoSidedProject(), twoSidedProcess());
  h.do('owen', { type: 'createIssue', id: 'i1', title: 'Stair nosing contrast', revisionId: 'revA' });
  h.do('owen', release('client-to-firm', ['firm'], 'i1'));
  h.do('owen', { type: 'editIssue', id: 'i1', title: 'SECRET_DRAFT_V2' });
  h.do('owen', { type: 'withdraw', kind: 'issue', id: 'i1', laneIds: ['firm'] });

  const firm = h.view('priya');
  assert.equal(firm.issues.i1?.title, 'Stair nosing contrast');
  assert.equal(firm.issues.i1?.withdrawn, true);
  assert.deepEqual(scanViewForCanaries(firm, ['SECRET_DRAFT_V2']), []);
  // The withdrawal history entry names the revision the firm had, not the hidden amendment.
  const entry = firm.issues.i1!.history.find((e) => e.action === 'withdraw')!;
  assert.equal(entry.rev, firm.issues.i1!.rev);
});

test('withdrawing from a lane that never received the item is refused and shows it nothing', () => {
  const h = harness(twoSidedProject(), twoSidedProcess());
  h.do('owen', { type: 'createIssue', id: 'i2', title: 'SECRET_NEVER_RELEASED' });
  h.refused('owen', { type: 'withdraw', kind: 'issue', id: 'i2', laneIds: ['firm'] }, 'invalid_state');
  assert.equal(h.view('priya').issues.i2, undefined);
  assert.deepEqual(scanViewForCanaries(h.view('priya'), ['SECRET_NEVER_RELEASED']), []);
});

test('audience rows never come from a withdrawal record', () => {
  const meta: ItemMeta = {
    kind: 'issue',
    id: 'x1',
    scopeId: 'rev_larch',
    originLaneId: 'client',
    owner: { userId: 'owen', partyId: 'larch', groupId: null },
    draftVisibility: 'private',
    checkingState: 'withdrawn',
    assignedCheckers: [],
    releasesByLane: {
      firm: [{ releaseId: 'w1', rev: 3, fromLaneId: 'client', gateId: null, at: 1, by: { userId: 'owen', partyId: 'larch', groupId: null }, withdrawn: true }],
    },
    latestRev: 3,
    history: [],
  };
  assert.deepEqual(computeItemAudiences(meta).access.filter((r) => r.laneId === 'firm'), []);
});

// --- Releasing: the exact revision, and only one's own lane's items ---

test('a receiving lane cannot release an item to itself and pull in the origin lane’s amendment', () => {
  const h = harness(twoSidedProject(), twoSidedProcess());
  h.do('owen', { type: 'createIssue', id: 'i1', title: 'Handrail height' });
  h.do('owen', release('client-to-firm', ['firm'], 'i1'));
  h.do('owen', { type: 'editIssue', id: 'i1', title: 'SECRET_DRAFT_V2' });

  // The hidden current revision is reported exactly like a missing item.
  h.refused('priya', release(null, ['firm'], 'i1'), 'not_found');
  const rev = h.state.ops.issues.i1!.rev;
  h.refused('priya', release(null, ['firm'], 'i1', 'issue', rev), 'not_found');
  assert.equal(h.view('priya').issues.i1?.title, 'Handrail height');
  assert.deepEqual(scanViewForCanaries(h.view('priya'), ['SECRET_DRAFT_V2']), []);
});

test('a lane can share only its own items with itself, even at a revision it can see', () => {
  const h = harness(twoSidedProject(), twoSidedProcess());
  h.do('owen', { type: 'createIssue', id: 'i1', title: 'Door swing clash' });
  h.do('owen', release('client-to-firm', ['firm'], 'i1'));
  h.refused('priya', release(null, ['firm'], 'i1'), 'forbidden');
  // Someone with no release grant cannot share with their lane either (sharing on creation is off).
  h.do('leo', { type: 'createIssue', id: 'f1', title: 'Firm note' });
  h.refused('leo', release(null, ['firm'], 'f1'), 'forbidden');
  h.do('priya', { type: 'createIssue', id: 'f2', title: 'Firm note 2' });
  h.do('priya', release(null, ['firm'], 'f2'));
});

test('sharing with one’s own lane does not get past a separated party matrix', () => {
  const project: ProjectConfig = {
    ...twoSidedProject(),
    parties: [...twoSidedProject().parties, { id: 'sub_x', name: 'Ash Acoustics', contractRole: 'subconsultant' }, { id: 'sub_y', name: 'Birch Fire', contractRole: 'subconsultant' }],
    members: [
      ...twoSidedProject().members,
      { userId: 'sx', partyId: 'sub_x', groupIds: [], state: 'active' },
      { userId: 'sy', partyId: 'sub_y', groupIds: [], state: 'active' },
    ],
    roles: [
      ...(twoSidedProject().roles ?? []),
      { subject: { kind: 'user', id: 'sx' }, role: 'reviewer', level: 'project' },
      { subject: { kind: 'user', id: 'sx' }, role: 'responder', level: 'project', gateIds: ['firm-to-client'] },
      { subject: { kind: 'user', id: 'sy' }, role: 'reviewer', level: 'project' },
    ],
  };
  const process = twoSidedProcess({
    firmMembers: [{ kind: 'party', id: 'fenwick' }, { kind: 'party', id: 'sub_x' }, { kind: 'party', id: 'sub_y' }],
    firmPartyVisibility: { mode: 'separated', leadPartyId: 'fenwick' },
  });
  const h = harness(project, process);
  h.do('sx', { type: 'createIssue', id: 'sx1', title: 'SECRET_SUB_X_NOTE' });
  assert.equal(h.view('sy').issues.sx1, undefined);
  h.do('sx', release(null, ['firm'], 'sx1'));
  assert.equal(h.view('sy').issues.sx1, undefined, 'a sibling subconsultant must not see it');
  assert.equal(h.view('priya').issues.sx1?.title, 'SECRET_SUB_X_NOTE', 'the lead party sees it');
});

test('a lane forwarding an item may only pass on a revision it received', () => {
  const { project, process } = threeSidedScenario;
  const h = harness(project, process);
  h.do('clara', { type: 'createIssue', id: 'c1', title: 'Kerb ramp gradient' });
  h.do('clara', release('client-to-certifier', ['certifier'], 'c1'));
  h.do('clara', { type: 'editIssue', id: 'c1', title: 'SECRET_CLIENT_AMENDMENT' });
  h.refused('victor', release('certifier-to-partner', ['partner'], 'c1'), 'not_found');
  assert.equal(h.view('devon').issues.c1, undefined);
  assert.deepEqual(scanViewForCanaries(h.view('devon'), ['SECRET_CLIENT_AMENDMENT']), []);
});

// --- Linked markups ---

test('releasing an issue never releases another lane’s linked markup or a hidden markup revision', () => {
  const project = twoSidedProject();
  const process = twoSidedProcess();
  const h = harness(project, process);
  h.do('owen', { type: 'createIssue', id: 'i1', title: 'Ceiling void access', revisionId: 'revA' });
  h.do('owen', release('client-to-firm', ['firm'], 'i1'));
  assert.equal(h.view('priya').markups.i1_m?.content.text, 'Ceiling void access');

  // The firm raises its own issue and links the client's markup to it.
  h.do('priya', { type: 'createIssue', id: 'f1', title: 'Firm follow-up' });
  const f1 = h.state.ops.issues.f1!;
  const linked = { ...f1, markupIds: [...f1.markupIds, 'i1_m'] };
  h.state = {
    ...h.state,
    ops: { ...h.state.ops, issues: { ...h.state.ops.issues, f1: linked } },
    versions: { ...h.state.versions, [itemKey('issue', 'f1')]: { [f1.rev]: linked } },
  };

  // The client amends its markup, which stays private to the client lane.
  h.do('owen', { type: 'editIssue', id: 'i1', title: 'SECRET_MARKUP_V2' });
  const ctx = { actorUserId: 'priya', project, process, state: h.state };
  assert.deepEqual(releaseBundle([{ kind: 'issue', id: 'f1', rev: f1.rev }], ctx), []);

  const before = metaOf(h.state, 'markup', 'i1_m')!.releasesByLane;
  h.do('priya', release(null, ['firm'], 'f1'));
  assert.deepEqual(metaOf(h.state, 'markup', 'i1_m')!.releasesByLane, before, 'the client markup gains no release');
  assert.equal(h.view('priya').markups.i1_m?.content.text, 'Ceiling void access');
  assert.deepEqual(scanViewForCanaries(h.view('priya'), ['SECRET_MARKUP_V2']), []);
});

test('an issue’s own-lane markup and placement travel with it at the revision the releaser sees', () => {
  const project = twoSidedProject();
  const process = twoSidedProcess({ clientDraftVisibility: 'private' });
  const h = harness(project, process);
  h.do('nia', { type: 'createIssue', id: 'i1', title: 'Riser fire stopping', revisionId: 'revA' });
  h.do('nia', { type: 'editIssue', id: 'i1', title: 'Riser fire stopping at L2' });
  const ctx = { actorUserId: 'nia', project, process, state: h.state };
  const bundle = releaseBundle([{ kind: 'issue', id: 'i1', rev: h.state.ops.issues.i1!.rev }], ctx);
  assert.deepEqual(
    bundle.map((b) => `${b.kind}:${b.id}@${b.rev}`).sort(),
    ['markup:i1_m@2', 'placement:i1_m_p_revA@1'],
  );
  // A lane member who cannot see the private draft bundles nothing of it.
  assert.deepEqual(releaseBundle([{ kind: 'issue', id: 'i1', rev: 2 }], { ...ctx, actorUserId: 'rhea' }), []);
});

// --- The check gate ---

test('a gate that requires checking accepts only a revision a checker approved', () => {
  const project = twoSidedProject();
  const process = twoSidedProcess({ clientRequiresCheck: true, clientCheckers: [{ kind: 'user', id: 'owen' }] });
  assert.ok(!validateProcess(project, process).errors.some((e) => e.code === 'no_checker_for_gate'));
  const h = harness(project, process);

  // A coordinator (submit + release, no check.review) cannot get past the gate by submitting.
  h.do('cora', { type: 'createIssue', id: 'i1', title: 'Lift pit drainage', revisionId: 'revA' });
  h.refused('cora', release('client-to-firm', ['firm'], 'i1'), 'invalid_state');
  h.do('cora', { type: 'submit', kind: 'issue', id: 'i1' });
  h.refused('cora', release('client-to-firm', ['firm'], 'i1'), 'invalid_state');
  // Nor after a checker returns it.
  h.do('owen', { type: 'returnItem', kind: 'issue', id: 'i1', note: 'Add the pump rating' });
  h.refused('cora', release('client-to-firm', ['firm'], 'i1'), 'invalid_state');
  assert.equal(h.view('priya').issues.i1, undefined);

  // Only a checker can approve; then the approved revision (and its markup) may cross.
  h.refused('cora', { type: 'approve', kind: 'issue', id: 'i1' }, 'forbidden');
  h.do('owen', { type: 'approve', kind: 'issue', id: 'i1' });
  h.do('cora', release('client-to-firm', ['firm'], 'i1'));
  assert.equal(h.view('priya').issues.i1?.title, 'Lift pit drainage');
  assert.equal(h.view('priya').markups.i1_m?.content.text, 'Lift pit drainage');

  // An amendment needs a fresh approval.
  h.do('owen', { type: 'editIssue', id: 'i1', title: 'Lift pit drainage (pump 2)' });
  h.refused('cora', release('client-to-firm', ['firm'], 'i1'), 'invalid_state');
  h.do('owen', { type: 'approve', kind: 'issue', id: 'i1' });
  h.do('cora', release('client-to-firm', ['firm'], 'i1'));
  assert.equal(h.view('priya').issues.i1?.title, 'Lift pit drainage (pump 2)');

  // A responder (submit own + release) cannot submit their way past the gate either.
  h.do('rhea', { type: 'createIssue', id: 'i2', title: 'Plant room louvre' });
  h.do('rhea', { type: 'submit', kind: 'issue', id: 'i2' });
  h.refused('rhea', release('client-to-firm', ['firm'], 'i2'), 'invalid_state');
});

// --- Cross-lane checker gate ---

function threeSidedToResponse() {
  const { project, process } = threeSidedScenario;
  const h = harness(project, process);
  h.do('clara', { type: 'createIssue', id: 'c1', title: 'Culvert headwall' });
  h.do('clara', release('client-to-certifier', ['certifier'], 'c1'));
  h.do('victor', release('certifier-to-partner', ['partner'], 'c1'));
  h.do('devon', { type: 'respond', id: 'r1', parent: { kind: 'issue', id: 'c1' }, body: 'Headwall detail revised' });
  h.do('devon', release('partner-to-certifier', ['certifier'], 'r1', 'response'));
  return h;
}

test('a caller-supplied gate id never grants checker powers from a gate the item did not come through', () => {
  const h = threeSidedToResponse();
  h.refused('victor', { type: 'deleteItem', kind: 'response', id: 'r1' });
  h.refused('victor', { type: 'returnItem', kind: 'response', id: 'r1', gateId: 'client-to-certifier' }, 'forbidden');
  h.refused('victor', { type: 'deleteItem', kind: 'response', id: 'r1' });
  assert.notEqual(metaOf(h.state, 'response', 'r1')!.checkingState, 'stopped');
  assert.equal(h.view('victor').responses.r1?.body, 'Headwall detail revised');

  // A gate id that disagrees with the real arrival gate is refused; the real one (or none) works.
  h.refused('victor', { type: 'returnItem', kind: 'issue', id: 'c1', gateId: 'partner-to-certifier' }, 'forbidden');
  h.do('victor', { type: 'returnItem', kind: 'issue', id: 'c1' });
  assert.equal(metaOf(h.state, 'issue', 'c1')!.checkedByGateId, 'client-to-certifier');
});

test('cross-lane checker powers need check.review covering the receiving lane, not just a release grant', () => {
  const { process } = threeSidedScenario;
  const project: ProjectConfig = { ...threeSidedScenario.project, grants: [] };
  const h = harness(project, process);
  h.do('clara', { type: 'createIssue', id: 'c1', title: 'Pavement crossfall' });
  h.do('clara', release('client-to-certifier', ['certifier'], 'c1'));
  // Victor holds release grants and the coordinator role, but no check.review.
  h.refused('victor', { type: 'editIssue', id: 'c1', title: 'Certifier wording' }, 'forbidden');
  h.refused('victor', { type: 'returnItem', kind: 'issue', id: 'c1' }, 'forbidden');
  h.refused('victor', { type: 'deleteItem', kind: 'issue', id: 'c1' });
  // A group-scoped check.review does not reach items that arrive from another lane either.
  const groupScoped: ProjectConfig = {
    ...project,
    grants: [{ subject: { kind: 'user', id: 'victor' }, level: 'project', action: 'check.review', scope: 'group' }],
  };
  const h2 = harness(groupScoped, process);
  h2.do('clara', { type: 'createIssue', id: 'c1', title: 'Pavement crossfall' });
  h2.do('clara', release('client-to-certifier', ['certifier'], 'c1'));
  h2.refused('victor', { type: 'editIssue', id: 'c1', title: 'Certifier wording' }, 'forbidden');
});

// --- Delegation ---

test('delegation can never widen member scope, process levels, level or scope id', () => {
  const coordinator = expandRoleAssignment({ subject: { kind: 'user', id: 'cora' }, role: 'review_coordinator', level: 'project', gateIds: ['client-to-firm'] });
  const g = (over: Partial<Grant>): Grant => ({ subject: { kind: 'user', id: 'nia' }, level: 'project', action: 'comment.create', ...over });

  assert.equal(canDelegateGrant(coordinator, g({ action: 'members.manage', memberScope: 'any' })), false);
  assert.equal(canDelegateGrant(coordinator, g({ action: 'members.manage', memberScope: 'review' })), true);
  assert.equal(canDelegateGrant(coordinator, g({ action: 'members.manage', memberScope: 'party' })), true);
  assert.equal(canDelegateGrant(coordinator, g({ action: 'process.change', processLevels: ['project'] })), false);
  assert.equal(canDelegateGrant(coordinator, g({ action: 'process.change', processLevels: ['review', 'session'] })), true);

  // A session-level coordinator can only delegate inside its own session.
  const sessionCoord = expandRoleAssignment({ subject: { kind: 'user', id: 'cora' }, role: 'review_coordinator', level: 'session', scopeId: 's1' });
  assert.equal(canDelegateGrant(sessionCoord, g({})), false);
  assert.equal(canDelegateGrant(sessionCoord, g({ level: 'review', scopeId: 'r1' })), false);
  assert.equal(canDelegateGrant(sessionCoord, g({ level: 'session', scopeId: 's2' })), false);
  assert.equal(canDelegateGrant(sessionCoord, g({ level: 'session', scopeId: 's1' })), true);
  // A review-level coordinator may delegate in its review and that review's sessions only.
  const reviewCoord = expandRoleAssignment({ subject: { kind: 'user', id: 'cora' }, role: 'review_coordinator', level: 'review', scopeId: 'r1' });
  const scopes = { parentReviewOf: (s: string) => (s === 's1' ? 'r1' : 'r9') };
  assert.equal(canDelegateGrant(reviewCoord, g({ level: 'review', scopeId: 'r1' }), scopes), true);
  assert.equal(canDelegateGrant(reviewCoord, g({ level: 'review', scopeId: 'r2' }), scopes), false);
  assert.equal(canDelegateGrant(reviewCoord, g({ level: 'session', scopeId: 's1' }), scopes), true);
  assert.equal(canDelegateGrant(reviewCoord, g({ level: 'session', scopeId: 's7' }), scopes), false);
  // A review-level `members.manage: any` holder is still bound to its review.
  const reviewAdmin: Grant[] = [{ subject: { kind: 'user', id: 'cora' }, level: 'review', scopeId: 'r1', action: 'members.manage', memberScope: 'any' }];
  assert.equal(canDelegateGrant(reviewAdmin, g({})), false);

  // Item scopes other than `any` do not nest: `lane` does not include `party`.
  const laneEditor: Grant[] = [
    { subject: { kind: 'user', id: 'cora' }, level: 'project', action: 'members.manage', memberScope: 'party' },
    { subject: { kind: 'user', id: 'cora' }, level: 'project', action: 'comment.edit', scope: 'lane' },
  ];
  assert.equal(canDelegateGrant(laneEditor, g({ action: 'comment.edit', scope: 'party' })), false);
  assert.equal(canDelegateGrant(laneEditor, g({ action: 'comment.edit', scope: 'own' })), true);
});

test('a coordinator cannot make themselves a project admin', () => {
  const project = twoSidedProject();
  const process = twoSidedProcess();
  const next: ProjectConfig = {
    ...project,
    roles: [...(project.roles ?? []), { subject: { kind: 'user', id: 'cora' }, role: 'project_admin', level: 'project' }],
  };
  const res = authorizeAction(
    { type: 'members.manage', targetUserId: 'cora', nextProject: next },
    { actorUserId: 'cora', project, process, state: createPolicyState() },
  );
  assert.equal(res.ok, false);
  assert.equal(!res.ok && res.reason.code, 'forbidden');
});

// --- Party matrix with party-less members ---

test('a party-less member or item gets no free pass through a separated or custom matrix', () => {
  const project: ProjectConfig = {
    ...twoSidedProject(),
    parties: [
      { id: 'alpha', name: 'Alder Partners', contractRole: 'lead_consultant' },
      { id: 'beta', name: 'Beech Civil', contractRole: 'subconsultant' },
      { id: 'gamma', name: 'Cedar Lighting', contractRole: 'subconsultant' },
    ],
  };
  const separated: LaneConfig = {
    id: 'delivery',
    name: 'Delivery',
    members: [{ kind: 'party', id: 'alpha' }, { kind: 'party', id: 'beta' }, { kind: 'party', id: 'gamma' }],
    partyVisibility: { mode: 'separated', leadPartyId: 'alpha' },
  };
  assert.equal(partyCanSeeInLane(separated, project, null, 'beta'), false);
  assert.equal(partyCanSeeInLane(separated, project, 'beta', null), false);
  assert.equal(partyCanSeeInLane(separated, project, null, 'alpha'), true);
  assert.equal(partyCanSeeInLane(separated, project, 'alpha', null), true);
  assert.equal(partyCanSeeInLane(separated, project, null, null), true);
  const custom: LaneConfig = { ...separated, partyVisibility: { mode: 'custom', pairs: [{ viewerPartyId: 'beta', ownerPartyId: 'gamma' }] } };
  assert.equal(partyCanSeeInLane(custom, project, null, 'gamma'), false);
  assert.equal(partyCanSeeInLane(custom, project, 'beta', null), false);
  assert.equal(partyCanSeeInLane(custom, project, 'beta', 'gamma'), true);
});

test('the validator rejects custom party pairs that name a party outside the lane', () => {
  const project = twoSidedProject();
  const process = twoSidedProcess({ firmPartyVisibility: { mode: 'custom', pairs: [{ viewerPartyId: 'fenwick', ownerPartyId: 'elsewhere' }] } });
  assert.ok(validateProcess(project, process).errors.some((e) => e.code === 'invalid_party_matrix'));
});

// --- Sessions widening their review ---

test('a session cannot widen checker powers, add checkers, or drop the review’s document set', () => {
  const project: ProjectConfig = {
    ...threeSidedScenario.project,
    documentSets: [{ id: 'ds_civil', name: 'Civil set' }],
  };
  const review: ProcessConfig = { ...threeSidedScenario.process, documentSetId: 'ds_civil' };
  const base: ProcessConfig = { ...review, id: 'sess_1', kind: 'session', parentReviewId: review.id };
  assert.deepEqual(validateProcess(project, base, { parentReview: review }).errors, []);
  const codes = (session: ProcessConfig): ValidationCode[] =>
    validateProcess(project, session, { parentReview: review }).errors.map((e) => e.code);
  const withGate = (id: string, change: (g: ProcessConfig['gates'][number]) => ProcessConfig['gates'][number]): ProcessConfig => ({
    ...base,
    gates: base.gates.map((g) => (g.id === id ? change(g) : g)),
  });

  const powers = review.gates.find((g) => g.id === 'client-to-certifier')!.checkerPowers!;
  assert.ok(codes(withGate('certifier-to-partner', (g) => ({ ...g, checkerPowers: powers }))).includes('session_widens_checker_powers'));
  const narrowReview: ProcessConfig = {
    ...review,
    gates: review.gates.map((g) => (g.id === 'client-to-certifier' ? { ...g, checkerPowers: { ...powers, delete: false } } : g)),
  };
  const turnsOnDelete = validateProcess(project, { ...base, gates: review.gates }, { parentReview: narrowReview }).errors.map((e) => e.code);
  assert.ok(turnsOnDelete.includes('session_widens_checker_powers'));
  assert.ok(codes(withGate('client-to-certifier', (g) => ({ ...g, checkers: [{ kind: 'user', id: 'clara' }] }))).includes('session_widens_checkers'));
  assert.ok(codes({ ...base, documentSetId: null }).includes('session_widens_document_set'));
  // Narrowing is fine.
  assert.deepEqual(codes(withGate('client-to-certifier', (g) => ({ ...g, checkerPowers: { ...powers, editWording: false } }))), []);
});

// --- process.update ---

test('process.update works out the level from the process and cannot skip the parent review check', () => {
  const project: ProjectConfig = {
    ...threeSidedScenario.project,
    grants: [
      ...threeSidedScenario.project.grants,
      { subject: { kind: 'user', id: 'clara' }, level: 'project', action: 'process.change', processLevels: ['session'] },
    ],
  };
  const review = threeSidedScenario.process;
  const state = createPolicyState();
  // A session-only holder cannot change a review by calling it a session.
  const asSession = authorizeAction({ type: 'process.update', level: 'session', nextProcess: review }, { actorUserId: 'clara', project, process: review, state });
  assert.equal(asSession.ok, false);
  const derived = authorizeAction({ type: 'process.update', nextProcess: review }, { actorUserId: 'clara', project, process: review, state });
  assert.equal(!derived.ok && derived.reason.code, 'forbidden');
  // The process id cannot change.
  const renamed = authorizeAction({ type: 'process.update', nextProcess: { ...review, id: 'other' } }, { actorUserId: 'victor', project, process: review, state });
  assert.equal(!renamed.ok && renamed.reason.code, 'invalid_state');

  // A session update without its parent review is refused rather than skipping the widening check.
  const session: ProcessConfig = { ...review, id: 'sess_1', kind: 'session', parentReviewId: review.id };
  const widened: ProcessConfig = { ...session, autoReleaseOnCreate: true };
  const noParent = authorizeAction({ type: 'process.update', nextProcess: widened }, { actorUserId: 'clara', project, process: session, state });
  assert.equal(noParent.ok, false);
  assert.equal(!noParent.ok && noParent.reason.code, 'invalid_config');
  assert.ok(!noParent.ok && noParent.reason.code === 'invalid_config' && noParent.reason.issues.some((i) => i.code === 'missing_parent_review'));
  const withParent = authorizeAction({ type: 'process.update', nextProcess: widened }, { actorUserId: 'clara', project, process: session, parentReview: review, state });
  assert.ok(!withParent.ok && withParent.reason.code === 'invalid_config' && withParent.reason.issues.some((i) => i.code === 'session_widens_drafts'));
  const fine = authorizeAction({ type: 'process.update', nextProcess: session }, { actorUserId: 'clara', project, process: session, parentReview: review, state });
  assert.equal(fine.ok, true);
});

// --- members.manage scoping ---

test('members.manage keeps to the manager’s party or review and to the target member', () => {
  const base = twoSidedProject();
  const project: ProjectConfig = {
    ...base,
    grants: [{ subject: { kind: 'user', id: 'priya' }, level: 'project', action: 'members.manage', memberScope: 'party' }],
  };
  const process = twoSidedProcess();
  const state = createPolicyState();
  const ctx = (actorUserId: string) => ({ actorUserId, project, process, state });
  const removing = (userId: string): ProjectConfig => ({
    ...project,
    members: project.members.map((m) => (m.userId === userId ? { ...m, state: 'removed' as const } : m)),
  });

  // A party manager cannot manage another party's member by leaving the party out.
  const otherParty = authorizeAction({ type: 'members.manage', targetUserId: 'nia', nextProject: removing('nia') }, ctx('priya'));
  assert.equal(!otherParty.ok && otherParty.reason.code, 'forbidden');
  assert.equal(authorizeAction({ type: 'members.manage', targetUserId: 'leo', nextProject: removing('leo') }, ctx('priya')).ok, true);
  // Nor by claiming the target's party is their own.
  const claimed = authorizeAction({ type: 'members.manage', targetUserId: 'nia', targetPartyId: 'fenwick', nextProject: removing('nia') }, ctx('priya'));
  assert.equal(claimed.ok, false);

  // A review manager can manage people taking part in the review, not anyone else.
  assert.equal(authorizeAction({ type: 'members.manage', targetUserId: 'leo', nextProject: removing('leo') }, ctx('cora')).ok, true);
  const outsider = authorizeAction({ type: 'members.manage', targetUserId: 'zed', nextProject: removing('zed') }, ctx('cora'));
  assert.equal(!outsider.ok && outsider.reason.code, 'forbidden');

  // The change may only touch the target member.
  const sneaky: ProjectConfig = { ...removing('leo'), members: removing('leo').members.map((m) => (m.userId === 'nia' ? { ...m, state: 'removed' as const } : m)) };
  assert.equal(authorizeAction({ type: 'members.manage', targetUserId: 'leo', nextProject: sneaky }, ctx('cora')).ok, false);

  // The last-admin rule always applies, because the resulting project is required.
  const noAdmin = authorizeAction({ type: 'members.manage', targetUserId: 'owen', nextProject: removing('owen') }, ctx('owen'));
  assert.equal(!noAdmin.ok && noAdmin.reason.code, 'invalid_state');
});

// --- Review- and session-level roles without a scope id ---

test('a review-level role without a scope id applies nowhere, and the validator rejects it', () => {
  const project: ProjectConfig = {
    ...twoSidedProject(),
    roles: [...(twoSidedProject().roles ?? []), { subject: { kind: 'user', id: 'leo' }, role: 'lead_reviewer', level: 'review' }],
  };
  const process = twoSidedProcess();
  const leo = project.members.find((m) => m.userId === 'leo')!;
  assert.equal(effectiveRolesForMember(leo, project, process, ['firm']).has('lead_reviewer'), false);
  assert.ok(validateProcess(project, process).errors.some((e) => e.code === 'missing_scope_id'));
});

// --- View-as never falls back to the live record ---

test('view-as leaves an item out rather than showing the live record when a snapshot is missing', () => {
  const project = twoSidedProject();
  const process = twoSidedProcess();
  const h = harness(project, process);
  h.do('owen', { type: 'createIssue', id: 'i1', title: 'Glazing manifestation' });
  h.do('owen', release('client-to-firm', ['firm'], 'i1'));
  // A path that bumps the record without a snapshot, then records that revision as released.
  const rev = h.state.ops.issues.i1!.rev;
  h.do('owen', {
    type: 'rawOp',
    op: { opId: 'raw_1', schemaVersion: PROTOCOL_VERSION, streamId: process.id, type: 'issue.patch', entityId: 'i1', payload: { title: 'SECRET_LIVE_RECORD' }, basedOn: { title: h.state.ops.issues.i1!.versions.title?.v ?? 0 } },
  });
  const meta = metaOf(h.state, 'issue', 'i1')!;
  const by = meta.owner;
  h.state = {
    ...h.state,
    meta: {
      ...h.state.meta,
      [itemKey('issue', 'i1')]: {
        ...meta,
        latestRev: rev + 1,
        releasesByLane: { ...meta.releasesByLane, firm: [...(meta.releasesByLane.firm ?? []), { releaseId: 'x', rev: rev + 1, fromLaneId: 'client', gateId: 'client-to-firm', at: 9, by }] },
      },
    },
  };
  const firm = h.view('priya');
  assert.equal(firm.issues.i1, undefined);
  assert.deepEqual(scanViewForCanaries(firm, ['SECRET_LIVE_RECORD']), []);
});

// --- Carrying open issues to a new revision ---

test('carrying open issues skips what the actor cannot see and builds fresh placement metadata', () => {
  const project = twoSidedProject();
  const process = twoSidedProcess();
  const h = harness(project, process);
  h.do('priya', { type: 'createIssue', id: 'f1', title: 'SECRET_FIRM_DRAFT', revisionId: 'revA' });
  h.do('owen', { type: 'createIssue', id: 'i1', title: 'Soffit insulation', revisionId: 'revA' });
  h.do('owen', { type: 'editIssue', id: 'i1', title: 'Soffit insulation (100 mm)' });
  h.do('owen', release('client-to-firm', ['firm'], 'i1'));
  h.do('owen', { type: 'carryOpenToRevision', revisionId: 'revB' });

  assert.equal(h.state.ops.placements.f1_m_p_revB, undefined, 'a hidden issue is not carried');
  const pMeta = metaOf(h.state, 'placement', 'i1_m_p_revB')!;
  const pRev = h.state.ops.placements.i1_m_p_revB!.rev;
  assert.deepEqual(pMeta.releasesByLane.firm?.map((r) => r.rev), [pRev], 'released at the placement’s own revision');
  assert.equal(pMeta.history.length, 1);
  assert.equal(pMeta.kind, 'placement');
  assert.deepEqual(Object.keys(h.view('priya').placements).sort(), ['f1_m_p_revA', 'i1_m_p_revA', 'i1_m_p_revB']);
});

// --- Group scope ---

test('group scope covers one’s own items and every group the owner belongs to', () => {
  const project: ProjectConfig = {
    ...twoSidedProject(),
    members: twoSidedProject().members.map((m) => (m.userId === 'nia' ? { ...m, groupIds: ['larch_coord', 'larch_team'] } : m)),
  };
  const h = harness(project, twoSidedProcess());
  // Gil (lead reviewer, no groups) can edit his own issue.
  h.do('gil', { type: 'createIssue', id: 'g1', title: 'Rooflight upstand' });
  h.do('gil', { type: 'editIssue', id: 'g1', title: 'Rooflight upstand 150 mm' });
  // Owen (larch_team) can edit Nia's issue although her first group is larch_coord.
  h.do('nia', { type: 'createIssue', id: 'n1', title: 'Gutter outlet' });
  h.do('owen', { type: 'editIssue', id: 'n1', title: 'Gutter outlet size' });
});
