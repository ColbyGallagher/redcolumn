import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROTOCOL_VERSION } from '@nb/ops';
import {
  authorizeOp,
  computeItemAudiences,
  createPolicyState,
  DEFAULT_STATUS_TRANSITIONS,
  DEFAULT_STATUSES,
  executeAction,
  metaOf,
  presets,
  viewAs,
  type DraftVisibility,
  type ItemMeta,
  type PolicyState,
  type ProcessConfig,
  type ProjectConfig,
  type ProjectMember,
} from './index.ts';

// Deterministic seeded PRNG (Mulberry32): zero external dependencies.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)]!;
}

// --- Simple, independent reference model of "who sees which version" ---

interface RefVersion {
  rev: number;
  title: string;
  /** Lane that authored this version (origin lane for normal edits; checking lane for checker edits). */
  authoredByLane: string;
  /** If created by a cross-lane checker and originatorSeesEdits is true. */
  visibleToOriginator?: boolean;
}

interface RefIssue {
  id: string;
  originLaneId: string;
  ownerUserId: string;
  ownerPartyId: string | null;
  draftVisibility: DraftVisibility;
  checkerUserIds: Set<string>;
  versions: Map<number, RefVersion>;
  /** Per lane id, set of rev numbers released to that lane. */
  releasedToLane: Map<string, Set<number>>;
  /** Per lane id, status seen by that lane. */
  statusByLane: Map<string, string>;
  initialStatus: string;
}

interface RefModel {
  issues: Map<string, RefIssue>;
  laneOfUser: Map<string, string>;
  partyOfUser: Map<string, string | null>;
  activeUsers: Set<string>;
  separatedPartner: boolean;
}

/**
 * Simple, obviously-correct reference visibility rule:
 * A user sees an issue iff they are active AND at least one version `v` is visible to them via:
 *   (a) draft access: user is in origin lane and (user is author or assigned checker) on an origin-lane version
 *   (b) lane internal access: user is in `v.authoredByLane` and (either `v` is a checker edit in their lane,
 *       or `draftVisibility === 'lane'` and the party matrix allows `(viewerParty, ownerParty)`)
 *   (c) released access: `v.rev` was explicitly released to user's lane, OR `v.visibleToOriginator` and user is in origin lane.
 * They see the highest visible `rev`.
 */
function referenceVisibleRev(ref: RefModel, userId: string, issue: RefIssue): number | null {
  if (!ref.activeUsers.has(userId)) return null;
  const userLane = ref.laneOfUser.get(userId);
  if (!userLane) return null;
  const userParty = ref.partyOfUser.get(userId) ?? null;

  let best: number | null = null;
  const consider = (rev: number): void => {
    if (best === null || rev > best) best = rev;
  };

  for (const v of issue.versions.values()) {
    const isOriginVersion = v.authoredByLane === issue.originLaneId;
    if (isOriginVersion && userLane === issue.originLaneId) {
      if (issue.draftVisibility === 'private') {
        if (userId === issue.ownerUserId || issue.checkerUserIds.has(userId)) consider(v.rev);
      } else {
        // Party matrix check in partner lane when separated (lead='partner', subs='sub_a','sub_b').
        const blockedByMatrix =
          ref.separatedPartner &&
          userLane === 'partner' &&
          userParty !== null &&
          issue.ownerPartyId !== null &&
          userParty !== issue.ownerPartyId &&
          userParty !== 'partner' &&
          issue.ownerPartyId !== 'partner';
        if (!blockedByMatrix) consider(v.rev);
      }
    }
    if (!isOriginVersion && userLane === v.authoredByLane) {
      consider(v.rev);
    }
    if (v.visibleToOriginator && userLane === issue.originLaneId) {
      consider(v.rev);
    }
    if (issue.releasedToLane.get(userLane)?.has(v.rev)) {
      consider(v.rev);
    }
  }
  return best;
}

function buildRandomFixture(rng: () => number): {
  project: ProjectConfig;
  process: ProcessConfig;
  ref: RefModel;
  users: string[];
  originatorSeesEdits: boolean;
} {
  const clientDraft: DraftVisibility = rng() < 0.5 ? 'private' : 'lane';
  const partnerDraft: DraftVisibility = rng() < 0.5 ? 'private' : 'lane';
  const separatedPartner = rng() < 0.5;
  const originatorSeesEdits = rng() < 0.5;

  const members: ProjectMember[] = [
    { userId: 'c_rev', partyId: 'client', groupIds: ['cg'], state: 'active' },
    { userId: 'c_lead', partyId: 'client', groupIds: ['cg', 'c_check'], state: 'active' },
    { userId: 'c_peer', partyId: 'client', groupIds: ['cg'], state: 'active' },
    { userId: 'cert_lead', partyId: 'cert', groupIds: ['certg'], state: 'active' },
    { userId: 'p_lead', partyId: 'partner', groupIds: ['pg'], state: 'active' },
    { userId: 'p_sub_a', partyId: 'sub_a', groupIds: ['pg'], state: 'active' },
    { userId: 'p_sub_b', partyId: 'sub_b', groupIds: ['pg'], state: 'active' },
    { userId: 'outsider', partyId: 'partner', groupIds: [], state: 'removed' },
  ];

  const project: ProjectConfig = {
    id: 'prop_proj',
    parties: [
      { id: 'client', name: 'Client Co', contractRole: 'client' },
      { id: 'cert', name: 'Cert Co', contractRole: 'certifier' },
      { id: 'partner', name: 'Partner Lead', contractRole: 'contractor' },
      { id: 'sub_a', name: 'Sub A', contractRole: 'subconsultant' },
      { id: 'sub_b', name: 'Sub B', contractRole: 'subconsultant' },
    ],
    groups: [
      { id: 'cg', name: 'Client Group', partyId: 'client' },
      { id: 'c_check', name: 'Client Checkers', partyId: 'client' },
      { id: 'certg', name: 'Cert Group', partyId: 'cert' },
      { id: 'pg', name: 'Partner Group', partyId: 'partner' },
    ],
    members,
    statuses: DEFAULT_STATUSES,
    statusTransitions: DEFAULT_STATUS_TRANSITIONS,
    defaultClosing: { allowedClosers: [{ kind: 'lane', id: 'certifier' }] },
    grants: [],
    roles: [
      { subject: { kind: 'user', id: 'cert_lead' }, role: 'project_admin', level: 'project' },
      { subject: { kind: 'user', id: 'c_rev' }, role: 'reviewer', level: 'project', transitions: [{ from: 'open', to: 'actioned' }] },
      { subject: { kind: 'user', id: 'c_peer' }, role: 'reviewer', level: 'project' },
      { subject: { kind: 'user', id: 'c_lead' }, role: 'lead_reviewer', level: 'project', gateIds: ['client-to-certifier'], transitions: '*' },
      { subject: { kind: 'user', id: 'cert_lead' }, role: 'review_coordinator', level: 'project', gateIds: ['certifier-to-partner', 'certifier-to-client', 'certifier-to-both'], transitions: '*' },
      { subject: { kind: 'user', id: 'p_lead' }, role: 'lead_reviewer', level: 'project', gateIds: ['partner-to-certifier'], transitions: [{ from: 'open', to: 'actioned' }] },
      { subject: { kind: 'user', id: 'p_sub_a' }, role: 'reviewer', level: 'project' },
      { subject: { kind: 'user', id: 'p_sub_b' }, role: 'reviewer', level: 'project' },
    ],
  };

  const process = presets.threeSided({
    id: 'prop_rev',
    clientMembers: [{ kind: 'party', id: 'client' }],
    certifierMembers: [{ kind: 'party', id: 'cert' }],
    partnerMembers: [{ kind: 'party', id: 'partner' }, { kind: 'party', id: 'sub_a' }, { kind: 'party', id: 'sub_b' }],
    clientDraftVisibility: clientDraft,
    certifierDraftVisibility: 'lane',
    partnerDraftVisibility: partnerDraft,
    clientCheckers: [{ kind: 'group', id: 'c_check' }],
    partnerPartyVisibility: separatedPartner ? { mode: 'separated', leadPartyId: 'partner' } : { mode: 'open' },
    certifierPowers: { originatorSeesEdits, originatorMayOverride: { return: true, edit: false, delete: false } },
  });

  const laneOfUser = new Map<string, string>([
    ['c_rev', 'client'],
    ['c_lead', 'client'],
    ['c_peer', 'client'],
    ['cert_lead', 'certifier'],
    ['p_lead', 'partner'],
    ['p_sub_a', 'partner'],
    ['p_sub_b', 'partner'],
  ]);
  const partyOfUser = new Map<string, string | null>(members.map((m) => [m.userId, m.partyId]));
  const activeUsers = new Set(members.filter((m) => m.state === 'active').map((m) => m.userId));

  return {
    project,
    process,
    originatorSeesEdits,
    users: members.map((m) => m.userId),
    ref: {
      issues: new Map(),
      laneOfUser,
      partyOfUser,
      activeUsers,
      separatedPartner,
    },
  };
}

/** Verifies every actor's `viewAs` matches the independent reference model and audience invariants. */
function assertMatchesReference(
  seed: number,
  step: number,
  state: PolicyState,
  project: ProjectConfig,
  process: ProcessConfig,
  ref: RefModel,
  users: readonly string[],
): void {
  for (const userId of users) {
    const view = viewAs(userId, project, process, state);

    // Inactive users always see an empty view.
    if (!ref.activeUsers.has(userId)) {
      assert.equal(Object.keys(view.issues).length, 0, `seed=${seed} step=${step} inactive ${userId} saw issues`);
      assert.equal(view.counts.totalIssues, 0);
      continue;
    }

    const userLane = ref.laneOfUser.get(userId)!;

    // Presence isolation: nobody from another lane ever appears.
    for (const pUser of view.presenceUserIds) {
      assert.equal(ref.laneOfUser.get(pUser), userLane, `seed=${seed} step=${step} presence leaked across lanes`);
    }

    // Compare visible issues & exact visible version against reference model.
    for (const [issueId, refIssue] of ref.issues) {
      const expectedRev = referenceVisibleRev(ref, userId, refIssue);
      const actual = view.issues[issueId];

      if (expectedRev === null) {
        assert.equal(
          actual,
          undefined,
          `seed=${seed} step=${step} user=${userId} unexpectedly saw hidden issue ${issueId}`,
        );
        // Hostile probe uniformity: status.transition on this hidden issue must match nonexistent id.
        const hiddenDec = authorizeOp(
          {
            opId: `probe_h_${step}`,
            schemaVersion: PROTOCOL_VERSION,
            streamId: process.id,
            type: 'status.transition',
            entityId: `se_h_${step}`,
            payload: { issueId, from: 'open', to: 'actioned' },
          },
          { actorUserId: userId, project, process, state },
        );
        const missingDec = authorizeOp(
          {
            opId: `probe_m_${step}`,
            schemaVersion: PROTOCOL_VERSION,
            streamId: process.id,
            type: 'status.transition',
            entityId: `se_m_${step}`,
            payload: { issueId: 'never_existed_id', from: 'open', to: 'actioned' },
          },
          { actorUserId: userId, project, process, state },
        );
        const norm = (x: unknown): string => JSON.stringify(x, (k, v) => (k === 'id' ? '<id>' : v));
        assert.equal(norm(hiddenDec), norm(missingDec), `seed=${seed} step=${step} error uniformity violated`);
      } else {
        assert.ok(actual, `seed=${seed} step=${step} user=${userId} missed visible issue ${issueId}`);
        // Note: issue.number bumps rev by 1 without changing title; compare visible title & owner!
        const expectedTitle = refIssue.versions.get(expectedRev)?.title;
        if (expectedTitle !== undefined) {
          assert.equal(
            actual.title,
            expectedTitle,
            `seed=${seed} step=${step} user=${userId} issue=${issueId} saw wrong version title`,
          );
        }
        assert.equal(actual.owner.userId, refIssue.ownerUserId, `owner must never change`);
        // Audience rows consistency: every visible item must have at least one matching audience row.
        const meta: ItemMeta | undefined = metaOf(state, 'issue', issueId);
        assert.ok(meta);
        const audiences = computeItemAudiences(meta);
        const hasAudience =
          audiences.access.some((r) => r.laneId === userLane && r.versionRev === actual.rev) ||
          audiences.draftAccess.some((r) => r.versionRev === actual.rev);
        assert.equal(hasAudience, true, `seed=${seed} step=${step} visible issue lacks backing audience row`);
      }
    }

    // No extra issues outside ref.issues.
    for (const id of Object.keys(view.issues)) {
      assert.ok(ref.issues.has(id), `seed=${seed} step=${step} unexpected issue ${id}`);
    }
  }
}

test('property test: 150 seeded random operation sequences match the reference model in every lane', () => {
  const SEEDS = 150;
  const STEPS_PER_SEED = 30;
  let totalStepsChecked = 0;

  for (let seed = 1; seed <= SEEDS; seed++) {
    const rng = mulberry32(seed * 7919 + 17);
    const { project, process, ref, users, originatorSeesEdits } = buildRandomFixture(rng);
    let state = createPolicyState(['c_rev', 'c_lead', 'cert_lead', 'p_lead', 'p_sub_a']);
    let issueSeq = 0;

    for (let step = 1; step <= STEPS_PER_SEED; step++) {
      const exec = { project, process, now: step * 1000, opSeq: step * 100 };
      const issueIds = [...ref.issues.keys()];
      const roll = rng();

      if (issueIds.length === 0 || roll < 0.25) {
        // Create an issue in client, certifier or partner lane.
        const creator = pick(rng, ['c_rev', 'c_lead', 'cert_lead', 'p_lead', 'p_sub_a', 'p_sub_b']);
        const id = `i_${++issueSeq}`;
        const title = `S${seed}_${id}_v1`;
        const res = executeAction(state, creator, { type: 'createIssue', id, title }, exec);
        if (res.ok) {
          state = res.state;
          const originLane = ref.laneOfUser.get(creator)!;
          const laneCfg = process.lanes.find((l) => l.id === originLane)!;
          const draftVis = laneCfg.defaultDraftVisibility ?? process.defaultDraftVisibility;
          const checkerUserIds = originLane === 'client' ? new Set(['c_lead']) : new Set<string>();
          const versions = new Map<number, RefVersion>([[1, { rev: 1, title, authoredByLane: originLane }]]);
          ref.issues.set(id, {
            id,
            originLaneId: originLane,
            ownerUserId: creator,
            ownerPartyId: ref.partyOfUser.get(creator) ?? null,
            draftVisibility: draftVis,
            checkerUserIds,
            versions,
            releasedToLane: new Map(),
            statusByLane: new Map([[originLane, 'open']]),
            initialStatus: 'open',
          });
        }
      } else if (roll < 0.5) {
        // Edit an issue (as author, same-lane lead, or certifier checker).
        const id = pick(rng, issueIds);
        const actor = pick(rng, ['c_rev', 'c_lead', 'cert_lead', 'p_lead', 'p_sub_a', 'p_sub_b']);
        const title = `S${seed}_${id}_edit_${step}`;
        const res = executeAction(state, actor, { type: 'editIssue', id, title }, exec);
        if (res.ok) {
          state = res.state;
          const updated = state.ops.issues[id]!;
          const refIssue = ref.issues.get(id)!;
          const actorLane = ref.laneOfUser.get(actor)!;
          const isCrossLane = actorLane !== refIssue.originLaneId;
          refIssue.versions.set(updated.rev, {
            rev: updated.rev,
            title,
            authoredByLane: actorLane,
            visibleToOriginator: isCrossLane ? originatorSeesEdits : undefined,
          });
        }
      } else if (roll < 0.78) {
        // Release through one of the configured gates.
        const id = pick(rng, issueIds);
        const route = pick(rng, [
          { actor: 'c_lead', gateId: 'client-to-certifier', to: ['certifier'] },
          { actor: 'cert_lead', gateId: 'certifier-to-partner', to: ['partner'] },
          { actor: 'cert_lead', gateId: 'certifier-to-client', to: ['client'] },
          { actor: 'cert_lead', gateId: 'certifier-to-both', to: ['client', 'partner'] },
        ]);
        const preRev = state.ops.issues[id]!.rev;
        const res = executeAction(
          state,
          route.actor,
          { type: 'release', gateId: route.gateId, toLaneIds: route.to, items: [{ kind: 'issue', id }] },
          exec,
        );
        if (res.ok) {
          state = res.state;
          const refIssue = ref.issues.get(id)!;
          for (const targetLane of route.to) {
            let set = refIssue.releasedToLane.get(targetLane);
            if (!set) {
              set = new Set();
              refIssue.releasedToLane.set(targetLane, set);
            }
            set.add(preRev);
          }
          // If numbering bumped rev, keep its title synced to the pre-number rev in ref model.
          const postIssue = state.ops.issues[id]!;
          if (postIssue.rev !== preRev && !refIssue.versions.has(postIssue.rev)) {
            const base = refIssue.versions.get(preRev);
            if (base) {
              refIssue.versions.set(postIssue.rev, {
                rev: postIssue.rev,
                title: base.title,
                authoredByLane: refIssue.originLaneId,
              });
            }
          }
        }
      } else if (roll < 0.9) {
        // Return or override an issue at the certifier gate.
        const id = pick(rng, issueIds);
        if (rng() < 0.6) {
          const res = executeAction(state, 'cert_lead', { type: 'returnItem', kind: 'issue', id, note: `Note ${step}` }, exec);
          if (res.ok) state = res.state;
        } else {
          const res = executeAction(state, 'c_lead', { type: 'overrideChecker', kind: 'issue', id, overrideKind: 'return' }, exec);
          if (res.ok) state = res.state;
        }
      } else {
        // Status transition in a lane.
        const id = pick(rng, issueIds);
        const actor = pick(rng, ['c_rev', 'c_lead', 'cert_lead', 'p_lead']);
        const to = pick(rng, ['actioned', 'answered', 'closed']);
        const res = executeAction(
          state,
          actor,
          { type: 'transitionStatus', issueId: id, to, revisionSeenId: to === 'closed' ? 'revA' : null },
          exec,
        );
        if (res.ok) {
          state = res.state;
          const lane = ref.laneOfUser.get(actor)!;
          ref.issues.get(id)!.statusByLane.set(lane, to);
        }
      }

      assertMatchesReference(seed, step, state, project, process, ref, users);
      totalStepsChecked++;
    }
  }

  assert.equal(totalStepsChecked, SEEDS * STEPS_PER_SEED);
});
