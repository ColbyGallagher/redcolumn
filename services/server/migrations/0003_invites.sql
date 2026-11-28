-- Single-use invitation tokens for onboarding users to the server or a project.

CREATE TABLE invites (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  email_lower TEXT NOT NULL,
  name TEXT,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  scope_id TEXT REFERENCES scopes(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  accepted_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX invites_email_lower_idx ON invites (email_lower);
CREATE INDEX invites_expires_at_idx ON invites (expires_at);
