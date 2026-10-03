/**
 * Calculation columns: small spreadsheet-style expressions over a markup's other columns.
 *
 *   [Quantity] * [Unit Cost]
 *   ROUND([Area] * 1.1, 2)
 *   IF([Status] = "Accepted", [Cost], 0)
 *   CONCAT([Page], " / ", [Author])
 *
 * Columns are referenced by name in square brackets. Numbers, "strings", + - * / ^ and & (join
 * text), comparisons (= <> < > <= >=), and the functions in FUNCTIONS are supported. Evaluation
 * never runs code: expressions are parsed into a tree and interpreted.
 */

export type Value = number | string | boolean;

type Node =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'ref'; name: string }
  | { k: 'neg'; e: Node }
  | { k: 'bin'; op: string; a: Node; b: Node }
  | { k: 'call'; fn: string; args: Node[] };

type Token = { t: 'num'; v: number } | { t: 'str'; v: string } | { t: 'ref'; v: string } | { t: 'id'; v: string } | { t: 'op'; v: string };

export class FormulaError extends Error {}

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) {
      i++;
    } else if (/[0-9.]/.test(c)) {
      const m = /^\d*\.?\d+(?:[eE][+-]?\d+)?|^\d+\./.exec(src.slice(i));
      if (!m) throw new FormulaError(`Unexpected "${c}"`);
      out.push({ t: 'num', v: Number(m[0]) });
      i += m[0].length;
    } else if (c === '"') {
      const end = src.indexOf('"', i + 1);
      if (end < 0) throw new FormulaError('Text is missing its closing "');
      out.push({ t: 'str', v: src.slice(i + 1, end) });
      i = end + 1;
    } else if (c === '[') {
      const end = src.indexOf(']', i + 1);
      if (end < 0) throw new FormulaError('A column name is missing its closing ]');
      out.push({ t: 'ref', v: src.slice(i + 1, end).trim() });
      i = end + 1;
    } else if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))!;
      out.push({ t: 'id', v: m[0].toUpperCase() });
      i += m[0].length;
    } else {
      const two = src.slice(i, i + 2);
      if (two === '<=' || two === '>=' || two === '<>' || two === '!=') {
        out.push({ t: 'op', v: two === '!=' ? '<>' : two });
        i += 2;
      } else if ('+-*/^&=<>(),'.includes(c)) {
        out.push({ t: 'op', v: c });
        i++;
      } else {
        throw new FormulaError(`Unexpected "${c}"`);
      }
    }
  }
  return out;
}

const PRECEDENCE: Record<string, number> = { '=': 1, '<>': 1, '<': 1, '>': 1, '<=': 1, '>=': 1, '&': 2, '+': 3, '-': 3, '*': 4, '/': 4, '^': 5 };

export function parseFormula(src: string): Node {
  const tokens = tokenize(src);
  let pos = 0;
  const peek = () => tokens[pos];
  const isOp = (v: string) => {
    const t = peek();
    return t?.t === 'op' && t.v === v;
  };
  const expect = (v: string) => {
    if (!isOp(v)) throw new FormulaError(`Expected "${v}"`);
    pos++;
  };

  const primary = (): Node => {
    const t = tokens[pos++];
    if (!t) throw new FormulaError('The formula ends too soon');
    if (t.t === 'num') return { k: 'num', v: t.v };
    if (t.t === 'str') return { k: 'str', v: t.v };
    if (t.t === 'ref') return { k: 'ref', name: t.v };
    if (t.t === 'id') {
      if (t.v === 'TRUE' || t.v === 'FALSE') return { k: 'num', v: t.v === 'TRUE' ? 1 : 0 };
      if (!FUNCTIONS[t.v]) throw new FormulaError(`Unknown function ${t.v}. Column names go in [square brackets].`);
      expect('(');
      const args: Node[] = [];
      if (!isOp(')')) {
        args.push(expr(0));
        while (isOp(',')) {
          pos++;
          args.push(expr(0));
        }
      }
      expect(')');
      return { k: 'call', fn: t.v, args };
    }
    if (t.v === '(') {
      const e = expr(0);
      expect(')');
      return e;
    }
    if (t.v === '-') return { k: 'neg', e: unary() };
    if (t.v === '+') return unary();
    throw new FormulaError(`Unexpected "${t.v}"`);
  };
  const unary = (): Node => primary();

  const expr = (minPrec: number): Node => {
    let left = unary();
    for (;;) {
      const t = peek();
      if (t?.t !== 'op' || PRECEDENCE[t.v] === undefined || PRECEDENCE[t.v]! < minPrec) return left;
      pos++;
      const prec = PRECEDENCE[t.v]!;
      // ^ is right-associative; everything else left-associative.
      const right = expr(t.v === '^' ? prec : prec + 1);
      left = { k: 'bin', op: t.v, a: left, b: right };
    }
  };

  if (!tokens.length) throw new FormulaError('Enter a formula');
  const tree = expr(0);
  if (pos < tokens.length) throw new FormulaError(`Unexpected "${(tokens[pos] as { v: unknown }).v}"`);
  return tree;
}

/** Column names a formula refers to. */
export function formulaRefs(src: string): string[] {
  const refs = new Set<string>();
  const walk = (n: Node) => {
    if (n.k === 'ref') refs.add(n.name);
    else if (n.k === 'neg') walk(n.e);
    else if (n.k === 'bin') {
      walk(n.a);
      walk(n.b);
    } else if (n.k === 'call') n.args.forEach(walk);
  };
  walk(parseFormula(src));
  return [...refs];
}

const num = (v: Value): number => {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  const s = v.replace(/[,$\s]/g, '');
  if (s === '') return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : Number.NaN;
};
const str = (v: Value): string => (typeof v === 'number' ? String(Math.round(v * 1e9) / 1e9) : String(v));
const truthy = (v: Value) => (typeof v === 'string' ? v !== '' && v !== '0' : !!v);

const FUNCTIONS: Record<string, (args: Value[]) => Value> = {
  SUM: (a) => a.reduce<number>((s, v) => s + num(v), 0),
  AVG: (a) => (a.length ? a.reduce<number>((s, v) => s + num(v), 0) / a.length : 0),
  MIN: (a) => Math.min(...a.map(num)),
  MAX: (a) => Math.max(...a.map(num)),
  ABS: (a) => Math.abs(num(a[0] ?? 0)),
  ROUND: (a) => {
    const f = 10 ** num(a[1] ?? 0);
    return Math.round(num(a[0] ?? 0) * f) / f;
  },
  CEILING: (a) => Math.ceil(num(a[0] ?? 0)),
  FLOOR: (a) => Math.floor(num(a[0] ?? 0)),
  SQRT: (a) => Math.sqrt(num(a[0] ?? 0)),
  IF: (a) => (truthy(a[0] ?? 0) ? (a[1] ?? '') : (a[2] ?? '')),
  AND: (a) => (a.every(truthy) ? 1 : 0),
  OR: (a) => (a.some(truthy) ? 1 : 0),
  NOT: (a) => (truthy(a[0] ?? 0) ? 0 : 1),
  CONCAT: (a) => a.map(str).join(''),
  UPPER: (a) => str(a[0] ?? '').toUpperCase(),
  LOWER: (a) => str(a[0] ?? '').toLowerCase(),
  LEN: (a) => str(a[0] ?? '').length,
  ISBLANK: (a) => (str(a[0] ?? '') === '' ? 1 : 0),
};

export const FUNCTION_NAMES = Object.keys(FUNCTIONS);

function evaluate(n: Node, lookup: (name: string) => Value | undefined): Value {
  switch (n.k) {
    case 'num':
    case 'str':
      return n.v;
    case 'ref': {
      const v = lookup(n.name);
      if (v === undefined) throw new FormulaError(`No column named [${n.name}]`);
      return v;
    }
    case 'neg':
      return -num(evaluate(n.e, lookup));
    case 'call':
      return FUNCTIONS[n.fn]!(n.args.map((a) => evaluate(a, lookup)));
    case 'bin': {
      const a = evaluate(n.a, lookup);
      const b = evaluate(n.b, lookup);
      switch (n.op) {
        case '+':
          return num(a) + num(b);
        case '-':
          return num(a) - num(b);
        case '*':
          return num(a) * num(b);
        case '/':
          return num(b) === 0 ? Number.NaN : num(a) / num(b);
        case '^':
          return num(a) ** num(b);
        case '&':
          return str(a) + str(b);
        default: {
          // Compare as numbers when both sides are numeric, else as text (case-insensitive).
          const an = num(a);
          const bn = num(b);
          const numeric = !Number.isNaN(an) && !Number.isNaN(bn) && str(a) !== '' && str(b) !== '';
          const cmp = numeric ? an - bn : str(a).toLowerCase().localeCompare(str(b).toLowerCase());
          const r = n.op === '=' ? cmp === 0 : n.op === '<>' ? cmp !== 0 : n.op === '<' ? cmp < 0 : n.op === '>' ? cmp > 0 : n.op === '<=' ? cmp <= 0 : cmp >= 0;
          return r ? 1 : 0;
        }
      }
    }
  }
}

/**
 * Evaluates `src` with column values from `lookup` (by name, case-insensitive is up to the
 * caller). Returns the value, or an error message.
 */
export function evalFormula(src: string, lookup: (name: string) => Value | undefined): { value: Value } | { error: string } {
  try {
    const v = evaluate(parseFormula(src), lookup);
    if (typeof v === 'number' && !Number.isFinite(v)) return { error: '#DIV/0' };
    return { value: v };
  } catch (err) {
    if (err instanceof FormulaError) return { error: err.message };
    if (err instanceof RangeError) return { error: 'Formula refers to itself' };
    throw err;
  }
}
