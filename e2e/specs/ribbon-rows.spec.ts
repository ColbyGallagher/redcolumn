import { expect, test } from '../support/app.ts';

// Every ribbon group keeps to three rows of buttons, and no row starts behind the group's label
// (the Modify tab's Align group once wrapped to four rows and its last row sat behind the label,
// unclickable). Buttons' padding may reach a few pixels into the label strip; a row may not start there.

test.describe('ribbon layout', () => {
  test.use({ toolbar: 'ribbon' });

  test.beforeEach(async ({ app }) => {
    await app.open('plan.pdf');
  });

  test('no group runs past three rows or under its label, on any tab', async ({ app }) => {
    const ribbon = app.page.locator('.ribbon');
    const tabs = await ribbon.getByRole('tab').allTextContents();
    expect(tabs.length).toBeGreaterThan(5);

    for (const name of tabs) {
      await ribbon.getByRole('tab', { name, exact: true }).click();
      await expect(ribbon.getByRole('tab', { name, exact: true })).toHaveAttribute('aria-selected', 'true');

      const problems = await app.page.evaluate(() => {
        const out: string[] = [];
        const groups = document.querySelectorAll<HTMLElement>('.ribbon .rb-group');
        for (const group of groups) {
          const label = group.querySelector<HTMLElement>('.rb-group-label')!;
          const items = group.querySelector<HTMLElement>('.rb-items')!;
          const name = label.textContent ?? '?';
          const labelTop = label.getBoundingClientRect().top;
          for (const el of items.querySelectorAll<HTMLElement>('*')) {
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) continue;
            if (r.top >= labelTop - 0.5) out.push(`${name}: <${el.tagName.toLowerCase()} class="${el.className}"> starts at ${r.top}, behind the label (top ${labelTop})`);
          }
          // Rows are the distinct tops among a stack's or grid's visible buttons.
          for (const box of items.querySelectorAll<HTMLElement>('.rb-stack, .rb-icon-grid')) {
            const tops = new Set<number>();
            for (const child of Array.from(box.children) as HTMLElement[]) {
              const r = child.getBoundingClientRect();
              if (r.width > 0 && r.height > 0) tops.add(Math.round(r.top));
            }
            if (tops.size > 3) out.push(`${name}: ${box.className} has ${tops.size} rows`);
          }
        }
        return out;
      });
      expect(problems, `tab ${name}`).toEqual([]);
    }
  });
});
