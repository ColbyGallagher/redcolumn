-- Project descriptions, single-team project member roles, and link-only / role-bearing invites.

ALTER TABLE projects
  ADD COLUMN description TEXT;

ALTER TABLE project_members
  ADD COLUMN role TEXT NOT NULL DEFAULT 'reviewer'
    CHECK (role IN ('project_admin', 'reviewer', 'viewer'));

ALTER TABLE invites
  ALTER COLUMN email DROP NOT NULL,
  ALTER COLUMN email_lower DROP NOT NULL,
  ADD COLUMN project_role TEXT
    CHECK (project_role IS NULL OR project_role IN ('project_admin', 'reviewer', 'viewer'));
