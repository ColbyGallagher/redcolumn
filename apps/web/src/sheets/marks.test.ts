import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectLinks, type Word } from '@nb/sheets';
import { findMarks, sectionFrame, teachMark, type MarkPage } from './marks.ts';

const word = (text: string, cx: number, cy: number, size = 6): Word => {
  const w = text.length * size * 0.55;
  return { text, x0: cx - w / 2, y0: cy - size / 2, x1: cx + w / 2, y1: cy + size / 2, size, angle: 0 };
};

/** A callout bubble: a circle split by a horizontal line, the identifier above and the sheet below. */
function bubble(cx: number, cy: number, detail: string | null, sheet: string | null, r = 12) {
  const segments: number[] = [];
  const n = 24;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const b = ((i + 1) / n) * Math.PI * 2;
    segments.push(cx + r * Math.cos(a), cy + r * Math.sin(a), cx + r * Math.cos(b), cy + r * Math.sin(b));
  }
  segments.push(cx - r, cy, cx + r, cy);
  const words = [...(detail ? [word(detail, cx, cy - r / 2)] : []), ...(sheet ? [word(sheet, cx, cy + r / 2, 4)] : [])];
  return { segments, words };
}

function page(...parts: { segments: number[]; words: Word[] }[]): MarkPage {
  return { width: 1224, height: 792, words: parts.flatMap((p) => p.words), segments: new Float32Array(parts.flatMap((p) => p.segments)) };
}

const box = (cx: number, cy: number, r = 12) => ({ x: cx - r - 2, y: cy - r - 2, w: 2 * r + 4, h: 2 * r + 4 });

test('teaching reads the label roles and keeps the line work', () => {
  const p = page(bubble(100, 100, '3', 'A-501'));
  const mark = teachMark(p, box(100, 100), 'detailCallout', '', ['A-101', 'A-501']);
  assert.equal(mark.kind, 'detailCallout');
  assert.equal(mark.name, 'Detail callout');
  assert.deepEqual(
    mark.words.map((w) => [w.role, w.text]),
    [
      ['detail', '3'],
      ['sheet', 'A-501'],
    ],
  );
  assert.equal(mark.lines.length, 25 * 4);
  // Relative to the box: the circle's left edge is 2 pt in.
  assert.equal(Math.min(...mark.lines.filter((_, i) => i % 2 === 0)), 2);
});

test('teaching needs a label in the box', () => {
  const p = page(bubble(100, 100, null, null));
  assert.throws(() => teachMark(p, box(100, 100), 'sectionMark', 'Cut', []), /no selectable text/);
});

test('finds every copy of a taught callout and links each to the sheet it names', () => {
  const numbers = ['A-101', 'A-501', 'A-502'];
  const plan = page(bubble(100, 100, '3', 'A-501'), bubble(400, 300, '7', 'A-502'), bubble(700, 500, '12', 'A-501'), bubble(900, 100, 'B', null), bubble(300, 600, '4', 'Z-999'));
  const pages = [plan, page(), page()];
  const mark = teachMark(plan, box(100, 100), 'detailCallout', 'Callout', numbers);
  const links = findMarks(pages, numbers, [mark]).sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x);
  // The grid bubble (no sheet) and the bubble naming a sheet not in the set are left out.
  assert.deepEqual(
    links.map((l) => [l.label, l.targetPage, l.kind, l.detail]),
    [
      ['3/A-501', 1, 'detail', '3'],
      ['7/A-502', 2, 'detail', '7'],
      ['12/A-501', 1, 'detail', '12'],
    ],
  );
  for (const l of links) {
    assert.ok(l.id.startsWith('mark-0:'), l.id);
    assert.ok(l.confidence > 0.5 && l.confidence < 1, `confidence ${l.confidence}`);
    assert.equal(l.pageIndex, 0);
  }
  // The clickable area is the matched mark, where the example box was drawn.
  assert.deepEqual(links[1]!.rect, box(400, 300));
});

test('a taught mark links where text detection cannot: sheets numbered with bare numbers', () => {
  const numbers = ['10', '12'];
  const plan = page(bubble(100, 100, '3', '12'), bubble(500, 400, '5', '12'));
  const pages = [plan, page()];
  // Bare numbers are addresses and quantities as often as sheets, so text detection leaves them.
  assert.equal(detectLinks(pages, numbers).length, 0);
  const mark = teachMark(plan, box(100, 100), 'detailCallout', '', numbers);
  assert.deepEqual(
    findMarks(pages, numbers, [mark]).map((l) => [l.label, l.targetPage]),
    [
      ['3/12', 1],
      ['5/12', 1],
    ],
  );
});

test('a taught detail title shows callouts where their detail is drawn', () => {
  const numbers = ['A-101', 'A-501'];
  const plan = page(bubble(100, 100, '3', 'A-501'));
  // The detail title on A-501: an underlined identifier with a fixed word beside it.
  const title = (cx: number, cy: number, id: string) => ({ segments: [cx - 20, cy + 8, cx + 60, cy + 8], words: [word(id, cx, cy, 10), word('DETAIL', cx + 30, cy, 6)] });
  const detailSheet = page(title(200, 400, '3'), title(600, 400, '4'));
  const pages = [plan, detailSheet];
  const callout = teachMark(plan, box(100, 100), 'detailCallout', '', numbers);
  const titleMark = teachMark(detailSheet, { x: 175, y: 390, w: 90, h: 22 }, 'detailTitle', '', numbers);
  assert.deepEqual(
    titleMark.words.map((w) => w.role),
    ['detail', 'text'],
  );
  const [link, ...rest] = findMarks(pages, numbers, [callout, titleMark]);
  // Titles that name no other sheet are destinations, not links.
  assert.equal(rest.length, 0);
  assert.equal(link!.targetPage, 1);
  const r = link!.targetRect!;
  // Framed around the title for 3, not the one for 4.
  assert.ok(r.x <= 200 && r.x + r.w >= 200 && r.y <= 400 && r.y + r.h >= 400, JSON.stringify(r));
  assert.ok(r.x + r.w < 600, JSON.stringify(r));
});

test('a section title that names the sheet it is cut on links back to the cut', () => {
  const numbers = ['A-101', 'A-301'];
  const plan = page(bubble(300, 300, 'A', 'A-301'));
  const sectionTitle = (cx: number, cy: number, id: string, from: string) => ({
    segments: [cx - 30, cy + 10, cx + 30, cy + 10, cx - 30, cy + 12, cx + 30, cy + 12],
    words: [word('SECTION', cx - 10, cy, 8), word(id, cx + 22, cy, 8), word(from, cx, cy + 18, 5)],
  });
  const sections = page(sectionTitle(500, 200, 'A', 'A-101'));
  const pages = [plan, sections];
  const cut = teachMark(plan, box(300, 300), 'sectionMark', '', numbers);
  const titled = teachMark(sections, { x: 465, y: 190, w: 70, h: 32 }, 'sectionTitle', '', numbers);
  const links = findMarks(pages, numbers, [cut, titled]);
  const back = links.find((l) => l.pageIndex === 1)!;
  assert.equal(back.label, 'A/A-101');
  assert.equal(back.targetPage, 0);
  // The back link frames the cut marker it came from.
  const r = back.targetRect!;
  assert.ok(r.x <= 300 && r.x + r.w >= 300 && r.y <= 300 && r.y + r.h >= 300, JSON.stringify(r));
  assert.equal(links.find((l) => l.pageIndex === 0)!.targetPage, 1);
});

test('a mark with no line work is found by the arrangement of its words', () => {
  const numbers = ['S-1', 'S-2'];
  const text = (cx: number, cy: number, id: string, sheet: string) => ({ segments: [], words: [word('DETAIL', cx, cy, 6), word(id, cx + 25, cy, 6), word(sheet, cx + 25, cy + 10, 6)] });
  const plan = page(text(100, 100, '1', 'S-2'), text(400, 200, '2', 'S-2'), { segments: [], words: [word('5', 700, 700)] });
  const pages = [plan, page()];
  const mark = teachMark(plan, { x: 80, y: 92, w: 60, h: 24 }, 'detailCallout', '', numbers);
  assert.equal(mark.lines.length, 0);
  const links = findMarks(pages, numbers, [mark]);
  assert.deepEqual(
    links.map((l) => l.label),
    ['1/S-2', '2/S-2'],
  );
  // Found by words alone, they are less certain than a shape match.
  assert.ok(links.every((l) => l.confidence < 0.75));
});

test('no taught marks, no candidates', () => {
  assert.deepEqual(findMarks([page(bubble(100, 100, '3', 'A-501'))], ['A-501'], []), []);
});

test('a section title that repeats its identifier (A-A) can be taught', () => {
  const p = page({ segments: [], words: [word('SECTION', 480, 200, 8), word('A-A', 510, 200, 8)] });
  const mark = teachMark(p, { x: 450, y: 190, w: 90, h: 20 }, 'sectionTitle', '', ['A-101']);
  assert.deepEqual(
    mark.words.map((w) => [w.role, w.text]),
    [
      ['text', 'SECTION'],
      ['detail', 'A-A'],
    ],
  );
});

test('a section title cut on its own sheet (a dash) links to the section mark with the same number', () => {
  const numbers = ['A-101'];
  const cutMark = (cx: number, cy: number, id: string) => ({ segments: [...bubble(cx, cy, id, null).segments], words: [word(id, cx, cy - 6, 8), word('-', cx, cy + 6, 8)] });
  const titleAt = (cx: number, cy: number, id: string) => ({ segments: [cx - 60, cy + 12, cx + 20, cy + 12], words: [word('SECTION', cx - 30, cy, 8), word(id, cx + 20, cy - 6, 8), word('-', cx + 20, cy + 6, 8)] });
  const sheet = page(cutMark(300, 600, '2'), cutMark(700, 600, '3'), titleAt(300, 200, '2'), titleAt(700, 200, '3'));
  const cut = teachMark(sheet, box(300, 600), 'sectionMark', '', numbers);
  const title = teachMark(sheet, { x: 255, y: 185, w: 100, h: 40 }, 'sectionTitle', '', numbers);
  const links = findMarks([sheet], numbers, [cut, title]);
  const back = links.find((l) => l.rect.y < 400 && l.detail === '2');
  assert.ok(back, JSON.stringify(links));
  assert.equal(back.targetPage, 0);
  const r = back.targetRect!;
  assert.ok(r.x <= 300 && r.x + r.w >= 300 && r.y <= 600 && r.y + r.h >= 600, JSON.stringify(r));
  assert.ok(r.x + r.w < 700, JSON.stringify(r));
});

test('a section mark and its title link to each other, each framing the other as taught', () => {
  const numbers = ['A-101'];
  const cutMark = (cx: number, cy: number, id: string) => ({ segments: [...bubble(cx, cy, id, null).segments], words: [word(id, cx, cy - 6, 8), word('-', cx, cy + 6, 8)] });
  const titleAt = (cx: number, cy: number, id: string) => ({ segments: [cx - 60, cy + 12, cx + 20, cy + 12], words: [word('SECTION', cx - 30, cy, 8), word(id, cx + 20, cy - 6, 8), word('-', cx + 20, cy + 6, 8)] });
  const sheet = page(cutMark(300, 600, '2'), titleAt(300, 200, '2'));
  const cutBox = box(300, 600);
  const titleBox = { x: 255, y: 185, w: 100, h: 40 };
  const cut = teachMark(sheet, cutBox, 'sectionMark', '', numbers);
  const title = teachMark(sheet, titleBox, 'sectionTitle', '', numbers);
  const links = findMarks([sheet], numbers, [cut, title]);
  const toTitle = links.find((l) => l.rect.y > 400)!;
  const toMark = links.find((l) => l.rect.y < 400)!;
  // The mark's link shows the section the title's rule sits under, which holds the title.
  const frame = toTitle.targetRect!;
  // The rule runs 240 to 320, so the section is that wide and rises above the title.
  assert.ok(frame.x === 240 && frame.w === 80 && frame.y < toMark.rect.y && frame.y + frame.h >= toMark.rect.y + toMark.rect.h, JSON.stringify(frame));
  assert.ok(frame.h > toMark.rect.h * 1.5, JSON.stringify(frame));
  // The title's link goes to the mark itself.
  assert.deepEqual(toMark.targetRect, toTitle.rect);
});

test('a title rule gives the extent of the section above it', () => {
  const box = { x: 100, y: 500, w: 90, h: 24 };
  // The rule is drawn in two strokes and runs a little past the title's box.
  const segs = [90, 520, 150, 520, 150, 520, 210, 520, 0, 40, 1000, 40];
  const f = sectionFrame(segs, box, 1224)!;
  assert.equal(f.x, 90);
  assert.equal(f.w, 120);
  assert.equal(f.y, 520 - 120 * 0.75);
  assert.ok(f.y + f.h >= 524);
  // A rule across most of the sheet is a border, not an underline.
  assert.equal(sectionFrame([0, 520, 1100, 520], box, 1224), null);
  assert.equal(sectionFrame([], box, 1224), null);
});

test('a section title with no underline, and a detail callout with the same letter, do not stand in for a cut', () => {
  const numbers = ['A-101'];
  // A detail callout "2" and a section title "2" on one sheet, taught as a callout and a title only: no cut exists.
  const callout = { segments: [...bubble(300, 600, '2', null).segments], words: [word('2', 300, 594, 8)] };
  const title = { segments: [], words: [word('SECTION', 480, 200, 8), word('2', 510, 200, 8)] };
  const sheet = page(callout, title);
  const c = teachMark(sheet, box(300, 600), 'detailCallout', '', numbers);
  const t = teachMark(sheet, { x: 450, y: 190, w: 90, h: 20 }, 'sectionTitle', '', numbers);
  const links = findMarks([sheet], numbers, [c, t]);
  assert.ok(!links.some((l) => l.rect.y < 400), JSON.stringify(links));
});
