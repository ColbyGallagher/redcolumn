import { useEffect, useState, type ReactNode } from 'react';
import type { Assembly, Markup, MarkupStore } from '@nb/markup';
import { assemblyChoice, changedInputs, inputValues, withInput, type AssemblyChoice, type AssemblyDefaults } from '../assemblies/assemblyChoice';

export { changedInputs, inputValues };

/** One row per variable: a number box, or a Yes/No switch. */
export function AssemblyInputFields({
  assembly,
  values,
  varies,
  disabled,
  onChange,
}: {
  assembly: Assembly;
  values: Readonly<Record<string, number>>;
  /** Variables whose value differs between the measurements being edited: marked, and a change sets them all. */
  varies?: ReadonlySet<string>;
  disabled?: boolean;
  onChange: (name: string, value: number) => void;
}) {
  return (
    <table className="asm-inputs">
      <tbody>
        {assembly.variables.map((v) => (
          <tr key={v.name}>
            <th scope="row">{v.name}</th>
            <td>
              {v.type === 'boolean' ? (
                <select aria-label={`Input ${v.name}`} value={values[v.name] ? '1' : '0'} disabled={disabled} onChange={(e) => onChange(v.name, Number(e.target.value))}>
                  <option value="1">Yes</option>
                  <option value="0">No</option>
                </select>
              ) : (
                <NumberInput label={`Input ${v.name}`} value={values[v.name] ?? v.value} disabled={disabled} onChange={(n) => onChange(v.name, n)} />
              )}
              {v.unit && v.type !== 'boolean' && <span className="muted"> {v.unit}</span>}
              {varies?.has(v.name) && (
                <span className="muted" title="The measurements being edited have different values: a change sets them all">
                  {' '}
                  (varies)
                </span>
              )}
              {(values[v.name] ?? v.value) !== v.value && <span className="muted" title="The assembly's default"> (default {v.type === 'boolean' ? (v.value ? 'Yes' : 'No') : v.value})</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function NumberInput({ label, value, disabled, onChange }: { label: string; value: number; disabled?: boolean; onChange: (n: number) => void }) {
  const [text, setText] = useState(String(value));
  const n = Number(text);
  // Set elsewhere (the ribbon and the Measurements panel edit the same inputs): show the new value.
  useEffect(() => {
    setText((t) => (t.trim() !== '' && Number(t) === value ? t : String(value)));
  }, [value]);
  return (
    <input
      aria-label={label}
      type="number"
      step="any"
      value={text}
      disabled={disabled}
      aria-invalid={text.trim() === '' || !Number.isFinite(n)}
      style={{ width: 90 }}
      onChange={(e) => {
        setText(e.target.value);
        const x = Number(e.target.value);
        if (e.target.value.trim() !== '' && Number.isFinite(x)) onChange(x);
      }}
    />
  );
}

/**
 * Asked when an assembly with variables is applied: this takeoff's inputs, prefilled with the
 * current values (the variables' defaults for a new one). OK hands back those that differ from the
 * defaults; Cancel leaves the assembly unapplied.
 */
export function AssemblyInputsDialog({ assembly, inputs, onOk, onCancel }: { assembly: Assembly; inputs?: Readonly<Record<string, number>>; onOk: (inputs: Record<string, number> | undefined) => void; onCancel: () => void }) {
  const [values, setValues] = useState(() => inputValues(assembly, inputs));
  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <form
        className="modal asm-inputs-dialog"
        role="dialog"
        aria-label="Assembly inputs"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') onCancel();
        }}
        onSubmit={(e) => {
          e.preventDefault();
          onOk(changedInputs(assembly, values));
        }}
      >
        <h3>Inputs: {assembly.name}</h3>
        <p className="muted">The values this takeoff uses. They start at the assembly’s defaults; change them for this measurement only.</p>
        <AssemblyInputFields assembly={assembly} values={values} onChange={(name, value) => setValues((v) => ({ ...v, [name]: value }))} />
        <div className="actions">
          <span className="spacer" />
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn primary">
            OK
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * Picking the assembly and setting its inputs for the selected measurements, or with none selected
 * for the next ones drawn (the Measurements panel and the Takeoff ribbon share this). Picking one
 * also names a measurement after it while its subject is empty or still the old assembly's name;
 * applied to measurements, an assembly with variables asks for their inputs first (`dialog`).
 * Setting one input changes only that variable on each measurement, so their other inputs stay.
 */
export function useAssemblyChoice<D extends AssemblyDefaults & { subject: string }>({
  chosen,
  store,
  canEdit,
  defaults,
  onDefaults,
  assemblies,
}: {
  chosen: readonly Markup[];
  store: MarkupStore | null;
  canEdit: boolean;
  defaults: D;
  onDefaults: (next: D) => void;
  assemblies: readonly Assembly[];
}): { choice: AssemblyChoice; pick: (id: string) => void; setInput: (name: string, value: number) => void; dialog: ReactNode } {
  const choice = assemblyChoice(chosen, defaults, assemblies);
  const [asking, setAsking] = useState<Assembly | null>(null);
  const nameOf = (id: string | undefined) => assemblies.find((a) => a.id === id)?.name ?? '';
  const renamed = (subject: string, oldId: string | undefined, newId: string) => (!subject.trim() || subject.trim() === nameOf(oldId) ? nameOf(newId) : subject);
  const apply = (id: string, inputs: Record<string, number> | undefined) => {
    if (!chosen.length) {
      onDefaults({ ...defaults, assemblyId: id || undefined, assemblyInputs: id ? inputs : undefined, subject: renamed(defaults.subject, defaults.assemblyId, id) });
      return;
    }
    if (!store || !canEdit) return;
    store.checkpoint();
    store.batch(() =>
      chosen.forEach((m) => {
        const subject = renamed(m.subject ?? '', m.assemblyId, id);
        store.update(m.id, { assemblyId: id || undefined, assemblyInputs: id ? inputs : undefined, ...(subject !== (m.subject ?? '') ? { subject: subject || undefined } : {}) });
      }),
    );
  };
  const pick = (id: string) => {
    if (chosen.length && (!store || !canEdit)) return;
    // Applied to measurements, an assembly with variables asks for their inputs first. (For the
    // next measurement, the inputs are edited beside the picker instead.)
    const assembly = assemblies.find((a) => a.id === id);
    if (chosen.length && assembly?.variables.length) setAsking(assembly);
    else apply(id, undefined);
  };
  const setInput = (name: string, value: number) => {
    const a = choice.assembly;
    if (!a) return;
    if (!chosen.length) return onDefaults({ ...defaults, assemblyInputs: withInput(a, defaults.assemblyInputs, name, value) });
    if (!store || !canEdit) return;
    store.checkpoint();
    store.batch(() => chosen.forEach((m) => store.update(m.id, { assemblyInputs: withInput(a, m.assemblyInputs, name, value) })));
  };
  const dialog = asking && (
    <AssemblyInputsDialog
      assembly={asking}
      inputs={chosen.length && chosen.every((m) => m.assemblyId === asking.id) ? chosen[0]!.assemblyInputs : undefined}
      onOk={(inputs) => {
        apply(asking.id, inputs);
        setAsking(null);
      }}
      onCancel={() => setAsking(null)}
    />
  );
  return { choice, pick, setInput, dialog };
}
