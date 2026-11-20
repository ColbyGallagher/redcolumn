import { decodePDFRawStream, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream, PDFString } from 'pdf-lib';
import { expect, test } from '../support/app.ts';

type Raw = { type: string; points: [number, number][]; stamp?: { lines: string[]; form?: { values: Record<string, string>; fields: { label: string; choices?: string[] }[] } } };

/** How many text runs a saved stamp's appearance draws (in the app's own embedded font), and its /Contents. */
async function stampText(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const annots = doc.getPage(0).node.Annots()!.asArray().map((r) => doc.context.lookup(r, PDFDict));
  const stamp = annots.find((a) => a.get(PDFName.of('Subtype')) === PDFName.of('Stamp'))!;
  const ap = doc.context.lookup(stamp.lookup(PDFName.of('AP'), PDFDict).get(PDFName.of('N'))) as PDFRawStream;
  const ops = new TextDecoder('latin1').decode(decodePDFRawStream(ap).decode());
  return {
    drawn: [...ops.matchAll(/<[0-9A-Fa-f]+>\s*Tj/g)].length,
    contents: stamp.lookup(PDFName.of('Contents'), PDFString, PDFHexString).decodeText(),
    annots: annots.length,
    acroForm: !!doc.catalog.get(PDFName.of('AcroForm')),
  };
}

/** A stamp PDF with form fields, as other PDF tools write them: a question, the date and a list. */
async function formStampPdf() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 100]);
  page.node.set(PDFName.of('ArtBox'), doc.context.obj([0, 0, 300, 100]));
  page.drawRectangle({ x: 2, y: 2, width: 296, height: 96, borderWidth: 3 });
  const widget = (rect: number[], extra: Record<string, unknown>) => doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Widget', Rect: rect, DA: PDFString.of('/Helv 12 Tf 0 g'), ...extra }));
  page.node.set(
    PDFName.of('Annots'),
    doc.context.obj([
      widget([10, 60, 290, 90], { FT: 'Tx', T: PDFString.of('Checker'), AA: { C: { S: 'JavaScript', JS: PDFString.of('event.value = app.response("Checked by:", "Stamp");') } } }),
      widget([10, 35, 290, 55], { FT: 'Tx', T: PDFString.of('When'), AA: { C: { S: 'JavaScript', JS: PDFString.of('event.value = util.printd("dd/mm/yyyy", new Date());') } } }),
      widget([10, 8, 290, 30], { FT: 'Ch', Ff: 1 << 17, T: PDFString.of('Status'), Opt: [PDFString.of('Open'), PDFString.of('Closed')], V: PDFString.of('Open') }),
    ]),
  );
  return Buffer.from(await doc.save());
}

test.describe('stamps with fields', () => {
  test.beforeEach(async ({ app }) => {
    await app.open('plan.pdf');
  });

  test.afterEach(async ({ app }) => {
    expect(app.errors).toEqual([]);
  });

  test('a stamp with a list and a text field asks for them, saves them filled in, and can be filled in again after reopening', async ({ app }) => {
    await app.cmd('tools.stamps');
    const dialog = app.page.getByRole('dialog', { name: 'Stamps' });
    await dialog.getByRole('button', { name: 'New…' }).click();
    await dialog.locator('#stamp-name').fill('E2E Checked');
    await dialog.locator('#stamp-lines').fill('CHECKED\nStatus: {Field 1}');
    await dialog.getByRole('button', { name: 'Add Text Field' }).click();
    await dialog.getByRole('button', { name: 'Add Text Field' }).click();
    const names = dialog.getByLabel('Field name');
    // Renaming a field renames it in the wording.
    await names.nth(0).fill('Status');
    await names.nth(0).blur();
    await expect(dialog.locator('#stamp-lines')).toHaveValue('CHECKED\nStatus: {Status}');
    await dialog.getByLabel('Status choices').fill('Open\nClosed');
    await names.nth(1).fill('Checked by');
    await names.nth(1).blur();
    await dialog.getByLabel('Starts as').nth(1).fill('{User}');
    await dialog.getByRole('button', { name: 'Save Stamp' }).click();
    await expect(dialog.locator('.stamp-list li.picked .name')).toHaveText('E2E Checked');
    await dialog.getByRole('button', { name: 'Place' }).click();

    // One small dialog asks for the values before the stamp is placed.
    const fill = app.page.getByRole('dialog', { name: 'E2E Checked' });
    await expect(fill).toBeVisible();
    await expect(fill.getByLabel('Status').locator('option')).toHaveText(['', 'Open', 'Closed']);
    await fill.getByLabel('Status').selectOption('Closed');
    await fill.getByLabel('Checked by').fill('A. Tester');
    await fill.getByRole('button', { name: 'Place' }).click();
    await expect(fill).toBeHidden();
    await app.drag([300, 450], [450, 520]);
    const [m] = (await app.raw()) as Raw[];
    expect(m!.stamp!.lines).toEqual(['CHECKED', 'Status: Closed', 'Checked by: A. Tester']);
    expect(m!.stamp!.form!.fields.find((f) => f.label === 'Status')!.choices).toEqual(['Open', 'Closed']);

    // Double-click the placed stamp to change a value.
    await app.tool('select');
    const [[x0, y0], [x1, y1]] = m!.points as [[number, number], [number, number]];
    const mid = await app.at([(x0 + x1) / 2, (y0 + y1) / 2]);
    await app.page.mouse.dblclick(mid.x, mid.y);
    const edit = app.page.getByRole('dialog', { name: 'E2E Checked' });
    await expect(edit.getByLabel('Status')).toHaveValue('Closed');
    await edit.getByLabel('Status').selectOption('Open');
    await edit.getByRole('button', { name: 'Update' }).click();
    await expect.poll(async () => ((await app.raw()) as Raw[])[0]!.stamp!.lines).toEqual(['CHECKED', 'Status: Open', 'Checked by: A. Tester']);

    // Saved: one stamp annotation (no form fields) whose appearance shows the values.
    const before = (await app.saved()).length;
    await app.cmd('file.saveAs');
    await expect.poll(async () => (await app.saved()).length, { timeout: 20_000 }).toBe(before + 1);
    const saved = (await app.saved()).at(-1)!.bytes;
    const text = await stampText(saved);
    // Its appearance draws the three filled-in lines (the unit tests read the text itself).
    expect(text.drawn).toBe(3);
    expect(text.contents).toMatch(/^CHECKED\nStatus: Open\nChecked by: A. Tester/);
    expect(text.acroForm).toBe(false);

    // Reopened, its fields are still there to fill in.
    await app.page.locator('input[type=file][accept*="pdf"]').first().setInputFiles({ name: 'checked.pdf', mimeType: 'application/pdf', buffer: Buffer.from(saved) });
    await expect.poll(async () => (await app.documents()).find((d) => d.active)?.name, { timeout: 30_000 }).toMatch(/^checked/);
    await expect.poll(async () => ((await app.raw()) as Raw[]).map((x) => x.stamp?.form?.values && Object.values(x.stamp.form.values).sort())).toEqual([['A. Tester', 'Open']]);
  });

  test('a field added to a picture stamp gets a text of its own, moved into place in the preview', async ({ app }) => {
    const png = await app.page.evaluate(async () => {
      const c = document.createElement('canvas');
      c.width = 200;
      c.height = 100;
      const ctx = c.getContext('2d')!;
      ctx.strokeStyle = '#1d4ed8';
      ctx.lineWidth = 6;
      ctx.strokeRect(3, 3, 194, 94);
      const blob = await new Promise<Blob>((res) => c.toBlob((b) => res(b!), 'image/png'));
      return btoa(String.fromCharCode(...new Uint8Array(await blob.arrayBuffer())));
    });
    await app.cmd('tools.stamps');
    const dialog = app.page.getByRole('dialog', { name: 'Stamps' });
    await dialog.locator('input[type=file]').setInputFiles([{ name: 'E2E_Box.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') }]);
    await dialog.locator('.stamp-list li').filter({ hasText: 'E2E Box' }).click();
    await dialog.getByRole('button', { name: 'Edit…' }).click();
    await dialog.getByRole('button', { name: 'Add Text Field' }).click();
    // The new field is shown by a text of its own.
    await expect(dialog.getByLabel('Text 1', { exact: true })).toHaveValue('{Field 1}');
    await dialog.getByLabel('Field name').fill('Reviewer');
    await dialog.getByLabel('Field name').blur();
    await expect(dialog.getByLabel('Text 1', { exact: true })).toHaveValue('{Reviewer}');
    // Moved down and right with the keyboard: 1% of the box a press, 5% with Shift.
    const handle = dialog.getByRole('button', { name: 'Move text 1', exact: true });
    await handle.focus();
    await app.page.keyboard.press('Shift+ArrowDown');
    await app.page.keyboard.press('ArrowRight');
    await dialog.getByRole('button', { name: 'Save Stamp' }).click();
    await dialog.getByRole('button', { name: 'Place' }).click();
    const fill = app.page.getByRole('dialog', { name: 'E2E Box' });
    await fill.getByLabel('Reviewer').fill('C. Tester');
    await fill.getByRole('button', { name: 'Place' }).click();
    await app.drag([300, 450], [500, 550]);
    const [m] = (await app.raw()) as (Raw & { stamp: { art: { texts: { text: string; x: number; y: number }[] } } })[];
    expect(m!.stamp.art.texts).toHaveLength(1);
    expect(m!.stamp.art.texts[0]).toMatchObject({ text: 'C. Tester' });
    expect(m!.stamp.art.texts[0]!.x).toBeCloseTo(0.11, 5);
    expect(m!.stamp.art.texts[0]!.y).toBeCloseTo(0.15, 5);
  });

  test('a stamp PDF with form fields imports as a stamp that asks for them, each in its place', async ({ app }) => {
    await app.cmd('tools.stamps');
    const dialog = app.page.getByRole('dialog', { name: 'Stamps' });
    await dialog.locator('input[type=file]').setInputFiles([{ name: 'E2E_Field_Stamp.pdf', mimeType: 'application/pdf', buffer: await formStampPdf() }]);
    await expect(dialog.getByRole('status')).toContainText('Imported 1 stamp');
    await dialog.locator('.stamp-list li').filter({ hasText: 'E2E Field Stamp' }).click();
    await dialog.getByRole('button', { name: 'Place' }).click();

    const fill = app.page.getByRole('dialog', { name: 'E2E Field Stamp' });
    await expect(fill.getByLabel('Checked by')).toBeVisible();
    await expect(fill.getByLabel('Status')).toHaveValue('Open');
    await fill.getByLabel('Checked by').fill('B. Tester');
    await fill.getByLabel('Status').selectOption('Closed');
    await fill.getByRole('button', { name: 'Place' }).click();
    await app.drag([300, 450], [450, 500]);
    const [m] = (await app.raw()) as (Raw & { stamp: { art: { texts: { text: string; y: number }[] } } })[];
    const texts = m!.stamp.art.texts;
    expect(texts.map((t) => t.text)).toEqual(['B. Tester', expect.stringMatching(/\d/), 'Closed']);
    // Top to bottom, as on the stamp's page.
    expect(texts[0]!.y).toBeLessThan(texts[1]!.y);
    expect(texts[1]!.y).toBeLessThan(texts[2]!.y);
  });
});
