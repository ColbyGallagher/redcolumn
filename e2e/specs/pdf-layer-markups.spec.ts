// A markup on one of the PDF's own layers (an annotation with /OC, as Revu saves them) hides with the
// layer when its eye is switched off in the Layers panel.
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { expect, test } from '../support/app.ts';

/** One page, a "Markups LR" layer with a "Beams" layer under it, and a rectangle markup on Beams. */
async function layeredPdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([792, 612]);
  page.drawText('Layered test', { x: 40, y: 560, size: 18 });
  const ctx = doc.context;
  const ocg = (name: string) => ctx.register(ctx.obj({ Type: 'OCG', Name: PDFString.of(name) }));
  const parent = ocg('Markups LR');
  const beams = ocg('Beams');
  doc.catalog.set(PDFName.of('OCProperties'), ctx.obj({ OCGs: [parent, beams], D: { Order: [parent, [beams]], ON: [parent, beams] } }));
  const annot = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Square', Rect: [200, 200, 500, 400], C: [1, 0, 0], BS: { W: 4 }, OC: beams, NM: PDFString.of('beam-1'), Subj: PDFString.of('Rectangle') }));
  page.node.set(PDFName.of('Annots'), ctx.obj([annot]));
  return Buffer.from(await doc.save());
}

test("switching a PDF layer off hides the markups on it, and on again shows them", async ({ app }) => {
  await app.page.locator('input[type=file][accept*="pdf"]').first().setInputFiles({ name: 'layered.pdf', mimeType: 'application/pdf', buffer: await layeredPdf() });
  await expect.poll(async () => (await app.markups().catch(() => [])).length, { timeout: 30_000 }).toBe(1);
  const hidden = () => app.page.evaluate(() => [...(window.__nb.tools as unknown as { hiddenLayers: Set<string> }).hiddenLayers]);
  await app.panel('Layers');
  // The PDF layer's eye (the first "Beams" row; the markup layer of the same name is listed after it).
  await app.page.getByRole('button', { name: 'Hide Beams', exact: true }).first().click();
  await expect.poll(hidden).toEqual(['Beams']);
  await app.page.getByRole('button', { name: 'Show Beams', exact: true }).first().click();
  await expect.poll(hidden).toEqual([]);
});
