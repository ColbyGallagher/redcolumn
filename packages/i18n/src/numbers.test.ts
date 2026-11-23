import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatFixed, formatNumber, formatTrimmed, normalizeNumberText, numberLocale, numberSeparators, parseNumber, setNumberLocale, supportedNumberLocale } from './numbers.ts';

test('defaults to US English and falls back to it for unknown locales', () => {
  assert.equal(numberLocale(), 'en-US');
  setNumberLocale('not a locale!');
  assert.equal(numberLocale(), 'en-US');
  setNumberLocale('de-DE');
  assert.equal(numberLocale(), 'de-DE');
  setNumberLocale('en-US');
});

test('formats in the given locale', () => {
  assert.equal(formatFixed(1234.5, 2, true, 'en-US'), '1,234.50');
  assert.equal(formatFixed(1234.5, 2, true, 'de-DE'), '1.234,50');
  assert.equal(formatFixed(1234.5, 2, true, 'fr-FR'), '1\u00a0234,50', 'a plain no-break space, which PDF fonts can draw');
  assert.equal(formatFixed(1234.5, 2, false, 'de-DE'), '1234,50');
  assert.equal(formatTrimmed(2.5, 4, false, 'de-DE'), '2,5');
  assert.equal(formatTrimmed(3, 4, false, 'de-DE'), '3');
  assert.equal(formatNumber(0.25, { style: 'percent' }, 'de-DE'), '25\u00a0%');
});

test('uses the number locale by default', () => {
  setNumberLocale('de-DE');
  try {
    assert.equal(formatFixed(1.5, 1), '1,5');
    assert.equal(parseNumber('1,5'), 1.5);
  } finally {
    setNumberLocale('en-US');
  }
});

test('always Latin digits, with the locale’s separators', () => {
  assert.equal(formatFixed(1234567.5, 2, true, 'ar-EG'), '1,234,567.50');
  assert.equal(formatFixed(1234567.5, 2, true, 'fa-IR'), '1,234,567.50');
  assert.equal(formatFixed(1234567.5, 2, true, 'bn-BD'), '12,34,567.50');
  assert.equal(parseNumber(formatFixed(1234567.5, 2, true, 'ar-EG'), 'ar-EG'), 1234567.5);
  assert.equal(parseNumber(formatFixed(1234567.5, 2, true, 'en-IN'), 'en-IN'), 1234567.5);
});

test('everything formatted reads back', () => {
  for (const locale of ['en-US', 'de-DE', 'fr-FR', 'de-CH', 'en-IN', 'hi-IN', 'ar-EG', 'fa-IR', 'ru-RU', 'pt-BR', 'es-ES', 'ja-JP'])
    for (const v of [0.25, 1.5, 999.999, 1250.5, 1234567.89, 0.001])
      for (const grouping of [true, false]) assert.equal(parseNumber(formatFixed(v, 3, grouping, locale), locale), Number(v.toFixed(3)), `${locale} ${v} ${grouping}`);
});

test('separators', () => {
  assert.deepEqual(numberSeparators('en-US'), { decimal: '.', group: ',' });
  assert.deepEqual(numberSeparators('de-DE'), { decimal: ',', group: '.' });
  assert.equal(numberSeparators('fr-FR').decimal, ',');
  assert.equal(numberSeparators('de-CH').decimal, '.');
  assert.match(numberSeparators('de-CH').group, /['’]/);
});

test('normalizes typed numbers and leaves the rest of the text', () => {
  assert.equal(normalizeNumberText('1,250.5 m', 'en-US'), '1250.5 m');
  assert.equal(normalizeNumberText('1,25 m', 'en-US'), '1,25 m');
  assert.equal(normalizeNumberText('1.250,5 m', 'de-DE'), '1250.5 m');
  assert.equal(normalizeNumberText('1,5 m 25 cm', 'de-DE'), '1.5 m 25 cm');
  assert.equal(normalizeNumberText(`25'-6 1/2"`, 'de-DE'), `25'-6 1/2"`);
  assert.equal(normalizeNumberText('1\u202f234,5', 'fr-FR'), '1234.5');
  assert.equal(normalizeNumberText('5 1/2', 'fr-FR'), '5 1/2');
  assert.equal(normalizeNumberText('1’250.5', 'de-CH'), '1250.5');
  assert.equal(normalizeNumberText("1'250.5", 'de-CH'), '1250.5');
  assert.equal(normalizeNumberText('1.5', 'de-DE'), '1.5', 'a point that is not a digit group stays a decimal point');
  assert.equal(normalizeNumberText('0.250', 'de-DE'), '0.250', 'a group never starts with 0');
  assert.equal(normalizeNumberText('1.2500', 'de-DE'), '1.2500');
  assert.equal(normalizeNumberText('1 250,5 m', 'fr-FR'), '1250.5 m', 'a plain space typed as the group mark');
  assert.equal(normalizeNumberText('10 125/128', 'fr-FR'), '10 125/128', 'a fraction after a space is not a group');
  assert.equal(normalizeNumberText('12,34,567.5', 'en-IN'), '1234567.5');
  assert.equal(normalizeNumberText('1,2,345', 'en-US'), '1,2,345', 'not properly grouped: left alone');
  assert.equal(normalizeNumberText(`25'-6"`, 'de-CH'), `25'-6"`);
});

test('parses numbers', () => {
  assert.equal(parseNumber('1,250.5', 'en-US'), 1250.5);
  assert.equal(parseNumber('-2.5', 'en-US'), -2.5);
  assert.equal(parseNumber('.5', 'en-US'), 0.5);
  assert.equal(parseNumber('1.234,5', 'de-DE'), 1234.5);
  assert.equal(parseNumber('0,75', 'de-DE'), 0.75);
  assert.equal(parseNumber('1.250', 'de-DE'), 1250);
  assert.equal(parseNumber('0.250', 'de-DE'), 0.25);
  assert.equal(parseNumber('0,250', 'de-DE'), 0.25);
  assert.equal(parseNumber('', 'en-US'), null);
  assert.equal(parseNumber('1.2.3', 'en-US'), null);
  assert.equal(parseNumber('abc', 'de-DE'), null);
  assert.equal(parseNumber('5.', 'en-US'), 5);
  // Long runs of digits that do not parse return quickly.
  const start = performance.now();
  assert.equal(parseNumber(`${'0'.repeat(50_000)}x`, 'en-US'), null);
  assert.ok(performance.now() - start < 200);
});

test('never -0, and always Latin digits, also with other Unicode extensions', () => {
  assert.equal(formatTrimmed(-0.001, 1), '0');
  assert.equal(formatFixed(-0.001, 2), '0.00');
  assert.equal(formatTrimmed(-2.5, 1), '-2.5');
  assert.match(formatTrimmed(123.5, 1, false, 'ar-EG-u-ca-islamic'), /^123[.,٫]5$/);
  assert.match(formatTrimmed(123.5, 1, false, 'ar-EG-u-nu-arab'), /^123/);
});

test('supportedNumberLocale is what setNumberLocale uses', () => {
  assert.equal(supportedNumberLocale('not a tag!'), 'en-US');
  setNumberLocale('de-DE');
  assert.equal(numberLocale(), supportedNumberLocale('de-DE'));
  setNumberLocale('en-US');
});
