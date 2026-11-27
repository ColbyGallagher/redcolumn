import { msg } from '@nb/i18n';
import { useState } from 'react';
import { warningText, summaryText } from '../cad/messages';
import { cadSession, useCadConversion } from '../cad/session';

interface Props {
  fileId: string;
  onConvertAgain: () => void;
}

/** Over a PDF converted from a drawing in this visit: what the conversion found, and Convert Again. */
export function CadReportBar({ fileId, onConvertAgain }: Props) {
  const entry = useCadConversion(fileId);
  const [open, setOpen] = useState(false);
  if (!entry || entry.dismissed) return null;
  const { conversion } = entry;
  const { report } = conversion;
  return (
    <div className="slow-drawing cad-report" role="status" aria-label={msg('Drawing conversion')}>
      <p>
        <span className="experimental-badge">{msg('Experimental')}</span> {summaryText(conversion.source.name, report)} {msg('The original drawing is not changed.')}
      </p>
      {open && report.warnings.length > 0 && (
        <ul className="cad-report-list">
          {report.warnings.map((w, i) => (
            <li key={i}>{warningText(w)}</li>
          ))}
        </ul>
      )}
      <div className="slow-drawing-actions">
        {report.warnings.length > 0 && (
          <button className="btn" onClick={() => setOpen(!open)} aria-expanded={open}>
            {open ? msg('Hide Details') : msg('Details')}
          </button>
        )}
        <button className="btn" onClick={onConvertAgain}>
          {msg('Convert Again…')}
        </button>
        <button className="btn" onClick={() => cadSession.dismiss(fileId)}>
          {msg('Close')}
        </button>
      </div>
    </div>
  );
}
