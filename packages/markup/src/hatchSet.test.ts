import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hatchDraw, HATCH_PATTERNS, resolveHatch, type HatchSpec } from './hatches.ts';
import { parseBhx } from './hatchSet.ts';

const SET = `\uFEFF<?xml version="1.0" encoding="utf-8"?>
<BluebeamRevuHatchSet Version="1">
  <Title>789c0b2e49cc4b492c4a01000e330332</Title>
  <Hatch Name="Horizontal">
    <ScaleX>1</ScaleX>
    <ScaleY>1</ScaleY>
    <Size>QuarterInch</Size>
    <LineWidth>1</LineWidth>
    <Element Type="Line" X1="-0.05555556" Y1="0.75" X2="1.055556" Y2="0.75" />
    <Element Type="Line" X1="-0.05555556" Y1="0.25" X2="1.055556" Y2="0.25" />
  </Hatch>
  <Hatch Name="Pips">
    <ScaleX>2</ScaleX>
    <ScaleY>1</ScaleY>
    <Size>HalfInch</Size>
    <LineWidth>2</LineWidth>
    <Element Type="Dot" X="0.5" Y="0.5" Size="Large" />
    <Element Type="Dot" X="0" Y="0" Size="Small" />
    <Element Type="Squiggle" X="0" Y="0" />
  </Hatch>
  <Hatch Name="Empty" />
</BluebeamRevuHatchSet>`;

test('a .bhx set reads its hatches, tile size and elements', async () => {
  const set = await parseBhx(SET);
  assert.equal(set.title, 'Standard');
  assert.equal(set.hatches[0]!.builtIn, 'horizontal', "Revu's Horizontal is the built-in one");
  assert.equal(set.hatches[1]!.builtIn, null);
  assert.deepEqual(
    set.hatches.map((h) => [h.name, h.id]),
    [
      ['Horizontal', 'set:Standard/Horizontal'],
      ['Pips', 'set:Standard/Pips'],
    ],
    'a hatch with nothing to draw is left out',
  );
  const pips = set.hatches[1]!.spec;
  assert.deepEqual(pips, {
    scaleX: 2,
    scaleY: 1,
    size: 36,
    lineWidth: 2,
    elements: [
      { type: 'dot', x: 0.5, y: 0.5, size: 'large' },
      { type: 'dot', x: 0, y: 0, size: 'small' },
    ],
  });
});

test('an imported hatch draws from the spec it carries, and nothing without it', async () => {
  const [h] = (await parseBhx(SET)).hatches;
  assert.equal(resolveHatch(h!.id), null);
  const draw = hatchDraw(h!.id, 100, h!.spec)!;
  assert.equal(draw.metrics.cellW, 18);
  assert.equal(draw.lines.length, 2);
  // Scale applies to the tile as it does for the built-in set.
  assert.equal(hatchDraw(h!.id, 200, h!.spec)!.metrics.cellW, 36);
});

test('other XML is refused', async () => {
  await assert.rejects(parseBhx('<BluebeamRevuLineStyleSet />'), /hatch set/);
  await assert.rejects(parseBhx('<BluebeamRevuHatchSet><Hatch>'), /hatch set/);
});

// Run with REVU_SETTINGS_DIR pointing at a Revu settings folder (e.g. …/Bluebeam Software/Revu/21).
const dir = process.env.REVU_SETTINGS_DIR;
test('Revu\'s Standard.bhx is the built-in hatch set', { skip: !dir }, async () => {
  const set = await parseBhx(readFileSync(`${dir}/Standard.bhx`, 'utf8'));
  assert.equal(set.hatches.length, HATCH_PATTERNS.length - 1);
  assert.ok(set.hatches.every((h) => h.builtIn), 'every hatch in it is a built-in one');
  const key = (s: HatchSpec) =>
    JSON.stringify({
      ...s,
      elements: s.elements.map((e) => (e.type === 'line' ? [e.type, e.x1, e.y1, e.x2, e.y2].map((v) => (typeof v === 'number' ? Math.round(v * 1e5) / 1e5 : v)) : [e.type, Math.round(e.x * 1e5) / 1e5, Math.round(e.y * 1e5) / 1e5, e.size])).map((e) => JSON.stringify(e)).sort(),
    });
  for (const h of set.hatches) {
    const builtIn = HATCH_PATTERNS.find((p) => p.label === h.name);
    assert.ok(builtIn, `${h.name} is a built-in hatch`);
    const mine = resolveHatch(builtIn.value)!;
    assert.equal(key(h.spec), key({ scaleX: mine.scaleX, scaleY: mine.scaleY, size: mine.size, lineWidth: mine.lineWidth, elements: mine.elements }), h.name);
  }
});
