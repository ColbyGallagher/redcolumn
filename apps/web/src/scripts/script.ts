import { MARKUP_LABELS, type CustomColumn, type Markup, type MarkupStatusDef } from '@nb/markup';

/**
 * Markup scripts: short rules that find markups and change them, for repetitive edits across a
 * document. A script is plain text, read by this small interpreter: nothing in it runs as code, so
 * a script cannot reach the page, the network or the files (the app's security policy forbids
 * `eval` anyway).
 *
 *   # Put Sam's clouds on their own layer, in red
 *   where type is cloud and author is "Sam"
 *   set layer "Review – Sam"
 *   set color red
 *
 *   rename layer "Old notes" to "Notes"
 *
 * Each `where` starts a rule; the `set` lines after it change every markup it finds. `every
 * markup` matches them all. Conditions compare a field with `is`, `is not`, `contains`, `does not
 * contain`, `starts with`, `ends with`, `matches /regex/`, `is empty`, `is not empty`, or `<`, `<=`,
 * `>`, `>=` for numbers, joined with `and`, `or`, `not` and brackets.
 */

/** What a script can read about a markup. */
export const READ_FIELDS = ['type', 'subject', 'author', 'status', 'layer', 'comment', 'text', 'color', 'fill', 'width', 'opacity', 'page', 'sheet', 'checked', 'locked', 'replies'] as const;
/** What a script can change. */
export const SET_FIELDS = ['color', 'fill', 'width', 'opacity', 'status', 'layer', 'subject', 'comment', 'checked'] as const;

type ReadField = (typeof READ_FIELDS)[number] | { column: string };
type SetField = (typeof SET_FIELDS)[number] | { column: string };

type Op = 'is' | 'is not' | 'contains' | 'does not contain' | 'starts with' | 'ends with' | 'matches' | 'is empty' | 'is not empty' | '<' | '<=' | '>' | '>=';

type Cond = { kind: 'cmp'; field: ReadField; op: Op; value: string | RegExp | null } | { kind: 'and'; a: Cond; b: Cond } | { kind: 'or'; a: Cond; b: Cond } | { kind: 'not'; a: Cond } | { kind: 'all' };

interface Rule {
  line: number;
  where: Cond;
  sets: { line: number; field: SetField; value: string }[];
}

export interface Program {
  rules: Rule[];
}

export interface ScriptError {
  line: number;
  message: string;
}

/** What running a script on a document needs besides its markups. */
export interface ScriptContext {
  statuses: readonly MarkupStatusDef[];
  columns: readonly CustomColumn[];
  pageLabel: (pageIndex: number) => string;
}

/** One markup's changes, for the preview and then the store. */
export interface ScriptChange {
  id: string;
  /** `Cloud, page 2`. */
  what: string;
  patch: Partial<Markup>;
  /** `color red → #0000ff`, … */
  changes: string[];
}

export interface ScriptRun {
  changes: ScriptChange[];
  /** Markups a rule found but could not change (locked), named. */
  skipped: string[];
  /** How many markups each rule found, in order. */
  found: number[];
}

const COLORS: Record<string, string> = {
  red: '#ff0000',
  green: '#008000',
  blue: '#0000ff',
  yellow: '#ffff00',
  orange: '#ffa500',
  purple: '#800080',
  magenta: '#ff00ff',
  cyan: '#00ffff',
  black: '#000000',
  white: '#ffffff',
  grey: '#808080',
  gray: '#808080',
};

// ---- Parsing ------------------------------------------------------------------------------------

type Tok = { t: 'word' | 'str' | 'num' | 'regex' | 'sym'; v: string; flags?: string };

class ParseError extends Error {}

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) {
      i++;
    } else if (c === '"' || c === '“') {
      const close = c === '"' ? '"' : '”';
      let v = '';
      i++;
      while (i < src.length && src[i] !== close) {
        if (src[i] === '\\' && i + 1 < src.length) i++;
        v += src[i++];
      }
      if (i >= src.length) throw new ParseError('a quote is not closed');
      i++;
      out.push({ t: 'str', v });
    } else if (c === '/') {
      let v = '';
      i++;
      while (i < src.length && src[i] !== '/') {
        if (src[i] === '\\' && i + 1 < src.length) v += src[i++];
        v += src[i++];
      }
      if (i >= src.length) throw new ParseError('a /pattern/ is not closed');
      i++;
      let flags = '';
      while (/[imsu]/.test(src[i] ?? '')) flags += src[i++];
      out.push({ t: 'regex', v, flags });
    } else if ('()'.includes(c)) {
      out.push({ t: 'sym', v: c });
      i++;
    } else if ('<>=!'.includes(c)) {
      const two = src.slice(i, i + 2);
      const v = ['<=', '>=', '!=', '=='].includes(two) ? two : c;
      i += v.length;
      out.push({ t: 'sym', v: v === '==' || v === '=' ? 'is' : v === '!=' ? 'is not' : v });
    } else {
      let v = '';
      while (i < src.length && !/[\s()<>=!"“]/.test(src[i]!)) v += src[i++];
      out.push({ t: /^-?\d+(\.\d+)?%?$/.test(v) ? 'num' : 'word', v });
    }
  }
  return out;
}

const FIELD_ALIASES: Record<string, (typeof READ_FIELDS)[number]> = { colour: 'color', stroke: 'color', 'line color': 'color', comments: 'comment', label: 'subject', kind: 'type' };

class Parser {
  i = 0;
  constructor(readonly toks: Tok[]) {}
  peek(n = 0) {
    return this.toks[this.i + n];
  }
  word(n = 0) {
    const t = this.peek(n);
    return t && (t.t === 'word' || t.t === 'sym') ? t.v.toLowerCase() : null;
  }
  take(...words: string[]) {
    if (words.every((w, k) => this.word(k) === w)) {
      this.i += words.length;
      return true;
    }
    return false;
  }
  done() {
    return this.i >= this.toks.length;
  }

  field(set: boolean): ReadField {
    if (this.take('column')) {
      const t = this.peek();
      if (!t || (t.t !== 'str' && t.t !== 'word')) throw new ParseError('column needs a name, e.g. column "Responsibility"');
      this.i++;
      return { column: t.v };
    }
    let w = this.word();
    if (!w) throw new ParseError(set ? 'set needs something to change' : 'a condition needs a field, e.g. type, author or color');
    if (w === 'line' && this.word(1) === 'color') {
      this.i++;
      w = 'line color';
    }
    this.i++;
    const f = (FIELD_ALIASES[w] ?? w) as (typeof READ_FIELDS)[number];
    if (set ? !(SET_FIELDS as readonly string[]).includes(f) : !(READ_FIELDS as readonly string[]).includes(f)) {
      throw new ParseError(`${set ? 'cannot set' : 'unknown field'} "${w}"${set ? ` (you can set ${SET_FIELDS.join(', ')}, or a column)` : ` (fields: ${READ_FIELDS.join(', ')}, or column "Name")`}`);
    }
    return f;
  }

  value(): string {
    const t = this.peek();
    if (!t || t.t === 'sym') throw new ParseError('a value is missing');
    this.i++;
    // Several bare words read as one value: set layer Review notes.
    let v = t.v;
    if (t.t === 'word') while (this.peek()?.t === 'word' && !['and', 'or', 'to'].includes(this.word()!)) v += ' ' + this.toks[this.i++]!.v;
    return v;
  }

  op(): Op {
    const tries: [string[], Op][] = [
      [['is', 'not', 'empty'], 'is not empty'],
      [['is', 'empty'], 'is empty'],
      [['is', 'not'], 'is not'],
      [['does', 'not', 'contain'], 'does not contain'],
      [['contains'], 'contains'],
      [['starts', 'with'], 'starts with'],
      [['ends', 'with'], 'ends with'],
      [['matches'], 'matches'],
      [['is'], 'is'],
      [['<='], '<='],
      [['>='], '>='],
      [['<'], '<'],
      [['>'], '>'],
    ];
    for (const [words, op] of tries) if (this.take(...words)) return op;
    throw new ParseError(`expected is, is not, contains, starts with, matches, < or > after the field, not "${this.peek()?.v ?? 'the end of the line'}"`);
  }

  cmp(): Cond {
    if (this.take('(')) {
      const c = this.or();
      if (!this.take(')')) throw new ParseError('a bracket is not closed');
      return c;
    }
    if (this.take('not')) return { kind: 'not', a: this.cmp() };
    const field = this.field(false);
    const op = this.op();
    if (op === 'is empty' || op === 'is not empty') return { kind: 'cmp', field, op, value: null };
    if (op === 'matches') {
      const t = this.peek();
      if (t?.t !== 'regex') throw new ParseError('matches needs a /pattern/');
      this.i++;
      try {
        return { kind: 'cmp', field, op, value: new RegExp(t.v, t.flags) };
      } catch {
        throw new ParseError(`/${t.v}/ is not a valid pattern`);
      }
    }
    return { kind: 'cmp', field, op, value: this.value() };
  }
  and(): Cond {
    let a = this.cmp();
    while (this.take('and')) a = { kind: 'and', a, b: this.cmp() };
    return a;
  }
  or(): Cond {
    let a = this.and();
    while (this.take('or')) a = { kind: 'or', a, b: this.and() };
    return a;
  }
}

/** Reads a script. Every line that cannot be read is listed, with why. */
export function parseScript(source: string): { program: Program; errors: ScriptError[] } {
  const rules: Rule[] = [];
  const errors: ScriptError[] = [];
  source.split(/\r?\n/).forEach((raw, n) => {
    const line = n + 1;
    // Comments: a line starting with # or //, or the rest of a line after ' // '.
    const text = (/^\s*(#|\/\/)/.test(raw) ? '' : raw.replace(/\s\/\/\s.*$/, '')).trim();
    if (!text) return;
    try {
      const p = new Parser(tokenize(text));
      if (p.take('where') || p.take('for', 'markups', 'where')) {
        const where = p.or();
        if (!p.done()) throw new ParseError(`"${p.peek()!.v}" is not understood here (join conditions with and / or)`);
        rules.push({ line, where, sets: [] });
      } else if (p.take('every', 'markup') || p.take('all', 'markups') || p.take('every', 'markups')) {
        if (!p.done()) throw new ParseError('every markup takes no condition; use where … instead');
        rules.push({ line, where: { kind: 'all' }, sets: [] });
      } else if (p.take('rename', 'layer')) {
        const from = p.value();
        if (!p.take('to')) throw new ParseError('rename layer "Old" to "New"');
        const to = p.value();
        if (!p.done()) throw new ParseError('rename layer "Old" to "New"');
        rules.push({ line, where: { kind: 'cmp', field: 'layer', op: 'is', value: from }, sets: [{ line, field: 'layer', value: to }] });
      } else if (p.take('set')) {
        const rule = rules[rules.length - 1];
        if (!rule) throw new ParseError('set comes after a where line (or every markup) that says which markups');
        const field = p.field(true) as SetField;
        p.take('to');
        const value = p.value();
        if (!p.done()) throw new ParseError(`"${p.peek()!.v}" is not understood after the value (put it in quotes if it is part of it)`);
        rule.sets.push({ line, field, value });
      } else throw new ParseError(`a line starts with where, every markup, set or rename layer, not "${p.peek()?.v}"`);
    } catch (e) {
      if (!(e instanceof ParseError)) throw e;
      errors.push({ line, message: e.message });
    }
  });
  for (const r of rules) if (!r.sets.length) errors.push({ line: r.line, message: 'this rule changes nothing: add set lines after it' });
  return { program: { rules }, errors };
}

// ---- Running ------------------------------------------------------------------------------------

const lower = (s: string) => s.trim().toLowerCase();
const colorOf = (v: string) => {
  const s = lower(v);
  return COLORS[s] ?? (/^#?[0-9a-f]{6}$/.test(s) ? (s.startsWith('#') ? s : `#${s}`) : /^#?[0-9a-f]{3}$/.test(s) ? `#${[...s.replace('#', '')].map((c) => c + c).join('')}` : null);
};

function readField(m: Markup, f: ReadField, ctx: ScriptContext): string | number | boolean {
  if (typeof f === 'object') {
    const col = ctx.columns.find((c) => lower(c.name) === lower(f.column));
    return col ? (m.fields?.[col.id] ?? '') : '';
  }
  switch (f) {
    case 'type':
      return m.type;
    case 'subject':
      return m.subject ?? MARKUP_LABELS[m.type];
    case 'author':
      return m.author;
    case 'status':
      return ctx.statuses.find((s) => s.id === m.status)?.name ?? m.status;
    case 'layer':
      return m.layer ?? '';
    case 'comment':
      return m.comment ?? '';
    case 'text':
      return m.text ?? '';
    case 'color':
      return m.style.stroke;
    case 'fill':
      return m.style.fill ?? 'none';
    case 'width':
      return m.style.width;
    case 'opacity':
      return Math.round(m.style.opacity * 100);
    case 'page':
      return m.pageIndex + 1;
    case 'sheet':
      return ctx.pageLabel(m.pageIndex);
    case 'checked':
      return !!m.checked;
    case 'locked':
      return !!m.locked;
    case 'replies':
      return m.replies?.length ?? 0;
  }
}

function test(c: Cond, m: Markup, ctx: ScriptContext): boolean {
  if (c.kind === 'all') return true;
  if (c.kind === 'and' || c.kind === 'or') return c.kind === 'and' ? test(c.a, m, ctx) && test(c.b, m, ctx) : test(c.a, m, ctx) || test(c.b, m, ctx);
  if (c.kind === 'not') return !test(c.a, m, ctx);
  const raw = readField(m, c.field, ctx);
  if (c.op === 'is empty') return raw === '' || raw === 'none';
  if (c.op === 'is not empty') return !(raw === '' || raw === 'none');
  if (c.value instanceof RegExp) return c.value.test(String(raw));
  const v = c.value ?? '';
  const order = (x: number, n: number) => (c.op === '<' ? x < n : c.op === '<=' ? x <= n : c.op === '>' ? x > n : x >= n);
  if (typeof raw === 'number') {
    const n = Number(v.replace(/%$/, ''));
    if (Number.isNaN(n)) return c.op === 'is not';
    if (c.op === 'is' || c.op === 'is not') return (raw === n) === (c.op === 'is');
    if (c.op === '<' || c.op === '<=' || c.op === '>' || c.op === '>=') return order(raw, n);
    return String(raw).includes(String(n)) === (c.op !== 'does not contain');
  }
  if (typeof raw === 'boolean') {
    const want = /^(true|yes|on|checked|locked)$/i.test(v);
    return c.op === 'is not' ? raw !== want : raw === want;
  }
  let a = lower(raw);
  let b = lower(v);
  // A type matches by its name too (cloud, Cloud+…, "text box").
  if (c.field === 'type') a = `${a}\u0000${lower(MARKUP_LABELS[m.type] ?? '')}`;
  if (c.field === 'color' || c.field === 'fill') b = colorOf(v) ?? b;
  const is = c.field === 'type' ? a.split('\u0000').includes(b) || a.split('\u0000').includes(b.replace(/\s+/g, '')) : a === b;
  switch (c.op) {
    case 'is':
      return is;
    case 'is not':
      return !is;
    case 'contains':
      return a.includes(b);
    case 'does not contain':
      return !a.includes(b);
    case 'starts with':
      return a.startsWith(b);
    case 'ends with':
      return a.endsWith(b);
    default:
      // A text field compared as numbers (a column of quantities, say); blank or not a number never matches.
      return a !== '' && !Number.isNaN(Number(a)) && !Number.isNaN(Number(b)) && order(Number(a), Number(b));
  }
}

/** One `set` as a patch on top of what earlier sets made, or why it cannot be. */
function applySet(m: Markup, s: Rule['sets'][number], ctx: ScriptContext): { patch: Partial<Markup>; change: string } {
  const f = s.field;
  const v = s.value;
  const fail = (why: string): never => {
    throw new ParseError(`line ${s.line}: ${why}`);
  };
  if (typeof f === 'object') {
    const col = ctx.columns.find((c) => lower(c.name) === lower(f.column)) ?? fail(`no column "${f.column}" in this document`);
    return { patch: { fields: { ...m.fields, [col.id]: v } }, change: `${col.name} → ${v}` };
  }
  switch (f) {
    case 'color': {
      const c = colorOf(v) ?? fail(`"${v}" is not a colour (a name such as red, or #rrggbb)`);
      return { patch: { style: { ...m.style, stroke: c } }, change: `colour → ${c}` };
    }
    case 'fill': {
      const c = lower(v) === 'none' ? null : (colorOf(v) ?? fail(`"${v}" is not a colour (a name, #rrggbb, or none)`));
      return { patch: { style: { ...m.style, fill: c } }, change: `fill → ${c ?? 'none'}` };
    }
    case 'width': {
      const n = Number(v.replace(/pt$/i, ''));
      if (!(n >= 0 && n <= 100)) fail(`width "${v}" is not a number of points from 0 to 100`);
      return { patch: { style: { ...m.style, width: n } }, change: `width → ${n} pt` };
    }
    case 'opacity': {
      const n = Number(v.replace(/%$/, ''));
      if (!(n >= 0 && n <= 100)) fail(`opacity "${v}" is not a percentage from 0 to 100`);
      return { patch: { style: { ...m.style, opacity: n / 100 } }, change: `opacity → ${n}%` };
    }
    case 'status': {
      const st = ctx.statuses.find((x) => lower(x.name) === lower(v) || lower(x.id) === lower(v)) ?? fail(`no status "${v}" (statuses: ${ctx.statuses.map((x) => x.name).join(', ')})`);
      return { patch: { status: st.id }, change: `status → ${st.name}` };
    }
    case 'layer':
      return { patch: { layer: lower(v) === 'none' ? undefined : v }, change: `layer → ${lower(v) === 'none' ? 'none' : v}` };
    case 'subject':
      return { patch: { subject: v }, change: `subject → ${v}` };
    case 'comment':
      return { patch: { comment: v }, change: 'comment set' };
    case 'checked': {
      const on = /^(true|yes|on|checked)$/i.test(v);
      return { patch: { checked: on || undefined }, change: on ? 'checked' : 'unchecked' };
    }
  }
}

/**
 * The changes a script makes to `markups`, without making them: for the preview, then the store.
 * Rules run in order, each on the markups as earlier rules left them. Throws a ScriptError-shaped
 * Error for a value that does not fit (an unknown status, say).
 */
export function runScript(program: Program, markups: readonly Markup[], ctx: ScriptContext): ScriptRun {
  const now = new Map(markups.map((m) => [m.id, m]));
  const patches = new Map<string, { patch: Partial<Markup>; changes: string[] }>();
  const skipped = new Set<string>();
  const found: number[] = [];
  const name = (m: Markup) => `${m.subject ?? MARKUP_LABELS[m.type]}, page ${m.pageIndex + 1}`;
  for (const rule of program.rules) {
    let n = 0;
    for (const m of [...now.values()]) {
      if (!test(rule.where, m, ctx)) continue;
      n++;
      if (m.locked) {
        skipped.add(name(m));
        continue;
      }
      let cur = m;
      const entry = patches.get(m.id) ?? { patch: {}, changes: [] };
      for (const s of rule.sets) {
        const { patch, change } = applySet(cur, s, ctx);
        // Only what actually changes counts.
        const real = Object.entries(patch).some(([k, val]) => JSON.stringify(val) !== JSON.stringify((cur as unknown as Record<string, unknown>)[k]));
        if (!real) continue;
        cur = { ...cur, ...patch };
        Object.assign(entry.patch, patch);
        entry.changes.push(change);
      }
      if (entry.changes.length) patches.set(m.id, entry);
      now.set(m.id, cur);
    }
    found.push(n);
  }
  const changes = [...patches].map(([id, e]) => ({ id, what: name(markups.find((m) => m.id === id)!), patch: e.patch, changes: e.changes }));
  return { changes, skipped: [...skipped], found };
}

/** Reads and runs a script; errors (with line numbers) instead of changes when it cannot. */
export function previewScript(source: string, markups: readonly Markup[], ctx: ScriptContext): { run: ScriptRun | null; errors: ScriptError[] } {
  const { program, errors } = parseScript(source);
  if (errors.length) return { run: null, errors };
  try {
    return { run: runScript(program, markups, ctx), errors: [] };
  } catch (e) {
    if (!(e instanceof ParseError)) throw e;
    const m = /^line (\d+): (.*)$/.exec(e.message);
    return { run: null, errors: [{ line: m ? Number(m[1]) : 0, message: m ? m[2]! : e.message }] };
  }
}
