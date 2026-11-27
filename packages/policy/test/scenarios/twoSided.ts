import { DEFAULT_STATUS_TRANSITIONS, DEFAULT_STATUSES, presets, type ProjectConfig, type ScenarioScript } from '../../src/index.ts';

// Two-sided review scenario: client drafts stay hidden from the firm until released.
// Fictional firms and people:
// - Civic Works (client): Nia (reviewer), Owen (lead)
// - Meridian Architects (firm): Leo (designer/responder), Priya (firm lead)

const project: ProjectConfig = {
  id: 'proj_meridian',
  parties: [
    { id: 'civic', name: 'Civic Works', contractRole: 'client' },
    { id: 'meridian', name: 'Meridian Architects', contractRole: 'lead_consultant' },
  ],
  groups: [
    { id: 'civic_review', name: 'Client Review Team', partyId: 'civic' },
    { id: 'meridian_design', name: 'Meridian Design Team', partyId: 'meridian' },
  ],
  members: [
    { userId: 'nia', name: 'Nia Brooks', partyId: 'civic', groupIds: ['civic_review'], state: 'active' },
    { userId: 'owen', name: 'Owen Grant', partyId: 'civic', groupIds: ['civic_review'], state: 'active' },
    { userId: 'leo', name: 'Leo Alvarez', partyId: 'meridian', groupIds: ['meridian_design'], state: 'active' },
    { userId: 'priya', name: 'Priya Nair', partyId: 'meridian', groupIds: ['meridian_design'], state: 'active' },
  ],
  statuses: DEFAULT_STATUSES,
  statusTransitions: DEFAULT_STATUS_TRANSITIONS,
  defaultClosing: { allowedClosers: [{ kind: 'user', id: 'owen' }] },
  grants: [],
  roles: [
    { subject: { kind: 'user', id: 'owen' }, role: 'project_admin', level: 'project' },
    { subject: { kind: 'user', id: 'owen' }, role: 'lead_reviewer', level: 'project', gateIds: ['client-to-firm'], transitions: '*' },
    { subject: { kind: 'user', id: 'nia' }, role: 'reviewer', level: 'project', transitions: [{ from: 'open', to: 'answered' }] },
    { subject: { kind: 'user', id: 'priya' }, role: 'responder', level: 'project', gateIds: ['firm-to-client'], transitions: [{ from: 'open', to: 'actioned' }, { from: 'actioned', to: 'answered' }] },
    { subject: { kind: 'user', id: 'leo' }, role: 'responder', level: 'project', gateIds: ['firm-to-client'], transitions: [{ from: 'open', to: 'actioned' }] },
  ],
};

const process = presets.twoSided({
  id: 'rev_two_sided',
  clientMembers: [{ kind: 'party', id: 'civic' }],
  firmMembers: [{ kind: 'party', id: 'meridian' }],
  // Client lane configured to share drafts within the client lane.
  clientDraftVisibility: 'lane',
  firmDraftVisibility: 'lane',
  allowedClosers: [{ kind: 'user', id: 'owen' }],
  allowAmendmentWhileOpen: true,
});

export const twoSidedScenario: ScenarioScript = {
  id: 'two-sided-firm-and-client',
  name: 'Two-sided review (drafts hidden until release, bulk release, amendment, per-lane status)',
  project,
  process,
  presentUserIds: ['nia', 'owen', 'leo', 'priya'],
  steps: [
    {
      name: 'Client reviewer creates c1; client lead sees it; firm sees nothing (no count, no number, no presence)',
      actor: 'nia',
      do: { type: 'createIssue', id: 'c1', title: 'CANARY_DRAFT_WORDING fire damper missing', revisionId: 'revA' },
      expect: {
        nia: {
          issues: { c1: { number: null, title: 'CANARY_DRAFT_WORDING fire damper missing', visibility: 'internal' } },
          counts: { totalIssues: 1, openIssues: 1 },
          presence: ['nia', 'owen'],
        },
        owen: {
          issues: { c1: { number: null, title: 'CANARY_DRAFT_WORDING fire damper missing', visibility: 'internal' } },
          counts: { totalIssues: 1, openIssues: 1 },
          presence: ['nia', 'owen'],
        },
        leo: {
          issues: { c1: 'hidden' },
          counts: { totalIssues: 0, openIssues: 0 },
          presence: ['leo', 'priya'],
          canaryAbsent: ['CANARY_DRAFT_WORDING', 'c1', 'nia', 'owen'],
        },
        priya: {
          issues: { c1: 'hidden' },
          counts: { totalIssues: 0, openIssues: 0 },
          presence: ['leo', 'priya'],
          canaryAbsent: ['CANARY_DRAFT_WORDING', 'c1', 'nia', 'owen'],
        },
      },
    },
    {
      name: 'Client reviewer creates c2 draft',
      actor: 'nia',
      do: { type: 'createIssue', id: 'c2', title: 'Acoustic seal required at corridor head', revisionId: 'revA' },
      expect: {
        owen: { counts: { totalIssues: 2 } },
        leo: { issues: { c1: 'hidden', c2: 'hidden' }, counts: { totalIssues: 0 } },
      },
    },
    {
      name: 'Client lead edits c1 wording; history shows the edit to the client lane only',
      actor: 'owen',
      do: { type: 'editIssue', id: 'c1', title: 'Add fire damper at duct penetration D-14' },
      expect: {
        nia: {
          issues: {
            c1: {
              title: 'Add fire damper at duct penetration D-14',
              ownerUserId: 'nia',
              historyContains: ['owen', 'edit'],
            },
          },
        },
        leo: {
          issues: { c1: 'hidden' },
          canaryAbsent: ['CANARY_DRAFT_WORDING', 'duct penetration', 'owen'],
        },
      },
    },
    {
      name: 'Client lead releases c1 and c2 in bulk; firm sees #1 and #2 at released versions without draft edit or editor name',
      actor: 'owen',
      do: {
        type: 'release',
        gateId: 'client-to-firm',
        toLaneIds: ['firm'],
        bulk: true,
        items: [
          { kind: 'issue', id: 'c1' },
          { kind: 'issue', id: 'c2' },
        ],
      },
      expect: {
        leo: {
          issues: {
            c1: {
              number: 1,
              title: 'Add fire damper at duct penetration D-14',
              ownerUserId: 'nia',
              visibility: 'released',
              amended: false,
              status: 'open',
              sharedStatus: 'open',
              historyExcludes: ['owen', 'CANARY_DRAFT_WORDING'],
            },
            c2: {
              number: 2,
              title: 'Acoustic seal required at corridor head',
              ownerUserId: 'nia',
              visibility: 'released',
              status: 'open',
            },
          },
          counts: { totalIssues: 2, openIssues: 2 },
          canaryAbsent: ['CANARY_DRAFT_WORDING', 'owen'],
        },
      },
    },
    {
      name: 'Client reviewer amends c1 after release; firm still sees previous released version until amendment is released',
      actor: 'nia',
      do: { type: 'editIssue', id: 'c1', title: 'Add fire damper at duct penetration D-14 (2-hour rating)' },
      expect: {
        nia: { issues: { c1: { title: 'Add fire damper at duct penetration D-14 (2-hour rating)' } } },
        leo: {
          issues: { c1: { title: 'Add fire damper at duct penetration D-14', amended: false } },
          canaryAbsent: ['2-hour rating'],
        },
      },
    },
    {
      name: 'Client lead releases the amended version of c1; firm now sees updated wording marked amended',
      actor: 'owen',
      do: { type: 'release', gateId: 'client-to-firm', toLaneIds: ['firm'], items: [{ kind: 'issue', id: 'c1' }] },
      expect: {
        leo: {
          issues: { c1: { number: 1, title: 'Add fire damper at duct penetration D-14 (2-hour rating)', amended: true } },
        },
      },
    },
    {
      name: 'Firm designer responds to c1; response stays inside firm lane until released',
      actor: 'leo',
      do: { type: 'respond', id: 'r1', parent: { kind: 'issue', id: 'c1' }, body: 'CANARY_INTERNAL_REPLY Damper added to M-201' },
      expect: {
        priya: { responses: { r1: { body: 'CANARY_INTERNAL_REPLY Damper added to M-201', ownerUserId: 'leo', visibility: 'internal' } } },
        nia: {
          responses: { r1: 'hidden' },
          canaryAbsent: ['CANARY_INTERNAL_REPLY', 'r1'],
        },
      },
    },
    {
      name: 'Firm lead releases r1 to client; client now sees the response',
      actor: 'priya',
      do: { type: 'release', gateId: 'firm-to-client', toLaneIds: ['client'], items: [{ kind: 'response', id: 'r1' }] },
      expect: {
        nia: { responses: { r1: { body: 'CANARY_INTERNAL_REPLY Damper added to M-201', ownerUserId: 'leo', visibility: 'released' } } },
      },
    },
    {
      name: 'Firm lead sets c1 to Actioned internally; client still sees Open; firm screen shows shared status Open',
      actor: 'priya',
      do: { type: 'transitionStatus', id: 'se_firm_1', issueId: 'c1', from: null, to: 'actioned' },
      expect: {
        priya: {
          issues: { c1: { status: 'actioned', sharedStatus: 'open' } },
        },
        nia: {
          issues: { c1: { status: 'open', sharedStatus: 'open' } },
          canaryAbsent: ['actioned', 'se_firm_1'],
        },
      },
    },
  ],
};
