import { expect, test, type App } from '../support/app.ts';

// fixtures/stitch.pdf: three sheets of one road, joined by detection into one stitch. A LandXML
// corridor in GDA2020 / MGA zone 56 is aligned once over the stitch and every sheet registered.

const CORRIDOR = `<?xml version="1.0"?>
<LandXML version="1.2"><Units><Metric linearUnit="meter"/></Units><CoordinateSystem epsgCode="7856"/>
<Alignments><Alignment name="MC01"><CoordGeom><Line><Start>6250030 329990</Start><End>6250030 330250</End></Line></CoordGeom></Alignment></Alignments>
</LandXML>`;

type Store = {
  stitchGroups(): unknown[];
  setScale(pages: number[], scale: unknown): void;
  allGeoRegions(): { pageIndex: number; crs?: string; epsg?: number }[];
};
const detected = (app: App) => () => app.page.evaluate(() => (window.__nb.tools.store as unknown as Store).stitchGroups().length);
const geo = (app: App) => app.page.evaluate(() => (window.__nb.tools.store as unknown as Store).allGeoRegions().map((r) => ({ page: r.pageIndex, epsg: r.epsg })));

test.describe('geospatial', () => {
  test.beforeEach(async ({ app }) => {
    await app.open('stitch.pdf');
  });

  test('document.geospatial needs a scale, then registers every stitched sheet from one alignment', async ({ app }) => {
    await expect.poll(detected(app), { timeout: 60_000 }).toBe(1);
    await app.cmd('document.geospatial');
    const panel = app.page.locator('.geo-panel');
    await expect(panel).toBeVisible();
    expect((await app.command('document.geospatial')).checked).toBe(true);

    // No scale yet: the model can't be opened.
    const openModel = panel.getByRole('button', { name: 'Open Model…' });
    await expect(openModel).toBeDisabled();
    await expect(panel.locator('.geo-needs-scale')).toBeVisible();

    await app.page.evaluate(() =>
      (window.__nb.tools.store as unknown as Store).setScale([0, 1, 2], { metersPerPoint: (100 * 0.0254) / 72, unit: 'm', feetInches: false, precision: 2, label: '1:100' }),
    );
    await expect(openModel).toBeEnabled();

    await panel.getByLabel(/All stitched sheets/).check();
    await panel.locator('input[type=file]').setInputFiles({ name: 'corridor.xml', mimeType: 'text/xml', buffer: Buffer.from(CORRIDOR) });
    await expect(panel.locator('.geo-model-name')).toHaveText('corridor.xml');
    await expect(panel.getByLabel('Coordinate system')).toHaveValue('EPSG:7856');
    // Aligning over the stitch opens the stitched view.
    await expect.poll(async () => (await app.view()).mode).toBe('stitch');

    await panel.getByRole('button', { name: 'Georeference 3 Sheets' }).click();
    expect((await geo(app)).sort((a, b) => a.page - b.page)).toEqual([
      { page: 0, epsg: 7856 },
      { page: 1, epsg: 7856 },
      { page: 2, epsg: 7856 },
    ]);

    // One undo takes all three off again.
    await app.cmd('edit.undo');
    expect(await geo(app)).toEqual([]);
  });
});
