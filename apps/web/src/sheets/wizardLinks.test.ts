import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_CHAINAGE_HINTS, DEFAULT_LINK_HINTS, type SheetInfo, type Word } from '@nb/sheets';
import { teachMark, type MarkPage } from './marks.ts';
import { alignmentSays, boxSays, learnAlignmentChain, learnMatchLine, runCalloutStep, runChainageStep, runMatchLineStep, taughtBox } from './wizardLinks.ts';

const word = (text: string, cx: number, cy: number, size = 6): Word => {
  const w = text.length * size * 0.55;
  return { text, x0: cx - w / 2, y0: cy - size / 2, x1: cx + w / 2, y1: cy + size / 2, size, angle: 0 };
};

/** A callout bubble: a circle split across, the identifier above and the sheet below. */
function bubble(cx: number, cy: number, detail: string | null, sheet: string | null, r = 12) {
  const segments: number[] = [];
  const n = 24;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const b = ((i + 1) / n) * Math.PI * 2;
    segments.push(cx + r * Math.cos(a), cy + r * Math.sin(a), cx + r * Math.cos(b), cy + r * Math.sin(b));
  }
  segments.push(cx - r, cy, cx + r, cy);
  // Lettered close to the divider, the identifier half as big again as the sheet number.
  const words = [...(detail ? [word(detail, cx, cy - r * 0.35, r * 0.75)] : []), ...(sheet ? [word(sheet, cx, cy + r * 0.4, r * 0.5)] : [])];
  return { segments, words };
}

function page(...parts: { segments: number[]; words: Word[] }[]): MarkPage {
  return { width: 1200, height: 800, words: parts.flatMap((p) => p.words), segments: new Float32Array(parts.flatMap((p) => p.segments)) };
}

const box = (cx: number, cy: number, r = 12) => ({ x: cx - r - 2, y: cy - r - 2, w: 2 * r + 4, h: 2 * r + 4 });
const numbers = ['A-101', 'A-501'];

test('a boxed callout says its identifier and the sheet it points to', () => {
  const plan = page(bubble(100, 100, '3', 'A-501'));
  const says = boxSays(taughtBox(plan, 0, box(100, 100)), numbers, DEFAULT_LINK_HINTS);
  assert.equal(says.id, '3');
  assert.equal(says.sheet, 1);
  assert.equal(says.text, '3 A-501');
  // A title naming its own sheet names no other.
  assert.equal(boxSays(taughtBox(page(bubble(100, 100, '3', 'A-101')), 0, box(100, 100)), numbers, DEFAULT_LINK_HINTS).sheet, null);
});

test('the step finds callouts from the text, and by their taught shape where the text cannot', async () => {
  // The third bubble's sheet number is lettered too small for the text to take it for a bubble.
  const odd = bubble(700, 500, '5', null);
  odd.words.push({ ...word('A-501', 700, 504.8, 2.5) });
  const plan = page(bubble(100, 100, '3', 'A-501'), bubble(400, 300, '4', 'A-501'), odd);
  // On A-501: detail 3's title, bigger, its own sheet number below, its name beside it.
  const details = page(bubble(300, 300, '3', 'A-501', 20), { segments: [], words: [word('CURB', 360, 290, 12)] });
  const pages = [plan, details];
  const textOnly = await runCalloutStep('detail', pages, numbers, DEFAULT_LINK_HINTS, [], async (i) => pages[i]!);
  assert.deepEqual(
    textOnly.links.map((l) => [l.label, l.targetPage, !!l.targetRect]),
    [
      ['3/A-501', 1, true],
      ['4/A-501', 1, false],
    ],
  );
  assert.equal(textOnly.places, 2);
  assert.equal(textOnly.linked, 2);
  // Taught the bubble: the odd one is found by its shape and linked too, the others not twice.
  const mark = teachMark(plan, box(100, 100), 'detailCallout', 'Callout', numbers);
  let read = 0;
  const withMark = await runCalloutStep('detail', pages, numbers, DEFAULT_LINK_HINTS, [mark], async (i) => (read++, pages[i]!));
  assert.ok(read >= 1, 'line work read for the pages that may hold the mark');
  assert.deepEqual(withMark.links.map((l) => l.label).sort(), ['3/A-501', '4/A-501', '5/A-501']);
  assert.equal(withMark.places, 3);
  assert.equal(withMark.linked, 3);
  assert.equal(withMark.unreadable, 0);
});

/** A match-line label of two lines: the phrase and chainage, then the adjoining drawing. */
function label(phrase: string, ch: string, sheet: string, x: number, y: number) {
  const words: Word[] = [];
  let cx = x;
  for (const t of [...phrase.split(' '), 'CH', ch]) {
    words.push(word(t, cx, y, 8));
    cx += t.length * 4.4 + 8;
  }
  cx = x;
  for (const t of ['ADJOINS', 'DRG', sheet]) {
    words.push(word(t, cx, y + 12, 8));
    cx += t.length * 4.4 + 8;
  }
  return { segments: [], words };
}
const plans = ['P-1', 'P-2', 'P-3'];
const labelBox = (x: number, y: number) => ({ x: x - 20, y: y - 8, w: 160, h: 24 });

test('a pair of match-line labels: the usual words, the chainage and the adjoining drawing', () => {
  const a = page(label('MATCH LINE', '280.000', 'P-2', 600, 400));
  const b = page(label('MATCH LINE', '280.000', 'P-1', 200, 300));
  const lesson = learnMatchLine(taughtBox(a, 0, labelBox(600, 400)), taughtBox(b, 1, labelBox(200, 300)), plans, DEFAULT_LINK_HINTS);
  assert.equal(lesson.problem, null);
  assert.equal(lesson.links, null, 'the usual words already read it');
  assert.ok(lesson.notes.some((n) => n.includes('adjoining drawing (P-2)')));
  assert.ok(lesson.notes.some((n) => n.includes('chainage')));
  const run = runMatchLineStep([a, b, page()], plans, DEFAULT_LINK_HINTS);
  assert.deepEqual(
    run.links.map((l) => [l.pageIndex, l.targetPage, l.kind]),
    [
      [0, 1, 'matchline'],
      [1, 0, 'matchline'],
    ],
  );
  assert.equal(run.places, 2);
  assert.equal(run.linked, 2);
});

test("a client's own words for match lines are learned, and a pair that disagrees is refused", () => {
  const a = page(label('JOIN LINE', '565.000', 'P-3', 600, 400));
  const c = page(label('JOIN LINE', '565.000', 'P-1', 200, 300));
  const usual = runMatchLineStep([a, page(), c], plans, DEFAULT_LINK_HINTS);
  // Without the words, the labels are plain sheet references: no match lines found.
  assert.equal(usual.links.length, 0);
  assert.equal(usual.places, 0);
  const lesson = learnMatchLine(taughtBox(a, 0, labelBox(600, 400)), taughtBox(c, 2, labelBox(200, 300)), plans, DEFAULT_LINK_HINTS);
  assert.equal(lesson.problem, null);
  assert.deepEqual(lesson.links?.matchLine, [...DEFAULT_LINK_HINTS.matchLine, 'JOIN LINE']);
  const learned = runMatchLineStep([a, page(), c], plans, lesson.links!);
  assert.equal(learned.links.length, 2);
  assert.equal(learned.places, 2);
  // The second label boxed on a sheet the first does not name.
  const wrong = learnMatchLine(taughtBox(a, 0, labelBox(600, 400)), taughtBox(page(label('JOIN LINE', '1', 'P-1', 200, 300)), 1, labelBox(200, 300)), plans, DEFAULT_LINK_HINTS);
  assert.match(wrong.problem ?? '', /names P-3, not P-2/);
});

const info = (number: string, title: string): SheetInfo => ({ number, title, discipline: null, scaleText: null, revision: null, source: 'standard', confidence: 1 });
const around = (cx: number, cy: number, w: number, h = 14) => ({ x: cx - w / 2, y: cy - h / 2, w, h });

/** A control plan: MC00 printed once at the start of its run of ticks, 0 to 300 every 20. */
function controlPlan(): MarkPage {
  const words = [word('MC00', 60, 500), ...Array.from({ length: 16 }, (_, i) => word(String(i * 20), 100 + i * 60, 500))];
  return page({ segments: [], words });
}
/** A cross-section sheet of MC00: the section at CHAINAGE 100, its alignment beside it, and MC00 again at the foot of the sheet. */
function crossSections(name = 'MC00'): MarkPage {
  return page({ segments: [], words: [word(name, 600, 380, 8), word('CHAINAGE', 560, 400, 8), word('100', 600, 400, 8), word('MC00', 1000, 760, 8)] });
}
const chainSheets = [info('P-1', 'ALIGNMENT CONTROL PLAN'), info('X-1', 'CROSS SECTIONS MC00 CH 0-150')];

test('the four chainage boxes: the plan tick, its alignment, the cross-section sheet naming it, a section', () => {
  const plan = controlPlan();
  const xs = crossSections();
  const boxes = {
    planChainage: taughtBox(plan, 0, around(400, 500, 30)),
    planAlignment: taughtBox(plan, 0, around(60, 500, 36)),
    sectionAlignment: taughtBox(xs, 1, around(600, 380, 30)),
    sectionChainage: taughtBox(xs, 1, around(580, 400, 70)),
  };
  assert.equal(alignmentSays(boxes.planAlignment), 'MC00');
  const lesson = learnAlignmentChain(boxes, chainSheets, DEFAULT_CHAINAGE_HINTS);
  assert.equal(lesson.problem, null);
  const h = lesson.chainage!;
  assert.deepEqual(h.alignments, ['MC00']);
  assert.equal(h.alignmentTemplate, 'MC##');
  assert.equal(h.alignmentSource, 'section', 'named beside the section');
  assert.ok(h.planTitles.includes('ALIGNMENT CONTROL PLAN'));
  assert.ok(lesson.notes.some((n) => n.includes('bare numbers')));
  assert.ok(lesson.notes.some((n) => n.includes('CHAINAGE 100') || n.includes('100 on X-1 links to P-1')), lesson.notes.join(' | '));
  const run = runChainageStep([plan, xs], chainSheets, h);
  assert.deepEqual(
    run.links.map((l) => [l.pageIndex, l.label, l.targetPage]),
    [
      [0, '100', 1],
      [1, 'CHAINAGE 100', 0],
    ],
  );
  assert.deepEqual([run.places, run.linked, run.ambiguous.length], [2, 2, 0]);

  // The alignment boxed in the title block.
  const corner = around(1000, 760, 30);
  const inTitle = learnAlignmentChain({ ...boxes, sectionAlignment: taughtBox(xs, 1, corner) }, chainSheets, DEFAULT_CHAINAGE_HINTS, { x: 900, y: 700, w: 280, h: 90 });
  assert.equal(inTitle.chainage?.alignmentSource, 'title');
  // Printed once on the sheet, away from the section, and not in the title.
  const single = page({ segments: [], words: [word('CHAINAGE', 560, 400, 8), word('100', 600, 400, 8), word('MC00', 1000, 760, 8)] });
  const once = learnAlignmentChain(
    { ...boxes, sectionAlignment: taughtBox(single, 1, corner), sectionChainage: taughtBox(single, 1, around(580, 400, 70)) },
    [chainSheets[0]!, info('X-1', 'CROSS SECTIONS SHEET 1')],
    DEFAULT_CHAINAGE_HINTS,
  );
  assert.equal(once.chainage?.alignmentSource, 'sheet');
  // Named in the title, boxed away from the section: the title.
  assert.equal(learnAlignmentChain({ ...boxes, sectionAlignment: taughtBox(single, 1, corner), sectionChainage: taughtBox(single, 1, around(580, 400, 70)) }, chainSheets, DEFAULT_CHAINAGE_HINTS).chainage?.alignmentSource, 'title');
});

test('chainage boxes that do not make a chain are refused', () => {
  const plan = controlPlan();
  const other = crossSections('MC01');
  const boxes = {
    planChainage: taughtBox(plan, 0, around(400, 500, 30)),
    planAlignment: taughtBox(plan, 0, around(60, 500, 36)),
    sectionAlignment: taughtBox(other, 1, around(600, 380, 30)),
    sectionChainage: taughtBox(other, 1, around(580, 400, 70)),
  };
  assert.match(learnAlignmentChain(boxes, chainSheets, DEFAULT_CHAINAGE_HINTS).problem ?? '', /alignment is MC00 but X-1 names MC01/);
  // The section's chainage boxed without its CHAINAGE.
  const xs = crossSections();
  assert.match(learnAlignmentChain({ ...boxes, sectionAlignment: taughtBox(xs, 1, around(600, 380, 30)), sectionChainage: taughtBox(xs, 1, around(600, 400, 16)) }, chainSheets, DEFAULT_CHAINAGE_HINTS).problem ?? '', /word in front of it/);
  // Everything on the plan.
  assert.match(learnAlignmentChain({ ...boxes, sectionAlignment: boxes.planAlignment, sectionChainage: boxes.planChainage }, chainSheets, DEFAULT_CHAINAGE_HINTS).problem ?? '', /on the plan/);
});
