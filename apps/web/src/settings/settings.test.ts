import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_SCALE, formatArea, formatLength, SCALE_PRESETS } from '@nb/measure';

// settings.ts reads localStorage when it loads: preferences saved before grid spacing followed the units.
const store = new Map<string, string>([['nb.settings', JSON.stringify({ unitSystem: 'metric', gridSize: 0.25, gridUnit: 'in' })]]);
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

const { DEFAULT_SETTINGS, gridSpacingPoints, scaleInDefaultUnits, settings, switchUnitSystem, withDefaultUnits } = await import('./settings.ts');

const preset = (label: string) => SCALE_PRESETS.find((p) => p.label === label)!.scale;

test('a grid spacing saved in its own unit is converted to the unit system', () => {
  assert.equal(settings.get().gridSize, 6);
  assert.ok(Math.abs(gridSpacingPoints(settings.get()) - (6 * 72) / 25.4) < 1e-9);
});

test('switching units resets default units the new system lacks and converts the grid', () => {
  const metric = { ...DEFAULT_SETTINGS, lengthUnit: 'mm' as const, areaUnit: 'm' as const, gridSize: 5 };
  const patch = switchUnitSystem(metric, 'imperial');
  assert.deepEqual([patch.lengthUnit, patch.areaUnit, patch.volumeUnit], ['ft', 'ft', 'ft']);
  assert.equal(patch.gridSize, 3 / 16);
  assert.deepEqual(switchUnitSystem(metric, 'metric'), {});
});

test('a preset scale is shown in the default length, area and volume units', () => {
  const s = { ...DEFAULT_SETTINGS, lengthUnit: 'mm' as const, areaUnit: 'm' as const, volumeUnit: 'm' as const };
  const scale = withDefaultUnits(preset('1:100'), s);
  assert.equal(scale.unit, 'mm');
  assert.equal(scale.precision, 0);
  assert.equal(scale.metersPerPoint, preset('1:100').metersPerPoint);
  assert.equal(formatLength(1.5, scale), '1,500 mm');
  assert.equal(formatArea(2, { ...scale, precision: 2 }), '2.00 m²');
});

test('a scale with its own units, or from the other system, keeps them', () => {
  const s = { ...DEFAULT_SETTINGS, lengthUnit: 'km' as const, areaUnit: 'km' as const };
  const own = withDefaultUnits({ ...preset('1:100'), areaUnit: 'mm' }, s);
  assert.equal(own.areaUnit, 'mm');
  const calibrated = withDefaultUnits({ ...preset('1:100'), label: 'Calibrated' }, s);
  assert.equal(calibrated.unit, 'm');
  assert.equal(calibrated.areaUnit, 'km');
  assert.deepEqual(withDefaultUnits(preset('1/8" = 1\'-0"'), s), preset('1/8" = 1\'-0"'));
});

test('scaleInDefaultUnits rewords a page scale in the default units without changing its size', () => {
  const metric = { ...DEFAULT_SETTINGS, ...switchUnitSystem(DEFAULT_SETTINGS, 'metric'), unitSystem: 'metric' as const };
  const imperial = { ...DEFAULT_SETTINGS, ...switchUnitSystem(metric, 'imperial'), unitSystem: 'imperial' as const };
  const base = preset('1:100');
  const inFeet = scaleInDefaultUnits(base, imperial);
  assert.equal(inFeet.unit, 'ft');
  assert.equal(inFeet.areaUnit, 'ft');
  assert.equal(inFeet.metersPerPoint, base.metersPerPoint);
  assert.equal(inFeet.label, base.label);
  assert.equal(inFeet.feetInches, false);
  const back = scaleInDefaultUnits(inFeet, metric);
  assert.equal(back.unit, 'm');
  assert.equal(back.areaUnit, 'm');
  // Inch fractions survive a move between feet and inches.
  const fractional = { ...preset('1/8" = 1\'-0"'), feetInches: true, precision: 16 };
  assert.equal(scaleInDefaultUnits(fractional, { ...imperial, lengthUnit: 'in' }).feetInches, true);
});

test('Imperial -> Metric -> Imperial restores feet-inches and its precision', () => {
  const metric = { ...DEFAULT_SETTINGS, ...switchUnitSystem(DEFAULT_SETTINGS, 'metric'), unitSystem: 'metric' as const };
  const imperial = { ...DEFAULT_SETTINGS, ...switchUnitSystem(metric, 'imperial'), unitSystem: 'imperial' as const };
  const fractional = { ...preset('1/8" = 1\'-0"'), feetInches: true, precision: 16 };
  const inMetric = scaleInDefaultUnits(fractional, metric);
  assert.equal(inMetric.unit, 'm');
  const back = scaleInDefaultUnits(inMetric, imperial);
  assert.equal(back.unit, 'ft');
  assert.equal(back.feetInches, true);
  assert.equal(back.precision, 16);
});

test('a units change keeps Bluebeam area wording and a picked precision', () => {
  const metric = { ...DEFAULT_SETTINGS, ...switchUnitSystem(DEFAULT_SETTINGS, 'metric'), unitSystem: 'metric' as const };
  const revu = { ...preset('1:100'), unit: 'mm' as const, areaUnit: 'm' as const, volumeUnit: 'm' as const, areaLabel: { unit: 'm' as const, label: 'sq m' }, volumeLabel: { unit: 'm' as const, label: 'cu m' }, precision: 3 };
  const out = scaleInDefaultUnits(revu, { ...metric, lengthUnit: 'cm' });
  assert.deepEqual(out.areaLabel, revu.areaLabel);
  assert.deepEqual(out.volumeLabel, revu.volumeLabel);
  const same = scaleInDefaultUnits({ ...revu, unit: 'cm' }, { ...metric, lengthUnit: 'cm' });
  assert.equal(same.precision, 3);
  assert.equal(scaleInDefaultUnits(same, { ...metric, lengthUnit: 'cm' }), same);
});

test('pages with no scale use the default units', () => {
  settings.set({ unitSystem: 'imperial' });
  assert.equal(DEFAULT_SCALE.unit, 'ft');
  settings.set({ unitSystem: 'metric', lengthUnit: 'mm' });
  assert.equal(DEFAULT_SCALE.unit, 'mm');
  assert.equal(DEFAULT_SCALE.areaUnit, 'm');
});

test('zoomToSearchResults defaults to true and parses from exported preferences', () => {
  assert.equal(DEFAULT_SETTINGS.zoomToSearchResults, true);
  assert.deepEqual(settings.parse(JSON.stringify({ settings: { zoomToSearchResults: false } })), { zoomToSearchResults: false });
});
