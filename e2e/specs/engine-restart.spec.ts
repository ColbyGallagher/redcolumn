import { expect, test } from '../support/app.ts';

/** Kills the render engine the way a crashed worker would (its waiting calls fail, listeners hear of it). */
const crashEngine = (page: import('@playwright/test').Page, message: string) =>
  page.evaluate((m) => {
    const nb = (window as unknown as { __nb: { engine: { fail(err: Error): void } } }).__nb;
    nb.engine.fail(new Error(m));
  }, message);

const drawTile = (page: import('@playwright/test').Page) =>
  page.evaluate(async () => {
    const nb = (window as unknown as { __nb: { engine: { openDocuments: { renderTile(p: number, s: number, x: number, y: number, w: number, h: number): Promise<{ bitmap: ImageBitmap }> }[] } } }).__nb;
    const doc = nb.engine.openDocuments[0]!;
    const r = await doc.renderTile(0, 1, 0, 0, 64, 64);
    return r.bitmap.width;
  });

test('a crashed renderer is replaced and the open document draws again', async ({ app }) => {
  await app.open('plan.pdf');
  expect(await drawTile(app.page)).toBe(64);

  await crashEngine(app.page, 'test crash');
  await expect(app.page.getByText('The PDF renderer restarted.')).toBeVisible();
  expect(await drawTile(app.page)).toBe(64);
  const [doc] = await app.documents();
  expect(doc).toMatchObject({ active: true });

  // The failure is logged with its cause and the open documents.
  expect(app.errors.some((e) => e.includes('PDF engine failed'))).toBe(true);
});

test('a second crash straight after a restart is not restarted again', async ({ app }) => {
  await app.open('plan.pdf');
  await crashEngine(app.page, 'first');
  await expect(app.page.getByText('The PDF renderer restarted.')).toBeVisible();
  await crashEngine(app.page, 'second');
  await expect(app.page.getByText('The PDF renderer stopped again.')).toBeVisible();
});
