import { expect, test, type App } from '../support/app.ts';

// Desktop only: a document tab moves to a window of its own.
const A: [number, number] = [300, 450];
const B: [number, number] = [520, 560];

const moveActiveTab = async (app: App) => {
  await app.page.locator('.doc-tab').first().click({ button: 'right' });
  await app.page.getByRole('menuitem', { name: 'Move to New Window' }).click();
};

test.describe('moving a tab to a new window', () => {
  test.skip(({ app }) => app.kind !== 'desktop', 'windows belong to the desktop app');

  test('a saved file opens in a second window and the tab closes', async ({ app }) => {
    await app.answerOpenDialog(app.fixture('plan.pdf'));
    await app.cmd('file.open');
    await expect.poll(async () => (await app.documents()).length).toBe(1);
    expect(await app.windowCount()).toBe(1);

    await moveActiveTab(app);

    const other = await app.secondWindow();
    await expect.poll(async () => (await other.documents()).map((d) => d.name)).toEqual(['plan.pdf']);
    await expect.poll(async () => (await app.documents()).length).toBe(0);
  });

  test('a document with unsaved markups moves with them, still unsaved', async ({ app }) => {
    await app.answerOpenDialog(app.fixture('plan.pdf'));
    await app.cmd('file.open');
    await expect.poll(async () => (await app.documents()).length).toBe(1);
    await app.tool('rect');
    await app.drag(A, B);
    await expect.poll(async () => (await app.raw()).length).toBe(1);

    await moveActiveTab(app);

    // No "Save changes?" question: the changes go with the document.
    const other = await app.secondWindow();
    await expect.poll(async () => (await other.raw().catch(() => [])).map((m) => m.type)).toEqual(['rect']);
    await expect.poll(async () => (await app.documents()).length).toBe(0);
  });
});
