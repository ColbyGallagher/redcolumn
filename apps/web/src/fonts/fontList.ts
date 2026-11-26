import { FONT_FAMILIES, cssFontFamily, isFontKeyword, isNamedFont } from '@nb/markup';

/** One row in the font picker. */
export interface FontEntry {
  /** What the markup's `fontFamily` becomes: a keyword, or an installed font's family name. */
  value: string;
  label: string;
  /** CSS for showing the name in its own face. */
  css: string;
  group: 'starred' | 'standard' | 'recent' | 'installed';
  /** Pinned by the user to stay at the top of the list. */
  starred?: boolean;
  /** A font this computer lacks (the document uses it, it is drawn in a similar font). */
  missing?: boolean;
}

export const RECENT_FONTS_KEY = 'nb.recentFonts';
export const STARRED_FONTS_KEY = 'nb.starredFonts';
const MAX_RECENT = 6;

/** Named fonts bundled with the app and shown in the Standard group alongside the PDF standard keywords. */
export const BUNDLED_STANDARD_FONTS: readonly { value: string; label: string }[] = [
  { value: 'Arial Narrow', label: 'Arial Narrow' },
];

const isBundledStandard = (family: string) => BUNDLED_STANDARD_FONTS.some((f) => f.value.toLowerCase() === family.toLowerCase());
const isValidFontValue = (v: unknown): v is string => typeof v === 'string' && (isFontKeyword(v) || isNamedFont(v));

/** The fonts the user has starred, in order. Empty where storage is blocked. */
export function loadStarredFonts(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STARRED_FONTS_KEY) ?? '[]') as unknown;
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const f of raw) {
      if (!isValidFontValue(f)) continue;
      const key = f.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(f);
    }
    return out;
  } catch {
    return [];
  }
}

/** Stars a font if not starred, or unstars it if already starred, and returns the updated list. */
export function toggleStarredFont(family: string): string[] {
  const current = loadStarredFonts();
  if (!isValidFontValue(family)) return current;
  const key = family.toLowerCase();
  const exists = current.some((f) => f.toLowerCase() === key);
  const next = exists ? current.filter((f) => f.toLowerCase() !== key) : [...current, family];
  try {
    localStorage.setItem(STARRED_FONTS_KEY, JSON.stringify(next));
  } catch {
    // Storage blocked; return the updated list for the current session.
  }
  return next;
}

/** The recently chosen installed fonts, newest first. Empty where storage is blocked. */
export function loadRecentFonts(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_FONTS_KEY) ?? '[]') as unknown;
    return Array.isArray(raw) ? raw.filter((f): f is string => typeof f === 'string' && isNamedFont(f) && !isBundledStandard(f)).slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

/** Puts an installed font at the top of the recent list (standard fonts are not kept), and returns the new list. */
export function rememberFont(family: string): string[] {
  const current = loadRecentFonts();
  if (!isNamedFont(family) || isBundledStandard(family)) return current;
  const next = [family, ...current.filter((f) => f !== family)].slice(0, MAX_RECENT);
  try {
    localStorage.setItem(RECENT_FONTS_KEY, JSON.stringify(next));
  } catch {
    // Not remembered; the list is just shorter next time.
  }
  return next;
}

/**
 * The rows of the picker, in order: starred fonts, the standard fonts (including bundled Arial
 * Narrow), the recently used ones, then the installed ones. A font appears once (the earliest group
 * wins), and the filter, a case-insensitive part of the name, applies to every group. The font the
 * markup has now is kept in view under "recent" even if it is not installed here, so the picker
 * never shows a blank.
 */
export function buildFontList(opts: { starred?: readonly string[]; installed?: readonly string[]; recent?: readonly string[]; current?: string | null; filter?: string; missing?: (family: string) => boolean }): FontEntry[] {
  const needle = (opts.filter ?? '').trim().toLowerCase();
  const seen = new Set<string>();
  const out: FontEntry[] = [];
  const labelFor = (value: string) => FONT_FAMILIES.find((f) => f.value === value)?.label ?? BUNDLED_STANDARD_FONTS.find((f) => f.value.toLowerCase() === value.toLowerCase())?.label ?? value;
  const add = (value: string, label: string, group: FontEntry['group']) => {
    const key = value.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    if (needle && !label.toLowerCase().includes(needle)) return;
    const isStd = isFontKeyword(value) || isBundledStandard(value);
    out.push({
      value,
      label,
      css: cssFontFamily(value),
      group,
      ...(group === 'starred' ? { starred: true } : {}),
      ...(!isStd && opts.missing?.(value) ? { missing: true } : {}),
    });
  };
  for (const f of opts.starred ?? []) if (isValidFontValue(f)) add(f, labelFor(f), 'starred');
  for (const f of FONT_FAMILIES) {
    add(f.value, f.label, 'standard');
    if (f.value === 'sans') {
      for (const b of BUNDLED_STANDARD_FONTS) add(b.value, b.label, 'standard');
    }
  }
  const recent = [...(isNamedFont(opts.current) ? [opts.current] : []), ...(opts.recent ?? [])];
  for (const f of recent) if (isNamedFont(f)) add(f, f, 'recent');
  for (const f of opts.installed ?? []) if (isNamedFont(f)) add(f, f, 'installed');
  return out;
}
