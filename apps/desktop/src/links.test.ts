import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkFill } from './excel.ts';
import { linkArguments, parseMarkupLink } from './links.ts';

// Links to a comment come out of a workbook someone emailed: only this app's own link, taken apart
// into three plain strings, gets through.

test('a comment link is taken apart into its document, markup and file name', () => {
  assert.deepEqual(parseMarkupLink('redcolumn://markup/?doc=doc-1&markup=m%261&name=KR-C-101+General+arrangement.pdf'), { doc: 'doc-1', markup: 'm&1', name: 'KR-C-101 General arrangement.pdf' });
  // As this app writes it, and as Excel hands it on (it adds the slash).
  assert.deepEqual(parseMarkupLink('redcolumn://markup?doc=a&markup=b'), { doc: 'a', markup: 'b', name: '' });
  assert.deepEqual(parseMarkupLink('REDCOLUMN://markup/?doc=a&markup=b'), { doc: 'a', markup: 'b', name: '' });
});

test('anything else is not a comment link', () => {
  for (const value of [
    'redcolumn://open?doc=a&markup=b',
    'redcolumn://markup/?doc=a',
    'redcolumn://markup/?markup=b',
    'redcolumn://user:pass@markup/?doc=a&markup=b',
    'redcolumn://markup:8080/?doc=a&markup=b',
    'redcolumn://markup.evil.example/?doc=a&markup=b',
    `redcolumn://markup/?doc=${'a'.repeat(301)}&markup=b`,
    'redcolumn://markup/?doc=a%00&markup=b',
    'https://example.com/?doc=a&markup=b',
    'C:\\drawings\\KR-C-101.pdf',
    '--inspect=9229',
    `redcolumn://markup/?doc=a&markup=b&x=${'y'.repeat(2000)}`,
  ])
    assert.equal(parseMarkupLink(value), null, value);
});

test('links on a command line are found among the other arguments', () => {
  const argv = ['C:\\Program Files\\redcolumn\\redcolumn.exe', '--allow-file-access', 'C:\\drawings\\KR-C-101.pdf', 'redcolumn://markup/?doc=a&markup=b', 'redcolumn://markup/?doc=a'];
  assert.deepEqual(linkArguments(argv), [{ doc: 'a', markup: 'b', name: '' }]);
});

test('a fill request links cells only to web addresses and comment links', () => {
  const request = (urls: unknown[]) => ({
    sheet: 'Review Comments',
    headerRow: 7,
    firstRow: 8,
    count: 2,
    columns: [{ col: 2, cells: [1, 2] }],
    key: { col: 11, label: 'redcolumn key', cells: ['m1', 'm2'] },
    firstCol: 2,
    below: 0,
    cells: [],
    hidden: { name: '_redcolumn', table: [] },
    validations: [],
    dates: [],
    links: { col: 2, urls },
  });
  assert.deepEqual(checkFill(request(['redcolumn://markup/?doc=a&markup=m1', ''])).links, { col: 2, urls: ['redcolumn://markup/?doc=a&markup=m1', ''] });
  assert.deepEqual(checkFill(request(['https://app.example/?doc=a&markup=m1', ''])).links?.urls[0], 'https://app.example/?doc=a&markup=m1');
  for (const url of ['file:///C:/Windows/system32/calc.exe', '\\\\server\\share\\run.bat', 'javascript:alert(1)', 'C:\\Windows\\notepad.exe', 7]) assert.throws(() => checkFill(request([url, ''])), /cannot be written/, String(url));
  assert.throws(() => checkFill(request(['redcolumn://markup/?doc=a&markup=m1'])), /cannot be written/, 'one address per row');
});
