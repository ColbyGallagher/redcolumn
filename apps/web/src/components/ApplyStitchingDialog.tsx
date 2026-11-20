import { useMemo, useRef, useState } from 'react';
import { leftoverTargets, pairInOrder, type SheetPair } from '@nb/stitch';
import type { StoredManualStitch } from '@nb/markup';
import { parsePageRange } from '../documents/printPdf';
import { replacementSummary, sameSize, stitchSourceSheets, unpartneredLines, type PageShape, type SheetResult } from '../documents/bulkStitch';

export interface StitchTargetDoc {
  id: string;
  name: string;
  pageCount: number;
  readOnly: boolean;
  label: (pageIndex: number) => string;
  /** The page's size in points (rotation applied) and its rotation, when known. */
  size: (pageIndex: number) => PageShape;
  /** The document's hand-placed stitching now. */
  stitch: () => StoredManualStitch;
}

export interface ApplyOptions {
  /** Target sheets to copy onto without snapping, with the reason. */
  copyOnly: Map<number, string>;
  onProgress: (done: number, total: number) => void;
  /** Stop: nothing is written. */
  signal: AbortSignal;
}

interface Props {
  /** Open documents the stitch can be copied into; the first is the one it comes from. */
  documents: StitchTargetDoc[];
  onApply: (targetId: string, pairs: SheetPair[], toleranceMm: number, options: ApplyOptions) => Promise<SheetResult[]>;
  /** Opens the Stitched View at a target sheet. */
  onShow: (targetId: string, pageIndex: number) => void;
  onClose: () => void;
}

const pct = (n: number) => `${Math.round(n * 100)}%`;
const range = (from: number, to: number) => (to > from ? `${from}-${to}` : `${from}`);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const SIZE_NOTE = 'Page size or rotation differs from its stitched sheet: copied without snapping';

/**
 * Apply Stitching to Other Sheets: pick another discipline's plan sheets, check how they pair
 * up with the stitched sheets (in order; any row can take another sheet or be skipped), and copy
 * the match lines and regions across. Each copied line is then nudged onto the drawn match line
 * found within the tolerance, and the result says which sheets snapped.
 */
export function ApplyStitchingDialog({ documents, onApply, onShow, onClose }: Props) {
  const source = documents[0]!;
  // Read on every render, so the warnings follow changes made while the dialog is open.
  const sourceStitch = source.stitch();
  const sources = stitchSourceSheets(sourceStitch);
  const after = Math.max(...sources) + 2;
  const [targetId, setTargetId] = useState(source.id);
  const target = documents.find((d) => d.id === targetId) ?? source;
  const same = target.id === source.id;
  const defaultRange = (d: StitchTargetDoc) => (d.id === source.id ? (after <= d.pageCount ? range(after, Math.min(d.pageCount, after + sources.length - 1)) : '') : range(1, Math.min(d.pageCount, sources.length)));
  const [text, setText] = useState(() => defaultRange(source));
  const [tolerance, setTolerance] = useState(3);
  const picked = useMemo(() => (text.trim() ? parsePageRange(text, target.pageCount) : []), [text, target.pageCount]);
  const exclude = same ? sources : [];
  const autoPairs = pairInOrder(sources, picked ?? [], exclude);
  /** Rows the user changed by hand, by source sheet. */
  const [edits, setEdits] = useState<Map<number, number | null>>(new Map());
  const pairs = autoPairs.map((p): SheetPair => (edits.has(p.source) ? { source: p.source, target: edits.get(p.source)! } : p));
  const [busy, setBusy] = useState<string | null>(null);
  const [results, setResults] = useState<SheetResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stopped, setStopped] = useState(false);
  const abort = useRef<AbortController | null>(null);

  const mismatched = (p: SheetPair) => p.target !== null && !sameSize(source.size(p.source), target.size(p.target));
  const choices = Array.from({ length: target.pageCount }, (_, i) => i).filter((i) => !same || !sources.includes(i));
  const used = pairs.map((p) => p.target).filter((t): t is number => t !== null);
  const twice = used.find((t, i) => used.indexOf(t) !== i);
  const replaced = replacementSummary(target.stitch(), used);
  const unpartnered = unpartneredLines(sourceStitch, pairs);
  const leftover = leftoverTargets(sources, picked ?? [], exclude);
  const sizeOff = pairs.filter(mismatched).length;
  const problem =
    picked === null
      ? 'Enter target sheets as a page range such as 5-8.'
      : target.readOnly
        ? `${target.name} is read-only.`
        : !used.length
          ? 'Pick at least one target sheet.'
          : twice !== undefined
            ? `${target.label(twice)} is paired twice.`
            : !(tolerance >= 0 && tolerance <= 50)
              ? 'The snap tolerance is 0 to 50 mm.'
              : null;
  const changeTarget = (id: string) => {
    const d = documents.find((x) => x.id === id) ?? source;
    setTargetId(d.id);
    setText(defaultRange(d));
    setEdits(new Map());
  };
  const swap = (i: number, j: number) => {
    const next = new Map(edits);
    next.set(pairs[i]!.source, pairs[j]!.target);
    next.set(pairs[j]!.source, pairs[i]!.target);
    setEdits(next);
  };
  const apply = async () => {
    const ac = new AbortController();
    abort.current = ac;
    setBusy('Applying…');
    setError(null);
    setStopped(false);
    try {
      const copyOnly = new Map(pairs.filter(mismatched).map((p) => [p.target!, SIZE_NOTE]));
      const out = await onApply(target.id, pairs, tolerance, { copyOnly, onProgress: (d, n) => setBusy(`Applying… ${d} of ${n}`), signal: ac.signal });
      if (!ac.signal.aborted) setResults(out);
    } catch (e) {
      // Stopped: back to the form, with nothing written.
      if (ac.signal.aborted) setStopped(true);
      else setError(e instanceof Error ? e.message : String(e));
    } finally {
      abort.current = null;
      setBusy(null);
    }
  };
  // While applying, the dialog stays open (Stop is the way out): closing it would hide a change still to come.
  const close = () => {
    if (!busy) onClose();
  };
  const undoHint = `Edit › Undo in ${target.name} puts it back.`;

  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <form
        className="modal page-tools print-dialog apply-stitching"
        role="dialog"
        aria-label="Apply Stitching to Other Sheets"
        aria-busy={!!busy}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') close();
        }}
        onSubmit={(e) => {
          e.preventDefault();
          if (!results && !problem && !busy) void apply();
        }}
      >
        <h3>Apply Stitching to Other Sheets</h3>
        {!results ? (
          <>
            <p className="muted">Copies the match lines and regions of the stitched sheets onto another discipline&rsquo;s plans, at the same place on each page, then snaps each line onto the match line drawn close by.</p>
            <fieldset disabled={!!busy}>
              <legend>Target sheets</legend>
              {documents.length > 1 && (
                <label className="row">
                  Document
                  <select aria-label="Target document" value={target.id} onChange={(e) => changeTarget(e.target.value)}>
                    {documents.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="row">
                Pages
                <input type="text" aria-label="Target pages" value={text} placeholder={`e.g. 5-8 (of ${target.pageCount})`} onChange={(e) => (setText(e.target.value), setEdits(new Map()))} />
              </label>
              <label className="row">
                Snap within
                <input type="number" aria-label="Snap tolerance (mm)" min={0} max={50} step={0.5} value={tolerance} onChange={(e) => setTolerance(Number(e.target.value))} style={{ width: '5em' }} />
                mm on paper (0: copy only)
              </label>
            </fieldset>
            <fieldset disabled={!!busy}>
              <legend>Pairing</legend>
              <table className="apply-stitching-pairs" style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left' }}>Stitched sheet</th>
                    <th style={{ textAlign: 'left' }}>Copy onto</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {pairs.map((p, i) => (
                    <tr key={p.source}>
                      <td>{source.label(p.source)}</td>
                      <td>
                        <select aria-label={`Target for ${source.label(p.source)}`} value={p.target ?? ''} onChange={(e) => setEdits(new Map(edits).set(p.source, e.target.value === '' ? null : Number(e.target.value)))}>
                          <option value="">— Skip —</option>
                          {choices.map((c) => (
                            <option key={c} value={c}>
                              {target.label(c)}
                            </option>
                          ))}
                        </select>
                        {mismatched(p) && (
                          <span className="print-error" title={SIZE_NOTE}>
                            {' '}
                            ⚠ Different page size or rotation: copy only
                          </span>
                        )}
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <button type="button" className="btn small" title="Swap with the row above" disabled={i === 0} onClick={() => swap(i, i - 1)}>
                          ▲
                        </button>
                        <button type="button" className="btn small" title="Swap with the row below" disabled={i === pairs.length - 1} onClick={() => swap(i, i + 1)}>
                          ▼
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </fieldset>
            <ul className="apply-stitching-notes muted">
              {replaced.sheets > 0 && (
                <li className="print-error">
                  Replaces {plural(replaced.lines, 'match line')}
                  {replaced.regions ? ` and ${plural(replaced.regions, 'region')}` : ''} on {plural(replaced.sheets, 'sheet')} of {target.name}
                  {replaced.broken ? `; ${plural(replaced.broken, 'line')} on other sheets lose${replaced.broken === 1 ? 's' : ''} its match` : ''}.
                </li>
              )}
              {unpartnered > 0 && <li className="print-error">{plural(unpartnered, 'copied line')} will have no partner: the sheet it joins is skipped.</li>}
              {stopped && <li>Stopped: nothing was changed.</li>}
              {leftover > 0 && <li>{plural(leftover, 'target sheet')} beyond the stitched sheets {leftover === 1 ? 'is' : 'are'} left out.</li>}
              {sizeOff > 0 && <li>{plural(sizeOff, 'pair')} with different page sizes {sizeOff === 1 ? 'is' : 'are'} copied without snapping (different page size or rotation).</li>}
              <li>{undoHint}</li>
            </ul>
          </>
        ) : (
          <>
            <p>
              Copied onto {plural(results.length, 'sheet')} of {target.name}; {results.filter((r) => r.snapped === r.lines).length} snapped to their drawn match lines.
              {results.some((r) => r.unpartnered) && ` ${plural(results.reduce((s, r) => s + r.unpartnered, 0), 'line')} have no partner (their sheet was skipped).`}
            </p>
            <table className="apply-stitching-results" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Sheet</th>
                  <th style={{ textAlign: 'left' }}>Lines snapped</th>
                  <th style={{ textAlign: 'left' }}>Confidence</th>
                  <th style={{ textAlign: 'left' }}>Moved</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.target} className={r.snapped === r.lines ? 'snapped' : 'flagged'} title={r.problem ?? undefined}>
                    <td>{target.label(r.target)}</td>
                    <td>
                      {r.snapped} of {r.lines}
                      {r.problem && <span className="print-error"> ⚠ {r.problem}: kept where copied</span>}
                      {r.unpartnered > 0 && <span className="print-error"> ⚠ {plural(r.unpartnered, 'line')} without a partner</span>}
                    </td>
                    <td>{r.checked ? pct(r.confidence) : 'n/a'}</td>
                    <td>{r.movedMm.toFixed(1)} mm</td>
                    <td>
                      <button type="button" className="btn small" onClick={() => onShow(target.id, r.target)}>
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted">{undoHint}</p>
          </>
        )}
        {(error ?? (!results && problem)) && <p className="print-error">{error ?? problem}</p>}
        <div className="actions">
          <span className="spacer" />
          {!results ? (
            <>
              {busy ? (
                <button type="button" className="btn" onClick={() => abort.current?.abort()}>
                  Stop
                </button>
              ) : (
                <button type="button" className="btn" onClick={close}>
                  Cancel
                </button>
              )}
              <button type="submit" className="btn primary" disabled={!!problem || !!busy} autoFocus>
                {busy ?? 'Apply'}
              </button>
            </>
          ) : (
            <button type="button" className="btn primary" onClick={onClose} autoFocus>
              Close
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
