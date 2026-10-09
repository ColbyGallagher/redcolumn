// Viewing & Navigating: zoom, page navigation, layouts, rotation, split, stitch and display aids.
module.exports = async function (h) {
  const { page } = h;
  const nav = (title) => page.locator(`.pagenav button[title^="${title}"]`);
  await h.open('sample-plans.pdf');
  await h.sampleMarkups();
  await page.keyboard.press('Control+9');
  await h.wait(600);

  // Zoom controls.
  await h.mark([nav('Zoom out'), { t: '.pagenav input.zoom', at: 'bl' }, nav('Zoom in'), { t: nav('Fit page'), at: 'bl' }, nav('Fit width')]);
  await h.shot('nav-zoom', { around: ['.pagenav-side.left'], pad: 30 });
  await h.menu('View');
  await h.mark([h.item('Fit Page'), h.item('Fit Width'), h.item('Actual Size'), h.item('Zoom In'), h.item('Zoom Out')], { numbers: false });
  await h.shot('view-menu-zoom', { around: [h.item('Fit Page'), h.item('Zoom Out')], pad: 30, minWidth: 320 });
  await h.menu('View', 'Navigation Tools');
  await h.shot('view-nav-tools', { around: ['.menu-flyout', h.item('Navigation Tools')], pad: 20 });
  await h.closeMenus();

  // Zoom box in action.
  await h.tool('zoomBox');
  const a = await h.at(...h.plan(36, 50));
  const b = await h.at(...h.plan(66, 22));
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 10 });
  await h.shot('zoom-box', { around: ['main.stage'], pad: 0 });
  await page.mouse.up();
  await h.tool('select');
  await page.keyboard.press('Control+9');

  // Pages.
  await h.mark([nav('Previous view'), { t: nav('First page'), at: 'bl' }, nav('Previous page'), { t: '.pagenav .page-field input', at: 'bl' }, nav('Next page'), { t: nav('Last page'), at: 'bl' }, nav('Next view')]);
  await h.shot('nav-pages', { around: ['.pagenav-center'], pad: 30 });
  await h.panel('Thumbnails');
  await h.mark(page.locator('.panel.left .thumb').nth(1));
  await h.shot('thumbs-go', { around: ['.panel.left'], pad: 0 });

  // Layouts.
  await h.menu('View');
  await h.mark([h.item('Single Page'), h.item('Continuous Pages'), h.item('Side-by-Side'), h.item('Continuous Side-by-Side'), h.item('Show Cover Page in Side-by-Side')], { numbers: false });
  await h.shot('view-menu-layout', { around: [h.item('Single Page'), h.item('Rotate View')], pad: 30, minWidth: 340 });
  await h.closeMenus();
  await h.mark(page.locator('.pagenav button', { hasText: /Single|Continuous/ }));
  await h.shot('nav-continuous', { around: ['.pagenav-side.left'], pad: 30 });
  await page.keyboard.press('Control+6');
  await h.wait(500);
  await page.keyboard.press('Control+9');
  await h.wait(900);
  await h.shot('layout-side-by-side', { around: ['main.stage'], pad: 0 });
  await page.keyboard.press('Control+4');
  await h.wait(300);
  await page.keyboard.press('Control+9');
  await h.wait(600);

  // Rotate view.
  await h.run('View', 'Rotate View', 'Clockwise');
  await page.keyboard.press('Control+9');
  await h.wait(900);
  await h.mark(page.locator('.statusbar button', { hasText: /^View / }));
  await h.shot('rotate-view', { around: ['main.stage', '.statusbar'], pad: 0 });
  await page.locator('.statusbar button', { hasText: /^View / }).click();
  await h.wait(400);

  // Split.
  await h.choose(() => page.keyboard.press('Control+2'), 'sample-plans-rev1.pdf');
  await h.wait(1500);
  await h.shot('split-view');
  await h.mark(page.locator('.statusbar button', { hasText: /^Sync$/ }));
  await h.shot('split-sync', { around: [page.locator('.statusbar button', { hasText: /^Sync$/ })], pad: 50, minWidth: 420 });
  await h.menu('View');
  await h.mark([h.item('Split Vertical'), h.item('Split Horizontal'), h.item('Switch'), h.item('Balance'), h.item('Unsplit'), h.item('Synchronise Document'), h.item('Synchronise Page')], { numbers: false });
  await h.shot('view-menu-split', { around: [h.item('Split Vertical'), h.item('Synchronise Page')], pad: 30, minWidth: 340 });
  await h.closeMenus();
  await h.run('View', 'Unsplit');
  await h.wait(800);

  // Rulers, grid, crosshair.
  await page.keyboard.press('Control+r');
  await page.keyboard.press('Shift+F9');
  await h.wait(300);
  await h.zoomTo(...h.plan(6, 52), ...h.plan(40, 28));
  await page.locator('.statusbar button', { hasText: /^Crosshair$/ }).click();
  const c = await h.at(...h.plan(22, 30));
  await page.mouse.move(c.x, c.y);
  await h.wait(500);
  await h.shot('view-aids', { around: ['main.stage'], pad: 0 });
  await h.mark([...['Grid', 'Snap Grid', 'Rulers', 'Crosshair'].map((t) => page.locator('.statusbar button', { hasText: new RegExp(`^${t}$`) }))]);
  await h.shot('status-view-aids', { around: ['.statusbar .status-group:not(.right)'], pad: 20 });
  await page.locator('.statusbar button', { hasText: /^Crosshair$/ }).click();
  await page.keyboard.press('Control+r');
  await page.keyboard.press('Shift+F9');

  // Magnifier.
  await page.keyboard.press('Control+9');
  await h.wait(500);
  await h.run('View', 'Magnifier');
  const m = await h.at(...h.plan(48, 30));
  await page.mouse.move(m.x, m.y);
  await h.wait(800);
  await h.shot('magnifier', { around: ['main.stage'], pad: 0 });
  await h.run('View', 'Magnifier');

  // Dark pages and dimmer.
  await h.run('View', 'Dark Mode (Pages)');
  await h.wait(900);
  await h.shot('dark-pages', { around: ['main.stage'], pad: 0 });
  await h.run('View', 'Dark Mode (Pages)');
  await h.menu('View');
  await h.mark([h.item('Dark Mode (Pages)'), h.item('Dimmer'), h.item('Disable Line Weights'), h.item('Magnifier'), h.item('Full Screen')], { numbers: false });
  await h.shot('view-menu-display', { around: [h.item('Dark Mode (Pages)'), h.item('Navigation Tools')], pad: 30, minWidth: 340 });
  await h.closeMenus();

  // Stitched view.
  await h.open('sample-stitch.pdf');
  await h.wait(6000);
  await h.run('View', 'Stitched View');
  await h.wait(1500);
  await page.keyboard.press('Control+9');
  await h.wait(1500);
  await h.shot('stitched', { around: ['main.stage'], pad: 0 });
};
