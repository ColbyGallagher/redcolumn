import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pdfOf, pdfTabs, type OpenFile, type OpenModel, type OpenTab } from './openTabs.ts';

const file = (id: string) => ({ id, name: `${id}.pdf`, hash: id }) as unknown as OpenFile['file'];
const pdf = (id: string): OpenFile => ({ file: file(id), doc: {} as OpenFile['doc'], store: {} as OpenFile['store'] });
const model = (id: string): OpenModel => ({ kind: 'model', file: file(id), view: { element: {} as HTMLElement, setVisible: () => {}, dispose: () => {}, controls: () => null, subscribe: () => () => {} } });

test('pdfOf keeps PDF tabs and drops model tabs', () => {
  const a = pdf('a');
  assert.equal(pdfOf(a), a);
  assert.equal(pdfOf({ ...a, kind: 'pdf' })?.file.id, 'a');
  assert.equal(pdfOf(model('m')), null);
  assert.equal(pdfOf(null), null);
  assert.equal(pdfOf(undefined), null);
});

test('pdfTabs keeps only the PDFs, in tab order', () => {
  const tabs: OpenTab[] = [pdf('a'), model('m'), pdf('b')];
  assert.deepEqual(pdfTabs(tabs).map((t) => t.file.id), ['a', 'b']);
  assert.deepEqual(pdfTabs([model('m')]), []);
});
