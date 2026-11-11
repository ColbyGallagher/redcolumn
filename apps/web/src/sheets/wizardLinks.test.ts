import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_LINK_HINTS, type Word } from '@nb/sheets';
import { teachMark, type MarkPage } from './marks.ts';
import { boxSays, runCalloutStep, taughtBox } from './wizardLinks.ts';

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
