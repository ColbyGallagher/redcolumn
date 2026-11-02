import { textInRegion, type Region, type Word } from '@nb/sheets';
import { parseScaleText, type Scale } from '@nb/measure';

export { textInRegion, type Region } from '@nb/sheets';

/** A page label from several boxes: each box's text, joined by `separator`, skipping empty ones. */
export function labelFromRegions(words: readonly Word[], regions: readonly Region[], separator: string): string {
  return regions
    .map((r) => textInRegion(words, r))
    .filter(Boolean)
    .join(separator);
}

/** Parses "1-3, 5, 8-" (1-based) into page indices below `count`. */
export function parsePageRange(text: string, count: number): number[] {
  const out = new Set<number>();
  for (const part of text.split(/[,;\s]+/).filter(Boolean)) {
    const m = /^(\d*)\s*-\s*(\d*)$/.exec(part);
    const [from, to] = m ? [m[1] ? Number(m[1]) : 1, m[2] ? Number(m[2]) : count] : [Number(part), Number(part)];
    if (!Number.isFinite(from) || !Number.isFinite(to)) continue;
    for (let p = Math.max(1, from); p <= Math.min(count, to); p++) out.add(p - 1);
  }
  return [...out].sort((a, b) => a - b);
}

/** The drawing scale written in a box: the first box whose text reads as a scale. */
export function scaleFromRegions(words: readonly Word[], regions: readonly Region[]): Scale | null {
  for (const r of regions) {
    const scale = parseScaleText(textInRegion(words, r));
    if (scale) return scale;
  }
  return null;
}

/**
 * A typed label for each page. With `consecutive`, the number at the end of the label counts up
 * page by page (A-101, A-102, ...), keeping its leading zeros; without a number every page gets
 * the same label.
 */
export function numberedLabels(pages: readonly number[], first: string, consecutive: boolean): { page: number; label: string }[] {
  const m = /^(.*?)(\d+)(\D*)$/.exec(first);
  return pages.map((page, k) => {
    if (!consecutive || !m) return { page, label: first };
    const [, prefix, digits, suffix] = m;
    return { page, label: `${prefix}${String(Number(digits) + k).padStart(digits!.length, '0')}${suffix}` };
  });
}
