import { useRef, useState } from 'react';
import type { StoredFile } from '../storage/fileStore';

export type SlipSource = { kind: 'file'; file: File } | { kind: 'library'; id: string; name: string };

export interface SlipSheetSpec {
  sources: SlipSource[];
  mode: 'sheet' | 'order';
  /** Sheets with no match are added at the end. */
  addUnmatched: boolean;
  /** Markups are moved to line up with the new sheet when it was plotted in a different place. */
  alignMarkups: boolean;
  /** Closed comments on the replaced sheets are not carried to the new revision; they stay in the revision kept of the set as it was. */
  leaveClosed: boolean;
}

interface Props {
  targetName: string;
  /** Library documents that can be slip-sheeted in (the target itself is left out). */
  files: readonly StoredFile[];
  /** How many comments in the document are closed now, and what closed means here. */
  closed: { count: number; means: string };
  onRun: (spec: SlipSheetSpec) => void;
  onCancel: () => void;
}

const sourceName = (s: SlipSource) => (s.kind === 'file' ? s.file.name : s.name);

/**
 * Document › Slip Sheet (also on the Batch menu): puts new revisions of sheets into this set in
 * place of the old ones. Each sheet keeps its page and its markups; the old set is kept as a
 * revision so it can be compared or restored.
 */
export function SlipSheetDialog({ targetName, files, closed, onRun, onCancel }: Props) {
  const [sources, setSources] = useState<SlipSource[]>([]);
  const [mode, setMode] = useState<'sheet' | 'order'>('sheet');
  const [addUnmatched, setAddUnmatched] = useState(true);
  const [alignMarkups, setAlignMarkups] = useState(true);
  const [leaveClosed, setLeaveClosed] = useState(false);
  const [pick, setPick] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const add = (list: SlipSource[]) => setSources((cur) => [...cur, ...list.filter((s) => !cur.some((c) => sourceName(c) === sourceName(s)))]);

  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <form
        className="modal print-dialog slip-sheet"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') onCancel();
        }}
        onSubmit={(e) => {
          e.preventDefault();
          if (sources.length) onRun({ sources, mode, addUnmatched, alignMarkups, leaveClosed });
        }}
      >
        <h3>Slip Sheet</h3>
        <p>
          New revisions of sheets replace the old ones in <b>{targetName}</b>. Each sheet keeps its place and its markups; the current set is kept as a revision.
        </p>
        <fieldset>
          <legend>New revisions</legend>
          {sources.length ? (
            <ul className="slip-sources">
              {sources.map((s, i) => (
                <li key={i}>
                  <span>{sourceName(s)}</span>
                  <button type="button" className="btn small flat" title="Remove" onClick={() => setSources((cur) => cur.filter((_, k) => k !== i))}>
                    ×
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="print-hint">Add the PDFs with the new sheets.</p>
          )}
          <div className="row">
            <button type="button" className="btn small" onClick={() => input.current?.click()}>
              Add files…
            </button>
            <select
              value={pick}
              aria-label="Add from the library"
              onChange={(e) => {
                const f = files.find((x) => x.id === e.target.value);
                if (f) add([{ kind: 'library', id: f.id, name: f.name }]);
                setPick('');
              }}
            >
              <option value="">Add from the library…</option>
              {files.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>
          <input
            ref={input}
            type="file"
            accept="application/pdf,.pdf"
            multiple
            hidden
            onChange={(e) => {
              add([...(e.target.files ?? [])].map((file) => ({ kind: 'file' as const, file })));
              e.target.value = '';
            }}
          />
        </fieldset>
        <fieldset>
          <legend>Match sheets</legend>
          <label className="row">
            <input type="radio" checked={mode === 'sheet'} onChange={() => setMode('sheet')} />
            By sheet number
          </label>
          <label className="row">
            <input type="radio" checked={mode === 'order'} onChange={() => setMode('order')} />
            By page order (the new pages replace pages 1, 2, 3…)
          </label>
        </fieldset>
        <label className="check">
          <input type="checkbox" checked={addUnmatched} onChange={(e) => setAddUnmatched(e.target.checked)} />
          Add new sheets that don't match any page, at the end
        </label>
        <label className="check">
          <input type="checkbox" checked={alignMarkups} onChange={(e) => setAlignMarkups(e.target.checked)} />
          Move markups to line up with the new sheets
        </label>
        <label className="check">
          <input type="checkbox" checked={leaveClosed} onChange={(e) => setLeaveClosed(e.target.checked)} />
          Leave closed comments behind
        </label>
        <p className="print-hint">
          {leaveClosed
            ? `Comments that are ${closed.means} on the replaced sheets are not carried to the new revision (${closed.count} in this document now). They stay in the copy of the current set kept under Document › Revisions. Open comments carry forward.`
            : 'Every comment carries forward to the new revision, open or closed.'}
        </p>
        <div className="actions">
          <span className="spacer" />
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={!sources.length}>
            Slip Sheet
          </button>
        </div>
      </form>
    </div>
  );
}
