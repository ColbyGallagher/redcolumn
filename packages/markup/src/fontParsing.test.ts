import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDefaultStyle } from './bluebeam.ts';
import { cssDeclaration, familyFromPdfName, findLengths, trimQuotesAndSpace } from './fonts.ts';

// Font strings come from imported files, so they are attacker-controlled: parsing must stay fast on awkward text.
const FAST_MS = 500;
const fast = (f: () => unknown) => {
  const t = performance.now();
  f();
  assert.ok(performance.now() - t < FAST_MS, 'took too long');
};

test('lengths are found like the old patterns found them', () => {
  assert.deepEqual(findLengths('Helvetica 12pt', ['pt']), [{ start: 10, end: 14, value: '12' }]);
  assert.deepEqual(findLengths('Arial 9.5 PX, 10px', ['pt', 'px']).map((l) => l.value), ['9.5', '10']);
  assert.deepEqual(findLengths('pt 12 pt', ['pt']).map((l) => l.value), ['12']);
  assert.deepEqual(findLengths('no size here', ['pt']), []);
});

test('quotes and spaces are trimmed at both ends only', () => {
  assert.equal(trimQuotesAndSpace(` '"Segoe UI" `), 'Segoe UI');
  assert.equal(trimQuotesAndSpace("Gill 'Sans' Mono"), "Gill 'Sans' Mono");
  assert.equal(trimQuotesAndSpace(' \t '), '');
});

test('declarations are read by property name', () => {
  assert.equal(cssDeclaration('color:#000; Font-Family: Calibri, sans-serif ;', ['font', 'font-family']), 'Calibri, sans-serif');
  assert.equal(cssDeclaration('font-size:12pt', ['font', 'font-family']), undefined);
});

test('a default style still reads its font', () => {
  assert.deepEqual(parseDefaultStyle('font: bold italic Arial 10pt; color:#ff0000'), { fontSize: 10, bold: true, italic: true, textColor: '#ff0000' });
  assert.equal(parseDefaultStyle("font-family:'Segoe UI', sans-serif").fontFamily, 'Segoe UI');
  assert.equal(parseDefaultStyle('font: Times New Roman,Bold 9pt').fontFamily, 'serif');
  assert.equal(familyFromPdfName('Calibri-BoldItalic'), 'Calibri');
  assert.equal(familyFromPdfName('ComicSansMS,Italic'), 'ComicSansMS');
  assert.equal(familyFromPdfName('Gill Sans MT'), 'Gill Sans MT');
});

test('pathological font strings are parsed quickly', () => {
  const inputs = ['1' + '.'.repeat(50000) + 'x', '\t'.repeat(50000) + 'x', '1pt'.repeat(20000), ',  '.repeat(20000), "'\"".repeat(30000) + 'a', '-bold'.repeat(30000), ' PS'.repeat(30000), 'a'.repeat(50000) + 'MT'];
  for (const s of inputs) {
    fast(() => parseDefaultStyle(`font: ${s}`));
    fast(() => parseDefaultStyle(`font-family: ${s}`));
    fast(() => familyFromPdfName(s));
    fast(() => findLengths(s, ['pt', 'px']));
    fast(() => trimQuotesAndSpace(s));
    fast(() => cssDeclaration(s, ['font']));
  }
});
