import { useEffect, useMemo, useRef, useState } from 'react';
import { alignmentsIn, readChainages, regionOfBox, sheetTitled, spotCheckSample, stepMeter, textInRegion, type ChainageAmbiguity, type PageText, type SheetInfo } from '@nb/sheets';
import type { DrawingStandard } from '../../sheets/standards';
import type { MarkPage } from '../../sheets/marks';
import { chainageIn } from '../../sheets/teachLinks';
import { alignmentSays, learnAlignmentChain, runChainageStep, taughtBox, type ChainBoxes, type StepRun } from '../../sheets/wizardLinks';
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
  onBack: () => void;
  onNext: () => void;
}

type Box = keyof ChainBoxes;
const ORDER: Box[] = ['planChainage', 'planAlignment', 'sectionAlignment', 'sectionChainage'];

const ASK: Record<Box, { title: string; how: string; label: string; gif: string }> = {
  planChainage: {
    title: 'Box a chainage on a plan',
    how: 'Find a plan where chainages are marked along an alignment and drag a box around one: a tick label (100) or a written chainage (CH 100).',
    label: 'plan chainage',
    gif: 'plan-chainage',
  },
  planAlignment: {
    title: 'Box the name of its alignment',
    how: 'On the same plan, box the name of the alignment that chainage is on (MC00, LINE A). Many alignments share chainages, so this says which one CH 100 means.',
    label: 'alignment',
    gif: 'plan-alignment',
  },
  sectionAlignment: {
    title: 'Box the alignment on a cross-section sheet',
    how: 'Go to a cross-section sheet of that alignment and box where it names the alignment: in the title, or the label beside a section.',
    label: 'alignment',
    gif: 'section-alignment',
  },
  sectionChainage: {
    title: 'Box one section’s chainage',
    how: 'On that sheet, box the chainage of one section, with the word in front of it (CHAINAGE 100, CH 100).',
    label: 'section chainage',
    gif: 'section-chainage',
  },
};

/**
 * The chainage step of the setup wizard: four boxes make the chain a chainage link follows (a
 * chainage on a plan, the alignment it is on, a cross-section sheet of that alignment, one of its
 * sections). redcolumn learns how the client writes chainages and names alignments and where
 * cross sections say theirs, links the set, and shows the chainages whose alignment it cannot tell.
 */
export function ChainageStep(p: Props) {
  const [phase, setPhase] = useState<Box | 'results'>(() => (p.standard.chainage.alignmentSource ? 'results' : 'planChainage'));
  const [boxes, setBoxes] = useState<Partial<ChainBoxes>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [run, setRun] = useState<(StepRun & { ambiguous: ChainageAmbiguity[] }) | null>(null);
  const [checks, setChecks] = useState<Map<string, boolean>>(new Map());
  const hints = p.standard.chainage;
  const name = (i: number) => p.sheets[i]?.number ?? `Sheet ${i + 1}`;

  const latestPage = useRef(p.page);
  latestPage.current = p.page;
  useEffect(() => {
    const want = !p.readOnly && phase !== 'results';
    const onBox = want
      ? (rect: PageRect) => {
          const at = latestPage.current;
          void p.readPage(at).then((page) => {
            const box = taughtBox(page, at, rect);
            setProblem(null);
            setBoxes((b) => ({ ...b, [phase]: box }));
          });
        }
      : null;
    const shown: ShownBox[] = [];
    for (const k of ORDER) {
      const b = boxes[k];
      if (b && b.pageIndex === p.page) shown.push({ key: k, ...b.box, label: ASK[k].label, tone: k === phase ? 'active' : 'done' });
    }
    p.setSheet({ onBox, boxes: shown });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, boxes, p.page, p.readOnly]);
  useEffect(() => () => p.setSheet({ onBox: null, boxes: [] }), []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (phase !== 'results' || !p.texts) return;
    setRun(runChainageStep(p.texts, p.sheets, hints));
  }, [phase, p.texts, p.sheets, hints]);

  // Cross-section sheets of the boxed alignment, to go to after the plan's two boxes.
  const planName = boxes.planAlignment ? alignmentSays(boxes.planAlignment) : '';
  const sectionSheets = useMemo(() => {
    if (!planName || !p.texts) return [];
    // Titled as cross sections and naming the alignment, in the title or anywhere on the sheet; those
    // printing written chainages first (a typical-sections sheet is titled alike but cut at none).
    const wanted = ` ${planName} `;
    const found: { i: number; score: number }[] = [];
    p.texts.forEach((page, i) => {
      if (i === boxes.planChainage?.pageIndex || !sheetTitled(page, p.sheets[i], hints.sectionTitles)) return;
      const inTitle = alignmentsIn(p.sheets[i]?.title, { alignments: [planName], alignmentTemplate: null }).length > 0;
      if (!inTitle && !` ${page.words.map((w) => w.text.toUpperCase()).join(' ')} `.includes(wanted)) return;
      const cut = readChainages(page, hints).some((c) => c.prefixed);
      found.push({ i, score: (cut ? 2 : 0) + (inTitle ? 1 : 0) });
    });
    return found.sort((a, b) => b.score - a.score || a.i - b.i).map((f) => f.i);
  }, [planName, p.texts, p.sheets, hints, boxes.planChainage?.pageIndex]);

  const learn = () => {
    const b = boxes as ChainBoxes;
    if (ORDER.some((k) => !boxes[k])) return;
    const titleField = p.standard.sheets.boxes.find((x) => x.field === 'title');
    const size = p.pages[b.sectionAlignment.pageIndex];
    const lesson = learnAlignmentChain(b, p.sheets, hints, titleField && size ? regionOfBox(titleField, size) : null);
    if (lesson.problem) {
      setProblem(lesson.problem);
      return;
    }
    if (lesson.chainage) {
      const chainage = lesson.chainage;
      p.change((s) => ({ ...s, chainage }));
    }
    setNotes(lesson.notes);
    setChecks(new Map());
    setPhase('results');
  };

  const sample = useMemo(() => (run ? spotCheckSample(run.links) : []), [run]);
  const meter = run ? stepMeter({ links: run.links, references: run.places, linked: run.linked, checks }) : null;

  if (phase !== 'results') {
    const at = ORDER.indexOf(phase);
    const ask = ASK[phase];
    const box = boxes[phase];
    const isChainage = phase === 'planChainage' || phase === 'sectionChainage';
    const read = box ? textInRegion(box.contents.words, box.box) : '';
    const ch = box && isChainage ? chainageIn(box.contents.words) : null;
    const back = () => {
      if (at === 0) return p.onBack();
      const prev = ORDER[at - 1]!;
      setPhase(prev);
      const b = boxes[prev];
      if (b) p.setPage(b.pageIndex);
    };
    const goToBox = (k: Box) => {
      setPhase(k);
      const b = boxes[k];
      if (b) p.setPage(b.pageIndex);
    };
    const next = () => {
      const following = ORDER[at + 1];
      if (!following) return learn();
      setPhase(following);
      const b = boxes[following];
      if (b) p.setPage(b.pageIndex);
      else if (following === 'sectionAlignment' && sectionSheets.length) p.setPage(sectionSheets[0]!);
    };
    return (
      <section className="sw-question">
        <p className="sw-progress">Chainages · {at + 1} of 5</p>
        <ol className="sw-checklist">
          {ORDER.map((k, i) => (
            <li key={k} className={`${k === phase ? 'current' : ''}${boxes[k] ? ' done' : ''}`}>
              <button type="button" disabled={!boxes[k] && i > at} onClick={() => goToBox(k)}>
                {boxes[k] ? '✓ ' : ''}
                {ASK[k].title}
              </button>
            </li>
          ))}
        </ol>
        <h2>{ask.title}</h2>
        <p>{ask.how}</p>
        <Gif src={`${window.location.origin}/help/gif/standards-chainage-${ask.gif}.gif`} alt={`Where to draw the ${ask.label} box on a sample drawing`} />
        {!box && <p className="sw-hint">Drag on the sheet to draw the box. Scroll to zoom; drag with the middle button to move around.</p>}
        {phase === 'sectionAlignment' && !box && planName && (
          <p className="sw-hint">
            {sectionSheets.length
              ? `Cross-section sheets that name ${planName}: ${sectionSheets.slice(0, 3).map(name).join(', ')}${sectionSheets.length > 3 ? ` and ${sectionSheets.length - 3} more` : ''}.`
              : `No sheet title names ${planName} as a cross-section sheet. Find one with the thumbnails.`}
          </p>
        )}
        {box && (
          <div className="sw-result">
            <p className="sw-read">
              Reads: <strong>{read || 'no text'}</strong>
            </p>
            {isChainage && (
              <p className={`sw-verdict ${ch ? 'good' : 'some'}`}>
                {ch ? `Chainage ${ch.value}${ch.prefix ? `, written after ${ch.prefix}` : ch.plus ? '' : ', a bare number'}.` : 'No chainage read in this box.'}
              </p>
            )}
            {phase === 'sectionAlignment' && planName && !` ${alignmentSays(box)} `.includes(` ${planName} `) && <p className="sw-warn">The plan’s alignment is {planName}, but this box reads {alignmentSays(box) || 'nothing'}.</p>}
          </div>
        )}
        {problem && <p className="sw-warn">{problem}</p>}
        <p className="sw-hint">These four boxes are the examples an AI assistant connected over MCP is given, to link the chainages text search cannot place.</p>
        <div className="sw-nav">
          <button type="button" className="btn" onClick={back}>
            Back
          </button>
          {box && !p.readOnly && (
            <button
              type="button"
              className="btn"
              onClick={() =>
                setBoxes((b) => {
                  const rest = { ...b };
                  delete rest[phase];
                  return rest;
                })
              }
            >
              Re-draw box
            </button>
          )}
          {at === 0 && !box && (
            <button type="button" className="btn flat" onClick={p.onNext} title="Skip chainages: this set has none">
              This set has none
            </button>
          )}
          <button type="button" className="btn primary" disabled={!box || (at === ORDER.length - 1 && (!p.texts || ORDER.some((k) => !boxes[k])))} onClick={next}>
            {at === ORDER.length - 1 ? 'Find the rest' : 'Next'}
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="sw-question">
      <p className="sw-progress">Chainages · 5 of 5</p>
      <h2>Check the chainages linked</h2>
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
          <Meter meter={meter} places={run.places} linked={run.linked} what="chainage" />
          {run.ambiguous.length > 0 && (
            <>
              <h3>Alignment unclear</h3>
              <p className="sw-hint">Cross sections at these chainages are drawn for more than one alignment, and the sheet does not say which it means. Their links wait for review.</p>
              <ul className="sw-ambiguous">
                {groupAmbiguous(run.ambiguous).map((g) => (
                  <li key={g.key}>
                    <button type="button" onClick={() => p.look(g.first.pageIndex, g.first.rect)}>
                      CH {g.first.value} on {name(g.first.pageIndex)}
                    </button>{' '}
                    could be on {g.first.alignments.join(' or ')}
                    {g.count > 1 ? ` (${g.count} places)` : ''}.
                  </li>
                ))}
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
          {(meter.band === 'ai' || run.ambiguous.length > 0) && (
            <div className="sw-ai">
              <strong>{meter.band === 'ai' ? 'Recommended: finish this step with AI.' : 'AI can settle the unclear ones.'}</strong> Chainage links need the alignment on both ends, and text alone often cannot tell it. An AI assistant connected to redcolumn over MCP can read the sheets, using the four boxes you drew as its examples.
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
            setBoxes({});
            setProblem(null);
            setPhase('planChainage');
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

/** One line per sheet and value: a plan and its long section print the same chainage twice. */
function groupAmbiguous(list: readonly ChainageAmbiguity[]) {
  const groups = new Map<string, { key: string; first: ChainageAmbiguity; count: number }>();
  for (const a of list) {
    const key = `${a.pageIndex}:${a.value}`;
    const g = groups.get(key);
    if (g) g.count++;
    else groups.set(key, { key, first: a, count: 1 });
  }
  return [...groups.values()];
}
