import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoSizedPoints } from './edits.ts';
import { DEFAULT_STYLES, rotatePoint, rotationCentre, type Markup, type MarkupType, type Point } from './model.ts';
import { layoutParagraphs } from './textLists.ts';
import { TEXT_INK_METRICS, textBaselineOffset, textBoxLines } from './render.ts';
import { parseDefaultStyle } from './bluebeam.ts';

function mk(type: MarkupType, points: Point[], extra: Partial<Markup> = {}): Markup {
  return { id: `${type}-${points.length}`, type, pageIndex: 0, points, style: { ...DEFAULT_STYLES[type] }, status: 'none', author: '', createdAt: 1, modifiedAt: 1, ...extra };
}
const measure = (s: string) => s.length * 6;

test('Auto-size keeps the wrapped line breaks and only shrinks the box', () => {
  const text = 'alpha beta gamma delta epsilon zeta eta theta';
  const box = mk('text', [[20, 30], [140, 300]], { text, style: { ...DEFAULT_STYLES.text, fontSize: 10 } });
  const lines = layoutParagraphs(text, 140 - 20 - 8, measure);
  assert.ok(lines.length > 1);
  const [a, b] = autoSizedPoints(box, measure)!;
  const w = b![0] - a![0];
  assert.ok(w <= 120, 'never wider than before');
  const widest = Math.max(...lines.map((l) => measure(l.text)));
  assert.equal(w, Math.ceil(widest + 8 + 1));
  assert.equal(b![1] - a![1], Math.ceil(lines.length * 12 + 8));
  // The text still wraps the same way in the fitted box, and fitting again changes nothing.
  assert.deepEqual(layoutParagraphs(text, w - 8, measure).map((l) => l.text), lines.map((l) => l.text));
  assert.deepEqual(autoSizedPoints({ ...box, points: [a!, b!] }, measure), [a, b]);
});

test('Auto-size honours padding, and a rotated box keeps its corner', () => {
  const m = mk('text', [[0, 0], [200, 100]], { text: 'abc', style: { ...DEFAULT_STYLES.text, fontSize: 10, textMargin: 0 } });
  const [a, b] = autoSizedPoints(m, measure)!;
  assert.deepEqual([b![0] - a![0], b![1] - a![1]], [19, 12]);
  const turned = { ...m, rotation: 30 };
  const pts = autoSizedPoints(turned, measure)!;
  const corner = (mm: Markup) => rotatePoint([mm.points[0]![0], mm.points[0]![1]], rotationCentre(mm), 30);
  const [c1, c2] = [corner(turned), corner({ ...turned, points: pts })];
  assert.ok(Math.abs(c1[0] - c2[0]) < 1e-6 && Math.abs(c1[1] - c2[1]) < 1e-6);
});

test('Auto-size on a callout wraps at the text box width and keeps the leader', () => {
  const text = 'alpha beta gamma delta epsilon zeta';
  const c = mk('callout', [[0, 0], [10, 10], [50, 50], [170, 200]], { text, style: { ...DEFAULT_STYLES.callout, fontSize: 10 } });
  const pts = autoSizedPoints(c, measure)!;
  assert.deepEqual(pts.slice(0, 2), [[0, 0], [10, 10]]);
  assert.ok(pts[3]![0] - pts[2]![0] <= 120);
  assert.ok(pts[3]![1] - pts[2]![1] > 20);
});

test('middle alignment leaves equal gaps above capitals and below the last baseline', () => {
  for (const family of ['sans', 'serif', 'mono'] as const) {
    for (const text of ['ONE', 'ONE\nTWO\nTHREE']) {
      for (const textMargin of [0, 4, 9]) {
        const style = { ...DEFAULT_STYLES.text, fontSize: 12, fontFamily: family, verticalAlign: 'middle' as const, textMargin };
        const m = mk('text', [[0, 0], [200, 90]], { text, style });
        const lines = textBoxLines(m, measure);
        const fm = TEXT_INK_METRICS[family];
        const base = textBaselineOffset(style);
        const capTop = lines[0]!.y + base - fm.cap * 12;
        const lastBaseline = lines[lines.length - 1]!.y + base;
        assert.ok(Math.abs(capTop - (90 - lastBaseline)) < 1e-6, `${family} ${text.length} ${textMargin}`);
      }
    }
  }
});

test('zero padding round-trips through the default style string', () => {
  assert.equal(parseDefaultStyle('font: Helvetica 12pt; margin:-1pt').textMargin, 0);
  assert.equal(parseDefaultStyle('font: Helvetica 12pt; margin:0pt').textMargin, 1);
});
