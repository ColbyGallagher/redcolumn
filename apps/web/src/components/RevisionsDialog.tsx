import type { FileRevision, StoredFile } from '../storage/fileStore';

interface Props {
  file: StoredFile;
  /** Opens the revision as its own document (to view or compare). */
  onOpen: (r: FileRevision) => void;
  /** Makes the revision the document's contents again (the current contents are kept as a revision). */
  onRestore: (r: FileRevision) => void;
  onDelete: (r: FileRevision) => void;
  onClose: () => void;
}

const size = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

/** Earlier versions of a document kept on this device (from Slip Sheet and Restore). */
export function RevisionsDialog({ file, onOpen, onRestore, onDelete, onClose }: Props) {
  const list = file.revisions ?? [];
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal print-dialog revisions"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') onClose();
        }}
      >
        <h3>Revisions of {file.name}</h3>
        {list.length ? (
          <table className="revision-list">
            <tbody>
              {list.map((r) => (
                <tr key={r.hash}>
                  <td>
                    <div>{new Date(r.savedAt).toLocaleString()}</div>
                    <div className="print-hint">
                      {r.note} · {size(r.size)}
                    </div>
                  </td>
                  <td className="revision-actions">
                    <button className="btn small" onClick={() => onOpen(r)} title="Open this version as its own document, e.g. to compare it">
                      Open
                    </button>
                    <button className="btn small" onClick={() => onRestore(r)} title="Go back to this version; the current one is kept as a revision">
                      Restore
                    </button>
                    <button className="btn small flat" onClick={() => onDelete(r)} title="Delete this revision from the device">
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p>No earlier versions are kept yet. Slip Sheet keeps the set as it was before each run.</p>
        )}
        <div className="actions">
          <span className="spacer" />
          <button className="btn primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
