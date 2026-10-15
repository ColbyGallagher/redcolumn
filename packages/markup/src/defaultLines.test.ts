import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_LINE_SETS } from './defaultLines.ts';
import { documentLineStyles } from './lineSet.ts';
import { lineArt, lineStyleReach, readLineStyle, type CustomLine } from './lineStyle.ts';
import { DEFAULT_STYLES, type Markup } from './model.ts';

const measure = (text: string, _f: string, _b: boolean, _i: boolean, size: number) => text.length * size * 0.5;
const all = DEFAULT_LINE_SETS.flatMap((s) => s.styles);

test('every built-in line style draws something along a line', () => {
  assert.ok(all.length >= 30, 'a good spread is built in');
  for (const style of all) {
    const art = lineArt([['M', 0, 100], ['L', 300, 100]], style, 1.5, measure);
    assert.ok(art, `${style.name} compiles`);
    assert.ok(art.stroke.length + art.texts.length > 0, `${style.name} draws`);
    assert.ok(art.stroke.every((c) => c.slice(1).every((n) => typeof n === 'number' && Number.isFinite(n))), `${style.name} has finite points`);
    assert.ok(lineStyleReach(style, 1.5) >= 1.5, `${style.name} has a reach`);
  }
});

test('built-in line style names are unique within a set and the sets are titled', () => {
  for (const set of DEFAULT_LINE_SETS) {
    assert.ok(set.title);
    assert.equal(new Set(set.styles.map((s) => s.name)).size, set.styles.length, set.title);
  }
});

test('a built-in style survives the trip through a PDF dictionary read', () => {
  for (const style of all) assert.deepEqual(readLineStyle(style.spec as never, style.name)?.spec, style.spec);
});

test('document line styles list what the markups bring that is not already known', () => {
  const gas = all.find((s) => s.name === 'Gas')!;
  const mine: CustomLine = { name: 'Mine', spec: [true, [0, 5, -5]] };
  const other: CustomLine = { name: 'Mine', spec: [true, [0, 6, -5]] };
  const markup = (lineStyle?: CustomLine): Markup => ({ ...({} as Markup), id: Math.random().toString(), style: { ...DEFAULT_STYLES.line, ...(lineStyle ? { lineStyle } : {}) } });
  const found = documentLineStyles([markup(), markup(gas), markup(mine), markup(mine), markup(other)], all);
  assert.deepEqual(found, [mine, other], 'known and repeated styles are left out; a same-named different pattern stays');
});
