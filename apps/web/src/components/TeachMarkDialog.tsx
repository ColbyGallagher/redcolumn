import { useState } from 'react';
import { MARK_KINDS, type MarkKind } from '../sheets/marks';

interface Props {
  /** The drawing standard the document is read with, if any: a mark can be kept for its sets only. */
  standard: string | null;
  /** Teaches the boxed example (for the standard's sets, or every set); resolves to an error message when it cannot be used. */
  onTeach: (kind: MarkKind, name: string, forStandard: boolean) => Promise<string | null>;
  onCancel: () => void;
}

/**
 * Links › Teach a Mark: after boxing an example on the sheet, say what kind of mark it is. The
 * example is kept in the profile and every mark like it becomes a link to review.
 */
export function TeachMarkDialog({ standard, onTeach, onCancel }: Props) {
  const [kind, setKind] = useState<MarkKind>('detailCallout');
  const [forStandard, setForStandard] = useState(!!standard);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <form
        className="modal teach-mark-dialog"
        aria-label="Teach a mark"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          void onTeach(kind, name, !!standard && forStandard).then((err) => {
            setBusy(false);
            setError(err);
          });
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') onCancel();
        }}
      >
        <h3>Teach a mark</h3>
        <p className="teach-hint">What did you box? redcolumn finds marks like it in this set and in sets you open later, and lists them under Needs review.</p>
        <fieldset>
          {(Object.keys(MARK_KINDS) as MarkKind[]).map((k) => (
            <label key={k} className="row">
              <input type="radio" name="kind" value={k} checked={kind === k} autoFocus={kind === k} onChange={() => setKind(k)} />
              {MARK_KINDS[k]}
            </label>
          ))}
        </fieldset>
        <label className="row">
          Name
          <input type="text" value={name} aria-label="Name" placeholder={MARK_KINDS[kind]} onChange={(e) => setName(e.target.value)} />
        </label>
        {standard && (
          <fieldset>
            <legend>Look for it in</legend>
            <label className="row">
              <input type="radio" name="scope" checked={forStandard} onChange={() => setForStandard(true)} />
              Sets read with {standard}
            </label>
            <label className="row">
              <input type="radio" name="scope" checked={!forStandard} onChange={() => setForStandard(false)} />
              Every set
            </label>
          </fieldset>
        )}
        {error && (
          <p className="teach-error" role="alert">
            {error}
          </p>
        )}
        <div className="actions">
          <span className="spacer" />
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={busy}>
            Teach
          </button>
        </div>
      </form>
    </div>
  );
}
