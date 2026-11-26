import { msg, msgParts } from '@nb/i18n';
import { keyed } from '../i18n/keyed';
import { useState } from 'react';

export interface RedactOptions {
  /** Overlay colour, #rrggbb. */
  fill: string;
  /** Text on each overlay, or '' for none. */
  text: string;
  /** Remove the document's metadata (title, author, XMP) too. */
  stripMetadata: boolean;
}

/** Black or white, whichever reads on `hex`. */
export function contrastOn(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  const l = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return l > 140 ? [0, 0, 0] : [1, 1, 1];
}

/** Tools › Redaction › Apply Redactions: how the removed areas look, and whether metadata goes too. */
export function ApplyRedactionsDialog({ count, onApply, onCancel }: { count: number; onApply: (o: RedactOptions) => void; onCancel: () => void }) {
  const [fill, setFill] = useState('#000000');
  const [text, setText] = useState('');
  const [stripMetadata, setStripMetadata] = useState(true);
  const [r, g, b] = contrastOn(fill).map((v) => v * 255);
  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <form
        className="modal"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') onCancel();
        }}
        onSubmit={(e) => {
          e.preventDefault();
          onApply({ fill, text: text.trim(), stripMetadata });
        }}
      >
        <h3>{msg('Apply Redactions')}</h3>
        <p>
          {msg('The content under {count} marked {count2, plural, one {area} other {areas}} is removed from the file for good, along with markups there.', { count, count2: count })}
        </p>
        <div className="form-grid">
          <label htmlFor="rd-fill">{msg('Overlay colour')}</label>
          <input id="rd-fill" type="color" value={fill} onChange={(e) => setFill(e.target.value)} />
          <label htmlFor="rd-text">{msg('Overlay text')}</label>
          <input id="rd-text" value={text} placeholder={msg('None (e.g. REDACTED, (b)(6))')} onChange={(e) => setText(e.target.value)} />
        </div>
        <div className="redact-preview" style={{ background: fill, color: `rgb(${r},${g},${b})` }}>
          {text || ' '}
        </div>
        <label className="field">
          {keyed(msgParts('{input}Also remove the document\'s metadata (title, author, subject, keywords, XMP)', { input: <input type="checkbox" checked={stripMetadata} onChange={(e) => setStripMetadata(e.target.checked)} /> }))}
        </label>
        <div className="actions">
          <button type="button" className="btn" onClick={onCancel}>
            {msg('Cancel')}
          </button>
          <button type="submit" className="btn primary danger">
            {msg('Apply')}
          </button>
        </div>
      </form>
    </div>
  );
}
