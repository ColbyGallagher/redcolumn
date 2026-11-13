import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildFontList } from './fontList.ts';

const labels = (l: ReturnType<typeof buildFontList>) => l.map((e) => `${e.group}:${e.label}`);

test('lists the standard fonts, then recent, then installed', () => {
  const list = buildFontList({ recent: ['Segoe UI'], installed: ['Arial', 'Calibri', 'Segoe UI'] });
  assert.deepEqual(labels(list), ['standard:Helvetica / Arial', 'standard:Times New Roman', 'standard:Courier New', 'recent:Segoe UI', 'installed:Arial', 'installed:Calibri']);
});

test('shows a font once, in its earliest group, ignoring case', () => {
  const list = buildFontList({ recent: ['calibri'], installed: ['Calibri', 'Cambria'], current: 'CALIBRI' });
  const calibri = list.filter((e) => e.label.toLowerCase() === 'calibri');
  assert.equal(calibri.length, 1);
  assert.equal(calibri[0]!.group, 'recent');
});

test("keeps the document's own font in view even when it is not installed", () => {
  const list = buildFontList({ installed: ['Arial'], current: 'Gill Sans MT', missing: (f) => f === 'Gill Sans MT' });
  const own = list.find((e) => e.value === 'Gill Sans MT');
  assert.equal(own?.group, 'recent');
  assert.equal(own?.missing, true);
});

test('does not repeat a keyword as a named font', () => {
  assert.deepEqual(buildFontList({ recent: ['sans', 'serif'], installed: ['mono'] }).filter((e) => e.group !== 'standard'), []);
});

test('filters every group by part of the name, any case', () => {
  const list = buildFontList({ recent: ['Segoe Script'], installed: ['Segoe UI', 'Calibri'], filter: ' SEGOE ' });
  assert.deepEqual(labels(list), ['recent:Segoe Script', 'installed:Segoe UI']);
  assert.deepEqual(labels(buildFontList({ filter: 'courier' })), ['standard:Courier New']);
  assert.deepEqual(buildFontList({ installed: ['Arial'], filter: 'zzz' }), []);
});

test('gives each row its own face', () => {
  const row = buildFontList({ installed: ['Segoe UI'] }).find((e) => e.value === 'Segoe UI')!;
  assert.ok(row.css.startsWith('"Segoe UI"'));
});
