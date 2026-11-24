import { msg, msgParts } from '@nb/i18n';
import { lazy } from '../../i18n/lazy';
import { keyed } from '../../i18n/keyed';
import { useEffect, useMemo, useRef, useState } from 'react';
import { spotCheckSample, stepMeter, type PageText, type SheetInfo } from '@nb/sheets';
import type { PreviewDrawing, PreviewView } from '../LinkPreview';
import type { DrawingStandard } from '../../sheets/standards';
import type { MarkPage } from '../../sheets/marks';
import { learnLink, type TaughtBox } from '../../sheets/teachLinks';
import { boxExample, boxSays, runCalloutStep, taughtBox, type CalloutKind, type StepRun } from '../../sheets/wizardLinks';
import { withExamples, type SetupStep } from '../../sheets/standards';
import { aiPrompt } from '../../sheets/standardsWizard';
import type { PageRect, ShownBox } from './SheetView';
import { AskAi, CheckCard, Gif, Meter, useStepResult } from './stepParts';

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
  /** The drawing's file name, for the prompt an AI assistant is given. */
  fileName: string;
}

const WORDS = lazy((): Record<CalloutKind, { many: string; one: string; mark: string; title: string; markHow: string; titleHow: string }> => ({
  section: {
    many: msg('Sections'),
    one: 'section',
    mark: 'section mark',
    title: 'section title',
    markHow: msg('Find a section mark on a plan, where a section is cut, and drag a box around its bubble: the letter and the sheet number it points to.'),
    titleHow: msg('This is the sheet the mark points to. Find that section’s title and drag a box around its bubble and title (SECTION A-A).'),
  },
  elevation: {
    many: msg('Elevations'),
    one: 'elevation',
    mark: 'elevation mark',
    title: 'elevation title',
    markHow: msg('Find an elevation mark (the bubble with an arrow pointing at what is seen) and drag a box around it, with its label and sheet number.'),
    titleHow: msg('This is the sheet the mark points to. Find that elevation’s title and drag a box around its bubble and title.'),
  },
  detail: {
    many: msg('Details'),
    one: 'detail',
    mark: 'detail callout',
    title: 'detail title',
    markHow: msg('Find a detail callout and drag a box around its bubble: the detail number and the sheet number it points to.'),
    titleHow: msg('This is the sheet the callout points to. Find that detail’s title and drag a box around its bubble and title.'),
  },
}));

type Phase = 'mark' | 'title' | 'results';

const STEP: Record<CalloutKind, SetupStep> = { section: 'sections', elevation: 'elevations', detail: 'details' };

/**
 * A link step of the setup wizard (sections, elevations, details): box one callout, then the title
 * it points to; redcolumn learns from the pair, finds the rest across the set, and shows a few for
 * the person to judge. The meter says whether the links can be kept, want a look, or are better
 * left to an AI assistant over MCP.
 */
export function CalloutStep(p: Props) {
  const w = WORDS()[p.kind];
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
    p.change((s) => withExamples({ ...s, links: lesson.links ?? s.links, marks: [...s.marks, ...lesson.marks] }, STEP[p.kind], [boxExample(STEP[p.kind], 'mark', mark, p.sheets), boxExample(STEP[p.kind], 'title', title, p.sheets)]));
    setNotes(lesson.notes);
    setChecks(new Map());
    setPhase('results');
  };

  const sample = useMemo(() => (run ? spotCheckSample(run.links) : []), [run]);
  const noText = useMemo(() => p.texts?.filter((t) => t.words.length === 0).length ?? 0, [p.texts]);
  const meter = run ? stepMeter({ links: run.links, references: run.places, linked: run.linked, checks, unreadable: run.unreadable, pagesWithoutText: noText, pages: p.texts?.length ?? 0 }) : null;
  useStepResult(STEP[p.kind], run, meter, p.change, p.readOnly);
  const gif = (part: 'mark' | 'title') => `${window.location.origin}/help/gif/standards-${p.kind}-${part}.gif`;

  if (phase === 'mark' || phase === 'title') {
    const box = phase === 'mark' ? mark : title;
    const says = phase === 'mark' ? markSays : titleSays;
    return (
      <section className="sw-question">
        <p className="sw-progress">
          {msg('{many} · {value} of 3', { many: w.many, value: phase === 'mark' ? 1 : 2 })}
        </p>
        <h2>{phase === 'mark' ? msg('Box a {mark}', { mark: w.mark }) : msg('Box its {title}', { title: w.title })}</h2>
        <p>{phase === 'mark' ? w.markHow : w.titleHow}</p>
        <Gif src={gif(phase)} alt={msg('Where to draw the {value} box on a sample drawing', { value: phase === 'mark' ? w.mark : w.title })} />
        {!box && <p className="sw-hint">{msg('Drag on the sheet to draw the box. Scroll to zoom; drag with the middle button to move around.')}</p>}
        {box && says && (
          <div className="sw-result">
            <p className="sw-read">
              {keyed(msgParts('Reads: {strong}', { strong: <strong>{says.text || msg('no text')}</strong> }))}
            </p>
            {phase === 'mark' && (
              <p className={`sw-verdict ${says.id && says.sheet !== null ? 'good' : 'some'}`}>
                {says.id ? `${w.one[0]!.toUpperCase() + w.one.slice(1)} ${says.id}` : msg('No identifier read')}
                {says.sheet !== null ? msg(', on {sheet}.', { sheet: numbers[says.sheet] ?? msg('sheet {number}', { number: says.sheet + 1 }) }) : '. ' + msg('It names no sheet in this set: go to the sheet it points to yourself.')}
              </p>
            )}
            {phase === 'title' && markSays?.id && says.id && markSays.id !== says.id && <p className="sw-warn">{msg('The mark says {id} but this title says {id2}.', { id: markSays.id, id2: says.id })}</p>}
          </div>
        )}
        {problem && <p className="sw-warn">{problem}</p>}
        <p className="sw-hint">{msg('Once a few examples are set up, an AI assistant connected over MCP can use them to find the links that text and shape search miss.')}</p>
        <div className="sw-nav">
          <button type="button" className="btn" onClick={phase === 'mark' ? p.onBack : () => setPhase('mark')}>
            {msg('Back')}
          </button>
          {box && !p.readOnly && (
            <button type="button" className="btn" onClick={() => (phase === 'mark' ? setMark(null) : setTitle(null))}>
              {msg('Re-draw box')}
            </button>
          )}
          {phase === 'mark' && !mark && (
            <button type="button" className="btn flat" onClick={p.onNext} title={msg('Skip {many}: this set has none', { many: w.many.toLowerCase() })}>
              {msg('This set has none')}
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
              {msg('Next')}
            </button>
          ) : (
            <button type="button" className="btn primary" disabled={!title || !p.texts} onClick={learn}>
              {msg('Find the rest')}
            </button>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="sw-question">
      <p className="sw-progress">{msg('{many} · 3 of 3', { many: w.many })}</p>
      <h2>{msg('Check the {many} found', { many: w.many.toLowerCase() })}</h2>
      {notes.length > 0 && (
        <ul className="sw-notes">
          {notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      {(running || !run) && <p className="sw-hint">{msg('Looking through the set…')}</p>}
      {run && meter && (
        <>
          <Meter meter={meter} places={run.places} linked={run.linked} what={w.many.toLowerCase()} />
          {run.unreadableAt && run.unreadableAt.length > 0 && (
            <>
              <h3>{msg('Found, but not read')}</h3>
              <p className="sw-hint">{msg('These look like {many} by their shape, but there is no text in them to read (outlined lettering, or a scanned sheet). An AI assistant can read them from the picture; click one to see it.', { many: w.many.toLowerCase() })}</p>
              <ul className="sw-ambiguous">
                {run.unreadableAt.slice(0, 12).map((u, i) => (
                  <li key={`${u.pageIndex}:${Math.round(u.rect.x)}:${Math.round(u.rect.y)}`}>
                    <button type="button" onClick={() => p.look(u.pageIndex, u.rect)}>
                      {msg('{number}. on {page}', { number: i + 1, page: p.sheets[u.pageIndex]?.number ?? msg('sheet {number}', { number: u.pageIndex + 1 }) })}
                    </button>
                  </li>
                ))}
                {run.unreadableAt.length > 12 && <li>{msg('and {count} more', { count: run.unreadableAt.length - 12 })}</li>}
              </ul>
            </>
          )}
          {sample.length > 0 && (
            <>
              <h3>{msg('Are these right?')}</h3>
              <p className="sw-hint">{msg('Click a picture to see it on the sheet. Your answers set the meter, and are kept on the links.')}</p>
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
              {keyed(msgParts('{strong} Text and shape search find too few of this set’s {many}, or too many are wrong. An AI assistant connected to redcolumn over MCP can read the sheets and use the examples you gave to find the rest. You can still keep what was found here.{askai}', { strong: <strong>{msg('Recommended: finish this step with AI.')}</strong>, many: w.many.toLowerCase(), askai: <AskAi prompt={aiPrompt(p.standard, p.fileName, [STEP[p.kind]])} /> }))}
            </div>
          )}
          {meter.band !== 'ai' && run.unreadable > 0 && <AskAi prompt={aiPrompt(p.standard, p.fileName, [STEP[p.kind]])} label={msg('Ask AI to read these')} />}
        </>
      )}
      <div className="sw-nav">
        <button type="button" className="btn" onClick={p.onBack}>
          {msg('Back')}
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
          {msg('Teach another example')}
        </button>
        <button type="button" className="btn primary" onClick={p.onNext}>
          {msg('Next')}
        </button>
      </div>
    </section>
  );
}
