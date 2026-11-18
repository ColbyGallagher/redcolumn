import { expect, test, type App } from '../support/app.ts';
import { PLAN } from '../support/driver.ts';

// Takeoff › Define Portal (Experimental): outline an area that is the same on several pages, link
// the pages, and markups drawn inside it on one page are mirrored to the others and kept in step.

const room = PLAN.room;
const margin = 20;
const outline = [
  [room.x - margin, room.y - margin],
  [room.x + room.w + margin, room.y - margin],
  [room.x + room.w + margin, room.y + room.h + margin],
  [room.x - margin, room.y + room.h + margin],
] as const;

type Raw = { id: string; pageIndex: number; points: [number, number][]; portalLink?: { portalId: string; linkId: string }; comment?: string };
const raw = async (app: App) => (await app.raw()) as unknown as Raw[];

async function definePortal(app: App) {
  await app.cmd('takeoff.definePortal');
  expect((await app.toolState()).tool).toBe('portalPolygon');
  await app.clicks(outline, 'enter');
  const dialog = app.page.getByRole('dialog', { name: 'Define Portal' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Name').fill('Typical floor');
  // Page 1 (where it was outlined) is ticked already; link pages 2 and 3.
  const boxes = dialog.getByRole('checkbox');
  await expect(boxes).toHaveCount(PLAN.pageCount);
  await expect(boxes.nth(0)).toBeChecked();
  await boxes.nth(1).check();
  await boxes.nth(2).check();
  await dialog.getByRole('button', { name: 'Create Portal' }).click();
  await expect(dialog).toBeHidden();
  expect((await app.toolState()).tool).toBe('select');
  return app.page.evaluate(() => JSON.parse(JSON.stringify(window.__nb.tools.store.portals())) as { name: string; pages: number[]; points: [number, number][] }[]);
}

test.describe('portals', () => {
  test.beforeEach(async ({ app }) => {
    await app.open('plan.pdf');
  });

  test('takeoff.definePortal: a rectangle drawn inside the portal appears on every linked page', async ({ app }) => {
    const portals = await definePortal(app);
    expect(portals).toHaveLength(1);
    expect(portals[0]).toMatchObject({ name: 'Typical floor', pages: [0, 1, 2] });

    await app.tool('rect');
    await app.drag([room.x + 20, room.y + 20], [room.x + 60, room.y + 50]);
    const all = await raw(app);
    expect(all.map((m) => m.pageIndex).sort()).toEqual([0, 1, 2]);
    expect(new Set(all.map((m) => m.portalLink?.linkId)).size).toBe(1);
    expect(all.every((m) => !!m.portalLink)).toBe(true);
    // Same page coordinates on each page.
    expect(new Set(all.map((m) => JSON.stringify(m.points))).size).toBe(1);

    // An edit to one copy reaches the others; one undo takes it back on every page.
    const copy = all.find((m) => m.pageIndex === 2)!;
    await app.page.evaluate(() => window.__nb.tools.store.checkpoint());
    await app.page.evaluate((id) => window.__nb.tools.store.update(id, { comment: 'Typical unit' }), copy.id);
    await expect.poll(async () => (await raw(app)).filter((m) => m.comment === 'Typical unit').length).toBe(3);
    await app.page.evaluate(() => window.__nb.tools.store.checkpoint());
    await app.cmd('edit.undo');
    await expect.poll(async () => (await raw(app)).filter((m) => m.comment === 'Typical unit').length).toBe(0);
    expect(await raw(app)).toHaveLength(3);

    // One crossing the portal's edge stays on its own page.
    await app.tool('rect');
    await app.drag([room.x + room.w, room.y + 20], [room.x + room.w + 60, room.y + 50]);
    await expect.poll(async () => (await raw(app)).length).toBe(4);
  });

  test('takeoff.breakPortalLink: the selected copy becomes a local markup', async ({ app }) => {
    await definePortal(app);
    await app.tool('rect');
    await app.drag([room.x + 20, room.y + 20], [room.x + 60, room.y + 50]);
    const first = (await raw(app)).find((m) => m.pageIndex === 0)!;
    expect((await app.command('takeoff.breakPortalLink')).enabled).toBe(false);
    await app.page.evaluate((id) => window.__nb.tools.select([id]), first.id);
    await app.cmd('takeoff.breakPortalLink');
    const after = await raw(app);
    expect(after.find((m) => m.id === first.id)!.portalLink).toBeUndefined();
    expect(after.filter((m) => m.portalLink).length).toBe(2);
    // Deleting the local one leaves the mirrored copies.
    await app.page.evaluate((id) => window.__nb.tools.store.remove([id]), first.id);
    await expect.poll(async () => (await raw(app)).length).toBe(2);
  });

  test('takeoff.portals: lists the portal, warns on a differing scale, and removes it', async ({ app }) => {
    await definePortal(app);
    // Only page 1 is calibrated: pages 2 and 3 differ.
    await app.page.evaluate(() => window.__nb.tools.store.setScale([0], { metersPerPoint: 0.01, unit: 'm', label: '1:100' } as never));
    await app.cmd('takeoff.portals');
    const dialog = app.page.getByRole('dialog', { name: 'Portals' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('Name')).toHaveValue('Typical floor');
    await expect(dialog.getByRole('alert')).toContainText('different scale');
    await dialog.getByRole('button', { name: 'Remove Portal' }).click();
    await expect(dialog).toBeHidden();
    expect(await app.page.evaluate(() => window.__nb.tools.store.portals().length)).toBe(0);
  });
});
