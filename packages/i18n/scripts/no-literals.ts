/**
 * Fails when untranslated English interface text appears in apps/web/src or apps/desktop/src.
 *
 * Checks:
 * - JSX text nodes (outside <code>, <kbd>, <pre>, <style>, <script>)
 * - JSX child string/template expressions (including ternaries and logical branches)
 * - Interface JSX attributes/props (title, aria-label, placeholder, alt, label, hint, etc.)
 * - Notice / error / alert / toast setter calls (setNotice, setError, onNotice, alert, confirm, etc.)
 * - Electron dialog options in apps/desktop/src (title, message, detail, buttonLabel, filter name)
 *
 * Intentional English can be exempted in two ways:
 * 1. An entry (with a reason) in packages/i18n/scripts/no-literals-allowlist.json
 * 2. An inline `// i18n-ignore: <reason>` or `{/* i18n-ignore: <reason> *\/}` comment on the
 *    line above (or same line).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

export interface AllowlistFileEntry {
  glob: string;
  reason: string;
}

export interface AllowlistStringEntry {
  text: string;
  reason: string;
}

export interface Allowlist {
  files: AllowlistFileEntry[];
  strings: AllowlistStringEntry[];
}

export interface Violation {
  ref: string;
  line: number;
  kind: string;
  text: string;
}

const SKIP_JSX_TAGS = new Set(['code', 'kbd', 'pre', 'style', 'script']);

const UI_ATTRS = new Set([
  'title',
  'aria-label',
  'aria-description',
  'aria-roledescription',
  'placeholder',
  'alt',
  'label',
  'hint',
  'tooltip',
  'heading',
  'subtitle',
  'description',
  'emptyText',
  'confirmLabel',
  'cancelLabel',
  'submitLabel',
  'applyLabel',
  'okLabel',
  'closeLabel',
  'actionLabel',
  'buttonLabel',
  'caption',
  'helperText',
  'errorText',
]);

const TRANSLATE_CALLS = new Set(['msg', 'msgc', 'msgParts', 't']);

const SETTER_EXACT = new Set([
  'setNotice',
  'setError',
  'setMessage',
  'setWarning',
  'setAlert',
  'setToast',
  'setBanner',
  'setFeedback',
  'setStatusMessage',
  'onNotice',
  'notify',
  'alert',
  'confirm',
  'prompt',
]);

const OBJECT_ONLY_SETTERS = new Set(['setStatus']);

const SETTER_PATTERN = /^(?:set|show|add|push|flash|emit|on)[A-Z][A-Za-z0-9]*(?:Notice|Error|Toast|Alert|Warning|Banner|Feedback)$/;

const ELECTRON_DIALOG_METHODS = new Set([
  'showOpenDialog',
  'showOpenDialogSync',
  'showSaveDialog',
  'showSaveDialogSync',
  'showMessageBox',
  'showMessageBoxSync',
  'showErrorBox',
]);

const ELECTRON_DIALOG_PROPS = new Set(['title', 'message', 'detail', 'buttonLabel', 'checkboxLabel']);

const IGNORE_COMMENT = /\bi18n-ignore\s*:\s*\S+/;

/** Converts a simple glob (`*`, `**`, `?`) into a RegExp over forward-slash relative paths. */
export function globToRegExp(glob: string): RegExp {
  const escaped = glob
    .replace(/\\/g, '/')
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    // Placeholders first, so the * in .* is not turned into [^/]* afterwards.
    .replace(/\*\*\//g, '\u0001')
    .replace(/\*\*/g, '\u0002')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/\u0001/g, '(?:.*/)?')
    .replace(/\u0002/g, '.*');
  return new RegExp(`^${escaped}$`);
}

export function normalizeText(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

/**
 * True when a string looks like human-readable English interface text rather than punctuation,
 * numbers, units, URLs, file extensions, or pure technical symbols.
 */
export function looksLikeUiText(raw: string): boolean {
  const s = normalizeText(raw);
  if (!s) return false;
  // Must contain at least one 2+ letter Latin word (skips single letters like X, Y, B, I, U, ×).
  if (!/[A-Za-z]{2,}/.test(s)) return false;
  // URLs, protocols, anchors, data URIs.
  if (/^(?:https?:\/\/|mailto:|tel:|data:|blob:|#[0-9a-f]{3,8}$)/i.test(s)) return false;
  // Pure file extensions or extension lists like ".pdf" or ".pdf,.png,.jpg" or "*.pdf".
  if (/^(?:\*?\.?[a-z0-9]{1,6}(?:\s*,\s*\*?\.[a-z0-9]{1,6})*)$/i.test(s) && s.includes('.')) return false;
  // Pure numeric values with technical units (e.g. "12px", "1.5em", "100vw", "300dpi", "1:100").
  if (/^[+-]?\d+(?:[.,]\d+)?\s*(?:px|pt|em|rem|vh|vw|%|mm|cm|m|ft|in|dpi|ms|s|deg|rad|x)$/i.test(s)) return false;
  // Pure dimension or paper-size tokens like "A4", "A3", "B5", "2x".
  if (/^[A-E]\d$/i.test(s)) return false;
  // Purely technical unit symbols or abbreviations without spaces.
  if (/^(?:mm|cm|km|ft|in|yd|mi|px|pt|pc|em|rem|dpi|ppi|deg|rad|sq|cu|m2|m3|ft2|ft3|mm2|cm2|in2|RGB|CMYK|HSL|HEX|SVG|PDF|PNG|JPG|JPEG|TIFF|WEBP|CSV|XLSX|DWG|DXF|XFDF|FDF|XML|JSON|UTF-8|BCP|ISO|UTC|URL|URI|API|ID|UUID|SHA-256|MD5|HMAC|PKCS#11|OCR|CAD|BIM|IFC|MCP)$/i.test(s)) {
    return false;
  }
  return true;
}

function isIgnoredAtLine(lines: readonly string[], lineIndex: number): boolean {
  const cur = lines[lineIndex] ?? '';
  if (IGNORE_COMMENT.test(cur)) return true;
  // Check immediately preceding non-blank line(s) that are pure comments.
  for (let i = lineIndex - 1; i >= Math.max(0, lineIndex - 3); i--) {
    const l = (lines[i] ?? '').trim();
    if (!l) continue;
    if (IGNORE_COMMENT.test(l)) return true;
    // Stop scanning upward once we hit a non-comment line.
    if (!l.startsWith('//') && !l.startsWith('/*') && !l.startsWith('*') && !l.startsWith('{/*')) break;
  }
  return false;
}

function jsxTagName(tag: ts.JsxTagNameExpression): string {
  if (ts.isIdentifier(tag)) return tag.text;
  if (ts.isPropertyAccessExpression(tag)) return tag.name.text;
  return tag.getText();
}

function isInsideSkippedJsx(node: ts.Node): boolean {
  let cur: ts.Node | undefined = node.parent;
  while (cur) {
    if (ts.isJsxElement(cur)) {
      const name = jsxTagName(cur.openingElement.tagName);
      if (SKIP_JSX_TAGS.has(name)) return true;
    }
    cur = cur.parent;
  }
  return false;
}

function isTranslateCall(expr: ts.Expression): boolean {
  return ts.isCallExpression(expr) && ts.isIdentifier(expr.expression) && TRANSLATE_CALLS.has(expr.expression.text);
}

function isSetterName(name: string): boolean {
  return SETTER_EXACT.has(name) || SETTER_PATTERN.test(name);
}

function callName(expr: ts.LeftHandSideExpression): string | undefined {
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr)) return expr.name.text;
  return undefined;
}

function templateHasUiText(tpl: ts.TemplateExpression): string | undefined {
  const parts = [tpl.head.text, ...tpl.templateSpans.map((s) => s.literal.text)];
  const combined = normalizeText(parts.join(' '));
  if (looksLikeUiText(combined)) return normalizeText(tpl.getText());
  return undefined;
}

function checkExpressionForLiterals(
  expr: ts.Expression,
  kind: string,
  report: (node: ts.Node, kind: string, text: string) => void,
): void {
  if (ts.isParenthesizedExpression(expr) || ts.isAsExpression(expr) || ts.isSatisfiesExpression(expr) || ts.isNonNullExpression(expr)) {
    checkExpressionForLiterals(expr.expression, kind, report);
    return;
  }
  if (isTranslateCall(expr)) return;
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) {
    if (looksLikeUiText(expr.text)) report(expr, kind, normalizeText(expr.text));
    return;
  }
  if (ts.isTemplateExpression(expr)) {
    const text = templateHasUiText(expr);
    if (text) report(expr, kind, text);
    else {
      // Even when the static parts are only punctuation (e.g. ` · ${flag ? 'A' : 'B'}`),
      // inspect each interpolated expression for untranslated string literals.
      for (const span of expr.templateSpans) {
        checkExpressionForLiterals(span.expression, kind, report);
      }
    }
    return;
  }
  if (ts.isConditionalExpression(expr)) {
    checkExpressionForLiterals(expr.whenTrue, kind, report);
    checkExpressionForLiterals(expr.whenFalse, kind, report);
    return;
  }
  if (ts.isBinaryExpression(expr)) {
    const op = expr.operatorToken.kind;
    if (op === ts.SyntaxKind.AmpersandAmpersandToken) {
      checkExpressionForLiterals(expr.right, kind, report);
    } else if (op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken) {
      checkExpressionForLiterals(expr.left, kind, report);
      checkExpressionForLiterals(expr.right, kind, report);
    } else if (op === ts.SyntaxKind.PlusToken) {
      // String concatenation of UI text, e.g. 'Error: ' + err.message
      checkExpressionForLiterals(expr.left, kind, report);
      checkExpressionForLiterals(expr.right, kind, report);
    }
  }
}

function propKeyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)) return name.text;
  return undefined;
}

/** Finds `const name = { ... }` in an enclosing block (for Electron dialog options variables). */
function resolveLocalObjectInitializer(ident: ts.Identifier): ts.ObjectLiteralExpression | undefined {
  let cur: ts.Node | undefined = ident.parent;
  while (cur) {
    if (ts.isBlock(cur) || ts.isSourceFile(cur)) {
      for (const stmt of cur.statements) {
        if (stmt.pos >= ident.pos) break;
        if (!ts.isVariableStatement(stmt)) continue;
        for (const decl of stmt.declarationList.declarations) {
          if (ts.isIdentifier(decl.name) && decl.name.text === ident.text && decl.initializer && ts.isObjectLiteralExpression(decl.initializer)) {
            return decl.initializer;
          }
        }
      }
    }
    cur = cur.parent;
  }
  return undefined;
}

export function checkSource(ref: string, text: string, allowStrings: ReadonlySet<string> = new Set()): Violation[] {
  const source = ts.createSourceFile(ref, text, ts.ScriptTarget.Latest, true, ref.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const lines = text.split(/\r?\n/);
  const violations: Violation[] = [];
  const checkedDialogOpts = new WeakSet<ts.ObjectLiteralExpression>();

  const report = (node: ts.Node, kind: string, value: string) => {
    const norm = normalizeText(value);
    if (!norm || allowStrings.has(norm)) return;
    const start = node.getStart(source);
    const lineIndex = source.getLineAndCharacterOfPosition(start).line;
    if (isIgnoredAtLine(lines, lineIndex)) return;
    violations.push({ ref, line: lineIndex + 1, kind, text: norm });
  };

  const checkElectronDialogOptions = (obj: ts.ObjectLiteralExpression) => {
    if (checkedDialogOpts.has(obj)) return;
    checkedDialogOpts.add(obj);
    for (const prop of obj.properties) {
      if (!ts.isPropertyAssignment(prop)) continue;
      const key = propKeyName(prop.name);
      if (!key) continue;
      if (ELECTRON_DIALOG_PROPS.has(key)) {
        checkExpressionForLiterals(prop.initializer, `dialog.${key}`, report);
      } else if (key === 'filters' && ts.isArrayLiteralExpression(prop.initializer)) {
        for (const el of prop.initializer.elements) {
          if (!ts.isObjectLiteralExpression(el)) continue;
          for (const fp of el.properties) {
            if (ts.isPropertyAssignment(fp) && propKeyName(fp.name) === 'name') {
              checkExpressionForLiterals(fp.initializer, 'dialog.filters.name', report);
            }
          }
        }
      }
    }
  };

  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) {
      if (!isInsideSkippedJsx(node) && looksLikeUiText(node.text)) {
        report(node, 'jsx-text', node.text);
      }
      return;
    }

    if (ts.isJsxExpression(node) && node.expression && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))) {
      if (!isInsideSkippedJsx(node)) {
        checkExpressionForLiterals(node.expression, 'jsx-expr', report);
      }
    }

    if (ts.isJsxAttribute(node) && node.initializer) {
      const attrName = ts.isIdentifier(node.name) ? node.name.text : node.name.getText(source);
      if (UI_ATTRS.has(attrName)) {
        if (ts.isStringLiteral(node.initializer)) {
          if (looksLikeUiText(node.initializer.text)) {
            report(node.initializer, `attr:${attrName}`, node.initializer.text);
          }
        } else if (ts.isJsxExpression(node.initializer) && node.initializer.expression) {
          checkExpressionForLiterals(node.initializer.expression, `attr:${attrName}`, report);
        }
      }
    }

    if (ts.isCallExpression(node)) {
      const name = callName(node.expression);
      if (name && (isSetterName(name) || OBJECT_ONLY_SETTERS.has(name)) && node.arguments.length > 0) {
        // Notice/error setters typically take the message as the first argument (or { message/text }).
        const arg = node.arguments[0]!;
        if (!OBJECT_ONLY_SETTERS.has(name)) checkExpressionForLiterals(arg, `call:${name}`, report);
        if (ts.isObjectLiteralExpression(arg)) {
          for (const prop of arg.properties) {
            if (!ts.isPropertyAssignment(prop)) continue;
            const key = propKeyName(prop.name);
            if (key === 'message' || key === 'text' || key === 'title' || key === 'label' || key === 'detail') {
              checkExpressionForLiterals(prop.initializer, `call:${name}.${key}`, report);
            }
          }
        }
      } else if (name && ELECTRON_DIALOG_METHODS.has(name)) {
        if (name === 'showErrorBox') {
          for (const arg of node.arguments) checkExpressionForLiterals(arg, `call:${name}`, report);
        } else {
          for (const arg of node.arguments) {
            if (ts.isObjectLiteralExpression(arg)) checkElectronDialogOptions(arg);
            else if (ts.isIdentifier(arg)) {
              const resolved = resolveLocalObjectInitializer(arg);
              if (resolved) checkElectronDialogOptions(resolved);
            }
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(source);
  return violations;
}

export function validateAllowlist(allowlist: Allowlist): string[] {
  const errors: string[] = [];
  for (const entry of allowlist.files) {
    if (!entry.glob?.trim()) errors.push('no-literals allowlist: file entry missing glob');
    if (!entry.reason?.trim()) errors.push(`no-literals allowlist: file entry "${entry.glob}" missing reason`);
  }
  for (const entry of allowlist.strings) {
    if (!entry.text?.trim()) errors.push('no-literals allowlist: string entry missing text');
    if (!entry.reason?.trim()) errors.push(`no-literals allowlist: string entry "${entry.text}" missing reason`);
  }
  return errors;
}

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..');
const ALLOWLIST_PATH = join(here, 'no-literals-allowlist.json');
const ROOTS = ['apps/web/src', 'apps/desktop/src'];

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name !== 'node_modules') sourceFiles(path, out);
    } else if (/\.tsx?$/.test(ent.name) && !/\.test\.tsx?$/.test(ent.name) && !ent.name.endsWith('.d.ts')) {
      out.push(path);
    }
  }
  return out;
}

function main() {
  const allowlist: Allowlist = JSON.parse(readFileSync(ALLOWLIST_PATH, 'utf8')) as Allowlist;
  const schemaErrors = validateAllowlist(allowlist);
  if (schemaErrors.length) {
    for (const e of schemaErrors) console.error(e);
    process.exitCode = 1;
    return;
  }

  const fileMatchers = allowlist.files.map((e) => globToRegExp(e.glob));
  const allowStrings = new Set(allowlist.strings.map((e) => normalizeText(e.text)));

  const violations: Violation[] = [];
  let checkedFiles = 0;

  for (const root of ROOTS) {
    const dir = join(repo, root);
    if (!existsSync(dir)) continue;
    for (const file of sourceFiles(dir)) {
      const ref = relative(repo, file).replace(/\\/g, '/');
      if (fileMatchers.some((re) => re.test(ref))) continue;
      checkedFiles++;
      violations.push(...checkSource(ref, readFileSync(file, 'utf8'), allowStrings));
    }
  }

  for (const v of violations) {
    console.error(`${v.ref}:${v.line}: untranslated literal (${v.kind}): ${JSON.stringify(v.text)}`);
  }
  console.log(
    `i18n no-literals: checked ${checkedFiles} files, ${violations.length} violation(s), ${allowlist.files.length} file / ${allowlist.strings.length} string allow-list entries`,
  );
  if (violations.length) process.exitCode = 1;
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) main();
