import { expect, test, type App } from '../support/app.ts';
import { PLAN } from '../support/driver.ts';

// fixtures/stitch.pdf: a road cut onto three sheets at world x 1000 and x 2000, each sheet turned
// by its own angle (make-fixtures.mjs). Here the user joins the first two by hand.
const S = PLAN.stitch;
/** Where world point (x, y) is drawn on a sheet, in page space (top-left origin, y down). */
const onSheet = (sheet: (typeof S.sheets)[number], [x, y]: [number, number]): [number, number] => {
  const cx = (sheet.from + sheet.to) / 2;
  const c = Math.cos(sheet.angle);
  const s = Math.sin(sheet.angle);
  const px = S.page.width / 2 + c * (x - cx) - s * y;
  const py = S.page.height / 2 + s * (x - cx) + c * y;
  return [px, S.page.height - py];
};

async function goTo(app: App, pageIndex: number) {
  await app.page.evaluate((i) => window.__nb.viewer.goToPage(i), pageIndex);
  await app.fit();
}

const manual = (app: App) =>
  app.page.evaluate(() => (window.__nb.tools.store as unknown as { manualStitch(): { lines: { pageIndex: number; matchTo: string | null; p1: [number, number]; offset?: [number, number] }[]; regions: Record<number, unknown> } }).manualStitch());

/** How many stitched groups detection found (once it has run). */
const detected = (app: App) => () => app.page.evaluate(() => (window.__nb.tools.store as unknown as { stitchGroups(): unknown[] }).stitchGroups().length);

test.describe('stitching by hand', () => {
  test.beforeEach(async ({ app }) => {
    await app.open('stitch.pdf');
  });

  test('document.stitching places regions and match lines; document.stitchToPage writes the joined page', async ({ app }) => {
    // The sheets are matched up in the background after opening; the hand-placed join then
    // replaces the detected one between sheets 1 and 2.
    await expect.poll(detected(app), { timeout: 60_000 }).toBe(1);
    await app.cmd('document.stitching');
    const panel = app.page.locator('.stitch-panel');
    await expect(panel).toBeVisible();
    expect((await app.command('document.stitching')).checked).toBe(true);

    // Sheet 1: a region leaving out the bottom strip, then the match line at x 1000.
    await goTo(app, 0);
    await app.tool('stitchRegion');
    await app.drag([20, 20], [S.page.width - 20, S.page.height - 60]);
    await app.tool('matchLine');
    await app.clicks([onSheet(S.sheets[0]!, [1000, -150]), onSheet(S.sheets[0]!, [1000, 150])]);
    // Sheet 2: the same line; with one unmatched line waiting, the two are matched at once.
    await goTo(app, 1);
    await app.clicks([onSheet(S.sheets[1]!, [1000, 150]), onSheet(S.sheets[1]!, [1000, -150])]);
    await app.tool('select');

    const s = await manual(app);
    expect(s.lines.map((l) => l.pageIndex)).toEqual([0, 1]);
    expect(s.lines.every((l) => l.matchTo)).toBe(true);
    expect(Object.keys(s.regions)).toEqual(['0']);
    await expect(panel.locator('.stitch-region').first()).toHaveText('Custom region');

    await app.cmd('view.stitched');
    expect((await app.view()).mode).toBe('stitch');

    // Nudge: the second sheet slides 5 pt along its line, then back.
    const second = panel.locator('.stitch-line').nth(1);
    await second.click();
    await panel.getByLabel('Nudge step').selectOption('5');
    await panel.getByTitle('Slide forward along the match line (→)').click();
    await expect.poll(async () => (await manual(app)).lines[1]?.offset).toEqual([5, 0]);
    await second.press('ArrowLeft');
    await expect.poll(async () => (await manual(app)).lines[1]?.offset).toBeUndefined();
    expect((await app.view()).mode).toBe('stitch');
    await app.cmd('view.stitched');

    // Editing a line: drag its end to a new place.
    await goTo(app, 1);
    const before = (await manual(app)).lines[1]!.p1;
    const end = onSheet(S.sheets[1]!, [1000, -150]);
    await app.drag(before as [number, number], [end[0] + 40, end[1] + 40]);
    await expect.poll(async () => (await manual(app)).lines[1]!.p1).not.toEqual(before);
    await app.page.keyboard.press('Control+z');
    await expect.poll(async () => (await manual(app)).lines[1]!.p1).toEqual(before);

    expect((await app.command('document.stitchToPage')).enabled).toBe(true);
    await app.cmd('document.stitchToPage');
    // The hand-placed join replaces the detected one between sheets 1 and 2; sheet 3 stays chained on.
    await expect(app.notice()).toHaveText(/^Stitched 3 sheets onto page 4/, { timeout: 60_000 });
    const doc = (await app.documents()).find((d) => d.active)!;
    expect(doc.pageCount).toBe(4);
    // The joined road is about as long as the two slices it came from (same scale).
    const info = await app.pageInfo(4);
    expect(Math.max(info.width, info.height)).toBeGreaterThan(S.page.width);
  });

  test('detected joins can be taken over and edited', async ({ app }) => {
    await expect.poll(detected(app), { timeout: 60_000 }).toBe(1);
    await app.cmd('document.stitching');
    const panel = app.page.locator('.stitch-panel');
    await panel.getByRole('button', { name: 'Edit Detected Lines' }).click();
    await expect(app.notice()).toHaveText('2 detected joins can now be edited.');
    const s = await manual(app);
    expect(s.lines.map((l) => l.pageIndex)).toEqual([0, 1, 1, 2]);
    expect(s.lines.every((l) => l.matchTo)).toBe(true);
    await expect(panel.getByRole('button', { name: 'Edit Detected Lines' })).toHaveCount(0);
  });

  test.afterEach(async ({ app }) => {
    expect(app.errors).toEqual([]);
  });
});
