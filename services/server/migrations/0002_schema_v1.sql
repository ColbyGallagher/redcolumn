-- Schema v1: tenancy, review processes, documents, versioned review content, audience rows,
-- takeoff libraries, and row-level security on every content table.
--
-- Additive on top of 0001_skeleton.sql: existing tables gain nullable or defaulted columns only,
-- so the document-stream write path keeps working unchanged.
--
-- How visibility is enforced
-- --------------------------
-- The permission rules live in TypeScript (@nb/policy). At write time the server turns them into
-- explicit audience rows:
--   item_access(item_kind, item_id, version_rev, lane_id, kind, owner_party_id)
--     kind = 'internal' (inside the lane, still filtered by the lane's party matrix)
--          | 'released' (a version released to that lane)
--   item_draft_access(item_kind, item_id, version_rev, subject_kind, subject_id)
--     the author and assigned checkers of a private draft
--   lane_members(lane_id, subject_kind, subject_id) and party_visibility(lane_id, viewer, owner)
-- The SELECT policies below only check that a matching row exists for the user named by
-- current_setting('app.user_id'). With no matching rows a query returns nothing.
--
-- Current-state tables (markups, issues, ...) hold the latest version of each item. A row is
-- visible only when the user may see exactly that version (its `rev`). Older versions that were
-- released to a lane are read from item_versions, which is filtered per version.
--
-- Roles: the role that runs migrations and the server's write path must be a superuser or have
-- BYPASSRLS. Queries made on behalf of a user run as a role without BYPASSRLS, inside a
-- transaction that does SET LOCAL ROLE <reader role> and SET LOCAL app.user_id = '<user id>'.
-- Only SELECT policies are defined, so such a role cannot write content tables.

-- ---------------------------------------------------------------------------------------------
-- Tenancy and people
-- ---------------------------------------------------------------------------------------------

CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE workspace_members (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, user_id)
);

CREATE INDEX workspace_members_user_id_idx ON workspace_members (user_id);

-- A sign-in method. workspace_id is NULL for server-wide providers (local accounts, one SSO for
-- the whole server) and set for a provider that belongs to one organisation.
CREATE TABLE identity_providers (
  id TEXT PRIMARY KEY,
  workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('local', 'oidc', 'saml')),
  name TEXT NOT NULL,
  config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE identities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL REFERENCES identity_providers(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  UNIQUE (provider_id, subject)
);

CREATE INDEX identities_user_id_idx ON identities (user_id);

-- A firm people work for. Not a tenant.
CREATE TABLE companies (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  number TEXT,
  settings_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ
);

CREATE INDEX projects_workspace_id_idx ON projects (workspace_id);

-- A company's participation in one project, with its contract role.
CREATE TABLE parties (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  company_id TEXT REFERENCES companies(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  contract_role TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX parties_project_id_idx ON parties (project_id);

-- A user on a project, acting for one party.
CREATE TABLE project_members (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  party_id TEXT REFERENCES parties(id) ON DELETE SET NULL,
  state TEXT NOT NULL DEFAULT 'invited' CHECK (state IN ('invited', 'active', 'removed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (project_id, user_id)
);

CREATE INDEX project_members_user_id_idx ON project_members (user_id);

-- A named set of members. A workspace group is a reusable list; a project group may stay linked
-- to the workspace group it was copied from.
CREATE TABLE groups (
  id TEXT PRIMARY KEY,
  workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  party_id TEXT REFERENCES parties(id) ON DELETE SET NULL,
  linked_group_id TEXT REFERENCES groups(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((workspace_id IS NULL) <> (project_id IS NULL))
);

CREATE TABLE group_members (
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (group_id, user_id)
);

CREATE INDEX group_members_user_id_idx ON group_members (user_id);

-- ---------------------------------------------------------------------------------------------
-- Documents
-- ---------------------------------------------------------------------------------------------

CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  number TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  discipline TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, number)
);

-- One issued version of a document. Never changes once written.
CREATE TABLE revisions (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  file_sha256 TEXT NOT NULL CHECK (file_sha256 ~ '^[0-9a-f]{64}$'),
  file_size BIGINT NOT NULL CHECK (file_size >= 0),
  page_count INTEGER NOT NULL CHECK (page_count >= 0),
  issued_by TEXT,
  issued_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (document_id, label)
);

-- A logical page that continues across revisions.
CREATE TABLE sheets (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  sheet_number TEXT NOT NULL,
  title TEXT,
  UNIQUE (document_id, sheet_number)
);

-- One physical page of one revision.
CREATE TABLE pages (
  id TEXT PRIMARY KEY,
  revision_id TEXT NOT NULL REFERENCES revisions(id) ON DELETE CASCADE,
  sheet_id TEXT REFERENCES sheets(id) ON DELETE SET NULL,
  position INTEGER NOT NULL CHECK (position >= 0),
  width DOUBLE PRECISION NOT NULL,
  height DOUBLE PRECISION NOT NULL,
  rotation INTEGER NOT NULL DEFAULT 0 CHECK (rotation IN (0, 90, 180, 270)),
  UNIQUE (revision_id, position)
);

CREATE TABLE document_sets (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  -- FALSE: every active project member may use the set. TRUE: only document_set_members.
  members_restricted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE document_set_members (
  document_set_id TEXT NOT NULL REFERENCES document_sets(id) ON DELETE CASCADE,
  subject_kind TEXT NOT NULL CHECK (subject_kind IN ('user', 'group', 'party', 'lane')),
  subject_id TEXT NOT NULL,
  PRIMARY KEY (document_set_id, subject_kind, subject_id)
);

CREATE TABLE document_set_documents (
  document_set_id TEXT NOT NULL REFERENCES document_sets(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  PRIMARY KEY (document_set_id, document_id)
);

-- ---------------------------------------------------------------------------------------------
-- Process: scopes, lanes, gates, stages
-- ---------------------------------------------------------------------------------------------

-- Each content item belongs to exactly one scope: a review, or a standalone session (which may
-- belong to a review).
CREATE TABLE scopes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('review', 'session')),
  parent_review_id TEXT REFERENCES scopes(id) ON DELETE CASCADE,
  document_set_id TEXT REFERENCES document_sets(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  default_draft_visibility TEXT NOT NULL DEFAULT 'private'
    CHECK (default_draft_visibility IN ('private', 'lane')),
  auto_release_on_create BOOLEAN NOT NULL DEFAULT FALSE,
  numbering_mode TEXT NOT NULL DEFAULT 'on_create'
    CHECK (numbering_mode IN ('on_create', 'on_first_crossing')),
  tick_closes_issue BOOLEAN NOT NULL DEFAULT FALSE,
  allow_amendment_while_open BOOLEAN NOT NULL DEFAULT TRUE,
  closing_json JSONB NOT NULL DEFAULT '{"allowedClosers":[]}'::jsonb,
  session_state TEXT CHECK (session_state IN ('open', 'locked', 'closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (kind = 'session' OR parent_review_id IS NULL)
);

CREATE INDEX scopes_project_id_idx ON scopes (project_id);

-- Revisions included in a review or session. Scopes point at revisions; they never copy files.
CREATE TABLE scope_revisions (
  scope_id TEXT NOT NULL REFERENCES scopes(id) ON DELETE CASCADE,
  revision_id TEXT NOT NULL REFERENCES revisions(id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (scope_id, revision_id)
);

-- One side of a wall inside a scope.
CREATE TABLE lanes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  scope_id TEXT NOT NULL REFERENCES scopes(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  default_draft_visibility TEXT CHECK (default_draft_visibility IN ('private', 'lane')),
  party_visibility_mode TEXT NOT NULL DEFAULT 'open'
    CHECK (party_visibility_mode IN ('open', 'separated', 'custom')),
  lead_party_id TEXT REFERENCES parties(id) ON DELETE SET NULL
);

CREATE INDEX lanes_scope_id_idx ON lanes (scope_id);

CREATE TABLE lane_members (
  lane_id TEXT NOT NULL REFERENCES lanes(id) ON DELETE CASCADE,
  subject_kind TEXT NOT NULL CHECK (subject_kind IN ('user', 'group', 'party')),
  subject_id TEXT NOT NULL,
  PRIMARY KEY (lane_id, subject_kind, subject_id)
);

CREATE INDEX lane_members_subject_idx ON lane_members (subject_kind, subject_id);

-- Compiled party matrix: inside lane_id, members of viewer_party_id may see internal items owned
-- by owner_party_id.
CREATE TABLE party_visibility (
  lane_id TEXT NOT NULL REFERENCES lanes(id) ON DELETE CASCADE,
  viewer_party_id TEXT NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  owner_party_id TEXT NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  PRIMARY KEY (lane_id, viewer_party_id, owner_party_id)
);

-- An allowed route out of a lane, with what a checker in a receiving lane may do.
CREATE TABLE gates (
  id TEXT PRIMARY KEY,
  scope_id TEXT NOT NULL REFERENCES scopes(id) ON DELETE CASCADE,
  from_lane_id TEXT NOT NULL REFERENCES lanes(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  item_kinds TEXT[] NOT NULL DEFAULT ARRAY['comment', 'response', 'status']::TEXT[]
    CHECK (item_kinds <@ ARRAY['comment', 'response', 'status']::TEXT[]),
  requires_check BOOLEAN NOT NULL DEFAULT FALSE,
  checker_can_approve BOOLEAN NOT NULL DEFAULT FALSE,
  checker_can_add_notes BOOLEAN NOT NULL DEFAULT FALSE,
  checker_can_return BOOLEAN NOT NULL DEFAULT FALSE,
  checker_can_edit_wording BOOLEAN NOT NULL DEFAULT FALSE,
  checker_can_delete BOOLEAN NOT NULL DEFAULT FALSE,
  originator_sees_edits BOOLEAN NOT NULL DEFAULT TRUE,
  originator_may_override_return BOOLEAN NOT NULL DEFAULT FALSE,
  originator_may_override_edit BOOLEAN NOT NULL DEFAULT FALSE,
  originator_may_override_delete BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE gate_targets (
  gate_id TEXT NOT NULL REFERENCES gates(id) ON DELETE CASCADE,
  to_lane_id TEXT NOT NULL REFERENCES lanes(id) ON DELETE CASCADE,
  PRIMARY KEY (gate_id, to_lane_id)
);

-- Assigned checkers for drafts leaving through this gate.
CREATE TABLE gate_checkers (
  gate_id TEXT NOT NULL REFERENCES gates(id) ON DELETE CASCADE,
  subject_kind TEXT NOT NULL CHECK (subject_kind IN ('user', 'group')),
  subject_id TEXT NOT NULL,
  PRIMARY KEY (gate_id, subject_kind, subject_id)
);

CREATE TABLE stages (
  id TEXT PRIMARY KEY,
  scope_id TEXT NOT NULL REFERENCES scopes(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'upcoming' CHECK (state IN ('upcoming', 'open', 'closed')),
  due_at TIMESTAMPTZ,
  participants_json JSONB,
  allow_late_submissions BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX stages_scope_id_idx ON stages (scope_id);

-- Project status set. Rules use the category, never the status name.
CREATE TABLE statuses (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('open', 'closed', 'void')),
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (project_id, id)
);

-- ---------------------------------------------------------------------------------------------
-- Streams, events and operation results (extending the skeleton)
-- ---------------------------------------------------------------------------------------------

ALTER TABLE streams ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE CASCADE;

-- received_at (the server's clock, authoritative) is kept from the skeleton; client_time is the
-- author's clock, shown as "made offline at". item_kind / version_rev / lane_id say which item
-- version an event produced, so the sync feed can filter events through the access rows.
ALTER TABLE events
  ADD COLUMN client_time TIMESTAMPTZ,
  ADD COLUMN item_kind TEXT,
  ADD COLUMN version_rev INTEGER,
  ADD COLUMN lane_id TEXT;

-- ---------------------------------------------------------------------------------------------
-- Review content (current state)
-- ---------------------------------------------------------------------------------------------

-- Markups and placements keep their skeleton columns. `rev` is the item's version number and is
-- what item_access.version_rev / item_draft_access.version_rev refer to.
ALTER TABLE markups
  ADD COLUMN project_id TEXT,
  ADD COLUMN origin_lane_id TEXT,
  ADD COLUMN draft_visibility TEXT NOT NULL DEFAULT 'private'
    CHECK (draft_visibility IN ('private', 'lane')),
  ADD COLUMN checking_state TEXT NOT NULL DEFAULT 'draft'
    CHECK (checking_state IN ('draft', 'submitted', 'returned', 'released', 'withdrawn', 'stopped')),
  ADD COLUMN client_time TIMESTAMPTZ;

CREATE INDEX markups_scope_id_idx ON markups (scope_id);

ALTER TABLE placements
  ADD COLUMN scope_id TEXT,
  ADD COLUMN origin_lane_id TEXT,
  ADD COLUMN owner_party_id TEXT,
  ADD COLUMN method TEXT NOT NULL DEFAULT 'original'
    CHECK (method IN ('original', 'aligned', 'manual', 'suggested')),
  ADD COLUMN client_time TIMESTAMPTZ;

-- The thing tracked to close-out, with or without a drawing. Its status per lane lives in
-- issue_lane_state.
CREATE TABLE issues (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  scope_id TEXT NOT NULL REFERENCES scopes(id) ON DELETE CASCADE,
  origin_lane_id TEXT NOT NULL REFERENCES lanes(id) ON DELETE CASCADE,
  number INTEGER,
  title TEXT NOT NULL DEFAULT '',
  owner_user_id TEXT NOT NULL,
  owner_party_id TEXT,
  owner_group_id TEXT,
  rev INTEGER NOT NULL CHECK (rev >= 1),
  deleted BOOLEAN NOT NULL DEFAULT FALSE,
  ticked BOOLEAN NOT NULL DEFAULT FALSE,
  record_json JSONB NOT NULL,
  client_time TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, number)
);

CREATE INDEX issues_scope_id_idx ON issues (scope_id);

CREATE TABLE issue_links (
  issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  markup_id TEXT NOT NULL REFERENCES markups(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (issue_id, markup_id)
);

CREATE INDEX issue_links_markup_id_idx ON issue_links (markup_id);

CREATE TABLE responses (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  scope_id TEXT NOT NULL REFERENCES scopes(id) ON DELETE CASCADE,
  origin_lane_id TEXT NOT NULL REFERENCES lanes(id) ON DELETE CASCADE,
  issue_id TEXT REFERENCES issues(id) ON DELETE CASCADE,
  markup_id TEXT REFERENCES markups(id) ON DELETE CASCADE,
  parent_response_id TEXT REFERENCES responses(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'reply' CHECK (kind IN ('reply', 'formal', 'note')),
  owner_user_id TEXT NOT NULL,
  owner_party_id TEXT,
  owner_group_id TEXT,
  rev INTEGER NOT NULL CHECK (rev >= 1),
  deleted BOOLEAN NOT NULL DEFAULT FALSE,
  record_json JSONB NOT NULL,
  client_time TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (issue_id IS NOT NULL OR markup_id IS NOT NULL)
);

CREATE INDEX responses_issue_id_idx ON responses (issue_id);

-- One status change. Append-only.
CREATE TABLE status_events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  scope_id TEXT NOT NULL REFERENCES scopes(id) ON DELETE CASCADE,
  origin_lane_id TEXT NOT NULL REFERENCES lanes(id) ON DELETE CASCADE,
  issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  actor_party_id TEXT,
  note TEXT,
  revision_seen_id TEXT REFERENCES revisions(id) ON DELETE SET NULL,
  rev INTEGER NOT NULL DEFAULT 1 CHECK (rev >= 1),
  client_time TIMESTAMPTZ,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX status_events_issue_id_idx ON status_events (issue_id);

-- An issue's current status as one lane sees it. One lane may show an issue as open while
-- another is still deciding internally whether to close it.
CREATE TABLE issue_lane_state (
  issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  lane_id TEXT NOT NULL REFERENCES lanes(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  status_event_id TEXT REFERENCES status_events(id) ON DELETE SET NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (issue_id, lane_id)
);

CREATE INDEX issue_lane_state_lane_id_idx ON issue_lane_state (lane_id);

-- ---------------------------------------------------------------------------------------------
-- Versions, releases and audience rows
-- ---------------------------------------------------------------------------------------------

-- An unchangeable version of a content item.
CREATE TABLE item_versions (
  item_kind TEXT NOT NULL,
  item_id TEXT NOT NULL,
  version_rev INTEGER NOT NULL CHECK (version_rev >= 1),
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  scope_id TEXT REFERENCES scopes(id) ON DELETE CASCADE,
  origin_lane_id TEXT NOT NULL REFERENCES lanes(id) ON DELETE CASCADE,
  -- Set when a checker in another lane produced this version (e.g. a wording edit).
  edited_in_lane_id TEXT REFERENCES lanes(id) ON DELETE SET NULL,
  author_user_id TEXT NOT NULL,
  author_party_id TEXT,
  record_json JSONB NOT NULL,
  op_id TEXT,
  client_time TIMESTAMPTZ,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (item_kind, item_id, version_rev)
);

-- A record that one item version became visible to one lane: who, when, through which gate.
CREATE TABLE releases (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  scope_id TEXT NOT NULL REFERENCES scopes(id) ON DELETE CASCADE,
  batch_id TEXT,
  gate_id TEXT REFERENCES gates(id) ON DELETE SET NULL,
  from_lane_id TEXT NOT NULL REFERENCES lanes(id) ON DELETE CASCADE,
  to_lane_id TEXT NOT NULL REFERENCES lanes(id) ON DELETE CASCADE,
  item_kind TEXT NOT NULL,
  item_id TEXT NOT NULL,
  version_rev INTEGER NOT NULL CHECK (version_rev >= 1),
  released_by TEXT NOT NULL,
  released_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  withdrawn_at TIMESTAMPTZ,
  withdrawn_by TEXT
);

CREATE INDEX releases_item_idx ON releases (item_kind, item_id);
CREATE INDEX releases_to_lane_id_idx ON releases (to_lane_id);

CREATE TABLE item_access (
  item_kind TEXT NOT NULL,
  item_id TEXT NOT NULL,
  version_rev INTEGER NOT NULL CHECK (version_rev >= 1),
  lane_id TEXT NOT NULL REFERENCES lanes(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('internal', 'released')),
  -- For 'internal' rows: the owning party, checked against party_visibility. NULL means the
  -- lane's party matrix does not apply (for example a checker's edit, or an owner outside the lane).
  owner_party_id TEXT,
  PRIMARY KEY (item_kind, item_id, version_rev, lane_id, kind)
);

CREATE INDEX item_access_lane_idx ON item_access (lane_id, item_kind, item_id);

CREATE TABLE item_draft_access (
  item_kind TEXT NOT NULL,
  item_id TEXT NOT NULL,
  version_rev INTEGER NOT NULL CHECK (version_rev >= 1),
  subject_kind TEXT NOT NULL CHECK (subject_kind IN ('user', 'group')),
  subject_id TEXT NOT NULL,
  PRIMARY KEY (item_kind, item_id, version_rev, subject_kind, subject_id)
);

CREATE INDEX item_draft_access_subject_idx ON item_draft_access (subject_kind, subject_id);

-- Item kinds used by the audience rows: the review content kinds plus the takeoff kinds.
ALTER TABLE item_versions ADD CONSTRAINT item_versions_item_kind_check CHECK (item_kind IN (
  'markup', 'placement', 'issue', 'response', 'statusEvent',
  'scale', 'viewport', 'assembly', 'catalogItem', 'productList', 'takeoffTemplate'));
ALTER TABLE releases ADD CONSTRAINT releases_item_kind_check CHECK (item_kind IN (
  'markup', 'placement', 'issue', 'response', 'statusEvent',
  'scale', 'viewport', 'assembly', 'catalogItem', 'productList', 'takeoffTemplate'));
ALTER TABLE item_access ADD CONSTRAINT item_access_item_kind_check CHECK (item_kind IN (
  'markup', 'placement', 'issue', 'response', 'statusEvent',
  'scale', 'viewport', 'assembly', 'catalogItem', 'productList', 'takeoffTemplate'));
ALTER TABLE item_draft_access ADD CONSTRAINT item_draft_access_item_kind_check CHECK (item_kind IN (
  'markup', 'placement', 'issue', 'response', 'statusEvent',
  'scale', 'viewport', 'assembly', 'catalogItem', 'productList', 'takeoffTemplate'));

-- ---------------------------------------------------------------------------------------------
-- Assets (content-addressed per project)
-- ---------------------------------------------------------------------------------------------

CREATE TABLE assets (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sha256 TEXT NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes BIGINT NOT NULL CHECK (size_bytes >= 0),
  media_type TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (project_id, sha256)
);

-- Which item versions use an asset. An asset is visible only through a version the user may see,
-- so knowing a hash from another lane gives nothing.
CREATE TABLE asset_refs (
  project_id TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  item_kind TEXT NOT NULL,
  item_id TEXT NOT NULL,
  version_rev INTEGER NOT NULL CHECK (version_rev >= 1),
  origin_lane_id TEXT NOT NULL REFERENCES lanes(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, sha256, item_kind, item_id, version_rev),
  FOREIGN KEY (project_id, sha256) REFERENCES assets(project_id, sha256) ON DELETE CASCADE
);

CREATE INDEX asset_refs_item_idx ON asset_refs (item_kind, item_id, version_rev);

-- ---------------------------------------------------------------------------------------------
-- Takeoff (each record belongs to one lane; private to it unless a version is shared)
-- ---------------------------------------------------------------------------------------------

CREATE TABLE scales (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  lane_id TEXT NOT NULL REFERENCES lanes(id) ON DELETE CASCADE,
  page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  rev INTEGER NOT NULL CHECK (rev >= 1),
  deleted BOOLEAN NOT NULL DEFAULT FALSE,
  record_json JSONB NOT NULL,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE viewports (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  lane_id TEXT NOT NULL REFERENCES lanes(id) ON DELETE CASCADE,
  page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  scale_id TEXT REFERENCES scales(id) ON DELETE SET NULL,
  rev INTEGER NOT NULL CHECK (rev >= 1),
  deleted BOOLEAN NOT NULL DEFAULT FALSE,
  record_json JSONB NOT NULL,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE assemblies (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  lane_id TEXT NOT NULL REFERENCES lanes(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  rev INTEGER NOT NULL CHECK (rev >= 1),
  deleted BOOLEAN NOT NULL DEFAULT FALSE,
  record_json JSONB NOT NULL,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE catalog_items (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  lane_id TEXT NOT NULL REFERENCES lanes(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  rev INTEGER NOT NULL CHECK (rev >= 1),
  deleted BOOLEAN NOT NULL DEFAULT FALSE,
  record_json JSONB NOT NULL,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE product_lists (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  lane_id TEXT NOT NULL REFERENCES lanes(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  rev INTEGER NOT NULL CHECK (rev >= 1),
  deleted BOOLEAN NOT NULL DEFAULT FALSE,
  record_json JSONB NOT NULL,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE takeoff_templates (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  lane_id TEXT NOT NULL REFERENCES lanes(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  rev INTEGER NOT NULL CHECK (rev >= 1),
  deleted BOOLEAN NOT NULL DEFAULT FALSE,
  record_json JSONB NOT NULL,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX scales_lane_id_idx ON scales (lane_id);
CREATE INDEX viewports_lane_id_idx ON viewports (lane_id);
CREATE INDEX assemblies_lane_id_idx ON assemblies (lane_id);
CREATE INDEX catalog_items_lane_id_idx ON catalog_items (lane_id);
CREATE INDEX product_lists_lane_id_idx ON product_lists (lane_id);
CREATE INDEX takeoff_templates_lane_id_idx ON takeoff_templates (lane_id);

-- ---------------------------------------------------------------------------------------------
-- Immutable records
-- ---------------------------------------------------------------------------------------------

-- Updates are always refused. A direct DELETE is refused too; a delete cascading from a parent
-- row (a project or document being removed) runs inside a foreign-key trigger and is allowed.
CREATE FUNCTION reject_record_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION '% rows are immutable', TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER revisions_immutable BEFORE UPDATE ON revisions
  FOR EACH ROW EXECUTE FUNCTION reject_record_change();
CREATE TRIGGER item_versions_immutable BEFORE UPDATE OR DELETE ON item_versions
  FOR EACH ROW EXECUTE FUNCTION reject_record_change();
CREATE TRIGGER status_events_immutable BEFORE UPDATE OR DELETE ON status_events
  FOR EACH ROW EXECUTE FUNCTION reject_record_change();

-- ---------------------------------------------------------------------------------------------
-- Visibility helpers used by the row-level security policies
-- ---------------------------------------------------------------------------------------------
-- SECURITY DEFINER so a reader role needs no access to membership tables. They only ever answer
-- for the user in app.user_id.

CREATE FUNCTION app_current_user_id() RETURNS TEXT
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')
$$;

-- Lanes the current user belongs to (as an active project member, directly, through a group or
-- through their party), limited to scopes whose document set they may use, with the party they
-- act for.
CREATE FUNCTION app_user_lanes() RETURNS TABLE (lane_id TEXT, party_id TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH member_lanes AS (
    SELECT l.id AS lane_id, l.scope_id, pm.user_id, pm.party_id
    FROM project_members pm
    JOIN lanes l ON l.project_id = pm.project_id
    WHERE pm.user_id = app_current_user_id()
      AND pm.state = 'active'
      AND EXISTS (
        SELECT 1 FROM lane_members lm
        WHERE lm.lane_id = l.id
          AND ((lm.subject_kind = 'user' AND lm.subject_id = pm.user_id)
            OR (lm.subject_kind = 'party' AND lm.subject_id = pm.party_id)
            OR (lm.subject_kind = 'group' AND EXISTS (
                  SELECT 1 FROM group_members gm
                  WHERE gm.group_id = lm.subject_id AND gm.user_id = pm.user_id)))
      )
  )
  SELECT ml.lane_id, ml.party_id
  FROM member_lanes ml
  JOIN scopes s ON s.id = ml.scope_id
  LEFT JOIN document_sets ds ON ds.id = s.document_set_id
  WHERE ds.id IS NULL
     OR NOT ds.members_restricted
     OR EXISTS (
       SELECT 1 FROM document_set_members dsm
       WHERE dsm.document_set_id = ds.id
         AND ((dsm.subject_kind = 'user' AND dsm.subject_id = ml.user_id)
           OR (dsm.subject_kind = 'party' AND dsm.subject_id = ml.party_id)
           OR (dsm.subject_kind = 'group' AND EXISTS (
                 SELECT 1 FROM group_members gm
                 WHERE gm.group_id = dsm.subject_id AND gm.user_id = ml.user_id))
           OR (dsm.subject_kind = 'lane' AND EXISTS (
                 SELECT 1 FROM member_lanes ml2
                 WHERE ml2.lane_id = dsm.subject_id AND ml2.scope_id = ml.scope_id)))
     )
$$;

CREATE FUNCTION app_in_lane(p_lane_id TEXT) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM app_user_lanes() m WHERE m.lane_id = p_lane_id)
$$;

-- Whether the current user may see version p_rev of an item (any version when p_rev is NULL):
--   * an item_access row for one of the user's lanes ('released', or 'internal' and allowed by
--     the lane's party matrix), or
--   * an item_draft_access row naming the user or one of their groups, while the user is in the
--     item's origin lane.
CREATE FUNCTION app_can_see(p_kind TEXT, p_id TEXT, p_rev INTEGER, p_origin_lane_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH my AS (SELECT lane_id, party_id FROM app_user_lanes())
  SELECT EXISTS (
    SELECT 1
    FROM item_access a
    JOIN my ON my.lane_id = a.lane_id
    WHERE a.item_kind = p_kind
      AND a.item_id = p_id
      AND (p_rev IS NULL OR a.version_rev = p_rev)
      AND (a.kind = 'released'
        OR a.owner_party_id IS NULL
        OR my.party_id IS NULL
        OR my.party_id = a.owner_party_id
        OR EXISTS (
          SELECT 1 FROM party_visibility pv
          WHERE pv.lane_id = a.lane_id
            AND pv.viewer_party_id = my.party_id
            AND pv.owner_party_id = a.owner_party_id))
  ) OR EXISTS (
    SELECT 1
    FROM item_draft_access d
    WHERE d.item_kind = p_kind
      AND d.item_id = p_id
      AND (p_rev IS NULL OR d.version_rev = p_rev)
      AND EXISTS (SELECT 1 FROM my WHERE my.lane_id = p_origin_lane_id)
      AND ((d.subject_kind = 'user' AND d.subject_id = app_current_user_id())
        OR (d.subject_kind = 'group' AND EXISTS (
              SELECT 1 FROM group_members gm
              WHERE gm.group_id = d.subject_id AND gm.user_id = app_current_user_id())))
  )
$$;

-- ---------------------------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------------------------

ALTER TABLE markups ENABLE ROW LEVEL SECURITY;
ALTER TABLE markups FORCE ROW LEVEL SECURITY;
CREATE POLICY markups_read ON markups FOR SELECT
  USING (app_can_see('markup', id, rev, origin_lane_id));

ALTER TABLE placements ENABLE ROW LEVEL SECURITY;
ALTER TABLE placements FORCE ROW LEVEL SECURITY;
CREATE POLICY placements_read ON placements FOR SELECT
  USING (app_can_see('placement', id, rev, origin_lane_id));

ALTER TABLE issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE issues FORCE ROW LEVEL SECURITY;
CREATE POLICY issues_read ON issues FOR SELECT
  USING (app_can_see('issue', id, rev, origin_lane_id));

ALTER TABLE issue_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE issue_links FORCE ROW LEVEL SECURITY;
CREATE POLICY issue_links_read ON issue_links FOR SELECT
  USING (
    app_can_see('issue', issue_id, NULL, (SELECT i.origin_lane_id FROM issues i WHERE i.id = issue_id))
    AND app_can_see('markup', markup_id, NULL, (SELECT m.origin_lane_id FROM markups m WHERE m.id = markup_id))
  );

ALTER TABLE responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE responses FORCE ROW LEVEL SECURITY;
CREATE POLICY responses_read ON responses FOR SELECT
  USING (app_can_see('response', id, rev, origin_lane_id));

ALTER TABLE status_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE status_events FORCE ROW LEVEL SECURITY;
CREATE POLICY status_events_read ON status_events FOR SELECT
  USING (app_can_see('statusEvent', id, rev, origin_lane_id));

ALTER TABLE issue_lane_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE issue_lane_state FORCE ROW LEVEL SECURITY;
CREATE POLICY issue_lane_state_read ON issue_lane_state FOR SELECT
  USING (app_in_lane(lane_id));

ALTER TABLE item_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE item_versions FORCE ROW LEVEL SECURITY;
-- Takeoff versions are also visible to their owning lane, like the takeoff tables themselves.
CREATE POLICY item_versions_read ON item_versions FOR SELECT
  USING (
    app_can_see(item_kind, item_id, version_rev, origin_lane_id)
    OR (item_kind IN ('scale', 'viewport', 'assembly', 'catalogItem', 'productList', 'takeoffTemplate')
        AND app_in_lane(origin_lane_id))
  );

-- A release is visible to its sending and receiving lanes, and only for a version the user may see.
ALTER TABLE releases ENABLE ROW LEVEL SECURITY;
ALTER TABLE releases FORCE ROW LEVEL SECURITY;
CREATE POLICY releases_read ON releases FOR SELECT
  USING (
    (app_in_lane(from_lane_id) OR app_in_lane(to_lane_id))
    AND app_can_see(item_kind, item_id, version_rev, from_lane_id)
  );

ALTER TABLE asset_refs ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset_refs FORCE ROW LEVEL SECURITY;
CREATE POLICY asset_refs_read ON asset_refs FOR SELECT
  USING (app_can_see(item_kind, item_id, version_rev, origin_lane_id));

ALTER TABLE assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE assets FORCE ROW LEVEL SECURITY;
CREATE POLICY assets_read ON assets FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM asset_refs r
    WHERE r.project_id = assets.project_id AND r.sha256 = assets.sha256
  ));

-- The event log carries operation payloads. An event is visible only for the item version it
-- produced; events without that information are hidden from readers.
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE events FORCE ROW LEVEL SECURITY;
CREATE POLICY events_read ON events FOR SELECT
  USING (
    item_kind IS NOT NULL AND version_rev IS NOT NULL
    AND app_can_see(item_kind, entity_id, version_rev, lane_id)
  );

-- Operation results are private to the actor who sent the operation.
ALTER TABLE op_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE op_results FORCE ROW LEVEL SECURITY;
CREATE POLICY op_results_read ON op_results FOR SELECT
  USING (actor_id = app_current_user_id());

-- Takeoff: visible to the owning lane, or to another lane for exactly a version shared with it.
ALTER TABLE scales ENABLE ROW LEVEL SECURITY;
ALTER TABLE scales FORCE ROW LEVEL SECURITY;
CREATE POLICY scales_read ON scales FOR SELECT
  USING (app_in_lane(lane_id) OR app_can_see('scale', id, rev, lane_id));

ALTER TABLE viewports ENABLE ROW LEVEL SECURITY;
ALTER TABLE viewports FORCE ROW LEVEL SECURITY;
CREATE POLICY viewports_read ON viewports FOR SELECT
  USING (app_in_lane(lane_id) OR app_can_see('viewport', id, rev, lane_id));

ALTER TABLE assemblies ENABLE ROW LEVEL SECURITY;
ALTER TABLE assemblies FORCE ROW LEVEL SECURITY;
CREATE POLICY assemblies_read ON assemblies FOR SELECT
  USING (app_in_lane(lane_id) OR app_can_see('assembly', id, rev, lane_id));

ALTER TABLE catalog_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_items FORCE ROW LEVEL SECURITY;
CREATE POLICY catalog_items_read ON catalog_items FOR SELECT
  USING (app_in_lane(lane_id) OR app_can_see('catalogItem', id, rev, lane_id));

ALTER TABLE product_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_lists FORCE ROW LEVEL SECURITY;
CREATE POLICY product_lists_read ON product_lists FOR SELECT
  USING (app_in_lane(lane_id) OR app_can_see('productList', id, rev, lane_id));

ALTER TABLE takeoff_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE takeoff_templates FORCE ROW LEVEL SECURITY;
CREATE POLICY takeoff_templates_read ON takeoff_templates FOR SELECT
  USING (app_in_lane(lane_id) OR app_can_see('takeoffTemplate', id, rev, lane_id));
