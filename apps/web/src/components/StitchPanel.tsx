import { useMemo, useState } from 'react';
import type { StoredManualStitch, StoredMatchLine } from '@nb/markup';
import { autoPair, lineProblem, pairLines } from '../documents/stitching';

interface Props {
  stitch: StoredManualStitch;
  editable: boolean;
  pageIndex: number;
  pageLabel: (pageIndex: number) => string;
  /** Pages with a viewport, whose outline stands in for a region nobody drew. */
  hasViewport: (pageIndex: number) => boolean;
  /** The tool now in use, to show which picking button is on. */
  tool: string;
  onSetTool: (tool: 'matchLine' | 'stitchRegion' | 'stitchPolygon' | 'stitchMove' | 'select') => void;
  onChange: (next: StoredManualStitch) => void;
  onGoTo: (pageIndex: number) => void;
  selected: string | null;
  onSelectLine: (id: string | null) => void;
  /** Turns the Stitched View on or off for the current sheet's group (null when it has none). */
  onPreview: (() => void) | null;
  previewing: boolean;
  /** Writes the current sheet's group as one new page (null when it has none). */
  onStitchToPage: ((includeMarkups: boolean) => void) | null;
  /** Slides the sheet joined at a line: `along` the line, and `apart` from its partner (negative: closer), in points. */
  onNudge: (id: string, along: number, apart: number) => void;
  /** Puts the sheet joined at a line back where the line ends place it. */
  onReset: (id: string) => void;
  /** The sheet a line's adjustments move (null while it is unmatched). */
  moverPage: (id: string) => number | null;
  /** Move Sheet slides only along the match line. */
  lockAlong: boolean;
  onLockAlong: (lock: boolean) => void;
  /** Takes over the current sheet's detected stitching as editable match lines (null when there is none to take). */
  onAdoptDetected: (() => void) | null;
}

const STEPS = [1, 5, 20];

/**
 * Stitching panel: outline the part of each sheet holding the drawing (leaving the title block
 * and legend out), click both ends of each match line, match each line to the one it meets on
 * the next sheet, then view the sheets joined or write them out as one page.
 */
export function StitchPanel({ stitch, editable, pageIndex, pageLabel, hasViewport, tool, onSetTool, onChange, onGoTo, selected, onSelectLine, onPreview, previewing, onStitchToPage, onNudge, onReset, moverPage, lockAlong, onLockAlong, onAdoptDetected }: Props) {
  const [includeMarkups, setIncludeMarkups] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const pages = useMemo(() => [...new Set([pageIndex, ...stitch.lines.map((l) => l.pageIndex), ...Object.keys(stitch.regions).map(Number)])].sort((a, b) => a - b), [stitch, pageIndex]);
  const unmatched = stitch.lines.filter((l) => !l.matchTo).length;
  const setLines = (lines: StoredMatchLine[]) => onChange({ ...stitch, lines });
  const update = (id: string, patch: Partial<StoredMatchLine>) => setLines(stitch.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const toggle = (t: 'matchLine' | 'stitchRegion' | 'stitchPolygon' | 'stitchMove') => onSetTool(tool === t ? 'select' : t);
  const [step, setStep] = useState(1);
  const sel = stitch.lines.find((l) => l.id === selected && l.matchTo) ?? null;
  const moving = sel ? moverPage(sel.id) : null;
  /** Arrow keys on a selected, matched line nudge its sheet (Shift: 10 steps). */
  const onKey = (e: React.KeyboardEvent, l: StoredMatchLine) => {
    if (!editable || !l.matchTo || (e.target as HTMLElement).closest('input, select')) return;
    const k = e.shiftKey ? step * 10 : step;
    const move = ({ ArrowLeft: [-k, 0], ArrowRight: [k, 0], ArrowUp: [0, -k], ArrowDown: [0, k] } as Record<string, [number, number]>)[e.key];
    if (!move) return;
    e.preventDefault();
    onNudge(l.id, move[0], move[1]);
  };

  return (
    <div className="stitch-panel">
      <p className="stitch-experimental">
        <span className="experimental-badge">Experimental</span> Check the joins before you measure across them.
      </p>
      {editable && (
        <div className="panel-toolbar">
          <button className={`btn small${tool === 'stitchRegion' ? ' active' : ''}`} title="Drag a box around the drawing on each sheet, leaving out the title block and legend" onClick={() => toggle('stitchRegion')}>
            Select Region
          </button>
          <button className={`btn small${tool === 'stitchPolygon' ? ' active' : ''}`} title="Click the corners of the drawing area; click the first corner again to close it" onClick={() => toggle('stitchPolygon')}>
            Polygon
          </button>
          <button className={`btn small${tool === 'matchLine' ? ' active' : ''}`} title="Click both ends of a match line; the tool stays on for the next sheet" onClick={() => toggle('matchLine')}>
            + Match Line
          </button>
          <button
            className={`btn small${tool === 'stitchMove' ? ' active' : ''}`}
            disabled={!sel}
            title={sel ? 'Drag in the Stitched View to move the sheet joined at the selected line' : 'Select a matched line first'}
            onClick={() => toggle('stitchMove')}
          >
            Move Sheet
          </button>
          <label className="field" title="Move Sheet slides the sheet only along the match line">
            <input type="checkbox" checked={lockAlong} onChange={(e) => onLockAlong(e.target.checked)} />
            Lock along line
          </label>
        </div>
      )}
      {editable && onAdoptDetected && (
        <div className="panel-toolbar">
          <button className="btn small" title="Turn the match lines found on this sheet's drawings into lines you can move and adjust" onClick={onAdoptDetected}>
            Edit Detected Lines
          </button>
        </div>
      )}
      <ul className="stitch-list">
        {pages.map((p) => {
          const lines = stitch.lines.filter((l) => l.pageIndex === p);
          const region = stitch.regions[p];
          return [
            <li key={`page-${p}`} className="stitch-page">
              <button className="stitch-page-name" title="Go to this sheet" onClick={() => onGoTo(p)}>
                {pageLabel(p)}
              </button>
              <span className="stitch-region" title="The part of the sheet that goes into the stitch">
                {region ? 'Custom region' : hasViewport(p) ? 'Viewport region' : <span className="warn">Whole sheet — title block included</span>}
              </span>
              {region && editable && (
                <button
                  className="btn small"
                  title="Use the whole sheet again"
                  onClick={() => {
                    const regions = { ...stitch.regions };
                    delete regions[p];
                    onChange({ ...stitch, regions });
                  }}
                >
                  Clear
                </button>
              )}
            </li>,
            ...lines.map((l) => {
              const problem = lineProblem(l, stitch.regions);
              const others = stitch.lines.filter((o) => o.pageIndex !== l.pageIndex);
              return (
                <li key={l.id} tabIndex={0} className={`stitch-line${selected === l.id ? ' active' : ''}`} onClick={() => onSelectLine(l.id)} onKeyDown={(e) => onKey(e, l)}>
                  <span className={`swatch${l.matchTo && !problem ? ' ok' : ' bad'}`} />
                  <input className="name" value={l.name} disabled={!editable} aria-label="Match line name" onChange={(e) => update(l.id, { name: e.target.value })} />
                  <select aria-label="Match to" value={l.matchTo ?? ''} disabled={!editable} onChange={(e) => setLines(pairLines(stitch.lines, l.id, e.target.value || null))}>
                    <option value="">Match to…</option>
                    {others.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name} ({pageLabel(o.pageIndex)})
                      </option>
                    ))}
                  </select>
                  {editable && (
                    <>
                      <button className="btn small" title="Keep the other side of the line" onClick={() => update(l.id, { contentSide: l.contentSide === 1 ? -1 : 1 })}>
                        ⇄
                      </button>
                      <button
                        className="btn small"
                        title="Delete the match line"
                        onClick={() => {
                          setLines(pairLines(stitch.lines, l.id, null).filter((x) => x.id !== l.id));
                          if (selected === l.id) onSelectLine(null);
                        }}
                      >
                        ×
                      </button>
                    </>
                  )}
                  {problem && <span className="stitch-problem">{problem}</span>}
                  {editable && sel?.id === l.id && moving !== null && (
                    <div className="stitch-nudge" onClick={(e) => e.stopPropagation()}>
                      <span className="stitch-nudge-label">Move {pageLabel(moving)}</span>
                      <button className="btn small" title="Slide back along the match line (←)" onClick={() => onNudge(l.id, -step, 0)}>
                        ◀
                      </button>
                      <button className="btn small" title="Slide forward along the match line (→)" onClick={() => onNudge(l.id, step, 0)}>
                        ▶
                      </button>
                      <button className="btn small" title="Move closer to the other sheet (↑)" onClick={() => onNudge(l.id, 0, -step)}>
                        ▲
                      </button>
                      <button className="btn small" title="Move apart from the other sheet (↓)" onClick={() => onNudge(l.id, 0, step)}>
                        ▼
                      </button>
                      <select aria-label="Nudge step" value={step} onChange={(e) => setStep(Number(e.target.value))}>
                        {STEPS.map((s) => (
                          <option key={s} value={s}>
                            {s} pt
                          </option>
                        ))}
                      </select>
                      {stitch.lines.some((x) => (x.id === l.id || x.id === l.matchTo) && x.offset) && (
                        <button className="btn small" title="Put the sheet back where the line ends place it" onClick={() => onReset(l.id)}>
                          Reset
                        </button>
                      )}
                    </div>
                  )}
                </li>
              );
            }),
          ];
        })}
      </ul>
      {!stitch.lines.length && <p className="empty">No match lines. Outline the drawing on each sheet, then click both ends of the match line where it continues on the next sheet.</p>}
      <div className="panel-toolbar stitch-actions">
        {editable && (
          <button
            className="btn small"
            title="Match lines on different sheets that have the same name"
            disabled={unmatched < 2}
            onClick={() => {
              const { lines, paired } = autoPair(stitch.lines);
              setLines(lines);
              setNotice(paired ? `Matched ${paired} pair${paired === 1 ? '' : 's'} by name.` : 'No two unmatched lines share a name.');
            }}
          >
            Match by Name
          </button>
        )}
        <button className={`btn small${previewing ? ' active' : ''}`} disabled={!onPreview} title="Show the joined sheets in the Stitched View" onClick={() => onPreview?.()}>
          Stitched View
        </button>
        {editable && (
          <>
            <label className="field">
              <input type="checkbox" checked={includeMarkups} onChange={(e) => setIncludeMarkups(e.target.checked)} />
              Include markups
            </label>
            <button className="btn small primary" disabled={!onStitchToPage} title="Add the joined sheets to the document as one new page" onClick={() => onStitchToPage?.(includeMarkups)}>
              Stitch to New Page
            </button>
            <button
              className="btn small"
              disabled={!stitch.lines.length && !Object.keys(stitch.regions).length}
              title="Remove every match line and region"
              onClick={() => {
                onChange({ lines: [], regions: {} });
                onSelectLine(null);
              }}
            >
              Erase All
            </button>
          </>
        )}
      </div>
      {notice && <p className="empty">{notice}</p>}
    </div>
  );
}
