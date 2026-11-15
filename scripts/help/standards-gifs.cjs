// Records the drawing standards setup's clips (apps/web/public/help/gif/standards-*.gif): where
// to draw each box of the link steps, on the Kestrel Road demo set.
//
//   pnpm dev                     (in another terminal; the scripts need the dev build's window.__nb)
//   URL=http://localhost:5173/ SCRIPT=standards-gifs sh scripts/help/run.sh [name ...]
//   URL=http://localhost:5173/ SCRIPT=standards-gifs sh scripts/help/run.sh shots    (the help page's screenshots)
//
// The setup opens over the app (pop-ups are turned off for the recording) on a new standard; each
// clip goes to its step and sheet, zooms to the place, and records the box being drawn.
const path = require('node:path');
const { launch } = require('./lib.cjs');
const { recorder } = require('./gif.cjs');

const SET = path.resolve(__dirname, '../../docs/demo-sets/kestrel-road-set.pdf');

/** A box on a sheet: 1-based page, page points from the top-left. */
const box = (page, x, y, w, h) => ({ page, x, y, w, h });
const MARKS = {
  section: { mark: box(6, 333, 534, 43, 43), title: box(4, 62, 533, 300, 52) },
  elevation: { mark: box(9, 567, 800, 43, 43), title: box(5, 957, 1555, 323, 43) },
  detail: { mark: box(8, 1106, 690, 43, 43), title: box(5, 1241, 757, 204, 46) },
};
const MATCH = { first: box(6, 1772, 932, 30, 199), second: box(7, 104, 847, 30, 199) };
const CHAIN = {
  'plan-chainage': box(6, 740, 583, 16, 22),
  'plan-alignment': box(6, 566, 582, 32, 14),
  'section-alignment': box(16, 797, 93, 28, 14),
  'section-chainage': box(16, 768, 398, 84, 20),
};

const STEP = { section: 'Sections', elevation: 'Elevations', detail: 'Details' };
const CAPTION = {
  mark: (k) => `Box a ${k === 'detail' ? 'detail callout' : `${k} mark`}: its letter and the sheet it points to`,
  title: (k) => `Box its ${k} title on the sheet the mark names`,
};

/** The clips, by name: what comes before the recording, and the box recorded. */
const CLIPS = {};
for (const [kind, b] of Object.entries(MARKS)) {
  CLIPS[`standards-${kind}-mark`] = { step: STEP[kind], before: [], box: b.mark, caption: CAPTION.mark(kind) };
  CLIPS[`standards-${kind}-title`] = { step: STEP[kind], before: [b.mark], box: b.title, caption: CAPTION.title(kind) };
}
CLIPS['standards-matchline-first'] = { step: 'Match lines', before: [], box: MATCH.first, caption: 'Box a match-line label: its words and the drawing it names', zoom: 0.8 };
CLIPS['standards-matchline-second'] = { step: 'Match lines', before: [MATCH.first], box: MATCH.second, caption: 'Box the matching label on the adjoining sheet', zoom: 0.8 };
const CHAIN_CAPTIONS = {
  'plan-chainage': 'Box a chainage on a plan',
  'plan-alignment': 'Box the name of the alignment it is on',
  'section-alignment': 'On a cross-section sheet of that alignment, box where it names it',
  'section-chainage': 'Box one section’s chainage, with CHAINAGE in front of it',
};
const order = Object.keys(CHAIN);
order.forEach((k, i) => {
  CLIPS[`standards-chainage-${k}`] = { step: 'Chainages', before: order.slice(0, i).map((x) => CHAIN[x]), box: CHAIN[k], caption: CHAIN_CAPTIONS[k], zoom: k.startsWith('section') ? 1.6 : 2 };
});

/** Where a page point is on screen, from the setup sheet's view. */
async function screen(page, x, y) {
  return page.evaluate(([x, y]) => {
    const el = document.querySelector('.sheet-view-body');
    const [cx, cy, zoom] = el.dataset.view.split(',').map(Number);
    const r = el.getBoundingClientRect();
    return { x: r.left + (x - cx) * zoom + r.width / 2, y: r.top + (y - cy) * zoom + r.height / 2 };
  }, [x, y]);
}

const zoomOf = (page) => page.evaluate(() => Number(document.querySelector('.sheet-view-body').dataset.view.split(',')[2]));

async function goToPage(h, n) {
  const input = h.page.locator('.sw-sheet .pagenav').getByLabel('Page', { exact: true });
  if (Number(await input.inputValue()) === n) return;
  await input.fill(String(n));
  await input.press('Enter');
  await h.wait(900);
}

/** Zooms the setup's sheet on a box, about `zoom` screen pixels a point. */
async function zoomTo(h, b, zoom) {
  for (let i = 0; i < 12 && (await zoomOf(h.page)) < zoom; i++) {
    const p = await screen(h.page, b.x + b.w / 2, b.y + b.h / 2);
    await h.page.mouse.move(p.x, p.y);
    await h.page.mouse.wheel(0, -220);
    await h.wait(250);
  }
  await h.wait(600);
}

async function drawBox(page, b) {
  const a = await screen(page, b.x, b.y);
  const z = await screen(page, b.x + b.w, b.y + b.h);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(z.x, z.y, { steps: 6 });
  await page.mouse.up();
}

async function prepare(h, clip) {
  const { page } = h;
  await page.locator('input[type=file][accept*="pdf"]').first().setInputFiles(SET);
  await page.waitForFunction(() => window.__nb && window.__nb.viewer && document.querySelector('.tab, .doc-tab'));
  await h.wait(2500);
  // The setup over the app rather than in a window of its own, so it is in the recording.
  await page.evaluate(() => {
    window.open = () => null;
    window.__nb.commands().get('document.setUpDrawingStandard').run();
  });
  const wizard = page.locator('.standards-wizard');
  await wizard.getByLabel('Standard name').fill('Meridian Civil');
  await wizard.getByRole('button', { name: 'Start', exact: true }).click();
  await wizard.locator('.sw-steps').getByRole('button', { name: clip.step }).click();
  await h.wait(1500);
  for (const b of clip.before) {
    await goToPage(h, b.page);
    await page.locator('.sw-sheet .pagenav button[title^="Fit page"]').click();
    await h.wait(500);
    await zoomTo(h, b, clip.zoom ?? 1.2);
    await drawBox(page, b);
    await h.wait(800);
    await wizard.locator('.sw-nav').getByRole('button', { name: 'Next', exact: true }).click();
    await h.wait(1500);
  }
  await goToPage(h, clip.box.page);
  await page.locator('.sw-sheet .pagenav button[title^="Fit page"]').click();
  await h.wait(500);
  await zoomTo(h, clip.box, clip.zoom ?? 1.2);
}


/** Opens the Kestrel set and the setup over the app, on its start screen. */
async function openSetup(h) {
  const { page } = h;
  await page.locator('input[type=file][accept*="pdf"]').first().setInputFiles(SET);
  await page.waitForFunction(() => window.__nb && window.__nb.viewer && document.querySelector('.tab, .doc-tab'));
  await h.wait(2500);
  await page.evaluate(() => {
    window.open = () => null;
    window.__nb.commands().get('document.setUpDrawingStandard').run();
  });
  return page.locator('.standards-wizard');
}

/** The help page's screenshots of the setup: the title block step, and the review. */
async function shots() {
  {
    const { browser, h } = await launch({ width: 1440, height: 860, toolbar: 'ribbon' });
    try {
      const wizard = await openSetup(h);
      await wizard.getByLabel('Standard name').fill('Meridian Civil');
      await wizard.getByRole('button', { name: 'Start', exact: true }).click();
      await h.wait(2500);
      // The drawing number box on the cover sheet's title block (as the Kestrel standard has it).
      await drawBox(h.page, box(1, 0.785 * 2384, 0.424 * 1684, 0.195 * 2384, 0.038 * 1684));
      await h.wait(1500);
      await h.shot('drawing-standard-setup');
    } finally {
      await browser.close();
    }
  }
  {
    const { browser, h } = await launch({ width: 1440, height: 860, toolbar: 'ribbon' });
    try {
      const wizard = await openSetup(h);
      // The Kestrel standard, shared as a file: imported on the start screen.
      await wizard.locator('input[type=file]').setInputFiles(path.resolve(__dirname, '../../docs/demo-sets/kestrel-road.rcstandard'));
      await h.wait(800);
      await wizard.locator('.sw-standards button').first().click();
      await h.wait(1500);
      await wizard.locator('.sw-steps').getByRole('button', { name: 'Match lines' }).click();
      await h.wait(3000);
      await wizard.locator('.sw-steps').getByRole('button', { name: 'Review' }).click();
      await h.wait(1500);
      await h.shot('drawing-standard-review');
    } finally {
      await browser.close();
    }
  }
}

(async () => {
  const wanted = process.argv.slice(2);
  if (wanted[0] === 'shots') return shots();
  const names = Object.keys(CLIPS).filter((n) => !wanted.length || wanted.some((w) => n.includes(w)));
  let failed = 0;
  for (const name of names) {
    console.log(`clip ${name}`);
    const clip = CLIPS[name];
    const { browser, h } = await launch({ width: 1280, height: 760, toolbar: 'ribbon' });
    try {
      await prepare(h, clip);
      const rec = recorder(h.page, { scale: 0.6 });
      await rec.start();
      await rec.caption(clip.caption);
      await rec.hold(900);
      const b = clip.box;
      await rec.drag(await screen(h.page, b.x, b.y), await screen(h.page, b.x + b.w, b.y + b.h));
      await rec.hold(2200);
      await rec.save(name);
    } catch (err) {
      failed++;
      console.error(`  FAILED ${name}:`, err.stack || err.message);
      await h.page.screenshot({ path: path.join(__dirname, `failed-${name}.png`) }).catch(() => {});
    } finally {
      await browser.close();
    }
  }
  if (failed) process.exitCode = 1;
})();
