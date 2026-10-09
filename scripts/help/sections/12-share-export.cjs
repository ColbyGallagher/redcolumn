// Share, Export & Print: print, publish, page images, File › Export and Import menus, share.
module.exports = async function (h) {
  const { page } = h;
  await h.open('sample-plans.pdf');
  await h.sampleMarkups();
  const shoot = async (name, path) => {
    await h.run(...path);
    await h.wait(700);
    await h.shot(name, { around: ['.modal'], pad: 20 });
    await h.closeModal();
  };
  await shoot('print-dialog', ['File', 'Print…']);
  await shoot('publish-dialog', ['File', 'Publish…']);
  await shoot('page-images', ['File', 'Export', 'Page Images…']);
  await shoot('summary-dialog', ['File', 'Export', 'Markup Summary…']);
  await h.menu('File', 'Export');
  await h.shot('menu-export', { around: ['.menu-drop', '.menu-flyout'], pad: 12 });
  await h.menu('File', 'Import');
  await h.shot('menu-import', { around: ['.menu-drop', '.menu-flyout'], pad: 12 });
  await h.closeMenus();
  await h.menu('File');
  await h.mark([h.item('Publish…'), h.item('Share / Email…'), h.item('Print…')], { numbers: false });
  await h.shot('menu-file-share', { around: ['.menu-drop'], pad: 12 });
  await h.closeMenus();
};
module.exports.viewport = { width: 1440, height: 1000 };
