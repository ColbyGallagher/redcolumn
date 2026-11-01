import { expect, test, type App } from '../support/app.ts';

// The top toolbar as a ribbon, which is how the app starts (Window › Toolbar Display): its tabs,
// the Modify tab's buttons following the selection, collapsing to the tabs, and over to the
// simplified toolbar.

const select = (app: App, ids: string[]) => app.page.evaluate((ids) => window.__nb.tools.select(ids), ids);
const ribbon = (app: App) => app.page.locator('.ribbon');
const button = (app: App, id: string) => ribbon(app).locator(`[data-ribbon-command="${id}"]`);

async function display(app: App, option: RegExp) {
  await app.page.getByRole('button', { name: /^Toolbar display options/ }).first().click();
  await app.page.getByRole('menuitemradio', { name: option }).click();
}

test.describe('ribbon', () => {
  // The app starts with the ribbon; other specs start with the one-row toolbar (support/app.ts).
  test.use({ toolbar: 'ribbon' });

  test.beforeEach(async ({ app }) => {
    await app.open('plan.pdf');
  });

  test('starts as a ribbon, and switches to its tabs only and the simplified toolbar', async ({ app }) => {
    await expect(ribbon(app)).toBeVisible();
    await expect(app.page.locator('.toolbar.tools')).toHaveCount(0);
    expect((await app.command('window.ribbon')).checked).toBe(true);

    await display(app, /Show Tabs and Commands/);
    await expect(ribbon(app)).toBeVisible();
    await expect(app.page.locator('.toolbar.tools')).toHaveCount(0);
    expect((await app.command('window.ribbon')).checked).toBe(true);
    await expect(ribbon(app).getByRole('tab')).toHaveText(['Home', 'Markup', 'Measure', 'Diagram', 'Modify', 'Document', 'Bulk', 'View']);

    // Every bulk job has a button on the Bulk tab; Modify has the PDF content tools.
    await ribbon(app).getByRole('tab', { name: 'Bulk' }).click();
    const jobs = (await app.page.evaluate(() => [...window.__nb.commands().keys()])).filter((id) => id.startsWith('batch.'));
    expect(jobs.length).toBeGreaterThan(10);
    for (const id of jobs) await expect(button(app, id)).toBeEnabled();
    await ribbon(app).getByRole('tab', { name: 'Modify' }).click();
    for (const id of ['edit.selectText', 'edit.eraseContent', 'edit.cutContent', 'edit.editText']) await expect(button(app, id)).toBeVisible();
    await button(app, 'edit.eraseContent').click();
    expect((await app.command('edit.eraseContent')).checked).toBe(true);

    // A tool picked from the Markup tab.
    await ribbon(app).getByRole('tab', { name: 'Markup' }).click();
    await ribbon(app).locator('[data-toolbar-tool="rect"]').click();
    expect((await app.command('tool.rect')).checked).toBe(true);

    // Ctrl+F1 folds the ribbon to its tabs; a tab drops its commands down until one is used.
    await app.page.keyboard.press('Control+F1');
    expect((await app.command('window.ribbonTabs')).checked).toBe(true);
    expect((await app.command('window.collapseRibbon')).checked).toBe(true);
    await expect(ribbon(app).locator('.rb-body')).toHaveCount(0);
    await ribbon(app).getByRole('tab', { name: 'View' }).click();
    await expect(button(app, 'view.fitWidth')).toBeVisible();
    await button(app, 'view.fitWidth').click();
    await expect(ribbon(app).locator('.rb-body')).toHaveCount(0);

    await app.cmd('window.ribbon');
    await expect(ribbon(app).locator('.rb-body')).toBeVisible();

    await display(app, /Simplified Toolbar/);
    await expect(ribbon(app)).toHaveCount(0);
    await expect(app.page.locator('.toolbar.tools')).toBeVisible();
    expect((await app.command('window.simplifiedToolbar')).checked).toBe(true);
  });

  test('the Modify tab disables what the selection cannot take', async ({ app }) => {
    await ribbon(app).getByRole('tab', { name: 'Modify' }).click();

    await app.tool('line');
    await app.drag([300, 450], [500, 450]);
    await app.tool('rect');
    await app.drag([300, 500], [400, 560]);
    await app.tool('select');
    const [line, rect] = await app.markups();

    // Nothing selected: the tools that pick by clicking are on; those that need a selection are off.
    await select(app, []);
    await expect(button(app, 'edit.trim')).toBeEnabled();
    await expect(button(app, 'edit.explode')).toBeDisabled();

    // A rectangle explodes into lines, but is not a line to trim, join or fillet.
    await select(app, [rect!.id]);
    await expect(button(app, 'edit.explode')).toBeEnabled();
    await expect(button(app, 'edit.trim')).toBeDisabled();
    await expect(button(app, 'edit.fillet')).toBeDisabled();
    await expect(button(app, 'edit.join')).toBeDisabled();
    await expect(button(app, 'edit.move')).toBeEnabled();
    await expect(button(app, 'edit.autoSize')).toBeDisabled();
    await app.page.screenshot({ path: test.info().outputPath('ribbon-modify-rect.png') });

    // A line trims and fillets but has nothing to explode.
    await select(app, [line!.id]);
    await expect(button(app, 'edit.explode')).toBeDisabled();
    await expect(button(app, 'edit.trim')).toBeEnabled();
    await expect(button(app, 'edit.fillet')).toBeEnabled();

    // Explode from the ribbon splits the rectangle into four lines.
    await select(app, [rect!.id]);
    await button(app, 'edit.explode').click();
    await expect.poll(async () => (await app.markups()).filter((m) => m.type === 'line').length).toBe(5);
  });
});
