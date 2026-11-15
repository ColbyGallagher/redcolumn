import { useRef } from 'react';
import { createPortal } from 'react-dom';
import { FUNCTION_DOCS } from '../columns/formula';
import { formatNumber } from '../columns/listColumns';

/** A group of names the property picker offers, e.g. Measured, Variables, Columns. */
export interface FormulaNameGroup {
  label: string;
  names: { name: string; hint: string }[];
}

interface Props {
  /** The item the formula is for, and its unit. */
  item: string;
  unit: string;
  formula: string;
  groups: readonly FormulaNameGroup[];
  /** What is wrong with the formula, if anything (unknown names, syntax, a text result). */
  problem?: string;
  /** The formula's result for the selected measurement, with waste and rounding; null when none is selected. */
  result: { rounded: number | null; base: number | null; error?: string } | null;
  /** What the result is worked out for, e.g. "Area on page 2". */
  resultLabel: string;
  readOnly: boolean;
  onChange: (formula: string) => void;
  onClose: () => void;
}

const OPERATORS: { text: string; label: string }[] = [
  { text: ' + ', label: '+' },
  { text: ' - ', label: '−' },
  { text: ' * ', label: '×' },
  { text: ' / ', label: '÷' },
  { text: '^', label: '^' },
  { text: '(', label: '(' },
  { text: ')', label: ')' },
  { text: ', ', label: ',' },
  { text: ' = ', label: '=' },
  { text: ' <> ', label: '≠' },
  { text: ' > ', label: '>' },
  { text: ' < ', label: '<' },
  { text: ' >= ', label: '≥' },
  { text: ' <= ', label: '≤' },
];

/**
 * The Formula Builder: an item's quantity formula with everything it can use a click away (the
 * measured values, the assembly's variables and switches, the document's columns), the functions
 * with how to call them, operator buttons, live checking and the result for the selected
 * measurement.
 */
export function FormulaBuilder({ item, unit, formula, groups, problem, result, resultLabel, readOnly, onChange, onClose }: Props) {
  const box = useRef<HTMLTextAreaElement>(null);
  const insert = (text: string, cursorBack = 0) => {
    const el = box.current;
    const at = el?.selectionStart ?? formula.length;
    const end = el?.selectionEnd ?? formula.length;
    onChange(formula.slice(0, at) + text + formula.slice(end));
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const pos = at + text.length - cursorBack;
      el.setSelectionRange(pos, pos);
    });
  };
  const fmt = (n: number | null) => (n === null ? '' : formatNumber(n, 2));
  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        e.stopPropagation();
        onClose();
      }}
    >
      <div className="modal asm-formula-dialog formula-builder" role="dialog" aria-label="Formula Builder" onMouseDown={(e) => e.stopPropagation()}>
        <div className="columns-head">
          <h3>Formula Builder: {item || 'Untitled item'}</h3>
        </div>
        <p className="hint-text">
          The quantity of {item || 'this item'} for each measurement, in {unit || 'its unit'}. Click a name, function or operator to put it in at the cursor. A formula must give a number; Yes/No switches count as 1 and 0.
        </p>
        <textarea
          ref={box}
          autoFocus
          rows={5}
          className="col-formula asm-formula-big"
          aria-label={`Formula for ${item}, Formula Builder`}
          value={formula}
          readOnly={readOnly}
          aria-invalid={!!problem}
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              onClose();
            }
          }}
        />
        <div className="fb-status" aria-live="polite">
          {problem ? (
            <em className="col-error">{problem}</em>
          ) : result ? (
            result.error ? (
              <em className="col-error">
                For {resultLabel}: {result.error}
              </em>
            ) : (
              <span className="fb-result">
                For {resultLabel}: <strong data-testid="formula-result">{fmt(result.rounded)}</strong> {unit}
                {result.base !== null && result.base !== result.rounded && <span className="muted"> ({fmt(result.base)} before waste and rounding)</span>}
              </span>
            )
          ) : (
            <span className="muted">The formula is valid. Select a measurement before opening the Assemblies window to see its result here.</span>
          )}
        </div>
        <div className="fb-ops" aria-label="Operators">
          {OPERATORS.map((o) => (
            <button key={o.label} type="button" className="btn small" disabled={readOnly} title={o.text.trim()} onMouseDown={(e) => e.preventDefault()} onClick={() => insert(o.text)}>
              {o.label}
            </button>
          ))}
        </div>
        <div className="fb-columns">
          <div className="fb-props" aria-label="Properties">
            {groups
              .filter((g) => g.names.length)
              .map((g) => (
                <div key={g.label} role="group" aria-label={g.label}>
                  <div className="asm-menu-head">{g.label}</div>
                  <div className="asm-refs">
                    {g.names.map((r) => (
                      <button key={r.name} type="button" className="asm-ref" title={r.hint} disabled={readOnly} onMouseDown={(e) => e.preventDefault()} onClick={() => insert(`[${r.name}]`)}>
                        [{r.name}]
                      </button>
                    ))}
                  </div>
                </div>
              ))}
          </div>
          <ul className="fb-functions" aria-label="Functions">
            {FUNCTION_DOCS.map((f) => (
              <li key={f.name}>
                <button type="button" className="asm-ref" title={f.hint} disabled={readOnly} onMouseDown={(e) => e.preventDefault()} onClick={() => insert(`${f.name}()`, 1)}>
                  {f.signature}
                </button>
                <span className="muted"> {f.hint}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="actions columns-actions">
          <span className="grow" />
          <button type="button" className="btn primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
