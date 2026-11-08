import { expect, test } from '../support/app.ts';

// Ctrl+drag while placing points curves the segment being placed. plan.pdf is calibrated at 100 pt = 10 ft.
test('a polylength curved with Ctrl+drag measures the arc, not the chord', async ({ app }) => {
  await app.open('plan.pdf');
  await app.calibrate();
  await app.tool('polylength');
  await app.clicks([[300, 450], [400, 450]]);
  // Press at the next corner with Ctrl held and drag away: the pointer is the middle of the arc, a half circle of radius 50 pt.
  const from = await app.at([500, 450]);
  const via = await app.at([450, 500]);
  await app.page.keyboard.down('Control');
  await app.page.mouse.move(from.x, from.y);
  await app.page.mouse.down();
  await app.page.mouse.move(via.x, via.y, { steps: 8 });
  await app.page.mouse.up();
  await app.page.keyboard.up('Control');
  await app.page.keyboard.press('Enter');
  await app.page.waitForTimeout(150);

  const markups = await app.markups();
  expect(markups).toHaveLength(1);
  // 10 ft straight + a half circle of radius 5 ft (15.708 ft).
  expect(markups[0]!.measurement).toMatch(/^25'-8/);
  const bulges = await app.page.evaluate(() => (window.__nb.tools.store as unknown as { all(): { bulges?: number[] }[] }).all()[0]!.bulges);
  expect(bulges).toHaveLength(2);
  expect(bulges![0]).toBe(0);
  expect(Math.abs(bulges![1]!)).toBeCloseTo(1, 6);
});
