import { useState } from 'react';
import type { Assembly } from '@nb/markup';
import type { ManualKind, ManualQuantity, Scale } from '@nb/measure';
import { defaultManualUnit, makeManual, MANUAL_KIND_LABELS, MANUAL_UNITS } from '../measure/manualQuantity';

/** What the dialog hands back: the typed quantity, the Subject of the markup, and the assembly to take off with. */
export interface ManualRequest {
  manual: ManualQuantity;
  subject: string;
  assemblyId?: string;
}

interface Props {
  /** The current page's scale: its units are the ones offered first. */
  scale: Scale;
  assemblies: readonly Assembly[];
  onOk: (request: ManualRequest) => void;
  onCancel: () => void;
}

const KINDS: ManualKind[] = ['length', 'area', 'volume', 'count'];

/**
 * Takeoff › Manual Quantity: a quantity known from a schedule or spec, typed instead of drawn.
 * OK arms the placement: the next click on a page puts the quantity there.
 */
export function ManualQuantityDialog({ scale, assemblies, onOk, onCancel }: Props) {
  const [kind, setKind] = useState<ManualKind>('area');
  const [unit, setUnit] = useState(() => defaultManualUnit('area', scale));
  const [text, setText] = useState('');
  const [subject, setSubject] = useState('Manual');
  const [assemblyId, setAssemblyId] = useState('');
  const [note, setNote] = useState('');
  const value = text.trim() === '' ? null : Number(text);
  const made = value === null ? null : makeManual(kind, value, unit, note);
  const changeKind = (k: ManualKind) => {
    setKind(k);
    setUnit(defaultManualUnit(k, scale));
  };
  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <form
        className="modal manual-quantity-dialog"
        role="dialog"
        aria-label="Manual Quantity"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') onCancel();
        }}
        onSubmit={(e) => {
          e.preventDefault();
          if (made) onOk({ manual: made, subject: subject.trim() || 'Manual', ...(assemblyId ? { assemblyId } : {}) });
        }}
      >
        <h3>Manual Quantity</h3>
        <p className="muted">A quantity from a schedule or spec, typed instead of drawn. Click a page afterwards to place it.</p>
        <div className="row">
          <label>
            Kind{' '}
            <select aria-label="Kind" value={kind} onChange={(e) => changeKind(e.target.value as ManualKind)}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {MANUAL_KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="row">
          <input autoFocus type="number" step="any" min={0} aria-label="Value" placeholder="Value" value={text} onChange={(e) => setText(e.target.value)} aria-invalid={text !== '' && !made} />
          <select aria-label="Unit" value={unit} onChange={(e) => setUnit(e.target.value)} disabled={kind === 'count'}>
            {MANUAL_UNITS[kind].map((u) => (
              <option key={u.id} value={u.id}>
                {u.label}
              </option>
            ))}
          </select>
        </div>
        <div className="row">
          <label>
            Subject <input aria-label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
          </label>
        </div>
        <div className="row">
          <label>
            Assembly{' '}
            <select aria-label="Assembly" value={assemblyId} onChange={(e) => setAssemblyId(e.target.value)}>
              <option value="">None</option>
              {assemblies.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="row">
          <label>
            Note <input aria-label="Note" value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
        </div>
        <div className="actions">
          <span className="spacer" />
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={!made}>
            OK
          </button>
        </div>
      </form>
    </div>
  );
}
