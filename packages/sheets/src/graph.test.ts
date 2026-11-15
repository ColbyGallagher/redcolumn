import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSheetGraph, type GraphLink } from './graph.ts';

const sheet = (number: string | null, discipline: string | null = null) => ({ number, title: null, discipline });
const link = (pageIndex: number, targetPage: number, kind: GraphLink['kind'], status?: GraphLink['status']): GraphLink => ({ pageIndex, targetPage, kind, status });

// G-001, C-101, C-102, C-501, S-201 and a page with no sheet number.
const SHEETS = [sheet('G-001'), sheet('C-101'), sheet('C-102'), sheet('C-501'), sheet('S-201'), sheet(null)];

test('links between the same two sheets are one edge, counted by kind', () => {
  const g = buildSheetGraph(6, SHEETS, [link(1, 3, 'detail', 'auto'), link(1, 3, 'detail', 'review'), link(1, 3, 'section', 'accepted'), link(1, 2, 'matchline', 'auto'), link(2, 1, 'matchline', 'auto')]);
  assert.deepEqual(g.edges, [
    { from: 1, to: 2, links: 1, byKind: { matchline: 1 }, review: 0 },
    { from: 1, to: 3, links: 3, byKind: { detail: 2, section: 1 }, review: 1 },
    { from: 2, to: 1, links: 1, byKind: { matchline: 1 }, review: 0 },
  ]);
  assert.deepEqual(
    g.nodes.map((n) => [n.number, n.out, n.in]),
    [
      ['G-001', 0, 0],
      ['C-101', 4, 1],
      ['C-102', 1, 1],
      ['C-501', 0, 3],
      ['S-201', 0, 0],
      [null, 0, 0],
    ],
  );
  assert.deepEqual(g.unlinked, [0, 4, 5]);
});

test('rejected links, links within a sheet and links off the set are not edges', () => {
  const g = buildSheetGraph(6, SHEETS, [link(1, 3, 'detail', 'rejected'), link(3, 3, 'detail', 'auto'), link(1, 9, 'sheet', 'auto'), link(-1, 2, 'sheet', 'auto')]);
  assert.deepEqual(g.edges, []);
  assert.equal(g.unlinked.length, 6);
});

test('a link fresh from detection, with no status, counts', () => {
  const g = buildSheetGraph(6, SHEETS, [link(0, 1, 'sheet')]);
  assert.deepEqual(g.edges, [{ from: 0, to: 1, links: 1, byKind: { sheet: 1 }, review: 0 }]);
});

test('kinds narrows the graph', () => {
  const links = [link(1, 3, 'detail', 'auto'), link(1, 2, 'matchline', 'auto'), link(4, 3, 'chainage', 'review')];
  const g = buildSheetGraph(6, SHEETS, links, { kinds: ['matchline', 'chainage'] });
  assert.deepEqual(
    g.edges.map((e) => [e.from, e.to, e.review]),
    [
      [1, 2, 0],
      [4, 3, 1],
    ],
  );
  assert.equal(buildSheetGraph(6, SHEETS, links, { kinds: [] }).edges.length, 3);
});

test('sheets group by discipline in set order, with unnumbered pages last', () => {
  const g = buildSheetGraph(6, SHEETS, []);
  assert.deepEqual(g.groups, [
    { discipline: 'General', pages: [0] },
    { discipline: 'Civil', pages: [1, 2, 3] },
    { discipline: 'Structural', pages: [4] },
    { discipline: null, pages: [5] },
  ]);
});

test("a sheet's own discipline wins over its number's letter", () => {
  // A drawing standard can name disciplines its own way (RD for Roads).
  const g = buildSheetGraph(3, { 0: sheet('RD-101', 'Roads'), 2: sheet('RD-102', 'Roads') }, [link(0, 2, 'matchline', 'auto')]);
  assert.deepEqual(g.groups, [
    { discipline: 'Roads', pages: [0, 2] },
    { discipline: null, pages: [1] },
  ]);
  assert.deepEqual(g.unlinked, [1]);
});

// A 14-sheet set: G-001 is the index and lists the other thirteen; C-102 calls up a detail on C-105.
const SET = Array.from({ length: 14 }, (_, i) => sheet(i === 0 ? 'G-001' : `C-${100 + i}`));
const LISTED = Array.from({ length: 13 }, (_, i) => link(0, i + 1, 'sheet', 'auto'));

test('a sheet index is named, and its links do not make a sheet linked', () => {
  const g = buildSheetGraph(14, SET, [...LISTED, link(2, 5, 'detail', 'auto')]);
  assert.deepEqual(g.indexPages, [0]);
  assert.equal(g.edges.length, 14);
  assert.equal(g.nodes[0]!.out, 13);
  assert.deepEqual(g.unlinked, [1, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13]);
});

test('the index is found whatever kinds are asked for', () => {
  const g = buildSheetGraph(14, SET, [...LISTED, link(2, 5, 'detail', 'auto')], { kinds: ['detail'] });
  assert.deepEqual(g.indexPages, [0]);
  assert.deepEqual(g.edges.map((e) => [e.from, e.to]), [[2, 5]]);
  assert.equal(g.unlinked.includes(0), false);
});

test('a sheet that points at many sheets some other way is not an index', () => {
  // Detail bubbles, not plain sheet references.
  const bubbles = Array.from({ length: 13 }, (_, i) => link(0, i + 1, 'detail', 'auto'));
  assert.deepEqual(buildSheetGraph(14, SET, bubbles).indexPages, []);
  // Each sheet referenced twice: a plan calling the same sheets up again and again.
  assert.deepEqual(buildSheetGraph(14, SET, [...LISTED, ...LISTED]).indexPages, []);
  // Ten sheets, none next to another in the set.
  const wide = Array.from({ length: 30 }, (_, i) => sheet(`C-${100 + i}`));
  const scattered = Array.from({ length: 10 }, (_, i) => link(0, i * 3 + 2, 'sheet', 'auto'));
  assert.deepEqual(buildSheetGraph(30, wide, scattered).indexPages, []);
  // A key plan: it lists its enlarged plans once each and in order, and each of them points back at it.
  const keyPlan = [...LISTED, ...LISTED.map((l) => link(l.targetPage, 0, 'sheet', 'auto'))];
  assert.deepEqual(buildSheetGraph(14, SET, keyPlan).indexPages, []);
  assert.deepEqual(buildSheetGraph(14, SET, keyPlan).unlinked, []);
  // A couple of sheets pointing back at the index (SEE G-001 FOR ABBREVIATIONS) leave it an index.
  assert.deepEqual(buildSheetGraph(14, SET, [...LISTED, link(4, 0, 'sheet', 'auto'), link(9, 0, 'sheet', 'auto')]).indexPages, [0]);
  // Nine sheets is a note, not an index.
  assert.deepEqual(buildSheetGraph(14, SET, LISTED.slice(0, 9)).indexPages, []);
  assert.deepEqual(buildSheetGraph(14, SET, LISTED.slice(0, 9)).unlinked, [10, 11, 12, 13]);
});

test('rejected entries of an index do not count toward it', () => {
  const g = buildSheetGraph(14, SET, [...LISTED.slice(0, 9), ...LISTED.slice(9).map((l) => ({ ...l, status: 'rejected' as const }))]);
  assert.deepEqual(g.indexPages, []);
});
