import { useState } from 'react';
import { INSTALLER_URL } from '../offline/install';
import type { SyncLink } from '../sheetsync/targets';
import type { SyncStatus } from '../sheetsync/useSheetSync';
import type { SyncIssue } from '../sheetsync/liveSync';

interface Props {
  docName: string;
  link: SyncLink | null;
  status: SyncStatus;
  rowCount: number;
  /** Excel on this computer: the Windows desktop app only. */
  localExcelAvailable: boolean;
  /** Running in the desktop app (on a computer without Excel sync, such as a Mac). */
  inDesktopApp: boolean;
  onConnectLocal: (title: string, quantities: boolean) => void;
  /** Turns the Quantities sheet on or off for the connected workbook. */
  onSetQuantities: (on: boolean) => void;
  /** Opens the workbook in Excel, or shows it in its folder. */
  onOpenLocal: () => void;
  onShowLocal: () => void;
  /** The link reads edits back from Excel. False for a link made before two-way sync, or in a desktop app without it. */
  twoWay?: boolean;
  /** Two-way sync is there to turn on for this link. */
  canTwoWay?: boolean;
  /** Cells waiting for an answer, with the markup's ID for each. */
  issues?: readonly (SyncIssue & { itemNo: string })[];
  onResolve?: (issue: SyncIssue, side: 'excel' | 'mine') => void;
  /** Sets the sheet's columns to the list's visible columns as they are now (and turns two-way on for an older link). */
  onUseListColumns?: () => void;
  onSyncNow: () => void;
  onStop: () => void;
  onClose: () => void;
}

function statusText(s: SyncStatus): string {
  if (s.kind === 'syncing') return 'Updating…';
  if (s.kind === 'synced') return `Up to date · ${new Date(s.at).toLocaleTimeString()}`;
  if (s.kind === 'error') return `${s.message}${s.retryAt ? ` Trying again at ${new Date(s.retryAt).toLocaleTimeString()}.` : ''}`;
  return 'Waiting for the next change';
}

/** Keep the Markups list in an Excel workbook on this computer, updated as markups change (Windows desktop app). */
const ISSUE: Record<SyncIssue['kind'], string> = {
  conflict: 'Changed here and in Excel',
  replyEdit: 'An earlier reply was rewritten in Excel',
  unknown: 'Excel has a value this column does not take',
  blocked: 'Changed in Excel, but this markup cannot be changed here',
};

export function SheetSyncDialog({ docName, link, status, rowCount, localExcelAvailable, inDesktopApp, onConnectLocal, onSetQuantities, onOpenLocal, onShowLocal, twoWay = false, canTwoWay = false, issues = [], onResolve, onUseListColumns, onSyncNow, onStop, onClose }: Props) {
  const [title, setTitle] = useState(`${docName.replace(/\.pdf$/i, '')} markups`);
  const [quantities, setQuantities] = useState(false);
  const busy = status.kind === 'syncing';
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal sheet-sync-dialog" role="dialog" aria-label="Sync markups to Excel" onMouseDown={(e) => e.stopPropagation()}>
        <h3>Sync Markups to Excel</h3>
        {link ? (
          <>
            <p>
              The Markups list for <b>{docName}</b> ({rowCount} row{rowCount === 1 ? '' : 's'}, {twoWay ? 'every markup, with the columns chosen for this workbook' : 'with the columns and filters it shows now'}) is kept in{' '}
              <button className="link-button" onClick={onOpenLocal} title="Open it in Excel">
                {link.title}
              </button>{' '}
              on this computer. It updates a moment after each change while this document is open.
            </p>
            <p className={status.kind === 'error' ? 'form-error' : 'hint-text'} role="status">
              {statusText(status)}
            </p>
            {issues.length > 0 && (
              <div className="sheet-sync-issues" role="alert">
                <p className="form-error">
                  <b>
                    {issues.length} cell{issues.length === 1 ? ' is' : 's are'} paused.
                  </b>{' '}
                  {issues.length === 1 ? 'It is' : 'They are'} left as {issues.length === 1 ? 'it is' : 'they are'} in Excel until you choose. Everything else keeps syncing.
                </p>
                <ul>
                  {issues.map((i) => (
                    <li key={i.id}>
                      <span>
                        ID {i.itemNo} · {i.column.label}: {ISSUE[i.kind]}. Here: <b>{i.mine || '(blank)'}</b>. Excel: <b>{i.theirs || '(blank)'}</b>.
                      </span>{' '}
                      {i.change && (
                        <button className="btn small" aria-label={`Use Excel's value for ID ${i.itemNo} ${i.column.label}`} onClick={() => onResolve?.(i, 'excel')}>
                          Use Excel's
                        </button>
                      )}{' '}
                      <button className="btn small" aria-label={`Use this document's value for ID ${i.itemNo} ${i.column.label}`} onClick={() => onResolve?.(i, 'mine')}>
                        Use this document's
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="sheet-sync-note" role="note">
              <b>The workbook can stay open in Excel.</b> Updates go straight into it and Excel saves it. While you are typing in a cell, Excel holds the update until you finish.
            </p>
            <label className="col-field">
              <input type="checkbox" aria-label="Include Quantities sheet" checked={!!link.quantities} disabled={busy} onChange={(e) => onSetQuantities(e.target.checked)} /> Include a Quantities sheet
            </label>
            {link.quantities && <p className="hint-text">The Quantities sheet holds the Quantity Summary by Item and is replaced by each update, like the Markups sheet. Turning it off leaves the last one in the workbook.</p>}
            {twoWay ? (
              <>
                <p className="hint-text">
                  <b>Two-way.</b> Type in Excel to change Status, Checkmark, Comments, Subject, Label, Layer and your own columns, or to answer in the New reply column: the change is applied here within about 15 seconds. Other columns are written from here and typing in them is replaced. Rows keep the order they have in Excel. Deleting a row in Excel does not delete its markup: the row comes back.
                </p>
                <p className="hint-text">
                  The sheet keeps the columns it was made with, whatever the list shows.{' '}
                  <button className="link-button" onClick={onUseListColumns}>
                    Use the list's columns as they are now
                  </button>
                </p>
              </>
            ) : (
              <>
                <p className="hint-text">Edits you make on the Markups sheet are replaced by the next update, so put your own formulas in another sheet: other sheets are kept.</p>
                {canTwoWay && (
                  <p className="hint-text">
                    This workbook was linked before two-way sync.{' '}
                    <button className="link-button" onClick={onUseListColumns}>
                      Make it two-way
                    </button>{' '}
                    to bring edits typed in Excel back here. The sheet is rewritten once with the list's visible columns and every markup.
                  </p>
                )}
              </>
            )}
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
            {canTwoWay ? (
              <p>
                Writes every markup, with the columns the list shows now, to an Excel workbook on this computer, and keeps the two in step: changes here go to the workbook, and what you type in the workbook's Status, Comments and other editable columns comes back here. Measurements go in as numbers, so the sheet can total them.
              </p>
            ) : (
              <p>Writes the Markups list (its visible columns, filter and sort) to an Excel workbook on this computer, then updates it as markups are added, edited or removed. Measurements go in as numbers, so the sheet can total them.</p>
            )}
            <label className="col-field">
              <span>Name</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
            {status.kind === 'error' && (
              <p className="form-error" role="alert">
                {status.message}
              </p>
            )}
            <label className="col-field">
              <input type="checkbox" aria-label="Include Quantities sheet" checked={quantities} onChange={(e) => setQuantities(e.target.checked)} /> Include a Quantities sheet
            </label>
            <p className="hint-text">The Quantities sheet is the Quantity Summary by Item: net, waste, order quantity and cost for every measurement with an assembly. It updates with the markups, even while the workbook is open.</p>
            <p className="hint-text">You choose the folder and file name next. The workbook updates even while it is open in Excel.</p>
            <div className="actions">
              <button className="btn" onClick={onClose}>
                Cancel
              </button>
              <button className="btn primary" disabled={busy || !title.trim()} onClick={() => onConnectLocal(title.trim(), quantities)}>
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
                <b>Sync to Excel only works in the redcolumn desktop app for Windows. To use this feature, download the desktop app.</b>
              )}
            </p>
            <p className="hint-text">It keeps the Markups list in an Excel workbook on your computer, updated as markups are added, edited or removed, even while the workbook is open in Excel.</p>
            <div className="actions">
              <button className="btn" onClick={onClose}>
                Close
              </button>
              {!inDesktopApp && (
                // Straight to the Windows installer: Excel sync needs that build, whatever this computer is.
                <a className="btn primary" href={INSTALLER_URL} onClick={onClose}>
                  Download for Windows
                </a>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
