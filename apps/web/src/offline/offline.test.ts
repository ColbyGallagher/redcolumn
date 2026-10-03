import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { crc32, drawIcon, encodePng, ICON_FILES, iconPngs } from './icons.ts';
import { buildManifest } from './manifest.ts';
import { installPlatform, INSTALL_STEPS } from './install.ts';
import { describeStorage, formatBytes } from './storage.ts';
import { UpdateGate } from './updates.ts';
import { isPdf, parseLaunch } from './launch.ts';
import { ocrEngineFile, ocrFiles } from './ocrCache.ts';

const pixel = (px: Uint8Array, size: number, x: number, y: number) => [...px.subarray((y * size + x) * 4, (y * size + x) * 4 + 4)];

test('crc32 matches the standard check value', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('the icon has transparent rounded corners, a blue background, the white sheet and the blue mark', () => {
  const size = 64;
  const px = drawIcon(size);
  assert.equal(pixel(px, size, 0, 0)[3], 0, 'corner is outside the rounded square');
  assert.deepEqual(pixel(px, size, 4, 32), [0x1e, 0x3a, 0x8a, 255]);
  assert.deepEqual(pixel(px, size, 20, 45), [255, 255, 255, 255]);
  assert.deepEqual(pixel(px, size, 32, 28), [0x3b, 0x82, 0xf6, 255]);
  assert.deepEqual(pixel(px, size, 46, 17), [0x1e, 0x3a, 0x8a, 255], 'the folded corner is cut away');
});

test('maskable icons fill the square and keep the drawing inside the safe zone', () => {
  const size = 100;
  const px = drawIcon(size, { fullBleed: true, scale: 0.8 });
  assert.equal(pixel(px, size, 0, 0)[3], 255);
  // Everything that is not background lies within 40% of the size from the centre.
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r] = pixel(px, size, x, y);
      if (r !== 0x1e) assert.ok(Math.hypot(x + 0.5 - 50, y + 0.5 - 50) <= 40, `drawing at ${x},${y} is outside the safe zone`);
    }
  }
});

test('encodePng writes a valid PNG whose pixels decode back', async () => {
  const pixels = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 0, 10, 20, 30, 40]);
  const png = await encodePng(2, 2, pixels);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(png.buffer, png.byteOffset);
  const chunks: { type: string; data: Uint8Array }[] = [];
  for (let at = 8; at < png.length; ) {
    const len = view.getUint32(at);
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    assert.equal(view.getUint32(at + 8 + len), crc32(png.subarray(at + 4, at + 8 + len)), `${type} CRC`);
    chunks.push({ type, data: png.subarray(at + 8, at + 8 + len) });
    at += 12 + len;
  }
  assert.deepEqual(chunks.map((c) => c.type), ['IHDR', 'IDAT', 'IEND']);
  const ihdr = new DataView(chunks[0]!.data.buffer, chunks[0]!.data.byteOffset);
  assert.deepEqual([ihdr.getUint32(0), ihdr.getUint32(4), chunks[0]!.data[8], chunks[0]!.data[9]], [2, 2, 8, 6]);
  const raw = inflateSync(chunks[1]!.data);
  assert.deepEqual([...raw], [0, ...pixels.subarray(0, 8), 0, ...pixels.subarray(8)]);
});

test('iconPngs makes every icon the manifest and index.html name, at its size', async () => {
  const icons = await iconPngs();
  assert.deepEqual(icons.map((i) => i.name), ICON_FILES.map((f) => f.name));
  for (const icon of icons) {
    const size = ICON_FILES.find((f) => f.name === icon.name)!.size;
    const view = new DataView(icon.bytes.buffer, icon.bytes.byteOffset);
    assert.equal(view.getUint32(16), size);
    assert.equal(view.getUint32(20), size);
  }
});

test('the manifest is installable: id, scope, PNG and maskable icons, shortcuts, file handling and sharing', () => {
  const m = buildManifest('/redcolumn/');
  assert.equal(m.id, '/redcolumn/');
  assert.equal(m.start_url, '/redcolumn/');
  assert.equal(m.scope, '/redcolumn/');
  assert.equal(m.display, 'standalone');
  const sizes = (purpose: string) => m.icons.filter((i) => i.type === 'image/png' && i.purpose === purpose).map((i) => i.sizes);
  assert.deepEqual(sizes('any'), ['192x192', '512x512']);
  assert.deepEqual(sizes('maskable'), ['192x192', '512x512']);
  assert.ok(m.icons.every((i) => i.src.startsWith('/redcolumn/')));
  assert.deepEqual(m.shortcuts.map((s) => s.url), ['/redcolumn/?action=open', '/redcolumn/?action=new']);
  assert.deepEqual(m.file_handlers, [{ action: '/redcolumn/', accept: { 'application/pdf': ['.pdf'] } }]);
  assert.equal(m.share_target.action, '/redcolumn/share-target');
  assert.equal(m.share_target.method, 'POST');
  assert.equal(m.share_target.enctype, 'multipart/form-data');
  assert.deepEqual(m.share_target.params.files[0]!.accept, ['application/pdf', '.pdf']);
});

test('installPlatform picks the right steps for each browser', () => {
  const cases: [string, number, string][] = [
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1', 5, 'ios'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15', 5, 'ios'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15', 0, 'safari-mac'],
    ['Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36', 5, 'android'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 Edg/126.0', 0, 'chromium'],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0', 0, 'firefox'],
  ];
  for (const [ua, touch, want] of cases) assert.equal(installPlatform(ua, touch), want, ua);
  assert.match(INSTALL_STEPS.ios.join(' '), /Add to Home Screen/);
});

test('formatBytes and describeStorage', () => {
  assert.equal(formatBytes(0), '0 bytes');
  assert.equal(formatBytes(1), '1 byte');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(250 * 1024 * 1024), '250 MB');
  assert.equal(formatBytes(3.2 * 1024 ** 3), '3.2 GB');
  const d = describeStorage({ usage: 50 * 1024 * 1024, quota: 1024 ** 3, persisted: true, details: { caches: 30 * 1024 * 1024, indexedDB: 20 * 1024 * 1024, fileSystem: 0 } });
  assert.equal(d.summary, '50 MB used of 1.0 GB available (5%)');
  assert.equal(Math.round(d.percent!), 5);
  assert.deepEqual(d.parts.map((p) => p.size), ['30 MB', '20 MB']);
  assert.equal(describeStorage({ usage: null, quota: null, persisted: null, details: {} }).percent, null);
  assert.match(describeStorage({ usage: 10, quota: 1e12, persisted: false, details: {} }).summary, /<1%/);
});

test('the update gate waits while anything is in progress, then applies once', () => {
  let busy: string[] = ['a gesture is in progress'];
  let applied = 0;
  const seen: string[][] = [];
  const gate = new UpdateGate({ busy: () => busy, apply: () => applied++, onWaiting: (r) => seen.push(r) });
  assert.equal(gate.poke(), false, 'nothing waiting yet');
  gate.ready();
  assert.equal(applied, 0);
  assert.deepEqual(seen.at(-1), ['a gesture is in progress']);
  busy = ['a dialog is open', 'you are typing'];
  assert.equal(gate.poke(), false);
  busy = [];
  assert.equal(gate.poke(), true);
  assert.equal(applied, 1);
  gate.poke();
  gate.applyNow();
  assert.equal(applied, 1, 'applied only once');
});

test('the update gate applies at once when asked, whatever is going on', () => {
  let applied = 0;
  const gate = new UpdateGate({ busy: () => ['a job is running'], apply: () => applied++ });
  gate.applyNow();
  assert.equal(applied, 0, 'nothing is waiting');
  gate.ready();
  gate.applyNow();
  assert.equal(applied, 1);
});

test('parseLaunch reads shortcut and share launches', () => {
  assert.deepEqual(parseLaunch('?action=open'), { action: 'open', url: null, error: false });
  assert.deepEqual(parseLaunch('?action=shared&url=https%3A%2F%2Fx.com%2Fa.pdf'), { action: 'shared', url: 'https://x.com/a.pdf', error: false });
  assert.equal(parseLaunch('?action=shared&error=1').error, true);
  assert.equal(parseLaunch('?action=delete-everything').action, null);
  assert.equal(parseLaunch('?project=abc').action, null);
  assert.ok(isPdf({ name: 'A-101.PDF', type: '' }));
  assert.ok(!isPdf({ name: 'photo.jpg', type: 'image/jpeg' }));
});

test('OCR downloads the engine build Tesseract would load', () => {
  assert.equal(ocrEngineFile(true, true), 'tesseract-core-relaxedsimd-lstm.wasm.js');
  assert.equal(ocrEngineFile(true, false), 'tesseract-core-simd-lstm.wasm.js');
  assert.equal(ocrEngineFile(false, false), 'tesseract-core-lstm.wasm.js');
  assert.deepEqual(ocrFiles('fra', 'x.js'), ['worker.min.js', 'x.js', 'fra.traineddata.gz']);
});
