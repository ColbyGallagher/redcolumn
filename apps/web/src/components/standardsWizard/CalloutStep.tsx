import { useEffect, useMemo, useRef, useState } from 'react';
import { spotCheckSample, stepMeter, type DetectedLink, type PageText, type SheetInfo } from '@nb/sheets';
import type { PreviewDrawing, PreviewView } from '../LinkPreview';
import type { DrawingStandard } from '../../sheets/standards';
import type { MarkPage } from '../../sheets/marks';
import { learnLink, type TaughtBox } from '../../sheets/teachLinks';
import { boxSays, runCalloutStep, taughtBox, type CalloutKind, type StepRun } from '../../sheets/wizardLinks';
import type { PageRect, ShownBox } from './SheetView';

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
  const meter = run ? stepMeter({ links: run.links, references: run.places, linked: run.linked, checks }) : null;
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

function Meter({ meter, places, linked, what }: { meter: ReturnType<typeof stepMeter>; places: number; linked: number; what: string }) {
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const says = { good: 'Good: these links can be kept as they are.', review: 'Usable: keep them, and look over the ones marked for review.', ai: 'Poor: recommend AI for this step.' }[meter.band];
  return (
    <div className={`sw-meter ${meter.band}`}>
      <div className="sw-meter-bar" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(meter.score * 100)} aria-label="How well this step is done">
        <span style={{ width: pct(meter.score) }} />
      </div>
      <p>
        <strong>{says}</strong>
      </p>
      <p>
        {linked} of {places} {what} references linked ({pct(meter.coverage)}); about {pct(meter.accuracy)} of the links right
        {meter.atLeast !== null ? `, at least ${pct(meter.atLeast)} going by your ${meter.checked} checks` : ' going by how they were found'}.
      </p>
      {meter.warnings.length > 0 && (
        <ul className="sw-notes">
          {meter.warnings.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CheckCard({
  link,
  sheets,
  pages,
  render,
  verdict,
  onLook,
  onVerdict,
}: {
  link: DetectedLink;
  sheets: Props['sheets'];
  pages: Props['pages'];
  render: Props['render'];
  verdict: boolean | undefined;
  onLook: Props['look'];
  onVerdict: (ok: boolean) => void;
}) {
  const name = (i: number) => sheets[i]?.number ?? `Sheet ${i + 1}`;
  return (
    <li className={`sw-check${verdict === true ? ' right' : verdict === false ? ' wrong' : ''}`}>
      <div className="sw-check-pair">
        <button type="button" className="sw-crop-btn" onClick={() => onLook(link.pageIndex, link.rect)} title={`Show on ${name(link.pageIndex)}`}>
          <Crop render={render} pageIndex={link.pageIndex} rect={link.rect} size={pages[link.pageIndex]} />
          <span>{name(link.pageIndex)}</span>
        </button>
        <span className="sw-check-arrow" aria-hidden="true">
          →
        </span>
        <button type="button" className="sw-crop-btn" onClick={() => onLook(link.targetPage, link.targetRect)} title={`Show on ${name(link.targetPage)}`}>
          <Crop render={render} pageIndex={link.targetPage} rect={link.targetRect} size={pages[link.targetPage]} />
          <span>{name(link.targetPage)}</span>
        </button>
      </div>
      <div className="sw-check-row">
        <span className="sw-check-label">
          {link.label} · {Math.round(link.confidence * 100)}%
        </span>
        <button type="button" className={`btn small${verdict === true ? ' primary' : ''}`} aria-pressed={verdict === true} onClick={() => onVerdict(true)}>
          Right
        </button>
        <button type="button" className={`btn small${verdict === false ? ' danger' : ''}`} aria-pressed={verdict === false} onClick={() => onVerdict(false)}>
          Wrong
        </button>
      </div>
    </li>
  );
}

const CROP_W = 112;
const CROP_H = 80;

/** Part of a page, small: a link's callout or its target (the whole sheet when it has no target area). */
function Crop({ render, pageIndex, rect, size }: { render: Props['render']; pageIndex: number; rect: PageRect | null; size: { width: number; height: number } | undefined }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let cancelled = false;
    const view = (r: PageRect): PreviewView => {
      const pad = Math.max(r.w, r.h) * 0.6;
      return { cx: r.x + r.w / 2, cy: r.y + r.h / 2, zoom: Math.min(CROP_W / (r.w + pad * 2), CROP_H / (r.h + pad * 2)) };
    };
    const go = async () => {
      // With no target area, the whole sheet.
      const whole = size ? { cx: size.width / 2, cy: size.height / 2, zoom: Math.min(CROP_W / size.width, CROP_H / size.height) } : null;
      const v0 = rect ? view(rect) : whole;
      if (!v0) return;
      const d = await render(pageIndex, CROP_W, CROP_H, v0);
      const el = host.current;
      if (cancelled || !d || !el) return;
      const v = d.view;
      d.canvas.className = 'sw-crop-canvas';
      d.canvas.style.left = `${(d.x0 - (v.cx - CROP_W / 2 / v.zoom)) * v.zoom}px`;
      d.canvas.style.top = `${(d.y0 - (v.cy - CROP_H / 2 / v.zoom)) * v.zoom}px`;
      el.replaceChildren(el.ownerDocument.adoptNode(d.canvas));
    };
    void go();
    return () => {
      cancelled = true;
    };
  }, [render, pageIndex, rect, size]);
  return <div ref={host} className="sw-crop" style={{ width: CROP_W, height: CROP_H }} />;
}

/** A short clip of where to draw, from the sample set; nothing when the clip is not there. */
function Gif({ src, alt }: { src: string; alt: string }) {
  const [ok, setOk] = useState(true);
  if (!ok) return null;
  return <img className="sw-gif" src={src} alt={alt} onError={() => setOk(false)} />;
}
