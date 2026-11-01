// Assemblies: the dialog with an example partition wall loaded.
module.exports = async function (h) {
  const { page } = h;
  await h.open('sample-plans.pdf');
  await h.run('Tools', 'Takeoff', 'Assemblies…');
  await page.waitForSelector('.assemblies-dialog');
  await page.locator('.assemblies-dialog button', { hasText: 'Examples' }).click();
  await page.locator('.assemblies-dialog [role=menuitem]', { hasText: /partition/i }).first().click();
  await h.wait(500);
  await h.shot('assemblies-dialog', { around: ['.assemblies-dialog'], pad: 16 });
  await h.closeModal();
};
