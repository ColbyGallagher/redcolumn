import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TYPE_INFO, type MarkupType } from '@nb/markup';
import { commonCapabilities, FOLLOW_START, followFormat, isMixed, styleMixed, type FormatFollow } from './selectionFormat.ts';

test('a mixed selection shares only the fields every type has', () => {
  // An area and a count both fill and label with a font; only the area hatches and dashes.
  const areaCount = commonCapabilities(['area', 'count']);
  assert.equal(areaCount.fill, true);
  assert.equal(areaCount.font, true);
  assert.equal(areaCount.hatch, false, 'a count has no hatch');
  assert.equal(areaCount.dash, false, 'a count has no line style');
  assert.equal(areaCount.arcRadius, null, 'only the count has a marker size');
  // Adding a text box keeps the font but loses nothing more; a rectangle has no font.
  const withText = commonCapabilities(['area', 'count', 'text']);
  assert.equal(withText.font, true);
  assert.equal(withText.label, false);
  const rectText = commonCapabilities(['rect', 'text']);
  assert.equal(rectText.fill && rectText.dash, true);
  assert.equal(rectText.hatch || rectText.font, false);
});

test('one type keeps its own capabilities, and no types share nothing', () => {
  assert.deepEqual(commonCapabilities(['area', 'area']), TYPE_INFO.area.caps);
  assert.equal(commonCapabilities([]).fill, false);
  const types: MarkupType[] = ['text', 'callout'];
  assert.equal(commonCapabilities(types).font, true);
});

test('values are mixed only when they differ', () => {
  assert.equal(isMixed([]), false);
  assert.equal(isMixed([1]), false);
  assert.equal(isMixed([0.5, 0.5, 0.5]), false);
  assert.equal(isMixed([0.5, 1]), true);
  assert.equal(isMixed([undefined, null]), false, 'unset and null are the same');
  assert.equal(isMixed([{ a: 1 }, { a: 1 }]), false);
  assert.equal(isMixed([{ a: 1 }, { a: 2 }]), true);
  const s = (dash?: 'dashed') => ({ style: { stroke: '#000', fill: null, width: 1, opacity: 1, dash } });
  assert.equal(styleMixed([s(), s('dashed')], 'dash'), true);
  assert.equal(styleMixed([s(), s('dashed')], 'dash', (d) => d ?? 'solid'), true);
  assert.equal(styleMixed([s(), s()], 'dash'), false);
  assert.equal(styleMixed([s(undefined), s('dashed')], 'width'), false);
});

const select = (s: FormatFollow, key: string, extra: { contextual?: boolean; busy?: boolean } = {}) => followFormat(s, { type: 'selection', key, contextual: true, busy: false, ...extra });

test('a selection goes to the Format tab, and clearing it goes back', () => {
  let s = select(FOLLOW_START, 'a');
  assert.deepEqual(s, { onFormat: true, auto: true, seen: 'a' });
  // Changing the selection while on the tab stays there.
  s = select(s, 'a,b');
  assert.equal(s.onFormat, true);
  s = select(s, '');
  assert.deepEqual(s, FOLLOW_START);
});

test('a tab picked while markups stay selected is respected until a new selection', () => {
  let s = select(FOLLOW_START, 'a');
  s = followFormat(s, { type: 'pick', format: false });
  assert.equal(s.onFormat, false);
  s = select(s, 'a');
  assert.equal(s.onFormat, false, 'the same selection does not pull them back');
  s = select(s, 'a,b');
  assert.equal(s.onFormat, true, 'a new selection does');
  s = followFormat(s, { type: 'pick', format: false });
  s = select(s, '');
  assert.equal(s.onFormat, false);
});

test('clearing does not move someone who picked the Format tab themselves', () => {
  let s = followFormat(FOLLOW_START, { type: 'pick', format: true });
  assert.equal(s.auto, false);
  s = select(s, 'a');
  s = select(s, '');
  assert.equal(s.onFormat, true);
  // Clicking the tab it already shows leaves the switch automatic.
  s = select(FOLLOW_START, 'a');
  s = followFormat(s, { type: 'pick', format: true });
  assert.equal(s.auto, true);
});

test('nothing switches mid-gesture, and the switch follows when it ends', () => {
  let s = select(FOLLOW_START, 'a', { busy: true });
  assert.deepEqual(s, FOLLOW_START);
  s = select(s, 'a');
  assert.equal(s.onFormat, true);
  // Without anything to format nothing switches (until there is).
  s = select(FOLLOW_START, 'a', { contextual: false });
  assert.deepEqual(s, FOLLOW_START);
  // Clearing while busy still goes back.
  s = select(select(FOLLOW_START, 'a'), '', { busy: true });
  assert.equal(s.onFormat, false);
  assert.equal(followFormat(select(FOLLOW_START, 'a'), { type: 'gone' }).onFormat, false);
});

test('a tool brings the Format tab forward, and putting it down goes back', () => {
  let s = followFormat(FOLLOW_START, { type: 'tool', active: true, contextual: true });
  assert.deepEqual([s.onFormat, s.auto], [true, true]);
  s = followFormat(s, { type: 'tool', active: false, contextual: true });
  assert.deepEqual([s.onFormat, s.auto], [false, false]);
  // A tool with nothing to format leaves the tab alone.
  assert.deepEqual(followFormat(FOLLOW_START, { type: 'tool', active: true, contextual: false }), FOLLOW_START);
});

test('a Format tab the user picked is not taken back when the tool is put down', () => {
  let s = followFormat(FOLLOW_START, { type: 'pick', format: true });
  s = followFormat(s, { type: 'tool', active: true, contextual: true });
  s = followFormat(s, { type: 'tool', active: false, contextual: true });
  assert.equal(s.onFormat, true);
  // Picking another tab while the tool is active keeps that tab.
  s = followFormat(FOLLOW_START, { type: 'tool', active: true, contextual: true });
  s = followFormat(s, { type: 'pick', format: false });
  s = followFormat(s, { type: 'tool', active: false, contextual: true });
  assert.equal(s.onFormat, false);
});
