import { PDFCheckBox, PDFDict, PDFDocument, PDFName, PDFSignature, PDFTextField } from 'pdf-lib';
import { expect, test, type App } from '../support/app.ts';
import { PLAN } from '../support/driver.ts';
import { checkSignatures } from '../../apps/web/src/documents/pdfSign.ts';

const modal = (app: App, title: string) => app.page.locator('.modal').filter({ has: app.page.locator('h3', { hasText: new RegExp(`^${title}$`) }) });

/** The document as Save As writes it. */
async function saveAs(app: App) {
  const before = (await app.saved()).length;
  await app.cmd('file.saveAs');
  await expect.poll(async () => (await app.saved()).length, { timeout: 20_000 }).toBe(before + 1);
  return (await app.saved()).at(-1)!.bytes;
}

/** Each form field of a saved PDF: its kind, name and first widget's rectangle (user space, rounded). */
async function fields(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  return doc
    .getForm()
    .getFields()
    .map((f) => {
      const r = f.acroField.getWidgets()[0]!.getRectangle();
      const kind = f instanceof PDFTextField ? 'text' : f instanceof PDFCheckBox ? 'checkbox' : f instanceof PDFSignature ? 'signature' : f.constructor.name;
      return { kind, name: f.getName(), rect: [r.x, r.y, r.width, r.height].map(Math.round) };
    });
}

test.describe('form fields', () => {
  test('tools.forms opens the Forms panel', async ({ app }) => {
    await app.open('plan.pdf');
    expect((await app.command('window.forms')).checked).toBe(false);
    await app.cmd('tools.forms');
    expect((await app.command('window.forms')).checked).toBe(true);
    await expect(app.page.locator('.forms-panel .empty')).toHaveText('This document has no form fields. Choose a type and draw a field on the page.');
  });

  test('tools.formField draws a text field', async ({ app }) => {
    await app.open('plan.pdf');
    await app.cmd('tools.formField');
    expect((await app.toolState()).tool).toBe('formField');
    expect((await app.command('tools.formField')).checked).toBe(true);
    await app.drag([100, 300], [300, 324]);
    // The first text field is Text1, listed in the Forms panel.
    await expect(app.page.locator('.forms-panel .field-name')).toHaveText(['Text Text1']);
    // Its widget is the drawn box in PDF space (y up): x 100, y 792 - 324, 200 x 24.
    await expect.poll(async () => fields(await saveAs(app)), { timeout: 30_000 }).toEqual([{ kind: 'text', name: 'Text1', rect: [100, PLAN.page.height - 324, 200, 24] }]);
  });

  test('tools.autoFields finds fill-in lines and check boxes', async ({ app }) => {
    const F = PLAN.forms;
    await app.open('forms.pdf');
    await app.cmd('tools.autoFields');
    await expect(app.notice()).toHaveText('Created 3 fields.', { timeout: 20_000 });
    await expect(app.page.locator('.forms-panel .field-name')).toHaveText(['Text NAME', 'Text DATE', 'Check Box APPROVED']);
    // A field 16 pt tall sits on each line; the check box is the drawn square. PDF y = 792 - page y.
    const [name, date] = F.lines;
    await expect
      .poll(async () => fields(await saveAs(app)), { timeout: 30_000 })
      .toEqual([
        { kind: 'text', name: 'NAME', rect: [name!.x0, F.page.height - name!.y, name!.x1 - name!.x0, 16] },
        { kind: 'text', name: 'DATE', rect: [date!.x0, F.page.height - date!.y, date!.x1 - date!.x0, 16] },
        { kind: 'checkbox', name: 'APPROVED', rect: [F.box.x, F.page.height - F.box.y - F.box.size, F.box.size, F.box.size] },
      ]);
    // Run again: every spot is a field now.
    await app.cmd('tools.autoFields');
    await expect(app.notice()).toHaveText('No fill-in lines, boxes or check boxes were found that are not fields already.');
  });

  test.afterEach(async ({ app }) => {
    expect(app.errors).toEqual([]);
  });
});

test.describe('stamps', () => {
  test.beforeEach(async ({ app }) => {
    await app.open('plan.pdf');
  });

  test('tools.stamps makes a new stamp and places it', async ({ app }) => {
    await app.cmd('tools.stamps');
    const dialog = app.page.getByRole('dialog', { name: 'Stamps' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'New…' }).click();
    await dialog.locator('#stamp-name').fill('E2E Checked');
    await dialog.locator('#stamp-lines').fill('E2E CHECKED\nSECOND LINE');
    await dialog.getByRole('button', { name: 'Save Stamp' }).click();
    // Back in the library, picked.
    await expect(dialog.locator('.stamp-list li.picked .name')).toHaveText('E2E Checked');
    await dialog.getByRole('button', { name: 'Place' }).click();
    await expect(dialog).toBeHidden();
    expect((await app.toolState()).tool).toBe('stamp');
    await app.drag([300, 450], [450, 520]);
    const [m] = await app.raw();
    expect(m).toMatchObject({ type: 'stamp', subject: 'E2E Checked', stamp: { lines: ['E2E CHECKED', 'SECOND LINE'] } });
  });

  test('tools.stamps: a built-in stamp is copied to edit, and the copy can be deleted', async ({ app }) => {
    await app.cmd('tools.stamps');
    const dialog = app.page.getByRole('dialog', { name: 'Stamps' });
    const first = (await dialog.locator('.stamp-list li .name').first().textContent())!;
    await expect(dialog.getByRole('button', { name: 'Delete' })).toBeDisabled();
    await dialog.getByRole('button', { name: 'Copy and Edit…' }).click();
    await expect(dialog.locator('#stamp-name')).toHaveValue(`${first} (copy)`);
    await dialog.getByRole('button', { name: 'Save Stamp' }).click();
    await expect(dialog.locator('.stamp-list li.picked .name')).toHaveText(`${first} (copy)`);
    const count = await dialog.locator('.stamp-list li').count();
    await dialog.getByRole('button', { name: 'Delete' }).click();
    await expect(dialog.locator('.stamp-list li')).toHaveCount(count - 1);
    await expect(dialog.locator('.stamp-list li .name').filter({ hasText: `${first} (copy)` })).toHaveCount(0);
  });

  test.afterEach(async ({ app }) => {
    expect(app.errors).toEqual([]);
  });
});

test.describe('signatures', () => {
  test.beforeEach(async ({ app }) => {
    await app.open('plan.pdf');
  });

  test('tools.signatures: a typed signature placed on the page', async ({ app }) => {
    await app.cmd('tools.signatures');
    expect((await app.command('window.signatures')).checked).toBe(true);
    await app.page.getByRole('button', { name: /New signature/ }).click();
    const dialog = app.page.getByRole('dialog', { name: 'Create signature' });
    await dialog.getByRole('tab', { name: 'Type' }).click();
    await dialog.getByPlaceholder('Your name').fill('E2E Tester');
    await dialog.getByPlaceholder('Name (e.g. My signature)').fill('E2E sig');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();
    await app.page.locator('.sig-card').filter({ hasText: 'E2E sig' }).click();
    await app.clicks([[400, 450]]);
    await expect.poll(async () => (await app.markups()).length).toBe(1);
    // Listed under In This Document as valid: nothing changed since it was placed.
    await expect(app.page.locator('.sig-placed .sig-state.valid')).toHaveCount(1);
  });

  /** Makes a self-signed Digital ID and signs the document with it, invisibly. */
  async function signWithNewId(app: App) {
    await app.cmd('tools.digitalIds');
    const ids = modal(app, 'Digital IDs');
    await ids.getByLabel('Name').fill('E2E Signer');
    await ids.getByLabel('Email').fill('signer@example.test');
    await ids.getByLabel('Password').fill('e2e-password');
    await ids.getByLabel('Again').fill('e2e-password');
    await ids.getByRole('button', { name: 'Create' }).click();
    await expect(ids.locator('.id-list li')).toHaveText(/E2E Signer <signer@example.test>Self-signed/, { timeout: 30_000 });
    await ids.getByRole('button', { name: 'Close' }).click();

    await app.cmd('tools.sign');
    const sign = modal(app, 'Sign');
    await sign.getByLabel('Password').fill('e2e-password');
    await sign.getByLabel('Location').fill('E2E Lab');
    await sign.getByLabel('Invisible (listed in Signatures only)').check();
    await sign.getByRole('button', { name: 'Sign' }).click();
    await expect(sign).toBeHidden({ timeout: 30_000 });
    await expect(app.page.locator('.dsig-list .dsig')).toHaveCount(1, { timeout: 30_000 });
  }

  test('tools.digitalIds makes an ID; tools.sign signs with it', async ({ app }) => {
    await signWithNewId(app);
    const sig = app.page.locator('.dsig-list .dsig');
    await expect(sig).toHaveCount(1, { timeout: 30_000 });
    await expect(sig.locator('b')).toHaveText('E2E Signer');
    await expect(sig).toContainText('I am approving this document · E2E Lab');
    await expect(sig.locator('.dsig-status')).toHaveText(/^Valid: unchanged since it was signed/);
    await expect(sig).toContainText('Certificate: E2E Signer (self-signed)');
  });

  test('Save As after signing writes the signed file as it is', async ({ app }) => {
    await signWithNewId(app);
    const [check] = await checkSignatures(await saveAs(app));
    expect(check).toMatchObject({ signer: 'E2E Signer', intact: true, coversWholeFile: true });
  });

  test('a markup added after signing is saved after the signature, which stays valid', async ({ app }) => {
    await signWithNewId(app);
    await app.tool('rect');
    await app.drag([300, 450], [350, 500]);
    await app.tool('select');
    await expect.poll(async () => (await app.markups()).length).toBe(1);
    const bytes = await saveAs(app);
    const [check] = await checkSignatures(bytes);
    // The signed version is kept byte for byte; the markup is an incremental update after it.
    expect(check).toMatchObject({ intact: true, coversWholeFile: false });
    expect(check!.signedLength).toBeLessThan(bytes.length);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPage(0).node.Annots()?.asArray().some((a) => doc.context.lookup(a, PDFDict).get(PDFName.of('Subtype'))?.toString() === '/Square')).toBe(true);
  });

  test('tools.sign without an ID offers to make one', async ({ app }) => {
    await app.cmd('tools.sign');
    const sign = modal(app, 'Sign');
    await expect(sign).toContainText('Signing needs a Digital ID.');
    await expect(sign.locator('button[type=submit]')).toBeDisabled();
    await sign.getByRole('button', { name: 'Make or import one…' }).click();
    await expect(modal(app, 'Digital IDs')).toBeVisible();
  });

  test.afterEach(async ({ app }) => {
    expect(app.errors).toEqual([]);
  });
});

// Redaction removes the words under the box from the page itself, so search no longer finds them.
// On page 1 "DOOR 2" is set at x 420, baseline y 330, 12 pt: the box 410-480 by 315-340 covers it.
test.describe('redaction', () => {
  test.beforeEach(async ({ app }) => {
    await app.open('plan.pdf');
  });

  test('tools.applyRedactions removes the text under redaction marks', async ({ app }) => {
    expect(await app.search('DOOR 2')).toEqual([1, 2]);
    await app.tool('redaction');
    await app.drag([410, 315], [480, 340]);
    expect((await app.markups()).map((m) => m.type)).toEqual(['redaction']);
    await app.cmd('tools.applyRedactions');
    const dialog = modal(app, 'Apply Redactions');
    await dialog.locator('#rd-text').fill('REDACTED');
    await dialog.locator('button[type=submit]').click();
    await expect.poll(() => app.search('DOOR 2'), { timeout: 30_000 }).toEqual([2]);
    // The rest of the page is still there; the marks are used up.
    expect(await app.search('DOOR 1')).toEqual([1, 2]);
    await expect.poll(async () => (await app.markups()).filter((m) => m.type === 'redaction')).toEqual([]);
  });

  test('tools.applyRedactions with nothing marked says so', async ({ app }) => {
    await app.cmd('tools.applyRedactions');
    await expect(app.notice()).toHaveText(/^Nothing is marked for redaction/);
  });

  test('search results marked for redaction are removed', async ({ app }) => {
    expect(await app.search('GENERAL NOTES')).toEqual([3]);
    await app.page.locator('.search p.empty').getByRole('button', { name: 'Mark for redaction' }).click();
    await expect(app.notice()).toHaveText('Marked 1 match for redaction. Tools › Redaction › Apply Redactions removes them.');
    // A box for each word of the match.
    await expect.poll(async () => (await app.markups()).map((m) => [m.type, m.page])).toEqual([
      ['redaction', 3],
      ['redaction', 3],
    ]);
    await app.cmd('tools.applyRedactions');
    await modal(app, 'Apply Redactions').locator('button[type=submit]').click();
    await expect.poll(() => app.search('GENERAL NOTES'), { timeout: 30_000 }).toEqual([]);
    expect(await app.search('ALL DIMENSIONS')).toEqual([3]);
  });

  test.afterEach(async ({ app }) => {
    expect(app.errors).toEqual([]);
  });
});
