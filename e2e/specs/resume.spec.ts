import { expect, test } from '../support/app.ts';
import { PLAN, type Pt } from '../support/driver.ts';

// Resume: right-click a finished count or open line and carry on in the same markup (calibrated
// at 100 pt = 10 ft, so 10 pt is 1 ft).
test.describe('resume a measurement', () => {
  test.beforeEach(async ({ app }) => {
    await app.open('plan.pdf');
    await app.calibrate();
  });

  async function resumeAt(app: Parameters<Parameters<typeof test>[2]>[0]['app'], at: Pt) {
    const c = await app.at(at);
    await app.page.mouse.click(c.x, c.y, { button: 'right' });
    await app.page.getByText('Resume', { exact: true }).click();
  }

  test('a count of 5 carries on to 8 in one markup', async ({ app }) => {
    await app.tool('count');
    await app.clicks(PLAN.symbols, 'enter');
    expect((await app.markups())[0]).toMatchObject({ type: 'count', measurement: '5 ea' });
    await app.tool('select');
    await resumeAt(app, PLAN.symbols[0]!);
    await app.clicks(
      [
        [300, 600],
        [330, 600],
        [360, 600],
      ],
      'enter',
    );
    const markups = await app.markups();
    expect(markups).toHaveLength(1);
    expect(markups[0]).toMatchObject({ type: 'count', measurement: '8 ea' });
    expect(markups[0]!.points).toHaveLength(8);
    // Each resumed point is its own undo step.
    await app.cmd('edit.undo');
    expect((await app.markups())[0]).toMatchObject({ measurement: '7 ea' });
  });

  test('a 20 ft polylength resumed from its end gains 5 ft in one markup', async ({ app }) => {
    await app.tool('polylength');
    await app.clicks(
      [
        [300, 450],
        [500, 450],
      ],
      'enter',
    );
    expect((await app.markups())[0]).toMatchObject({ measurement: `20'-0"` });
    await app.tool('select');
    await resumeAt(app, [500, 450]);
    await app.clicks([[550, 450]], 'enter');
    const markups = await app.markups();
    expect(markups).toHaveLength(1);
    expect(markups[0]).toMatchObject({ type: 'polylength', measurement: `25'-0"` });
    expect(markups[0]!.points).toHaveLength(3);
  });

  test('resumed from its start, a polylength grows at that end', async ({ app }) => {
    await app.tool('polylength');
    await app.clicks(
      [
        [300, 450],
        [500, 450],
      ],
      'enter',
    );
    await app.tool('select');
    await resumeAt(app, [300, 450]);
    await app.clicks([[250, 450]], 'enter');
    const markups = await app.markups();
    expect(markups).toHaveLength(1);
    expect(markups[0]).toMatchObject({ measurement: `25'-0"` });
    expect(markups[0]!.points).toHaveLength(3);
  });
});
