import { expect, test, type App } from '../support/app.ts';
import { PLAN } from '../support/driver.ts';

// plan-rev1.pdf is plan.pdf with "REVISION 1" added to sheet 1 at x 1000, baseline y 60 (12 pt):
// the only difference between the two, so a compare finds one change, on page 1. In Helvetica the
// words are 5613/1000 em wide (67.4 pt at 12 pt), and capitals rise 718/1000 em (8.6 pt) above the
// baseline, with nothing below it.
const REVISION = { x0: 1000, x1: 1067, y0: 52, y1: 60 };

const modal = (app: App, title: string) => app.page.locator('.modal').filter({ has: app.page.locator('h3', { hasText: title }) });

async function pick(app: App, title: string) {
  const dialog = modal(app, title);
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Old revision', { exact: true }).selectOption({ label: 'plan.pdf (open)' });
  await dialog.getByLabel('New revision', { exact: true }).selectOption({ label: 'plan-rev1.pdf (open)' });
  await dialog.getByLabel('All pages, in page order').check();
  return dialog;
}

test.describe('compare and overlay', () => {
  test.beforeEach(async ({ app }) => {
    await app.open('plan.pdf', 'plan-rev1.pdf');
  });

  test('need two documents in the library', async ({ app }) => {
    expect((await app.command('document.compare')).enabled).toBe(true);
    expect((await app.command('document.overlay')).enabled).toBe(true);
  });

  test('document.compare clouds the one change', async ({ app }) => {
    await app.cmd('document.compare');
    const dialog = await pick(app, 'Compare Documents');
    await dialog.locator('button[type=submit]').click();
    const results = app.page.locator('.compare-results');
    await expect(results.locator('.vs-result')).toHaveText('1 difference on 1 of 3 pages', { timeout: 60_000 });
    await expect(results.locator('.compare-page')).toHaveText(['Page 1 · 1', 'Page 2 · no changes', 'Page 3 · no changes']);
    // The cloud goes on the new revision, around the revision note.
    const marks = (await app.assistant<{ markups: { type: string; page: number; points: [number, number][] }[] }>('list_markups', { document: 'plan-rev1.pdf' })).markups;
    expect(marks.map((m) => [m.type, m.page])).toEqual([['cloud', 1]]);
    const xs = marks[0]!.points.map(([x]) => x);
    const ys = marks[0]!.points.map(([, y]) => y);
    expect(Math.min(...xs)).toBeLessThanOrEqual(REVISION.x0);
    expect(Math.max(...xs)).toBeGreaterThanOrEqual(REVISION.x1);
    expect(Math.min(...ys)).toBeLessThanOrEqual(REVISION.y0);
    expect(Math.max(...ys)).toBeGreaterThanOrEqual(REVISION.y1);
    // ...and not far beyond it: nothing else changed.
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(200);
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(100);
    // The two revisions side by side.
    expect((await app.command('view.split')).checked || (await app.command('view.splitHorizontal')).checked).toBe(true);
  });

  test('document.overlay stacks the pages into a new PDF', async ({ app }) => {
    await app.cmd('document.overlay');
    const dialog = await pick(app, 'Overlay Pages');
    await dialog.locator('button[type=submit]').click();
    await expect(app.notice()).toHaveText(/^Overlaid 3 pages: /, { timeout: 60_000 });
    const docs = await app.documents();
    const overlay = docs.find((d) => d.active)!;
    expect(overlay.name).toBe('Overlay - plan-rev1 over plan.pdf');
    expect(overlay.pageCount).toBe(3);
    for (const p of [1, 2, 3]) expect(await app.pageInfo(p)).toMatchObject({ width: PLAN.page.width, height: PLAN.page.height });
  });

  test.afterEach(async ({ app }) => {
    expect(app.errors).toEqual([]);
  });
});

// fixtures/stitch.pdf: a road drawn in world units and cut onto three sheets at match lines x 1000
// and x 2000, each sheet turned by its own angle about the middle of its slice (make-fixtures.mjs).
test.describe('stitched view', () => {
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
  const apply = (m: number[], [x, y]: [number, number]) => [m[0]! * x + m[2]! * y + m[4]!, m[1]! * x + m[3]! * y + m[5]!];
  const groups = (app: App) =>
    app.page.evaluate(() => (window.__nb.tools.store as unknown as { stitchGroups(): { placements: { pageIndex: number; toWorld: number[] }[] }[] }).stitchGroups());

  test.beforeEach(async ({ app }) => {
    await app.open('stitch.pdf');
  });

  test('view.stitched joins the sheets at their match lines', async ({ app }) => {
    // The sheets are matched up in the background after opening.
    await expect.poll(async () => (await groups(app)).length, { timeout: 60_000 }).toBe(1);
    const [group] = await groups(app);
    expect(group!.placements.map((p) => p.pageIndex).sort()).toEqual([0, 1, 2]);
    const toWorld = (i: number) => group!.placements.find((p) => p.pageIndex === i)!.toWorld;
    // Each match line, drawn on both sheets it joins, lands in the same place. So does every
    // point of the road, so the sheets' turns cancel: 0.2 + 0.45 rad between C-101 and C-102.
    for (const [a, b, x] of [[0, 1, 1000], [1, 2, 2000]] as const) {
      for (const y of [-200, 0, 200]) {
        const pa = apply(toWorld(a), onSheet(S.sheets[a]!, [x, y]));
        const pb = apply(toWorld(b), onSheet(S.sheets[b]!, [x, y]));
        expect(Math.hypot(pa[0]! - pb[0]!, pa[1]! - pb[1]!), `sheets ${a + 1}/${b + 1} at x ${x}, y ${y}`).toBeLessThan(2);
      }
    }
    // A stretch of road 100 units long on one sheet is 100 long in the stitched view (same scale).
    const p0 = apply(toWorld(0), onSheet(S.sheets[0]!, [400, 0]));
    const p1 = apply(toWorld(0), onSheet(S.sheets[0]!, [500, 0]));
    expect(Math.hypot(p1[0]! - p0[0]!, p1[1]! - p0[1]!)).toBeCloseTo(100, 0);

    expect((await app.command('view.stitched')).enabled).toBe(true);
    await app.cmd('view.stitched');
    expect((await app.view()).mode).toBe('stitch');
    expect((await app.command('view.stitched')).checked).toBe(true);
    await app.cmd('view.stitched');
    expect((await app.view()).mode).not.toBe('stitch');
    expect((await app.command('view.stitched')).checked).toBe(false);
  });

  test('view.stitched is off for sheets without match lines', async ({ app }) => {
    await app.open('plan.pdf');
    await app.page.waitForTimeout(1000);
    expect((await app.command('view.stitched')).enabled).toBe(false);
  });

  test.afterEach(async ({ app }) => {
    expect(app.errors).toEqual([]);
  });
});
