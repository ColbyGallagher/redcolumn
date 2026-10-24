import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFString } from 'pdf-lib';
import { expect, test, type App } from '../support/app.ts';
import type { Pt } from '../support/driver.ts';

// The Diagram tab: flowchart shapes placed with a click, steps added after a shape, connectors
// drawn between shapes that follow them when they move, and shapes changed into other shapes.

const ribbon = (app: App) => app.page.locator('.ribbon');
const button = (app: App, id: string) => ribbon(app).locator(`[data-ribbon-command="${id}"]`);
const select = (app: App, ids: string[]) => app.page.evaluate((ids) => window.__nb.tools.select(ids), ids);

type Raw = { id: string; type: string; points: [number, number][]; text?: string; flowShape?: string; connect?: { from?: { id: string; side?: string }; to?: { id: string; side?: string }; route?: string } };
const raw = async (app: App) => (await app.raw()) as unknown as Raw[];
/** Page points to a tenth of a point (clicks go through screen pixels). */
const round = (n: number) => Math.round(n * 10) / 10;
const pts = (m: Raw) => m.points.map(([x, y]) => [round(x), round(y)]);
const box = (m: Raw) => {
  const [[x0, y0], [x1, y1]] = m.points as [[number, number], [number, number]];
  return { x: round(Math.min(x0, x1)), y: round(Math.min(y0, y1)), w: round(Math.abs(x1 - x0)), h: round(Math.abs(y1 - y0)) };
};

async function typeAndCommit(app: App, text: string) {
  await expect(app.page.locator('textarea.text-editor')).toBeVisible();
  await app.page.keyboard.type(text);
  await app.page.keyboard.press('Control+Enter');
  await expect(app.page.locator('textarea.text-editor')).toHaveCount(0);
}

test.describe('diagram', () => {
  test.use({ toolbar: 'ribbon' });

  test.beforeEach(async ({ app }) => {
    await app.open('plan.pdf');
    await app.clearMarkups();
    await ribbon(app).getByRole('tab', { name: 'Diagram' }).click();
  });

  test('builds a flowchart a step at a time from the ribbon', async ({ app }) => {
    const at: Pt = [300, 150];
    await button(app, 'diagram.terminator').click();
    expect((await app.command('diagram.terminator')).checked).toBe(true);
    await app.clicks([at]);
    await typeAndCommit(app, 'Start');
    const [start] = await raw(app);
    // A click places Start / End at its usual size (120 x 50), centred on the click.
    expect(start).toMatchObject({ type: 'flowShape', flowShape: 'terminator', text: 'Start' });
    expect(box(start!)).toEqual({ x: 240, y: 125, w: 120, h: 50 });

    // Add Step Below: a Process step 40 pt under it, joined by a connector, ready to type.
    await select(app, [start!.id]);
    await button(app, 'diagram.addBelow').click();
    await typeAndCommit(app, 'Check drawings');
    const all = await raw(app);
    const step = all.find((m) => m.type === 'flowShape' && m.id !== start!.id)!;
    const link = all.find((m) => m.type === 'connector')!;
    expect(step).toMatchObject({ flowShape: 'process', text: 'Check drawings' });
    expect(box(step)).toEqual({ x: 240, y: 215, w: 120, h: 60 });
    expect(link.connect).toMatchObject({ from: { id: start!.id }, to: { id: step.id } });
    // Straight down from the middle of one to the middle of the next.
    expect(pts(link)).toEqual([[300, 175], [300, 215]]);

    // Change Shape turns the selected step into a decision (same box, text and connector).
    await select(app, [step.id]);
    await ribbon(app).getByLabel('Change Shape').selectOption('decision');
    const changed = (await raw(app)).find((m) => m.id === step.id)!;
    expect(changed).toMatchObject({ flowShape: 'decision', text: 'Check drawings' });
    expect(box(changed)).toEqual(box(step));

    // Dragging the start shape up and right takes the connector along: it now bends at right angles.
    await app.tool('select');
    await app.drag([300, 150], [500, 65]);
    const moved = (await raw(app)).find((m) => m.type === 'connector')!.points;
    const near = (p: [number, number], q: [number, number]) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1;
    // Out of the bottom of the moved shape (440..560 x 40..90), into the top of the step.
    expect(near(moved[0]!, [500, 90]), `starts at ${moved[0]}`).toBe(true);
    expect(near(moved.at(-1)!, [300, 215]), `ends at ${moved.at(-1)}`).toBe(true);
    expect(moved.length).toBe(4);
    for (let i = 1; i < moved.length; i++) {
      const [p, q] = [moved[i - 1]!, moved[i]!];
      expect(Math.abs(p[0] - q[0]) < 1e-6 || Math.abs(p[1] - q[1]) < 1e-6, `piece ${i} is square`).toBe(true);
    }
  });

  test('connector tool glues to the shapes it is dragged between, and Connect joins a selection', async ({ app }) => {
    await button(app, 'diagram.process').click();
    await app.clicks([[200, 200]]);
    await typeAndCommit(app, 'A');
    await button(app, 'diagram.process').click();
    await app.clicks([[450, 200]]);
    await typeAndCommit(app, 'B');
    await button(app, 'diagram.data').click();
    await app.clicks([[450, 400]]);
    await typeAndCommit(app, 'C');
    const [a, b, c] = await raw(app);

    await button(app, 'tool.connector').click();
    expect((await app.command('tool.connector')).checked).toBe(true);
    await app.drag([200, 200], [450, 200]);
    const drawn = (await raw(app)).find((m) => m.type === 'connector')!;
    expect(drawn.connect).toMatchObject({ from: { id: a!.id }, to: { id: b!.id }, route: 'elbow' });
    // Side by side: from A's right side to B's left side.
    expect(pts(drawn)).toEqual([[260, 200], [390, 200]]);

    // Double-clicking it gives it text.
    await app.tool('select');
    const mid = await app.at([325, 200]);
    await app.page.mouse.dblclick(mid.x, mid.y);
    const dialog = app.modal();
    await dialog.locator('input, textarea').first().fill('Yes');
    await dialog.locator('button[type=submit]').click();
    await expect.poll(async () => (await raw(app)).find((m) => m.type === 'connector')?.text).toBe('Yes');

    // Connect Shapes joins B and C (A and B are joined already); Straight makes the new one a line.
    await select(app, [a!.id, b!.id, c!.id]);
    await app.cmd('diagram.straight');
    await button(app, 'diagram.connect').click();
    const connectors = (await raw(app)).filter((m) => m.type === 'connector');
    expect(connectors).toHaveLength(2);
    const bc = connectors.find((m) => m.connect?.from?.id === b!.id && m.connect.to?.id === c!.id)!;
    expect(bc.connect?.route).toBe('straight');
    expect(pts(bc)).toEqual([[450, 230], [450, 370]]);
  });

  test('a connector segment drags across by its handle, a bend is added with Ctrl+double-click, and the route can be reset', async ({ app }) => {
    await button(app, 'diagram.process').click();
    await app.clicks([[200, 200]]);
    await typeAndCommit(app, 'A');
    await button(app, 'diagram.process').click();
    await app.clicks([[500, 420]]);
    await typeAndCommit(app, 'B');
    await button(app, 'tool.connector').click();
    await app.drag([200, 200], [500, 420]);
    await app.tool('select');
    let c = (await raw(app)).find((m) => m.type === 'connector')!;
    await select(app, [c.id]);
    // Across, down, across: the down segment's handle is halfway down it.
    const [, p1, p2] = c.points as [number, number][];
    expect(p1![0]).toBe(p2![0]);
    await app.drag([p1![0], (p1![1] + p2![1]) / 2], [p1![0] + 60, (p1![1] + p2![1]) / 2]);
    c = (await raw(app)).find((m) => m.type === 'connector')! as Raw & { connect?: { bends?: { first: string; mids: number[] } } };
    expect(round(c.points[1]![0])).toBe(round(p1![0] + 60));
    expect((c.connect as { bends?: unknown }).bends).toBeTruthy();
    // One undo step for the drag.
    await app.cmd('edit.undo');
    expect(round((await raw(app)).find((m) => m.type === 'connector')!.points[1]![0])).toBe(round(p1![0]));
    await app.cmd('edit.redo');
    // Ctrl+double-click on the first segment adds a bend (two more segments).
    await select(app, [c.id]);
    const first = await app.at([(c.points[0]![0] + c.points[1]![0]) / 2, c.points[0]![1]]);
    await app.page.keyboard.down('Control');
    await app.page.mouse.dblclick(first.x, first.y);
    await app.page.keyboard.up('Control');
    await expect.poll(async () => ((await raw(app)).find((m) => m.type === 'connector')!.connect as { bends?: { mids: number[] } }).bends?.mids.length).toBe(3);
    // Reset Route (right-click) routes it automatically again.
    await app.page.evaluate((id) => window.__nb.tools.setRouteOf(id, 'reset'), c.id);
    expect(((await raw(app)).find((m) => m.type === 'connector')!.connect as { bends?: unknown }).bends).toBeUndefined();
  });

  test('shapes and connectors save into the PDF', async ({ app }) => {
    await button(app, 'diagram.process').click();
    await app.clicks([[300, 200]]);
    await typeAndCommit(app, 'Saved step');
    const [m] = await app.markups();
    expect(m).toMatchObject({ type: 'flowShape', text: 'Saved step' });
    await select(app, [(await raw(app))[0]!.id]);
    await button(app, 'diagram.addRight').click();
    await typeAndCommit(app, 'Next');
    await app.cmd('file.saveAs');
    await expect.poll(async () => (await app.saved()).length, { timeout: 30_000 }).toBeGreaterThan(0);
    const doc = await PDFDocument.load((await app.saved()).at(-1)!.bytes);
    const annots = doc.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray).asArray().map((ref) => doc.context.lookup(ref, PDFDict));
    const ours = annots.filter((d) => d.has(PDFName.of('NBData')));
    const text = (d: PDFDict) => d.lookupMaybe(PDFName.of('Contents'), PDFString, PDFHexString)?.decodeText();
    // Other PDF tools see the shapes as outlines with their text, the connector as a line with an arrow.
    expect(ours.map((d) => [d.get(PDFName.of('Subtype'))?.toString(), text(d)])).toEqual([
      ['/Polygon', 'Saved step'],
      ['/Polygon', 'Next'],
      ['/PolyLine', undefined],
    ]);
  });
});
