import { readFileSync } from 'node:fs';
import { expect, test, type App } from '../support/app.ts';

// fixtures/road-disciplines.pdf (scripts/make_road_disciplines.py): pages 1-2 are roadworks plan
// sheets joined at a match line, pages 3-4 the same windows as drainage plans, page 4 drawn
// out of register by SHIFT_MM. road-disciplines.json says where the match line is drawn.
const SET = JSON.parse(readFileSync(new URL('../fixtures/road-disciplines.json', import.meta.url), 'utf8')) as {
  pages: { page: number; shiftMm: [number, number]; matchLine: [[number, number], [number, number]] }[];
};
const PT = 72 / 25.4;

type Line = { id: string; pageIndex: number; p0: [number, number]; p1: [number, number]; matchTo: string | null };
const manual = (app: App) => app.page.evaluate(() => (window.__nb.tools.store as unknown as { manualStitch(): { lines: Line[]; regions: Record<number, unknown> } }).manualStitch());

test.describe('apply stitching to other sheets', () => {
  test.beforeEach(async ({ app }) => {
    await app.open('road-disciplines.pdf');
  });

  test('document.applyStitching copies the roadworks stitch onto the drainage sheets and snaps it', async ({ app }) => {
    expect((await app.command('document.applyStitching')).enabled).toBe(false);
    // The roadworks sheets' match line, as the user would trace it with + Match Line. On sheet 1
    // the drawing is left of the line (the line runs down the page), on sheet 2 right of it.
    const [a, b] = [SET.pages[0]!.matchLine, SET.pages[1]!.matchLine];
    await app.page.evaluate(
      ([a, b]) =>
        (window.__nb.tools.store as unknown as { setManualStitch(s: unknown): void }).setManualStitch({
          lines: [
            { id: 'ml-a', pageIndex: 0, p0: a[0], p1: a[1], contentSide: 1, name: 'CH 280', matchTo: 'ml-b' },
            { id: 'ml-b', pageIndex: 1, p0: b[0], p1: b[1], contentSide: -1, name: 'CH 280', matchTo: 'ml-a' },
          ],
          regions: { 0: [[30, 30], [1870, 30], [1870, 1650], [30, 1650]] },
        }),
      [a, b] as const,
    );
    await expect.poll(async () => (await app.command('document.applyStitching')).enabled).toBe(true);
    await app.cmd('document.applyStitching');
    const dialog = app.page.getByRole('dialog', { name: 'Apply Stitching to Other Sheets' });
    await expect(dialog).toBeVisible();
    // The sheets after the stitched ones are picked and paired in order.
    await expect(dialog.getByLabel('Target pages')).toHaveValue('3-4');
    await expect(dialog.getByRole('combobox', { name: /^Target for/ })).toHaveCount(2);
    await dialog.getByRole('button', { name: 'Apply' }).click();
    await expect(dialog.locator('.apply-stitching-results tbody tr')).toHaveCount(2, { timeout: 60_000 });
    await expect(dialog).toContainText('2 snapped to their drawn match lines');

    const s = await manual(app);
    const copies = s.lines.filter((l) => l.pageIndex >= 2).sort((x, y) => x.pageIndex - y.pageIndex);
    expect(copies.map((l) => l.pageIndex)).toEqual([2, 3]);
    expect(copies[0]!.matchTo).toBe(copies[1]!.id);
    expect(Object.keys(s.regions).sort()).toEqual(['0', '2']);
    // Page 3 lines up with page 1; page 4's copy moved onto its out-of-register line.
    const near = (p: [number, number], q: [number, number], tol: number) => Math.hypot(p[0] - q[0], p[1] - q[1]) < tol;
    expect(near(copies[0]!.p0, SET.pages[2]!.matchLine[0], 0.3)).toBe(true);
    expect(near(copies[1]!.p0, SET.pages[3]!.matchLine[0], 0.5)).toBe(true);
    expect(near(copies[1]!.p1, SET.pages[3]!.matchLine[1], 0.5)).toBe(true);
    // ...which is about SHIFT_MM away from where it was copied to.
    const [dx, dy] = SET.pages[3]!.shiftMm;
    expect(Math.hypot(copies[1]!.p0[0] - b[0][0], copies[1]!.p0[1] - b[0][1])).toBeCloseTo(Math.hypot(dx, dy) * PT, 0);

    // View opens the drainage sheets stitched.
    await dialog.getByRole('button', { name: 'View' }).last().click();
    await expect(dialog).toHaveCount(0);
    expect((await app.view()).mode).toBe('stitch');
    await app.cmd('view.stitched');

    // One undo takes the copies away again.
    await app.page.keyboard.press('Control+z');
    await expect.poll(async () => (await manual(app)).lines.length).toBe(2);
  });

  test.afterEach(async ({ app }) => {
    expect(app.errors).toEqual([]);
  });
});
