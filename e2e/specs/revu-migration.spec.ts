import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { expect, test } from '../support/app.ts';

// File › Migrate from Revu: a Revu settings folder picked by hand (the desktop app finds none in
// its test APPDATA, so both projects pick it), listed by kind, and imported in one click.

const SHIFT = 0x10000;

function revuFolder(root: string) {
  const files: Record<string, string> = {
    // Cloud on O instead of C; Line stays on L.
    '21/KeyboardShortcuts.xml': `<?xml version="1.0" encoding="utf-8"?>\n<KeyboardShortcuts Version="1">\n  <Shortcut><Keys>79</Keys><Feature>Markup.Cloud</Feature></Shortcut>\n  <Shortcut><Keys>76</Keys><Feature>Markup.Line</Feature></Shortcut>\n  <Shortcut><Keys>${SHIFT | 86}</Keys><Feature>Pan</Feature></Shortcut>\n</KeyboardShortcuts>\n`,
    '21/Kestrel Sheets.xml': `<?xml version="1.0" encoding="utf-8"?>\n<root>\n  <bookmark dname="Cover Sheet" manual="1" />\n  <bookmark dname="Plans" manual="0">\n    <bookmark dname="Plan 1" manual="1" />\n  </bookmark>\n</root>\n`,
    '21/Categories/Kestrel.xml': `<?xml version="1.0" encoding="utf-8"?>\n<?categories version="1"?>\n<Kestrel_x0020_Roads>\n  <Category>\n    <Discipline>Roads</Discipline>\n    <Abbrev>R</Abbrev>\n  </Category>\n</Kestrel_x0020_Roads>\n`,
    // Never offered.
    '21/DigitalIDs.xml': '<?xml version="1.0"?><DigitalIDs><ID thumbprint="00"/></DigitalIDs>',
    '21/Templates/rfi.pdf': '%PDF-1.7',
  };
  for (const [name, text] of Object.entries(files)) {
    const file = join(root, 'Revu', name);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
  return join(root, 'Revu');
}

test('Migrate from Revu imports a picked settings folder in one click', async ({ app }, info) => {
  const folder = revuFolder(info.outputPath('revu'));
  await app.cmd('file.migrateRevu');
  const dialog = app.page.locator('.revu-migration');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: /Choose Folder/ })).toBeVisible();

  const input = dialog.locator('input[type=file]');
  await input.evaluate((el) => el.setAttribute('webkitdirectory', ''));
  await input.setInputFiles(folder);

  await expect(dialog.getByText('Keyboard shortcuts', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Bookmark templates', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Sets categories', { exact: true })).toBeVisible();
  await expect(dialog).not.toContainText('DigitalIDs');
  await dialog.getByRole('button', { name: 'Import 3 Items' }).click();

  await expect(dialog.locator('.revu-results')).toBeVisible();
  await expect(dialog).toContainText('Imported the bookmark template Kestrel Sheets');
  await expect(dialog).toContainText('Imported the Sets category template Kestrel Roads');
  await expect(dialog).toContainText('Imported Revu shortcuts: 2 commands changed');
  await expect(dialog.locator('.failed')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Done' }).click();

  const shortcuts = await app.page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('nb.profiles') ?? '{}') as { profiles: { id: string; state: { shortcuts: Record<string, string[]> } }[]; activeId: string };
    return saved.profiles.find((p) => p.id === saved.activeId)!.state.shortcuts;
  });
  expect(shortcuts['tool.cloud']).toEqual(['O']);
  expect(shortcuts['edit.offset']).toEqual([]);
});
