// Managed deployment (issue #361): a policy file the main process reads at startup turns features
// off. The e2e fixture hands the app a policy file of its own (RECOLUMN_POLICY_FILE), merged with
// the machine's, so this runs on a machine with no policy installed.
import { expect, test } from '../support/app.ts';

test.skip(({ app }) => app.kind !== 'desktop', 'managed policy belongs to the desktop app');

test.describe('with a policy', () => {
  test.use({
    policy: {
      disableAutoUpdate: true,
      disableAssistant: true,
      disableCommunityLibrary: true,
      disabledFeatures: ['help.sponsor', 'file.migrateRevu'],
      unknownSetting: true,
    },
  });

  test('the page gets the policy, and what it turns off is gone from the menus and refused', async ({ app }) => {
    const policy = await app.page.evaluate(() => (window as unknown as { redcolumn: { policy: Record<string, unknown> } }).redcolumn.policy);
    expect(policy).toMatchObject({ managed: true, disableAutoUpdate: true, disableAssistant: true, disableCommunityLibrary: true, disableMicrosoftSignIn: false, disableExcelSync: false });
    expect(policy.disabledFeatures).toEqual(['help.sponsor', 'file.migrateRevu']);
    // The unknown key is reported, not applied.
    expect(String(policy.problems)).toContain('unknownSetting is not a policy');

    const managed = await app.page.evaluate(() =>
      Object.fromEntries(['help.updates', 'tools.library', 'help.sponsor', 'file.migrateRevu', 'file.open'].map((id) => [id, (window.__nb.commands().get(id) as { managed?: boolean } | undefined)?.managed === true])),
    );
    expect(managed).toEqual({ 'help.updates': true, 'tools.library': true, 'help.sponsor': true, 'file.migrateRevu': true, 'file.open': false });
    await expect(app.cmd('help.updates')).rejects.toThrow(/disabled/);

    await expect(app.page.locator('.menubar-help-btn', { hasText: 'Sponsor' })).toHaveCount(0);
    const help = await app.menu('Help');
    await expect(help).toBeVisible();
    await expect(app.item('Check for Updates')).toHaveCount(0);
    await expect(app.item('Sponsor')).toHaveCount(0);
    await app.page.keyboard.press('Escape');

    // The main process refuses on its own, whatever the page asks.
    const refusals = await app.page.evaluate(async () => {
      const host = (window as unknown as { redcolumn: { setAssistantEnabled(on: boolean): Promise<unknown>; updateState(): Promise<unknown>; assistantInfo(): Promise<{ enabled: boolean }> } }).redcolumn;
      const reason = (p: Promise<unknown>) => p.then(() => 'allowed', (e: Error) => e.message);
      return { assistant: await reason(host.setAssistantEnabled(true)), update: await reason(host.updateState()), info: (await host.assistantInfo()).enabled };
    });
    expect(refusals.assistant).toMatch(/turned off by your organisation/);
    expect(refusals.update).toMatch(/turned off by your organisation/);
    expect(refusals.info).toBe(false);
    expect(app.errors).toEqual([]);
  });

  test('Preferences says the settings are managed, and the MCP switch is locked', async ({ app }) => {
    await app.cmd('file.preferences');
    const note = app.page.locator('.prefs-managed');
    await expect(note).toContainText('Managed by your organisation.');
    await expect(note).toContainText('Automatic updates');
    await app.page.locator('.prefs-nav button', { hasText: /^MCP$/ }).click();
    const mcp = app.page.locator('.mcp-prefs');
    await expect(mcp.locator('input[type=checkbox]')).toBeDisabled();
    await expect(mcp.locator('input[type=checkbox]')).not.toBeChecked();
    await expect(mcp).toContainText('Managed by your organisation.');
    expect(app.errors).toEqual([]);
  });
});

test('without a policy nothing is managed', async ({ app }) => {
  const managed = await app.page.evaluate(() => (window as unknown as { redcolumn: { policy?: { managed?: boolean } } }).redcolumn.policy?.managed);
  expect(managed).toBe(false);
  expect((await app.command('help.updates')).enabled).toBe(true);
  await app.cmd('file.preferences');
  await expect(app.page.locator('.prefs-managed')).toHaveCount(0);
});
