import { useState } from 'react';
import { ALL_ALLOWED, type Permissions, type PrintPermission, type SecuritySettings } from '../documents/security';

interface Props {
  name: string;
  onSave: (settings: SecuritySettings) => Promise<void>;
  onCancel: () => void;
}

const PERMISSIONS: { key: Exclude<keyof Permissions, 'print'>; label: string }[] = [
  { key: 'modify', label: 'Change the document' },
  { key: 'assemble', label: 'Insert, delete and rotate pages' },
  { key: 'annotate', label: 'Add markups and fill in forms' },
  { key: 'fillForms', label: 'Fill in forms' },
  { key: 'copy', label: 'Copy text and pictures' },
  { key: 'accessibility', label: 'Text for screen readers' },
];

/**
 * Document › Security: saves a copy protected with an open password and/or permissions, encrypted
 * with AES-256. The copy on this device stays unprotected, so it can still be worked on.
 */
export function SecurityDialog({ name, onSave, onCancel }: Props) {
  const [open, setOpen] = useState('');
  const [openAgain, setOpenAgain] = useState('');
  const [limit, setLimit] = useState(false);
  const [owner, setOwner] = useState('');
  const [perms, setPerms] = useState<Permissions>({ ...ALL_ALLOWED, modify: false, assemble: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const problems = [
    open !== openAgain ? 'The open passwords don’t match.' : '',
    !open && !limit ? 'Set an open password, limit what can be done, or both.' : '',
    limit && owner && owner === open ? 'The permissions password must differ from the open password.' : '',
  ].filter(Boolean);

  return (
    <div className="modal-backdrop" onMouseDown={busy ? undefined : onCancel}>
      <form
        className="modal print-dialog security-dialog"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape' && !busy) onCancel();
        }}
        onSubmit={(e) => {
          e.preventDefault();
          if (problems.length || busy) return;
          setBusy(true);
          setError(null);
          onSave({ openPassword: open, permissionsPassword: limit ? owner : '', permissions: limit ? perms : ALL_ALLOWED }).catch((err) => {
            setError(err instanceof Error ? err.message : String(err));
            setBusy(false);
          });
        }}
      >
        <h3>Security</h3>
        <p>Saves a protected copy of {name} (AES-256). The copy on this device is not changed.</p>
        <fieldset>
          <legend>Password to open</legend>
          <label className="row">
            Password
            <input type="password" autoComplete="new-password" value={open} onChange={(e) => setOpen(e.target.value)} />
          </label>
          <label className="row">
            Again
            <input type="password" autoComplete="new-password" value={openAgain} onChange={(e) => setOpenAgain(e.target.value)} />
          </label>
        </fieldset>
        <fieldset>
          <legend>
            <label className="check">
              <input type="checkbox" checked={limit} onChange={(e) => setLimit(e.target.checked)} />
              Limit what can be done
            </label>
          </legend>
          {limit && (
            <>
              <label className="row" title="Needed to change these limits. Left empty, nobody can lift them.">
                Permissions password
                <input type="password" autoComplete="new-password" value={owner} placeholder="(none: the limits can’t be lifted)" onChange={(e) => setOwner(e.target.value)} />
              </label>
              <label className="row">
                Printing
                <select value={perms.print} onChange={(e) => setPerms((p) => ({ ...p, print: e.target.value as PrintPermission }))}>
                  <option value="high">Allowed</option>
                  <option value="low">Low resolution only</option>
                  <option value="none">Not allowed</option>
                </select>
              </label>
              {PERMISSIONS.map(({ key, label }) => (
                <label key={key} className="check">
                  <input type="checkbox" checked={perms[key]} onChange={(e) => setPerms((p) => ({ ...p, [key]: e.target.checked }))} />
                  {label}
                </label>
              ))}
            </>
          )}
        </fieldset>
        {problems.map((p) => (
          <p key={p} className="print-hint">
            {p}
          </p>
        ))}
        {error && <p className="print-error">{error}</p>}
        <div className="actions">
          <span className="spacer" />
          <button type="button" className="btn" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={!!problems.length || busy}>
            {busy ? 'Saving…' : 'Save Protected Copy…'}
          </button>
        </div>
      </form>
    </div>
  );
}
