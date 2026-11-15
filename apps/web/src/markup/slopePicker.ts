import { useSyncExternalStore } from 'react';
import { isMeasureKind, type Markup } from '@nb/markup';
import type { Slope, SlopeSpec } from '@nb/measure';
import { slopePatch } from './selectionFormat';

/**
 * The Takeoff tab's Slope picker: one plane's slope (pitch, degrees, grade or a rise:run ratio),
 * or none. Picking applies it to the selected measurements and to the running measure tool; Hip
 * and Valley arm Polylength with it as the roof pitch. It lives for the session.
 */
export interface SlopePick {
  kind: 'none' | SlopeSpec['kind'];
  /** Pitch (rise per 12), degrees or percent. */
  value: number;
  rise: number;
  run: number;
}

let pick: SlopePick = { kind: 'pitch', value: 6, rise: 1, run: 4 };
const listeners = new Set<() => void>();

export function slopePick(): SlopePick {
  return pick;
}

export function setSlopePick(patch: Partial<SlopePick>) {
  pick = { ...pick, ...patch };
  for (const l of listeners) l();
}

export function useSlopePick(): SlopePick {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    slopePick,
    slopePick,
  );
}

/** The picked slope as a slope spec, or null for none. */
export function pickedSpec(p: SlopePick = pick): SlopeSpec | null {
  switch (p.kind) {
    case 'none':
      return null;
    case 'ratio':
      return { kind: 'ratio', rise: p.rise, run: p.run };
    default:
      return { kind: p.kind, value: p.value };
  }
}

/** The pitch a hip or valley is armed with: the picked slope, else 6:12. */
export function hipValleySlope(kind: 'hip' | 'valley', p: SlopePick = pick): Slope {
  return { kind, a: pickedSpec(p) ?? { kind: 'pitch', value: 6 } };
}

/**
 * The change the picked slope makes to a measurement. A hip or valley keeps being one, with the
 * picked slope as its first plane; other markups take the slope where it applies (none clears it).
 */
export function pickedSlopePatch(m: Pick<Markup, 'type' | 'slope'>, spec: SlopeSpec | null): Partial<Markup> {
  if (!isMeasureKind(m.type)) return {};
  if (spec && (m.slope?.kind === 'hip' || m.slope?.kind === 'valley')) return { slope: { ...m.slope, a: spec } };
  return slopePatch(m, spec);
}
