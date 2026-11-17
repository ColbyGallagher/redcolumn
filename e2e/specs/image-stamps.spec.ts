import { PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import { expect, test } from '../support/app.ts';

test.describe('image stamps', () => {
  test.beforeEach(async ({ app }) => {
    await app.open('plan.pdf');
  });

  test.afterEach(async ({ app }) => {
    expect(app.errors).toEqual([]);
  });

  test('a PNG with transparency imports as a stamp, places, saves with a soft mask and reloads', async ({ app }) => {
    // A generated 80 x 40 picture: an opaque red left half, a transparent right half.
    const png = await app.page.evaluate(async () => {
      const c = document.createElement('canvas');
      c.width = 80;
      c.height = 40;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#ff0000';
      ctx.fillRect(0, 0, 40, 40);
      const blob = await new Promise<Blob>((res) => c.toBlob((b) => res(b!), 'image/png'));
      return btoa(String.fromCharCode(...new Uint8Array(await blob.arrayBuffer())));
    });
    await app.cmd('tools.stamps');
    const dialog = app.page.getByRole('dialog', { name: 'Stamps' });
    await dialog.locator('input[type=file]').setInputFiles([
      { name: 'E2E_Seal.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') },
      { name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('not a picture') },
    ]);
    await expect(dialog.locator('.stamp-list li .name').filter({ hasText: /^E2E Seal$/ })).toHaveCount(1);
    // The one that cannot be read is named, not dropped silently.
    await expect(dialog.getByRole('status')).toContainText('broken.png');
    await dialog.locator('.stamp-list li').filter({ hasText: 'E2E Seal' }).click();
    await dialog.getByRole('button', { name: 'Place' }).click();
    await expect(dialog).toBeHidden();
    await app.drag([300, 450], [450, 520]);
    const [m] = await app.raw();
    expect(m).toMatchObject({ type: 'stamp', subject: 'E2E Seal', stamp: { art: { aspect: 2, texts: [] } } });

    const before = (await app.saved()).length;
    await app.cmd('file.saveAs');
    await expect.poll(async () => (await app.saved()).length, { timeout: 20_000 }).toBe(before + 1);
    const saved = (await app.saved()).at(-1)!.bytes;
    const doc = await PDFDocument.load(saved, { ignoreEncryption: true });
    let masked = 0;
    for (const [, obj] of doc.context.enumerateIndirectObjects()) {
      const dict = (obj as { dict?: PDFDict }).dict;
      if (dict?.get(PDFName.of('Subtype')) === PDFName.of('Image') && dict.get(PDFName.of('SMask'))) masked++;
    }
    expect(masked).toBeGreaterThan(0);

    // Reopened, the stamp is still there.
    await app.page.locator('input[type=file][accept*="pdf"]').first().setInputFiles({ name: 'sealed.pdf', mimeType: 'application/pdf', buffer: Buffer.from(saved) });
    await expect.poll(async () => (await app.documents()).find((d) => d.active)?.name, { timeout: 30_000 }).toMatch(/^sealed/);
    await expect.poll(async () => (await app.markups()).map((x) => x.type)).toEqual(['stamp']);
  });
});
