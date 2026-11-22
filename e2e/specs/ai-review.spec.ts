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

test.describe('Review AI Takeoff: grouping columns and tools', () => {
  test.beforeEach(async ({ app }) => {
    await app.open('plan.pdf');
  });

  test('a grouping column is renamed, regrouped and accepted; a tool runs only once accepted', async ({ app }) => {
    const { page } = app;
    await app.assistant('place_markups', { page: 1, markups: [{ type: 'rect', points: [[100, 100], [150, 150]], subject: 'Door' }, { type: 'rect', points: [[300, 100], [350, 150]], subject: 'Door' }] });
    const [a, b] = (await app.markups()).map((m) => m.id) as [string, string];
    await app.assistant('propose_grouping_column', { source: 'Claude', name: 'Zone', reasoning: 'Left and right of the corridor', assignments: [{ id: a, value: 'West', reasoning: 'left of the corridor' }, { id: b, value: 'West' }] });
    const review = page.getByRole('complementary', { name: 'Review AI takeoff' });
    await expect(review).toBeVisible();
    await review.getByRole('tab', { name: /Columns/ }).click();
    // Located by position: its name (and so its label) changes below.
    const card = review.locator('.takeoff-proposal').first();
    await expect(card).toHaveAttribute('aria-label', 'Grouping column: Zone');
    await expect(card).toContainText('left of the corridor');
    await expect(card.locator('.tp-state')).toHaveText('Proposed');
    await card.getByLabel('Column name').fill('Wing');
    await card.getByLabel('Group').nth(1).fill('East');
    await expect(card.locator('.tp-state')).toHaveText('In review');
    await expect(card).toHaveAttribute('aria-label', 'Grouping column: Wing');
    await card.getByRole('button', { name: 'Accept Column' }).click();
    await expect.poll(async () => (await app.markups()).map((m) => m.fields?.Wing)).toEqual(['West', 'East']);

    // A tool: proposed, it cannot run; accepted, a run proposes a column for review.
    await app.assistant('propose_grouping_tool', { source: 'Claude', name: 'Doors', description: 'Every door in one group', reasoning: 'Doors are priced together', column: 'Trade', filter: { subject: 'Door' }, action: { kind: 'set', value: 'Joinery' } });
    await review.getByRole('tab', { name: /Tools/ }).click();
    const tool = review.getByRole('article', { name: 'Tool: Doors' });
    await expect(tool).toContainText('subject contains “Door” → Trade: set to “Joinery”');
    await expect(tool.getByRole('button', { name: 'Run on This Document' })).toHaveCount(0);
    await tool.getByRole('button', { name: 'Accept Tool' }).click();
    await tool.getByRole('button', { name: 'Run on This Document' }).click();
    // It lands on the Columns tab, marked with the tool that made it.
    const made = review.getByRole('article', { name: 'Grouping column: Trade' });
    await expect(made).toContainText('made by the tool “Doors”');
    await expect(made.locator('.tp-state')).toHaveText('Proposed');
    expect((await app.markups()).map((m) => m.fields?.Trade)).toEqual([undefined, undefined]);
  });
});

test.describe('Review AI Takeoff: the optional review pass', () => {
  test.beforeEach(async ({ app }) => {
    await app.open('plan.pdf');
    await app.calibrate();
  });

  test('off by default; requested, a fresh-context reviewer’s findings show beside the item and change nothing', async ({ app }) => {
    const { page } = app;
    const placed = await app.assistant<{ placed: { id: string }[]; reviewPass?: string }>('place_markups', { source: 'Claude', page: 1, markups: [{ type: 'length', points: [[300, 450], [500, 450]], subject: 'Kerb', confidence: 0.9, reasoning: 'first-pass thinking' }] });
    expect(placed.reviewPass).toBeUndefined();
    const id = placed.placed[0]!.id;
    const review = page.getByRole('complementary', { name: 'Review AI takeoff' });
    await expect(review).toBeVisible();
    const pass = review.getByLabel('Review pass after each AI takeoff');
    await expect(pass).not.toBeChecked();
    await review.getByRole('button', { name: 'Request Review Pass' }).click();
    await expect(review).toContainText('waiting for your AI client');

    // The reviewer's packet has the output, not the reasoning.
    const packet = await app.assistant<{ items: { item: string }[]; requested?: unknown }>('get_review_packet');
    expect(JSON.stringify(packet)).not.toContain('first-pass thinking');
    expect(packet.requested).toBeTruthy();
    await app.assistant('report_review_findings', {
      source: 'Reviewer',
      findings: [
        { item: `draft:${id}`, severity: 'issue', kind: 'quantity', message: 'The kerb stops short of the corner.', expected: { quantity: 25, unit: 'ft' } },
        { kind: 'missed', message: 'A second kerb run on the north side.', sources: [{ page: 1, bbox: { x: 300, y: 300, w: 200, h: 10 } }] },
      ],
    });
    await expect(review).not.toContainText('waiting for your AI client');
    const missed = review.getByRole('region', { name: 'Possibly missed' });
    await expect(missed).toContainText('A second kerb run on the north side.');
    const row = review.locator('.takeoff-proposal', { hasText: 'Kerb' }).filter({ has: page.locator('.tp-measure') }).first();
    await expect(row.locator(':scope > .tp-head .ar-kind.review')).toHaveText('AI review: 1');
    await row.locator('.tp-measure').click();
    const finding = row.getByRole('list', { name: 'AI review findings' });
    await expect(finding).toContainText('The kerb stops short of the corner.');
    await finding.getByRole('button', { name: 'Accept Finding' }).click();
    await expect(row.locator(':scope > .tp-head .ar-kind.review')).toHaveCount(0);
    await missed.getByRole('button', { name: 'Dismiss' }).click();
    await expect(missed).toHaveCount(0);
    // Nothing was applied: the draft is still the AI's, waiting.
    const raw = ((await app.raw()) as unknown as { id: string; ai?: { status: string } }[]).find((m) => m.id === id)!;
    expect(raw.ai!.status).toBe('pending');
  });
});
