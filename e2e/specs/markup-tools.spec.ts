import { expect, test, type App } from '../support/app.ts';
import type { Pt } from '../support/driver.ts';

// Every markup tool on the toolbar (MARKUP_GROUPS in apps/web/src/components/ToolBar.tsx): draw it
// at known page points, then check the markup the store holds: its type, page and points.
const A: Pt = [300, 450];
const B: Pt = [500, 550];
const C: Pt = [500, 450];

/** Points match the clicks to within a hundredth of a point (screen-to-page rounding). */
function expectPoints(actual: [number, number][], expected: readonly Pt[]) {
  expect(actual).toHaveLength(expected.length);
  actual.forEach(([x, y], i) => {
    expect(x, `point ${i} x`).toBeCloseTo(expected[i]![0], 1);
    expect(y, `point ${i} y`).toBeCloseTo(expected[i]![1], 1);
  });
}

async function typeAndCommit(app: App, text: string) {
  await expect(app.page.locator('textarea.text-editor')).toBeVisible();
  await app.page.keyboard.type(text);
  await app.page.keyboard.press('Control+Enter');
  await expect(app.page.locator('textarea.text-editor')).toHaveCount(0);
}

/** Runs a command that opens the file picker and answers it with a fixture. */
async function pickFile(app: App, command: string, fixture: string) {
  const chooser = app.page.waitForEvent('filechooser');
  await app.cmd(command);
  await (await chooser).setFiles(app.fixture(fixture));
}

const DRAG: { tool: string; points: readonly Pt[] }[] = [
  { tool: 'line', points: [A, B] },
  { tool: 'arrow', points: [A, B] },
  { tool: 'ellipticalArc', points: [A, B] },
  { tool: 'rect', points: [A, B] },
  { tool: 'ellipse', points: [A, B] },
  { tool: 'cloud', points: [A, B] },
  { tool: 'redaction', points: [A, B] },
];

const CLICK: { tool: string; clicks: readonly Pt[]; finish?: 'enter'; points: readonly Pt[] }[] = [
  { tool: 'polyline', clicks: [A, C, B], finish: 'enter', points: [A, C, B] },
  { tool: 'arc', clicks: [A, [400, 400], C], points: [A, [400, 400], C] },
  // Clicking the first point again closes the shape; the closing point is not stored twice.
  { tool: 'polygon', clicks: [A, C, B, A], points: [A, C, B] },
  { tool: 'polygonCloud', clicks: [A, C, B, A], points: [A, C, B] },
];

test.describe('markup tools', () => {
  test.beforeEach(async ({ app }) => {
    await app.open('plan.pdf');
  });

  for (const { tool, points } of DRAG) {
    test(`${tool}: drag`, async ({ app }) => {
      await app.tool(tool);
      await app.drag(points[0]!, points[1]!);
      const [m, ...rest] = await app.markups();
      expect(rest).toEqual([]);
      expect(m).toMatchObject({ type: tool, page: 1, author: 'E2E Tester' });
      expectPoints(m!.points, points);
    });
  }

  for (const { tool, clicks, finish, points } of CLICK) {
    test(`${tool}: clicks`, async ({ app }) => {
      await app.tool(tool);
      await app.clicks(clicks, finish);
      const [m, ...rest] = await app.markups();
      expect(rest).toEqual([]);
      expect(m).toMatchObject({ type: tool, page: 1 });
      expectPoints(m!.points, points);
    });
  }

  test('dimension: asks for its text', async ({ app }) => {
    await app.tool('dimension');
    await app.drag(A, C);
    const ask = app.page.locator('.modal').filter({ hasText: 'Dimension Text' });
    await expect(ask).toBeVisible();
    await app.page.keyboard.type(`20'-0"`);
    await app.page.keyboard.press('Enter');
    await expect(ask).toBeHidden();
    const [m] = await app.markups();
    expect(m).toMatchObject({ type: 'dimension', text: `20'-0"` });
    expectPoints(m!.points, [A, C]);
  });

  test('pen: keeps every point of the stroke', async ({ app }) => {
    await app.tool('pen');
    const path: Pt[] = Array.from({ length: 11 }, (_, i) => [300 + i * 20, 450 + (i % 2) * 10] as Pt);
    const start = await app.at(path[0]!);
    await app.page.mouse.move(start.x, start.y);
    await app.page.mouse.down();
    for (const p of path.slice(1)) {
      const c = await app.at(p);
      await app.page.mouse.move(c.x, c.y);
    }
    await app.page.mouse.up();
    const [m] = await app.markups();
    expect(m!.type).toBe('pen');
    expectPoints([m!.points[0]!, m!.points.at(-1)!], [path[0]!, path.at(-1)!]);
    expect(m!.points.length).toBeGreaterThanOrEqual(path.length);
  });

  test('highlighter: a freehand stroke', async ({ app }) => {
    await app.tool('highlighter');
    await app.drag(A, C);
    const [m] = await app.markups();
    expect(m!.type).toBe('highlighter');
    expectPoints([m!.points[0]!, m!.points.at(-1)!], [A, C]);
  });

  test('eraser: rubbing across a pen stroke splits it', async ({ app }) => {
    await app.tool('pen');
    await app.drag([300, 450], [500, 450], 20);
    expect(await app.markups()).toHaveLength(1);
    await app.tool('eraser');
    await app.drag([400, 420], [400, 480]);
    const pieces = await app.markups();
    expect(pieces.length).toBe(2);
    for (const m of pieces) expect(m.type).toBe('pen');
    // Nothing is left where the eraser went.
    const xs = pieces.flatMap((m) => m.points.map(([x]) => x));
    expect(xs.some((x) => Math.abs(x - 400) < 2)).toBe(false);
  });

  test('eraser: whole-markup mode deletes the stroke', async ({ app }) => {
    await app.tool('pen');
    await app.drag([300, 450], [500, 450], 20);
    await app.cmd('tools.eraserWhole');
    expect((await app.command('tools.eraserWhole')).checked).toBe(true);
    await app.tool('eraser');
    await app.drag([400, 420], [400, 480]);
    expect(await app.markups()).toEqual([]);
  });

  test('eraser sizes are exclusive', async ({ app }) => {
    for (const id of ['tools.eraserSmall', 'tools.eraserMedium', 'tools.eraserLarge']) {
      await app.cmd(id);
      expect((await app.command(id)).checked, id).toBe(true);
    }
    expect((await app.command('tools.eraserSmall')).checked).toBe(false);
  });

  for (const tool of ['text', 'callout', 'flagLabel'] as const) {
    test(`${tool}: drag, then type`, async ({ app }) => {
      await app.tool(tool);
      await app.drag(A, B);
      await typeAndCommit(app, `${tool.toUpperCase()} CHECK`);
      const [m] = await app.markups();
      expect(m).toMatchObject({ type: tool, page: 1, text: `${tool.toUpperCase()} CHECK` });
      // A callout stores its leader too: 4 points.
      expect(m!.points).toHaveLength(tool === 'callout' ? 4 : 2);
    });
  }

  test('typewriter: click, then type', async ({ app }) => {
    await app.tool('typewriter');
    await app.clicks([A]);
    await typeAndCommit(app, 'EXISTING SLAB');
    const [m] = await app.markups();
    expect(m).toMatchObject({ type: 'typewriter', text: 'EXISTING SLAB' });
    expectPoints([m!.points[0]!], [A]);
  });

  test('note: the comment goes on the markup', async ({ app }) => {
    await app.tool('note');
    await app.clicks([A]);
    const dialog = app.page.locator('.modal').filter({ hasText: 'Note comment' });
    await dialog.locator('textarea').fill('Check the fan position.');
    await dialog.getByRole('button', { name: 'OK' }).click();
    const [m] = await app.markups();
    expect(m).toMatchObject({ type: 'note', comment: 'Check the fan position.' });
  });

  test('cloudPlus: a cloud and its callout', async ({ app }) => {
    await app.tool('cloudPlus');
    await app.drag(A, B);
    await typeAndCommit(app, 'CONFIRM LENGTH');
    const ms = await app.markups();
    expect(ms.map((m) => m.type).sort()).toEqual(['callout', 'cloud']);
    expect(ms.find((m) => m.type === 'callout')!.text).toBe('CONFIRM LENGTH');
    expectPoints(ms.find((m) => m.type === 'cloud')!.points, [A, B]);
  });

  test('image: picks a picture, then places it', async ({ app }) => {
    await pickFile(app, 'tool.image', 'picture.png');
    await expect.poll(async () => (await app.toolState()).tool).toBe('image');
    await app.drag(A, B);
    const [m] = await app.raw();
    expect(m).toMatchObject({ type: 'image', pageIndex: 0 });
    expect(String(m!.image)).toMatch(/^data:image\/png;base64,/);
  });

  test('attachment: picks a file, then pins it', async ({ app }) => {
    await pickFile(app, 'tool.attachment', 'notes.txt');
    await app.clicks([A]);
    const [m] = await app.raw();
    expect(m).toMatchObject({ type: 'attachment', attachment: { name: 'notes.txt', size: 34 } });
  });

  test('stamp: places the default stamp', async ({ app }) => {
    await app.tool('stamp');
    await app.drag(A, B);
    const [m] = await app.raw();
    expect(m).toMatchObject({ type: 'stamp', subject: 'Approved' });
    expect((m!.stamp as { lines: string[] }).lines[0]).toBe('APPROVED');
    expect((m!.stamp as { lines: string[] }).lines[1]).toContain('E2E Tester');
  });

  test('hyperlink: links to a page', async ({ app }) => {
    await app.tool('hyperlink');
    await app.drag(A, B);
    const dialog = app.page.locator('.modal.hyperlink-dialog');
    await dialog.locator('select[aria-label=Page]').selectOption({ label: 'Page 3' });
    await dialog.locator('button[type=submit]').click();
    const [m] = await app.raw();
    expect(m).toMatchObject({ type: 'hyperlink', link: { kind: 'page', pageIndex: 2 } });
  });

  test('space: named after drawing', async ({ app }) => {
    await app.tool('space');
    await app.clicks([A, C, B, A]);
    const dialog = app.page.locator('.modal').filter({ hasText: 'Name the Space' });
    await dialog.locator('input').first().fill('Kitchen');
    await dialog.locator('button[type=submit]').click();
    const [m] = await app.markups();
    expect(m).toMatchObject({ type: 'space', subject: 'Kitchen' });
    expectPoints(m!.points, [A, C, B]);
  });

  test('table: sized in its dialog', async ({ app }) => {
    await app.tool('table');
    await app.drag(A, B);
    const dialog = app.page.locator('.modal').filter({ hasText: 'Rows' });
    await expect(dialog).toBeVisible();
    await dialog.locator('button[type=submit]').click();
    await expect(dialog).toBeHidden();
    const [m] = await app.raw();
    expect(m).toMatchObject({ type: 'table', pageIndex: 0 });
  });

  test('legend: lists the markups on the page', async ({ app }) => {
    await app.tool('rect');
    await app.drag([600, 450], [650, 500]);
    await app.tool('cloud');
    await app.drag([700, 450], [750, 500]);
    await app.tool('legend');
    await app.drag(A, B);
    expect((await app.markups()).map((m) => m.type).sort()).toEqual(['cloud', 'legend', 'rect']);
  });

  test('lasso: selects what it encloses', async ({ app }) => {
    for (const x of [300, 400, 800]) {
      await app.tool('rect');
      await app.drag([x, 450], [x + 50, 500]);
    }
    const [r1, r2] = await app.markups();
    await app.tool('lasso');
    const loop: Pt[] = [
      [280, 430],
      [470, 430],
      [470, 520],
      [280, 520],
      [280, 430],
    ];
    const start = await app.at(loop[0]!);
    await app.page.mouse.move(start.x, start.y);
    await app.page.mouse.down();
    for (const p of loop) {
      const c = await app.at(p);
      await app.page.mouse.move(c.x, c.y, { steps: 5 });
    }
    await app.page.mouse.up();
    expect((await app.toolState()).selected.sort()).toEqual([r1!.id, r2!.id].sort());
  });

  test('snapshot: copies an area, adds no markup', async ({ app }) => {
    await app.tool('snapshot');
    await app.drag(A, B);
    expect(await app.markups()).toEqual([]);
    // The snapshot is on the markup clipboard, ready to paste.
    await expect.poll(async () => (await app.command('edit.paste')).enabled).toBe(true);
  });

  test('snapshot: clicking the corners copies an outlined area, adds no markup', async ({ app }) => {
    await app.tool('snapshot');
    await app.clicks([A, C, B, A]);
    expect(await app.markups()).toEqual([]);
    await expect.poll(async () => (await app.command('edit.paste')).enabled).toBe(true);
  });

  test('snapshot: a polygon picture is see-through outside the outline', async ({ app }) => {
    // A solid box to copy from; the outline A, C, B is the upper-right half of it.
    await app.tool('rect');
    await app.drag(A, B);
    await app.page.evaluate(() => {
      const store = window.__nb.tools.store as unknown as { all(): { id: string; style: object }[]; update(id: string, patch: object): void };
      const [m] = store.all();
      store.update(m!.id, { style: { ...m!.style, fill: '#000000', opacity: 1 } });
    });
    await app.tool('snapshot');
    await app.clicks([A, C, B, A]);
    await expect.poll(async () => (await app.command('edit.paste')).enabled).toBe(true);
    await app.cmd('edit.paste');
    const picture = (await app.raw()).find((m) => m.type === 'image');
    expect(picture).toBeTruthy();
    const alphas = await app.page.evaluate(async (src) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const g = canvas.getContext('2d')!;
      g.drawImage(img, 0, 0);
      const alphaAt = (fx: number, fy: number) => g.getImageData(Math.floor(fx * (canvas.width - 1)), Math.floor(fy * (canvas.height - 1)), 1, 1).data[3]!;
      return { inside: alphaAt(0.85, 0.15), outside: alphaAt(0.15, 0.85) };
    }, picture!.image as string);
    expect(alphas.inside).toBeGreaterThan(200);
    expect(alphas.outside).toBe(0);
  });

  test('change picture colours: lists the colours of the picture and swaps one', async ({ app }) => {
    // A solid red box, copied as a picture and pasted back over it.
    await app.tool('rect');
    await app.drag(A, B);
    await app.page.evaluate(() => {
      const store = window.__nb.tools.store as unknown as { all(): { id: string; style: object }[]; update(id: string, patch: object): void };
      const [m] = store.all();
      store.update(m!.id, { style: { ...m!.style, stroke: '#ff0000', fill: '#ff0000', opacity: 1 } });
    });
    await app.tool('snapshot');
    await app.drag([A[0] + 20, A[1] + 20], [B[0] - 20, B[1] - 20]);
    await expect.poll(async () => (await app.command('edit.paste')).enabled).toBe(true);
    await app.clearMarkups();
    await app.cmd('edit.paste');
    const picture = (await app.raw()).find((m) => m.type === 'image')!;
    const [p0, p1] = picture.points as [number, number][];
    await app.page.evaluate((id) => window.__nb.tools.select([id]), picture.id as string);
    const c = await app.at([(p0![0] + p1![0]) / 2, (p0![1] + p1![1]) / 2]);
    await app.page.mouse.click(c.x, c.y, { button: 'right' });
    await app.page.getByText('Change Picture Colours…').click();
    const dialog = app.page.locator('.modal').filter({ hasText: 'Change Picture Colours' });
    await expect(dialog.getByLabel('New colour for #ff0000')).toBeVisible();
    await dialog.getByLabel('New colour for #ff0000').fill('#0000ff');
    await dialog.getByRole('button', { name: 'OK' }).click();
    await expect(dialog).toBeHidden();
    const after = (await app.raw()).find((m) => m.id === picture.id)!;
    expect(after.image).not.toBe(picture.image);
    const pixel = await app.page.evaluate(async (src) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const g = canvas.getContext('2d')!;
      g.drawImage(img, 0, 0);
      return [...g.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data];
    }, after.image as string);
    expect(pixel).toEqual([0, 0, 255, 255]);
  });

  test.describe('text markups on the PDF text', () => {
    // Page 2: "DOOR 1   HOLLOW CORE", 12 pt Helvetica with its baseline at y 100.
    test.beforeEach(async ({ app }) => {
      await app.cmd('view.nextPage');
      await app.fit();
    });

    for (const tool of ['textHighlight', 'underline', 'strikeout', 'squiggly']) {
      test(`${tool}: snaps to the words`, async ({ app }) => {
        await app.tool(tool);
        await app.drag([58, 95], [200, 95]);
        const [m] = await app.markups();
        expect(m).toMatchObject({ type: tool, page: 2 });
        const [x0, y0] = m!.points[0]!;
        const [x1, y1] = m!.points[1]!;
        // Its box covers the line of text, around the 12 pt line ending at the baseline. It starts
        // at the "D" itself, just right of x 60 (Helvetica's D has a 0.95 pt side bearing at 12 pt).
        expect(x0).toBeGreaterThanOrEqual(60);
        expect(x0).toBeLessThan(62);
        expect(y0).toBeLessThan(92);
        expect(y1).toBeGreaterThan(99);
        expect(x1).toBeGreaterThan(150);
      });
    }

    test('replaceText: asks for the new words', async ({ app }) => {
      await app.tool('replaceText');
      await app.drag([58, 95], [100, 95]);
      const dialog = app.page.locator('.modal').filter({ hasText: 'Replace Text' });
      await expect(dialog).toContainText('Replacing "DOOR" with:');
      await app.page.keyboard.type('WINDOW');
      await app.page.keyboard.press('Enter');
      const [m] = await app.markups();
      expect(m).toMatchObject({ type: 'replaceText', page: 2, text: 'WINDOW' });
    });
  });

  test('tools.lineStyles: a line style made in the editor draws a line', async ({ app }) => {
    await app.cmd('tools.lineStyles');
    const dialog = app.page.getByRole('dialog', { name: 'Line styles' });
    await expect(dialog).toBeVisible();
    // Built-in styles are copied to change them; a new one goes into a set of the user's own.
    await dialog.getByRole('button', { name: 'New…' }).click();
    const editor = app.page.getByRole('dialog', { name: 'Edit line style' });
    await editor.locator('#ls-name').fill('E2E Gas');
    await editor.getByLabel('Component type to add').selectOption('text');
    await editor.getByRole('button', { name: 'Add component' }).click();
    await editor.getByLabel('Text', { exact: true }).fill('G');
    await editor.getByRole('button', { name: 'Save' }).click();
    await expect(dialog.getByRole('option', { name: /My Line Styles/ })).toHaveAttribute('aria-selected', 'true');
    await expect(dialog.locator('.ls-styles li.picked .name')).toHaveText('E2E Gas');
    await dialog.getByRole('button', { name: 'Done' }).click();
    await expect(dialog).toBeHidden();

    // The pickers offer it, and open the manager from their last entry.
    await app.tool('line');
    const picker = app.page.locator('select:has(option[value="manage"])').first();
    await picker.selectOption({ label: 'E2E Gas' });
    await app.drag(A, B);
    const [m] = await app.raw();
    expect(m).toMatchObject({ style: { lineStyle: { name: 'E2E Gas', spec: [true, [0, 6, -3, ['G', 'Helvetica', 6, false, false, true]]] } } });
    await picker.selectOption('manage');
    await expect(dialog).toBeVisible();
    await expect(picker).toHaveValue(/^line:/);
  });

  test.afterEach(async ({ app }) => {
    expect(app.errors).toEqual([]);
  });
});
