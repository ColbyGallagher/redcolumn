import { expect, test } from '../support/app.ts';
import type { Pt } from '../support/driver.ts';

// A multi-point markup finishes with Enter, Space or a double-click, and optionally a right-click.
const POINTS: Pt[] = [[300, 450], [500, 450], [500, 550]];

test.describe('finishing multi-point markups', () => {
  test.beforeEach(async ({ app }) => {
    await app.open('plan.pdf');
    await app.calibrate();
    await app.tool('polylength');
  });

  test('Space finishes and the tool stays armed', async ({ app }) => {
    await app.clicks(POINTS);
    expect(await app.markups()).toEqual([]);
    await app.page.keyboard.press(' ');
    const markups = await app.markups();
    expect(markups).toHaveLength(1);
    expect(markups[0]!.points).toHaveLength(3);
    expect((await app.toolState()).tool).toBe('polylength');
  });

  test('double-click finishes without a duplicate vertex', async ({ app }) => {
    await app.clicks(POINTS, 'dbl');
    const markups = await app.markups();
    expect(markups).toHaveLength(1);
    expect(markups[0]!.points).toHaveLength(3);
  });

  test('right-click leaves the markup in progress by default', async ({ app }) => {
    await app.clicks(POINTS);
    const c = await app.at([600, 600]);
    await app.page.mouse.click(c.x, c.y, { button: 'right' });
    expect(await app.markups()).toEqual([]);
    await app.page.keyboard.press('Escape');
  });

  test.describe('with the preference on', () => {
    test.use({ settings: { unitSystem: 'imperial', lengthUnit: 'ft', areaUnit: 'ft', volumeUnit: 'ft', rightClickFinishes: true } });

    test('right-click finishes it', async ({ app }) => {
      await app.clicks(POINTS);
      const c = await app.at([600, 600]);
      await app.page.mouse.click(c.x, c.y, { button: 'right' });
      expect(await app.markups()).toHaveLength(1);
      expect((await app.toolState()).tool).toBe('polylength');
    });
  });
});
