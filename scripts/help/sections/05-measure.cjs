// Measurement & Takeoff: scales, calibration, each measure tool, Smart Fill, Symbol Search,
// the Measurements panel and Spaces.
module.exports = async function (h) {
  const { page } = h;
  const P = h.plan;
  await h.open('sample-plans.pdf');
  await h.zoomTo(...P(5, 52), ...P(67, 4));
  const view = await page.evaluate(() => window.__nb.viewer.getView());
  const home = async () => {
    await page.evaluate((v) => {
      window.__nb.tools.setTool('select');
      window.__nb.tools.select([]);
      window.__nb.viewer.setView(v);
    }, view);
    await h.wait(300);
  };
  const clear = () => page.evaluate(() => window.__nb.tools.store.remove(window.__nb.tools.store.all().map((m) => m.id)));
  const area = async (a, b, pad = 50) => {
    const p = await h.at(...a);
    const q = await h.at(...b);
    const stage = await page.locator('main.stage').boundingBox();
    const x0 = Math.max(stage.x, Math.min(p.x, q.x) - pad);
    const y0 = Math.max(stage.y, Math.min(p.y, q.y) - pad);
    const x1 = Math.min(stage.x + stage.width, Math.max(p.x, q.x) + pad);
    const y1 = Math.min(stage.y + stage.height, Math.max(p.y, q.y) + pad);
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  };
  const pick = async (label, name) => {
    await h.menu('Tools', 'Measure');
    await h.mark(h.item(label), { numbers: false });
    await h.shot(name, { around: ['.menu-drop', '.menu-flyout'], pad: 12 });
    await h.closeMenus();
  };

  // No scale yet.
  const right = '.pagenav-side.right';
  await h.mark([`${right} select`, `${right} input`, page.locator(`${right} button`, { hasText: 'All pages' })]);
  await h.shot('scale-nav', { around: [right], pad: 26 });
  await h.menu('Tools', 'Measure');
  await h.shot('menu-measure', { around: ['.menu-drop', '.menu-flyout'], pad: 12 });
  await h.closeMenus();

  // Calibrate between grid lines 1 and 2 (30 feet apart), on the dimension line.
  await pick('Calibrate', 'pick-calibrate');
  await h.tool('calibrate');
  await h.clicks([P(8, 7), P(38, 7)]);
  await h.wait(500);
  await page.locator('.modal input').first().fill('30');
  await h.shot('calibrate-dialog-filled', { around: ['.modal'], pad: 20 });
  await page.locator('.modal button[type=submit], .modal .btn.primary').first().click();
  await h.wait(500);
  await home();

  // Typed scale.
  const typed = page.locator(`${right} input`);
  await typed.fill(`1/4" = 1'-0"`);
  await h.mark(typed);
  await h.shot('scale-typed', { around: [right], pad: 26 });
  await typed.press('Enter');
  await h.wait(400);
  await h.mark(`${right} select`);
  await h.shot('scale-set', { around: [right], pad: 26 });

  // Each tool.
  const tools = [
    ['Length', 'length', async () => h.clicks([P(8.5, 21), P(37.5, 21)])],
    ['Polylength', 'polylength', async () => h.clicks([P(12, 15), P(24, 15), P(24, 26), P(34, 26)], 'enter')],
    ['Area', 'area', async () => h.clicks([P(38.5, 47.5), P(63.5, 47.5), P(63.5, 12.5), P(38.5, 12.5), P(38.5, 47.5)])],
    ['Perimeter', 'perimeter', async () => h.clicks([P(8.5, 47.5), P(22, 47.5), P(22, 30.5), P(8.5, 30.5), P(8.5, 47.5)], 'enter')],
    ['Count', 'count', async () => h.clicks([P(15, 43), P(30, 43), P(16, 25), P(30, 25), P(48, 42), P(58, 42), P(48, 34), P(58, 34)], 'enter')],
    ['Angle', 'angle', async () => h.clicks([P(48, 20), P(40, 14), P(56, 14)])],
    ['Diameter', 'diameter', async () => h.clicks([P(44, 30), P(54, 30)])],
    ['Radius', 'radius', async () => h.clicks([P(50, 30), P(56, 30)])],
    ['Arc Length', 'arcLength', async () => h.clicks([P(42, 20), P(50, 26), P(58, 20)])],
    ['Volume', 'volume', async () => h.clicks([P(38.5, 47.5), P(63.5, 47.5), P(63.5, 12.5), P(38.5, 12.5), P(38.5, 47.5)])],
  ];
  for (const [label, tool, draw] of tools) {
    await pick(label, `pick-${tool}`);
    await h.tool(tool);
    await draw();
    await h.wait(300);
    await home();
    await h.shot(`measure-${tool}`, { around: [await area(P(6, 50), P(66, 10), 10)], pad: 0 });
    if (tool === 'volume' || tool === 'area') {
      const c = await h.at(...P(38.5, 30));
      await page.mouse.click(c.x, c.y);
      await h.panel('Properties');
      await h.shot(`properties-${tool}`, { around: ['.panel.left'], pad: 0 });
      if (tool === 'area') {
        const cut = page.locator('.panel.left button[title^="Draw a polygon inside the area"]');
        await h.mark(cut);
        await h.shot('cutout-button', { around: [cut], pad: 80, minWidth: 260 });
        await cut.click();
        await h.clicks([P(52, 30), P(63, 30), P(63, 12.5), P(52, 12.5), P(52, 30)]);
        await home();
        await h.shot('measure-cutout', { around: [await area(P(36, 50), P(66, 10), 10)], pad: 0 });
      }
    }
    if (tool === 'count') {
      await h.panel('Measurements');
      await h.shot('measurements-panel', { around: ['.panel.left'], pad: 0 });
    }
    await clear();
  }

  // Smart Fill.
  await pick('Smart Fill', 'pick-dynamicFill');
  await h.tool('dynamicFill');
  await h.mark(page.locator('.toolbar.tools label.field', { hasText: 'Fill as' }));
  await h.shot('smart-fill-toolbar', { around: [page.locator('.toolbar.tools label.field', { hasText: 'Fill as' })], pad: 40, minWidth: 300 });
  await h.clickAt(...P(15, 38));
  await h.wait(1500);
  await h.clickAt(...P(50, 30));
  await h.wait(1500);
  await home();
  await h.shot('smart-fill-result', { around: [await area(P(6, 50), P(66, 10), 10)], pad: 0 });
  await clear();

  // Symbol Search: box one light fitting.
  await pick('Symbol Search', 'pick-visualSearch');
  await h.tool('visualSearch');
  await h.drag(P(14.3, 43.7), P(15.7, 42.3));
  await h.wait(3000);
  await h.shot('symbol-search-panel', { around: ['.visual-search'], pad: 16 });
  await page.locator('button[title="One count per page, a point on each copy"]').click().catch(() => {});
  await h.wait(500);
  await home();
  await h.shot('symbol-search-counted', { around: [await area(P(6, 50), P(66, 10), 10)], pad: 0 });
  await clear();

  // Viewports.
  await h.panel('Measurements');
  await h.mark(page.locator('.panel.left .viewports-head button').first());
  await h.shot('viewports-add', { around: ['.panel.left .scale-settings', '.panel.left .viewports'], pad: 20 });

  // Spaces.
  await h.panel('Spaces');
  await h.mark(page.locator('.panel.left button', { hasText: /Add|New/ }).first());
  await h.shot('spaces-add', { around: ['.spaces-panel .panel-toolbar', '.spaces-panel .empty'], pad: 16 });
  await h.tool('space');
  await h.clicks([P(38.5, 47.5), P(63.5, 47.5), P(63.5, 12.5), P(38.5, 12.5), P(38.5, 47.5)]);
  await h.wait(500);
  if (await page.locator('.modal input').count()) {
    await page.locator('.modal input').first().fill('Kitchen');
    await page.keyboard.press('Enter');
  } else {
    await page.keyboard.type('Kitchen');
    await page.keyboard.press('Enter');
  }
  await h.wait(400);
  await home();
  await h.panel('Spaces');
  await h.shot('spaces-panel', { around: ['.spaces-panel .panel-toolbar', '.spaces-panel li'], pad: 16 });
  await h.shot('space-drawn', { around: [await area(P(36, 50), P(66, 10), 10)], pad: 0 });

  // Bulk apply page scale.
  await h.run('Document', 'Bulk Apply Page Scale…');
  await h.wait(600);
  await h.shot('scale-regions', { around: ['.label-regions'], pad: 16 });
};
