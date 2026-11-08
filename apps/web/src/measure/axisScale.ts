import { calibratedScale, calibrateAxis, measureValue, yScaleLabel, type LengthUnit, type Scale } from '@nb/measure';

/** Which way a calibration line is measured: across the page, up it, or (no separate Y scale) both. */
export type CalibrateAxis = 'x' | 'y' | 'both';

/** A calibration line's component must be at least this much of its length to calibrate an axis. */
const MIN_COMPONENT = 0.1;

/** Whether the page is scaled differently up it than across it, so calibrating needs an axis. */
export const hasSeparateY = (scale: Scale | null | undefined): boolean => !!scale && yScaleLabel(scale) !== null;

/** The axes a calibration offers: the two when Y is separate, else one for both. */
export const calibrateAxes = (scale: Scale | null | undefined): CalibrateAxis[] => (hasSeparateY(scale) ? ['x', 'y'] : ['both']);

/**
 * The length in page points a calibration line gives for an axis: its horizontal part for X, its
 * vertical part for Y, the whole line for both. An error when the line is too much the other way.
 */
export function calibrationLength(delta: readonly [number, number], axis: CalibrateAxis): { points: number } | { error: string } {
  const whole = Math.hypot(delta[0], delta[1]);
  if (axis === 'both') return whole > 0 ? { points: whole } : { error: 'Draw a longer line' };
  const part = Math.abs(axis === 'x' ? delta[0] : delta[1]);
  if (!(part > 0) || part < whole * MIN_COMPONENT) return { error: `Draw a more ${axis === 'x' ? 'horizontal' : 'vertical'} line to calibrate the ${axis === 'x' ? 'horizontal (X)' : 'vertical (Y)'} scale` };
  return { points: part };
}

/**
 * The scale after calibrating `axis` from a line of `delta` page points that is `real` long: only
 * that axis changes when the page has a separate Y scale; otherwise the line sets the whole scale.
 */
export function calibrateFromLine(current: Scale | null | undefined, axis: CalibrateAxis, delta: readonly [number, number], real: number, unit: LengthUnit): { scale: Scale } | { error: string } {
  const length = calibrationLength(delta, hasSeparateY(current) ? (axis === 'both' ? 'x' : axis) : 'both');
  if ('error' in length) return length;
  if (!current || !hasSeparateY(current)) return { scale: calibratedScale(length.points, real, unit) };
  return { scale: calibrateAxis(current, axis === 'y' ? 'y' : 'x', length.points, real, unit) };
}

/** A Space's plan area in square meters, at the scale across and up the page. */
export function spaceArea(points: readonly (readonly [number, number])[], scale: Scale): number {
  return measureValue('area', points as [number, number][], scale.metersPerPoint, {}, scale.yMetersPerPoint);
}
