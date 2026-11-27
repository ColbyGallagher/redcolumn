import type { Actor, ItemKind, OpsState, StatusDef } from '@nb/ops';

// Core configuration, audience and metadata types for review permissions and visibility.
// Pure data structures: no runtime environment assumptions, usable on client and server.

export const MEMBER_STATES = ['invited', 'active', 'removed'] as const;
export type MemberState = (typeof MEMBER_STATES)[number];

/** A firm participating in a project, with its contract role. */
export interface Party {
  id: string;
  name: string;
  contractRole: string;
}

/** A named set of members, such as a discipline or review team. */
export interface Group {
  id: string;
  name: string;
  partyId?: string | null;
}

/** One user's participation in a project, acting for one party. */
export interface ProjectMember {
  userId: string;
  name?: string;
  partyId: string | null;
  groupIds: readonly string[];
  state: MemberState;
}

/** A member selector used by grants, closing rules and document sets. */
export type SubjectRef =
  | { kind: 'user'; id: string }
  | { kind: 'group'; id: string }
  | { kind: 'party'; id: string }
  | { kind: 'lane'; id: string };

/** A member selector stored in `lane_members(lane_id, user_id | group_id | party_id)`. */
export type LaneMemberRef =
  | { kind: 'user'; id: string }
  | { kind: 'group'; id: string }
  | { kind: 'party'; id: string };

/** A member selector stored in `item_draft_access(item_id, user_id | group_id)`. */
export type DraftAccessRef =
  | { kind: 'user'; id: string }
  | { kind: 'group'; id: string };

/** A folder or set of documents with optional membership restriction. */
export interface DocumentSet {
  id: string;
  name: string;
  /** When omitted, every active project member may access the set. */
  members?: readonly SubjectRef[];
}

export const DRAFT_VISIBILITIES = ['private', 'lane'] as const;
/** Whether new drafts are visible only to author + assigned checkers, or shared within the lane. */
export type DraftVisibility = (typeof DRAFT_VISIBILITIES)[number];

export const CHECKING_STATES = ['draft', 'submitted', 'approved', 'returned', 'released', 'withdrawn', 'stopped'] as const;
export type CheckingState = (typeof CHECKING_STATES)[number];

export const PARTY_VISIBILITY_MODES = ['open', 'separated', 'custom'] as const;
export type PartyVisibilityMode = (typeof PARTY_VISIBILITY_MODES)[number];

export interface PartyVisibilityPair {
  viewerPartyId: string;
  ownerPartyId: string;
}

/** Visibility matrix for parties sharing a lane (e.g. a lead firm and subconsultants). */
export interface PartyVisibilityConfig {
  mode: PartyVisibilityMode;
  /** Used when `mode === 'separated'`: all parties see the lead and themselves; the lead sees all. */
  leadPartyId?: string | null;
  /** Used when `mode === 'custom'`: explicit (viewer, owner) visibility pairs; self is always visible. */
  pairs?: readonly PartyVisibilityPair[];
}

/** One side of a wall in a review or session. */
export interface LaneConfig {
  id: string;
  name: string;
  members: readonly LaneMemberRef[];
  /** Optional override for new items' default draft visibility in this lane. */
  defaultDraftVisibility?: DraftVisibility;
  /** Optional party visibility matrix for internal items inside this lane. Defaults to `'open'`. */
  partyVisibility?: PartyVisibilityConfig;
}

export const GATE_ITEM_KINDS = ['comment', 'response', 'status'] as const;
export type GateItemKind = (typeof GATE_ITEM_KINDS)[number];

/** What a checker in a receiving lane may do to items that arrive through a gate. */
export interface CheckerPowers {
  approve: boolean;
  addNotes: boolean;
  return: boolean;
  editWording: boolean;
  delete: boolean;
  /** Whether the originating lane sees wording edits made by the checker. */
  originatorSeesEdits: boolean;
  /** Which checker actions the originating lane is allowed to override. */
  originatorMayOverride: {
    return: boolean;
    edit: boolean;
    delete: boolean;
  };
}

/** An allowed route from one lane to one or more target lanes. */
export interface GateConfig {
  id: string;
  name: string;
  fromLaneId: string;
  toLaneIds: readonly string[];
  /** Which content categories may cross through this gate. */
  itemKinds: readonly GateItemKind[];
  /** Whether an internal check inside `fromLaneId` is required before release. */
  requiresCheck: boolean;
  /** Assigned checkers for drafts targeting this gate. */
  checkers?: readonly DraftAccessRef[];
  /** Powers granted to checkers in the receiving lane(s) (e.g. an independent certifier). */
  checkerPowers?: CheckerPowers;
}

export const GRANT_SCOPES = ['own', 'group', 'party', 'lane', 'any'] as const;
export type GrantScope = (typeof GRANT_SCOPES)[number];

export const GRANT_LEVELS = ['project', 'review', 'session'] as const;
export type GrantLevel = (typeof GRANT_LEVELS)[number];

export const ROLE_PRESET_IDS = [
  'project_admin',
  'document_controller',
  'review_coordinator',
  'lead_reviewer',
  'reviewer',
  'responder',
  'viewer',
] as const;
export type RolePresetId = (typeof ROLE_PRESET_IDS)[number];

export const ACTION_KINDS = [
  'comment.create',
  'comment.edit',
  'comment.delete',
  'comment.withdraw',
  'check.submit',
  'check.review',
  'release',
  'process.change',
  'response.create',
  'status.change',
  'issue.tick',
  'issue.assign',
  'record.lock',
  'revisions.manage',
  'review.manage',
  'members.manage',
  'register.issue',
  'scale.edit',
  'takeoff.share',
] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

/** One allowed status transition. `from: null` or `'*'` matches any starting status. */
export interface StatusTransitionRule {
  from: string | null;
  to: string;
}

/** One entry in a closer list: any matching entry qualifies to close an issue. */
export type CloserRef =
  | { kind: 'author' }
  | { kind: 'assignee' }
  | { kind: 'designer' }
  | { kind: 'role'; role: RolePresetId }
  | { kind: 'user'; id: string }
  | { kind: 'group'; id: string }
  | { kind: 'party'; id: string }
  | { kind: 'lane'; id: string };

/** Who may close an issue and any extra conditions. */
export interface ClosingConfig {
  allowedClosers: readonly CloserRef[];
  /** When true, an actor who responded to the issue cannot close it. */
  closerNotResponder?: boolean;
}

/** One additive permission grant. Version 1 has no deny rules. */
export interface Grant {
  id?: string;
  subject: SubjectRef;
  level: GrantLevel;
  /** Required when `level` is `'review'` or `'session'`. */
  scopeId?: string;
  action: ActionKind;
  /** Scope for scoped actions (`own`, `group`, `party`, `lane`, `any`). */
  scope?: GrantScope;
  /** For `'release'`: gate ids allowed, or `'*'` for any gate leaving the actor's lane. */
  gateIds?: readonly string[] | '*';
  /** For `'status.change'`: allowed transitions, or `'*'`. */
  transitions?: readonly StatusTransitionRule[] | '*';
  /** For `'process.change'`: which context levels may be changed. */
  processLevels?: readonly GrantLevel[];
  /** For `'members.manage'`: `'party'` (own firm), `'review'` (review participants), or `'any'`. */
  memberScope?: 'party' | 'review' | 'any';
  /** Role preset that produced this grant, if any. */
  fromRole?: RolePresetId;
}

/** Assigns a built-in role preset to a subject at a project, review or session level. */
export interface RoleAssignment {
  subject: SubjectRef;
  role: RolePresetId;
  level: GrantLevel;
  scopeId?: string;
  /** Optional gate ids for roles that release (`review_coordinator`, `lead_reviewer`, `responder`). */
  gateIds?: readonly string[] | '*';
  /** Optional status transitions for roles that change status (`by rule`). */
  transitions?: readonly StatusTransitionRule[] | '*';
}

export const STAGE_STATES = ['upcoming', 'open', 'closed'] as const;
export type StageState = (typeof STAGE_STATES)[number];

/** One stage in a review. Stage rules only restrict; they never grant extra access. */
export interface StageConfig {
  id: string;
  name: string;
  state: StageState;
  /** Optional participants permitted to act during this stage. */
  participants?: readonly SubjectRef[];
  /** When true, a coordinator may record acceptance of late submissions after close. */
  allowLateSubmissions?: boolean;
}

export const SESSION_STATES = ['open', 'locked', 'closed'] as const;
export type SessionState = (typeof SESSION_STATES)[number];

/** Configuration for one visibility scope: a review, or a standalone session. */
export interface ProcessConfig {
  id: string;
  kind: 'review' | 'session';
  /** When this is a session belonging to a review, its parent review id. */
  parentReviewId?: string | null;
  /** Optional document set whose membership gates access to this scope. */
  documentSetId?: string | null;
  lanes: readonly LaneConfig[];
  gates: readonly GateConfig[];
  /** Default draft visibility for new items when a lane does not override it. */
  defaultDraftVisibility: DraftVisibility;
  /** When true (single-lane workflows), newly created items are immediately shared/released to their lane. */
  autoReleaseOnCreate: boolean;
  /** When project-wide issue numbers are assigned. */
  numberingMode: 'on_create' | 'on_first_crossing';
  /** Whether ticking off an issue also closes it. */
  tickClosesIssue: boolean;
  /** Whether released items may be amended while the stage is open. */
  allowAmendmentWhileOpen: boolean;
  /** Closing rules for this scope (overrides project default). */
  closing: ClosingConfig;
  /** Per-issue overrides of closing rules. */
  issueClosingOverrides?: Readonly<Record<string, ClosingConfig>>;
  sessionState?: SessionState;
  activeStage?: StageConfig | null;
  grants?: readonly Grant[];
  roles?: readonly RoleAssignment[];
}

/** Project-level tenancy, statuses, closing defaults and grants. */
export interface ProjectConfig {
  id: string;
  parties: readonly Party[];
  groups: readonly Group[];
  members: readonly ProjectMember[];
  documentSets?: readonly DocumentSet[];
  statuses: readonly StatusDef[];
  /** Structurally allowed status transitions project-wide. When omitted, any status-to-status transition is allowed. */
  statusTransitions?: readonly StatusTransitionRule[];
  defaultClosing: ClosingConfig;
  grants: readonly Grant[];
  roles?: readonly RoleAssignment[];
  /** Optional document designers (keyed by documentId or scopeId) for the `'designer'` closer rule. */
  documentDesigners?: Readonly<Record<string, readonly string[]>>;
}

// --- Audience rows (for persistence in SQL / RLS and pure policy evaluation) ---

export type AccessKind = 'internal' | 'released';

/** Mirrors `item_access(item_id, version_id, lane_id, kind)`. */
export interface ItemAccessRow {
  itemKind: ItemKind;
  itemId: string;
  versionRev: number;
  laneId: string;
  kind: AccessKind;
  /** Owner party id, evaluated against the lane's party matrix when `kind === 'internal'`. */
  ownerPartyId: string | null;
}

/** Mirrors `item_draft_access(item_id, user_id | group_id)` for author + assigned checkers. */
export interface ItemDraftAccessRow {
  itemKind: ItemKind;
  itemId: string;
  versionRev: number;
  subject: DraftAccessRef;
}

/** Mirrors `lane_members(lane_id, user_id | group_id | party_id)`. */
export interface LaneMemberRow {
  laneId: string;
  member: LaneMemberRef;
}

/** Mirrors `party_visibility(lane_id, viewer_party, owner_party)`. */
export interface PartyVisibilityRow {
  laneId: string;
  viewerPartyId: string;
  ownerPartyId: string;
}

/** Explicit audience rows for a single item across its versions. */
export interface ItemAudiences {
  access: readonly ItemAccessRow[];
  draftAccess: readonly ItemDraftAccessRow[];
}

// --- Item lifecycle metadata & snapshots ---

export interface ReleasedVersionRecord {
  releaseId: string;
  rev: number;
  fromLaneId: string;
  gateId: string | null;
  at: number;
  by: Actor;
  withdrawn?: boolean;
}

export interface CheckerEditRecord {
  laneId: string;
  gateId: string;
  by: Actor;
  visibleToOriginator: boolean;
}

export interface OverrideRecord {
  kind: 'return' | 'edit' | 'delete';
  by: Actor;
  at: number;
  label: string;
}

export interface ItemHistoryEntry {
  at: number;
  actor: Actor;
  laneId: string;
  action:
    | 'create'
    | 'edit'
    | 'delete'
    | 'restore'
    | 'submit'
    | 'approve'
    | 'return'
    | 'override'
    | 'check_edit'
    | 'check_delete'
    | 'release'
    | 'withdraw'
    | 'amend'
    | 'status'
    | 'assign';
  rev: number;
  note?: string | null;
  /** Lanes that may see this history entry. Draft edits stay in their own lane. */
  visibleToLaneIds: readonly string[];
  /** When true, only author and assigned checkers see this entry while the item is a private draft. */
  privateDraftOnly?: boolean;
}

/** Policy metadata attached to one `@nb/ops` item. */
export interface ItemMeta {
  kind: ItemKind;
  id: string;
  scopeId: string;
  originLaneId: string;
  owner: Actor;
  /** Every group the owner belonged to when the item was created (`owner.groupId` is only the first). */
  ownerGroupIds?: readonly string[];
  draftVisibility: DraftVisibility;
  checkingState: CheckingState;
  /** Revision an authorized checker approved. A gate that requires checking accepts only this revision. */
  approvedRev?: number | null;
  assignedCheckers: readonly DraftAccessRef[];
  /** When an item has been released to a lane with checker powers, the gate it arrived through. */
  arrivedViaGateId?: string | null;
  /** Gate through which a checker returned, edited or stopped this item. */
  checkedByGateId?: string | null;
  /** Lane currently checking this item, if checked across a gate. */
  checkingLaneId?: string | null;
  returnNote?: string | null;
  overridden?: OverrideRecord | null;
  /** Per version `rev`, edits made by a checker in another lane (does not change `owner`). */
  checkerEditedRevs?: Readonly<Record<number, CheckerEditRecord>>;
  /** Per receiving lane id, released versions in chronological order. */
  releasesByLane: Readonly<Record<string, readonly ReleasedVersionRecord[]>>;
  /** Lanes in which this item has been withdrawn. */
  withdrawnInLanes?: readonly string[];
  assigneeUserId?: string | null;
  documentId?: string | null;
  locked?: boolean;
  /** Users who have authored a response on this issue (used for `closerNotResponder`). */
  responderUserIds?: readonly string[];
  /** Initial status set on issue creation (shown to lanes before a status event overrides it). */
  initialStatus?: string | null;
  /** Latest rev number for this item. */
  latestRev: number;
  /** History entries with explicit lane visibility. */
  history: readonly ItemHistoryEntry[];
}

/** Key identifying an item across kinds: `${kind}:${id}`. */
export const itemKey = (kind: ItemKind, id: string): string => `${kind}:${id}`;

/** Safe own-property lookup (never traverses prototype chain). */
export const own = <T>(map: Readonly<Record<string, T>> | undefined, key: string): T | undefined =>
  map !== undefined && Object.hasOwn(map, key) ? map[key] : undefined;

/** Immutable snapshot store keyed by `itemKey(kind, id)` then `rev`. */
export type VersionSnapshots = Readonly<Record<string, Readonly<Record<number, unknown>>>>;

/** Combined state used by authorization, view-as projection and the scenario runner. */
export interface PolicyState {
  ops: OpsState;
  /** Policy metadata keyed by `itemKey(kind, id)`. */
  meta: Readonly<Record<string, ItemMeta>>;
  /** Immutable record snapshots per item and rev. */
  versions: VersionSnapshots;
  /** Next project-wide issue number (monotonic, never reused). */
  nextIssueNumber: number;
  /** Online user ids currently present in the scope (filtered per lane by view-as). */
  presentUserIds?: readonly string[];
}
