import { AREA_LABELS, DEFAULT_SCALE, LENGTH_UNITS, METERS_PER_UNIT, VOLUME_LABELS, areaUnitOf, volumeUnitOf, type ManualKind, type ManualQuantity, type Scale } from '@nb/measure';

/** A unit a typed quantity can be entered in: how many base units (m, sq m, cu m or items) one of it is. */
export interface ManualUnit {
  id: string;
  label: string;
  factor: number;
}

const lengthUnits: ManualUnit[] = LENGTH_UNITS.map((u) => ({ id: u, label: u, factor: METERS_PER_UNIT[u] }));
const areaUnits: ManualUnit[] = [
  ...LENGTH_UNITS.map((u) => ({ id: u, label: AREA_LABELS[u], factor: METERS_PER_UNIT[u] ** 2 })),
  { id: 'ac', label: 'ac', factor: 4046.8564224 },
  { id: 'ha', label: 'ha', factor: 10000 },
];
const volumeUnits: ManualUnit[] = [
  ...LENGTH_UNITS.map((u) => ({ id: u, label: VOLUME_LABELS[u], factor: METERS_PER_UNIT[u] ** 3 })),
  { id: 'L', label: 'L', factor: 0.001 },
  { id: 'gal', label: 'gal', factor: 0.003785411784 },
];
const countUnits: ManualUnit[] = [{ id: 'ea', label: 'ea', factor: 1 }];

/** The units a quantity of this kind can be typed in. */
export const MANUAL_UNITS: Record<ManualKind, readonly ManualUnit[]> = { length: lengthUnits, area: areaUnits, volume: volumeUnits, count: countUnits };

export const MANUAL_KIND_LABELS: Record<ManualKind, string> = { length: 'Length', area: 'Area', volume: 'Volume', count: 'Count' };

/** The unit to offer first for a kind: the page's own display unit. */
export function defaultManualUnit(kind: ManualKind, scale: Scale = DEFAULT_SCALE): string {
  if (kind === 'count') return 'ea';
  if (kind === 'length') return scale.unit;
  return kind === 'area' ? areaUnitOf(scale) : volumeUnitOf(scale);
}

function unitOf(kind: ManualKind, unit: string | undefined): ManualUnit {
  const units = MANUAL_UNITS[kind];
  return units.find((u) => u.id === unit) ?? units[0]!;
}

/** A quantity typed in `unit`, in base units (m, sq m, cu m, items). */
export function manualToBase(kind: ManualKind, value: number, unit: string | undefined): number {
  return value * unitOf(kind, unit).factor;
}

/** A base-unit quantity as it reads in `unit`. */
export function manualFromBase(kind: ManualKind, base: number, unit: string | undefined): number {
  return base / unitOf(kind, unit).factor;
}

/** The quantity a typed `value` in `unit` makes, or null when it is not a finite, non-negative number. */
export function makeManual(kind: ManualKind, value: number, unit: string | undefined, note?: string): ManualQuantity | null {
  if (!Number.isFinite(value) || value < 0) return null;
  const u = unitOf(kind, unit);
  const n = note?.trim();
  return { kind, value: value * u.factor, unit: u.id, ...(n ? { note: n } : {}) };
}

/** The value to show when editing: the quantity in the unit it was typed in, without float noise. */
export function manualEditValue(q: ManualQuantity): number {
  return Number(manualFromBase(q.kind, q.value, q.unit).toPrecision(12));
}
