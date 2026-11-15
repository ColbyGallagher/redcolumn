import { test } from 'node:test';
import assert from 'node:assert/strict';
import { explain, scoreEvidence, spotCheckSample, stepMeter, wilsonLower } from './confidence.ts';

test('evidence adds up in log-odds', () => {
  // The forms alone score what detection gave them before evidence was kept.
  assert.equal(scoreEvidence(['bubble']), 0.9);
  assert.equal(scoreEvidence(['slash']), 0.85);
  assert.equal(scoreEvidence(['reference']), 0.8);
  assert.equal(scoreEvidence(['chainage']), 0.6);
  assert.equal(scoreEvidence(['chainage', 'alignmentAgrees']), 0.85);
  assert.equal(scoreEvidence(['bubble', 'cutMarker']), 0.93);
  assert.equal(scoreEvidence(['chainage', 'alignmentUnknown', 'severalAlignments']), 0.5);
});

test('explain puts the strongest reasons first', () => {
  const why = explain({ evidence: ['chainage', 'outsideSheetRange', 'alignmentUnknown'] });
  assert.deepEqual(
    why.map((w) => w.effect),
    ['lowers', 'raises', 'notes'],
  );
  assert.deepEqual(explain({}), []);
});

test('a few checks give a cautious lower bound', () => {
  assert.equal(Math.round(wilsonLower(8, 8) * 100), 68);
  assert.equal(Math.round(wilsonLower(40, 40) * 100), 91);
  assert.ok(wilsonLower(6, 8) < 0.5);
  assert.equal(wilsonLower(0, 0), 0);
});

const link = (i: number, confidence: number) => ({ id: `l${i}`, confidence });

test('spot checks take the least sure, the middle and a repeatable random rest', () => {
  const links = Array.from({ length: 40 }, (_, i) => link(i, (i % 10) / 10 + 0.05));
  const a = spotCheckSample(links, 8, 7);
  assert.equal(a.length, 8);
  assert.equal(new Set(a.map((l) => l.id)).size, 8);
  // The two least sure are in.
  assert.ok(a[0]!.confidence === 0.05 && a[1]!.confidence === 0.05);
  assert.deepEqual(
    spotCheckSample(links, 8, 7).map((l) => l.id),
    a.map((l) => l.id),
  );
  assert.equal(spotCheckSample(links.slice(0, 3), 8).length, 3);
});

test('step meter: scores until checked, then the checks', () => {
  const links = Array.from({ length: 20 }, (_, i) => link(i, 0.95));
  const fresh = stepMeter({ links, references: 20, linked: links.length });
  assert.equal(fresh.from, 'scores');
  assert.equal(fresh.band, 'good');
  // All 8 checks right: good, and at least 68% going by the checks alone.
  const right = new Map(links.slice(0, 8).map((l) => [l.id, true]));
  const checked = stepMeter({ links, references: 20, linked: 20, checks: right });
  assert.equal(checked.from, 'checks');
  assert.equal(checked.band, 'good');
  assert.equal(Math.round(checked.atLeast! * 100), 68);
  // 2 of 8 wrong: review; half wrong: AI, however sure the scores were.
  const twoWrong = new Map(links.slice(0, 8).map((l, i) => [l.id, i >= 2]));
  assert.equal(stepMeter({ links, references: 20, linked: 20, checks: twoWrong }).band, 'review');
  const halfWrong = new Map(links.slice(0, 8).map((l, i) => [l.id, i >= 4]));
  assert.equal(stepMeter({ links, references: 20, linked: 20, checks: halfWrong }).band, 'ai');
  assert.equal(fresh.atLeast, null);
});

test('step meter: half the references unlinked, or no text, recommend AI', () => {
  const links = Array.from({ length: 10 }, (_, i) => link(i, 0.95));
  const half = stepMeter({ links, references: 20, linked: links.length });
  assert.equal(half.band, 'ai');
  assert.ok(half.warnings.some((w) => w.includes('10 of 20')));
  const scanned = stepMeter({ links, references: 10, linked: 10, pages: 20, pagesWithoutText: 5 });
  assert.equal(scanned.band, 'ai');
  assert.equal(stepMeter({ links: [], references: 0, linked: 0 }).band, 'ai');
});
