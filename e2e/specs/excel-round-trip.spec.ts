import { buildWorkbook, type SheetSpec } from '../../apps/web/src/sheetsync/xlsx.ts';
import { readWorkbook, type CellValue } from '../../apps/web/src/sheetsync/xlsxRead.ts';
import { expect, test, type App } from '../support/app.ts';
import { PLAN, type Pt } from '../support/driver.ts';

// File › Export › Markups for Excel, then File › Import › Markups from Excel: the list goes out with
// row keys, is edited the way a designer would in Excel, and comes back through a preview as one
// undo step.

const r = PLAN.room;
const roomAt = (dy: number): Pt[] => {
  const pts: Pt[] = [[r.x, r.y + dy], [r.x + r.w, r.y + dy], [r.x + r.w, r.y + r.h + dy], [r.x, r.y + r.h + dy]];
  return [...pts, pts[0]!];
};

type Row = { id: string; status: string; comment?: string; replies?: { author: string; text: string }[] };
const rows = (app: App) =>
  app.page.evaluate(() => (window.__nb.tools.store as unknown as { all(): Row[] }).all().map((m) => ({ id: m.id, status: m.status, comment: m.comment, replies: m.replies?.map((x) => ({ author: x.author, text: x.text })) })));

/** One cloud per comment, put straight into the document: this spec is about the list, not the drawing tools. */
async function addComments(app: App, comments: string[]) {
  await app.page.evaluate(
    ([comments, rooms]) => {
      const store = window.__nb.tools.store as unknown as { add(m: object): void };
      (comments as string[]).forEach((comment, i) =>
        store.add({ id: `e2e-cloud-${i}`, type: 'cloud', pageIndex: 0, points: (rooms as [number, number][][])[i]!, style: { stroke: '#dc2626', strokeWidth: 1 }, author: 'Reviewer', createdAt: i + 1, modifiedAt: i + 1, status: 'none', comment }),
      );
    },
    [comments, comments.map((_, i) => roomAt(i * 120).slice(0, 4))] as const,
  );
  await expect.poll(async () => (await rows(app)).length).toBe(comments.length);
}

/** The exported workbook, written again with the visible sheet's cells changed: what saving it from a spreadsheet program gives. */
async function editWorkbook(bytes: Uint8Array, edit: (header: CellValue[], rows: CellValue[][]) => void): Promise<Buffer> {
  const book = await readWorkbook(bytes);
  const sheets = book.sheets.map((s): SheetSpec => {
    let table = s.rows.map((row) => [...row]);
    if (s.state === 'visible') {
      const body = table.slice(1);
      edit(table[0]!, body);
      table = [table[0]!, ...body];
    }
    return { name: s.name, state: s.state, filter: false, table: table.map((row) => row.map((v) => (v === null ? '' : typeof v === 'boolean' ? String(v) : v))) };
  });
  return Buffer.from(buildWorkbook(sheets));
}

async function importFile(app: App, buffer: Buffer) {
  const chooser = app.page.waitForEvent('filechooser');
  await app.cmd('file.importXlsx');
  await (await chooser).setFiles({ name: 'plan markups.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer });
  const dialog = app.page.getByRole('dialog', { name: 'Import from Excel' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe('Markups list to Excel and back', () => {
  test('file.exportXlsx and file.importXlsx: edits made in the workbook come back through the preview as one undo step', async ({ app }) => {
    await app.open('plan.pdf');
    await addComments(app, ['Kerb line clashes with pit lid', 'Show the batter extent']);
    const before = await rows(app);

    await app.cmd('file.exportXlsx');
    await expect.poll(async () => (await app.saved()).some((f) => f.name.endsWith(' markups.xlsx'))).toBe(true);
    const exported = (await app.saved()).find((f) => f.name.endsWith(' markups.xlsx'))!;

    // Untouched, the workbook has nothing to bring back.
    const same = await importFile(app, Buffer.from(exported.bytes));
    await expect(same.getByText('Nothing to change')).toBeVisible();
    await expect(same.getByRole('button', { name: /^Apply 0 changes/ })).toBeDisabled();
    await same.getByRole('button', { name: 'Cancel' }).click();

    // The designer sets a status, answers one comment, and types a status the document does not have.
    const edited = await editWorkbook(exported.bytes, (header, body) => {
      const at = (label: string) => header.indexOf(label);
      body[0]![at('Status')] = 'Completed';
      body[0]![at('New reply')] = 'Pit moved 300 east';
      body[1]![at('Status')] = 'Closed out';
      body.push([null, null, 'A row typed in Excel']);
    });
    const dialog = await importFile(app, edited);
    await expect(dialog.getByTestId('import-summary')).toContainText('2 rows matched (2 by row key). 1 cell to change, 1 reply to add, 0 conflicts, 1 unknown value, 1 row skipped.');
    await expect(dialog.locator('.import-excel-table tbody tr')).toHaveCount(2);
    // Mapping the unknown word to a status turns it into a change.
    await dialog.getByLabel('Map Closed out to').selectOption('Rejected');
    await expect(dialog.locator('.import-excel-table tbody tr')).toHaveCount(3);
    await dialog.getByLabel('Reply author').fill('Priya Designer');
    await dialog.getByRole('button', { name: 'Apply 3 changes' }).click();
    await expect(app.notice()).toContainText('3 changes to 2 markups');

    const after = await rows(app);
    expect(after.map((m) => m.status)).toEqual(['completed', 'rejected']);
    expect(after[0]!.replies).toEqual([{ author: 'Priya Designer', text: 'Pit moved 300 east' }]);
    expect(after.map((m) => m.comment)).toEqual(before.map((m) => m.comment));

    // The same file again: only the status the mapping was needed for is still to do, and that mapping is asked again.
    const again = await importFile(app, edited);
    await expect(again.getByTestId('import-summary')).toContainText('0 cells to change, 0 replies to add');
    await again.getByRole('button', { name: 'Cancel' }).click();

    // One undo takes the whole import back.
    await app.cmd('edit.undo');
    expect(await rows(app)).toEqual(before);
  });

  test('file.importXlsx refuses a file that is not a workbook', async ({ app }) => {
    await app.open('plan.pdf');
    const chooser = app.page.waitForEvent('filechooser');
    await app.cmd('file.importXlsx');
    await (await chooser).setFiles({ name: 'notes.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from('ID,Status\n1,Open\n') });
    await expect(app.errorBar()).toContainText('notes.xlsx failed: That file is not an Excel workbook');
  });
});
