import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alignPages, suggestPlacement, type CommentGeometry, type Mask, type TextWordBox } from './index.ts';

function blank(width: number, height: number): Mask {
  return { width, height, data: new Uint8Array(width * height) };
}

function strokeRect(m: Mask, x: number, y: number, w: number, h: number, t = 2) {
  const fill = (rx: number, ry: number, rw: number, rh: number) => {
    for (let j = Math.max(0, Math.round(ry)); j < Math.min(m.height, Math.round(ry + rh)); j++) {
      for (let i = Math.max(0, Math.round(rx)); i < Math.min(m.width, Math.round(rx + rw)); i++) {
        m.data[j * m.width + i] = 1;
      }
    }
  };
  fill(x, y, w, t);
  fill(x, y + h - t, w, t);
  fill(x, y, t, h);
  fill(x + w - t, y, t, h);
}

/** Builds a miniature synthetic plan mask (1 px = 1 pt) with border + 3 interior rooms/features. */
function miniPlan(dx = 0, dy = 0, omitRoomB = false, redrawRoomC = false): Mask {
  const m = blank(400, 300);
  // Sheet border.
  strokeRect(m, 10 + dx, 10 + dy, 380, 280, 2);
  // Room A (top-left).
  strokeRect(m, 40 + dx, 40 + dy, 120, 90, 2);
  strokeRect(m, 65 + dx, 65 + dy, 40, 25, 2);
  // Room B (top-right) — optionally deleted.
  if (!omitRoomB) {
    strokeRect(m, 220 + dx, 40 + dy, 120, 90, 2);
    strokeRect(m, 250 + dx, 70 + dy, 50, 30, 2);
  }
  // Room C (bottom) — optionally redrawn with different geometry.
  if (!redrawRoomC) {
    strokeRect(m, 60 + dx, 170 + dy, 240, 80, 2);
    strokeRect(m, 110 + dx, 190 + dy, 50, 40, 2);
  } else {
    // Diagonal/rearranged walls in the same area.
    for (let i = 0; i < 80; i++) {
      const x = 90 + dx + i * 2;
      const y = 175 + dy + i;
      if (x >= 0 && x < m.width && y >= 0 && y < m.height) m.data[y * m.width + x] = 1;
    }
  }
  return m;
}

const baseWords = (dx = 0, dy = 0, omitB = false): TextWordBox[] => [
  { text: 'LOBBY', x0: 70 + dx, y0: 50 + dy, x1: 110 + dx, y1: 60 + dy },
  ...(omitB ? [] : [{ text: 'OFFICE', x0: 250 + dx, y0: 50 + dy, x1: 295 + dx, y1: 60 + dy }]),
  { text: 'HALL', x0: 150 + dx, y0: 200 + dy, x1: 185 + dx, y1: 210 + dy },
];

test('alignPages and suggestPlacement carry comments accurately across a shifted revision', () => {
  const oldMask = miniPlan(0, 0);
  const newMask = miniPlan(14, -9);
  const alignment = alignPages(
    {
      oldSize: { width: 400, height: 300 },
      newSize: { width: 400, height: 300 },
      oldMask,
      newMask,
      scale: 1,
      oldWords: baseWords(0, 0),
      newWords: baseWords(14, -9),
    },
    { retainEvidence: true },
  );

  assert.deepEqual(alignment.offset, [14, -9]);
  assert.ok(alignment.confidence > 0.9, `expected high confidence, got ${alignment.confidence}`);

  const comment: CommentGeometry = {
    points: [
      [55, 55],
      [120, 100],
    ],
  };
  const sug = suggestPlacement(alignment, comment);
  assert.equal(sug.kind, 'suggested');
  assert.ok(sug.confidence > 0.9);
  assert.deepEqual(sug.geometry.points, [
    [69, 46],
    [134, 91],
  ]);
});

test('suggestPlacement declines deleted content while placing surviving comments on the same sheet', () => {
  const oldMask = miniPlan(0, 0, false);
  const newMask = miniPlan(6, 4, true);
  const alignment = alignPages(
    {
      oldSize: { width: 400, height: 300 },
      newSize: { width: 400, height: 300 },
      oldMask,
      newMask,
      scale: 1,
      oldWords: baseWords(0, 0, false),
      newWords: baseWords(6, 4, true),
    },
    { retainEvidence: true },
  );

  assert.ok(alignment.confidence > 0.65);

  const onRoomA = suggestPlacement(alignment, { points: [[50, 50], [115, 95]] });
  assert.equal(onRoomA.kind, 'suggested');
  assert.deepEqual(onRoomA.geometry.points, [
    [56, 54],
    [121, 99],
  ]);

  const onDeletedRoomB = suggestPlacement(alignment, { points: [[245, 65], [305, 105]] });
  assert.equal(onDeletedRoomB.kind, 'none');
  assert.equal(onDeletedRoomB.reason, 'content-missing');
});

test('suggestPlacement declines heavily redrawn content locally', () => {
  const oldMask = miniPlan(0, 0, false, false);
  const newMask = miniPlan(0, 0, false, true);
  const alignment = alignPages(
    {
      oldSize: { width: 400, height: 300 },
      newSize: { width: 400, height: 300 },
      oldMask,
      newMask,
      scale: 1,
    },
    { retainEvidence: true },
  );

  const onRedrawnC = suggestPlacement(alignment, { points: [[105, 185], [165, 235]] });
  assert.equal(onRedrawnC.kind, 'none');
  assert.ok(onRedrawnC.reason === 'content-changed' || onRedrawnC.reason === 'content-missing');
});

test('suggestPlacement declines everything when two unrelated sheets share only an outer border', () => {
  const oldMask = blank(400, 300);
  const newMask = blank(400, 300);
  // Same outer border on both.
  strokeRect(oldMask, 10, 10, 380, 280, 2);
  strokeRect(newMask, 10, 10, 380, 280, 2);
  // Completely different interiors.
  strokeRect(oldMask, 50, 50, 100, 80, 2);
  strokeRect(oldMask, 60, 170, 90, 70, 2);
  strokeRect(newMask, 240, 60, 110, 60, 2);
  strokeRect(newMask, 210, 180, 130, 70, 2);

  const alignment = alignPages({
    oldSize: { width: 400, height: 300 },
    newSize: { width: 400, height: 300 },
    oldMask,
    newMask,
    scale: 1,
    oldWords: [{ text: 'PLAN', x0: 70, y0: 70, x1: 110, y1: 80 }],
    newWords: [{ text: 'ELEVATION', x0: 260, y0: 70, x1: 320, y1: 80 }],
  });

  assert.ok(alignment.confidence < 0.35, `expected low page confidence, got ${alignment.confidence}`);
  const sug = suggestPlacement(alignment, { points: [[60, 60], [120, 110]] });
  assert.equal(sug.kind, 'none');
  assert.equal(sug.reason, 'low-page-confidence');
});

test('suggestPlacement accepts PageAlignInput directly and transforms holes and rotation', () => {
  const oldMask = miniPlan(0, 0);
  const newMask = miniPlan(10, 5);
  const comment: CommentGeometry = {
    points: [
      [40, 40],
      [160, 40],
      [160, 130],
      [40, 130],
    ],
    holes: [
      [
        [65, 65],
        [105, 65],
        [105, 90],
        [65, 90],
      ],
    ],
    rotation: 15,
  };
  const sug = suggestPlacement(
    {
      oldSize: { width: 400, height: 300 },
      newSize: { width: 400, height: 300 },
      oldMask,
      newMask,
      scale: 1,
    },
    comment,
  );
  assert.equal(sug.kind, 'suggested');
  assert.equal(sug.geometry.rotation, 15);
  assert.deepEqual(sug.geometry.holes?.[0]?.[0], [75, 70]);
});

test('suggestPlacement rejects empty geometry and out-of-bounds geometry', () => {
  const oldMask = miniPlan(0, 0);
  const alignment = alignPages({
    oldSize: { width: 400, height: 300 },
    newSize: { width: 400, height: 300 },
    oldMask,
    newMask: oldMask,
    scale: 1,
  });

  assert.equal(suggestPlacement(alignment, { points: [] }).kind, 'none');
  const oob = suggestPlacement(alignment, { points: [[500, 400], [550, 450]] });
  assert.equal(oob.kind, 'none');
  if (oob.kind === 'none') assert.equal(oob.reason, 'out-of-bounds');

  // A box whose centre falls outside the page (e.g. 95% off-page) is also rejected as out-of-bounds.
  const mostlyOff = suggestPlacement(alignment, { points: [[395, 100], [495, 150]] });
  assert.equal(mostlyOff.kind, 'none');
  if (mostlyOff.kind === 'none') assert.equal(mostlyOff.reason, 'out-of-bounds');
});

test('alignPages omits full-page evidence by default and validates scale', () => {
  const oldMask = miniPlan(0, 0);
  const withoutEvidence = alignPages({
    oldSize: { width: 400, height: 300 },
    newSize: { width: 400, height: 300 },
    oldMask,
    newMask: oldMask,
    scale: 1,
  });
  assert.equal(withoutEvidence.evidence, undefined);

  const withEvidence = alignPages(
    {
      oldSize: { width: 400, height: 300 },
      newSize: { width: 400, height: 300 },
      oldMask,
      newMask: oldMask,
      scale: 1,
    },
    { retainEvidence: true },
  );
  assert.ok(withEvidence.evidence);

  assert.throws(
    () =>
      alignPages({
        oldSize: { width: 400, height: 300 },
        newSize: { width: 400, height: 300 },
        oldMask,
        newMask: oldMask,
        scale: 0,
      }),
    RangeError,
  );
  assert.throws(
    () =>
      alignPages({
        oldSize: { width: 400, height: 300 },
        newSize: { width: 400, height: 300 },
        oldMask,
        newMask: oldMask,
        scale: 1,
        oldScale: -2,
      }),
    RangeError,
  );
});

test('suggestPlacement does not double-rotate box markups under a 90-degree rotating transform', () => {
  // 90° clockwise rotation about the origin shifted by (+200, 0): (x, y) -> (200 - y, x).
  const oldMask = blank(200, 200);
  const newMask = blank(200, 200);
  strokeRect(oldMask, 40, 40, 80, 20, 2);
  // Under (x, y) -> (200 - y, x), the 80x20 box [40..120]x[40..60] lands on [140..160]x[40..120].
  strokeRect(newMask, 140, 40, 20, 80, 2);

  const alignment = alignPages(
    {
      oldSize: { width: 200, height: 200 },
      newSize: { width: 200, height: 200 },
      oldMask,
      newMask,
      scale: 1,
    },
    { transform: [0, 1, -1, 0, 200, 0], align: false, retainEvidence: true },
  );

  const sug = suggestPlacement(alignment, {
    points: [
      [40, 40],
      [120, 60],
    ],
    rotation: 0,
  });
  assert.equal(sug.kind, 'suggested');
  // Centre (80, 50) maps to (150, 80); unrotated box stays 80x20 around (150, 80), with rotation = 90°.
  assert.equal(sug.geometry.rotation, 90);
  assert.deepEqual(sug.geometry.points, [
    [110, 70],
    [190, 90],
  ]);

  // Also verify non-zero initial rotation accumulates cleanly.
  const sugRotated = suggestPlacement(alignment, {
    points: [
      [40, 40],
      [120, 60],
    ],
    rotation: 30,
  });
  assert.equal(sugRotated.kind, 'suggested');
  assert.equal(sugRotated.geometry.rotation, 120);
  assert.deepEqual(sugRotated.geometry.points, [
    [110, 70],
    [190, 90],
  ]);
});
