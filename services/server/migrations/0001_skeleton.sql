-- Initial server schema: local accounts, opaque sessions, ordered streams,
-- idempotent operation results, document markups/placements, and event log.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  email_lower TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  is_admin BOOLEAN NOT NULL DEFAULT FALSE,
  disabled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX sessions_user_id_idx ON sessions (user_id);
CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);

CREATE TABLE streams (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'document',
  seq BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE op_results (
  op_id TEXT PRIMARY KEY,
  stream_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  accepted BOOLEAN NOT NULL,
  result_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX op_results_stream_id_idx ON op_results (stream_id);

CREATE TABLE markups (
  id TEXT PRIMARY KEY,
  stream_id TEXT NOT NULL REFERENCES streams(id) ON DELETE CASCADE,
  scope_id TEXT NOT NULL,
  type TEXT NOT NULL,
  rev INTEGER NOT NULL,
  deleted BOOLEAN NOT NULL DEFAULT FALSE,
  owner_user_id TEXT NOT NULL,
  owner_party_id TEXT,
  owner_group_id TEXT,
  record_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX markups_stream_id_idx ON markups (stream_id);

CREATE TABLE placements (
  id TEXT PRIMARY KEY,
  stream_id TEXT NOT NULL REFERENCES streams(id) ON DELETE CASCADE,
  markup_id TEXT NOT NULL REFERENCES markups(id) ON DELETE CASCADE,
  revision_id TEXT NOT NULL,
  page_id TEXT NOT NULL,
  rev INTEGER NOT NULL,
  deleted BOOLEAN NOT NULL DEFAULT FALSE,
  record_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX placements_stream_id_idx ON placements (stream_id);
CREATE INDEX placements_markup_id_idx ON placements (markup_id);

CREATE TABLE events (
  stream_id TEXT NOT NULL REFERENCES streams(id) ON DELETE CASCADE,
  seq BIGINT NOT NULL,
  op_id TEXT NOT NULL UNIQUE,
  actor_id TEXT NOT NULL,
  op_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  payload_json JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (stream_id, seq)
);
