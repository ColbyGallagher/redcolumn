import { formatNumber, msg } from '@nb/i18n';
import { lazy } from '../i18n/lazy';
import { useEffect, useState } from 'react';
import type { DocumentInfo, PdfDocument } from '@nb/pdf-core';
import { formatPdfDate, type EditableInfo } from '../documents/docInfo';
import { presetFor } from '../documents/pageSizes';

interface Props {
  fileName: string;
  doc: PdfDocument;
  /** File size in bytes, if known. */
  bytes?: number;
  /** Why the fields cannot be edited (e.g. a shared collaboration document), or null if they can. */
  readOnlyReason: string | null;
  onSave: (info: EditableInfo) => void;
  onClose: () => void;
}

/** Security permission bits (ISO 32000 table 22) and what they allow. */
const PERMISSIONS = lazy((): [number, string][] => [
  [1 << 2, msg('Printing')],
  [1 << 3, msg('Changing the document')],
  [1 << 4, msg('Copying content')],
  [1 << 5, msg('Commenting (markups)')],
  [1 << 8, msg('Filling form fields')],
  [1 << 10, msg('Assembling pages')],
]);

function sizeLabel(w: number, h: number) {
  const named = presetFor(w, h)?.label.replace(/ \(.*/, '');
  const dims = `${(w / 72).toFixed(2)} × ${(h / 72).toFixed(2)} in`;
  return named ? `${named}, ${dims}` : dims;
}

/** Document → Document Properties: file facts, and the editable title, author, subject and keywords. */
export function DocumentPropertiesDialog({ fileName, doc, bytes, readOnlyReason, onSave, onClose }: Props) {
  const [info, setInfo] = useState<DocumentInfo | null>(null);
  const [draft, setDraft] = useState<EditableInfo>({ title: '', author: '', subject: '', keywords: '' });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    doc
      .info()
      .then((i) => {
        if (!live) return;
        setInfo(i);
        setDraft({ title: i.title, author: i.author, subject: i.subject, keywords: i.keywords });
      })
      .catch((err) => live && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      live = false;
    };
  }, [doc]);

  const sizes = [...new Set(doc.pages.map((p) => sizeLabel(p.width, p.height)))];
  const changed = !!info && (draft.title !== info.title || draft.author !== info.author || draft.subject !== info.subject || draft.keywords !== info.keywords);
  const encrypted = !!info && info.securityRevision >= 0;
  const field = (key: keyof EditableInfo, label: string) => (
    <>
      <label htmlFor={`dp-${key}`}>{label}</label>
      <input
        id={`dp-${key}`}
        value={draft[key]}
        readOnly={!!readOnlyReason || !info}
        autoFocus={key === 'title' && !readOnlyReason}
        onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
      />
    </>
  );

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form
        className="modal doc-props"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (changed && !readOnlyReason) onSave(draft);
          else onClose();
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') onClose();
        }}
      >
        <h3>{msg('Document Properties')}</h3>
        {error && <p className="error">{error}</p>}
        <div className="form-grid">
          {field('title', msg('Title'))}
          {field('author', msg('Author'))}
          {field('subject', msg('Subject'))}
          {field('keywords', msg('Keywords'))}
        </div>
        {readOnlyReason && <p className="pref-hint">{readOnlyReason}</p>}
        <dl className="facts">
          <dt>{msg('File')}</dt>
          <dd>{fileName}</dd>
          {bytes !== undefined && (
            <>
              <dt>{msg('Size')}</dt>
              <dd>{bytes >= 1048576 ? msg('{size} MB', { size: formatNumber(bytes / 1048576, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) }) : msg('{size} KB', { size: formatNumber(Math.max(1, Math.round(bytes / 1024)), { maximumFractionDigits: 0 }) })}</dd>
            </>
          )}
          <dt>{msg('Pages')}</dt>
          <dd>{doc.pages.length}</dd>
          <dt>{msg('Page size')}</dt>
          <dd>{sizes.length > 3 ? msg('{count} different sizes', { count: sizes.length }) : sizes.join('; ')}</dd>
          {info && (
            <>
              <dt>{msg('PDF version')}</dt>
              <dd>{info.version ? `${Math.floor(info.version / 10)}.${info.version % 10}` : msg('Unknown')}</dd>
              <dt>{msg('Created')}</dt>
              <dd>{formatPdfDate(info.creationDate) || '—'}</dd>
              <dt>{msg('Modified')}</dt>
              <dd>{formatPdfDate(info.modDate) || '—'}</dd>
              <dt>{msg('Application')}</dt>
              <dd>{info.creator || '—'}</dd>
              <dt>{msg('PDF producer')}</dt>
              <dd>{info.producer || '—'}</dd>
              <dt>{msg('Security')}</dt>
              <dd>{encrypted ? msg('Encrypted (revision {securityRevision})', { securityRevision: info.securityRevision }) : msg('None')}</dd>
              {encrypted && (
                <>
                  <dt>{msg('Allowed')}</dt>
                  <dd>{PERMISSIONS().filter(([bit]) => info.permissions & bit).map(([, label]) => label).join(', ') || msg('Nothing')}</dd>
                </>
              )}
            </>
          )}
        </dl>
        <div className="actions">
          <button type="button" className="btn" onClick={onClose} autoFocus={!!readOnlyReason}>
            {changed ? msg('Cancel') : msg('Close')}
          </button>
          {changed && !readOnlyReason && (
            <button type="submit" className="btn primary">
              {msg('Save')}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
