import { expect, test, type App } from '../support/app.ts';
import type { Pt } from '../support/driver.ts';

// The Line style picker: a listbox whose options are drawn beside their names. Its keys belong to it,
// not to the app's shortcuts.
const A: Pt = [300, 450];
const B: Pt = [500, 450];
const C: Pt = [300, 520];
const D: Pt = [500, 520];

test.describe('line style picker', () => {
  test.use({ toolbar: 'ribbon' });

  test.beforeEach(async ({ app }) => {
    await app.open('plan.pdf');
  });

  const picker = (app: App) => app.page.getByRole('combobox', { name: 'Line style' }).first();
  const list = (app: App) => app.page.getByRole('listbox', { name: 'Line styles' });

  test('keys typed on the picker do not reach the app shortcuts', async ({ app }) => {
    await app.tool('rect');
    await picker(app).focus();
    // L is the Line tool's shortcut; here it is a letter to find "Long dash" with.
    await app.page.keyboard.press('l');
    await expect(list(app)).toBeVisible();
    await expect(list(app).getByRole('option', { name: 'Long dash', exact: true })).toHaveClass(/active/);
    expect((await app.toolState()).tool).toBe('rect');
    await app.page.keyboard.press('Enter');
    await expect(list(app)).toBeHidden();
    await expect(picker(app)).toContainText('Long dash');
    expect((await app.toolState()).tool).toBe('rect');
    // Escape with the list shut is not the app's "cancel the tool" either.
    await app.page.keyboard.press('Escape');
    expect((await app.toolState()).tool).toBe('rect');
  });

  test('options are drawn: each swatch has pixels, and the keyboard moves through them', async ({ app }) => {
    await app.tool('line');
    await picker(app).click();
    const options = list(app).getByRole('option');
    const swatches = list(app).locator('canvas.ls-swatch');
    // The built-in dashes are all in view, so all are drawn.
    const drawn = await swatches.evaluateAll((cs) =>
      cs.slice(0, 6).map((c) => {
        const canvas = c as HTMLCanvasElement;
        const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
        let ink = 0;
        for (let i = 3; i < data.length; i += 4) if (data[i]! > 0) ink++;
        return ink;
      }),
    );
    expect(drawn).toHaveLength(6);
    for (const ink of drawn) expect(ink).toBeGreaterThan(20);
    // A dashed swatch has less ink than a solid one.
    expect(drawn[1]!).toBeLessThan(drawn[0]!);

    // End goes to the last entry, Home to the first.
    await app.page.keyboard.press('End');
    await expect(options.last()).toHaveClass(/active/);
    await app.page.keyboard.press('Home');
    await expect(options.first()).toHaveClass(/active/);
    // The same letter again steps on through the names that begin with it.
    await app.page.keyboard.press('d');
    await expect(list(app).getByRole('option', { name: 'Dashed', exact: true })).toHaveClass(/active/);
    await app.page.keyboard.press('d');
    await expect(list(app).getByRole('option', { name: 'Dotted', exact: true })).toHaveClass(/active/);
    await app.page.keyboard.press('d');
    await expect(list(app).getByRole('option', { name: 'Dash dot', exact: true })).toHaveClass(/active/);
    // Tab closes it without picking.
    await app.page.keyboard.press('Tab');
    await expect(list(app)).toBeHidden();
    await expect(picker(app)).toContainText('Solid');
  });

  test('a selection with different styles shows Mixed, and the Properties panel has the picker too', async ({ app }) => {
    await app.tool('line');
    await app.drag(A, B);
    await app.drag(C, D);
    await app.tool('select');
    const ids = (await app.markups()).map((m) => m.id);
    expect(ids).toHaveLength(2);
    await app.page.evaluate((id) => window.__nb.tools.select([id]), ids[1]!);
    await picker(app).click();
    await list(app).getByRole('option', { name: 'Dotted', exact: true }).click();
    await app.page.evaluate((all) => window.__nb.tools.select(all), ids);
    await expect(picker(app)).toContainText('Mixed');

    // The Properties panel's picker works on the selection the same way (it has no Mixed state of its own).
    await app.page.getByRole('button', { name: 'Properties', exact: true }).click();
    const panel = app.page.locator('.props-panel').getByRole('combobox', { name: 'Line style' });
    await panel.click();
    await list(app).getByRole('option', { name: 'Dashed', exact: true }).click();
    await expect(panel).toContainText('Dashed');
    expect((await app.raw()).map((m) => (m as { style: { dash?: string } }).style.dash)).toEqual(['dashed', 'dashed']);
  });
});
