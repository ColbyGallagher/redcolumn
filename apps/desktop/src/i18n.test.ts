import assert from 'node:assert/strict';
import test from 'node:test';
import { setStrings, t } from './i18n.ts';

test('the page’s translations replace the English; anything missing stays English', () => {
  assert.equal(t('Open'), 'Open');
  assert.equal(setStrings({ Open: 'Öffnen' }), true);
  assert.equal(t('Open'), 'Öffnen');
  assert.equal(t('Save'), 'Save');
});

test('anything that is not a short string table is refused and leaves the last one', () => {
  setStrings({ Open: 'Öffnen' });
  for (const bad of [null, 'Open', ['Open'], { Open: 1 }, { Open: 'x'.repeat(3000) }, Object.fromEntries(Array.from({ length: 600 }, (_, i) => [`k${i}`, 'v']))]) {
    assert.equal(setStrings(bad), false);
  }
  assert.equal(t('Open'), 'Öffnen');
});
