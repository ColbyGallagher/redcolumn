/**
 * Lighter page content for drawing: the operators of a content stream rewritten so the page looks
 * the same but has far fewer objects.
 *
 * CAD exporters (ArchiCAD, and others through PDFTron) write each hatch dash as its own path
 * object, `q 0.5 0.5 0.5 RG 0.1 w x y m x y l S 0 G 0 w Q`, and place tiny hatch-tile forms
 * thousands of times. A renderer pays per object (parsing it, setting up its state and clip), so
 * a sheet with 600,000 of them takes seconds to draw whatever the zoom. Runs of such objects with
 * the same stroke state are merged into one path per area of the page (merged paths still let a
 * zoomed-in tile skip what lies outside it), and stroke-only forms placed by translation are drawn
 * inline. Only strokes are merged: filled shapes that overlap would cancel out (non-zero and
 * even-odd winding), and transparency (`gs`) is left alone, as overlapping translucent strokes
 * darken where they cross.
 */

import { asRect, clipLines, clipRegion, flattenCurve, type Polyline } from './clip';

/** Whitespace and delimiters (PDF 32000 7.2.2). */
const WHITE = new Uint8Array(256);
for (const c of [0, 9, 10, 12, 13, 32]) WHITE[c] = 1;
const DELIM = new Uint8Array(256);
for (const c of '()<>[]{}/%') DELIM[c.charCodeAt(0)] = 1;
const regular = (c: number) => !WHITE[c] && !DELIM[c];

/** Stroke state an item may set before its path. */
const STATE_OPS = new Set(['RG', 'rg', 'G', 'g', 'K', 'k', 'CS', 'cs', 'SC', 'SCN', 'sc', 'scn', 'w', 'J', 'j', 'M', 'd', 'i', 'ri']);
const PATH_OPS = new Set(['m', 'l', 'c', 'v', 'y', 'h', 're']);

/**
 * Reads a content stream one operator at a time: the operator, where its operands start, and its
 * numeric operands. Strings, arrays, dictionaries and inline images are skipped whole.
 */
export class Scanner {
  pos = 0;
  /** The operator just read. */
  op = '';
  /** Where its first operand (or the operator itself) starts, and the offset just after it. */
  start = 0;
  end = 0;
  /** Where the operator keyword itself starts. */
  opStart = 0;
  /** Numeric operands in order (up to 16), how many there were, and how many operands in all. */
  readonly nums = new Float64Array(16);
  numCount = 0;
  operands = 0;
  /** The last name operand, without its slash (the XObject of `Do`). */
  name = '';

  constructor(readonly data: Uint8Array) {}

  /** Reads the next operator; false at the end. */
  next(): boolean {
    const d = this.data;
    const n = d.length;
    this.numCount = 0;
    this.operands = 0;
    this.name = '';
    this.start = -1;
    for (;;) {
      while (this.pos < n && WHITE[d[this.pos]!]) this.pos++;
      if (this.pos >= n) return false;
      const c = d[this.pos]!;
      if (c === 0x25 /* % */) {
        while (this.pos < n && d[this.pos] !== 10 && d[this.pos] !== 13) this.pos++;
        continue;
      }
      if (this.start < 0) this.start = this.pos;
      if (c === 0x2f /* / */) {
        const s = ++this.pos;
        while (this.pos < n && regular(d[this.pos]!)) this.pos++;
        this.name = latin1(d, s, this.pos);
        this.operands++;
      } else if (c === 0x28 /* ( */) {
        this.skipString();
        this.operands++;
      } else if (c === 0x3c /* < */) {
        if (d[this.pos + 1] === 0x3c) this.skipDict();
        else this.skipHex();
        this.operands++;
      } else if (c === 0x5b /* [ */) {
        this.skipArray();
        this.operands++;
      } else if (DELIM[c]) {
        // A stray closing delimiter: malformed, skipped.
        this.pos++;
      } else {
        const s = this.pos;
        while (this.pos < n && regular(d[this.pos]!)) this.pos++;
        const num = parseNumber(d, s, this.pos);
        if (num !== null) {
          if (this.numCount < 16) this.nums[this.numCount] = num;
          this.numCount++;
          this.operands++;
          continue;
        }
        const word = latin1(d, s, this.pos);
        if (word === 'true' || word === 'false' || word === 'null') {
          this.operands++;
          continue;
        }
        this.op = word;
        this.opStart = s;
        if (word === 'BI') this.skipInlineImage();
        this.end = this.pos;
        return true;
      }
    }
  }

  private skipString() {
    const d = this.data;
    let depth = 0;
    while (this.pos < d.length) {
      const c = d[this.pos++]!;
      if (c === 0x5c /* \ */) this.pos++;
      else if (c === 0x28) depth++;
      else if (c === 0x29 && --depth === 0) return;
    }
  }

  private skipHex() {
    const d = this.data;
    while (this.pos < d.length && d[this.pos] !== 0x3e) this.pos++;
    this.pos++;
  }

  private skipDict() {
    const d = this.data;
    this.pos += 2;
    let depth = 1;
    while (this.pos < d.length && depth > 0) {
      const c = d[this.pos]!;
      if (c === 0x28) this.skipString();
      else if (c === 0x3c && d[this.pos + 1] === 0x3c) {
        depth++;
        this.pos += 2;
      } else if (c === 0x3e && d[this.pos + 1] === 0x3e) {
        depth--;
        this.pos += 2;
      } else if (c === 0x3c) this.skipHex();
      else this.pos++;
    }
  }

  private skipArray() {
    const d = this.data;
    this.pos++;
    let depth = 1;
    while (this.pos < d.length && depth > 0) {
      const c = d[this.pos]!;
      if (c === 0x28) this.skipString();
      else if (c === 0x3c && d[this.pos + 1] === 0x3c) this.skipDict();
      else if (c === 0x3c) this.skipHex();
      else {
        if (c === 0x5b) depth++;
        else if (c === 0x5d) depth--;
        this.pos++;
      }
    }
  }

  /** BI <key value ...> ID <binary> EI: past the EI. */
  private skipInlineImage() {
    const d = this.data;
    // The image dictionary: up to the ID keyword.
    for (;;) {
      while (this.pos < d.length && WHITE[d[this.pos]!]) this.pos++;
      if (this.pos >= d.length) return;
      const c = d[this.pos]!;
      if (c === 0x28) this.skipString();
      else if (c === 0x3c && d[this.pos + 1] === 0x3c) this.skipDict();
      else if (c === 0x3c) this.skipHex();
      else if (c === 0x5b) this.skipArray();
      else if (DELIM[c]) this.pos++;
      else {
        const s = this.pos;
        while (this.pos < d.length && regular(d[this.pos]!)) this.pos++;
        if (this.pos - s === 2 && d[s] === 0x49 && d[s + 1] === 0x44) break;
      }
    }
    // One whitespace byte, then data up to EI standing on its own.
    this.pos++;
    while (this.pos < d.length) {
      if (d[this.pos] === 0x45 && d[this.pos + 1] === 0x49 && WHITE[d[this.pos - 1]!] && (this.pos + 2 >= d.length || !regular(d[this.pos + 2]!))) {
        this.pos += 2;
        return;
      }
      this.pos++;
    }
  }
}

function latin1(d: Uint8Array, s: number, e: number): string {
  return e - s < 64 ? String.fromCharCode(...d.subarray(s, e)) : new TextDecoder('latin1').decode(d.subarray(s, e));
}

/** A PDF number token (`12`, `-0.5`, `.25`, `+3.`), or null. */
function parseNumber(d: Uint8Array, s: number, e: number): number | null {
  let i = s;
  let sign = 1;
  if (d[i] === 0x2d) {
    sign = -1;
    i++;
  } else if (d[i] === 0x2b) i++;
  let v = 0;
  let digits = 0;
  while (i < e && d[i]! >= 0x30 && d[i]! <= 0x39) {
    v = v * 10 + (d[i]! - 0x30);
    i++;
    digits++;
  }
  if (i < e && d[i] === 0x2e) {
    i++;
    let f = 0.1;
    while (i < e && d[i]! >= 0x30 && d[i]! <= 0x39) {
      v += (d[i]! - 0x30) * f;
      f /= 10;
      i++;
      digits++;
    }
  }
  return i === e && digits > 0 ? sign * v : null;
}

/**
 * The largest size (points, along the image's own width and height) each XObject is placed at by
 * this content, from the transformation in force at its `Do`. Forms count too; the caller picks
 * out its images.
 */
export function placements(data: Uint8Array): Map<string, { w: number; h: number }> {
  const out = new Map<string, { w: number; h: number }>();
  const sc = new Scanner(data);
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack: number[][] = [];
  while (sc.next()) {
    const op = sc.op;
    if (op === 'q') stack.push(ctm);
    else if (op === 'Q') ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0];
    else if (op === 'cm' && sc.numCount === 6) {
      const [a, b, c, d, e, f] = sc.nums;
      const [A, B, C, D, E, F] = ctm as [number, number, number, number, number, number];
      ctm = [a! * A + b! * C, a! * B + b! * D, c! * A + d! * C, c! * B + d! * D, e! * A + f! * C + E, e! * B + f! * D + F];
    } else if (op === 'Do' && sc.name) {
      // The unit square's sides, mapped by the CTM.
      const w = Math.hypot(ctm[0]!, ctm[1]!);
      const h = Math.hypot(ctm[2]!, ctm[3]!);
      const was = out.get(sc.name);
      out.set(sc.name, { w: Math.max(w, was?.w ?? 0), h: Math.max(h, was?.h ?? 0) });
    }
  }
  return out;
}

/** A form XObject that only strokes paths: drawn inline instead of placed. */
export interface StrokeForm {
  /** Its stroke state operators, as written. */
  state: string;
  /** Path operators, each with its coordinates (x, y pairs). */
  path: { op: string; xy: number[] }[];
}

/**
 * The form's content as a StrokeForm, or null when it does anything but set stroke state and
 * stroke paths (all state before the first path), or reaches outside `bbox` (which clips it).
 */
export function parseStrokeForm(content: Uint8Array, bbox: readonly [number, number, number, number]): StrokeForm | null {
  const sc = new Scanner(content);
  const state: string[] = [];
  const path: StrokeForm['path'] = [];
  let open = false;
  let width = 1;
  while (sc.next()) {
    const op = sc.op;
    if (STATE_OPS.has(op)) {
      if (path.length) return null;
      if (op === 'w' && sc.numCount === 1) width = sc.nums[0]!;
      state.push(latin1(content, sc.start, sc.end));
    } else if (PATH_OPS.has(op)) {
      if (sc.numCount !== sc.operands || sc.numCount > 16) return null;
      if (op === 're') {
        const [x, y, w, h] = sc.nums;
        path.push({ op: 'm', xy: [x!, y!] }, { op: 'l', xy: [x! + w!, y!] }, { op: 'l', xy: [x! + w!, y! + h!] }, { op: 'l', xy: [x!, y! + h!] }, { op: 'h', xy: [] });
      } else path.push({ op, xy: Array.from(sc.nums.subarray(0, sc.numCount)) });
      open = true;
    } else if (op === 'S' || op === 's') {
      if (!open) return null;
      if (op === 's') path.push({ op: 'h', xy: [] });
      open = false;
    } else return null;
  }
  if (!path.length || open) return null;
  // The form's bounding box clips it: only forms drawn wholly inside it can go inline.
  const pad = width / 2 + 1e-6;
  for (const p of path) {
    for (let k = 0; k < p.xy.length; k += 2) {
      if (p.xy[k]! < bbox[0] - pad || p.xy[k]! > bbox[2] + pad || p.xy[k + 1]! < bbox[1] - pad || p.xy[k + 1]! > bbox[3] + pad) return null;
    }
  }
  return { state: state.join('\n'), path };
}

export interface OptimizeOptions {
  /** The stroke-only form a `Do` names, or null to leave the placement as it is. */
  form?: (name: string) => StrokeForm | null;
  /** Side of the square areas (user space units) merged paths are grouped into. */
  cell?: number;
  /** Most path operators in one merged path. */
  maxPathOps?: number;
}

export interface OptimizeStats {
  /** Stroke objects (and inlined form placements) found in runs worth merging. */
  merged: number;
  /** Form placements drawn inline. */
  inlined: number;
  /** Path objects written in their place. */
  written: number;
  /** Clipping paths around stroke objects whose lines were cut to them (or lay inside them) instead. */
  clips: number;
  /** Rectangular clipping paths written as polygons, written as rectangles. */
  rects: number;
}

type Chunk = Uint8Array | string;

/** One stroke object, or a form placement drawn inline, ready to merge with its neighbours. */
interface Item {
  start: number;
  end: number;
  key: string;
  state: Chunk;
  paths: Chunk[];
  x: number;
  y: number;
  ops: number;
  inlined: boolean;
}

interface Run {
  key: string;
  state: Chunk;
  /** Paths by area, in the order areas were first reached, with each one's operator count. */
  cells: Map<number, { paths: Chunk[]; ops: number[] }>;
  items: number;
  inlined: number;
}

const fmt = (v: number) => {
  const r = Math.round(v * 10000) / 10000;
  return Object.is(r, -0) ? '0' : String(r);
};

/** Rewrites a page's (or form's) content with runs of stroke objects merged. */
export function optimizeContent(data: Uint8Array, options: OptimizeOptions = {}): { bytes: Uint8Array; stats: OptimizeStats } {
  const cell = options.cell ?? 64;
  const maxOps = options.maxPathOps ?? 4000;
  const sc = new Scanner(data);
  const out: Chunk[] = [];
  const stats: OptimizeStats = { merged: 0, inlined: 0, written: 0, clips: 0, rects: 0 };
  let pass = 0;
  let run: Run | null = null;

  /** Takes items read from `start` to `end` into the run (the bytes they came from are dropped). */
  const take = (start: number, end: number, items: Item[]) => {
    for (const item of items) {
      if (run && (run as Run).key !== item.key) flush();
      if (!run) {
        out.push(data.subarray(pass, start));
        pass = start;
        run = { key: item.key, state: item.state, cells: new Map(), items: 0, inlined: 0 };
      }
      const r: Run = run;
      const ck = (Math.floor(item.x / cell) + 32768) * 65536 + (Math.floor(item.y / cell) + 32768);
      let c = r.cells.get(ck);
      if (!c) r.cells.set(ck, (c = { paths: [], ops: [] }));
      // The object's whole path counts against the merged path's size, on its first part.
      for (let k = 0; k < item.paths.length; k++) {
        c.paths.push(item.paths[k]!);
        c.ops.push(k ? 0 : item.ops);
      }
      r.items++;
      if (item.inlined) r.inlined++;
    }
    // Wholly clipped away: nothing of it is drawn, so nothing is written.
    if (!run) out.push(data.subarray(pass, start));
    pass = end;
  };

  const flush = () => {
    if (!run) return;
    const r = run;
    run = null;
    for (const { paths, ops } of r.cells.values()) {
      let sum = 0;
      let at = 0;
      for (let k = 0; k < paths.length; k++) {
        sum += ops[k]!;
        if (sum < maxOps && k < paths.length - 1) continue;
        out.push('q\n', r.state, '\n');
        for (let p = at; p <= k; p++) {
          const path = paths[p]!;
          out.push(path);
          const last = typeof path === 'string' ? path.charCodeAt(path.length - 1) : path[path.length - 1];
          if (last !== 10) out.push('\n');
        }
        out.push('S\nQ\n');
        stats.written++;
        sum = 0;
        at = k + 1;
      }
    }
    stats.merged += r.items;
    stats.inlined += r.inlined;
  };

  /** Where the path being built (outside any merged object) starts, for clipping paths. */
  let pathStart = -1;
  while (sc.next()) {
    const op = sc.op;
    if (op !== 'q') {
      flush();
      if (PATH_OPS.has(op)) {
        if (pathStart < 0) pathStart = sc.start;
        continue;
      }
      if ((op === 'W' || op === 'W*') && pathStart >= 0) {
        // A rectangle written as a polygon with points along its sides: as a rectangle, the
        // renderer clips to it directly instead of through a mask.
        const shape = polylines([data.subarray(pathStart, sc.opStart)]);
        const rect = shape && shape.length === 1 && shape[0]!.pts.length > 10 ? asRect(shape) : null;
        if (rect) {
          out.push(data.subarray(pass, pathStart), `${fmt(rect[0])} ${fmt(rect[1])} ${fmt(rect[2] - rect[0])} ${fmt(rect[3] - rect[1])} re\n`);
          pass = sc.opStart;
          stats.rects++;
        }
      }
      pathStart = -1;
      continue;
    }
    pathStart = -1;
    const qStart = sc.opStart;
    const after = sc.pos;
    const item = readItem(sc, qStart, options.form);
    if (item) {
      take(item.start, item.end, [item]);
      continue;
    }
    sc.pos = after;
    const scope = readClipScope(sc, options.form);
    if (scope) {
      stats.clips++;
      take(qStart, sc.end, scope);
      continue;
    }
    sc.pos = after;
    flush();
  }
  flush();
  out.push(data.subarray(pass));
  return { bytes: concat(out), stats };
}

/** Subpaths of path operators, curves flattened, or null for anything malformed. */
function polylines(chunks: Chunk[]): Polyline[] | null {
  const out: Polyline[] = [];
  let cur: Polyline | null = null;
  for (const chunk of chunks) {
    const bytes = typeof chunk === 'string' ? latin1Bytes(chunk) : chunk;
    const sc = new Scanner(bytes);
    while (sc.next()) {
      const n = sc.nums;
      const text = `${latin1(bytes, sc.start, sc.end)}\n`;
      const op = sc.op;
      if (op === 'm' && sc.numCount === 2) {
        out.push((cur = { pts: [n[0]!, n[1]!], closed: false, src: text }));
        continue;
      }
      if (op === 're' && sc.numCount === 4) {
        const [x, y, w, h] = n;
        out.push((cur = { pts: [x!, y!, x! + w!, y!, x! + w!, y! + h!, x!, y! + h!], closed: true, src: text }));
        continue;
      }
      if (!cur) return null;
      if (op === 'h') {
        cur.closed = true;
        cur.src += text;
        continue;
      }
      // After a close, drawing on starts a new subpath at the closed one's start.
      if (cur.closed) out.push((cur = { pts: [cur.pts[0]!, cur.pts[1]!], closed: false, src: `${fmt(cur.pts[0]!)} ${fmt(cur.pts[1]!)} m\n` }));
      const x0 = cur.pts[cur.pts.length - 2]!;
      const y0 = cur.pts[cur.pts.length - 1]!;
      if (op === 'l' && sc.numCount === 2) cur.pts.push(n[0]!, n[1]!);
      else if (op === 'c' && sc.numCount === 6) flattenCurve(cur.pts, x0, y0, n[0]!, n[1]!, n[2]!, n[3]!, n[4]!, n[5]!);
      else if (op === 'v' && sc.numCount === 4) flattenCurve(cur.pts, x0, y0, x0, y0, n[0]!, n[1]!, n[2]!, n[3]!);
      else if (op === 'y' && sc.numCount === 4) flattenCurve(cur.pts, x0, y0, n[0]!, n[1]!, n[2]!, n[3]!, n[2]!, n[3]!);
      else return null;
      cur.src += text;
    }
  }
  return out;
}

function latin1Bytes(s: string): Uint8Array {
  const b = new Uint8Array(s.length);
  for (let k = 0; k < s.length; k++) b[k] = s.charCodeAt(k);
  return b;
}

/** How far inside a clipping rectangle a path's points must lie for the clip to be dropped. */
const RECT_MARGIN = 0.5;

/**
 * Whether every point of the path operators (curve control points included: a curve stays within
 * them) lies inside the rectangle.
 */
function within(chunks: Chunk[], [x0, y0, x1, y1]: [number, number, number, number]): boolean {
  const ok = (x: number, y: number) => x >= x0 + RECT_MARGIN && x <= x1 - RECT_MARGIN && y >= y0 + RECT_MARGIN && y <= y1 - RECT_MARGIN;
  for (const chunk of chunks) {
    const sc = new Scanner(typeof chunk === 'string' ? latin1Bytes(chunk) : chunk);
    while (sc.next()) {
      const n = sc.nums;
      if (sc.op === 're') {
        if (!ok(n[0]!, n[1]!) || !ok(n[0]! + n[2]!, n[1]! + n[3]!)) return false;
      } else for (let k = 0; k + 1 < sc.numCount; k += 2) if (!ok(n[k]!, n[k + 1]!)) return false;
    }
  }
  return true;
}

/** A dash pattern set (lines cut part way would restart their dashes). */
const DASHED = /\[\s*[-\d.]/;

/**
 * After a `q`: a clipping path (`... W n` or `W* n`) around stroke objects only, read through its
 * `Q`, as those objects with their lines cut to the clip (or as they are, when the clip is a
 * rectangle they lie inside). Null for anything else, dashed lines included.
 */
function readClipScope(sc: Scanner, form: OptimizeOptions['form']): Item[] | null {
  const d = sc.data;
  let pathStart = -1;
  /** The next operator (null at the end). */
  const next = (): string | null => (sc.next() ? sc.op : null);
  // The clipping path, its W or W*, and n.
  for (let op = next(); op; op = next()) {
    if (PATH_OPS.has(op)) {
      if (pathStart < 0) pathStart = sc.start;
      continue;
    }
    if ((op === 'W' || op === 'W*') && pathStart >= 0) {
      const evenOdd = op === 'W*';
      const pathEnd = sc.opStart;
      if (next() !== 'n') return null;
      const shape = polylines([d.subarray(pathStart, pathEnd)]);
      if (!shape) return null;
      const items: Item[] = [];
      for (;;) {
        const inner = next();
        if (inner === 'Q') break;
        if (inner !== 'q') return null;
        const item = readItem(sc, sc.opStart, form);
        if (!item) return null;
        items.push(item);
      }
      if (!items.length) return null;
      // A rectangle everything already lies inside clips nothing (curves included).
      const rect = asRect(shape);
      if (rect && items.every((item) => within(item.paths, rect))) return items;
      const region = clipRegion(shape, evenOdd);
      if (!region) return null;
      const out: Item[] = [];
      for (const item of items) {
        const lines = polylines(item.paths);
        if (!lines || DASHED.test(item.state as string)) return null;
        const cut = clipLines(lines, region);
        if (!cut) continue;
        const first = /^(\S+) (\S+) m/.exec(cut);
        out.push({ ...item, paths: [cut], x: first ? Number(first[1]) : item.x, y: first ? Number(first[2]) : item.y });
      }
      return out;
    }
    return null;
  }
  return null;
}

/**
 * After a `q` (at `qStart`): a stroke object (`q [state] path S [state] Q`) or a stroke-only form
 * placed by translation (`q [1 0 0 1 tx ty cm] [state] /Fm Do Q`), read through its `Q`. Null (the
 * scanner then somewhere inside) for anything else.
 */
function readItem(sc: Scanner, qStart: number, form: OptimizeOptions['form']): Item | null {
  const d = sc.data;
  let stateStart = -1;
  let stateEnd = -1;
  let cm: [number, number] | null = null;
  /** 0 state, 1 path, 2 stroked. */
  let phase = 0;
  let pathStart = 0;
  const paths: Chunk[] = [];
  let x = NaN;
  let y = NaN;
  let ops = 0;
  while (sc.next()) {
    const op = sc.op;
    if (op === 'cm' && phase === 0 && !cm && stateStart < 0) {
      const n = sc.nums;
      // Translation only: a scale would change how wide the form's lines are drawn.
      if (sc.numCount !== 6 || sc.operands !== 6 || n[0] !== 1 || n[1] !== 0 || n[2] !== 0 || n[3] !== 1) return null;
      cm = [n[4]!, n[5]!];
    } else if (STATE_OPS.has(op)) {
      if (phase === 1) return null;
      // After stroking, state resets are undone by Q anyway.
      if (phase === 0) {
        if (stateStart < 0) stateStart = sc.start;
        stateEnd = sc.end;
      }
    } else if (PATH_OPS.has(op)) {
      if (cm) return null;
      if (phase !== 1) {
        pathStart = sc.start;
        phase = 1;
      }
      if (Number.isNaN(x) && sc.numCount >= 2) {
        x = sc.nums[0]!;
        y = sc.nums[1]!;
      }
      ops++;
    } else if (op === 'S' || op === 's') {
      if (phase !== 1) return null;
      paths.push(d.subarray(pathStart, sc.opStart));
      if (op === 's') paths.push('h');
      phase = 2;
    } else if (op === 'Q') {
      if (phase !== 2 || Number.isNaN(x)) return null;
      const state = stateStart < 0 ? '' : latin1(d, stateStart, stateEnd);
      return { start: qStart, end: sc.end, key: state, state, paths, x, y, ops, inlined: false };
    } else if (op === 'Do' && phase === 0 && form) {
      const f = sc.operands === 1 && sc.name ? form(sc.name) : null;
      if (!f || !sc.next() || sc.op !== 'Q') return null;
      const [tx, ty] = cm ?? [0, 0];
      const outer = stateStart < 0 ? '' : latin1(d, stateStart, stateEnd);
      const state = outer ? `${outer}\n${f.state}` : f.state;
      let text = '';
      for (const p of f.path) {
        for (let k = 0; k < p.xy.length; k += 2) text += `${fmt(p.xy[k]! + tx)} ${fmt(p.xy[k + 1]! + ty)} `;
        text += `${p.op}\n`;
      }
      const first = f.path[0]!.xy;
      return { start: qStart, end: sc.end, key: state, state, paths: [text], x: first[0]! + tx, y: first[1]! + ty, ops: f.path.length, inlined: true };
    } else return null;
  }
  return null;
}

/** Joins chunks; strings are Latin-1 (state text read back from the stream byte for byte). */
function concat(chunks: Chunk[]): Uint8Array {
  let size = 0;
  for (const c of chunks) size += c.length;
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    if (typeof c === 'string') for (let k = 0; k < c.length; k++) out[at + k] = c.charCodeAt(k);
    else out.set(c, at);
    at += c.length;
  }
  return out;
}
