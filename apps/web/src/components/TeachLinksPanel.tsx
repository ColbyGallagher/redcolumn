import { useEffect, useMemo, useRef, useState } from 'react';
import { SheetLookup, type ChainageHints, type LinkHints, type Rect, type SheetInfo } from '@nb/sheets';
import { backgroundLines, boxContents, type MarkPage } from '../sheets/marks';
import { TEACH_KINDS, learnChainage, learnLink, type Lesson, type TaughtBox, type TeachKind } from '../sheets/teachLinks';
import { useResizablePanel } from './resizablePanel';

/** A box drawn with the teach tool. */
export interface TeachBox {
  pageIndex: number;
  rect: Rect;
}

interface Props {
  /** The drawing standard the document is read with: what the pairs teach can be kept in it. */
  standard: string | null;
  /** The document's sheet info by page (stable until it changes), and its page count. */
  sheetInfo: Readonly<Record<number, SheetInfo>>;
  pageCount: number;
  linkHints: LinkHints;
  chainageHints: ChainageHints;
  /** The latest box drawn with the teach tool (a new object each time). */
  box: TeachBox | null;
  readPage: (pageIndex: number) => Promise<MarkPage>;
  /** Turns on the tool for drawing the next box. */
  onArm: () => void;
  onGoTo: (pageIndex: number) => void;
  onKeep: (lesson: Lesson, forStandard: boolean) => void;
  onClose: () => void;
}

/** A box as drawn, and what of it the person left out. */
interface Drawn extends TaughtBox {
  droppedWords: Set<number>;
  droppedLines: Set<number>;
  /** Everything in the box; `contents` is what is kept. */
  all: TaughtBox['contents'];
}

const KINDS = Object.keys(TEACH_KINDS) as TeachKind[];

function drawn(page: MarkPage, pageIndex: number, rect: Rect): Drawn {
  const all = boxContents(page, rect);
  const droppedLines = backgroundLines(page, rect, all);
  return { page, pageIndex, box: rect, all, contents: all, droppedWords: new Set(), droppedLines };
}

/** With the left-out words and line work taken away. */
function kept(d: Drawn): Drawn {
  return { ...d, contents: { words: d.all.words.filter((_, i) => !d.droppedWords.has(i)), lines: d.all.lines.filter((_, i) => !d.droppedLines.has(i)) } };
}

/**
 * The boxed mark's line work and words, drawn small: click a line or a word to leave it out (the
 * road or hatching behind a mark) or put it back. Line work running out of the box starts left out.
 */
function BoxPreview({ d, onChange, compact = false }: { d: Drawn; onChange: (d: Drawn) => void; compact?: boolean }) {
  const { box, all } = d;
  const toggle = (set: Set<number>, i: number) => {
    const next = new Set(set);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    return next;
  };
  // A finished step's box is shown small, leaving room for the next.
  const height = Math.min(compact ? 70 : 150, Math.max(50, (box.h / box.w) * 300));
  return (
    <>
      <svg className="tl-preview" viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`} style={{ height }} role="img" aria-label="What was boxed: click line work to leave it out or put it back">
        {all.lines.map(([x1, y1, x2, y2], i) => (
          <g key={i} onClick={() => onChange(kept({ ...d, droppedLines: toggle(d.droppedLines, i) }))}>
            <line x1={x1} y1={y1} x2={x2} y2={y2} className={d.droppedLines.has(i) ? 'dropped' : undefined} vectorEffect="non-scaling-stroke" strokeWidth={1.2} />
            <line x1={x1} y1={y1} x2={x2} y2={y2} className="hit" vectorEffect="non-scaling-stroke" strokeWidth={8} />
          </g>
        ))}
        {all.words.map((w, i) => (
          <text key={i} x={w.x0} y={w.y1} fontSize={w.size} className={d.droppedWords.has(i) ? 'dropped' : undefined}>
            {w.text}
          </text>
        ))}
      </svg>
      <p className="hint">
        {all.lines.length - d.droppedLines.size} of {all.lines.length} lines kept{d.droppedLines.size ? ' (red: the drawing behind the mark)' : ''}. Click a line to leave it out or put it back.
      </p>
      {all.words.length > 0 && (
        <div className="tl-words" aria-label="Words in the box">
          {all.words.map((w, i) => (
            <button key={i} type="button" className="btn small" aria-pressed={!d.droppedWords.has(i)} title={d.droppedWords.has(i) ? 'Left out: click to put it back' : 'Click to leave it out'} onClick={() => onChange(kept({ ...d, droppedWords: toggle(d.droppedWords, i) }))}>
              {w.text}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

/**
 * Teach Links: box a mark on one sheet, then what it points to on another, for sections, details,
 * elevations and chainage in turn. Each pair is checked before it is kept: the identifiers must
 * agree and the mark must name the sheet its title is on. What the pair teaches about the client's
 * drawings (which part of the number callouts cite, how titles and chainages are written) goes into
 * the document's drawing standard with the marks.
 */
export function TeachLinksPanel({ standard, sheetInfo, pageCount, linkHints: givenLinks, chainageHints: givenChainage, box, readPage, onArm, onGoTo, onKeep, onClose }: Props) {
  const panel = useResizablePanel('nb.panel.teachLinks');
  const [kind, setKind] = useState<TeachKind>('section');
  const [mark, setMark] = useState<Drawn | null>(null);
  const [target, setTarget] = useState<Drawn | null>(null);
  /** Which box the next one drawn fills. */
  const [stage, setStage] = useState<'mark' | 'target' | 'check'>('mark');
  /** The mark alone, with no title to box (a callout to a whole sheet). */
  const [alone, setAlone] = useState(false);
  const [name, setName] = useState('');
  const [forStandard, setForStandard] = useState(!!standard);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const step = TEACH_KINDS[kind];
  const result = useRef<HTMLDivElement>(null);
  const sheets = useMemo(() => Array.from({ length: pageCount }, (_, i) => sheetInfo[i] ?? null), [sheetInfo, pageCount]);
  const numbers = useMemo(() => sheets.map((s) => s?.number ?? null), [sheets]);
  // The standard is read afresh on every render; its hints only change when it does.
  const linkKey = JSON.stringify(givenLinks);
  const chainageKey = JSON.stringify(givenChainage);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const linkHints = useMemo(() => givenLinks, [linkKey]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const chainageHints = useMemo(() => givenChainage, [chainageKey]);

  // A new box fills the step waiting for it.
  useEffect(() => {
    if (!box) return;
    let live = true;
    setLoading(true);
    void readPage(box.pageIndex)
      .then((page) => {
        if (!live) return;
        const d = drawn(page, box.pageIndex, box.rect);
        setMessage(null);
        if (stage === 'mark') setMark(d);
        else {
          setTarget(d);
          setStage('check');
        }
      })
      .catch((err) => live && setMessage(err instanceof Error ? err.message : String(err)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
    // Only a new box starts a read; the stage it fills is the one current when it was drawn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [box]);

  const restart = (k: TeachKind = kind) => {
    setKind(k);
    setMark(null);
    setTarget(null);
    setAlone(false);
    setStage('mark');
    onArm();
  };

  const lesson: Lesson | null = useMemo(() => {
    if (!mark || (stage !== 'check' && !alone)) return null;
    if (kind === 'chainage') return target ? learnChainage(mark, target, sheets, chainageHints) : null;
    return learnLink(kind, mark, alone ? null : target, numbers, linkHints, name);
  }, [mark, target, stage, alone, kind, sheets, numbers, linkHints, chainageHints, name]);

  /** The sheet the boxed mark points to, when the set has it: a button goes there. */
  const pointsTo = useMemo(() => {
    if (!mark || kind === 'chainage') return null;
    const lookup = new SheetLookup(numbers, linkHints.calloutPart);
    for (const w of mark.contents.words) {
      const page = lookup.find(w.text, true);
      if (page !== null && page !== mark.pageIndex) return page;
    }
    return null;
  }, [mark, kind, numbers, linkHints]);

  // What the pair taught, and Keep, are brought into view as they appear.
  // (In braces: scrollIntoView returns a promise in newer browsers, and an effect may only return a clean-up.)
  useEffect(() => {
    void result.current?.scrollIntoView({ block: 'nearest' });
  }, [lesson]);

  const where = (i: number) => numbers[i] ?? `page ${i + 1}`;
  const keepsHints = !!lesson && (!!lesson.links || !!lesson.chainage);
  const canKeep = !!lesson && !lesson.problem && (lesson.marks.length > 0 || (keepsHints && !!standard && forStandard));

  return (
    <div ref={panel.ref} style={panel.style} className="label-regions teach-links resizable-panel" role="dialog" aria-label="Teach links">
      {panel.handles}
      <div className="lr-head rp-head" onPointerDown={panel.onMoveStart} title="Drag to move; drag an edge to resize">
        <b>Teach Links</b>
        <button className="btn small flat" onClick={onClose} title="Close" aria-label="Close">
          ×
        </button>
      </div>
      <div className="rp-body">
        <div className="tl-kinds" role="tablist" aria-label="What to teach">
          {KINDS.map((k) => (
            <button key={k} type="button" role="tab" aria-selected={k === kind} className={`btn small${k === kind ? ' active' : ''}`} onClick={() => restart(k)}>
              {TEACH_KINDS[k].label}
            </button>
          ))}
        </div>

        <p className={`tl-step${mark ? ' done' : ''}`}>1. {step.markPrompt}</p>
        {stage === 'mark' && (
          <button type="button" className="btn small" onClick={onArm}>
            {mark ? 'Box it again' : 'Draw box'}
          </button>
        )}
        {mark && (
          <>
            <p className="hint">On {where(mark.pageIndex)}:</p>
            <BoxPreview d={mark} onChange={setMark} compact={stage !== 'mark'} />
          </>
        )}
        {mark && stage === 'mark' && (
          <div className="lr-row">
            <button
              type="button"
              className="btn small primary"
              onClick={() => {
                setStage('target');
                onArm();
              }}
            >
              Next
            </button>
            {kind !== 'chainage' && (
              <button type="button" className="btn small" onClick={() => setAlone(true)} title="Keep the mark alone: it points to a whole sheet, not a drawing with a title">
                No title to box
              </button>
            )}
          </div>
        )}

        {mark && !alone && stage !== 'mark' && (
          <>
            <p className={`tl-step${target ? ' done' : ''}`}>2. {step.targetPrompt}</p>
            <div className="lr-row">
              {pointsTo !== null && (
                <button type="button" className="btn small" onClick={() => onGoTo(pointsTo)}>
                  Go to {where(pointsTo)}
                </button>
              )}
              <button type="button" className="btn small" onClick={onArm}>
                {target ? 'Box it again' : 'Draw box'}
              </button>
              <button
                type="button"
                className="btn small flat"
                onClick={() => {
                  setTarget(null);
                  setStage('mark');
                }}
              >
                Back
              </button>
            </div>
            {target && (
              <>
                <p className="hint">On {where(target.pageIndex)}:</p>
                <BoxPreview d={target} onChange={setTarget} />
              </>
            )}
          </>
        )}
        {loading && <p className="hint">Reading the box…</p>}
        {message && <p className="tl-problem">{message}</p>}

        {lesson && (
          <div ref={result}>
            {lesson.notes.length > 0 && (
              <ul className="tl-notes">
                {lesson.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            )}
            {lesson.problem && (
              <p className="tl-problem" role="alert">
                {lesson.problem}
              </p>
            )}
            {kind !== 'chainage' && (
              <label className="ds-field">
                Name
                <input className="lr-typed" value={name} placeholder={step.label.replace(/s$/, '')} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
              </label>
            )}
            {standard ? (
              <fieldset className="lr-row">
                <legend>Keep in</legend>
                <label>
                  <input type="radio" name="tl-scope" checked={forStandard} onChange={() => setForStandard(true)} />
                  {standard}
                </label>
                {kind !== 'chainage' && (
                  <label>
                    <input type="radio" name="tl-scope" checked={!forStandard} onChange={() => setForStandard(false)} />
                    Every set
                  </label>
                )}
              </fieldset>
            ) : (
              keepsHints && <p className="hint">Read this document with a drawing standard to keep what this pair teaches about the client's drawings; only the marks are kept for now.</p>
            )}
            <div className="lr-actions">
              <button
                type="button"
                className="btn small primary"
                disabled={!canKeep}
                onClick={() => {
                  onKeep(lesson, !!standard && (forStandard || kind === 'chainage'));
                  setMessage(null);
                  restart();
                }}
              >
                Keep
              </button>
            </div>
          </div>
        )}
        <p className="hint">Teach each kind once or twice; every mark like the ones kept is then found in this set and in sets read with the same standard, and listed in the Links tab.</p>
      </div>
    </div>
  );
}
