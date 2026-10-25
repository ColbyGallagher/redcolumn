import { useState } from 'react';
import type { SyncLink } from '../sheetsync/targets';
import type { SyncStatus } from '../sheetsync/useSheetSync';

interface Props {
  docName: string;
  link: SyncLink | null;
  status: SyncStatus;
  rowCount: number;
  /** Excel on this computer: the Windows desktop app only. */
  localExcelAvailable: boolean;
  /** Running in the desktop app (on a computer without Excel sync, such as a Mac). */
  inDesktopApp: boolean;
  onConnectLocal: (title: string) => void;
  /** Opens the workbook in Excel, or shows it in its folder. */
  onOpenLocal: () => void;
  onShowLocal: () => void;
  onSyncNow: () => void;
  onStop: () => void;
  /** Offers the desktop app download. */
  onInstall: () => void;
  onClose: () => void;
}

function statusText(s: SyncStatus): string {
  if (s.kind === 'syncing') return 'Updating…';
  if (s.kind === 'synced') return `Up to date · ${new Date(s.at).toLocaleTimeString()}`;
  if (s.kind === 'error') return `${s.message}${s.retryAt ? ` Trying again at ${new Date(s.retryAt).toLocaleTimeString()}.` : ''}`;
  return 'Waiting for the next change';
}

/** Keep the Markups list in an Excel workbook on this computer, updated as markups change (Windows desktop app). */
export function SheetSyncDialog({ docName, link, status, rowCount, localExcelAvailable, inDesktopApp, onConnectLocal, onOpenLocal, onShowLocal, onSyncNow, onStop, onInstall, onClose }: Props) {
  const [title, setTitle] = useState(`${docName.replace(/\.pdf$/i, '')} markups`);
  const busy = status.kind === 'syncing';
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal sheet-sync-dialog" role="dialog" aria-label="Sync markups to Excel" onMouseDown={(e) => e.stopPropagation()}>
        <h3>Sync Markups to Excel</h3>
        {link ? (
          <>
            <p>
              The Markups list for <b>{docName}</b> ({rowCount} row{rowCount === 1 ? '' : 's'}, with the columns and filters it shows now) is kept in{' '}
              <button className="link-button" onClick={onOpenLocal} title="Open it in Excel">
                {link.title}
              </button>{' '}
              on this computer. It updates a moment after each change while this document is open.
            </p>
            <p className={status.kind === 'error' ? 'form-error' : 'hint-text'} role="status">
              {statusText(status)}
            </p>
            <p className="sheet-sync-note" role="note">
              <b>The workbook can stay open in Excel.</b> Updates go straight into it and Excel saves it. While you are typing in a cell, Excel holds the update until you finish.
            </p>
            <p className="hint-text">Edits you make on the Markups sheet are replaced by the next update, so put your own formulas in another sheet: other sheets are kept.</p>
            <div className="actions">
              <button className="btn" onClick={onStop}>
                Stop syncing
              </button>
              <button className="btn" onClick={onShowLocal}>
                Show in Folder
              </button>
              <button className="btn" onClick={onClose}>
                Close
              </button>
              <button className="btn primary" disabled={busy} onClick={onSyncNow}>
                {status.kind === 'error' ? 'Retry now' : 'Sync now'}
              </button>
            </div>
          </>
        ) : localExcelAvailable ? (
          <>
            <p>Writes the Markups list (its visible columns, filter and sort) to an Excel workbook on this computer, then updates it as markups are added, edited or removed. Measurements go in as numbers, so the sheet can total them.</p>
            <label className="col-field">
              <span>Name</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
            {status.kind === 'error' && (
              <p className="form-error" role="alert">
                {status.message}
              </p>
            )}
            <p className="hint-text">You choose the folder and file name next. The workbook updates even while it is open in Excel.</p>
            <div className="actions">
              <button className="btn" onClick={onClose}>
                Cancel
              </button>
              <button className="btn primary" disabled={busy || !title.trim()} onClick={() => onConnectLocal(title.trim())}>
                Choose Workbook…
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="sheet-sync-note" role="note">
              {inDesktopApp ? (
                <b>Sync to Excel works in the redcolumn desktop app on Windows, with Excel installed on the same computer.</b>
              ) : (
                <b>Sync to Excel only works in the redcolumn desktop app. To use this feature, download the desktop app.</b>
              )}
            </p>
            <p className="hint-text">It keeps the Markups list in an Excel workbook on your computer, updated as markups are added, edited or removed, even while the workbook is open in Excel.</p>
            <div className="actions">
              <button className="btn" onClick={onClose}>
                Close
              </button>
              {!inDesktopApp && (
                <button className="btn primary" onClick={onInstall}>
                  Download the Desktop App
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
