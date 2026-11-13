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

// Arc (3-point): arm it, click a point on the curve, then the arc end; the next segment is straight again.
test('a polylength traced with a 3-point arc measures the arc', async ({ app }) => {
  await app.open('plan.pdf');
  await app.calibrate();
  await app.tool('polylength');
  await app.clicks([[300, 450], [400, 450]]);
  const arcCommand = () => app.page.evaluate(() => {
    const c = window.__nb.commands().get('draw.arc')!;
    return { enabled: c.enabled, checked: !!c.checked };
  });
  expect(await arcCommand()).toEqual({ enabled: true, checked: false });
  await app.page.keyboard.press('Shift+B');
  await expect(app.page.getByTestId('arc-hint')).toContainText('point on the curve');
  await expect.poll(arcCommand).toEqual({ enabled: true, checked: true });
  // Through (450, 500) to (500, 450): a half circle of radius 50 pt (5 ft), then a straight 10 ft.
  await app.clicks([[450, 500]]);
  await expect(app.page.getByTestId('arc-hint')).toContainText('arc end');
  await app.clicks([[500, 450]]);
  await expect(app.page.getByTestId('arc-hint')).toHaveCount(0);
  await app.clicks([[600, 450]]);
  await app.page.keyboard.press('Enter');
  await app.page.waitForTimeout(150);

  const markups = await app.markups();
  expect(markups).toHaveLength(1);
  // 10 ft + π × 5 ft (15.708 ft) + 10 ft = 35.708 ft.
  expect(markups[0]!.measurement).toMatch(/^35'-8/);
  const m = await app.page.evaluate(() => (window.__nb.tools.store as unknown as { all(): { points: number[][]; bulges?: number[] }[] }).all()[0]!);
  expect(m.points).toHaveLength(4);
  expect(m.bulges).toHaveLength(3);
  expect(m.bulges![0]).toBe(0);
  expect(Math.abs(m.bulges![1]!)).toBeCloseTo(1, 6);
  expect(m.bulges![2]).toBe(0);
});
