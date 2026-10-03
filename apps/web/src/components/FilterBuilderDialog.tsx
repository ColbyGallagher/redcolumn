import { useState } from 'react';
import { FILTER_OPS, type AdvancedFilter, type FilterOp, type FilterRule, type ListColumn } from '../columns/listColumns';

interface Props {
  columns: readonly ListColumn[];
  initial: AdvancedFilter | null;
  onApply: (filter: AdvancedFilter | null) => void;
  onCancel: () => void;
}

/**
 * Markups list › Filter Builder: conditions on any columns, joined by "all" (AND) or "any" (OR).
 * They apply together with the column filters in the filter row.
 */
export function FilterBuilderDialog({ columns, initial, onApply, onCancel }: Props) {
  const [match, setMatch] = useState<'all' | 'any'>(initial?.match ?? 'all');
  const [rules, setRules] = useState<FilterRule[]>(initial?.rules.length ? initial.rules : [{ key: columns[0]?.key ?? 'subject', op: 'contains', value: '' }]);

  const update = (i: number, patch: Partial<FilterRule>) => setRules(rules.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const usable = rules.filter((r) => r.value.trim() || !FILTER_OPS.find((o) => o.value === r.op)?.needsValue);

  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <form
        className="modal filter-builder"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          onApply(usable.length ? { match, rules: usable } : null);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') onCancel();
        }}
      >
        <h3>Filter Builder</h3>
        <div className="row match-row">
          Show markups that match
          <select value={match} onChange={(e) => setMatch(e.target.value as 'all' | 'any')} aria-label="Match">
            <option value="all">all</option>
            <option value="any">any</option>
          </select>
          of these conditions:
        </div>
        <div className="rules">
          {rules.map((r, i) => {
            const op = FILTER_OPS.find((o) => o.value === r.op)!;
            return (
              <div key={i} className="rule">
                <select value={r.key} aria-label="Column" onChange={(e) => update(i, { key: e.target.value })}>
                  {columns.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label}
                    </option>
                  ))}
                </select>
                <select value={r.op} aria-label="Condition" onChange={(e) => update(i, { op: e.target.value as FilterOp })}>
                  {FILTER_OPS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                {op.needsValue ? <input value={r.value} aria-label="Value" placeholder="Value" autoFocus={i === rules.length - 1} onChange={(e) => update(i, { value: e.target.value })} /> : <span className="grow" />}
                <button type="button" className="btn small" title="Remove this condition" onClick={() => setRules(rules.filter((_, k) => k !== i))}>
                  ×
                </button>
              </div>
            );
          })}
        </div>
        <button type="button" className="btn small" onClick={() => setRules([...rules, { key: rules.at(-1)?.key ?? columns[0]?.key ?? 'subject', op: 'contains', value: '' }])}>
          + Add condition
        </button>
        <div className="actions">
          <button type="button" className="btn" onClick={() => onApply(null)} disabled={!initial}>
            Clear
          </button>
          <span className="spacer" />
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn primary">
            Apply
          </button>
        </div>
      </form>
    </div>
  );
}
