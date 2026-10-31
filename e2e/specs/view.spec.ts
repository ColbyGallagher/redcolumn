import { expect, test, type App } from '../support/app.ts';
import { PLAN } from '../support/driver.ts';

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

  test('teach a mark: the example is kept in the profile and marks like it wait in Needs review', async ({ app }) => {
    const { sheetNumbers, radius: r, callouts } = PLAN.marks;
    await app.open('marks.pdf');
    await expect.poll(async () => (await app.documents()).find((d) => d.active)?.name).toBe('marks.pdf');
    // Sheet numbers as the Pages panel would have them (the fixture has no title blocks).
    await app.page.evaluate((numbers) => {
      const store = (window.__nb.tools as unknown as { store: { setDetectedSheets(s: unknown[]): void } }).store;
      store.setDetectedSheets(numbers.map((number, i) => [i, { number, title: null, discipline: null, scaleText: null, revision: null, source: 'manual', confidence: 1 }]));
    }, sheetNumbers);
    await app.cmd('document.teachMark');
    const panel = app.page.locator('.links');
    await expect(panel).toBeVisible();
    // Box the first callout, with its label.
    const [first] = callouts;
    await app.drag([first!.x - r - 4, first!.y - r - 4], [first!.x + r + 4, first!.y + r + 4]);
    const dialog = app.page.locator('.modal.teach-mark-dialog');
    await dialog.getByLabel('Detail callout').check();
    await dialog.getByLabel('Name').fill('Split bubble');
    await dialog.locator('button[type=submit]').click();
    await expect(dialog).toHaveCount(0);
    // Every callout (the example too) is a link to review, with how sure the match is; the grid bubble is not.
    await expect(panel.locator('h3', { hasText: 'Needs review' })).toHaveText(`Needs review (${callouts.length})`);
    const rows = panel.locator('li', { has: app.page.locator('button[title="Keep this link"]') });
    await expect(rows).toHaveCount(callouts.length);
    for (const c of callouts) await expect(rows.filter({ hasText: `${c.detail}/${c.sheet}` })).toContainText(/A-101 → A-501\s*\d+%/);
    // Kept in the profile, on this device.
    const taught = await app.page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem('nb.profiles')!) as { activeId: string; profiles: { id: string; state: { taughtMarks: { name: string; kind: string }[] } }[] };
      return saved.profiles.find((p) => p.id === saved.activeId)!.state.taughtMarks.map((m) => [m.name, m.kind]);
    });
    expect(taught).toEqual([['Split bubble', 'detailCallout']]);
    await expect(panel.locator('h3', { hasText: 'Taught marks' })).toHaveText('Taught marks (1)');
    // Nothing is applied until a person keeps it.
    await rows.filter({ hasText: '2/A-501' }).locator('button[title="Keep this link"]').click();
    await expect(rows).toHaveCount(callouts.length - 1);
    const kept = await app.page.evaluate(() => (window.__nb.tools as unknown as { store: { allLinks(): { label: string; status: string }[] } }).store.allLinks().filter((l) => l.status === 'accepted').map((l) => l.label));
    expect(kept).toEqual(['2/A-501']);
    // Forgetting the mark takes back the links still waiting, not the one kept.
    await panel.getByRole('button', { name: 'Forget Split bubble' }).click();
    await expect(panel.locator('h3', { hasText: 'Needs review' })).toHaveCount(0);
    await expect(panel.locator('h3', { hasText: 'Taught marks' })).toHaveCount(0);
  });

  test("a drawing standard's own taught marks are looked for only in sets read with it", async ({ app }) => {
    const { sheetNumbers, radius: r, callouts } = PLAN.marks;
    await app.open('marks.pdf');
    await expect.poll(async () => (await app.documents()).find((d) => d.active)?.name).toBe('marks.pdf');
    await app.page.evaluate((numbers) => {
      const store = (window.__nb.tools as unknown as { store: { setDetectedSheets(s: unknown[]): void } }).store;
      store.setDetectedSheets(numbers.map((number, i) => [i, { number, title: null, discipline: null, scaleText: null, revision: null, source: 'manual', confidence: 1 }]));
    }, sheetNumbers);
    // A standard with no title-block boxes: this client's sets only need its marks.
    await app.cmd('document.drawingStandards');
    const standard = app.page.locator('.drawing-standard');
    await standard.getByLabel('Name').fill('Bubble client');
    await standard.getByRole('button', { name: 'Save and use' }).click();
    await expect(standard.getByLabel('Drawing standard for this document')).not.toHaveValue('');
    await standard.locator('summary', { hasText: 'Sheet links and marks' }).click();
    await standard.getByRole('button', { name: 'Teach a mark…' }).click();
    const [first] = callouts;
    await app.drag([first!.x - r - 4, first!.y - r - 4], [first!.x + r + 4, first!.y + r + 4]);
    const dialog = app.page.locator('.modal.teach-mark-dialog');
    await expect(dialog.getByLabel('Sets read with Bubble client')).toBeChecked();
    await dialog.getByLabel('Detail callout').check();
    await dialog.getByLabel('Name').fill('Client bubble');
    await dialog.locator('button[type=submit]').click();
    await expect(dialog).toHaveCount(0);
    // Reading the set with the standard already linked these bubbles from their text, so the mark
    // suggests nothing new here; what matters is that it is looked for in this set.
    const searched = () => app.page.evaluate(() => (window.__nb.tools as unknown as { store: { marksSearched(): string[] } }).store.marksSearched().length);
    await expect.poll(searched).toBe(1);
    const links = app.page.locator('.links');
    await expect(links.locator('.taught-kind')).toHaveText('Detail callout · Bubble client');
    await expect(standard.locator('h4', { hasText: 'Marks' })).toHaveText('Marks (1)');
    // Kept with the standard, not with the marks for every set.
    const kept = await app.page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem('nb.profiles')!) as { activeId: string; profiles: { id: string; state: { taughtMarks: unknown[]; drawingStandards: { name: string; marks: { name: string }[] }[] } }[] };
      const state = saved.profiles.find((p) => p.id === saved.activeId)!.state;
      return [state.taughtMarks.length, state.drawingStandards.map((s) => [s.name, s.marks.map((m) => m.name)])];
    });
    expect(kept).toEqual([0, [['Bubble client', ['Client bubble']]]]);
    // Read without the standard, its marks are not looked for.
    await standard.getByLabel('Drawing standard for this document').selectOption('');
    await expect.poll(searched).toBe(0);
    await expect(links.locator('h3', { hasText: 'Taught marks' })).toHaveCount(0);
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
