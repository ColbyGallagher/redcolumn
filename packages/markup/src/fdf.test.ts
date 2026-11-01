import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { DEFAULT_STYLES, type Markup } from './model.ts';
import { exportWithAnnotations, pageMatrix, type Matrix } from './export.ts';
import { fdfFromPdf, markupsFromFdf } from './fdf.ts';

const mk = (m: Partial<Markup> & Pick<Markup, 'id' | 'type' | 'points'>): Markup => ({ pageIndex: 0, style: { ...DEFAULT_STYLES[m.type] }, status: 'none', author: 'Ann', createdAt: 1000, modifiedAt: 2000, ...m });

/** A two-page PDF, 400 × 300, and what the app saves into it for these markups. */
async function saved(markups: Markup[]): Promise<{ pdf: Uint8Array; matrices: Matrix[] }> {
  const blank = await PDFDocument.create();
  blank.addPage([400, 300]);
  blank.addPage([400, 300]);
  const bytes = await blank.save();
  const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const pdf = await exportWithAnnotations(copy, markups);
  const doc = await PDFDocument.load(pdf);
  return { pdf, matrices: doc.getPages().map(pageMatrix) };
}

test('markups go to FDF and come back, replies and pages included', async () => {
  const markups = [
    mk({ id: 'c1', type: 'cloud', points: [[10, 20], [110, 80]], comment: 'Check this', replies: [{ id: 'r1', author: 'Bo', text: 'Done', createdAt: 5000 }] }),
    mk({ id: 't1', type: 'text', pageIndex: 1, points: [[50, 50], [150, 90]], text: 'Hello (world)' }),
    mk({ id: 'l1', type: 'line', points: [[20, 200], [180, 240]] }),
  ];
  const { pdf, matrices } = await saved(markups);
  const fdf = await fdfFromPdf(pdf, 'plan.pdf');
  assert.equal(new TextDecoder().decode(fdf.subarray(0, 8)), '%FDF-1.2');
  assert.match(new TextDecoder('latin1').decode(fdf), /\/Page 1/);

  const back = await markupsFromFdf(fdf, (i) => matrices[i] ?? null);
  assert.equal(back.fileName, 'plan.pdf');
  assert.deepEqual(back.skipped, []);
  assert.deepEqual(
    back.markups.map((m) => [m.id, m.type, m.pageIndex]).sort(),
    [['c1', 'cloud', 0], ['l1', 'line', 0], ['t1', 'text', 1]],
  );
  const cloud = back.markups.find((m) => m.id === 'c1')!;
  assert.equal(cloud.comment, 'Check this');
  assert.deepEqual(cloud.replies?.map((r) => [r.id, r.text]), [['r1', 'Done']]);
  assert.equal(back.markups.find((m) => m.id === 't1')!.text, 'Hello (world)');
});

test('an FDF reply names its parent by /NM, as Bluebeam writes it', async () => {
  const fdf = `%FDF-1.2
1 0 obj<</Version 1.5/FDF<</F(plan.pdf)/Annots[2 0 R 3 0 R]>>>>
endobj
2 0 obj<</Type/Annot/Subtype/Square/Subj(Rectangle)/C[1 0 0]/T(Ann)/NM(PARENT)/Rect[10 100 110 200]/Contents(Check)/Page 0/F 4>>
endobj
3 0 obj<</Type/Annot/Subtype/Text/Name/Note/T(Bo)/NM(CHILD)/IRT(PARENT)/Rect[10 100 28 118]/Contents(Agreed)/M(D:20260101120000Z)/Page 0/F 28>>
endobj
trailer
<</Root 1 0 R>>
%%EOF
`;
  const matrix: Matrix = [1, 0, 0, -1, 0, 300];
  const { markups, skipped } = await markupsFromFdf(new TextEncoder().encode(fdf), () => matrix);
  assert.deepEqual(skipped, []);
  assert.equal(markups.length, 1);
  assert.equal(markups[0]!.type, 'rect');
  assert.deepEqual(markups[0]!.replies?.map((r) => [r.author, r.text]), [['Bo', 'Agreed']]);
  // Rect is user space (y up); the markup is page space (y down).
  const [a, b] = markups[0]!.points as [number, number][];
  assert.ok(Math.abs(a![0] - 10) < 1 && Math.abs(a![1] - 100) < 1 && Math.abs(b![0] - 110) < 1 && Math.abs(b![1] - 200) < 1);
});

test('annotations with no markup equivalent are named, and pages the document lacks are reported', async () => {
  const fdf = `%FDF-1.2
1 0 obj<</FDF<</Annots[2 0 R 3 0 R]>>>>
endobj
2 0 obj<</Type/Annot/Subtype/Stamp/Subj(Approved)/Rect[10 10 100 40]/Page 0>>
endobj
3 0 obj<</Type/Annot/Subtype/Square/Rect[10 10 100 40]/Page 4>>
endobj
trailer
<</Root 1 0 R>>
%%EOF
`;
  const { markups, skipped } = await markupsFromFdf(new TextEncoder().encode(fdf), (i) => (i === 0 ? [1, 0, 0, -1, 0, 300] : null));
  assert.equal(markups.length, 0);
  assert.equal(skipped.length, 2);
  assert.match(skipped[0]!, /Stamp "Approved"/);
  assert.match(skipped[1]!, /page 5/);
});

test('a file that is not an FDF is refused', async () => {
  await assert.rejects(() => markupsFromFdf(new TextEncoder().encode('%PDF-1.7\n'), () => null), /not an FDF/);
  await assert.rejects(() => markupsFromFdf(new TextEncoder().encode('%FDF-1.2\n1 0 obj<<>>endobj\ntrailer\n<</Root 1 0 R>>\n'), () => null), /no \/FDF/);
});
