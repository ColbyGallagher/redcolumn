import { expect, test, type App } from '../support/app.ts';
import { PLAN } from '../support/driver.ts';

// fixtures/stitch.pdf: a road cut onto three sheets at world x 1000 and x 2000, each sheet turned
// by its own angle (make-fixtures.mjs). The assistant joins the first two with its own tools.
const S = PLAN.stitch;
const onSheet = (sheet: (typeof S.sheets)[number], [x, y]: [number, number]): [number, number] => {
  const cx = (sheet.from + sheet.to) / 2;
  const c = Math.cos(sheet.angle);
  const s = Math.sin(sheet.angle);
  const px = S.page.width / 2 + c * (x - cx) - s * y;
  const py = S.page.height / 2 + s * (x - cx) + c * y;
  return [px, S.page.height - py];
};
const toImage = (m: number[], [x, y]: [number, number]): [number, number] => [m[0]! * x + m[2]! * y + m[4]!, m[1]! * x + m[3]! * y + m[5]!];

interface StitchImage {
  pages: number[];
  scale: number;
  width: number;
  height: number;
  sheets: { page: number; toImage: number[] }[];
}

const detected = (app: App) => () => app.page.evaluate(() => (window.__nb.tools.store as unknown as { stitchGroups(): unknown[] }).stitchGroups().length);

test.describe('stitching with the assistant tools', () => {
  test.beforeEach(async ({ app }) => {
    await app.open('stitch.pdf');
  });

  test('match lines from the assistant join turned sheets, and the stitched page is written', async ({ app }) => {
    await expect.poll(detected(app), { timeout: 60_000 }).toBe(1);
    const [s1, s2] = S.sheets as [(typeof S.sheets)[number], (typeof S.sheets)[number]];

    await app.assistant('set_stitch_region', { page: 1, points: [[20, 20], [S.page.width - 20, S.page.height - 60]] });
    const placed = await app.assistant<{ lines: { problem?: string }[]; groups: { pages: number[]; sheets: { page: number; scale: number }[]; joins: { pages: number[]; byHand: boolean }[] }[] }>('place_match_lines', {
      pairs: [
        {
          name: 'X 1000',
          a: { page: 1, p0: onSheet(s1, [1000, -150]), p1: onSheet(s1, [1000, 150]), keepPoint: onSheet(s1, [500, 0]) },
          // Given the other way round on the second sheet: the order of the ends does not matter.
          b: { page: 2, p0: onSheet(s2, [1000, 150]), p1: onSheet(s2, [1000, -150]), keepPoint: onSheet(s2, [1500, 0]) },
        },
      ],
    });
    expect(placed.lines.every((l) => !l.problem)).toBe(true);
    const group = placed.groups.find((g) => g.pages.includes(1))!;
    expect(group.pages).toEqual(expect.arrayContaining([1, 2]));
    expect(group.joins).toContainEqual({ pages: [1, 2], name: 'X 1000', byHand: true });
    expect(Math.abs(group.sheets.find((s) => s.page === 2)!.scale - 1)).toBeLessThan(0.01);

    // The picture puts the same world point on both sheets at the same pixel, and keeps distances.
    const seen = await app.assistant<StitchImage>('get_stitch_image', { page: 1, maxSize: 1200 });
    expect(seen.width).toBeGreaterThan(0);
    const m1 = seen.sheets.find((s) => s.page === 1)!.toImage;
    const m2 = seen.sheets.find((s) => s.page === 2)!.toImage;
    const join1 = toImage(m1, onSheet(s1, [1000, 40]));
    const join2 = toImage(m2, onSheet(s2, [1000, 40]));
    expect(Math.hypot(join1[0] - join2[0], join1[1] - join2[1]) / seen.scale).toBeLessThan(2);
    const left = toImage(m1, onSheet(s1, [900, 0]));
    const right = toImage(m2, onSheet(s2, [1100, 0]));
    expect(Math.abs(Math.hypot(left[0] - right[0], left[1] - right[1]) / seen.scale - 200)).toBeLessThan(2);

    // The picture really holds the drawing: it is a PNG with dark linework in it.
    const ink = await app.page.evaluate(async () => {
      const r = (await window.__nb.assistant('get_stitch_image', { page: 1, maxSize: 600 })) as { image: { data: string } };
      const img = new Image();
      img.src = `data:image/png;base64,${r.image.data}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext('2d')!;
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let dark = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i]! < 100 && d[i + 1]! < 100 && d[i + 2]! < 100) dark++;
      return dark;
    });
    expect(ink).toBeGreaterThan(200);

    await app.assistant('show_stitched_view', { page: 1 });
    expect((await app.view()).mode).toBe('stitch');
    await app.assistant('show_stitched_view', { on: false });
    expect((await app.view()).mode).not.toBe('stitch');

    const before = (await app.documents())[0]!.pageCount;
    const made = await app.assistant<{ page: number; sheets: number[] }>('stitch_to_page', { page: 1 });
    expect(made.page).toBe(before + 1);
    await expect.poll(async () => (await app.documents())[0]!.pageCount).toBe(before + 1);
    const page = await app.assistant<{ width: number; height: number }>('get_page', { page: made.page });
    expect(page.width).toBeGreaterThan(S.page.width);

    // Reading back, sliding, and removing.
    const read = await app.assistant<{ lines: { id: string; page: number }[] }>('get_stitching', { page: 1 });
    const id = read.lines[0]!.id;
    const slid = await app.assistant<{ slid: { page: number }[] }>('update_match_lines', { lines: [{ id, slide: { apart: 12 } }] });
    expect(slid.slid[0]!.page).toBe(2);
    await app.assistant('delete_match_lines', { all: true });
    expect((await app.assistant<{ lines: unknown[] }>('get_stitching')).lines).toEqual([]);
  });
});
