import { useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_LINK_HINTS, spotCheckSample, stepMeter, type PageText, type SheetInfo } from '@nb/sheets';
import type { DrawingStandard } from '../../sheets/standards';
import type { MarkPage } from '../../sheets/marks';
import type { TaughtBox } from '../../sheets/teachLinks';
import { boxSays, learnMatchLine, runMatchLineStep, taughtBox, type StepRun } from '../../sheets/wizardLinks';
import type { StepSheet } from './CalloutStep';
import type { PageRect, ShownBox } from './SheetView';
import { CheckCard, Gif, Meter, type Render } from './stepParts';

interface Props {
  standard: DrawingStandard;
  change: (f: (s: DrawingStandard) => DrawingStandard) => void;
  texts: readonly PageText[] | null;
  sheets: readonly (SheetInfo | null | undefined)[];
  pages: readonly { width: number; height: number }[];
  page: number;
  setPage: (page: number) => void;
  look: (page: number, rect: PageRect | null) => void;
  readPage: (pageIndex: number) => Promise<MarkPage>;
  render: Render;
  readOnly: boolean;
  setSheet: (s: StepSheet) => void;
  onChecks: (checks: ReadonlyMap<string, boolean>) => void;
  /** Stitches the document's plans along their match lines (the Stitching panel's own finder). */
  onStitch?: () => void;
  onBack: () => void;
  onNext: () => void;
}

type Phase = 'first' | 'second' | 'results';

const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * The match-lines step of the setup wizard: box a match-line label on one plan, then the
 * matching label on the sheet it names. redcolumn learns the words the client labels match lines
 * with, checks the pair agrees, finds every match line in the set, and shows a few to judge.
 */
export function MatchLineStep(p: Props) {
  // A standard that already has its own match-line words has been through this step: show what it finds.
  const [phase, setPhase] = useState<Phase>(() => (same(p.standard.links.matchLine, DEFAULT_LINK_HINTS.matchLine) ? 'first' : 'results'));
  const [first, setFirst] = useState<TaughtBox | null>(null);
  const [second, setSecond] = useState<TaughtBox | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [run, setRun] = useState<StepRun | null>(null);
  const [checks, setChecks] = useState<Map<string, boolean>>(new Map());
  const [stitched, setStitched] = useState(false);
  const numbers = useMemo(() => p.sheets.map((s) => s?.number ?? null), [p.sheets]);
  const hints = p.standard.links;
  const firstSays = first ? boxSays(first, numbers, hints) : null;
  const secondSays = second ? boxSays(second, numbers, hints) : null;

  const latestPage = useRef(p.page);
  latestPage.current = p.page;
  useEffect(() => {
    const want = !p.readOnly && (phase === 'first' || phase === 'second');
    const onBox = want
      ? (rect: PageRect) => {
          const at = latestPage.current;
          void p.readPage(at).then((page) => {
            const box = taughtBox(page, at, rect);
            setProblem(null);
            if (phase === 'first') setFirst(box);
            else setSecond(box);
          });
        }
      : null;
    const boxes: ShownBox[] = [];
    if (first && first.pageIndex === p.page) boxes.push({ key: 'first', ...first.box, label: 'match line', tone: phase === 'first' ? 'active' : 'done' });
    if (second && second.pageIndex === p.page) boxes.push({ key: 'second', ...second.box, label: 'matching label', tone: phase === 'second' ? 'active' : 'done' });
    p.setSheet({ onBox, boxes });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, first, second, p.page, p.readOnly]);
  useEffect(() => () => p.setSheet({ onBox: null, boxes: [] }), []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (phase !== 'results' || !p.texts) return;
    setRun(runMatchLineStep(p.texts, numbers, hints));
  }, [phase, p.texts, numbers, hints]);

  const learn = () => {
    if (!first || !second) return;
    const lesson = learnMatchLine(first, second, numbers, hints);
    if (lesson.problem) {
      setProblem(lesson.problem);
      return;
    }
    if (lesson.links) {
      const links = lesson.links;
      p.change((s) => ({ ...s, links: { ...s.links, matchLine: links.matchLine } }));
    }
    setNotes(lesson.notes);
    setChecks(new Map());
    setPhase('results');
  };

  const sample = useMemo(() => (run ? spotCheckSample(run.links) : []), [run]);
  const meter = run ? stepMeter({ links: run.links, references: run.places, linked: run.linked, checks }) : null;
  const gif = (part: 'first' | 'second') => `${window.location.origin}/help/gif/standards-matchline-${part}.gif`;

  if (phase === 'first' || phase === 'second') {
    const box = phase === 'first' ? first : second;
    const says = phase === 'first' ? firstSays : secondSays;
    return (
      <section className="sw-question">
        <p className="sw-progress">Match lines · {phase === 'first' ? 1 : 2} of 3</p>
        <h2>{phase === 'first' ? 'Box a match-line label' : 'Box the matching label'}</h2>
        <p>
          {phase === 'first'
            ? 'Find a match line on a plan (where the drawing continues on another sheet) and drag a box around its label: the words, and the drawing number it names.'
            : 'This is the sheet the label names. Find the same match line here and drag a box around its label.'}
        </p>
        <Gif src={gif(phase)} alt={`Where to draw the ${phase === 'first' ? 'match-line label' : 'matching label'} box on a sample drawing`} />
        {!box && <p className="sw-hint">Drag on the sheet to draw the box. Scroll to zoom; drag with the middle button to move around.</p>}
        {box && says && (
          <div className="sw-result">
            <p className="sw-read">
              Reads: <strong>{says.text || 'no text'}</strong>
            </p>
            <p className={`sw-verdict ${says.sheet !== null ? 'good' : 'some'}`}>
              {says.sheet !== null ? `Names ${numbers[says.sheet] ?? `sheet ${says.sheet + 1}`}.` : 'It names no drawing in this set: go to the adjoining sheet yourself.'}
            </p>
          </div>
        )}
        {problem && <p className="sw-warn">{problem}</p>}
        <p className="sw-hint">Once a few examples are set up, an AI assistant connected over MCP can use them to find the links that text search misses.</p>
        <div className="sw-nav">
          <button type="button" className="btn" onClick={phase === 'first' ? p.onBack : () => setPhase('first')}>
            Back
          </button>
          {box && !p.readOnly && (
            <button type="button" className="btn" onClick={() => (phase === 'first' ? setFirst(null) : setSecond(null))}>
              Re-draw box
            </button>
          )}
          {phase === 'first' && !first && (
            <button type="button" className="btn flat" onClick={p.onNext} title="Skip match lines: this set has none">
              This set has none
            </button>
          )}
          {phase === 'first' ? (
            <button
              type="button"
              className="btn primary"
              disabled={!first}
              onClick={() => {
                setPhase('second');
                if (firstSays?.sheet != null) p.setPage(firstSays.sheet);
              }}
            >
              Next
            </button>
          ) : (
            <button type="button" className="btn primary" disabled={!second || !p.texts} onClick={learn}>
              Find the rest
            </button>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="sw-question">
      <p className="sw-progress">Match lines · 3 of 3</p>
      <h2>Check the match lines found</h2>
      {notes.length > 0 && (
        <ul className="sw-notes">
          {notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      {!run && <p className="sw-hint">Looking through the set…</p>}
      {run && meter && (
        <>
          <Meter meter={meter} places={run.places} linked={run.linked} what="match line" />
          {sample.length > 0 && (
            <>
              <h3>Are these right?</h3>
              <p className="sw-hint">Click a picture to see it on the sheet. Your answers set the meter, and are kept on the links.</p>
              <ol className="sw-checks">
                {sample.map((l) => (
                  <CheckCard
                    key={l.id}
                    link={l}
                    sheets={p.sheets}
                    pages={p.pages}
                    render={p.render}
                    verdict={checks.get(l.id)}
                    onLook={p.look}
                    onVerdict={(ok) => {
                      const next = new Map(checks).set(l.id, ok);
                      setChecks(next);
                      p.onChecks(next);
                    }}
                  />
                ))}
              </ol>
            </>
          )}
          {meter.band === 'ai' && (
            <div className="sw-ai">
              <strong>Recommended: finish this step with AI.</strong> Text search finds too few of this set’s match lines, or too many are wrong. An AI assistant connected to redcolumn over MCP can read the sheets and use the labels you boxed to find the rest.
            </div>
          )}
          {p.onStitch && run.links.length > 0 && (
            <div className="sw-row">
              <button
                type="button"
                className="btn"
                disabled={p.readOnly || stitched}
                onClick={() => {
                  setStitched(true);
                  p.onStitch?.();
                }}
              >
                {stitched ? 'Stitching the plans…' : 'Use these to stitch the plans'}
              </button>
            </div>
          )}
        </>
      )}
      <div className="sw-nav">
        <button type="button" className="btn" onClick={p.onBack}>
          Back
        </button>
        <button
          type="button"
          className="btn"
          disabled={p.readOnly}
          onClick={() => {
            setFirst(null);
            setSecond(null);
            setPhase('first');
          }}
        >
          Teach another example
        </button>
        <button type="button" className="btn primary" onClick={p.onNext}>
          Next
        </button>
      </div>
    </section>
  );
}
