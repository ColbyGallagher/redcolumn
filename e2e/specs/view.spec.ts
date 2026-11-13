import { expect, test, type App } from '../support/app.ts';
import { PLAN } from '../support/driver.ts';
import { boxInSetup, openSetup, setupPage, setupStep, startStandard } from '../support/setup.ts';

const page = async (app: App) => (await app.documents()).find((d) => d.active)!.page;

test.describe('view', () => {
  test.beforeEach(async ({ app }) => {
    await app.open('plan.pdf');
  });

  test('zoom in, out, actual size and fit', async ({ app }) => {
    const fit = (await app.view()).zoom;
    await app.cmd('view.actualSize');
    expect((await app.view()).zoom).toBeCloseTo(1, 5);
    // The default button zoom step (10) takes 100% to 120% and back.
    await app.cmd('view.zoomIn');
    expect((await app.view()).zoom).toBeCloseTo(1.2, 5);
    await app.cmd('view.zoomOut');
    expect((await app.view()).zoom).toBeCloseTo(1, 5);
    await app.cmd('view.fitPage');
    expect((await app.view()).zoom).toBeCloseTo(fit, 5);
    await app.cmd('view.actualSize');
    await app.cmd('view.fitWidth');
    // Fitting the width ignores the height, so it is never smaller than fitting the whole page.
    expect((await app.view()).zoom).toBeGreaterThanOrEqual(fit - 1e-6);
  });

  test('page layouts', async ({ app }) => {
    const LAYOUTS: [string, string][] = [
      ['view.singlePage', 'single'],
      ['view.continuous', 'continuous'],
      ['view.sideBySide', 'single'],
      ['view.continuousSideBySide', 'continuous'],
    ];
    for (const [id, mode] of LAYOUTS) {
      await app.cmd(id);
      await expect.poll(async () => (await app.command(id)).checked, id).toBe(true);
      await expect.poll(async () => (await app.view()).mode, id).toBe(mode);
      for (const [other] of LAYOUTS) if (other !== id) expect((await app.command(other)).checked, `${other} after ${id}`).toBe(false);
    }
    // Side by side halves the zoom that fits: two sheets share the width.
    await app.cmd('view.singlePage');
    const one = (await app.view()).zoom;
    await app.cmd('view.sideBySide');
    expect((await app.view()).zoom).toBeLessThan(one * 0.6);
    await app.cmd('view.coverPage');
    expect((await app.command('view.coverPage')).checked).toBe(true);
  });

  test('rotate view turns the view, not the document', async ({ app }) => {
    await app.cmd('view.rotateClockwise');
    expect((await app.view()).rotation).toBe(1);
    await app.cmd('view.rotateClockwise');
    expect((await app.view()).rotation).toBe(2);
    await app.cmd('view.rotateCounterclockwise');
    await app.cmd('view.rotateCounterclockwise');
    await app.cmd('view.rotateCounterclockwise');
    expect((await app.view()).rotation).toBe(3);
    // The page itself is not rotated.
    expect(await app.pageInfo(1)).toMatchObject({ width: 1224, height: 792 });
  });

  test('page navigation', async ({ app }) => {
    expect(await page(app)).toBe(1);
    expect((await app.command('view.prevPage')).enabled).toBe(false);
    await app.cmd('view.nextPage');
    await expect.poll(() => page(app)).toBe(2);
    await app.cmd('view.lastPage');
    await expect.poll(() => page(app)).toBe(3);
    expect((await app.command('view.nextPage')).enabled).toBe(false);
    await app.cmd('view.prevPage');
    await expect.poll(() => page(app)).toBe(2);
    await app.cmd('view.firstPage');
    await expect.poll(() => page(app)).toBe(1);
  });

  test('back and forward retrace jumps', async ({ app }) => {
    // Views are remembered when a link, bookmark or search jumps somewhere: follow a hyperlink.
    expect((await app.command('view.back')).enabled).toBe(false);
    await app.tool('hyperlink');
    await app.drag([300, 450], [500, 550]);
    const dialog = app.page.locator('.modal.hyperlink-dialog');
    await dialog.locator('select[aria-label=Page]').selectOption({ label: 'Page 3' });
    await dialog.locator('button[type=submit]').click();
    await app.tool('select');
    await app.page.evaluate(() => window.__nb.tools.select([]));
    await app.clicks([[400, 500]]);
    await expect.poll(() => page(app)).toBe(3);
    await expect.poll(async () => (await app.command('view.back')).enabled).toBe(true);
    await app.cmd('view.back');
    await expect.poll(() => page(app)).toBe(1);
    await expect.poll(async () => (await app.command('view.forward')).enabled).toBe(true);
    await app.cmd('view.forward');
    await expect.poll(() => page(app)).toBe(3);
  });

  test('a sheet link previews its target beside the plan: pin, Esc and Open', async ({ app }) => {
    // Once the opened set has been read (its last step, stitching, is done), so reading it does not replace these.
    await expect.poll(() => app.page.evaluate(() => (window.__nb.tools as unknown as { store: { stitchDetected(): boolean } }).store.stitchDetected()), { timeout: 30_000 }).toBe(true);
    // A detail link on page 1 to page 3 (as auto-linking finds them).
    await app.page.evaluate(() => {
      const store = (window.__nb.tools as unknown as { store: { setDetectedLinks(l: unknown[]): void } }).store;
      store.setDetectedLinks([
        { id: 'L1', pageIndex: 0, rect: { x: 300, y: 450, w: 120, h: 40 }, label: '3/A-103', kind: 'detail', detail: '3', targetPage: 2, targetRect: { x: 200, y: 200, w: 200, h: 150 }, confidence: 1 },
        { id: 'L2', pageIndex: 0, rect: { x: 300, y: 550, w: 120, h: 40 }, label: 'A-102', kind: 'sheet', detail: null, targetPage: 1, targetRect: null, confidence: 1 },
      ]);
      window.__nb.tools.select([]);
    });
    await app.tool('select');
    await app.clicks([[360, 470]]);
    const previews = app.page.locator('.link-preview');
    await expect(previews).toHaveCount(1);
    await expect(previews.locator('canvas')).toHaveCount(1);
    expect(await page(app)).toBe(1);
    // Pinned, it stays when the next link is clicked; the next one opens beside it.
    await previews.first().locator('button[aria-pressed]').click();
    await app.clicks([[360, 570]]);
    await expect(previews).toHaveCount(2);
    await app.page.keyboard.press('Escape');
    await expect(previews).toHaveCount(1);
    await previews.first().getByRole('button', { name: 'Open', exact: true }).click();
    await expect.poll(() => page(app)).toBe(3);
    await previews.first().getByRole('button', { name: 'Close preview' }).click();
    await expect(previews).toHaveCount(0);
  });

  test("teach sheet links: the setup's Details step keeps a callout and its title in the standard, looked for only in sets read with it", async ({ app }) => {
    const { sheetNumbers, radius: r, callouts, title } = PLAN.marks;
    await app.open('marks.pdf');
    await expect.poll(async () => (await app.documents()).find((d) => d.active)?.name).toBe('marks.pdf');
    // Sheet numbers as the Pages panel would have them (the fixture has no title blocks).
    await app.page.evaluate((numbers) => {
      const store = (window.__nb.tools as unknown as { store: { setDetectedSheets(s: unknown[]): void } }).store;
      store.setDetectedSheets(numbers.map((number, i) => [i, { number, title: null, discipline: null, scaleText: null, revision: null, source: 'manual', confidence: 1 }]));
    }, sheetNumbers);
    const size = await app.page.evaluate(() => (window.__nb.viewer as unknown as { pageSize(i: number): { width: number; height: number } }).pageSize(0));
    // Teach Sheet Links opens the setup at its link steps; a standard keeps what is taught.
    const { win, wizard } = await openSetup(app, 'document.teachMark');
    await startStandard(wizard, 'Bubble client');
    await expect(wizard.locator('.sw-progress')).toContainText('Sections');
    await setupStep(wizard, 'Details');
    // 1. The callout to detail 2, with its label.
    const two = callouts.find((c) => c.detail === title.detail)!;
    await boxInSetup(win, wizard, size, { x: two.x - r - 4, y: two.y - r - 4, w: 2 * r + 8, h: 2 * r + 8 });
    await expect(wizard.locator('.sw-verdict')).toHaveText(`Detail ${title.detail}, on A-501.`);
    // 2. Next goes to the sheet it names; its title there.
    await wizard.getByRole('button', { name: 'Next', exact: true }).click();
    await expect.poll(() => setupPage(wizard)).toBe(2);
    await boxInSetup(win, wizard, size, { x: title.x - 10, y: title.y - 20, w: 106, h: 30 });
    await expect(wizard.locator('.sw-read')).toContainText(title.detail);
    await wizard.getByRole('button', { name: 'Find the rest' }).click();
    // 3. What was found, with the meter and links to check.
    await expect(wizard.locator('.sw-question h2')).toHaveText('Check the details found');
    await expect(wizard.locator('.sw-meter')).toBeVisible();
    // Kept with the standard, with the boxes as examples; nothing for every set.
    const kept = await app.page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem('nb.profiles')!) as { activeId: string; profiles: { id: string; state: { taughtMarks: unknown[]; drawingStandards: { name: string; marks: { kind: string }[]; examples?: { step: string; role: string }[] }[] } }[] };
      const state = saved.profiles.find((p) => p.id === saved.activeId)!.state;
      return [state.taughtMarks.length, state.drawingStandards.map((s) => [s.name, s.marks.map((m) => m.kind), (s.examples ?? []).map((e) => `${e.step}:${e.role}`)])];
    });
    expect(kept).toEqual([0, [['Bubble client', ['detailCallout', 'detailTitle'], ['details:mark', 'details:title']]]]);
    // Read with the standard, its marks are looked for in this set; read without it, they are not.
    await setupStep(wizard, 'Review');
    await wizard.getByRole('button', { name: 'Read this document with it' }).click();
    const searched = () => app.page.evaluate(() => (window.__nb.tools as unknown as { store: { marksSearched(): string[] } }).store.marksSearched().length);
    await expect.poll(searched).toBe(2);
    await wizard.getByLabel('Drawing standard for this document').selectOption('');
    await expect.poll(searched).toBe(0);
    await Promise.all([win.waitForEvent('close'), wizard.getByRole('button', { name: 'Close the setup' }).click()]);
  });

  test('chainage links: to the cross section at a station, else the plan that covers it; kept once a drawing standard says how', async ({ app }) => {
    await app.open('chainage.pdf');
    await expect.poll(async () => (await app.documents()).find((d) => d.active)?.name).toBe('chainage.pdf');
    const chainage = () =>
      app.page.evaluate(() =>
        (window.__nb.tools as unknown as { store: { allLinks(): { kind: string; label: string; pageIndex: number; targetPage: number; status: string }[] } }).store
          .allLinks()
          .filter((l) => l.kind === 'chainage')
          .map((l) => `${l.pageIndex + 1}:${l.label}>${l.targetPage + 1}:${l.status}`)
          .sort(),
      );
    // Without a standard: the sheets' titles say plan and cross sections, and every link waits for review.
    await expect.poll(chainage).toEqual(['1:12+00>2:review', '1:13+00>2:review', '2:STA 12+00>1:review', '2:STA 13+00>1:review', '3:STA 14+50>1:review']);
    const { win, wizard } = await openSetup(app);
    await startStandard(wizard, 'Road client');
    await setupStep(wizard, 'Review');
    await wizard.getByRole('button', { name: 'Read this document with it' }).click();
    await expect.poll(chainage).toEqual(['1:12+00>2:auto', '1:13+00>2:auto', '2:STA 12+00>1:auto', '2:STA 13+00>1:auto', '3:STA 14+50>1:auto']);
    await Promise.all([win.waitForEvent('close'), wizard.getByRole('button', { name: 'Close the setup' }).click()]);
  });

  test('next and previous document', async ({ app }) => {
    await app.open('plan-rev1.pdf');
    const active = async () => (await app.documents()).find((d) => d.active)!.name;
    expect(await active()).toBe('plan-rev1.pdf');
    await app.cmd('view.prevDocument');
    await expect.poll(active).toBe('plan.pdf');
    await app.cmd('view.nextDocument');
    await expect.poll(active).toBe('plan-rev1.pdf');
  });

  test('split, sync, switch and unsplit', async ({ app }) => {
    expect((await app.command('view.unsplit')).enabled).toBe(false);
    await app.tool('rect');
    await app.drag([300, 450], [350, 500]);
    const chooser = app.page.waitForEvent('filechooser');
    await app.cmd('view.split');
    await (await chooser).setFiles(app.fixture('plan-rev1.pdf'));
    await expect.poll(async () => (await app.command('view.split')).checked).toBe(true);
    // Two panes, two canvases.
    await expect(app.page.locator('main.stage canvas')).toHaveCount(2, { timeout: 15_000 });
    for (const id of ['view.unsplit', 'view.switchPanes', 'view.balance', 'view.syncDocument', 'view.syncPage']) expect((await app.command(id)).enabled, id).toBe(true);
    // Switch Panes swaps the documents: plan.pdf (with its markup) moves out of pane A, then back.
    expect(await app.page.evaluate(() => window.__nb.tools.store.all().length)).toBe(1);
    await app.cmd('view.switchPanes');
    await expect.poll(() => app.page.evaluate(() => window.__nb.tools.store.all().length)).toBe(0);
    await app.cmd('view.switchPanes');
    await expect.poll(() => app.page.evaluate(() => window.__nb.tools.store.all().length)).toBe(1);
    // Balance gives the panes equal widths.
    await app.cmd('view.balance');
    await expect
      .poll(async () => {
        const [a, b] = await app.page.locator('main.stage canvas').evaluateAll((cs) => cs.map((c) => c.getBoundingClientRect().width));
        return Math.abs(a! - b!);
      })
      .toBeLessThan(3);
    for (const id of ['view.syncDocument', 'view.syncPage']) {
      await app.cmd(id);
      await expect.poll(async () => (await app.command(id)).checked, id).toBe(true);
    }
    const names = async () => (await app.documents()).map((d) => d.name).sort();
    expect(await names()).toEqual(['plan-rev1.pdf', 'plan.pdf']);
    await app.cmd('view.unsplit');
    await expect.poll(async () => (await app.command('view.split')).checked).toBe(false);
    await expect(app.page.locator('main.stage canvas')).toHaveCount(1);
  });

  test('split horizontal', async ({ app }) => {
    const chooser = app.page.waitForEvent('filechooser');
    await app.cmd('view.splitHorizontal');
    await (await chooser).setFiles(app.fixture('plan-rev1.pdf'));
    await expect.poll(async () => (await app.command('view.splitHorizontal')).checked).toBe(true);
    expect((await app.command('view.split')).checked).toBe(false);
    await app.cmd('view.unsplit');
  });

  // On/off settings: each flips and flips back.
  const TOGGLES = [
    'view.rulers',
    'view.crosshair',
    'view.grid',
    'view.snapGrid',
    'view.snapContent',
    'view.snapMarkup',
    'view.polarTracking',
    'view.objectSnapTracking',
    'view.showLinks',
    'view.darkPages',
    'view.dimmer',
    'view.thinLines',
    'view.magnifier',
    'view.replyIndicators',
    'view.reuse',
  ];
  for (const id of TOGGLES) {
    test(`${id} toggles`, async ({ app }) => {
      const before = (await app.command(id)).checked;
      expect(typeof before, `${id} is a toggle`).toBe('boolean');
      await app.cmd(id);
      await expect.poll(async () => (await app.command(id)).checked).toBe(!before);
      await app.cmd(id);
      await expect.poll(async () => (await app.command(id)).checked).toBe(before);
    });
  }

  test.describe('grid', () => {
    // A half-inch grid: 36 pt.
    test.use({ settings: { unitSystem: 'imperial', lengthUnit: 'ft', areaUnit: 'ft', volumeUnit: 'ft', gridSize: 0.5 } });

    test('snap to grid puts points on the grid', async ({ app }) => {
      await app.cmd('view.snapContent'); // off, so the drawing's own lines don't win
      await app.cmd('view.snapMarkup');
      await app.cmd('view.snapGrid');
      await app.tool('line');
      await app.drag([301.3, 452.2], [497.6, 548.9]);
      const [m] = await app.markups();
      // Nearest multiples of 36: 301.3 -> 288, 452.2 -> 468, 497.6 -> 504, 548.9 -> 540.
      expect(m!.points.map(([x, y]) => [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000])).toEqual([
        [288, 468],
        [504, 540],
      ]);
    });
  });

  test('full screen', async ({ app }) => {
    await app.cmd('view.fullScreen');
    await expect.poll(async () => (await app.command('view.fullScreen')).checked).toBe(true);
    await app.cmd('view.fullScreen');
    await expect.poll(async () => (await app.command('view.fullScreen')).checked).toBe(false);
  });

  test.afterEach(async ({ app }) => {
    expect(app.errors).toEqual([]);
  });
});
