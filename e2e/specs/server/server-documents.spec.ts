// Server documents in the viewer, with two browser contexts against a real redcolumn server.
// Skipped unless E2E_SERVER_URL names one. To run it:
//   1. Build the web app with the test hook:  VITE_E2E=1 pnpm --filter @nb/web build
//   2. Start the server on a fresh database with WEB_DIST_DIR=apps/web/dist, and create an admin
//      (`redcolumn-admin create-admin`).
//   3. E2E_SERVER_URL=http://127.0.0.1:3000 E2E_SERVER_EMAIL=... E2E_SERVER_PASSWORD=... \
//        pnpm --filter @nb/e2e exec playwright test --project=web specs/server
import { randomUUID } from 'node:crypto';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';

const SERVER = process.env.E2E_SERVER_URL?.replace(/\/$/, '');
const EMAIL = process.env.E2E_SERVER_EMAIL ?? '';
const PASSWORD = process.env.E2E_SERVER_PASSWORD ?? '';

interface Markup {
  id: string;
  type: string;
  comment?: string;
  author: string;
  points: [number, number][];
}

async function drawingPdf(): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const title of ['ROOF FRAMING PLAN  S-101', 'SECTIONS  S-102']) {
    const page = pdf.addPage([842, 595]);
    page.drawRectangle({ x: 30, y: 30, width: 782, height: 535, borderWidth: 1, opacity: 0 });
    page.drawText(title, { x: 60, y: 520, size: 18, font });
  }
  return Buffer.from(await pdf.save());
}

async function newPerson(browser: Browser, errors: string[], who: string): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US' });
  // Open a local file through a file input, which Playwright can answer, not the native picker.
  await context.addInitScript(() => Reflect.deleteProperty(window, 'showOpenFilePicker'));
  const page = await context.newPage();
  page.on('pageerror', (err) => errors.push(`${who}: ${err.message}`));
  page.on('console', (message) => {
    // A signed-out visit asks who it is and hears 401.
    if (message.type() === 'error' && !message.text().includes('status of 401')) errors.push(`${who}: ${message.text()}`);
  });
  return page;
}

const markups = (page: Page): Promise<Markup[]> =>
  page.evaluate(() => JSON.parse(JSON.stringify(window.__nb.tools.store.all())) as Markup[]);

async function openProjectDocuments(page: Page, project: string): Promise<void> {
  const row = page.locator('.connect-projects-block li.connect-list-item', { hasText: project });
  await row.getByRole('button', { name: 'Documents' }).click();
  await expect(page.getByRole('region', { name: 'Project documents' })).toBeVisible();
}

async function openFirstRevision(page: Page): Promise<void> {
  await page.getByRole('region', { name: 'Project documents' }).getByRole('button', { name: 'Open' }).click();
  await expect(page.locator('.sync-status[data-sync-state="synced"]')).toBeVisible();
  await page.waitForFunction(() => !!window.__nb.tools.store);
}

const commandState = (page: Page, id: string) =>
  page.evaluate((commandId) => {
    const c = window.__nb.commands().get(commandId) as { enabled: boolean; managed?: boolean } | undefined;
    return c ? { enabled: c.enabled, hidden: !!c.managed } : null;
  }, id);

test('two people work on one server document', async ({ browser }, info) => {
  test.skip(!SERVER, 'E2E_SERVER_URL is not set');
  test.setTimeout(120_000);
  const errors: string[] = [];
  const project = `Wharf Pavilion ${randomUUID().slice(0, 6)}`;
  const reviewerEmail = `ben.${randomUUID().slice(0, 8)}@example.test`;

  // The admin signs in, makes a project, invites a reviewer and adds a PDF.
  const ada = await newPerson(browser, errors, 'admin');
  await ada.goto(`${SERVER}/`);
  await ada.getByLabel('Email').fill(EMAIL);
  await ada.getByLabel('Password').fill(PASSWORD);
  await ada.getByRole('button', { name: 'Sign in', exact: true }).click();
  await ada.getByRole('button', { name: 'New project' }).click();
  await ada.getByLabel('Project name').fill(project);
  await ada.getByRole('button', { name: 'Create project' }).click();

  const members = ada.locator('.review-invite-form');
  await expect(members).toBeVisible();
  await members.getByRole('button', { name: /invite/i }).click();
  const link = ada.locator('.review-invite-link-field input');
  await expect(link).toHaveValue(/\/invite\//);
  const inviteUrl = await link.inputValue();

  await openProjectDocuments(ada, project);
  await ada.getByTestId('add-pdf-input').setInputFiles({ name: 'S-101 roof.pdf', mimeType: 'application/pdf', buffer: await drawingPdf() });
  await expect(ada.getByRole('region', { name: 'Project documents' }).getByRole('button', { name: 'Open' })).toBeVisible({ timeout: 30_000 });
  await openFirstRevision(ada);

  // The reviewer accepts the invitation and opens the same revision.
  const ben = await newPerson(browser, errors, 'reviewer');
  const token = new URL(inviteUrl).pathname.split('/').pop()!;
  await ben.goto(`${SERVER}/#/invite/${token}`);
  await ben.getByLabel('Email').fill(reviewerEmail);
  await ben.getByLabel('Display name').fill('Ben Reviewer');
  await ben.getByLabel('Password', { exact: true }).fill('fictional-pass-135790');
  await ben.getByLabel('Confirm password').fill('fictional-pass-135790');
  await ben.getByRole('button', { name: 'Create account & accept' }).click();
  await openProjectDocuments(ben, project);
  await openFirstRevision(ben);

  // Each sees the other, and the page they are on.
  await expect(ada.locator('.sync-presence')).toContainText('Ben Reviewer · page 1');
  await expect(ben.locator('.sync-presence')).toContainText('page 1');

  // The reviewer draws a rectangle with the mouse; the admin sees it appear.
  await ben.evaluate(() => window.__nb.tools.setTool('rect'));
  const canvas = ben.locator('.pane canvas').first();
  const box = (await canvas.boundingBox())!;
  await ben.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.4);
  await ben.mouse.down();
  await ben.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.55, { steps: 6 });
  await ben.mouse.up();
  await expect.poll(async () => (await markups(ben)).length).toBe(1);
  await expect.poll(async () => (await markups(ada)).length).toBe(1);
  await expect(ben.locator('.sync-status[data-sync-state="synced"]')).toBeVisible();
  const [drawn] = await markups(ada);
  expect(drawn!.author).toBe('Ben Reviewer');

  // At the same moment the reviewer moves it and the admin writes its comment: both edits survive.
  const moved = drawn!.points.map(([x, y]) => [x + 60, y + 40] as [number, number]);
  await Promise.all([
    ben.evaluate(([id, points]) => window.__nb.tools.store.update(id, { points }), [drawn!.id, moved] as const),
    ada.evaluate((id) => window.__nb.tools.store.update(id, { comment: 'Confirm the bolt grade' }), drawn!.id),
  ]);
  for (const page of [ada, ben]) {
    await expect
      .poll(async () => {
        const [m] = await markups(page);
        return { comment: m?.comment, first: m?.points[0] };
      })
      .toEqual({ comment: 'Confirm the bolt grade', first: moved[0] });
    await expect(page.locator('.sync-status[data-sync-state="synced"]')).toBeVisible();
    await expect(page.locator('.sync-rejected-toggle')).toHaveCount(0);
  }

  // What a server document cannot do is gone, and its shortcut does nothing.
  for (const id of ['document.flatten', 'document.rotatePages', 'document.ocr', 'takeoff.portals', 'tools.takeoffReview', 'tool.length', 'tool.calibrate', 'file.save']) {
    expect(await commandState(ada, id), id).toEqual({ enabled: false, hidden: true });
  }
  expect(await commandState(ada, 'tool.cloud')).toEqual({ enabled: true, hidden: false });
  await expect(ada.locator('[data-ribbon-tab="measure"]')).toHaveCount(0);
  await expect(ada.locator('[data-ribbon-tab="takeoff"]')).toHaveCount(0);
  await expect(ada.locator('[data-ribbon-tab="markup"]')).toHaveCount(1);
  await ada.screenshot({ path: info.outputPath('server-document-admin.png') });

  // After a reload the reviewer opens it again, and the markup is still there.
  await ben.reload();
  await openProjectDocuments(ben, project);
  await openFirstRevision(ben);
  await expect.poll(async () => (await markups(ben)).map((m) => [m.id, m.comment])).toEqual([[drawn!.id, 'Confirm the bolt grade']]);
  await ben.screenshot({ path: info.outputPath('server-document-reviewer.png') });

  // A local file opened in the same app keeps every command.
  await ben.keyboard.press('Control+w');
  await expect(ben.locator('.sync-status')).toHaveCount(0);
  const chooser = ben.waitForEvent('filechooser');
  await ben.getByRole('button', { name: 'Open a local file', exact: true }).click();
  await (await chooser).setFiles({ name: 'site-notes.pdf', mimeType: 'application/pdf', buffer: await drawingPdf() });
  await expect.poll(() => commandState(ben, 'document.flatten')).toEqual({ enabled: true, hidden: false });
  for (const id of ['document.rotatePages', 'tool.length', 'tool.calibrate', 'file.save', 'takeoff.portals']) {
    expect(await commandState(ben, id), id).toEqual({ enabled: true, hidden: false });
  }
  await expect(ben.locator('[data-ribbon-tab="measure"]')).toHaveCount(1);
  await expect(ben.locator('.sync-status')).toHaveCount(0);
  await ben.screenshot({ path: info.outputPath('local-file.png') });

  expect(errors, errors.join('\n')).toEqual([]);
  await ada.context().close();
  await ben.context().close();
});
