import { useEffect, useRef, useState } from 'react';
import type { FieldChanges, FieldType, FieldVisibility, FormField, FormModel } from '../documents/forms';
import { CALC_LABELS, type CalcOp, type FieldFormat } from '../documents/formScripts';

export type NewFieldType = Exclude<FieldType, 'button'> | 'button';

const TYPE_LABELS: Record<FieldType, string> = {
  text: 'Text',
  checkbox: 'Check Box',
  radio: 'Radio Button',
  dropdown: 'Drop-down',
  list: 'List Box',
  button: 'Button',
  signature: 'Signature',
};

interface Props {
  model: FormModel | null;
  /** The form can be changed (not a shared Studio document, not busy). */
  editable: boolean;
  selected: string | null;
  onSelect: (name: string | null) => void;
  newType: NewFieldType;
  onNewType: (t: NewFieldType) => void;
  /** Turns on the tool for drawing new fields of `newType`. */
  onDraw: () => void;
  drawing: boolean;
  onGo: (f: FormField) => void;
  onFill: (name: string, value: string) => void;
  onUpdate: (name: string, changes: FieldChanges) => Promise<void>;
  onDelete: (name: string) => void;
  onReorder: (names: string[]) => void;
  onReset: () => void;
  onExport: (format: 'xfdf' | 'csv') => void;
  onImport: (file: File) => void;
}

/** A field's value, edited in the list. */
function ValueEditor({ f, disabled, onFill }: { f: FormField; disabled: boolean; onFill: (v: string) => void }) {
  const [draft, setDraft] = useState(f.value);
  useEffect(() => setDraft(f.value), [f.value]);
  const off = disabled || f.readOnly || !!f.calculation;
  if (f.type === 'checkbox') return <input type="checkbox" checked={f.value !== 'Off' && f.value !== ''} disabled={off} onChange={(e) => onFill(e.target.checked ? (f.widgets[0]?.onValue ?? 'Yes') : 'Off')} />;
  if (f.type === 'radio' || f.type === 'dropdown')
    return (
      <select value={f.value === 'Off' ? '' : f.value} disabled={off} onChange={(e) => onFill(e.target.value || (f.type === 'radio' ? 'Off' : ''))}>
        <option value="">—</option>
        {f.options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  if (f.type === 'list')
    return (
      <select multiple size={Math.min(4, Math.max(2, f.options.length))} value={f.value.split('\n').filter(Boolean)} disabled={off} onChange={(e) => onFill([...e.target.selectedOptions].map((o) => o.value).join('\n'))}>
        {f.options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  if (f.type === 'text')
    return (
      <input
        type="text"
        value={draft}
        disabled={off}
        maxLength={f.maxLength ?? undefined}
        title={f.calculation ? 'Calculated' : undefined}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => draft !== f.value && onFill(draft)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') setDraft(f.value);
        }}
      />
    );
  return <span className="muted">{f.type === 'signature' ? (f.value ? 'Signed' : 'Not signed') : ''}</span>;
}

/** Name, tooltip, flags, options, calculation and format of one field. */
function Properties({ f, all, onUpdate, onDelete }: { f: FormField; all: readonly FormField[]; onUpdate: (c: FieldChanges) => Promise<void>; onDelete: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const run = (c: FieldChanges) => {
    setError(null);
    onUpdate(c).catch((err) => setError(err instanceof Error ? err.message : String(err)));
  };
  const numeric = all.filter((x) => x.name !== f.name && (x.type === 'text' || x.type === 'dropdown'));
  const fmt = f.format;
  const setFormat = (next: FieldFormat | null) => run({ format: next });
  return (
    <div className="field-props" onKeyDown={(e) => e.stopPropagation()}>
      <label className="row">
        Name
        <input key={`n${f.name}`} defaultValue={f.name} onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== f.name && run({ name: e.target.value.trim() })} />
      </label>
      <label className="row">
        Tooltip
        <input key={`t${f.name}`} defaultValue={f.tooltip} onBlur={(e) => e.target.value !== f.tooltip && run({ tooltip: e.target.value })} />
      </label>
      <div className="row wrap">
        <label className="check">
          <input type="checkbox" checked={f.required} onChange={(e) => run({ required: e.target.checked })} />
          Required
        </label>
        <label className="check">
          <input type="checkbox" checked={f.readOnly} onChange={(e) => run({ readOnly: e.target.checked })} />
          Read-only
        </label>
        {f.type === 'text' && (
          <label className="check">
            <input type="checkbox" checked={f.multiline} onChange={(e) => run({ multiline: e.target.checked })} />
            Multi-line
          </label>
        )}
      </div>
      {f.type === 'text' && (
        <label className="row">
          Max length
          <input key={`m${f.name}`} type="number" min={0} style={{ width: 70 }} defaultValue={f.maxLength ?? ''} onBlur={(e) => run({ maxLength: Number(e.target.value) > 0 ? Math.round(Number(e.target.value)) : null })} />
        </label>
      )}
      <fieldset>
        <legend>Appearance</legend>
        <div className="row wrap">
          {f.type !== 'checkbox' && f.type !== 'radio' && f.type !== 'signature' && (
            <label className="row" title="Text size (0 fits the text to the box)">
              Size
              <input key={`fs${f.name}`} type="number" min={0} max={72} style={{ width: 52 }} defaultValue={f.fontSize} onBlur={(e) => Number(e.target.value) !== f.fontSize && run({ fontSize: Math.max(0, Number(e.target.value) || 0) })} />
            </label>
          )}
          <label className="row" title="Text colour">
            Text
            <input type="color" value={f.textColor} onChange={(e) => run({ textColor: e.target.value })} />
          </label>
          <label className="row" title="Border colour (untick for none)">
            <input type="checkbox" checked={!!f.borderColor} onChange={(e) => run({ borderColor: e.target.checked ? '#000000' : null })} />
            Border
            {f.borderColor && <input type="color" value={f.borderColor} onChange={(e) => run({ borderColor: e.target.value })} />}
          </label>
          <label className="row" title="Background colour (untick for none)">
            <input type="checkbox" checked={!!f.backgroundColor} onChange={(e) => run({ backgroundColor: e.target.checked ? '#ffffff' : null })} />
            Fill
            {f.backgroundColor && <input type="color" value={f.backgroundColor} onChange={(e) => run({ backgroundColor: e.target.value })} />}
          </label>
        </div>
        <label className="row">
          Shown
          <select value={f.visibility} onChange={(e) => run({ visibility: e.target.value as FieldVisibility })}>
            <option value="visible">Visible and printed</option>
            <option value="noPrint">Visible, not printed</option>
            <option value="printOnly">Printed only</option>
            <option value="hidden">Hidden</option>
          </select>
        </label>
      </fieldset>
      {f.type !== 'signature' && f.type !== 'button' && (
        <label className="row" title="The value Reset Form puts back">
          Default
          {f.type === 'dropdown' || f.type === 'radio' ? (
            <select value={f.defaultValue} onChange={(e) => run({ defaultValue: e.target.value })}>
              <option value="">(none)</option>
              {f.options.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          ) : f.type === 'checkbox' ? (
            <input type="checkbox" checked={!!f.defaultValue && f.defaultValue !== 'Off'} onChange={(e) => run({ defaultValue: e.target.checked ? (f.widgets[0]?.onValue ?? 'Yes') : '' })} />
          ) : (
            <input key={`dv${f.name}`} defaultValue={f.defaultValue} onBlur={(e) => e.target.value !== f.defaultValue && run({ defaultValue: e.target.value })} />
          )}
        </label>
      )}
      {f.type === 'text' && (
        <fieldset>
          <legend>Validate</legend>
          <label className="row">
            <select
              value={f.validation?.kind ?? ''}
              onChange={(e) => run({ validation: e.target.value === 'range' ? { kind: 'range', min: null, max: null } : e.target.value === 'pattern' ? { kind: 'pattern', pattern: '.*', message: 'That value is not accepted.' } : null })}
            >
              <option value="">Any value</option>
              <option value="range">A number in a range</option>
              <option value="pattern">Text matching a pattern</option>
            </select>
          </label>
          {f.validation?.kind === 'range' && (
            <div className="row wrap">
              <label className="row">
                From
                <input key={`vmin${f.name}`} type="number" style={{ width: 70 }} defaultValue={f.validation.min ?? ''} onBlur={(e) => run({ validation: { ...(f.validation as { kind: 'range'; min: number | null; max: number | null }), min: e.target.value === '' ? null : Number(e.target.value) } })} />
              </label>
              <label className="row">
                to
                <input key={`vmax${f.name}`} type="number" style={{ width: 70 }} defaultValue={f.validation.max ?? ''} onBlur={(e) => run({ validation: { ...(f.validation as { kind: 'range'; min: number | null; max: number | null }), max: e.target.value === '' ? null : Number(e.target.value) } })} />
              </label>
            </div>
          )}
          {f.validation?.kind === 'pattern' && (
            <>
              <label className="row" title="A regular expression, e.g. ^[A-Z]-\d{3}$">
                Pattern
                <input key={`vp${f.name}`} defaultValue={f.validation.pattern} onBlur={(e) => run({ validation: { kind: 'pattern', pattern: e.target.value, message: (f.validation as { message: string }).message } })} />
              </label>
              <label className="row">
                Message
                <input key={`vm${f.name}`} defaultValue={f.validation.message} onBlur={(e) => run({ validation: { kind: 'pattern', pattern: (f.validation as { pattern: string }).pattern, message: e.target.value } })} />
              </label>
            </>
          )}
        </fieldset>
      )}
      {f.type === 'button' && (
        <fieldset>
          <legend>When clicked</legend>
          <label className="row">
            <select
              value={f.action?.kind ?? ''}
              aria-label="Button action"
              onChange={(e) => {
                const k = e.target.value;
                run({
                  action:
                    k === 'url' ? { kind: 'url', url: 'https://' } : k === 'page' ? { kind: 'page', pageIndex: 0 } : k === 'reset' ? { kind: 'reset' } : k === 'print' ? { kind: 'print' } : k === 'submit' ? { kind: 'submit', url: 'mailto:' } : null,
                });
              }}
            >
              <option value="">Nothing</option>
              <option value="url">Open a web page</option>
              <option value="page">Go to a page</option>
              <option value="reset">Reset the form</option>
              <option value="print">Print</option>
              <option value="submit">Submit the form data</option>
            </select>
          </label>
          {(f.action?.kind === 'url' || f.action?.kind === 'submit') && (
            <label className="row" title={f.action.kind === 'submit' ? 'A mailto: address, or a web address that accepts XFDF' : undefined}>
              Address
              <input
                key={`act${f.name}${f.action.kind}`}
                defaultValue={f.action.url}
                aria-label="Action address"
                onBlur={(e) => {
                  const url = e.target.value.trim();
                  if (url !== (f.action as { url: string }).url) run({ action: { kind: (f.action as { kind: 'url' | 'submit' }).kind, url } });
                }}
              />
            </label>
          )}
          {f.action?.kind === 'page' && (
            <label className="row">
              Page
              <input key={`actp${f.name}`} type="number" min={1} style={{ width: 70 }} defaultValue={f.action.pageIndex + 1} onBlur={(e) => run({ action: { kind: 'page', pageIndex: Math.max(0, Math.round(Number(e.target.value)) - 1 || 0) } })} />
            </label>
          )}
        </fieldset>
      )}
      {(f.type === 'dropdown' || f.type === 'list') && (
        <label className="col">
          Options (one per line)
          <textarea key={`o${f.name}`} rows={4} defaultValue={f.options.join('\n')} onBlur={(e) => {
            const options = e.target.value.split('\n').map((s) => s.trim()).filter(Boolean);
            if (options.join('\n') !== f.options.join('\n')) run({ options });
          }} />
        </label>
      )}
      {f.type === 'text' && (
        <>
          <fieldset>
            <legend>Calculate</legend>
            <label className="row">
              <select value={f.calculation?.op ?? ''} onChange={(e) => run({ calculation: e.target.value ? { op: e.target.value as CalcOp, fields: f.calculation?.fields ?? [] } : null })}>
                <option value="">Not calculated</option>
                {(Object.keys(CALC_LABELS) as CalcOp[]).map((op) => (
                  <option key={op} value={op}>
                    {CALC_LABELS[op]}
                  </option>
                ))}
              </select>
            </label>
            {f.calculation && (
              <div className="calc-fields">
                {numeric.map((x) => (
                  <label key={x.name} className="check">
                    <input
                      type="checkbox"
                      checked={f.calculation!.fields.includes(x.name)}
                      onChange={(e) => run({ calculation: { op: f.calculation!.op, fields: e.target.checked ? [...f.calculation!.fields, x.name] : f.calculation!.fields.filter((n) => n !== x.name) } })}
                    />
                    {x.name}
                  </label>
                ))}
                {!numeric.length && <span className="muted">Add other text fields to calculate from.</span>}
              </div>
            )}
          </fieldset>
          <fieldset>
            <legend>Format</legend>
            <label className="row">
              <select
                value={fmt?.kind ?? ''}
                onChange={(e) => {
                  const k = e.target.value;
                  setFormat(k === 'number' ? { kind: 'number', decimals: 2, separator: true, currency: '', currencyFirst: true, negativeParens: false } : k === 'percent' ? { kind: 'percent', decimals: 0 } : k === 'date' ? { kind: 'date', pattern: 'dd/mm/yyyy' } : null);
                }}
              >
                <option value="">None</option>
                <option value="number">Number</option>
                <option value="percent">Percent</option>
                <option value="date">Date</option>
              </select>
              {fmt && fmt.kind !== 'date' && (
                <>
                  <input type="number" min={0} max={6} style={{ width: 48 }} value={fmt.decimals} title="Decimal places" onChange={(e) => setFormat({ ...fmt, decimals: Math.max(0, Math.min(6, Math.round(Number(e.target.value)) || 0)) })} />
                  dp
                </>
              )}
            </label>
            {fmt?.kind === 'number' && (
              <div className="row wrap">
                <label className="row">
                  Currency
                  <input style={{ width: 40 }} value={fmt.currency} onChange={(e) => setFormat({ ...fmt, currency: e.target.value.slice(0, 4) })} />
                </label>
                <label className="check">
                  <input type="checkbox" checked={fmt.separator} onChange={(e) => setFormat({ ...fmt, separator: e.target.checked })} />
                  1,000s
                </label>
                <label className="check">
                  <input type="checkbox" checked={fmt.negativeParens} onChange={(e) => setFormat({ ...fmt, negativeParens: e.target.checked })} />
                  (negative)
                </label>
              </div>
            )}
            {fmt?.kind === 'date' && (
              <label className="row">
                Pattern
                <select value={fmt.pattern} onChange={(e) => setFormat({ kind: 'date', pattern: e.target.value })}>
                  {['dd/mm/yyyy', 'mm/dd/yyyy', 'yyyy-mm-dd', 'd mmm yyyy', 'mmm d, yyyy', 'dd-mmm-yy'].concat(fmt.pattern).filter((p, i, a) => a.indexOf(p) === i).map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </fieldset>
        </>
      )}
      {error && <p className="print-error">{error}</p>}
      <button className="btn small flat" onClick={onDelete}>
        Delete field
      </button>
    </div>
  );
}

/**
 * Forms panel: every field of the document in tab order, filled in right here or on the page,
 * with their properties; new fields are drawn on the page. Reset, and form data in and out.
 */
export function FormsPanel(p: Props) {
  const importRef = useRef<HTMLInputElement>(null);
  const fields = p.model?.fields ?? [];
  const selected = fields.find((f) => f.name === p.selected) ?? null;
  const move = (name: string, by: -1 | 1) => {
    const names = fields.map((f) => f.name);
    const i = names.indexOf(name);
    const j = i + by;
    if (i < 0 || j < 0 || j >= names.length) return;
    [names[i], names[j]] = [names[j]!, names[i]!];
    p.onReorder(names);
  };
  const required = fields.filter((f) => f.required && (!f.value || f.value === 'Off'));

  return (
    <div className="forms-panel">
      <div className="sheet-actions wrap">
        <select value={p.newType} disabled={!p.editable} aria-label="New field type" onChange={(e) => p.onNewType(e.target.value as NewFieldType)}>
          {(Object.keys(TYPE_LABELS) as FieldType[]).map((t) => (
            <option key={t} value={t}>
              {TYPE_LABELS[t]}
            </option>
          ))}
        </select>
        <button className={`btn small${p.drawing ? ' primary' : ''}`} disabled={!p.editable} onClick={p.onDraw} title="Draw the new field's box on the page">
          {p.drawing ? 'Drawing…' : 'Draw field'}
        </button>
      </div>
      <div className="sheet-actions wrap">
        <button className="btn small" disabled={!p.editable || !fields.length} onClick={p.onReset}>
          Reset
        </button>
        <button className="btn small" disabled={!fields.length} onClick={() => p.onExport('xfdf')} title="Save the values as XFDF, which most PDF apps import">
          Export XFDF
        </button>
        <button className="btn small" disabled={!fields.length} onClick={() => p.onExport('csv')}>
          Export CSV
        </button>
        <button className="btn small" disabled={!p.editable || !fields.length} onClick={() => importRef.current?.click()} title="Fill the form from XFDF, CSV or JSON data">
          Import…
        </button>
        <input
          ref={importRef}
          type="file"
          accept=".xfdf,.xml,.csv,.json,text/csv,application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) p.onImport(f);
            e.target.value = '';
          }}
        />
      </div>
      {!fields.length && <p className="empty">{p.model ? 'This document has no form fields. Choose a type and draw a field on the page.' : 'Reading the form…'}</p>}
      {required.length > 0 && (
        <p className="print-hint">
          {required.length} required field{required.length === 1 ? '' : 's'} still empty: {required.slice(0, 4).map((f) => f.name).join(', ')}
          {required.length > 4 ? '…' : ''}
        </p>
      )}
      <ul className="form-fields">
        {fields.map((f, i) => (
          <li key={f.name} className={f.name === p.selected ? 'active' : ''}>
            <div className="field-row">
              <button className="field-name" onClick={() => {
                p.onSelect(f.name === p.selected ? null : f.name);
                p.onGo(f);
              }} title={`${TYPE_LABELS[f.type]}${f.tooltip ? ` — ${f.tooltip}` : ''}`}>
                <span className="field-type">{TYPE_LABELS[f.type]}</span> {f.name}
                {f.required && <span className="required">*</span>}
              </button>
              <ValueEditor f={f} disabled={!p.editable} onFill={(v) => p.onFill(f.name, v)} />
              {p.editable && (
                <span className="field-order">
                  <button className="btn small flat" disabled={i === 0} title="Earlier in the tab order" onClick={() => move(f.name, -1)}>
                    ↑
                  </button>
                  <button className="btn small flat" disabled={i === fields.length - 1} title="Later in the tab order" onClick={() => move(f.name, 1)}>
                    ↓
                  </button>
                </span>
              )}
            </div>
            {selected === f && p.editable && <Properties f={f} all={fields} onUpdate={(c) => p.onUpdate(f.name, c)} onDelete={() => p.onDelete(f.name)} />}
          </li>
        ))}
      </ul>
    </div>
  );
}
