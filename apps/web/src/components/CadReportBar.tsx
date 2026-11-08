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
    <div className="slow-drawing cad-report" role="status" aria-label="Drawing conversion">
      <p>
        <span className="experimental-badge">Experimental</span> {summaryText(conversion.source.name, report)} The original drawing is not changed.
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
            {open ? 'Hide Details' : 'Details'}
          </button>
        )}
        <button className="btn" onClick={onConvertAgain}>
          Convert Again…
        </button>
        <button className="btn" onClick={() => cadSession.dismiss(fileId)}>
          Close
        </button>
      </div>
    </div>
  );
}
