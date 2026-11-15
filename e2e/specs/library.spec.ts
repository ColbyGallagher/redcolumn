import { createHash } from 'node:crypto';
import { expect, test, type App } from '../support/app.ts';

// Browse Library: the community library's list and one pack, served by a stand-in for GitHub so
// nothing leaves the machine. Adding the pack puts its assembly in My Assemblies and its tool set
// in the Tool Library; adding it again replaces rather than doubles it; a pack whose bytes do not
// match the list is refused.

const BASE = 'https://raw.githubusercontent.com/ColbyGallagher/redcolumn-library/main/';

const pack = JSON.stringify({
  format: 'redcolumn.trade-pack',
  version: 1,
  name: 'E2E kerbs',
  trade: 'Civil / Roads',
  description: 'One kerb assembly and a tool.',
  author: 'e2e',
  units: 'metric',
  tags: ['kerb'],
  assemblies: [{ id: 'e2e-kerb', name: 'E2E kerb and gutter', description: '', variables: [{ name: 'Width', value: 0.45 }], items: [{ id: 'e2e-kerb-concrete', name: 'Concrete', unit: 'm³', formula: '[Length] * [Width] * 0.15' }] }],
  toolSets: [{ name: 'E2E kerb tools', items: [{ type: 'length', label: 'Kerb', style: { stroke: '#d97706' } }] }],
});
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const entry = (id: string, name: string, hash: string) => ({ id, name, trade: 'Civil / Roads', description: 'One kerb assembly and a tool.', author: 'e2e', units: 'metric', tags: ['kerb'], path: `packs/${id}.rctrade`, sha256: hash, size: pack.length, contents: { assemblies: 1, toolSets: 1, tools: 1 } });
const index = JSON.stringify({
  format: 'redcolumn.library-index',
  version: 1,
  entries: [entry('e2e-kerbs', 'E2E kerbs', sha(pack)), entry('e2e-tampered', 'E2E tampered', 'f'.repeat(64))],
});

/** Answers the library's requests from `files`, and records how they were asked. */
async function standInForGitHub(app: App) {
  await app.page.evaluate(
    ({ base, files }) => {
      const real = window.fetch.bind(window);
      const w = window as unknown as { __libraryAsked: { url: string; credentials?: string; referrerPolicy?: string }[] };
      w.__libraryAsked = [];
      window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (!url.startsWith(base)) return real(input, init);
        w.__libraryAsked.push({ url, credentials: init?.credentials, referrerPolicy: init?.referrerPolicy });
        const path = url.slice(base.length);
        return Promise.resolve(path in files ? new Response(files[path]) : new Response('', { status: 404 }));
      };
    },
    { base: BASE, files: { 'index.json': index, 'packs/e2e-kerbs.rctrade': pack, 'packs/e2e-tampered.rctrade': pack } },
  );
}

test.describe('library', () => {
  test.use({ toolbar: 'ribbon' });

  test.beforeEach(async ({ app }) => {
    await app.open('plan.pdf');
  });

  test('browse, add a pack, add it again, refuse a tampered one', async ({ app }) => {
    const { page } = app;
    await standInForGitHub(app);

    // tools.library: the list, filtered by search.
    await app.cmd('tools.library');
    const dialog = page.getByRole('dialog', { name: 'Community Library' });
    await expect(dialog.getByRole('heading', { name: 'E2E kerbs' })).toBeVisible();
    await dialog.getByRole('searchbox', { name: 'Search the library' }).fill('tampered');
    await expect(dialog.getByRole('heading', { name: 'E2E kerbs' })).toBeHidden();
    await dialog.getByRole('searchbox', { name: 'Search the library' }).fill('');

    const kerbs = dialog.locator('article', { has: page.getByRole('heading', { name: 'E2E kerbs', exact: true }) });
    await kerbs.getByRole('button', { name: 'Add' }).click();
    await expect(kerbs).toContainText('Added 1 assembly, 1 tool set (1 tool).');
    await kerbs.getByRole('button', { name: 'Add Again' }).click();
    await expect(kerbs.getByRole('button', { name: 'Add Again' })).toBeEnabled();

    const tampered = dialog.locator('article', { has: page.getByRole('heading', { name: 'E2E tampered' }) });
    await tampered.getByRole('button', { name: 'Add' }).click();
    await expect(dialog).toContainText('does not match the library');

    // Asked without credentials or a referrer.
    const asked = await page.evaluate(() => (window as unknown as { __libraryAsked: { url: string; credentials?: string; referrerPolicy?: string }[] }).__libraryAsked);
    expect(asked.length).toBeGreaterThanOrEqual(3);
    for (const a of asked) expect([a.credentials, a.referrerPolicy]).toEqual(['omit', 'no-referrer']);

    // Once in My Assemblies and once in the Tool Library, after adding twice.
    const stored = await page.evaluate(() => ({
      assemblies: (JSON.parse(localStorage.getItem('nb.assemblyLibrary') ?? '[]') as { name: string }[]).filter((a) => a.name === 'E2E kerb and gutter').length,
      toolSets: (localStorage.getItem('nb.profiles')?.match(/E2E kerb tools/g) ?? []).length,
    }));
    expect(stored).toEqual({ assemblies: 1, toolSets: 1 });

    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toBeHidden();
  });
});
