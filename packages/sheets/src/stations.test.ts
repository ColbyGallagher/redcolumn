import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectStationLinks, formatStation, parseStation, sheetStationRanges } from './stations.ts';
import { detectLinks } from './links.ts';
import type { PageText, Word } from './types.ts';

const W = 2592;
const H = 1728;

function word(text: string, x: number, y: number, size = 8): Word {
  return { text, x0: x, y0: y - size, x1: x + text.length * size * 0.6, y1: y, size, angle: 0 };
}

function titleBlock(number: string): Word[] {
  return [word('SHEET', 2450, 1650, 7), word(number, 2450, 1700, 28)];
}

/** A plan sheet: even station ticks every 100 ft from `from`, `count` of them, with odd match-line stations at either end when given. */
function plan(number: string, from: number, count: number, ends: { start?: number; end?: number } = {}, extras: Word[] = []): PageText {
  const ticks = Array.from({ length: count }, (_, i) => word(formatStation(from + i * 100), 300 + i * 300, 900));
  if (ends.start !== undefined) ticks.unshift(word(formatStation(ends.start), 200, 900));
  if (ends.end !== undefined) ticks.push(word(formatStation(ends.end), 300 + count * 300, 900));
  return { width: W, height: H, words: [...ticks, ...extras, ...titleBlock(number)] };
}

function sheet(number: string, words: Word[]): PageText {
  return { width: W, height: H, words: [...words, ...titleBlock(number)] };
}

test('station text parses in the forms sheets print it', () => {
  assert.equal(parseStation('598+59.00'), 59859);
  assert.equal(parseStation('STA:598+59.00'), 59859);
  assert.equal(parseStation('STA.12+00'), 1200);
  assert.equal(parseStation('(610+10.00)'), 61010);
  assert.equal(parseStation('598+59.00,'), 59859);
  assert.equal(parseStation('C-4017'), null);
  assert.equal(parseStation('1+2'), null);
  assert.equal(parseStation('12-00'), null);
  assert.equal(formatStation(59859), '598+59.00');
  assert.equal(formatStation(61010), '610+10.00');
  assert.equal(formatStation(1200.5), '12+00.50');
});

test('plan sheets get a station range from their ticks; sections sheets and short runs do not', () => {
  const pages = [
    plan('P-4010', 46700, 5, { end: 47160 }),
    plan('P-4011', 47200, 5, { start: 47160 }),
    // A sections sheet lists odd stations: not coverage, though there are five of them.
    sheet('P-3008', ['598+59.00', '601+54.67', '604+88.70', '610+10.00', '611+80.00'].map((t, i) => word(t, 300 + i * 300, 700))),
    // A section's own chainage runs 0+00 to 0+20: too short to be sheet coverage.
    sheet('S-5002', ['0+00', '0+05', '0+10', '0+15', '0+20'].map((t, i) => word(t, 300 + i * 100, 700))),
    // Mentions introduced by STA are not ticks.
    sheet('CD-4015', ['STA', '588+49.91', 'STA', '589+21.00', 'STA', '590+00.00', 'STA', '591+00.00'].map((t, i) => word(t, 300 + i * 100, 700))),
  ];
  const ranges = sheetStationRanges(pages);
  assert.deepEqual(ranges[0], { from: 46700, to: 47160, ticks: 5 });
  assert.deepEqual(ranges[1], { from: 47160, to: 47600, ticks: 5 });
  assert.equal(ranges[2], null);
  assert.equal(ranges[3], null);
  assert.equal(ranges[4], null);
});

test('a station mentioned on a section links to the plan that covers it, framed at the nearest tick', () => {
  const pages = [
    plan('P-4010', 46700, 5, { end: 47160 }),
    plan('P-4011', 47200, 5, { start: 47160 }),
    sheet('P-3004', [word('SECTION', 300, 700, 12), word('@', 360, 700, 12), word('STA', 380, 700, 12), word('470+50.00', 420, 700, 12), word('STA:471+60.00', 300, 1000)]),
  ];
  const numbers = pages.map((p) => p.words[p.words.length - 1]!.text);
  const links = detectStationLinks(pages, numbers);
  assert.deepEqual(
    links.map((l) => [l.pageIndex, l.label, l.anchor, numbers[l.targetPage], l.kind, l.confidence]),
    [
      [2, '470+50.00', '470+50.00', 'P-4010', 'station', 0.85],
      // A boundary station is on both adjoining plans.
      [2, 'STA:471+60.00', '471+60.00', 'P-4010', 'station', 0.85],
      [2, 'STA:471+60.00', '471+60.00', 'P-4011', 'station', 0.85],
    ],
  );
  // Framed around the 470+00 tick (the nearest) on P-4010.
  const frame = links[0]!.targetRect!;
  const tick = pages[0]!.words.find((w) => w.text === '470+00.00')!;
  assert.ok(frame.x < tick.x0 && frame.x + frame.w > tick.x1 && frame.y < tick.y0 && frame.y + frame.h > tick.y1);
});

test("a plan's own stations are not links out; a discipline without plans links to every discipline that covers", () => {
  const pages = [
    plan('C-410', 46700, 5),
    plan('P-410', 46700, 5, {}, [word('STA', 300, 1200), word('468+00.00', 340, 1200), word('STA', 300, 1300), word('480+00.00', 340, 1300)]),
    plan('P-412', 47700, 5),
    sheet('CD-410', [word('REMOVE', 300, 700), word('VALVE', 360, 700), word('STA', 420, 700), word('468+50', 460, 700)]),
  ];
  const numbers = ['C-410', 'P-410', 'P-412', 'CD-410'];
  const links = detectStationLinks(pages, numbers);
  assert.deepEqual(
    links.map((l) => [numbers[l.pageIndex], l.label, numbers[l.targetPage], l.confidence]),
    [
      // 468+00 is on P-4010 itself: no link. 480+00 is off this sheet: a link to the plan that has it.
      ['P-410', '480+00.00', 'P-412', 0.85],
      // Civil demolition has no plans of its own, so both covering disciplines are offered.
      ['CD-410', '468+50', 'C-410', 0.8],
      ['CD-410', '468+50', 'P-410', 0.8],
    ],
  );
});

test('a key plan spanning the whole alignment does not take station links from the plan sheets', () => {
  const key = plan('C-1000', 42500, 8); // 425+00 .. 432+00 in 100 ft ticks: a long overview
  const pages = [key, plan('C-4001', 42500, 4), plan('C-4002', 42900, 4), sheet('S-5002', [word('STA', 300, 700), word('429+50', 340, 700)])];
  const numbers = ['C-1000', 'C-4001', 'C-4002', 'S-5002'];
  const links = detectStationLinks(pages, numbers);
  assert.deepEqual(
    links.map((l) => numbers[l.targetPage]),
    ['C-4002'],
  );
});

test('detectLinks includes station links beside sheet references', () => {
  const pages = [plan('P-4010', 46700, 5), sheet('P-3004', [word('SEE', 300, 700), word('SHEET', 330, 700), word('P-4010', 380, 700), word('STA', 300, 800), word('469+00', 340, 800)])];
  const kinds = detectLinks(pages, ['P-4010', 'P-3004'])
    .filter((l) => l.pageIndex === 1)
    .map((l) => l.kind)
    .sort();
  assert.deepEqual(kinds, ['sheet', 'station']);
});
