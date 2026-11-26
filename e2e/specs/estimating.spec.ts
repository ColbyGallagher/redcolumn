import { expect, test, type App } from '../support/app.ts';
import { PLAN, type Pt } from '../support/driver.ts';

// Estimating: a catalog item, an assembly that prices from it with a variable and a Yes/No switch,
// per-takeoff inputs, the totals with waste and rounding, then a takeoff template that measures
// the next area the same way.

// The ribbon's commands, and its tabs, which sit in the menu bar's row.
const ribbon = (app: App) => app.page.locator('.ribbon, .rb-tabs');
const button = (app: App, id: string) => ribbon(app).locator(`[data-ribbon-command="${id}"]`);
const openTab = (app: App) => ribbon(app).getByRole('tab', { name: 'Takeoff' }).click();

const r = PLAN.room;
/** The 20 ft x 10 ft room: 200 sf. */
const room: Pt[] = [
  [r.x, r.y],
  [r.x + r.w, r.y],
  [r.x + r.w, r.y + r.h],
  [r.x, r.y + r.h],
  [r.x, r.y],
];
/** A 5 ft x 5 ft square well clear of the room: 25 sf. */
const square: Pt[] = [
  [r.x, r.y + r.h + 60],
  [r.x + 50, r.y + r.h + 60],
  [r.x + 50, r.y + r.h + 110],
  [r.x, r.y + r.h + 110],
  [r.x, r.y + r.h + 60],
];

test.describe('estimating', () => {
  test.use({ toolbar: 'ribbon' });

  test.beforeEach(async ({ app }) => {
    await app.open('plan.pdf');
    await app.calibrate();
  });

  test('an item, an assembly with inputs, the quantities, then a template', async ({ app }) => {
    const { page } = app;

    // takeoff.items: one catalog item, with its cost, waste and rounding.
    await openTab(app);
    for (const id of ['takeoff.items', 'takeoff.productLists', 'takeoff.templates', 'takeoff.saveTemplate']) await expect(button(app, id)).toBeVisible();
    await app.cmd('takeoff.items');
    const items = page.getByRole('dialog', { name: 'Items' });
    await items.getByRole('button', { name: '+ Item' }).click();
    const row = items.locator('tbody tr').first();
    await row.getByLabel('Item name').fill('Drywall sheet');
    await row.getByLabel('Item unit', { exact: true }).fill('sheets');
    await row.getByLabel('Item unit cost').fill('15');
    await row.getByLabel('Item waste percent').fill('10');
    await row.getByLabel('Item round up', { exact: true }).check();
    await items.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(items).toBeHidden();

    // An assembly that uses it: board layers (a variable) and both sides (a Yes/No switch).
    await app.cmd('tools.assemblies');
    const asm = page.getByRole('dialog', { name: 'Assemblies' });
    await asm.getByRole('button', { name: '+ New' }).click();
    await asm.getByRole('textbox', { name: 'Name', exact: true }).fill('Lined wall');
    await asm.getByRole('button', { name: '+ Variable' }).click();
    await asm.getByLabel('Variable name').nth(0).fill('Layers');
    await asm.getByLabel('Variable value').nth(0).fill('2');
    await asm.getByRole('button', { name: '+ Yes/No' }).click();
    await asm.getByLabel('Variable name').nth(1).fill('Both Sides');
    await expect(asm.getByLabel('Variable value').nth(1)).toHaveValue('1');
    await asm.getByLabel('Catalog item for New item').selectOption({ label: 'Drywall sheet' });
    // The Formula Builder: properties, functions and live checking.
    await asm.getByRole('button', { name: /^Formula Builder:/ }).click();
    const fb = page.getByRole('dialog', { name: 'Formula Builder' });
    await expect(fb.getByRole('group', { name: 'Yes/No switches' })).toContainText('[Both Sides]');
    await expect(fb.getByRole('list', { name: 'Functions' })).toContainText('CONVERT(value, "from", "to")');
    const box = fb.getByRole('textbox');
    await box.fill('[Area] * [Layers] * if([Both Sides], 2, 1) / [Nope]');
    await expect(fb.locator('.col-error')).toContainText('[Nope]');
    await box.fill('[Area] * [Layers] * if([Both Sides], 2, 1) / 32');
    await expect(fb.locator('.col-error')).toHaveCount(0);
    await fb.getByRole('button', { name: 'Done' }).click();
    await asm.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(asm).toBeHidden();

    // Draw the room, then apply the assembly: it asks for this takeoff's inputs.
    await app.tool('area');
    await app.clicks(room);
    const [area] = await app.markups();
    expect(area).toMatchObject({ type: 'area', measurement: '200.00 sf' });
    await page.keyboard.press('Escape');
    await page.evaluate((id) => window.__nb.tools.select([id]), area!.id);
    await app.panel('Measurements');
    // The Measurements panel's picker (the Markup properties group has one too).
    await page.getByRole('complementary').filter({ hasText: 'Measurement Properties' }).getByLabel('Assembly', { exact: true }).selectOption({ label: 'Lined wall' });
    const inputs = page.getByRole('dialog', { name: 'Assembly inputs' });
    await expect(inputs.getByLabel('Input Layers')).toHaveValue('2');
    await expect(inputs.getByLabel('Input Both Sides')).toHaveValue('1');
    await inputs.getByLabel('Input Layers').fill('3');
    await inputs.getByLabel('Input Both Sides').selectOption({ label: 'No' });
    await inputs.getByRole('button', { name: 'OK' }).click();
    await expect.poll(async () => (await app.raw())[0]!.assemblyInputs).toEqual({ Layers: 3, 'Both Sides': 0 });

    // 200 sf x 3 layers x 1 side / 32 = 18.75 sheets, +10% = 20.625: 21 sheets at 15.
    await app.cmd('tools.quantities');
    const totals = page.getByRole('dialog', { name: 'Takeoff quantities' });
    const sheets = totals.locator('tbody tr', { has: page.locator('td', { hasText: /^Drywall sheet/ }) });
    await expect(sheets.locator('td').nth(5)).toHaveText('21');
    await expect(sheets).toContainText('315.00');
    await totals.getByRole('button', { name: 'Close', exact: true }).click();

    // The inputs can be changed in the Measurements panel afterwards.
    await page.getByRole('group', { name: 'Assembly inputs' }).getByLabel('Input Both Sides').selectOption({ label: 'Yes' });
    await expect.poll(async () => (await app.raw())[0]!.assemblyInputs).toEqual({ Layers: 3 });

    // Right-click › Save as Template…
    await app.tool('select');
    const edge = await app.at([r.x + r.w / 2, r.y]);
    await page.mouse.click(edge.x, edge.y, { button: 'right' });
    await page.getByRole('menuitem', { name: 'Save as Template…' }).click();
    const ask = page.getByRole('dialog', { name: 'Save as Template' });
    await ask.getByRole('textbox').fill('Lined wall, 3 layers');
    await ask.getByRole('button', { name: 'Save' }).click();
    await expect(app.notice()).toContainText('Lined wall, 3 layers');

    // Takeoff › Templates arms the area tool with it; the next area gets the assembly and inputs.
    await openTab(app);
    await button(app, 'takeoff.templates').click();
    await page.getByRole('menuitem', { name: 'Lined wall, 3 layers' }).click();
    expect((await app.toolState()).tool).toBe('area');
    await app.clicks(square);
    const placed = (await app.raw()).filter((m) => m.type === 'area');
    expect(placed).toHaveLength(2);
    expect(placed[1]).toMatchObject({ assemblyId: placed[0]!.assemblyId, assemblyInputs: { Layers: 3 } });

    // 25 sf x 3 x 2 / 32 = 4.6875, +10% = 5.15625: 6 sheets; with the room's 200 x 3 x 2 / 32 x 1.1 = 41.25, 46.40625 in all: 47.
    await app.cmd('tools.quantities');
    await expect(sheets.locator('td').nth(5)).toHaveText('47');
    await totals.getByRole('button', { name: 'Close', exact: true }).click();

    // Rounding each measurement up first, as for offcuts that cannot be used elsewhere: 42 + 6 = 48.
    await app.cmd('takeoff.items');
    await row.getByLabel('Item round up each measurement').check();
    await items.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(items).toBeHidden();
    await app.cmd('tools.quantities');
    await expect(sheets.locator('td').nth(5)).toHaveText('48');
    await expect(sheets).toContainText('720.00');
    await totals.getByRole('button', { name: 'Close', exact: true }).click();

    // takeoff.templates: Manage Templates lists it.
    await app.cmd('takeoff.templates');
    const manage = page.getByRole('dialog', { name: 'Takeoff Templates' });
    await expect(manage.getByLabel('Template name')).toHaveValue('Lined wall, 3 layers');
    await manage.getByRole('button', { name: 'Cancel' }).click();
  });

  test('takeoff.productLists and takeoff.saveTemplate: a CSV price list sets an item’s cost', async ({ app }) => {
    const { page } = app;
    await app.cmd('takeoff.productLists');
    const lists = page.getByRole('dialog', { name: 'Product Lists' });
    await lists.getByLabel('Import CSV file').setInputFiles({ name: 'Supplier.csv', mimeType: 'text/csv', buffer: Buffer.from('Name,Unit Cost\nStud 2x4,4.25\nTrack,3.10\n') });
    await expect(lists.getByRole('table', { name: 'Records' }).locator('tbody tr')).toHaveCount(2);
    await lists.getByRole('button', { name: 'Save', exact: true }).click();

    await app.cmd('takeoff.items');
    const items = page.getByRole('dialog', { name: 'Items' });
    await items.getByRole('button', { name: '+ Item' }).click();
    const row = items.locator('tbody tr').first();
    await row.getByLabel('Item name').fill('Studs');
    await row.getByLabel('Item product list').selectOption({ label: 'Supplier' });
    await expect(row.getByLabel('Item product record')).toHaveValue(/./);
    await expect(row).toContainText('4.25 (list)');
    await items.getByRole('button', { name: 'Save', exact: true }).click();
    const raw = await page.evaluate(() => (window.__nb.tools as unknown as { store: { estimating(): { items: { name: string; listRef?: unknown }[] } } }).store.estimating().items);
    expect(raw[0]).toMatchObject({ name: 'Studs', listRef: { listId: expect.any(String), recordId: expect.any(String) } });

    // takeoff.saveTemplate needs one measurement selected.
    expect((await app.command('takeoff.saveTemplate')).enabled).toBe(false);
    await app.tool('length');
    await app.clicks([
      [300, 450],
      [500, 450],
    ]);
    await page.keyboard.press('Escape');
    const [run] = await app.markups();
    await page.evaluate((id) => window.__nb.tools.select([id]), run!.id);
    await app.cmd('takeoff.saveTemplate');
    const ask = page.getByRole('dialog', { name: 'Save as Template' });
    await ask.getByRole('button', { name: 'Save' }).click();
    const templates = await page.evaluate(() => (window.__nb.tools as unknown as { store: { estimating(): { templates: { tool: string }[] } } }).store.estimating().templates);
    expect(templates.map((t) => t.tool)).toEqual(['length']);
  });

  test('sort alphabetically and drag-and-drop reorder items, assemblies, assembly items, and product lists', async ({ app }) => {
    const { page } = app;

    // Seed items in unsorted order, sort A-Z, then drag to reorder manually, and verify persistence.
    await app.cmd('takeoff.items');
    const items = page.getByRole('dialog', { name: 'Items' });
    for (const name of ['Zinc flashing', 'Anchor bolt', 'Mortar']) {
      await items.getByRole('button', { name: '+ Item' }).click();
      await items.locator('tbody tr').last().getByLabel('Item name').fill(name);
    }
    await items.getByRole('button', { name: 'Sort items A–Z' }).click();
    await expect(items.locator('tbody tr').nth(0).getByLabel('Item name')).toHaveValue('Anchor bolt');
    await expect(items.locator('tbody tr').nth(1).getByLabel('Item name')).toHaveValue('Mortar');
    await expect(items.locator('tbody tr').nth(2).getByLabel('Item name')).toHaveValue('Zinc flashing');
    // Drag Zinc flashing to the top (before Anchor bolt).
    await items.getByRole('img', { name: 'Drag to reorder Zinc flashing' }).dragTo(items.locator('tbody tr').nth(0));
    await expect(items.locator('tbody tr').nth(0).getByLabel('Item name')).toHaveValue('Zinc flashing');
    await expect(items.locator('tbody tr').nth(1).getByLabel('Item name')).toHaveValue('Anchor bolt');
    await items.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(items).toBeHidden();

    const savedItems = await page.evaluate(() => (window.__nb.tools as unknown as { store: { estimating(): { items: { name: string }[] } } }).store.estimating().items.map((i) => i.name));
    expect(savedItems).toEqual(['Zinc flashing', 'Anchor bolt', 'Mortar']);

    // Assemblies and items within an assembly: sort A-Z / Z-A and drag-and-drop reorder.
    await app.cmd('tools.assemblies');
    const asm = page.getByRole('dialog', { name: 'Assemblies' });
    for (const name of ['Stud wall', 'Ceiling grid', 'Roof deck']) {
      await asm.getByRole('button', { name: '+ New' }).click();
      await asm.getByRole('textbox', { name: 'Name', exact: true }).fill(name);
    }
    await asm.getByRole('button', { name: 'Sort assemblies A–Z' }).click();
    const asmRows = asm.getByRole('list', { name: 'Assemblies in this document' }).locator('li');
    await expect(asmRows.nth(0)).toContainText('Ceiling grid');
    await expect(asmRows.nth(1)).toContainText('Roof deck');
    await expect(asmRows.nth(2)).toContainText('Stud wall');
    // Drag Stud wall before Ceiling grid.
    await asmRows.nth(2).dragTo(asmRows.nth(0));
    await expect(asmRows.nth(0)).toContainText('Stud wall');
    await expect(asmRows.nth(1)).toContainText('Ceiling grid');

    // Add items inside the selected assembly (Roof deck), sort A-Z, then drag-and-drop reorder.
    await asm.locator('.asm-items tbody tr').nth(0).getByLabel('Item name').fill('Tape');
    await asm.getByRole('button', { name: '+ Item' }).click();
    await asm.locator('.asm-items tbody tr').nth(1).getByLabel('Item name').fill('Board');
    await asm.getByRole('button', { name: '+ Item' }).click();
    await asm.locator('.asm-items tbody tr').nth(2).getByLabel('Item name').fill('Screws');
    await asm.getByRole('button', { name: 'Sort assembly items A–Z' }).click();
    await expect(asm.locator('.asm-items tbody tr').nth(0).getByLabel('Item name')).toHaveValue('Board');
    await expect(asm.locator('.asm-items tbody tr').nth(1).getByLabel('Item name')).toHaveValue('Screws');
    await expect(asm.locator('.asm-items tbody tr').nth(2).getByLabel('Item name')).toHaveValue('Tape');
    await asm.getByRole('img', { name: 'Drag to reorder Tape' }).dragTo(asm.locator('.asm-items tbody tr').nth(0));
    await expect(asm.locator('.asm-items tbody tr').nth(0).getByLabel('Item name')).toHaveValue('Tape');
    await asm.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(asm).toBeHidden();

    const savedAssemblies = await page.evaluate(() =>
      (window.__nb.tools as unknown as { store: { assemblies(): { name: string; items: { name: string }[] }[] } }).store
        .assemblies()
        .map((a) => ({ name: a.name, items: a.items.map((i) => i.name) })),
    );
    expect(savedAssemblies.map((a) => a.name)).toEqual(['Stud wall', 'Ceiling grid', 'Roof deck']);
    expect(savedAssemblies.find((a) => a.name === 'Roof deck')?.items).toEqual(['Tape', 'Board', 'Screws']);

    // Product lists and records within a list: sort A-Z and drag-and-drop.
    await app.cmd('takeoff.productLists');
    const lists = page.getByRole('dialog', { name: 'Product Lists' });
    await lists.getByLabel('Import CSV file').setInputFiles({ name: 'Plumbing.csv', mimeType: 'text/csv', buffer: Buffer.from('Name,Unit Cost\nValve,12\nElbow,3\nPipe,8\n') });
    await lists.getByLabel('Import CSV file').setInputFiles({ name: 'Electrical.csv', mimeType: 'text/csv', buffer: Buffer.from('Name,Unit Cost\nWire,5\n') });
    await lists.getByRole('button', { name: 'Sort product lists A–Z' }).click();
    const listRows = lists.getByRole('list', { name: 'Product lists in this document' }).locator('li');
    await expect(listRows.nth(0)).toContainText('Electrical');
    await expect(listRows.nth(1)).toContainText('Plumbing');
    await listRows.nth(1).click();
    await lists.getByRole('button', { name: 'Sort records A–Z' }).click();
    const recRows = lists.getByRole('table', { name: 'Records' }).locator('tbody tr');
    await expect(recRows.nth(0).getByLabel('Name')).toHaveValue('Elbow');
    await expect(recRows.nth(1).getByLabel('Name')).toHaveValue('Pipe');
    await expect(recRows.nth(2).getByLabel('Name')).toHaveValue('Valve');
    await lists.getByRole('img', { name: 'Drag to reorder Valve' }).dragTo(recRows.nth(0));
    await expect(recRows.nth(0).getByLabel('Name')).toHaveValue('Valve');
    await lists.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(lists).toBeHidden();
  });

  test.afterEach(async ({ app }) => {
    expect(app.errors).toEqual([]);
  });
});
