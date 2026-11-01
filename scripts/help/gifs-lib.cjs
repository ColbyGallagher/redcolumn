// Shared set-up and moves for the tool demo GIFs (scripts/help/gifs/*.cjs): the ribbon layout,
// the panels folded away so the drawing fills the view, and the sample plan zoomed on one room.
const VIEWPORT = { width: 1280, height: 720 };
// The Markup tab is wider than the Modify tab: its Insert and Tables groups need the extra room.
const WIDE = { width: 1600, height: 780 };
// The whole window is recorded: the ribbon spans its full width.
const OPTIONS = {};

/** Opens the sample plans in the ribbon layout with only the drawing showing. */
async function prepare(h, { zoom } = {}) {
  const P = h.plan;
  // Feet and inches (the sample sheets are imperial): the setting is read when the app starts.
  await h.page.evaluate(() => localStorage.setItem('nb.settings', JSON.stringify({ unitSystem: 'imperial' })));
  await h.page.reload();
  await h.page.waitForSelector('.menubar');
  await h.open('sample-plans.pdf');
  await h.run('Window', 'Toolbar Display', 'Ribbon: Tabs and Commands');
  await h.run('Window', 'Toggle Panels');
  // 1/4" = 1'-0" is the sample sheets' scale, so lengths typed in the bar are in feet and inches.
  await h.page.locator('label.field.scale select').first().selectOption({ label: `1/4" = 1'-0"` });
  await h.wait(600);
  await h.zoomTo(...(zoom ? zoom(P) : [...P(6, 34), ...P(44, 6)]));
  return h;
}

/** Draws markups with a tool without recording (page points in feet from the sheet's corner). */
const drawing = (h) => ({
  async line(a, b) {
    await h.tool('line');
    await h.drag(h.plan(...a), h.plan(...b));
  },
  async poly(points) {
    await h.tool('polyline');
    await h.clicks(points.map((p) => h.plan(...p)), 'enter');
  },
  async rect(a, b) {
    await h.tool('rect');
    await h.drag(h.plan(...a), h.plan(...b));
  },
  async shape(tool, a, b) {
    await h.tool(tool);
    await h.drag(h.plan(...a), h.plan(...b));
  },
  /** Restyles the markup drawn last. */
  async style(patch) {
    await h.page.evaluate((patch) => {
      const st = window.__nb.tools.store;
      const m = st.all().at(-1);
      st.update(m.id, { style: { ...m.style, ...patch } });
    }, patch);
  },
  async text(a, b, text) {
    await h.tool('text');
    await h.drag(h.plan(...a), h.plan(...b));
    await h.typeText(text);
  },
  /** A freehand stroke (plan points in feet), not recorded. */
  async pen(points) {
    await h.tool('pen');
    const cs = [];
    for (const p of points) cs.push(await h.at(...h.plan(...p)));
    await h.page.mouse.move(cs[0].x, cs[0].y);
    await h.page.mouse.down();
    for (const c of cs) await h.page.mouse.move(c.x, c.y);
    await h.page.mouse.up();
  },
  async ellipse(a, b) {
    await h.tool('ellipse');
    await h.drag(h.plan(...a), h.plan(...b));
  },
  async done() {
    await h.tool('select');
    await h.page.keyboard.press('Escape');
    await h.wait(300);
  },
});

/** Recorded: opens a ribbon tab and clicks one of its buttons. */
async function ribbon(h, rec, tab, command) {
  const { page } = h;
  const tabBtn = page.locator(`[data-ribbon-tab=${tab}]`);
  if ((await tabBtn.getAttribute('aria-selected')) !== 'true') await rec.click(tabBtn);
  await rec.click(page.locator(`[data-ribbon-command="${command}"]`));
}

/** Recorded: opens the Markup tab and clicks a tool's button. */
async function markupTool(h, rec, tool) {
  const { page } = h;
  const tabBtn = page.locator('[data-ribbon-tab=markup]');
  if ((await tabBtn.getAttribute('aria-selected')) !== 'true') await rec.click(tabBtn);
  await rec.click(page.locator(`.rb-body [data-toolbar-tool="${tool}"]`));
}

/** Recorded: opens a menu from the menu bar and follows `path`, hovering submenus and clicking the last item. */
async function menuPath(h, rec, title, ...path) {
  const { page } = h;
  await rec.click(page.locator('.menubar .menu-title', { hasText: new RegExp(`^${title}$`) }));
  await rec.hold(200);
  for (const label of path.slice(0, -1)) {
    const c = await rec.centre(h.item(label));
    await rec.move(c.x, c.y);
    await page.waitForTimeout(400);
    await rec.hold(200);
  }
  await rec.click(h.item(path[path.length - 1]));
}

/** Screen point of a plan point in feet. */
const at = (h) => (x, y) => h.at(...h.plan(x, y));

/** Recorded: selects markups by clicking each (shift for more than one). */
async function select(h, rec, points) {
  for (let i = 0; i < points.length; i++) {
    if (i) await h.page.keyboard.down('Shift');
    await rec.click(await at(h)(...points[i]));
    if (i) await h.page.keyboard.up('Shift');
  }
}

/**
 * Defines a demo. `setup(d, h)` draws what the demo works on (not recorded); `play(ctx)` is the
 * recording: ctx has rec, page, bar (the CAD bar), pt(x, y) (a plan point in feet on screen),
 * click(x, y), go(x, y), modify(command), pick(...points), field(label, text) and typed(text).
 */
function demo(name, { setup, play, hold = 1400, viewport = VIEWPORT, zoom }) {
  const fn = async (h, rec) => {
    const { page } = h;
    await prepare(h, { zoom });
    const d = drawing(h);
    await setup(d, h);
    await d.done();
    await rec.start();
    await rec.hold(600);
    const pt = at(h);
    const bar = page.locator('.cad-bar');
    const ctx = {
      h,
      rec,
      page,
      bar,
      pt,
      click: async (x, y, o) => rec.click(await pt(x, y), o),
      go: async (x, y, o) => rec.move((await pt(x, y)).x, (await pt(x, y)).y, o),
      drag: async (a, b, o) => rec.drag(await pt(...a), await pt(...b), o),
      modify: (command) => ribbon(h, rec, 'modify', command),
      tool: (name) => markupTool(h, rec, name),
      menu: (title, ...path) => menuPath(h, rec, title, ...path),
      /** A point in page units (points from the sheet's top-left) on screen. */
      pp: (x, y) => h.at(x, y),
      clickPt: async (x, y, o) => rec.click(await h.at(x, y), o),
      dragPt: async (a, b) => rec.drag(await h.at(...a), await h.at(...b)),
      /** A freehand stroke through plan points in feet. */
      async stroke(points) {
        const cs = [];
        for (const p of points) cs.push(await pt(...p));
        await rec.path(cs);
      },
      /** Picks a file in the file picker the next click opens, then goes on. */
      async chooseFile(action, name) {
        const chooser = page.waitForEvent('filechooser');
        await action();
        await (await chooser).setFiles(h.sample(name));
        await h.wait(800);
      },
      pick: (...points) => select(h, rec, points),
      /** Clicks a field in the bar and types into it (replacing what is there). */
      async field(label, text) {
        await rec.click(bar.getByLabel(label, { exact: true }));
        await page.keyboard.press('Control+a');
        await rec.type(text, { perFrame: 2 });
      },
    };
    await play(ctx);
    await rec.hold(hold);
  };
  fn.gif = name;
  fn.viewport = viewport;
  fn.options = OPTIONS;
  return fn;
}

module.exports = { VIEWPORT, WIDE, OPTIONS, prepare, drawing, ribbon, markupTool, menuPath, at, select, demo };
