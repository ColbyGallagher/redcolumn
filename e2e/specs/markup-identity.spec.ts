import { expect, test, type App } from '../support/app.ts';
import { PLAN, type Pt } from '../support/driver.ts';

// Subject, Label and Layer in the Markup Format tab: they edit the selection (one undo step per edit,
// "Mixed" where the markups differ) and the running drawing tool (the next markups take them and the
// command carries on), and a Tool Chest tool can be saved back with them.

const r = PLAN.room;
const roomAt = (dy: number): Pt[] => {
  const pts: Pt[] = [[r.x, r.y + dy], [r.x + r.w, r.y + dy], [r.x + r.w, r.y + r.h + dy], [r.x, r.y + r.h + dy]];
  return [...pts, pts[0]!];
};

const ribbon = (app: App) => app.page.locator('.ribbon');
type Row = { id: string; type: string; subject?: string; label?: string; text?: string; layer?: string };
const rows = (app: App) =>
  app.page.evaluate(() => (window.__nb.tools.store as unknown as { all(): Row[] }).all().map((m) => ({ id: m.id, type: m.type, subject: m.subject, label: m.label, text: m.text, layer: m.layer })));
const select = (app: App, ids: string[]) => app.page.evaluate((ids) => window.__nb.tools.select(ids), ids);

async function drawRooms(app: App, n: number) {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    await app.tool('area');
    await app.clicks(roomAt(i * 120));
    await app.tool('select');
    ids.push((await app.markups()).at(-1)!.id);
  }
  return ids;
}

async function commit(app: App, name: string, value: string) {
  const f = ribbon(app).getByRole(name === 'Subject' ? 'combobox' : 'textbox', { name, exact: true });
  await f.fill(value);
  await f.press('Enter');
}

test.describe('subject, label and layer in the Markup Format tab', () => {
  test.use({ toolbar: 'ribbon' });

  test.beforeEach(async ({ app }) => {
    await app.open('plan.pdf');
    await app.calibrate();
  });

  test('a selection changes subject and layer together, one undo step each, with mixed values shown', async ({ app }) => {
    const ids = await drawRooms(app, 3);
    await app.page.evaluate((id) => (window.__nb.tools.store as unknown as { update(id: string, p: object): void }).update(id, { subject: 'Other' }), ids[0]!);
    await select(app, ids);
    await expect(ribbon(app).getByRole('combobox', { name: 'Subject', exact: true })).toHaveAttribute('placeholder', 'Mixed');

    await commit(app, 'Subject', 'Downlight Type A');
    await expect.poll(async () => (await rows(app)).map((m) => m.subject)).toEqual(Array(3).fill('Downlight Type A'));

    await ribbon(app).getByRole('combobox', { name: 'Layer' }).selectOption({ label: 'New layer…' });
    await app.page.getByRole('dialog', { name: 'New Markup Layer' }).getByRole('textbox').fill('Electrical');
    await app.page.keyboard.press('Enter');
    await expect.poll(async () => (await rows(app)).map((m) => m.layer)).toEqual(Array(3).fill('Electrical'));

    // The layer is one undo step; the subject stays.
    await app.cmd('edit.undo');
    await expect.poll(async () => (await rows(app)).map((m) => m.layer)).toEqual(Array(3).fill(undefined));
    expect((await rows(app)).map((m) => m.subject)).toEqual(Array(3).fill('Downlight Type A'));
    await app.cmd('edit.undo');
    expect((await rows(app)).map((m) => m.subject)).toEqual(['Other', undefined, undefined]);
  });

  test('editing the subject mid-command changes the next markups and the tool keeps running', async ({ app }) => {
    await app.page.evaluate(() => {
      const tools = window.__nb.tools as unknown as { setTool(t: string, p: object): void };
      tools.setTool('area', { id: 'chest-area', subject: 'Original' });
    });
    await app.clicks(roomAt(0));
    await expect.poll(async () => (await rows(app)).map((m) => m.subject)).toEqual(['Original']);

    // Nothing is selected and a drawing tool runs: the tab is there with its fields.
    await ribbon(app).getByRole('tab', { name: 'Markup Format' }).click();
    await commit(app, 'Subject', 'Floor Finish');
    await commit(app, 'Label', 'Level 1');
    expect(await app.toolState()).toMatchObject({ tool: 'area' });
    await app.clicks(roomAt(120));
    await expect.poll(async () => (await rows(app)).map((m) => m.subject)).toEqual(['Original', 'Floor Finish']);
    expect((await rows(app)).at(-1)!.text).toBe('Level 1');
    expect(await app.toolState()).toMatchObject({ tool: 'area' });
  });

  test('a Tool Chest tool is saved back with its edited subject', async ({ app }) => {
    const [id] = await drawRooms(app, 1);
    await select(app, [id!]);
    const c = await app.at([r.x + r.w / 2, r.y + r.h / 2]);
    await app.page.mouse.click(c.x, c.y, { button: 'right' });
    await app.page.getByRole('menuitem', { name: 'Add to Tool Library' }).hover();
    await app.page.getByRole('menuitem', { name: 'New Tool Set…' }).click();
    await app.page.getByRole('dialog', { name: 'New Tool Set' }).getByRole('textbox').fill('Mine');
    await app.page.keyboard.press('Enter');
    await app.panel('Tool Library');
    await app.page.locator('.tool-item').first().click();

    await ribbon(app).getByRole('tab', { name: 'Markup Format' }).click();
    await commit(app, 'Subject', 'Saved Subject');
    await ribbon(app).getByRole('button', { name: 'Save to Tool Chest' }).click();
    await expect
      .poll(() => app.page.evaluate(() => (localStorage.getItem('nb.profiles') ?? '').includes('Saved Subject')))
      .toBe(true);
  });
});
