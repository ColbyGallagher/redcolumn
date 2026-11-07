import { useState } from 'react';
import type { CountTool } from '../search/countFromHits';

interface Props {
  /** How many found items will be counted. */
  total: number;
  /** The Tool Chest's count tools. */
  tools: CountTool[];
  onApply: (tool: CountTool | null) => void;
  onCancel: () => void;
}

/** Apply Count to Checked: which count tool the checked search results become, or the default count. */
export function CountToolDialog({ total, tools, onApply, onCancel }: Props) {
  const [choice, setChoice] = useState<string>('');
  const tool = tools.find((t) => t.id === choice) ?? null;
  const swatch = (t: CountTool | null) => <span className="count-tool-swatch" aria-hidden="true" style={{ background: t?.style.stroke ?? '#e03131' }} />;
  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <form
        className="modal page-tools print-dialog count-tool-dialog"
        role="dialog"
        aria-label="Apply Count to Checked"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') onCancel();
        }}
        onSubmit={(e) => {
          e.preventDefault();
          onApply(tool);
        }}
      >
        <h3>Apply Count to Checked</h3>
        <p className="muted">
          {total} checked result{total === 1 ? '' : 's'} become a count with the symbol at the centre of each match.
        </p>
        <fieldset>
          <legend>Count tool</legend>
          <label className="row">
            <input type="radio" name="count-tool" checked={choice === ''} onChange={() => setChoice('')} autoFocus />
            {swatch(null)}
            Default count
          </label>
          {tools.map((t) => (
            <label key={t.id} className="row">
              <input type="radio" name="count-tool" checked={choice === t.id} onChange={() => setChoice(t.id)} />
              {swatch(t)}
              {t.name}
            </label>
          ))}
          {tools.length === 0 && <p className="muted">No count tools in the Tool Chest yet: save a count markup to it to use it here.</p>}
        </fieldset>
        <div className="actions">
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
