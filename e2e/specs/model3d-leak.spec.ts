import { expect, test, type App } from '../support/app.ts';

// The 3D viewer frees what it holds when its model closes (issue #191). In a file of its own, as a
// trace keeps the page's elements (the old canvas among them) for its snapshots.
test.use({ trace: 'off' });

const openModel = (app: App) => app.page.locator('input[type=file][accept*="ifc"]').first().setInputFiles(app.fixture('../../docs/demo-sets/kestrel-road-revA.ifc'));
const view = (app: App) => app.page.locator('.model-view');

test('closing a model frees its WebGL context, workers, window listeners and the view itself', async ({ app }) => {
  const page = app.page;
  // Counts what the app holds: WebGL contexts made, and window listeners by type.
  await page.evaluate(() => {
    const w = window as unknown as { __gl: WebGLRenderingContext[]; __listeners: Record<string, number>; __views: WeakRef<object>[] };
    w.__gl = [];
    w.__listeners = {};
    w.__views = [];
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      const ctx = (getContext as (...a: unknown[]) => unknown).call(this, type, ...rest);
      if (ctx && /webgl/.test(type)) w.__gl.push(ctx as WebGLRenderingContext);
      return ctx;
    } as typeof getContext;
    // Listeners added since now and not yet removed, by type and capture.
    const live = new Map<string, Set<unknown>>();
    const key = (type: string, opts: unknown) => `${type}${(typeof opts === 'boolean' ? opts : !!(opts as { capture?: boolean } | undefined)?.capture) ? ' capture' : ''}`;
    const add = window.addEventListener;
    const remove = window.removeEventListener;
    window.addEventListener = function (type: string, fn: unknown, opts?: unknown) {
      const k = key(type, opts);
      if (!live.has(k)) live.set(k, new Set());
      live.get(k)!.add(fn);
      w.__listeners[k] = live.get(k)!.size;
      return (add as (...a: unknown[]) => void).call(window, type, fn, opts);
    } as typeof add;
    window.removeEventListener = function (type: string, fn: unknown, opts?: unknown) {
      const k = key(type, opts);
      live.get(k)?.delete(fn);
      w.__listeners[k] = live.get(k)?.size ?? 0;
      return (remove as (...a: unknown[]) => void).call(window, type, fn, opts);
    } as typeof remove;
  });
  type Counts = { contexts: number; live: number; listeners: Record<string, number> };
  const counts = () =>
    page.evaluate(() => {
      const w = window as unknown as { __gl: WebGLRenderingContext[]; __listeners: Record<string, number> };
      return { contexts: w.__gl.length, live: w.__gl.filter((c) => !c.isContextLost()).length, listeners: { ...w.__listeners } };
    }) as Promise<Counts>;
  // The 3D view's workers: model conversion (model3d) and the fragments library's (thatopen).
  const workers = () => page.workers().filter((x) => /model3d|thatopen|fragments/i.test(x.url())).length;
  const workersBefore = workers();
  let baseline: Counts | null = null;

  for (let round = 0; round < 3; round++) {
    await openModel(app);
    await expect(view(app)).toHaveAttribute('data-state', 'ready', { timeout: 90_000 });
    await page.evaluate(() => {
      const w = window as unknown as { __views: WeakRef<object>[] };
      const s = (document.querySelector('.model-view') as unknown as { session: { run(a: unknown): void } }).session;
      w.__views.push(new WeakRef(s));
      // Things that add their own resources: the mini-map, a section box and walking.
      s.run({ type: 'miniMap' });
      s.run({ type: 'sectionBox' });
      s.run({ type: 'nav', mode: 'Walk' });
    });
    await page.waitForTimeout(300);
    if (round === 0) expect((await counts()).live).toBeGreaterThan(0);
    await page.locator('.doc-tab.active .close').click();
    await expect(view(app)).toHaveCount(0);
    // Every WebGL context the view made is gone.
    await expect.poll(async () => (await counts()).live).toBe(0);
    const now = await counts();
    // The same window listeners after each round: none left behind by a closed view.
    if (!baseline) baseline = now;
    else expect(now.listeners).toEqual(baseline.listeners);
  }
  // No 3D workers left running.
  await expect.poll(workers, { message: `3D workers still running: ${page.workers().map((w) => w.url()).join(', ')}` }).toBe(workersBefore);
  // The closed views can be collected (Chromium, where the test can ask for a collection).
  const cdp = await page.context().newCDPSession(page).catch(() => null);
  if (cdp) {
    await expect
      .poll(async () => {
        await cdp.send('HeapProfiler.collectGarbage');
        return page.evaluate(() => (window as unknown as { __views: WeakRef<object>[] }).__views.filter((r) => r.deref()).length);
      }, { timeout: 20_000 })
      .toBe(0);
  }
});
