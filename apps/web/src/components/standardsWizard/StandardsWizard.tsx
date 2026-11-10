import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { boxFromRegion, regionOfBox, templateRegex, type PageText, type SheetInfo, type TitleBox } from '@nb/sheets';
import type { PreviewDrawing, PreviewView } from '../LinkPreview';
import { PageNav } from '../PageNav';
import { newStandard, withDefaults, type DrawingStandard } from '../../sheets/standards';
import {
  TITLE_EXTRAS,
  TITLE_QUESTIONS,
  WIZARD_STEPS,
  boxFor,
  checkBox,
  checkVerdict,
  customNameProblem,
  disciplineCandidates,
  loadPlace,
  loadSplit,
  numbersRead,
  savePlace,
  saveSplit,
  startPage,
  templateFor,
  withAnswer,
  type WizardStepId,
} from '../../sheets/standardsWizard';
import { SheetView, type PageRect, type SheetViewApi, type ShownBox } from './SheetView';
import { ThumbStrip } from './ThumbStrip';
import { CalloutStep, type StepSheet } from './CalloutStep';
import { MatchLineStep } from './MatchLineStep';
import { ChainageStep } from './ChainageStep';
import type { MarkPage } from '../../sheets/marks';
import type { CalloutKind } from '../../sheets/wizardLinks';

interface Props {
  fileName: string;
  pages: readonly { width: number; height: number }[];
  /** Every page's text; null while it is being read. */
  texts: readonly PageText[] | null;
  sheets: readonly (SheetInfo | null | undefined)[];
  render: (pageIndex: number, width: number, height: number, view: PreviewView) => Promise<PreviewDrawing | null>;
  standards: readonly DrawingStandard[];
  /** The standard the document is read with, if any: the wizard opens on it. */
  current: string | null;
  readOnly: boolean;
  /** A page's text and line work, for the link steps' examples and shape search. */
  readPage: (pageIndex: number) => Promise<MarkPage>;
  onSave: (standard: DrawingStandard) => void;
  /** Reads the document with the standard, then keeps the person's answers on the links they checked. */
  onUse: (id: string, checks: ReadonlyMap<string, boolean>) => void;
  /** Stitches the document's plans along their match lines. */
  onStitch?: () => void;
  /** Opens Teach Sheet Links in the app, for the steps the wizard does not do yet. */
  onTeachLinks: () => void;
  /** Opens the Drawing Standards panel (every setting, import and export). */
  onPanel: () => void;
  onClose: () => void;
}

const QUESTIONS = TITLE_QUESTIONS.length;
const LAST_TITLE = QUESTIONS + TITLE_EXTRAS.length - 1;
const FIELD_NAME: Record<TitleBox['field'], string> = { number: 'Number', title: 'Title', revision: 'Rev', scale: 'Scale', sheetSize: 'Size', custom: '', ignore: 'Ignore' };

/**
 * The drawing standards setup wizard: instructions and what has been read on the left (a third of
 * the window unless dragged), the sheet on the right. It asks one thing at a time, checks each
 * answer across the set, and saves as it goes, so closing it and coming back carries on.
 */
export function StandardsWizard(props: Props) {
  const { pages, texts, sheets, standards, current, readOnly, onSave } = props;
  const [standard, setStandard] = useState<DrawingStandard | null>(() => {
    const s = standards.find((x) => x.id === current);
    return s ? withDefaults(s) : null;
  });
  const [step, setStep] = useState<WizardStepId>('titleBlock');
  const [question, setQuestion] = useState(0);
  const [page, setPage] = useState(() => Math.min(startPage(sheets), Math.max(0, pages.length - 1)));
  const [split, setSplit] = useState(loadSplit);
  const [customName, setCustomName] = useState('');
  const [drawingCustom, setDrawingCustom] = useState(false);
  const sheetView = useRef<SheetViewApi>(null);
  /** What a link step does with the sheet, and the person's answers on its sample links. */
  const [stepSheet, setStepSheet] = useState<StepSheet>({ onBox: null, boxes: [] });
  const [checks, setChecks] = useState<Map<string, boolean>>(new Map());
  /** A part of a page to show (a sample link's callout or target). */
  const [look, setLook] = useState<{ rect: PageRect | null; n: number } | null>(null);
  const [zoom, setZoom] = useState(1);

  // Carry on where this standard was left.
  const started = useRef<string | null>(null);
  useEffect(() => {
    if (!standard || started.current === standard.id) return;
    started.current = standard.id;
    const place = loadPlace(standard.id);
    if (place) {
      setStep(place.step);
      setQuestion(Math.min(place.question, LAST_TITLE));
    }
  }, [standard]);
  useEffect(() => {
    if (standard) savePlace(standard.id, { step, question });
  }, [standard, step, question]);

  /** Changes the standard and saves it to the profile straight away. */
  const latest = useRef(standard);
  latest.current = standard;
  const change = useCallback(
    (f: (s: DrawingStandard) => DrawingStandard) => {
      const s = latest.current;
      if (!s) return;
      const next = { ...f(s), updatedAt: Date.now() };
      latest.current = next;
      setStandard(next);
      onSave(next);
    },
    [onSave],
  );

  const boxes = standard?.sheets.boxes ?? [];
  const size = pages[page] ?? { width: 1, height: 1 };
  const q = step === 'titleBlock' && question < QUESTIONS ? TITLE_QUESTIONS[question]! : null;
  const extra = step === 'titleBlock' && question >= QUESTIONS ? TITLE_EXTRAS[question - QUESTIONS]!.id : null;
  const answer = q ? boxFor(boxes, q) : undefined;
  const numberBox = boxes.find((b) => b.field === 'number');

  const check = useMemo(() => (texts && answer ? checkBox(texts, answer, page, answer.field === 'number' ? (standard?.sheets.template ?? null) : null) : null), [texts, answer, page, standard?.sheets.template]);
  // Sheets the box being answered reads nothing on, marked in the thumbnails.
  const flagged = useMemo(() => new Set(check?.empty ?? []), [check]);
  const nameProblem = customNameProblem(customName, boxes);
  const numbers = useMemo(() => (texts && numberBox ? numbersRead(texts, numberBox) : []), [texts, numberBox]);

  const callout: CalloutKind | null = step === 'sections' ? 'section' : step === 'elevations' ? 'elevation' : step === 'details' ? 'detail' : null;
  const stepOwnsSheet = !!callout || step === 'matchLines' || step === 'chainage';
  const drawing = stepOwnsSheet ? !!stepSheet.onBox : !readOnly && ((!!q && step === 'titleBlock') || extra === 'ignore' || (extra === 'ownFields' && drawingCustom));
  const onBox = (rect: PageRect) => {
    if (stepOwnsSheet) return stepSheet.onBox?.(rect);
    if (q) change((s) => ({ ...s, sheets: { ...s.sheets, boxes: withAnswer(s.sheets.boxes, q, boxFromRegion(rect, size, q.field, q.name)) } }));
    else if (extra === 'ignore') change((s) => ({ ...s, sheets: { ...s.sheets, boxes: [...s.sheets.boxes, boxFromRegion(rect, size, 'ignore')] } }));
    else if (extra === 'ownFields' && customName.trim() && !customNameProblem(customName, latest.current?.sheets.boxes ?? [])) {
      const name = customName.trim();
      change((s) => ({ ...s, sheets: { ...s.sheets, boxes: withAnswer(s.sheets.boxes, { field: 'custom', name }, boxFromRegion(rect, size, 'custom', name)) } }));
      setCustomName('');
      setDrawingCustom(false);
    }
  };

  const titleBoxes: ShownBox[] = boxes.map((b, i) => {
    const r = regionOfBox(b, size);
    const active = !!answer && b === answer;
    return { key: `${i}:${b.field}:${b.name ?? ''}`, ...r, label: b.field === 'custom' ? (b.name ?? '') : FIELD_NAME[b.field], tone: b.field === 'ignore' ? 'ignore' : active ? 'active' : 'done' };
  });
  // Once the number is boxed, later title-block questions show the title block, not the whole sheet.
  const focus = useMemo(() => {
    if (step !== 'titleBlock' || !boxes.length || !numberBox || q?.field === 'number') return null;
    const rs = boxes.filter((b) => b.field !== 'ignore').map((b) => regionOfBox(b, size));
    const x = Math.min(...rs.map((r) => r.x));
    const y = Math.min(...rs.map((r) => r.y));
    const pad = Math.max(size.width, size.height) * 0.06;
    const x1 = Math.max(...rs.map((r) => r.x + r.w));
    const y1 = Math.max(...rs.map((r) => r.y + r.h));
    return { x: x - pad, y: y - pad, w: x1 - x + pad * 2, h: y1 - y + pad * 2 };
    // Fitted when the step changes or the number box first appears, not on every box.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, !!numberBox, q?.field === 'number', size]);
  const shown = stepOwnsSheet ? stepSheet.boxes : titleBoxes;
  const shownFocus = look ? look.rect : stepOwnsSheet ? null : focus;
  const focusKey = look ? `look:${look.n}` : focus && !stepOwnsSheet ? `tb:${step}` : step;
  const goTo = (i: number) => {
    setLook(null);
    setPage(i);
  };
  const stepTo = (id: WizardStepId) => {
    setLook(null);
    setStep(id);
  };

  // ---- splitter between the instructions and the sheet
  const shell = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const splitDown = (e: ReactPointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragging.current = true;
  };
  const splitMove = (e: ReactPointerEvent) => {
    const el = shell.current;
    if (!dragging.current || !el) return;
    const r = el.getBoundingClientRect();
    setSplit(Math.min(0.6, Math.max(0.2, (e.clientX - r.left) / r.width)));
  };
  const splitUp = () => {
    if (!dragging.current) return;
    dragging.current = false;
    saveSplit(split);
  };

  const next = () => setQuestion((n) => Math.min(LAST_TITLE, n + 1));
  const back = () => setQuestion((n) => Math.max(0, n - 1));

  if (!standard) return <StartScreen {...props} onStart={setStandard} />;

  const stepIndex = WIZARD_STEPS.findIndex((s) => s.id === step);
  return (
    <div ref={shell} className="standards-wizard" style={{ gridTemplateColumns: `${split * 100}% 6px 1fr` }}>
      <header className="sw-head">
        <div className="sw-title">
          <strong>{standard.name}</strong>
          <span>{props.fileName}</span>
        </div>
        <nav className="sw-steps" aria-label="Setup steps">
          {WIZARD_STEPS.map((s, i) => (
            <button key={s.id} type="button" className={`sw-step${s.id === step ? ' current' : ''}${i < stepIndex ? ' past' : ''}`} aria-current={s.id === step ? 'step' : undefined} onClick={() => stepTo(s.id)}>
              <span className="sw-step-n">{i + 1}</span>
              {s.label}
            </button>
          ))}
        </nav>
        <button type="button" className="btn small flat" onClick={props.onClose} aria-label="Close the setup">
          Close
        </button>
      </header>

      <aside className="sw-guide" aria-label="Instructions">
        {step === 'titleBlock' && (
          <>
            <p className="sw-progress">
              Title block · {question + 1} of {LAST_TITLE + 1}
            </p>
            <ol className="sw-checklist">
              {[...TITLE_QUESTIONS.map((x) => ({ key: x.key, label: x.label, done: !!boxFor(boxes, x) })), ...TITLE_EXTRAS.map((x) => ({ key: x.id, label: x.label, done: false }))].map((item, i) => (
                <li key={item.key} className={`${i === question ? 'current' : ''}${item.done ? ' done' : ''}`}>
                  <button type="button" onClick={() => setQuestion(i)}>
                    {item.done ? '✓ ' : ''}
                    {item.label}
                  </button>
                </li>
              ))}
            </ol>
            {q && (
              <section className="sw-question">
                <h2>{q.label}</h2>
                <p>{q.prompt}</p>
                {readOnly && <p className="sw-warn">This document is read-only, so boxes cannot be drawn on it.</p>}
                {!answer && !readOnly && <p className="sw-hint">Drag on the sheet to draw the box. Scroll to zoom; drag with the middle button to move around.</p>}
                {answer && <BoxResult check={check} verdict={check ? checkVerdict(check, q.field) : null} sheets={sheets} onGoTo={goTo} />}
              </section>
            )}
            {extra === 'ownFields' && (
              <section className="sw-question">
                <h2>Your own fields</h2>
                <p>Anything else in the title block you want read from every sheet (Package, Drawn by, Contract). Name it, then draw its box.</p>
                <div className="sw-row">
                  <input
                    value={customName}
                    onChange={(e) => {
                      setCustomName(e.target.value);
                      setDrawingCustom(false);
                    }}
                    placeholder="Field name"
                    aria-label="Field name"
                    maxLength={60}
                  />
                  <button type="button" className="btn small" disabled={!customName.trim() || !!nameProblem || readOnly} onClick={() => setDrawingCustom(true)}>
                    {drawingCustom ? 'Drag on the sheet…' : 'Draw its box'}
                  </button>
                </div>
                {nameProblem && <p className="sw-warn">{nameProblem}</p>}
                <BoxList
                  boxes={boxes.filter((b) => b.field === 'custom' && !TITLE_QUESTIONS.some((x) => x.name === b.name))}
                  texts={texts}
                  page={page}
                  onRemove={(b) => change((s) => ({ ...s, sheets: { ...s.sheets, boxes: s.sheets.boxes.filter((x) => x !== b) } }))}
                />
              </section>
            )}
            {extra === 'ignore' && (
              <section className="sw-question">
                <h2>Other numbers</h2>
                <p>Box any number in the title block that is not the drawing number but looks like one: a contract number, a file name, a reference drawing. They are never taken for the sheet's number.</p>
                <BoxList boxes={boxes.filter((b) => b.field === 'ignore')} texts={texts} page={page} onRemove={(b) => change((s) => ({ ...s, sheets: { ...s.sheets, boxes: s.sheets.boxes.filter((x) => x !== b) } }))} />
              </section>
            )}
            {extra === 'numbers' && <NumbersStep standard={standard} numbers={numbers} change={change} />}
            <div className="sw-nav">
              <button type="button" className="btn" onClick={back} disabled={question === 0}>
                Back
              </button>
              {q && answer && !readOnly && (
                <button type="button" className="btn" onClick={() => change((s) => ({ ...s, sheets: { ...s.sheets, boxes: withAnswer(s.sheets.boxes, q, null) } }))}>
                  Re-draw box
                </button>
              )}
              {q?.optional && !answer && (
                <button type="button" className="btn flat" onClick={next}>
                  Skip
                </button>
              )}
              {question < LAST_TITLE ? (
                <button type="button" className="btn primary" onClick={next} disabled={!!q && !q.optional && !answer}>
                  Next
                </button>
              ) : (
                <button type="button" className="btn primary" onClick={() => stepTo('sections')}>
                  Next: sections
                </button>
              )}
            </div>
          </>
        )}
        {WIZARD_STEPS.find((s) => s.id === step && !s.ready) && (
          <section className="sw-question">
            <h2>{WIZARD_STEPS[stepIndex]!.label}</h2>
            <p>This step is coming to the setup soon. Until then, teach these links with Teach Sheet Links in the main window: box one example and its target, and redcolumn finds the rest.</p>
            <p className="sw-hint">Once the title block and a few examples are set up, an AI assistant connected over MCP can use them to find the links that text search misses.</p>
            <div className="sw-nav">
              <button type="button" className="btn" onClick={() => stepTo(WIZARD_STEPS[stepIndex - 1]!.id)}>
                Back
              </button>
              <button type="button" className="btn" onClick={props.onTeachLinks}>
                Open Teach Sheet Links
              </button>
              <button type="button" className="btn primary" onClick={() => stepTo(WIZARD_STEPS[stepIndex + 1]!.id)}>
                Next
              </button>
            </div>
          </section>
        )}
        {callout && (
          <CalloutStep
            key={callout}
            kind={callout}
            standard={standard}
            change={change}
            texts={texts}
            sheets={sheets}
            pages={pages}
            page={page}
            setPage={goTo}
            look={(i, rect) => {
              setPage(i);
              setLook((l) => ({ rect, n: (l?.n ?? 0) + 1 }));
            }}
            readPage={props.readPage}
            render={props.render}
            readOnly={readOnly}
            setSheet={setStepSheet}
            onChecks={(c) => setChecks((all) => new Map([...all, ...c]))}
            onBack={() => {
              if (stepIndex === 1) setQuestion(LAST_TITLE);
              stepTo(WIZARD_STEPS[stepIndex - 1]!.id);
            }}
            onNext={() => stepTo(WIZARD_STEPS[stepIndex + 1]!.id)}
          />
        )}
        {step === 'matchLines' && (
          <MatchLineStep
            standard={standard}
            change={change}
            texts={texts}
            sheets={sheets}
            pages={pages}
            page={page}
            setPage={goTo}
            look={(i, rect) => {
              setPage(i);
              setLook((l) => ({ rect, n: (l?.n ?? 0) + 1 }));
            }}
            readPage={props.readPage}
            render={props.render}
            readOnly={readOnly}
            setSheet={setStepSheet}
            onChecks={(c) => setChecks((all) => new Map([...all, ...c]))}
            onStitch={props.onStitch}
            onBack={() => stepTo(WIZARD_STEPS[stepIndex - 1]!.id)}
            onNext={() => stepTo(WIZARD_STEPS[stepIndex + 1]!.id)}
          />
        )}
        {step === 'chainage' && (
          <ChainageStep
            standard={standard}
            change={change}
            texts={texts}
            sheets={sheets}
            pages={pages}
            page={page}
            setPage={goTo}
            look={(i, rect) => {
              setPage(i);
              setLook((l) => ({ rect, n: (l?.n ?? 0) + 1 }));
            }}
            readPage={props.readPage}
            render={props.render}
            readOnly={readOnly}
            setSheet={setStepSheet}
            onChecks={(c) => setChecks((all) => new Map([...all, ...c]))}
            onBack={() => stepTo(WIZARD_STEPS[stepIndex - 1]!.id)}
            onNext={() => stepTo(WIZARD_STEPS[stepIndex + 1]!.id)}
          />
        )}
        {step === 'review' && (
          <section className="sw-question">
            <h2>Review</h2>
            <p>
              {standard.name} reads {boxes.filter((b) => b.field !== 'ignore').length} title-block fields
              {standard.sheets.template ? `, with drawing numbers like ${standard.sheets.template}` : ''}. It is saved in your profile as you go.
            </p>
            {texts && numberBox && (
              <p>
                The drawing number box reads a number on {numbers.length} of {texts.length} sheets in {props.fileName}.
              </p>
            )}
            <div className="sw-nav">
              <button type="button" className="btn" onClick={() => stepTo('chainage')}>
                Back
              </button>
              <button type="button" className="btn" onClick={props.onPanel}>
                More settings…
              </button>
              <button type="button" className="btn primary" disabled={!numberBox || readOnly} onClick={() => props.onUse(standard.id, checks)}>
                Read this document with it
              </button>
            </div>
          </section>
        )}
      </aside>

      <div className="sw-split" role="separator" aria-orientation="vertical" aria-label="Resize the instructions" onPointerDown={splitDown} onPointerMove={splitMove} onPointerUp={splitUp} onPointerCancel={splitUp} />

      <main className="sw-sheet">
        <div className="sw-sheet-body">
          <ThumbStrip pages={pages} sheets={sheets} current={page} render={props.render} onGoTo={goTo} flagged={stepOwnsSheet ? undefined : flagged} />
          <SheetView ref={sheetView} onZoom={setZoom} pageIndex={page} page={size} render={props.render} boxes={shown} drawing={drawing} onBox={onBox} focus={shownFocus} focusKey={focusKey} />
        </div>
        <PageNav
          pageIndex={page}
          pageCount={pages.length}
          disabled={false}
          onFirst={() => goTo(0)}
          onPrev={() => goTo(Math.max(0, page - 1))}
          onNext={() => goTo(Math.min(pages.length - 1, page + 1))}
          onLast={() => goTo(pages.length - 1)}
          onGoTo={goTo}
          zoom={zoom}
          continuous={false}
          onZoomIn={() => sheetView.current?.zoomBy(1.25)}
          onZoomOut={() => sheetView.current?.zoomBy(1 / 1.25)}
          onZoomTo={(z) => sheetView.current?.zoomTo(z)}
          onFit={() => sheetView.current?.fit()}
          onFitWidth={() => sheetView.current?.fitWidth()}
          sheetLabel={sheets[page]?.number ?? undefined}
          sheetTitle={sheets[page]?.title ?? undefined}
          pageWidthPt={size.width}
          pageHeightPt={size.height}
        />
      </main>
    </div>
  );
}

function StartScreen({ standards, readOnly, onClose, onStart, onSave }: Props & { onStart: (s: DrawingStandard) => void }) {
  const [name, setName] = useState('');
  return (
    <div className="standards-wizard start">
      <section className="sw-start">
        <h1>Set up a drawing standard</h1>
        <p>A drawing standard is how one client draws: where its title block keeps the drawing number, title and revision, and how its sheets refer to each other. Set it up once on one of its sets; every set from that client is then read the same way.</p>
        <p>The setup takes you through it a step at a time, with the sheet beside the instructions.</p>
        <div className="sw-row">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Client or standard name" aria-label="Standard name" maxLength={200} />
          <button
            type="button"
            className="btn primary"
            disabled={!name.trim() || readOnly}
            onClick={() => {
              const s = newStandard(name.trim());
              onSave(s);
              onStart(s);
            }}
          >
            Start
          </button>
        </div>
        {standards.length > 0 && (
          <>
            <h2>Or carry on with one you have</h2>
            <ul className="sw-standards">
              {standards.map((s) => (
                <li key={s.id}>
                  <button type="button" className="btn" onClick={() => onStart(withDefaults(s))}>
                    {s.name}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        <div className="sw-nav">
          <button type="button" className="btn flat" onClick={onClose}>
            Close
          </button>
        </div>
      </section>
    </div>
  );
}

function BoxResult({ check, verdict, sheets, onGoTo }: { check: ReturnType<typeof checkBox> | null; verdict: 'good' | 'some' | 'poor' | null; sheets: Props['sheets']; onGoTo: (page: number) => void }) {
  if (!check) return <p className="sw-hint">Reading the set's text…</p>;
  return (
    <div className="sw-result">
      <p className="sw-read">
        Reads: <strong>{check.here ?? 'nothing'}</strong>
      </p>
      <p className={`sw-verdict ${verdict}`}>
        Read on {check.read} of {check.of} sheets
        {check.empty.length > 0 && check.empty.length < check.of && ' (the others are marked in the thumbnails)'}
        {verdict === 'good' && ' — looks right.'}
        {verdict === 'some' && ' — some sheets have nothing there (covers and indexes often don’t).'}
        {verdict === 'poor' && (check.here ? ' — too few; try a box that takes in the whole field.' : ' — nothing read on this sheet; draw the box around the text itself.')}
      </p>
      {check.repeated.length > 0 && <p className="sw-warn">The same number is read on several sheets ({check.repeated.slice(0, 3).join(', ')}). Is the box on the drawing number?</p>}
      <table className="sw-samples">
        <caption>On other sheets</caption>
        <tbody>
          {check.samples.map((s) => (
            <tr key={s.page}>
              <td>
                <button type="button" className="sw-link" title={sheets[s.page]?.number ?? undefined} onClick={() => onGoTo(s.page)}>
                  Sheet {s.page + 1}
                </button>
              </td>
              <td className={s.value ? '' : 'none'}>{s.value ?? 'nothing'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BoxList({ boxes, texts, page, onRemove }: { boxes: TitleBox[]; texts: readonly PageText[] | null; page: number; onRemove: (b: TitleBox) => void }) {
  if (!boxes.length) return <p className="sw-hint">None yet.</p>;
  return (
    <ul className="sw-boxes">
      {boxes.map((b, i) => {
        const c = texts ? checkBox(texts, b, page) : null;
        return (
          <li key={i}>
            <span>{b.field === 'custom' ? b.name : 'Ignored'}</span>
            <span className="sw-box-value">{c ? (c.here ?? 'nothing here') : '…'}</span>
            <button type="button" className="btn small flat" onClick={() => onRemove(b)} aria-label={`Remove ${b.field === 'custom' ? b.name : 'ignored box'}`}>
              Remove
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function NumbersStep({ standard, numbers, change }: { standard: DrawingStandard; numbers: string[]; change: (f: (s: DrawingStandard) => DrawingStandard) => void }) {
  const suggested = useMemo(() => templateFor(numbers), [numbers]);
  const template = standard.sheets.template;
  const fits = useMemo(() => {
    if (!template) return null;
    try {
      const re = templateRegex(template);
      return numbers.filter((n) => re.test(n.toUpperCase())).length;
    } catch {
      return null;
    }
  }, [template, numbers]);
  const candidates = useMemo(() => disciplineCandidates(numbers), [numbers]);
  const part = standard.sheets.disciplinePart;
  const codes = candidates.find((c) => c.part === part)?.codes ?? [];
  const setSheets = (patch: Partial<DrawingStandard['sheets']>) => change((s) => ({ ...s, sheets: { ...s.sheets, ...patch } }));
  if (!numbers.length) return <p className="sw-warn">Box the drawing number first (step 1), so its numbers can be read.</p>;
  return (
    <section className="sw-question">
      <h2>Drawing numbers</h2>
      <p>
        How this client builds drawing numbers: <code>#</code> a digit, <code>@</code> a letter, <code>?</code> either, <code>*</code> a run of them. Numbers that do not fit (another consultant’s sheets) are left to the text.
      </p>
      <div className="sw-row">
        <input value={template ?? ''} onChange={(e) => setSheets({ template: e.target.value.trim() || null })} placeholder={suggested ?? 'Any number'} aria-label="Drawing number template" />
        {suggested && suggested !== template && (
          <button type="button" className="btn small" onClick={() => setSheets({ template: suggested })}>
            Use {suggested}
          </button>
        )}
      </div>
      {fits !== null && (
        <p className={`sw-verdict ${fits === numbers.length ? 'good' : 'some'}`}>
          {fits} of {numbers.length} numbers read fit.
        </p>
      )}
      {candidates.length > 0 && (
        <>
          <h3>Which part names the discipline?</h3>
          <div className="sw-choices" role="radiogroup" aria-label="Discipline part">
            <label>
              <input type="radio" checked={part === null} onChange={() => setSheets({ disciplinePart: null })} /> None of them
            </label>
            {candidates.map((c) => (
              <label key={c.part}>
                <input type="radio" checked={part === c.part} onChange={() => setSheets({ disciplinePart: c.part })} /> Part {c.part + 1}: {c.codes.slice(0, 6).join(', ')}
                {c.codes.length > 6 ? '…' : ''}
              </label>
            ))}
          </div>
          {part !== null && codes.length > 0 && (
            <table className="sw-samples">
              <caption>Discipline names</caption>
              <tbody>
                {codes.map((code) => (
                  <tr key={code}>
                    <td>{code}</td>
                    <td>
                      <input
                        value={standard.sheets.disciplines[code] ?? ''}
                        placeholder={code}
                        aria-label={`Discipline name for ${code}`}
                        maxLength={100}
                        onChange={(e) => {
                          const name = e.target.value;
                          change((s) => {
                            const disciplines = Object.fromEntries(Object.entries(s.sheets.disciplines).filter(([k]) => k !== code));
                            if (name.trim()) disciplines[code] = name;
                            return { ...s, sheets: { ...s.sheets, disciplines } };
                          });
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </section>
  );
}
