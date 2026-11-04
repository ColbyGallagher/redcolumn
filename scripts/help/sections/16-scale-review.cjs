// Review Sheet Scales: the e2e set of sheets drawn for A1, one saved at A3 and one not to scale.
module.exports = async function (h) {
  const { page } = h;
  await h.open('../../../e2e/fixtures/paper.pdf');
  await page.waitForFunction(() => Object.values(window.__nb.tools.store.allSheets()).filter((s) => s.scaleText).length === 3, null, { timeout: 30000 });
  await h.run('Document', 'Review Sheet Scales…');
  await page.waitForSelector('.scale-review');
  await h.wait(400);
  await h.shot('scale-review', { around: ['.scale-review'], pad: 16 });
};
