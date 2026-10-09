// Pages & Documents: thumbnails, page tools, labels, headers, bookmarks, properties, new PDFs,
// search, content editing and the document processing dialogs.
module.exports = async function (h) {
  const { page } = h;
  const P = h.plan;
  await h.open('sample-plans.pdf');
  await h.zoomTo(...P(5, 52), ...P(67, 4));

  /** Runs a menu command (picking `file` if it asks for one) and shoots the dialog it opens. */
  async function dialog(name, path, file) {
    await h.maybeChoose(() => h.run(...path), file ?? 'sample-plans-rev1.pdf');
    await h.wait(600);
    if (await page.locator('.modal').count()) await h.shot(name, { around: ['.modal'], pad: 20 });
    else {
      console.warn('  no dialog for', path.join(' > '));
      await h.shot(name);
    }
    await h.closeModal();
    await page.keyboard.press('Escape');
  }

  // Thumbnails.
  await h.panel('Thumbnails');
  await h.shot('thumbnails-panel', { around: ['.panel.left'], pad: 0 });
  const thumbs = page.locator('.panel.left .thumb');
  await thumbs.nth(1).click({ modifiers: ['Control'] });
  await h.wait(200);
  await h.shot('thumbnails-selected', { around: ['.panel.left'], pad: 0 });
  await thumbs.nth(0).click();
  await h.mark([
    page.locator('.panel.left button[title$="anticlockwise"]').first(),
    page.locator('.panel.left button[title$=" clockwise"]').first(),
    page.locator('.panel.left button', { hasText: /^Delete$/ }),
    page.locator('.panel.left button', { hasText: /^Extract$/ }),
    page.locator('.panel.left button', { hasText: /Insert PDF/ }),
    { t: page.locator('.panel.left label', { hasText: 'Scale' }).first(), at: 'l' },
    { t: page.locator('.panel.left label', { hasText: 'Label' }).first(), at: 'l' },
    { t: '.panel.left .thumb-zoom', at: 'l' },
  ]);
  await h.shot('thumbnails-controls', { around: [page.locator('.panel.left button[title$="anticlockwise"]').first(), '.panel.left .thumb-zoom'], pad: 34 });

  // Document menu.
  await h.menu('Document');
  await h.shot('menu-document', { around: ['.menu-drop'], pad: 12 });
  await h.menu('Document', 'Insert');
  await h.shot('menu-document-insert', { around: ['.menu-drop', '.menu-flyout'], pad: 12 });
  await h.menu('Document', 'Page Labels');
  await h.shot('menu-document-labels', { around: ['.menu-drop', '.menu-flyout'], pad: 12 });
  await h.closeMenus();

  await dialog('insert-blank', ['Document', 'Insert', 'Blank Pages…']);
  await dialog('extract-pages', ['Document', 'Extract Pages…']);
  await dialog('replace-pages', ['Document', 'Replace Pages…'], 'sample-plans-rev1.pdf');
  await dialog('split-document', ['Document', 'Split Document…']);
  await dialog('crop-pages', ['Document', 'Crop Pages…']);
  await dialog('page-setup', ['Document', 'Page Setup…']);
  await dialog('number-pages', ['Document', 'Number Pages…']);
  await dialog('header-footer', ['Document', 'Headers & Footers…']);
  await dialog('doc-properties', ['Document', 'Document Properties…']);
  await dialog('security', ['Document', 'Security…']);
  await dialog('ocr', ['Document', 'OCR…']);
  await dialog('colour-processing', ['Document', 'Colour Processing…']);
  await dialog('reduce-size', ['Document', 'Reduce File Size…']);
  await dialog('flatten', ['Document', 'Flatten…']);

  // Page labels from a region.
  await h.run('Document', 'Page Labels', 'From Page Region…');
  await h.wait(500);
  const lr = page.locator('.label-regions');
  if (await lr.count()) await h.shot('label-regions', { around: ['.label-regions'], pad: 16 });
  await page.locator('.label-regions button[title="Close"]').click().catch(() => {});

  // Bookmarks.
  await h.panel('Bookmarks');
  await h.shot('bookmarks-panel', { around: ['.panel.left'], pad: 0 });
  const autoBm = page.locator('.panel.left button[title="Create a bookmark for every page from its page label"]');
  if (await autoBm.count()) {
    await autoBm.click();
    await h.wait(400);
    await h.shot('bookmarks-made', { around: ['.panel.left'], pad: 0 });
  }

  // New PDF, combine, camera.
  await dialog('new-pdf', ['File', 'New PDF…']);
  await dialog('combine', ['File', 'Combine…']);
  await dialog('camera', ['File', 'Create', 'From Camera…']);

  // Find text and the Search panel.
  await page.locator('.doc-tab').first().click();
  await page.keyboard.press('Control+f');
  await h.wait(400);
  await page.keyboard.type('A-201');
  await page.keyboard.press('Enter');
  await h.wait(1200);
  await h.shot('search-panel', { around: ['.panel.left'], pad: 0 });
  await h.shot('search-hit', { around: ['main.stage'], pad: 0 });

  // PDF content editing.
  await h.menu('Edit', 'PDF Content');
  await h.shot('menu-pdf-content', { around: ['.menu-drop', '.menu-flyout'], pad: 12 });
  await h.closeMenus();
  await page.keyboard.press('Control+9');
  await h.zoomTo(130, 160, 560, 250);
  await h.tool('selectText');
  await h.drag([146, 193], [420, 206]);
  await h.wait(300);
  await h.shot('select-text', { around: ['main.stage'], pad: 0 });
  await page.keyboard.press('Escape');
  await h.tool('editText');
  await h.clickAt(200, 232);
  await h.wait(600);
  await h.shot('edit-text', { around: ['main.stage'], pad: 0 });
  await page.keyboard.press('Escape');
  await h.closeModal();
  await h.tool('eraseContent');
  {
    const a = await h.at(140, 228);
    const b = await h.at(420, 238);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 8 });
    await h.shot('erase-content', { around: ['main.stage'], pad: 0 });
    await page.mouse.up();
  }
  await page.keyboard.press('Escape');

  // Last, the commands that change the pages straight away.
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+9');
  await h.panel('Thumbnails');
  await page.locator('.panel.left .thumb').nth(0).click();
  await h.maybeChoose(() => h.run('Document', 'Insert', 'Pages from PDF…'), 'sample-form.pdf');
  await h.wait(1500);
  await h.mark(page.locator('.panel.left .thumb').nth(1));
  await h.shot('inserted-page', { around: ['.panel.left'], pad: 0 });
  await page.locator('.panel.left .thumb').nth(1).click();
  await h.wait(300);
  await page.locator('.panel.left button[title$=" clockwise"]').first().click();
  await h.wait(1500);
  await h.mark(page.locator('.panel.left .thumb').nth(1));
  await h.shot('rotated-page', { around: ['.panel.left'], pad: 0 });
};
