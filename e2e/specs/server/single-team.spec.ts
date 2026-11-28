// A one-team internal check, through the app against a real redcolumn server: the manager (the
// project admin, who alone may close), the designer (a reviewer) and someone who only looks (a
// viewer). It follows the single-team scenario of @nb/policy
// (packages/policy/test/scenarios/singleTeam.ts) up to its last step, which carries open comments
// onto a new revision: the app cannot do that yet.
// Skipped unless E2E_SERVER_URL names a server; see server-documents.spec.ts for how to run it.
import { randomUUID } from 'node:crypto';
import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';

const SERVER = process.env.E2E_SERVER_URL?.replace(/\/$/, '');
const EMAIL = process.env.E2E_SERVER_EMAIL ?? '';
const PASSWORD = process.env.E2E_SERVER_PASSWORD ?? '';
const INVITED_PASSWORD = 'fictional-pass-135790';

interface Markup {
  id: string;
  seq?: number;
  status: string;
  checked?: boolean;
  comment?: string;
  statusHistory?: { state: string; author: string }[];
}

/** What the spec reaches into on the open server document, through the test hook. */
interface ServerDocument {
  inner: {
    streamId: string;
    scopeId: string;
    revisionId: string;
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    issueFor(markupId: string): { id: string; number: number | null } | undefined;
    viewState(): { statusEvents: Record<string, { issueId: string; to: string; revisionSeenId: string | null }> };
  };
}

async function drawingPdf(): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([842, 595]);
  page.drawRectangle({ x: 30, y: 30, width: 782, height: 535, borderWidth: 1, opacity: 0 });
  page.drawText('FOOTBRIDGE DECK PLAN  S-201', { x: 60, y: 520, size: 18, font });
  return Buffer.from(await pdf.save());
}

async function newPerson(browser: Browser, errors: string[], who: string): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, locale: 'en-US' });
  const page = await context.newPage();
  page.on('pageerror', (err) => errors.push(`${who}: ${err.message}`));
  page.on('console', (message) => {
    // A signed-out visit asks who it is and hears 401.
    if (message.type() === 'error' && !message.text().includes('status of 401')) errors.push(`${who}: ${message.text()}`);
  });
  return page;
}

async function openProjectDocuments(page: Page, project: string): Promise<void> {
  const row = page.locator('.connect-projects-block li.connect-list-item', { hasText: project });
  await row.getByRole('button', { name: 'Documents' }).click();
  await expect(page.getByRole('region', { name: 'Project documents' })).toBeVisible();
}

async function openDrawing(page: Page): Promise<void> {
  await page.getByRole('region', { name: 'Project documents' }).getByRole('button', { name: 'Open' }).click();
  await expect(synced(page)).toBeVisible();
  await page.waitForFunction(() => !!window.__nb.tools.store);
}

async function invite(admin: Page, role: 'reviewer' | 'viewer'): Promise<string> {
  const form = admin.locator('.review-invite-form');
  const link = admin.locator('.review-invite-link-field input');
  const previous = (await link.count()) ? await link.inputValue() : '';
  await form.locator('select').selectOption(role);
  await form.getByRole('button', { name: 'Create invite link' }).click();
  await expect(link).toHaveValue(/\/invite\//);
  await expect(link).not.toHaveValue(previous);
  return new URL(await link.inputValue()).pathname.split('/').pop()!;
}

async function join(page: Page, token: string, name: string, project: string): Promise<void> {
  await page.goto(`${SERVER}/#/invite/${token}`);
  await page.getByLabel('Email').fill(`${name.split(' ')[0]!.toLowerCase()}.${randomUUID().slice(0, 8)}@example.test`);
  await page.getByLabel('Display name').fill(name);
  await page.getByLabel('Password', { exact: true }).fill(INVITED_PASSWORD);
  await page.getByLabel('Confirm password').fill(INVITED_PASSWORD);
  await page.getByRole('button', { name: 'Create account & accept' }).click();
  await openProjectDocuments(page, project);
  await openDrawing(page);
}

const synced = (page: Page) => page.locator('.sync-status[data-sync-state="synced"]');

const markups = (page: Page): Promise<Markup[]> =>
  page.evaluate(() => JSON.parse(JSON.stringify(window.__nb.tools.store.all())) as Markup[]);

const markup = async (page: Page, id: string): Promise<Markup | undefined> => (await markups(page)).find((m) => m.id === id);

/** Draws a rectangle with the mouse and gives its comment, and returns its id. */
async function drawRectangle(page: Page, at: number, comment: string): Promise<string> {
  const before = new Set((await markups(page)).map((m) => m.id));
  await page.evaluate(() => window.__nb.tools.setTool('rect'));
  const box = (await page.locator('.pane canvas').first().boundingBox())!;
  await page.mouse.move(box.x + box.width * at, box.y + box.height * 0.35);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * (at + 0.1), box.y + box.height * 0.5, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await markups(page)).length).toBe(before.size + 1);
  const id = (await markups(page)).find((m) => !before.has(m.id))!.id;
  await page.evaluate(([markupId, text]) => window.__nb.tools.store.update(markupId!, { comment: text }), [id, comment]);
  await page.evaluate(() => window.__nb.tools.setTool('select'));
  return id;
}

// ---- The Markups list and the right-click menu -------------------------------------------------

const row = (page: Page, id: string) => page.locator(`.markups tbody tr[data-id="${id}"]`);
/** The ID column is the first. */
const idCell = (page: Page, id: string) => row(page, id).locator('td').first();
const statusSelect = (page: Page, id: string) => row(page, id).locator('.status-cell select');
const history = (page: Page, id: string) => row(page, id).locator('.status-history');
const tickBox = (page: Page, id: string) => row(page, id).getByRole('checkbox', { name: 'Checkmark' });

const menuItem = (page: Page, label: string): Locator =>
  page.locator('.ctx-menu .menu-item').filter({ has: page.locator('.label', { hasText: new RegExp(`^${label}$`) }) }).first();

async function rowMenu(page: Page, id: string): Promise<void> {
  await idCell(page, id).click({ button: 'right' });
  await expect(menuItem(page, 'Check')).toBeVisible();
}

async function closeMenu(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(page.locator('.ctx-menu')).toHaveCount(0);
}

/** Shows the Checkmark column, which the list hides to begin with. */
async function showTickColumn(page: Page): Promise<void> {
  await page.locator('.markups thead th').first().click({ button: 'right' });
  await menuItem(page, 'Columns').hover();
  await menuItem(page, 'Checkmark').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.markups thead th', { hasText: 'Checkmark' })).toHaveCount(1);
}

// ---- A client that does not do as the app does --------------------------------------------------

interface Answer {
  type: 'ack' | 'reject';
  code?: string;
}

/** Sends operations straight over a socket with this person's own session, one at a time. */
function sendRaw(page: Page, streamId: string, ops: Record<string, unknown>[]): Promise<Answer[]> {
  return page.evaluate(
    ({ stream, list }) =>
      new Promise<Answer[]>((resolve, reject) => {
        const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`);
        const answers: Answer[] = [];
        const timer = setTimeout(() => reject(new Error(`No answer; got ${JSON.stringify(answers)}`)), 10_000);
        const send = (frame: unknown) => socket.send(JSON.stringify(frame));
        const next = () => {
          const op = list[answers.length];
          if (op) return send({ type: 'send', streamId: stream, ops: [{ ...op, streamId: stream, schemaVersion: 1, opId: crypto.randomUUID() }] });
          clearTimeout(timer);
          socket.close();
          resolve(answers);
        };
        socket.onopen = () => send({ type: 'hello', protocol: { min: 1, max: 1 } });
        socket.onmessage = (event) => {
          const frame = JSON.parse(String(event.data)) as { type: string; message?: { type: string; reason?: { code?: string } } };
          if (frame.type === 'welcome') send({ type: 'open', streamId: stream, cursor: null, pendingOpIds: [] });
          if (frame.type !== 'sync') return;
          if (frame.message?.type === 'welcome') next();
          if (frame.message?.type === 'ack' || frame.message?.type === 'reject') {
            answers.push({ type: frame.message.type, ...(frame.message.reason?.code ? { code: frame.message.reason.code } : {}) });
            next();
          }
        };
      }),
    { stream: streamId, list: ops },
  );
}

const documentIds = (page: Page, markupId: string) =>
  page.evaluate((id) => {
    const { inner } = window.__nb.tools.store as unknown as ServerDocument;
    return { streamId: inner.streamId, scopeId: inner.scopeId, revisionId: inner.revisionId, issueId: inner.issueFor(id)?.id ?? '' };
  }, markupId);

const statusChanges = (page: Page, markupId: string) =>
  page.evaluate((id) => {
    const { inner } = window.__nb.tools.store as unknown as ServerDocument;
    const issueId = inner.issueFor(id)?.id;
    return Object.values(inner.viewState().statusEvents).filter((e) => e.issueId === issueId);
  }, markupId);

/** What everyone should see of each comment: its number, status and tick. */
async function expectComments(pages: Page[], expected: Record<string, [number: number, status: string, checked: boolean]>): Promise<void> {
  for (const page of pages) {
    await expect
      .poll(async () => Object.fromEntries((await markups(page)).map((m) => [m.id, [m.seq, m.status, !!m.checked]])))
      .toEqual(expected);
    for (const [id, [number, status]] of Object.entries(expected)) {
      await expect(idCell(page, id)).toHaveText(String(number));
      await expect(statusSelect(page, id)).toHaveValue(status);
    }
  }
}

test('a one-team internal check: statuses, ticks, closing and numbers', async ({ browser }, info) => {
  test.skip(!SERVER, 'E2E_SERVER_URL is not set');
  test.setTimeout(240_000);
  const errors: string[] = [];
  const project = `Harbor Footbridge ${randomUUID().slice(0, 6)}`;

  // The manager makes the project, invites the designer and a viewer, and adds the drawing.
  const manager = await newPerson(browser, errors, 'manager');
  await manager.goto(`${SERVER}/`);
  await manager.getByLabel('Email').fill(EMAIL);
  await manager.getByLabel('Password').fill(PASSWORD);
  await manager.getByRole('button', { name: 'Sign in', exact: true }).click();
  await manager.getByRole('button', { name: 'New project' }).click();
  await manager.getByLabel('Project name').fill(project);
  await manager.getByRole('button', { name: 'Create project' }).click();
  await expect(manager.locator('.review-invite-form')).toBeVisible();
  const designerToken = await invite(manager, 'reviewer');
  const viewerToken = await invite(manager, 'viewer');
  await openProjectDocuments(manager, project);
  await manager.getByTestId('add-pdf-input').setInputFiles({ name: 'S-201 footbridge.pdf', mimeType: 'application/pdf', buffer: await drawingPdf() });
  await expect(manager.getByRole('region', { name: 'Project documents' }).getByRole('button', { name: 'Open' })).toBeVisible({ timeout: 30_000 });
  await openDrawing(manager);

  const designer = await newPerson(browser, errors, 'designer');
  await join(designer, designerToken, 'Sam Patel', project);

  // Two markups. Neither is a numbered comment yet.
  const c1 = await drawRectangle(manager, 0.2, 'Beam splice bolt grade missing');
  const c2 = await drawRectangle(manager, 0.5, 'Check slab edge thickenings');
  await expect(row(manager, c1)).toBeVisible();
  await expect(manager.locator('.markups thead th').first()).toContainText('ID');
  await expect(idCell(manager, c1)).toHaveText('');
  await expect(statusSelect(manager, c1).locator('option')).toHaveText(['—', 'Open', 'Actioned', 'Answered', 'Closed', 'Not applicable']);

  // 1. The manager raises c1 from the list: the designer sees number 1, open.
  await statusSelect(manager, c1).selectOption('open');
  await expect(idCell(manager, c1)).toHaveText('1');
  await expect(idCell(designer, c1)).toHaveText('1');
  await expect(statusSelect(designer, c1)).toHaveValue('open');
  await expect(history(designer, c1)).toContainText('set by');

  // 2. The second is raised from the right-click menu and takes number 2.
  await rowMenu(manager, c2);
  await menuItem(manager, 'Set Status').hover();
  await menuItem(manager, 'Open').click();
  await expectComments([manager, designer], { [c1]: [1, 'open', false], [c2]: [2, 'open', false] });

  // 3. The designer ticks c1. Both see it ticked; it stays open.
  await showTickColumn(manager);
  await showTickColumn(designer);
  await rowMenu(designer, c1);
  await menuItem(designer, 'Check').click();
  for (const page of [manager, designer]) await expect(tickBox(page, c1)).toBeChecked();
  await expectComments([manager, designer], { [c1]: [1, 'open', true], [c2]: [2, 'open', false] });
  // The tick is undone and redone like an edit, and the status stays.
  await designer.keyboard.press('Control+z');
  await expect(tickBox(manager, c1)).not.toBeChecked();
  await expect(statusSelect(manager, c1)).toHaveValue('open');
  await tickBox(designer, c1).check();
  await expect(tickBox(manager, c1)).toBeChecked();

  // 4. The designer may not close: no control offers it, and the server refuses it from any client.
  await expect(statusSelect(designer, c1).locator('option[value="closed"]')).toBeDisabled();
  await expect(statusSelect(designer, c1).locator('option[value="actioned"]')).toBeEnabled();
  await rowMenu(designer, c1);
  await menuItem(designer, 'Set Status').hover();
  await expect(menuItem(designer, 'Closed')).toBeDisabled();
  await expect(menuItem(designer, 'Actioned')).toBeEnabled();
  await closeMenu(designer);
  const asDesigner = await documentIds(designer, c1);
  expect(
    await sendRaw(designer, asDesigner.streamId, [
      { type: 'status.transition', entityId: randomUUID(), payload: { issueId: asDesigner.issueId, from: 'open', to: 'closed', revisionSeenId: asDesigner.revisionId } },
    ]),
  ).toEqual([{ type: 'reject', code: 'forbidden' }]);
  await expectComments([manager, designer], { [c1]: [1, 'open', true], [c2]: [2, 'open', false] });

  // 5. The manager closes c1. Both see it closed, with the revision that was checked.
  await statusSelect(manager, c1).selectOption('closed');
  await expectComments([manager, designer], { [c1]: [1, 'closed', true], [c2]: [2, 'open', false] });
  await expect(history(designer, c1)).toContainText('Closed set by');
  await expect
    .poll(async () => (await statusChanges(designer, c1)).map((e) => [e.to, e.revisionSeenId]))
    .toEqual([['closed', asDesigner.revisionId]]);

  // Undo does not take a status back, and says so.
  await manager.keyboard.press('Control+z');
  await expect(manager.locator('.sync-problem')).toContainText('A status change cannot be undone');
  await expect(statusSelect(manager, c1)).toHaveValue('closed');
  await expect(synced(manager)).toBeVisible();
  await manager.screenshot({ path: info.outputPath('manager-status-kept.png') });
  await manager.locator('.sync-problem').getByRole('button', { name: 'Dismiss' }).click();

  // An issue raised while offline shows a temporary ID until the server numbers it.
  await designer.evaluate(() => (window.__nb.tools.store as unknown as ServerDocument).inner.disconnect());
  const c3 = await drawRectangle(designer, 0.7, 'Dimension missing at gridline B');
  await statusSelect(designer, c3).selectOption('actioned');
  await expect(idCell(designer, c3)).toHaveText(/^Temp [0-9A-F]{4}$/);
  await expect(designer.locator('.sync-status[data-sync-state="offline"]')).toBeVisible();
  await designer.screenshot({ path: info.outputPath('designer-offline-temporary-id.png') });
  expect(await markup(manager, c3)).toBeUndefined();
  await designer.evaluate(() => (window.__nb.tools.store as unknown as ServerDocument).inner.connect());
  const all: Record<string, [number, string, boolean]> = { [c1]: [1, 'closed', true], [c2]: [2, 'open', false], [c3]: [3, 'actioned', false] };
  await expect(synced(designer)).toBeVisible();
  await expectComments([manager, designer], all);

  // The viewer sees all of it, and can change none of it.
  const viewer = await newPerson(browser, errors, 'viewer');
  await join(viewer, viewerToken, 'Vic Observer', project);
  await showTickColumn(viewer);
  await expectComments([viewer], all);
  await expect(history(viewer, c1)).toContainText('Closed set by');
  for (const id of [c1, c2, c3]) {
    await expect(statusSelect(viewer, id)).toBeDisabled();
    await expect(tickBox(viewer, id)).toBeDisabled();
  }
  await rowMenu(viewer, c2);
  await expect(menuItem(viewer, 'Set Status')).toBeDisabled();
  await expect(menuItem(viewer, 'Check')).toBeDisabled();
  await closeMenu(viewer);
  await viewer.evaluate((id) => window.__nb.tools.store.update(id, { status: 'actioned', checked: true, comment: 'Changed by a viewer' }), c2);
  const asViewer = await documentIds(viewer, c2);
  const refused = await sendRaw(viewer, asViewer.streamId, [
    { type: 'status.transition', entityId: randomUUID(), payload: { issueId: asViewer.issueId, from: 'open', to: 'actioned' } },
    { type: 'status.transition', entityId: randomUUID(), payload: { issueId: asViewer.issueId, from: 'open', to: 'closed', revisionSeenId: asViewer.revisionId } },
    { type: 'issue.patch', entityId: asViewer.issueId, basedOn: { checked: 0 }, payload: { checked: true } },
    { type: 'markup.create', entityId: randomUUID(), payload: { scopeId: asViewer.scopeId, type: 'rect', content: { style: { stroke: '#000000', fill: null, width: 1, opacity: 1 } } } },
  ]);
  expect(refused).toEqual(Array.from({ length: 4 }, () => ({ type: 'reject', code: 'forbidden' })));
  await expectComments([manager, designer, viewer], all);
  await viewer.screenshot({ path: info.outputPath('viewer.png') });

  // Opened again, everything is as it was, numbers included.
  await designer.reload();
  await openProjectDocuments(designer, project);
  await openDrawing(designer);
  await expectComments([designer], all);
  expect((await markup(designer, c2))!.comment).toBe('Check slab edge thickenings');
  await designer.screenshot({ path: info.outputPath('designer-reopened.png') });

  expect(errors, errors.join('\n')).toEqual([]);
  for (const page of [manager, designer, viewer]) await page.context().close();
});
