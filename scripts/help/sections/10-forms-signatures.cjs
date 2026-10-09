// Forms & Signatures: auto fields, Forms panel, filling, signatures, Digital IDs, Flags panel.
module.exports = async function (h) {
  const { page } = h;
  await h.open('sample-form.pdf');
  await page.keyboard.press('Control+9');
  await h.wait(500);

  await h.menu('Tools', 'Form');
  await h.shot('menu-form', { around: ['.menu-drop', '.menu-flyout'], pad: 12 });
  await h.closeMenus();

  // Auto-create fields.
  await h.run('Tools', 'Form', 'Auto-Create Fields…');
  await h.wait(800);
  if (await page.locator('.modal').count()) {
    await h.shot('auto-fields', { around: ['.modal'], pad: 20 });
    await page.locator('.modal button[type=submit], .modal button.primary').last().click().catch(() => {});
    await h.wait(1500);
  }
  await h.shot('auto-fields-result', { around: ['main.stage'], pad: 0 });

  // Forms panel.
  await h.panel('Forms');
  await h.shot('forms-panel', { around: ['.panel.left'], pad: 0 });

  // Fill a field on the page: the first text field (Project).
  await h.tool('select');
  await h.clickAt(300, 112);
  await h.wait(400);
  await page.keyboard.type('Sample Project');
  await h.shot('fill-field', { around: ['main.stage'], pad: 0 });
  await page.keyboard.press('Tab');
  await page.keyboard.type('Alex Smith');
  await page.keyboard.press('Enter');
  await h.wait(300);
  await h.clickAt(60, 216);
  await h.wait(300);
  await h.shot('form-filled', { around: ['main.stage'], pad: 0 });

  // Draw a field.
  await h.run('Tools', 'Form', 'Draw Field');
  await h.wait(400);
  await h.shot('draw-field-start', { around: ['.panel.left', 'main.stage'], pad: 0 });
  await page.keyboard.press('Escape');

  // Signatures.
  await h.panel('Signatures');
  await h.shot('signatures-panel', { around: ['.panel.left .signatures-wrap, .panel.left'], pad: 0 });
  await page.locator('.panel.left button', { hasText: /New signature/ }).click().catch(() => {});
  await h.wait(500);
  const typeTab = page.locator('.modal [role=tab], .modal button').filter({ hasText: /^Type/ }).first();
  await typeTab.click().catch(() => {});
  await page.locator('.modal input[placeholder="Your name"]').fill('Alex Smith').catch(() => {});
  await h.wait(300);
  await h.shot('signature-create', { around: ['.modal'], pad: 20 });
  await page.locator('.modal button.primary, .modal button[type=submit]').last().click().catch(() => {});
  await h.wait(500);
  await h.shot('signatures-mine', { around: ['.panel.left'], pad: 0 });
  await page.locator('.panel.left button', { hasText: /Alex Smith|Signature/ }).first().click().catch(() => {});
  await h.wait(300);
  await h.drag([150, 560], [330, 600]);
  await h.wait(800);
  await h.shot('signature-placed', { around: ['main.stage'], pad: 0 });

  // Digital IDs and signing.
  await h.closeModal();
  await h.run('Tools', 'Sign & Certify', 'Digital IDs…');
  await h.wait(500);
  await h.shot('digital-ids', { around: ['.modal'], pad: 20 });
  await h.closeModal();
  await h.run('Tools', 'Sign & Certify', 'Sign with Digital ID…');
  await h.wait(500);
  await h.shot('digital-sign', { around: ['.modal'], pad: 20 });
  await h.closeModal();

  // Flags panel.
  await h.tool('flag');
  await h.clickAt(560, 120);
  await h.wait(300);
  await h.closeModal();
  await page.keyboard.press('Escape');
  await h.panel('Flags');
  await h.shot('flags-panel', { around: ['.panel.left'], pad: 0 });
};
module.exports.viewport = { width: 1440, height: 1000 };
