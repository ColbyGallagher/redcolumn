// Working Together: the Sessions and Projects panels and their start dialogs. Signing in to Google
// or Microsoft is not possible here, so these show the panels before a session or Project exists.
module.exports = async function (h) {
  const { page } = h;
  await h.open('sample-plans.pdf');
  await h.panel('Sessions');
  await h.shot('sessions-panel', { around: ['.panel.left .session-toolbar', '.panel.left .sessions > h3', '.panel.left .sessions > p'], pad: 16 });
  await page.locator('.sessions button', { hasText: '+ Start' }).click().catch(() => {});
  await h.wait(500);
  if (await page.locator('.modal').count()) await h.shot('session-start', { around: ['.modal'], pad: 20 });
  await h.closeModal();
  await page.locator('.sessions button', { hasText: 'Join…' }).click().catch(() => {});
  await h.wait(500);
  if (await page.locator('.modal').count()) await h.shot('session-join', { around: ['.modal'], pad: 20 });
  await h.closeModal();
  await h.panel('Projects');
  await h.shot('projects-panel', { around: ['.panel.left .session-toolbar', '.panel.left .sessions > h3', '.panel.left .sessions > p'], pad: 16 });
};
module.exports.viewport = { width: 1440, height: 1000 };
