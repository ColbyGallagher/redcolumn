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

const { DEFAULT_SETTINGS, gridSpacingPoints, settings, switchUnitSystem, withDefaultUnits } = await import('./settings.ts');

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

test('pages with no scale use the default units', () => {
  settings.set({ unitSystem: 'imperial' });
  assert.equal(DEFAULT_SCALE.unit, 'ft');
  settings.set({ unitSystem: 'metric', lengthUnit: 'mm' });
  assert.equal(DEFAULT_SCALE.unit, 'mm');
  assert.equal(DEFAULT_SCALE.areaUnit, 'm');
});
