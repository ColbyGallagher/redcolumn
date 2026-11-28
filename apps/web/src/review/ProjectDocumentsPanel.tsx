import { msg } from '@nb/i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ServerClientError, type ServerProjectSummary } from '../connect/client';
import { listDocuments, type DocumentSummary, type RevisionSummary, type RevisionTarget } from './documentsApi';
import { uploadPdf, type UploadAttempt } from './upload';
import './review.css';

export interface ProjectDocumentsPanelProps {
  project: ServerProjectSummary;
  onOpenRevision: (target: RevisionTarget) => Promise<void> | void;
  onClose?: () => void;
}

/** How often the list is read again while the server is still reading a PDF. */
const PROCESSING_POLL_MS = 1500;

function describeDocumentsError(err: unknown): string {
  if (err instanceof ServerClientError) {
    switch (err.code) {
      case 'unauthenticated':
        return msg('Your session has expired. Please sign in again.');
      case 'document_number_conflict':
        return msg('This project already has a document with that file name.');
      case 'invalid_total_bytes':
        return msg('The file is empty or larger than the server accepts.');
      case 'hash_mismatch':
        return msg('The file changed or was damaged on the way. Add it again.');
      case 'forbidden':
        return msg('Your role on this project does not let you add documents.');
      case 'not_found':
      case 'project_not_found':
        return msg('Project not found or you no longer have access.');
      default:
        return msg('Request failed ({code}).', { code: err.code });
    }
  }
  return msg('Could not reach the server. Check your connection and try again.');
}

interface UploadState {
  file: File;
  attempt: UploadAttempt;
  sent: number;
  busy: boolean;
  error: string | null;
}

function RevisionRow({ revision, onOpen, opening }: { revision: RevisionSummary; onOpen: () => void; opening: boolean }) {
  const label = msg('Revision {label}', { label: revision.label });
  return (
    <li className="review-revision">
      <span>
        {label}
        {revision.processingStatus === 'ready' && (
          <span className="connect-item-meta">
            {msg('{count, plural, one {# page} other {# pages}}', { count: revision.pageCount })}
          </span>
        )}
        {(revision.processingStatus === 'pending' || revision.processingStatus === 'processing') && (
          <span className="connect-item-meta">{msg('The server is reading the PDF…')}</span>
        )}
        {revision.processingStatus === 'failed' && (
          <span className="connect-item-meta">{msg('The server could not read this PDF.')}</span>
        )}
      </span>
      {revision.processingStatus === 'ready' && (
        <button type="button" className="btn primary" disabled={opening} onClick={onOpen}>
          {opening ? msg('Opening…') : msg('Open')}
        </button>
      )}
    </li>
  );
}

export function ProjectDocumentsPanel({ project, onOpenRevision, onClose }: ProjectDocumentsPanelProps) {
  const [documents, setDocuments] = useState<DocumentSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [upload, setUpload] = useState<UploadState | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const live = useRef(true);
  const canAdd = project.role === 'project_admin' || project.role === 'reviewer';

  const load = useCallback(async () => {
    try {
      const next = await listDocuments(project.id);
      if (!live.current) return;
      setDocuments(next);
      setError(null);
    } catch (err) {
      if (live.current) setError(describeDocumentsError(err));
    }
  }, [project.id]);

  useEffect(() => {
    live.current = true;
    setDocuments(null);
    void load();
    return () => {
      live.current = false;
    };
  }, [load]);

  const processing = !!documents?.some((d) =>
    d.revisions.some((r) => r.processingStatus === 'pending' || r.processingStatus === 'processing'),
  );
  useEffect(() => {
    if (!processing) return;
    const timer = setTimeout(() => void load(), PROCESSING_POLL_MS);
    return () => clearTimeout(timer);
  }, [processing, documents, load]);

  const runUpload = async (file: File, attempt: UploadAttempt) => {
    setUpload({ file, attempt, sent: 0, busy: true, error: null });
    try {
      await uploadPdf(project.id, file, {
        attempt,
        onProgress: (sent) => setUpload((u) => (u && u.attempt === attempt ? { ...u, sent } : u)),
      });
      setUpload(null);
      await load();
    } catch (err) {
      setUpload((u) => (u && u.attempt === attempt ? { ...u, busy: false, error: describeDocumentsError(err) } : u));
    }
  };

  const open = async (target: RevisionTarget) => {
    setOpening(target.revisionId);
    try {
      await onOpenRevision(target);
    } finally {
      if (live.current) setOpening(null);
    }
  };

  return (
    <section className="review-panel" aria-label={msg('Project documents')}>
      <div className="review-panel-header">
        <h3>{msg('Documents in {name}', { name: project.name })}</h3>
        <div className="connect-actions">
          {canAdd && (
            <button type="button" className="btn primary" disabled={upload?.busy} onClick={() => input.current?.click()}>
              {msg('Add PDF…')}
            </button>
          )}
          {onClose && (
            <button type="button" className="btn" onClick={onClose}>
              {msg('Close')}
            </button>
          )}
        </div>
      </div>
      <input
        ref={input}
        type="file"
        accept="application/pdf,.pdf"
        hidden
        data-testid="add-pdf-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void runUpload(file, {});
        }}
      />

      {upload && (
        <div className="review-upload">
          <span>{msg('Uploading {name}', { name: upload.file.name })}</span>
          <progress max={upload.file.size} value={upload.sent} />
          {upload.error && (
            <>
              <div className="connect-error" role="alert">
                {upload.error}
              </div>
              <div className="connect-actions">
                <button type="button" className="btn primary" onClick={() => void runUpload(upload.file, upload.attempt)}>
                  {msg('Resume upload')}
                </button>
                <button type="button" className="btn" onClick={() => setUpload(null)}>
                  {msg('Cancel')}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {error && (
        <div className="connect-error" role="alert">
          {error}
        </div>
      )}

      {documents === null ? (
        !error && <p className="connect-muted">{msg('Loading…')}</p>
      ) : documents.length === 0 ? (
        <p className="connect-muted">{msg('No documents yet.')}</p>
      ) : (
        <ul className="connect-list">
          {documents.map((document) => (
            <li key={document.id} className="connect-list-item review-document">
              <div>
                <strong>{document.title || document.number}</strong>
                <span className="connect-item-meta">{document.number}</span>
              </div>
              <ul className="review-revisions">
                {document.revisions.map((revision) => (
                  <RevisionRow
                    key={revision.id}
                    revision={revision}
                    opening={opening === revision.id}
                    onOpen={() => void open({ projectId: project.id, documentId: document.id, revisionId: revision.id })}
                  />
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
