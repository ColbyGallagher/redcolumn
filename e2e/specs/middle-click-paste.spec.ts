// On Linux a middle click pastes the primary selection. Over the drawing (where the middle button pans)
// that paste is dropped; an ordinary paste still pastes.
import { expect, test } from '../support/app.ts';

test('a paste that follows a middle click on the drawing is dropped; an ordinary paste still pastes', async ({ app }) => {
  await app.open('plan.pdf');
  await app.tool('rect');
  await app.drag([300, 450], [350, 500]);
  const count = async () => (await app.markups()).length;
  expect(await count()).toBe(1);
  await app.page.evaluate(() => window.__nb.tools.select(window.__nb.tools.store.all().map((m) => m.id)));
  await app.cmd('edit.copy');

  // An ordinary paste event pastes the copied markup.
  await app.page.evaluate(() => window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: new DataTransfer(), bubbles: true, cancelable: true })));
  await expect.poll(count).toBe(2);

  // A middle click on the drawing, then the paste the system sends with it: nothing is pasted, and the
  // release is marked handled (which keeps the browser from pasting the selection at all).
  const handled = await app.page.evaluate(() => {
    const canvas = document.querySelector('main.stage canvas')!;
    const r = canvas.getBoundingClientRect();
    const at = { clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, button: 1, bubbles: true, cancelable: true };
    canvas.dispatchEvent(new MouseEvent('mousedown', at));
    const up = new MouseEvent('mouseup', at);
    canvas.dispatchEvent(up);
    window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: new DataTransfer(), bubbles: true, cancelable: true }));
    return up.defaultPrevented;
  });
  expect(handled).toBe(true);
  await app.page.waitForTimeout(300);
  expect(await count()).toBe(2);
});
