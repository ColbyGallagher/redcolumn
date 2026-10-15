import { useState } from 'react';
import type { SyncLink } from '../sheetsync/targets';
import type { SyncStatus } from '../sheetsync/useSheetSync';

interface Props {
  docName: string;
  link: SyncLink | null;
  status: SyncStatus;
  rowCount: number;
  oneDriveAvailable: boolean;
  /** Excel on this computer: the Windows desktop app only. */
  localExcelAvailable: boolean;
  onConnect: (title: string) => void;
  onConnectLocal: (title: string) => void;
  /** Opens a workbook on this computer in Excel, or shows it in its folder. */
  onOpenLocal: () => void;
  onShowLocal: () => void;
  onSyncNow: () => void;
  onStop: () => void;
  onClose: () => void;
}

function statusText(s: SyncStatus): string {
  if (s.kind === 'syncing') return 'Updating…';
  if (s.kind === 'synced') return `Up to date · ${new Date(s.at).toLocaleTimeString()}`;
  if (s.kind === 'error' && s.reconnect) return `${s.message} Click Reconnect to sign in again.`;
  if (s.kind === 'error') return `${s.message}${s.retryAt ? ` Trying again at ${new Date(s.retryAt).toLocaleTimeString()}.` : ''}`;
  return 'Waiting for the next change';
}

/** Keep the Markups list in an Excel workbook, in OneDrive or on this computer, updated as markups change. */
export function SheetSyncDialog({ docName, link, status, rowCount, oneDriveAvailable, localExcelAvailable, onConnect, onConnectLocal, onOpenLocal, onShowLocal, onSyncNow, onStop, onClose }: Props) {
  const [title, setTitle] = useState(`${docName.replace(/\.pdf$/i, '')} markups`);
  const busy = status.kind === 'syncing';
  const local = link?.provider === 'excel-local';
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal sheet-sync-dialog" role="dialog" aria-label="Sync markups to Excel" onMouseDown={(e) => e.stopPropagation()}>
        <h3>Sync Markups to Excel</h3>
        {link ? (
          <>
            <p>
              The Markups list for <b>{docName}</b> ({rowCount} row{rowCount === 1 ? '' : 's'}, with the columns and filters it shows now) is kept in{' '}
              {local ? (
                <>
                  <button className="link-button" onClick={onOpenLocal} title="Open it in Excel">
                    {link.title}
                  </button>{' '}
                  on this computer
                </>
              ) : (
                <>
                  <a href={link.url} target="_blank" rel="noreferrer">
                    {link.title}
                  </a>{' '}
                  in Excel in OneDrive
                </>
              )}
              . It updates a moment after each change while this document is open.
            </p>
            <p className={status.kind === 'error' ? 'form-error' : 'hint-text'} role="status">
              {statusText(status)}
            </p>
            {local ? (
              <p className="sheet-sync-note" role="note">
                <b>The workbook can stay open in Excel.</b> Updates go straight into it and Excel saves it. While you are typing in a cell, Excel holds the update until you finish.
              </p>
            ) : (
              <p className="sheet-sync-note" role="note">
                <b>Close the workbook in Excel to let it update.</b> While it is open in Excel (desktop or the web), Excel may lock the file and the update cannot be saved. Sync then shows ⚠ and catches up by itself once
                the workbook is closed.
              </p>
            )}
            <p className="hint-text">Edits you make on the Markups sheet are replaced by the next update, so put your own formulas in another sheet.</p>
            <div className="actions">
              <button className="btn" onClick={onStop}>
                Stop syncing
              </button>
              {local && (
                <button className="btn" onClick={onShowLocal}>
                  Show in Folder
                </button>
              )}
              <button className="btn" onClick={onClose}>
                Close
              </button>
              <button className="btn primary" disabled={busy} onClick={onSyncNow}>
                {status.kind === 'error' ? (status.reconnect ? 'Reconnect' : 'Retry now') : 'Sync now'}
              </button>
            </div>
          </>
        ) : (
          <>
            <p>Writes the Markups list (its visible columns, filter and sort) to an Excel workbook, then updates it as markups are added, edited or removed. Measurements go in as numbers, so the sheet can total them.</p>
            <label className="col-field">
              <span>Name</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
            {status.kind === 'error' && (
              <p className="form-error" role="alert">
                {status.message}
              </p>
            )}
            <div className="choice-cards">
              {localExcelAvailable && (
                <button className="choice-card" disabled={busy || !title.trim()} onClick={() => onConnectLocal(title.trim())}>
                  <b>Excel on this computer</b>
                  <span>An .xlsx saved where you choose. Updates even while it is open in Excel.</span>
                </button>
              )}
              <button className="choice-card" disabled={!oneDriveAvailable || busy || !title.trim()} onClick={() => onConnect(title.trim())}>
                <b>Excel in OneDrive</b>
                <span>{oneDriveAvailable ? 'An .xlsx in Apps/redcolumn. Close it in Excel to let it update.' : 'Microsoft sign-in is not set up for this site'}</span>
              </button>
            </div>
            <div className="actions">
              <button className="btn" onClick={onClose}>
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
