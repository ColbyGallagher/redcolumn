-- Document uploads and revision PDF processing status.
--
-- Revisions remain immutable once their PDF page-reading job finishes ('ready' or 'failed').
-- While a newly created revision is 'pending' or 'processing', only its processing_status,
-- processing_error, and authoritative page_count may be finalized; identity and file fields
-- (document_id, label, file_sha256, file_size, issued_by, issued_at, created_at) never change.

ALTER TABLE revisions
  ADD COLUMN processing_status TEXT NOT NULL DEFAULT 'ready'
    CHECK (processing_status IN ('pending', 'processing', 'ready', 'failed')),
  ADD COLUMN processing_error TEXT;

CREATE OR REPLACE FUNCTION reject_revision_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM documents WHERE id = OLD.document_id) THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE'
     AND OLD.processing_status IN ('pending', 'processing')
     AND NEW.processing_status IN ('processing', 'ready', 'failed')
     AND NEW.id = OLD.id
     AND NEW.document_id = OLD.document_id
     AND NEW.label = OLD.label
     AND NEW.file_sha256 = OLD.file_sha256
     AND NEW.file_size = OLD.file_size
     AND NEW.issued_by IS NOT DISTINCT FROM OLD.issued_by
     AND NEW.issued_at IS NOT DISTINCT FROM OLD.issued_at
     AND NEW.created_at = OLD.created_at
     AND (NEW.processing_status <> 'processing' OR NEW.page_count = OLD.page_count)
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '% rows are immutable', TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TABLE document_uploads (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
  document_number TEXT,
  document_title TEXT NOT NULL DEFAULT '',
  discipline TEXT,
  revision_label TEXT NOT NULL DEFAULT '1',
  filename TEXT NOT NULL,
  total_bytes BIGINT NOT NULL CHECK (total_bytes > 0),
  expected_sha256 TEXT NOT NULL CHECK (expected_sha256 ~ '^[0-9a-f]{64}$'),
  received_bytes BIGINT NOT NULL DEFAULT 0 CHECK (received_bytes >= 0 AND received_bytes <= total_bytes),
  chunk_size INTEGER NOT NULL CHECK (chunk_size > 0),
  sheet_suggestions_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  state TEXT NOT NULL DEFAULT 'uploading' CHECK (state IN ('uploading', 'completed', 'aborted', 'failed')),
  revision_id TEXT REFERENCES revisions(id) ON DELETE SET NULL,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX document_uploads_project_id_idx ON document_uploads (project_id);
CREATE INDEX document_uploads_state_idx ON document_uploads (project_id, state);
