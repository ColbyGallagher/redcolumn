import { expect, test, type App } from '../support/app.ts';

// Close-out: what is still open on each sheet, the revision a comment was raised on, and Slip Sheet
// leaving closed comments behind when a new revision comes in.

type Row = { id: string; status: string; raisedRev?: string };
const rows = (app: App) => app.page.evaluate(() => (window.__nb.tools.store as unknown as { all(): Row[] }).all().map((m) => ({ id: m.id, status: m.status, raisedRev: m.raisedRev })));

async function setUp(app: App) {
  await app.open('plan.pdf');
  await app.page.evaluate(() => {
    const store = window.__nb.tools.store as unknown as { add(m: object): void; setDetectedSheets(entries: [number, object][]): void };
    // The sheet as its title block would be read (the fictional Kestrel Road set).
    store.setDetectedSheets([[0, { number: 'KR-C-101', title: 'General arrangement', discipline: null, scaleText: null, revision: 'B', source: 'manual', confidence: 1 }]]);
    const cloud = (i: number, patch: object) =>
      store.add({ id: `e2e-cloud-${i}`, type: 'cloud', pageIndex: 0, points: [[100, 100 + i * 80], [220, 100 + i * 80], [220, 160 + i * 80], [100, 160 + i * 80]], style: { stroke: '#dc2626', strokeWidth: 1 }, author: 'Reviewer', createdAt: i + 1, modifiedAt: i + 1, status: 'none', ...patch });
    cloud(0, { comment: 'Kerb line clashes with pit lid' });
    cloud(1, { comment: 'Show the batter extent', status: 'completed' });
    cloud(2, { comment: 'Label the culvert', status: 'rejected' });
    // Ticked off, but it says nothing: not a comment.
    cloud(3, { status: 'completed' });
  });
  await expect.poll(async () => (await rows(app)).length).toBe(4);
}

test.describe('close-out', () => {
  test('document.closeOut: open and closed comments by sheet, and going to one', async ({ app }) => {
    await setUp(app);
    await app.cmd('document.closeOut');
    const dialog = app.page.getByRole('dialog', { name: 'Close-out' });
    // Rejected is still open; Completed is closed.
    await expect(dialog.getByTestId('close-out-summary')).toHaveText('2 open, 1 closed on 1 sheet');
    const sheet = dialog.locator('tr.close-out-sheet');
    await expect(sheet).toHaveCount(1);
    await expect(sheet.locator('td')).toHaveText([/KR-C-101/, 'General arrangement', 'B', '2', '1']);
    await sheet.click();
    await expect(dialog.locator('tr.close-out-comment')).toHaveCount(2);
    await dialog.getByLabel('Show comments').selectOption('all');
    await expect(dialog.locator('tr.close-out-comment')).toHaveCount(3);
    await expect(dialog.locator('tr.close-out-comment').nth(1)).toContainText('Show the batter extent');
    await expect(dialog.locator('tr.close-out-comment').nth(1)).toContainText('Completed (closed)');

    await dialog.locator('tr.close-out-comment').first().click();
    await expect(dialog).toBeHidden();
    await expect.poll(async () => (await app.toolState()).selected).toEqual(['e2e-cloud-0']);
  });

  test('document.slipSheet: closed comments are left behind, open ones carry forward with the revision they were raised on', async ({ app }) => {
    await setUp(app);
    await app.cmd('document.slipSheet');
    const dialog = app.page.locator('form.slip-sheet');
    await dialog.locator('input[type=file]').setInputFiles(app.fixture('plan-rev1.pdf'));
    await dialog.getByLabel('By page order').check();
    await dialog.getByLabel('Move markups to line up with the new sheets').uncheck();
    await expect(dialog.getByText('Every comment carries forward')).toBeVisible();
    await dialog.getByLabel('Leave closed comments behind').check();
    await expect(dialog.getByText('1 in this document now')).toBeVisible();
    await dialog.getByRole('button', { name: 'Slip Sheet' }).click();

    await expect(app.page.locator('.notice')).toContainText('left 1 closed comment behind', { timeout: 60_000 });
    // The completed comment stayed with the old revision; the open and the rejected one came along, raised at B.
    expect(await rows(app)).toEqual([
      { id: 'e2e-cloud-0', status: 'none', raisedRev: 'B' },
      { id: 'e2e-cloud-2', status: 'rejected', raisedRev: 'B' },
      { id: 'e2e-cloud-3', status: 'completed' },
    ]);

    await app.cmd('document.closeOut');
    const closeOut = app.page.getByRole('dialog', { name: 'Close-out' });
    await expect(closeOut.getByTestId('close-out-summary')).toHaveText('2 open, 0 closed on 1 sheet');
    await closeOut.locator('tr.close-out-sheet').click();
    await expect(closeOut.locator('tr.close-out-comment').first()).toContainText('Raised at B');
  });
});
