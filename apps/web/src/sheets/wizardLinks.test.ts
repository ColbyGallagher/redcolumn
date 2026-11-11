import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_LINK_HINTS, type Word } from '@nb/sheets';
import { teachMark, type MarkPage } from './marks.ts';
import { boxSays, learnMatchLine, runCalloutStep, runMatchLineStep, taughtBox } from './wizardLinks.ts';

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
