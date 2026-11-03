import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settings } from '../settings/settings.ts';
import { applyCommandPolicy, commandPolicy } from './commandPolicy.ts';
import type { Command } from './appCommands.ts';

/** Installs the window an embedding host would add itself to (or none at all, with `redcolumn` null). */
function host(redcolumn: unknown) {
  settings.set({ embedHostHooks: true });
  const scope = globalThis as { window?: unknown };
  delete scope.window;
  if (redcolumn !== null) scope.window = { redcolumn };
}

const command = (id: string): Command => ({ id, label: id, category: 'Document', run: () => void (ran = true), enabled: true });
let ran = false;

test('with no host every command is the very object it was given', () => {
  host(null);
  const c = command('document.flatten');
  assert.equal(applyCommandPolicy(c), c);
  assert.equal(commandPolicy('document.flatten').run(c.run), c.run);
  ran = false;
  c.run();
  assert.equal(ran, true);
});

test('a host without the commandPolicy hook leaves commands untouched', () => {
  host({ isDesktop: true });
  const c = command('document.flatten');
  assert.equal(applyCommandPolicy(c), c);
  assert.equal(commandPolicy('document.flatten').disabledReason, null);
});

test('a refused command comes back disabled, with a run that refuses', () => {
  const reason = 'Not available here: it would rewrite the document.';
  host({ commandPolicy: (id: string) => (id === 'document.flatten' || id === 'batch.flatten' ? { disabledReason: reason } : null) });
  const refused = applyCommandPolicy(command('document.flatten'));
  assert.equal(refused.enabled, false);
  assert.equal(commandPolicy('batch.flatten').disabledReason, reason);
  ran = false;
  refused.run();
  assert.equal(ran, false);
  // A command the host allows is untouched, down to its run.
  const allowed = command('document.ocr');
  assert.equal(applyCommandPolicy(allowed), allowed);
});

test('the original run is handed back when the host does not refuse', () => {
  host({ commandPolicy: () => null });
  const c = command('document.slipSheet');
  assert.equal(commandPolicy('document.slipSheet').run(c.run), c.run);
  assert.equal(applyCommandPolicy(c), c);
});

test('with the experimental setting off a refusing host changes nothing', () => {
  host({ commandPolicy: () => ({ disabledReason: 'No.' }) });
  settings.set({ embedHostHooks: false });
  const c = command('document.flatten');
  assert.equal(applyCommandPolicy(c), c);
  assert.equal(commandPolicy('batch.flatten').disabledReason, null);
});
