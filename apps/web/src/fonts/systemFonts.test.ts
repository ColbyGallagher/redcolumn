import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_STYLES, type Markup } from '@nb/markup';
import { isBundledFont, namedFontUses, pickStyle, splitBrowserFontFamily } from './systemFonts.ts';

const styles = [
  { style: 'Light', bold: false, italic: false },
  { style: 'Regular', bold: false, italic: false },
  { style: 'Italic', bold: false, italic: true },
  { style: 'Semibold', bold: true, italic: false },
  { style: 'Bold', bold: true, italic: false },
];

test('a style is picked by weight and slant, preferring the plain names', () => {
  assert.equal(pickStyle(styles, false, false)?.style, 'Regular');
  assert.equal(pickStyle(styles, true, false)?.style, 'Bold');
  assert.equal(pickStyle(styles, false, true)?.style, 'Italic');
  assert.equal(pickStyle(styles, true, true)?.style, 'Bold');
  assert.equal(pickStyle([], false, false), null);
});

test('named fonts in use are found with the variants they need', () => {
  const m = (fontFamily: string, extra = {}): Markup => ({ id: fontFamily, type: 'text', pageIndex: 0, points: [[0, 0], [10, 10]], style: { ...DEFAULT_STYLES.text, fontFamily, ...extra }, status: 'none', author: '', createdAt: 0, modifiedAt: 0 });
  const uses = namedFontUses([m('Segoe UI'), m('Segoe UI', { bold: true }), m('serif'), m('Calibri', { italic: true })]);
  assert.deepEqual([...uses.keys()].sort(), ['Calibri', 'Segoe UI']);
  assert.ok(uses.get('Segoe UI')!.has('00') && uses.get('Segoe UI')!.has('10'));
  assert.ok(uses.get('Calibri')!.has('01'));
});

test('browser typographic subfamilies split into separate RIBBI families', () => {
  assert.deepEqual(splitBrowserFontFamily('Arial', 'Regular'), { family: 'Arial', style: 'Regular' });
  assert.deepEqual(splitBrowserFontFamily('Arial', 'Bold Italic'), { family: 'Arial', style: 'Bold Italic' });
  assert.deepEqual(splitBrowserFontFamily('Arial', 'Narrow'), { family: 'Arial Narrow', style: 'Regular' });
  assert.deepEqual(splitBrowserFontFamily('Arial', 'Narrow Bold'), { family: 'Arial Narrow', style: 'Bold' });
  assert.deepEqual(splitBrowserFontFamily('Arial', 'Narrow Bold Italic'), { family: 'Arial Narrow', style: 'Bold Italic' });
  assert.deepEqual(splitBrowserFontFamily('Arial', 'Black'), { family: 'Arial Black', style: 'Regular' });
  assert.deepEqual(splitBrowserFontFamily('Liberation Sans Narrow', 'Narrow Bold'), { family: 'Liberation Sans Narrow', style: 'Bold' });
});

test('bundled fonts are recognised case-insensitively', () => {
  assert.equal(isBundledFont('Arial Narrow'), true);
  assert.equal(isBundledFont('arial narrow'), true);
  assert.equal(isBundledFont('Segoe UI'), false);
});
