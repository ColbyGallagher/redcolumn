import { useEffect, useState } from 'react';
import type { DocumentInfo, PdfDocument } from '@nb/pdf-core';
import { formatPdfDate, type EditableInfo } from '../documents/docInfo';
import { presetFor } from '../documents/pageSizes';

interface Props {
  fileName: string;
  doc: PdfDocument;
  /** File size in bytes, if known. */
  bytes?: number;
  /** Why the fields cannot be edited (e.g. a shared Studio document), or null if they can. */
  readOnlyReason: string | null;
  onSave: (info: EditableInfo) => void;
  onClose: () => void;
}

/** Security permission bits (ISO 32000 table 22) and what they allow. */
const PERMISSIONS: [number, string][] = [
  [1 << 2, 'Printing'],
  [1 << 3, 'Changing the document'],
  [1 << 4, 'Copying content'],
  [1 << 5, 'Commenting (markups)'],
  [1 << 8, 'Filling form fields'],
  [1 << 10, 'Assembling pages'],
];

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
        <h3>Document Properties</h3>
        {error && <p className="error">{error}</p>}
        <div className="form-grid">
          {field('title', 'Title')}
          {field('author', 'Author')}
          {field('subject', 'Subject')}
          {field('keywords', 'Keywords')}
        </div>
        {readOnlyReason && <p className="pref-hint">{readOnlyReason}</p>}
        <dl className="facts">
          <dt>File</dt>
          <dd>{fileName}</dd>
          {bytes !== undefined && (
            <>
              <dt>Size</dt>
              <dd>{bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`}</dd>
            </>
          )}
          <dt>Pages</dt>
          <dd>{doc.pages.length}</dd>
          <dt>Page size</dt>
          <dd>{sizes.length > 3 ? `${sizes.length} different sizes` : sizes.join('; ')}</dd>
          {info && (
            <>
              <dt>PDF version</dt>
              <dd>{info.version ? `${Math.floor(info.version / 10)}.${info.version % 10}` : 'Unknown'}</dd>
              <dt>Created</dt>
              <dd>{formatPdfDate(info.creationDate) || '—'}</dd>
              <dt>Modified</dt>
              <dd>{formatPdfDate(info.modDate) || '—'}</dd>
              <dt>Application</dt>
              <dd>{info.creator || '—'}</dd>
              <dt>PDF producer</dt>
              <dd>{info.producer || '—'}</dd>
              <dt>Security</dt>
              <dd>{encrypted ? `Encrypted (revision ${info.securityRevision})` : 'None'}</dd>
              {encrypted && (
                <>
                  <dt>Allowed</dt>
                  <dd>{PERMISSIONS.filter(([bit]) => info.permissions & bit).map(([, label]) => label).join(', ') || 'Nothing'}</dd>
                </>
              )}
            </>
          )}
        </dl>
        <div className="actions">
          <button type="button" className="btn" onClick={onClose} autoFocus={!!readOnlyReason}>
            {changed ? 'Cancel' : 'Close'}
          </button>
          {changed && !readOnlyReason && (
            <button type="submit" className="btn primary">
              Save
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
