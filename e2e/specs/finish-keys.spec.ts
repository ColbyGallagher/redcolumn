import { expect, test } from '../support/app.ts';
import type { Pt } from '../support/driver.ts';

// A multi-point markup finishes with Enter, Space or a double-click, and optionally a right-click.
const POINTS: Pt[] = [[300, 450], [500, 450], [500, 550]];
const ROOM: Pt[] = [[300, 450], [500, 450], [500, 550], [300, 550]];
const SHAPES = [
  { tool: 'polylength', points: POINTS },
  { tool: 'area', points: ROOM },
] as const;
type Finisher = 'space' | 'enter' | 'dbl' | 'right';

async function drawAndFinish(app: any, points: readonly Pt[], how: Finisher) {
  if (how === 'dbl') return app.clicks(points, 'dbl');
  await app.clicks(points);
  expect(await app.markups()).toEqual([]);
  if (how === 'space') await app.page.keyboard.press(' ');
  else if (how === 'enter') await app.page.keyboard.press('Enter');
  else {
    const c = await app.at([600, 600]);
    await app.page.mouse.click(c.x, c.y, { button: 'right' });
  }
  await app.page.waitForTimeout(150);
}

test.describe('finishing multi-point markups', () => {
  test.beforeEach(async ({ app }) => {
    await app.open('plan.pdf');
    await app.calibrate();
  });

  for (const how of ['space', 'enter', 'dbl'] as const) {
    for (const shape of SHAPES) {
      test(`${how} finishes ${shape.tool} with ${shape.points.length} vertices and the tool stays armed`, async ({ app }) => {
        await app.tool(shape.tool);
        await drawAndFinish(app, shape.points, how);
        const markups = await app.markups();
        expect(markups).toHaveLength(1);
        expect(markups[0]!.points).toHaveLength(shape.points.length);
        expect((await app.toolState()).tool).toBe(shape.tool);
      });
    }
  }

  test('Space does not scroll the page', async ({ app }) => {
    await app.tool('polylength');
    await app.clicks(POINTS);
    const prevented = await app.page.evaluate(() => new Promise<boolean>((resolve) => {
      window.addEventListener('keydown', (e) => setTimeout(() => resolve(e.defaultPrevented)), { once: true });
      document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
    }));
    expect(prevented).toBe(true);
    expect(await app.markups()).toHaveLength(1);
  });

  test('a space typed in a text field finishes nothing and is not prevented', async ({ app }) => {
    await app.tool('polylength');
    await app.clicks(POINTS);
    const prevented = await app.page.evaluate(() => new Promise<boolean>((resolve) => {
      const input = document.createElement('input');
      document.body.appendChild(input);
      input.focus();
      window.addEventListener('keydown', (e) => setTimeout(() => resolve(e.defaultPrevented)), { once: true });
      input.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
    }));
    expect(prevented).toBe(false);
    expect(await app.markups()).toEqual([]);
    await app.page.keyboard.press('Escape');
  });

  test('right-click opens the context menu and does not finish by default', async ({ app }) => {
    await app.tool('polylength');
    await app.clicks(POINTS);
    const c = await app.at([600, 600]);
    await app.page.mouse.click(c.x, c.y, { button: 'right' });
    expect(await app.markups()).toEqual([]);
    await expect(app.page.getByRole('menu').or(app.page.locator('.context-menu, [role="menu"]')).first()).toBeVisible();
    await app.page.keyboard.press('Escape');
  });

  test.describe('with the preference on', () => {
    test.use({ settings: { unitSystem: 'imperial', lengthUnit: 'ft', areaUnit: 'ft', volumeUnit: 'ft', rightClickFinishes: true } });

    for (const shape of SHAPES) {
      test(`right-click finishes ${shape.tool} with ${shape.points.length} vertices`, async ({ app }) => {
        await app.tool(shape.tool);
        await drawAndFinish(app, shape.points, 'right');
        const markups = await app.markups();
        expect(markups).toHaveLength(1);
        expect(markups[0]!.points).toHaveLength(shape.points.length);
        expect((await app.toolState()).tool).toBe(shape.tool);
      });
    }
  });
});
