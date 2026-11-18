import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoSizedPoints } from './edits.ts';
import { DEFAULT_STYLES, type Markup, type MarkupType, type Point } from './model.ts';
import { textBoxLines } from './render.ts';
import { applySpanStyle, layoutRuns, normalizeSpans, rangeHasFlag, shiftSpans, styleRuns, toggleSpanFlag, type StyledMeasure } from './textSpans.ts';
import { layoutParagraphs } from './textLists.ts';

function mk(type: MarkupType, points: Point[], extra: Partial<Markup> = {}): Markup {
  return { id: `${type}-${points.length}`, type, pageIndex: 0, points, style: { ...DEFAULT_STYLES[type] }, status: 'none', author: '', createdAt: 1, modifiedAt: 1, ...extra };
}
/** 6 per character, 8 when bold. */
const styled: StyledMeasure = (s, bold) => s.length * (bold ? 8 : 6);
const plain = (s: string) => s.length * 6;
const base = { color: '#000000' };

test('normalizeSpans clips, drops empties and junk, joins neighbours', () => {
  const spans = normalizeSpans(
    [
      { start: 0, end: 3, style: { bold: true } },
      { start: 3, end: 6, style: { bold: true } },
      { start: 8, end: 99, style: { italic: true } },
      { start: 4, end: 4, style: { bold: true } },
      { start: 1, end: 2, style: {} },
      { start: 2, end: 3, style: { color: 'red' } },
    ],
    10,
  );
  assert.deepEqual(spans, [{ start: 0, end: 6, style: { bold: true } }, { start: 8, end: 10, style: { italic: true } }]);
  assert.deepEqual(normalizeSpans(undefined, 5), []);
  assert.deepEqual(normalizeSpans([{ start: 0, end: 2, style: { bold: true } }], 0), []);
});

test('a later span wins where spans overlap', () => {
  const spans = normalizeSpans([{ start: 0, end: 4, style: { bold: true, color: '#ff0000' } }, { start: 2, end: 6, style: { bold: false } }], 6);
  assert.deepEqual(spans, [
    { start: 0, end: 2, style: { bold: true, color: '#ff0000' } },
    { start: 2, end: 4, style: { bold: false, color: '#ff0000' } },
    { start: 4, end: 6, style: { bold: false } },
  ]);
});

test('styleRuns resolves each run against the markup style', () => {
  const runs = styleRuns('one two three', [{ start: 4, end: 7, style: { bold: true } }], { ...base, italic: true });
  assert.deepEqual(runs.map((r) => [r.text, r.bold, r.italic]), [['one ', false, true], ['two', true, true], [' three', false, true]]);
  const off = styleRuns('abc', [{ start: 0, end: 1, style: { italic: false } }], { ...base, italic: true });
  assert.deepEqual(off.map((r) => [r.text, r.italic]), [['a', false], ['bc', true]]);
});

test('toggling a flag turns it on, then off, and a no-op override is dropped', () => {
  const text = 'hello world';
  const on = toggleSpanFlag(text, [], 0, 5, 'bold', base);
  assert.deepEqual(on, [{ start: 0, end: 5, style: { bold: true } }]);
  assert.ok(rangeHasFlag(text, on, 0, 5, 'bold', base));
  // Selecting more than the bold word makes bold apply to all of it first.
  const wider = toggleSpanFlag(text, on, 0, 11, 'bold', base);
  assert.deepEqual(wider, [{ start: 0, end: 11, style: { bold: true } }]);
  assert.deepEqual(toggleSpanFlag(text, wider, 0, 11, 'bold', base), []);
  // On an already-bold markup, toggling a selection un-bolds it (an explicit override).
  const boldBase = { ...base, bold: true };
  assert.deepEqual(toggleSpanFlag(text, [], 6, 11, 'bold', boldBase), [{ start: 6, end: 11, style: { bold: false } }]);
});

test('applySpanStyle sets colour and clears it again', () => {
  const red = applySpanStyle([], 2, 5, { color: '#ff0000' }, 8);
  assert.deepEqual(red, [{ start: 2, end: 5, style: { color: '#ff0000' } }]);
  assert.deepEqual(applySpanStyle(red, 0, 8, { color: undefined }, 8), []);
});

test('shiftSpans follows the text through insertions and deletions', () => {
  const spans = [{ start: 6, end: 11, style: { bold: true } }];
  // Typing before the bold word moves it.
  assert.deepEqual(shiftSpans(spans, 'hello world', 'oh hello world'), [{ start: 9, end: 14, style: { bold: true } }]);
  // Typing inside it grows it.
  assert.deepEqual(shiftSpans(spans, 'hello world', 'hello wonrld'), [{ start: 6, end: 12, style: { bold: true } }]);
  // Deleting the word drops the span.
  assert.deepEqual(shiftSpans(spans, 'hello world', 'hello '), []);
  // Unchanged text keeps its spans.
  assert.deepEqual(shiftSpans(spans, 'hello world', 'hello world'), spans);
});

test('layoutRuns wraps with each word measured in its own weight', () => {
  const text = 'aaa bbb ccc';
  // Plain: 11 chars * 6 = 66 fits. Bold over "bbb" adds 6, so the third word wraps.
  assert.equal(layoutRuns(text, [], base, 66, styled).length, 1);
  const lines = layoutRuns(text, [{ start: 4, end: 7, style: { bold: true } }], base, 66, styled);
  assert.deepEqual(lines.map((l) => l.text), ['aaa bbb', 'ccc']);
  assert.equal(lines[0]!.width, 4 * 6 + 3 * 8);
  assert.deepEqual(lines.map((l) => [l.start, l.end]), [[0, 7], [8, 11]]);
});

test('layoutRuns matches layoutParagraphs when nothing differs, including lists and long words', () => {
  const text = 'alpha beta gamma delta\n• a bulleted item that is long enough to wrap around\n\nsupercalifragilisticexpialidocious';
  for (const w of [60, 90, 150]) {
    const a = layoutParagraphs(text, w, plain).map((l) => [l.text, l.indent, l.last]);
    const b = layoutRuns(text, [{ start: 0, end: 1, style: { bold: true } }], base, w, (s) => plain(s)).map((l) => [l.text, l.indent, l.last]);
    assert.deepEqual(b, a, `width ${w}`);
  }
});

test('textBoxLines lists each line as runs that tile it, in order', () => {
  const m = mk('text', [[0, 0], [100, 100]], { text: 'one two three four', spans: [{ start: 4, end: 7, style: { bold: true, color: '#ff0000' } }], style: { ...DEFAULT_STYLES.text, fontSize: 10 } });
  const lines = textBoxLines(m, plain, styled);
  const first = lines[0]!;
  assert.ok(first.runs);
  assert.equal(first.runs!.map((r) => r.text).join(''), first.text);
  const bold = first.runs!.find((r) => r.bold)!;
  assert.equal(bold.color, '#ff0000');
  assert.equal(bold.width, 3 * 8);
  // Runs sit end to end from the line's left edge.
  let x = first.x;
  for (const r of first.runs!) {
    assert.equal(r.x, x);
    x += r.width;
  }
  // Without a styled measure, or without spans, there are no runs.
  assert.equal(textBoxLines(m, plain)[0]!.runs, undefined);
  assert.equal(textBoxLines({ ...m, spans: undefined }, plain, styled)[0]!.runs, undefined);
});

test('justified lines spread the gap through every run', () => {
  const m = mk('text', [[0, 0], [100, 100]], { text: 'aa bb cc dd ee ff gg hh ii', spans: [{ start: 3, end: 5, style: { bold: true } }], style: { ...DEFAULT_STYLES.text, fontSize: 10, textAlign: 'justify' } });
  const [first] = textBoxLines(m, plain, styled);
  const last = first!.runs!.at(-1)!;
  assert.ok(first!.gap > 0);
  assert.ok(Math.abs(last.x + last.width - (first!.x + first!.width)) < 1e-6);
});

test('auto-size accounts for bold text being wider', () => {
  const text = 'aaaa bbbb cccc';
  const box = mk('text', [[0, 0], [200, 100]], { text, style: { ...DEFAULT_STYLES.text, fontSize: 10 } });
  const [, p] = autoSizedPoints(box, plain, styled)!;
  const [, q] = autoSizedPoints({ ...box, spans: [{ start: 0, end: 14, style: { bold: true } }] }, plain, styled)!;
  assert.ok(q![0] > p![0]);
});
