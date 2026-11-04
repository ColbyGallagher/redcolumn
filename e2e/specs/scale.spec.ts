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

  test('document.scaleReview corrects a sheet saved smaller than its stated size, checks scale bars, and applies the picked pages', async ({ app }) => {
    await app.cmd('document.scaleReview');
    const panel = app.page.locator('.scale-review');
    await expect(panel).toBeVisible();
    // Each page's scale bar is measured against its proposal; the A3 page whose title block does
    // not say it was drawn for A1 is caught by its bar.
    await expect(panel.locator('tbody td:nth-child(7)')).toHaveText(P.map((s) => s.checked));
    await expect(panel.locator('tbody .sr-state')).toHaveText(P.map((s) => s.status));
    await expect(panel.locator('tbody tr').nth(1)).toContainText('A1 → A3');
    await panel.getByRole('button', { name: 'Apply to 2 pages' }).click();
    const scales = await app.page.evaluate(() => (window.__nb.tools.store as unknown as { allScales(): Record<number, { label: string; metersPerPoint: number }> }).allScales());
    expect(P.map((_, i) => scales[i]?.label ?? null)).toEqual(P.map((s) => s.applied));
    // The A3 page is half size, so one point there is twice as long as on the A1 page.
    expect(scales[1]!.metersPerPoint / scales[0]!.metersPerPoint).toBeCloseTo(2, 2);
    // Applied pages agree with their title blocks now; the not-to-scale sheet, the one its bar
    // disagrees with and the details sheet (viewports are never ticked for you) still need a look.
    await expect(panel.locator('tbody .sr-state')).toHaveText(['Not to scale', 'Check', 'Views']);
  });

  test('document.scaleReview proposes a viewport for each detail of an AS SHOWN sheet', async ({ app }) => {
    const i = P.findIndex((s) => s.details);
    const details = P[i]!.details!;
    await app.cmd('document.scaleReview');
    const panel = app.page.locator('.scale-review');
    const row = panel.locator('tbody tr').filter({ hasText: P[i]!.number });
    await expect(row.locator('.sr-viewports')).toHaveText(`${details.length} viewports`);
    await panel.getByRole('button', { name: 'Clear' }).click();
    await row.getByRole('checkbox').check();
    await panel.getByRole('button', { name: 'Apply to 1 page' }).click();
    const viewports = await app.page.evaluate(() =>
      (window.__nb.tools.store as unknown as { allViewports(): { pageIndex: number; name: string; rect: { x: number; y: number; w: number; h: number }; scale: { label: string } }[] }).allViewports(),
    );
    expect(viewports.map((v) => [v.pageIndex, v.name, v.scale.label])).toEqual(details.map((d) => [i, d.title, d.title.split(' ').at(-1)]));
    // Each viewport covers its own detail and stops short of the next one and the title block.
    for (const [k, d] of details.entries()) {
      const r = viewports[k]!.rect;
      expect(r.x <= d.box.x && r.x + r.w >= d.box.x + d.box.w && r.y <= d.box.y && r.y + r.h >= d.box.y + d.box.h, `${d.title} covers its box`).toBe(true);
      expect(r.x + r.w < (details[k + 1]?.box.x ?? 1880), `${d.title} stops before the next`).toBe(true);
    }
    // With its viewports in, the AS SHOWN sheet no longer needs a look.
    await expect(row).toHaveCount(0);
  });

  test('an AI client reads sheet scales, proposes one for review, and cannot measure until a person applies it', async ({ app }) => {
    type Info = { number: string; status: string; measurable: boolean; source: string };
    const { pages } = await app.assistant<{ pages: Info[] }>('get_sheet_info');
    expect(pages.map((p) => [p.number, p.status, p.measurable])).toEqual(P.map((s) => [s.number, s.status === 'Check' ? 'ready' : s.status.toLowerCase().replace('not to scale', 'nts'), false]));
    // Measuring before the page has a scale is refused.
    await expect(app.assistant('place_markup', { page: 1, type: 'length', points: [[300, 300], [400, 300]] })).rejects.toThrow(/no scale yet/);
    // The A3 sheet whose title block omits "@ A1": the client reads the drawing and proposes the
    // sheet size it was drawn for.
    const c104 = P.findIndex((s) => s.number === 'C-104');
    const proposed = await app.assistant<Info>('propose_page_scale', { page: c104 + 1, scale: '1:100', sheetSize: 'A1', reasoning: 'The scale bar under the plan is drawn for A1.' });
    expect([proposed.source, proposed.status]).toEqual(['ai', 'resized']);
    await app.cmd('document.scaleReview');
    const panel = app.page.locator('.scale-review');
    const row = panel.locator('tbody tr').filter({ hasText: 'C-104' });
    await expect(row.locator('.sr-ai')).toHaveText('AI');
    await expect(row.locator('td:nth-child(7)')).toHaveText('✓ scale bar');
    await expect(row.getByRole('checkbox')).not.toBeChecked();
    // A person applies the first sheet's scale; then the client can measure on it.
    await panel.getByRole('button', { name: 'Clear' }).click();
    await panel.locator('tbody tr').filter({ hasText: 'C-101' }).getByRole('checkbox').check();
    await panel.getByRole('button', { name: 'Apply to 1 page' }).click();
    await app.assistant('place_markup', { page: 1, type: 'length', points: [[300, 300], [400, 300]] });
    expect((await app.markups(1)).map((m) => m.type)).toEqual(['length']);
  });

  test('measuring on a sheet marked NOT TO SCALE warns instead of asking for a scale', async ({ app }) => {
    const nts = P.findIndex((s) => s.scale === 'NTS');
    await app.page.evaluate((i) => window.__nb.viewer.goToPage(i), nts);
    await app.tool('length');
    await app.clicks([[300, 450]]);
    const ask = app.page.locator('.modal').filter({ hasText: 'This sheet is not to scale' });
    await expect(ask).toBeVisible();
    await expect(ask.getByRole('button', { name: 'Set Scale Anyway…' })).toBeVisible();
    await ask.getByRole('button', { name: 'Cancel' }).click();
    await expect(ask).toBeHidden();
    expect((await app.pageInfo(nts + 1)).scale).toBeUndefined();
  });
});
