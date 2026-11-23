import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setNumberLocale } from '@nb/i18n';
import { formatArea, formatLength, formatScaleNumber, parseLength, parseScaleNumber, scaleFromParts, type Scale } from './scale.ts';
import { formatMeasure, formatSlope } from './measure.ts';

const metric: Scale = { label: '', metersPerPoint: 1, unit: 'm', precision: 2, feetInches: false };
const feet: Scale = { label: '', metersPerPoint: 1, unit: 'ft', precision: 16, feetInches: true };

/** Runs `fn` with numbers in `locale`, then back to US English. */
function inLocale(locale: string, fn: () => void) {
  setNumberLocale(locale);
  try {
    fn();
  } finally {
    setNumberLocale('en-US');
  }
}

test('measurements are shown in the chosen number format', () => {
  inLocale('de-DE', () => {
    assert.equal(formatLength(1250.5, metric), '1.250,50 m');
    assert.equal(formatArea(12.345, metric), '12,35 m²');
    assert.equal(formatMeasure('angle', 45.25, { ...metric, anglePrecision: 1 }), '45,3°');
    assert.equal(formatSlope({ kind: 'percent', value: 2.5 }), '2,5%');
    assert.equal(formatSlope({ kind: 'elevation', from: 0, to: 1.2 } as never), 'Δ1,20 m');
    // Feet and inches are unchanged.
    assert.equal(formatLength(0.3048 * 25.5, feet), `25'-6"`);
  });
  assert.equal(formatLength(1250.5, metric), '1,250.50 m');
});

test('typed lengths and scale numbers read in the chosen number format', () => {
  inLocale('de-DE', () => {
    assert.equal(parseLength('1,5 m', 'm'), 1.5);
    assert.equal(parseLength('1.250,5', 'm'), 1250.5);
    assert.equal(parseLength('1,5', 'm'), 1.5);
    assert.equal(parseLength(`25'-6 1/2"`, 'ft'), 25 + 6.5 / 12);
    assert.equal(parseScaleNumber('2,5'), 2.5);
    assert.equal(parseScaleNumber('1/4'), 0.25);
  });
  inLocale('de-CH', () => assert.equal(parseLength('1’250.5 m', 'm'), 1250.5));
  inLocale('fr-FR', () => assert.equal(parseLength('1\u202f250,5 m', 'm'), 1250.5));
  assert.equal(parseLength('1,250.5 m', 'm'), 1250.5);
});

test('scale numbers keep a point in labels, and follow the format in fields', () => {
  inLocale('de-DE', () => {
    assert.equal(formatScaleNumber(2.3), '2.3');
    assert.equal(formatScaleNumber(2.3, true), '2,3');
    assert.equal(formatScaleNumber(0.25, true), '1/4');
    assert.match(scaleFromParts(1, 'mm', 2.3, 'm')!.label, /2\.3 m/);
  });
});
