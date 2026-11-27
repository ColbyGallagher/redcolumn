import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createPolicyState,
  DEFAULT_STATUS_TRANSITIONS,
  DEFAULT_STATUSES,
  executeAction,
  presets,
  runScenario,
  validateProcess,
  viewAs,
  type ProjectConfig,
} from './index.ts';
import { singleTeamScenario, threeSidedScenario, twoSidedScenario } from '../test/scenarios/index.ts';

for (const scenario of [singleTeamScenario, twoSidedScenario, threeSidedScenario]) {
  test(`scenario passes: ${scenario.name}`, () => {
    const validation = validateProcess(scenario.project, scenario.process, { checkProjectAdmin: true });
    assert.deepEqual(validation.errors, [], `scenario process failed validation: ${JSON.stringify(validation.errors)}`);

    const result = runScenario(scenario);
    assert.deepEqual(
      result.failures,
      [],
      `scenario "${scenario.id}" failed:\n${result.failures.map((f) => `  step ${f.stepIndex + 1} (${f.stepName}): ${f.message}`).join('\n')}`,
    );
    assert.equal(result.ok, true);
    assert.equal(result.stepsRun, scenario.steps.length);
  });
}

test('three-sided variant with originatorSeesEdits=true lets client see certifier edits', () => {
  const process = {
    ...threeSidedScenario.process,
    gates: threeSidedScenario.process.gates.map((g) =>
      g.id === 'client-to-certifier' && g.checkerPowers
        ? { ...g, checkerPowers: { ...g.checkerPowers, originatorSeesEdits: true } }
        : g,
    ),
  };
  let state = createPolicyState();
  const exec = (n: number) => ({ project: threeSidedScenario.project, process, now: n * 1000, opSeq: n * 10 });
  state = executeAction(state, 'clara', { type: 'createIssue', id: 'c1', title: 'Client wording' }, exec(1)).state;
  state = executeAction(state, 'clara', { type: 'release', gateId: 'client-to-certifier', toLaneIds: ['certifier'], items: [{ kind: 'issue', id: 'c1' }] }, exec(2)).state;
  state = executeAction(state, 'victor', { type: 'editIssue', id: 'c1', title: 'Certifier edited wording' }, exec(3)).state;

  assert.equal(viewAs('clara', threeSidedScenario.project, process, state).issues.c1?.title, 'Certifier edited wording');
  assert.equal(viewAs('devon', threeSidedScenario.project, process, state).issues.c1, undefined);
});

test('bulk release reports per-item success and failure independently with one batchId', () => {
  let state = createPolicyState();
  const { project, process } = twoSidedScenario;
  const exec = (n: number) => ({ project, process, now: n * 1000, opSeq: n * 10 });

  state = executeAction(state, 'nia', { type: 'createIssue', id: 'c1', title: 'Valid item 1' }, exec(1)).state;
  state = executeAction(state, 'nia', { type: 'createIssue', id: 'c2', title: 'Valid item 2' }, exec(2)).state;

  const bulk = executeAction(
    state,
    'owen',
    {
      type: 'release',
      gateId: 'client-to-firm',
      toLaneIds: ['firm'],
      bulk: true,
      items: [
        { kind: 'issue', id: 'c1' },
        { kind: 'issue', id: 'missing_item' },
        { kind: 'issue', id: 'c2' },
      ],
    },
    exec(3),
  );

  assert.equal(bulk.ok, true);
  assert.ok(bulk.batchId);
  assert.equal(bulk.itemResults?.length, 3);
  assert.equal(bulk.itemResults?.[0]?.ok, true);
  assert.equal(bulk.itemResults?.[1]?.ok, false);
  assert.equal(bulk.itemResults?.[2]?.ok, true);

  const firmView = viewAs('leo', project, process, bulk.state);
  assert.equal(firmView.issues.c1?.number, 1);
  assert.equal(firmView.issues.c2?.number, 2);
});

test('tickClosesIssue=true closes an issue when an authorized closer ticks it', () => {
  const project: ProjectConfig = {
    id: 'p_tick',
    parties: [{ id: 'team', name: 'Harbor Structural', contractRole: 'internal' }],
    groups: [],
    members: [
      { userId: 'mgr', partyId: 'team', groupIds: [], state: 'active' },
      { userId: 'des', partyId: 'team', groupIds: [], state: 'active' },
    ],
    statuses: DEFAULT_STATUSES,
    statusTransitions: DEFAULT_STATUS_TRANSITIONS,
    defaultClosing: { allowedClosers: [{ kind: 'user', id: 'mgr' }] },
    grants: [],
    roles: [
      { subject: { kind: 'user', id: 'mgr' }, role: 'review_coordinator', level: 'project', gateIds: '*', transitions: '*' },
      { subject: { kind: 'user', id: 'des' }, role: 'reviewer', level: 'project' },
    ],
  };
  const process = presets.singleTeam({
    id: 'r_tick',
    members: [{ kind: 'party', id: 'team' }],
    allowedClosers: [{ kind: 'user', id: 'mgr' }],
    tickClosesIssue: true,
  });
  const exec = (n: number) => ({ project, process, now: n * 1000, opSeq: n * 10 });
  const created = executeAction(createPolicyState(), 'mgr', { type: 'createIssue', id: 'i1', title: 'Detail check' }, exec(1));
  assert.ok(created.ok);

  // Designer cannot tick because tickClosesIssue is true and designer is not in the closer list.
  const desTick = executeAction(created.state, 'des', { type: 'tickIssue', id: 'i1', checked: true }, exec(2));
  assert.equal(desTick.ok, false);

  // Manager ticks and the issue closes automatically.
  const mgrTick = executeAction(created.state, 'mgr', { type: 'tickIssue', id: 'i1', checked: true, revisionSeenId: 'revA' }, exec(3));
  assert.ok(mgrTick.ok);
  assert.equal(viewAs('des', project, process, mgrTick.state).issues.i1?.status, 'closed');
  assert.equal(viewAs('des', project, process, mgrTick.state).issues.i1?.checked, true);
});
