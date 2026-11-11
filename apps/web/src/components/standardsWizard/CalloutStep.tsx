import { useEffect, useMemo, useRef, useState } from 'react';
import { spotCheckSample, stepMeter, type PageText, type SheetInfo } from '@nb/sheets';
import type { PreviewDrawing, PreviewView } from '../LinkPreview';
import type { DrawingStandard } from '../../sheets/standards';
import type { MarkPage } from '../../sheets/marks';
import { learnLink, type TaughtBox } from '../../sheets/teachLinks';
import { boxSays, runCalloutStep, taughtBox, type CalloutKind, type StepRun } from '../../sheets/wizardLinks';
import type { PageRect, ShownBox } from './SheetView';
import { CheckCard, Gif, Meter } from './stepParts';

/** The wizard's hold on the sheet while this step draws on it. */
export interface StepSheet {
  /** Dragging on the sheet draws a box for the step (null: not drawing). */
  onBox: ((rect: PageRect) => void) | null;
  boxes: ShownBox[];
}

interface Props {
  kind: CalloutKind;
  standard: DrawingStandard;
  change: (f: (s: DrawingStandard) => DrawingStandard) => void;
  texts: readonly PageText[] | null;
  sheets: readonly (SheetInfo | null | undefined)[];
  pages: readonly { width: number; height: number }[];
  page: number;
  setPage: (page: number) => void;
  /** Shows a part of a page on the sheet. */
  look: (page: number, rect: PageRect | null) => void;
  readPage: (pageIndex: number) => Promise<MarkPage>;
  render: (pageIndex: number, width: number, height: number, view: PreviewView) => Promise<PreviewDrawing | null>;
  readOnly: boolean;
  setSheet: (s: StepSheet) => void;
  /** The person's answers on the sample links (by link id), kept on the links when the document is read with the standard. */
  onChecks: (checks: ReadonlyMap<string, boolean>) => void;
  onBack: () => void;
  onNext: () => void;
}

const WORDS: Record<CalloutKind, { many: string; one: string; mark: string; title: string; markHow: string; titleHow: string }> = {
  section: {
    many: 'Sections',
    one: 'section',
    mark: 'section mark',
    title: 'section title',
    markHow: 'Find a section mark on a plan, where a section is cut, and drag a box around its bubble: the letter and the sheet number it points to.',
    titleHow: 'This is the sheet the mark points to. Find that section’s title and drag a box around its bubble and title (SECTION A-A).',
  },
  elevation: {
    many: 'Elevations',
    one: 'elevation',
    mark: 'elevation mark',
    title: 'elevation title',
    markHow: 'Find an elevation mark (the bubble with an arrow pointing at what is seen) and drag a box around it, with its label and sheet number.',
    titleHow: 'This is the sheet the mark points to. Find that elevation’s title and drag a box around its bubble and title.',
  },
  detail: {
    many: 'Details',
    one: 'detail',
    mark: 'detail callout',
    title: 'detail title',
    markHow: 'Find a detail callout and drag a box around its bubble: the detail number and the sheet number it points to.',
    titleHow: 'This is the sheet the callout points to. Find that detail’s title and drag a box around its bubble and title.',
  },
};

type Phase = 'mark' | 'title' | 'results';

/**
 * A link step of the setup wizard (sections, elevations, details): box one callout, then the title
 * it points to; redcolumn learns from the pair, finds the rest across the set, and shows a few for
 * the person to judge. The meter says whether the links can be kept, want a look, or are better
 * left to an AI assistant over MCP.
 */
export function CalloutStep(p: Props) {
  const w = WORDS[p.kind];
  const [phase, setPhase] = useState<Phase>(() => (p.standard.marks.some((m) => m.kind.startsWith(p.kind)) ? 'results' : 'mark'));
  const [mark, setMark] = useState<TaughtBox | null>(null);
  const [title, setTitle] = useState<TaughtBox | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [run, setRun] = useState<StepRun | null>(null);
  const [running, setRunning] = useState(false);
  const [checks, setChecks] = useState<Map<string, boolean>>(new Map());
  const numbers = useMemo(() => p.sheets.map((s) => s?.number ?? null), [p.sheets]);
  const hints = p.standard.links;

  const markSays = mark ? boxSays(mark, numbers, hints) : null;
  const titleSays = title ? boxSays(title, numbers, hints) : null;

  // The sheet: drawing while a box is wanted, the examples shown on their pages.
  const latestPage = useRef(p.page);
  latestPage.current = p.page;
  useEffect(() => {
    const want = !p.readOnly && (phase === 'mark' || phase === 'title');
    const onBox = want
      ? (rect: PageRect) => {
          const at = latestPage.current;
          void p.readPage(at).then((page) => {
            const box = taughtBox(page, at, rect);
            setProblem(null);
            if (phase === 'mark') setMark(box);
            else setTitle(box);
          });
        }
      : null;
    const boxes: ShownBox[] = [];
    if (mark && mark.pageIndex === p.page) boxes.push({ key: 'mark', ...mark.box, label: w.mark, tone: phase === 'mark' ? 'active' : 'done' });
    if (title && title.pageIndex === p.page) boxes.push({ key: 'title', ...title.box, label: w.title, tone: phase === 'title' ? 'active' : 'done' });
    p.setSheet({ onBox, boxes });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, mark, title, p.page, p.readOnly]);
  useEffect(() => () => p.setSheet({ onBox: null, boxes: [] }), []); // eslint-disable-line react-hooks/exhaustive-deps

  // Find the rest once there is something to find with (and again after each example).
  const runId = useRef(0);
  useEffect(() => {
    if (phase !== 'results' || !p.texts) return;
    const id = ++runId.current;
    setRunning(true);
    void runCalloutStep(p.kind, p.texts, numbers, hints, p.standard.marks, p.readPage)
      .then((r) => {
        if (id === runId.current) setRun(r);
      })
      .finally(() => id === runId.current && setRunning(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, p.texts, numbers, hints, p.standard.marks, p.kind]);

  const learn = () => {
    if (!mark || !title) return;
    const lesson = learnLink(p.kind, mark, title, numbers, hints, w.one[0]!.toUpperCase() + w.one.slice(1));
    if (lesson.problem) {
      setProblem(lesson.problem);
      return;
    }
    p.change((s) => ({ ...s, links: lesson.links ?? s.links, marks: [...s.marks, ...lesson.marks] }));
    setNotes(lesson.notes);
    setChecks(new Map());
    setPhase('results');
  };

  const sample = useMemo(() => (run ? spotCheckSample(run.links) : []), [run]);
  const noText = useMemo(() => p.texts?.filter((t) => t.words.length === 0).length ?? 0, [p.texts]);
  const meter = run ? stepMeter({ links: run.links, references: run.places, linked: run.linked, checks, unreadable: run.unreadable, pagesWithoutText: noText, pages: p.texts?.length ?? 0 }) : null;
  const gif = (part: 'mark' | 'title') => `${window.location.origin}/help/gif/standards-${p.kind}-${part}.gif`;

  if (phase === 'mark' || phase === 'title') {
    const box = phase === 'mark' ? mark : title;
    const says = phase === 'mark' ? markSays : titleSays;
    return (
      <section className="sw-question">
        <p className="sw-progress">
          {w.many} · {phase === 'mark' ? 1 : 2} of 3
        </p>
        <h2>{phase === 'mark' ? `Box a ${w.mark}` : `Box its ${w.title}`}</h2>
        <p>{phase === 'mark' ? w.markHow : w.titleHow}</p>
        <Gif src={gif(phase)} alt={`Where to draw the ${phase === 'mark' ? w.mark : w.title} box on a sample drawing`} />
        {!box && <p className="sw-hint">Drag on the sheet to draw the box. Scroll to zoom; drag with the middle button to move around.</p>}
        {box && says && (
          <div className="sw-result">
            <p className="sw-read">
              Reads: <strong>{says.text || 'no text'}</strong>
            </p>
            {phase === 'mark' && (
              <p className={`sw-verdict ${says.id && says.sheet !== null ? 'good' : 'some'}`}>
                {says.id ? `${w.one[0]!.toUpperCase() + w.one.slice(1)} ${says.id}` : 'No identifier read'}
                {says.sheet !== null ? `, on ${numbers[says.sheet] ?? `sheet ${says.sheet + 1}`}.` : '. It names no sheet in this set: go to the sheet it points to yourself.'}
              </p>
            )}
            {phase === 'title' && markSays?.id && says.id && markSays.id !== says.id && <p className="sw-warn">The mark says {markSays.id} but this title says {says.id}.</p>}
          </div>
        )}
        {problem && <p className="sw-warn">{problem}</p>}
        <p className="sw-hint">Once a few examples are set up, an AI assistant connected over MCP can use them to find the links that text and shape search miss.</p>
        <div className="sw-nav">
          <button type="button" className="btn" onClick={phase === 'mark' ? p.onBack : () => setPhase('mark')}>
            Back
          </button>
          {box && !p.readOnly && (
            <button type="button" className="btn" onClick={() => (phase === 'mark' ? setMark(null) : setTitle(null))}>
              Re-draw box
            </button>
          )}
          {phase === 'mark' && !mark && (
            <button type="button" className="btn flat" onClick={p.onNext} title={`Skip ${w.many.toLowerCase()}: this set has none`}>
              This set has none
            </button>
          )}
          {phase === 'mark' ? (
            <button
              type="button"
              className="btn primary"
              disabled={!mark}
              onClick={() => {
                setPhase('title');
                if (markSays?.sheet != null) p.setPage(markSays.sheet);
              }}
            >
              Next
            </button>
          ) : (
            <button type="button" className="btn primary" disabled={!title || !p.texts} onClick={learn}>
              Find the rest
            </button>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="sw-question">
      <p className="sw-progress">{w.many} · 3 of 3</p>
      <h2>Check the {w.many.toLowerCase()} found</h2>
      {notes.length > 0 && (
        <ul className="sw-notes">
          {notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      {(running || !run) && <p className="sw-hint">Looking through the set…</p>}
      {run && meter && (
        <>
          <Meter meter={meter} places={run.places} linked={run.linked} what={w.many.toLowerCase()} />
          {run.unreadableAt && run.unreadableAt.length > 0 && (
            <>
              <h3>Found, but not read</h3>
              <p className="sw-hint">These look like {w.many.toLowerCase()} by their shape, but there is no text in them to read (outlined lettering, or a scanned sheet). An AI assistant can read them from the picture; click one to see it.</p>
              <ul className="sw-ambiguous">
                {run.unreadableAt.slice(0, 12).map((u, i) => (
                  <li key={`${u.pageIndex}:${Math.round(u.rect.x)}:${Math.round(u.rect.y)}`}>
                    <button type="button" onClick={() => p.look(u.pageIndex, u.rect)}>
                      {i + 1}. on {p.sheets[u.pageIndex]?.number ?? `sheet ${u.pageIndex + 1}`}
                    </button>
                  </li>
                ))}
                {run.unreadableAt.length > 12 && <li>and {run.unreadableAt.length - 12} more</li>}
              </ul>
            </>
          )}
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
              <strong>Recommended: finish this step with AI.</strong> Text and shape search find too few of this set’s {w.many.toLowerCase()}, or too many are wrong. An AI assistant connected to redcolumn over MCP can read the sheets and use the examples you gave to find the rest. You can still keep what was found here.
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
            setMark(null);
            setTitle(null);
            setPhase('mark');
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
