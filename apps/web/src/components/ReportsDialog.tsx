import { useState } from 'react';
import { REPORTS, type ReportId, type ReportScope } from '../takeoff/reports';

export type ReportFormatId = 'pdf' | 'xlsx' | 'csv';
export type ReportPaper = 'a4' | 'letter';

export interface ReportRequest {
  reports: ReportId[];
  scope: ReportScope;
  format: ReportFormatId;
  paper: ReportPaper;
}

interface Props {
  /** Markups in each scope, so the picker can say what it covers (and turn off a scope with nothing in it). */
  counts: Readonly<Record<ReportScope, number>>;
  /** The current page's name, for the "Current page" choice. */
  pageLabel: string;
  /** Exporting: the dialog stays open and its button is off while it runs. */
  busy: boolean;
  error: string | null;
  onExport: (request: ReportRequest) => void;
  onClose: () => void;
}

const SCOPES: { id: ReportScope; label: string }[] = [
  { id: 'all', label: 'All pages' },
  { id: 'page', label: 'Current page' },
  { id: 'selection', label: 'Selected markups' },
  { id: 'list', label: 'Markups list, as filtered' },
];

const FORMATS: { id: ReportFormatId; label: string; hint: string }[] = [
  { id: 'pdf', label: 'PDF', hint: 'One file, a page set per report' },
  { id: 'xlsx', label: 'Excel', hint: 'One workbook, a sheet per report' },
  { id: 'csv', label: 'CSV', hint: 'One file per report (a zip when more than one)' },
];

/** The paper people in most places use: Letter in the US and Canada, A4 elsewhere. */
function defaultPaper(): ReportPaper {
  try {
    return /-(US|CA)\b/i.test(navigator.language) ? 'letter' : 'a4';
  } catch {
    return 'a4';
  }
}

/**
 * Takeoff › Reports: pick the reports, what they cover and the file to make. They are built from
 * the measurements, the assemblies and the Items catalog, in each page's display units.
 */
export function ReportsDialog({ counts, pageLabel, busy, error, onExport, onClose }: Props) {
  const [picked, setPicked] = useState<ReadonlySet<ReportId>>(() => new Set(REPORTS.map((r) => r.id)));
  const [scope, setScope] = useState<ReportScope>('all');
  const [format, setFormat] = useState<ReportFormatId>('pdf');
  const [paper, setPaper] = useState<ReportPaper>(defaultPaper);
  const toggle = (id: ReportId, on: boolean) =>
    setPicked((p) => {
      const next = new Set(p);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const ready = picked.size > 0 && !busy;
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form
        className="modal reports-dialog"
        role="dialog"
        aria-label="Takeoff Reports"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') onClose();
        }}
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) onExport({ reports: REPORTS.filter((r) => picked.has(r.id)).map((r) => r.id), scope, format, paper });
        }}
      >
        <h3>Takeoff Reports</h3>
        <fieldset className="reports-group">
          <legend>Reports</legend>
          {REPORTS.map((r) => (
            <label key={r.id} className="reports-choice" title={r.hint}>
              <input type="checkbox" checked={picked.has(r.id)} onChange={(e) => toggle(r.id, e.target.checked)} />
              <span>
                {r.title} <span className="muted">{r.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <fieldset className="reports-group">
          <legend>Cover</legend>
          {SCOPES.map((s) => (
            <label key={s.id} className="reports-choice">
              <input type="radio" name="report-scope" checked={scope === s.id} disabled={s.id !== 'all' && counts[s.id] === 0} onChange={() => setScope(s.id)} />
              <span>
                {s.id === 'page' ? `${s.label} (${pageLabel})` : s.label} <span className="muted">{counts[s.id]} markup{counts[s.id] === 1 ? '' : 's'}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <fieldset className="reports-group">
          <legend>File</legend>
          {FORMATS.map((f) => (
            <label key={f.id} className="reports-choice" title={f.hint}>
              <input type="radio" name="report-format" checked={format === f.id} onChange={() => setFormat(f.id)} />
              <span>
                {f.label} <span className="muted">{f.hint}</span>
              </span>
            </label>
          ))}
          <label className="reports-choice">
            <span>Paper</span>
            <select aria-label="Paper size" value={paper} disabled={format !== 'pdf'} onChange={(e) => setPaper(e.target.value as ReportPaper)}>
              <option value="a4">A4 landscape</option>
              <option value="letter">Letter landscape</option>
            </select>
          </label>
        </fieldset>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="actions">
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={!ready}>
            {busy ? 'Exporting…' : 'Export'}
          </button>
        </div>
      </form>
    </div>
  );
}
