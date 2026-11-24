/**
 * Enforces logical CSS properties (margin-inline-start, padding-inline-end, inset-inline-start,
 * border-inline-*, text-align: start/end, float/clear: inline-start/inline-end) in
 * apps/web/src/**\/*.css so right-to-left languages work cleanly.
 *
 * Existing physical left/right declarations are grandfathered per file in
 * packages/i18n/scripts/logical-css-baseline.json so only new ones fail.
 * Individual intentional physical declarations (e.g. a PDF canvas or directional graphic) can be
 * exempted with a `/* logical-css-ignore: <reason> *\/` comment on the preceding or same line.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface CssViolation {
  ref: string;
  line: number;
  property: string;
  value: string;
  suggestion: string;
}

const PHYSICAL_PROPERTIES: Record<string, string> = {
  'margin-left': 'margin-inline-start',
  'margin-right': 'margin-inline-end',
  'padding-left': 'padding-inline-start',
  'padding-right': 'padding-inline-end',
  'border-left': 'border-inline-start',
  'border-left-width': 'border-inline-start-width',
  'border-left-style': 'border-inline-start-style',
  'border-left-color': 'border-inline-start-color',
  'border-right': 'border-inline-end',
  'border-right-width': 'border-inline-end-width',
  'border-right-style': 'border-inline-end-style',
  'border-right-color': 'border-inline-end-color',
  'border-top-left-radius': 'border-start-start-radius',
  'border-top-right-radius': 'border-start-end-radius',
  'border-bottom-left-radius': 'border-end-start-radius',
  'border-bottom-right-radius': 'border-end-end-radius',
  'left': 'inset-inline-start',
  'right': 'inset-inline-end',
  'scroll-margin-left': 'scroll-margin-inline-start',
  'scroll-margin-right': 'scroll-margin-inline-end',
  'scroll-padding-left': 'scroll-padding-inline-start',
  'scroll-padding-right': 'scroll-padding-inline-end',
};

const PHYSICAL_VALUE_PROPERTIES: Record<string, Record<string, string>> = {
  'text-align': { left: 'text-align: start', right: 'text-align: end' },
  'float': { left: 'float: inline-start', right: 'float: inline-end' },
  'clear': { left: 'clear: inline-start', right: 'clear: inline-end' },
};

// A reason is required: the comment's closing */ does not count as one.
const IGNORE_COMMENT = /\blogical-css-ignore\s*:\s*(?!\*\/)\S/;

function isIgnored(lines: readonly string[], lineIndex: number): boolean {
  const cur = lines[lineIndex] ?? '';
  if (IGNORE_COMMENT.test(cur)) return true;
  for (let i = lineIndex - 1; i >= Math.max(0, lineIndex - 2); i--) {
    const l = (lines[i] ?? '').trim();
    if (!l) continue;
    if (IGNORE_COMMENT.test(l)) return true;
    if (!l.startsWith('/*') && !l.startsWith('*')) break;
  }
  return false;
}

/**
 * Finds physical left/right CSS declarations in one CSS file.
 * Strips comments (preserving newlines so line numbers remain exact) and tracks brace depth so
 * selectors and at-rule preambles are never mistaken for declarations.
 */
export function checkCssSource(ref: string, text: string): CssViolation[] {
  const lines = text.split(/\r?\n/);
  const violations: CssViolation[] = [];

  // Scan character-by-character so strings and comments are respected.
  let line = 1;
  let depth = 0;
  let inString: '"' | "'" | null = null;
  let inComment = false;
  let parenDepth = 0;
  let stmt = '';
  let stmtLine = 1;

  const flushDeclaration = () => {
    const raw = stmt.trim();
    const declLine = stmtLine;
    stmt = '';
    if (!raw || raw.startsWith('@')) return;
    const colon = raw.indexOf(':');
    if (colon <= 0) return;
    const prop = raw.slice(0, colon).trim().toLowerCase();
    // Skip CSS custom properties (--foo-left).
    if (prop.startsWith('--')) return;
    const val = raw.slice(colon + 1).trim();
    const firstToken = val.split(/[\s!]/)[0]?.toLowerCase() ?? '';

    let suggestion: string | undefined;
    if (Object.hasOwn(PHYSICAL_PROPERTIES, prop)) {
      suggestion = PHYSICAL_PROPERTIES[prop];
    } else if (Object.hasOwn(PHYSICAL_VALUE_PROPERTIES, prop)) {
      suggestion = PHYSICAL_VALUE_PROPERTIES[prop]![firstToken];
    }

    if (suggestion && !isIgnored(lines, declLine - 1)) {
      violations.push({ ref, line: declLine, property: prop, value: val, suggestion });
    }
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    const next = text[i + 1];

    if (inComment) {
      if (ch === '\n') line++;
      if (ch === '*' && next === '/') {
        inComment = false;
        i++;
      }
      continue;
    }

    if (inString) {
      if (ch === '\\' && next !== undefined) {
        if (depth > 0) stmt += ch + next;
        if (next === '\n') line++;
        i++;
        continue;
      }
      if (ch === inString) inString = null;
      if (ch === '\n') line++;
      if (depth > 0) stmt += ch;
      continue;
    }

    if (ch === '/' && next === '*') {
      inComment = true;
      i++;
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = ch;
      if (depth > 0) {
        if (!stmt.trim()) stmtLine = line;
        stmt += ch;
      }
      continue;
    }

    if (ch === '\n') {
      line++;
      if (depth > 0 && stmt) stmt += ' ';
      continue;
    }

    if (ch === '(') {
      parenDepth++;
      if (depth > 0) stmt += ch;
      continue;
    }

    if (ch === ')') {
      if (parenDepth > 0) parenDepth--;
      if (depth > 0) stmt += ch;
      continue;
    }

    if (parenDepth === 0 && ch === '{') {
      // Anything accumulated before '{' is a selector or at-rule header, not a declaration.
      stmt = '';
      depth++;
      continue;
    }

    if (parenDepth === 0 && ch === '}') {
      if (depth > 0) {
        flushDeclaration();
        depth--;
      }
      continue;
    }

    if (parenDepth === 0 && ch === ';') {
      if (depth > 0) flushDeclaration();
      else stmt = '';
      continue;
    }

    if (depth > 0) {
      if (!stmt.trim() && ch.trim()) stmtLine = line;
      stmt += ch;
    }
  }

  return violations;
}

export interface BaselineCheckResult {
  errors: string[];
  totalPhysical: number;
  counts: Record<string, number>;
}

export function evaluateBaseline(
  files: readonly { ref: string; violations: CssViolation[] }[],
  baseline: Readonly<Record<string, number>>,
): BaselineCheckResult {
  const errors: string[] = [];
  const counts: Record<string, number> = {};
  let totalPhysical = 0;

  for (const { ref, violations } of files) {
    const count = violations.length;
    counts[ref] = count;
    totalPhysical += count;
    const allowed = baseline[ref] ?? 0;
    if (count > allowed) {
      errors.push(
        `${ref}: ${count} physical left/right CSS declaration(s) exceeds baseline (${allowed}). Use logical properties for new CSS:`,
      );
      for (const v of violations) {
        errors.push(`  ${v.ref}:${v.line}: ${v.property}: ${v.value}  -> use ${v.suggestion}`);
      }
    }
  }

  return { errors, totalPhysical, counts };
}

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..');
const BASELINE_PATH = join(here, 'logical-css-baseline.json');
const CSS_ROOT = 'apps/web/src';

function cssFiles(dir: string, out: string[] = []): string[] {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name !== 'node_modules') cssFiles(path, out);
    } else if (ent.name.endsWith('.css')) {
      out.push(path);
    }
  }
  return out;
}

function main(writeBaseline: boolean) {
  const rootDir = join(repo, CSS_ROOT);
  const paths = existsSync(rootDir) ? cssFiles(rootDir).sort() : [];
  const scanned = paths.map((file) => {
    const ref = relative(repo, file).replace(/\\/g, '/');
    return { ref, violations: checkCssSource(ref, readFileSync(file, 'utf8')) };
  });

  if (writeBaseline) {
    const next: Record<string, number> = {};
    for (const s of scanned) {
      if (s.violations.length > 0) next[s.ref] = s.violations.length;
    }
    writeFileSync(BASELINE_PATH, JSON.stringify(next, null, 2) + '\n');
    console.log(`logical-css: wrote baseline for ${Object.keys(next).length} file(s)`);
    return;
  }

  const baseline: Record<string, number> = existsSync(BASELINE_PATH)
    ? (JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as Record<string, number>)
    : {};
  const result = evaluateBaseline(scanned, baseline);
  for (const e of result.errors) console.error(e);
  console.log(
    `i18n logical-css: checked ${scanned.length} files, ${result.totalPhysical} grandfathered physical declaration(s)${result.errors.length ? '; FAILED' : ''}`,
  );
  if (result.errors.length) process.exitCode = 1;
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  main(process.argv.includes('--update-baseline'));
}
