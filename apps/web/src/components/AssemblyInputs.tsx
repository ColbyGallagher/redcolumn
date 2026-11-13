import { useState } from 'react';
import type { Assembly } from '@nb/markup';

/** A measurement's value for each of `assembly`'s variables: its own input, else the default. */
export function inputValues(assembly: Assembly, inputs: Readonly<Record<string, number>> | undefined): Record<string, number> {
  const own = new Map(Object.entries(inputs ?? {}).map(([k, v]) => [k.trim().toLowerCase(), v]));
  return Object.fromEntries(assembly.variables.map((v) => [v.name, own.get(v.name.trim().toLowerCase()) ?? v.value]));
}

/** `values` without the ones that are the variables' defaults (undefined when none is left), as a measurement keeps them. */
export function changedInputs(assembly: Assembly, values: Readonly<Record<string, number>>): Record<string, number> | undefined {
  const out: Record<string, number> = {};
  for (const v of assembly.variables) {
    const x = values[v.name];
    if (x === undefined || !Number.isFinite(x)) continue;
    const norm = v.type === 'boolean' ? (x ? 1 : 0) : x;
    if (norm !== (v.type === 'boolean' ? (v.value ? 1 : 0) : v.value)) out[v.name] = norm;
  }
  return Object.keys(out).length ? out : undefined;
}

/** One row per variable: a number box, or a Yes/No switch. */
export function AssemblyInputFields({ assembly, values, disabled, onChange }: { assembly: Assembly; values: Readonly<Record<string, number>>; disabled?: boolean; onChange: (name: string, value: number) => void }) {
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
