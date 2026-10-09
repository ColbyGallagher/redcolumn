// Getting Started: the start screen, a tour of the screen, opening and saving, tabs, File Access,
// the command finder, undo history and installing.
module.exports = async function (h) {
  const { page } = h;

  // The start screen.
  await h.mark(page.getByRole('button', { name: 'Open a PDF…' }));
  await h.shot('start-screen');

  await h.menu('File');
  await h.mark(h.item('Open…'));
  await h.shot('file-open', { around: ['.menu-drop'], pad: 16 });
  await h.closeMenus();

  await h.open('sample-plans.pdf');

  await h.sampleMarkups();
  await page.keyboard.press('Control+9');
  await h.wait(700);

  // The tour.
  await h.mark(
    [{ t: '.menubar', at: 'r' }, { t: '.toolbar.tools', at: 'r' }, { t: '.doc-tabs', at: 'r' }, { t: '.rail', at: 'tr' }, { t: '.panel.left', at: 'tr' }, { t: 'main.stage', at: 'tr' }, { t: '.pagenav', at: 'r' }, { t: '.bottom-dock', at: 'tr' }, { t: '.statusbar', at: 'r' }],
    { pad: -2 },
  );
  await h.shot('workspace-tour');

  // Save.
  await h.menu('File');
  await h.mark([h.item('Save'), h.item('Save As…')], { numbers: false });
  await h.shot('file-save', { around: ['.menu-drop'], pad: 16 });
  await h.closeMenus();
  await h.mark('.doc-tab.active');
  await h.shot('tab-unsaved', { around: ['.doc-tab.active'], pad: 16, minWidth: 360 });

  // Tabs.
  await h.open('sample-form.pdf');
  await h.mark('.doc-tabs .doc-tab-add');
  await h.shot('tabs-add', { around: ['.doc-tabs .doc-tab', '.doc-tabs .doc-tab-add'], pad: 16 });
  await page.locator('.doc-tab').first().click({ button: 'right' });
  await h.wait(300);
  await h.shot('tab-menu', { around: ['.doc-tabs', '.ctx-menu, .context-menu, [role=menu]'], pad: 12 });
  await page.keyboard.press('Escape');

  // File Access.
  await h.panel('File Access');
  await h.mark(['.library-search', '.library .btn.small', '.library .recents']);
  await h.shot('file-access', { around: ['.library-tools', '.library .recents'], pad: 20 });

  // Find tools and commands.
  await page.keyboard.press('Control+Shift+P');
  await h.wait(300);
  await page.keyboard.type('cloud');
  await h.wait(300);
  await h.shot('command-palette', { around: ['.modal, .palette, .command-palette'], pad: 20 });
  await page.keyboard.press('Escape');

  // Undo history.
  await page.locator('.doc-tab').first().click();
  await h.wait(800);
  await h.run('Edit', 'Undo History…');
  await h.shot('undo-history', { around: ['.modal'], pad: 20 });
  await page.keyboard.press('Escape');

  // Install.
  await h.mark('.install-app-btn');
  await h.shot('install-button', { around: ['.install-app-btn'], pad: 60, minWidth: 360 });
  await h.run('Help', 'Install App…');
  await h.shot('install-dialog', { around: ['.modal'], pad: 20 });
};
