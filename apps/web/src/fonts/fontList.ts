import { FONT_FAMILIES, cssFontFamily, isNamedFont } from '@nb/markup';

/** One row in the font picker. */
export interface FontEntry {
  /** What the markup's `fontFamily` becomes: a keyword, or an installed font's family name. */
  value: string;
  label: string;
  /** CSS for showing the name in its own face. */
  css: string;
  group: 'standard' | 'recent' | 'installed';
  /** A font this computer lacks (the document uses it, it is drawn in a similar font). */
  missing?: boolean;
}

export const RECENT_FONTS_KEY = 'nb.recentFonts';
const MAX_RECENT = 6;

/** The recently chosen installed fonts, newest first. Empty where storage is blocked. */
export function loadRecentFonts(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_FONTS_KEY) ?? '[]') as unknown;
    return Array.isArray(raw) ? raw.filter((f): f is string => typeof f === 'string' && isNamedFont(f)).slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

/** Puts an installed font at the top of the recent list (keywords are not kept), and returns the new list. */
export function rememberFont(family: string): string[] {
  const current = loadRecentFonts();
  if (!isNamedFont(family)) return current;
  const next = [family, ...current.filter((f) => f !== family)].slice(0, MAX_RECENT);
  try {
    localStorage.setItem(RECENT_FONTS_KEY, JSON.stringify(next));
  } catch {
    // Not remembered; the list is just shorter next time.
  }
  return next;
}

/**
 * The rows of the picker, in order: the three standard fonts, the recently used ones, then the
 * installed ones. A font appears once (the earliest group wins), and the filter, a case-insensitive
 * part of the name, applies to every group. The font the markup has now is kept in view under
 * "recent" even if it is not installed here, so the picker never shows a blank.
 */
export function buildFontList(opts: { installed?: readonly string[]; recent?: readonly string[]; current?: string | null; filter?: string; missing?: (family: string) => boolean }): FontEntry[] {
  const needle = (opts.filter ?? '').trim().toLowerCase();
  const seen = new Set<string>();
  const out: FontEntry[] = [];
  const add = (value: string, label: string, group: FontEntry['group']) => {
    const key = value.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    if (needle && !label.toLowerCase().includes(needle)) return;
    out.push({ value, label, css: cssFontFamily(value), group, ...(group !== 'standard' && opts.missing?.(value) ? { missing: true } : {}) });
  };
  for (const f of FONT_FAMILIES) add(f.value, f.label, 'standard');
  const recent = [...(isNamedFont(opts.current) ? [opts.current] : []), ...(opts.recent ?? [])];
  for (const f of recent) if (isNamedFont(f)) add(f, f, 'recent');
  for (const f of opts.installed ?? []) if (isNamedFont(f)) add(f, f, 'installed');
  return out;
}
