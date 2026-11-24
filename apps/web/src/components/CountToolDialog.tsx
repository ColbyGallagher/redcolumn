import { msg, msgParts } from '@nb/i18n';
import { keyed } from '../i18n/keyed';
import { useState } from 'react';
import type { CountTool } from '../search/countFromHits';
import { CountSymbolSwatch } from './CountSymbolSwatch';

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
  const swatch = (t: CountTool | null) => (
    <CountSymbolSwatch shape={t?.style.countShape ?? 'circle'} symbol={t?.style.countSymbol} style={t?.style} size={18} className="count-tool-swatch-canvas" />
  );
  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <form
        className="modal page-tools print-dialog count-tool-dialog"
        role="dialog"
        aria-label={msg('Apply Count to Checked')}
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
        <h3>{msg('Apply Count to Checked')}</h3>
        <p className="muted">
          {msg('{total} checked {total2, plural, one {result} other {results}} become a count with the symbol at the centre of each match.', { total, total2: total })}
        </p>
        <fieldset>
          <legend>{msg('Count tool')}</legend>
          <label className="row">
            {keyed(msgParts('{input}{swatch}Default count', { input: <input type="radio" name="count-tool" checked={choice === ''} onChange={() => setChoice('')} autoFocus />, swatch: swatch(null) }))}
          </label>
          {tools.map((t) => (
            <label key={t.id} className="row">
              <input type="radio" name="count-tool" checked={choice === t.id} onChange={() => setChoice(t.id)} />
              {swatch(t)}
              {t.name}
            </label>
          ))}
          {tools.length === 0 && <p className="muted">{msg('No count tools in the Tool Chest yet: save a count markup to it to use it here.')}</p>}
        </fieldset>
        <div className="actions">
          <span className="spacer" />
          <button type="button" className="btn" onClick={onCancel}>
            {msg('Cancel')}
          </button>
          <button type="submit" className="btn primary">
            {msg('Apply')}
          </button>
        </div>
      </form>
    </div>
  );
}
