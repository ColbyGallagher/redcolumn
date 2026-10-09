// Editing Markups: selecting, handles, style, Properties, right-click menu and the editing tools.
module.exports = async function (h) {
  const { page } = h;
  const P = h.plan;
  await h.open('sample-plans.pdf');
  await h.zoomTo(...P(5, 52), ...P(67, 9));
  const tools = () => page.evaluate(() => window.__nb.tools);
  const selectAt = async (x, y, shift = false) => {
    const c = await h.at(...P(x, y));
    if (shift) await page.keyboard.down('Shift');
    await page.mouse.click(c.x, c.y);
    if (shift) await page.keyboard.up('Shift');
    await h.wait(250);
  };
  const stage = 'main.stage';
  const areaAround = async (a, b, pad = 50) => {
    const p = await h.at(...a);
    const q = await h.at(...b);
    return { x: Math.min(p.x, q.x) - pad, y: Math.min(p.y, q.y) - pad, width: Math.abs(q.x - p.x) + 2 * pad, height: Math.abs(q.y - p.y) + 2 * pad };
  };

  // A few markups to work with.
  await h.tool('cloud');
  await h.drag(P(41, 40), P(61, 26));
  await h.tool('rect');
  await h.drag(P(9.5, 47.5), P(21, 30.5));
  await h.tool('rect');
  await h.drag(P(23.5, 47.5), P(37, 30.5));
  await h.tool('text');
  await h.drag(P(10, 26), P(26, 22));
  await h.typeText('NEW CARPTE THROUGHOUT');
  await h.tool('select');
  await page.keyboard.press('Escape');

  // Selected markup with handles.
  await selectAt(9.6, 40);
  await h.shot('select-handles', { around: [await areaAround(P(8, 50), P(22, 29), 30)], pad: 0 });
  await selectAt(23.6, 40, true);
  await h.shot('select-shift', { around: [await areaAround(P(8, 50), P(38, 29), 30)], pad: 0 });

  // Selection box (Shift+drag on empty page).
  await page.keyboard.press('Escape');
  {
    const a = await h.at(...P(7, 49));
    const b = await h.at(...P(39, 28.5));
    await page.keyboard.down('Shift');
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 10 });
    await h.shot('select-box', { around: [await areaAround(P(6, 50), P(40, 28), 30)], pad: 0 });
    await page.mouse.up();
    await page.keyboard.up('Shift');
  }
  await page.keyboard.press('Escape');

  // Lasso.
  await h.menu('Edit');
  await h.mark([h.item('Select'), h.item('Select All'), h.item('Lasso')], { numbers: false });
  await h.shot('edit-menu-select', { around: [h.item('Pan'), h.item('Find Text')], pad: 20, minWidth: 320 });
  await h.closeMenus();

  // Style controls for a selected cloud.
  await selectAt(41.1, 33);
  const tb = '.toolbar.tools';
  await h.mark([
    `${tb} input[type=color]`,
    { t: page.locator(`${tb} label.field`, { hasText: 'Fill' }), at: 'bl' },
    page.locator(`${tb} [title="Line width"]`).first(),
    { t: page.locator(`${tb} label[title="Line style"]`), at: 'bl' },
    page.locator(`${tb} [title="Opacity"]`).first(),
    { t: page.locator(`${tb} label.field`, { hasText: 'Bubbles' }), at: 'bl' },
  ]);
  await h.shot('toolbar-style', { around: [`${tb} input[type=color]`, page.locator(`${tb} label.field`, { hasText: 'Bubbles' })], pad: 26 });

  // Properties panel.
  await h.panel('Properties');
  await h.shot('properties-panel', { around: ['.panel.left'], pad: 0 });

  // Right-click menu.
  const cc = await h.at(...P(41.1, 33));
  await page.mouse.click(cc.x, cc.y, { button: 'right' });
  await h.wait(300);
  await h.shot('markup-menu', { around: ['[role=menu]'], pad: 12 });
  const sub = async (label) => {
    await page.locator('[role=menu] [role=menuitem]').filter({ hasText: new RegExp(`^\\W*${label}`) }).first().hover();
    await h.wait(300);
  };
  await sub('Order');
  await h.shot('markup-menu-order', { around: ['[role=menu]'], pad: 12 });
  await sub('Alignment');
  await h.shot('markup-menu-align', { around: ['[role=menu]'], pad: 12 });
  await sub('Set Status');
  await h.shot('markup-menu-status', { around: ['[role=menu]'], pad: 12 });
  await sub('Layer');
  await h.shot('markup-menu-layer', { around: ['[role=menu]'], pad: 12 });
  await sub('Rotate');
  await h.shot('markup-menu-rotate', { around: ['[role=menu]'], pad: 12 });
  await page.keyboard.press('Escape');
  await h.wait(200);

  // Comment.
  await page.mouse.click(cc.x, cc.y, { button: 'right' });
  await page.locator('[role=menu] [role=menuitem]').filter({ hasText: /Add Comment/ }).first().click();
  await h.wait(300);
  await page.keyboard.type('Bench length changed to 3.6 m. Confirm with client.');
  await h.shot('comment-dialog', { around: ['.modal'], pad: 20 });
  await page.keyboard.press('Control+Enter');
  await h.wait(300);
  await page.mouse.click(cc.x, cc.y, { button: 'right' });
  await page.locator('[role=menu] [role=menuitem]').filter({ hasText: /^\W*Reply/ }).first().click();
  await h.wait(300);
  await page.keyboard.type('Client confirmed 3.6 m on site.');
  await h.shot('reply-dialog', { around: ['.modal'], pad: 20 });
  await page.keyboard.press('Control+Enter');
  await h.wait(300);
  await page.mouse.click(cc.x, cc.y, { button: 'right' });
  await sub('Set Status');
  await page.locator('[role=menu] [role=menuitem]').filter({ hasText: /^\W*Accepted/ }).first().click().catch(() => {});
  await h.wait(300);
  await h.shot('list-with-reply', { around: ['.bottom-dock'], pad: 0 });

  // Layers.
  await page.mouse.click(cc.x, cc.y, { button: 'right' });
  await sub('Layer');
  await page.locator('[role=menu] [role=menuitem]').filter({ hasText: /New Layer/ }).first().click();
  await h.wait(300);
  await page.keyboard.type('Kitchen changes');
  await page.keyboard.press('Enter');
  await h.wait(300);
  await h.panel('Layers');
  await h.shot('layers-panel', { around: ['.panel.left .layers'], pad: 16 });

  // Multiply.
  await page.keyboard.press('Escape');
  await h.tool('ellipse');
  await h.drag(P(40, 46), P(42, 44));
  await h.tool('select');
  await page.keyboard.press('Escape');
  await selectAt(41, 46);
  await page.keyboard.press('Control+m');
  await h.wait(300);
  for (const [id, v] of [['#mult-cols', '5'], ['#mult-rows', '2'], ['#mult-gapx', '3'], ['#mult-gapy', '3']]) {
    await page.locator(id).fill(v).catch(() => {});
  }
  await h.shot('multiply-dialog', { around: ['.modal'], pad: 20 });
  await page.locator('.modal button[type=submit]').click();
  await h.wait(400);
  await page.keyboard.press('Escape');
  await h.shot('multiply-result', { around: [await areaAround(P(38, 48), P(64, 26), 20)], pad: 0 });

  // Offset.
  await h.tool('polyline');
  await h.clicks([P(10, 15), P(30, 15), P(30, 24)], 'enter');
  await h.tool('select');
  await page.keyboard.press('Escape');
  await selectAt(20, 15);
  await page.keyboard.press('o');
  const op = await h.at(...P(22, 17));
  await page.mouse.move(op.x, op.y, { steps: 5 });
  await h.wait(300);
  await h.shot('offset-preview', { around: [await areaAround(P(8, 26), P(32, 13), 20)], pad: 0 });
  await page.mouse.click(op.x, op.y);
  await page.keyboard.press('Escape');

  // Format Painter.
  await selectAt(41.1, 33);
  await h.menu('Edit');
  await h.mark(h.item('Format Painter'), { numbers: false });
  await h.shot('edit-menu-painter', { around: ['.menu-drop'], pad: 12 });
  await h.closeMenus();

  // Change colours.
  await selectAt(41.1, 33);
  await page.mouse.click(cc.x, cc.y, { button: 'right' });
  await page.locator('[role=menu] [role=menuitem]').filter({ hasText: /Change Colours/ }).first().click();
  await h.wait(300);
  await h.shot('change-colours', { around: ['.modal'], pad: 20 });
  await h.closeModal();

  // Text formatting controls.
  await h.tool('text');
  await h.mark([
    page.locator(`${tb} label.field`, { hasText: /^Box$/ }),
    { t: page.locator(`${tb} label.field`, { hasText: /^Border$/ }), at: 'bl' },
    page.locator(`${tb} select.font-family`),
    { t: page.locator(`${tb} input.font-size`), at: 'bl' },
  ]);
  await h.shot('toolbar-text', { around: [`${tb} input[type=color]`, page.locator(`${tb} input.font-size`)], pad: 26 });
  await h.tool('select');
  await selectAt(10.2, 24);
  await h.panel('Properties');
  await h.shot('properties-text', { around: ['.panel.left'], pad: 0 });

  // Spelling.
  await page.keyboard.press('Escape');
  await page.keyboard.press('F7');
  await h.wait(800);
  await h.shot('spelling-dialog', { around: ['.modal'], pad: 20 });
  await h.closeModal();

  // Snapping and draw to scale.
  await h.zoomTo(...P(20, 35), ...P(42, 22));
  await h.tool('line');
  const sp = await h.at(...P(38.1, 29.8));
  await page.mouse.move(sp.x - 6, sp.y + 5, { steps: 3 });
  await page.mouse.move(sp.x - 3, sp.y + 2, { steps: 3 });
  await h.wait(300);
  await h.shot('snap-marker', { around: [{ x: sp.x - 120, y: sp.y - 90, width: 240, height: 180 }], pad: 0 });
  await page.keyboard.press('Escape');
  await h.mark(['Snap Grid', 'Snap Content', 'Snap Markup'].map((t) => page.locator('.statusbar button', { hasText: new RegExp(`^${t}$`) })));
  await h.shot('status-snap', { around: ['.statusbar .status-group:not(.right)'], pad: 20 });
  await page.locator('.statusbar button', { hasText: /^Draw to Scale$/ }).click();
  await h.zoomTo(...P(5, 52), ...P(67, 9));
  await h.tool('line');
  const d0 = await h.at(...P(12, 20));
  await page.mouse.click(d0.x, d0.y);
  const d1 = await h.at(...P(24, 24));
  await page.mouse.move(d1.x, d1.y, { steps: 5 });
  await h.wait(400);
  await page.keyboard.type('12');
  await h.wait(300);
  await h.mark('.sketch-bar');
  await h.shot('sketch-drawing', { around: ['main.stage'], pad: 0 });
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await h.mark([page.locator('.statusbar button', { hasText: /^Reuse$/ }), page.locator('.statusbar button', { hasText: /^Draw to Scale$/ })]);
  await h.shot('status-reuse', { around: ['.statusbar .status-group:not(.right)'], pad: 20 });
  await page.locator('.statusbar button', { hasText: /^Draw to Scale$/ }).click();

  // Page right-click menu.
  await h.zoomTo(...P(5, 52), ...P(67, 9));
  const e = await h.at(...P(50, 10));
  await page.mouse.click(e.x, e.y, { button: 'right' });
  await h.wait(300);
  await h.shot('page-menu', { around: ['[role=menu]'], pad: 12 });
  await page.keyboard.press('Escape');
};
