import { useState } from 'react';
import type { SheetProvider, SyncLink } from '../sheetsync/targets';
import type { SyncStatus } from '../sheetsync/useSheetSync';

interface Props {
  docName: string;
  link: SyncLink | null;
  status: SyncStatus;
  rowCount: number;
  googleAvailable: boolean;
  oneDriveAvailable: boolean;
  onConnect: (provider: SheetProvider, title: string) => void;
  onSyncNow: () => void;
  onStop: () => void;
  onClose: () => void;
}

const WHERE: Record<SheetProvider, string> = { google: 'Google Sheets', onedrive: 'Excel in OneDrive' };

function statusText(s: SyncStatus): string {
  if (s.kind === 'syncing') return 'Updating…';
  if (s.kind === 'synced') return `Up to date · ${new Date(s.at).toLocaleTimeString()}`;
  if (s.kind === 'error') return s.message;
  return 'Waiting for the next change';
}

/** Keep the Markups list in a Google Sheet or an Excel workbook in OneDrive, updated as markups change. */
export function SheetSyncDialog({ docName, link, status, rowCount, googleAvailable, oneDriveAvailable, onConnect, onSyncNow, onStop, onClose }: Props) {
  const [title, setTitle] = useState(`${docName.replace(/\.pdf$/i, '')} markups`);
  const busy = status.kind === 'syncing';
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal sheet-sync-dialog" role="dialog" aria-label="Sync markups to a spreadsheet" onMouseDown={(e) => e.stopPropagation()}>
        <h3>Sync Markups to a Spreadsheet</h3>
        {link ? (
          <>
            <p>
              The Markups list for <b>{docName}</b> ({rowCount} row{rowCount === 1 ? '' : 's'}, with the columns and filters it shows now) is kept in{' '}
              <a href={link.url} target="_blank" rel="noreferrer">
                {link.title}
              </a>{' '}
              in {WHERE[link.provider]}. It updates a moment after each change while this document is open.
            </p>
            <p className={status.kind === 'error' ? 'form-error' : 'hint-text'} role="status">
              {statusText(status)}
            </p>
            {link.provider === 'onedrive' && <p className="hint-text">Excel for the web reloads the workbook when it changes. Edits you make in the spreadsheet are replaced by the next update, so put your own formulas in another sheet.</p>}
            {link.provider === 'google' && <p className="hint-text">Edits you make in the sheet's Markups tab are replaced by the next update, so put your own formulas in another tab.</p>}
            <div className="actions">
              <button className="btn" onClick={onStop}>
                Stop syncing
              </button>
              <button className="btn" onClick={onClose}>
                Close
              </button>
              <button className="btn primary" disabled={busy} onClick={onSyncNow}>
                {status.kind === 'error' && status.reconnect ? 'Reconnect' : 'Sync now'}
              </button>
            </div>
          </>
        ) : (
          <>
            <p>Writes the Markups list (its visible columns, filter and sort) to a spreadsheet, then updates it as markups are added, edited or removed. Measurements go in as numbers, so the sheet can total them.</p>
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
              <button className="choice-card" disabled={!googleAvailable || busy || !title.trim()} onClick={() => onConnect('google', title.trim())}>
                <b>Google Sheets</b>
                <span>{googleAvailable ? 'Updates live for everyone who has it open' : 'Google sign-in is not set up for this site'}</span>
              </button>
              <button className="choice-card" disabled={!oneDriveAvailable || busy || !title.trim()} onClick={() => onConnect('onedrive', title.trim())}>
                <b>Excel in OneDrive</b>
                <span>{oneDriveAvailable ? 'An .xlsx in Apps/redcolumn that Excel opens' : 'Microsoft sign-in is not set up for this site'}</span>
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
