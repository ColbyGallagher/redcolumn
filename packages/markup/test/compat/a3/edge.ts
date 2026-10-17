// Edge cases: degenerate and extreme geometry, very large point counts, off-page markups,
// and data that stresses text handling. Any of these may legitimately be refused by a reader;
// the point is to see which, and that nothing else on the page is lost.
import { mk, PageBuilder, type PageSpec } from './lib.ts';
import type { Point } from '../../../src/model.ts';
import { ngon, star } from './shapes.ts';

const pts = (n: number, f: (i: number) => Point): Point[] => Array.from({ length: n }, (_, i) => f(i));

export function edgeGeometry(p0: number): PageSpec {
  const P = new PageBuilder(p0, { title: 'Edge cases: degenerate and extreme geometry', sheet: 'E-101', cols: 6, rows: 6 });
  P.cell('E01 zero length: line, arrow, polyline', null, (r) => [
    mk('line', 0, [[r.x + 10, r.y + 10], [r.x + 10, r.y + 10]], { subject: 'E01 zero line' }),
    mk('arrow', 0, [[r.x + 40, r.y + 10], [r.x + 40, r.y + 10]], { subject: 'E01 zero arrow' }, { width: 4 }),
    mk('polyline', 0, [[r.x + 70, r.y + 10], [r.x + 70, r.y + 10], [r.x + 70, r.y + 10]], { subject: 'E01 zero polyline' }),
  ]);
  P.cell('E02 zero size: rect, ellipse, cloud, text box', null, (r) => [
    mk('rect', 0, [[r.x + 10, r.y + 10], [r.x + 10, r.y + 10]], { subject: 'E02 zero rect' }),
    mk('ellipse', 0, [[r.x + 40, r.y + 10], [r.x + 40, r.y + 40]], { subject: 'E02 zero-width ellipse' }),
    mk('cloud', 0, [[r.x + 70, r.y + 10], [r.x + 70, r.y + 10]], { subject: 'E02 zero cloud' }),
    mk('text', 0, [[r.x + 100, r.y + 10], [r.x + 100, r.y + 10]], { text: 'zero', subject: 'E02 zero text' }),
  ]);
  P.cell('E03 degenerate polygons: collinear, duplicate vertices', null, (r) => [
    mk('polygon', 0, [[r.x, r.y + 10], [r.x + 40, r.y + 10], [r.x + 80, r.y + 10]], { subject: 'E03 collinear' }),
    mk('polygon', 0, [[r.x, r.y + 30], [r.x, r.y + 30], [r.x + 60, r.y + 30], [r.x + 60, r.y + 60], [r.x + 60, r.y + 60], [r.x, r.y + 60]], { subject: 'E03 duplicates' }, { fill: '#c7d2fe' }),
  ]);
  P.cell('E04 reversed corners: rect, ellipse, text', null, (r) => [
    mk('rect', 0, [[r.x + 60, r.y + 50], [r.x + 5, r.y + 5]], { subject: 'E04 reversed rect' }),
    mk('ellipse', 0, [[r.x + 150, r.y + 50], [r.x + 80, r.y + 5]], { subject: 'E04 reversed ellipse' }),
  ]);
  P.cell('E05 2000-point pen stroke', null, (r) => [mk('pen', 0, pts(2000, (i) => [r.x + (i / 2000) * r.w, r.y + r.h / 2 + Math.sin(i / 20) * 30 * Math.cos(i / 400)]))]);
  P.cell('E06 500-point polyline; 200-vertex polygon', [2, 1], (r) => [
    mk('polyline', 0, pts(500, (i) => [r.x + (i / 500) * 150, r.y + 38 + Math.sin(i / 6) * 25]), { subject: 'E06 polyline x500' }),
    mk('polygon', 0, ngon(r.x + 260, r.y + 38, 50, 36, 200), { subject: 'E06 polygon x200' }),
  ]);
  P.cell('E07 count of 500 points', null, (r) => [mk('count', 0, pts(500, (i) => [r.x + (i % 50) * 3.2, r.y + Math.floor(i / 50) * 7]), {}, { arcRadius: 1.2 })]);
  P.cell('E08 opacity 0.01 fill; opacity 0.05 stroke; opacity 1', null, (r) => [
    mk('rect', 0, [[r.x, r.y], [r.x + 40, r.y + 50]], { subject: 'E08 fill .01' }, { fill: '#000000', opacity: 1, fillOpacity: 0.01 }),
    mk('rect', 0, [[r.x + 50, r.y], [r.x + 90, r.y + 50]], { subject: 'E08 opacity .05' }, { opacity: 0.05, width: 4 }),
    mk('rect', 0, [[r.x + 100, r.y], [r.x + 140, r.y + 50]], { subject: 'E08 opacity 1' }, { opacity: 1, width: 4 }),
  ]);
  P.cell('E09 font size 3 / 96 in text boxes', null, (r) => [
    mk('text', 0, [[r.x, r.y], [r.x + 60, r.y + 30]], { text: 'tiny text size three', subject: 'E09 3pt' }, { fontSize: 3 }),
    mk('text', 0, [[r.x + 70, r.y], [r.x + 150, r.y + 80]], { text: 'Big', subject: 'E09 96pt' }, { fontSize: 96 }),
  ]);
  P.cell('E10 rotations 360, -45, 720, 0.5', null, (r) =>
    [360, -45, 720, 0.5].map((a, i) => mk('rect', 0, [[r.x + i * 38, r.y + 15], [r.x + i * 38 + 30, r.y + 50]], { rotation: a, subject: `E10 rotation ${a}` })),
  );
  P.cell('E11 20 identical rectangles stacked', null, (r) => pts(20, () => [0, 0] as Point).map(() => mk('rect', 0, [[r.x, r.y], [r.x + 100, r.y + 50]], { subject: 'E11 stacked' })));
  P.cell('E12 pen with 1 point / 2 identical / 3 points', null, (r) => [
    mk('pen', 0, [[r.x + 5, r.y + 5]], { subject: 'E12 pen 1pt' }),
    mk('pen', 0, [[r.x + 30, r.y + 5], [r.x + 30, r.y + 5]], { subject: 'E12 pen 2 same' }),
    mk('pen', 0, [[r.x + 60, r.y + 5], [r.x + 80, r.y + 40], [r.x + 100, r.y + 5]], { subject: 'E12 pen 3pt' }),
  ]);
  P.cell('E13 line width 100; width 0.001', null, (r) => [
    mk('line', 0, [[r.x, r.y + 20], [r.x + 140, r.y + 20]], { subject: 'E13 width 100' }, { width: 100, opacity: 0.2 }),
    mk('line', 0, [[r.x, r.y + 60], [r.x + 140, r.y + 60]], { subject: 'E13 width .001' }, { width: 0.001 }),
  ]);
  P.cell('E14 text: 5000 chars in a tall box', null, (r) => [mk('text', 0, [[r.x, r.y], [r.x + r.w, r.y + r.h]], { text: 'lorem ipsum dolor sit amet '.repeat(185) }, { fontSize: 5 })]);
  P.cell('E15 text: one 400-char word, no spaces', null, (r) => [mk('text', 0, [[r.x, r.y], [r.x + r.w, r.y + 50]], { text: 'W'.repeat(400) }, { fontSize: 8 })]);
  P.cell('E16 dash arrays: [5], [500 500], [0.1 0.1]', null, (r) =>
    ([[5], [500, 500], [0.1, 0.1]] as number[][]).map((a, i) => mk('line', 0, [[r.x, r.y + 12 + i * 26], [r.x + r.w, r.y + 12 + i * 26]], { subject: `E16 dash [${a}]` }, { width: 2, dashArray: a, dash: 'dashed' })),
  );
  P.cell('E17 hatch scale 5 and 1000', null, (r) => [
    mk('rect', 0, [[r.x, r.y], [r.x + 70, r.y + 50]], { subject: 'E17 hatch 5%' }, { hatch: 'grid', hatchScale: 5 }),
    mk('rect', 0, [[r.x + 80, r.y], [r.x + 150, r.y + 50]], { subject: 'E17 hatch 1000%' }, { hatch: 'brick', hatchScale: 1000 }),
  ]);
  P.cell('E18 10 stacked identical count points', null, (r) => [mk('count', 0, pts(10, () => [r.x + 40, r.y + 30] as Point))]);
  P.cell('E19 callout: tip inside box; zero-size box', [2, 1], (r) => [
    mk('callout', 0, [[r.x + 60, r.y + 30], [r.x + 70, r.y + 30], [r.x, r.y], [r.x + 140, r.y + 60]], { text: 'tip inside own box', subject: 'E19 tip inside' }),
    mk('callout', 0, [[r.x + 180, r.y + 10], [r.x + 220, r.y + 40], [r.x + 260, r.y + 40], [r.x + 260, r.y + 40]], { text: 'zero box', subject: 'E19 zero box' }),
  ]);
  P.cell('E20 rounded corners larger than the shape', null, (r) => [mk('rect', 0, [[r.x, r.y + 10], [r.x + 100, r.y + 40]], {}, { cornerRadius: 200, width: 2 })]);
  P.cell('E21 clouds: arc 0.5 on 100x60; arc 80 on 100x60', null, (r) => [
    mk('cloud', 0, [[r.x, r.y], [r.x + 70, r.y + 50]], { subject: 'E21 arc .5' }, { arcRadius: 0.5 }),
    mk('cloud', 0, [[r.x + 80, r.y], [r.x + 150, r.y + 50]], { subject: 'E21 arc 80' }, { arcRadius: 80 }),
  ]);
  P.cell('E22 polygon cloud: collinear points', null, (r) => [mk('polygonCloud', 0, [[r.x, r.y + 20], [r.x + 50, r.y + 20], [r.x + 100, r.y + 20]])]);
  P.cell('E23 elliptical arc 0-0, 0-360, -90..90, 0-720', [2, 1], (r) =>
    ([[0, 0], [0, 360], [-90, 90], [0, 720]] as [number, number][]).map(([a, b], i) =>
      mk('ellipticalArc', 0, [[r.x + i * 82, r.y + 8], [r.x + i * 82 + 70, r.y + 70]], { arcAngles: [a, b], subject: `E23 ${a}..${b}` }, { width: 2 }),
    ),
  );
  P.cell('E24 arc: identical points; exactly collinear', null, (r) => [
    mk('arc', 0, [[r.x + 10, r.y + 10], [r.x + 10, r.y + 10], [r.x + 10, r.y + 10]], { subject: 'E24 arc same' }),
    mk('arc', 0, [[r.x + 30, r.y + 40], [r.x + 80, r.y + 40], [r.x + 130, r.y + 40]], { subject: 'E24 arc collinear' }),
  ]);
  P.cell('E25 table 1x50 and 50x1', [2, 1], (r) => {
    const wide = { cols: Array<number>(50).fill(1), rows: [1], cells: [Array.from({ length: 50 }, (_, i) => String(i % 10))] };
    const tall = { cols: [1], rows: Array<number>(50).fill(1), cells: Array.from({ length: 50 }, (_, i) => [String(i % 10)]) };
    return [
      mk('table', 0, [[r.x, r.y + 20], [r.x + 250, r.y + 40]], { table: wide, subject: 'E25 1x50' }, { fontSize: 5 }),
      mk('table', 0, [[r.x + 280, r.y], [r.x + 300, r.y + 75]], { table: tall, subject: 'E25 50x1' }, { fontSize: 3 }),
    ];
  });
  P.cell('E26 stamps: single empty-ish line; very small', null, (r) => [
    mk('stamp', 0, [[r.x, r.y], [r.x + 80, r.y + 24]], { stamp: { lines: ['-'], frame: 'box' }, subject: 'E26 dash stamp' }, { stroke: '#7c3aed' }),
    mk('stamp', 0, [[r.x + 100, r.y], [r.x + 106, r.y + 3]], { stamp: { lines: ['TINY'], frame: 'rounded' }, subject: 'E26 tiny stamp' }, { stroke: '#7c3aed' }),
  ]);
  P.cell('E27 measurement degenerate: self-crossing area, zero polylength, 180 deg angle, zero rays', [2, 1], (r) => [
    mk('area', 0, [[r.x, r.y], [r.x + 60, r.y + 60], [r.x + 60, r.y], [r.x, r.y + 60]], { subject: 'E27 bowtie area' }),
    mk('polylength', 0, [[r.x + 90, r.y + 10], [r.x + 90, r.y + 10]], { subject: 'E27 polylength zero' }),
    mk('angle', 0, [[r.x + 130, r.y + 40], [r.x + 180, r.y + 40], [r.x + 230, r.y + 40]], { subject: 'E27 straight angle' }),
    mk('angle', 0, [[r.x + 250, r.y + 40], [r.x + 250, r.y + 40], [r.x + 300, r.y + 10]], { subject: 'E27 zero ray angle' }),
    mk('radius', 0, [[r.x + 300, r.y + 60], [r.x + 300, r.y + 60]], { subject: 'E27 zero radius' }),
    mk('diameter', 0, [[r.x + 320, r.y + 60], [r.x + 320, r.y + 60]], { subject: 'E27 zero diameter' }),
  ]);
  P.cell('E28 volume with depth 0; area with depth 100 m', null, (r) => [
    mk('volume', 0, [[r.x, r.y], [r.x + 60, r.y], [r.x + 60, r.y + 50], [r.x, r.y + 50]], { depth: 0, subject: 'E28 volume depth 0' }),
    mk('area', 0, [[r.x + 80, r.y], [r.x + 140, r.y], [r.x + 140, r.y + 50], [r.x + 80, r.y + 50]], { depth: 100, subject: 'E28 depth 100 m' }),
  ]);
  P.cell('E29 star polygon, 3 holes in an area', null, (r) => [
    mk('area', 0, star(r.x + 80, r.y + 40, 70, 30), { subject: 'E29 star area, holes', holes: [ngon(r.x + 80, r.y + 40, 6, 6, 4), ngon(r.x + 60, r.y + 30, 3, 3, 4), ngon(r.x + 100, r.y + 50, 3, 3, 4)] }),
  ]);
  P.cell('E30 text highlight: zero-width and reversed quad', null, (r) => [
    mk('textHighlight', 0, [[r.x + 10, r.y + 10], [r.x + 10, r.y + 22]], { subject: 'E30 zero-width highlight' }),
    mk('underline', 0, [[r.x + 100, r.y + 22], [r.x + 20, r.y + 10]], { subject: 'E30 reversed underline' }),
  ]);

  // Markups that do not fit the cell grid: they cover or leave the page.
  const { w, h } = P.spec;
  P.add(
    mk('rect', 0, [[0, 0], [w, h]], { subject: 'E40 rectangle exactly the page' }, { stroke: '#7c3aed', width: 1 }),
    mk('line', 0, [[0, 0], [w, h]], { subject: 'E41 diagonal across the whole page' }, { stroke: '#7c3aed', width: 0.5 }),
    mk('cloud', 0, [[40, 40], [w - 40, h - 130]], { subject: 'E42 page-sized cloud' }, { stroke: '#a78bfa', width: 0.5 }),
    mk('rect', 0, [[w - 40, 200], [w + 60, 260]], { subject: 'E43 rectangle half off the right edge' }, { stroke: '#dc2626', width: 2 }),
    mk('line', 0, [[100, 100], [-200, -200]], { subject: 'E44 line leaving through the top-left' }, { stroke: '#dc2626', width: 2 }),
    mk('text', 0, [[300, h - 20], [420, h + 40]], { text: 'Text box straddling the bottom edge', subject: 'E45 text off the bottom edge' }, { stroke: '#dc2626' }),
    mk('rect', 0, [[w + 300, h + 300], [w + 400, h + 400]], { subject: 'E46 rectangle entirely off the page' }, { stroke: '#dc2626' }),
    mk('note', 0, [[0, 0], [24, 24]], { comment: 'note in the very corner', subject: 'E47 note at 0,0' }),
    mk('count', 0, [[w - 2, h - 2], [w + 5, h + 5], [-5, -5]], { subject: 'E48 count on and past edges' }),
  );
  return P.spec;
}

/** Text and data stress that stays within what the standard fonts can show. */
export function edgeData(p0: number): PageSpec {
  const P = new PageBuilder(p0, { title: 'Edge cases: names, ids and data', sheet: 'E-102' });
  const big = 'The quick brown fox jumps over the lazy dog. '.repeat(40);
  P.cell('D01 markup id with spaces and symbols', null, (r) => [mk('rect', 0, [[r.x, r.y], [r.x + 80, r.y + 40]], { id: 'id with spaces & <symbols> "quotes" é', subject: 'D01 odd id' })]);
  P.cell('D02 duplicate subjects (x3)', null, (r) => [0, 1, 2].map((i) => mk('rect', 0, [[r.x + i * 50, r.y], [r.x + i * 50 + 40, r.y + 40]], { subject: 'Duplicate subject' })));
  P.cell('D03 subject: empty string; whitespace', null, (r) => [
    mk('rect', 0, [[r.x, r.y], [r.x + 40, r.y + 40]], { subject: ' ' }),
    mk('rect', 0, [[r.x + 50, r.y], [r.x + 90, r.y + 40]], { subject: '\t' }),
  ]);
  P.cell('D04 same createdAt on every markup (ties)', null, (r) => [0, 1, 2].map((i) => mk('ellipse', 0, [[r.x + i * 50, r.y], [r.x + i * 50 + 40, r.y + 40]], { createdAt: 1, modifiedAt: 1, subject: 'D04 same time' })));
  P.cell('D05 dates: year 1970 and year 2099', null, (r) => [
    mk('rect', 0, [[r.x, r.y], [r.x + 40, r.y + 40]], { createdAt: 0, modifiedAt: 0, subject: 'D05 epoch' }),
    mk('rect', 0, [[r.x + 50, r.y], [r.x + 90, r.y + 40]], { createdAt: Date.UTC(2099, 0, 1), modifiedAt: Date.UTC(2099, 0, 1), subject: 'D05 2099' }),
  ]);
  P.cell('D06 text: 20 000 chars comment', null, (r) => [mk('rect', 0, [[r.x, r.y], [r.x + 80, r.y + 40]], { comment: big.repeat(12), subject: 'D06 huge comment' })]);
  P.cell('D07 note with 60 replies', null, (r) => [
    mk('note', 0, [[r.x + 5, r.y + 5], [r.x + 29, r.y + 29]], { comment: 'many replies', subject: 'D07 60 replies', replies: Array.from({ length: 60 }, (_, i) => ({ id: `d7-${i}`, author: `User ${i % 5}`, text: `Reply ${i}`, createdAt: 1_790_000_000_000 + i * 1000, ...(i % 3 ? { parentId: `d7-${i - 1}` } : {}) })) }),
  ]);
  P.cell('D08 reply parent missing; reply cycle', null, (r) => [
    mk('note', 0, [[r.x + 5, r.y + 5], [r.x + 29, r.y + 29]], {
      comment: 'broken reply chain',
      subject: 'D08 broken replies',
      replies: [
        { id: 'a', author: 'X', text: 'orphan, parent missing', createdAt: 1, parentId: 'zzz' },
        { id: 'b', author: 'X', text: 'cycle b -> c', createdAt: 2, parentId: 'c' },
        { id: 'c', author: 'X', text: 'cycle c -> b', createdAt: 3, parentId: 'b' },
      ],
    }),
  ]);
  P.cell('D09 fields referencing a column that does not exist', null, (r) => [mk('rect', 0, [[r.x, r.y], [r.x + 80, r.y + 40]], { fields: { 'col-does-not-exist': 'ghost value', 'col-ref': 'real value' }, subject: 'D09 unknown column id' })]);
  P.cell('D10 status id that is not defined', null, (r) => [mk('rect', 0, [[r.x, r.y], [r.x + 80, r.y + 40]], { status: 'mystery-status', subject: 'D10 unknown status' })]);
  P.cell('D11 layer name with unicode / symbols', null, (r) => [mk('rect', 0, [[r.x, r.y], [r.x + 80, r.y + 40]], { layer: 'Layer / "Rev B" – café (draft)', subject: 'D11 odd layer' })]);
  P.cell('D12 hyperlink to a page index that does not exist', null, (r) => [
    mk('hyperlink', 0, [[r.x, r.y], [r.x + 70, r.y + 30]], { link: { kind: 'page', pageIndex: 999, rect: null }, subject: 'D12 link to page 999' }),
    mk('hyperlink', 0, [[r.x + 80, r.y], [r.x + 150, r.y + 30]], { link: { kind: 'url', url: 'mailto:a3.tester@example.com?subject=Hello%20there' }, subject: 'D12 mailto' }),
  ]);
  P.cell('D13 locked + hidden + flagged + checked all at once', null, (r) => [mk('rect', 0, [[r.x, r.y], [r.x + 80, r.y + 40]], { locked: true, hidden: false, flagged: true, checked: true, status: 'accepted', subject: 'D13 every flag' })]);
  P.cell('D14 table cell text with newlines and specials', null, (r) => [
    mk('table', 0, [[r.x, r.y], [r.x + 150, r.y + 70]], { table: { cols: [1, 1], rows: [1, 1], cells: [['a\nb', '( ) \\ & <'], ['', '  ']] }, subject: 'D14 table specials' }, { fontSize: 7 }),
  ]);
  P.cell('D15 text box newline kinds: \\r\\n and \\r', null, (r) => [mk('text', 0, [[r.x, r.y], [r.x + 150, r.y + 60]], { text: 'crlf line one\r\nline two\rline three', subject: 'D15 CRLF' })]);
  P.cell('D16 markup with every optional style set', [2, 1], (r) => [
    mk('text', 0, [[r.x, r.y], [r.x + 200, r.y + 70]], {
      text: 'Every style property set', subject: 'D16 all styles',
    }, { fill: '#fef3c7', fillOpacity: 0.7, opacity: 0.9, width: 2.5, dash: 'dashDot', fontSize: 11, fontFamily: 'serif', bold: true, italic: true, underline: true, textColor: '#7c2d12', textAlign: 'center', verticalAlign: 'middle', cornerRadius: 8 }),
  ]);
  return P.spec;
}

/** Text outside the standard fonts' range: how a reader copes with CJK, emoji, RTL and symbols. */
export function unicodePage(p0: number): PageSpec {
  const P = new PageBuilder(p0, { title: 'Edge cases: characters beyond Latin-1', sheet: 'E-103' });
  const samples: [string, string][] = [
    ['Greek', 'Αθήνα Ω αβγ'],
    ['Cyrillic', 'Москва Тест'],
    ['Japanese', 'テスト 図面 確認'],
    ['Chinese', '中文 测试'],
    ['Arabic (RTL)', 'مرحبا بالعالم'],
    ['Math / arrows', '≥ ≤ ≠ → ← ✓ ∞ ≈'],
    ['Emoji', '😀 ✅ 🏗️'],
    ['Smart quotes / dashes', '“quoted” ‘single’ – — …'],
  ];
  for (const [name, s] of samples) {
    P.cell(`U text box: ${name}`, null, (r) => [mk('text', 0, [[r.x, r.y], [r.x + r.w, r.y + 40]], { text: s, subject: `U text ${name}`, comment: `comment: ${s}`, fields: { 'col-ref': s, 'col-notes': s } })]);
  }
  P.cell('U note comment + reply', null, (r) => [mk('note', 0, [[r.x + 5, r.y + 5], [r.x + 29, r.y + 29]], { comment: samples.map((s) => s[1]).join('\n'), replies: [{ id: 'u1', author: '中文 User', text: samples[2]![1], createdAt: 1_790_000_000_000 }], subject: 'U note unicode' })]);
  P.cell('U stamp lines + callout', [2, 1], (r) => [
    mk('stamp', 0, [[r.x, r.y], [r.x + 130, r.y + 40]], { stamp: { lines: ['承認済み', '✓ OK'], frame: 'rounded' }, subject: 'U stamp' }, { stroke: '#15803d' }),
    mk('callout', 0, [[r.x + 150, r.y + 60], [r.x + 190, r.y + 40], [r.x + 200, r.y], [r.x + 330, r.y + 40]], { text: 'مرحبا → café', subject: 'U callout' }),
  ]);
  return P.spec;
}

/**
 * Every dash pattern at 1, 2 and 3 pt widths, to see which ones Revu recognises: open a line's
 * Properties and check its Style. Revu wrote [2 2] and [3 3] (1 pt), [4 4] (3 pt) and [8 4 4 4] (1 pt) itself.
 */
export const DASH_ARRAYS: { label: string; dash: number[] }[] = [
  { label: 'Revu wrote: 2 2', dash: [2, 2] },
  { label: 'Revu wrote: 3 3', dash: [3, 3] },
  { label: 'Revu wrote: 4 4', dash: [4, 4] },
  { label: 'Revu wrote: 8 4 4 4', dash: [8, 4, 4, 4] },
  ...[[1, 1], [1, 2], [2, 1], [2, 4], [3, 1], [3, 2], [4, 2], [4, 3], [5, 5], [6, 2], [6, 3], [6, 2, 2, 2], [8, 6], [8, 8], [10, 5], [10, 10], [12, 4], [12, 6, 2, 6], [16, 8], [18, 8], [20, 10], [3, 2, 1, 2]].map((dash) => ({ label: dash.join(' '), dash })),
  { label: 'zero-length dash (dots): 0 5', dash: [0, 5] },
  { label: 'zero-length dash: 12 6 0 6', dash: [12, 6, 0, 6] },
  { label: 'redcolumn dashed at 2 pt: 8 6', dash: [8, 6] },
  { label: 'redcolumn longDash at 2 pt: 18 8', dash: [18, 8] },
];

export function dashMatrix(p0: number): PageSpec {
  const P = new PageBuilder(p0, { title: 'Dash patterns at 1, 2 and 3 pt: which does Revu keep?', sheet: 'D-101', cols: 6, rows: 6 });
  for (const { label, dash } of DASH_ARRAYS) {
    P.cell(`DA ${label}  (lines are 1, 2, 3 pt)`, null, (r) =>
      [1, 2, 3].map((w, i) => mk('line', 0, [[r.x, r.y + 12 + i * 24], [r.x + r.w, r.y + 12 + i * 24]], { subject: `DA [${dash.join(' ')}] ${w}pt` }, { width: w, dashArray: dash, dash: 'dashed' })),
    );
  }
  return P.spec;
}
