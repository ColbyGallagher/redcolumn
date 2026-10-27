import assert from 'node:assert/strict';
import test from 'node:test';
import { MarkupStore, type StoredStitchGroup } from '@nb/markup';
import { assistantCall, type AssistantDocument, type AssistantEnv } from './assistant.ts';

/** Two 1000 × 700 sheets of a long plan, joined at a vertical match line. */
async function doc(): Promise<AssistantDocument> {
  const store = await MarkupStore.open(`stitch-${Math.random()}`, { persist: false });
  return { id: 'set', name: 'C-101.pdf', pageCount: 3, pageIndex: 0, active: true, store, pageSize: () => ({ width: 1000, height: 700 }) };
}

const pair = (extra: Record<string, unknown> = {}) => ({
  name: 'STA 12+00',
  // On sheet 1 the drawing is left of x = 800; on sheet 2, right of x = 200. Sheet 2's ends are given bottom-up.
  a: { page: 1, p0: [800, 100], p1: [800, 600], keepPoint: [400, 350] },
  b: { page: 2, p0: [200, 600], p1: [200, 100], keepPoint: [600, 350] },
  ...extra,
});

interface Group {
  pages: number[];
  sheets: { page: number; scale: number; rotation: number }[];
  joins: { pages: number[]; name: string | null; byHand: boolean }[];
}

test('a pair of match lines joins two sheets, in one undo step', async () => {
  const d = await doc();
  const placed = (await assistantCall([d], 'place_match_lines', { pairs: [pair()] })) as { placed: { name: string; ids: string[] }[]; lines: { keepSide: string; matchTo: string; problem?: string }[]; groups: Group[] };
  assert.equal(placed.placed.length, 1);
  assert.equal(placed.placed[0]!.name, 'STA 12+00');
  assert.equal(placed.lines.length, 2);
  assert.ok(placed.lines.every((l) => l.matchTo && !l.problem));
  assert.equal(placed.groups.length, 1);
  assert.deepEqual(placed.groups[0]!.pages, [1, 2]);
  // Same scale, no turn: the ends' order did not matter.
  assert.equal(placed.groups[0]!.sheets[1]!.scale, 1);
  assert.equal(placed.groups[0]!.sheets[1]!.rotation, 0);
  assert.deepEqual(placed.groups[0]!.joins, [{ pages: [1, 2], name: 'STA 12+00', byHand: true }]);
  // Sheet 2 sits 600 points to the right, so its match line lands on sheet 1's.
  const [, second] = (await import('./assistantStitch.ts')).stitchGroupsOf(d)[0]!.placements;
  assert.deepEqual([Math.round(second!.toWorld[4]), Math.round(second!.toWorld[5])], [600, 0]);

  d.store.undo();
  assert.equal(d.store.manualStitch().lines.length, 0);
});

test('keepSide is walking from p0 to p1, and the bigger side stays by default', async () => {
  const d = await doc();
  await assistantCall([d], 'place_match_lines', {
    pairs: [{ a: { page: 1, p0: [800, 100], p1: [800, 600], keepSide: 'right' }, b: { page: 2, p0: [200, 100], p1: [200, 600] } }],
  });
  const read = (await assistantCall([d], 'get_stitching', {})) as { lines: { page: number; keepSide: string; name: string }[] };
  // Walking down the page at x = 800, the right-hand side is toward x = 0.
  assert.equal(read.lines.find((l) => l.page === 1)!.keepSide, 'right');
  // On sheet 2 the side with more of the sheet (x > 200) is the left-hand side walking down.
  assert.equal(read.lines.find((l) => l.page === 2)!.keepSide, 'left');
  assert.ok(read.lines.every((l) => l.name === 'ML-1'));
});

test('a sheet at another scale is scaled to fit, and bad pairs place nothing', async () => {
  const d = await doc();
  const placed = (await assistantCall([d], 'place_match_lines', {
    pairs: [{ a: { page: 1, p0: [800, 100], p1: [800, 600], keepPoint: [0, 0] }, b: { page: 2, p0: [200, 100], p1: [200, 350], keepPoint: [900, 0] } }],
  })) as { groups: Group[] };
  assert.equal(placed.groups[0]!.sheets[1]!.scale, 2);

  const before = d.store.manualStitch().lines.length;
  await assert.rejects(() => assistantCall([d], 'place_match_lines', { pairs: [pair(), { a: { page: 1, p0: [10, 10], p1: [10, 10] }, b: { page: 3, p0: [0, 0], p1: [0, 9] } }] }), /too short/);
  await assert.rejects(() => assistantCall([d], 'place_match_lines', { pairs: [{ a: { page: 1, p0: [0, 0], p1: [0, 9] }, b: { page: 1, p0: [5, 0], p1: [5, 9] } }] }), /different pages/);
  await assert.rejects(() => assistantCall([d], 'place_match_lines', { pairs: [{ a: { page: 1, p0: [0, 0], p1: [1200, 9] }, b: { page: 2, p0: [5, 0], p1: [5, 9] } }] }), /off page 1/);
  assert.equal(d.store.manualStitch().lines.length, before);
});

test('regions leave out the title block, and a line end outside one is a problem', async () => {
  const d = await doc();
  await assistantCall([d], 'place_match_lines', { pairs: [pair()] });
  const set = (await assistantCall([d], 'set_stitch_region', { page: 1, points: [[0, 0], [850, 650]] })) as { region: number[][]; lines: { problem?: string }[] };
  assert.deepEqual(set.region, [[0, 0], [850, 0], [850, 650], [0, 650]]);
  assert.equal(set.lines[0]!.problem, undefined);
  const tight = (await assistantCall([d], 'set_stitch_region', { page: 1, points: [[0, 0], [850, 0], [850, 400], [0, 400]] })) as { lines: { problem?: string }[] };
  assert.match(tight.lines[0]!.problem!, /outside the region/);
  await assistantCall([d], 'set_stitch_region', { page: 1, points: null });
  assert.equal(d.store.manualStitch().regions[0], undefined);
});

test('update_match_lines slides, flips, re-pairs, and resets', async () => {
  const d = await doc();
  const placed = (await assistantCall([d], 'place_match_lines', { pairs: [pair()] })) as { placed: { ids: string[] }[] };
  const [a, b] = placed.placed[0]!.ids as [string, string];
  const groups = await import('./assistantStitch.ts');
  const x = () => groups.stitchGroupsOf(d)[0]!.placements[1]!.toWorld;

  const slid = (await assistantCall([d], 'update_match_lines', { lines: [{ id: a, slide: { along: 0, apart: 10 } }] })) as { slid: { page: number }[] };
  assert.equal(slid.slid[0]!.page, 2);
  assert.equal(Math.round(x()[4]), 610);
  await assistantCall([d], 'update_match_lines', { lines: [{ id: a, slide: { along: 25 } }] });
  // Along the line (sheet 1's, run top to bottom) moves sheet 2 down the page.
  assert.equal(Math.round(x()[5]), 25);
  await assistantCall([d], 'update_match_lines', { lines: [{ id: b, resetSlide: true }] });
  assert.deepEqual([Math.round(x()[4]), Math.round(x()[5])], [600, 0]);

  await assistantCall([d], 'update_match_lines', { lines: [{ id: a, flip: true, name: 'ML-A' }] });
  const read = (await assistantCall([d], 'get_stitching', { page: 1 })) as { lines: { keepSide: string; name: string }[] };
  // It kept the right-hand side (toward x = 0); flipped, it keeps the left.
  assert.equal(read.lines[0]!.keepSide, 'left');
  assert.equal(read.lines[0]!.name, 'ML-A');

  await assistantCall([d], 'update_match_lines', { lines: [{ id: a, matchTo: null }] });
  assert.equal(groups.stitchGroupsOf(d).length, 0);
  await assert.rejects(() => assistantCall([d], 'update_match_lines', { lines: [{ id: a, slide: { apart: 5 } }] }), /not matched/);
  await assert.rejects(() => assistantCall([d], 'update_match_lines', { lines: [{ id: 'nope' }] }), /no match line nope/);
});

test('removing match lines asks first', async () => {
  const d = await doc();
  const placed = (await assistantCall([d], 'place_match_lines', { pairs: [pair()] })) as { placed: { ids: string[] }[] };
  const [a, b] = placed.placed[0]!.ids as [string, string];
  await assert.rejects(() => assistantCall([d], 'delete_match_lines', { ids: [a] }, { confirm: async () => false }), /Not confirmed/);
  assert.equal(d.store.manualStitch().lines.length, 2);
  let asked = '';
  await assistantCall([d], 'delete_match_lines', { ids: [a] }, { confirm: async (m) => ((asked = m), true) });
  assert.match(asked, /1 match line/);
  const left = d.store.manualStitch().lines;
  assert.deepEqual(left.map((l) => [l.id, l.matchTo]), [[b, null]]);
  await assistantCall([d], 'delete_match_lines', { all: true }, { confirm: async () => true });
  assert.equal(d.store.manualStitch().lines.length, 0);
});

test('the stitched picture covers the kept parts of every sheet, with each sheet\'s mapping', async () => {
  const d = await doc();
  let asked: { bounds: { x: number; y: number; w: number; h: number }; scale: number } | null = null;
  d.renderStitch = async (_group, bounds, scale) => ((asked = { bounds, scale }), { png: 'AAAA', width: Math.ceil(bounds.w * scale), height: Math.ceil(bounds.h * scale) });
  await assert.rejects(() => assistantCall([d], 'get_stitch_image', { page: 1 }), /not stitched/);
  await assistantCall([d], 'place_match_lines', { pairs: [pair()] });
  const seen = (await assistantCall([d], 'get_stitch_image', { page: 2, maxSize: 800 })) as { pages: number[]; bounds: { x: number; w: number; h: number }; scale: number; sheets: { page: number; toImage: number[] }[]; image: { mimeType: string } };
  assert.deepEqual(seen.pages, [1, 2]);
  // Sheet 1 kept to x = 800, sheet 2 from its x = 200 placed at 800: 1600 wide in all.
  assert.deepEqual([seen.bounds.x, seen.bounds.w, seen.bounds.h], [0, 1600, 700]);
  assert.equal(seen.scale, 0.5);
  assert.deepEqual(seen.sheets[1]!.toImage, [0.5, 0, 0, 0.5, 300, 0]);
  assert.equal(seen.image.mimeType, 'image/png');
  assert.ok(asked);

  const zoom = (await assistantCall([d], 'get_stitch_image', { region: { x: 700, y: 200, w: 200, h: 200 }, dpi: 144 })) as { region: { x: number; w: number }; scale: number };
  assert.deepEqual([zoom.region.x, zoom.region.w, zoom.scale], [700, 200, 2]);
});

test('the stitched view and Stitch to New Page go through the app, and the page asks first', async () => {
  const d = await doc();
  await assistantCall([d], 'place_match_lines', { pairs: [pair()] });
  const shown: (StoredStitchGroup | null)[] = [];
  const env: AssistantEnv = {
    confirm: async () => true,
    stitch: {
      show: (_id, group) => (shown.push(group), true),
      toPage: async () => ({ pageIndex: 3, markups: 2 }),
    },
  };
  const on = (await assistantCall([d], 'show_stitched_view', { page: 1 }, env)) as { stitched: boolean; pages: number[] };
  assert.deepEqual([on.stitched, on.pages], [true, [1, 2]]);
  await assistantCall([d], 'show_stitched_view', { on: false }, env);
  assert.equal(shown[1], null);

  const made = (await assistantCall([d], 'stitch_to_page', { page: 2 }, env)) as { page: number; sheets: number[]; markups: number };
  assert.deepEqual(made, { document: 'C-101.pdf', page: 4, sheets: [1, 2], markups: 2 });
  await assert.rejects(() => assistantCall([d], 'stitch_to_page', {}, { ...env, confirm: async () => false }), /Not confirmed/);
  await assert.rejects(() => assistantCall([d], 'stitch_to_page', {}, { ...env, stitch: { ...env.stitch!, toPage: async () => null } }), /on screen/);
});
