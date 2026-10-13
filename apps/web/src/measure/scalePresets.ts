import { SCALE_PRESETS, type PaperUnit, type Scale } from '@nb/measure';

const PRESETS_KEY = 'nb.scalePresets';
export const PAPER_UNITS: PaperUnit[] = ['in', 'mm', 'cm'];

/** A scale the user saved with "+ Add Preset". */
export interface SavedPreset {
  label: string;
  scale: Scale;
}

export function loadPresets(): SavedPreset[] {
  try {
    const raw = JSON.parse(localStorage.getItem(PRESETS_KEY) ?? '[]') as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const { label, scale } = item as { label?: unknown; scale?: Scale };
      if (typeof label !== 'string' || !scale || typeof scale.metersPerPoint !== 'number' || typeof scale.unit !== 'string') return [];
      return [{ label, scale }];
    });
  } catch {
    return [];
  }
}

export function writePresets(list: SavedPreset[]) {
  try {
    localStorage.setItem(PRESETS_KEY, JSON.stringify(list));
  } catch {
    // The preset still applies for this visit.
  }
}

export function closeScale(a: Scale, b: Scale): boolean {
  return a.unit === b.unit && b.metersPerPoint > 0 && Math.abs(a.metersPerPoint / b.metersPerPoint - 1) < 1e-4;
}

export function matchPreset(scale: Scale, saved: readonly SavedPreset[]): { kind: 'saved' | 'builtin'; label: string } | null {
  const savedHit = saved.find((s) => closeScale(s.scale, scale));
  if (savedHit) return { kind: 'saved', label: savedHit.label };
  const builtin = SCALE_PRESETS.find((p) => closeScale(p.scale, scale));
  return builtin ? { kind: 'builtin', label: builtin.label } : null;
}

/** Zero-based pages from `all`, or from a 1-based range such as `3-5, 8`. Null when the text is not valid. */
export function pagesOf(mode: 'all' | 'range', text: string, count: number): number[] | null {
  if (count < 1) return null;
  if (mode === 'all') return Array.from({ length: count }, (_, i) => i);
  const pages = new Set<number>();
  if (!text.trim()) return null;
  for (const part of text.split(',')) {
    const t = part.trim();
    if (!t) continue;
    const range = /^(\d+)\s*-\s*(\d+)$/.exec(t);
    if (range) {
      let a = Number(range[1]);
      let b = Number(range[2]);
      if (a > b) [a, b] = [b, a];
      if (a < 1 || b > count) return null;
      for (let i = a; i <= b; i++) pages.add(i - 1);
    } else if (/^\d+$/.test(t)) {
      const n = Number(t);
      if (n < 1 || n > count) return null;
      pages.add(n - 1);
    } else return null;
  }
  return pages.size ? [...pages] : null;
}

/** Zero-based pages written as a 1-based range, e.g. `1-3, 5`. */
export function rangeText(pages: readonly number[]): string {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j]! + 1) j++;
    parts.push(j > i ? `${sorted[i]! + 1}-${sorted[j]! + 1}` : String(sorted[i]! + 1));
    i = j + 1;
  }
  return parts.join(', ');
}

/** Precision as a select value: `d2` for two decimal places, `f16` for sixteenths of an inch. */
export function precisionValue(scale: Scale | null, pending: string): string {
  if (!scale) return pending;
  const frac = scale.feetInches && (scale.unit === 'ft' || scale.unit === 'in');
  return `${frac ? 'f' : 'd'}${scale.precision}`;
}

export function precisionText(value: string): string {
  const p = Number(value.slice(1));
  if (value[0] === 'f') return p === 1 ? 'Whole inches' : `1/${p}"`;
  return p ? `0.${'0'.repeat(p - 1)}1` : '1';
}
