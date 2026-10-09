// Batch: the Batch menu and each batch command's window.
module.exports = async function (h) {
  const { page } = h;
  await h.open('sample-form.pdf');
  await h.open('sample-plans-rev1.pdf');
  await h.open('sample-plans.pdf');
  await h.menu('Batch');
  await h.shot('menu-batch', { around: ['.menu-drop'], pad: 12 });
  await h.closeMenus();
  const kinds = [
    ['Auto-Link Sheets…', 'batch-link'],
    ['Flatten…', 'batch-flatten'],
    ['Page Labels (AutoMark)…', 'batch-page-labels'],
    ['Sign & Seal…', 'batch-sign'],
    ['Markup Summary…', 'batch-summary'],
    ['Print…', 'batch-print'],
  ];
  for (const [label, name] of kinds) {
    await h.run('Batch', label);
    await h.wait(600);
    await h.shot(name, { around: ['.modal'], pad: 20 });
    await h.closeModal();
  }
};
module.exports.viewport = { width: 1440, height: 1100 };
