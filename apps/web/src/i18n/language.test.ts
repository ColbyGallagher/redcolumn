import { test } from 'node:test';
import assert from 'node:assert/strict';
import { offeredLanguages, resolveLanguage } from './language';

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
