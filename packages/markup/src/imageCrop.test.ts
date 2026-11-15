import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream, PDFString, decodePDFRawStream } from 'pdf-lib';
import { exportWithAnnotations } from './export.ts';
import { cropImage, cropOf, imageFrame, mirrorCrop, uncropImage } from './imageCrop.ts';
import { DEFAULT_STYLES, boundsOf, rotatePoint, rotationCentre, type Markup, type Point } from './model.ts';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** A 200 x 100 picture at (100, 100). */
const image = (extra: Partial<Markup> = {}): Markup => ({
  id: 'img',
  type: 'image',
  pageIndex: 0,
  points: [[100, 100], [300, 200]],
  style: { ...DEFAULT_STYLES.image },
  image: PNG,
  status: 'none',
  author: 'Tester',
  createdAt: 1,
  modifiedAt: 1,
  ...extra,
});

const close = (a: number, b: number, what: string) => assert.ok(Math.abs(a - b) < 1e-6, `${what}: ${a} is not ${b}`);
const samePoints = (a: readonly Point[], b: readonly Point[], what: string) => a.forEach((p, i) => (close(p[0], b[i]![0], `${what} x${i}`), close(p[1], b[i]![1], `${what} y${i}`)));

/** Where a point of the picture (u, v as fractions of the whole picture) lands on the page. */
function onPage(m: Markup, u: number, v: number): Point {
  const { full } = imageFrame(m);
  const p: Point = [full.x + u * full.w, full.y + v * full.h];
  return m.rotation ? rotatePoint(p, rotationCentre(m), m.rotation) : p;
}

test('an uncropped image draws its picture over its whole box', () => {
  const m = image();
  assert.equal(cropOf(m), null);
  const { clip, full } = imageFrame(m);
  assert.deepEqual(clip, { x: 100, y: 100, w: 200, h: 100 });
  assert.deepEqual(full, clip);
});

test('cropping keeps the part between the corners and shrinks the box to it', () => {
  const change = cropImage(image(), [150, 120], [250, 180])!;
  assert.deepEqual(change.points, [[150, 120], [250, 180]]);
  assert.deepEqual(change.crop, { x: 0.25, y: 0.2, w: 0.5, h: 0.6 });
  const m = image(change);
  // The picture stays where it was: drawn whole at its old place, clipped to the new box.
  assert.deepEqual(imageFrame(m).full, { x: 100, y: 100, w: 200, h: 100 });
});

test('the corners can be given either way round, and a box past the picture is cut to it', () => {
  assert.deepEqual(cropImage(image(), [250, 180], [150, 120]), cropImage(image(), [150, 120], [250, 180]));
  const change = cropImage(image(), [50, 50], [200, 150])!;
  assert.deepEqual(change.points, [[100, 100], [200, 150]]);
  assert.deepEqual(change.crop, { x: 0, y: 0, w: 0.5, h: 0.5 });
});

test('cropping again cuts into the part already kept', () => {
  const once = image(cropImage(image(), [150, 120], [250, 180])!);
  const twice = cropImage(once, [200, 120], [250, 150])!;
  assert.deepEqual(twice.points, [[200, 120], [250, 150]]);
  const c = twice.crop!;
  close(c.x, 0.5, 'x');
  close(c.y, 0.2, 'y');
  close(c.w, 0.25, 'w');
  close(c.h, 0.3, 'h');
});

test('a box that misses the picture, or keeps too little of it, crops nothing', () => {
  assert.equal(cropImage(image(), [400, 400], [500, 500]), null);
  assert.equal(cropImage(image(), [150, 120], [150, 180]), null);
  assert.equal(cropImage(image({ image: undefined }), [150, 120], [250, 180]), null);
});

test('a crop to the whole picture is no crop', () => {
  assert.equal(cropImage(image(), [0, 0], [400, 400])!.crop, undefined);
});

test('reset shows the whole picture again, at the same size and place', () => {
  const m = image(cropImage(image(), [150, 120], [250, 180])!);
  const back = uncropImage(m)!;
  assert.equal(back.crop, undefined);
  samePoints(back.points, [[100, 100], [300, 200]], 'points');
  assert.equal(uncropImage(image()), null, 'nothing to reset');
});

test('a rotated image is cropped in its own frame and its picture does not move', () => {
  const m = image({ rotation: 30 });
  // Corners picked on the page: two points of the picture, turned with it.
  const a = onPage(m, 0.25, 0.2);
  const b = onPage(m, 0.75, 0.8);
  const cropped = image({ rotation: 30, ...cropImage(m, a, b)! });
  const c = cropOf(cropped)!;
  close(c.x, 0.25, 'x');
  close(c.y, 0.2, 'y');
  close(c.w, 0.5, 'w');
  close(c.h, 0.6, 'h');
  const box = boundsOf(cropped.points);
  close(box.w, 100, 'width kept');
  close(box.h, 60, 'height kept');
  for (const [u, v] of [[0.25, 0.2], [0.5, 0.5], [0.75, 0.8], [0, 0]] as const) samePoints([onPage(cropped, u, v)], [onPage(m, u, v)], `picture point ${u},${v}`);
  // And reset puts it back exactly.
  samePoints(uncropImage(cropped)!.points, m.points, 'reset');
});

test('mirroring a picture mirrors its crop, so the same part stays shown', () => {
  const c = { x: 0.1, y: 0.2, w: 0.3, h: 0.4 };
  const h = mirrorCrop(c, 'horizontal');
  close(h.x, 0.6, 'x');
  assert.equal(h.y, 0.2);
  const v = mirrorCrop(c, 'vertical');
  assert.equal(v.x, 0.1);
  close(v.y, 0.4, 'y');
});

test('a crop that is not usable is ignored', () => {
  assert.equal(cropOf({ crop: { x: 0.5, y: 0, w: 0.8, h: 1 } }), null, 'runs past the picture');
  assert.equal(cropOf({ crop: { x: 0, y: 0, w: 0, h: 1 } }), null, 'empty');
  assert.equal(cropOf({ crop: { x: Number.NaN, y: 0, w: 0.5, h: 1 } }), null, 'not a number');
});

/** The exported annotation's appearance operators and its saved markup data. */
async function exported(m: Markup): Promise<{ ops: string; data: Partial<Markup> }> {
  const doc = await PDFDocument.create();
  doc.addPage([400, 400]);
  const out = await PDFDocument.load(await exportWithAnnotations((await doc.save()).buffer as ArrayBuffer, [m]));
  const ops = out.context
    .enumerateIndirectObjects()
    .flatMap(([, o]) => (o instanceof PDFRawStream && o.dict.get(PDFName.of('Subtype')) === PDFName.of('Form') ? [Buffer.from(decodePDFRawStream(o).decode()).toString('latin1')] : []))
    .join('\n');
  const annot = out.context.lookup(out.getPage(0).node.Annots()!.get(0), PDFDict);
  const data = JSON.parse((annot.lookup(PDFName.of('NBData')) as PDFHexString | PDFString).decodeText()) as Partial<Markup>;
  return { ops, data };
}

test('a cropped image saves the whole picture clipped to its box, and keeps its crop', async () => {
  const { ops, data } = await exported(image(cropImage(image(), [150, 120], [250, 180])!));
  assert.match(ops, /150 120 100 60 re W n/);
  assert.match(ops, /200 0 0 -100 100 200 cm\s*\/Im0 Do/);
  assert.deepEqual(data.crop, { x: 0.25, y: 0.2, w: 0.5, h: 0.6 });
  assert.deepEqual(data.points, [[150, 120], [250, 180]]);
});

test('an uncropped image saves as before, with no clip', async () => {
  const { ops, data } = await exported(image());
  assert.doesNotMatch(ops, /re W n/);
  assert.match(ops, /200 0 0 -100 100 200 cm\s*\/Im0 Do/);
  assert.equal(data.crop, undefined);
});
