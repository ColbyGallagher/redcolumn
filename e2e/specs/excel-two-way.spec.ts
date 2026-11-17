import { writeFileSync } from 'node:fs';
import { buildWorkbook, type SheetSpec } from '../../apps/web/src/sheetsync/xlsx.ts';
import { readWorkbook, type CellValue } from '../../apps/web/src/sheetsync/xlsxRead.ts';
import { expect, test, type App } from '../support/app.ts';

// Two-way Sync to Excel (Windows desktop app). The workbook stays closed here, so no Excel is
// needed: the app writes the file, the test changes it on disk the way saving it from Excel would,
// and the next sync brings the edits into the document. scripts/sheetsync-live-check.mjs covers the
// workbook being open in Excel.

type Row = { id: string; status: string; comment?: string; replies?: { text: string }[] };
const rows = (app: App) => app.page.evaluate(() => (window.__nb.tools.store as unknown as { all(): Row[] }).all().map((m) => ({ id: m.id, status: m.status, comment: m.comment, replies: m.replies?.map((x) => ({ text: x.text })) })));
const update = (app: App, id: string, patch: object) => app.page.evaluate(([id, patch]) => (window.__nb.tools.store as unknown as { update(id: string, patch: object): void }).update(id as string, patch as object), [id, patch] as const);

async function addComments(app: App, comments: string[]) {
  await app.page.evaluate((comments) => {
    const store = window.__nb.tools.store as unknown as { add(m: object): void };
    comments.forEach((comment, i) =>
      store.add({ id: `e2e-cloud-${i}`, type: 'cloud', pageIndex: 0, points: [[100, 100 + i * 80], [220, 100 + i * 80], [220, 160 + i * 80], [100, 160 + i * 80]], style: { stroke: '#dc2626', strokeWidth: 1 }, author: 'Reviewer', createdAt: i + 1, modifiedAt: i + 1, status: 'none', comment }),
    );
  }, comments);
  await expect.poll(async () => (await rows(app)).length).toBe(comments.length);
}

const workbook = async (app: App) => (await app.saved()).find((f) => f.name.endsWith('.xlsx'));
/** The Markups sheet as a header and rows, by header text. */
async function sheet(app: App) {
  const book = await readWorkbook((await workbook(app))!.bytes);
  const [header, ...body] = book.sheets.find((s) => s.name === 'Markups')!.rows;
  const at = (label: string) => header!.indexOf(label);
  return { book, header: header!, body, at };
}
/** Saves the workbook again with cells of the Markups sheet changed, as Excel would after someone typed in it. */
async function typeInWorkbook(app: App, edit: (body: CellValue[][], at: (label: string) => number) => void) {
  const { book, body, at } = await sheet(app);
  edit(body, at);
  const specs = book.sheets.map((s): SheetSpec => ({ name: s.name, state: s.state, filter: false, table: s.rows.map((row) => row.map((v) => (v === null ? '' : typeof v === 'boolean' ? String(v) : v))) }));
  writeFileSync((await workbook(app))!.path!, buildWorkbook(specs));
}

test.describe('two-way Sync to Excel', () => {
  test('edits saved in the workbook come into the document, and a cell changed on both sides waits for an answer', async ({ app }) => {
    test.skip(app.kind !== 'desktop' || process.platform !== 'win32', 'Sync to Excel is in the Windows desktop app');
    await app.open('plan.pdf');
    await addComments(app, ['Kerb line clashes with pit lid', 'Show the batter extent']);

    await app.cmd('takeoff.syncExcel');
    const dialog = app.page.getByRole('dialog', { name: 'Sync markups to Excel' });
    await dialog.getByRole('button', { name: 'Choose Workbook…' }).click();
    await expect(dialog.getByText('Two-way.')).toBeVisible();
    // The first cycle writes the workbook: every markup, keyed, with a New reply column.
    await expect.poll(async () => ((await workbook(app)) ? (await sheet(app)).body.length : 0), { timeout: 20_000 }).toBe(2);
    const first = await sheet(app);
    expect(first.header[0]).toBe('redcolumn key');
    expect(first.at('New reply')).toBeGreaterThan(0);
    expect(first.book.sheets.find((s) => s.name === '_redcolumn')?.state).toBe('veryHidden');

    // The designer sets a status and answers a comment, and saves.
    await typeInWorkbook(app, (body, at) => {
      body[0]![at('Status')] = 'Completed';
      body[0]![at('New reply')] = 'Pit moved 300 east';
    });
    await dialog.getByRole('button', { name: 'Sync now' }).click();
    await expect.poll(async () => (await rows(app))[0]).toMatchObject({ status: 'completed', replies: [{ text: 'Pit moved 300 east' }] });
    // The answered New reply cell is cleared by the write that follows, and nothing is applied twice.
    await expect.poll(async () => { const s = await sheet(app); return [s.body[0]![s.at('Status')], s.body[0]![s.at('New reply')] ?? null]; }, { timeout: 20_000 }).toEqual(['Completed', null]);
    expect((await rows(app))[0]!.replies).toHaveLength(1);

    // Changed on both sides: the designer says Rejected, the reviewer says Accepted.
    await typeInWorkbook(app, (body, at) => void (body[1]![at('Status')] = 'Rejected'));
    await update(app, 'e2e-cloud-1', { status: 'accepted', comment: 'Show the batter extent and toe' });
    await dialog.getByRole('button', { name: 'Sync now' }).click();
    await expect(dialog.getByText('1 cell is paused.')).toBeVisible({ timeout: 20_000 });
    expect((await rows(app))[1]!.status).toBe('accepted');
    // The rest of the row still syncs; the paused cell is left as it is in the workbook.
    await expect.poll(async () => { const s = await sheet(app); return [s.body[1]![s.at('Comments')], s.body[1]![s.at('Status')]]; }, { timeout: 20_000 }).toEqual(['Show the batter extent and toe', 'Rejected']);
    await dialog.getByRole('button', { name: "Use Excel's value for ID 2 Status" }).click();
    await expect.poll(async () => (await rows(app))[1]!.status).toBe('rejected');
    await expect(dialog.getByText('1 cell is paused.')).toBeHidden();

    await dialog.getByRole('button', { name: 'Stop syncing' }).click();
  });
});
