import type { MarkupTools } from '../markup/MarkupTools';

interface Props {
  tools: MarkupTools;
  /** Number of characters selected. */
  length: number;
  readOnly: boolean;
  onCopy: () => void;
}

/**
 * What can be done with the PDF text the user just selected: copy it, or mark it up. The words stay
 * highlighted until they choose, press Esc or click elsewhere.
 */
export function TextSelectionBar({ tools, length, readOnly, onCopy }: Props) {
  const mark = (type: 'textHighlight' | 'underline' | 'strikeout' | 'squiggly') => () => tools.markSelectedText(type);
  return (
    <div className="text-selection-bar" role="toolbar" aria-label="Selected text">
      <span className="text-selection-count">
        {length} character{length === 1 ? '' : 's'}
      </span>
      <button type="button" className="btn" title="Copy the selected text (Ctrl+C)" onClick={onCopy}>
        Copy
      </button>
      <span className="sep" />
      <button type="button" className="btn" disabled={readOnly} title="Highlight the selected text" onClick={mark('textHighlight')}>
        Highlight
      </button>
      <button type="button" className="btn u" disabled={readOnly} title="Underline the selected text" onClick={mark('underline')}>
        Underline
      </button>
      <button type="button" className="btn s" disabled={readOnly} title="Strike through the selected text" onClick={mark('strikeout')}>
        Strikethrough
      </button>
      <button type="button" className="btn" disabled={readOnly} title="Mark the selected text with a wavy line" onClick={mark('squiggly')}>
        Squiggly
      </button>
      <button type="button" className="btn" title="Deselect (Esc)" aria-label="Deselect" onClick={() => tools.clearTextSelection()}>
        ✕
      </button>
    </div>
  );
}
