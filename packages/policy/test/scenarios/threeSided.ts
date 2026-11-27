import { PROTOCOL_VERSION } from '@nb/ops';
import { DEFAULT_STATUS_TRANSITIONS, DEFAULT_STATUSES, presets, type ProjectConfig, type ScenarioScript } from '../../src/index.ts';

// Three-sided certified review scenario: client, independent certifier, delivery partner.
// Walls stay up between all three; checking gate controls edits, returns, overrides and forwarding.
// Fictional firms and people:
// - Civic Works (client): Clara (client lead/reviewer)
// - Northgate Certifiers (certifier): Victor (certifier lead)
// - Crestline Builders (delivery partner): Devon (partner responder)

const project: ProjectConfig = {
  id: 'proj_northgate',
  parties: [
    { id: 'civic', name: 'Civic Works', contractRole: 'client' },
    { id: 'northgate', name: 'Northgate Certifiers', contractRole: 'certifier' },
    { id: 'crestline', name: 'Crestline Builders', contractRole: 'contractor' },
  ],
  groups: [
    { id: 'client_team', name: 'Client Team', partyId: 'civic' },
    { id: 'cert_team', name: 'Certifier Team', partyId: 'northgate' },
    { id: 'partner_team', name: 'Delivery Team', partyId: 'crestline' },
  ],
  members: [
    { userId: 'clara', name: 'Clara Hayes', partyId: 'civic', groupIds: ['client_team'], state: 'active' },
    { userId: 'victor', name: 'Victor Lin', partyId: 'northgate', groupIds: ['cert_team'], state: 'active' },
    { userId: 'devon', name: 'Devon Ward', partyId: 'crestline', groupIds: ['partner_team'], state: 'active' },
  ],
  statuses: DEFAULT_STATUSES,
  statusTransitions: DEFAULT_STATUS_TRANSITIONS,
  defaultClosing: { allowedClosers: [{ kind: 'lane', id: 'certifier' }] },
  grants: [],
  roles: [
    { subject: { kind: 'user', id: 'victor' }, role: 'project_admin', level: 'project' },
    { subject: { kind: 'user', id: 'clara' }, role: 'lead_reviewer', level: 'project', gateIds: ['client-to-certifier'], transitions: [{ from: 'open', to: 'answered' }] },
    { subject: { kind: 'user', id: 'victor' }, role: 'review_coordinator', level: 'project', gateIds: ['certifier-to-partner', 'certifier-to-client', 'certifier-to-both'], transitions: '*' },
    { subject: { kind: 'user', id: 'devon' }, role: 'responder', level: 'project', gateIds: ['partner-to-certifier'], transitions: [{ from: 'open', to: 'actioned' }] },
  ],
};

const process = presets.threeSided({
  id: 'rev_certified',
  clientMembers: [{ kind: 'party', id: 'civic' }],
  certifierMembers: [{ kind: 'party', id: 'northgate' }],
  partnerMembers: [{ kind: 'party', id: 'crestline' }],
  clientDraftVisibility: 'private',
  certifierDraftVisibility: 'lane',
  partnerDraftVisibility: 'lane',
  certifierPowers: {
    approve: true,
    addNotes: true,
    return: true,
    editWording: true,
    delete: true,
    originatorSeesEdits: false,
    originatorMayOverride: { return: true, edit: false, delete: false },
  },
  allowedClosers: [{ kind: 'lane', id: 'certifier' }],
});

export const threeSidedScenario: ScenarioScript = {
  id: 'three-sided-certified-review',
  name: 'Three-sided certified review (client, certifier, partner; permanent walls, checking gate, gaps, hostile probe)',
  project,
  process,
  presentUserIds: ['clara', 'victor', 'devon'],
  steps: [
    {
      name: 'Client creates c1 and c2 drafts (invisible to certifier and partner)',
      actor: 'clara',
      do: { type: 'createIssue', id: 'c1', title: 'CANARY_CLIENT_ORIG_C1 Drainage fall looks flat', revisionId: 'revA' },
      expect: {
        clara: { issues: { c1: { number: null, visibility: 'draft' } }, presence: ['clara'] },
        victor: { issues: { c1: 'hidden' }, presence: ['victor'], canaryAbsent: ['CANARY_CLIENT_ORIG_C1'] },
        devon: { issues: { c1: 'hidden' }, presence: ['devon'], canaryAbsent: ['CANARY_CLIENT_ORIG_C1'] },
      },
    },
    {
      name: 'Client creates c2 draft',
      actor: 'clara',
      do: { type: 'createIssue', id: 'c2', title: 'CANARY_C2_SECRET Kerb detail out of scope', revisionId: 'revA' },
      expect: {
        devon: { counts: { totalIssues: 0 }, canaryAbsent: ['CANARY_C2_SECRET', 'c2'] },
      },
    },
    {
      name: 'Client releases c1 and c2 to certifier; they take numbers 1 and 2 as they cross; delivery partner sees nothing',
      actor: 'clara',
      do: {
        type: 'release',
        gateId: 'client-to-certifier',
        toLaneIds: ['certifier'],
        items: [
          { kind: 'issue', id: 'c1' },
          { kind: 'issue', id: 'c2' },
        ],
      },
      expect: {
        victor: {
          issues: {
            c1: { number: 1, title: 'CANARY_CLIENT_ORIG_C1 Drainage fall looks flat', ownerUserId: 'clara' },
            c2: { number: 2, title: 'CANARY_C2_SECRET Kerb detail out of scope', ownerUserId: 'clara' },
          },
          counts: { totalIssues: 2 },
        },
        devon: {
          issues: { c1: 'hidden', c2: 'hidden' },
          counts: { totalIssues: 0 },
          canaryAbsent: ['CANARY_CLIENT_ORIG_C1', 'CANARY_C2_SECRET', 'c1', 'c2'],
        },
      },
    },
    {
      name: 'Certifier edits wording of c1 (originatorSeesEdits is false, so client still sees original)',
      actor: 'victor',
      do: { type: 'editIssue', id: 'c1', title: 'Confirm longitudinal drainage fall meets 1:100 minimum' },
      expect: {
        victor: { issues: { c1: { title: 'Confirm longitudinal drainage fall meets 1:100 minimum', ownerUserId: 'clara' } } },
        clara: {
          issues: { c1: { title: 'CANARY_CLIENT_ORIG_C1 Drainage fall looks flat', ownerUserId: 'clara' } },
          canaryAbsent: ['1:100 minimum'],
        },
        devon: {
          issues: { c1: 'hidden' },
          canaryAbsent: ['1:100 minimum', 'CANARY_CLIENT_ORIG_C1'],
        },
      },
    },
    {
      name: 'Certifier returns c2 with note; client sees c2 returned with note; partner sees nothing',
      actor: 'victor',
      do: { type: 'returnItem', kind: 'issue', id: 'c2', note: 'CANARY_RETURN_NOTE Outside stage 2 contract scope', gateId: 'client-to-certifier' },
      expect: {
        clara: {
          issues: {
            c2: {
              number: 2,
              checkingState: 'returned',
              returnNote: 'CANARY_RETURN_NOTE Outside stage 2 contract scope',
            },
          },
        },
        devon: {
          issues: { c2: 'hidden' },
          canaryAbsent: ['CANARY_RETURN_NOTE', 'CANARY_C2_SECRET', 'c2'],
        },
      },
    },
    {
      name: 'Client overrides return of c2 (allowed on gate); c2 goes back to certifier marked returned, overridden by client',
      actor: 'clara',
      do: {
        type: 'overrideChecker',
        kind: 'issue',
        id: 'c2',
        overrideKind: 'return',
        label: 'returned, overridden by client',
      },
      expect: {
        victor: {
          issues: {
            c2: {
              number: 2,
              checkingState: 'submitted',
              overrideLabel: 'returned, overridden by client',
            },
          },
        },
        devon: {
          issues: { c2: 'hidden' },
          canaryAbsent: ['overridden by client', 'CANARY_C2_SECRET', 'CANARY_RETURN_NOTE'],
        },
      },
    },
    {
      name: 'Certifier releases c1 to delivery partner; partner sees #1 at certifier version raised by client author, never original wording',
      actor: 'victor',
      do: { type: 'release', gateId: 'certifier-to-partner', toLaneIds: ['partner'], items: [{ kind: 'issue', id: 'c1' }] },
      expect: {
        devon: {
          issues: {
            c1: {
              number: 1,
              title: 'Confirm longitudinal drainage fall meets 1:100 minimum',
              ownerUserId: 'clara',
              visibility: 'released',
            },
            c2: 'hidden',
          },
          counts: { totalIssues: 1 },
          canaryAbsent: ['CANARY_CLIENT_ORIG_C1', 'CANARY_C2_SECRET', 'CANARY_RETURN_NOTE'],
        },
      },
    },
    {
      name: 'Certifier raises its own c3 and releases it to both sides; everyone sees #3; partner sees #1 and #3 (gap at 2 reveals nothing else)',
      actor: 'victor',
      do: { type: 'createIssue', id: 'c3', title: 'Verify hydrant booster pressure calculation', revisionId: 'revA' },
    },
    {
      name: 'Certifier releases c3 to both client and partner',
      actor: 'victor',
      do: { type: 'release', gateId: 'certifier-to-both', toLaneIds: ['client', 'partner'], items: [{ kind: 'issue', id: 'c3' }] },
      expect: {
        clara: {
          issues: {
            c1: { number: 1 },
            c2: { number: 2 },
            c3: { number: 3, title: 'Verify hydrant booster pressure calculation', ownerUserId: 'victor' },
          },
          counts: { totalIssues: 3 },
        },
        devon: {
          issues: {
            c1: { number: 1 },
            c2: 'hidden',
            c3: { number: 3, title: 'Verify hydrant booster pressure calculation', ownerUserId: 'victor' },
          },
          counts: { totalIssues: 2 },
          canaryAbsent: ['CANARY_C2_SECRET', 'CANARY_RETURN_NOTE', 'CANARY_CLIENT_ORIG_C1', 'c2'],
        },
      },
    },
    {
      name: 'Delivery partner responds to c1; response stays in partner lane until released to certifier',
      actor: 'devon',
      do: { type: 'respond', id: 'r_p1', parent: { kind: 'issue', id: 'c1' }, body: 'Longitudinal grade adjusted to 1:85 on rev B' },
      expect: {
        victor: { responses: { r_p1: 'hidden' } },
        clara: { responses: { r_p1: 'hidden' } },
      },
    },
    {
      name: 'Delivery partner releases response r_p1 to certifier; client still cannot see it yet',
      actor: 'devon',
      do: { type: 'release', gateId: 'partner-to-certifier', toLaneIds: ['certifier'], items: [{ kind: 'response', id: 'r_p1' }] },
      expect: {
        victor: { responses: { r_p1: { body: 'Longitudinal grade adjusted to 1:85 on rev B', ownerUserId: 'devon', visibility: 'released' } } },
        clara: { responses: { r_p1: 'hidden' }, canaryAbsent: ['1:85 on rev B'] },
      },
    },
    {
      name: 'Certifier releases partner response r_p1 to client; client now sees it',
      actor: 'victor',
      do: { type: 'release', gateId: 'certifier-to-client', toLaneIds: ['client'], items: [{ kind: 'response', id: 'r_p1' }] },
      expect: {
        clara: { responses: { r_p1: { body: 'Longitudinal grade adjusted to 1:85 on rev B', ownerUserId: 'devon', visibility: 'released' } } },
      },
    },
    {
      name: 'Delivery partner tries to close c1; refused because closer list is certifier',
      actor: 'devon',
      do: { type: 'transitionStatus', issueId: 'c1', from: null, to: 'closed', revisionSeenId: 'revA' },
      rejects: 'forbidden',
    },
    {
      name: 'Modified partner client sends status.transition on hidden c2; returns byte-identical not_found as random id; canary scan clean',
      actor: 'devon',
      do: {
        type: 'rawOp',
        op: {
          opId: 'hostile_probe_c2',
          schemaVersion: PROTOCOL_VERSION,
          streamId: 'rev_certified',
          type: 'status.transition',
          entityId: 'se_hostile_1',
          payload: { issueId: 'c2', from: 'open', to: 'actioned' },
        },
      },
      rejects: 'not_found',
      uniformityProbe: {
        type: 'rawOp',
        op: {
          opId: 'hostile_probe_missing',
          schemaVersion: PROTOCOL_VERSION,
          streamId: 'rev_certified',
          type: 'status.transition',
          entityId: 'se_hostile_2',
          payload: { issueId: 'does-not-exist-999', from: 'open', to: 'actioned' },
        },
      },
      expect: {
        devon: {
          issues: { c2: 'hidden' },
          canaryAbsent: ['CANARY_C2_SECRET', 'CANARY_RETURN_NOTE', 'CANARY_CLIENT_ORIG_C1', 'c2'],
        },
      },
    },
  ],
};
