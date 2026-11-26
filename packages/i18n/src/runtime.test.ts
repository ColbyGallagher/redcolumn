import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activate, currentLocale, formattingLocale, messagesBeforeActivation, msg, msgc, msgParts } from './runtime.ts';
import { messageKey } from './po.ts';
import { fallbackChain, LOCALES, localeInfo, matchLocale, type LocaleInfo } from './locales.ts';

// Runs first: nothing activated yet.
test('English before activation, and early use is recorded', () => {
  assert.equal(msg('Early {x}', { x: 1 }), 'Early 1');
  assert.deepEqual(messagesBeforeActivation(), ['Early {x}']);
});

test('translations, contexts, and English for anything missing', () => {
  activate('en', { 'Save all': 'Alle speichern', [messageKey('Count', 'verb')]: 'Zählen', '{n} pages': '{n} Seiten' });
  assert.equal(msg('Save all'), 'Alle speichern');
  assert.equal(msgc('verb', 'Count'), 'Zählen');
  assert.equal(msgc('noun', 'Count'), 'Count');
  assert.equal(msg('Not translated'), 'Not translated');
  assert.equal(msg('{n} pages', { n: 3 }), '3 Seiten');
});

test('a broken translation falls back to the English', () => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    activate('en', { 'Open {name}': 'Öffnen {name' });
    assert.equal(msg('Open {name}', { name: 'x' }), 'Open x');
  } finally {
    console.warn = warn;
  }
});

test('pseudo-locales', () => {
  activate('en-XA');
  assert.equal(currentLocale().code, 'en-XA');
  assert.equal(formattingLocale(), 'en');
  const s = msg('Save {n, plural, one {# file} other {# files}}', { n: 2 });
  assert.match(s, /^\[\[Šåṽé 2 ƒîļéš ~+\]\]$/);
  // A closing ellipsis stays last, where code that marks dialog commands looks for it.
  assert.match(msg('Open…'), /^\[\[Öþéñ ~+\]\]…$/);
  activate('ar-XB');
  assert.equal(currentLocale().dir, 'rtl');
  assert.ok(msg('Open…').endsWith('…'), 'the closing ellipsis stays last right to left too');
  assert.equal(msg('Hi {name}', { name: 'Ann' }), '‮Hi ‬Ann');
  activate('en');
});

test('rich parts', () => {
  const el = { k: 1 };
  assert.deepEqual(msgParts('Press {key}', { key: el }), ['Press ', el]);
});

test('unknown locale codes activate English', () => {
  activate('xx');
  assert.equal(currentLocale().code, 'en');
});

test('fallback chain', () => {
  assert.deepEqual(fallbackChain('de-AT'), ['de-AT', 'de', 'en']);
  assert.deepEqual(fallbackChain('en'), ['en']);
  assert.deepEqual(fallbackChain('zh-Hant-TW'), ['zh-Hant-TW', 'zh-Hant', 'zh', 'en']);
});

test('matching the user’s languages', () => {
  const de: LocaleInfo = { code: 'de', name: 'Deutsch', english: 'German', dir: 'ltr', status: 'preview', scripts: ['Latn'] };
  const ptBR: LocaleInfo = { code: 'pt-BR', name: 'Português', english: 'Portuguese', dir: 'ltr', status: 'preview', scripts: ['Latn'] };
  const all = [...LOCALES, de, ptBR];
  assert.equal(matchLocale(['de-AT', 'en'], all), 'de');
  assert.equal(matchLocale(['es-ES', 'de'], all), 'de');
  assert.equal(matchLocale(['pt-PT'], all), 'pt-BR');
  assert.equal(matchLocale(['ja'], all), 'en');
  assert.equal(matchLocale(['ar'], all), 'en', 'pseudo-locales never match by language');
  assert.equal(matchLocale(['en-XA'], all), 'en-XA');
});

test('registry is consistent', () => {
  const codes = new Set<string>();
  for (const l of LOCALES) {
    assert.ok(!codes.has(l.code), `duplicate ${l.code}`);
    codes.add(l.code);
    assert.equal(localeInfo(l.code.toUpperCase()), l);
    assert.equal(l.pseudo !== undefined, l.status === 'pseudo', l.code);
    if (l.rules) assert.doesNotThrow(() => new Intl.PluralRules(l.rules));
  }
  assert.equal(LOCALES.filter((l) => l.status === 'source').length, 1);
});
