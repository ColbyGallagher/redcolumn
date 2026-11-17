import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STAMP_IMAGE_BUDGET, type StampDef } from '@nb/markup';
import { addPictureStamps, stampFromImage, type PictureBitmap, type PictureCanvas, type PictureEnv } from './pictureStamp.ts';

/** A PNG header claiming `w` x `h` (just enough of a file to be sized). */
function pngHeader(w: number, h: number): Uint8Array {
  const b = new Uint8Array(32);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  return b;
}
const file = (bytes: Uint8Array, name: string, type: string) => new File([bytes as Uint8Array<ArrayBuffer>], name, { type });

/** A stand-in for the browser: decodes to the given size, records what was drawn, and encodes as a fixed string. */
function fakeEnv(opts: { alpha?: boolean; decodeFails?: boolean; urlLength?: (side: number) => number } = {}) {
  const log = { decodeBox: undefined as unknown, canvases: [] as { width: number; height: number; smoothing: string; types: string[] }[] };
  const env: PictureEnv = {
    async decode(_f, box) {
      if (opts.decodeFails) throw new Error('bad');
      log.decodeBox = box;
      const w = box.width ?? (box.height ? 0 : 4000);
      const bitmap: PictureBitmap = { width: w || 2000, height: w ? Math.round(w / 2) : 4000, close() {} };
      return bitmap;
    },
    canvas() {
      const entry = { width: 0, height: 0, smoothing: '', types: [] as string[] };
      log.canvases.push(entry);
      const canvas: PictureCanvas = {
        get width() {
          return entry.width;
        },
        set width(v) {
          entry.width = v;
        },
        get height() {
          return entry.height;
        },
        set height(v) {
          entry.height = v;
        },
        getContext: () => ({
          imageSmoothingEnabled: false,
          set imageSmoothingQuality(q: 'low' | 'medium' | 'high') {
            entry.smoothing = q;
          },
          get imageSmoothingQuality() {
            return 'high' as const;
          },
          drawImage() {},
          getImageData: (_x, _y, w, h) => {
            const data = new Uint8Array(w * h * 4).fill(255);
            if (opts.alpha) data[3] = 0;
            return { data };
          },
        }),
        toDataURL(type) {
          entry.types.push(type);
          const prefix = `data:${type};base64,`;
          return prefix + 'A'.repeat(Math.max(0, (opts.urlLength?.(entry.width) ?? 100) - prefix.length));
        },
      };
      return canvas;
    },
  };
  return { env, log };
}

test('a picture with see-through pixels is kept as a PNG', async () => {
  const { env } = fakeEnv({ alpha: true });
  const stamp = await stampFromImage(file(pngHeader(200, 100), 'Seal_One.png', 'image/png'), env);
  assert.match(stamp.art!.image, /^data:image\/png;base64,/);
  assert.equal(stamp.name, 'Seal One');
  assert.equal(stamp.art!.texts.length, 0);
});

test('a picture with none is stored as a JPEG', async () => {
  const { env } = fakeEnv({ alpha: false });
  const stamp = await stampFromImage(file(pngHeader(200, 100), 'photo.png', 'image/png'), env);
  assert.match(stamp.art!.image, /^data:image\/jpeg;base64,/);
});

test('a big picture is scaled down while it is decoded and drawn with high-quality smoothing', async () => {
  const { env, log } = fakeEnv();
  const stamp = await stampFromImage(file(pngHeader(6000, 3000), 'big.png', 'image/png'), env);
  assert.deepEqual(log.decodeBox, { width: 1280 });
  assert.equal(log.canvases[0]!.smoothing, 'high');
  assert.equal(stamp.art!.aspect, 2);
});

test('a picture too big for the library is made smaller until it fits', async () => {
  const { env, log } = fakeEnv({ alpha: true, urlLength: (side) => (side > 700 ? STAMP_IMAGE_BUDGET + 1 : 1000) });
  await stampFromImage(file(pngHeader(2000, 1000), 'detail.png', 'image/png'), env);
  assert.deepEqual(log.canvases.map((c) => c.width), [1280, 1024, 768, 512]);
  const never = fakeEnv({ urlLength: () => STAMP_IMAGE_BUDGET + 1 });
  await assert.rejects(stampFromImage(file(pngHeader(2000, 1000), 'x.png', 'image/png'), never.env), /too detailed/);
});

test('files that cannot be used are refused with a reason', async () => {
  const { env } = fakeEnv();
  await assert.rejects(stampFromImage(file(new Uint8Array(), 'e.png', 'image/png'), env), /empty/);
  await assert.rejects(stampFromImage(file(new Uint8Array([1]), 'logo.svg', 'image/svg+xml'), env), /SVG/);
  await assert.rejects(stampFromImage(file(new TextEncoder().encode('not a picture'), 'n.png', 'image/png'), env), /not a picture/);
  await assert.rejects(stampFromImage(file(pngHeader(20000, 20000), 'huge.png', 'image/png'), env), /too large/);
  await assert.rejects(stampFromImage(file(pngHeader(10, 10), 'bad.png', 'image/png'), fakeEnv({ decodeFails: true }).env), /not a picture/);
});

const stamp = (id: string, name: string, art?: boolean, texts = 0): StampDef => ({
  id,
  name,
  lines: [name],
  color: '#000',
  frame: 'none',
  art: art ? { image: 'data:image/png;base64,AA', aspect: 1, texts: Array.from({ length: texts }, () => ({}) as never) } : undefined,
});

test('importing pictures: the last of a name in a batch wins, and only picture stamps are replaced', () => {
  const library = [stamp('t', 'Approved'), stamp('p', 'Seal', true), stamp('r', 'Revu', true, 1)];
  const { stamps, added } = addPictureStamps(library, [stamp('a', 'Seal', true), stamp('b', 'Seal', true), stamp('c', 'Approved', true), stamp('d', 'Revu', true)]);
  assert.deepEqual(stamps.map((s) => s.id), ['t', 'r', 'b', 'c', 'd']);
  assert.deepEqual(added.map((s) => s.name), ['Seal', 'Approved (2)', 'Revu (2)']);
  assert.equal(added[1]!.lines[0], 'Approved (2)');
});
