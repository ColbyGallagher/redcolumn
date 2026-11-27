import { DEFAULT_STATUS_TRANSITIONS, DEFAULT_STATUSES, presets, type ProjectConfig, type ScenarioScript } from '../../src/index.ts';

// Single-team internal check scenario: one lane, immediate release, tick separate from status.
// Fictional company and people: Harbor Structural (Maya = manager, Sam = designer).

const project: ProjectConfig = {
  id: 'proj_harbor',
  parties: [{ id: 'harbor', name: 'Harbor Structural', contractRole: 'internal' }],
  groups: [{ id: 'design', name: 'Design Team', partyId: 'harbor' }],
  members: [
    { userId: 'maya', name: 'Maya Chen', partyId: 'harbor', groupIds: ['design'], state: 'active' },
    { userId: 'sam', name: 'Sam Patel', partyId: 'harbor', groupIds: ['design'], state: 'active' },
  ],
  statuses: DEFAULT_STATUSES,
  statusTransitions: DEFAULT_STATUS_TRANSITIONS,
  defaultClosing: { allowedClosers: [{ kind: 'user', id: 'maya' }] },
  grants: [],
  roles: [
    { subject: { kind: 'user', id: 'maya' }, role: 'project_admin', level: 'project' },
    { subject: { kind: 'user', id: 'maya' }, role: 'document_controller', level: 'project' },
    { subject: { kind: 'user', id: 'maya' }, role: 'review_coordinator', level: 'project', gateIds: '*', transitions: '*' },
    { subject: { kind: 'user', id: 'sam' }, role: 'reviewer', level: 'project', transitions: [{ from: 'open', to: 'actioned' }] },
  ],
};

const process = presets.singleTeam({
  id: 'rev_internal',
  members: [{ kind: 'party', id: 'harbor' }],
  allowedClosers: [{ kind: 'user', id: 'maya' }],
  tickClosesIssue: false,
});

export const singleTeamScenario: ScenarioScript = {
  id: 'single-team-internal-check',
  name: 'Single-team internal check (one lane, immediate release, tick separate from status)',
  project,
  process,
  presentUserIds: ['maya', 'sam'],
  steps: [
    {
      name: 'Manager creates issue c1 on rev A; designer sees number 1, open immediately',
      actor: 'maya',
      do: { type: 'createIssue', id: 'c1', title: 'Beam splice bolt grade missing', revisionId: 'revA' },
      expect: {
        maya: {
          issues: { c1: { number: 1, title: 'Beam splice bolt grade missing', status: 'open', checked: false, visibility: 'released', placedOnRevisions: ['revA'] } },
          counts: { totalIssues: 1, openIssues: 1, closedIssues: 0 },
          presence: ['maya', 'sam'],
        },
        sam: {
          issues: { c1: { number: 1, title: 'Beam splice bolt grade missing', status: 'open', checked: false, visibility: 'released', placedOnRevisions: ['revA'] } },
          counts: { totalIssues: 1, openIssues: 1, closedIssues: 0 },
          presence: ['maya', 'sam'],
        },
      },
    },
    {
      name: 'Manager creates second open issue c2 on rev A (takes number 2)',
      actor: 'maya',
      do: { type: 'createIssue', id: 'c2', title: 'Check slab edge thickenings', revisionId: 'revA' },
      expect: {
        sam: {
          issues: {
            c1: { number: 1, status: 'open' },
            c2: { number: 2, status: 'open', placedOnRevisions: ['revA'] },
          },
          counts: { totalIssues: 2, openIssues: 2 },
        },
      },
    },
    {
      name: 'Designer ticks c1; both see it ticked while status stays open (tickClosesIssue is off)',
      actor: 'sam',
      do: { type: 'tickIssue', id: 'c1', checked: true },
      expect: {
        maya: { issues: { c1: { checked: true, status: 'open' } } },
        sam: { issues: { c1: { checked: true, status: 'open' } } },
      },
    },
    {
      name: 'Designer tries to close c1; refused because closer list is manager only',
      actor: 'sam',
      do: { type: 'transitionStatus', issueId: 'c1', to: 'closed', revisionSeenId: 'revA' },
      rejects: 'forbidden',
      expect: {
        maya: { issues: { c1: { status: 'open', checked: true } } },
        sam: { issues: { c1: { status: 'open', checked: true } } },
      },
    },
    {
      name: 'Manager closes c1 with revision checked revA; both see closed and revision checked',
      actor: 'maya',
      do: { type: 'transitionStatus', issueId: 'c1', to: 'closed', revisionSeenId: 'revA' },
      expect: {
        maya: {
          issues: { c1: { status: 'closed', statusRevisionSeenId: 'revA', checked: true } },
          counts: { totalIssues: 2, openIssues: 1, closedIssues: 1 },
        },
        sam: {
          issues: { c1: { status: 'closed', statusRevisionSeenId: 'revA', checked: true } },
          counts: { totalIssues: 2, openIssues: 1, closedIssues: 1 },
        },
      },
    },
    {
      name: 'Revision B uploaded: closed c1 is not carried; open c2 is placed on revB as same issue #2 while revA stays unchanged',
      actor: 'maya',
      do: { type: 'carryOpenToRevision', revisionId: 'revB' },
      expect: {
        maya: {
          issues: {
            c1: { number: 1, status: 'closed', placedOnRevisions: ['revA'] },
            c2: { number: 2, status: 'open', placedOnRevisions: ['revA', 'revB'] },
          },
        },
        sam: {
          issues: {
            c1: { number: 1, status: 'closed', placedOnRevisions: ['revA'] },
            c2: { number: 2, status: 'open', placedOnRevisions: ['revA', 'revB'] },
          },
        },
      },
    },
  ],
};
