import { expect, test } from '../support/app.ts';

// Interface language (Preferences › General › Options › Language; packages/i18n). The pseudo-locales
// stand in for real translations: en-XA accents and lengthens every translated message, ar-XB shows
// it right to left.
const IMPERIAL = { unitSystem: 'imperial', lengthUnit: 'ft', areaUnit: 'ft', volumeUnit: 'ft' };

test.describe('accented pseudo-locale', () => {
  test.use({ settings: { ...IMPERIAL, uiLanguage: 'en-XA' } });

  test('shows translated text, and switching back to English applies after a restart', async ({ app }) => {
    const root = () => app.page.evaluate(() => [document.documentElement.lang, document.documentElement.dir]);
    expect(await root()).toEqual(['en', 'ltr']);
    await app.cmd('file.preferences');
    const language = app.page.getByRole('combobox', { name: /^\[\[Ļåñĝûåĝé ~+\]\]$/ });
    await expect(language).toHaveValue('en-XA');

    await language.selectOption('en');
    const restart = app.page.getByRole('button', { name: /^\[\[Ŕéšţåŕţ Ñöŵ ~+\]\]$/ });
    await expect(restart).toBeVisible();
    await restart.click();

    await app.page.waitForSelector('.menubar');
    await app.page.waitForFunction(() => !!window.__nb?.commands);
    await app.cmd('file.preferences');
    await expect(app.page.getByRole('combobox', { name: 'Language', exact: true })).toHaveValue('en');
    await expect(app.page.getByRole('button', { name: 'Restart Now' })).toHaveCount(0);
    expect(app.errors).toEqual([]);
  });
});

test.describe('restarting with unsaved changes', () => {
  test.use({ settings: { ...IMPERIAL, uiLanguage: 'en-XA' } });

  test('asks about them first; Cancel keeps the app running with the markup', async ({ app }) => {
    await app.open('plan.pdf');
    await app.tool('rect');
    await app.drag([300, 450], [520, 560]);
    await expect.poll(async () => (await app.raw()).length).toBe(1);

    await app.cmd('file.preferences');
    await app.page.getByRole('combobox', { name: /^\[\[Ļåñĝûåĝé ~+\]\]$/ }).selectOption('en');
    await app.page.getByRole('button', { name: /^\[\[Ŕéšţåŕţ Ñöŵ ~+\]\]$/ }).click();

    // The save prompt's own text is not translated yet, so it is found by its role alone.
    const prompt = app.page.getByRole('dialog').filter({ hasText: 'plan.pdf' });
    await expect(prompt).toBeVisible();
    await prompt.getByRole('button', { name: /Cancel/ }).click();
    await expect(prompt).toBeHidden();
    // Still running, still in the pseudo-locale, markup kept; the new choice is saved for next time.
    expect(await app.raw()).toHaveLength(1);
    expect(await app.page.evaluate(() => JSON.parse(localStorage.getItem('nb.settings') ?? '{}').uiLanguage)).toBe('en');
    expect(app.errors).toEqual([]);
  });
});

test.describe('right-to-left pseudo-locale', () => {
  test.use({ settings: { ...IMPERIAL, uiLanguage: 'ar-XB' } });

  test('sets the page direction and starts without errors', async ({ app }) => {
    expect(await app.page.evaluate(() => [document.documentElement.lang, document.documentElement.dir])).toEqual(['ar', 'rtl']);
    await expect(app.page.locator('.menubar')).toBeVisible();
    expect(app.errors).toEqual([]);
  });
});

test('English by default, with no restart pending', async ({ app }) => {
  expect(await app.page.evaluate(() => document.documentElement.lang)).toBe('en');
  await app.cmd('file.preferences');
  await expect(app.page.getByRole('combobox', { name: 'Language', exact: true })).toHaveValue('auto');
  await expect(app.page.getByRole('button', { name: 'Restart Now' })).toHaveCount(0);
  expect(app.errors).toEqual([]);
});

test.describe('number format', () => {
  test.use({ settings: { unitSystem: 'metric', lengthUnit: 'm', areaUnit: 'm', volumeUnit: 'm', numberFormat: 'de-DE' } });

  test('measurements show and read decimal commas', async ({ app }) => {
    await app.open('plan.pdf');
    await app.scaleSelect().selectOption({ label: '1:100' });
    // 1:100: 72 pt (25.4 mm on paper) is 2.54 m.
    await app.tool('length');
    await app.clicks([
      [300, 450],
      [372, 450],
    ]);
    expect((await app.markups()).map((m) => m.measurement)).toEqual(['2,54 m']);

    await app.cmd('file.preferences');
    await expect(app.page.getByRole('combobox', { name: 'Number Format', exact: true })).toHaveValue('de-DE');
    await expect(app.page.getByRole('button', { name: 'Restart Now' })).toHaveCount(0);
    expect(app.errors).toEqual([]);
  });
});
