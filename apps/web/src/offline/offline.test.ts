import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ICON_FILES } from './icons.ts';
import { buildManifest } from './manifest.ts';
import { INSTALLER_URL, installerPlatform, INSTALL_STEPS, MAC_ARM64_URL, MAC_X64_URL } from './install.ts';
import { describeStorage, formatBytes } from './storage.ts';
import { UpdateGate } from './updates.ts';
import { isPdf, parseLaunch } from './launch.ts';
import { ocrEngineFile, ocrFiles } from './ocrCache.ts';

test('every icon the manifest and index.html name is a PNG file in public/, at its size', () => {
  for (const f of ICON_FILES) {
    const bytes = readFileSync(new URL(`../../public/${f.name}`, import.meta.url));
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], `${f.name} is a PNG`);
    const view = new DataView(bytes.buffer, bytes.byteOffset);
    assert.equal(view.getUint32(16), f.size, `${f.name} width`);
    assert.equal(view.getUint32(20), f.size, `${f.name} height`);
  }
});

test('the manifest is installable: id, scope, PNG and maskable icons, shortcuts, file handling and sharing', () => {
  const m = buildManifest('/redcolumn/');
  assert.equal(m.id, '/redcolumn/');
  assert.equal(m.start_url, '/redcolumn/');
  assert.equal(m.scope, '/redcolumn/');
  assert.equal(m.display, 'standalone');
  assert.deepEqual(m.display_override, ['window-controls-overlay', 'standalone']);
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

test('the installer links are the latest release and Windows and macOS are offered them', () => {
  assert.equal(INSTALLER_URL, 'https://github.com/ColbyGallagher/redcolumn/releases/latest/download/redcolumn-Setup.exe');
  assert.equal(MAC_ARM64_URL, 'https://github.com/ColbyGallagher/redcolumn/releases/latest/download/redcolumn-arm64.dmg');
  assert.equal(MAC_X64_URL, 'https://github.com/ColbyGallagher/redcolumn/releases/latest/download/redcolumn-x64.dmg');
  assert.equal(installerPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36'), 'windows');
  assert.equal(installerPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15'), 'mac');
  // iPadOS Safari reports itself as a Mac; its touch screen gives it away.
  assert.equal(installerPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15', 5), null);
  assert.equal(installerPlatform('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36'), null);
  assert.match(INSTALL_STEPS.windows.join(' '), /redcolumn-Setup\.exe/);
  assert.match(INSTALL_STEPS.mac.join(' '), /Open Anyway/);
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
