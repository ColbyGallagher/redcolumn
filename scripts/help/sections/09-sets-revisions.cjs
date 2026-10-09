// Drawing Sets & Revisions: Sets panel, sheet links, Compare, Overlay, Slip Sheet and Revisions.
module.exports = async function (h) {
  const { page } = h;
  await h.open('sample-stitch.pdf');
  await h.open('sample-plans-rev1.pdf');
  await h.open('sample-plans.pdf');
  await h.wait(3000);
  await page.keyboard.press('Control+9');

  // Sheet links on the page and in the Links tab.
  await h.zoomTo(130, 160, 560, 250);
  await h.shot('links-on-page', { around: ['main.stage'], pad: 0 });
  await page.locator('.bottom-dock [role=tab], .bottom-dock button').filter({ hasText: /^Links$/i }).first().click().catch(() => {});
  await h.wait(500);
  await h.shot('links-panel', { around: ['.bottom-dock'], pad: 0 });
  await page.locator('.bottom-dock [role=tab], .bottom-dock button').filter({ hasText: /^Markups$/i }).first().click().catch(() => {});
  await page.keyboard.press('Control+9');

  // Sets.
  await h.panel('Sets');
  await page.locator('.sets-panel button', { hasText: 'New Set…' }).click();
  await h.wait(300);
  await page.locator('.set-create input[placeholder="Set name"]').fill('Sample Project');
  const boxes = page.locator('.set-create .set-files input[type=checkbox]');
  for (let i = 0; i < (await boxes.count()); i++) {
    const label = await boxes.nth(i).locator('xpath=..').innerText();
    if (/sample-plans\.pdf|sample-stitch/.test(label) && !(await boxes.nth(i).isChecked())) await boxes.nth(i).check();
  }
  await h.shot('sets-new', { around: ['.sets-panel'], pad: 12 });
  await page.locator('.set-create button[type=submit]').click();
  await h.wait(4000);
  await h.shot('sets-panel', { around: ['.panel.left'], pad: 0 });
  await page.locator('.sets-panel button[title="Files and categories"]').first().click().catch(() => {});
  await h.wait(300);
  await h.shot('sets-files', { around: ['.panel.left'], pad: 0 });
  await page.locator('.sets-panel button[title="Files and categories"]').first().click().catch(() => {});

  // Compare.
  await page.locator('.doc-tab', { hasText: 'sample-plans.pdf' }).first().click();
  await h.wait(500);
  await h.run('Document', 'Compare Documents…');
  await h.wait(600);
  // New: sample-plans-rev1, old: sample-plans.
  const selects = page.locator('.modal select');
  const n = await selects.count();
  for (let i = 0; i < Math.min(n, 2); i++) {
    const opts = await selects.nth(i).locator('option').allInnerTexts();
    const want = i === 1 ? opts.find((o) => /rev1/.test(o)) : opts.find((o) => /^sample-plans\.pdf/.test(o));
    if (want) await selects.nth(i).selectOption({ label: want }).catch(() => {});
  }
  await h.shot('compare-dialog', { around: ['.modal'], pad: 20 });
  await page.locator('.modal button[type=submit]').last().evaluate((b) => b.click());
  await h.wait(8000);
  await page.keyboard.press('Control+9');
  await h.wait(800);
  await h.shot('compare-results');
  await h.shot('compare-results-panel', { around: ['.compare-results'], pad: 12 });
  await page.locator('.compare-results button[title="Close"]').click().catch(() => {});

  // Overlay.
  await h.run('Document', 'Overlay Pages…');
  await h.wait(600);
  await h.shot('overlay-dialog', { around: ['.modal'], pad: 20 });
  await page.locator('.modal button[type=submit]').last().evaluate((b) => b.click());
  await h.wait(8000);
  await page.locator('.doc-tab', { hasText: /^Overlay/ }).first().click().catch(() => {});
  await h.wait(1500);
  await page.keyboard.press('Control+9');
  await h.wait(1500);
  await h.shot('overlay-result', { around: ['main.stage'], pad: 0 });

  // Slip sheet and revisions.
  await page.locator('.doc-tab', { hasText: /^sample-plans\.pdf/ }).first().click().catch(() => {});
  await h.run('Document', 'Slip Sheet…');
  await h.wait(600);
  await h.shot('slip-sheet', { around: ['.modal'], pad: 20 });
  await h.closeModal();
  await h.run('Document', 'Revisions…');
  await h.wait(600);
  await h.shot('revisions', { around: ['.modal'], pad: 20 });
  await h.closeModal();
};

module.exports.viewport = { width: 1440, height: 1100 };
