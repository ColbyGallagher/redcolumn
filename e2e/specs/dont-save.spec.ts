import { expect, test } from '../support/app.ts';

// Issue 247: Don't Save has to mean it, even with Document Recovery on (its default).
const A: [number, number] = [300, 450];
const B: [number, number] = [520, 560];

test.describe("Don't Save", () => {
  test.skip(({ app }) => app.kind !== 'web', 'covers the browser build; the logic is shared with the desktop app');

  test('closing with Don\'t Save leaves no markup when the same file is opened again', async ({ app }) => {
    await app.open('plan.pdf');
    await app.tool('rect');
    await app.drag(A, B);
    await expect.poll(async () => (await app.raw()).length).toBe(1);

    await app.cmd('file.close');
    const dialog = app.page.getByRole('dialog', { name: 'Save changes?' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: "Don't Save" }).click();
    await expect.poll(async () => (await app.documents()).length).toBe(0);

    await app.open('plan.pdf');
    expect(await app.raw()).toEqual([]);
  });

  test('markups recovered after a reload can be discarded from the bar', async ({ app }) => {
    await app.open('plan.pdf');
    await app.tool('rect');
    await app.drag(A, B);
    await expect.poll(async () => (await app.raw()).length).toBe(1);

    await app.page.reload();
    const bar = app.page.getByRole('region', { name: 'Recovered markups' });
    await expect(bar).toBeVisible({ timeout: 30_000 });
    await expect(bar).toContainText('Unsaved markups from your last session were recovered.');
    expect(await app.raw()).toHaveLength(1);

    await bar.getByRole('button', { name: 'Discard' }).click();
    await expect(bar).toBeHidden();
    await expect.poll(async () => (await app.raw()).length).toBe(0);
  });

  test('Keep dismisses the bar and the markup stays', async ({ app }) => {
    await app.open('plan.pdf');
    await app.tool('rect');
    await app.drag(A, B);
    await expect.poll(async () => (await app.raw()).length).toBe(1);

    await app.page.reload();
    const bar = app.page.getByRole('region', { name: 'Recovered markups' });
    await expect(bar).toBeVisible({ timeout: 30_000 });
    await bar.getByRole('button', { name: 'Keep' }).click();
    await expect(bar).toBeHidden();
    expect(await app.raw()).toHaveLength(1);
  });
});
