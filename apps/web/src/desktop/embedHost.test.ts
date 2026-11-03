import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settings } from '../settings/settings.ts';
import { hostDocumentId, hostRefusal } from './embedHost.ts';

/** Installs the window an embedding host would add itself to. */
function host(redcolumn: unknown) {
  (globalThis as { window?: unknown }).window = { redcolumn };
}

const asked: string[] = [];
const embedding = {
  documentIdFor: (token: string) => (asked.push(token), ({ t1: 'host-record-7', hash: 'a'.repeat(64), studio: 'studio:s1:d1', empty: '' } as Record<string, string>)[token] ?? null),
  commandPolicy: (id: string) => (id === 'document.flatten' ? { disabledReason: 'Linked to estimate lines.' } : null),
};

test('with the experimental setting off the host hooks are not asked', () => {
  settings.set({ embedHostHooks: false });
  host(embedding);
  asked.length = 0;
  assert.equal(hostDocumentId('t1'), null);
  assert.equal(hostRefusal('document.flatten'), null);
  assert.deepEqual(asked, []);
});

test('with it on the host assigns document ids', () => {
  settings.set({ embedHostHooks: true });
  host(embedding);
  assert.equal(hostDocumentId('t1'), 'host-record-7');
  assert.equal(hostDocumentId('unknown'), null);
});

test('a file with no launch token does not ask the host', () => {
  settings.set({ embedHostHooks: true });
  host(embedding);
  asked.length = 0;
  assert.equal(hostDocumentId(null), null);
  assert.equal(hostDocumentId(''), null);
  assert.deepEqual(asked, []);
});

test('ids the library uses for its own files are refused', () => {
  settings.set({ embedHostHooks: true });
  host(embedding);
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(hostDocumentId('hash'), null, 'a content hash would take over another file');
    assert.equal(hostDocumentId('studio'), null, 'a studio: id would open as a Live Session document');
    assert.equal(hostDocumentId('empty'), null);
  } finally {
    console.warn = warn;
  }
});

test('with it on the host refuses commands, and only those it names', () => {
  settings.set({ embedHostHooks: true });
  host(embedding);
  assert.equal(hostRefusal('document.flatten'), 'Linked to estimate lines.');
  assert.equal(hostRefusal('document.ocr'), null);
});

test('a host without the hooks changes nothing', () => {
  settings.set({ embedHostHooks: true });
  host({ isDesktop: true });
  assert.equal(hostDocumentId('t1'), null);
  assert.equal(hostRefusal('document.flatten'), null);
});
