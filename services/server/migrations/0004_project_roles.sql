-- Project descriptions, single-team project member roles, and link-only / role-bearing invites.

ALTER TABLE projects
  ADD COLUMN description TEXT;

ALTER TABLE project_members
  ADD COLUMN role TEXT NOT NULL DEFAULT 'reviewer'
    CHECK (role IN ('project_admin', 'reviewer', 'viewer'));

-- Existing projects must keep an admin. Schema v1 records no project creator and no project role;
-- the only records of authority are users.is_admin (server admin) and workspace_members.role. So
-- active, enabled members who are server admins, or admins of the project's workspace, become
-- project admins.
UPDATE project_members AS pm
SET role = 'project_admin'
FROM projects AS p, users AS u
WHERE p.id = pm.project_id
  AND u.id = pm.user_id
  AND pm.state = 'active'
  AND u.disabled_at IS NULL
  AND (
    u.is_admin
    OR EXISTS (
      SELECT 1 FROM workspace_members AS wm
      WHERE wm.workspace_id = p.workspace_id AND wm.user_id = pm.user_id AND wm.role = 'admin'
    )
  );

-- A project that still has none gets its longest-standing active, enabled member: the nearest
-- thing schema v1 has to a creator.
UPDATE project_members AS pm
SET role = 'project_admin'
FROM (
  SELECT DISTINCT ON (m.project_id) m.project_id, m.user_id
  FROM project_members AS m
  JOIN users AS u ON u.id = m.user_id
  WHERE m.state = 'active'
    AND u.disabled_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM project_members AS a
      WHERE a.project_id = m.project_id AND a.state = 'active' AND a.role = 'project_admin'
    )
  ORDER BY m.project_id, m.created_at, m.user_id
) AS longest_standing
WHERE pm.project_id = longest_standing.project_id
  AND pm.user_id = longest_standing.user_id;

-- An invite without an email is a bearer link: anyone holding it can use it. That is only allowed
-- for joining a project as an ordinary user, so a server-admin invite always names an email.
-- email and email_lower are set together, because acceptance matches on email_lower.
ALTER TABLE invites
  ALTER COLUMN email DROP NOT NULL,
  ALTER COLUMN email_lower DROP NOT NULL,
  ADD COLUMN project_role TEXT
    CHECK (project_role IS NULL OR project_role IN ('project_admin', 'reviewer', 'viewer')),
  ADD COLUMN revoked_at TIMESTAMPTZ,
  ADD CONSTRAINT invites_email_pair_check
    CHECK ((email IS NULL) = (email_lower IS NULL)),
  ADD CONSTRAINT invites_link_only_check
    CHECK (email_lower IS NOT NULL OR (project_id IS NOT NULL AND role = 'user'));

CREATE INDEX invites_project_id_idx ON invites (project_id);
