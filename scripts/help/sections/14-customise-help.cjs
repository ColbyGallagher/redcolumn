// Customise and Help: Preferences sections, Profiles, Keyboard Shortcuts, the panel rail menu and
// the Help menu.
module.exports = async function (h) {
  const { page } = h;
  await h.open('sample-plans.pdf');

  await page.keyboard.press('Control+k');
  await h.wait(400);
  const sections = ['General', 'Interface', 'Navigation & Zoom', 'Display', 'Grid & Snap', 'Markup', 'Tools', 'Offline'];
  for (const s of sections) {
    await page.locator('.modal [role=tab]', { hasText: new RegExp(`^${s.replace(/[&]/g, '\\$&')}$`) }).click();
    await h.wait(250);
    await h.shot(`prefs-${s.toLowerCase().replace(/[^a-z]+/g, '-')}`, { around: ['.modal'], pad: 20 });
  }
  await page.locator('.modal button', { hasText: /^Done$/ }).click().catch(() => {});
  await h.closeModal();

  await h.menu('File', 'Profiles');
  await h.shot('menu-profiles', { around: ['.menu-drop', '.menu-flyout'], pad: 12 });
  await h.closeMenus();
  await h.run('File', 'Profiles', 'Manage Profiles…');
  await h.wait(500);
  await h.shot('profiles-dialog', { around: ['.modal'], pad: 20 });
  await h.closeModal();

  await h.run('File', 'Keyboard Shortcuts…');
  await h.wait(500);
  await h.shot('shortcuts-dialog', { around: ['.modal'], pad: 20 });
  await h.closeModal();

  await page.locator('.rail button').nth(3).click({ button: 'right' });
  await h.wait(300);
  await h.shot('rail-menu', { around: ['[role=menu]'], pad: 12 });
  await page.keyboard.press('Escape');
  await h.menu('Window');
  await h.shot('menu-window', { around: ['.menu-drop'], pad: 12 });
  await h.menu('Help');
  await h.shot('menu-help', { around: ['.menu-drop'], pad: 12 });
  await h.closeMenus();
  await h.run('Help', "Learn What's New");
  await h.wait(500);
  await h.shot('whats-new', { around: ['.modal'], pad: 20 });
  await h.closeModal();
  await h.menu('Edit');
  await h.mark(page.locator('.menu-drop .menu-field'));
  await h.shot('edit-author', { around: [page.locator('.menu-drop .menu-field'), h.item('Check Spelling…')], pad: 16 });
  await h.closeMenus();
};
module.exports.viewport = { width: 1440, height: 1000 };
