import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDict, PDFDocument, PDFName, PDFRawStream, PDFStream, decodePDFRawStream, degrees } from 'pdf-lib';
import { exportWithAnnotations } from './export.ts';
import { DEFAULT_STYLES, type Markup, type VectorPicture } from './model.ts';
import { base64ToBytes, bytesToBase64, mirrorVector, pictureMatrix, pictureSegments, userToShown, type Matrix } from './vectorPicture.ts';

const at = (t: Matrix, x: number, y: number) => [t[0] * x + t[2] * y + t[4], t[1] * x + t[3] * y + t[5]].map((v) => Math.round(v * 1e6) / 1e6 + 0);

const picture = (vector: Partial<VectorPicture> = {}, extra: Partial<Markup> = {}): Markup & { vector: VectorPicture } => ({
  id: 'p1',
  type: 'image',
  pageIndex: 0,
  points: [[100, 50], [300, 150]],
  style: { ...DEFAULT_STYLES.image },
  image: 'data:image/png;base64,',
  status: 'none',
  author: 'Tester',
  createdAt: 1,
  modifiedAt: 1,
  ...extra,
  vector: { pdf: 'x', width: 100, height: 50, ...vector },
});

test('the picture is stretched over the markup box, and turned over when flipped', () => {
  assert.deepEqual(at(pictureMatrix(picture()), 0, 0), [100, 50]);
  assert.deepEqual(at(pictureMatrix(picture()), 100, 50), [300, 150]);
  const flipped = picture({ flipX: true });
  assert.deepEqual(at(pictureMatrix(flipped), 0, 0), [300, 50]);
  assert.deepEqual(at(pictureMatrix(flipped), 100, 50), [100, 150]);
  const both = picture(mirrorVector(mirrorVector(picture().vector, 'horizontal'), 'vertical'));
  assert.deepEqual(at(pictureMatrix(both), 0, 0), [300, 150]);
});

test('a cropped picture keeps its lines where they were', () => {
  // The right half shown: the box is the right half of where the whole picture was.
  const cropped = picture({}, { points: [[200, 50], [300, 150]], crop: { x: 0.5, y: 0, w: 0.5, h: 1 } });
  assert.deepEqual(at(pictureMatrix(cropped), 0, 0), [100, 50]);
  assert.deepEqual(at(pictureMatrix(cropped), 100, 50), [300, 150]);
});

test('user space maps to shown space for every page rotation', () => {
  const box = { l: 10, b: 20, r: 110, t: 70 }; // 100 wide, 50 tall
  // Unturned: top-left of the box is the origin.
  assert.deepEqual(at(userToShown(box, 0), 10, 70), [0, 0]);
  assert.deepEqual(at(userToShown(box, 0), 110, 20), [100, 50]);
  // Turned a quarter clockwise: the bottom-left corner comes to the top left, 50 wide and 100 tall.
  assert.deepEqual(at(userToShown(box, 90), 10, 20), [0, 0]);
  assert.deepEqual(at(userToShown(box, 90), 10, 70), [50, 0]);
  assert.deepEqual(at(userToShown(box, 90), 110, 20), [0, 100]);
  assert.deepEqual(at(userToShown(box, 180), 110, 20), [0, 0]);
  assert.deepEqual(at(userToShown(box, 180), 10, 70), [100, 50]);
  assert.deepEqual(at(userToShown(box, 270), 110, 70), [0, 0]);
  assert.deepEqual(at(userToShown(box, 270), 10, 70), [0, 100]);
  assert.deepEqual(at(userToShown(box, -90), 110, 70), [0, 0]);
});

test('the line work is placed on the page, cut to the box and turned with the markup', () => {
  // A line across the whole picture and one wholly inside its left half.
  const lines = [0, 25, 100, 25, 10, 10, 40, 10];
  const plain = pictureSegments(picture(), lines, [0, 1]);
  assert.deepEqual([...plain.segments], [100, 100, 300, 100, 120, 70, 180, 70]);
  assert.deepEqual([...plain.curves], [0, 1]);
  const cropped = pictureSegments(picture({}, { points: [[200, 50], [300, 150]], crop: { x: 0.5, y: 0, w: 0.5, h: 1 } }), lines);
  // The long line is cut where the box starts; the short one is gone with the left half.
  assert.deepEqual([...cropped.segments], [200, 100, 300, 100]);
  const turned = pictureSegments(picture({}, { rotation: 90 }), [50, 0, 50, 50]);
  // Rotated about the box centre (200, 100): the vertical line through it lies flat.
  const [x1, y1, x2, y2] = [...turned.segments].map((v) => Math.round(v));
  assert.deepEqual([Math.min(x1!, x2!), y1, Math.max(x1!, x2!), y2], [150, 100, 250, 100]);
});

test('base64 round trip', () => {
  const bytes = new Uint8Array(70000).map((_, i) => (i * 31) & 255);
  assert.deepEqual(base64ToBytes(bytesToBase64(bytes)), bytes);
});

/** A one-page PDF of a line, as a vector Snapshot keeps the area. */
async function areaPdf(rotate = 0): Promise<string> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([100, 50]);
  page.drawLine({ start: { x: 0, y: 25 }, end: { x: 100, y: 25 }, thickness: 1 });
  if (rotate) page.setRotation(degrees(rotate));
  return bytesToBase64(await doc.save());
}

async function appearanceOf(m: Markup): Promise<{ ops: string; xobjects: PDFDict }> {
  const doc = await PDFDocument.create();
  doc.addPage([400, 400]);
  const out = await PDFDocument.load(await exportWithAnnotations((await doc.save()).buffer as ArrayBuffer, [m]));
  const annots = out.getPage(0).node.Annots()!;
  const annot = out.context.lookup(annots.get(0), PDFDict);
  const ap = annot.lookup(PDFName.of('AP'), PDFDict);
  const n = ap.lookup(PDFName.of('N'), PDFStream) as PDFRawStream;
  const ops = new TextDecoder().decode(decodePDFRawStream(n).decode());
  const xobjects = n.dict.lookup(PDFName.of('Resources'), PDFDict).lookup(PDFName.of('XObject'), PDFDict);
  return { ops, xobjects };
}

test('a vector Snapshot is written as a form of its page, not as a picture', async () => {
  const { ops, xobjects } = await appearanceOf(picture({ pdf: await areaPdf() }));
  assert.match(ops, /\/Fm0 Do/);
  assert.doesNotMatch(ops, /\/Im0 Do/);
  const form = xobjects.lookup(PDFName.of('Fm0'), PDFStream);
  assert.equal(form.dict.lookup(PDFName.of('Subtype'))?.toString(), '/Form');
  // Its user space, unturned: y flips and the box is stretched twice over (100 x 50 onto 200 x 100).
  assert.match(ops, /2 0 0 -2 100 150 cm/);
});

test('a turned area page is placed turned', async () => {
  const { ops } = await appearanceOf(picture({ pdf: await areaPdf(90), width: 50, height: 100 }, { points: [[100, 50], [150, 150]] }));
  // A quarter turn: user x runs down the page and user y across it.
  assert.match(ops, /0 1 1 0 100 50 cm/);
});

test('markups over a vector Snapshot are written over it as a picture', async () => {
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const { ops, xobjects } = await appearanceOf(picture({ pdf: await areaPdf(), overlay: png }));
  assert.ok(ops.indexOf('/Fm0 Do') < ops.indexOf('/Im0 Do'));
  assert.ok(xobjects.get(PDFName.of('Im0')));
});

test('a vector Snapshot whose PDF cannot be read is written as its picture', async () => {
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const { ops } = await appearanceOf(picture({ pdf: bytesToBase64(new TextEncoder().encode('not a pdf')) }, { image: png }));
  assert.match(ops, /\/Im0 Do/);
});
