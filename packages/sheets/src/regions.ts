import type { Word } from './types.ts';

/** A box on a page, in page space (points, top-left origin). */
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

