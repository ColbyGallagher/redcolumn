import type { StatusDef } from '@nb/ops';
import type {
  CheckerPowers,
  CloserRef,
  DraftAccessRef,
  DraftVisibility,
  LaneMemberRef,
  PartyVisibilityConfig,
  ProcessConfig,
  RoleAssignment,
  StatusTransitionRule,
} from './types.ts';

// Neutral starting process presets for the three common review structures:
// - singleTeam: one lane, immediate release, no walls or gates required
// - twoSided: two lanes (client and firm), drafts hidden until released
// - threeSided: three lanes (client, certifier, partner), permanent separation and checking gate

export const DEFAULT_STATUSES: readonly StatusDef[] = [
  { id: 'open', name: 'Open', category: 'open' },
  { id: 'actioned', name: 'Actioned', category: 'open' },
  { id: 'answered', name: 'Answered', category: 'open' },
  { id: 'closed', name: 'Closed', category: 'closed' },
  { id: 'void', name: 'Not applicable', category: 'void' },
];

export const DEFAULT_STATUS_TRANSITIONS: readonly StatusTransitionRule[] = [
  { from: 'open', to: 'actioned' },
  { from: 'open', to: 'answered' },
  { from: 'open', to: 'closed' },
  { from: 'open', to: 'void' },
  { from: 'actioned', to: 'open' },
  { from: 'actioned', to: 'answered' },
  { from: 'actioned', to: 'closed' },
  { from: 'actioned', to: 'void' },
  { from: 'answered', to: 'open' },
  { from: 'answered', to: 'actioned' },
  { from: 'answered', to: 'closed' },
  { from: 'answered', to: 'void' },
  { from: 'closed', to: 'open' },
  { from: 'void', to: 'open' },
];

export interface SingleTeamPresetOptions {
  id: string;
  kind?: 'review' | 'session';
  members: readonly LaneMemberRef[];
  allowedClosers?: readonly CloserRef[];
  closerNotResponder?: boolean;
  tickClosesIssue?: boolean;
  roles?: readonly RoleAssignment[];
}

export interface TwoSidedPresetOptions {
  id: string;
  kind?: 'review' | 'session';
  clientMembers: readonly LaneMemberRef[];
  firmMembers: readonly LaneMemberRef[];
  /** Defaults to `'private'`; set to `'lane'` to share client drafts within the client lane. */
  clientDraftVisibility?: DraftVisibility;
  firmDraftVisibility?: DraftVisibility;
  clientCheckers?: readonly DraftAccessRef[];
  clientRequiresCheck?: boolean;
  firmPartyVisibility?: PartyVisibilityConfig;
  clientPartyVisibility?: PartyVisibilityConfig;
  allowedClosers?: readonly CloserRef[];
  closerNotResponder?: boolean;
  allowAmendmentWhileOpen?: boolean;
  roles?: readonly RoleAssignment[];
}

export interface ThreeSidedPresetOptions {
  id: string;
  kind?: 'review' | 'session';
  clientMembers: readonly LaneMemberRef[];
  certifierMembers: readonly LaneMemberRef[];
  partnerMembers: readonly LaneMemberRef[];
  clientDraftVisibility?: DraftVisibility;
  certifierDraftVisibility?: DraftVisibility;
  partnerDraftVisibility?: DraftVisibility;
  clientCheckers?: readonly DraftAccessRef[];
  clientPartyVisibility?: PartyVisibilityConfig;
  partnerPartyVisibility?: PartyVisibilityConfig;
  certifierPowers?: Partial<CheckerPowers>;
  allowedClosers?: readonly CloserRef[];
  closerNotResponder?: boolean;
  allowAmendmentWhileOpen?: boolean;
  roles?: readonly RoleAssignment[];
}

const DEFAULT_CERTIFIER_POWERS: CheckerPowers = {
  approve: true,
  addNotes: true,
  return: true,
  editWording: true,
  delete: true,
  originatorSeesEdits: false,
  originatorMayOverride: {
    return: true,
    edit: false,
    delete: false,
  },
};

export const presets = {
  /**
   * Single-team review: one lane, shared drafts, immediate release and numbering on creation.
   * Requires no walls, firms or gates.
   */
  singleTeam(opts: SingleTeamPresetOptions): ProcessConfig {
    return {
      id: opts.id,
      kind: opts.kind ?? 'review',
      lanes: [
        {
          id: 'team',
          name: 'Team',
          members: opts.members,
          defaultDraftVisibility: 'lane',
        },
      ],
      gates: [],
      defaultDraftVisibility: 'lane',
      autoReleaseOnCreate: true,
      numberingMode: 'on_create',
      tickClosesIssue: opts.tickClosesIssue ?? false,
      allowAmendmentWhileOpen: true,
      closing: {
        allowedClosers: opts.allowedClosers ?? [{ kind: 'role', role: 'review_coordinator' }],
        closerNotResponder: opts.closerNotResponder,
      },
      roles: opts.roles,
    };
  },

  /**
   * Two-sided review: client and firm lanes separated by walls, with one gate in each direction.
   * Drafts stay hidden across the wall until explicitly released.
   */
  twoSided(opts: TwoSidedPresetOptions): ProcessConfig {
    return {
      id: opts.id,
      kind: opts.kind ?? 'review',
      lanes: [
        {
          id: 'client',
          name: 'Client',
          members: opts.clientMembers,
          defaultDraftVisibility: opts.clientDraftVisibility ?? 'private',
          partyVisibility: opts.clientPartyVisibility,
        },
        {
          id: 'firm',
          name: 'Firm',
          members: opts.firmMembers,
          defaultDraftVisibility: opts.firmDraftVisibility ?? 'private',
          partyVisibility: opts.firmPartyVisibility,
        },
      ],
      gates: [
        {
          id: 'client-to-firm',
          name: 'Client to Firm',
          fromLaneId: 'client',
          toLaneIds: ['firm'],
          itemKinds: ['comment', 'status'],
          requiresCheck: opts.clientRequiresCheck ?? false,
          checkers: opts.clientCheckers,
        },
        {
          id: 'firm-to-client',
          name: 'Firm to Client',
          fromLaneId: 'firm',
          toLaneIds: ['client'],
          itemKinds: ['response', 'status'],
          requiresCheck: false,
        },
      ],
      defaultDraftVisibility: 'private',
      autoReleaseOnCreate: false,
      numberingMode: 'on_first_crossing',
      tickClosesIssue: false,
      allowAmendmentWhileOpen: opts.allowAmendmentWhileOpen ?? true,
      closing: {
        allowedClosers: opts.allowedClosers ?? [{ kind: 'lane', id: 'client' }],
        closerNotResponder: opts.closerNotResponder,
      },
      roles: opts.roles,
    };
  },

  /**
   * Three-sided certified review: client, independent certifier and delivery partner.
   * Walls stay up between all three; client comments and partner responses pass through the certifier.
   */
  threeSided(opts: ThreeSidedPresetOptions): ProcessConfig {
    const powers: CheckerPowers = {
      ...DEFAULT_CERTIFIER_POWERS,
      ...opts.certifierPowers,
      originatorMayOverride: {
        ...DEFAULT_CERTIFIER_POWERS.originatorMayOverride,
        ...opts.certifierPowers?.originatorMayOverride,
      },
    };
    return {
      id: opts.id,
      kind: opts.kind ?? 'review',
      lanes: [
        {
          id: 'client',
          name: 'Client',
          members: opts.clientMembers,
          defaultDraftVisibility: opts.clientDraftVisibility ?? 'private',
          partyVisibility: opts.clientPartyVisibility,
        },
        {
          id: 'certifier',
          name: 'Certifier',
          members: opts.certifierMembers,
          defaultDraftVisibility: opts.certifierDraftVisibility ?? 'private',
        },
        {
          id: 'partner',
          name: 'Delivery Partner',
          members: opts.partnerMembers,
          defaultDraftVisibility: opts.partnerDraftVisibility ?? 'private',
          partyVisibility: opts.partnerPartyVisibility,
        },
      ],
      gates: [
        {
          id: 'client-to-certifier',
          name: 'Client to Certifier',
          fromLaneId: 'client',
          toLaneIds: ['certifier'],
          itemKinds: ['comment', 'status'],
          requiresCheck: false,
          checkers: opts.clientCheckers,
          checkerPowers: powers,
        },
        {
          id: 'certifier-to-partner',
          name: 'Certifier to Delivery Partner',
          fromLaneId: 'certifier',
          toLaneIds: ['partner'],
          itemKinds: ['comment', 'status'],
          requiresCheck: false,
        },
        {
          id: 'certifier-to-client',
          name: 'Certifier to Client',
          fromLaneId: 'certifier',
          toLaneIds: ['client'],
          itemKinds: ['comment', 'response', 'status'],
          requiresCheck: false,
        },
        {
          id: 'certifier-to-both',
          name: 'Certifier to Both Sides',
          fromLaneId: 'certifier',
          toLaneIds: ['client', 'partner'],
          itemKinds: ['comment', 'status'],
          requiresCheck: false,
        },
        {
          id: 'partner-to-certifier',
          name: 'Delivery Partner to Certifier',
          fromLaneId: 'partner',
          toLaneIds: ['certifier'],
          itemKinds: ['response', 'status'],
          requiresCheck: false,
        },
      ],
      defaultDraftVisibility: 'private',
      autoReleaseOnCreate: false,
      numberingMode: 'on_first_crossing',
      tickClosesIssue: false,
      allowAmendmentWhileOpen: opts.allowAmendmentWhileOpen ?? true,
      closing: {
        allowedClosers: opts.allowedClosers ?? [{ kind: 'lane', id: 'certifier' }],
        closerNotResponder: opts.closerNotResponder,
      },
      roles: opts.roles,
    };
  },
} as const;
