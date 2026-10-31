import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CHAINAGE_HINTS, detectChainageLinks, parsePlus, readChainages, readTicks, type ChainageHints } from './chainage.ts';
import type { PageText, SheetInfo, Word } from './types.ts';

function word(text: string, x: number, y: number, size = 8): Word {
  return { text, x0: x, y0: y - size, x1: x + text.length * size * 0.55, y1: y, size, angle: 0 };
}

/** Words for a phrase, left to right on one row. */
function phrase(text: string, x: number, y: number, size = 8): Word[] {
  const out: Word[] = [];
  let cx = x;
  for (const t of text.split(' ')) {
    out.push(word(t, cx, y, size));
    cx += (t.length + 1) * size * 0.55;
  }
  return out;
}

const page = (words: Word[]): PageText => ({ width: 3000, height: 2000, words });
const sheet = (number: string, title: string): SheetInfo => ({ number, title, discipline: null, scaleText: null, revision: null, source: 'standard', confidence: 1 });

/** Plan ticks along an alignment: `12+00` every `step` feet (or `1+200` every `step` metres). */
function ticks(from: number, to: number, step: number, metric = false, y = 1000, prefix = ''): Word[] {
  const out: Word[] = [];
  for (let v = from; v <= to; v += step) {
    const unit = metric ? 1000 : 100;
    const text = `${prefix}${Math.floor(v / unit)}+${String(v % unit).padStart(metric ? 3 : 2, '0')}`;
    out.push(word(text, 200 + (v - from) * (metric ? 2 : 1), y));
  }
  return out;
}

const pairs = (links: ReturnType<typeof detectChainageLinks>, numbers: string[]) => links.map((l) => [numbers[l.pageIndex], l.label, numbers[l.targetPage], l.confidence]);

test('chainages read as US stations, metric chainages and prefixed numbers', () => {
  assert.equal(parsePlus('598+59.00'), 59859);
  assert.equal(parsePlus('12+00'), 1200);
  assert.equal(parsePlus('1+250.000'), 1250);
  assert.equal(parsePlus('0+020'), 20);
  assert.equal(parsePlus('12+5'), null);
  const read = readChainages(page([...phrase('CH 1250.000', 100, 100), word('CH1300', 100, 200), word('STA:12+00', 100, 300), ...phrase('STA 14+50', 100, 400), word('(598+59.00)', 100, 500), ...phrase('CHANNEL 7', 100, 600)]), DEFAULT_CHAINAGE_HINTS);
  assert.deepEqual(
    read.map((c) => [c.value, c.prefixed]),
    [
      [1250, true],
      [1300, true],
      [1200, true],
      [1450, true],
      [59859, false],
    ],
  );
});

test('road set: a cross-section sheet at even stations is not a plan, and sections link both ways', () => {
  const numbers = ['C-101', 'C-102', 'C-301', 'G-001'];
  const pages = [
    page(ticks(1000, 2000, 100)),
    page(ticks(2000, 3000, 100)),
    // Sections every 50 ft, on even stations: #168 took this sheet for the narrowest plan.
    page([...phrase('STA 12+00', 300, 300), ...phrase('STA 12+50', 300, 600), ...phrase('STA 13+00', 300, 900), ...phrase('STA 13+50', 300, 1200)]),
    page([...phrase('TIE IN AT STA 12+75', 100, 100), ...phrase('SEE SECTION AT STA 12+50', 100, 200)]),
  ];
  const sheets = [sheet('C-101', 'PLAN AND PROFILE STA 10+00 TO 20+00'), sheet('C-102', 'PLAN AND PROFILE'), sheet('C-301', 'CROSS SECTIONS'), sheet('G-001', 'GENERAL NOTES')];
  const links = detectChainageLinks(pages, sheets, DEFAULT_CHAINAGE_HINTS, true);
  const from = (n: string) => pairs(links, numbers).filter((p) => p[0] === n);
  assert.deepEqual(from('G-001'), [
    ['G-001', 'STA 12+75', 'C-101', 0.85],
    ['G-001', 'STA 12+50', 'C-301', 0.85],
  ]);
  // Each section on the cross-section sheet goes to the plan that covers it.
  assert.deepEqual(
    from('C-301').map((p) => p[2]),
    ['C-101', 'C-101', 'C-101', 'C-101'],
  );
  // The plans' own ticks: 12+00 and 13+00 have sections; the rest are the plans themselves.
  assert.deepEqual(from('C-101'), [
    ['C-101', '12+00', 'C-301', 0.85],
    ['C-101', '13+00', 'C-301', 0.85],
  ]);
  const toSection = links.find((l) => l.label === 'STA 12+50' && l.targetPage === 2)!;
  assert.ok(toSection.targetRect && toSection.targetRect.y < 600 && toSection.targetRect.y + toSection.targetRect.h > 600, 'framed on the section');
});

test('two alignments with the same stations: each chainage goes to its own alignment', () => {
  const numbers = ['C-101', 'C-201', 'C-501'];
  const hints: ChainageHints = { ...DEFAULT_CHAINAGE_HINTS, alignments: ['MAINLINE', 'RAMP A'] };
  const pages = [
    page([...phrase('MAINLINE', 200, 900, 14), ...ticks(1000, 2000, 100)]),
    page([...phrase('RAMP A', 200, 900, 14), ...ticks(1000, 1500, 100)]),
    page([...phrase('MAINLINE STA 18+00', 100, 100), ...phrase('RAMP A STA 12+00', 100, 200), ...phrase('MATCH EXISTING AT STA 12+00', 100, 300)]),
  ];
  const sheets = [sheet('C-101', 'PLAN AND PROFILE'), sheet('C-201', 'PLAN AND PROFILE'), sheet('C-501', 'DETAILS')];
  const links = detectChainageLinks(pages, sheets, hints, true).filter((l) => l.pageIndex === 2);
  assert.deepEqual(pairs(links, numbers), [
    ['C-501', 'STA 18+00', 'C-101', 0.85],
    ['C-501', 'STA 12+00', 'C-201', 0.85],
    // No alignment named for this one: both plans at that chainage, for review.
    ['C-501', 'STA 12+00', 'C-101', 0.6],
    ['C-501', 'STA 12+00', 'C-201', 0.6],
  ]);
});

test('a table of stations is not a plan: its rows link to the plan, not the other way', () => {
  const numbers = ['C-101', 'V-002', 'S-501'];
  const pages = [page(ticks(1000, 2000, 100)), page(['10+00', '10+50', '11+00', '11+50', '12+00'].map((t, i) => word(t, 100, 100 + i * 20))), page(phrase('STA 11+20', 100, 100))];
  const sheets = [sheet('C-101', 'PLAN AND PROFILE'), sheet('V-002', 'SURVEY CONTROL'), sheet('S-501', 'DETAILS')];
  assert.deepEqual(
    pairs(detectChainageLinks(pages, sheets, DEFAULT_CHAINAGE_HINTS, true), numbers),
    [...['10+00', '10+50', '11+00', '11+50', '12+00'].map((t) => ['V-002', t, 'C-101', 0.85]), ['S-501', 'STA 11+20', 'C-101', 0.85]],
  );
});

test('ticks printed with their prefix run together still give the plan its stretch', () => {
  const numbers = ['C-102', 'S-501'];
  const pages = [page(ticks(3000, 4000, 100, false, 1000, 'STA')), page(phrase('STA 35+00', 100, 100))];
  const sheets = [sheet('C-102', 'PLAN AND PROFILE'), sheet('S-501', 'DETAILS')];
  assert.deepEqual(pairs(detectChainageLinks(pages, sheets, DEFAULT_CHAINAGE_HINTS, true), numbers), [['S-501', 'STA 35+00', 'C-102', 0.85]]);
});

test('metric chainage: plan and long section to cross section and back', () => {
  const numbers = ['DRG-100', 'DRG-200', 'DRG-300'];
  const hints: ChainageHints = { ...DEFAULT_CHAINAGE_HINTS, alignments: ['MC01'], planTitles: ['PLAN AND LONGITUDINAL SECTION'], sectionTitles: ['CROSS SECTIONS'] };
  const pages = [
    page([...phrase('MC01', 200, 900, 14), ...ticks(1200, 1400, 20, true), ...phrase('MC01 CH 1250.000', 600, 1200)]),
    page([...phrase('MC01 CH 1250.000', 300, 300), ...phrase('MC01 CH 1300.000', 300, 900)]),
    page(phrase('MC01 1+300.000', 100, 100)),
  ];
  const sheets = [sheet('DRG-100', 'MC01 PLAN AND LONGITUDINAL SECTION CH 1200 TO 1400'), sheet('DRG-200', 'MC01 CROSS SECTIONS SHEET 1'), sheet('DRG-300', 'PAVEMENT DETAILS')];
  const links = pairs(detectChainageLinks(pages, sheets, hints, true), numbers);
  assert.deepEqual(
    links.filter((p) => p[0] !== 'DRG-100'),
    [
      ['DRG-200', 'CH 1250.000', 'DRG-100', 0.85],
      ['DRG-200', 'CH 1300.000', 'DRG-100', 0.85],
      ['DRG-300', '1+300.000', 'DRG-200', 0.85],
    ],
  );
  // On the plan: the cut at 1250 and the 1+300 tick go to their cross sections.
  assert.deepEqual(
    links.filter((p) => p[0] === 'DRG-100'),
    [
      ['DRG-100', '1+300', 'DRG-200', 0.85],
      ['DRG-100', 'CH 1250.000', 'DRG-200', 0.85],
    ],
  );
});

test('without a drawing standard every chainage link waits for review', () => {
  const pages = [page(ticks(1000, 2000, 100)), page(phrase('STA 12+75', 100, 100))];
  const links = detectChainageLinks(pages, [sheet('C-101', 'PLAN AND PROFILE'), sheet('G-001', 'NOTES')]);
  assert.deepEqual(
    links.map((l) => [l.label, l.targetPage, l.confidence, l.kind]),
    [['STA 12+75', 0, 0.6, 'chainage']],
  );
});

/** A word turned a quarter turn, as plan ticks and grid labels often are. */
const upright = (text: string, x: number, y: number, size = 8): Word => ({ ...word(text, x, y, size), angle: -Math.PI / 2 });

test('bare plan ticks: an evenly stepped run along the alignment is chainage; a scale bar, grid labels and stray numbers are not', () => {
  // 101140 to 101240 every 20 m, 120 pt apart, bending gently as the road curves.
  const ticks = [101140, 101160, 101180, 101200, 101220, 101240].map((v, i) => upright(String(v), 600 + i * 120, 1500 - i * i * 4, 9));
  const scaleBar = [0, 10, 20, 30, 40, 50].map((v, i) => word(String(v), 2500 + i * 30, 1900, 6));
  // Eastings along the top and bottom of the frame.
  const grid = [590100, 590200, 590300, 590400, 590500].flatMap((v, i) => [word(String(v), 400 + i * 500, 30, 7), word(String(v), 400 + i * 500, 1985, 7)]);
  const stray = [word('20', 900, 700), word('20', 1300, 400), word('50', 1500, 800), word('0.000', 1800, 1400), ...phrase('TC 101184.655', 1000, 1300)];
  const read = readTicks(page([...ticks, ...scaleBar, ...grid, ...stray]));
  assert.deepEqual(
    read.map((c) => c.value),
    [101140, 101160, 101180, 101200, 101220, 101240],
  );
  // Too few to be a run.
  assert.deepEqual(readTicks(page(ticks.slice(0, 3))), []);
});

test('a cross section at CHAINAGE 101180 links to the plan whose bare ticks cover it, and the tick links back', () => {
  const numbers = ['RW-DRG-000022', 'RW-DRG-000011'];
  const plan = page([...phrase('ADJOINS SHEET', 100, 100), ...[101140, 101160, 101180, 101200, 101220, 101240].map((v, i) => upright(String(v), 600 + i * 120, 1500, 9))]);
  const section = page([...phrase('DATUM 224.0', 100, 500), ...phrase('-8.349 -7.150 0.000 3.500 7.000', 300, 900), ...phrase('CHAINAGE 101180', 1200, 1000, 12)]);
  const hints: ChainageHints = { ...DEFAULT_CHAINAGE_HINTS, planTitles: ['ROADWORKS PLAN'], sectionTitles: ['CROSS SECTIONS'] };
  const links = detectChainageLinks([plan, section], [sheet(numbers[0]!, 'MCR1 ROADWORKS PLAN SHEET 2'), sheet(numbers[1]!, 'MCR1 CROSS SECTIONS SHEET 11')], hints, true);
  assert.deepEqual(pairs(links, numbers), [
    ['RW-DRG-000022', '101180', 'RW-DRG-000011', 0.85],
    ['RW-DRG-000011', 'CHAINAGE 101180', 'RW-DRG-000022', 0.85],
  ]);
  // Without plan titles that fit, bare numbers are not read as ticks.
  assert.deepEqual(pairs(detectChainageLinks([plan, section], [sheet(numbers[0]!, 'GENERAL ARRANGEMENT'), sheet(numbers[1]!, 'MCR1 CROSS SECTIONS SHEET 11')], hints, true), numbers), []);
});
