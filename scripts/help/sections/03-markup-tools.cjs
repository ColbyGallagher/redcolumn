// Markup Tools: where each tool is, and what drawing with it looks like.
const GROUP = {
  line: 'Lines & Shapes',
  arrow: 'Lines & Shapes',
  dimension: 'Lines & Shapes',
  polyline: 'Lines & Shapes',
  arc: 'Lines & Shapes',
  ellipticalArc: 'Lines & Shapes',
  rect: 'Lines & Shapes',
  ellipse: 'Lines & Shapes',
  polygon: 'Lines & Shapes',
  cloud: 'Lines & Shapes',
  polygonCloud: 'Lines & Shapes',
  cloudPlus: 'Lines & Shapes',
  pen: 'Freehand',
  highlighter: 'Freehand',
  textHighlight: 'Text Markup',
  underline: 'Text Markup',
  strikeout: 'Text Markup',
  squiggly: 'Text Markup',
  replaceText: 'Text Markup',
  text: 'Text & Notes',
  callout: 'Text & Notes',
  typewriter: 'Text & Notes',
  flagLabel: 'Text & Notes',
  note: 'Text & Notes',
  image: 'Other',
  flag: 'Other',
  legend: 'Other',
};

module.exports = async function (h) {
  const { page } = h;
  const P = h.plan;
  await h.open('sample-plans.pdf');
  await h.zoomTo(...P(5, 52), ...P(67, 9));
  const view = await page.evaluate(() => window.__nb.viewer.getView());
  const reset = async () => {
    await page.evaluate(() => {
      const t = window.__nb.tools;
      t.setTool('select');
      t.select([]);
    });
    await page.evaluate((v) => window.__nb.viewer.setView(v), view);
    await h.wait(300);
  };
  /** Removes every markup, so each shot shows only its own. */
  const clear = async () => {
    await page.evaluate(() => {
      const s = window.__nb.tools.store;
      s.remove(s.all().map((m) => m.id));
    });
  };

  /** Where to find a tool: its toolbar button, or Tools › Markup › group. */
  async function where(tool, label) {
    const btn = page.locator(`.toolbar.tools [data-toolbar-tool="${tool}"]`);
    if (await btn.count()) {
      await h.mark(btn);
      await h.shot(`pick-${tool}`, { around: [page.locator('.toolbar.tools .btn.tool').first(), btn], pad: 14, minWidth: 260 });
      return;
    }
    await h.menu('Tools', 'Markup', GROUP[tool]);
    await h.mark(h.item(label), { numbers: false });
    await h.shot(`pick-${tool}`, { around: ['.menu-drop', '.menu-flyout'], pad: 12 });
    await h.closeMenus();
  }

  /** The area of the page around page points, as a crop. */
  async function region(a, b, pad = 60) {
    const p = await h.at(...a);
    const q = await h.at(...b);
    return { x: Math.min(p.x, q.x) - pad, y: Math.min(p.y, q.y) - pad, width: Math.abs(q.x - p.x) + 2 * pad, height: Math.abs(q.y - p.y) + 2 * pad };
  }

  /** Crops to the area a-b grown to hold every markup on the page, kept inside the drawing area. */
  async function result(name, a, b, pad = 60) {
    const box = await page.evaluate(
      ([a, b, pad]) => {
        const v = window.__nb.viewer;
        const i = v.currentPageIndex;
        const pts = [a, b];
        for (const m of window.__nb.tools.store.all()) if (m.pageIndex === i) pts.push(...m.points);
        const c = pts.map((p) => v.pageToClient(p, i));
        const xs = c.map((p) => p[0]);
        const ys = c.map((p) => p[1]);
        const stage = document.querySelector('main.stage').getBoundingClientRect();
        const x0 = Math.max(stage.left, Math.min(...xs) - pad);
        const y0 = Math.max(stage.top, Math.min(...ys) - pad);
        const x1 = Math.min(stage.right, Math.max(...xs) + pad);
        const y1 = Math.min(stage.bottom, Math.max(...ys) + pad);
        return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
      },
      [a, b, pad],
    );
    await h.shot(name, { around: [box], pad: 0 });
  }

  // The toolbar, and its right-click menu.
  {
    const tools = page.locator('.toolbar.tools .btn.tool');
    const n = await tools.count();
    const marks = [];
    for (let i = 0; i < n; i++) marks.push({ t: tools.nth(i), at: i % 2 ? 'bl' : 'tl' });
    await h.mark(marks, { pad: 1 });
    await h.shot('toolbar-numbered', { around: [tools.first(), tools.last()], pad: 22 });
  }
  await page.locator('.toolbar.tools [data-toolbar-tool="cloud"]').click({ button: 'right' });
  await h.wait(300);
  await page.locator('.ctx-menu .menu-item, .context-menu .menu-item, [role=menu] [role=menuitem]').filter({ hasText: 'Toolbar Tools' }).first().hover();
  await h.wait(300);
  await page.locator('[role=menu] [role=menuitem]').filter({ hasText: /^Markup/ }).last().hover();
  await h.wait(300);
  await h.shot('toolbar-menu', { around: ['[role=menu]'], pad: 12 });
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await h.menu('Tools', 'Markup');
  await h.shot('tools-menu-markup', { around: ['.menu-drop', '.menu-flyout'], pad: 12 });
  await h.closeMenus();

  // Lines.
  await reset();
  await where('line', 'Line');
  await h.tool('line');
  await h.drag(P(10, 27), P(28, 20));
  await result('draw-line', P(10, 27), P(28, 20));
  await where('arrow', 'Arrow');
  await h.tool('arrow');
  await h.drag(P(52, 44), P(46, 37));
  await result('draw-arrow', P(52, 44), P(46, 37));
  await clear();
  await where('dimension', 'Dimension');
  await h.tool('dimension');
  await h.drag(P(38.5, 50), P(64, 50));
  await h.wait(400);
  await h.shot('dimension-text', { around: ['.modal'], pad: 20 });
  await page.keyboard.type("26'-0\"");
  await page.keyboard.press('Enter');
  await h.wait(300);
  await result('draw-dimension', P(38, 52), P(64, 47));
  await clear();
  await where('polyline', 'Polyline');
  await h.tool('polyline');
  await h.clicks([P(12, 16), P(20, 16), P(20, 24), P(30, 24)]);
  await result('draw-polyline-progress', P(12, 15), P(30, 25));
  await page.keyboard.press('Enter');
  await h.wait(200);
  await result('draw-polyline', P(12, 15), P(30, 25));
  await clear();
  await where('arc', 'Arc');
  await h.tool('arc');
  await h.clicks([P(42, 16), P(48, 21), P(56, 16)]);
  await result('draw-arc', P(42, 15), P(56, 22));
  await clear();
  await where('ellipticalArc', 'Elliptical Arc');
  await h.tool('ellipticalArc');
  await h.drag(P(42, 30), P(58, 18));
  await result('draw-elliptical-arc', P(42, 30), P(58, 18));
  await clear();

  // Shapes.
  await where('rect', 'Rectangle');
  await h.tool('rect');
  await h.drag(P(9.5, 47.5), P(21, 30.5));
  await result('draw-rect', P(9.5, 47.5), P(21, 30.5));
  await where('ellipse', 'Ellipse');
  await h.tool('ellipse');
  await h.drag(P(44, 34), P(58, 26));
  await result('draw-ellipse', P(44, 34), P(58, 26));
  await clear();
  await where('polygon', 'Polygon');
  await h.tool('polygon');
  await h.clicks([P(39, 47), P(63, 47), P(63, 30), P(52, 30), P(52, 26.5)]);
  await result('draw-polygon-progress', P(39, 47), P(63, 26));
  await h.clicks([P(39, 26.5), P(39, 47)]);
  await result('draw-polygon', P(39, 47), P(63, 26));
  await clear();
  await where('cloud', 'Cloud');
  await h.tool('cloud');
  await h.drag(P(41, 40), P(61, 26));
  await result('draw-cloud', P(41, 40), P(61, 26));
  await clear();
  await where('polygonCloud', 'Polygon Cloud');
  await h.tool('polygonCloud');
  await h.clicks([P(9, 29), P(37, 29), P(37, 13), P(22, 13), P(22, 20), P(9, 20)]);
  await h.clicks([P(9, 29)]);
  await result('draw-polygon-cloud', P(9, 29), P(37, 13));
  await clear();
  await where('cloudPlus', 'Cloud+');
  await h.tool('cloudPlus');
  await h.drag(P(41, 40), P(55, 28));
  await h.wait(500);
  await result('draw-cloud-plus-editing', P(41, 46), P(70, 22));
  await page.keyboard.type('CONFIRM BENCH LENGTH');
  await page.keyboard.press('Control+Enter');
  await h.wait(300);
  await reset();
  await result('draw-cloud-plus', P(41, 46), P(70, 22));
  await clear();

  // Freehand.
  await where('pen', 'Pen');
  await h.tool('pen');
  {
    const pts = [];
    for (let i = 0; i <= 40; i++) pts.push(P(12 + i * 0.4, 22 + Math.sin(i / 4) * 2));
    const first = await h.at(...pts[0]);
    await page.mouse.move(first.x, first.y);
    await page.mouse.down();
    for (const p of pts) {
      const c = await h.at(...p);
      await page.mouse.move(c.x, c.y);
    }
    await page.mouse.up();
  }
  await result('draw-pen', P(11, 26), P(29, 18));
  await where('highlighter', 'Highlight');
  await h.tool('highlighter');
  await h.drag(P(40, 44), P(62, 44), 20);
  await result('draw-highlighter', P(39, 46), P(63, 42));
  await reset();

  // Eraser: rub across the pen stroke.
  await h.menu('Tools', 'Eraser');
  await h.shot('menu-eraser', { around: ['.menu-drop', '.menu-flyout'], pad: 12 });
  await h.closeMenus();
  await h.tool('eraser');
  {
    const a = await h.at(...P(18, 26));
    const b = await h.at(...P(18, 18));
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 12 });
    await page.mouse.up();
    await page.mouse.move(b.x + 2, b.y - 40);
  }
  await h.wait(300);
  await result('draw-eraser', P(11, 26), P(29, 18));
  await reset();
  await clear();

  // Text on the drawing.
  await where('text', 'Text Box');
  await h.tool('text');
  await h.drag(P(40, 46), P(56, 41));
  await h.wait(300);
  await page.keyboard.type('NEW SPLASHBACK TO MATCH');
  await result('draw-text-editing', P(40, 46), P(56, 41));
  await page.keyboard.press('Control+Enter');
  await h.wait(300);
  await reset();
  await result('draw-text', P(40, 46), P(56, 41));
  await clear();
  await where('callout', 'Callout');
  await h.tool('callout');
  await h.drag(P(23, 41), P(30, 52));
  await h.wait(300);
  await page.keyboard.type('WINDOW SIZE TBC');
  await page.keyboard.press('Control+Enter');
  await reset();
  await result('draw-callout', P(20, 55), P(40, 39));
  await clear();
  await where('typewriter', 'Typewriter');
  await h.tool('typewriter');
  await h.clickAt(...P(40, 20));
  await page.keyboard.type('EXISTING SLAB');
  await page.keyboard.press('Control+Enter');
  await reset();
  await result('draw-typewriter', P(39, 22), P(56, 17));
  await clear();
  await where('flagLabel', 'Flag Label');
  await h.tool('flagLabel');
  await h.drag(P(40, 44), P(50, 41));
  await h.wait(300);
  await page.keyboard.type('RFI 012');
  await page.keyboard.press('Control+Enter');
  await reset();
  await result('draw-flag-label', P(39, 45), P(51, 40));
  await clear();
  await where('note', 'Note');
  await h.tool('note');
  await h.clickAt(...P(50, 36));
  await h.wait(500);
  await h.shot('note-comment', { around: ['.modal'], pad: 20 });
  await page.keyboard.type('Check the extract fan position with the electrician.');
  await page.keyboard.press('Control+Enter');
  await reset();
  await result('draw-note', P(46, 39), P(56, 33));
  await clear();

  // Text markups on the PDF's own text (the general notes, near the top left of the sheet).
  const NOTE_Y = [196, 209, 222, 235];
  const textTool = async (tool, label, name, line, pick = true) => {
    if (pick) await where(tool, label);
    await h.tool(tool);
    await h.drag([146, NOTE_Y[line] - 3], [420, NOTE_Y[line] - 3]);
    await h.wait(300);
  };
  await h.zoomTo(130, 160, 560, 250);
  await textTool('textHighlight', 'Text Highlight', 'draw-text-highlight', 1);
  await result('draw-text-highlight', [140, 170], [560, 245], 20);
  await textTool('underline', 'Underline', 'draw-underline', 0);
  await textTool('strikeout', 'Strikethrough', 'draw-strikeout', 2, false);
  await textTool('squiggly', 'Squiggly', 'draw-squiggly', 3, false);
  await result('draw-text-lines', [140, 170], [560, 245], 20);
  await clear();
  await where('replaceText', 'Replace Text');
  await h.tool('replaceText');
  await h.drag([300, NOTE_Y[1] - 3], [345, NOTE_Y[1] - 3]);
  await h.wait(400);
  await h.shot('replace-text-ask', { around: ['.modal'], pad: 20 });
  await page.keyboard.type('MEASURE');
  await page.keyboard.press('Enter');
  await h.wait(300);
  await reset();
  await h.zoomTo(130, 160, 560, 250);
  await result('draw-replace-text', [140, 170], [560, 245], 20);
  await clear();
  await reset();

  // Stamps.
  await where('stamp', 'Stamp');
  await h.menu('Tools', 'Stamp');
  await h.shot('menu-stamp', { around: ['.menu-drop', '.menu-flyout'], pad: 12 });
  await h.item('Approved').click();
  await h.wait(200);
  await h.drag(P(40, 46), P(56, 40));
  await reset();
  await result('draw-stamp', P(39, 47), P(57, 39));
  await clear();
  await h.run('Tools', 'Stamp', 'Manage Stamps…');
  await h.wait(400);
  await h.shot('stamps-dialog', { around: ['.modal'], pad: 20 });
  await page.locator('.modal button', { hasText: /^New/ }).first().click();
  await h.wait(300);
  await h.shot('stamps-new', { around: ['.modal'], pad: 20 });
  await h.closeModal();

  // Image, attachment, snapshot, flag, legend, hyperlink, redaction.
  await reset();
  await h.menu('Tools', 'Markup', 'Other');
  await h.mark(h.item('Image'), { numbers: false });
  await h.shot('pick-image', { around: ['.menu-drop', '.menu-flyout'], pad: 12 });
  await h.closeMenus();
  await h.choose(() => h.tool('image'), 'site-photo.png');
  await h.drag(P(40, 46), P(52, 38));
  await reset();
  await result('draw-image', P(39, 47), P(53, 37));
  await clear();

  await h.menu('Tools');
  await h.mark([h.item('File Attachment'), h.item('Sound…'), h.item('Hyperlink')], { numbers: false });
  await h.shot('menu-tools-other', { around: ['.menu-drop'], pad: 12 });
  await h.closeMenus();
  await h.choose(() => h.tool('attachment'), 'specification.txt');
  await h.clickAt(...P(50, 36));
  await reset();
  await result('draw-attachment', P(46, 39), P(56, 33));
  await clear();
  await h.run('Tools', 'Sound…');
  await h.wait(400);
  await h.shot('sound-dialog', { around: ['.modal'], pad: 20 });
  await h.closeModal();

  await h.menu('Edit');
  await h.mark(h.item('Snapshot'), { numbers: false });
  await h.shot('pick-snapshot', { around: ['.menu-drop'], pad: 12 });
  await h.closeMenus();
  await h.tool('snapshot');
  {
    const a = await h.at(...P(38, 49));
    const b = await h.at(...P(65, 24));
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 10 });
    await result('draw-snapshot', P(38, 49), P(65, 24), 30);
    await page.mouse.up();
  }
  await reset();

  await where('flag', 'Flag');
  await h.tool('flag');
  await h.clickAt(...P(50, 36));
  await reset();
  await result('draw-flag', P(46, 40), P(56, 32));
  await clear();

  // Legend: needs some markups to list.
  await h.tool('cloud');
  await h.drag(P(41, 40), P(61, 26));
  await h.tool('rect');
  await h.drag(P(9.5, 47.5), P(21, 30.5));
  await h.tool('cloud');
  await h.drag(P(10, 28), P(36, 14));
  await where('legend', 'Legend');
  await h.tool('legend');
  await h.drag(P(66, 47), P(82, 38));
  await reset();
  await result('draw-legend', P(38, 49), P(84, 12), 20);
  await clear();

  await reset();
  await h.tool('hyperlink');
  await h.drag(P(8, 51), P(30, 49));
  await h.wait(500);
  await h.shot('hyperlink-dialog', { around: ['.modal'], pad: 20 });
  await h.closeModal();
  await reset();
  await clear();

  await h.menu('Tools', 'Redaction');
  await h.shot('menu-redaction', { around: ['.menu-drop', '.menu-flyout'], pad: 12 });
  await h.closeMenus();
  await h.tool('redaction');
  await h.drag(P(66, 50), P(84, 46));
  await reset();
  await page.evaluate((v) => window.__nb.viewer.setView(v), view);
  await h.zoomTo(...P(60, 72), ...P(95, 40));
  await result('draw-redaction', P(64, 52), P(86, 44));
  await h.run('Tools', 'Redaction', 'Apply Redactions…');
  await h.wait(400);
  await h.shot('apply-redactions', { around: ['.modal'], pad: 20 });
  await page.keyboard.press('Escape');
};
