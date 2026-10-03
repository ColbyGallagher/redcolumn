/**
 * Form field recognition: fill-in lines ("Name ________"), boxes and check boxes found in a page's
 * vector line work, named from the text label beside them.
 */

export interface DetectedField {
  type: 'text' | 'checkbox';
  name: string;
  /** Page space: points, top-left origin, y down. */
  rect: { x: number; y: number; w: number; h: number };
}

export interface LabelWord {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface Seg {
  a: number;
  b: number;
  at: number;
}

/** Collinear, touching pieces of horizontal or vertical lines, merged. */
function merge(list: Seg[], gap: number): Seg[] {
  list.sort((p, q) => p.at - q.at || p.a - q.a);
  const out: Seg[] = [];
  for (const s of list) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.at - s.at) < 0.8 && s.a <= last.b + gap) last.b = Math.max(last.b, s.b);
    else out.push({ ...s });
  }
  return out;
}

const near = (p: number, q: number, tol: number) => Math.abs(p - q) <= tol;

/** A field name from a label: its words without trailing colons or underscores, else a fallback. */
function nameFrom(words: string[], fallback: string): string {
  const name = words.join(' ').replace(/[_:.\s]+$/g, '').replace(/^[_\s]+/, '').trim();
  return name.length >= 2 && name.length <= 40 ? name : fallback;
}

/**
 * Fields on one page. `segments` are flat [x1, y1, x2, y2, ...] page-space lines (as pdf-core's
 * page geometry gives); `words` the page's text; `taken` areas already holding fields.
 */
export function detectFields(segments: ArrayLike<number>, words: readonly LabelWord[], taken: readonly { x: number; y: number; w: number; h: number }[] = []): DetectedField[] {
  const hs: Seg[] = [];
  const vs: Seg[] = [];
  for (let i = 0; i + 3 < segments.length; i += 4) {
    const [x1, y1, x2, y2] = [segments[i]!, segments[i + 1]!, segments[i + 2]!, segments[i + 3]!];
    if (Math.abs(y1 - y2) < 0.5 && Math.abs(x2 - x1) > 3) hs.push({ a: Math.min(x1, x2), b: Math.max(x1, x2), at: (y1 + y2) / 2 });
    else if (Math.abs(x1 - x2) < 0.5 && Math.abs(y2 - y1) > 3) vs.push({ a: Math.min(y1, y2), b: Math.max(y1, y2), at: (x1 + x2) / 2 });
  }
  const H = merge(hs, 1);
  const V = merge(vs, 1);
  const out: DetectedField[] = [];
  const used = new Set<Seg>();
  const overlaps = (r: DetectedField['rect']) =>
    [...taken, ...out.map((f) => f.rect)].some((t) => r.x < t.x + t.w - 1 && r.x + r.w > t.x + 1 && r.y < t.y + t.h - 1 && r.y + r.h > t.y + 1);
  const textInside = (r: DetectedField['rect']) => words.some((w) => (w.x0 + w.x1) / 2 > r.x + 1 && (w.x0 + w.x1) / 2 < r.x + r.w - 1 && (w.y0 + w.y1) / 2 > r.y + 1 && (w.y0 + w.y1) / 2 < r.y + r.h - 1);
  /** The words just left of (or above) a spot, on its line, as a label. */
  const labelFor = (r: DetectedField['rect'], fallback: string) => {
    const left = words
      .filter((w) => w.x1 <= r.x + 2 && w.x1 > r.x - 220 && (w.y0 + w.y1) / 2 > r.y - 4 && (w.y0 + w.y1) / 2 < r.y + r.h + 4)
      .sort((p, q) => p.x0 - q.x0);
    // The words closest to the field, back to a gap.
    const picked: LabelWord[] = [];
    for (const w of [...left].reverse()) {
      const next = picked[0];
      if (next && next.x0 - w.x1 > 12) break;
      if (!next && r.x - w.x1 > 40) break;
      picked.unshift(w);
    }
    if (picked.length) return nameFrom(picked.map((w) => w.text), fallback);
    const above = words.filter((w) => w.y1 <= r.y + 1 && w.y1 > r.y - 16 && w.x0 < r.x + r.w && w.x1 > r.x).sort((p, q) => p.x0 - q.x0);
    return above.length ? nameFrom(above.map((w) => w.text), fallback) : fallback;
  };

  // Boxes: two horizontal lines joined at both ends by vertical ones.
  for (const top of H) {
    for (const bottom of H) {
      if (bottom === top || bottom.at <= top.at + 5 || bottom.at - top.at > 60) continue;
      if (!near(top.a, bottom.a, 2) || !near(top.b, bottom.b, 2)) continue;
      const hasSide = (x: number) => V.some((v) => near(v.at, x, 2) && v.a <= top.at + 2 && v.b >= bottom.at - 2);
      if (!hasSide(top.a) || !hasSide(top.b)) continue;
      // Edges of a box are never fill-in lines of their own, field or not.
      used.add(top).add(bottom);
      const rect = { x: top.a, y: top.at, w: top.b - top.a, h: bottom.at - top.at };
      if (rect.w < 5 || overlaps(rect) || textInside(rect)) continue;
      const square = rect.w <= 24 && Math.abs(rect.w - rect.h) <= 3;
      if (!square && rect.w < 30) continue;
      out.push({ type: square ? 'checkbox' : 'text', name: labelFor(rect, square ? 'Check Box' : 'Text'), rect });
    }
  }
  // Fill-in lines: a horizontal line with nothing drawn just above it.
  for (const line of H) {
    if (used.has(line) || line.b - line.a < 36 || line.b - line.a > 500) continue;
    const h = 16;
    const rect = { x: line.a, y: line.at - h, w: line.b - line.a, h };
    const blocked = H.some((o) => o !== line && o.at < line.at - 1 && o.at > line.at - h && o.a < line.b && o.b > line.a) || V.some((v) => v.at > line.a + 2 && v.at < line.b - 2 && v.b > line.at - h + 2 && v.a < line.at - 2);
    if (blocked || overlaps(rect) || textInside(rect)) continue;
    out.push({ type: 'text', name: labelFor(rect, 'Text'), rect });
  }
  // Unique names, in reading order.
  out.sort((p, q) => p.rect.y - q.rect.y || p.rect.x - q.rect.x);
  const seen = new Map<string, number>();
  for (const f of out) {
    const n = (seen.get(f.name) ?? 0) + 1;
    seen.set(f.name, n);
    if (n > 1) f.name = `${f.name} ${n}`;
  }
  return out;
}
