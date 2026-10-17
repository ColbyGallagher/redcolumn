// Page geometry: the same markups on pages that are rotated, portrait, offset (MediaBox not at the
// origin) or cropped (CropBox inside the MediaBox), to prove coordinates map correctly.
import { A3H, A3W, mk, PageBuilder, textWidth, type PageOpts, type PageSpec } from './lib.ts';
import { preset } from './measure.ts';
import { ngon, star } from './shapes.ts';
import type { Point } from '../../../src/model.ts';

const VARIANTS: (PageOpts & { portrait?: boolean })[] = [
  { title: 'Landscape media, /Rotate 90', sheet: 'G-101', rotate: 90, note: 'MediaBox A3 landscape, Rotate 90 (shows portrait)' },
  { title: 'Landscape media, /Rotate 180', sheet: 'G-102', rotate: 180, note: 'MediaBox A3 landscape, Rotate 180 (upside down)' },
  { title: 'Landscape media, /Rotate 270', sheet: 'G-103', rotate: 270, note: 'MediaBox A3 landscape, Rotate 270 (shows portrait)' },
  { title: 'Portrait A3, no rotation', sheet: 'G-104', portrait: true, note: 'MediaBox A3 portrait' },
  { title: 'Portrait media, /Rotate 90 (shows landscape)', sheet: 'G-105', portrait: true, rotate: 90, note: 'MediaBox A3 portrait, Rotate 90' },
  { title: 'MediaBox origin at (-100, -60)', sheet: 'G-106', box: { x: -100, y: -60, w: A3W, h: A3H }, note: 'MediaBox lower-left is negative' },
  { title: 'CropBox inset inside MediaBox', sheet: 'G-107', media: { x: 0, y: 0, w: A3W, h: A3H }, box: { x: 40, y: 30, w: 1100, h: 770 }, note: 'CropBox 40,30 1100x770 inside A3 MediaBox' },
  { title: 'Offset MediaBox + CropBox + Rotate 270', sheet: 'G-108', media: { x: -50, y: -50, w: A3W + 100, h: A3H + 100 }, box: { x: 10, y: 20, w: 1000, h: 700 }, rotate: 270, note: 'worst case: offset media, crop, rotate 270' },
];

export function geometry(p0: number): PageSpec[] {
  return VARIANTS.map((v, i) => {
    const P = new PageBuilder(p0 + i, { ...v, scale: preset('1:100') });
    const { w, h } = P.spec;
    // Orientation markers in the four corners of the display.
    const corners: [string, number, number][] = [['TOP-LEFT', 30, 30], ['TOP-RIGHT', w - 110, 30], ['BOTTOM-LEFT', 30, h - 60], ['BOTTOM-RIGHT', w - 110, h - 135]];
    for (const [label, x, y] of corners) {
      P.add(mk('text', 0, [[x, y], [x + 80, y + 22]], { text: label, subject: `corner ${label}` }, { fontSize: 8, fill: '#fef9c3' }));
    }
    // A line of base text for a text highlight and an underline.
    const sentence = 'Highlight this sentence on every page orientation.';
    const ty = 100;
    P.baseText(60, ty, sentence, 11);
    P.reserve(0, 0, 3, 1);
    const word = 'every page';
    const x0 = 60 + textWidth(sentence.slice(0, sentence.indexOf(word)), 11);
    P.add(
      mk('textHighlight', 0, [[60, ty - 9], [60 + textWidth(sentence, 11), ty + 2.5]], { subject: 'G text highlight, whole line' }),
      mk('underline', 0, [[x0, ty - 9], [x0 + textWidth(word, 11), ty + 2.5]], { subject: 'G underline words' }),
    );
    P.cell('G01 line + arrow', null, (r) => [mk('line', 0, [[r.x, r.y], [r.x + r.w, r.y + 20]], { subject: 'G01 line' }), mk('arrow', 0, [[r.x, r.y + 50], [r.x + r.w, r.y + 30]], { subject: 'G01 arrow' })]);
    P.cell('G02 rect rotated 30 + ellipse', null, (r) => [mk('rect', 0, [[r.x + 5, r.y + 10], [r.x + 65, r.y + 50]], { rotation: 30, subject: 'G02 rect rot 30' }, { fill: '#bae6fd' }), mk('ellipse', 0, [[r.x + 85, r.y + 5], [r.x + 150, r.y + 55]], { subject: 'G02 ellipse' })]);
    P.cell('G03 polygon + star + cloud', [2, 1], (r) => [
      mk('polygon', 0, ngon(r.x + 40, r.y + 40, 35, 35, 5), { subject: 'G03 pentagon' }),
      mk('polygon', 0, star(r.x + 130, r.y + 40, 38, 16), { subject: 'G03 star' }, { fill: '#fde047' }),
      mk('cloud', 0, [[r.x + 190, r.y + 8], [r.x + 270, r.y + 70]], { subject: 'G03 cloud' }),
    ]);
    P.cell('G04 text box rotated 90 + text box normal', null, (r) => [mk('text', 0, [[r.x + 5, r.y + 10], [r.x + 95, r.y + 40]], { text: 'rot 90', rotation: 90, subject: 'G04 text rot 90' }), mk('text', 0, [[r.x + 90, r.y + 10], [r.x + 150, r.y + 40]], { text: 'plain', subject: 'G04 text' })]);
    P.cell('G05 callout', [2, 1], (r) => [mk('callout', 0, [[r.x + 5, r.y + 65], [r.x + 60, r.y + 45], [r.x + 100, r.y + 5], [r.x + 300, r.y + 55]], { text: 'Callout leader on this orientation' })]);
    P.cell('G06 pen + highlighter', null, (r) => [
      mk('pen', 0, Array.from({ length: 30 }, (_, k) => [r.x + k * 5, r.y + 20 + Math.sin(k / 3) * 15] as Point), { subject: 'G06 pen' }),
      mk('highlighter', 0, [[r.x, r.y + 60], [r.x + 140, r.y + 60]], { subject: 'G06 highlighter' }),
    ]);
    P.cell('G07 length / area / count at 1:100', [2, 1], (r) => [
      mk('length', 0, [[r.x, r.y + 10], [r.x + 120, r.y + 10]], { subject: 'G07 length' }),
      mk('area', 0, [[r.x, r.y + 30], [r.x + 100, r.y + 30], [r.x + 100, r.y + 75], [r.x, r.y + 75]], { subject: 'G07 area' }),
      mk('count', 0, [[r.x + 180, r.y + 20], [r.x + 220, r.y + 40], [r.x + 260, r.y + 20], [r.x + 300, r.y + 40]], { subject: 'G07 count' }),
      mk('angle', 0, [[r.x + 300, r.y + 75], [r.x + 220, r.y + 75], [r.x + 260, r.y + 45]], { subject: 'G07 angle' }),
    ]);
    P.cell('G08 note + flag + stamp', null, (r) => [
      mk('note', 0, [[r.x + 5, r.y + 5], [r.x + 29, r.y + 29]], { comment: 'Note position check', subject: 'G08 note' }),
      mk('flag', 0, [[r.x + 40, r.y + 5], [r.x + 64, r.y + 29]], { comment: 'Flag', subject: 'G08 flag' }),
      mk('stamp', 0, [[r.x + 75, r.y + 5], [r.x + 160, r.y + 35]], { stamp: { lines: ['DRAFT'], frame: 'rounded' }, subject: 'G08 stamp' }, { stroke: '#6b7280' }),
    ]);
    P.cell('G09 hyperlink + table', [2, 1], (r) => [
      mk('hyperlink', 0, [[r.x, r.y + 10], [r.x + 80, r.y + 40]], { link: { kind: 'url', url: 'https://example.com/geometry' }, subject: 'G09 link' }),
      mk('table', 0, [[r.x + 100, r.y], [r.x + 300, r.y + 60]], { table: { cols: [1, 1], rows: [1, 1], cells: [['TL', 'TR'], ['BL', 'BR']] }, subject: 'G09 table' }),
    ]);
    P.cell('G10 dimension + polyline + arc', [2, 1], (r) => [
      mk('dimension', 0, [[r.x, r.y + 70], [r.x + 140, r.y + 70]], { text: '1400', subject: 'G10 dimension' }),
      mk('polyline', 0, [[r.x + 160, r.y + 70], [r.x + 200, r.y + 10], [r.x + 240, r.y + 70], [r.x + 280, r.y + 10]], { subject: 'G10 polyline' }),
      mk('arc', 0, [[r.x, r.y + 50], [r.x + 70, r.y], [r.x + 140, r.y + 50]], { subject: 'G10 arc' }),
    ]);
    return P.spec;
  });
}
