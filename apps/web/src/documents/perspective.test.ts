import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyHomography, flatSize, homography, type Pt } from './perspective.ts';

test('a homography maps the four corners exactly and straight lines to straight lines', () => {
  const quad: Pt[] = [[30, 40], [410, 20], [450, 330], [10, 300]];
  const rect: Pt[] = [[0, 0], [400, 0], [400, 300], [0, 300]];
  const h = homography(rect, quad);
  rect.forEach((p, i) => {
    const q = applyHomography(h, p);
    assert.ok(Math.hypot(q[0] - quad[i]![0], q[1] - quad[i]![1]) < 1e-6);
  });
  // The rectangle's centre goes to where the quad's diagonals cross.
  const c = applyHomography(h, [200, 150]);
  const cross = (a: Pt, b: Pt, p: Pt) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  assert.ok(Math.abs(cross(quad[0]!, quad[2]!, c)) < 1e-6 && Math.abs(cross(quad[1]!, quad[3]!, c)) < 1e-6);
  assert.deepEqual(flatSize(quad), { width: 441, height: 313 });
});
