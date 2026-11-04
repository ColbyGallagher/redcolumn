// Review Sheet Scales: the e2e set of sheets drawn for A1: saved at A1 and A3, not to scale, an A3
// sheet its scale bar catches, and an AS SHOWN sheet of details.
module.exports = async function (h) {
  const { page } = h;
  await h.open('../../../e2e/fixtures/paper.pdf');
  await page.waitForFunction(() => Object.values(window.__nb.tools.store.allSheets()).filter((s) => s.scaleText).length === 5, null, { timeout: 30000 });
  await h.run('Document', 'Review Sheet Scales…');
  await page.waitForSelector('.scale-review');
  // The scale bars and view titles are read in the background.
  await page.waitForFunction(() => [...document.querySelectorAll('.scale-review tbody td:nth-child(7)')].every((td) => td.textContent !== '…'));
  await h.wait(400);
  await h.shot('scale-review', { around: ['.scale-review'], pad: 16 });
};
