/**
 * Calculation columns: small spreadsheet-style expressions over a markup's other columns.
 *
 *   [Quantity] * [Unit Cost]
 *   ROUND([Area] * 1.1, 2)
 *   IF([Status] = "Accepted", [Cost], 0)
 *   CONCAT([Page], " / ", [Author])
 *
 * Function names are not case-sensitive (if, If, IF). Yes/No values (checkmark columns, switches)
 * count as 1 and 0.
 *
 * Columns are referenced by name in square brackets. Numbers, "strings", + - * / ^ and & (join
 * text), comparisons (= <> < > <= >=), and the functions in FUNCTIONS are supported. Evaluation
 * never runs code: expressions are parsed into a tree and interpreted.
 */

import { AREA_LABELS, METERS_PER_UNIT, VOLUME_LABELS, type LengthUnit } from '@nb/measure';

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

/** Unit names CONVERT knows, to their size in metres (or m², m³) and dimension (1 length, 2 area, 3 volume). */
const UNIT_SIZES: Map<string, { size: number; dim: 1 | 2 | 3 }> = (() => {
  const out = new Map<string, { size: number; dim: 1 | 2 | 3 }>();
  for (const [u, m] of Object.entries(METERS_PER_UNIT)) {
    out.set(u, { size: m, dim: 1 });
    out.set(AREA_LABELS[u as LengthUnit].toLowerCase(), { size: m * m, dim: 2 });
    out.set(VOLUME_LABELS[u as LengthUnit].toLowerCase(), { size: m * m * m, dim: 3 });
    for (const [suffix, dim] of [['2', 2], ['²', 2], ['^2', 2], ['3', 3], ['³', 3], ['^3', 3]] as const) out.set(u + suffix, { size: m ** dim, dim });
    out.set(`sq ${u}`, { size: m * m, dim: 2 });
    out.set(`cu ${u}`, { size: m * m * m, dim: 3 });
  }
  for (const [names, size, dim] of [
    [['lf', 'feet', 'foot'], 0.3048, 1],
    [['inch', 'inches'], 0.0254, 1],
    [['metre', 'metres', 'meter', 'meters'], 1, 1],
    [['sq', 'square'], 0.3048 ** 2 * 100, 2],
    [['ac', 'acre', 'acres'], 4046.8564224, 2],
    [['ha', 'hectare', 'hectares'], 10000, 2],
    [['l', 'litre', 'litres', 'liter', 'liters'], 0.001, 3],
  ] as const)
    for (const n of names) out.set(n, { size, dim });
  return out;
})();

const DIMENSIONS = ['', 'length', 'area', 'volume'];

/** CONVERT(value, "from", "to"): a length, area or volume in another unit of the same kind. */
function convert(value: number, from: string, to: string): number {
  const a = UNIT_SIZES.get(from.trim().toLowerCase());
  const b = UNIT_SIZES.get(to.trim().toLowerCase());
  if (!a) throw new FormulaError(`CONVERT does not know the unit "${from}"`);
  if (!b) throw new FormulaError(`CONVERT does not know the unit "${to}"`);
  if (a.dim !== b.dim) throw new FormulaError(`CONVERT cannot turn ${DIMENSIONS[a.dim]} ("${from}") into ${DIMENSIONS[b.dim]} ("${to}")`);
  return Number(((value * a.size) / b.size).toPrecision(15));
}

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
  CONVERT: (a) => {
    if (a.length !== 3) throw new FormulaError('CONVERT takes a value, the unit it is in and the unit to give, e.g. CONVERT([Length], "ft", "m")');
    return convert(num(a[0]!), str(a[1]!), str(a[2]!));
  },
};

/** The functions as the Formula Builder lists them: how to call each and what it gives. */
export const FUNCTION_DOCS: { name: string; signature: string; hint: string }[] = [
  { name: 'IF', signature: 'IF(test, then, else)', hint: 'One value or another: IF([Area] > 100, 2, 1)' },
  { name: 'CONVERT', signature: 'CONVERT(value, "from", "to")', hint: 'A length, area or volume in another unit: CONVERT([Area], "sf", "m2")' },
  { name: 'ROUND', signature: 'ROUND(x, places)', hint: 'Rounded to a number of decimal places' },
  { name: 'CEILING', signature: 'CEILING(x)', hint: 'Rounded up to a whole number' },
  { name: 'FLOOR', signature: 'FLOOR(x)', hint: 'Rounded down to a whole number' },
  { name: 'MIN', signature: 'MIN(a, b, ...)', hint: 'The smallest' },
  { name: 'MAX', signature: 'MAX(a, b, ...)', hint: 'The largest' },
  { name: 'SUM', signature: 'SUM(a, b, ...)', hint: 'The total' },
  { name: 'AVG', signature: 'AVG(a, b, ...)', hint: 'The average' },
  { name: 'ABS', signature: 'ABS(x)', hint: 'Without its sign' },
  { name: 'SQRT', signature: 'SQRT(x)', hint: 'The square root' },
  { name: 'AND', signature: 'AND(a, b, ...)', hint: '1 when every test is true' },
  { name: 'OR', signature: 'OR(a, b, ...)', hint: '1 when any test is true' },
  { name: 'NOT', signature: 'NOT(test)', hint: '1 when the test is false' },
];

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
