import { test } from 'node:test';
import assert from 'node:assert/strict';
import { argNames, formatIcu, formatIcuParts, IcuSyntaxError, parseIcu } from './icu.ts';

const fmt = (src: string, values: Record<string, unknown> = {}, locale = 'en') => formatIcu(parseIcu(src), values, locale);

test('plain text and arguments', () => {
  assert.equal(fmt('Save all'), 'Save all');
  assert.equal(fmt('Open {name}?', { name: 'A-101.pdf' }), 'Open A-101.pdf?');
  assert.equal(fmt('Missing {name}'), 'Missing {name}');
});

test('numbers follow the locale', () => {
  assert.equal(fmt('{n} pages', { n: 1234.5 }, 'en'), '1,234.5 pages');
  assert.equal(fmt('{n} Seiten', { n: 1234.5 }, 'de'), '1.234,5 Seiten');
  assert.equal(fmt('{n, number, integer}', { n: 2.6 }, 'en'), '3');
  assert.equal(fmt('{n, number, percent}', { n: 0.25 }, 'en'), '25%');
});

test('plurals use the language rules, with exact matches first', () => {
  const en = '{count, plural, =0 {No markups} one {# markup} other {# markups}}';
  assert.equal(fmt(en, { count: 0 }), 'No markups');
  assert.equal(fmt(en, { count: 1 }), '1 markup');
  assert.equal(fmt(en, { count: 1200 }), '1,200 markups');
  const ru = '{n, plural, one {# лист} few {# листа} many {# листов} other {# листа}}';
  assert.equal(fmt(ru, { n: 1 }, 'ru'), '1 лист');
  assert.equal(fmt(ru, { n: 3 }, 'ru'), '3 листа');
  assert.equal(fmt(ru, { n: 5 }, 'ru'), '5 листов');
  const ar = '{n, plural, zero {z} one {o} two {t} few {f} many {m} other {x}}';
  assert.deepEqual([0, 1, 2, 3, 11, 100].map((n) => fmt(ar, { n }, 'ar')), ['z', 'o', 't', 'f', 'm', 'x']);
});

test('ordinals and select', () => {
  const ord = '{n, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}';
  assert.deepEqual([1, 2, 3, 4, 11, 22].map((n) => fmt(ord, { n })), ['1st', '2nd', '3rd', '4th', '11th', '22nd']);
  const sel = '{kind, select, area {Area} length {Length} other {Count}}';
  assert.equal(fmt(sel, { kind: 'area' }), 'Area');
  assert.equal(fmt(sel, { kind: 'volume' }), 'Count');
});

test('# outside a plural and nested arguments', () => {
  assert.equal(fmt('Sheet #{n}', { n: 4 }), 'Sheet #4');
  assert.equal(fmt('{n, plural, one {# sheet in {set}} other {# sheets in {set}}}', { n: 2, set: 'IFC' }), '2 sheets in IFC');
});

test('apostrophes', () => {
  assert.equal(fmt("Don't save"), "Don't save");
  assert.equal(fmt("Type '{name}' literally"), 'Type {name} literally');
  assert.equal(fmt("It''s"), "It's");
  assert.equal(fmt("{n, plural, other {'#' is # }}", { n: 3 }), '# is 3 ');
});

test('rich parts keep non-string values', () => {
  const el = { type: 'kbd' };
  assert.deepEqual(formatIcuParts(parseIcu('Press {key} to {action}'), { key: el, action: 'pan' }, 'en'), ['Press ', el, ' to pan']);
});

test('syntax errors', () => {
  for (const bad of ['{', '}', '{n, plural, one {x}}', '{n, wat}', '{n, plural, one {a} one {b} other {c}}', '{ }'])
    assert.throws(() => parseIcu(bad), IcuSyntaxError, bad);
});

test('argNames collects nested names', () => {
  assert.deepEqual([...argNames(parseIcu('{a} {n, plural, one {{b}} other {{c, select, x {{d}} other {}}}}'))].sort(), ['a', 'b', 'c', 'd', 'n']);
});

test('false and null values show nothing, as they do in JSX', () => {
  assert.equal(formatIcu(parseIcu('Read on 3 sheets{note}'), { note: false }, 'en'), 'Read on 3 sheets');
  assert.equal(formatIcu(parseIcu('a{x}b'), { x: null }, 'en'), 'ab');
  assert.equal(formatIcu(parseIcu('a{x}b'), { x: true }, 'en'), 'atrueb');
});
