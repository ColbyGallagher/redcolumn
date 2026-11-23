import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NUMBER_FORMATS, numberSample, offeredLanguages, resolveLanguage, resolveNumberFormat } from './language';

test('auto follows the browser, never to a pseudo-locale', () => {
  assert.equal(resolveLanguage('auto', ['ja-JP']), 'en');
  assert.equal(resolveLanguage('auto', ['en-XA']), 'en');
  assert.equal(resolveLanguage('auto', []), 'en');
});

test('a chosen language is used when registered', () => {
  assert.equal(resolveLanguage('en-XA', ['de']), 'en-XA');
  assert.equal(resolveLanguage('xx', ['de']), 'en');
  assert.equal(resolveLanguage(42, []), 'en', 'a stored value of the wrong type counts as auto');
  assert.equal(resolveLanguage(null, ['en-XA']), 'en');
});

test('pseudo-locales are offered in development, or while in use', () => {
  const codes = (dev: boolean, cur: string[]) => offeredLanguages(dev, cur).map((l) => l.code);
  assert.deepEqual(codes(false, ['auto', 'en']), ['en']);
  assert.deepEqual(codes(false, ['ar-XB', 'en']), ['en', 'ar-XB']);
  assert.deepEqual(codes(false, ['en', 'en-XA']), ['en', 'en-XA'], 'the running one stays listed after choosing another');
  assert.deepEqual(codes(true, ['auto']), ['en', 'en-XA', 'ar-XB']);
});

test('number formats: auto follows the system, and each is named by a sample', () => {
  assert.equal(resolveNumberFormat('auto', 'de-AT'), 'de-AT');
  assert.equal(resolveNumberFormat('fr-FR', 'de-AT'), 'fr-FR');
  assert.equal(resolveNumberFormat(7, 'de-AT'), 'de-AT', 'a stored value of the wrong type counts as auto');
  assert.deepEqual(NUMBER_FORMATS.map(numberSample), ['1,234,567.89', '1.234.567,89', '1\u202f234\u202f567,89', numberSample('de-CH')]);
  assert.match(numberSample('de-CH'), /^1['’]234['’]567\.89$/);
});
