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
  type ExecutionResult,
  type GateConfig,
  type ItemMeta,
  type PolicyState,
  type ProcessConfig,
  type ProjectConfig,
  type ProjectMember,
  type ScenarioAction,
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

// --- An independent reference model ---
//
// The model keeps its own copy of every item's versions and release records, and decides for itself
// whether each action should be allowed, from the fixture's roles written out by hand below. It never
// reads the implementation's state: the test asserts that `executeAction` agrees with the model's
// allow/deny decision, then compares every user's `viewAs` (issues, markups, placements, responses,
// counts and history) with what the model says that user may see.

type Lane = 'client' | 'certifier' | 'partner';

interface RefVersion {
  text: string;
  /** Set when a checker in another lane wrote this version. */
  checker?: { lane: Lane; party: string | null; visibleToOriginator: boolean };
}

interface RefRelease {
  rev: number;
  withdrawn: boolean;
  gateId: string | null;
}

interface RefItem {
  kind: 'issue' | 'markup' | 'placement' | 'response';
  id: string;
  origin: Lane;
  owner: string;
  ownerParty: string | null;
  ownerGroups: readonly string[];
  draft: DraftVisibility;
  /** User ids with draft access besides the author (assigned checkers). */
  checkers: ReadonlySet<string>;
  versions: Map<number, RefVersion>;
  rev: number;
  releases: Map<Lane, RefRelease[]>;
  /** Issue number (issues only). */
  number: number | null;
  /** The companion markup (issues) or parent issue (responses); the markup of a placement. */
  linked: string | null;
}

interface RefUser {
  lane: Lane;
  party: string;
  groups: readonly string[];
  active: boolean;
}

interface RefModel {
  users: ReadonlyMap<string, RefUser>;
  items: Map<string, RefItem>;
  nextNumber: number;
  separatedPartner: boolean;
  originatorSeesEdits: boolean;
  gates: readonly GateConfig[];
}

const key = (kind: RefItem['kind'], id: string): string => `${kind}:${id}`;

/** The fixture's roles, written out by hand: who holds which grant (see `buildRandomFixture`). */
const ROLE = {
  /** `comment.create` */
  creates: new Set(['c_rev', 'c_peer', 'c_lead', 'cert_lead', 'p_lead', 'p_sub_a', 'p_sub_b']),
  /** `comment.edit` scope: `own` or `group`. */
  edit: new Map<string, 'own' | 'group'>([['c_rev', 'own'], ['c_peer', 'own'], ['c_lead', 'group'], ['p_lead', 'group'], ['p_sub_a', 'own'], ['p_sub_b', 'own']]),
  /** `comment.withdraw` scope. */
  withdraw: new Map<string, 'own' | 'group'>([['c_rev', 'own'], ['c_peer', 'own'], ['c_lead', 'group'], ['p_lead', 'group'], ['p_sub_a', 'own'], ['p_sub_b', 'own']]),
  /** `check.review` scope. */
  checkReview: new Map<string, 'group' | 'lane'>([['c_lead', 'group'], ['p_lead', 'group'], ['cert_lead', 'lane']]),
  /** `release` gate ids. */
  release: new Map<string, readonly string[]>([
    ['c_lead', ['client-to-certifier']],
    ['cert_lead', ['certifier-to-partner', 'certifier-to-client', 'certifier-to-both']],
    ['p_lead', ['partner-to-certifier']],
  ]),
  /** `response.create` (scope `any`). */
  responds: new Set(['c_rev', 'c_peer', 'c_lead', 'cert_lead', 'p_lead', 'p_sub_a', 'p_sub_b']),
};

function partyMatrixAllows(model: RefModel, lane: Lane, viewerParty: string | null, ownerParty: string | null): boolean {
  if (lane !== 'partner' || !model.separatedPartner) return true;
  return viewerParty === ownerParty || viewerParty === 'partner' || ownerParty === 'partner';
}

function activeReleasesOf(item: RefItem, lane: Lane): RefRelease[] {
  const out: RefRelease[] = [];
  for (const r of item.releases.get(lane) ?? []) {
    if (r.withdrawn) out.length = 0;
    else out.push(r);
  }
  return out;
}

/** Whether `userId` may see version `rev` of `item`, from the model's own rules. */
function refSeesRev(model: RefModel, userId: string, item: RefItem, rev: number): boolean {
  const u = model.users.get(userId);
  if (!u || !u.active) return false;
  const v = item.versions.get(rev);
  if (!v) return false;
  const inOrigin = u.lane === item.origin;
  if (v.checker) {
    if (u.lane === v.checker.lane && partyMatrixAllows(model, u.lane, u.party, v.checker.party)) return true;
    if (v.checker.visibleToOriginator && inOrigin && partyMatrixAllows(model, u.lane, u.party, item.ownerParty)) return true;
  } else if (inOrigin) {
    if (item.draft === 'lane' && partyMatrixAllows(model, u.lane, u.party, item.ownerParty)) return true;
    if (item.draft === 'private' && (userId === item.owner || item.checkers.has(userId))) return true;
  }
  // Released versions (withdrawal records never count). Sharing with the origin lane obeys its matrix.
  for (const r of item.releases.get(u.lane) ?? []) {
    if (r.withdrawn || r.rev !== rev) continue;
    if (!inOrigin || partyMatrixAllows(model, u.lane, u.party, item.ownerParty)) return true;
  }
  return false;
}

function refVisibleRev(model: RefModel, userId: string, item: RefItem): number | null {
  for (let rev = item.rev; rev >= 1; rev--) {
    if (refSeesRev(model, userId, item, rev)) return rev;
  }
  return null;
}

function refWithdrawnFor(model: RefModel, userId: string, item: RefItem): boolean {
  const lane = model.users.get(userId)!.lane;
  const records = item.releases.get(lane) ?? [];
  return records.length > 0 && records[records.length - 1]!.withdrawn;
}

const isReleasedAcross = (item: RefItem): boolean =>
  [...item.releases.entries()].some(([lane, recs]) => lane !== item.origin && recs.length > 0);

function sharesGroup(model: RefModel, userId: string, item: RefItem): boolean {
  const groups = model.users.get(userId)!.groups;
  return item.ownerGroups.some((g) => groups.includes(g));
}

function scopeCovers(model: RefModel, userId: string, scope: 'own' | 'group' | 'lane' | undefined, item: RefItem): boolean {
  if (scope === undefined) return false;
  if (userId === item.owner) return true;
  if (scope === 'group') return sharesGroup(model, userId, item);
  if (scope === 'lane') return model.users.get(userId)!.lane === item.origin;
  return false;
}

function isInternalChecker(model: RefModel, userId: string, item: RefItem): boolean {
  if (model.users.get(userId)!.lane !== item.origin) return false;
  return scopeCovers(model, userId, ROLE.checkReview.get(userId), item) || item.checkers.has(userId);
}

/** The gate through which a cross-lane checker in `lane` received `item` with `power`. */
function refCheckerGate(model: RefModel, userId: string, item: RefItem, power: 'editWording'): GateConfig | undefined {
  const u = model.users.get(userId)!;
  if (u.lane === item.origin) return undefined;
  const scope = ROLE.checkReview.get(userId);
  if (scope !== 'lane') return undefined;
  return model.gates.find(
    (g) =>
      g.fromLaneId === item.origin &&
      g.checkerPowers?.[power] === true &&
      g.toLaneIds.includes(u.lane) &&
      activeReleasesOf(item, u.lane).some((r) => r.gateId === g.id),
  );
}

const categoryOf = (kind: RefItem['kind']): 'comment' | 'response' => (kind === 'response' ? 'response' : 'comment');

function refFindGate(model: RefModel, gateId: string | null, from: Lane, to: readonly Lane[], category: 'comment' | 'response'): GateConfig | undefined {
  const fits = (g: GateConfig): boolean =>
    g.fromLaneId === from && g.itemKinds.includes(category) && to.every((t) => g.toLaneIds.includes(t));
  if (gateId !== null) {
    const g = model.gates.find((x) => x.id === gateId);
    return g && fits(g) ? g : undefined;
  }
  return model.gates.find(fits);
}

const holdsGate = (userId: string, gateId: string): boolean => (ROLE.release.get(userId) ?? []).includes(gateId);

/** The linked markups and placements that travel with `item` in a release by `userId`. */
function refBundle(model: RefModel, userId: string, item: RefItem): { item: RefItem; rev: number }[] {
  if (item.kind !== 'issue' || !item.linked) return [];
  const lane = model.users.get(userId)!.lane;
  const out: { item: RefItem; rev: number }[] = [];
  const markup = model.items.get(key('markup', item.linked));
  if (!markup || markup.origin !== lane) return out;
  const mRev = refVisibleRev(model, userId, markup);
  if (mRev === null) return out;
  out.push({ item: markup, rev: mRev });
  for (const p of model.items.values()) {
    if (p.kind !== 'placement' || p.linked !== markup.id || p.origin !== lane) continue;
    const pRev = refVisibleRev(model, userId, p);
    if (pRev !== null) out.push({ item: p, rev: pRev });
  }
  return out;
}

/** The model's own decision on a release; `null` means it must be refused. */
function refReleasePlan(
  model: RefModel,
  userId: string,
  item: RefItem,
  gateId: string | null,
  to: readonly Lane[],
): { rev: number; gateId: string | null; bundle: { item: RefItem; rev: number }[] } | null {
  const u = model.users.get(userId);
  if (!u || !u.active || to.length === 0) return null;
  if (!refSeesRev(model, userId, item, item.rev)) return null;
  const bundle = refBundle(model, userId, item);
  const everything = [{ item, rev: item.rev }, ...bundle];

  if (gateId === null && to.every((t) => t === u.lane)) {
    const laneGateIds = model.gates.filter((g) => g.fromLaneId === u.lane).map((g) => g.id);
    const holdsLaneGate = laneGateIds.some((id) => holdsGate(userId, id));
    const ok = everything.every(
      ({ item: it }) =>
        it.origin === u.lane &&
        (scopeCovers(model, userId, ROLE.edit.get(userId), it) ||
          scopeCovers(model, userId, ROLE.withdraw.get(userId), it) ||
          scopeCovers(model, userId, ROLE.checkReview.get(userId), it)),
    );
    return ok && holdsLaneGate ? { rev: item.rev, gateId: null, bundle } : null;
  }

  let recordedGate: string | null = null;
  for (const { item: it, rev } of everything) {
    const gate = refFindGate(model, gateId, u.lane, to, categoryOf(it.kind));
    if (!gate || !holdsGate(userId, gate.id)) return null;
    if (it === item) recordedGate = gate.id;
    if (it.origin !== u.lane) {
      const received = activeReleasesOf(it, u.lane);
      const ownEdit = it.versions.get(rev)?.checker?.lane === u.lane;
      if (!ownEdit && !received.some((r) => r.rev === rev)) return null;
      for (const r of received) {
        const arrival = model.gates.find((g) => g.id === r.gateId);
        if (arrival?.checkerPowers && !arrival.checkerPowers.approve) return null;
      }
    }
  }
  return { rev: item.rev, gateId: recordedGate, bundle };
}

function refApplyRelease(
  model: RefModel,
  item: RefItem,
  plan: NonNullable<ReturnType<typeof refReleasePlan>>,
  to: readonly Lane[],
): void {
  const record = (it: RefItem, rev: number, gateId: string | null): void => {
    for (const lane of to) {
      const list = it.releases.get(lane) ?? [];
      list.push({ rev, withdrawn: false, gateId });
      it.releases.set(lane, list);
    }
  };
  let rev = plan.rev;
  // Numbering on the first crossing adds a revision with the same wording, which is what is released.
  if (item.kind === 'issue' && item.number === null && to.some((l) => l !== item.origin)) {
    item.number = model.nextNumber++;
    item.rev += 1;
    item.versions.set(item.rev, { text: item.versions.get(rev)!.text });
    rev = item.rev;
  }
  record(item, rev, plan.gateId);
  for (const b of plan.bundle) {
    const gate = refFindGate(model, plan.gateId, b.item.origin, to, 'comment');
    record(b.item, b.rev, plan.gateId === null ? gate?.id ?? null : plan.gateId);
  }
}

function buildRandomFixture(rng: () => number): {
  project: ProjectConfig;
  process: ProcessConfig;
  model: RefModel;
  users: string[];
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
    grants: [{ subject: { kind: 'user', id: 'cert_lead' }, level: 'project', action: 'check.review', scope: 'lane' }],
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

  const laneOf: Record<string, Lane> = {
    c_rev: 'client', c_lead: 'client', c_peer: 'client', cert_lead: 'certifier',
    p_lead: 'partner', p_sub_a: 'partner', p_sub_b: 'partner', outsider: 'partner',
  };
  const users = new Map<string, RefUser>(
    members.map((m) => [m.userId, { lane: laneOf[m.userId]!, party: m.partyId!, groups: m.groupIds, active: m.state === 'active' }]),
  );
  return {
    project,
    process,
    users: members.map((m) => m.userId),
    model: { users, items: new Map(), nextNumber: 1, separatedPartner, originatorSeesEdits, gates: process.gates },
  };
}

function draftFor(lane: Lane, process: ProcessConfig): DraftVisibility {
  return process.lanes.find((l) => l.id === lane)!.defaultDraftVisibility ?? process.defaultDraftVisibility;
}

/** Verifies every user's `viewAs` matches the reference model. */
function assertMatchesReference(
  label: string,
  state: PolicyState,
  project: ProjectConfig,
  process: ProcessConfig,
  model: RefModel,
  users: readonly string[],
): void {
  for (const userId of users) {
    const view = viewAs(userId, project, process, state);
    const u = model.users.get(userId)!;
    const at = `${label} user=${userId}`;

    if (!u.active) {
      assert.equal(Object.keys(view.issues).length + Object.keys(view.markups).length + Object.keys(view.responses).length, 0, `${at} inactive user saw items`);
      continue;
    }

    for (const pUser of view.presenceUserIds) {
      assert.equal(model.users.get(pUser)?.lane, u.lane, `${at} presence leaked across lanes`);
    }

    const expected = { issues: 0, markups: 0, responses: 0 };
    const seenIds = { issue: new Set<string>(), markup: new Set<string>(), placement: new Set<string>(), response: new Set<string>() };
    for (const item of model.items.values()) {
      let rev = refVisibleRev(model, userId, item);
      // Placements show only under a visible markup; responses only under a visible issue.
      if (rev !== null && item.kind === 'placement' && refVisibleRev(model, userId, model.items.get(key('markup', item.linked!))!) === null) rev = null;
      if (rev !== null && item.kind === 'response' && refVisibleRev(model, userId, model.items.get(key('issue', item.linked!))!) === null) rev = null;
      const actual =
        item.kind === 'issue' ? view.issues[item.id] : item.kind === 'markup' ? view.markups[item.id] : item.kind === 'placement' ? view.placements[item.id] : view.responses[item.id];
      const what = `${at} ${item.kind}=${item.id}`;
      if (rev === null) {
        assert.equal(actual, undefined, `${what} must be hidden`);
        if (item.kind === 'issue') assertUniformNotFound(what, userId, item.id, project, process, state);
        continue;
      }
      assert.ok(actual, `${what} must be visible at rev ${rev}`);
      seenIds[item.kind].add(item.id);
      assert.equal(actual.rev, rev, `${what} visible revision`);
      const text = item.versions.get(rev)!.text;
      const withdrawn = refWithdrawnFor(model, userId, item);
      if (item.kind === 'issue') {
        const issue = view.issues[item.id]!;
        assert.equal(issue.title, text, `${what} title`);
        assert.equal(issue.number, item.number, `${what} number`);
        assert.equal(issue.owner.userId, item.owner, `${what} owner`);
        assert.equal(issue.withdrawn, withdrawn, `${what} withdrawn`);
        if (!withdrawn) expected.issues++;
        // History: only this lane's own entries, a withdrawal from this lane, or a visible checker edit.
        for (const entry of issue.history) {
          const ok =
            entry.laneId === u.lane ||
            (entry.action === 'withdraw' && entry.visibleToLaneIds.includes(u.lane) && refSeesRev(model, userId, item, entry.rev)) ||
            (entry.action === 'check_edit' && u.lane === item.origin && model.originatorSeesEdits);
          assert.ok(ok, `${what} history leaked ${JSON.stringify(entry)}`);
        }
      } else if (item.kind === 'markup') {
        assert.equal(view.markups[item.id]!.content.text, text, `${what} text`);
        assert.equal(view.markups[item.id]!.withdrawn, withdrawn, `${what} withdrawn`);
        if (!withdrawn) expected.markups++;
      } else if (item.kind === 'response') {
        assert.equal(view.responses[item.id]!.body, text, `${what} body`);
        assert.equal(view.responses[item.id]!.withdrawn, withdrawn, `${what} withdrawn`);
        if (!withdrawn) expected.responses++;
      }

      // Every visible version is backed by an audience row.
      const meta: ItemMeta | undefined = metaOf(state, item.kind, item.id);
      assert.ok(meta, `${what} has metadata`);
      const audiences = computeItemAudiences(meta);
      const backed =
        audiences.access.some((r) => r.laneId === u.lane && r.versionRev === rev) ||
        audiences.draftAccess.some((r) => r.versionRev === rev);
      assert.ok(backed, `${what} lacks a backing audience row`);
    }

    for (const id of Object.keys(view.issues)) assert.ok(seenIds.issue.has(id), `${at} unexpected issue ${id}`);
    for (const id of Object.keys(view.markups)) assert.ok(seenIds.markup.has(id), `${at} unexpected markup ${id}`);
    for (const id of Object.keys(view.placements)) assert.ok(seenIds.placement.has(id), `${at} unexpected placement ${id}`);
    for (const id of Object.keys(view.responses)) assert.ok(seenIds.response.has(id), `${at} unexpected response ${id}`);
    assert.equal(view.counts.totalIssues, expected.issues, `${at} counts.totalIssues`);
    assert.equal(view.counts.totalMarkups, expected.markups, `${at} counts.totalMarkups`);
    assert.equal(view.counts.totalResponses, expected.responses, `${at} counts.totalResponses`);
  }
}

/** A status change on a hidden issue is refused exactly as on an issue that never existed. */
function assertUniformNotFound(
  what: string,
  userId: string,
  issueId: string,
  project: ProjectConfig,
  process: ProcessConfig,
  state: PolicyState,
): void {
  const probe = (id: string) =>
    authorizeOp(
      { opId: 'probe', schemaVersion: PROTOCOL_VERSION, streamId: process.id, type: 'status.transition', entityId: 'se_probe', payload: { issueId: id, from: 'open', to: 'actioned' } },
      { actorUserId: userId, project, process, state },
    );
  const norm = (x: unknown): string => JSON.stringify(x, (k, v) => (k === 'id' ? '<id>' : v));
  assert.equal(norm(probe(issueId)), norm(probe('never_existed_id')), `${what} error uniformity`);
}

const ALL_USERS = ['c_rev', 'c_lead', 'c_peer', 'cert_lead', 'p_lead', 'p_sub_a', 'p_sub_b', 'outsider'];
const LANES: readonly Lane[] = ['client', 'certifier', 'partner'];

test('property test: seeded random sequences agree with an independent model on every decision and every view', () => {
  const SEEDS = 120;
  const STEPS_PER_SEED = 40;
  let totalSteps = 0;
  const outcomes = { allowed: 0, refused: 0 };

  for (let seed = 1; seed <= SEEDS; seed++) {
    const rng = mulberry32(seed * 7919 + 17);
    const { project, process, model, users } = buildRandomFixture(rng);
    let state = createPolicyState(['c_rev', 'c_lead', 'cert_lead', 'p_lead', 'p_sub_a']);
    let seq = 0;

    for (let step = 1; step <= STEPS_PER_SEED; step++) {
      const exec = { project, process, now: step * 1000, opSeq: step * 100 };
      const label = `seed=${seed} step=${step}`;
      const issues = [...model.items.values()].filter((i) => i.kind === 'issue');
      const responses = [...model.items.values()].filter((i) => i.kind === 'response');
      const actor = pick(rng, ALL_USERS);
      const u = model.users.get(actor)!;
      const roll = rng();

      let action: ScenarioAction;
      let allowed: boolean;
      let apply: (() => void) | null = null;

      if (issues.length === 0 || roll < 0.15) {
        // Create an issue with its companion markup and placement.
        const id = `i_${++seq}`;
        const title = `S${seed}_${id}_v1`;
        action = { type: 'createIssue', id, title, revisionId: 'revA' };
        allowed = u.active && ROLE.creates.has(actor);
        apply = () => {
          const draft = draftFor(u.lane, process);
          const checkers = new Set(u.lane === 'client' ? ['c_lead'] : []);
          const base = { origin: u.lane, owner: actor, ownerParty: u.party, ownerGroups: u.groups, draft, checkers, number: null };
          model.items.set(key('markup', `${id}_m`), { ...base, releases: new Map(), kind: 'markup', id: `${id}_m`, versions: new Map([[1, { text: title }]]), rev: 1, linked: null });
          model.items.set(key('placement', `${id}_m_p_revA`), { ...base, releases: new Map(), kind: 'placement', id: `${id}_m_p_revA`, versions: new Map([[1, { text: '' }]]), rev: 1, linked: `${id}_m` });
          model.items.set(key('issue', id), { ...base, releases: new Map(), kind: 'issue', id, versions: new Map([[1, { text: title }]]), rev: 1, linked: `${id}_m` });
        };
      } else if (roll < 0.35) {
        // Edit an issue's wording (author, lead, or a cross-lane checker).
        const issue = pick(rng, issues);
        const title = `S${seed}_${issue.id}_edit_${step}`;
        action = { type: 'editIssue', id: issue.id, title };
        const visible = u.active && refVisibleRev(model, actor, issue) !== null;
        let gate: GateConfig | undefined;
        if (!visible) allowed = false;
        else if (isReleasedAcross(issue) && u.lane !== issue.origin) {
          gate = refCheckerGate(model, actor, issue, 'editWording');
          allowed = gate !== undefined;
        } else {
          allowed =
            scopeCovers(model, actor, ROLE.edit.get(actor), issue) ||
            (!isReleasedAcross(issue) && isInternalChecker(model, actor, issue)) ||
            refCheckerGate(model, actor, issue, 'editWording') !== undefined;
          gate = u.lane !== issue.origin ? refCheckerGate(model, actor, issue, 'editWording') : undefined;
        }
        apply = () => {
          const checker = u.lane !== issue.origin
            ? { lane: u.lane, party: u.party, visibleToOriginator: gate?.checkerPowers?.originatorSeesEdits ?? false }
            : undefined;
          issue.rev += 1;
          issue.versions.set(issue.rev, checker ? { text: title, checker } : { text: title });
          const markup = model.items.get(key('markup', issue.linked!))!;
          markup.rev += 1;
          markup.versions.set(markup.rev, checker ? { text: title, checker } : { text: title });
        };
      } else if (roll < 0.62) {
        // Release an issue: any actor, through any gate, to its own lane, or to a random lane.
        const issue = pick(rng, issues);
        const choice = pick(rng, [
          ...process.gates.map((g) => ({ gateId: g.id as string | null, to: g.toLaneIds as readonly Lane[] })),
          { gateId: null, to: [u.lane] },
          { gateId: null, to: [pick(rng, LANES)] },
        ]);
        action = { type: 'release', gateId: choice.gateId, toLaneIds: choice.to, items: [{ kind: 'issue', id: issue.id }] };
        const plan = refReleasePlan(model, actor, issue, choice.gateId, choice.to);
        allowed = plan !== null;
        apply = () => refApplyRelease(model, issue, plan!, choice.to);
      } else if (roll < 0.74) {
        // Withdraw an issue from one or two lanes.
        const issue = pick(rng, issues);
        const lanes = rng() < 0.7 ? [pick(rng, LANES)] : [...LANES].filter(() => rng() < 0.6);
        action = { type: 'withdraw', kind: 'issue', id: issue.id, laneIds: lanes };
        allowed =
          u.active &&
          refVisibleRev(model, actor, issue) !== null &&
          scopeCovers(model, actor, ROLE.withdraw.get(actor), issue) &&
          lanes.length > 0 &&
          lanes.every((l) => activeReleasesOf(issue, l).length > 0) &&
          lanes.every((l) => {
            if (l === issue.origin) return true;
            const gate = refFindGate(model, null, issue.origin, [l], 'comment');
            return gate !== undefined && holdsGate(actor, gate.id);
          });
        apply = () => {
          for (const l of lanes) {
            const last = activeReleasesOf(issue, l).at(-1)!;
            issue.releases.get(l)!.push({ rev: last.rev, withdrawn: true, gateId: null });
          }
        };
      } else if (roll < 0.86 || responses.length === 0) {
        // Respond to an issue.
        const parent = pick(rng, issues);
        const id = `r_${++seq}`;
        const body = `S${seed}_${id}_body`;
        action = { type: 'respond', id, parent: { kind: 'issue', id: parent.id }, body };
        allowed = u.active && ROLE.responds.has(actor) && refVisibleRev(model, actor, parent) !== null;
        apply = () => {
          model.items.set(key('response', id), {
            kind: 'response', id, origin: u.lane, owner: actor, ownerParty: u.party, ownerGroups: u.groups,
            draft: draftFor(u.lane, process), checkers: new Set(), versions: new Map([[1, { text: body }]]), rev: 1,
            releases: new Map(), number: null, linked: parent.id,
          });
        };
      } else {
        // Release a response: any actor, through any gate or to their own lane.
        const response = pick(rng, responses);
        const choice = pick(rng, [
          ...process.gates.map((g) => ({ gateId: g.id as string | null, to: g.toLaneIds as readonly Lane[] })),
          { gateId: null, to: [u.lane] },
        ]);
        action = { type: 'release', gateId: choice.gateId, toLaneIds: choice.to, items: [{ kind: 'response', id: response.id }] };
        const plan = refReleasePlan(model, actor, response, choice.gateId, choice.to);
        allowed = plan !== null;
        apply = () => refApplyRelease(model, response, plan!, choice.to);
      }

      const res: ExecutionResult = executeAction(state, actor, action, exec);
      assert.equal(
        res.ok,
        allowed,
        `${label} actor=${actor} ${JSON.stringify(action)}: model says ${allowed ? 'allow' : 'refuse'}, got ${JSON.stringify(res.error ?? 'ok')}`,
      );
      if (res.ok) {
        state = res.state;
        apply?.();
        outcomes.allowed++;
      } else {
        outcomes.refused++;
      }

      assertMatchesReference(label, state, project, process, model, users);
      totalSteps++;
    }
  }

  assert.equal(totalSteps, SEEDS * STEPS_PER_SEED);
  // The sequences exercise both sides of the rules.
  assert.ok(outcomes.allowed > SEEDS * 5, `too few allowed steps: ${outcomes.allowed}`);
  assert.ok(outcomes.refused > SEEDS * 5, `too few refused steps: ${outcomes.refused}`);
});
