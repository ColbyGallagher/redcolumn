import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkCssSource, evaluateBaseline } from './logical-css.ts';

test('flags physical left/right CSS properties and values with logical suggestions', () => {
  const css = `
.panel {
  margin-left: 8px;
  padding-right: 12px;
  border-left: 1px solid var(--border);
  border-top-right-radius: 4px;
  left: 0;
  right: 8px !important;
  text-align: left;
  float: right;
  clear: left;
}
`;
  const violations = checkCssSource('apps/web/src/example.css', css);
  assert.deepEqual(
    violations.map((v) => [v.line, v.property, v.suggestion]),
    [
      [3, 'margin-left', 'margin-inline-start'],
      [4, 'padding-right', 'padding-inline-end'],
      [5, 'border-left', 'border-inline-start'],
      [6, 'border-top-right-radius', 'border-start-end-radius'],
      [7, 'left', 'inset-inline-start'],
      [8, 'right', 'inset-inline-end'],
      [9, 'text-align', 'text-align: start'],
      [10, 'float', 'float: inline-end'],
      [11, 'clear', 'clear: inline-start'],
    ],
  );
});

test('allows logical properties, custom properties, comments, strings and selectors', () => {
  const css = `
/* left: 0; margin-left: 8px; */
.align-left:hover {
  --offset-left: 10px;
  margin-inline-start: 8px;
  padding-inline-end: 4px;
  border-inline-start: 1px solid var(--border);
  inset-inline-start: 0;
  text-align: start;
  text-align: center;
  background-position: right 8px center;
  background-image: url("data:image/svg+xml,left:0;right:0");
}
@media (max-width: 720px) {
  .drawer {
    inset-inline-end: 0;
  }
}
`;
  assert.deepEqual(checkCssSource('apps/web/src/clean.css', css), []);
});

test('honors logical-css-ignore with a reason and rejects bare comments', () => {
  const css = `
.canvas-overlay {
  /* logical-css-ignore: PDF page coordinate space is always physical */
  left: 0;
  /* logical-css-ignore: */
  right: 0;
}
`;
  const violations = checkCssSource('apps/web/src/canvas.css', css);
  assert.equal(violations.length, 1);
  assert.equal(violations[0]!.property, 'right');
  assert.equal(violations[0]!.line, 6);
});

test('evaluates grandfather baseline per file', () => {
  const one = checkCssSource('apps/web/src/a.css', '.a { left: 0; }');
  const two = checkCssSource('apps/web/src/a.css', '.a { left: 0; right: 0; }');
  const zero = checkCssSource('apps/web/src/new.css', '.b { inset-inline-start: 0; }');

  assert.equal(evaluateBaseline([{ ref: 'apps/web/src/a.css', violations: one }], { 'apps/web/src/a.css': 1 }).errors.length, 0);
  assert.equal(evaluateBaseline([{ ref: 'apps/web/src/a.css', violations: one }], { 'apps/web/src/a.css': 2 }).errors.length, 0);
  assert.ok(evaluateBaseline([{ ref: 'apps/web/src/a.css', violations: two }], { 'apps/web/src/a.css': 1 }).errors.length > 0);
  assert.ok(evaluateBaseline([{ ref: 'apps/web/src/new.css', violations: one }], {}).errors.length > 0);
  assert.equal(evaluateBaseline([{ ref: 'apps/web/src/new.css', violations: zero }], {}).errors.length, 0);
});
