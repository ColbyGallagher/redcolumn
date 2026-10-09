import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_STYLES, type Markup } from './model.ts';
import type { Matrix } from './export.ts';
import { invertMatrix, markupsFromXfdf, markupsToXfdf } from './xfdf.ts';

// A 400 × 300 page: page space is y down from the top, user space y up.
const matrix: Matrix = [1, 0, 0, -1, 0, 300];
const mk = (m: Partial<Markup> & Pick<Markup, 'id' | 'type' | 'points'>): Markup => ({ pageIndex: 0, style: { ...DEFAULT_STYLES[m.type] }, status: 'none', author: 'Ann', createdAt: 1000, modifiedAt: 2000, ...m });

test('markups go to XFDF and come back exactly, replies included', () => {
  const markups = [
    mk({ id: 'c1', type: 'cloud', points: [[10, 20], [110, 80]], comment: 'Check <this> & that', replies: [{ id: 'r1', author: 'Bo', text: 'Done', createdAt: 5000 }] }),
    mk({ id: 't1', type: 'text', points: [[50, 50], [150, 90]], text: 'Hello "world"' }),
  ];
  const xml = markupsToXfdf(markups, () => matrix, 'plan.pdf');
  assert.match(xml, /<polygon [^>]*style="cloudy"/);
  assert.match(xml, /<freetext [^>]*rect="/);
  assert.match(xml, /inreplyto="c1"/);
  assert.match(xml, /<f href="plan.pdf"\/>/);
  const back = markupsFromXfdf(xml, () => invertMatrix(matrix));
  assert.deepEqual(back, markups);
});

test('a reply to a reply comes back under that reply', () => {
  const markups = [
    mk({
      id: 'c1',
      type: 'cloud',
      points: [[10, 20], [110, 80]],
      comment: 'Check',
      replies: [
        { id: 'r2', author: 'Cy', text: 'Thanks', createdAt: 6000, parentId: 'r1' },
        { id: 'r1', author: 'Bo', text: 'Done', createdAt: 5000 },
      ],
    }),
  ];
  const xml = markupsToXfdf(markups, () => matrix);
  assert.match(xml, /name="r1"[^>]*inreplyto="c1"/);
  assert.match(xml, /name="r2"[^>]*inreplyto="r1"/);
  const [back] = markupsFromXfdf(xml, () => invertMatrix(matrix));
  assert.deepEqual(
    back!.replies?.map((r) => [r.id, r.parentId ?? '', r.text]),
    [
      ['r1', '', 'Done'],
      ['r2', 'r1', 'Thanks'],
    ],
  );
});

test("other tools' XFDF annotations become markups in page space", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<xfdf xmlns="http://ns.adobe.com/xfdf/" xml:space="preserve"><annots>
<square page="0" rect="10,200,110,280" color="#FF0000" width="2" name="sq" title="Acrobat User" date="D:20240102030405Z"><contents>Revise</contents></square>
<line page="0" rect="0,0,0,0" start="20,290" end="220,290" color="#0000FF" name="ln" title="X"/>
<text page="0" rect="0,0,20,20" inreplyto="sq" name="rp" title="Y"><contents>Agreed</contents></text>
</annots></xfdf>`;
  const [sq, ln] = markupsFromXfdf(xml, () => invertMatrix(matrix));
  assert.equal(sq!.type, 'rect');
  assert.equal(sq!.comment, 'Revise');
  assert.equal(sq!.author, 'Acrobat User');
  // User y 200..280 is page y 20..100, less half the border.
  assert.deepEqual(sq!.points, [[11, 21], [109, 99]]);
  assert.equal(sq!.replies?.[0]?.text, 'Agreed');
  assert.equal(sq!.replies?.[0]?.parentId, undefined);
  assert.equal(sq!.modifiedAt, Date.UTC(2024, 0, 2, 3, 4, 5));
  assert.equal(ln!.type, 'line');
  assert.deepEqual(ln!.points, [[20, 10], [220, 10]]);
});
