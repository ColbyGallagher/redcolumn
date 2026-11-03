import { expect, test } from '../support/app.ts';
import { PLAN } from '../support/driver.ts';

test.describe('page scale', () => {
  test.beforeEach(async ({ app }) => {
    await app.open('plan.pdf');
  });

  test('a new document has no scale', async ({ app }) => {
    expect((await app.pageInfo(1)).scale).toBeUndefined();
    await expect(app.scaleSelect()).toHaveValue('');
  });

  test('calibrate from a known length sets every page', async ({ app }) => {
    await app.calibrate();
    // 100 pt (1.39") is 10 ft, so 1" is 7.2 ft.
    // Clicks land to within a screen pixel, so allow the last few digits (7.200001 at some window sizes).
    for (let p = 1; p <= PLAN.pageCount; p++) {
      const m = /^1" = ([\d.]+)'$/.exec((await app.pageInfo(p)).scale ?? '');
      expect(m, `page ${p} scale`).not.toBeNull();
      expect(Number(m![1])).toBeCloseTo(7.2, 4);
    }
    await app.tool('length');
    await app.clicks([
      [300, 450],
      [500, 450],
    ]);
    expect((await app.markups()).map((m) => m.measurement)).toEqual([`20'-0"`]);
  });

  test('a preset from the page bar', async ({ app }) => {
    await app.scaleSelect().selectOption({ label: `1/4" = 1'-0"` });
    expect((await app.pageInfo(1)).scale).toBe(`1/4" = 1'`);
    // 1/4" = 1 ft: 72 pt (1") is 4 ft.
    await app.tool('length');
    await app.clicks([
      [300, 450],
      [372, 450],
    ]);
    expect((await app.markups()).map((m) => m.measurement)).toEqual([`4'-0"`]);
  });

  test('measuring without a scale asks for one first', async ({ app }) => {
    await app.tool('length');
    await app.clicks([[300, 450]]);
    const ask = app.page.locator('.modal').filter({ hasText: 'Set a page scale first' });
    await expect(ask).toBeVisible();
    await ask.getByRole('button', { name: 'Cancel' }).click();
    await expect(ask).toBeHidden();
    expect(await app.markups()).toEqual([]);
  });

  test('the scale prompt can start Calibrate', async ({ app }) => {
    await app.tool('area');
    await app.clicks([[300, 450]]);
    await app.page.locator('.modal').getByRole('button', { name: 'Calibrate…' }).click();
    expect((await app.toolState()).tool).toBe('calibrate');
  });

  test('angle and count need no scale', async ({ app }) => {
    await app.tool('count');
    await app.clicks(PLAN.symbols.slice(0, 2), 'enter');
    await expect(app.page.locator('.modal')).toHaveCount(0);
    expect((await app.markups()).map((m) => m.measurement)).toEqual(['2 ea']);
  });

  test('Scale to Length needs a scale', async ({ app }) => {
    await app.tool('length');
    await app.scaleSelect().selectOption({ label: `1/4" = 1'-0"` });
    await app.clicks([
      [300, 450],
      [372, 450],
    ]);
    const [m] = await app.markups();
    await app.page.evaluate((id) => window.__nb.tools.select([id]), m!.id);
    expect((await app.command('edit.scaleToLength')).enabled).toBe(true);
  });

  test.afterEach(async ({ app }) => {
    expect(app.errors).toEqual([]);
  });
});

test.describe('metric', () => {
  test.use({ settings: { unitSystem: 'metric', lengthUnit: 'm', areaUnit: 'm', volumeUnit: 'm' } });

  test('a 1:100 preset measures in metres', async ({ app }) => {
    await app.open('plan.pdf');
    await app.scaleSelect().selectOption({ label: '1:100' });
    // 1:100: 72 pt (25.4 mm on paper) is 2.54 m.
    await app.tool('length');
    await app.clicks([
      [300, 450],
      [372, 450],
    ]);
    expect((await app.markups()).map((m) => m.measurement)).toEqual(['2.54 m']);
  });
});

test.describe('sheet scale review', () => {
  const P = PLAN.paper.sheets;

  test.beforeEach(async ({ app }) => {
    await app.open('paper.pdf');
    // Sheet detection reads each title block's scale once the text is in.
    await expect.poll(() => app.page.evaluate(() => Object.values((window.__nb.tools.store as unknown as { allSheets(): Record<number, { scaleText: string | null }> }).allSheets()).map((s) => s.scaleText)), { timeout: 30_000 }).toEqual(P.map((s) => s.scale));
  });

  test('document.scaleReview corrects a sheet saved smaller than its stated size and applies the picked pages', async ({ app }) => {
    await app.cmd('document.scaleReview');
    const panel = app.page.locator('.scale-review');
    await expect(panel).toBeVisible();
    await expect(panel.locator('tbody .sr-state')).toHaveText(P.map((s) => s.status));
    await expect(panel.locator('tbody tr').nth(1)).toContainText('A1 → A3');
    await panel.getByRole('button', { name: 'Apply to 2 pages' }).click();
    const scales = await app.page.evaluate(() => (window.__nb.tools.store as unknown as { allScales(): Record<number, { label: string; metersPerPoint: number }> }).allScales());
    expect(P.map((_, i) => scales[i]?.label ?? null)).toEqual(P.map((s) => s.applied));
    // The A3 page is half size, so one point there is twice as long as on the A1 page.
    expect(scales[1]!.metersPerPoint / scales[0]!.metersPerPoint).toBeCloseTo(2, 2);
    // Applied pages agree with their title blocks now; only the not-to-scale sheet still needs a look.
    await expect(panel.locator('tbody .sr-state')).toHaveText(['Not to scale']);
  });
});
