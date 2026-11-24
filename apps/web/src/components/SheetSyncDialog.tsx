import { msg, msgParts } from '@nb/i18n';
import { lazy } from '../i18n/lazy';
import { keyed } from '../i18n/keyed';
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
  if (s.kind === 'synced') return msg('Up to date · {toLocaleTimeString}', { toLocaleTimeString: new Date(s.at).toLocaleTimeString() });
  if (s.kind === 'error') return `${s.message}${s.retryAt ? ' ' + msg('Trying again at {toLocaleTimeString}.', { toLocaleTimeString: new Date(s.retryAt).toLocaleTimeString() }) : ''}`;
  return msg('Waiting for the next change');
}

/** Keep the Markups list in an Excel workbook on this computer, updated as markups change (Windows desktop app). */
const ISSUE = lazy((): Record<SyncIssue['kind'], string> => ({
  conflict: msg('Changed here and in Excel'),
  replyEdit: msg('An earlier reply was rewritten in Excel'),
  unknown: msg('Excel has a value this column does not take'),
  blocked: msg('Changed in Excel, but this markup cannot be changed here'),
}));

export function SheetSyncDialog({ docName, link, status, rowCount, localExcelAvailable, inDesktopApp, onConnectLocal, onSetQuantities, onOpenLocal, onShowLocal, twoWay = false, canTwoWay = false, issues = [], onResolve, onUseListColumns, onSyncNow, onStop, onClose }: Props) {
  const [title, setTitle] = useState(`${docName.replace(/\.pdf$/i, '')} markups`);
  const [quantities, setQuantities] = useState(false);
  const busy = status.kind === 'syncing';
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal sheet-sync-dialog" role="dialog" aria-label={msg('Sync markups to Excel')} onMouseDown={(e) => e.stopPropagation()}>
        <h3>{msg('Sync Markups to Excel')}</h3>
        {link ? (
          <>
            <p>
              {(() => {
                const values = {
                  document: <b>{docName}</b>,
                  rows: rowCount,
                  workbook: (
                    <button className="link-button" onClick={onOpenLocal} title={msg('Open it in Excel')}>
                      {link.title}
                    </button>
                  ),
                };
                return keyed(
                  twoWay
                    ? msgParts('The Markups list for {document} ({rows, plural, one {# row} other {# rows}}, every markup, with the columns chosen for this workbook) is kept in {workbook} on this computer. It updates a moment after each change while this document is open.', values)
                    : msgParts('The Markups list for {document} ({rows, plural, one {# row} other {# rows}}, with the columns and filters it shows now) is kept in {workbook} on this computer. It updates a moment after each change while this document is open.', values),
                );
              })()}
            </p>
            <p className={status.kind === 'error' ? 'form-error' : 'hint-text'} role="status">
              {statusText(status)}
            </p>
            {issues.length > 0 && (
              <div className="sheet-sync-issues" role="alert">
                <p className="form-error">
                  <b>
                    {msg('{count, plural, one {# cell is} other {# cells are}} paused.', { count: issues.length })}
                  </b>{' '}
                  {msg('{count, plural, one {It is left as it is} other {They are left as they are}} in Excel until you choose. Everything else keeps syncing.', { count: issues.length })}
                </p>
                <ul>
                  {issues.map((i) => (
                    <li key={i.id}>
                      <span>
                        {keyed(msgParts('ID {itemNo} · {label}: {iSSUE}. Here: {b}. Excel: {b2}.', { itemNo: i.itemNo, label: i.column.label, iSSUE: ISSUE()[i.kind], b: <b>{i.mine || '(blank)'}</b>, b2: <b>{i.theirs || '(blank)'}</b> }))}
                      </span>{' '}
                      {i.change && (
                        <button className="btn small" aria-label={msg('Use Excel\'s value for ID {itemNo} {label}', { itemNo: i.itemNo, label: i.column.label })} onClick={() => onResolve?.(i, 'excel')}>
                          {msg('Use Excel\'s')}
                        </button>
                      )}{' '}
                      <button className="btn small" aria-label={msg('Use this document\'s value for ID {itemNo} {label}', { itemNo: i.itemNo, label: i.column.label })} onClick={() => onResolve?.(i, 'mine')}>
                        {msg('Use this document\'s')}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="sheet-sync-note" role="note">
              {keyed(msgParts('{b} Updates go straight into it and Excel saves it. While you are typing in a cell, Excel holds the update until you finish.', { b: <b>{msg('The workbook can stay open in Excel.')}</b> }))}
            </p>
            <label className="col-field">
              {keyed(msgParts('{input} Include a Quantities sheet', { input: <input type="checkbox" aria-label={msg('Include Quantities sheet')} checked={!!link.quantities} disabled={busy} onChange={(e) => onSetQuantities(e.target.checked)} /> }))}
            </label>
            {link.quantities && <p className="hint-text">{msg('The Quantities sheet holds the Quantity Summary by Item and is replaced by each update, like the Markups sheet. Turning it off leaves the last one in the workbook.')}</p>}
            {twoWay ? (
              <>
                <p className="hint-text">
                  {keyed(msgParts('{b} Type in Excel to change Status, Checkmark, Comments, Subject, Label, Layer and your own columns, or to answer in the New reply column: the change is applied here within about 15 seconds. Other columns are written from here and typing in them is replaced. Rows keep the order they have in Excel. Deleting a row in Excel does not delete its markup: the row comes back.', { b: <b>{msg('Two-way.')}</b> }))}
                </p>
                <p className="hint-text">
                  {msg('The sheet keeps the columns it was made with, whatever the list shows.')}{' '}
                  <button className="link-button" onClick={onUseListColumns}>
                    {msg('Use the list\'s columns as they are now')}
                  </button>
                </p>
              </>
            ) : (
              <>
                <p className="hint-text">{msg('Edits you make on the Markups sheet are replaced by the next update, so put your own formulas in another sheet: other sheets are kept.')}</p>
                {canTwoWay && (
                  <p className="hint-text">
                    {keyed(
                      msgParts("This workbook was linked before two-way sync. {button} to bring edits typed in Excel back here. The sheet is rewritten once with the list's visible columns and every markup.", {
                        button: (
                          <button className="link-button" onClick={onUseListColumns}>
                            {msg('Make it two-way')}
                          </button>
                        ),
                      }),
                    )}
                  </p>
                )}
              </>
            )}
            <div className="actions">
              <button className="btn" onClick={onStop}>
                {msg('Stop syncing')}
              </button>
              <button className="btn" onClick={onShowLocal}>
                {msg('Show in Folder')}
              </button>
              <button className="btn" onClick={onClose}>
                {msg('Close')}
              </button>
              <button className="btn primary" disabled={busy} onClick={onSyncNow}>
                {status.kind === 'error' ? msg('Retry now') : msg('Sync now')}
              </button>
            </div>
          </>
        ) : localExcelAvailable ? (
          <>
            {canTwoWay ? (
              <p>
                {msg('Writes every markup, with the columns the list shows now, to an Excel workbook on this computer, and keeps the two in step: changes here go to the workbook, and what you type in the workbook\'s Status, Comments and other editable columns comes back here. Measurements go in as numbers, so the sheet can total them.')}
              </p>
            ) : (
              <p>{msg('Writes the Markups list (its visible columns, filter and sort) to an Excel workbook on this computer, then updates it as markups are added, edited or removed. Measurements go in as numbers, so the sheet can total them.')}</p>
            )}
            <label className="col-field">
              <span>{msg('Name')}</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
            {status.kind === 'error' && (
              <p className="form-error" role="alert">
                {status.message}
              </p>
            )}
            <label className="col-field">
              {keyed(msgParts('{input} Include a Quantities sheet', { input: <input type="checkbox" aria-label={msg('Include Quantities sheet')} checked={quantities} onChange={(e) => setQuantities(e.target.checked)} /> }))}
            </label>
            <p className="hint-text">{msg('The Quantities sheet is the Quantity Summary by Item: net, waste, order quantity and cost for every measurement with an assembly. It updates with the markups, even while the workbook is open.')}</p>
            <p className="hint-text">{msg('You choose the folder and file name next. The workbook updates even while it is open in Excel.')}</p>
            <div className="actions">
              <button className="btn" onClick={onClose}>
                {msg('Cancel')}
              </button>
              <button className="btn primary" disabled={busy || !title.trim()} onClick={() => onConnectLocal(title.trim(), quantities)}>
                {msg('Choose Workbook…')}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="sheet-sync-note" role="note">
              {inDesktopApp ? (
                <b>{msg('Sync to Excel works in the redcolumn desktop app on Windows, with Excel installed on the same computer.')}</b>
              ) : (
                <b>{msg('Sync to Excel only works in the redcolumn desktop app for Windows. To use this feature, download the desktop app.')}</b>
              )}
            </p>
            <p className="hint-text">{msg('It keeps the Markups list in an Excel workbook on your computer, updated as markups are added, edited or removed, even while the workbook is open in Excel.')}</p>
            <div className="actions">
              <button className="btn" onClick={onClose}>
                {msg('Close')}
              </button>
              {!inDesktopApp && (
                // Straight to the Windows installer: Excel sync needs that build, whatever this computer is.
                <a className="btn primary" href={INSTALLER_URL} onClick={onClose}>
                  {msg('Download for Windows')}
                </a>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
