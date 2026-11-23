import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatFixed, formatNumber, formatTrimmed, normalizeNumberText, numberLocale, numberSeparators, parseNumber, setNumberLocale } from './numbers.ts';

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
  assert.equal(formatFixed(1234.5, 2, true, 'fr-FR'), '1\u202f234,50');
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
});

test('parses numbers', () => {
  assert.equal(parseNumber('1,250.5', 'en-US'), 1250.5);
  assert.equal(parseNumber('-2.5', 'en-US'), -2.5);
  assert.equal(parseNumber('.5', 'en-US'), 0.5);
  assert.equal(parseNumber('1.234,5', 'de-DE'), 1234.5);
  assert.equal(parseNumber('0,75', 'de-DE'), 0.75);
  assert.equal(parseNumber('1.250', 'de-DE'), 1250);
  assert.equal(parseNumber('', 'en-US'), null);
  assert.equal(parseNumber('1.2.3', 'en-US'), null);
  assert.equal(parseNumber('abc', 'de-DE'), null);
});
