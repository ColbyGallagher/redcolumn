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

test.describe('menus in the accented pseudo-locale', () => {
  test.use({ settings: { ...IMPERIAL, uiLanguage: 'en-XA' } });

  test('every menu and command in the redcolumn menu is translated', async ({ app }) => {
    await app.open('plan.pdf');
    await app.page.locator('.menubar .brand-mark').click();
    const titles = await app.page.locator('.brand-drop > .menu-sub > .menu-item .label').allInnerTexts();
    expect(titles.length).toBeGreaterThan(5);
    for (const t of titles) expect(t, t).toMatch(/^\[\[.*\]\]$/);
    // Open each menu and check its items.
    const untranslated: string[] = [];
    let checked = 0;
    for (const title of titles) {
      const flyout = await app.menu(title.trim());
      await expect(flyout).toBeVisible();
      const items = await flyout.locator('.menu-item .label').allInnerTexts();
      checked += items.length;
      untranslated.push(...items.filter((i) => i.trim() && !/^\[\[/.test(i)).map((i) => `${title} › ${i}`));
      // Fields in a menu (Edit › Author), whose label once showed twice.
      for (const field of await flyout.locator('.menu-field').allInnerTexts()) expect(field.trim(), field).toMatch(/^\[\[[^[]*\]\]$/);
    }
    expect(checked).toBeGreaterThan(150);
    expect(untranslated, untranslated.join('\n')).toEqual([]);
    expect(app.errors).toEqual([]);
  });
});

test.describe('ribbon in the accented pseudo-locale', () => {
  // Clipboard is hidden by its English name, as a person who customised the ribbon in English left it.
  test.use({ toolbar: 'ribbon', settings: { ...IMPERIAL, uiLanguage: 'en-XA', hiddenRibbonGroups: ['home/Clipboard'] } });

  test('every tab and group is translated, and hidden groups stay hidden', async ({ app }) => {
    await app.open('plan.pdf');
    const ribbon = app.page.locator('.ribbon, .rb-tabs');
    const tabs = await ribbon.getByRole('tab').allTextContents();
    expect(tabs.length).toBeGreaterThan(5);
    const untranslated: string[] = [];
    let groups = 0;
    let buttons = 0;
    for (const name of tabs) {
      expect(name, name).toMatch(/^\[\[.*\]\]$/);
      await ribbon.getByRole('tab', { name, exact: true }).click();
      await expect(ribbon.getByRole('tab', { name, exact: true })).toHaveAttribute('aria-selected', 'true');
      const labels = await app.page.locator('.ribbon .rb-group-label').allInnerTexts();
      groups += labels.length;
      untranslated.push(...labels.filter((l) => !/^\[\[/.test(l.trim())).map((l) => `${name} › group ${l}`));
      const items = await app.page.locator('.ribbon .rb-items .rb-label').allInnerTexts();
      buttons += items.length;
      untranslated.push(...items.filter((i) => /[A-Za-z]{2}/.test(i) && !/^\[\[/.test(i.trim())).map((i) => `${name} › ${i}`));
    }
    expect(groups).toBeGreaterThan(40);
    expect(buttons).toBeGreaterThan(150);
    expect(untranslated, untranslated.join('\n')).toEqual([]);

    await ribbon.getByRole('tab').first().click();
    await expect(app.page.locator('.ribbon [data-ribbon-command="edit.formatPainter"]')).toHaveCount(0);
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

    // The save prompt is translated too; the file name inside it is not.
    const prompt = app.page.getByRole('dialog').filter({ hasText: 'plan.pdf' });
    await expect(prompt).toBeVisible();
    await expect(prompt.getByRole('heading')).toHaveText(/^\[\[.*\]\]$/);
    await prompt.getByRole('button', { name: /^\[\[Çåñçéļ ~+\]\]$/ }).click();
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

test.describe('German', () => {
  test.use({ toolbar: 'ribbon', settings: { ...IMPERIAL, uiLanguage: 'de' } });

  test('menus, ribbon and preferences are in German, marked as a preview', async ({ app }) => {
    expect(await app.page.evaluate(() => document.documentElement.lang)).toBe('de');
    await app.open('plan.pdf');
    await app.page.locator('.menubar .brand-mark').click();
    const titles = (await app.page.locator('.brand-drop > .menu-sub > .menu-item .label').allInnerTexts()).map((t) => t.trim());
    expect(titles).toEqual(expect.arrayContaining(['Datei', 'Bearbeiten', 'Ansicht', 'Werkzeuge', 'Fenster', 'Hilfe']));
    await app.page.keyboard.press('Escape');
    const tabs = await app.page.locator('.ribbon, .rb-tabs').getByRole('tab').allTextContents();
    expect(tabs).toEqual(expect.arrayContaining(['Start', 'Mengenermittlung', 'Dokument']));

    await app.cmd('file.preferences');
    const language = app.page.getByRole('combobox', { name: 'Sprache', exact: true });
    await expect(language).toHaveValue('de');
    await expect(language.locator('option[value="de"]')).toHaveText('Deutsch (German) · Vorschau: maschinell übersetzt');
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
