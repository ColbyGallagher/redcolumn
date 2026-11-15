import { expect, test, type App } from '../support/app.ts';
import { PLAN } from '../support/driver.ts';

// Takeoff › Manual Quantity: a quantity typed in, placed with one click, then edited in Properties.

const dialog = (app: App) => app.page.getByRole('dialog', { name: 'Manual Quantity' });
const spot = [PLAN.room.x + 40, PLAN.room.y + 40] as const;

async function arm(app: App, value: string) {
  await app.cmd('takeoff.manual');
  await expect(dialog(app)).toBeVisible();
  await dialog(app).getByLabel('Kind').selectOption('area');
  await dialog(app).getByLabel('Unit').selectOption('m');
  await dialog(app).getByLabel('Value').fill(value);
  await dialog(app).getByRole('button', { name: 'OK' }).click();
  await expect(dialog(app)).toBeHidden();
  expect((await app.toolState()).tool).toBe('manual');
}

test.describe('manual quantity', () => {
  test.beforeEach(async ({ app }) => {
    await app.open('plan.pdf');
    await app.calibrate();
  });

  test('takeoff.manual: place 24 m², see it listed, edit it to 30 in Properties', async ({ app }) => {
    await arm(app, '24');
    await app.clicks([spot]);

    // One manual markup, back on the Select tool with the new markup selected.
    const [m] = await app.markups();
    expect(m).toMatchObject({ type: 'manual', subject: 'Manual', measurement: '258.33 sf' });
    const state = await app.toolState();
    expect(state.tool).toBe('select');
    expect(state.selected).toEqual([m!.id]);
    const [raw] = await app.raw();
    expect(raw!.manual).toMatchObject({ kind: 'area', unit: 'm' });
    expect((raw!.manual as { value: number }).value).toBeCloseTo(24, 9);

    // The Markups list shows it in the page's units.
    await expect(app.page.locator('.markups')).toContainText('258.33 sf');

    // Properties edits the typed value.
    await app.page.getByRole('button', { name: 'Properties', exact: true }).click();
    const panel = app.page.locator('.props-panel');
    await expect(panel.getByLabel('Value')).toHaveValue('24');
    await panel.getByLabel('Value').fill('30');
    await panel.getByLabel('Value').blur();
    await expect.poll(async () => (await app.markups())[0]!.measurement).toBe('322.92 sf');
    await expect(app.page.locator('.markups')).toContainText('322.92 sf');
  });

  test('Esc cancels the placement', async ({ app }) => {
    await arm(app, '12');
    await app.page.keyboard.press('Escape');
    expect((await app.toolState()).tool).toBe('select');
    await app.clicks([spot]);
    expect(await app.markups()).toHaveLength(0);
  });
});
