// Tool Library: the panel, saving a markup as a tool, tool and tool set menus.
module.exports = async function (h) {
  const { page } = h;
  const P = h.plan;
  await h.open('sample-plans.pdf');
  await h.zoomTo(...P(5, 52), ...P(67, 4));
  await h.panel('Tool Library');
  await h.shot('tool-library', { around: ['.panel.left'], pad: 0 });

  // A cloud to save as a tool.
  await h.tool('cloud');
  await h.drag(P(41, 40), P(61, 26));
  await page.evaluate(() => {
    const s = window.__nb.tools.store;
    const m = s.all()[0];
    s.update(m.id, { subject: 'Demolish', style: { ...m.style, stroke: '#ea580c', width: 2 } });
    window.__nb.tools.setTool('select');
    window.__nb.tools.select([m.id]);
  });
  await h.wait(300);
  // The list row has the same menu as the markup on the page.
  await page.locator('.markups tbody tr').first().click({ button: 'right' });
  await page.locator('[role=menu] [role=menuitem]').filter({ hasText: /Add to Tool Library/ }).first().hover();
  await h.wait(300);
  await h.shot('add-to-tool-library', { around: ['[role=menu]'], pad: 12 });
  await page.locator('[role=menu] [role=menuitem]').filter({ hasText: /^\W*My Tools/ }).first().click();
  await h.wait(500);
  await h.shot('tool-library-saved', { around: ['.panel.left'], pad: 0 });

  // Right-click the saved tool.
  const tool = page.locator('.panel.left [draggable=true]').filter({ hasText: /Demolish/ }).first();
  const anyTool = (await tool.count()) ? tool : page.locator('.panel.left [draggable=true]').first();
  await anyTool.click({ button: 'right' });
  await h.wait(300);
  await h.shot('tool-menu', { around: ['[role=menu]', anyTool], pad: 12 });
  await page.keyboard.press('Escape');

  // Tool set options.
  const opts = page.locator('.panel.left button[title="Tool set options"]').nth(1);
  await opts.click().catch(() => {});
  await h.wait(300);
  await h.shot('tool-set-menu', { around: ['[role=menu]', opts], pad: 12 });
  await page.keyboard.press('Escape');

  // New set and import buttons.
  await h.mark([page.locator('.panel.left button[title="Create a new tool set"]'), page.locator('.panel.left [title^="Import tool sets"]')]);
  await h.shot('tool-library-buttons', { around: [page.locator('.panel.left button[title="Create a new tool set"]'), page.locator('.panel.left [title^="Import tool sets"]')], pad: 40, minWidth: 260 });

  // Preferences: clicking a saved tool.
  await page.keyboard.press('Control+k');
  await h.wait(400);
  await page.locator('.modal [role=tab]', { hasText: 'Tool Library' }).click();
  await h.wait(300);
  await h.shot('prefs-tool-library', { around: ['.modal'], pad: 20 });
  await h.closeModal();
};
