// Pages 3 and 4: text markups over real page text, text boxes, callouts, typewriter, notes, flags.
import { mk, PageBuilder, split, textWidth, type PageSpec } from './lib.ts';
import type { Point, Reply } from '../../../src/model.ts';

const NOTES: [string, boolean][] = [
  ['GENERAL NOTES AND SPECIFICATION CLAUSES', true],
  ['All dimensions are in millimetres unless noted otherwise.', false],
  ['Contractor to verify all dimensions on site before ordering materials.', false],
  ['Concrete shall be 40 MPa at 28 days with a maximum slump of 80 mm.', false],
  ['Reinforcement to AS/NZS 4671, grade 500N, lapped 600 mm minimum.', false],
  ['Fire rated walls to extend to underside of roof sheeting.', false],
  ['Provide 10 mm expansion joints at maximum 6000 mm centres.', false],
  ['Waterproofing membrane to turn up 150 mm at all wall junctions.', false],
  ['Refer to structural drawings for all penetrations through slab.', false],
  ['All penetrations through fire rated elements to be sealed.', false],
  ['Set out from gridline A and gridline 1 only.', false],
  ['Do not scale from this drawing.', false],
  ['Slab edge detail subject to engineer approval - see RFI 0042.', false],
  ['End of notes.', false],
];
const SIZE = 11;
const X0 = 42;
const Y0 = 78;
const STEP = 17;

/** Corner points of the characters `from`..`to` of note line `i`, as a text markup's quad (top-left, bottom-right). */
function span(i: number, from = 0, to = NOTES[i]![0].length): [Point, Point] {
  const [s, bold] = NOTES[i]!;
  const base = Y0 + i * STEP;
  const size = bold ? 12 : SIZE;
  const x0 = X0 + textWidth(s.slice(0, from), size, bold);
  const x1 = X0 + textWidth(s.slice(0, to), size, bold);
  return [[x0, base - size * 0.8], [x1, base + size * 0.22]];
}
const find = (i: number, word: string): [Point, Point] => {
  const k = NOTES[i]![0].indexOf(word);
  if (k < 0) throw new Error(`"${word}" not in note line ${i}`);
  return span(i, k, k + word.length);
};

const REPLIES = (base: number): Reply[] => [
  { id: `r${base}-1`, author: 'Priya Raman', text: 'Which detail does this refer to?', createdAt: base },
  { id: `r${base}-2`, author: 'A3 Tester', text: 'Detail 4 on A-501.', createdAt: base + 60_000, parentId: `r${base}-1` },
  { id: `r${base}-3`, author: 'Priya Raman', text: 'Thanks. Updated.', createdAt: base + 120_000, parentId: `r${base}-2` },
  { id: `r${base}-4`, author: "Zoë O'Brien", text: 'Second thread: check the setout too.', createdAt: base + 180_000 },
];

export function textPage(p0: number): PageSpec {
  const P = new PageBuilder(p0, { title: 'Text markups and text boxes', sheet: 'A-201' });
  NOTES.forEach(([s, bold], i) => P.baseText(X0, Y0 + i * STEP, s, bold ? 12 : SIZE, bold));
  P.reserve(0, 0, 2, 3);
  P.spec.captions.push({ x: 33, y: 52, text: 'TX: text markups sit over the real page text below (select / search it in Bluebeam)', size: 7 });

  P.add(
    mk('textHighlight', 0, span(1), { subject: 'TX01 text highlight, whole line' }),
    mk('textHighlight', 0, find(2, 'verify all dimensions'), { subject: 'TX02 text highlight, 3 words', comment: 'Check this against the survey.' }),
    mk('textHighlight', 0, [...span(4), ...span(5)], { subject: 'TX03 text highlight, two lines (4 points)' }, { stroke: '#4ade80', opacity: 0.35 }),
    mk('underline', 0, find(3, '40 MPa'), { subject: 'TX04 underline' }),
    mk('underline', 0, [...span(7, 0, 30), ...span(8, 0, 30)], { subject: 'TX05 underline, two lines' }, { stroke: '#0ea5e9', width: 2 }),
    mk('strikeout', 0, find(6, 'maximum 6000 mm centres'), { subject: 'TX06 strikeout' }),
    mk('squiggly', 0, find(8, 'structural drawings'), { subject: 'TX07 squiggly' }),
    mk('replaceText', 0, find(10, 'gridline A'), { text: 'grid line B', subject: 'TX08 replace text' }),
    mk('replaceText', 0, find(9, 'sealed'), { text: 'fire stopped with a tested system', subject: 'TX09 replace text, long replacement' }),
    mk('textHighlight', 0, span(12, 0, 24), { subject: 'TX10 highlight + status Accepted + reply', status: 'accepted', replies: REPLIES(T_BASE) }, { stroke: '#f97316' }),
    mk('strikeout', 0, span(13), { subject: 'TX11 strikeout, red 2pt', checked: true }, { stroke: '#dc2626', width: 2 }),
  );

  P.cell('TB01 text box, default', null, (r) => [mk('text', 0, [[r.x, r.y], [r.x + r.w, r.y + 40]], { text: 'Text box' })]);
  P.cell('TB02 wrapped paragraph, 9pt', null, (r) => [mk('text', 0, [[r.x, r.y], [r.x + r.w, r.y + r.h]], { text: 'The quick brown fox jumps over the lazy dog while the contractor verifies every dimension on site before ordering.' }, { fontSize: 9 })]);
  P.cell('TB03 filled yellow, 2pt blue border', null, (r) => [mk('text', 0, [[r.x, r.y], [r.x + r.w, r.y + 55]], { text: 'FILLED BOX' }, { fill: '#fef08a', stroke: '#1d4ed8', width: 2 })]);
  P.cell('TB04 no box / borderless+fill', null, (r) => [
    mk('text', 0, split(r, 0, 2).map((p, i) => (i ? [p[0], r.y + 50] : [p[0], r.y])) as Point[], { text: 'No box', subject: 'TB04 noBox' }, { noBox: true }),
    mk('text', 0, split(r, 1, 2).map((p, i) => (i ? [p[0], r.y + 50] : [p[0], r.y])) as Point[], { text: 'Borderless', subject: 'TB04 borderless' }, { borderless: true, fill: '#bbf7d0' }),
  ]);
  P.cell('TB05 fonts: sans / serif / mono', null, (r) =>
    (['sans', 'serif', 'mono'] as const).map((f, i) => mk('text', 0, [[split(r, i, 3)[0]![0], r.y], [split(r, i, 3)[1]![0], r.y + 36]], { text: `${f} 12`, subject: `TB05 ${f}` }, { fontFamily: f })),
  );
  P.cell('TB06 bold / italic / underline / all three', [2, 1], (r) =>
    [{ bold: true }, { italic: true }, { underline: true }, { bold: true, italic: true, underline: true }].map((s, i) => mk('text', 0, [[split(r, i, 4)[0]![0], r.y], [split(r, i, 4)[1]![0], r.y + 36]], { text: Object.keys(s).join('+'), subject: `TB06 ${Object.keys(s).join('+')}` }, s)),
  );
  P.cell('TB07 text colour red, border green, fill pale', null, (r) => [mk('text', 0, [[r.x, r.y], [r.x + r.w, r.y + 45]], { text: 'Coloured text' }, { textColor: '#b91c1c', stroke: '#15803d', fill: '#ecfccb', width: 2 })]);
  P.cell('TB08 alignment left / centre / right', null, (r) =>
    (['left', 'center', 'right'] as const).map((a, i) => mk('text', 0, [[split(r, i, 3)[0]![0], r.y], [split(r, i, 3)[1]![0], r.y + 36]], { text: a, subject: `TB08 ${a}` }, { textAlign: a })),
  );
  P.cell('TB09 vertical top / middle / bottom', null, (r) =>
    (['top', 'middle', 'bottom'] as const).map((a, i) => mk('text', 0, [[split(r, i, 3)[0]![0], r.y], [split(r, i, 3)[1]![0], r.y + 64]], { text: a, subject: `TB09 ${a}` }, { verticalAlign: a })),
  );
  P.cell('TB10 sizes 6 / 24 / 40 pt', [2, 1], (r) =>
    [6, 24, 40].map((s, i) => mk('text', 0, [[r.x + i * 110, r.y], [r.x + i * 110 + 100, r.y + (s > 30 ? 62 : 40)]], { text: `${s}pt`, subject: `TB10 ${s}pt` }, { fontSize: s })),
  );
  P.cell('TB11 rotated 90 / 33 / 180', [2, 1], (r) =>
    [90, 33, 180].map((a, i) => mk('text', 0, [[r.x + i * 105, r.y + 10], [r.x + i * 105 + 90, r.y + 50]], { text: `rot ${a}`, rotation: a, subject: `TB11 rotation ${a}` })),
  );
  P.cell('TB12 dashed border + opacity .4', null, (r) => [mk('text', 0, [[r.x, r.y], [r.x + r.w, r.y + 50]], { text: 'dashed / 40%' }, { dash: 'dashed', width: 2, opacity: 0.4, fill: '#fde68a' })]);
  P.cell('TB13 bullet list and numbered list', [2, 1], (r) => [
    mk('text', 0, [[r.x, r.y], [r.x + 150, r.y + 75]], { text: '- Item one\n- Item two\n  - Nested item\n- Item three', subject: 'TB13 bullets' }, { fontSize: 10 }),
    mk('text', 0, [[r.x + 170, r.y], [r.x + 320, r.y + 75]], { text: '1. First\n2. Second\n3. Third\n4. Fourth', subject: 'TB13 numbered' }, { fontSize: 10 }),
  ]);
  P.cell('TB14 characters: accents, symbols, ( ) \\ / # % & < > " \'', [2, 1], (r) => [
    mk('text', 0, [[r.x, r.y], [r.x + 165, r.y + 70]], { text: 'Ünïcödé é ñ ± ° ² ³ ½ µ € £ © ®', subject: 'TB14 latin symbols' }, { fontSize: 10 }),
    mk('text', 0, [[r.x + 175, r.y], [r.x + 340, r.y + 70]], { text: 'Esc: ( ) \\ / # % & < > " \' ; = [x]', subject: 'TB14 pdf/xml specials' }, { fontSize: 10 }),
  ]);
  P.cell('TB15 text overflowing a small box (clip)', null, (r) => [mk('text', 0, [[r.x, r.y], [r.x + 70, r.y + 24]], { text: 'This text is far too long to fit in this small box and should be clipped or flow out.' }, { fontSize: 10 })]);
  P.cell('TB16 empty text box; whitespace-only; newlines only', null, (r) => [
    mk('text', 0, split(r, 0, 3).map((p, i) => (i ? [p[0], r.y + 36] : [p[0], r.y])) as Point[], { text: '', subject: 'TB16 empty' }),
    mk('text', 0, split(r, 1, 3).map((p, i) => (i ? [p[0], r.y + 36] : [p[0], r.y])) as Point[], { text: '   ', subject: 'TB16 spaces' }),
    mk('text', 0, split(r, 2, 3).map((p, i) => (i ? [p[0], r.y + 36] : [p[0], r.y])) as Point[], { text: '\n\n\n', subject: 'TB16 newlines' }),
  ]);
  return P.spec;
}

const T_BASE = Date.UTC(2026, 9, 17, 10, 0, 0);

export function calloutsNotes(p0: number): PageSpec {
  const P = new PageBuilder(p0, { title: 'Callouts, typewriter, notes and flags', sheet: 'A-202' });
  P.cell('CO01 callout, default', [2, 1], (r) => [mk('callout', 0, [[r.x + 5, r.y + 60], [r.x + 60, r.y + 40], [r.x + 100, r.y + 5], [r.x + 320, r.y + 55]], { text: 'Check clash with services at this location.' })]);
  P.cell('CO02 callout, long two-segment leader, filled', [2, 1], (r) => [mk('callout', 0, [[r.x + 5, r.y + 70], [r.x + 140, r.y + 60], [r.x + 170, r.y + 5], [r.x + 330, r.y + 50]], { text: 'Fill + blue leader\nSecond line' }, { fill: '#e0f2fe', stroke: '#0369a1', width: 2 })]);
  P.cell('CO03 callout: open arrow tip, circle at knee side, dashed', [2, 1], (r) => [mk('callout', 0, [[r.x + 5, r.y + 10], [r.x + 70, r.y + 30], [r.x + 110, r.y + 8], [r.x + 320, r.y + 60]], { text: 'Dashed border, open arrow' }, { startCap: 'openArrow', dash: 'dashed' })]);
  P.cell('CO04 callout, tiny leader; no text', null, (r) => [
    mk('callout', 0, [[r.x + 40, r.y + 30], [r.x + 42, r.y + 30], [r.x + 44, r.y + 30], [r.x + r.w, r.y + 60]], { text: 'tiny', subject: 'CO04 tiny leader' }),
    mk('callout', 0, [[r.x, r.y + 10], [r.x + 10, r.y + 20], [r.x + 20, r.y], [r.x + 60, r.y + 25]], { text: '', subject: 'CO04 empty' }),
  ]);
  P.cell('CO05 callout, tip right of box (leader goes left)', [2, 1], (r) => [mk('callout', 0, [[r.x + 330, r.y + 70], [r.x + 270, r.y + 40], [r.x + 20, r.y + 5], [r.x + 230, r.y + 50]], { text: 'Leader from the right' })]);
  P.cell('TW01 typewriter, single line', null, (r) => [mk('typewriter', 0, [[r.x, r.y], [r.x + r.w, r.y + 20]], { text: 'Typewriter text' })]);
  P.cell('TW02 typewriter, multi-line 14pt red', null, (r) => [mk('typewriter', 0, [[r.x, r.y], [r.x + r.w, r.y + 60]], { text: 'Line one\nLine two\nLine three' }, { fontSize: 14, textColor: '#dc2626' })]);
  P.cell('TW03 typewriter, 8pt wrapped paragraph, mono', null, (r) => [mk('typewriter', 0, [[r.x, r.y], [r.x + r.w, r.y + 60]], { text: 'A longer typewriter paragraph that wraps across the width of its box.' }, { fontSize: 8, fontFamily: 'mono' })]);
  P.cell('TW04 typewriter: bold italic underline, centred', null, (r) => [mk('typewriter', 0, [[r.x, r.y], [r.x + r.w, r.y + 30]], { text: 'Bold italic' }, { bold: true, italic: true, underline: true, textAlign: 'center', fontSize: 14 })]);
  P.cell('TW05 typewriter rotated 90', null, (r) => [mk('typewriter', 0, [[r.x + 30, r.y + 10], [r.x + 130, r.y + 30]], { text: 'Rotated 90', rotation: 90 })]);
  P.cell('N01 note with comment', null, (r) => [mk('note', 0, [[r.x + 10, r.y + 10], [r.x + 34, r.y + 34]], { comment: 'A sticky note comment.\nSecond line of the comment.' })]);
  P.cell('N02 note with reply thread (3 deep) + status Rejected', null, (r) => [mk('note', 0, [[r.x + 10, r.y + 10], [r.x + 34, r.y + 34]], { comment: 'Needs review by structural.', replies: REPLIES(T_BASE + 5_000_000), status: 'rejected' })]);
  P.cell('N03 notes: colours, no comment, long comment', null, (r) => [
    mk('note', 0, [[r.x + 5, r.y + 10], [r.x + 29, r.y + 34]], { comment: 'green', subject: 'N03 green' }, { fill: '#86efac', stroke: '#166534' }),
    mk('note', 0, [[r.x + 45, r.y + 10], [r.x + 69, r.y + 34]], { subject: 'N03 no comment' }),
    mk('note', 0, [[r.x + 85, r.y + 10], [r.x + 109, r.y + 34]], { comment: 'x'.repeat(100) + '\n' + 'long comment '.repeat(60), subject: 'N03 long comment' }, { fill: '#fca5a5' }),
  ]);
  P.cell('N04 note with status each: accepted completed cancelled', null, (r) =>
    (['accepted', 'completed', 'cancelled'] as const).map((s, i) => mk('note', 0, [[r.x + 5 + i * 40, r.y + 10], [r.x + 29 + i * 40, r.y + 34]], { comment: s, status: s, subject: `N04 ${s}` })),
  );
  P.cell('FL01 flag label, default', null, (r) => [mk('flagLabel', 0, [[r.x, r.y + 5], [r.x + 100, r.y + 30]], { text: 'FLAG' })]);
  P.cell('FL02 flag labels: long text, tall, rotated 90', [2, 1], (r) => [
    mk('flagLabel', 0, [[r.x, r.y + 5], [r.x + 170, r.y + 30]], { text: 'Long flag label text here', subject: 'FL02 long' }),
    mk('flagLabel', 0, [[r.x + 190, r.y], [r.x + 270, r.y + 60]], { text: 'Tall', subject: 'FL02 tall' }, { fill: '#1d4ed8', stroke: '#1e3a8a' }),
    mk('flagLabel', 0, [[r.x + 280, r.y + 20], [r.x + 340, r.y + 40]], { text: 'Rot', rotation: 90, subject: 'FL02 rotated' }),
  ]);
  P.cell('FL03 flag (linked flag) + flagged markup', null, (r) => [
    mk('flag', 0, [[r.x + 10, r.y + 10], [r.x + 34, r.y + 34]], { comment: 'Follow up with architect', flagged: true, subject: 'FL03 flag' }),
    mk('rect', 0, [[r.x + 60, r.y + 10], [r.x + 130, r.y + 50]], { flagged: true, subject: 'FL03 flagged rectangle' }),
  ]);
  return P.spec;
}
