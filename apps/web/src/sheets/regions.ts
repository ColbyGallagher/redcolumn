import type { Word } from '@nb/sheets';
import { parseScaleText, type Scale } from '@nb/measure';

export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The text inside a box on a page, in reading order. Words count when their centre is inside.
 * Title blocks often run sideways, so words are read along their own direction: rotated into
 * the dominant reading direction, grouped into lines, and read top to bottom, left to right.
 */
export function textInRegion(words: readonly Word[], r: Region): string {
  const inside = words.filter((w) => {
    const cx = (w.x0 + w.x1) / 2;
    const cy = (w.y0 + w.y1) / 2;
    return cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h && w.text.trim();
  });
  if (!inside.length) return '';
  // Dominant direction, snapped to quarter turns.
  const turns = new Map<number, number>();
  for (const w of inside) {
    const q = ((Math.round((w.angle || 0) / (Math.PI / 2)) % 4) + 4) % 4;
    turns.set(q, (turns.get(q) ?? 0) + w.text.length);
  }
  const q = [...turns].sort((a, b) => b[1] - a[1])[0]![0];
  const a = -q * (Math.PI / 2);
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const placed = inside
    .map((w) => {
      const cx = (w.x0 + w.x1) / 2;
      const cy = (w.y0 + w.y1) / 2;
      return { text: w.text.trim(), x: cx * cos - cy * sin, y: cx * sin + cy * cos, size: w.size || Math.min(w.x1 - w.x0, w.y1 - w.y0) || 8 };
    })
    .sort((m, n) => m.y - n.y);
  const lines: (typeof placed)[] = [];
  for (const w of placed) {
    const line = lines[lines.length - 1];
    if (line && Math.abs(line[0]!.y - w.y) <= Math.max(line[0]!.size, w.size) * 0.5) line.push(w);
    else lines.push([w]);
  }
  return lines
    .map((l) => l.sort((m, n) => m.x - n.x).map((w) => w.text).join(' '))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

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
