// Drives the app the way a person does (menus, clicks on the drawing, typing) and reads its state
// back through window.__nb, the test hook in apps/web/src/App.tsx. Ported from scripts/help/lib.cjs.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, type Page } from '@playwright/test';

const FIXTURES = resolve(import.meta.dirname, '../fixtures');

/** Where things are drawn in fixtures/plan.pdf (written by fixtures/make-fixtures.mjs). */
export const PLAN = JSON.parse(readFileSync(join(FIXTURES, 'expected.json'), 'utf8')) as {
  page: { width: number; height: number };
  calibration: { from: [number, number]; to: [number, number]; feet: number };
  room: { x: number; y: number; w: number; h: number };
  symbols: [number, number][];
  symbolRadius: number;
  search: Record<string, { hits: number; firstPage: number }>;
  pageCount: number;
  sheets: { labelBox: Box; labels: string[]; scaleBox: Box; scales: string[] };
  forms: { page: { width: number; height: number }; lines: { label: string; x0: number; x1: number; y: number }[]; box: { label: string; x: number; y: number; size: number } };
  stitch: { page: { width: number; height: number }; sheets: { number: string; from: number; to: number; angle: number }[] };
  marks: { sheetNumbers: string[]; radius: number; callouts: { x: number; y: number; detail: string; sheet: string }[]; grid: { x: number; y: number; label: string } };
  rotated: { pages: { rotate: number; text: string; x: number; y: number }[] };
};

type Box = { x: number; y: number; w: number; h: number };

export type Pt = readonly [number, number];

/** A markup as the assistant's list_markups reports it (pages are 1-based). */
export interface MarkupInfo {
  id: string;
  type: string;
  page: number;
  points: [number, number][];
  text?: string;
  comment?: string;
  subject?: string;
  author?: string;
  measurement?: string;
  hidden?: boolean;
  locked?: boolean;
}

export interface CommandInfo {
  id: string;
  label: string;
  category: string;
  enabled: boolean;
  checked?: boolean;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function driver(page: Page) {
  const d = {
    page,
    fixture: (name: string) => join(FIXTURES, name),

    /** Opens fixture PDFs through the app's file input and waits until the first is the active document. */
    async open(...names: string[]) {
      if (!names.length) names = ['plan.pdf'];
      await page.locator('input[type=file][accept*="pdf"]').first().setInputFiles(names.map(d.fixture));
      const last = names[names.length - 1]!.replace(/\.pdf$/i, '');
      await expect
        .poll(async () => (await d.documents().catch(() => [])).some((doc) => doc.active && doc.name.startsWith(last) && doc.pageCount > 0), {
          message: `${last} did not open`,
          timeout: 30_000,
        })
        .toBe(true);
      await d.fit();
    },

    /** Calls one of the assistant's MCP tools (list_markups, get_page, ...) inside the app. */
    assistant<T = unknown>(method: string, params: Record<string, unknown> = {}) {
      return page.evaluate(([m, p]) => window.__nb.assistant(m, p), [method, params] as const) as Promise<T>;
    },
    async documents() {
      return (await d.assistant<{ documents: { id: string; name: string; pageCount: number; page: number; active: boolean }[] }>('list_open_documents')).documents;
    },
    async markups(pageNumber?: number) {
      return (await d.assistant<{ markups: MarkupInfo[] }>('list_markups', pageNumber ? { page: pageNumber } : {})).markups;
    },
    /** The page's size and, when one is set, its scale equation (pages are 1-based). */
    pageInfo(pageNumber?: number) {
      return d.assistant<{ page: number; width: number; height: number; scale?: string }>('get_page', pageNumber ? { page: pageNumber } : {});
    },
    /** The active document's markups straight from the store, for fields list_markups leaves out. */
    raw() {
      return page.evaluate(() => JSON.parse(JSON.stringify(window.__nb.tools.store.all())) as Record<string, unknown>[]);
    },
    /** Removes every markup in the active document. */
    clearMarkups() {
      return page.evaluate(() => window.__nb.tools.store.remove(window.__nb.tools.store.all().map((m) => m.id)));
    },

    // Commands: the same table the menus, shortcuts and palette use (apps/web/src/commands/appCommands.ts).
    commands() {
      return page.evaluate(() =>
        [...window.__nb.commands().values()].map((c) => ({ id: c.id, label: c.label, category: c.category, enabled: c.enabled, checked: c.checked })),
      ) as Promise<CommandInfo[]>;
    },
    async command(id: string): Promise<CommandInfo> {
      const c = (await d.commands()).find((x) => x.id === id);
      if (!c) throw new Error(`No command ${id}`);
      return c;
    },
    /** Runs a command by id; fails if it does not exist or is disabled. */
    async cmd(id: string) {
      await page.evaluate((id) => {
        const before = window.__nb.commands();
        const c = before.get(id);
        if (!c) throw new Error(`No command ${id}`);
        if (!c.enabled) throw new Error(`Command ${id} is disabled`);
        (window as unknown as { __nbBefore: unknown }).__nbBefore = before;
        c.run();
      }, id);
      // The command table is rebuilt on every render: wait for one, so `checked` and `enabled` are
      // current. A command that changes nothing React shows doesn't render, hence the short timeout.
      await page
        .waitForFunction(() => window.__nb.commands() !== (window as unknown as { __nbBefore: unknown }).__nbBefore, null, { timeout: 1000 })
        .catch(() => {});
    },

    // Menus and dialogs.
    async menu(title: string, ...subs: string[]) {
      await page.keyboard.press('Escape');
      await page.locator('.menubar .menu-title', { hasText: new RegExp(`^${escape(title)}$`) }).click();
      for (const s of subs) {
        await page
          .locator('.menu-sub > .menu-item')
          .filter({ has: page.locator('.label', { hasText: new RegExp(`^${escape(s)}$`) }) })
          .last()
          .hover();
      }
      return page.locator('.menu-drop');
    },
    item(label: string) {
      return page
        .locator('.menu-drop .menu-item, .menu-flyout .menu-item')
        .filter({ has: page.locator('.label', { hasText: new RegExp(`^${escape(label)}$`) }) })
        .last();
    },
    /** Clicks a menu item: menuPath('Tools', 'Measure', 'Length'). */
    async menuPath(title: string, ...labels: string[]) {
      const last = labels.pop()!;
      await d.menu(title, ...labels);
      await d.item(last).click();
    },
    modal: () => page.locator('.modal').last(),
    async closeModal() {
      for (let i = 0; i < 4 && (await page.locator('.modal-backdrop').count()); i++) {
        const btn = page.locator('.modal .actions button, .modal button').filter({ hasText: /^(Cancel|Close)$/ }).last();
        if (await btn.count()) await btn.click({ timeout: 2000 }).catch(() => {});
        else await page.keyboard.press('Escape');
        await page.waitForTimeout(150);
      }
    },
    /** Opens a side panel by its rail button title. */
    async panel(title: string) {
      const btn = page.locator('.rail button').filter({ hasText: new RegExp(`^\\s*${escape(title)}`) }).first();
      const open = (await btn.getAttribute('class'))?.includes('active');
      if (!open) await btn.click();
    },

    // The drawing.
    /** Picks a tool through its command (tool.<name>), as the toolbar and menus do; else directly. */
    async tool(tool: string) {
      await page.evaluate((t) => {
        const c = window.__nb.commands().get(`tool.${t}`);
        if (c) {
          if (!c.enabled) throw new Error(`Command tool.${t} is disabled`);
          c.run();
        } else window.__nb.tools.setTool(t);
      }, tool);
      await expect.poll(() => page.evaluate(() => window.__nb.tools.getState().tool)).toBe(tool);
    },
    toolState() {
      return page.evaluate(() => {
        const s = window.__nb.tools.getState();
        return { tool: s.tool, selected: [...s.selected], measuring: !!s.measuring };
      });
    },
    /** The active pane's view: focused page (0-based), zoom, page mode and rotation in quarter turns. */
    view() {
      return page.evaluate(() => {
        const v = window.__nb.viewer;
        const { pageIndex, zoom, mode } = v.getView();
        return { pageIndex, zoom, mode, rotation: v.pageView().rotation };
      });
    },
    async fit() {
      await page.evaluate(() => window.__nb.viewer.fit());
      await page.waitForTimeout(200);
    },
    /** Screen point of a page point (pt from the page's top-left). */
    async at([x, y]: Pt, pageIndex?: number) {
      return page.evaluate(
        ([x, y, i]) => {
          const v = window.__nb.viewer;
          const [cx, cy] = v.pageToClient([x, y], i ?? v.currentPageIndex);
          return { x: cx, y: cy };
        },
        [x, y, pageIndex] as const,
      );
    },
    async drag(from: Pt, to: Pt, steps = 10) {
      const a = await d.at(from);
      const b = await d.at(to);
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      await page.mouse.move(b.x, b.y, { steps });
      await page.mouse.up();
      await page.waitForTimeout(150);
    },
    /** Clicks page points in turn; `finish` then presses Enter or double-clicks the last point. */
    async clicks(points: readonly Pt[], finish?: 'enter' | 'dbl') {
      for (const p of points) {
        const c = await d.at(p);
        await page.mouse.click(c.x, c.y);
        await page.waitForTimeout(60);
      }
      if (finish === 'enter') await page.keyboard.press('Enter');
      if (finish === 'dbl') {
        const c = await d.at(points[points.length - 1]!);
        await page.mouse.dblclick(c.x, c.y);
      }
      await page.waitForTimeout(150);
    },

    // Scales.
    /** Calibrates from the plan's 10'-0" bar (100 pt), for every page. */
    async calibrate(feet = PLAN.calibration.feet) {
      await d.tool('calibrate');
      await d.clicks([PLAN.calibration.from, PLAN.calibration.to]);
      const dialog = page.locator('.modal').filter({ hasText: 'Calibrate scale' });
      const submit = dialog.locator('button[type=submit]');
      // The dialog can re-render as it opens and drop what was typed: retype until Set scale is enabled.
      await expect(async () => {
        await dialog.locator('select').first().selectOption('ft');
        await dialog.locator('input').first().fill(String(feet));
        await expect(submit).toBeEnabled({ timeout: 1000 });
      }).toPass({ timeout: 10_000 });
      await submit.click();
      await expect(dialog).toBeHidden();
      await d.tool('select');
    },
    scaleSelect: () => page.locator('.pagenav-side.right select').first(),

    // Text search (Edit › Find Text), for checking what a page operation left on the pages.
    /** Searches the active document and returns the 1-based page of each hit, in order. */
    async search(query: string): Promise<number[]> {
      const input = page.locator('.search-bar input[placeholder="Search text"]');
      if (!(await input.isVisible())) await d.cmd('edit.find');
      const summary = page.locator('.search p.empty').first();
      let pages: number[] = [];
      // The words of an edited document are read again in the background: search until the
      // summary and the list agree.
      await expect(async () => {
        await input.fill(query);
        await input.press('Enter');
        await expect(summary).toHaveText(/^(No matches\.|\d+ match)/, { timeout: 2000 });
        const n = /^(\d+) match/.exec((await summary.textContent()) ?? '')?.[1];
        const nums = await page.locator('.search-hit .num').allTextContents();
        expect(nums.length).toBe(Number(n ?? 0));
        pages = nums.map((t) => Number(/Page (\d+)/.exec(t)?.[1]));
      }).toPass({ timeout: 20_000 });
      return pages;
    },
    /** The notice bar's text (an operation's result), once it shows. */
    notice: () => page.locator('.notice').last(),
    errorBar: () => page.locator('.error').last(),
  };
  return d;
}

export type Driver = ReturnType<typeof driver>;
