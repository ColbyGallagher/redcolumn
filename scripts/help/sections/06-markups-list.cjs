// Markups List: the list and its bar, filtering, grouping, columns, statuses, export and sync.
module.exports = async function (h) {
  const { page } = h;
  const P = h.plan;
  await h.open('sample-plans.pdf');
  await h.zoomTo(...P(5, 52), ...P(67, 4));
  // Scale, some markups and measurements, a couple of comments and statuses.
  const typed = page.locator('.pagenav-side.right input');
  await typed.fill(`1/4" = 1'-0"`);
  await typed.press('Enter');
  await page.evaluate(() => window.__nb.tools.store.all());
  const add = async (tool, pts, how) => {
    await h.tool(tool);
    if (how === 'drag') await h.drag(pts[0], pts[1]);
    else await h.clicks(pts, how);
  };
  await add('cloud', [P(41, 40), P(61, 26)], 'drag');
  await add('cloud', [P(10, 28), P(36, 14)], 'drag');
  await add('rect', [P(9.5, 47.5), P(21, 30.5)], 'drag');
  await add('area', [P(38.5, 47.5), P(63.5, 47.5), P(63.5, 12.5), P(38.5, 12.5), P(38.5, 47.5)]);
  await add('area', [P(8.5, 47.5), P(22, 47.5), P(22, 30.5), P(8.5, 30.5), P(8.5, 47.5)]);
  await add('length', [P(8.5, 21), P(37.5, 21)]);
  await add('count', [P(15, 43), P(30, 43), P(16, 25), P(30, 25)], 'enter');
  await page.evaluate(() => {
    const t = window.__nb.tools;
    const s = t.store;
    const all = s.all();
    const set = (i, patch) => all[i] && s.update(all[i].id, patch);
    set(0, { comment: 'Bench length changed to 3.6 m', status: 'accepted', subject: 'Revision' });
    set(1, { comment: 'Check floor finish', subject: 'Revision' });
    set(2, { comment: 'Wardrobe moved', status: 'completed', subject: 'Query' });
    set(3, { subject: 'Floor - Tiles' });
    set(4, { subject: 'Floor - Carpet' });
    t.setTool('select');
    t.select([]);
  });
  await page.keyboard.press('Escape');
  await h.wait(500);

  const bar = '.markups-bar';
  const dock = '.bottom-dock';
  // Make the list taller by dragging the splitter up.
  const dockBox = await page.locator(dock).boundingBox();
  await page.mouse.move(dockBox.x + 300, dockBox.y - 2);
  await page.mouse.down();
  await page.mouse.move(dockBox.x + 300, dockBox.y - 220, { steps: 6 });
  await page.mouse.up();
  await h.wait(400);

  await h.shot('list-overview', { around: [dock], pad: 0 });
  const b = (text) => page.locator(`${bar} button, ${bar} label`).filter({ hasText: text }).first();
  await h.mark([
    '.markups-search',
    { t: b('Hide All'), at: 'bl' },
    b('Filter'),
    { t: '.saved-filters', at: 'bl' },
    b('Filter Builder'),
    { t: b('On page'), at: 'bl' },
    b('Group'),
    { t: b('Columns'), at: 'bl' },
    b('Status ▾'),
    { t: b('Manage Columns'), at: 'bl' },
    b('Export'),
    { t: b('Sync'), at: 'bl' },
  ]);
  await h.shot('list-bar', { around: [bar], pad: 18 });

  // Search.
  await page.locator('.markups-search').fill('floor');
  await h.wait(300);
  await h.shot('list-search', { around: [dock], pad: 0 });
  await page.locator('.markups-search').fill('');

  // Filter row.
  await b('Filter').click();
  await h.wait(300);
  const subjectFilter = page.locator('.filter-row input').nth(1);
  await subjectFilter.fill('Revision').catch(() => {});
  await h.wait(300);
  await h.shot('list-filter-row', { around: [dock], pad: 0 });
  await page.locator(`${bar} button`, { hasText: /^Clear$/ }).click().catch(() => {});
  await b('Filter').click();

  // Filter builder.
  await b('Filter Builder').click();
  await h.wait(300);
  await page.locator('.modal button', { hasText: /Add|condition/i }).first().click().catch(() => {});
  await h.wait(200);
  await h.shot('filter-builder', { around: ['.modal'], pad: 20 });
  await h.closeModal();

  // Sort and header menu.
  const th = page.locator('.markups thead th').filter({ hasText: 'Subject' }).first();
  await th.click({ button: 'right' });
  await h.wait(300);
  await h.shot('list-header-menu', { around: ['[role=menu]', th], pad: 12 });
  await page.keyboard.press('Escape');

  // Group.
  await page.locator(`${bar} label.group-by`, { hasText: 'Group' }).locator('select').selectOption({ label: 'Subject' });
  await h.wait(400);
  await h.shot('list-grouped', { around: [dock], pad: 0 });
  await page.locator(`${bar} label.group-by`, { hasText: 'Group' }).locator('select').selectOption({ label: 'None' });

  // Columns and status menus.
  await b('Columns').click();
  await h.wait(300);
  await h.shot('list-columns-menu', { around: ['[role=menu]'], pad: 12 });
  await page.keyboard.press('Escape');
  await b('Status ▾').click();
  await h.wait(300);
  await h.shot('list-status-menu', { around: ['[role=menu]'], pad: 12 });
  await page.keyboard.press('Escape');

  // Status cell.
  const statusCell = page.locator('.markups .status-cell select').first();
  await h.mark(statusCell);
  await h.shot('list-status-cell', { around: [statusCell, page.locator('.markups thead th').filter({ hasText: 'Status' }).first()], pad: 60, minWidth: 420 });

  // Manage columns.
  await b('Manage Columns').click();
  await h.wait(400);
  await h.shot('columns-dialog', { around: ['.modal'], pad: 20 });
  const addCol = page.locator('.modal button', { hasText: /Add column/ }).first();
  await addCol.click().catch(() => {});
  await h.wait(300);
  await h.shot('columns-dialog-add', { around: ['.modal'], pad: 20 });
  await h.closeModal();
  await h.closeModal();

  // Export.
  await b('Export').click();
  await h.wait(400);
  await h.shot('export-dialog', { around: ['.modal'], pad: 20 });
  await h.closeModal();

  // Sync.
  await b('Sync').click();
  await h.wait(400);
  await h.shot('sheet-sync', { around: ['.modal'], pad: 20 });
  await h.closeModal();
};
module.exports.viewport = { width: 1440, height: 1000 };
