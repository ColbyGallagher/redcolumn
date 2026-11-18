import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildWorkbook, type LooseCell, type SheetSpec } from '../../apps/web/src/sheetsync/xlsx.ts';
import { readWorkbook, workbookParts, type CellValue } from '../../apps/web/src/sheetsync/xlsxRead.ts';
import { expect, test, type App } from '../support/app.ts';

// Comment registers: make a template for a client, export the comments in its layout, fill the
// workbook in as the designer would, and import it.

type Row = { id: string; status: string; replies?: { author: string; text: string }[] };
const rows = (app: App) => app.page.evaluate(() => (window.__nb.tools.store as unknown as { all(): Row[] }).all().map((m) => ({ id: m.id, status: m.status, replies: m.replies?.map((x) => ({ author: x.author, text: x.text })) })));

async function addMarkups(app: App, comments: (string | null)[]) {
  await app.page.evaluate((comments) => {
    const store = window.__nb.tools.store as unknown as { add(m: object): void };
    comments.forEach((comment, i) =>
      store.add({ id: `e2e-cloud-${i}`, type: 'cloud', pageIndex: 0, points: [[100, 100 + i * 80], [220, 100 + i * 80], [220, 160 + i * 80], [100, 160 + i * 80]], style: { stroke: '#dc2626', strokeWidth: 1 }, author: 'Reviewer', createdAt: i + 1, modifiedAt: i + 1, status: 'none', ...(comment ? { comment } : {}) }),
    );
  }, comments);
  await expect.poll(async () => (await rows(app)).length).toBe(comments.length);
}

/** Whether Excel is installed: filling a client's file drives it. */
function hasExcel(): boolean {
  try {
    return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "if ([Type]::GetTypeFromProgID('Excel.Application')) { 'yes' } else { 'no' }"], { encoding: 'utf8', windowsHide: true }).trim() === 'yes';
  } catch {
    return false;
  }
}

test.describe('comment register', () => {
  test('file.registerTemplates and file.exportRegister: a template, a register in its layout, and the filled-in register imported', async ({ app }) => {
    await app.open('plan.pdf');
    await addMarkups(app, ['Kerb line clashes with pit lid', 'Show the batter extent', null]);

    // No templates yet: the export offers to make one.
    await app.cmd('file.exportRegister');
    const exportDialog = app.page.getByRole('dialog', { name: 'Export comment register' });
    await expect(exportDialog.getByText('There are no register templates yet')).toBeVisible();
    await exportDialog.getByRole('button', { name: 'New Template…' }).click();
    const editor = app.page.getByRole('dialog', { name: 'Register templates' });
    await editor.getByRole('button', { name: 'New', exact: true }).click();
    await editor.getByLabel('Template name').fill('Kestrel register');
    await editor.getByLabel('Word for Completed').fill('Closed');
    await editor.getByLabel('Other words for Completed').fill('Closed out');
    await editor.getByLabel('Other words for Completed').blur();
    await editor.getByRole('button', { name: 'Save Template' }).click();
    await editor.getByRole('button', { name: 'Close' }).click();

    // The export dialog now has the template; only markups that say something are listed.
    await expect(exportDialog.getByLabel('Register template')).toHaveValue(/.+/);
    await expect(exportDialog.getByLabel('Register rows')).toContainText('Markups with a comment (2)');
    await exportDialog.getByLabel('Document name').fill('KR-C-101 General arrangement');
    await exportDialog.getByRole('button', { name: 'Export', exact: true }).click();
    await expect.poll(async () => (await app.saved()).some((f) => f.name.endsWith('Kestrel register.xlsx'))).toBe(true);
    const exported = (await app.saved()).find((f) => f.name.endsWith('Kestrel register.xlsx'))!;
    const book = await readWorkbook(exported.bytes);
    expect(book.sheets.map((s) => `${s.name}:${s.state}`)).toEqual(['Register:visible', 'Read me:visible', '_redcolumn:veryHidden']);
    const register = book.sheets[0]!.rows;
    expect(register[0]![0]).toBe('Comment register');
    expect(register[1]![2]).toBe('KR-C-101 General arrangement');
    const header = register[4]!;
    expect(header.slice(0, 9)).toEqual(['Item No', 'Sheet', 'Comment', 'Raised by', 'Date raised', 'Status', 'Designer Response', 'Response by', 'Reviewer Close-out']);
    expect(register.slice(5).map((r) => [r[2], r[5]])).toEqual([['Kerb line clashes with pit lid', 'Open'], ['Show the batter extent', 'Open']]);

    // The designer answers, signs the answer and closes one out in the client's words.
    const at = (label: string) => header.indexOf(label);
    const sheets = book.sheets.map((s, i): SheetSpec => {
      const table = s.rows.map((row) => [...row]) as CellValue[][];
      if (i === 0) {
        table[5]![at('Status')] = 'Closed out';
        table[5]![at('Designer Response')] = 'Pit moved 300 east';
        table[5]![at('Response by')] = 'Priya Designer';
      }
      return { name: s.name, state: s.state, filter: false, table: table.map((row) => row.map((v) => (v === null ? '' : typeof v === 'boolean' ? String(v) : v))) };
    });
    const chooser = app.page.waitForEvent('filechooser');
    await app.cmd('file.importXlsx');
    await (await chooser).setFiles({ name: 'Kestrel register.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(buildWorkbook(sheets)) });
    const preview = app.page.getByRole('dialog', { name: 'Import from Excel' });
    await expect(preview.getByTestId('import-summary')).toContainText('2 rows matched (2 by row key). 1 cell to change, 1 reply to add, 0 conflicts, 0 unknown values');
    await expect(preview.locator('.import-excel-table tbody tr')).toHaveCount(2);
    await preview.getByLabel('Reply author').fill('Someone else');
    await preview.getByRole('button', { name: 'Apply 2 changes' }).click();

    const after = await rows(app);
    expect(after[0]).toMatchObject({ status: 'completed', replies: [{ author: 'Priya Designer', text: 'Pit moved 300 east' }] });
    expect(after[1]!.status).toBe('none');

    // The template is there to edit from the menu command too.
    await app.cmd('file.registerTemplates');
    await expect(app.page.getByRole('dialog', { name: 'Register templates' }).getByLabel('Template name')).toHaveValue('Kestrel register');
  });

  test('a register fills in a copy of the client’s own file, which keeps its title block and what is under its table', async ({ app }) => {
    test.skip(app.kind !== 'desktop' || process.platform !== 'win32', 'Excel fills the client’s file in, in the Windows desktop app');
    test.skip(!hasExcel(), 'Excel is not installed here');
    test.setTimeout(180_000);
    // The client's blank register (the fictional Kestrel Road set): a title block, the header on row 5,
    // two blank rows, then a sign-off block.
    const heads = ['Item No', 'Sheet', 'Comment', 'Raised by', 'Date raised', 'Status', 'Designer Response', 'Response by', 'Reviewer Close-out'];
    const cells: LooseCell[] = [
      { row: 0, col: 0, value: 'KESTREL ROAD UPGRADE', bold: true },
      { row: 1, col: 0, value: 'Document' },
      ...heads.map((value, col) => ({ row: 4, col, value, bold: true })),
      { row: 7, col: 0, value: 'Reviewed by' },
      { row: 7, col: 2, value: 'Signature' },
    ];
    const blank = join(mkdtempSync(join(tmpdir(), 'e2e-register-')), 'KR client register.xlsx');
    writeFileSync(blank, buildWorkbook([{ name: 'Review Comments', filter: false, table: [], cells }]));

    await app.open('plan.pdf');
    await addMarkups(app, ['Kerb line clashes with pit lid', 'Show the batter extent', 'Label the culvert']);

    // The template points at the client's file. Its sheet name is not the file's, and the file has one sheet: it is found.
    await app.cmd('file.registerTemplates');
    const editor = app.page.getByRole('dialog', { name: 'Register templates' });
    await editor.getByRole('button', { name: 'New', exact: true }).click();
    await editor.getByLabel('Template name').fill('Kestrel own file');
    await app.answerOpenDialog(blank);
    await editor.getByRole('button', { name: 'Choose…' }).click();
    await expect(editor.getByTestId('client-file-name')).toHaveText('KR client register.xlsx');
    await expect(editor.getByTestId('client-file-check')).toHaveText('The file’s headings match this template.');
    await editor.getByRole('button', { name: 'Save Template' }).click();
    await editor.getByRole('button', { name: 'Close' }).click();

    await app.cmd('file.exportRegister');
    const exportDialog = app.page.getByRole('dialog', { name: 'Export comment register' });
    await expect(exportDialog.getByLabel('Register workbook')).toHaveValue('client');
    await exportDialog.getByLabel('Document name').fill('KR-C-101 General arrangement');
    await exportDialog.getByRole('button', { name: 'Export', exact: true }).click();
    await expect.poll(async () => (await app.saved()).some((f) => f.name.endsWith('Kestrel own file.xlsx')), { timeout: 120_000 }).toBe(true);
    await expect(exportDialog).toBeHidden({ timeout: 120_000 });

    const filled = (await app.saved()).find((f) => f.name.endsWith('Kestrel own file.xlsx'))!;
    const book = await readWorkbook(filled.bytes);
    expect(book.sheets.map((s) => `${s.name}:${s.state}`)).toEqual(['Review Comments:visible', '_redcolumn:veryHidden']);
    const rowsOf = book.sheets[0]!.rows;
    expect(rowsOf[0]![0]).toBe('KESTREL ROAD UPGRADE');
    expect(rowsOf[1]![2]).toBe('KR-C-101 General arrangement');
    expect(rowsOf[4]!.slice(0, 10)).toEqual([...heads, 'redcolumn key']);
    expect(rowsOf.slice(5, 8).map((r) => [r[0], r[2], r[5]])).toEqual([[1, 'Kerb line clashes with pit lid', 'Open'], [2, 'Show the batter extent', 'Open'], [3, 'Label the culvert', 'Open']]);
    // Three comments and room for two: a row was inserted, and the sign-off block is a row further down.
    expect([rowsOf[8]![0], rowsOf[8]![2]]).toEqual(['Reviewed by', 'Signature']);

    // The filled-in file comes back like any register, and the sign-off block is not a row added.
    const chooser = app.page.waitForEvent('filechooser');
    await app.cmd('file.importXlsx');
    await (await chooser).setFiles({ name: filled.name, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: filled.bytes });
    const preview = app.page.getByRole('dialog', { name: 'Import from Excel' });
    await expect(preview.getByTestId('import-summary')).toContainText('3 rows matched (3 by row key). 0 cells to change, 0 replies to add, 0 conflicts, 0 unknown values, 0 rows skipped');
  });

  test('a register with thumbnails and links: a picture of each markup, and an item number that opens its comment', async ({ app }) => {
    await app.open('plan.pdf');
    await addMarkups(app, ['Kerb line clashes with pit lid', 'Show the batter extent']);

    await app.cmd('file.registerTemplates');
    const editor = app.page.getByRole('dialog', { name: 'Register templates' });
    await editor.getByRole('button', { name: 'New', exact: true }).click();
    await editor.getByLabel('Template name').fill('Kestrel pictures');
    // A tenth column for the picture, and a link on each item number.
    await editor.getByRole('button', { name: 'Add Column' }).click();
    await editor.getByLabel('Field 10').selectOption('thumb');
    await editor.getByLabel('Heading 10').fill('Location');
    await editor.getByLabel('Link item numbers').check();
    await editor.getByRole('button', { name: 'Save Template' }).click();
    await editor.getByRole('button', { name: 'Close' }).click();

    await app.cmd('file.exportRegister');
    const exportDialog = app.page.getByRole('dialog', { name: 'Export comment register' });
    // A short register has its pictures unless they are turned off.
    await expect(exportDialog.getByLabel('Include thumbnails')).toBeChecked();
    await exportDialog.getByRole('button', { name: 'Export', exact: true }).click();
    await expect.poll(async () => (await app.saved()).some((f) => f.name.endsWith('Kestrel pictures.xlsx')), { timeout: 30_000 }).toBe(true);
    const exported = (await app.saved()).find((f) => f.name.endsWith('Kestrel pictures.xlsx'))!;

    const parts = workbookParts(exported.bytes);
    expect(parts.names.filter((n) => n.startsWith('xl/media/')).sort()).toEqual(['xl/media/image1.jpeg', 'xl/media/image2.jpeg']);
    const sheet = (await parts.text('xl/worksheets/sheet1.xml'))!;
    expect(sheet).toContain('<hyperlink ref="A6" r:id="rId1"/><hyperlink ref="A7" r:id="rId2"/>');
    expect(sheet).toContain('<drawing r:id="rId3"/>');
    const drawing = (await parts.text('xl/drawings/drawing1.xml'))!;
    // The pictures are in the tenth column, on the comments' rows.
    expect(drawing).toContain('<xdr:col>9</xdr:col>');
    expect(drawing.match(/<xdr:twoCellAnchor/g)).toHaveLength(2);
    const target = /Id="rId2"[^>]*Target="([^"]+)"/.exec((await parts.text('xl/worksheets/_rels/sheet1.xml.rels'))!)![1]!.replace(/&amp;/g, '&');
    // It still reads as a register.
    expect((await readWorkbook(exported.bytes)).sheets[0]!.rows[4]![9]).toBe('Location');

    if (app.kind === 'desktop') {
      // The desktop app's links use its own scheme; Windows hands a clicked one to the app.
      expect(target).toMatch(/^redcolumn:\/\/markup\/\?doc=[^&]+&markup=e2e-cloud-1&name=plan\.pdf$/);
      return;
    }
    // The web app's link is its own address: opening it brings up the document at the comment.
    expect(target).toMatch(/^http:\/\/[^/]+\/\?doc=[^&]+&markup=e2e-cloud-1&name=plan\.pdf$/);
    await app.page.evaluate(() => (window.__nb.tools as unknown as { select(ids: string[]): void }).select([]));
    await app.page.goto(target);
    await app.page.waitForFunction(() => !!window.__nb?.tools);
    await expect.poll(async () => (await app.toolState()).selected, { timeout: 30_000 }).toEqual(['e2e-cloud-1']);
    // The link is followed once: it is gone from the address.
    expect(new URL(app.page.url()).search).toBe('');
  });
});
