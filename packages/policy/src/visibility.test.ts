import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { PROTOCOL_VERSION } from '@nb/ops';
import {
  authorizeAction,
  authorizeOp,
  canActorSeeItem,
  canActorSeeVersion,
  compileLaneMembers,
  compilePartyVisibility,
  computeItemAudiences,
  createPolicyState,
  DEFAULT_STATUS_TRANSITIONS,
  DEFAULT_STATUSES,
  executeAction,
  metaOf,
  presets,
  previewAccessChange,
  scanViewForCanaries,
  viewAs,
  viewAsPerspective,
  type ProjectConfig,
} from './index.ts';

function multiPartyProject(): ProjectConfig {
  return {
    id: 'proj_sub',
    parties: [
      { id: 'client', name: 'Civic Works', contractRole: 'client' },
      { id: 'lead_firm', name: 'Meridian Architects', contractRole: 'lead_consultant' },
      { id: 'sub_a', name: 'Redwood Structural', contractRole: 'subconsultant' },
      { id: 'sub_b', name: 'Bluebell Electrical', contractRole: 'subconsultant' },
    ],
    groups: [
      { id: 'client_review', name: 'Client Review', partyId: 'client' },
      { id: 'client_checkers', name: 'Client Checkers', partyId: 'client' },
    ],
    members: [
      { userId: 'proj_admin', partyId: 'lead_firm', groupIds: [], state: 'active' },
      { userId: 'c_rev', partyId: 'client', groupIds: ['client_review'], state: 'active' },
      { userId: 'c_checker', partyId: 'client', groupIds: ['client_review', 'client_checkers'], state: 'active' },
      { userId: 'c_other', partyId: 'client', groupIds: [], state: 'active' },
      { userId: 'lead_u', partyId: 'lead_firm', groupIds: [], state: 'active' },
      { userId: 'sub_a_u', partyId: 'sub_a', groupIds: [], state: 'active' },
      { userId: 'sub_b_u', partyId: 'sub_b', groupIds: [], state: 'active' },
    ],
    documentSets: [
      { id: 'ds_restricted', name: 'Restricted Set', members: [{ kind: 'user', id: 'c_rev' }, { kind: 'user', id: 'lead_u' }] },
    ],
    statuses: DEFAULT_STATUSES,
    statusTransitions: DEFAULT_STATUS_TRANSITIONS,
    defaultClosing: { allowedClosers: [{ kind: 'lane', id: 'client' }] },
    grants: [],
    roles: [
      { subject: { kind: 'user', id: 'proj_admin' }, role: 'project_admin', level: 'project' },
      { subject: { kind: 'user', id: 'c_rev' }, role: 'reviewer', level: 'project', transitions: '*' },
      { subject: { kind: 'user', id: 'c_checker' }, role: 'lead_reviewer', level: 'project', gateIds: ['client-to-firm'], transitions: '*' },
      { subject: { kind: 'user', id: 'c_other' }, role: 'reviewer', level: 'project' },
      { subject: { kind: 'user', id: 'lead_u' }, role: 'lead_reviewer', level: 'project', gateIds: ['firm-to-client'], transitions: '*' },
      { subject: { kind: 'user', id: 'sub_a_u' }, role: 'reviewer', level: 'project' },
      { subject: { kind: 'user', id: 'sub_b_u' }, role: 'reviewer', level: 'project' },
    ],
  };
}

test('project admin outside a lane cannot see that lane’s drafts or internal items', () => {
  const project = multiPartyProject();
  const process = presets.twoSided({
    id: 'r_walls',
    clientMembers: [{ kind: 'party', id: 'client' }],
    firmMembers: [{ kind: 'party', id: 'lead_firm' }, { kind: 'party', id: 'sub_a' }, { kind: 'party', id: 'sub_b' }],
    clientDraftVisibility: 'private',
    clientCheckers: [{ kind: 'group', id: 'client_checkers' }],
  });

  const created = executeAction(
    createPolicyState(['proj_admin', 'c_rev', 'c_checker']),
    'c_rev',
    { type: 'createIssue', id: 'i1', title: 'CANARY_PRIVATE_DRAFT' },
    { project, process, now: 1000, opSeq: 1 },
  );
  assert.ok(created.ok);
  const state = created.state;
  const meta = metaOf(state, 'issue', 'i1')!;

  // Audience rows: private draft produces item_draft_access rows for author + assigned checker group, no item_access rows.
  const audiences = computeItemAudiences(meta);
  assert.equal(audiences.access.length, 0);
  assert.deepEqual(
    audiences.draftAccess.map((r) => r.subject),
    [{ kind: 'user', id: 'c_rev' }, { kind: 'group', id: 'client_checkers' }],
  );

  // Author and assigned checker see it; other client lane member and project admin in firm lane see NOTHING.
  assert.equal(canActorSeeItem('c_rev', meta, project, process), true);
  assert.equal(canActorSeeItem('c_checker', meta, project, process), true);
  assert.equal(canActorSeeItem('c_other', meta, project, process), false);
  assert.equal(canActorSeeItem('proj_admin', meta, project, process), false);

  const adminView = viewAs('proj_admin', project, process, state);
  assert.equal(adminView.counts.totalIssues, 0);
  assert.deepEqual(scanViewForCanaries(adminView, ['CANARY_PRIVATE_DRAFT', 'i1', 'c_rev']), []);
});

test('separated party visibility matrix isolates sibling subconsultants while lead sees all', () => {
  const project = multiPartyProject();
  const process = presets.twoSided({
    id: 'r_matrix',
    clientMembers: [{ kind: 'party', id: 'client' }],
    firmMembers: [{ kind: 'party', id: 'lead_firm' }, { kind: 'party', id: 'sub_a' }, { kind: 'party', id: 'sub_b' }],
    firmDraftVisibility: 'lane',
    firmPartyVisibility: { mode: 'separated', leadPartyId: 'lead_firm' },
  });

  // Compile DB-ready lane_members and party_visibility rows.
  const laneRows = compileLaneMembers(process);
  assert.equal(laneRows.length, 4);
  const pvRows = compilePartyVisibility(process, project);
  const hasPair = (viewer: string, owner: string): boolean =>
    pvRows.some((r) => r.laneId === 'firm' && r.viewerPartyId === viewer && r.ownerPartyId === owner);
  assert.equal(hasPair('lead_firm', 'sub_a'), true);
  assert.equal(hasPair('lead_firm', 'sub_b'), true);
  assert.equal(hasPair('sub_a', 'lead_firm'), true);
  assert.equal(hasPair('sub_a', 'sub_a'), true);
  assert.equal(hasPair('sub_a', 'sub_b'), false);
  assert.equal(hasPair('sub_b', 'sub_a'), false);

  // sub_a creates a comment in firm lane: lead_u and sub_a_u see it; sub_b_u does NOT.
  const created = executeAction(
    createPolicyState(),
    'sub_a_u',
    { type: 'createIssue', id: 'i_sub_a', title: 'CANARY_SUB_A Footing pad clash' },
    { project, process, now: 1000, opSeq: 1 },
  );
  assert.ok(created.ok);
  const state = created.state;

  assert.ok(viewAs('sub_a_u', project, process, state).issues.i_sub_a);
  assert.ok(viewAs('lead_u', project, process, state).issues.i_sub_a);
  const subBView = viewAs('sub_b_u', project, process, state);
  assert.equal(subBView.issues.i_sub_a, undefined);
  assert.deepEqual(scanViewForCanaries(subBView, ['CANARY_SUB_A', 'i_sub_a']), []);

  // Synthetic perspective preview ("view as" party) matches real user view.
  const subAPersp = viewAsPerspective({ laneId: 'firm', partyId: 'sub_a' }, project, process, state);
  const subBPersp = viewAsPerspective({ laneId: 'firm', partyId: 'sub_b' }, project, process, state);
  assert.ok(subAPersp.issues.i_sub_a);
  assert.equal(subBPersp.issues.i_sub_a, undefined);
});

test('document set restriction blocks non-members even if they are in a lane', () => {
  const project = multiPartyProject();
  const process = {
    ...presets.twoSided({
      id: 'r_docset',
      clientMembers: [{ kind: 'party', id: 'client' }],
      firmMembers: [{ kind: 'party', id: 'lead_firm' }],
      clientDraftVisibility: 'lane',
    }),
    documentSetId: 'ds_restricted',
  };
  const created = executeAction(
    createPolicyState(),
    'c_rev',
    { type: 'createIssue', id: 'i1', title: 'Restricted sheet note' },
    { project, process, now: 1000, opSeq: 1 },
  );
  assert.ok(created.ok);
  // c_rev is in ds_restricted -> sees i1; c_other is in client lane but NOT in ds_restricted -> sees nothing.
  assert.ok(viewAs('c_rev', project, process, created.state).issues.i1);
  assert.equal(viewAs('c_other', project, process, created.state).counts.totalIssues, 0);
});

test('released versions are frozen; withdrawal marks withdrawn without erasing; draft edits stay hidden', () => {
  const project = multiPartyProject();
  const process = presets.twoSided({
    id: 'r_ver',
    clientMembers: [{ kind: 'party', id: 'client' }],
    firmMembers: [{ kind: 'party', id: 'lead_firm' }],
    clientDraftVisibility: 'private',
    clientCheckers: [{ kind: 'group', id: 'client_checkers' }],
  });

  let state = executeAction(
    createPolicyState(),
    'c_rev',
    { type: 'createIssue', id: 'i1', title: 'v1 text' },
    { project, process, now: 1000, opSeq: 1 },
  ).state;
  state = executeAction(state, 'c_checker', { type: 'editIssue', id: 'i1', title: 'v2 released text' }, { project, process, now: 2000, opSeq: 10 }).state;
  state = executeAction(state, 'c_checker', { type: 'release', gateId: 'client-to-firm', toLaneIds: ['firm'], items: [{ kind: 'issue', id: 'i1' }] }, { project, process, now: 3000, opSeq: 20 }).state;

  const meta = metaOf(state, 'issue', 'i1')!;
  // Numbering on the first crossing adds rev 3: rev 2's wording plus the issue number. The firm sees
  // that revision, NEVER rev 1 (draft).
  assert.equal(canActorSeeVersion('lead_u', meta, 3, project, process), true);
  assert.equal(canActorSeeVersion('lead_u', meta, 1, project, process), false);
  assert.equal(viewAs('lead_u', project, process, state).issues.i1?.title, 'v2 released text');
  assert.equal(viewAs('lead_u', project, process, state).issues.i1?.number, 1);

  // An amendment after the release stays in the client lane, and withdrawing must not publish it.
  state = executeAction(state, 'c_checker', { type: 'editIssue', id: 'i1', title: 'SECRET_DRAFT_V4' }, { project, process, now: 3500, opSeq: 25 }).state;

  // Deleting a released item is refused; withdrawing is allowed.
  const delAttempt = executeAction(state, 'c_checker', { type: 'deleteItem', kind: 'issue', id: 'i1' }, { project, process, now: 4000, opSeq: 30 });
  assert.equal(delAttempt.ok, false);
  assert.equal(delAttempt.error && 'code' in delAttempt.error && delAttempt.error.code, 'invalid_state');

  const withdrawn = executeAction(state, 'c_checker', { type: 'withdraw', kind: 'issue', id: 'i1', laneIds: ['firm'] }, { project, process, now: 5000, opSeq: 40 });
  assert.ok(withdrawn.ok);
  const firmView = viewAs('lead_u', project, process, withdrawn.state);
  assert.equal(firmView.issues.i1?.withdrawn, true);
  assert.equal(firmView.issues.i1?.title, 'v2 released text');
  assert.equal(firmView.issues.i1?.rev, 3);
  assert.deepEqual(scanViewForCanaries(firmView, ['SECRET_DRAFT_V4']), []);
  assert.equal(firmView.counts.totalIssues, 0);
});

test('previewAccessChange reports exactly who gains or loses visibility when lane membership changes', () => {
  const project = multiPartyProject();
  const beforeProcess = presets.twoSided({
    id: 'r_preview',
    clientMembers: [{ kind: 'user', id: 'c_rev' }, { kind: 'user', id: 'c_checker' }],
    firmMembers: [{ kind: 'party', id: 'lead_firm' }],
    clientDraftVisibility: 'lane',
  });
  const state = executeAction(
    createPolicyState(),
    'c_rev',
    { type: 'createIssue', id: 'i1', title: 'Internal note' },
    { project, process: beforeProcess, now: 1000, opSeq: 1 },
  ).state;

  // Adding c_other to client lane and removing c_checker from client lane.
  const afterProcess = presets.twoSided({
    id: 'r_preview',
    clientMembers: [{ kind: 'user', id: 'c_rev' }, { kind: 'user', id: 'c_other' }],
    firmMembers: [{ kind: 'party', id: 'lead_firm' }],
    clientDraftVisibility: 'lane',
  });
  const diff = previewAccessChange(
    { project, process: beforeProcess },
    { project, process: afterProcess },
    state,
  );
  assert.deepEqual(diff.gained, [{ userId: 'c_other', itemKind: 'issue', itemId: 'i1' }]);
  assert.deepEqual(diff.lost, [{ userId: 'c_checker', itemKind: 'issue', itemId: 'i1' }]);
});

test('uniform error check: operations on hidden items match missing items byte-for-byte', () => {
  const project = multiPartyProject();
  const process = presets.twoSided({
    id: 'r_err',
    clientMembers: [{ kind: 'party', id: 'client' }],
    firmMembers: [{ kind: 'party', id: 'lead_firm' }],
    clientDraftVisibility: 'private',
  });
  const state = executeAction(
    createPolicyState(),
    'c_rev',
    { type: 'createIssue', id: 'hidden_i1', title: 'Secret' },
    { project, process, now: 1000, opSeq: 1 },
  ).state;

  const ops = [
    (id: string) => ({ opId: 'o1', schemaVersion: PROTOCOL_VERSION, streamId: 'r_err', type: 'issue.patch' as const, entityId: id, payload: { title: 'x' }, basedOn: { title: 0 } }),
    (id: string) => ({ opId: 'o2', schemaVersion: PROTOCOL_VERSION, streamId: 'r_err', type: 'issue.delete' as const, entityId: id, payload: {} }),
    (id: string) => ({ opId: 'o3', schemaVersion: PROTOCOL_VERSION, streamId: 'r_err', type: 'response.create' as const, entityId: 'resp_x', payload: { parent: { kind: 'issue' as const, id }, kind: 'reply' as const, body: 'hi' } }),
    (id: string) => ({ opId: 'o4', schemaVersion: PROTOCOL_VERSION, streamId: 'r_err', type: 'status.transition' as const, entityId: 'se_x', payload: { issueId: id, from: 'open', to: 'actioned' } }),
  ];

  for (const make of ops) {
    const onHidden = authorizeOp(make('hidden_i1'), { actorUserId: 'lead_u', project, process, state });
    const onMissing = authorizeOp(make('missing_99'), { actorUserId: 'lead_u', project, process, state });
    assert.equal(onHidden.ok, false);
    assert.equal(onMissing.ok, false);
    const norm = (x: unknown): string => JSON.stringify(x, (k, v) => (k === 'id' ? '<id>' : v));
    assert.equal(norm(onHidden), norm(onMissing));
    assert.equal(!onHidden.ok && onHidden.reason.code, 'not_found');
  }

  // Register export cannot target a lane the issuer is not in.
  const badExport = authorizeAction(
    { type: 'register.issue', audienceLaneIds: ['client'] },
    {
      actorUserId: 'lead_u',
      project: { ...project, roles: [...(project.roles ?? []), { subject: { kind: 'user', id: 'lead_u' }, role: 'document_controller', level: 'project' }] },
      process,
      state,
    },
  );
  assert.equal(badExport.ok, false);
  assert.equal(badExport.reason.code, 'forbidden');
});

test('library source files are pure TypeScript with no Node- or DOM-only imports', () => {
  const dir = new URL('.', import.meta.url);
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.ts') || name.endsWith('.test.ts')) continue;
    const text = readFileSync(new URL(name, dir), 'utf8');
    assert.equal(/\bfrom\s+['"]node:/.test(text), false, `${name} must not import node: modules`);
    assert.equal(
      /\b(window|document|Buffer)\s*\.\w|\bprocess\.(env|argv|cwd|exit|platform|versions)\b|\bnew\s+Function\b|\beval\s*\(/.test(text),
      false,
      `${name} must not reference Node/DOM globals or dynamic eval`,
    );
  }
});
