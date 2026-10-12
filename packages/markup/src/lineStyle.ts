import { PdfName, type PdfValue } from './bluebeam';
import type { PathCmd, ShapePart } from './geometry';

/**
 * Bluebeam's custom line styles (Revu's Line Styles): a line drawn as a repeating pattern of dashes,
 * gaps, text and small vector symbols, optionally as several parallel lines. A markup carries one as
 * `/LineStyle` (the pattern) and `/LineStyleName`; we keep the pattern exactly as stored so it goes
 * back to Bluebeam unchanged, and lay it out from that when drawing.
 *
 * `/LineStyle` is `[scaleWithLineWidth, line, line, ...]`. Each line is `[offset, component, ...]`,
 * repeating along the markup's path, `offset` points to the left of its direction:
 *  - a positive number is a dash that long, a negative one a gap;
 *  - `[text, font, size, bold, italic, upright]` is text, centred on the line;
 *  - `[left, right, scale, fill, type, x, y, ...]` is a symbol: it takes `left + right` along the line,
 *    its origin `left` in, and its points follow (type 0 starts a path, 1 is a line to, 2 is one of the
 *    three points of a Bézier curve), with y up.
 */
export interface CustomLine {
  name: string;
  /** The pattern as Bluebeam stores it (numbers, booleans, strings, arrays). */
  spec: unknown[];
}

type Cmd = ['M', number, number] | ['L', number, number] | ['C', number, number, number, number, number, number];

type Component =
  | { kind: 'dash'; width: number }
  | { kind: 'space'; width: number }
  | { kind: 'text'; text: string; font: string; size: number; bold: boolean; italic: boolean; upright: boolean }
  | { kind: 'vector'; left: number; right: number; scale: number; fill: boolean; path: Cmd[] };

interface Compiled {
  /** Every length in the pattern is in multiples of the line width. */
  scaled: boolean;
  lines: { offset: number; parts: Component[] }[];
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The custom line style a markup's raw /LineStyle and /LineStyleName hold, or undefined if it has none. */
export function readLineStyle(spec: PdfValue | undefined, name: PdfValue | undefined): CustomLine | undefined {
  if (!Array.isArray(spec) || !spec.length) return undefined;
  const plain = (v: PdfValue): unknown => (v instanceof PdfName ? v.name : Array.isArray(v) ? v.map(plain) : v);
  return { name: typeof name === 'string' ? name : name instanceof PdfName ? name.name : '', spec: plain(spec) as unknown[] };
}

function compileVector(v: unknown[]): Component | null {
  if (v.length < 4 || !isNum(v[0]) || !isNum(v[1]) || !isNum(v[2])) return null;
  const path: Cmd[] = [];
  for (let i = 4; i + 2 < v.length; ) {
    const type = v[i];
    const x = v[i + 1];
    const y = v[i + 2];
    if (!isNum(type) || !isNum(x) || !isNum(y)) break;
    if (type === 2) {
      // A curve is its two control points then its end point, each stored as a type 2 point.
      const q = v.slice(i, i + 9);
      if (q.length < 9 || q.some((n, k) => (k % 3 === 0 ? n !== 2 : !isNum(n)))) break;
      path.push(['C', q[1] as number, q[2] as number, q[4] as number, q[5] as number, q[7] as number, q[8] as number]);
      i += 9;
      continue;
    }
    path.push([type === 0 ? 'M' : 'L', x, y]);
    i += 3;
  }
  return path.length ? { kind: 'vector', left: v[0], right: v[1], scale: v[2], fill: v[3] === true, path } : null;
}

function compileText(v: unknown[]): Component | null {
  if (typeof v[0] !== 'string') return null;
  return { kind: 'text', text: v[0], font: typeof v[1] === 'string' ? v[1] : 'Helvetica', size: isNum(v[2]) ? v[2] : 6, bold: v[3] === true, italic: v[4] === true, upright: v[5] !== false };
}

const compiled = new WeakMap<object, Compiled | null>();

function compile(line: CustomLine): Compiled | null {
  if (compiled.has(line)) return compiled.get(line)!;
  const spec = line.spec;
  let out: Compiled | null = null;
  if (Array.isArray(spec)) {
    const lines = spec.slice(1).flatMap((l) => {
      if (!Array.isArray(l)) return [];
      const parts = l.slice(1).flatMap((c): Component[] => {
        if (isNum(c)) return c > 0 ? [{ kind: 'dash', width: c }] : c < 0 ? [{ kind: 'space', width: -c }] : [];
        if (!Array.isArray(c)) return [];
        const comp = typeof c[0] === 'string' ? compileText(c) : compileVector(c);
        return comp ? [comp] : [];
      });
      return [{ offset: isNum(l[0]) ? l[0] : 0, parts }];
    });
    if (lines.length) out = { scaled: spec[0] !== false, lines };
  }
  compiled.set(line, out);
  return out;
}

/** Text a line style lays along a line. `angle` is clockwise in page space; `x`, `y` is its centre. */
export interface ArtText {
  text: string;
  x: number;
  y: number;
  angle: number;
  size: number;
  font: 'sans' | 'serif' | 'mono';
  bold: boolean;
  italic: boolean;
}

/** A line style laid out along a path: lines to stroke, shapes to fill, text to draw. */
export interface LineArt {
  stroke: PathCmd[];
  fill: PathCmd[];
  texts: ArtText[];
}

/** How wide text is, in points, for the layout to leave room for it. */
export type TextMeasure = (text: string, font: ArtText['font'], bold: boolean, italic: boolean, size: number) => number;

const fontFamilyOf = (name: string): ArtText['font'] => (/times|serif(?!.*sans)|georgia|garamond/i.test(name) ? 'serif' : /courier|mono|consolas/i.test(name) ? 'mono' : 'sans');

type Pt = [number, number];

interface Run {
  pts: Pt[];
  /** Distance along the run to each point. */
  at: number[];
  length: number;
}

/** A path as runs of straight pieces (curves flattened), closed ones ending where they began. */
function runsOf(path: PathCmd[]): Run[] {
  const lists: Pt[][] = [];
  let cur: Pt[] = [];
  const flush = () => {
    if (cur.length > 1) lists.push(cur);
    cur = [];
  };
  for (const c of path) {
    if (c[0] === 'M') {
      flush();
      cur = [[c[1], c[2]]];
    } else if (c[0] === 'L') {
      cur.push([c[1], c[2]]);
    } else if (c[0] === 'C') {
      const [x0, y0] = cur[cur.length - 1] ?? [c[5], c[6]];
      const n = Math.max(4, Math.min(32, Math.ceil((Math.hypot(c[1] - x0, c[2] - y0) + Math.hypot(c[3] - c[1], c[4] - c[2]) + Math.hypot(c[5] - c[3], c[6] - c[4])) / 3)));
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        const u = 1 - t;
        cur.push([u * u * u * x0 + 3 * u * u * t * c[1] + 3 * u * t * t * c[3] + t * t * t * c[5], u * u * u * y0 + 3 * u * u * t * c[2] + 3 * u * t * t * c[4] + t * t * t * c[6]]);
      }
    } else if (cur.length) {
      cur.push(cur[0]!);
    }
  }
  flush();
  return lists.map((pts) => {
    const at = [0];
    for (let i = 1; i < pts.length; i++) at.push(at[i - 1]! + Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]));
    return { pts, at, length: at[at.length - 1]! };
  });
}

/** The point at distance `s` along a run, and the unit tangent there. */
function sample(run: Run, s: number): { p: Pt; t: Pt } {
  const { pts, at } = run;
  let i = 1;
  while (i < pts.length - 1 && at[i]! < s) i++;
  const a = pts[i - 1]!;
  const b = pts[i]!;
  const seg = at[i]! - at[i - 1]! || 1;
  const f = Math.max(0, Math.min(1, (s - at[i - 1]!) / seg));
  return { p: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], t: [(b[0] - a[0]) / seg, (b[1] - a[1]) / seg] };
}

/** The part of a run between two distances, moved `offset` to the left of its direction. */
function slice(run: Run, s0: number, s1: number, offset: number): Pt[] {
  const out: Pt[] = [];
  const shift = (p: Pt, t: Pt): Pt => [p[0] + t[1] * offset, p[1] - t[0] * offset];
  const first = sample(run, s0);
  out.push(shift(first.p, first.t));
  for (let i = 1; i < run.pts.length; i++) {
    const from = Math.max(run.at[i - 1]!, s0);
    const to = Math.min(run.at[i]!, s1);
    if (to <= from + 1e-9) continue;
    const seg = sample(run, (from + to) / 2);
    const a = shift(sample(run, from).p, seg.t);
    const b = shift(sample(run, to).p, seg.t);
    if (Math.hypot(a[0] - out[out.length - 1]![0], a[1] - out[out.length - 1]![1]) > 1e-6) out.push(a);
    out.push(b);
  }
  return out;
}

const polyline = (pts: Pt[]): PathCmd[] => pts.map(([x, y], i) => (i ? (['L', x, y] as PathCmd) : (['M', x, y] as PathCmd)));

/**
 * `path` drawn in a custom line style at line width `width`. `measure` sizes the style's text.
 * Nothing is returned for a style that cannot be read, which then draws as a plain line.
 */
export function lineArt(path: PathCmd[], style: CustomLine, width: number, measure: TextMeasure): LineArt | null {
  const pattern = compile(style);
  if (!pattern) return null;
  const k = pattern.scaled ? Math.max(width, 0.25) : 1;
  const art: LineArt = { stroke: [], fill: [], texts: [] };
  for (const run of runsOf(path)) {
    for (const line of pattern.lines) {
      const offset = line.offset * k;
      if (!line.parts.length) {
        art.stroke.push(...polyline(slice(run, 0, run.length, offset)));
        continue;
      }
      let s = 0;
      for (let guard = 0; s < run.length - 1e-6 && guard < 20000; guard++) {
        const before = s;
        for (const c of line.parts) {
          if (s >= run.length - 1e-6) break;
          if (c.kind === 'dash') {
            const end = Math.min(s + c.width * k, run.length);
            art.stroke.push(...polyline(slice(run, s, end, offset)));
            s = end;
          } else if (c.kind === 'space') {
            s += c.width * k;
          } else if (c.kind === 'text') {
            const size = c.size * k;
            const family = fontFamilyOf(c.font);
            const w = measure(c.text, family, c.bold, c.italic, size);
            if (s + w <= run.length + 1e-6) {
              const { p, t } = sample(run, s + w / 2);
              let angle = Math.atan2(t[1], t[0]);
              // Upright text turns over rather than reading upside down on lines drawn leftwards.
              if (c.upright && Math.abs(angle) > Math.PI / 2) angle += angle > 0 ? -Math.PI : Math.PI;
              art.texts.push({ text: c.text, x: p[0] + t[1] * offset, y: p[1] - t[0] * offset, angle, size, font: family, bold: c.bold, italic: c.italic });
            }
            s += w;
          } else {
            const sc = c.scale * k;
            const w = (c.left + c.right) * sc;
            if (s + w <= run.length + 1e-6) {
              const { p, t } = sample(run, s + c.left * sc);
              // Symbol space has x along the line and y to its left (up, as the pattern is authored).
              const at = (x: number, y: number): Pt => [p[0] + t[0] * x * sc + t[1] * (y * sc + offset), p[1] + t[1] * x * sc - t[0] * (y * sc + offset)];
              const cmds: PathCmd[] = c.path.map((m) => {
                if (m[0] === 'C') {
                  const a = at(m[1], m[2]);
                  const b = at(m[3], m[4]);
                  const e = at(m[5], m[6]);
                  return ['C', a[0], a[1], b[0], b[1], e[0], e[1]];
                }
                const q = at(m[1], m[2]);
                return [m[0], q[0], q[1]];
              });
              art.stroke.push(...cmds);
              if (c.fill) art.fill.push(...cmds, ['Z']);
            }
            s += w;
          }
        }
        // A pattern that takes no room would never get anywhere.
        if (s <= before) break;
      }
    }
  }
  return art;
}

/** How far a style reaches to either side of a line at width `width`: for padding bounds. */
export function lineStyleReach(style: CustomLine, width: number): number {
  const pattern = compile(style);
  if (!pattern) return 0;
  const k = pattern.scaled ? Math.max(width, 0.25) : 1;
  let reach = 0;
  for (const line of pattern.lines) {
    for (const c of line.parts) {
      if (c.kind === 'text') reach = Math.max(reach, Math.abs(line.offset) * k + c.size * k * 0.7);
      else if (c.kind === 'vector') {
        const ys = c.path.flatMap((m) => (m[0] === 'C' ? [m[2], m[4], m[6]] : [m[2]]));
        const far = Math.max(...ys.map(Math.abs), 0);
        reach = Math.max(reach, Math.abs(line.offset) * k + far * c.scale * k);
      } else reach = Math.max(reach, Math.abs(line.offset) * k);
    }
    if (!line.parts.length) reach = Math.max(reach, Math.abs(line.offset) * k);
  }
  return reach + width;
}

/** Whether a style lays out text (so an export needs a font for it). */
export function lineStyleHasText(style: CustomLine): boolean {
  return !!compile(style)?.lines.some((l) => l.parts.some((c) => c.kind === 'text'));
}

/** The fonts a style's text uses. */
export function lineStyleFonts(style: CustomLine): { font: ArtText['font']; bold: boolean; italic: boolean }[] {
  const seen = new Map<string, { font: ArtText['font']; bold: boolean; italic: boolean }>();
  for (const l of compile(style)?.lines ?? []) {
    for (const c of l.parts) {
      if (c.kind !== 'text') continue;
      const f = { font: fontFamilyOf(c.font), bold: c.bold, italic: c.italic };
      seen.set(`${f.font}${f.bold}${f.italic}`, f);
    }
  }
  return [...seen.values()];
}

/**
 * A markup's drawn parts with its custom line style laid out: where a part strokes its outline, a
 * `lineArt` part stands in for the stroke. Hit testing and selection keep to `markupShape`.
 */
export function styledParts(parts: ShapePart[], style: CustomLine | undefined, width: number, measure: TextMeasure): ShapePart[] {
  if (!style) return parts;
  return parts.flatMap((part): ShapePart[] => {
    if (!part.stroke || part.decoration || part.hatch || !part.path.length) return [part];
    const art = lineArt(part.path, style, width, measure);
    if (!art) return [part];
    return [...(part.fill ? [{ ...part, stroke: false }] : []), { path: [], stroke: false, fill: null, art }];
  });
}
