import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_CHAINAGE_HINTS, DEFAULT_LINK_HINTS, type SheetInfo, type Word } from '@nb/sheets';
import { backgroundLines, boxContents, findMarks, type MarkPage } from './marks.ts';
import { idForm, learnChainage, learnLink, titleWords, type TaughtBox } from './teachLinks.ts';

const word = (text: string, cx: number, cy: number, size = 6): Word => {
  const w = text.length * size * 0.55;
  return { text, x0: cx - w / 2, y0: cy - size / 2, x1: cx + w / 2, y1: cy + size / 2, size, angle: 0 };
};

/** A section mark: a bubble split across, the letter above and the cited sheet below. */
function cut(cx: number, cy: number, id: string, sheet: string, r = 12) {
  const segments: number[] = [];
  const n = 24;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const b = ((i + 1) / n) * Math.PI * 2;
    segments.push(cx + r * Math.cos(a), cy + r * Math.sin(a), cx + r * Math.cos(b), cy + r * Math.sin(b));
  }
  segments.push(cx - r, cy, cx + r, cy);
  return { segments, words: [word(id, cx, cy - r / 2), word(sheet, cx, cy + r / 2, 4)] };
}

/** A section title: SECTION, the letter, and an underline. */
const title = (cx: number, cy: number, id: string, words = 'SECTION') => ({ segments: [cx - 80, cy + 12, cx + 30, cy + 12], words: [word(words, cx + 14 - (words.length * 3.3) / 2, cy), word(id, cx + 20, cy)] });

function page(...parts: { segments: number[]; words: Word[] }[]): MarkPage {
  return { width: 1224, height: 792, words: parts.flatMap((p) => p.words), segments: new Float32Array(parts.flatMap((p) => p.segments)) };
}

const at = (p: MarkPage, pageIndex: number, box: { x: number; y: number; w: number; h: number }): TaughtBox => ({ page: p, pageIndex, box, contents: boxContents(p, box) });
const square = (cx: number, cy: number, r = 14) => ({ x: cx - r, y: cy - r, w: 2 * r, h: 2 * r });

test('background line work: lines running out of the box and dashes along them are left out; the bubble round the label stays', () => {
  // A road edge across the box, a dashed centreline along another line that leaves it, and the mark.
  const road = { segments: [60, 95, 140, 95, 140, 95, 160, 120], words: [] };
  const dashes = { segments: [60, 108, 80, 108, 85, 108, 95, 108, 100, 108, 110, 108, 115, 108, 140, 108], words: [] };
  const p = page(cut(100, 100, 'C', '000022'), road, dashes);
  const box = square(100, 100, 16);
  const contents = boxContents(p, box);
  const drop = backgroundLines(p, box, contents);
  const kept = contents.lines.filter((_, i) => !drop.has(i));
  // 24 arcs and the split line; the road's pieces and the dashes inside the box are gone.
  assert.equal(kept.length, 25, JSON.stringify(contents.lines.filter((_, i) => drop.has(i))));
  // With nothing leaving the box there is nothing to clean.
  assert.equal(backgroundLines(page(cut(100, 100, 'C', '000022')), box, boxContents(page(cut(100, 100, 'C', '000022')), box)).size, 0);
});

test('a section mark and its title teach the part of the number callouts cite, and the mark is then found across the set', () => {
  const numbers = ['SBUCD-WSPAU-0001-RW-DRG-000011', 'SBUCD-WSPAU-0002-RW-DRG-000022'];
  // Callouts cite the 0002 part here, not the last: the client's own habit.
  const plan = page(cut(100, 100, 'C', '0002'), cut(300, 100, 'D', '0002'));
  const sections = page(title(500, 400, 'C'), title(500, 600, 'D'));
  const lesson = learnLink('section', at(plan, 0, square(100, 100)), at(sections, 1, { x: 410, y: 385, w: 130, h: 30 }), numbers, DEFAULT_LINK_HINTS, '');
  assert.equal(lesson.problem, null, lesson.notes.join(' '));
  assert.equal(lesson.links?.calloutPart, 2);
  assert.deepEqual(
    lesson.marks.map((m) => [m.kind, m.name]),
    [
      ['sectionMark', 'Section mark'],
      ['sectionTitle', 'Section title'],
    ],
  );
  assert.ok(lesson.notes.some((n) => /part 3/.test(n)), lesson.notes.join(' '));
  // Both cuts link to their titles on the other sheet.
  const links = findMarks([plan, sections], numbers, lesson.marks, lesson.links!).filter((l) => l.pageIndex === 0);
  assert.deepEqual(links.map((l) => [l.label, l.targetPage, l.kind]).sort(), [
    ['C/0002', 1, 'section'],
    ['D/0002', 1, 'section'],
  ]);
});

test("identifiers written the client's own way are learned from the word both boxes print", () => {
  const numbers = ['A-101', 'A-501'];
  const plan = page(cut(100, 100, 'DT3', 'A-501'));
  const details = page(title(500, 400, 'DT3', 'DETAIL'));
  const lesson = learnLink('detail', at(plan, 0, square(100, 100)), at(details, 1, { x: 410, y: 385, w: 130, h: 30 }), numbers, DEFAULT_LINK_HINTS, 'Bubble');
  assert.equal(lesson.problem, null);
  assert.ok(lesson.links?.ids?.includes('@@#'), JSON.stringify(lesson.links?.ids));
  // The usual forms are kept alongside.
  assert.ok(lesson.links?.ids?.includes('@'));
  assert.deepEqual(lesson.marks.map((m) => m.name), ['Bubble mark', 'Bubble title']);
  assert.equal(idForm('DT3'), '@@#');
  assert.equal(idForm('A#1'), '@\\##');
});

test('a pair that does not agree is not kept', () => {
  const numbers = ['A-101', 'A-501', 'A-502'];
  const plan = page(cut(100, 100, 'C', 'A-501'));
  // The title says D.
  const wrongTitle = learnLink('section', at(plan, 0, square(100, 100)), at(page(title(500, 400, 'D')), 1, { x: 410, y: 385, w: 130, h: 30 }), numbers, DEFAULT_LINK_HINTS, '');
  assert.match(wrongTitle.problem ?? '', /says C but the title says D/);
  // The title is on another sheet than the one the mark names.
  const wrongSheet = learnLink('section', at(plan, 0, square(100, 100)), at(page(title(500, 400, 'C')), 2, { x: 410, y: 385, w: 130, h: 30 }), numbers, DEFAULT_LINK_HINTS, '');
  assert.match(wrongSheet.problem ?? '', /points to A-501.*A-502/);
  assert.deepEqual(wrongSheet.marks, []);
});

test("an elevation pair learns the words in front of the client's elevation titles", () => {
  const numbers = ['A-101', 'A-301'];
  const plan = page(cut(100, 100, '2', 'A-301'));
  const elevations = page(title(500, 400, '2', 'VIEW'));
  const lesson = learnLink('elevation', at(plan, 0, square(100, 100)), at(elevations, 1, { x: 410, y: 385, w: 130, h: 30 }), numbers, DEFAULT_LINK_HINTS, '');
  assert.equal(lesson.problem, null);
  assert.deepEqual(lesson.links?.titles.elevation, ['ELEVATION', 'VIEW']);
  assert.deepEqual(lesson.marks.map((m) => m.kind), ['elevationMark', 'elevationTitle']);
  const links = findMarks([plan, elevations], numbers, lesson.marks, lesson.links!);
  assert.deepEqual(links.filter((l) => l.pageIndex === 0).map((l) => [l.label, l.kind, l.targetPage]), [['2/A-301', 'elevation', 1]]);
});

test('chainage: a cross section at CHAINAGE 101180 and the same bare tick on the plan teach title words, and link', () => {
  const sheet = (title: string): SheetInfo => ({ number: null, title, discipline: null, scaleText: null, revision: null, source: 'standard', confidence: 1 });
  const upright = (t: string, x: number, y: number): Word => ({ ...word(t, x, y, 9), angle: -Math.PI / 2 });
  const plan: MarkPage = { width: 3000, height: 2000, words: [101140, 101160, 101180, 101200, 101220, 101240].map((v, i) => upright(String(v), 600 + i * 120, 1500)), segments: new Float32Array() };
  const section: MarkPage = { width: 3000, height: 2000, words: [word('CHAINAGE', 1200, 1000, 12), word('101180', 1270, 1000, 12), word('0.000', 900, 900)], segments: new Float32Array() };
  const sheets = [sheet('MCR1 ROADWORKS PLAN SHEET 2'), sheet('MCR1 CROSS SECTIONS SHEET 11')];
  const lesson = learnChainage(at(section, 1, { x: 1150, y: 980, w: 160, h: 40 }), at(plan, 0, { x: 820, y: 1480, w: 40, h: 40 }), sheets, DEFAULT_CHAINAGE_HINTS);
  assert.equal(lesson.problem, null, lesson.notes.join(' '));
  // CROSS SECTIONS is a default title; the plan's title words are new.
  assert.deepEqual(lesson.chainage?.planTitles.at(-1), 'ROADWORKS PLAN');
  assert.ok(lesson.notes.at(-1)!.includes('links to the plan'), lesson.notes.join(' '));
  // Different values, or a bare number on the cross section, are refused.
  assert.match(learnChainage(at(section, 1, { x: 1150, y: 980, w: 160, h: 40 }), at(plan, 0, { x: 700, y: 1480, w: 40, h: 40 }), sheets, DEFAULT_CHAINAGE_HINTS).problem ?? '', /101180 but the plan box says 101160/);
  assert.match(learnChainage(at(section, 1, { x: 1250, y: 980, w: 50, h: 40 }), at(plan, 0, { x: 820, y: 1480, w: 40, h: 40 }), sheets, DEFAULT_CHAINAGE_HINTS).problem ?? '', /word in front/);
});

test('title words: the run without numbers that sister sheets share', () => {
  assert.equal(titleWords('MCR1 ROADWORKS PLAN SHEET 2'), 'ROADWORKS PLAN');
  assert.equal(titleWords('CROSS SECTIONS CH 101000 TO 101200'), 'CROSS SECTIONS');
  assert.equal(titleWords('Plan and longitudinal section'), 'PLAN AND LONGITUDINAL SECTION');
  assert.equal(titleWords('101180'), null);
  assert.equal(titleWords(null), null);
});
