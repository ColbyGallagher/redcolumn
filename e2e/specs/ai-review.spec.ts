import { expect, test } from '../support/app.ts';

interface Raw {
  id: string;
  subject?: string;
  ai?: { status: string; review?: { by: string }; original: { subject?: string } };
}

test.describe('Review AI Takeoff', () => {
  test.beforeEach(async ({ app }) => {
    await app.open('plan.pdf');
    await app.calibrate();
  });

  test('measurements the AI draws are drafts, least sure first, approved or rejected by a person', async ({ app }) => {
    const { page } = app;
    await page.evaluate(() => {
      const store = (window.__nb.tools as unknown as { store: { setAssemblies(a: unknown[]): void } }).store;
      store.setAssemblies([{ id: 'kerb', name: 'Kerb', variables: [], items: [{ id: 'k', name: 'Kerb', unit: 'ft', formula: '[Length]' }] }]);
    });
    const placed = await app.assistant<{ placed: { id: string; draft?: boolean }[] }>('place_markups', {
      source: 'Claude',
      page: 1,
      markups: [
        { type: 'length', points: [[300, 450], [500, 450]], subject: 'Kerb', assembly: 'Kerb', confidence: 0.95, reasoning: 'Kerb line type from the legend', sources: [{ page: 1, bbox: { x: 40, y: 40, w: 120, h: 30 }, text: 'KERB', kind: 'legend' }] },
        { type: 'length', points: [[300, 520], [420, 520]], subject: 'Kerb', assembly: 'Kerb', confidence: 0.35, reasoning: 'Might be a kerb' },
      ],
    });
    expect(placed.placed.map((p) => p.draft)).toEqual([true, true]);
    const [sure, unsure] = placed.placed.map((p) => p.id) as [string, string];

    // The review opens by itself, the least sure first and flagged.
    const review = page.getByRole('complementary', { name: 'Review AI takeoff' });
    await expect(review).toBeVisible();
    const rows = review.locator('.takeoff-proposal');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0).locator('.ar-conf')).toHaveText('⚑ 35%');
    await expect(rows.nth(1).locator('.ar-conf')).toHaveText('95%');

    // Drafts are left out of the totals.
    await review.getByRole('button', { name: 'Close takeoff review' }).click();
    await app.cmd('tools.quantities');
    const totals = page.getByRole('dialog', { name: 'Takeoff quantities' });
    await expect(totals.locator('tbody tr', { hasText: 'Kerb' })).toHaveCount(0);
    await totals.getByRole('button', { name: 'Close', exact: true }).click();

    // The sure one: its source and reasoning, a subject changed by a person, then approved.
    await app.cmd('tools.takeoffReview');
    const sureRow = rows.nth(1);
    await sureRow.locator('.tp-measure').click();
    await expect(sureRow.getByRole('list', { name: 'Sources' })).toContainText('KERB');
    await expect(sureRow).toContainText('Kerb line type from the legend');
    await sureRow.getByLabel('Subject').fill('Kerb type 1');
    await sureRow.getByRole('button', { name: 'Approve', exact: true }).click();
    await expect(rows).toHaveCount(1);
    const raw = async (id: string) => ((await app.raw()) as unknown as Raw[]).find((m) => m.id === id);
    await expect.poll(async () => (await raw(sure))?.ai?.status).toBe('approved');
    expect((await raw(sure))!.ai!.original.subject).toBe('Kerb');
    expect((await raw(sure))!.subject).toBe('Kerb type 1');

    // The unsure one is rejected with the keyboard: it comes off the drawing.
    await rows.nth(0).locator('.tp-measure').click();
    await rows.nth(0).locator('.tp-measure').press('r');
    await expect(rows).toHaveCount(0);
    await expect.poll(async () => await raw(unsure)).toBeUndefined();

    // All, with decisions: the approved one is marked edited; the rejected one can come back.
    await review.getByLabel('Show').selectOption('all');
    await expect(rows).toHaveCount(2);
    await expect(review.locator('.takeoff-proposal.approved .ar-edited')).toBeVisible();
    const rejected = review.locator('.takeoff-proposal.rejected');
    // Still open from the R that rejected it.
    await expect(rejected.locator('.tp-measure')).toHaveAttribute('aria-expanded', 'true');
    await rejected.getByRole('button', { name: 'Review Again' }).click();
    await expect.poll(async () => (await raw(unsure))?.ai?.status).toBe('pending');

    // The approved one counts now.
    await review.getByRole('button', { name: 'Close takeoff review' }).click();
    await app.cmd('tools.quantities');
    await expect(totals.locator('tbody tr', { hasText: 'Kerb' })).toHaveCount(1);
    await totals.getByRole('button', { name: 'Close', exact: true }).click();

    const listed = await app.assistant<{ drafts: { id: string; state: string }[] }>('list_takeoff_proposals');
    expect(Object.fromEntries(listed.drafts.map((d) => [d.id, d.state]))).toEqual({ [sure]: 'approved', [unsure]: 'pending' });
  });
});
