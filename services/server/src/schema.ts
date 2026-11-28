import type { Generated } from 'kysely';

// Kysely table types for migrations/0001_skeleton.sql and migrations/0002_schema_v1.sql.
// Column names match the SQL exactly. BIGINT columns come back from pg as strings.

export type SubjectKind = 'user' | 'group' | 'party';
export type DocumentSetSubjectKind = SubjectKind | 'lane';
export type DraftSubjectKind = 'user' | 'group';
export type DraftVisibility = 'private' | 'lane';
export type AccessKind = 'internal' | 'released';
export type CheckingState = 'draft' | 'submitted' | 'returned' | 'released' | 'withdrawn' | 'stopped';
export type ReviewItemKind = 'markup' | 'placement' | 'issue' | 'response' | 'statusEvent';
export type TakeoffItemKind = 'scale' | 'viewport' | 'assembly' | 'catalogItem' | 'productList' | 'takeoffTemplate';
/** Item kinds that can carry versions and audience rows. */
export type VersionedItemKind = ReviewItemKind | TakeoffItemKind;

// --- Skeleton tables -------------------------------------------------------------------------

export interface SchemaMigrationsTable {
  version: string;
  name: string;
  checksum: string;
  applied_at: Generated<Date>;
}

export interface UsersTable {
  id: string;
  email: string;
  email_lower: string;
  name: string;
  password_hash: string;
  role: 'user' | 'admin';
  is_admin: boolean;
  disabled_at: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface SessionsTable {
  id: string;
  user_id: string;
  token_hash: string;
  created_at: Generated<Date>;
  expires_at: Date;
  revoked_at: Date | null;
  last_seen_at: Generated<Date>;
}

export interface StreamsTable {
  id: string;
  kind: string;
  seq: string;
  project_id: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface OpResultsTable {
  op_id: string;
  stream_id: string;
  actor_id: string;
  payload_hash: string;
  accepted: boolean;
  result_json: unknown;
  created_at: Generated<Date>;
}

export interface MarkupsTable {
  id: string;
  stream_id: string;
  scope_id: string;
  type: string;
  /** Version number; matches `item_access.version_rev`. */
  rev: number;
  deleted: boolean;
  owner_user_id: string;
  owner_party_id: string | null;
  owner_group_id: string | null;
  record_json: unknown;
  project_id: string | null;
  origin_lane_id: string | null;
  draft_visibility: Generated<DraftVisibility>;
  checking_state: Generated<CheckingState>;
  client_time: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface PlacementsTable {
  id: string;
  stream_id: string;
  markup_id: string;
  revision_id: string;
  page_id: string;
  rev: number;
  deleted: boolean;
  record_json: unknown;
  scope_id: string | null;
  origin_lane_id: string | null;
  owner_party_id: string | null;
  method: Generated<'original' | 'aligned' | 'manual' | 'suggested'>;
  client_time: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface EventsTable {
  stream_id: string;
  seq: string;
  op_id: string;
  actor_id: string;
  op_type: string;
  entity_id: string;
  payload_json: unknown;
  /** Server time, authoritative. */
  received_at: Generated<Date>;
  /** The author's clock, shown as "made offline at". */
  client_time: Date | null;
  item_kind: VersionedItemKind | null;
  version_rev: number | null;
  lane_id: string | null;
}

// --- Tenancy and people ----------------------------------------------------------------------

export interface WorkspacesTable {
  id: string;
  name: string;
  created_at: Generated<Date>;
}

export interface WorkspaceMembersTable {
  workspace_id: string;
  user_id: string;
  role: Generated<'member' | 'admin'>;
  created_at: Generated<Date>;
}

export interface IdentityProvidersTable {
  id: string;
  workspace_id: string | null;
  kind: 'local' | 'oidc' | 'saml';
  name: string;
  config_json: Generated<unknown>;
  enabled: Generated<boolean>;
  created_at: Generated<Date>;
}

export interface IdentitiesTable {
  id: string;
  user_id: string;
  provider_id: string;
  subject: string;
  email: string | null;
  created_at: Generated<Date>;
  last_used_at: Date | null;
}

export interface CompaniesTable {
  id: string;
  workspace_id: string;
  name: string;
  created_at: Generated<Date>;
}

export interface ProjectsTable {
  id: string;
  workspace_id: string;
  name: string;
  number: string | null;
  settings_json: Generated<unknown>;
  created_at: Generated<Date>;
  archived_at: Date | null;
}

export interface PartiesTable {
  id: string;
  project_id: string;
  company_id: string | null;
  name: string;
  contract_role: string;
  created_at: Generated<Date>;
}

export interface ProjectMembersTable {
  project_id: string;
  user_id: string;
  party_id: string | null;
  state: Generated<'invited' | 'active' | 'removed'>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface GroupsTable {
  id: string;
  workspace_id: string | null;
  project_id: string | null;
  party_id: string | null;
  linked_group_id: string | null;
  name: string;
  created_at: Generated<Date>;
}

export interface GroupMembersTable {
  group_id: string;
  user_id: string;
  created_at: Generated<Date>;
}

// --- Documents -------------------------------------------------------------------------------

export interface DocumentsTable {
  id: string;
  project_id: string;
  number: string;
  title: Generated<string>;
  discipline: string | null;
  created_at: Generated<Date>;
}

export interface RevisionsTable {
  id: string;
  document_id: string;
  label: string;
  file_sha256: string;
  file_size: string | number;
  page_count: number;
  issued_by: string | null;
  issued_at: Date | null;
  created_at: Generated<Date>;
}

export interface SheetsTable {
  id: string;
  document_id: string;
  sheet_number: string;
  title: string | null;
}

export interface PagesTable {
  id: string;
  revision_id: string;
  sheet_id: string | null;
  position: number;
  width: number;
  height: number;
  rotation: Generated<0 | 90 | 180 | 270>;
}

export interface DocumentSetsTable {
  id: string;
  project_id: string;
  name: string;
  members_restricted: Generated<boolean>;
  created_at: Generated<Date>;
}

export interface DocumentSetMembersTable {
  document_set_id: string;
  subject_kind: DocumentSetSubjectKind;
  subject_id: string;
}

export interface DocumentSetDocumentsTable {
  document_set_id: string;
  document_id: string;
}

// --- Process ---------------------------------------------------------------------------------

export interface ScopesTable {
  id: string;
  project_id: string;
  kind: 'review' | 'session';
  parent_review_id: string | null;
  document_set_id: string | null;
  name: string;
  default_draft_visibility: Generated<DraftVisibility>;
  auto_release_on_create: Generated<boolean>;
  numbering_mode: Generated<'on_create' | 'on_first_crossing'>;
  tick_closes_issue: Generated<boolean>;
  allow_amendment_while_open: Generated<boolean>;
  closing_json: Generated<unknown>;
  session_state: 'open' | 'locked' | 'closed' | null;
  created_at: Generated<Date>;
}

export interface ScopeRevisionsTable {
  scope_id: string;
  revision_id: string;
  added_at: Generated<Date>;
}

export interface LanesTable {
  id: string;
  project_id: string;
  scope_id: string;
  name: string;
  position: Generated<number>;
  default_draft_visibility: DraftVisibility | null;
  party_visibility_mode: Generated<'open' | 'separated' | 'custom'>;
  lead_party_id: string | null;
}

export interface LaneMembersTable {
  lane_id: string;
  subject_kind: SubjectKind;
  subject_id: string;
}

export interface PartyVisibilityTable {
  lane_id: string;
  viewer_party_id: string;
  owner_party_id: string;
}

export interface GatesTable {
  id: string;
  scope_id: string;
  from_lane_id: string;
  name: string;
  item_kinds: Generated<('comment' | 'response' | 'status')[]>;
  requires_check: Generated<boolean>;
  checker_can_approve: Generated<boolean>;
  checker_can_add_notes: Generated<boolean>;
  checker_can_return: Generated<boolean>;
  checker_can_edit_wording: Generated<boolean>;
  checker_can_delete: Generated<boolean>;
  originator_sees_edits: Generated<boolean>;
  originator_may_override_return: Generated<boolean>;
  originator_may_override_edit: Generated<boolean>;
  originator_may_override_delete: Generated<boolean>;
}

export interface GateTargetsTable {
  gate_id: string;
  to_lane_id: string;
}

export interface GateCheckersTable {
  gate_id: string;
  subject_kind: DraftSubjectKind;
  subject_id: string;
}

export interface StagesTable {
  id: string;
  scope_id: string;
  name: string;
  position: Generated<number>;
  state: Generated<'upcoming' | 'open' | 'closed'>;
  due_at: Date | null;
  participants_json: unknown;
  allow_late_submissions: Generated<boolean>;
}

export interface StatusesTable {
  project_id: string;
  id: string;
  name: string;
  category: 'open' | 'closed' | 'void';
  position: Generated<number>;
}

// --- Review content --------------------------------------------------------------------------

export interface IssuesTable {
  id: string;
  project_id: string;
  scope_id: string;
  origin_lane_id: string;
  number: number | null;
  title: Generated<string>;
  owner_user_id: string;
  owner_party_id: string | null;
  owner_group_id: string | null;
  rev: number;
  deleted: Generated<boolean>;
  ticked: Generated<boolean>;
  record_json: unknown;
  client_time: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface IssueLinksTable {
  issue_id: string;
  markup_id: string;
  created_at: Generated<Date>;
}

export interface ResponsesTable {
  id: string;
  project_id: string;
  scope_id: string;
  origin_lane_id: string;
  issue_id: string | null;
  markup_id: string | null;
  parent_response_id: string | null;
  kind: Generated<'reply' | 'formal' | 'note'>;
  owner_user_id: string;
  owner_party_id: string | null;
  owner_group_id: string | null;
  rev: number;
  deleted: Generated<boolean>;
  record_json: unknown;
  client_time: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface StatusEventsTable {
  id: string;
  project_id: string;
  scope_id: string;
  origin_lane_id: string;
  issue_id: string;
  from_status: string | null;
  to_status: string;
  actor_user_id: string;
  actor_party_id: string | null;
  note: string | null;
  revision_seen_id: string | null;
  rev: Generated<number>;
  client_time: Date | null;
  received_at: Generated<Date>;
}

export interface IssueLaneStateTable {
  issue_id: string;
  lane_id: string;
  status: string;
  status_event_id: string | null;
  version: Generated<number>;
  updated_at: Generated<Date>;
}

// --- Versions, releases and audience rows ----------------------------------------------------

export interface ItemVersionsTable {
  item_kind: VersionedItemKind;
  item_id: string;
  version_rev: number;
  project_id: string;
  scope_id: string | null;
  origin_lane_id: string;
  edited_in_lane_id: string | null;
  author_user_id: string;
  author_party_id: string | null;
  record_json: unknown;
  op_id: string | null;
  client_time: Date | null;
  received_at: Generated<Date>;
}

export interface ReleasesTable {
  id: string;
  project_id: string;
  scope_id: string;
  batch_id: string | null;
  gate_id: string | null;
  from_lane_id: string;
  to_lane_id: string;
  item_kind: VersionedItemKind;
  item_id: string;
  version_rev: number;
  released_by: string;
  released_at: Generated<Date>;
  withdrawn_at: Date | null;
  withdrawn_by: string | null;
}

export interface ItemAccessTable {
  item_kind: VersionedItemKind;
  item_id: string;
  version_rev: number;
  lane_id: string;
  kind: AccessKind;
  owner_party_id: string | null;
}

export interface ItemDraftAccessTable {
  item_kind: VersionedItemKind;
  item_id: string;
  version_rev: number;
  subject_kind: DraftSubjectKind;
  subject_id: string;
}

export interface AssetsTable {
  project_id: string;
  sha256: string;
  size_bytes: string | number;
  media_type: string;
  storage_key: string;
  created_at: Generated<Date>;
}

export interface AssetRefsTable {
  project_id: string;
  sha256: string;
  item_kind: VersionedItemKind;
  item_id: string;
  version_rev: number;
  origin_lane_id: string;
}

// --- Takeoff ---------------------------------------------------------------------------------

interface LaneOwnedRecord {
  id: string;
  project_id: string;
  lane_id: string;
  rev: number;
  deleted: Generated<boolean>;
  record_json: unknown;
  created_by: string;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ScalesTable extends LaneOwnedRecord {
  page_id: string;
}

export interface ViewportsTable extends LaneOwnedRecord {
  page_id: string;
  scale_id: string | null;
}

export interface AssembliesTable extends LaneOwnedRecord {
  name: string;
}

export interface CatalogItemsTable extends LaneOwnedRecord {
  name: string;
}

export interface ProductListsTable extends LaneOwnedRecord {
  name: string;
}

export interface TakeoffTemplatesTable extends LaneOwnedRecord {
  name: string;
}

export interface InvitesTable {
  id: string;
  token_hash: string;
  email: string;
  email_lower: string;
  name: string | null;
  project_id: string | null;
  scope_id: string | null;
  role: 'user' | 'admin';
  created_by: string | null;
  expires_at: Date;
  accepted_at: Date | null;
  accepted_by: string | null;
  created_at: Generated<Date>;
}

export interface Database {
  schema_migrations: SchemaMigrationsTable;
  users: UsersTable;
  sessions: SessionsTable;
  invites: InvitesTable;
  streams: StreamsTable;
  op_results: OpResultsTable;
  markups: MarkupsTable;
  placements: PlacementsTable;
  events: EventsTable;
  workspaces: WorkspacesTable;
  workspace_members: WorkspaceMembersTable;
  identity_providers: IdentityProvidersTable;
  identities: IdentitiesTable;
  companies: CompaniesTable;
  projects: ProjectsTable;
  parties: PartiesTable;
  project_members: ProjectMembersTable;
  groups: GroupsTable;
  group_members: GroupMembersTable;
  documents: DocumentsTable;
  revisions: RevisionsTable;
  sheets: SheetsTable;
  pages: PagesTable;
  document_sets: DocumentSetsTable;
  document_set_members: DocumentSetMembersTable;
  document_set_documents: DocumentSetDocumentsTable;
  scopes: ScopesTable;
  scope_revisions: ScopeRevisionsTable;
  lanes: LanesTable;
  lane_members: LaneMembersTable;
  party_visibility: PartyVisibilityTable;
  gates: GatesTable;
  gate_targets: GateTargetsTable;
  gate_checkers: GateCheckersTable;
  stages: StagesTable;
  statuses: StatusesTable;
  issues: IssuesTable;
  issue_links: IssueLinksTable;
  responses: ResponsesTable;
  status_events: StatusEventsTable;
  issue_lane_state: IssueLaneStateTable;
  item_versions: ItemVersionsTable;
  releases: ReleasesTable;
  item_access: ItemAccessTable;
  item_draft_access: ItemDraftAccessTable;
  assets: AssetsTable;
  asset_refs: AssetRefsTable;
  scales: ScalesTable;
  viewports: ViewportsTable;
  assemblies: AssembliesTable;
  catalog_items: CatalogItemsTable;
  product_lists: ProductListsTable;
  takeoff_templates: TakeoffTemplatesTable;
}

/** Tables that have row-level security enabled and forced. */
export const RLS_TABLES = [
  'markups',
  'placements',
  'issues',
  'issue_links',
  'responses',
  'status_events',
  'issue_lane_state',
  'item_versions',
  'releases',
  'assets',
  'asset_refs',
  'events',
  'op_results',
  'scales',
  'viewports',
  'assemblies',
  'catalog_items',
  'product_lists',
  'takeoff_templates',
] as const satisfies readonly (keyof Database)[];
