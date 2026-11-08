import { expect, test } from '../support/app.ts';

// plan.pdf is calibrated at 100 pt = 10 ft, so 200 x 100 pt is 20 ft x 10 ft = 200 sf.
test.describe('drag a rectangle with the area tool', () => {
  test.beforeEach(async ({ app }) => {
    await app.open('plan.pdf');
    await app.calibrate();
  });

  test('press, drag and release measures a rectangle in one motion and keeps the tool', async ({ app }) => {
    await app.tool('area');
    await app.drag([300, 450], [500, 550]);
    const markups = await app.markups();
    expect(markups).toHaveLength(1);
    expect(markups[0]).toMatchObject({ type: 'area', measurement: '200.00 sf' });
    expect(markups[0]!.points).toHaveLength(4);
    expect((await app.toolState()).tool).toBe('area');
  });

  test('clicking point by point still works', async ({ app }) => {
    await app.tool('area');
    await app.clicks([[300, 450], [500, 450], [500, 550], [300, 550]], 'enter');
    const markups = await app.markups();
    expect(markups).toHaveLength(1);
    expect(markups[0]).toMatchObject({ type: 'area', measurement: '200.00 sf' });
  });
});
