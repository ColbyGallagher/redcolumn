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

  test('fit width brings the page back across the view after zooming off centre (#493)', async ({ app }) => {
    // The page's sides on screen, by its two top corners.
    const sides = async () => [(await app.at([0, 0])).x, (await app.at([1224, 0])).x] as const;
    await app.cmd('view.singlePage');
    await app.cmd('view.fitWidth');
    const [left, right] = await sides();
    // Zoom in about the top-left corner of the view, which leaves the page far off to the right.
    await app.page.evaluate(() => window.__nb.viewer.zoomBy(8, 0, 0));
    await app.cmd('view.fitWidth');
    const after = await sides();
    expect(after[0]).toBeCloseTo(left, 1);
    expect(after[1]).toBeCloseTo(right, 1);
  });

  test('fit page shows the entire page in every layout', async ({ app }) => {
    // A window much wider than the sheet's shape, so its height is what limits the zoom.
    await app.page.setViewportSize({ width: 1440, height: 600 });
    for (const layout of ['view.continuous', 'view.singlePage', 'view.continuousSideBySide', 'view.sideBySide']) {
      await app.cmd(layout);
      await app.cmd('view.actualSize');
      await app.cmd('view.fitPage');
      const view = (await app.page.locator('canvas').first().boundingBox())!;
      for (const corner of [[0, 0], [1224, 792]] as const) {
        const at = await app.at(corner);
        expect(at.x, layout).toBeGreaterThanOrEqual(view.x);
        expect(at.x, layout).toBeLessThanOrEqual(view.x + view.width);
        expect(at.y, layout).toBeGreaterThanOrEqual(view.y);
        expect(at.y, layout).toBeLessThanOrEqual(view.y + view.height);
      }
    }
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

  test('page strip layout buttons and zoom presets menu (#507)', async ({ app }) => {
    const nav = app.page.locator('.pagenav');
    // All four page layouts are directly clickable on the bottom strip; Cover Page appears in side-by-side.
    await nav.getByRole('button', { name: 'Side-by-Side', exact: true }).click();
    await expect.poll(async () => (await app.command('view.sideBySide')).checked).toBe(true);
    const coverBtn = nav.getByRole('button', { name: 'Show Cover Page in Side-by-Side', exact: true });
    await expect(coverBtn).toBeVisible();
    await coverBtn.click();
    await expect.poll(async () => (await app.command('view.coverPage')).checked).toBe(true);

    // Switching from Continuous to Continuous Side-by-Side refits the two-page spread.
    await nav.getByRole('button', { name: 'Continuous Pages', exact: true }).click();
    await expect.poll(async () => (await app.command('view.continuous')).checked).toBe(true);
    const oneColZoom = (await app.view()).zoom;
    await nav.getByRole('button', { name: 'Continuous Side-by-Side', exact: true }).click();
    await expect.poll(async () => (await app.command('view.continuousSideBySide')).checked).toBe(true);
    expect((await app.view()).zoom).toBeLessThan(oneColZoom * 0.65);

    // Zoom presets dropdown offers percentage presets, Actual Size, Fit Page and Fit Width.
    const zoomBtn = nav.getByRole('button', { name: 'Zoom presets', exact: true });
    await zoomBtn.click();
    await nav.getByRole('menuitem', { name: '200%', exact: true }).click();
    expect((await app.view()).zoom).toBeCloseTo(2, 3);

    await zoomBtn.click();
    await nav.getByRole('menuitem', { name: /Actual Size/ }).click();
    expect((await app.view()).zoom).toBeCloseTo(1, 3);

    await zoomBtn.click();
    await nav.getByRole('menuitem', { name: /Fit Page/ }).click();
    await expect(nav.locator('button[title^="Fit page"]')).toHaveAttribute('aria-pressed', 'true');

    await zoomBtn.click();
    await nav.getByRole('menuitem', { name: /Fit Width/ }).click();
    await expect(nav.locator('button[title^="Fit width"]')).toHaveAttribute('aria-pressed', 'true');
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

  test('rotate view (Ctrl+Shift+Plus) turns only the document in front', async ({ app }) => {
    await app.open('plan-rev1.pdf');
    await app.page.keyboard.press('Control+Shift+Equal');
    await expect.poll(async () => (await app.view()).rotation).toBe(1);
    const tabs = app.page.getByRole('tablist', { name: 'Documents', exact: true }).getByRole('tab');
    // The other open document is not turned with it.
    await tabs.filter({ hasText: /^plan\.pdf/ }).click();
    await expect.poll(async () => (await app.documents()).find((d) => d.active)?.name).toMatch(/^plan\.pdf/);
    expect((await app.view()).rotation).toBe(0);
    // And the turned one is still turned when it comes back to the front.
    await tabs.filter({ hasText: /^plan-rev1/ }).click();
    await expect.poll(async () => (await app.view()).rotation).toBe(1);
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

  // Keep View Between Pages (on by default).
  type Pt = [number, number];
  type V = { pageView(): { centre: Pt }; pageAtClient(x: number, y: number): number | null; zoomFor(i: number): number };
  const centre = (app: App) => app.page.evaluate(() => (window.__nb.viewer as unknown as V).pageView().centre);
  const setting = (app: App) => app.page.evaluate(() => (window.__nb.viewer as unknown as { keepViewBetweenPages: boolean }).keepViewBetweenPages);
  const zoomOf = async (app: App) => (await app.view()).zoom;
  const turnOff = async (app: App) => {
    await app.cmd('view.keepView');
    await expect.poll(async () => (await app.command('view.keepView')).checked).toBe(false);
    await expect.poll(() => setting(app)).toBe(false);
  };

  test('Keep View Between Pages in continuous layout: next page keeps zoom and the spot in view; off opens the page top', async ({ app }) => {
    expect((await app.view()).mode).toBe('continuous');
    expect((await app.command('view.keepView')).checked).toBe(true);
    const fit = await zoomOf(app);
    await app.page.evaluate(() => window.__nb.viewer.zoomToRect({ x: 100, y: 100, w: 200, h: 150 }, 1));
    const zoomed = await zoomOf(app);
    expect(zoomed).toBeGreaterThan(fit * 2);
    const at = await centre(app);
    await app.cmd('view.nextPage');
    await expect.poll(() => page(app)).toBe(2);
    expect(await zoomOf(app)).toBeCloseTo(zoomed, 5);
    const next = await centre(app);
    expect(next[0]).toBeCloseTo(at[0], 1);
    expect(next[1]).toBeCloseTo(at[1], 1);
    // The middle of the view is on page 2.
    expect(next[0]).toBeGreaterThanOrEqual(0);
    expect(next[1]).toBeGreaterThanOrEqual(0);
    expect(next[1]).toBeLessThanOrEqual(792);
    await app.cmd('view.prevPage');
    await expect.poll(() => page(app)).toBe(1);
    expect(await zoomOf(app)).toBeCloseTo(zoomed, 5);
    // Off: the page opens as a destination does (its top), not at the spot.
    await turnOff(app);
    await app.cmd('view.nextPage');
    await expect.poll(() => page(app)).toBe(2);
    const off = await centre(app);
    await app.page.evaluate(() => {
      window.__nb.viewer.goToPage(0);
      window.__nb.viewer.goToPage(1);
    });
    const dest = await centre(app);
    expect(off[0]).toBeCloseTo(dest[0], 1);
    expect(off[1]).toBeCloseTo(dest[1], 1);
    expect(Math.abs(off[1] - at[1])).toBeGreaterThan(20);
  });

  test('Keep View Between Pages in single page layout: arrows, first/last and the page box', async ({ app }) => {
    await app.cmd('view.singlePage');
    await expect.poll(async () => (await app.view()).mode).toBe('single');
    await app.page.evaluate(() => window.__nb.viewer.zoomToRect({ x: 100, y: 100, w: 200, h: 150 }, 1));
    const zoomed = await zoomOf(app);
    const at = await centre(app);
    const kept = async (n: number) => {
      await expect.poll(() => page(app)).toBe(n);
      expect(await zoomOf(app)).toBeCloseTo(zoomed, 5);
      const c = await centre(app);
      expect(c[0]).toBeCloseTo(at[0], 1);
      expect(c[1]).toBeCloseTo(at[1], 1);
    };
    await app.cmd('view.nextPage');
    await kept(2);
    await app.cmd('view.lastPage');
    await kept(3);
    await app.cmd('view.firstPage');
    await kept(1);
    const box = app.page.getByLabel('Page', { exact: true });
    await box.fill('3');
    await box.press('Enter');
    await kept(3);
  });

  test('Keep View Between Pages with sheets of different sizes: fit stays fit, zoomed in keeps the part of the drawing', async ({ app }) => {
    await app.open('paper.pdf');
    await expect.poll(async () => (await app.view()).mode).toBe('single');
    // Sheet 1 is A1, sheet 2 is A3 (half the width).
    await app.cmd('view.fitPage');
    await app.cmd('view.nextPage');
    await expect.poll(() => page(app)).toBe(2);
    const fitted = await zoomOf(app);
    await app.fit();
    expect(fitted).toBeCloseTo(await zoomOf(app), 5);
    await app.cmd('view.prevPage');
    await expect.poll(() => page(app)).toBe(1);
    await app.fit();
    // Zoomed in on the A1 sheet: the same fraction of the sheet, at twice the zoom on the A3 copy.
    await app.page.evaluate(() => window.__nb.viewer.zoomToRect({ x: 600, y: 400, w: 400, h: 300 }, 1));
    const zoomed = await zoomOf(app);
    const [x, y] = await centre(app);
    await app.cmd('view.nextPage');
    await expect.poll(() => page(app)).toBe(2);
    expect(await zoomOf(app)).toBeCloseTo((zoomed * 2384) / 1191, 3);
    const [nx, ny] = await centre(app);
    expect(nx / 1191).toBeCloseTo(x / 2384, 2);
    expect(ny / 842).toBeCloseTo(y / 1684, 2);
  });

  test('Keep View Between Pages with side-by-side spreads and a cover fits the spread', async ({ app }) => {
    await app.cmd('view.sideBySide');
    await app.cmd('view.coverPage');
    await expect.poll(async () => (await app.command('view.coverPage')).checked).toBe(true);
    await app.page.evaluate(() => window.__nb.viewer.zoomBy(3));
    await app.cmd('view.nextPage');
    await expect.poll(() => page(app)).toBe(2);
    const spread = await zoomOf(app);
    await app.fit();
    expect(spread).toBeCloseTo(await zoomOf(app), 5);
    // The cover is whole on screen going back to it.
    await app.page.evaluate(() => window.__nb.viewer.zoomBy(3));
    await app.cmd('view.prevPage');
    await expect.poll(() => page(app)).toBe(1);
    const cover = await zoomOf(app);
    await app.fit();
    expect(cover).toBeCloseTo(await zoomOf(app), 5);
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

  // Quarantined (e2e/quarantine.md): right-clicking the right pane's tab drops the selection, the
  // Markup Format row closes and the tabs move up before the context menu opens, so it opens on the page.
  test.fixme('split with one file open shows independent panes and a tab in the right pane, with no file picker', async ({ app }) => {
    expect((await app.command('view.unsplit')).enabled).toBe(false);
    await app.tool('rect');
    await app.drag([300, 450], [350, 500]);
    let picked = false;
    app.page.on('filechooser', () => (picked = true));
    await app.cmd('view.split');
    await expect.poll(async () => (await app.command('view.split')).checked).toBe(true);
    await expect(app.page.locator('main.stage canvas')).toHaveCount(2, { timeout: 15_000 });
    expect(picked).toBe(false);
    // One document, one markup store, two independent views (Synchronise is off).
    expect(await app.documents()).toHaveLength(1);
    await expect.poll(async () => (await app.command('view.syncDocument')).checked).toBe(false);
    expect(await app.page.evaluate(() => window.__nb.tools.store.all().length)).toBe(1);
    // The right pane shows the mirrored document's tab, and Move to Left Pane is disabled so it cannot duplicate.
    const rightTabs = app.page.getByRole('tablist', { name: 'Right pane documents' }).getByRole('tab');
    await expect(rightTabs).toHaveCount(1);
    await rightTabs.first().click({ button: 'right' });
    await expect(app.page.getByRole('menuitem', { name: 'Move to Left Pane' })).toBeDisabled();
    await app.page.keyboard.press('Escape');
    // Switch Panes has nothing to swap.
    expect((await app.command('view.switchPanes')).enabled).toBe(false);
    expect(await app.documents()).toHaveLength(1);
    expect(await app.page.evaluate(() => window.__nb.tools.store.all().length)).toBe(1);
    await app.cmd('view.unsplit');
    await expect.poll(async () => (await app.command('view.split')).checked).toBe(false);
    await expect(app.page.locator('main.stage canvas')).toHaveCount(1);
    expect(await app.page.evaluate(() => window.__nb.tools.store.all().length)).toBe(1);
  });

  test('split with one file open starts synchronised when the preference is enabled', async ({ app }) => {
    await app.cmd('file.preferences');
    const dialog = app.page.getByRole('dialog');
    await dialog.getByRole('tab', { name: 'Document', exact: true }).click();
    await dialog.getByLabel('Synchronise Panes When Splitting a Single Document').check();
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog).toBeHidden();
    await app.cmd('view.split');
    await expect(app.page.locator('main.stage canvas')).toHaveCount(2, { timeout: 15_000 });
    await expect.poll(async () => (await app.command('view.syncDocument')).checked).toBe(true);
  });

  test('page edits while the view is mirrored reach both panes', async ({ app }) => {
    await app.cmd('view.split');
    await expect(app.page.locator('main.stage canvas')).toHaveCount(2, { timeout: 15_000 });
    await expect.poll(() => app.page.evaluate(() => !!window.__nb.viewerB?.pageSize(0))).toBe(true);
    // Rotate Pages turns the left pane's current page, which need not be the first.
    const page = await app.page.evaluate(() => window.__nb.viewer.currentPageIndex);
    const sizes = () => app.page.evaluate((p) => [window.__nb.viewer.pageSize(p), window.__nb.viewerB?.pageSize(p)], page);
    const [before] = await sizes();
    await app.cmd('document.rotatePages');
    await expect
      .poll(async () => {
        const [a, b] = await sizes();
        return !!a && !!b && a.width === b.width && a.height === b.height && a.width === before!.height;
      })
      .toBe(true);
  });

  test('page edits made in the mirrored right pane keep both panes and the tab in step', async ({ app }) => {
    await app.tool('rect');
    await app.drag([300, 450], [350, 500]);
    await app.cmd('view.split');
    await expect(app.page.locator('main.stage canvas')).toHaveCount(2, { timeout: 15_000 });
    await expect.poll(() => app.page.evaluate(() => !!window.__nb.viewerB?.pageSize(0))).toBe(true);
    // Rotate with the right pane active: its current page (the views are independent) is the one turned.
    await app.page.locator('main.stage').nth(1).click({ position: { x: 5, y: 5 } });
    const page = await app.page.evaluate(() => window.__nb.viewerB!.currentPageIndex);
    const sizes = () => app.page.evaluate((p) => [window.__nb.viewer.pageSize(p), window.__nb.viewerB?.pageSize(p)], page);
    const [before] = await sizes();
    await app.cmd('document.rotatePages');
    await expect
      .poll(async () => {
        const [a, b] = await sizes();
        return !!a && !!b && a.width === b.width && a.height === b.height && a.width === before!.height;
      })
      .toBe(true);
    expect(await app.page.evaluate(() => window.__nb.tools.store.all().length)).toBe(1);
    // Closing the edited document from the right pane asks about the changes, then closes the tab and ends the split.
    await app.cmd('file.close');
    const dialog = app.page.getByRole('dialog', { name: 'Save changes?' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: "Don't Save" }).click();
    await expect.poll(async () => (await app.documents()).length).toBe(0);
    await expect.poll(async () => (await app.command('view.split')).checked).toBe(false);
    await expect(app.page.locator('main.stage canvas')).toHaveCount(1);
  });

  for (const from of ['left', 'right'] as const) {
    test(`closing the document from the ${from} pane while mirrored closes both views`, async ({ app }) => {
      await app.cmd('view.split');
      await expect(app.page.locator('main.stage canvas')).toHaveCount(2, { timeout: 15_000 });
      await app.page.locator('main.stage').nth(from === 'left' ? 0 : 1).click({ position: { x: 5, y: 5 } });
      await app.cmd('file.close');
      await expect.poll(async () => (await app.documents()).length).toBe(0);
      await expect.poll(async () => (await app.command('view.split')).checked).toBe(false);
      await expect(app.page.locator('main.stage canvas')).toHaveCount(1);
    });
  }

  test('a mirrored right pane follows the left pane to another file, and closing keeps the other', async ({ app }) => {
    await app.cmd('view.split');
    await expect(app.page.locator('main.stage canvas')).toHaveCount(2, { timeout: 15_000 });
    await app.open('plan-rev1.pdf');
    expect((await app.command('view.switchPanes')).enabled).toBe(false);
    expect(await app.documents()).toHaveLength(2);
    await expect(app.page.locator('main.stage canvas')).toHaveCount(2);
    // Closing from the right pane closes the file in front (plan-rev1.pdf); plan.pdf stays, still split.
    await app.page.locator('main.stage').nth(1).click({ position: { x: 5, y: 5 } });
    await app.cmd('file.close');
    await expect.poll(async () => (await app.documents()).map((d) => d.name)).toEqual(['plan.pdf']);
    await expect(app.page.locator('main.stage canvas')).toHaveCount(2);
    expect(await app.page.evaluate(() => !!window.__nb.viewerB?.pageSize(0))).toBe(true);
    await app.cmd('view.unsplit');
    await expect(app.page.locator('main.stage canvas')).toHaveCount(1);
  });

  test('split with two files open puts the other open file in the second pane', async ({ app }) => {
    await app.tool('rect');
    await app.drag([300, 450], [350, 500]);
    await app.open('plan-rev1.pdf');
    await app.open('plan.pdf');
    let picked = false;
    app.page.on('filechooser', () => (picked = true));
    await app.cmd('view.split');
    await expect.poll(async () => (await app.command('view.split')).checked).toBe(true);
    await expect(app.page.locator('main.stage canvas')).toHaveCount(2, { timeout: 15_000 });
    expect(picked).toBe(false);
    expect((await app.documents()).map((d) => d.name).sort()).toEqual(['plan-rev1.pdf', 'plan.pdf']);
    // The active file stays active, its markups intact.
    expect((await app.documents()).find((d) => d.active)!.name).toBe('plan.pdf');
    for (const id of ['view.unsplit', 'view.switchPanes', 'view.balance', 'view.syncDocument', 'view.syncPage']) expect((await app.command(id)).enabled, id).toBe(true);
    // Switch Panes swaps the documents: the active file is unchanged, and both stay open.
    const before = (await app.documents()).find((d) => d.active)!.name;
    expect(await app.page.evaluate(() => window.__nb.tools.store.all().length)).toBe(1);
    await app.cmd('view.switchPanes');
    await expect.poll(() => app.page.evaluate(() => window.__nb.tools.store.all().length)).toBe(0);
    await app.cmd('view.switchPanes');
    await expect.poll(() => app.page.evaluate(() => window.__nb.tools.store.all().length)).toBe(1);
    expect((await app.documents()).find((d) => d.active)!.name).toBe(before);
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
    await app.cmd('view.unsplit');
    await expect.poll(async () => (await app.command('view.split')).checked).toBe(false);
    await expect(app.page.locator('main.stage canvas')).toHaveCount(1);
    expect(await app.documents()).toHaveLength(2);
  });

  test('split horizontal', async ({ app }) => {
    await app.cmd('view.splitHorizontal');
    await expect.poll(async () => (await app.command('view.splitHorizontal')).checked).toBe(true);
    expect((await app.command('view.split')).checked).toBe(false);
    await app.cmd('view.unsplit');
  });

  test('disable line weights thins the drawing, and turning it off restores it (#502)', async ({ app }) => {
    // How much darkness is on the drawing (grey pixels count in part), once the render has settled.
    const ink = async () => {
      let last = -1;
      for (let i = 0; i < 40; i++) {
        await app.page.waitForTimeout(500);
        const n = await app.page.evaluate(() => {
          const c = document.querySelector('canvas')!;
          const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
          let dark = 0;
          // The page is white; what surrounds it is left out.
          for (let k = 0; k < d.length; k += 4) if (d[k + 3] === 255 && d[k] === d[k + 1] && d[k] === d[k + 2]) dark += 255 - d[k]!;
          return dark;
        });
        if (n === last) return n;
        last = n;
      }
      return last;
    };
    // Zoomed in, so a line's weight covers many pixels.
    await app.cmd('view.singlePage');
    await app.page.evaluate(() => window.__nb.viewer.zoomBy(4));
    const normal = await ink();
    await app.cmd('view.thinLines');
    const thin = await ink();
    expect(thin).toBeGreaterThan(0);
    expect(thin).toBeLessThan(normal * 0.9);
    await app.cmd('view.thinLines');
    expect(await ink()).toBe(normal);
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
    'view.keepView',
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

  test.describe('wheel set to scroll in single page view', () => {
    test.use({ settings: { unitSystem: 'imperial', lengthUnit: 'ft', areaUnit: 'ft', volumeUnit: 'ft', singlePageWheel: 'scroll' } });

    test('scrolls to the edge of the page, then turns the page', async ({ app }) => {
      await app.cmd('view.singlePage');
      await expect.poll(async () => (await app.view()).mode).toBe('single');
      // Over the middle of the fitted page, which stays over the view however it scrolls.
      const c = await app.at([612, 396]);
      // Each mouse-wheel notch arrives as its own event, after the last one's pause.
      const notch = async (dy: number) => {
        await app.page.mouse.move(c.x, c.y);
        await app.page.mouse.wheel(0, dy);
        await app.page.waitForTimeout(200);
      };
      const fit = (await app.view()).zoom;
      // The whole page in view: each notch turns a page, at the same zoom, and stops at the ends.
      await notch(100);
      await expect.poll(async () => (await app.view()).pageIndex).toBe(1);
      expect((await app.view()).zoom).toBeCloseTo(fit, 5);
      await notch(-100);
      await expect.poll(async () => (await app.view()).pageIndex).toBe(0);
      await notch(-100);
      expect((await app.view()).pageIndex).toBe(0);

      // Zoomed in, the wheel scrolls down the sheet first and turns only once its bottom is in view.
      await app.page.evaluate(() => window.__nb.viewer.zoomBy(4));
      const zoom = (await app.view()).zoom;
      const panY = await app.page.evaluate(() => window.__nb.viewer.getView().panY);
      await notch(100);
      expect((await app.view()).pageIndex).toBe(0);
      expect(await app.page.evaluate(() => window.__nb.viewer.getView().panY)).toBeLessThan(panY);
      for (let i = 0; i < 100 && (await app.view()).pageIndex === 0; i++) await notch(100);
      // The next page opens at its top (a 24 px margin), at the same zoom.
      const next = await app.page.evaluate(() => window.__nb.viewer.getView());
      expect(next.pageIndex).toBe(1);
      expect(next.zoom).toBeCloseTo(zoom, 5);
      expect(next.panY).toBeCloseTo(24, 0);
      // Back up: the previous page opens at its bottom.
      await notch(-100);
      const prev = await app.page.evaluate(() => window.__nb.viewer.getView());
      expect(prev.pageIndex).toBe(0);
      const height = await app.page.evaluate(([x, y]) => (document.elementFromPoint(x, y) as HTMLCanvasElement).clientHeight, [c.x, c.y] as const);
      expect(prev.panY + 792 * prev.zoom).toBeCloseTo(height - 24, 0);
    });
    test('a trackpad gesture turns one page, however long it runs', async ({ app }) => {
      await app.cmd('view.singlePage');
      await expect.poll(async () => (await app.view()).mode).toBe('single');
      const c = await app.at([612, 396]);
      // Small deltas with no pause between them: one swipe and its momentum. Sent in one go from the
      // page, so a busy test machine cannot space them out into separate gestures.
      await app.page.evaluate(([x, y]) => {
        const target = document.elementFromPoint(x, y)!;
        for (let i = 0; i < 30; i++) target.dispatchEvent(new WheelEvent('wheel', { deltaY: 20, clientX: x, clientY: y, bubbles: true, cancelable: true }));
      }, [c.x, c.y] as const);
      await expect.poll(async () => (await app.view()).pageIndex).toBe(1);
      await app.page.waitForTimeout(300);
      expect((await app.view()).pageIndex).toBe(1);
    });
  });

  test.describe('book reading defaults: two-page, cover, fit page and wheel scroll (#507)', () => {
    test.use({
      settings: {
        unitSystem: 'imperial',
        lengthUnit: 'ft',
        areaUnit: 'ft',
        volumeUnit: 'ft',
        pageLayout: 'sideBySide',
        pageZoom: 'fitPage',
        coverPage: true,
        singlePageWheel: 'scroll',
      },
    });

    test('opens in two-page fit page and wheel-scrolling between cover and spread keeps each spread fitted', async ({ app }) => {
      await expect.poll(async () => (await app.command('view.sideBySide')).checked).toBe(true);
      await expect.poll(async () => (await app.command('view.coverPage')).checked).toBe(true);
      const coverZoom = (await app.view()).zoom;
      const box = (await app.page.locator('canvas').first().boundingBox())!;
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      // Scroll down one wheel notch from cover (page 1) to spread (pages 2–3): refits to the two-page spread.
      await app.page.mouse.move(cx, cy);
      await app.page.mouse.wheel(0, 100);
      await expect.poll(async () => (await app.view()).pageIndex).toBe(1);
      const spreadZoom = (await app.view()).zoom;
      expect(spreadZoom).toBeLessThan(coverZoom * 0.65);
      // Scroll back up to cover (page 1): refits back to the single cover page.
      await app.page.waitForTimeout(200);
      await app.page.mouse.wheel(0, -100);
      await expect.poll(async () => (await app.view()).pageIndex).toBe(0);
      expect((await app.view()).zoom).toBeCloseTo(coverZoom, 4);
    });
  });

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
