import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkSource, globToRegExp, looksLikeUiText, validateAllowlist } from './no-literals.ts';

test('flags untranslated JSX text, expressions, attributes and setters', () => {
  const src = `
export function Panel({ ok, n, err }: { ok: boolean; n: number; err: string }) {
  setNotice('Saved file.');
  setError(\`Export failed: \${err}\`);
  setStatus({ kind: 'error', message: 'Could not save.' });
  setStatus('online');
  return (
    <div title="Close panel" aria-label="Search" placeholder="Type here" alt="Preview">
      <Dialog label="Settings" hint="Optional" applyLabel="Place" />
      <button>Save all</button>
      <span>{ok ? 'Done' : \`\${n} left\`}</span>
    </div>
  );
}
`;
  const violations = checkSource('apps/web/src/Panel.tsx', src);
  assert.deepEqual(
    violations.map((v) => [v.kind, v.text]),
    [
      ['call:setNotice', 'Saved file.'],
      ['call:setError', '`Export failed: ${err}`'],
      ['call:setStatus.message', 'Could not save.'],
      ['attr:title', 'Close panel'],
      ['attr:aria-label', 'Search'],
      ['attr:placeholder', 'Type here'],
      ['attr:alt', 'Preview'],
      ['attr:label', 'Settings'],
      ['attr:hint', 'Optional'],
      ['attr:applyLabel', 'Place'],
      ['jsx-text', 'Save all'],
      ['jsx-expr', 'Done'],
      ['jsx-expr', '`${n} left`'],
    ],
  );
});

test('skips translated calls, code tags, punctuation and technical tokens', () => {
  const src = `
import { msg, msgc, msgParts } from '@nb/i18n';
export function Clean({ n }: { n: number }) {
  setNotice(msg('Saved.'));
  setError(msg('Failed: {n}', { n }));
  return (
    <div title={msg('Close')} aria-label={msgc('noun', 'Count')}>
      <code>const x = 'Hello world';</code>
      <kbd>Ctrl+Shift+S</kbd>
      <pre>Unformatted output</pre>
      <input placeholder="1-5, 8" />
      <span>×</span>
      <span>100%</span>
      <span>12px</span>
      <span>PDF</span>
      <span>{keyed(msgParts('Press {k}', { k: <kbd>Esc</kbd> }))}</span>
    </div>
  );
}
`;
  assert.deepEqual(checkSource('apps/web/src/Clean.tsx', src), []);
});

test('honors inline i18n-ignore with a reason and rejects bare ignore comments', () => {
  const src = `
export function Ignored() {
  // i18n-ignore: internal test notice
  setNotice('Allowed by comment');
  // i18n-ignore:
  setNotice('Missing reason fails');
  return (
    <div>
      {/* i18n-ignore: product name */}
      <b>red</b>column
      {/* i18n-ignore */}
      <span>Still flagged</span>
    </div>
  );
}
`;
  const violations = checkSource('apps/web/src/Ignored.tsx', src);
  assert.deepEqual(
    violations.map((v) => v.text),
    ['Missing reason fails', 'Still flagged'],
  );
});

test('checks Electron dialog options inline and via local options variable', () => {
  const src = `
async function pick(win: any, dialog: any, t: (s: string) => string) {
  await dialog.showOpenDialog(win, {
    title: 'Open PDF',
    filters: [{ name: 'Documents', extensions: ['pdf'] }],
  });
  const options = {
    title: 'Save file',
    filters: [{ name: t('All files'), extensions: ['*'] }],
  };
  return win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
}
`;
  const violations = checkSource('apps/desktop/src/paths.ts', src);
  assert.deepEqual(
    violations.map((v) => [v.kind, v.text]),
    [
      ['dialog.title', 'Open PDF'],
      ['dialog.filters.name', 'Documents'],
      ['dialog.title', 'Save file'],
    ],
  );
});

test('allowlist strings, globs and schema validation', () => {
  const src = `export const C = () => <input placeholder="#rrggbb" />;`;
  assert.deepEqual(checkSource('apps/web/src/C.tsx', src, new Set(['#rrggbb'])), []);

  const dirGlob = globToRegExp('apps/desktop/src/assistant/**');
  assert.equal(dirGlob.test('apps/desktop/src/assistant/server.ts'), true);
  assert.equal(dirGlob.test('apps/desktop/src/assistant/sub/page.ts'), true);
  assert.equal(dirGlob.test('apps/desktop/src/main.ts'), false);

  const fileGlob = globToRegExp('apps/web/src/desktop/assistant*.ts');
  assert.equal(fileGlob.test('apps/web/src/desktop/assistant.ts'), true);
  assert.equal(fileGlob.test('apps/web/src/desktop/assistantTools.ts'), true);
  assert.equal(fileGlob.test('apps/web/src/desktop/host.ts'), false);

  assert.equal(looksLikeUiText('https://example.com'), false);
  assert.equal(looksLikeUiText('.pdf,.png'), false);
  assert.equal(looksLikeUiText('Open file'), true);

  assert.equal(
    validateAllowlist({
      files: [{ glob: 'a/**', reason: '' }],
      strings: [{ text: 'foo', reason: '   ' }],
    }).length,
    2,
  );
});
