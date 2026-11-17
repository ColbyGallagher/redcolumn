import { buildWorkbook, type SheetSpec } from '../../apps/web/src/sheetsync/xlsx.ts';
import { readWorkbook, type CellValue } from '../../apps/web/src/sheetsync/xlsxRead.ts';
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
});
