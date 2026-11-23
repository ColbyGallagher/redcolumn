import { msg } from '@nb/i18n';
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
    <div className="text-selection-bar" role="toolbar" aria-label={msg('Selected text')}>
      <span className="text-selection-count">
        {msg('{count, plural, one {# character} other {# characters}}', { count: length })}
      </span>
      <button type="button" className="btn" title={msg('Copy the selected text (Ctrl+C)')} onClick={onCopy}>
        {msg('Copy')}
      </button>
      <span className="sep" />
      <button type="button" className="btn" disabled={readOnly} title={msg('Highlight the selected text')} onClick={mark('textHighlight')}>
        {msg('Highlight')}
      </button>
      <button type="button" className="btn u" disabled={readOnly} title={msg('Underline the selected text')} onClick={mark('underline')}>
        {msg('Underline')}
      </button>
      <button type="button" className="btn s" disabled={readOnly} title={msg('Strike through the selected text')} onClick={mark('strikeout')}>
        {msg('Strikethrough')}
      </button>
      <button type="button" className="btn" disabled={readOnly} title={msg('Mark the selected text with a wavy line')} onClick={mark('squiggly')}>
        {msg('Squiggly')}
      </button>
      <button type="button" className="btn" title={msg('Deselect (Esc)')} aria-label={msg('Deselect')} onClick={() => tools.clearTextSelection()}>
        ✕
      </button>
    </div>
  );
}
