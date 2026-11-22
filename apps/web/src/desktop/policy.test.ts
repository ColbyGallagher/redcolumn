import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settings } from '../settings/settings.ts';
import { applyCommandPolicy, commandPolicy } from '../commands/commandPolicy.ts';
import type { Command } from '../commands/appCommands.ts';
import { MANAGED_HINT, managedPolicy, managedRefusal, managedSummary } from './policy.ts';

/** The desktop preload's bridge, with the policy the main process read (or none: the web app). */
function desktopWith(policy: unknown) {
  const scope = globalThis as { window?: unknown };
  delete scope.window;
  if (policy !== null) scope.window = { redcolumn: { isDesktop: true, policy } };
}

const POLICY = {
  managed: true,
  disableAutoUpdate: true,
  disableAssistant: false,
  disableCommunityLibrary: true,
  disableMicrosoftSignIn: false,
  disableExcelSync: false,
  disabledFeatures: ['help.sponsor', 'takeoff.*'],
  problems: [],
};

const command = (id: string): Command => ({ id, label: id, category: 'Tools', run: () => void (ran = true), enabled: true });
let ran = false;

test('the web app, and a desktop app with no policy, are not managed', () => {
  desktopWith(null);
  assert.equal(managedPolicy().managed, false);
  assert.equal(managedRefusal('help.updates'), null);
  desktopWith(undefined);
  assert.equal(managedPolicy().managed, false);
});

test('switches remove their commands; listed ids and groups are removed', () => {
  desktopWith(POLICY);
  assert.equal(managedRefusal('help.updates'), MANAGED_HINT);
  assert.equal(managedRefusal('tools.library'), MANAGED_HINT);
  assert.equal(managedRefusal('help.sponsor'), MANAGED_HINT);
  assert.equal(managedRefusal('takeoff.count'), MANAGED_HINT);
  // A group is a prefix up to the dot, not any id that starts with the same letters.
  assert.equal(managedRefusal('takeoffs'), null);
  assert.equal(managedRefusal('file.open'), null);
});

test('a malformed policy object is read field by field', () => {
  desktopWith({ managed: true, disableAutoUpdate: 'yes', disabledFeatures: ['file.open', 3] });
  const p = managedPolicy();
  assert.equal(p.disableAutoUpdate, false);
  assert.deepEqual(p.disabledFeatures, ['file.open']);
});

test('a managed command comes back disabled and marked, with a run that refuses', () => {
  settings.set({ embedHostHooks: false });
  desktopWith(POLICY);
  const refused = applyCommandPolicy(command('help.updates'));
  assert.equal(refused.enabled, false);
  assert.equal(refused.managed, true);
  assert.equal(refused.hint, MANAGED_HINT);
  ran = false;
  refused.run();
  assert.equal(ran, false);
  assert.equal(commandPolicy('help.updates').managed, true);
  // Everything else is the very object it was given.
  const allowed = command('file.open');
  assert.equal(applyCommandPolicy(allowed), allowed);
});

test('policy wins over an embedding host that allows the command', () => {
  settings.set({ embedHostHooks: true });
  desktopWith(POLICY);
  (globalThis as unknown as { window: { redcolumn: Record<string, unknown> } }).window.redcolumn.commandPolicy = () => null;
  assert.equal(commandPolicy('help.sponsor').disabledReason, MANAGED_HINT);
  settings.set({ embedHostHooks: false });
});

test('the summary lists what is turned off', () => {
  desktopWith(POLICY);
  assert.deepEqual(managedSummary(), ['Automatic updates', 'The community library', '2 commands or command groups']);
});
