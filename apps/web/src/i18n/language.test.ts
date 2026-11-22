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
});

test('pseudo-locales are offered in development, or while in use', () => {
  const codes = (dev: boolean, cur: string) => offeredLanguages(dev, cur).map((l) => l.code);
  assert.deepEqual(codes(false, 'auto'), ['en']);
  assert.deepEqual(codes(false, 'ar-XB'), ['en', 'ar-XB']);
  assert.deepEqual(codes(true, 'auto'), ['en', 'en-XA', 'ar-XB']);
});
